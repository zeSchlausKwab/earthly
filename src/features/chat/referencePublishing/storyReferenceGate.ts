import { castEvent } from 'applesauce-core/casts'
import type { FeatureCollection } from 'geojson'
import type { NostrEvent } from 'nostr-tools'
import { fieldSessionIdForEvent } from '@/features/field-sessions/events'
import type { ToolExecutionRunIdentity, ToolExecutionTarget } from '@/features/chat/tools/types'
import { publishChannelMatchesDatasetScope } from '@/features/geo-editor/components/authoringDestination'
import { useEditorStore, type GeoCollectionEditDraft } from '@/features/geo-editor/store'
import { sanitizeEditorProperties } from '@/features/geo-editor/utils'
import { privateWorkspaceIdForDataset } from '@/lib/private-workspace/projection'
import { eventStore } from '@/lib/nostr'
import { GeoDataset, type GeoBlobReference } from '@/lib/nostr/geo-event'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { extractNostrAddressReferences, naddrToCoordinate } from '@/lib/nostr/references'
import { publishCapturedPublicDataset } from './publishCapturedDataset'
import {
	getCompletedReferencePublication,
	getReferencePublishingExecutionContext,
	requestReferencePublish,
} from './requestStore'
import type {
	CapturedDatasetPublication,
	DatasetReferenceEnsureResult,
	StoryReferencePublicationGateResult,
} from './types'

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

function buildFeatureCollection(draft: GeoCollectionEditDraft): FeatureCollection {
	const collection: FeatureCollection & {
		name?: string
		description?: string
		color?: string
		properties?: Record<string, unknown>
	} = {
		type: 'FeatureCollection',
		features: draft.features.map((feature) => {
			const properties = sanitizeEditorProperties(
				feature.properties as Record<string, unknown> | undefined,
			)
			return {
				type: 'Feature' as const,
				id: feature.id,
				geometry: clone(feature.geometry),
				...(properties ? { properties } : {}),
			}
		}) as FeatureCollection['features'],
	}

	const existingIds = new Set(collection.features.map((feature) => String(feature.id)))
	for (const reference of draft.blobReferences) {
		if (
			reference.scope !== 'feature' ||
			!reference.featureId ||
			existingIds.has(reference.featureId)
		) {
			continue
		}
		existingIds.add(reference.featureId)
		collection.features.push({
			type: 'Feature',
			id: reference.featureId,
			geometry: null,
			properties: { externalPlaceholder: true, blobUrl: reference.url },
		} as unknown as FeatureCollection['features'][number])
	}

	const title = draft.collectionMeta.name || draft.name || 'Untitled Dataset'
	collection.name = title
	if (draft.collectionMeta.description) collection.description = draft.collectionMeta.description
	if (draft.collectionMeta.color) collection.color = draft.collectionMeta.color
	const properties: Record<string, unknown> = { ...draft.collectionMeta.customProperties }
	if (draft.collectionMeta.name) properties.name = draft.collectionMeta.name
	if (draft.collectionMeta.description) properties.description = draft.collectionMeta.description
	if (draft.collectionMeta.color) properties.color = draft.collectionMeta.color
	if (Object.keys(properties).length > 0) collection.properties = properties
	return collection
}

function serializeBlobReferences(draft: GeoCollectionEditDraft): GeoBlobReference[] {
	return draft.blobReferences
		.filter((reference) => Boolean(reference.url))
		.map(({ scope, featureId, url, sha256, size, mimeType }) => ({
			scope,
			featureId,
			url,
			sha256,
			size,
			mimeType,
		}))
}

function datasetCoordinate(dataset: GeoDataset | null): string | null {
	return dataset?.dTag ? `${GEO_EVENT_KIND}:${dataset.pubkey}:${dataset.dTag}` : null
}

function targetDatasetCoordinate(target: ToolExecutionTarget): string | null {
	if (!target.entityId || !/^[0-9a-f]{64}:.+$/i.test(target.entityId)) return null
	return `${GEO_EVENT_KIND}:${target.entityId}`
}

function referencedDatasetCoordinates(markdown: string): Set<string> {
	return new Set(
		extractNostrAddressReferences(markdown)
			.map((reference) => naddrToCoordinate(reference.address))
			.filter(
				(coordinate): coordinate is string =>
					typeof coordinate === 'string' && coordinate.startsWith(`${GEO_EVENT_KIND}:`),
			),
	)
}

