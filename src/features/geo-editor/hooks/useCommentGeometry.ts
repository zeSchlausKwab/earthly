import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type maplibregl from 'maplibre-gl'
import type { NDKGeoCommentEvent } from '@/lib/ndk/NDKGeoCommentEvent'
import type { CommentAnnotationPopupData } from '../components/CommentAnnotationPopup'

interface CommentLayerEntry {
	sourceId: string
	layerIds: string[]
	cursorLayerIds: string[]
	comment: NDKGeoCommentEvent
	handleClick: (event: maplibregl.MapLayerMouseEvent) => void
	handleMouseMove: (event: maplibregl.MapLayerMouseEvent) => void
	handleMouseLeave: () => void
}

function getDefaultTextFontStack(
	style: maplibregl.StyleSpecification | undefined,
): string[] | null {
	const isStringArray = (value: unknown): value is string[] =>
		Array.isArray(value) && value.every((entry) => typeof entry === 'string')

	const extract = (value: unknown): string[] | null => {
		if (typeof value === 'string') return [value]
		if (isStringArray(value)) return value
		if (!Array.isArray(value) || value.length === 0) return null

		const [op, ...rest] = value
		if (op === 'literal' && rest.length > 0 && isStringArray(rest[0])) return rest[0]
		if (op === 'case') {
			for (const part of rest) {
				const extracted = extract(part)
				if (extracted) return extracted
			}
		}
		return null
	}

	try {
		const layers = style?.layers ?? []
		for (const layer of layers) {
			const layout = (layer as { layout?: Record<string, unknown> }).layout
			const textFont = layout?.['text-font']
			const extracted = extract(textFont)
			if (extracted) return extracted
		}
	} catch {
		return null
	}

	return null
}

function buildOverlayCollection(comment: NDKGeoCommentEvent): FeatureCollection {
	const collection = comment.geojson ?? { type: 'FeatureCollection', features: [] }
	return {
		type: 'FeatureCollection',
		features: collection.features.map((feature) => ({
			...feature,
			properties: {
				...(feature.properties ?? {}),
				commentId: comment.commentId ?? comment.id,
				commentText: comment.text,
				commentPubkey: comment.pubkey,
				commentCreatedAt: comment.created_at,
			},
		})),
	}
}

