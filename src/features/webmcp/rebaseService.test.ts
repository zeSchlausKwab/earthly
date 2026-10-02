import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import { PrivateKeyAccount } from 'applesauce-accounts/accounts'
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from 'nostr-tools'
import { accounts, eventStore } from '@/lib/nostr'
import { ARTICLE_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import { coordinateToNaddrReference } from '@/lib/nostr/references'
import { getCurrentPubkey, setCurrentPubkey } from '@/lib/wallet/currentUser'
import {
	readStoryDraft,
	writeStoryDraft,
	storyContentFingerprint,
	type StoryDraft,
} from '@/lib/nostr/story/draft'
import {
	readGroupEditorDraft,
	writeGroupEditorDraft,
	type GroupEditorDraft,
} from '@/features/groups/editorDraft'
import {
	documentDraftRevision,
	type AuthoringDocumentKind,
} from '@/features/chat/tools/document-authoring'
import { registerDocumentDraftForm } from '@/features/chat/tools/documentDraftForms'
import { getSafetyLevel, setSafetyLevelProvider } from '@/features/chat/safeEditing/safetyAccess'
import { createDocumentRebaseTools } from './rebaseService'
import type { RebaseField } from '@/features/chat/tools/document-rebase'
import {
	clearDocumentReviews,
	getDocumentReviews,
	resolveDocumentReview,
	subscribeDocumentReviews,
	undoDocumentReview,
	type DocumentReview,
} from './documentReviews'
import { useWebMcpStore } from './state'
import type { BrowserTool } from './platform'

const secret = generateSecretKey(),
	owner = getPublicKey(secret)
const account = PrivateKeyAccount.fromKey<{ ephemeral?: boolean }>(secret)
const priorAccount = accounts.active,
	priorOwner = getCurrentPubkey()
const priorAccess = useWebMcpStore.getState(),
	priorSafety = getSafetyLevel(),
	priorWindow = globalThis.window
const storage = new Map<string, string>()
let failWrites = false
let sequence = 50_000,
	session: AbortController,
	tools: BrowserTool[]
let allowedReferences: Set<string>
let explicitRebases: Array<{ kind: AuthoringDocumentKind; key: string; revision: string }>
let leases: Map<string, { kind: AuthoringDocumentKind; key: string; revision: string | null }>

beforeAll(() =>
	Object.assign(globalThis, {
		window: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => {
					if (failWrites) throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
					storage.set(key, value)
				},
				removeItem: (key: string) => storage.delete(key),
			},
		},
	}),
)
afterAll(() => {
	if (priorWindow === undefined) delete (globalThis as { window?: unknown }).window
	else Object.assign(globalThis, { window: priorWindow })
})

