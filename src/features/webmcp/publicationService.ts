import { castEvent } from 'applesauce-core/casts'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { NostrEvent } from 'nostr-tools'
import { accounts, eventStore, publish } from '@/lib/nostr'
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
import { readStoryDraft } from '@/lib/nostr/story/draft'
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
import { useEditorStore } from '@/features/geo-editor/store'
import type { BrowserTool } from './platform'
import { BrowserToolError } from './mapContext'
import { useWebMcpStore } from './state'
import type { BrowserPublicDocumentSource } from './lifecycleService'

export const BROWSER_PUBLICATION_TOOLS = ['prepare_publication', 'publish_publication'] as const
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
	/** A positive relay acknowledgement grants only the exact signed public source. */
	onPublicSource?: (source: BrowserPublicDocumentSource) => void
	/** Test seams use the same captured payload and validation contracts. */
	publishDataset?: typeof publishCapturedPublicDataset
	publishStory?: typeof publishSavedStory
	publishEvent?: typeof publish
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
		if (plan.target.kind !== 'map' && documentRevision(plan.target, owner!) !== plan.revision)
			throw new BrowserToolError(
				'stale_draft',
				'The document changed after preview. Nothing further will be signed; prepare its current revision again.',
			)
		active(signal, plan) // Form flush can synchronously change account/access state.
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
	function receiptHooks(plan: Plan, signal: AbortSignal) {
		return {
			signal,
			beforeCommit: () => validate(plan, signal),
			onSigned: (event: NostrEvent) => {
				const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
				const coordinate = `${event.kind}:${event.pubkey}:${identifier ?? ''}`
				plan.receipts.push({
					eventId: event.id,
					coordinate,
					reference: coordinateToNaddrReference(coordinate),
					delivery: 'unknown',
					relays: [],
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
						// Never use the retained draft: it may already contain later, unpublished edits.
						const content = JSON.parse(event.content) as Record<string, unknown>
						const map = event.kind === GEO_EVENT_KIND
						options.onPublicSource?.({
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
			receiptHooks(plan, signal),
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
				for (const [token, earlier] of plans) {
					if (
						targetKey(earlier.target) === targetKey(plan.target) &&
						earlier.result?.ok === false &&
						earlier.receipts.some((receipt) => receipt.delivery === 'unknown')
					)
						throw new BrowserToolError(
							'publication_uncertain',
							`A prior attempt signed events with uncertain delivery. Inspect its result with previewToken ${token}; resolve delivery before creating another publication identity.`,
						)
				}
				if (plans.size >= 16) {
					const removable = [...plans].find(
						([, candidate]) =>
							candidate.status === 'prepared' ||
							(candidate.status === 'finished' && candidate.result?.ok === true),
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
				return plan.result
			},
		),
	]
}
