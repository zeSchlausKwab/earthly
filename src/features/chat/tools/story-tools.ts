/**
 * Story draft authoring tools: `read_story_draft` + `write_story_draft`.
 *
 * The AI composes into a LOCAL Story draft keyed either by the new-story
 * sentinel or an existing Story's d-tag. It never publishes. The user reviews
 * the draft in the Story editor and publishes manually, which is also where inline `nostr:naddr1…` mentions are
 * mirrored into queryable `a` tags (STORY-03).
 *
 * Overwrite gate: an existing draft that this chat session did NOT write is
 * user text — refusing to clobber it without `overwrite: true` mirrors the
 * dataset gate's "confirm destructive, apply pure adds" stance at the tool-arg
 * level (the model must read the draft and confirm with the user first).
 */

import { requestOpenStoryEditor } from '@/features/geo-editor/storyEditorBridge'
import { castEvent } from 'applesauce-core/casts'
import { Article } from '@/lib/nostr/article'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { eventStore } from '@/lib/nostr'
import { NEW_STORY_DRAFT_KEY, readStoryDraft, writeStoryDraft } from '@/lib/nostr/story'
import { stringifyNostrAddressReference } from '@/lib/nostr/references'
import { useEditorStore } from '@/features/geo-editor/store'
import { gateStoryDatasetReferences } from '@/features/chat/referencePublishing'
import { fetchLatestByCoordinate, parseEntityReference } from './entity-tools'
import type { ToolEntry } from './registry'
import type { Tool } from './types'

const MAX_TITLE_CHARS = 300
const MAX_SUMMARY_CHARS = 2_000
const MAX_BODY_CHARS = 100_000

/**
 * Draft slots authored by THIS chat session. Module-level (not persisted):
 * after a reload every existing draft counts as user text and the overwrite
 * gate re-arms independently for each Story d-tag.
 */
const sessionOwnedDraftKeys = new Set<string>()
const sessionReadDraftKeys = new Set<string>()

/** Test hook — re-arm the overwrite gate. */
export function resetStoryDraftOwnership(): void {
	sessionOwnedDraftKeys.clear()
	sessionReadDraftKeys.clear()
}

export function normalizeStoryFeatureReferences(markdown: string): {
	markdown: string
	normalizedCount: number
} {
	let normalizedCount = 0
	const normalized = markdown.replace(
		/(nostr:naddr1[a-z0-9]+)#([^\s)\],;]+)/gi,
		(_match, fullReference: string, rawFeatureId: string) => {
			if (!rawFeatureId.includes('/') || rawFeatureId.includes('%2F')) return _match
			normalizedCount += 1
			return stringifyNostrAddressReference({
				address: fullReference.slice('nostr:'.length),
				featureId: rawFeatureId.replace(/[.!?]+$/, ''),
			})
		},
	)
	return { markdown: normalized, normalizedCount }
}

function requireString(value: unknown, name: string, max: number): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`${name} must be a non-empty string.`)
	}
	if (value.length > max) {
		throw new Error(`${name} exceeds ${max} characters (${value.length}).`)
	}
	return value
}

function optionalString(value: unknown, name: string, max: number): string | undefined {
	if (value === undefined || value === null) return undefined
	if (typeof value !== 'string') throw new Error(`${name} must be a string.`)
	if (value.length > max) {
		throw new Error(`${name} exceeds ${max} characters (${value.length}).`)
	}
	return value.trim() || undefined
}

