import { cn } from '@/lib/utils'
import { useNDK, useNDKCurrentUser } from '@nostr-dev-kit/react'
import type { FeatureCollection } from 'geojson'
import { Eye, EyeOff, MapPin, Maximize2, MessageCircle, Plus, Trash2 } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore, type GeoCollectionEditDraft } from '../geo-editor/store'
import { NDKGeoCollectionEvent } from '@/lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoCommentEvent } from '@/lib/ndk/NDKGeoCommentEvent'
import type { MapContextValidationMode, NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import { CommentsPanel } from '../social/comments'
import {
	GeoRichTextEditor,
	type GeoFeatureItem,
	type GeoRichTextEditorRef,
} from '@/components/editor/GeoRichTextEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface GeoCollectionEditorPanelProps {
	initialCollection?: NDKGeoCollectionEvent | null
	onClose: () => void
	onSave: (collection: NDKGeoCollectionEvent) => void
	availableFeatures?: GeoFeatureItem[]
	mapContextEvents?: NDKMapContextEvent[]
	className?: string
	/** Callback to add/remove comment GeoJSON overlay on map */
	onCommentGeometryVisibility?: (comment: NDKGeoCommentEvent, visible: boolean) => void
	/** Callback to zoom to a bounding box */
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	/** Callback when a geo mention's visibility is toggled */
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	/** Callback to zoom to a mentioned geometry */
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	/** Optional comment d-tag from the route to reveal in the thread */
	focusCommentId?: string
}

