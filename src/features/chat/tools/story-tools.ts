/**
 * Story draft authoring tools: `read_story_draft` + `write_story_draft`.
 *
 * The AI composes into the LOCAL new-story draft (the same
 * `earthly:story:drafts:v1` slot the StoryEditorPanel pre-fills from) — it
 * never publishes. The user reviews the draft in the Story editor and
 * publishes manually, which is also where inline `nostr:naddr1…` mentions are
 * mirrored into queryable `a` tags (STORY-03).
 *
 * Scope note: only the `new-story` sentinel draft is writable. Drafts keyed by
 * a published story's d-tag are invisible in the edit panel (it pre-fills from
 * the event content instead), so offering to write them would be a silent
 * no-op for the user. Editing published stories stays with the proposal flow.
 *
 * Overwrite gate: an existing draft that this chat session did NOT write is
 * user text — refusing to clobber it without `overwrite: true` mirrors the
 * dataset gate's "confirm destructive, apply pure adds" stance at the tool-arg
 * level (the model must read the draft and confirm with the user first).
 */

import { requestOpenStoryEditor } from '@/features/geo-editor/storyEditorBridge'
import { NEW_STORY_DRAFT_KEY, readStoryDraft, writeStoryDraft } from '@/lib/nostr/story'
import type { ToolEntry } from './registry'
import type { Tool } from './types'

const MAX_TITLE_CHARS = 300
const MAX_SUMMARY_CHARS = 2_000
const MAX_BODY_CHARS = 100_000

/**
 * Whether THIS chat session authored the current new-story draft. Module-level
 * (not persisted): after a reload every existing draft counts as user text and
 * the overwrite gate re-arms.
 */
let sessionOwnsDraft = false

/** Test hook — re-arm the overwrite gate. */
export function resetStoryDraftOwnership(): void {
	sessionOwnsDraft = false
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
	'Cite entities inline in the Markdown as nostr:naddr1… written BARE in prose — never wrapped in backticks/code spans or bold (append #featureId to point at one feature inside a dataset). On publish these mentions are mirrored into queryable references automatically and render as interactive pills.'

const REVIEW_HINT =
	'Draft saved locally and the Story editor is now open on the left with the draft loaded. Tell the user to review it there and publish when ready — publishing is always their action.'

const readStoryDraftSchema: Tool = {
	type: 'function',
	function: {
		name: 'read_story_draft',
		description:
			"Read the local new-story draft (title, summary, Markdown body). Use before write_story_draft to check for existing user text, or to continue composing. Returns null fields when no draft exists. For published stories' content use read_entity instead.",
		parameters: { type: 'object', properties: {}, required: [] },
	},
}

const writeStoryDraftSchema: Tool = {
	type: 'function',
	function: {
		name: 'write_story_draft',
		description: `Write the local new-story draft the user reviews and publishes in the Story editor — this never publishes anything. ${MENTION_SYNTAX_HINT} If a draft this session didn't author already exists, the call fails unless overwrite is true — read it first and confirm with the user before overwriting.`,
		parameters: {
			type: 'object',
			properties: {
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
			},
			required: ['title', 'markdown'],
		},
	},
}

export function registerStoryTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'read_story_draft',
		kind: 'host-builtin',
		schema: readStoryDraftSchema,
		handler: async () => {
			const draft = readStoryDraft(NEW_STORY_DRAFT_KEY)
			if (!draft) {
				return { ok: true, exists: false, draft: null }
			}
			return {
				ok: true,
				exists: true,
				authoredByThisSession: sessionOwnsDraft,
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

			const existing = readStoryDraft(NEW_STORY_DRAFT_KEY)
			if (
				existing &&
				!sessionOwnsDraft &&
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

			writeStoryDraft(NEW_STORY_DRAFT_KEY, {
				title: title.trim(),
				summary,
				image,
				content: markdown,
			})
			sessionOwnsDraft = true

			// Surface the draft: open the Story editor in create mode (or re-run its
			// pre-fill if it is already open) so the user never has to hunt for it.
			requestOpenStoryEditor()

			return {
				ok: true,
				draftKey: NEW_STORY_DRAFT_KEY,
				stats: { titleChars: title.trim().length, markdownChars: markdown.length },
				note: REVIEW_HINT,
			}
		},
	})
}