export function useCommentGeometry(
	mapRef: React.RefObject<maplibregl.Map | null>,
	mapReady = false,
) {
	const commentGeometryLayers = useRef<Map<string, CommentLayerEntry>>(new Map())
	const desiredVisibleComments = useRef<Map<string, NDKGeoCommentEvent>>(new Map())
	const [annotationPopupData, setAnnotationPopupData] = useState<CommentAnnotationPopupData | null>(
		null,
	)

	const removeCommentLayers = useCallback(
		(commentId: string) => {
			if (!mapRef.current) return
			const mapInstance = mapRef.current
			const existing = commentGeometryLayers.current.get(commentId)
			if (!existing) return

			existing.cursorLayerIds.forEach((layerId) => {
				try {
					mapInstance.off('click', layerId, existing.handleClick)
					mapInstance.off('mousemove', layerId, existing.handleMouseMove)
					mapInstance.off('mouseleave', layerId, existing.handleMouseLeave)
				} catch {
					// Layer may already be gone.
				}
			})

			for (const layerId of existing.layerIds) {
				if (mapInstance.getLayer(layerId)) {
					mapInstance.removeLayer(layerId)
				}
			}

			if (mapInstance.getSource(existing.sourceId)) {
				mapInstance.removeSource(existing.sourceId)
			}

			commentGeometryLayers.current.delete(commentId)

			setAnnotationPopupData((current) => {
				const currentId = current?.comment.commentId ?? current?.comment.id
				return currentId === commentId ? null : current
			})
		},
		[mapRef],
	)

	const showCommentLayers = useCallback(
		(comment: NDKGeoCommentEvent) => {
			if (!mapReady || !mapRef.current) return

			const commentId = comment.commentId ?? comment.id ?? ''
			if (!commentId) return
			if (!comment.geojson || comment.geojson.features.length === 0) return
			if (commentGeometryLayers.current.has(commentId)) return

			const mapInstance = mapRef.current
			if (!mapInstance.isStyleLoaded()) return
			const sourceId = `comment-geo-${commentId}`
			const fillLayerId = `comment-fill-${commentId}`
			const lineLayerId = `comment-line-${commentId}`
			const pointLayerId = `comment-point-${commentId}`
			const annotationAnchorLayerId = `comment-annotation-anchor-${commentId}`
			const annotationTextLayerId = `comment-annotation-text-${commentId}`
			const layerIds = [fillLayerId, lineLayerId, pointLayerId, annotationAnchorLayerId]
			const cursorLayerIds = [fillLayerId, lineLayerId, pointLayerId, annotationAnchorLayerId]
			const textFont = getDefaultTextFontStack(mapInstance.getStyle())
			const overlayCollection = buildOverlayCollection(comment)

			mapInstance.addSource(sourceId, {
				type: 'geojson',
				data: overlayCollection,
			})

			mapInstance.addLayer({
				id: fillLayerId,
				type: 'fill',
				source: sourceId,
				filter: [
					'any',
					['==', ['geometry-type'], 'Polygon'],
					['==', ['geometry-type'], 'MultiPolygon'],
				],
				paint: {
					'fill-color': '#fbbf24',
					'fill-opacity': 0.18,
				},
			})

			mapInstance.addLayer({
				id: lineLayerId,
				type: 'line',
				source: sourceId,
				filter: [
					'any',
					['==', ['geometry-type'], 'LineString'],
					['==', ['geometry-type'], 'MultiLineString'],
					['==', ['geometry-type'], 'Polygon'],
					['==', ['geometry-type'], 'MultiPolygon'],
				],
				paint: {
					'line-color': '#d97706',
					'line-width': 2,
					'line-dasharray': [2, 2],
				},
			})

			mapInstance.addLayer({
				id: pointLayerId,
				type: 'circle',
				source: sourceId,
				filter: [
					'all',
					['==', ['geometry-type'], 'Point'],
					['!=', ['get', 'featureType'], 'annotation'],
				],
				paint: {
					'circle-color': '#f59e0b',
					'circle-radius': 6,
					'circle-stroke-color': '#fff',
					'circle-stroke-width': 2,
				},
			})

			mapInstance.addLayer({
				id: annotationAnchorLayerId,
				type: 'circle',
				source: sourceId,
				filter: [
					'all',
					['==', ['geometry-type'], 'Point'],
					['==', ['get', 'featureType'], 'annotation'],
				],
				paint: {
					'circle-color': '#facc15',
					'circle-radius': 5,
					'circle-stroke-color': '#fff7ed',
					'circle-stroke-width': 2,
				},
			})

			if (textFont) {
				mapInstance.addLayer({
					id: annotationTextLayerId,
					type: 'symbol',
					source: sourceId,
					filter: [
						'all',
						['==', ['geometry-type'], 'Point'],
						['==', ['get', 'featureType'], 'annotation'],
					],
					layout: {
						'text-field': ['coalesce', ['get', 'text'], ['get', 'name'], 'Annotation'],
						'text-font': textFont,
						'text-size': ['coalesce', ['get', 'textFontSize'], 14],
						'text-anchor': 'top',
						'text-offset': [0, 0.8],
						'text-allow-overlap': true,
						'text-ignore-placement': true,
					},
					paint: {
						'text-color': ['coalesce', ['get', 'textColor'], '#92400e'],
						'text-halo-color': ['coalesce', ['get', 'textHaloColor'], '#fff8db'],
						'text-halo-width': ['coalesce', ['get', 'textHaloWidth'], 1.5],
					},
				})
				layerIds.push(annotationTextLayerId)
				cursorLayerIds.push(annotationTextLayerId)
			}

			const handleClick = (event: maplibregl.MapLayerMouseEvent) => {
				const feature = event.features?.[0]
				if (!feature) return
				setAnnotationPopupData({
					comment,
					feature: feature as unknown as CommentAnnotationPopupData['feature'],
					screenPosition: { x: event.point.x, y: event.point.y },
					pinned: true,
				})
			}

			const handleMouseMove = (event: maplibregl.MapLayerMouseEvent) => {
				const feature = event.features?.[0]
				mapInstance.getCanvas().style.cursor = 'pointer'
				if (!feature) return
				setAnnotationPopupData((current) => {
					if (current?.pinned && (current.comment.commentId ?? current.comment.id) === commentId) {
						return current
					}
					return {
						comment,
						feature: feature as unknown as CommentAnnotationPopupData['feature'],
						screenPosition: { x: event.point.x, y: event.point.y },
						pinned: false,
					}
				})
			}

			const handleMouseLeave = () => {
				mapInstance.getCanvas().style.cursor = ''
				setAnnotationPopupData((current) => {
					if (!current || current.pinned) return current
					const currentId = current.comment.commentId ?? current.comment.id
					return currentId === commentId ? null : current
				})
			}

			cursorLayerIds.forEach((layerId) => {
				mapInstance.on('click', layerId, handleClick)
				mapInstance.on('mousemove', layerId, handleMouseMove)
				mapInstance.on('mouseleave', layerId, handleMouseLeave)
			})

			commentGeometryLayers.current.set(commentId, {
				sourceId,
				layerIds,
				cursorLayerIds,
				comment,
				handleClick,
				handleMouseMove,
				handleMouseLeave,
			})
		},
		[mapReady, mapRef, removeCommentLayers],
	)

	const handleCommentGeometryVisibility = useCallback(
		(comment: NDKGeoCommentEvent, visible: boolean) => {
			const commentId = comment.commentId ?? comment.id ?? ''
			if (!commentId) return

			if (visible) {
				desiredVisibleComments.current.set(commentId, comment)
				if (!mapReady) return
				showCommentLayers(comment)
				return
			}

			desiredVisibleComments.current.delete(commentId)
			removeCommentLayers(commentId)
		},
		[mapReady, removeCommentLayers, showCommentLayers],
	)

	useEffect(() => {
		if (!mapReady || !mapRef.current) return

		for (const [commentId, comment] of desiredVisibleComments.current) {
			if (commentGeometryLayers.current.has(commentId)) continue
			showCommentLayers(comment)
		}
	}, [mapReady, mapRef, showCommentLayers])

	useEffect(() => {
		if (!mapReady) return
		const mapInstance = mapRef.current
		if (!mapInstance) return

		const replayVisibleComments = () => {
			commentGeometryLayers.current.clear()
			for (const comment of desiredVisibleComments.current.values()) {
				showCommentLayers(comment)
			}
		}

		mapInstance.on('style.load', replayVisibleComments)
		return () => {
			mapInstance.off('style.load', replayVisibleComments)
		}
	}, [mapReady, mapRef, showCommentLayers])

	return {
		commentGeometryLayers,
		annotationPopupData,
		setAnnotationPopupData,
		handleCommentGeometryVisibility,
	}
}
