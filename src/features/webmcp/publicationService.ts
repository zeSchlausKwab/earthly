import { castEvent } from 'applesauce-core/casts'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { NostrEvent } from 'nostr-tools'
import { accounts, eventStore, publish } from '@/lib/nostr'
import { config } from '@/config'
import { readRelaysFor } from '@/lib/nostr/relay-router'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { getCurrentPubkey } from '@/lib/wallet/currentUser'
import { ARTICLE_KIND, GEO_EVENT_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import {
	GroupFactory,
	getGroupReferencedAddresses,
	isGroup,
	type GroupContent,
} from '@/lib/nostr/group'
import { MapContext } from '@/lib/nostr/map-context'
import {
	coordinateToNaddrReference,
	extractReferencedCoordinates,
	setAddressReferenceTags,
} from '@/lib/nostr/references'
import { readStoryDraft, storyContentFingerprint, writeStoryDraft } from '@/lib/nostr/story/draft'
import { validateStoryPresentation } from '@/lib/nostr/story/lifecycle'
import {
	assertPublishedStoryReferences,
	resolveLocalStoryReference,
} from '@/lib/nostr/story/localReferences'
import { resolveLocalMapPresentationSource } from '@/lib/map-presentation'
import { computeSchemaHash } from '@/lib/group/schemaHash'
import { validateSchema } from '@/lib/validation/schemaWorker'
import {
	readGroupEditorDraft,
	writeGroupEditorDraft,
	clearGroupEditorDraft,
	normalizeAtlasPresentationForPublish,
	type GroupEditorDraft,
} from '@/features/groups/editorDraft'
import { compileBuilderSchema } from '@/features/groups/schemaBuilder'
import { getAtlasEditorTarget, requestOpenAtlasEditor } from '@/features/groups/atlasEditorBridge'
import {
	flushDocumentDraftForm,
	suppressDocumentDraftFormSave,
} from '@/features/chat/tools/documentDraftForms'
import { documentDraftRevision } from '@/features/chat/tools/document-authoring'
import {
	captureLocalStoryDependencies,
	resolveLocalStoryDependencies,
} from '@/features/chat/referencePublishing/localStoryDependencies'
import {
	publishCapturedPublicDataset,
	capturedDatasetPublicationMode,
} from '@/features/chat/referencePublishing/publishCapturedDataset'
import type { CapturedDatasetPublication } from '@/features/chat/referencePublishing/types'
import type { ToolJsonSchema } from '@/features/chat/tools/types'
import {
	publishSavedStory,
	savedStorySource,
	storyPublicationCoordinate,
} from '@/features/geo-editor/storyPublication'
import { draftContentFingerprint } from '@/features/geo-editor/draftContent'
import { reconcilePublishedDatasetIdentity } from '@/features/geo-editor/publicationIdentity'
import { useEditorStore } from '@/features/geo-editor/store'
import {
	flushPersistedGeoCollectionDraftState,
	writePersistedGeoCollectionDraftState,
} from '@/features/geo-editor/store/editorCoreSlice'
import { readPersistedGeoCollectionDraftState } from '@/features/geo-editor/store/draftSlice'
import {
	readPersistedWorkspaceState,
	writePersistedWorkspaceState,
} from '@/features/geo-editor/store/workspaceSlice'
import type { BrowserTool } from './platform'
import { BrowserToolError } from './mapContext'
import { useWebMcpStore } from './state'
import type { BrowserPublicDocumentSource } from './lifecycleService'
import {
	matchesSignedPublication,
	observeSignedPublications,
	type SignedPublicationObservation,
} from './publicationObservation'

export const BROWSER_PUBLICATION_TOOLS = [
	'prepare_publication',
	'publish_publication',
	'reconcile_publication',
] as const
type ToolFactory = (
	name: string,
	description: string,
	schema: ToolJsonSchema,
	readOnly: boolean,
	handler: (args: Record<string, unknown>, signal: AbortSignal, id: string) => Promise<unknown>,
) => BrowserTool
export type PublicationTarget =
	| { kind: 'map'; workspaceId: string }
	| { kind: 'story' | 'atlas'; draftKey: string }
type RelayResponse = { ok: boolean; from: string; message?: string }
export interface PublicationReceipt {
	eventId: string
	coordinate: string
	reference: string | null
	delivery: 'acknowledged' | 'unknown'
	relays: RelayResponse[]
	target: PublicationTarget
	observation?: SignedPublicationObservation
	/** Local identity recovery is separate from relay delivery evidence. */
	localRecovery?: string
}
interface MapLease {
	captured: CapturedDatasetPublication
	revision: string
	completed: boolean
}
interface Plan {
	target: PublicationTarget
	account: NonNullable<typeof accounts.active>
	signer: NonNullable<typeof accounts.signer>
	revision: string
	base: NostrEvent | null
	maps: MapLease[]
	atlas?: GroupEditorDraft
	schema?: Record<string, unknown>
	schemaHash?: string
	storyReference?: string
	title: string
	status: 'prepared' | 'executing' | 'finished'
	receipts: PublicationReceipt[]
	signedEvents: Map<string, NostrEvent>
	recoveryBlocked?: boolean
	explicitRebaseRevisionId?: string
	result?: Record<string, unknown>
}

function hash(value: unknown) {
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))))
}
function targetKey(target: PublicationTarget) {
	return target.kind === 'map' ? `map:${target.workspaceId}` : `${target.kind}:${target.draftKey}`
}
function mapRevision(workspaceId: string) {
	const state = useEditorStore.getState()
	const workspace = state.workspaces[workspaceId]
	const draft = state.geoEditDrafts[workspace?.activeDraftId ?? '']
	if (!workspace || !draft || draft.sourceId !== workspace.sourceId)
		throw new BrowserToolError('draft_not_found', 'This exact Map working copy is unavailable.')
	if (state.pendingHydratedDraftId === draft.id)
		throw new BrowserToolError(
			'map_not_ready',
			'Wait for this Map to finish loading before preparing publication.',
		)
	if (workspace.datasetKey && workspace.baseRevisionId && draft.authoringIntent !== 'fork') {
		const [pubkey, ...identifier] = workspace.datasetKey.split(':')
		const latest = eventStore.getReplaceable(GEO_EVENT_KIND, pubkey!, identifier.join(':'))
		if (latest && latest.id !== workspace.baseRevisionId)
			throw new BrowserToolError(
				'stale_source',
				'This retained Map was opened against an older source revision. Review your changes and reopen or explicitly fork before publishing.',
			)
	}
	return hash([
		workspace.id,
		workspace.sourceId,
		workspace.datasetKey,
		workspace.baseRevisionId,
		workspace.activeDraftId,
		draftContentFingerprint(draft),
		draft.authoringIntent,
		draft.sourceDataset,
		draft.name,
		draft.description,
		draft.persistenceVersion,
	])
}
function assertPublicBaseCurrent(base: NostrEvent | null) {
	if (!base) return
	const identifier = base.tags.find((tag) => tag[0] === 'd')?.[1]
	const latest = identifier ? eventStore.getReplaceable(base.kind, base.pubkey, identifier) : null
	if (!latest || latest.id !== base.id)
		throw new BrowserToolError(
			'stale_source',
			'The loaded public source changed. Reopen its latest revision and prepare again.',
		)
}
function documentRevision(target: Exclude<PublicationTarget, { kind: 'map' }>, owner: string) {
	flushDocumentDraftForm(target.kind, target.draftKey, owner)
	const draft =
		target.kind === 'story'
			? readStoryDraft(target.draftKey, owner)
			: readGroupEditorDraft(target.draftKey, owner)
	if (!draft)
		throw new BrowserToolError(
			'draft_not_found',
			'This current-account document draft is unavailable.',
		)
	return hash(documentDraftRevision(draft))
}
function captureMaps(markdown: string, key: string): MapLease[] {
	// Local Story references need their own reviewed publication first. Never drop them silently.
	if (/earthly-story-draft:/u.test(markdown))
		throw new BrowserToolError(
			'unpublished_story_dependency',
			'Publish the referenced Story first, replace its local reference with the published address, then prepare again.',
		)
	return captureLocalStoryDependencies(markdown, key).map((captured) => ({
		captured: structuredClone(captured),
		revision: mapRevision(captured.binding.workspaceId),
		completed: false,
	}))
}
function atlasBase(key: string, owner: string, draft: GroupEditorDraft): NostrEvent | null {
	if (key === 'new-context' || key.startsWith('thread-atlas:')) return null
	const match = /^edit:([0-9a-f]{64}):(.+)$/iu.exec(key)
	if (!match || match[1] !== owner)
		throw new BrowserToolError(
			'publication_scope',
			'Only new public Atlases or an exact owned public Atlas edit slot can be published.',
		)
	if (!draft.sourceRevisionId)
		throw new BrowserToolError(
			'source_revision_unknown',
			'This retained Atlas edit has no known original revision. Preserve your changes as an explicit copy, or review/discard this retained edit and reopen the current published Atlas before updating.',
		)
	const latest = eventStore.getReplaceable(MAP_CONTEXT_KIND, owner, match[2]!)
	if (latest && latest.id !== draft.sourceRevisionId)
		throw new BrowserToolError(
			'stale_source',
			'This retained Atlas was opened against an older source revision. Preserve your changes and reopen or explicitly fork before updating.',
		)
	const base = eventStore.getEvent(draft.sourceRevisionId)
	if (
		!base ||
		!isGroup(base) ||
		base.pubkey !== owner ||
		base.tags.find((tag) => tag[0] === 'd')?.[1] !== match[2]
	)
		throw new BrowserToolError(
			'source_not_found',
			'Load the exact original public Atlas revision before preparing its update.',
		)
	return base
}
function atlasCuratedCoordinates(values: string[]) {
	return [
		...new Set(
			values.flatMap((value) => {
				const reference = value.trim()
				// Native document writes retain exact public coordinates; the UI also retains naddr references.
				return /^(37515|37520):[a-fA-F0-9]{64}:.+$/u.test(reference)
					? [reference]
					: extractReferencedCoordinates(reference)
			}),
		),
	]
}
function atlasPresentation(draft: GroupEditorDraft, base: NostrEvent | null) {
	const preserved =
		base && isGroup(base)
			? getGroupReferencedAddresses(base).filter(
					(coordinate) => coordinateToNaddrReference(coordinate) === null,
				)
			: []
	return normalizeAtlasPresentationForPublish(draft.presentation, [
		...extractReferencedCoordinates(draft.description),
		...atlasCuratedCoordinates(draft.curatedReferences),
		...preserved,
	])
}

