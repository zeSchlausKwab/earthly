import { castEvent } from 'applesauce-core/casts'
import type { FeatureCollection } from 'geojson'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { resolveSchemaCacheKey, validateAttachment } from '@/lib/group'
import { accounts, eventStore, publish } from '@/lib/nostr'
import {
	deleteDataset,
	GeoDataset,
	GeoDatasetFactory,
	type GeoBlobReference,
} from '@/lib/nostr/geo-event'
import { GeoProposalFactory } from '@/lib/nostr/geo-proposal'
import type { Group } from '@/lib/nostr/group'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { extractReferencedCoordinates, setAddressReferenceTags } from '@/lib/nostr/references'
import { noteSessionPublish } from '@/lib/nostr/sessionPublishes'
import type { SchemaRuleError } from '@/lib/validation/schema.worker'
import { privateDatasetStackEntryId } from '@/features/private-maps/privateDatasetStack'
import { fieldDatasetStackEntryId } from '@/features/field-sessions/fieldDatasetStack'
import type { EditorFeature } from '../core'
import { useEditorStore, type SidebarViewMode } from '../store'
import type { EditorBlobReference } from '../types'
import { extractCollectionMeta, sanitizeEditorProperties } from '../utils'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '../constants'
import { publishFailureMessage } from './publishFailure'

/**
 * One advisory, per-rule attach warning surfaced to the contributor when their
 * dataset is `c`-attached to a `schema` Group. These NEVER block publishing
 * (GROUP-04) — they are dismissible hints rendered as an amber `Alert`.
 */
export interface AttachWarning {
	/** Stable key for React lists + per-line dismissal. */
	id: string
	/** Contributor-facing, specific copy (UI-SPEC), e.g. "Property `name` is required." */
	message: string
}

/** The advisory validation state the attach UI reads. NEVER gates publish. */
export interface AttachValidationState {
	/** The `schema` Group coordinate currently being checked against, if any. */
	groupCoordinate: string | null
	/** The Group's display name (for the "Checking against {name}'s rules…" copy). */
	groupName: string | null
	/** True while the off-thread worker is running. */
	checking: boolean
	/** Per-rule warnings (empty when conforming or not a schema Group). */
	warnings: AttachWarning[]
	/** Set when the worker itself failed — copy: "shown unfiltered", publish still enabled. */
	workerFailed: boolean
}

const EMPTY_ATTACH_VALIDATION: AttachValidationState = {
	groupCoordinate: null,
	groupName: null,
	checking: false,
	warnings: [],
	workerFailed: false,
}

/**
 * Turn the off-thread worker's structured `errors[]` into specific, contributor-facing
 * warning lines per the UI-SPEC copywriting contract (e.g. "Property `name` is required.",
 * "Geometry type `Polygon` isn't allowed here."). Bounded by the worker's own MAX_ERRORS cap.
 */
function toAttachWarnings(errors: SchemaRuleError[]): AttachWarning[] {
	return errors.map((error, index) => ({
		id: `${error.keyword}-${error.instancePath || 'root'}-${index}`,
		message: describeAttachError(error),
	}))
}

function describeAttachError(error: SchemaRuleError): string {
	if (error.keyword === 'required') {
		const missing = (error.params as { missingProperty?: string } | undefined)?.missingProperty
		return missing ? `Property \`${missing}\` is required.` : 'A required property is missing.'
	}
	if (error.keyword === 'enum' && error.instancePath.endsWith('/geometry/type')) {
		const allowed = (error.params as { allowedValues?: unknown[] } | undefined)?.allowedValues
		const list = Array.isArray(allowed) ? allowed.join(', ') : ''
		return list
			? `Geometry type isn't allowed here — allowed: ${list}.`
			: "This geometry type isn't allowed here."
	}
	const where = error.instancePath ? `\`${error.instancePath}\` ` : ''
	return `${where}${error.message}.`.replace(/\.\.$/, '.')
}

interface UsePublishingOptions {
	currentUserPubkey: string | undefined
	getDatasetName: (event: GeoDataset) => string
	getDatasetKey: (event: GeoDataset) => string
	/**
	 * The Groups the contributor can `c`-attach to. Repointed from the legacy
	 * `mapContexts: MapContext[]` (the slimmed governance model has NO
	 * `validationMode:'required'` blocking gate — GROUP-04). Used ONLY to resolve a
	 * `schema` Group's schema for the off-thread advisory validation pass.
	 */
	groups: Group[]
	resolvedCollectionResolver?: (event: GeoDataset) => FeatureCollection | undefined
	/** Navigate to a focus route (from useRouting) — publish success lands on the
	 *  published dataset's canonical URL instead of stranding the author in the
	 *  catalog (workflow audit P1). Preserves any active context scope. */
	navigateTo?: (
		focusType: 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon',
		naddr: string,
		sidebarView?: SidebarViewMode,
	) => void
	/** Encode a dataset's naddr (from useRouting). */
	encodeGeoEventNaddr?: (event: {
		kind?: number
		pubkey: string
		datasetId?: string
		dTag?: string
	}) => string | null
	/** Active MLS workspace. When set, dataset writes stay encrypted and never hit public relays. */
	privateWorkspaceId?: string
	publishPrivateDataset?: (
		collection: FeatureCollection,
		options?: { datasetId?: string; name?: string; previous?: GeoDataset },
	) => Promise<GeoDataset>
	/** Active nearby Field session. Writes use the embedded relay and never the public publisher. */
	fieldSessionId?: string
	publishFieldDataset?: (
		collection: FeatureCollection,
		options?: { datasetId?: string; name?: string; previous?: GeoDataset },
	) => Promise<GeoDataset>
	/** False for quarantined drafts whose historical destination cannot be proven. */
	publishBoundaryResolved?: boolean
	publishBoundaryMessage?: string
}

