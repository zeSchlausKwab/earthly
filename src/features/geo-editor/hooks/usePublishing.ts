import { castEvent } from 'applesauce-core/casts'
import type { FeatureCollection } from 'geojson'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { validateDatasetForContext } from '@/lib/context/validation'
import { accounts, eventStore, publish } from '@/lib/nostr'
import {
	deleteDataset,
	GeoDataset,
	GeoDatasetFactory,
	type GeoBlobReference,
} from '@/lib/nostr/geo-event'
import { GeoProposal, GeoProposalFactory } from '@/lib/nostr/geo-proposal'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import type { MapContext } from '@/lib/nostr/map-context'
import {
	extractReferencedCoordinates,
	setAddressReferenceTags,
} from '@/lib/nostr/references'
import type { EditorFeature } from '../core'
import { useEditorStore } from '../store'
import type { EditorBlobReference } from '../types'
import { extractCollectionMeta, sanitizeEditorProperties } from '../utils'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '../constants'

interface UsePublishingOptions {
	currentUserPubkey: string | undefined
	getDatasetName: (event: GeoDataset) => string
	getDatasetKey: (event: GeoDataset) => string
	mapContexts: MapContext[]
	resolvedCollectionResolver?: (event: GeoDataset) => FeatureCollection | undefined
}