function must<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) throw new Error('Required fixture value is absent')
	return value
}
interface NativeResult {
	ok: boolean
	code?: string
	message?: string
	status?: string
	reference?: string
}
interface NativePreview extends NativeResult {
	fields: RebaseField[]
	conflicts: string[]
	baseAvailable: boolean
	rebaseToken: string
}
function read(kind: AuthoringDocumentKind, key: string) {
	return kind === 'story' ? readStoryDraft(key, owner) : readGroupEditorDraft(key, owner)
}
function issue(kind: AuthoringDocumentKind, key: string) {
	const token = crypto.randomUUID()
	leases.set(token, { kind, key, revision: documentDraftRevision(read(kind, key)) })
	return token
}
beforeEach(() => {
	storage.clear()
	failWrites = false
	clearDocumentReviews()
	accounts.active$.next(account)
	setCurrentPubkey(owner)
	useWebMcpStore.setState({ enabled: true })
	setSafetyLevelProvider(() => 3)
	session = new AbortController()
	leases = new Map()
	allowedReferences = new Set()
	explicitRebases = []
	tools = createDocumentRebaseTools({
		owner,
		getOwner: () => accounts.active?.pubkey ?? null,
		sessionSignal: session.signal,
		readLease: (kind, key, token) => {
			const lease = typeof token === 'string' ? leases.get(token) : undefined
			return lease?.kind === kind && lease.key === key ? lease.revision : undefined
		},
		issueDraftToken: issue,
		onExplicitRebase: (kind, key, revision) => explicitRebases.push({ kind, key, revision }),
		assertReferenceAllowed: (reference) => {
			if (!allowedReferences.has(reference)) throw new Error(`Reference not readable: ${reference}`)
		},
		tool: (name, description, inputSchema, readOnly, handler) => ({
			name,
			description,
			inputSchema,
			annotations: {
				readOnlyHint: readOnly,
				consequentialHint: !readOnly,
				untrustedContentHint: true,
			},
			execute: async (args, context) => {
				try {
					return await handler(
						args as Record<string, unknown>,
						context?.signal ?? session.signal,
						`rebase-${sequence++}`,
					)
				} catch (error) {
					return {
						ok: false,
						code: (error as { code?: string }).code,
						message: (error as Error).message,
					}
				}
			},
		}),
	})
})
afterEach(() => {
	session.abort()
	clearDocumentReviews()
	failWrites = false
	accounts.active$.next(priorAccount)
	setCurrentPubkey(priorOwner)
	useWebMcpStore.setState(priorAccess, true)
	setSafetyLevelProvider(() => priorSafety)
})
function signed(
	kind: number,
	key: string,
	content: Record<string, unknown>,
	tags: string[][] = [],
) {
	return finalizeEvent(
		{
			kind,
			created_at: sequence++,
			tags: [['d', key], ...tags],
			content: JSON.stringify({ ...content, modelVersion: MODEL_VERSION }),
		},
		secret,
	)
}
interface Fixture {
	kind: AuthoringDocumentKind
	key: string
	latest: NostrEvent
	before: StoryDraft | GroupEditorDraft
}
function story(
	options: {
		legacy?: boolean
		storeOriginal?: boolean
		current?: boolean
		originalExpired?: boolean
		remoteContent?: string
		presentation?: unknown
	} = {},
): Fixture {
	const key = `native-rebase-story-${sequence++}`
	const base = {
		title: 'Base title',
		summary: 'Base summary',
		image: '',
		content: 'Base body',
		...(options.presentation !== undefined ? { presentation: options.presentation } : {}),
	}
	const original = signed(
		ARTICLE_KIND,
		key,
		base,
		options.originalExpired ? [['expiration', '1']] : [],
	)
	if (options.storeOriginal !== false) eventStore.add(original)
	const latest = options.current
		? original
		: signed(ARTICLE_KIND, key, {
				...base,
				title: 'Remote title',
				summary: 'Remote summary',
				...(options.remoteContent ? { content: options.remoteContent } : {}),
			})
	eventStore.add(latest)
	const before: StoryDraft = {
		...base,
		title: 'Local title',
		updatedAt: 123,
		...(!options.legacy
			? {
					publication: {
						reference: must(coordinateToNaddrReference(`${ARTICLE_KIND}:${owner}:${key}`)),
						eventId: original.id,
						fingerprint: storyContentFingerprint(base),
					},
				}
			: {}),
	}
	writeStoryDraft(key, before, owner)
	return { kind: 'story', key, latest, before: must(readStoryDraft(key, owner)) }
}
function atlas(legacy = false): Fixture {
	const id = `native-rebase-atlas-${sequence++}`,
		key = `edit:${owner}:${id}`
	const base = {
		name: 'Base Atlas',
		description: 'Base description',
		image: '',
		governance: 'closed',
	}
	const original = signed(MAP_CONTEXT_KIND, id, base)
	eventStore.add(original)
	const latest = signed(MAP_CONTEXT_KIND, id, {
		...base,
		name: 'Remote Atlas',
		description: 'Remote description',
	})
	eventStore.add(latest)
	const before: GroupEditorDraft = {
		name: 'Local Atlas',
		description: 'Base description',
		image: '',
		governance: 'closed',
		schemaMode: 'builder',
		allowedGeometryTypes: [],
		rows: [],
		advancedJson: '{}',
		sampleJson: '{}',
		curatedReferences: [],
		updatedAt: 123,
		...(legacy ? {} : { sourceRevisionId: original.id }),
	}
	writeGroupEditorDraft(key, before, owner)
	return { kind: 'atlas', key, latest, before: must(readGroupEditorDraft(key, owner)) }
}
async function call(
	name: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<NativeResult> {
	const tool = tools.find((entry) => entry.name === `earthly_${name}`)
	if (!tool) throw new Error(`Missing tool ${name}`)
	return (await tool.execute(args, { signal })) as NativeResult
}
async function prepare(
	fixture: Fixture,
	token: string = issue(fixture.kind, fixture.key),
	revision = fixture.latest.id,
) {
	return (await call('prepare_document_rebase', {
		kind: fixture.kind,
		draftTarget: fixture.key,
		draftToken: token,
		sourceRevisionId: revision,
	})) as NativePreview
}
function apply(
	preview: NativePreview,
	resolutions: Record<string, unknown> = { title: { choice: 'local' } },
	signal?: AbortSignal,
) {
	return call(
		'apply_document_rebase',
		{ rebaseToken: preview.rebaseToken, confirm: true, resolutions },
		signal,
	)
}
function nextReview(): Promise<DocumentReview> {
	return new Promise((resolve) => {
		const unsubscribe = subscribeDocumentReviews(() => {
			const review = getDocumentReviews().find((entry) => entry.status === 'pending')
			if (review) {
				unsubscribe()
				resolve(review)
			}
		})
	})
}

test('preparation compares full snapshots without changing content or publication baseline', async () => {
	const fixture = story()
	const preview = await prepare(fixture)
	expect(preview.ok).toBe(true)
	expect(preview.conflicts).toEqual(['title'])
	expect(must(preview.fields.find((field) => field.field === 'summary')).status).toBe('remote-only')
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
	expect(getDocumentReviews()).toHaveLength(0)
	expect(explicitRebases).toEqual([])
})

test('explicit conflict resolution advances the existing lineage and Undo restores the exact old baseline', async () => {
	const fixture = story(),
		preview = await prepare(fixture)
	const result = await apply(preview)
	expect(result.status).toBe('rebased')
	expect(explicitRebases).toEqual([
		{ kind: 'story', key: fixture.key, revision: fixture.latest.id },
	])
	expect(readStoryDraft(fixture.key, owner)).toMatchObject({
		title: 'Local title',
		summary: 'Remote summary',
		publication: { eventId: fixture.latest.id },
	})
	expect(result.reference).toBe(`${ARTICLE_KIND}:${owner}:${fixture.key}`)
	const review = must(getDocumentReviews().at(-1))
	expect(undoDocumentReview(review.id)).toBe(true)
	expect(explicitRebases).toHaveLength(1)
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
})

test.each(['story', 'atlas'] as const)(
	'a legacy %s has explicit differing-field conflicts and Undo removes its newly installed baseline',
	async (kind) => {
		const fixture = kind === 'story' ? story({ legacy: true }) : atlas(true)
		const preview = await prepare(fixture)
		expect(preview.baseAvailable).toBe(false)
		const resolutions = Object.fromEntries(
			preview.conflicts.map((field: string) => [field, { choice: 'local' }]),
		)
		expect((await apply(preview, resolutions)).status).toBe('rebased')
		expect(undoDocumentReview(must(getDocumentReviews().at(-1)).id)).toBe(true)
		expect(documentDraftRevision(read(kind, fixture.key))).toBe(
			documentDraftRevision(fixture.before),
		)
	},
)

test('Atlas policy and metadata rebase through the same review and exact Undo boundary', async () => {
	const fixture = atlas(),
		preview = await prepare(fixture)
	expect(preview.baseAvailable).toBe(false)
	expect(preview.conflicts).toEqual(['name', 'description'])
	expect(
		(await apply(preview, { name: { choice: 'remote' }, description: { choice: 'remote' } }))
			.status,
	).toBe('rebased')
	expect(readGroupEditorDraft(fixture.key, owner)).toMatchObject({
		name: 'Remote Atlas',
		description: 'Remote description',
		sourceRevisionId: fixture.latest.id,
	})
	expect(undoDocumentReview(must(getDocumentReviews().at(-1)).id)).toBe(true)
	expect(documentDraftRevision(readGroupEditorDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
})

test('missing, mismatched and stale draft tokens cannot prepare a rebase', async () => {
	const fixture = story(),
		token = issue('story', fixture.key)
	expect((await prepare(fixture, 'missing')).code).toBe('draft_token_required')
	writeStoryDraft(fixture.key, { ...(fixture.before as StoryDraft), title: 'Human edit' }, owner)
	expect((await prepare(fixture, token)).code).toBe('stale_draft')
	const other = story()
	expect((await prepare(other, token)).code).toBe('draft_token_required')
})

test('missing rebase tokens, absent confirmation and unresolved conflicts never change a draft', async () => {
	const fixture = story(),
		preview = await prepare(fixture)
	expect(
		(
			await call('apply_document_rebase', {
				confirm: true,
				resolutions: {},
				rebaseToken: 'missing',
			})
		).code,
	).toBe('rebase_token_required')
	expect(
		(await call('apply_document_rebase', { resolutions: {}, rebaseToken: preview.rebaseToken }))
			.code,
	).toBe('confirmation_required')
	expect((await apply(preview, {})).ok).toBe(false)
	expect(explicitRebases).toEqual([])
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
})

test('a token is consumed after success and cannot reapply its stale snapshot', async () => {
	const fixture = story(),
		preview = await prepare(fixture)
	expect((await apply(preview)).ok).toBe(true)
	expect((await apply(preview)).code).toBe('rebase_token_required')
})

test('a local edit during approval is preserved and makes the prepared rebase stale', async () => {
	const fixture = story(),
		preview = await prepare(fixture)
	setSafetyLevelProvider(() => 1)
	const reviewing = nextReview(),
		pending = apply(preview),
		review = await reviewing
	writeStoryDraft(
		fixture.key,
		{ ...(fixture.before as StoryDraft), content: 'Human work during review' },
		owner,
	)
	resolveDocumentReview(review.id, true)
	expect((await pending).code).toBe('stale_draft')
	expect(readStoryDraft(fixture.key, owner)?.content).toBe('Human work during review')
	expect(readStoryDraft(fixture.key, owner)?.publication).toEqual(
		(fixture.before as StoryDraft).publication,
	)
})

test('a newer publication during approval invalidates the public-source CAS', async () => {
	const fixture = story(),
		preview = await prepare(fixture)
	setSafetyLevelProvider(() => 1)
	const reviewing = nextReview(),
		pending = apply(preview),
		review = await reviewing
	eventStore.add(
		signed(ARTICLE_KIND, fixture.key, {
			title: 'Newest public title',
			summary: 'Newest summary',
			content: 'New body',
		}),
	)
	resolveDocumentReview(review.id, true)
	expect((await pending).code).toBe('stale_source')
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
})

test('stale public reads and subsequent source replacements invalidate previews before editing', async () => {
	const fixture = story()
	expect((await prepare(fixture, issue('story', fixture.key), '0'.repeat(64))).code).toBe(
		'stale_source',
	)
	const preview = await prepare(fixture)
	eventStore.add(
		signed(ARTICLE_KIND, fixture.key, { title: 'A newer public title', content: 'Latest body' }),
	)
	expect((await apply(preview)).code).toBe('stale_source')
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
})

test('permission revocation during review prevents a merged reference from committing', async () => {
	const reference = `37515:${'b'.repeat(64)}:authorized-then-revoked`
	allowedReferences.add(reference)
	const fixture = story(),
		preview = await prepare(fixture)
	setSafetyLevelProvider(() => 1)
	const reviewing = nextReview()
	const pending = apply(preview, {
		title: { choice: 'local' },
		content: {
			choice: 'merged',
			value: `Permitted map ${coordinateToNaddrReference(reference)}`,
		},
	})
	const review = await reviewing
	allowedReferences.delete(reference)
	resolveDocumentReview(review.id, true)
	const result = await pending
	expect(result.ok).toBe(false)
	expect(result.message).toContain('Reference not readable')
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
})

test('cancelled review preserves content and allows a fresh approval of the same preview', async () => {
	const fixture = story(),
		preview = await prepare(fixture)
	setSafetyLevelProvider(() => 1)
	const reviewing = nextReview(),
		pending = apply(preview),
		review = await reviewing
	resolveDocumentReview(review.id, false)
	expect((await pending).status).toBe('cancelled')
	expect(explicitRebases).toEqual([])
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
	setSafetyLevelProvider(() => 3)
	expect((await apply(preview)).status).toBe('rebased')
})

test('aborting an in-flight review never rebases its draft', async () => {
	const fixture = story(),
		preview = await prepare(fixture),
		controller = new AbortController()
	setSafetyLevelProvider(() => 1)
	const reviewing = nextReview(),
		pending = apply(preview, undefined, controller.signal)
	await reviewing
	controller.abort()
	expect((await pending).ok).toBe(false)
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
})

test.each(['account', 'access', 'session'] as const)(
	'%s revocation invalidates a prepared token without edits',
	async (mode) => {
		const fixture = story(),
			preview = await prepare(fixture)
		if (mode === 'account') {
			const other = PrivateKeyAccount.fromKey<{ ephemeral?: boolean }>(generateSecretKey())
			accounts.active$.next(other)
			setCurrentPubkey(other.pubkey)
		}
		if (mode === 'access') useWebMcpStore.setState({ enabled: false })
		if (mode === 'session') session.abort()
		expect((await apply(preview)).ok).toBe(false)
		expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
			documentDraftRevision(fixture.before),
		)
	},
)

test('unavailable or expired original snapshots can use the retained exact Story fingerprint', async () => {
	for (const options of [{ storeOriginal: false }, { originalExpired: true }]) {
		const fixture = story(options),
			preview = await prepare(fixture)
		expect(preview.ok).toBe(true)
		expect(preview.baseAvailable).toBe(true)
		expect(preview.conflicts).toEqual(['title'])
	}
})

test('new merged references require permission while known public bindings may be retained', async () => {
	const map = must(coordinateToNaddrReference(`37515:${'a'.repeat(64)}:unread-map`))
	const fixture = story(),
		preview = await prepare(fixture)
	const result = await apply(preview, {
		title: { choice: 'local' },
		content: { choice: 'merged', value: `New reference ${map}` },
	})
	expect(result.ok).toBe(false)
	expect(result.message).toContain('Reference not readable')
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
	const retained = story({ remoteContent: `Known public reference ${map}` })
	expect((await apply(await prepare(retained))).status).toBe('rebased')
})

test.each([42, { version: 2, arbitrary: 'new content' }])(
	'new merged malformed or future presentations are rejected',
	async (presentation) => {
		const fixture = story(),
			preview = await prepare(fixture)
		expect(
			(
				await apply(preview, {
					title: { choice: 'local' },
					presentation: { choice: 'merged', value: presentation },
				})
			).ok,
		).toBe(false)
		expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
			documentDraftRevision(fixture.before),
		)
	},
)

test('opaque future presentation snapshots are preserved when retained, including Undo', async () => {
	const opaque = { version: 22, nested: { unknown: ['future', 1] } }
	const fixture = story({ presentation: opaque }),
		preview = await prepare(fixture)
	expect((await apply(preview)).status).toBe('rebased')
	expect(readStoryDraft(fixture.key, owner)?.presentation).toEqual(opaque)
	expect(undoDocumentReview(must(getDocumentReviews().at(-1)).id)).toBe(true)
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
})

test('failed Undo storage writes do not claim to restore the original publication baseline', async () => {
	const fixture = story(),
		preview = await prepare(fixture)
	expect((await apply(preview)).status).toBe('rebased')
	const saved = documentDraftRevision(readStoryDraft(fixture.key, owner)),
		review = must(getDocumentReviews().at(-1))
	failWrites = true
	expect(undoDocumentReview(review.id)).toBe(false)
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(saved)
	expect(getDocumentReviews().at(-1)?.status).toBe('applied')
	failWrites = false
	expect(undoDocumentReview(review.id)).toBe(true)
	expect(documentDraftRevision(readStoryDraft(fixture.key, owner))).toBe(
		documentDraftRevision(fixture.before),
	)
})

test('the already-current shortcut still detects human form edits during source lookup', async () => {
	const fixture = story({ current: true }),
		token = issue('story', fixture.key)
	let flushes = 0
	const unregister = registerDocumentDraftForm({
		kind: 'story',
		draftKey: fixture.key,
		ownerPubkey: owner,
		suppress: () => {},
		flush: () => {
			if (++flushes === 2)
				writeStoryDraft(
					fixture.key,
					{ ...(fixture.before as StoryDraft), content: 'Unsaved human input' },
					owner,
				)
		},
	})
	try {
		expect((await prepare(fixture, token)).code).toBe('stale_draft')
		expect(readStoryDraft(fixture.key, owner)?.content).toBe('Unsaved human input')
	} finally {
		unregister()
	}
})