function attachmentsDiffer(draft: GeoCollectionEditDraft, dataset: GeoDataset | null): boolean {
	if (!dataset) return draft.contextRefs.length > 0 || draft.blobReferences.length > 0
	const contextRefs = [...draft.contextRefs].sort()
	const publishedContextRefs = [...dataset.contextReferences].sort()
	if (JSON.stringify(contextRefs) !== JSON.stringify(publishedContextRefs)) return true
	return JSON.stringify(serializeBlobReferences(draft)) !== JSON.stringify(dataset.blobReferences)
}

function sourceIdentityForCoordinate(coordinate: string): {
	datasetKey: string
	sourceId: string
} | null {
	const [kind, pubkey, ...identifierParts] = coordinate.split(':')
	const identifier = identifierParts.join(':')
	if (kind !== String(GEO_EVENT_KIND) || !pubkey || !identifier) return null
	const datasetKey = `${pubkey}:${identifier}`
	return { datasetKey, sourceId: `dataset:${datasetKey}` }
}

function draftMatchesCapturedPublication(
	draft: GeoCollectionEditDraft,
	captured: CapturedDatasetPublication,
): boolean {
	return (
		JSON.stringify(buildFeatureCollection(draft)) === JSON.stringify(captured.featureCollection) &&
		JSON.stringify(draft.contextRefs) === JSON.stringify(captured.contextReferences) &&
		JSON.stringify(serializeBlobReferences(draft)) === JSON.stringify(captured.blobReferences) &&
		JSON.stringify(draft.publishChannel) === JSON.stringify(captured.publishChannel)
	)
}

function targetMatchesCompletedPublication(
	target: ToolExecutionTarget | null,
	chatId: string | null,
): boolean {
	const completed = getCompletedReferencePublication()
	if (!completed || !target || chatId !== completed.captured.binding.chatId) return false
	const binding = completed.captured.binding
	return (
		target.workspaceId === binding.workspaceId &&
		target.draftId === binding.draftId &&
		target.sourceId === binding.sourceId &&
		target.baseRevisionId === binding.baseRevisionId
	)
}

function resolveCompletedPublication(
	input: EnsureDatasetReferencePublishedInput,
): DatasetReferenceEnsureResult | null {
	const execution = getReferencePublishingExecutionContext()
	const target = input.target ?? execution.runTarget
	const chatId = input.chatId ?? execution.chatId
	if (!targetMatchesCompletedPublication(target, chatId)) return null
	const completed = getCompletedReferencePublication()
	if (!completed || !target?.workspaceId || !target.draftId) return null

	const referencesPublished = referencedDatasetCoordinates(input.markdown).has(
		completed.published.datasetCoordinate,
	)
	const intendsReference = referencesPublished || input.referencesNewDataset === true
	if (!intendsReference) return { status: 'ready' }

	const identity = sourceIdentityForCoordinate(completed.published.datasetCoordinate)
	const state = useEditorStore.getState()
	const workspace = state.workspaces[target.workspaceId]
	const draft = state.geoEditDrafts[target.draftId]
	const stillPublishedSnapshot = Boolean(
		identity &&
			workspace &&
			draft &&
			workspace.kind === 'dataset' &&
			workspace.datasetKey === identity.datasetKey &&
			workspace.sourceId === identity.sourceId &&
			draft.sourceId === identity.sourceId &&
			draftMatchesCapturedPublication(draft, completed.captured),
	)
	if (stillPublishedSnapshot) {
		return {
			status: 'ready',
			published: completed.published,
			resumedAfterPublication: true,
		}
	}

	return {
		status: 'blocked',
		code: 'reference_publish_source_unavailable',
		message:
			'The Dataset changed again after it was published. Send a new request so Earthly can bind the latest revision before adding its reference.',
		retryable: true,
	}
}

export interface EnsureDatasetReferencePublishedInput {
	markdown: string
	/** Explicit identity for non-tool callers such as the Chat reference picker. */
	chatId?: string | null
	toolCallId?: string | null
	/** Immutable editor target captured before any dialog/await boundary. */
	target?: ToolExecutionTarget | null
	/** Required for a new Dataset, which cannot already have an naddr in Markdown. */
	referencesNewDataset?: boolean
}

type CaptureResult =
	| { kind: 'none' }
	| { kind: 'blocked'; result: DatasetReferenceEnsureResult }
	| { kind: 'captured'; captured: CapturedDatasetPublication }

