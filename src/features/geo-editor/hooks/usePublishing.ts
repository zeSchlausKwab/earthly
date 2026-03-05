import type NDK from '@nostr-dev-kit/ndk'
import type { FeatureCollection } from 'geojson'
import { useCallback, useMemo } from 'react'
import { validateDatasetForContext } from '@/lib/context/validation'
import type { GeoBlobReference, NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { NDKGeoEvent as NDKGeoEventClass } from '@/lib/ndk/NDKGeoEvent'
import { NDKGeoEditProposalEvent } from '@/lib/ndk/NDKGeoEditProposalEvent'
import { GEO_EVENT_KIND } from '@/lib/ndk/kinds'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import type { EditorFeature } from '../core'
import { useEditorStore } from '../store'
import type { EditorBlobReference } from '../types'
import { extractCollectionMeta, sanitizeEditorProperties } from '../utils'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '../constants'

interface UsePublishingOptions {
	ndk: NDK | undefined
	currentUserPubkey: string | undefined
	getDatasetName: (event: NDKGeoEvent) => string
	getDatasetKey: (event: NDKGeoEvent) => string
	mapContexts: NDKMapContextEvent[]
	resolvedCollectionResolver?: (event: NDKGeoEvent) => FeatureCollection | undefined
}

export function usePublishing({
	ndk,
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
	const activeDatasetContextRefs = useEditorStore((state) => state.activeDatasetContextRefs)
	const collectionMeta = useEditorStore((state) => state.collectionMeta)
	const blobReferences = useEditorStore((state) => state.blobReferences)

	// Store actions
	const setIsPublishing = useEditorStore((state) => state.setIsPublishing)
	const setPublishMessage = useEditorStore((state) => state.setPublishMessage)
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

			const contextByCoordinate = new Map<string, NDKMapContextEvent>()
			mapContexts.forEach((context) => {
				const coordinate = context.contextCoordinate
				if (coordinate) {
					contextByCoordinate.set(coordinate, context)
				}
			})

			const requiredContexts = activeDatasetContextRefs
				.map((ref) => contextByCoordinate.get(ref))
				.filter((context): context is NDKMapContextEvent => Boolean(context))
				.filter(
					(context) =>
						(context.context.contextUse === 'validation' ||
							context.context.contextUse === 'hybrid') &&
						context.context.validationMode === 'required',
				)

			if (requiredContexts.length === 0) {
				return { ok: true }
			}

			const candidate = new NDKGeoEventClass(ndk || undefined)
			candidate.featureCollection = collection
			candidate.contextReferences = activeDatasetContextRefs

			for (const context of requiredContexts) {
				const result = validateDatasetForContext(candidate, context, collection, 'strict')
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
		[activeDatasetContextRefs, mapContexts, ndk],
	)

	const switchToDatasetViewMode = useCallback(
		(dataset: NDKGeoEvent) => {
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

			if (!ndk) {
				setPublishError('NDK is not ready.')
				return
			}

			const refs = serializeBlobReferences()
			const collectionBlobRef = refs.find((ref) => ref.scope === 'collection')

			const event = new NDKGeoEventClass(ndk)
			event.contextReferences = activeDatasetContextRefs

			if (collectionBlobRef) {
				// Publish as STUB with external reference (per SPEC.md section 1.5)
				// Compute metadata from FULL collection first, then set stub content
				event.featureCollection = collection
				event.updateDerivedMetadata() // Computes bbox, geohash from full geometry

				// Now replace content with stub - keeping the computed metadata tags
				const stubCollection = buildCollectionStub(collection, collectionBlobRef.url)

				// Set stub as content (metadata tags already computed above)
				event.content = JSON.stringify(stubCollection)
				event.blobReferences = refs
				// Skip metadata update since we pre-computed from full collection
				await event.publishNew(undefined, { skipMetadataUpdate: true })
			} else {
				// Publish with full geometry inline (standard case)
				event.featureCollection = collection
				event.blobReferences = refs
				await event.publishNew()
			}
			setPublishMessage('Dataset published successfully.')
			setActiveDataset(event)
			setActiveDatasetContextRefs(event.contextReferences)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			switchToDatasetViewMode(event)
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
		ndk,
		serializeBlobReferences,
		activeDatasetContextRefs,
		buildCollectionStub,
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
			if (!ndk) {
				setPublishError('NDK is not ready.')
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

				const event = new NDKGeoEventClass(ndk)
				event.contextReferences = activeDatasetContextRefs
				// Compute discovery metadata (bbox/geohash) from the full geometry first.
				event.featureCollection = collection
				event.updateDerivedMetadata()

				// Then publish stub content referencing Blossom.
				const stubCollection = buildCollectionStub(collection, blobResult.url)
				event.content = JSON.stringify(stubCollection)

				// Add the blob reference for the full collection
				const existingRefs = serializeBlobReferences()
				event.blobReferences = [
					...existingRefs.filter((ref) => ref.scope !== 'collection'),
					{
						scope: 'collection',
						url: blobResult.url,
						sha256: blobResult.sha256,
						size: blobResult.size,
						mimeType: 'application/geo+json',
					},
				]

				await event.publishNew(undefined, { skipMetadataUpdate: true })
				setPublishMessage('Dataset published with external reference.')
				setActiveDataset(event)
				setActiveDatasetContextRefs(event.contextReferences)
				setCollectionMeta(extractCollectionMeta(collection))
				setSelectedFeatureIds([])
				switchToDatasetViewMode(event)

				// Clean up dialog state
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
			ndk,
			setIsPublishing,
			setPublishMessage,
			setPublishError,
			buildCollectionFromEditor,
			validateRequiredContextAttachments,
			activeDatasetContextRefs,
			serializeBlobReferences,
			buildCollectionStub,
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

		try {
			const refs = serializeBlobReferences()
			const collectionBlobRef = refs.find((ref) => ref.scope === 'collection')

			const event = new NDKGeoEventClass(ndk || undefined)
			event.datasetId = activeDataset.datasetId ?? activeDataset.id
			event.hashtags = activeDataset.hashtags
			event.collectionReferences = activeDataset.collectionReferences
			event.contextReferences = activeDatasetContextRefs
			event.relayHints = activeDataset.relayHints
			event.blobReferences = refs

			if (collectionBlobRef) {
				// Publish as STUB with external reference (per SPEC.md section 1.5)
				// Preserve discovery metadata if we can't compute it (e.g. geometry not loaded)
				event.boundingBox = activeDataset.boundingBox
				event.geohash = activeDataset.geohash

				// Compute bbox/geohash from FULL collection first, then set stub content.
				event.featureCollection = collection
				event.updateDerivedMetadata()

				const stubCollection = buildCollectionStub(collection, collectionBlobRef.url)
				event.content = JSON.stringify(stubCollection)

				await event.publishUpdate(activeDataset, undefined, { skipMetadataUpdate: true })
			} else {
				// Publish with full geometry inline (standard case)
				event.featureCollection = collection
				await event.publishUpdate(activeDataset)
			}

			setPublishMessage('Dataset update published successfully.')
			setActiveDataset(event)
			setActiveDatasetContextRefs(event.contextReferences)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			switchToDatasetViewMode(event)
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
		ndk,
		serializeBlobReferences,
		activeDatasetContextRefs,
		buildCollectionStub,
		setActiveDataset,
		setActiveDatasetContextRefs,
		setCollectionMeta,
		setSelectedFeatureIds,
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

			if (!ndk) {
				setPublishError('NDK is not ready.')
				return
			}

			const refs = serializeBlobReferences()
			const collectionBlobRef = refs.find((ref) => ref.scope === 'collection')

			const event = new NDKGeoEventClass(ndk)
			event.contextReferences = activeDatasetContextRefs
			event.blobReferences = refs

			if (collectionBlobRef) {
				event.featureCollection = collection
				event.updateDerivedMetadata()

				const stubCollection = buildCollectionStub(collection, collectionBlobRef.url)
				event.content = JSON.stringify(stubCollection)
				await event.publishNew(undefined, { skipMetadataUpdate: true })
			} else {
				event.featureCollection = collection
				await event.publishNew()
			}

			setPublishMessage('Dataset copy published successfully.')
			setActiveDataset(event)
			setActiveDatasetContextRefs(event.contextReferences)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			switchToDatasetViewMode(event)
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
		ndk,
		serializeBlobReferences,
		activeDatasetContextRefs,
		buildCollectionStub,
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

				if (!ndk) {
					setPublishError('NDK is not ready.')
					return
				}

				const proposal = new NDKGeoEditProposalEvent(ndk)
				proposal.featureCollection = collection
				proposal.targetAddress = `${GEO_EVENT_KIND}:${activeDataset.pubkey}:${activeDataset.dTag}`
				proposal.ownerPubkey = activeDataset.pubkey
				if (activeDataset.id) {
					proposal.baseVersion = activeDataset.id
				}
				proposal.description = description
				proposal.hashtags = activeDataset.hashtags

				await proposal.publishProposal()
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
			ndk,
			switchToDatasetViewMode,
			setSelectedFeatureIds,
		],
	)

	const handleDeleteDataset = useCallback(
		async (event: NDKGeoEvent, onClear: () => void) => {
			if (!ndk) {
				alert('NDK is not ready.')
				return
			}
			if (!event.datasetId) {
				alert('Dataset is missing a d tag and cannot be deleted.')
				return
			}
			if (!confirm(`Delete dataset "${getDatasetName(event)}"? This action cannot be undone.`)) {
				return
			}

			const key = getDatasetKey(event)
			try {
				await NDKGeoEventClass.deleteDataset(ndk, event)
				if (activeDataset && getDatasetKey(activeDataset) === key) {
					onClear()
				}
			} catch (error) {
				console.error('Failed to delete dataset', error)
				alert('Failed to delete dataset. Check console for details.')
			}
		},
		[ndk, activeDataset, getDatasetKey, getDatasetName],
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
		!!activeDataset && currentUserPubkey === activeDataset?.pubkey && features.length > 0
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