function explicitlyConfirmsOverwrite(message: string | undefined): boolean {
	if (!message) return false
	const normalized = message.trim().toLowerCase()
	if (/\b(?:do not|don't|dont|never)\s+(?:overwrite|replace)\b/.test(normalized)) return false
	return /\boverwrite\b/.test(normalized) || /\breplace\b[^.\n]{0,40}\bdraft\b/.test(normalized)
}

const MENTION_SYNTAX_HINT =
	'Cite datasets inline as bare nostr:naddr1… references. For one dataset feature, append the percent-encoded feature id fragment returned by read_entity (for example #relation%2F62504). When the working Dataset is new and has no naddr yet, set referencesActiveDataset=true: Earthly will ask the user to publish it, return its fresh mention, and require this Story write to be retried with that mention. Coordinates use bare RFC 5870 geo:latitude,longitude URIs; OSM elements use canonical https://www.openstreetmap.org/{node|way|relation}/{id} URLs. Never wrap references in code spans. On publish, Nostr mentions are mirrored into queryable references and all supported forms render as interactive pills.'

const REVIEW_HINT =
	'Draft saved locally. The Story edit state is ready behind the Story icon. Tell the user to review it there and publish when ready — publishing is always their action.'

const readStoryDraftSchema: Tool = {
	type: 'function',
	function: {
		name: 'read_story_draft',
		description:
			"Read a local Story draft (title, summary, Markdown body). Omit storyReference for the new-story slot; pass an existing Story's naddr to inspect its edit-draft slot. Use read_entity for the published source body.",
		parameters: {
			type: 'object',
			properties: {
				storyReference: {
					type: 'string',
					description: 'Optional existing Story naddr (nostr:naddr1…) to read its edit draft.',
				},
			},
			required: [],
		},
	},
}

const writeStoryDraftSchema: Tool = {
	type: 'function',
	function: {
		name: 'write_story_draft',
		description: `Write a local Story draft the user reviews and publishes in the Story editor — this never publishes anything. Omit storyReference to create a new Story; pass an existing Story naddr to update that Story in its edit screen. ${MENTION_SYNTAX_HINT} If a local draft this session didn't author already exists, the call fails unless overwrite is true — read it first and confirm with the user before overwriting.`,
		parameters: {
			type: 'object',
			properties: {
				storyReference: {
					type: 'string',
					description:
						'Optional existing Story naddr. When present, the matching published Story opens in edit mode with this draft.',
				},
				title: { type: 'string', description: 'Story title (required, shown as the headline).' },
				summary: {
					type: 'string',
					description: 'Short teaser/abstract shown in story lists and link previews.',
				},
				markdown: {
					type: 'string',
					description: `The full Markdown body. ${MENTION_SYNTAX_HINT}`,
				},
				image: {
					type: 'string',
					description: 'Optional cover-image URL (usually one the user provided or uploaded).',
				},
				overwrite: {
					type: 'boolean',
					description:
						'Required (true) to replace an existing draft that this session did not write. Only pass after the user confirmed.',
				},
				referencesActiveDataset: {
					type: 'boolean',
					description:
						'Set true only when this Story is intended to cite the working Dataset or one of its features and that Dataset is new (so no naddr exists yet). This triggers an explicit Publish and continue dialog before any Story draft is saved.',
				},
			},
			required: ['title', 'markdown'],
		},
	},
}

async function resolveStoryTarget(
	value: unknown,
): Promise<{ draftKey: string; story: Article } | null> {
	if (value === undefined || value === null) return null
	const ref = parseEntityReference(value)
	if (ref.kind !== ARTICLE_KIND) {
		throw new Error(
			`storyReference must point to a Story (kind ${ARTICLE_KIND}), not kind ${ref.kind}.`,
		)
	}
	const event = await fetchLatestByCoordinate(ref)
	if (!event) throw new Error('The Story target was not found on the configured content relays.')
	const story = castEvent(event, Article, eventStore)
	return { draftKey: ref.identifier, story }
}

export function registerStoryTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'read_story_draft',
		kind: 'host-builtin',
		schema: readStoryDraftSchema,
		handler: async (args) => {
			const target = await resolveStoryTarget(args.storyReference)
			const draftKey = target?.draftKey ?? NEW_STORY_DRAFT_KEY
			const draft = readStoryDraft(draftKey)
			sessionReadDraftKeys.add(draftKey)
			if (!draft) {
				return {
					ok: true,
					exists: Boolean(target),
					draftKey,
					source: target ? 'published' : 'empty',
					draft: target
						? {
								title: target.story.article.title ?? null,
								summary: target.story.article.summary ?? null,
								image: target.story.article.image ?? null,
								markdown: target.story.article.content ?? null,
								updatedAt: target.story.created_at * 1000,
							}
						: null,
				}
			}
			return {
				ok: true,
				exists: true,
				draftKey,
				authoredByThisSession: sessionOwnedDraftKeys.has(draftKey),
				draft: {
					title: draft.title ?? null,
					summary: draft.summary ?? null,
					image: draft.image ?? null,
					markdown: draft.content ?? null,
					updatedAt: draft.updatedAt,
				},
			}
		},
	})

	register({
		name: 'write_story_draft',
		kind: 'host-builtin',
		schema: writeStoryDraftSchema,
		handler: async (args, context) => {
			const title = requireString(args.title, 'title', MAX_TITLE_CHARS)
			const markdown = requireString(args.markdown, 'markdown', MAX_BODY_CHARS)
			const summary = optionalString(args.summary, 'summary', MAX_SUMMARY_CHARS)
			const image = optionalString(args.image, 'image', MAX_TITLE_CHARS)

			const target = await resolveStoryTarget(args.storyReference)
			const draftKey = target?.draftKey ?? NEW_STORY_DRAFT_KEY
			if (target && !sessionReadDraftKeys.has(draftKey)) {
				throw new Error(
					'Read the existing Story with read_story_draft before updating it. This prevents rewriting published content from model memory.',
				)
			}
			const existing = readStoryDraft(draftKey)
			if (
				existing &&
				!sessionOwnedDraftKeys.has(draftKey) &&
				(args.overwrite !== true || !explicitlyConfirmsOverwrite(context?.userMessage))
			) {
				const existingChars = existing.content?.length ?? 0
				throw new Error(
					`A draft already exists (title: ${JSON.stringify(existing.title ?? 'untitled')}, ` +
						`${existingChars} chars, updated ${new Date(existing.updatedAt).toISOString()}) ` +
						'and was not written by this session. Call read_story_draft, preserve or merge ' +
						'what the user wrote, and pass overwrite: true only after the user explicitly confirms overwrite.',
				)
			}

			const normalizedBody = normalizeStoryFeatureReferences(markdown)
			const referenceGate = await gateStoryDatasetReferences(normalizedBody.markdown, {
				run: context?.run,
				referencesActiveDataset: args.referencesActiveDataset === true,
			})
			if (referenceGate.status !== 'ready') {
				return {
					ok: false,
					...referenceGate,
				}
			}
			writeStoryDraft(draftKey, {
				title: title.trim(),
				summary,
				image,
				content: normalizedBody.markdown,
			})
			sessionOwnedDraftKeys.add(draftKey)

			// Retain the Story edit state in create mode (or refresh its pre-fill if
			// it already exists). The sidebar decides whether that state is visible.
			requestOpenStoryEditor(target?.story)

			return {
				ok: true,
				draftKey,
				mode: target ? 'edit' : 'create',
				stats: {
					titleChars: title.trim().length,
					markdownChars: normalizedBody.markdown.length,
					normalizedReferenceCount: normalizedBody.normalizedCount,
				},
				...(referenceGate.published
					? { datasetPublication: referenceGate.published }
					: useEditorStore.getState().activeDataset && useEditorStore.getState().isDirty
						? {
								datasetWarning:
									'This Story does not cite the active Dataset, which still has unpublished local edits.',
							}
						: {}),
				note: REVIEW_HINT,
			}
		},
	})
}