function resolveTargetBaseDataset(target: ToolExecutionTarget): {
	dataset: GeoDataset | null
	error: string | null
} {
	if (!target.baseRevisionId) return { dataset: null, error: null }
	const event = eventStore.getEvent(target.baseRevisionId)
	if (!event) {
		return {
			dataset: null,
			error: 'Wait for Earthly to restore the exact Dataset revision this run started from.',
		}
	}
	try {
		return { dataset: castEvent(event, GeoDataset, eventStore), error: null }
	} catch {
		return { dataset: null, error: 'The captured Dataset revision is no longer available.' }
	}
}

/**
 * Resolve and snapshot only the run-bound workspace/draft. This function never
 * consults activeWorkspaceId, activeGeoEditDraftId, or activeDataset, so free
 * navigation while the model works cannot retarget a later publish prompt.
 */
export function captureTargetDatasetPublication(
	input: EnsureDatasetReferencePublishedInput,
): CaptureResult {
	const state = useEditorStore.getState()
	const execution = getReferencePublishingExecutionContext()
	const chatId = input.chatId ?? execution.chatId
	const toolCallId = input.toolCallId ?? execution.toolCallId
	const target = input.target ?? execution.runTarget
	if (target?.entityType !== 'dataset') return { kind: 'none' }
	const referencedCoordinates = referencedDatasetCoordinates(input.markdown)
	const resolvedBase = resolveTargetBaseDataset(target)
	const base = resolvedBase.dataset
	const baseCoordinate = datasetCoordinate(base)
	const capturedCoordinate = targetDatasetCoordinate(target)
	const referencesCapturedDataset = Boolean(
		(baseCoordinate && referencedCoordinates.has(baseCoordinate)) ||
			(capturedCoordinate && referencedCoordinates.has(capturedCoordinate)) ||
			(resolvedBase.error && target.baseRevisionId && referencedCoordinates.size > 0),
	)
	const referencesNewDataset = target.baseRevisionId === null && input.referencesNewDataset === true
	if (!referencesCapturedDataset && !referencesNewDataset) return { kind: 'none' }
	if (resolvedBase.error) {
		return {
			kind: 'blocked',
			result: {
				status: 'blocked',
				code: 'reference_publish_source_unavailable',
				message: resolvedBase.error,
				retryable: true,
			},
		}
	}

	const workspaceId = target.workspaceId
	const draftId = target.draftId
	const workspace = workspaceId ? state.workspaces[workspaceId] : null
	const draft = draftId ? state.geoEditDrafts[draftId] : null
	if (!workspaceId || !workspace || !draftId || !draft) {
		return {
			kind: 'blocked',
			result: {
				status: 'blocked',
				code: 'reference_publish_source_unavailable',
				message: 'The Dataset draft captured when this request started is no longer available.',
				retryable: true,
			},
		}
	}
	if (
		target.sourceId === null ||
		workspace.sourceId !== draft.sourceId ||
		target.sourceId !== workspace.sourceId ||
		target.sourceId !== draft.sourceId
	) {
		return {
			kind: 'blocked',
			result: {
				status: 'blocked',
				code: 'reference_publish_source_unavailable',
				message: 'The captured Dataset draft no longer belongs to its original edit state.',
				retryable: true,
			},
		}
	}

	if (draft.publishChannel.kind !== 'public') {
		return {
			kind: 'blocked',
			result: {
				status: 'blocked',
				code: 'reference_publish_scope_incompatible',
				message: 'A public reference cannot expose private or nearby Dataset changes.',
				retryable: false,
			},
		}
	}

	if ((workspace.datasetKey || draft.sourceId.startsWith('dataset:')) && !base) {
		return {
			kind: 'blocked',
			result: {
				status: 'blocked',
				code: 'reference_publish_source_unavailable',
				message: 'Wait for Earthly to restore the Dataset revision this draft updates, then retry.',
				retryable: true,
			},
		}
	}
	if (base) {
		const baseKey = `${base.pubkey}:${base.dTag}`
		const expectedSourceId = `dataset:${baseKey}`
		if (
			workspace.kind !== 'dataset' ||
			workspace.datasetKey !== baseKey ||
			workspace.sourceId !== expectedSourceId ||
			draft.sourceId !== expectedSourceId ||
			(target.entityId !== baseKey && target.entityId !== base.event.id)
		) {
			return {
				kind: 'blocked',
				result: {
					status: 'blocked',
					code: 'reference_publish_source_unavailable',
					message: 'The captured Dataset identity no longer matches its base revision.',
					retryable: true,
				},
			}
		}
	} else if (
		workspace.kind !== 'scratch' ||
		workspace.datasetKey !== null ||
		(target.entityId !== null && target.entityId !== draft.sourceId)
	) {
		return {
			kind: 'blocked',
			result: {
				status: 'blocked',
				code: 'reference_publish_source_unavailable',
				message: 'The captured new Dataset no longer matches its original edit state.',
				retryable: true,
			},
		}
	}

	if (referencesNewDataset && draft.features.length === 0) {
		return {
			kind: 'blocked',
			result: {
				status: 'blocked',
				code: 'reference_publish_source_unavailable',
				message: 'Draw or import geometry before referencing this new Dataset.',
				retryable: true,
			},
		}
	}
	const dirty =
		!base ||
		target.wasDirty ||
		target.draftUpdatedAt === null ||
		draft.updatedAt !== target.draftUpdatedAt ||
		attachmentsDiffer(draft, base)
	if (!dirty) return { kind: 'none' }

	if (!chatId || !toolCallId) {
		return {
			kind: 'blocked',
			result: {
				status: 'blocked',
				code: 'reference_publish_context_missing',
				message:
					'This action is not bound to a conversation and operation, so publishing was refused.',
				retryable: true,
			},
		}
	}

	if (
		base &&
		!publishChannelMatchesDatasetScope(draft.publishChannel, {
			privateGroupId: privateWorkspaceIdForDataset(base),
			fieldSessionId: fieldSessionIdForEvent(base.event) ?? undefined,
		})
	) {
		return {
			kind: 'blocked',
			result: {
				status: 'blocked',
				code: 'reference_publish_scope_incompatible',
				message: 'The Dataset source and saved draft have incompatible publication scopes.',
				retryable: false,
			},
		}
	}

	const featureCollection = buildFeatureCollection(draft)
	return {
		kind: 'captured',
		captured: {
			binding: {
				chatId,
				toolCallId,
				workspaceId,
				draftId,
				sourceId: draft.sourceId,
				draftUpdatedAt: draft.updatedAt,
				baseRevisionId: base?.event.id ?? null,
				baseCoordinate,
			},
			title: draft.collectionMeta.name || draft.name || 'Untitled Dataset',
			publishChannel: clone(draft.publishChannel),
			featureCollection: clone(featureCollection),
			contextReferences: [...draft.contextRefs],
			blobReferences: clone(serializeBlobReferences(draft)),
			featureIds: featureCollection.features
				.map((feature) => feature.id)
				.filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
				.map(String),
			baseEvent: base ? clone(base.event as NostrEvent) : null,
		},
	}
}

