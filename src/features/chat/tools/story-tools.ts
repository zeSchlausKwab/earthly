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

import {
	getStoryEditorTarget,
	requestOpenStoryEditor,
} from '@/features/geo-editor/storyEditorBridge'
import { castEvent } from 'applesauce-core/casts'
import { Article } from '@/lib/nostr/article'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { eventStore, accounts } from '@/lib/nostr'
import {
	NEW_STORY_DRAFT_KEY,
	readStoryDraft,
	writeStoryDraft,
	getStoryProposalUnsupportedFields,
	clearStoryDraft,
} from '@/lib/nostr/story'
import { toast } from 'sonner'
import { localStoryReferences } from '@/lib/nostr/story/localReferences'
import { isToolExecutionRunActive } from './executionTarget'
import { stringifyNostrAddressReference } from '@/lib/nostr/references'
import { parseStoryMarkdown } from '@/lib/map-presentation'
import { useEditorStore } from '@/features/geo-editor/store'
import { gateStoryDatasetReferences } from '@/features/chat/referencePublishing'
import { requestStoryTarget } from '@/features/chat/storyTargeting'
import { useChatStore } from '../store'
import {
	assertThreadStoryReferenceScope,
	registerRunOutput,
	resolveRunWorkTarget,
	runWorkingSet,
	type ThreadWorkTarget,
} from '../workingSet'
import { fetchLatestByCoordinate, parseEntityReference } from './entity-tools'
import type { ToolEntry } from './registry'
import type { Tool } from './types'
import {
	describeStoryMapContent,
	prepareStoryMapAuthoring,
	STORY_VIEW_AUTHORING_HINT,
	storyPresentationSchema,
} from './story-presentation'

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
const sessionReadDraftRevisions = new Map<string, string>()
const ownershipKey = (draftKey: string, chatId?: string) => `${chatId ?? 'headless'}:${draftKey}`

/** Test hook — re-arm the overwrite gate. */
export function resetStoryDraftOwnership(): void {
	sessionOwnedDraftKeys.clear()
	sessionReadDraftKeys.clear()
	sessionReadDraftRevisions.clear()
}