/** Scoped public publication plans; prepare never signs, uploads, or transmits. */
export function createPublicationTools(options: {
	tool: ToolFactory
	owner: string | null
	getOwner: () => string | null
	sessionSignal: AbortSignal
	assertToolAllowed?: (name: string, args: Record<string, unknown>) => void
	/** A positive acknowledgement or verified relay read grants only the exact signed source. */
	onPublicSource?: (source: BrowserPublicDocumentSource) => void
	/** Test seams use the same captured payload and validation contracts. */
	publishDataset?: typeof publishCapturedPublicDataset
	publishStory?: typeof publishSavedStory
	publishEvent?: typeof publish
	/** Read-only exact-ID relay observation; never substitutes local cached events. */
	observeEvents?: typeof observeSignedPublications
	getObservationRelays?: () => string[]
	/** Private witness from a successful reviewed native rebase, scoped to this runtime. */
	registerExplicitRebase?: (
		handler: (kind: 'story' | 'atlas', draftKey: string, sourceRevisionId: string) => void,
	) => void
}): BrowserTool[] {
	const { tool, owner, getOwner, sessionSignal } = options
	const plans = new Map<string, Plan>()
	sessionSignal.addEventListener('abort', () => plans.clear(), { once: true })
	function active(signal: AbortSignal, plan?: Plan) {
		signal.throwIfAborted()
		sessionSignal.throwIfAborted()
		if (
			!useWebMcpStore.getState().enabled ||
			!owner ||
			getOwner() !== owner ||
			getCurrentPubkey() !== owner
		)
			throw new BrowserToolError(
				'access_disabled',
				'Publication access or its account changed. Enable access again and prepare a new plan.',
			)
		if (
			accounts.active?.pubkey !== owner ||
			!accounts.signer ||
			(plan && (accounts.active !== plan.account || accounts.signer !== plan.signer))
		)
			throw new BrowserToolError(
				'account_changed',
				'The signing account changed. Prepare publication again.',
			)
	}
	function validate(plan: Plan, signal: AbortSignal) {
		active(signal, plan)
		assertNoUnresolvedPublication(plan)
		if (plan.target.kind !== 'map' && documentRevision(plan.target, owner!) !== plan.revision)
			throw new BrowserToolError(
				'stale_draft',
				'The document changed after preview. Nothing further will be signed; prepare its current revision again.',
			)
		active(signal, plan) // Form flush can synchronously change account/access state.
		assertNoUnresolvedPublication(plan)
		assertPublicBaseCurrent(plan.base)
		for (const lease of plan.maps) {
			if (lease.completed) continue
			if (mapRevision(lease.captured.binding.workspaceId) !== lease.revision)
				throw new BrowserToolError(
					'stale_map',
					'A Map in this publication plan changed. Prepare the current revisions again.',
				)
			if (lease.captured.authoringIntent !== 'fork')
				assertPublicBaseCurrent(lease.captured.baseEvent)
		}
	}
	function grantSignedSource(plan: Plan, event: NostrEvent, receipt: PublicationReceipt) {
		if (
			!options.onPublicSource ||
			event.pubkey !== owner ||
			(event.kind !== GEO_EVENT_KIND && event.kind !== ARTICLE_KIND)
		)
			return
		const content = JSON.parse(event.content) as Record<string, unknown>
		const map = event.kind === GEO_EVENT_KIND
		options.onPublicSource({
			kind: map ? 'map' : 'story',
			reference: receipt.coordinate,
			revisionId: event.id,
			wholeSource: true,
			title:
				typeof content[map ? 'name' : 'title'] === 'string'
					? String(content[map ? 'name' : 'title'])
					: plan.title,
			...(receipt.reference ? { citeReference: receipt.reference } : {}),
			...(map
				? {
						featureIds: Array.isArray(content.features)
							? content.features.flatMap((feature) => {
									if (
										!feature ||
										typeof feature !== 'object' ||
										feature.properties?.externalPlaceholder === true
									)
										return []
									return typeof feature.id === 'string' || typeof feature.id === 'number'
										? [String(feature.id)]
										: []
								})
							: [],
					}
				: {}),
		})
	}
	function receiptHooks(plan: Plan, signal: AbortSignal, map?: MapLease) {
		return {
			signal,
			beforeCommit: () => validate(plan, signal),
			onSigned: (event: NostrEvent) => {
				const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
				const coordinate = `${event.kind}:${event.pubkey}:${identifier ?? ''}`
				plan.signedEvents.set(event.id, structuredClone(event))
				plan.receipts.push({
					eventId: event.id,
					coordinate,
					reference: coordinateToNaddrReference(coordinate),
					delivery: 'unknown',
					relays: [],
					target: map
						? { kind: 'map', workspaceId: map.captured.binding.workspaceId }
						: plan.target,
				})
			},
			onDelivery: (event: NostrEvent, responses: ReadonlyArray<RelayResponse>) => {
				const receipt = plan.receipts.find((receipt) => receipt.eventId === event.id)
				if (receipt) {
					receipt.relays = responses.map(({ ok, from, message }) => ({
						ok,
						from,
						...(message ? { message } : {}),
					}))
					receipt.delivery = responses.some((response) => response.ok) ? 'acknowledged' : 'unknown'
					if (
						options.onPublicSource &&
						receipt.delivery === 'acknowledged' &&
						!signal.aborted &&
						!sessionSignal.aborted &&
						useWebMcpStore.getState().enabled &&
						getOwner() === owner &&
						getCurrentPubkey() === owner &&
						accounts.active === plan.account &&
						accounts.signer === plan.signer &&
						event.pubkey === owner &&
						(event.kind === GEO_EVENT_KIND || event.kind === ARTICLE_KIND)
					) {
						// Grants always come from signed bytes, never later retained edits.
						grantSignedSource(plan, event, receipt)
					}
				}
			},
		}
	}
	async function publishMap(plan: Plan, captured: CapturedDatasetPublication, signal: AbortSignal) {
		validate(plan, signal)
		const lease = plan.maps.find(
			(lease) => lease.captured.binding.workspaceId === captured.binding.workspaceId,
		)
		if (!lease || lease.completed)
			throw new BrowserToolError(
				'dependency_not_in_plan',
				'This Map was not an unpublished dependency in the reviewed plan.',
			)
		const result = await (options.publishDataset ?? publishCapturedPublicDataset)(
			lease.captured,
			() => validate(plan, signal),
			receiptHooks(plan, signal, lease),
		)
		if (
			plan.target.kind !== 'map' &&
			plan.receipts.find((receipt) => receipt.eventId === result.eventId)?.delivery !==
				'acknowledged'
		)
			throw new BrowserToolError(
				'delivery_uncertain',
				'A dependent Map has no positive relay acknowledgement. The parent document was not signed and its local references are kept; resolve Map delivery before continuing.',
			)
		lease.completed = true // The shared publisher legitimately advances this Map's identity/baseline.
		return result
	}
	function hasUnresolvedDelivery(plan: Plan) {
		return (
			((plan.recoveryBlocked || plan.explicitRebaseRevisionId) && !explicitRebaseIsCurrent(plan)) ||
			plan.receipts.some(
				(receipt) => receipt.delivery === 'unknown' && receipt.observation?.status !== 'verified',
			)
		)
	}
	function assertNoUnresolvedPublication(plan: Plan) {
		for (const [token, earlier] of plans) {
			if (earlier === plan) continue
			const sharedUnresolvedMap = earlier.receipts.some(
				(receipt) =>
					receipt.target.kind === 'map' &&
					plan.maps.some(
						(lease) =>
							lease.captured.binding.workspaceId ===
							(receipt.target as { workspaceId: string }).workspaceId,
					) &&
					((receipt.delivery === 'unknown' && receipt.observation?.status !== 'verified') ||
						(receipt.observation?.status === 'verified' &&
							receipt.localRecovery !== 'reconciled' &&
							receipt.localRecovery !== 'already_current')),
			)
			if (
				sharedUnresolvedMap ||
				(targetKey(earlier.target) === targetKey(plan.target) &&
					(earlier.result?.ok === false ||
						earlier.recoveryBlocked ||
						earlier.explicitRebaseRevisionId) &&
					hasUnresolvedDelivery(earlier))
			)
				throw new BrowserToolError(
					'publication_uncertain',
					`A prior attempt signed events with uncertain delivery or unresolved local identity. Inspect previewToken ${token}; resolve it before signing another publication identity.`,
				)
		}
	}
	function advanceExplicitRebaseLineage(completed: Plan) {
		if (completed.target.kind === 'map' || !completed.base) return
		const parent = completed.receipts.find(
			(receipt) => targetKey(receipt.target) === targetKey(completed.target),
		)
		if (
			!parent ||
			(parent.delivery !== 'acknowledged' && parent.observation?.status !== 'verified')
		)
			return
		for (const earlier of plans.values()) {
			if (
				earlier === completed ||
				targetKey(earlier.target) !== targetKey(completed.target) ||
				earlier.explicitRebaseRevisionId !== completed.base.id
			)
				continue
			const prior = earlier.explicitRebaseRevisionId
			earlier.explicitRebaseRevisionId = parent.eventId
			if (!explicitRebaseIsCurrent(earlier)) earlier.explicitRebaseRevisionId = prior
		}
	}
	function explicitRebaseIsCurrent(plan: Plan) {
		if (plan.target.kind === 'map' || !plan.explicitRebaseRevisionId) return false
		const event = eventStore.getEvent(plan.explicitRebaseRevisionId)
		if (!event || event.pubkey !== owner || !matchesSignedPublication(event, event)) return false
		const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
		if (
			!identifier ||
			eventStore.getReplaceable(event.kind, event.pubkey, identifier)?.id !== event.id
		)
			return false
		if (plan.target.kind === 'story') {
			const draft = readStoryDraft(plan.target.draftKey, owner)
			return (
				event.kind === ARTICLE_KIND &&
				draft?.publication?.eventId === event.id &&
				storyPublicationCoordinate(draft.publication.reference) ===
					`${event.kind}:${owner}:${identifier}`
			)
		}
		return (
			event.kind === MAP_CONTEXT_KIND &&
			plan.target.draftKey === `edit:${owner}:${identifier}` &&
			readGroupEditorDraft(plan.target.draftKey, owner)?.sourceRevisionId === event.id
		)
	}
	function persistRecoveredMap(lease: MapLease, event: NostrEvent) {
		const state = useEditorStore.getState()
		writePersistedGeoCollectionDraftState(state.geoEditDrafts, state.activeGeoEditDraftId)
		flushPersistedGeoCollectionDraftState()
		writePersistedWorkspaceState(state.workspaces, state.activeWorkspaceId, owner)
		const persistedWorkspace =
			readPersistedWorkspaceState(owner).workspaces[lease.captured.binding.workspaceId]
		const persistedDraft =
			readPersistedGeoCollectionDraftState(owner).drafts[lease.captured.binding.draftId]
		const currentDraft = state.geoEditDrafts[lease.captured.binding.draftId]
		return Boolean(
			persistedWorkspace?.baseRevisionId === event.id &&
				persistedWorkspace.sourceId === currentDraft?.sourceId &&
				persistedDraft?.sourceId === currentDraft?.sourceId &&
				currentDraft &&
				persistedDraft &&
				draftContentFingerprint(persistedDraft) === draftContentFingerprint(currentDraft) &&
				persistedDraft.authoringIntent === currentDraft.authoringIntent,
		)
	}
	function recoverObservedMap(
		plan: Plan,
		receipt: PublicationReceipt,
		event: NostrEvent,
		signal: AbortSignal,
	) {
		if (receipt.target.kind !== 'map') return { status: 'not_a_map' }
		const workspaceId = receipt.target.workspaceId
		const lease = plan.maps.find(
			(candidate) => candidate.captured.binding.workspaceId === workspaceId,
		)
		if (!lease) return { status: 'stale_binding' }
		const state = useEditorStore.getState()
		const workspace = state.workspaces[workspaceId]
		if (!workspace) return { status: 'stale_binding' }
		if (
			workspace.baseRevisionId === event.id &&
			`${GEO_EVENT_KIND}:${workspace.datasetKey}` === receipt.coordinate
		) {
			active(signal, plan)
			if (!persistRecoveredMap(lease, event)) return { status: 'storage_failed' }
			lease.completed = true
			return { status: 'already_current' }
		}
		if (workspace.baseRevisionId !== lease.captured.binding.baseRevisionId)
			return { status: 'stale_source' }
		const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
		const latest = identifier
			? eventStore.getReplaceable(event.kind, event.pubkey, identifier)
			: null
		if (latest && latest.id !== event.id) return { status: 'stale_source' }
		const result = reconcilePublishedDatasetIdentity(
			lease.captured.binding,
			castEvent(event, GeoDataset, eventStore),
			lease.captured.title,
		)
		if (result.status !== 'reconciled') return { status: 'stale_binding' }
		active(signal, plan)
		if (lease.captured.authoringIntent === 'fork')
			useEditorStore.getState().saveGeoEditDraft(lease.captured.binding.draftId, {
				authoringIntent: 'edit',
				sourceDataset: lease.captured.sourceDataset,
			})
		if (!persistRecoveredMap(lease, event)) return { status: 'storage_failed' }
		lease.completed = true
		return { status: 'reconciled' }
	}
	function recoverObservedDocument(
		plan: Plan,
		receipt: PublicationReceipt,
		event: NostrEvent,
		signal: AbortSignal,
	) {
		if (receipt.target.kind === 'map') return { status: 'not_a_document' }
		const target = receipt.target
		const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
		const latest = identifier
			? eventStore.getReplaceable(event.kind, event.pubkey, identifier)
			: null
		if (latest && latest.id !== event.id) return { status: 'stale_source' }
		if (target.kind === 'story') {
			const retained = readStoryDraft(target.draftKey, owner)
			const saved = identifier ? readStoryDraft(identifier, owner) : null
			if (retained?.publication?.eventId === event.id)
				return { status: 'already_current', draftTarget: target.draftKey }
			if (saved?.publication?.eventId === event.id)
				return {
					status: retained ? 'draft_changed' : 'already_current',
					draftTarget: identifier,
				}
			if (!retained || documentRevision(target, owner!) !== plan.revision)
				return { status: 'draft_changed' }
			active(signal, plan)
			if (!receipt.reference) return { status: 'invalid_address' }
			const content = JSON.parse(event.content) as Record<string, unknown>
			const next = {
				...retained,
				publication: {
					reference: receipt.reference,
					eventId: event.id,
					fingerprint: storyContentFingerprint(content),
				},
			}
			writeStoryDraft(target.draftKey, next, owner)
			if (
				documentDraftRevision(readStoryDraft(target.draftKey, owner)) !==
				documentDraftRevision(next)
			)
				return { status: 'storage_failed' }
			return { status: 'reconciled', draftTarget: target.draftKey }
		}
		const key = `edit:${event.pubkey}:${identifier}`
		const retained = readGroupEditorDraft(target.draftKey, owner)
		if (readGroupEditorDraft(key, owner)?.sourceRevisionId === event.id) {
			if (key !== target.draftKey && retained) {
				if (documentRevision(target, owner!) !== plan.revision)
					return { status: 'draft_changed', draftTarget: key }
				active(signal, plan)
				suppressDocumentDraftFormSave('atlas', target.draftKey, owner)
				clearGroupEditorDraft(target.draftKey, owner)
				if (readGroupEditorDraft(target.draftKey, owner))
					return { status: 'storage_failed', draftTarget: key }
			}
			return { status: 'already_current', draftTarget: key }
		}
		if (!retained || documentRevision(target, owner!) !== plan.revision)
			return { status: 'draft_changed' }
		active(signal, plan)
		const next = { ...retained, sourceRevisionId: event.id }
		writeGroupEditorDraft(key, next, owner)
		if (documentDraftRevision(readGroupEditorDraft(key, owner)) !== documentDraftRevision(next))
			return { status: 'storage_failed' }
		if (key !== target.draftKey) {
			active(signal, plan)
			suppressDocumentDraftFormSave('atlas', target.draftKey, owner)
			clearGroupEditorDraft(target.draftKey, owner)
			if (readGroupEditorDraft(target.draftKey, owner))
				return { status: 'storage_failed', draftTarget: key }
		}
		if (getAtlasEditorTarget()?.draftKey === target.draftKey)
			requestOpenAtlasEditor(key, castEvent(event, MapContext, eventStore))
		return { status: 'reconciled', draftTarget: key }
	}
	function resolveObservedDependencies(plan: Plan, signal: AbortSignal) {
		if (plan.target.kind === 'map') return { status: 'not_a_document' }
		const target = plan.target
		if (documentRevision(target, owner!) !== plan.revision) return { status: 'draft_changed' }
		active(signal, plan)
		const maps = plan.receipts.filter(
			(receipt) =>
				receipt.target.kind === 'map' &&
				(receipt.delivery === 'acknowledged' || receipt.observation?.status === 'verified'),
		)
		if (!maps.length) return { status: 'no_observed_dependencies' }
		if (target.kind === 'story') {
			const retained = readStoryDraft(target.draftKey, owner)!
			let content = retained.content ?? '',
				presentation = retained.presentation
			for (const receipt of maps) {
				const workspaceId = (receipt.target as { workspaceId: string }).workspaceId
				if (!receipt.reference) continue
				content = resolveLocalStoryReference(content, workspaceId, receipt.reference)
				presentation = resolveLocalMapPresentationSource(
					presentation,
					workspaceId,
					receipt.coordinate,
				)
			}
			const next = { ...retained, content, presentation }
			writeStoryDraft(target.draftKey, next, owner)
			if (
				documentDraftRevision(readStoryDraft(target.draftKey, owner)) !==
				documentDraftRevision(next)
			)
				return { status: 'storage_failed' }
		} else {
			const retained = readGroupEditorDraft(target.draftKey, owner)!
			let description = retained.description,
				presentation = retained.presentation
			let curatedReferences = retained.curatedReferences
			for (const receipt of maps) {
				const workspaceId = (receipt.target as { workspaceId: string }).workspaceId
				if (!receipt.reference) continue
				description = resolveLocalStoryReference(description, workspaceId, receipt.reference)
				curatedReferences = curatedReferences.map((value) =>
					resolveLocalStoryReference(value, workspaceId, receipt.reference!),
				)
				presentation = resolveLocalMapPresentationSource(
					presentation,
					workspaceId,
					receipt.coordinate,
				)
			}
			const next = { ...retained, description, curatedReferences, presentation }
			writeGroupEditorDraft(target.draftKey, next, owner)
			if (
				documentDraftRevision(readGroupEditorDraft(target.draftKey, owner)) !==
				documentDraftRevision(next)
			)
				return { status: 'storage_failed' }
		}
		plan.revision = documentRevision(target, owner!)
		return { status: 'references_resolved' }
	}
	async function prepare(target: PublicationTarget, signal: AbortSignal): Promise<Plan> {
		active(signal)
		if (useEditorStore.getState().isPublishing)
			throw new BrowserToolError('publication_busy', 'Another publication is in progress.')
		const account = accounts.active!,
			signer = accounts.signer!
		let base: NostrEvent | null = null,
			maps: MapLease[] = [],
			revision: string,
			title: string
		let atlas: GroupEditorDraft | undefined,
			schema: Record<string, unknown> | undefined,
			schemaHash: string | undefined,
			storyReference: string | undefined
		if (target.kind === 'map') {
			revision = mapRevision(target.workspaceId)
			maps = captureMaps(
				`earthly-draft:${encodeURIComponent(target.workspaceId)}`,
				'native-publication',
			)
			if (maps.length !== 1)
				throw new BrowserToolError(
					'draft_not_found',
					'Could not capture the exact Map for publication.',
				)
			capturedDatasetPublicationMode(maps[0]!.captured, owner!)
			title = maps[0]!.captured.title
		} else {
			revision = documentRevision(target, owner!)
			active(signal)
			if (target.kind === 'story') {
				const draft = readStoryDraft(target.draftKey, owner)!
				title = draft.title?.trim() ?? ''
				if (!title || !draft.content?.trim())
					throw new BrowserToolError(
						'invalid_story',
						'A Story needs a title and narrative before publication.',
					)
				storyReference = draft.publication?.reference
				if (
					!storyReference &&
					target.draftKey !== 'new-story' &&
					!target.draftKey.startsWith('thread-story:')
				) {
					throw new BrowserToolError(
						'source_revision_unknown',
						'This retained Story edit has no known original revision. Preserve your changes as an explicit copy, or review/discard this retained edit and reopen the current published Story before updating.',
					)
				}
				if (storyReference) {
					if (!draft.publication?.eventId)
						throw new BrowserToolError(
							'source_revision_unknown',
							'This Story has no known original source revision. Review/discard the retained edit and reopen its published source before updating.',
						)
					const coordinate = storyPublicationCoordinate(storyReference)
					if (coordinate?.split(':')[1] !== owner)
						throw new BrowserToolError(
							'publication_scope',
							'Someone else’s Story requires an explicit fork or proposal; it cannot be overwritten.',
						)
					const [kind, pubkey, ...identifier] = coordinate!.split(':')
					const latest = eventStore.getReplaceable(Number(kind), pubkey!, identifier.join(':'))
					if (latest && latest.id !== draft.publication.eventId)
						throw new BrowserToolError(
							'stale_source',
							'This retained Story was opened against an older source revision. Preserve your changes and reopen or explicitly fork before updating.',
						)
					base = savedStorySource({
						kind: 'story',
						draftKey: target.draftKey,
						title,
						storyReference,
					})
				}
				validateStoryPresentation(draft, { allowLocalDraftReferences: true })
				maps = captureMaps(draft.content, target.draftKey)
			} else {
				atlas = structuredClone(readGroupEditorDraft(target.draftKey, owner)!)
				title = atlas.name.trim()
				if (!title)
					throw new BrowserToolError('invalid_atlas', 'An Atlas needs a name before publication.')
				base = atlasBase(target.draftKey, owner!, atlas)
				maps = captureMaps(
					[atlas.description, ...atlas.curatedReferences].join('\n'),
					target.draftKey,
				)
				if (atlas.governance === 'schema') {
					schema =
						atlas.schemaMode === 'builder'
							? compileBuilderSchema(atlas.rows, atlas.allowedGeometryTypes)
							: JSON.parse(atlas.advancedJson)
					if (!schema || typeof schema !== 'object' || Array.isArray(schema))
						throw new BrowserToolError('invalid_schema', 'Atlas schema must be a JSON object.')
					if (
						atlas.schemaMode === 'builder' &&
						!atlas.rows.some((row) => row.name.trim()) &&
						!atlas.allowedGeometryTypes.length
					)
						throw new BrowserToolError(
							'invalid_schema',
							'Add a property rule or allowed geometry type before publishing a schema Atlas.',
						)
					schemaHash = await computeSchemaHash(schema)
					const verdict = await validateSchema(schema, JSON.parse(atlas.sampleJson || '{}'), {
						schemaHash: schemaHash!,
					})
					if (verdict.error && !verdict.errors?.length)
						throw new BrowserToolError('invalid_schema', verdict.error)
				}
				// Validate the resolved default-view contract without publishing its local sources.
				const preview = structuredClone(atlas)
				for (const lease of maps) {
					const workspaceId = lease.captured.binding.workspaceId
					const coordinate = `37515:${owner}:preview-${hash(workspaceId)}`
					const mention = coordinateToNaddrReference(coordinate)!
					preview.description = resolveLocalStoryReference(
						preview.description,
						workspaceId,
						mention,
					)
					preview.curatedReferences = preview.curatedReferences.map((reference) =>
						resolveLocalStoryReference(reference, workspaceId, mention),
					)
					preview.presentation = resolveLocalMapPresentationSource(
						preview.presentation,
						workspaceId,
						coordinate,
					)
				}
				atlasPresentation(preview, base)
			}
		}
		const plan: Plan = {
			target: structuredClone(target),
			account,
			signer,
			revision,
			base: base && structuredClone(base),
			maps,
			atlas,
			schema,
			schemaHash,
			storyReference,
			title,
			status: 'prepared',
			receipts: [],
			signedEvents: new Map(),
		}
		validate(plan, signal)
		return plan
	}
	async function publishAtlas(plan: Plan, signal: AbortSignal) {
		if (plan.target.kind !== 'atlas' || !plan.atlas) throw new Error('Atlas target required.')
		const target = plan.target
		const draft = structuredClone(plan.atlas)
		await resolveLocalStoryDependencies(
			[draft.description, ...draft.curatedReferences].join('\n'),
			{
				storyDraftKey: target.draftKey,
				validate: () => validate(plan, signal),
				publishDependency: (captured) => publishMap(plan, captured, signal),
				onProgress: (_body, _completed, _total, resolved) => {
					if (!resolved) return
					draft.description = resolveLocalStoryReference(
						draft.description,
						resolved.workspaceId,
						resolved.published.datasetMention,
					)
					draft.curatedReferences = draft.curatedReferences.map((reference) =>
						resolveLocalStoryReference(
							reference,
							resolved.workspaceId,
							resolved.published.datasetMention,
						),
					)
					draft.presentation = resolveLocalMapPresentationSource(
						draft.presentation,
						resolved.workspaceId,
						resolved.published.datasetCoordinate,
					)
					writeGroupEditorDraft(target.draftKey, draft, owner)
					plan.revision = hash(documentDraftRevision(readGroupEditorDraft(target.draftKey, owner)))
					const mounted = getAtlasEditorTarget()
					if (mounted?.draftKey === target.draftKey)
						requestOpenAtlasEditor(target.draftKey, mounted.context)
				},
			},
		)
		validate(plan, signal)
		assertPublishedStoryReferences([draft.description, ...draft.curatedReferences].join('\n'))
		const preserved =
			plan.base && isGroup(plan.base)
				? getGroupReferencedAddresses(plan.base).filter(
						(coordinate) => coordinateToNaddrReference(coordinate) === null,
					)
				: []
		const coordinates = [
			...extractReferencedCoordinates(draft.description),
			...atlasCuratedCoordinates(draft.curatedReferences),
		]
		const content: GroupContent = {
			name: draft.name.trim(),
			description: draft.description || undefined,
			descriptionFormat: 'markdown',
			governance: draft.governance,
			image: draft.image.trim() || undefined,
			geometryConstraints:
				draft.governance === 'schema' && draft.allowedGeometryTypes.length
					? { allowedTypes: draft.allowedGeometryTypes }
					: undefined,
			schema: plan.schema,
			presentation: atlasPresentation(draft, plan.base),
		}
		const factory =
			plan.base && isGroup(plan.base)
				? GroupFactory.modify(plan.base).group(content)
				: GroupFactory.create(content)
		const hooks = receiptHooks(plan, signal)
		const signed = await factory
			.schemaHash(plan.schemaHash)
			.modifyPublicTags(setAddressReferenceTags(coordinates, preserved))
			.sign({
				getPublicKey: () => plan.signer.getPublicKey(),
				signEvent: (event) => {
					validate(plan, signal)
					return plan.signer.signEvent(event)
				},
			})
		hooks.onSigned(signed)
		validate(plan, signal)
		if (signed.pubkey !== owner)
			throw new BrowserToolError(
				'account_changed',
				'The signer returned an event for a different account.',
			)
		const responses = await (options.publishEvent ?? publish)(signed, {
			routing: 'outbox',
			signal,
			beforeCommit: hooks.beforeCommit,
		})
		hooks.onDelivery(signed, responses)
		// Edits made after transmission began stay in the same author's retained edit slot.
		if (accounts.active === plan.account && getOwner() === owner) {
			flushDocumentDraftForm('atlas', target.draftKey, owner)
			const retained = readGroupEditorDraft(target.draftKey, owner)
			const key = `edit:${signed.pubkey}:${signed.tags.find((tag) => tag[0] === 'd')?.[1]}`
			if (retained) {
				if (key !== target.draftKey) {
					suppressDocumentDraftFormSave('atlas', target.draftKey, owner)
					clearGroupEditorDraft(target.draftKey, owner)
				}
				writeGroupEditorDraft(key, { ...retained, sourceRevisionId: signed.id }, owner)
				if (getAtlasEditorTarget()?.draftKey === target.draftKey)
					requestOpenAtlasEditor(key, castEvent(signed, MapContext, eventStore))
			}
			return { draftTarget: key }
		}
		return {}
	}
	options.registerExplicitRebase?.((kind, draftKey, sourceRevisionId) => {
		try {
			active(sessionSignal)
			for (const plan of plans.values()) {
				if (plan.target.kind !== kind || plan.target.draftKey !== draftKey) continue
				active(sessionSignal, plan)
				const parent = plan.receipts.find(
					(receipt) => targetKey(receipt.target) === targetKey(plan.target),
				)
				if (
					parent?.observation?.status !== 'verified' ||
					plan.receipts.some(
						(receipt) =>
							receipt.delivery === 'unknown' && receipt.observation?.status !== 'verified',
					)
				)
					continue
				const source = eventStore.getEvent(sourceRevisionId)
				const identifier = source?.tags.find((tag) => tag[0] === 'd')?.[1]
				if (!source || `${source.kind}:${source.pubkey}:${identifier}` !== parent.coordinate)
					continue
				const prior = plan.explicitRebaseRevisionId
				plan.explicitRebaseRevisionId = sourceRevisionId
				if (!explicitRebaseIsCurrent(plan)) {
					plan.explicitRebaseRevisionId = prior
					continue
				}
				plan.recoveryBlocked = false
			}
		} catch {
			// A revoked or changed account cannot supply a resolution witness.
		}
	})
	const targetSchema: ToolJsonSchema = {
		oneOf: [
			{
				type: 'object',
				properties: { kind: { const: 'map' }, workspaceId: { type: 'string', minLength: 1 } },
				required: ['kind', 'workspaceId'],
				additionalProperties: false,
			},
			{
				type: 'object',
				properties: {
					kind: { enum: ['story', 'atlas'] },
					draftKey: { type: 'string', minLength: 1 },
				},
				required: ['kind', 'draftKey'],
				additionalProperties: false,
			},
		],
	}
	return [
		tool(
			'earthly_prepare_publication',
			'Preview publication of an exact current-account local public Map, Story or Atlas. Lists captured Map dependencies and revisions. Does not sign or publish. Review the summary, then use its previewToken with earthly_publish_publication and confirm=true under the user’s publication instruction.',
			{
				type: 'object',
				properties: { target: targetSchema },
				required: ['target'],
				additionalProperties: false,
			},
			true,
			async (args, signal) => {
				options.assertToolAllowed?.('prepare_publication', args)
				const plan = await prepare(args.target as PublicationTarget, signal)
				if (plans.size >= 16) {
					const removable = [...plans].find(
						([, candidate]) =>
							!candidate.explicitRebaseRevisionId &&
							(candidate.status === 'prepared' ||
								(candidate.status === 'finished' && !hasUnresolvedDelivery(candidate))),
					)
					if (!removable)
						throw new BrowserToolError(
							'publication_capacity',
							'Publication receipt capacity is full with unresolved signed attempts. Inspect their receipts and resolve delivery before preparing more publications.',
						)
					plans.delete(removable[0])
				}
				const previewToken = crypto.randomUUID()
				plans.set(previewToken, plan)
				return {
					ok: true,
					previewToken,
					target: plan.target,
					owner,
					revision: plan.revision,
					title: plan.title,
					summary:
						plan.target.kind === 'map'
							? {
									featureCount: plan.maps[0]!.captured.featureCollection.features.length,
									contextReferenceCount: plan.maps[0]!.captured.contextReferences.length,
									blobReferenceCount: plan.maps[0]!.captured.blobReferences.length,
								}
							: plan.target.kind === 'story'
								? {
										description: readStoryDraft(plan.target.draftKey, owner)?.summary ?? '',
										narrativeCharacters:
											readStoryDraft(plan.target.draftKey, owner)?.content?.length ?? 0,
										hasPresentation:
											readStoryDraft(plan.target.draftKey, owner)?.presentation !== undefined,
									}
								: {
										description: plan.atlas?.description ?? '',
										curatedReferenceCount: plan.atlas?.curatedReferences.length ?? 0,
										governance: plan.atlas?.governance,
										hasPresentation: plan.atlas?.presentation !== undefined,
									},
					mode:
						plan.target.kind === 'map'
							? capturedDatasetPublicationMode(plan.maps[0]!.captured, owner!)
							: plan.base
								? 'update'
								: 'new',
					baseEventId: plan.base?.id ?? plan.maps[0]?.captured.baseEvent?.id ?? null,
					dependencies:
						plan.target.kind === 'map'
							? []
							: plan.maps.map((lease) => ({
									kind: 'map',
									workspaceId: lease.captured.binding.workspaceId,
									title: lease.captured.title,
									revision: lease.revision,
									featureCount: lease.captured.featureCollection.features.length,
									mode: capturedDatasetPublicationMode(lease.captured, owner!),
								})),
					publicationChannel: 'public',
					relayRouting: 'account outbox and configured write relays',
					confirmation:
						'confirm=true authorizes this exact captured public target and every listed dependency. A browser signer may still request interaction.',
					sideEffectsApplied: false,
				}
			},
		),
		tool(
			'earthly_publish_publication',
			'Execute a reviewed public publication plan using previewToken and explicit confirm=true. Publishes the exact captured target and listed Map dependencies; stale drafts, changed accounts or revoked access stop further signing. Returns signed event addresses and actual relay acknowledgements; unknown delivery is not success. Reusing a finished token returns its receipt without signing again.',
			{
				type: 'object',
				properties: {
					previewToken: { type: 'string', minLength: 1, maxLength: 100 },
					confirm: { type: 'boolean', const: true },
				},
				required: ['previewToken', 'confirm'],
				additionalProperties: false,
			},
			false,
			async (args, signal) => {
				options.assertToolAllowed?.('publish_publication', args)
				active(signal)
				if (args.confirm !== true)
					throw new BrowserToolError(
						'confirmation_required',
						'Publication requires explicit confirm=true for the reviewed plan.',
					)
				const plan = plans.get(String(args.previewToken))
				if (!plan)
					throw new BrowserToolError(
						'preview_required',
						'This preview is unavailable or expired. Prepare publication in this account/session first.',
					)
				active(signal, plan)
				if (plan.result) return plan.result
				if (plan.status !== 'prepared' || useEditorStore.getState().isPublishing)
					throw new BrowserToolError('publication_busy', 'Another publication is executing.')
				validate(plan, signal)
				plan.status = 'executing'
				let extra: Record<string, unknown> = {}
				try {
					if (plan.target.kind === 'story') {
						const story = await (options.publishStory ?? publishSavedStory)(
							{
								kind: 'story',
								draftKey: plan.target.draftKey,
								title: plan.title,
								storyReference: plan.storyReference,
							},
							{
								...receiptHooks(plan, signal),
								validate: () => validate(plan, signal),
								publishDependency: (captured) => publishMap(plan, captured, signal),
								onProgress: () => {
									plan.revision = hash(
										documentDraftRevision(
											readStoryDraft((plan.target as { draftKey: string }).draftKey, owner),
										),
									)
								},
							},
						)
						extra = { draftTarget: story.dTag }
					} else {
						useEditorStore.getState().setIsPublishing(true)
						if (plan.target.kind === 'map') await publishMap(plan, plan.maps[0]!.captured, signal)
						else extra = await publishAtlas(plan, signal)
					}
					const acknowledged =
						plan.receipts.length > 0 &&
						plan.receipts.every((receipt) => receipt.delivery === 'acknowledged')
					plan.result = {
						ok: acknowledged,
						status: acknowledged ? 'published' : 'delivery_uncertain',
						target: plan.target,
						...extra,
						receipts: structuredClone(plan.receipts),
						sideEffectsApplied: plan.receipts.length > 0,
						...(!acknowledged
							? {
									code: 'delivery_uncertain',
									message:
										'Events were signed, but relay acknowledgement is incomplete or unavailable. Inspect delivery before preparing a new attempt.',
								}
							: {}),
					}
				} catch (error) {
					plan.result = {
						ok: false,
						code:
							error instanceof BrowserToolError
								? error.code
								: signal.aborted || sessionSignal.aborted
									? 'cancelled'
									: 'publication_failed',
						message: error instanceof Error ? error.message : 'Publication failed.',
						target: plan.target,
						receipts: structuredClone(plan.receipts),
						sideEffectsApplied: plan.receipts.length > 0,
						partial: plan.receipts.some((receipt) => receipt.delivery === 'acknowledged'),
					}
				} finally {
					plan.status = 'finished'
					useEditorStore.getState().setIsPublishing(false)
				}
				if (plan.result?.ok === true) advanceExplicitRebaseLineage(plan)
				return plan.result
			},
		),
		tool(
			'earthly_reconcile_publication',
			'Read configured relays for the exact signed event IDs retained by a publication preview. Verifies full event bytes and signatures; never signs, sends events, uploads, or creates a fork. Original acknowledgements remain distinct from positive observation. Recovers unchanged local publication identities and local Map dependency references; changed drafts are preserved. Unknown or partial delivery stays explicit.',
			{
				type: 'object',
				properties: { previewToken: { type: 'string', minLength: 1, maxLength: 100 } },
				required: ['previewToken'],
				additionalProperties: false,
			},
			true,
			async (args, signal) => {
				options.assertToolAllowed?.('reconcile_publication', args)
				active(signal)
				const plan = plans.get(String(args.previewToken))
				if (!plan)
					throw new BrowserToolError(
						'preview_required',
						'This preview is unavailable in this account/session.',
					)
				active(signal, plan)
				if (plan.status === 'executing')
					throw new BrowserToolError(
						'publication_busy',
						'Wait for the original publication attempt to finish.',
					)
				if (!plan.receipts.length)
					return {
						ok: false,
						code: 'nothing_signed',
						target: plan.target,
						receipts: [],
						publicationComplete: false,
					}
				const signed = plan.receipts.flatMap((receipt) => {
					const event = plan.signedEvents.get(receipt.eventId)
					return event && matchesSignedPublication(event, event) ? [event] : []
				})
				const relays = [
					...new Set(
						options.getObservationRelays?.() ?? [
							...readRelaysFor('content'),
							...config.writeRelays,
						],
					),
				]
				const operationSignal = AbortSignal.any([signal, sessionSignal])
				const observations = await (options.observeEvents ?? observeSignedPublications)(
					signed,
					relays,
					operationSignal,
				)
				active(signal, plan)
				const recoveries: Array<Record<string, unknown>> = []
				// Fail closed if a source grant or form flush interrupts identity recovery.
				plan.recoveryBlocked = true
				let recoveryBlocked = false
				for (const receipt of plan.receipts) {
					const observation = observations.find((item) => item.eventId === receipt.eventId)
					// A later empty read cannot erase a previously verified relay observation.
					if (
						observation &&
						(observation.status === 'verified' || receipt.observation?.status !== 'verified')
					)
						receipt.observation = observation
					if (receipt.observation?.status !== 'verified') continue
					active(signal, plan)
					const event = plan.signedEvents.get(receipt.eventId)!
					eventStore.add(event)
					grantSignedSource(plan, event, receipt)
					active(signal, plan)
					let recovery: Record<string, unknown>
					try {
						recovery =
							receipt.target.kind === 'map'
								? recoverObservedMap(plan, receipt, event, signal)
								: recoverObservedDocument(plan, receipt, event, signal)
					} catch {
						recovery = { status: 'draft_changed' }
					}
					receipt.localRecovery = String(recovery.status)
					if (recovery.status !== 'reconciled' && recovery.status !== 'already_current')
						recoveryBlocked = true
					recoveries.push({ eventId: event.id, target: receipt.target, ...recovery })
				}
				const targetReceipt = plan.receipts.find(
					(receipt) => targetKey(receipt.target) === targetKey(plan.target),
				)
				const targetObserved = targetReceipt?.observation?.status === 'verified'
				if (!targetReceipt && !recoveryBlocked && plan.target.kind !== 'map') {
					active(signal, plan)
					let dependencies: Record<string, unknown>
					try {
						dependencies = resolveObservedDependencies(plan, signal)
					} catch {
						dependencies = { status: 'draft_changed' }
					}
					// No signed parent exists here. New prose can use a fresh plan once the
					// exact dependency identities are safe; never force a fork just to keep it.
					if (dependencies.status === 'storage_failed') recoveryBlocked = true
					recoveries.push({ target: plan.target, ...dependencies })
				}
				const allSignedEventsObserved = plan.receipts.every(
					(receipt) => receipt.observation?.status === 'verified',
				)
				const publicationComplete = targetObserved && allSignedEventsObserved
				const anyObserved = plan.receipts.some(
					(receipt) => receipt.observation?.status === 'verified',
				)
				active(signal, plan)
				plan.recoveryBlocked = recoveryBlocked && !explicitRebaseIsCurrent(plan)
				if (plan.result)
					plan.result = {
						...plan.result,
						receipts: structuredClone(plan.receipts),
						...(publicationComplete
							? {
									ok: true,
									status: 'publication_observed',
									code: undefined,
									message:
										'Configured relays returned the exact signed publication. Inspect recoveries for any retained draft that still needs explicit resolution.',
								}
							: {}),
					}
				if (publicationComplete && !plan.recoveryBlocked) advanceExplicitRebaseLineage(plan)
				return {
					ok: publicationComplete,
					status: publicationComplete
						? 'publication_observed'
						: anyObserved
							? 'partial'
							: 'delivery_uncertain',
					target: plan.target,
					publicationComplete,
					targetObserved,
					allSignedEventsObserved,
					receipts: structuredClone(plan.receipts),
					recoveries,
					recoveryBlocked: plan.recoveryBlocked,
					signedOrSent: false,
					note: 'Observation proves these exact events were returned by the listed relays; it is not an acknowledgement of the original publication request. Absence does not prove an event was never published.',
				}
			},
		),
	]
}