/** Generic gate used by both durable authoring writes and Chat reference attachment. */
export async function ensureDatasetReferencePublished(
	input: EnsureDatasetReferencePublishedInput,
	publishDataset: typeof publishCapturedPublicDataset = publishCapturedPublicDataset,
): Promise<DatasetReferenceEnsureResult> {
	const completed = resolveCompletedPublication(input)
	if (completed) return completed
	const capture = captureTargetDatasetPublication(input)
	if (capture.kind === 'none') return { status: 'ready' }
	if (capture.kind === 'blocked') return capture.result

	const decision = await requestReferencePublish(capture.captured, () =>
		publishDataset(capture.captured),
	)
	if (decision.decision === 'cancelled') {
		return {
			status: 'blocked',
			code: 'reference_publish_cancelled',
			message: 'The Dataset was not published, so its reference was not added.',
			retryable: true,
		}
	}
	return { status: 'ready', published: decision.published }
}

export async function gateStoryDatasetReferences(
	markdown: string,
	options: {
		run?: ToolExecutionRunIdentity
		referencesActiveDataset?: boolean
		publishDataset?: typeof publishCapturedPublicDataset
	} = {},
): Promise<StoryReferencePublicationGateResult> {
	const ensured = await ensureDatasetReferencePublished(
		{
			markdown,
			chatId: options.run?.chatId,
			target: options.run?.target,
			referencesNewDataset: options.referencesActiveDataset === true,
		},
		options.publishDataset,
	)
	if (ensured.status === 'blocked') return ensured
	if (ensured.published?.addressChanged && !ensured.resumedAfterPublication) {
		return {
			status: 'retry',
			code: 'dataset_reference_published_with_new_address',
			message:
				'The Dataset is now published. Retry write_story_draft with the fresh mention; the Story draft was not saved with a stale or missing reference.',
			published: ensured.published,
		}
	}
	return ensured
}