export function normalizeStoryFeatureReferences(markdown: string): {
	markdown: string
	normalizedCount: number
} {
	let normalizedCount = 0
	const viewFences = parseStoryMarkdown(markdown).views
	const normalized = markdown.replace(
		/(nostr:naddr1[a-z0-9]+)#([^\s)\],;]+)/gi,
		(_match, fullReference: string, rawFeatureId: string, offset: number) => {
			// A future view payload is opaque data, not prose to normalize.
			if (viewFences.some((view) => offset >= view.start && offset < view.end)) return _match
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
	'Cite published Maps inline as bare nostr:naddr1… references. Preserve feature-only fragments returned by read_entity (for example #relation%2F62504). For a local Map, use the exact localReference from get_working_set or create_map_draft in the narrative; the Story editor resolves it with explicit confirmation at publication. Local references cannot yet be opening-presentation layer sources: use published sources for view layers. Never publish while authoring. Coordinates use bare RFC 5870 geo:latitude,longitude URIs; OSM elements use canonical https://www.openstreetmap.org/{node|way|relation}/{id} URLs. Never wrap references in code spans.'

const REVIEW_HINT =
	'Draft saved locally. The Story working copy is ready behind the Story icon. Tell the user to review it there and publish when ready — publishing is always their action.'

const STORY_TARGET_CANCELLED_RESULT = {
	ok: false,
	status: 'blocked',
	code: 'story_target_cancelled',
	message:
		'Story creation was cancelled. No Story draft was written; ask again when a Story working copy is ready.',
} as const

async function ensureNewStoryTarget(
	context: Parameters<ToolEntry['handler']>[1],
	storyTitle: string,
): Promise<boolean> {
	if (!context?.run || !context.toolCallId || getStoryEditorTarget()?.mode === 'create') {
		return true
	}
	const decision = await requestStoryTarget(
		{
			chatId: context.run.chatId,
			toolCallId: context.toolCallId,
			storyTitle,
		},
		() => requestOpenStoryEditor(),
	)
	return decision.decision === 'created'
}

const readStoryDraftSchema: Tool = {
	type: 'function',
	function: {
		name: 'read_story_draft',
		description:
			'Read a permitted local Story using workingTarget from get_working_set, or a published Story using storyReference. Without a permitted target, only published content is readable. Read before changing a Story and preserve unsupported presentation/view data.',
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
		description: `Write a permitted local Story using workingTarget, or create a separate Story with createNew=true when creation is enabled. Supports MapPresentationV1 and inline earthly-view blocks. This never publishes or changes the visible editor. Read existing content first; preserve unrelated text and view data. Changes follow the user's review setting. ${MENTION_SYNTAX_HINT}`,
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
					description: `The full Markdown body. ${MENTION_SYNTAX_HINT} ${STORY_VIEW_AUTHORING_HINT}`,
				},
				presentation: storyPresentationSchema,
				createNew: {
					type: 'boolean',
					description:
						'Create another separate Story output, even if this Thread already has Story outputs. Requires new-draft permission.',
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
						'Legacy option; do not use in work Threads. Use named localReference values from get_working_set instead. Authoring never publishes a reference.',
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

export interface StoryToolDependencies {
	gateDatasetReferences?: typeof gateStoryDatasetReferences
}

export function registerStoryTools(
	register: (entry: ToolEntry) => void,
	dependencies: StoryToolDependencies = {},
): void {
	const gateDatasetReferences = dependencies.gateDatasetReferences ?? gateStoryDatasetReferences
	register({
		name: 'read_story_draft',
		kind: 'host-builtin',
		schema: readStoryDraftSchema,
		handler: async (args, context) => {
			const run = context?.run
			const scoped =
				run?.workingSet && (args.workingTarget || !args.storyReference)
					? resolveRunWorkTarget(run, args.workingTarget, 'story')
					: null
			const target = await resolveStoryTarget(
				scoped?.kind === 'story' ? scoped.storyReference : args.storyReference,
			)
			const draftKey =
				scoped?.kind === 'story' ? scoped.draftKey : (target?.draftKey ?? NEW_STORY_DRAFT_KEY)
			// A public address permits reading the published source, not a private local edit slot.
			const draft = run?.workingSet && !scoped ? null : readStoryDraft(draftKey)
			sessionReadDraftKeys.add(ownershipKey(draftKey, context?.run?.chatId))
			if (scoped)
				sessionReadDraftRevisions.set(ownershipKey(draftKey, run?.chatId), JSON.stringify(draft))
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
								presentation: target.story.article.presentation ?? null,
								mapAuthoring: describeStoryMapContent(
									target.story.article.presentation,
									target.story.article.content,
								),
								updatedAt: target.story.created_at * 1000,
							}
						: null,
				}
			}
			return {
				ok: true,
				exists: true,
				draftKey,
				authoredByThisSession: sessionOwnedDraftKeys.has(
					ownershipKey(draftKey, context?.run?.chatId),
				),
				draft: {
					title: draft.title ?? null,
					summary: draft.summary ?? null,
					image: draft.image ?? null,
					markdown: draft.content ?? null,
					presentation: draft.presentation ?? null,
					mapAuthoring: describeStoryMapContent(draft.presentation, draft.content),
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
			const ownerPubkey = accounts.active?.pubkey ?? null
			const markdown = requireString(args.markdown, 'markdown', MAX_BODY_CHARS)
			let summary = optionalString(args.summary, 'summary', MAX_SUMMARY_CHARS)
			let image = optionalString(args.image, 'image', MAX_TITLE_CHARS)

			const run = context?.run
			let scoped: ThreadWorkTarget | undefined
			if (run?.workingSet) {
				const candidates = runWorkingSet(run).filter((item) => item.kind === 'story')
				if (!args.createNew && (args.workingTarget || candidates.length || args.storyReference)) {
					scoped = resolveRunWorkTarget(run, args.workingTarget, 'story')
					if (
						scoped.kind !== 'story' ||
						(args.storyReference && args.storyReference !== scoped.storyReference)
					)
						throw new Error(
							'The requested Story is not this working target. Add its edit/proposal explicitly, not as a reference.',
						)
				} else {
					if (args.workingTarget || args.storyReference)
						throw new Error('Creating a new Story cannot also name an existing destination.')
					if (!run.allowCreate)
						throw new Error('Enable new local drafts in Working on to create a Story.')
					const key = `thread-story:${run.chatId}:${crypto.randomUUID()}`
					scoped = {
						id: `story:${key}`,
						kind: 'story',
						draftKey: key,
						title: title.trim(),
						intent: 'create',
					}
				}
			}
			const target = await resolveStoryTarget(
				scoped?.kind === 'story' ? scoped.storyReference : args.storyReference,
			)
			const draftKey =
				scoped?.kind === 'story' ? scoped.draftKey : (target?.draftKey ?? NEW_STORY_DRAFT_KEY)
			const ownerKey = ownershipKey(draftKey, run?.chatId)
			if (target && !sessionReadDraftKeys.has(ownerKey)) {
				throw new Error(
					'Read the existing Story with read_story_draft before updating it. This prevents rewriting published content from model memory.',
				)
			}
			const existing = readStoryDraft(draftKey)
			if (
				run?.workingSet &&
				existing &&
				sessionReadDraftRevisions.get(ownerKey) !== JSON.stringify(existing)
			)
				throw new Error(
					'Read the latest local Story with read_story_draft and workingTarget before replacing it. The draft may contain new user edits.',
				)
			if (run?.workingSet) {
				if (!Object.hasOwn(args, 'summary'))
					summary = existing?.summary ?? target?.story.article.summary
				if (!Object.hasOwn(args, 'image')) image = existing?.image ?? target?.story.article.image
			}
			if (
				existing &&
				!run?.workingSet &&
				!sessionOwnedDraftKeys.has(ownerKey) &&
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

			// A new Story is a distinct retained edit state, not a side effect the
			// tool may invent. Park the exact AI call until the user explicitly
			// creates that target. Direct/headless invocations without run ownership
			// retain the legacy behavior because they cannot own a visible dialog.
			if (!run?.workingSet && !target && !(await ensureNewStoryTarget(context, title.trim()))) {
				return STORY_TARGET_CANCELLED_RESULT
			}

			const normalizedBody = normalizeStoryFeatureReferences(markdown)
			if (run?.workingSet) {
				assertThreadStoryReferenceScope(normalizedBody.markdown, run)
				for (const reference of localStoryReferences(normalizedBody.markdown)) {
					const output = runWorkingSet(run).find(
						(item) => item.kind === 'dataset' && item.workspaceId === reference.workspaceId,
					)
					const sources =
						run.references?.filter((item) => item.localWorkspaceId === reference.workspaceId) ?? []
					const allowed = output
						? !output.featureIds ||
							(reference.featureId && output.featureIds.includes(reference.featureId))
						: sources.some((item) => !item.featureId || item.featureId === reference.featureId)
					if (!allowed)
						throw new Error(
							'This local Story reference is outside the Thread’s outputs or attached feature scope. Attach that source explicitly first.',
						)
				}
			}
			const mapContent = prepareStoryMapAuthoring({
				markdown: normalizedBody.markdown,
				previousMarkdown: existing?.content ?? target?.story.article.content,
				presentation: Object.hasOwn(args, 'presentation')
					? args.presentation
					: existing
						? existing.presentation
						: target?.story.article.presentation,
				replacePresentation: Object.hasOwn(args, 'presentation'),
			})
			if (
				scoped?.intent === 'propose' &&
				target &&
				getStoryProposalUnsupportedFields(target.story.article, {
					title: title.trim(),
					summary,
					image,
					...mapContent,
				}).length
			) {
				throw new Error(
					'A Story proposal can change narrative and inline views only. Preserve the cover and opening presentation, or explicitly start a new Story to make independent changes.',
				)
			}
			if (run?.workingSet && args.referencesActiveDataset === true)
				throw new Error(
					'Name an attached reference or working output explicitly. The visible Map is not an implicit source and will not be published.',
				)
			const referenceGate = run?.workingSet
				? { status: 'ready' as const, published: undefined }
				: await gateDatasetReferences(normalizedBody.markdown, {
						run: context?.run,
						referencesActiveDataset: args.referencesActiveDataset === true,
					})
			if (referenceGate.status !== 'ready') {
				return {
					ok: false,
					...referenceGate,
				}
			}
			// Dataset publication is an independent awaited gate. The author may
			// close the Story state while this tool is parked, so revalidate the
			// target at the final write boundary instead of reviving it implicitly.
			if (!run?.workingSet && !target && !(await ensureNewStoryTarget(context, title.trim()))) {
				return STORY_TARGET_CANCELLED_RESULT
			}
			if (run?.workingSet) {
				const level = useChatStore.getState().safetyLevel
				if (level === 1 || (level !== 3 && (existing || target))) {
					const decision = await requestStoryTarget(
						{
							chatId: run.chatId,
							toolCallId: context?.toolCallId ?? '',
							storyTitle: title.trim(),
							review: {
								before: JSON.stringify(existing ?? target?.story.article ?? {}, null, 2),
								after: JSON.stringify({ title, summary, image, ...mapContent }, null, 2),
							},
						},
						() => {},
					)
					if (decision.decision !== 'created')
						return {
							ok: false,
							status: 'cancelled',
							message: 'Story changes discarded. No content changed.',
						}
				}
				if (JSON.stringify(readStoryDraft(draftKey)) !== JSON.stringify(existing))
					throw new Error(
						'The Story changed while the AI was working. Read the latest draft and try again; nothing was overwritten.',
					)
				if (
					(context?.toolCallId && !isToolExecutionRunActive(run)) ||
					!useChatStore.getState().chatSessions.some((chat) => chat.id === run.chatId) ||
					(accounts.active?.pubkey ?? null) !== ownerPubkey
				)
					throw new Error(
						'This Thread run ended or its account changed. No Story changes were applied.',
					)
				if (scoped && !runWorkingSet(run).some((item) => item.id === scoped.id)) {
					registerRunOutput(run, scoped)
					const chat = useChatStore.getState().chatSessions.find((chat) => chat.id === run.chatId)
					if (!chat) throw new Error('Owning Thread unavailable.')
					useChatStore.getState().setWorkingSet(chat.id, [...(chat.workingSet ?? []), scoped])
				}
			}
			writeStoryDraft(draftKey, {
				title: title.trim(),
				summary,
				image,
				// Opening presentation and physical views commit together, after the
				// existing target/reference approvals; omitted future data stays opaque.
				...mapContent,
			})
			sessionOwnedDraftKeys.add(ownerKey)
			sessionReadDraftRevisions.set(ownerKey, JSON.stringify(readStoryDraft(draftKey)))
			if (run?.workingSet) {
				const saved = readStoryDraft(draftKey)
				toast.success(`Updated local Story: ${title.trim()}`, {
					action: {
						label: 'Undo',
						onClick: () => {
							if (
								(accounts.active?.pubkey ?? null) !== ownerPubkey ||
								JSON.stringify(readStoryDraft(draftKey)) !== JSON.stringify(saved)
							) {
								toast.error('The Story has changed since this AI edit. Undo was not applied.')
								return
							}
							if (existing) writeStoryDraft(draftKey, existing)
							else clearStoryDraft(draftKey)
							if (getStoryEditorTarget()?.draftKey === draftKey)
								requestOpenStoryEditor(target?.story, draftKey)
						},
					},
				})
			}

			// Retain the Story edit state in create mode (or refresh its pre-fill if
			// it already exists). The sidebar decides whether that state is visible.
			if (!run?.workingSet || getStoryEditorTarget()?.draftKey === draftKey)
				requestOpenStoryEditor(target?.story, scoped ? draftKey : undefined)

			return {
				ok: true,
				draftKey,
				mode: target ? 'edit' : 'create',
				workingTarget: scoped?.id,
				stats: {
					titleChars: title.trim().length,
					markdownChars: normalizedBody.markdown.length,
					normalizedReferenceCount: normalizedBody.normalizedCount,
					viewBlockCount: parseStoryMarkdown(normalizedBody.markdown).views.length,
				},
				...(referenceGate.published
					? { datasetPublication: referenceGate.published }
					: !run?.workingSet &&
							useEditorStore.getState().activeDataset &&
							useEditorStore.getState().isDirty
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