export function usePublishing({
	currentUserPubkey,
	getDatasetName,
	getDatasetKey,
	mapContexts,
	resolvedCollectionResolver,
}: UsePublishingOptions) {
	void resolvedCollectionResolver
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
	const setViewCollection = useEditorStore((state) => state.setViewCollection)

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
		const currentFeatures = editor.getAllFeatures()
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

	const validateRequiredContextAttachments = useCallback(
		(collection: FeatureCollection): { ok: true } | { ok: false; message: string } => {
			if (activeDatasetContextRefs.length === 0) {
				return { ok: true }
			}

			const contextByCoordinate = new Map<string, MapContext>()
			mapContexts.forEach((context) => {
				const coordinate = context.contextCoordinate
				if (coordinate) {
					contextByCoordinate.set(coordinate, context)
				}
			})

			const requiredContexts = activeDatasetContextRefs
				.map((ref) => contextByCoordinate.get(ref))
				.filter((context): context is MapContext => Boolean(context))
				.filter(
					(context) =>
						(context.context.contextUse === 'validation' ||
							context.context.contextUse === 'hybrid') &&
						context.context.validationMode === 'required',
				)

			if (requiredContexts.length === 0) {
				return { ok: true }
			}

			// Validation only consults the dataset for its featureCollection when
			// none is provided explicitly. We always pass the collection here, so
			// passing `null` for the dataset is fine.
			for (const context of requiredContexts) {
				const result = validateDatasetForContext(null, context, collection, 'strict')
				if (result.status !== 'valid') {
					const contextName =
						context.context.name || context.contextId || context.id || 'Unknown context'
					return {
						ok: false,
						message: `Context validation failed for "${contextName}" (${result.featureErrorCount} invalid feature(s)).`,
					}
				}
			}

			return { ok: true }
		},
		[activeDatasetContextRefs, mapContexts],
	)

	const switchToDatasetViewMode = useCallback(
		(dataset: GeoDataset) => {
			setMode('select')
			setViewMode('view')
			setViewDataset(dataset)
			setViewCollection(null)
		},
		[setMode, setViewMode, setViewDataset, setViewCollection],
	)

	const handlePublishNew = useCallback(async () => {
		if (!editor) return
		setIsPublishing(true)
		setPublishMessage('Preparing dataset...')
		setPublishError(null)

		try {
			const collection = buildCollectionFromEditor()
			if (!collection) throw new Error('No features to publish')
			const contextValidation = validateRequiredContextAttachments(collection)
			if (contextValidation.ok === false) {
				setPublishError(contextValidation.message)
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
			setActiveDataset(cast)
			setActiveDatasetContextRefs(cast.contextReferences)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			switchToDatasetViewMode(cast)
		} catch (error) {
			console.error('Failed to publish dataset', error)
			setPublishError('Failed to publish dataset. Check console for details.')
		} finally {
			setIsPublishing(false)
		}
	}, [
		editor,
		setIsPublishing,
		setPublishMessage,
		setPublishError,
		buildCollectionFromEditor,
		validateRequiredContextAttachments,
		serializeBlobReferences,
		activeDatasetContextRefs,
		buildCollectionStub,
		getCollectionDescription,
		setActiveDataset,
		setActiveDatasetContextRefs,
		setCollectionMeta,
		setSelectedFeatureIds,
		switchToDatasetViewMode,
	])

	/**
	 * Complete publishing with blossom blob reference.
	 * Creates a stub event with a blob reference (SPEC.md section 1.5).
	 */
	const handlePublishWithBlossomUpload = useCallback(
		async (blobResult: { sha256: string; url: string; size: number }) => {
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
				const contextValidation = validateRequiredContextAttachments(collection)
				if (contextValidation.ok === false) {
					setPublishError(contextValidation.message)
					return
				}

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
				setActiveDataset(cast)
				setActiveDatasetContextRefs(cast.contextReferences)
				setCollectionMeta(extractCollectionMeta(collection))
				setSelectedFeatureIds([])
				switchToDatasetViewMode(cast)

				setPendingPublishCollection(null)
				setBlossomUploadDialogOpen(false)
			} catch (error) {
				console.error('Failed to publish with blossom', error)
				setPublishError('Failed to publish. Check console for details.')
			} finally {
				setIsPublishing(false)
			}
		},
		[
			setIsPublishing,
			setPublishMessage,
			setPublishError,
			buildCollectionFromEditor,
			validateRequiredContextAttachments,
			activeDatasetContextRefs,
			serializeBlobReferences,
			buildCollectionStub,
			getCollectionDescription,
			setActiveDataset,
			setActiveDatasetContextRefs,
			setCollectionMeta,
			setSelectedFeatureIds,
			switchToDatasetViewMode,
			setPendingPublishCollection,
			setBlossomUploadDialogOpen,
		],
	)

	const handlePublishUpdate = useCallback(async () => {
		if (!editor || !activeDataset) return
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
		const contextValidation = validateRequiredContextAttachments(collection)
		if (contextValidation.ok === false) {
			setPublishError(contextValidation.message)
			setIsPublishing(false)
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
			setIsDirty(false)
			setActiveDataset(cast)
			setActiveDatasetContextRefs(cast.contextReferences)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			switchToDatasetViewMode(cast)
		} catch (error) {
			console.error('Failed to publish dataset update', error)
			setPublishError('Failed to publish dataset update. Check console for details.')
		} finally {
			setIsPublishing(false)
		}
	}, [
		editor,
		activeDataset,
		setIsPublishing,
		setPublishMessage,
		setPublishError,
		currentUserPubkey,
		buildCollectionFromEditor,
		validateRequiredContextAttachments,
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
	])

	const handlePublishCopy = useCallback(async () => {
		if (!editor) return
		setIsPublishing(true)
		setPublishMessage('Creating copy...')
		setPublishError(null)

		try {
			const collection = buildCollectionFromEditor()
			if (!collection) throw new Error('No features to publish')
			const contextValidation = validateRequiredContextAttachments(collection)
			if (contextValidation.ok === false) {
				setPublishError(contextValidation.message)
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
			setActiveDataset(cast)
			setActiveDatasetContextRefs(cast.contextReferences)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			switchToDatasetViewMode(cast)
		} catch (error) {
			console.error('Failed to publish dataset copy', error)
			setPublishError('Failed to publish dataset copy. Check console for details.')
		} finally {
			setIsPublishing(false)
		}
	}, [
		editor,
		setIsPublishing,
		setPublishMessage,
		setPublishError,
		buildCollectionFromEditor,
		validateRequiredContextAttachments,
		serializeBlobReferences,
		activeDatasetContextRefs,
		buildCollectionStub,
		getCollectionDescription,
		setActiveDataset,
		setActiveDatasetContextRefs,
		setCollectionMeta,
		setSelectedFeatureIds,
		switchToDatasetViewMode,
	])

	const handleProposeEdit = useCallback(
		async (description: string) => {
			if (!editor || !activeDataset) return
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
				switchToDatasetViewMode(activeDataset)
				setSelectedFeatureIds([])
			} catch (error) {
				console.error('Failed to publish edit proposal', error)
				setPublishError('Failed to publish edit proposal. Check console for details.')
			} finally {
				setIsPublishing(false)
			}
		},
		[
			editor,
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
		[activeDataset, getDatasetKey, getDatasetName],
	)

	// Check if there's a collection blob reference (uploaded to Blossom)
	const hasCollectionBlob = blobReferences.some((ref) => ref.scope === 'collection' && ref.url)

	// Computed permissions
	// Can publish new if: has features, no active dataset, and (not over size OR has blob uploaded)
	const collection = buildCollectionFromEditor()
	const canPublishNew =
		features.length > 0 &&
		!activeDataset &&
		(hasCollectionBlob || (collection ? !isOverSizeLimit(collection) : true))
	const canPublishUpdate =
		!!activeDataset && currentUserPubkey === activeDataset?.pubkey && features.length > 0 && isDirty
	const canPublishCopy =
		!!activeDataset && currentUserPubkey !== activeDataset?.pubkey && features.length > 0
	const canProposeEdit =
		!!activeDataset && currentUserPubkey !== activeDataset?.pubkey && features.length > 0

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