export function GeoCollectionEditorPanel({
	initialCollection,
	onClose,
	onSave,
	availableFeatures = [],
	mapContextEvents = [],
	className,
	onCommentGeometryVisibility,
	onZoomToBounds,
	onMentionVisibilityToggle,
	onMentionZoomTo,
	focusCommentId,
}: GeoCollectionEditorPanelProps) {
	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const editorRef = useRef<GeoRichTextEditorRef>(null)

	const [visibleGeojsonCommentIds, setVisibleGeojsonCommentIds] = useState<Set<string>>(new Set())
	const [attachedGeojson, setAttachedGeojson] = useState<FeatureCollection | null>(null)
	const [visibleReferenceAddrs, setVisibleReferenceAddrs] = useState<Set<string>>(new Set())

	// Form state
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const features = useEditorStore((state) => state.features)
	const geoEditDrafts = useEditorStore((state) => state.geoEditDrafts)
	const activeGeoEditDraftId = useEditorStore((state) => state.activeGeoEditDraftId)
	const createGeoEditDraft = useEditorStore((state) => state.createGeoEditDraft)
	const saveGeoEditDraft = useEditorStore((state) => state.saveGeoEditDraft)
	const loadGeoEditDraft = useEditorStore((state) => state.loadGeoEditDraft)
	const deleteGeoEditDraft = useEditorStore((state) => state.deleteGeoEditDraft)
	const activeContextScopeCoordinate = useEditorStore((state) => state.activeContextScopeCoordinate)

	const selectedFeatures = useMemo(() => {
		if (selectedFeatureIds.length === 0) return []
		return features.filter((f) => selectedFeatureIds.includes(f.id))
	}, [features, selectedFeatureIds])

	const canAttachGeometry = selectedFeatures.length > 0 && !attachedGeojson

	// Initialize form state directly from collection to avoid timing issues
	const initialName = initialCollection?.metadata.name || ''
	const initialDescription = initialCollection?.metadata.description || ''
	const draftSourceId = initialCollection?.id ?? initialCollection?.dTag ?? '__new__'

	const [name, setName] = useState(initialName)
	const [description, setDescription] = useState(initialDescription)
	const [selectedContextRefs, setSelectedContextRefs] = useState<string[]>(
		initialCollection?.contextReferences ?? [],
	)
	const [isSaving, setIsSaving] = useState(false)
	const [lastAutoSavedAt, setLastAutoSavedAt] = useState<number | null>(null)

	useEffect(() => {
		const nextContextRefs = initialCollection?.contextReferences ?? []
		setSelectedContextRefs((prev) => {
			if (
				prev.length === nextContextRefs.length &&
				prev.every((value, index) => value === nextContextRefs[index])
			) {
				return prev
			}
			return nextContextRefs
		})
	}, [initialCollection])

	const draftsForSource = useMemo(
		() =>
			Object.values(geoEditDrafts)
				.filter((draft) => draft.sourceId === draftSourceId)
				.sort((a, b) => b.updatedAt - a.updatedAt),
		[geoEditDrafts, draftSourceId],
	)

	const activeDraft = useMemo(
		() => (activeGeoEditDraftId ? (geoEditDrafts[activeGeoEditDraftId] ?? null) : null),
		[activeGeoEditDraftId, geoEditDrafts],
	)

	const getDraftLabel = useCallback((draft: GeoCollectionEditDraft, index: number) => {
		const title = draft.name.trim() || `Untitled draft ${index + 1}`
		const shortId = draft.id.slice(0, 8)
		return `${title} (${shortId})`
	}, [])

	const applyDraft = useCallback(
		(draftId: string) => {
			const draft = useEditorStore.getState().geoEditDrafts[draftId]
			if (!draft) return
			loadGeoEditDraft(draftId)
			setName(draft.name)
			setDescription(draft.description)
			setLastAutoSavedAt(draft.updatedAt)
			editorRef.current?.setContent(draft.description)
		},
		[loadGeoEditDraft],
	)

	// Initialize or restore the most recent draft for the selected collection source.
	useEffect(() => {
		const store = useEditorStore.getState()
		const existingDrafts = Object.values(store.geoEditDrafts)
			.filter((draft) => draft.sourceId === draftSourceId)
			.sort((a, b) => b.updatedAt - a.updatedAt)

		if (existingDrafts.length > 0) {
			const preferredDraft =
				existingDrafts.find((draft) => draft.id === store.activeGeoEditDraftId) ?? existingDrafts[0]
			if (!preferredDraft) return
			applyDraft(preferredDraft.id)
			return
		}

		const createdDraftId = createGeoEditDraft(draftSourceId, {
			name: initialName,
			description: initialDescription,
			features: store.features,
			selectedFeatureIds: store.selectedFeatureIds,
		})
		applyDraft(createdDraftId)
	}, [draftSourceId, initialName, initialDescription, createGeoEditDraft, applyDraft])

	// Autosave panel text + geometry state to local drafts.
	useEffect(() => {
		if (!activeDraft || activeDraft.sourceId !== draftSourceId) return
		const timer = window.setTimeout(() => {
			saveGeoEditDraft(activeDraft.id, {
				sourceId: draftSourceId,
				name,
				description,
				features,
				selectedFeatureIds,
			})
			setLastAutoSavedAt(Date.now())
		}, 350)

		return () => window.clearTimeout(timer)
	}, [
		activeDraft,
		draftSourceId,
		name,
		description,
		features,
		selectedFeatureIds,
		saveGeoEditDraft,
	])

	const handleDraftChange = useCallback(
		(draftId: string) => {
			applyDraft(draftId)
		},
		[applyDraft],
	)

	const handleCreateDraft = useCallback(() => {
		const createdDraftId = createGeoEditDraft(draftSourceId, {
			name,
			description,
			features,
			selectedFeatureIds,
		})
		applyDraft(createdDraftId)
	}, [
		createGeoEditDraft,
		draftSourceId,
		name,
		description,
		features,
		selectedFeatureIds,
		applyDraft,
	])

	const handleDeleteDraft = useCallback(() => {
		if (!activeDraft) return
		deleteGeoEditDraft(activeDraft.id)
		const store = useEditorStore.getState()
		const remainingDrafts = Object.values(store.geoEditDrafts)
			.filter((draft) => draft.sourceId === draftSourceId)
			.sort((a, b) => b.updatedAt - a.updatedAt)

		if (remainingDrafts.length > 0) {
			const nextDraft = remainingDrafts[0]
			if (!nextDraft) return
			applyDraft(nextDraft.id)
			return
		}

		const createdDraftId = createGeoEditDraft(draftSourceId, {
			name: initialName,
			description: initialDescription,
			features: store.features,
			selectedFeatureIds: store.selectedFeatureIds,
		})
		applyDraft(createdDraftId)
	}, [
		activeDraft,
		deleteGeoEditDraft,
		draftSourceId,
		applyDraft,
		createGeoEditDraft,
		initialName,
		initialDescription,
	])

	// Extract references from description
	const referencedAddresses = useMemo(() => {
		const refs = new Set<string>()
		const pattern = /nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?/g
		let match = pattern.exec(description)
		while (match !== null) {
			if (match[1]) {
				refs.add(match[1])
			}
			match = pattern.exec(description)
		}
		return Array.from(refs)
	}, [description])

	const handleSave = async () => {
		if (!ndk || !currentUser) return
		setIsSaving(true)

		try {
			const event = initialCollection
				? NDKGeoCollectionEvent.from(initialCollection)
				: new NDKGeoCollectionEvent(ndk)

			// Update metadata
			event.metadata = {
				...event.metadata,
				name,
				description,
				ownerPk: currentUser.pubkey,
			}

			// Update references
			// We only use references explicitly found in the description for now
			// as per the "textual way" requirement.
			// Format for 'a' tag: "kind:pubkey:d-tag"
			const aTags: string[] = []

			for (const addr of referencedAddresses) {
				try {
					const decoded = nip19.decode(addr)
					if (decoded.type === 'naddr') {
						const { kind, pubkey, identifier } = decoded.data
						aTags.push(`${kind}:${pubkey}:${identifier}`)
					}
				} catch (_e) {
					console.warn('Invalid naddr in description:', addr)
				}
			}

			event.datasetReferences = aTags
			event.contextReferences = selectedContextRefs

			await event.publishNew()
			onSave(event)
			onClose()
		} catch (error) {
			console.error('Failed to save collection:', error)
		} finally {
			setIsSaving(false)
		}
	}

	const handleDescriptionChange = useCallback((text: string) => {
		setDescription(text)
	}, [])

	const resolvedReferences = useMemo(() => {
		return referencedAddresses.map((addr) => {
			const feature = availableFeatures.find((f) => f.address === addr)
			return {
				address: addr,
				name: feature?.datasetName || feature?.name || 'Unknown Dataset',
			}
		})
	}, [referencedAddresses, availableFeatures])
	const attachableContexts = useMemo(
		() =>
			mapContextEvents
				.map((context) => {
					const coordinate = context.contextCoordinate
					if (!coordinate) return null
					return {
						coordinate,
						name: context.context.name || context.contextId || context.id || 'Untitled context',
						validationMode: context.context.validationMode,
					}
				})
				.filter(
					(
						entry,
					): entry is {
						coordinate: string
						name: string
						validationMode: MapContextValidationMode
					} => entry !== null,
				),
		[mapContextEvents],
	)

	const scopeAwareAttachableContexts = useMemo(() => {
		if (!activeContextScopeCoordinate) return attachableContexts
		return attachableContexts.filter(
			(context) =>
				context.coordinate === activeContextScopeCoordinate ||
				selectedContextRefs.includes(context.coordinate),
		)
	}, [activeContextScopeCoordinate, attachableContexts, selectedContextRefs])

	// Auto-attach scope context for new collections only.
	useEffect(() => {
		if (initialCollection) return
		if (!activeContextScopeCoordinate) return
		if (selectedContextRefs.includes(activeContextScopeCoordinate)) return
		setSelectedContextRefs((prev) => Array.from(new Set([...prev, activeContextScopeCoordinate])))
	}, [initialCollection, activeContextScopeCoordinate, selectedContextRefs])

	const selectedDraftId =
		activeDraft && activeDraft.sourceId === draftSourceId ? activeDraft.id : draftsForSource[0]?.id

	// Comment handlers
	const handleAttachGeometry = useCallback(() => {
		if (selectedFeatures.length === 0) return
		const collection: FeatureCollection = {
			type: 'FeatureCollection',
			features: selectedFeatures.map((f) => ({
				type: 'Feature' as const,
				id: f.id,
				geometry: f.geometry,
				properties: f.properties ?? {},
			})),
		}
		setAttachedGeojson(collection)
	}, [selectedFeatures])

	const handleClearAttachment = useCallback(() => {
		setAttachedGeojson(null)
	}, [])

	const handleCommentGeojsonVisibilityChange = useCallback(
		(comment: NDKGeoCommentEvent, visible: boolean) => {
			const id = comment.commentId ?? comment.id ?? ''
			setVisibleGeojsonCommentIds((prev) => {
				const next = new Set(prev)
				if (visible) {
					next.add(id)
				} else {
					next.delete(id)
				}
				return next
			})
			if (onCommentGeometryVisibility) {
				onCommentGeometryVisibility(comment, visible)
			}
		},
		[onCommentGeometryVisibility],
	)

	const handleZoomToCommentGeojson = useCallback(
		(comment: NDKGeoCommentEvent) => {
			const commentGeojson = comment.geojson
			if (comment.boundingBox && onZoomToBounds) {
				onZoomToBounds(comment.boundingBox)
			} else if (commentGeojson && onZoomToBounds) {
				import('@turf/turf')
					.then((turf) => {
						const bbox = turf.bbox(commentGeojson) as [number, number, number, number]
						if (bbox.every((v) => Number.isFinite(v))) {
							onZoomToBounds(bbox)
						}
					})
					.catch(() => {})
			}
		},
		[onZoomToBounds],
	)

	return (
		<div className={cn('flex flex-col h-full overflow-hidden', className)}>
			{/* Header */}
			<div className="flex items-center px-4 py-3 border-b border-gray-100">
				<h2 className="text-base font-semibold text-gray-900">
					{initialCollection ? 'Edit Collection' : 'New Collection'}
				</h2>
			</div>

			<div className="flex-1 overflow-y-auto">
				<div className="p-4 space-y-4">
						<div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
							<div className="flex items-center justify-between">
								<Label className="text-xs font-medium text-emerald-900">Local Drafts</Label>
								<span className="text-[11px] text-emerald-800">
									{lastAutoSavedAt
										? `Auto-saved ${new Date(lastAutoSavedAt).toLocaleTimeString()}`
										: 'Auto-save on'}
								</span>
							</div>
							<div className="flex items-center gap-2">
								<Select value={selectedDraftId} onValueChange={handleDraftChange}>
									<SelectTrigger className="w-full bg-white">
										<SelectValue placeholder="Select draft" />
									</SelectTrigger>
									<SelectContent>
										{draftsForSource.map((draft, index) => (
											<SelectItem key={draft.id} value={draft.id}>
												{getDraftLabel(draft, index)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									type="button"
									size="icon-sm"
									variant="outline"
									onClick={handleCreateDraft}
									title="Create new draft"
								>
									<Plus className="h-3.5 w-3.5" />
								</Button>
								<Button
									type="button"
									size="icon-sm"
									variant="outline"
									onClick={handleDeleteDraft}
									disabled={draftsForSource.length <= 1}
									title="Delete current draft"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							</div>
							<div className="text-[11px] text-emerald-800">
								{draftsForSource.length} draft{draftsForSource.length === 1 ? '' : 's'} for this
								collection
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="collection-name">Name</Label>
							<Input
								id="collection-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="My Awesome Collection"
							/>
						</div>

						<div className="space-y-2">
							<Label>Description</Label>
							<div className="text-xs text-gray-500 mb-1">
								Describe your collection. Mention datasets using $ or drag them here.
							</div>
							<GeoRichTextEditor
								key={initialCollection?.id ?? initialCollection?.dTag ?? 'new'}
								ref={editorRef}
								initialValue={description}
								onChange={handleDescriptionChange}
								placeholder="This collection contains..."
								availableFeatures={availableFeatures}
								onMentionVisibilityToggle={onMentionVisibilityToggle}
								onMentionZoomTo={onMentionZoomTo}
								className="min-h-[150px]"
								rows={6}
							/>
						</div>

						{referencedAddresses.length > 0 && (
							<div className="space-y-2">
								<Label>Referenced Datasets ({referencedAddresses.length})</Label>
								<div className="bg-gray-50 rounded-md p-2 space-y-1">
									{resolvedReferences.map((ref) => {
										const isVisible = visibleReferenceAddrs.has(ref.address)
										return (
											<div
												key={ref.address}
												className="flex items-center gap-2 text-sm text-gray-700 bg-white border border-gray-200 rounded px-2 py-1"
											>
												<MapPin className="h-3 w-3 text-gray-400 flex-shrink-0" />
												<span className="truncate flex-1">{ref.name}</span>
												<Button
													size="icon-sm"
													variant="ghost"
													onClick={() => {
														setVisibleReferenceAddrs((prev) => {
															const next = new Set(prev)
															if (isVisible) {
																next.delete(ref.address)
															} else {
																next.add(ref.address)
															}
															return next
														})
														onMentionVisibilityToggle?.(ref.address, undefined, !isVisible)
													}}
													title={isVisible ? 'Hide on map' : 'Show on map'}
												>
													{isVisible ? (
														<Eye className="h-3 w-3 text-blue-600" />
													) : (
														<EyeOff className="h-3 w-3 text-gray-400" />
													)}
												</Button>
												<Button
													size="icon-sm"
													variant="ghost"
													onClick={() => onMentionZoomTo?.(ref.address, undefined)}
													title="Zoom to dataset"
												>
													<Maximize2 className="h-3 w-3" />
												</Button>
											</div>
										)
									})}
								</div>
							</div>
						)}

						<div className="space-y-2">
							<Label>References in context ({selectedContextRefs.length})</Label>
							<div className="text-xs text-gray-500">
								Collections attach as references (reference lane) in context view.
							</div>
							{scopeAwareAttachableContexts.length === 0 ? (
								<p className="text-xs text-gray-500">No map contexts available yet.</p>
							) : (
								<div className="space-y-1">
									{scopeAwareAttachableContexts.map((context) => (
										<label
											key={context.coordinate}
											className="flex items-center justify-between gap-2 rounded border border-gray-100 px-2 py-1"
										>
											<span className="truncate text-xs text-gray-700">{context.name}</span>
											<div className="flex items-center gap-2 shrink-0">
												<span className="text-[10px] text-gray-500">{context.validationMode}</span>
												<input
													type="checkbox"
													checked={selectedContextRefs.includes(context.coordinate)}
													onChange={(event) => {
														setSelectedContextRefs((prev) => {
															if (event.target.checked) {
																return Array.from(new Set([...prev, context.coordinate]))
															}
															return prev.filter((value) => value !== context.coordinate)
														})
													}}
												/>
											</div>
										</label>
									))}
								</div>
							)}
						</div>

						{initialCollection && (
							<section className="space-y-3 border-t border-gray-100 pt-4">
								<div className="flex items-center justify-between gap-3">
									<div className="flex items-center gap-2">
										<MessageCircle className="h-4 w-4 text-gray-400" />
										<h3 className="text-sm font-semibold text-gray-900">Comments</h3>
									</div>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant={attachedGeojson ? 'default' : 'outline'}
												size="sm"
												onClick={attachedGeojson ? handleClearAttachment : handleAttachGeometry}
												disabled={!canAttachGeometry && !attachedGeojson}
												className="gap-1.5"
											>
												<MapPin className="h-3.5 w-3.5" />
												{attachedGeojson
													? `${attachedGeojson.features.length} attached`
													: selectedFeatures.length > 0
														? `Attach ${selectedFeatures.length}`
														: 'Select geometry'}
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											{attachedGeojson
												? 'Click to clear attached geometry'
												: 'Select geometries on the map, then click to attach to your comment'}
										</TooltipContent>
									</Tooltip>
								</div>

								<CommentsPanel
									key={initialCollection.id ?? initialCollection.dTag ?? 'no-target'}
									target={initialCollection}
									onCommentGeojsonVisibilityChange={handleCommentGeojsonVisibilityChange}
									onZoomToCommentGeojson={handleZoomToCommentGeojson}
									visibleGeojsonCommentIds={visibleGeojsonCommentIds}
									attachedGeojson={attachedGeojson}
									onClearAttachment={handleClearAttachment}
									availableFeatures={availableFeatures}
									onMentionVisibilityToggle={onMentionVisibilityToggle}
									onMentionZoomTo={onMentionZoomTo}
									focusCommentId={focusCommentId}
								/>
							</section>
						)}
					</div>
			</div>

			<div className="p-4 border-t border-gray-100 flex justify-end gap-2">
				<Button variant="ghost" onClick={onClose} disabled={isSaving}>
					Cancel
				</Button>
				<Button
					onClick={handleSave}
					disabled={isSaving || !name.trim()}
					className="bg-emerald-600 hover:bg-emerald-700"
				>
					{isSaving ? 'Saving...' : 'Save Collection'}
				</Button>
			</div>
		</div>
	)
}