/**
 * Session breadcrumb for the AI chat (one line per publish): lets a same-session
 * "now write the article about what I just published" resolve the fresh naddr
 * without the user re-attaching it.
 */
function noteDatasetSessionPublish(cast: GeoDataset, collection: FeatureCollection): void {
	if (!cast.pubkey || !cast.dTag) return
	const rawName = (collection as { name?: unknown }).name
	const name = typeof rawName === 'string' && rawName ? rawName : (cast.datasetId ?? cast.dTag)
	noteSessionPublish({
		type: 'dataset',
		name,
		coordinate: `${GEO_EVENT_KIND}:${cast.pubkey}:${cast.dTag}`,
	})
}

export function usePublishing({
	currentUserPubkey,
	getDatasetName,
	getDatasetKey,
	groups,
	resolvedCollectionResolver,
	navigateTo,
	encodeGeoEventNaddr,
	privateWorkspaceId,
	publishPrivateDataset,
	fieldSessionId,
	publishFieldDataset,
	publishBoundaryResolved = true,
	publishBoundaryMessage = 'Choose a verified destination before publishing this draft.',
}: UsePublishingOptions) {
	void resolvedCollectionResolver
	const workspaceMode = privateWorkspaceId ? 'private' : fieldSessionId ? 'field' : 'public'
	const workspacePublisher = privateWorkspaceId ? publishPrivateDataset : publishFieldDataset
	const hasWorkspaceScope = workspaceMode !== 'public'
	// A persisted private/nearby draft may be reopened while its group or field
	// session is unavailable. Keep the channel intact, but do not present a Save
	// action that could fail over to the public publisher. The caller restores the
	// scoped publisher only after the destination has been resolved locally.
	const workspacePublisherReady =
		publishBoundaryResolved && (!hasWorkspaceScope || Boolean(workspacePublisher))
	// Store state
	const editor = useEditorStore((state) => state.editor)
	const features = useEditorStore((state) => state.features)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const isDirty = useEditorStore((state) => state.isDirty)
	const activeDatasetContextRefs = useEditorStore((state) => state.activeDatasetContextRefs)
	const collectionMeta = useEditorStore((state) => state.collectionMeta)
	const blobReferences = useEditorStore((state) => state.blobReferences)

	// Store actions
	const setIsPublishing = useEditorStore((state) => state.setIsPublishing)
	const setPublishMessage = useEditorStore((state) => state.setPublishMessage)
	const setIsDirty = useEditorStore((state) => state.setIsDirty)
	const setPublishError = useEditorStore((state) => state.setPublishError)
	const setActiveDataset = useEditorStore((state) => state.setActiveDataset)
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const setActiveDatasetContextRefs = useEditorStore((state) => state.setActiveDatasetContextRefs)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const setMode = useEditorStore((state) => state.setMode)
	const setViewMode = useEditorStore((state) => state.setViewMode)
	const setViewDataset = useEditorStore((state) => state.setViewDataset)
	const setStance = useEditorStore((state) => state.setStance)
	const addMapStackEntry = useEditorStore((state) => state.addMapStackEntry)
	const removeMapStackEntry = useEditorStore((state) => state.removeMapStackEntry)

	// Blossom dialog state
	const setBlossomUploadDialogOpen = useEditorStore((state) => state.setBlossomUploadDialogOpen)
	const setPendingPublishCollection = useEditorStore((state) => state.setPendingPublishCollection)

	const serializeEditorFeature = useCallback((feature: EditorFeature) => {
		const sanitized = sanitizeEditorProperties(
			feature.properties as Record<string, any> | undefined,
		)
		return {
			type: 'Feature' as const,
			id: feature.id,
			geometry: JSON.parse(JSON.stringify(feature.geometry)),
			...(sanitized ? { properties: sanitized } : {}),
		}
	}, [])

	const getCollectionDescription = useCallback((collection: FeatureCollection): string => {
		const maybeCollection = collection as FeatureCollection & {
			description?: string
			properties?: Record<string, unknown>
		}
		const direct = maybeCollection.description
		if (typeof direct === 'string' && direct.trim().length > 0) return direct
		const propertyDescription = maybeCollection.properties?.description
		return typeof propertyDescription === 'string' ? propertyDescription : ''
	}, [])

	const serializeBlobReferences = useCallback(
		(): GeoBlobReference[] =>
			blobReferences
				.filter((reference) => reference.url)
				.map(({ scope, featureId, url, sha256, size, mimeType }: EditorBlobReference) => ({
					scope,
					featureId,
					url,
					sha256,
					size,
					mimeType,
				})),
		[blobReferences],
	)

	const buildCollectionFromEditor = useCallback((): FeatureCollection | null => {
		if (!editor) return null
		// `features` is the reactive Zustand mirror. Reading only from the stable
		// editor instance made this callback retain the previous collection identity,
		// so size/publish previews did not rerender after simplify/update operations.
		const currentFeatures = features
		if (currentFeatures.length === 0) return null

		const collectionName =
			collectionMeta.name ||
			(activeDataset ? getDatasetName(activeDataset) : `Geo dataset ${new Date().toLocaleString()}`)

		const collection: FeatureCollection & {
			name?: string
			description?: string
			color?: string
			properties?: Record<string, any>
		} = {
			type: 'FeatureCollection',
			features: currentFeatures.map(serializeEditorFeature) as any,
		}

		// Add external blob placeholders
		const existingIds = new Set(
			collection.features
				.map((feature) =>
					typeof feature.id === 'string'
						? feature.id
						: typeof feature.id === 'number'
							? String(feature.id)
							: undefined,
				)
				.filter((id): id is string => Boolean(id)),
		)

		blobReferences.forEach((reference) => {
			if (reference.scope !== 'feature' || !reference.featureId) return
			if (existingIds.has(reference.featureId)) return
			existingIds.add(reference.featureId)
			collection.features.push({
				type: 'Feature',
				id: reference.featureId,
				geometry: null,
				properties: {
					externalPlaceholder: true,
					blobUrl: reference.url,
				},
			} as any)
		})

		// Set collection metadata
		;(collection as any).name = collectionName
		if (collectionMeta.description) {
			;(collection as any).description = collectionMeta.description
		}
		if (collectionMeta.color) {
			;(collection as any).color = collectionMeta.color
		}

		const extraProps: Record<string, any> = {
			...collectionMeta.customProperties,
		}
		if (collectionMeta.color) extraProps.color = collectionMeta.color
		if (collectionMeta.description) extraProps.description = collectionMeta.description
		if (collectionMeta.name) extraProps.name = collectionMeta.name

		if (Object.keys(extraProps).length > 0) {
			;(collection as any).properties = {
				...(collection as any).properties,
				...extraProps,
			}
		}

		return collection
	}, [
		editor,
		features,
		collectionMeta,
		activeDataset,
		getDatasetName,
		blobReferences,
		serializeEditorFeature,
	])

	const buildCollectionStub = useCallback(
		(
			collection: FeatureCollection,
			collectionBlobUrl: string,
		): FeatureCollection & {
			name?: string
			description?: string
			properties?: Record<string, any>
		} => {
			const stubCollection: FeatureCollection & {
				name?: string
				description?: string
				properties?: Record<string, any>
			} = {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						id: 'external-geometry-placeholder',
						geometry: null,
						properties: {
							externalPlaceholder: true,
							blobUrl: collectionBlobUrl,
							name: 'External geometry',
						},
					} as any,
				],
			}

			// Copy metadata from original collection for discovery (SPEC.md section 1.5)
			if ((collection as any).name) stubCollection.name = (collection as any).name
			if ((collection as any).description)
				stubCollection.description = (collection as any).description
			if ((collection as any).properties) stubCollection.properties = (collection as any).properties

			return stubCollection
		},
		[],
	)

	/**
	 * Calculate the serialized size of a FeatureCollection in bytes.
	 */
	const getCollectionSize = useCallback((collection: FeatureCollection): number => {
		const jsonString = JSON.stringify(collection)
		return new TextEncoder().encode(jsonString).length
	}, [])

	/**
	 * Check if the collection exceeds the size threshold.
	 */
	const isOverSizeLimit = useCallback(
		(collection: FeatureCollection): boolean => {
			return getCollectionSize(collection) > BLOSSOM_UPLOAD_THRESHOLD_BYTES
		},
		[getCollectionSize],
	)

	/**
	 * Current collection size for display (memoized).
	 */
	const currentCollectionSize = useMemo(() => {
		const collection = buildCollectionFromEditor()
		return collection ? getCollectionSize(collection) : 0
	}, [buildCollectionFromEditor, getCollectionSize])

	// ── Off-thread advisory attach validation (GROUP-04 warn-not-block) ────────────
	//
	// The legacy blocking `validateRequiredContextAttachments` gate is GONE. The slimmed
	// governance model has NO `validationMode:'required'` and NEVER blocks a contributor's
	// publish on a schema failure (REQUIREMENTS "Out of scope: blocking a contributor's
	// publish on schema failure"). Instead, when a dataset's `c` refs point at a `schema`
	// Group, we run the off-thread `validateSchema` worker (via `@/lib/group`) and expose
	// the per-rule verdict as ADVISORY hook state — it never sets `publishError` and never
	// aborts a publish entrypoint.
	const [attachValidation, setAttachValidation] =
		useState<AttachValidationState>(EMPTY_ATTACH_VALIDATION)

	/** Index Groups by their coordinate so a `c` ref resolves to its schema Group. */
	const groupByCoordinate = useMemo(() => {
		const map = new Map<string, Group>()
		groups.forEach((group) => {
			const coordinate = group.groupCoordinate
			if (coordinate) map.set(coordinate, group)
		})
		return map
	}, [groups])

	/** The first attached `schema` Group (with a schema), if any — the validation target. */
	const attachedSchemaGroup = useMemo(() => {
		for (const ref of activeDatasetContextRefs) {
			const group = groupByCoordinate.get(ref)
			if (group && group.group.governance === 'schema' && group.group.schema) {
				return group
			}
		}
		return null
	}, [activeDatasetContextRefs, groupByCoordinate])

	/**
	 * Run the OFF-THREAD advisory validation pass for the attached schema Group. The result
	 * flows ONLY to `attachValidation` — it NEVER sets `publishError` and NEVER blocks
	 * publishing (GROUP-04). A worker failure is surfaced as "shown unfiltered" with publish
	 * still enabled (the dataset is a valid standalone 37515 regardless).
	 */
	const runAttachValidation = useCallback(async () => {
		const group = attachedSchemaGroup
		const schema = group?.group.schema
		if (!group || !schema) {
			setAttachValidation(EMPTY_ATTACH_VALIDATION)
			return
		}

		const groupCoordinate = group.groupCoordinate ?? null
		const groupName = group.group.name || 'this Context'
		// CR-02: derive a content-based compile-cache key when the Group has no published
		// `schema-hash` tag — never the shared `'sha256:unhashed'` sentinel, which would alias
		// distinct unhashed schemas onto the first-compiled validator in the worker cache.
		const schemaHash = await resolveSchemaCacheKey(schema, group.schemaHash)

		setAttachValidation({
			groupCoordinate,
			groupName,
			checking: true,
			warnings: [],
			workerFailed: false,
		})

		const collection = buildCollectionFromEditor()
		const features = collection?.features ?? []

		try {
			const allWarnings: AttachWarning[] = []
			for (const feature of features) {
				const verdict = await validateAttachment(schema, feature.properties ?? {}, {
					schemaHash,
				})
				if (!verdict.ok && verdict.errors && verdict.errors.length > 0) {
					allWarnings.push(...toAttachWarnings(verdict.errors))
				}
			}

			// Dedup identical per-rule lines across features so the contributor sees each
			// distinct rule once.
			const seen = new Set<string>()
			const deduped = allWarnings.filter((warning) => {
				if (seen.has(warning.message)) return false
				seen.add(warning.message)
				return true
			})

			setAttachValidation({
				groupCoordinate,
				groupName,
				checking: false,
				warnings: deduped,
				workerFailed: false,
			})
		} catch {
			// Fail OPEN for legibility only — the worker's timeout-kill is the real DoS guard.
			// Publish stays enabled (the dataset is a valid standalone 37515 regardless).
			setAttachValidation({
				groupCoordinate,
				groupName,
				checking: false,
				warnings: [],
				workerFailed: true,
			})
		}
	}, [attachedSchemaGroup, buildCollectionFromEditor])

	/** Clear the advisory warnings (e.g. when the contributor detaches the Group). */
	const clearAttachValidation = useCallback(() => {
		setAttachValidation(EMPTY_ATTACH_VALIDATION)
	}, [])

	// NOTE: this previously called a nonexistent store action (setViewCollection —
	// legacy state removed long ago), which threw mid-success on EVERY publish and
	// sent the flow into the catch branch. That crash is what stranded authors in
	// the catalog with a stale "Failed to publish" error (workflow audit P1).
	const switchToDatasetViewMode = useCallback(
		(dataset: GeoDataset) => {
			// A successful save ends the map's draft representation and restores the
			// saved dataset under the same scope-specific identity used by stack
			// reconciliation. This keeps public, private, and nearby saves single-row.
			removeMapStackEntry('draft:active')
			const datasetKey = getDatasetKey(dataset)
			const scopedEntry = privateWorkspaceId
				? {
						id: privateDatasetStackEntryId(privateWorkspaceId, datasetKey),
						source: 'private-group' as const,
					}
				: fieldSessionId
					? {
							id: fieldDatasetStackEntryId(fieldSessionId, datasetKey),
							source: 'field-session' as const,
						}
					: { source: 'route' as const }
			addMapStackEntry({
				...scopedEntry,
				entityType: 'dataset',
				entityKey: datasetKey,
				title: getDatasetName(dataset),
				visible: true,
				pinned: false,
			})
			setMode('select')
			setViewMode('view')
			setViewDataset(dataset)
			setStance('focus')
		},
		[
			addMapStackEntry,
			fieldSessionId,
			getDatasetKey,
			getDatasetName,
			privateWorkspaceId,
			removeMapStackEntry,
			setMode,
			setStance,
			setViewDataset,
			setViewMode,
		],
	)

	const finishWorkspaceDatasetSave = useCallback(
		(
			dataset: GeoDataset,
			collection: FeatureCollection,
			action: 'saved' | 'updated' | 'copied',
		) => {
			const label = workspaceMode === 'private' ? 'Private dataset' : 'Nearby dataset'
			setPublishMessage(`${label} ${action}.`)
			toast.success(`${label} ${action}.`)
			setIsDirty(false)
			setActiveDataset(dataset)
			setActiveDatasetContextRefs([])
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			switchToDatasetViewMode(dataset)
		},
		[
			workspaceMode,
			setPublishMessage,
			setIsDirty,
			setActiveDataset,
			setActiveDatasetContextRefs,
			setCollectionMeta,
			setSelectedFeatureIds,
			switchToDatasetViewMode,
		],
	)

	/** Land the author on the just-published dataset's canonical reader route
	 *  (workflow audit P1): the completion destination is the entity itself —
	 *  where it can be verified, shared, and discussed — not the catalog. */
	const navigateToPublishedDataset = useCallback(
		(dataset: GeoDataset) => {
			if (!navigateTo || !encodeGeoEventNaddr) return
			const naddr = encodeGeoEventNaddr(dataset)
			if (naddr) navigateTo('geoevent', naddr, 'datasets')
		},
		[navigateTo, encodeGeoEventNaddr],
	)

	const handlePublishNew = useCallback(async () => {
		if (!editor) return
		if (!publishBoundaryResolved) {
			setPublishError(publishBoundaryMessage)
			return
		}
		setIsPublishing(true)
		setPublishMessage('Preparing dataset...')
		setPublishError(null)

		try {
			const collection = buildCollectionFromEditor()
			if (!collection) throw new Error('No features to publish')
			if (hasWorkspaceScope) {
				if (!workspacePublisher) throw new Error('The active workspace is not available')
				const dataset = await workspacePublisher(collection)
				finishWorkspaceDatasetSave(dataset, collection, 'saved')
				return
			}

			const signer = accounts.signer
			if (!signer) {
				setPublishError('No active account.')
				return
			}

			const refs = serializeBlobReferences()
			const collectionBlobRef = refs.find((ref) => ref.scope === 'collection')
			const referencedCoords = extractReferencedCoordinates(getCollectionDescription(collection))

			let factory = GeoDatasetFactory.create(collection)
				.contextReferences(activeDatasetContextRefs)
				.blobReferences(refs)
				.modifyPublicTags(setAddressReferenceTags(referencedCoords))

			if (collectionBlobRef) {
				// Stub publish (SPEC.md §1.5): compute spatial discovery tags from
				// the full collection, swap the content for a stub, then update
				// content-derived tags (size, checksum) so they match the stub.
				const stubCollection = buildCollectionStub(collection, collectionBlobRef.url)
				factory = factory
					.withSpatialMetadata()
					.content(JSON.stringify(stubCollection))
					.withContentMetadata()
			} else {
				factory = factory.withDerivedMetadata()
			}

			const signedEvent = await factory.sign(signer)
			await publish(signedEvent, { routing: 'outbox' })
			const cast = castEvent(signedEvent, GeoDataset, eventStore)

			setPublishMessage('Dataset published successfully.')
			toast.success('Dataset published.')
			noteDatasetSessionPublish(cast, collection)
			setActiveDataset(cast)
			setActiveDatasetContextRefs(cast.contextReferences)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			switchToDatasetViewMode(cast)
			navigateToPublishedDataset(cast)
		} catch (error) {
			console.error('Failed to publish dataset', error)
			setPublishError(publishFailureMessage('publish this dataset', error))
		} finally {
			setIsPublishing(false)
		}
	}, [
		editor,
		publishBoundaryResolved,
		publishBoundaryMessage,
		setIsPublishing,
		setPublishMessage,
		setPublishError,
		buildCollectionFromEditor,
		hasWorkspaceScope,
		workspacePublisher,
		finishWorkspaceDatasetSave,
		serializeBlobReferences,
		activeDatasetContextRefs,
		buildCollectionStub,
		getCollectionDescription,
		setActiveDataset,
		setActiveDatasetContextRefs,
		setCollectionMeta,
		setSelectedFeatureIds,
		switchToDatasetViewMode,
		navigateToPublishedDataset,
	])

	/**
	 * Complete publishing with blossom blob reference.
	 * Creates a stub event with a blob reference (SPEC.md section 1.5).
	 */
	const handlePublishWithBlossomUpload = useCallback(
		async (blobResult: { sha256: string; url: string; size: number }) => {
			if (!publishBoundaryResolved || hasWorkspaceScope) {
				setPublishError('External public storage is unavailable for this draft destination.')
				return
			}
			const signer = accounts.signer
			if (!signer) {
				setPublishError('No active account.')
				return
			}

			setIsPublishing(true)
			setPublishMessage('Publishing with external reference...')
			setPublishError(null)

			try {
				const collection = buildCollectionFromEditor()
				if (!collection) throw new Error('No features to publish')

				const existingRefs = serializeBlobReferences()
				const blobRefs: GeoBlobReference[] = [
					...existingRefs.filter((ref) => ref.scope !== 'collection'),
					{
						scope: 'collection',
						url: blobResult.url,
						sha256: blobResult.sha256,
						size: blobResult.size,
						mimeType: 'application/geo+json',
					},
				]
				const referencedCoords = extractReferencedCoordinates(getCollectionDescription(collection))
				const stubCollection = buildCollectionStub(collection, blobResult.url)

				const signedEvent = await GeoDatasetFactory.create(collection)
					.contextReferences(activeDatasetContextRefs)
					.blobReferences(blobRefs)
					.modifyPublicTags(setAddressReferenceTags(referencedCoords))
					.withSpatialMetadata()
					.content(JSON.stringify(stubCollection))
					.withContentMetadata()
					.sign(signer)

				await publish(signedEvent, { routing: 'outbox' })
				const cast = castEvent(signedEvent, GeoDataset, eventStore)

				setPublishMessage('Dataset published with external reference.')
				toast.success('Dataset published (large geometry stored externally).')
				noteDatasetSessionPublish(cast, collection)
				setActiveDataset(cast)
				setActiveDatasetContextRefs(cast.contextReferences)
				setCollectionMeta(extractCollectionMeta(collection))
				setSelectedFeatureIds([])
				switchToDatasetViewMode(cast)
				navigateToPublishedDataset(cast)

				setPendingPublishCollection(null)
				setBlossomUploadDialogOpen(false)
			} catch (error) {
				console.error('Failed to publish with blossom', error)
				setPublishError(publishFailureMessage('publish this dataset', error))
			} finally {
				setIsPublishing(false)
			}
		},
		[
			publishBoundaryResolved,
			hasWorkspaceScope,
			setIsPublishing,
			setPublishMessage,
			setPublishError,
			buildCollectionFromEditor,
			activeDatasetContextRefs,
			serializeBlobReferences,
			buildCollectionStub,
			getCollectionDescription,
			setActiveDataset,
			setActiveDatasetContextRefs,
			setCollectionMeta,
			setSelectedFeatureIds,
			switchToDatasetViewMode,
			navigateToPublishedDataset,
			setPendingPublishCollection,
			setBlossomUploadDialogOpen,
		],
	)

	const handlePublishUpdate = useCallback(async () => {
		if (!editor || !activeDataset) return
		if (!publishBoundaryResolved) {
			setPublishError(publishBoundaryMessage)
			return
		}
		setIsPublishing(true)
		setPublishMessage('Updating dataset...')
		setPublishError(null)

		if (currentUserPubkey !== activeDataset.pubkey) {
			setPublishError('You can only update datasets you own.')
			setIsPublishing(false)
			return
		}

		const collection = buildCollectionFromEditor()
		if (!collection) {
			setPublishError('Draw or load geometry before publishing.')
			setIsPublishing(false)
			return
		}

		if (hasWorkspaceScope) {
			try {
				if (!workspacePublisher) throw new Error('The active workspace is not available')
				const dataset = await workspacePublisher(collection, {
					datasetId: activeDataset.dTag,
					previous: activeDataset,
				})
				finishWorkspaceDatasetSave(dataset, collection, 'updated')
			} catch (error) {
				console.error('Failed to update workspace dataset', error)
				setPublishError('Failed to update dataset. Check the workspace connection.')
			} finally {
				setIsPublishing(false)
			}
			return
		}

		const signer = accounts.signer
		if (!signer) {
			setPublishError('No active account.')
			setIsPublishing(false)
			return
		}

		try {
			const refs = serializeBlobReferences()
			const collectionBlobRef = refs.find((ref) => ref.scope === 'collection')
			const referencedCoords = extractReferencedCoordinates(getCollectionDescription(collection))

			let factory = GeoDatasetFactory.update(activeDataset.event, collection)
				.hashtags(activeDataset.hashtags)
				.collectionReferences(activeDataset.collectionReferences)
				.contextReferences(activeDatasetContextRefs)
				.relayHints(activeDataset.relayHints)
				.blobReferences(refs)
				.modifyPublicTags(setAddressReferenceTags(referencedCoords))

			if (collectionBlobRef) {
				const stubCollection = buildCollectionStub(collection, collectionBlobRef.url)
				factory = factory
					.withSpatialMetadata()
					.content(JSON.stringify(stubCollection))
					.withContentMetadata()
			} else {
				factory = factory.withDerivedMetadata()
			}

			const signedEvent = await factory.sign(signer)
			await publish(signedEvent, { routing: 'outbox' })
			const cast = castEvent(signedEvent, GeoDataset, eventStore)

			setPublishMessage('Dataset update published successfully.')
			toast.success('Dataset updated.')
			noteDatasetSessionPublish(cast, collection)
			setIsDirty(false)
			setActiveDataset(cast)
			setActiveDatasetContextRefs(cast.contextReferences)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			switchToDatasetViewMode(cast)
			navigateToPublishedDataset(cast)
		} catch (error) {
			console.error('Failed to publish dataset update', error)
			setPublishError(publishFailureMessage('publish this dataset update', error))
		} finally {
			setIsPublishing(false)
		}
	}, [
		editor,
		publishBoundaryResolved,
		publishBoundaryMessage,
		activeDataset,
		setIsPublishing,
		setPublishMessage,
		setPublishError,
		currentUserPubkey,
		buildCollectionFromEditor,
		hasWorkspaceScope,
		workspacePublisher,
		finishWorkspaceDatasetSave,
		serializeBlobReferences,
		activeDatasetContextRefs,
		buildCollectionStub,
		getCollectionDescription,
		setActiveDataset,
		setActiveDatasetContextRefs,
		setCollectionMeta,
		setSelectedFeatureIds,
		setIsDirty,
		switchToDatasetViewMode,
		navigateToPublishedDataset,
	])

	const handlePublishCopy = useCallback(async () => {
		if (!editor) return
		if (!publishBoundaryResolved) {
			setPublishError(publishBoundaryMessage)
			return
		}
		setIsPublishing(true)
		setPublishMessage('Creating copy...')
		setPublishError(null)

		try {
			const collection = buildCollectionFromEditor()
			if (!collection) throw new Error('No features to publish')
			if (hasWorkspaceScope) {
				if (!workspacePublisher) throw new Error('The active workspace is not available')
				const dataset = await workspacePublisher(collection)
				finishWorkspaceDatasetSave(dataset, collection, 'copied')
				return
			}

			const signer = accounts.signer
			if (!signer) {
				setPublishError('No active account.')
				return
			}

			const refs = serializeBlobReferences()
			const collectionBlobRef = refs.find((ref) => ref.scope === 'collection')
			const referencedCoords = extractReferencedCoordinates(getCollectionDescription(collection))

			let factory = GeoDatasetFactory.create(collection)
				.contextReferences(activeDatasetContextRefs)
				.blobReferences(refs)
				.modifyPublicTags(setAddressReferenceTags(referencedCoords))

			if (collectionBlobRef) {
				const stubCollection = buildCollectionStub(collection, collectionBlobRef.url)
				factory = factory
					.withSpatialMetadata()
					.content(JSON.stringify(stubCollection))
					.withContentMetadata()
			} else {
				factory = factory.withDerivedMetadata()
			}

			const signedEvent = await factory.sign(signer)
			await publish(signedEvent, { routing: 'outbox' })
			const cast = castEvent(signedEvent, GeoDataset, eventStore)

			setPublishMessage('Dataset copy published successfully.')
			toast.success('Dataset copy published.')
			noteDatasetSessionPublish(cast, collection)
			setActiveDataset(cast)
			setActiveDatasetContextRefs(cast.contextReferences)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			switchToDatasetViewMode(cast)
			navigateToPublishedDataset(cast)
		} catch (error) {
			console.error('Failed to publish dataset copy', error)
			setPublishError(publishFailureMessage('publish this dataset copy', error))
		} finally {
			setIsPublishing(false)
		}
	}, [
		editor,
		publishBoundaryResolved,
		publishBoundaryMessage,
		setIsPublishing,
		setPublishMessage,
		setPublishError,
		buildCollectionFromEditor,
		hasWorkspaceScope,
		workspacePublisher,
		finishWorkspaceDatasetSave,
		serializeBlobReferences,
		activeDatasetContextRefs,
		buildCollectionStub,
		getCollectionDescription,
		setActiveDataset,
		setActiveDatasetContextRefs,
		setCollectionMeta,
		setSelectedFeatureIds,
		switchToDatasetViewMode,
		navigateToPublishedDataset,
	])

	const handleProposeEdit = useCallback(
		async (description: string) => {
			if (!editor || !activeDataset) return
			if (!publishBoundaryResolved) {
				setPublishError(publishBoundaryMessage)
				return
			}
			setIsPublishing(true)
			setPublishMessage('Creating edit proposal...')
			setPublishError(null)

			try {
				const collection = buildCollectionFromEditor()
				if (!collection) throw new Error('No features to publish')

				const signer = accounts.signer
				if (!signer) {
					setPublishError('No active account.')
					return
				}

				const targetAddress = `${GEO_EVENT_KIND}:${activeDataset.pubkey}:${activeDataset.dTag}`
				const referencedCoords = extractReferencedCoordinates(description)
				const signedEvent = await GeoProposalFactory.create(
					{
						address: targetAddress,
						ownerPubkey: activeDataset.pubkey,
						baseVersion: activeDataset.id,
					},
					collection,
				)
					.description(description)
					.hashtags(activeDataset.hashtags)
					// Preserve the target's `a` tag so the rich-text sync can't strip it.
					.modifyPublicTags(setAddressReferenceTags(referencedCoords, [targetAddress]))
					.withSpatialMetadata()
					.sign(signer)

				// Route to the dataset owner's inbox so they're notified, with a
				// safe dev-mode fallback to `config.relayUrls`.
				await publish(signedEvent, { routing: 'inbox', target: activeDataset.pubkey })

				setPublishMessage('Edit proposal published successfully.')
				toast.success('Edit proposal sent to the dataset owner.')
				switchToDatasetViewMode(activeDataset)
				setSelectedFeatureIds([])
			} catch (error) {
				console.error('Failed to publish edit proposal', error)
				setPublishError(publishFailureMessage('publish this edit proposal', error))
				toast.error('Failed to publish edit proposal.')
			} finally {
				setIsPublishing(false)
			}
		},
		[
			editor,
			publishBoundaryResolved,
			publishBoundaryMessage,
			activeDataset,
			setIsPublishing,
			setPublishMessage,
			setPublishError,
			buildCollectionFromEditor,
			switchToDatasetViewMode,
			setSelectedFeatureIds,
		],
	)

	const handleDeleteDataset = useCallback(
		async (event: GeoDataset, onClear: () => void) => {
			if (hasWorkspaceScope) {
				toast.error('Workspace dataset deletion is not available yet.')
				return
			}
			const signer = accounts.signer
			if (!signer) {
				toast.error('No active account.')
				return
			}
			if (!(event.datasetId ?? event.dTag)) {
				toast.error('Dataset is missing a d tag and cannot be deleted.')
				return
			}

			const key = getDatasetKey(event)
			try {
				await deleteDataset(event.event, signer)
				if (activeDataset && getDatasetKey(activeDataset) === key) {
					onClear()
				}
				toast.success(`Deleted "${getDatasetName(event)}".`)
			} catch (error) {
				console.error('Failed to delete dataset', error)
				toast.error('Failed to delete dataset. Check console for details.')
			}
		},
		[activeDataset, getDatasetKey, getDatasetName, hasWorkspaceScope],
	)

	// Check if there's a collection blob reference (uploaded to Blossom)
	const hasCollectionBlob = blobReferences.some((ref) => ref.scope === 'collection' && ref.url)

	// Computed permissions
	// Can publish new if: has features, no active dataset, and (not over size OR has blob uploaded)
	const collection = buildCollectionFromEditor()
	const canPublishNew =
		features.length > 0 &&
		!activeDataset &&
		workspacePublisherReady &&
		(hasWorkspaceScope || hasCollectionBlob || (collection ? !isOverSizeLimit(collection) : true))
	const canPublishUpdate =
		workspacePublisherReady &&
		!!activeDataset &&
		currentUserPubkey === activeDataset?.pubkey &&
		features.length > 0 &&
		isDirty
	const canPublishCopy =
		workspacePublisherReady &&
		!!activeDataset &&
		currentUserPubkey !== activeDataset?.pubkey &&
		features.length > 0
	const canProposeEdit =
		publishBoundaryResolved &&
		!hasWorkspaceScope &&
		!!activeDataset &&
		currentUserPubkey !== activeDataset?.pubkey &&
		features.length > 0

	return {
		// Actions
		handlePublishNew,
		handlePublishUpdate,
		handlePublishCopy,
		handleProposeEdit,
		handleDeleteDataset,
		handlePublishWithBlossomUpload,
		buildCollectionFromEditor,
		serializeBlobReferences,
		// Advisory attach validation (GROUP-04 warn-not-block; NEVER gates publish)
		attachValidation,
		attachedSchemaGroup,
		runAttachValidation,
		clearAttachValidation,
		setActiveDatasetContextRefs,
		activeDatasetContextRefs,
		// Size helpers
		getCollectionSize,
		isOverSizeLimit,
		currentCollectionSize,
		sizeThreshold: BLOSSOM_UPLOAD_THRESHOLD_BYTES,
		// Computed
		canPublishNew,
		canPublishUpdate,
		canPublishCopy,
		canProposeEdit,
	}
}
