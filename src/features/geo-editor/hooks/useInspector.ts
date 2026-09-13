import { useCallback, useEffect, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import { earthlyGeoServer, type ReverseLookupOutput } from '@/ctxcn'
import { useEditorStore } from '../store'

type ReverseLookupResult = ReverseLookupOutput['result']

export type { ReverseLookupResult }

export function useInspector(mapRef: React.RefObject<maplibregl.Map | null>) {
	const [reverseLookupResult, setReverseLookupResult] = useState<ReverseLookupResult | null>(null)
	const [reverseLookupStatus, setReverseLookupStatus] = useState<'idle' | 'loading' | 'error'>(
		'idle',
	)
	const [reverseLookupError, setReverseLookupError] = useState<string | null>(null)
	const [inspectorClickPosition, setInspectorClickPosition] = useState<{
		x: number
		y: number
	} | null>(null)

	const editor = useEditorStore((state) => state.editor)
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const setInspectorActive = useEditorStore((state) => state.setInspectorActive)
	const setCurrentMode = useEditorStore((state) => state.setMode)

	// Inspector click handling
	useEffect(() => {
		if (!mapRef.current) return
		const mapInstance = mapRef.current

		const handleInspectorClick = async (event: maplibregl.MapMouseEvent & any) => {
			const { lng, lat } = event.lngLat
			setInspectorClickPosition({ x: event.point.x, y: event.point.y })
			setReverseLookupStatus('loading')
			setReverseLookupError(null)
			setReverseLookupResult(null)

			try {
				await new Promise((resolve) => setTimeout(resolve, 100))
				const response = await earthlyGeoServer.ReverseLookup(lat, lng)
				setReverseLookupResult(response.result)
			} catch (error) {
				const errorMessage =
					error instanceof Error && error.message === 'Not connected'
						? 'Cannot connect to geo server. Make sure the relay is running (bun relay).'
						: error instanceof Error
							? error.message
							: 'Reverse lookup failed'
				setReverseLookupError(errorMessage)
				setReverseLookupResult(null)
			} finally {
				setReverseLookupStatus('idle')
			}
		}

		if (inspectorActive) {
			mapInstance.getCanvas().style.cursor = 'crosshair'
			mapInstance.on('click', handleInspectorClick)
		}

		return () => {
			mapInstance.getCanvas().style.cursor = ''
			mapInstance.off('click', handleInspectorClick)
		}
	}, [inspectorActive, mapRef])

	const disableInspector = useCallback(() => {
		setInspectorActive(false)
		if (editor) {
			editor.setMode('select')
			setCurrentMode('select')
		}
	}, [editor, setCurrentMode, setInspectorActive])

	return {
		reverseLookupResult,
		setReverseLookupResult,
		reverseLookupStatus,
		reverseLookupError,
		setReverseLookupError,
		inspectorClickPosition,
		setInspectorClickPosition,
		disableInspector,
	}
}
