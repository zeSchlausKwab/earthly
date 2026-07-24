import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
} from 'react'
import type maplibregl from 'maplibre-gl'

const MAGNIFIER_SIZE = 140
const MAGNIFIER_OFFSET = { x: 80, y: -80 }
const POINTER_OFFSET = { x: 0, y: -48 }

export { MAGNIFIER_SIZE }

export function useMagnifier(mapRef: React.RefObject<maplibregl.Map | null>) {
	const [magnifierEnabled, setMagnifierEnabled] = useState(false)
	const [magnifierVisible, setMagnifierVisible] = useState(false)
	const [magnifierPosition, setMagnifierPosition] = useState({ x: 0, y: 0 })
	const [magnifierCenter, setMagnifierCenter] = useState<[number, number] | null>(null)
	const [magnifierZoomOffset, setMagnifierZoomOffset] = useState(1)
	const [magnifierMenuOpen, setMagnifierMenuOpen] = useState(false)
	const magnifierLongPressTimerRef = useRef<number | null>(null)
	const magnifierLongPressTriggeredRef = useRef(false)
	const magnifierButtonRef = useRef<HTMLButtonElement>(null)
	const magnifierMenuRef = useRef<HTMLDivElement>(null)

	const toggleMagnifier = useCallback(() => {
		const next = !magnifierEnabled
		setMagnifierEnabled(next)
		if (!next) setMagnifierVisible(false)
	}, [magnifierEnabled])

	const clearMagnifierLongPress = useCallback(() => {
		if (magnifierLongPressTimerRef.current) {
			window.clearTimeout(magnifierLongPressTimerRef.current)
			magnifierLongPressTimerRef.current = null
		}
	}, [])

	const handleMagnifierPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			if (event.pointerType === 'mouse' && event.button !== 0) return
			event.preventDefault()
			magnifierLongPressTriggeredRef.current = false
			clearMagnifierLongPress()
			magnifierLongPressTimerRef.current = window.setTimeout(() => {
				magnifierLongPressTriggeredRef.current = true
				setMagnifierMenuOpen(true)
			}, 550)
		},
		[clearMagnifierLongPress],
	)

	const handleMagnifierPointerUp = useCallback(() => {
		const didLongPress = magnifierLongPressTriggeredRef.current
		clearMagnifierLongPress()
		if (!didLongPress) {
			toggleMagnifier()
		}
	}, [clearMagnifierLongPress, toggleMagnifier])

	// Close menu on outside click
	useEffect(() => {
		if (!magnifierMenuOpen) return
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node
			if (magnifierMenuRef.current?.contains(target)) return
			if (magnifierButtonRef.current?.contains(target)) return
			setMagnifierMenuOpen(false)
		}
		document.addEventListener('pointerdown', handlePointerDown)
		return () => document.removeEventListener('pointerdown', handlePointerDown)
	}, [magnifierMenuOpen])

	// Magnifier update on touch
	useEffect(() => {
		if (!mapRef.current) return
		const mapInstance = mapRef.current

		const updateMagnifier = (event: maplibregl.MapTouchEvent) => {
			if (!magnifierEnabled) return
			const point = event.point
			const container = mapInstance.getContainer()
			const width = container.clientWidth
			const height = container.clientHeight
			const posX = Math.min(
				Math.max(point.x + MAGNIFIER_OFFSET.x, MAGNIFIER_SIZE / 2),
				width - MAGNIFIER_SIZE / 2,
			)
			const posY = Math.min(
				Math.max(point.y + MAGNIFIER_OFFSET.y, MAGNIFIER_SIZE / 2),
				height - MAGNIFIER_SIZE / 2,
			)
			const targetX = Math.min(Math.max(point.x + POINTER_OFFSET.x, 0), width)
			const targetY = Math.min(Math.max(point.y + POINTER_OFFSET.y, 0), height)
			const lngLat = mapInstance.unproject([targetX, targetY])

			setMagnifierPosition({ x: posX, y: posY })
			setMagnifierCenter([lngLat.lng, lngLat.lat])
			setMagnifierVisible(true)
		}

		const handleTouchStart = (e: maplibregl.MapTouchEvent) => updateMagnifier(e)
		const handleTouchMove = (e: maplibregl.MapTouchEvent) => updateMagnifier(e)
		const handleTouchEnd = () => setMagnifierVisible(false)

		mapInstance.on('touchstart', handleTouchStart)
		mapInstance.on('touchmove', handleTouchMove)
		mapInstance.on('touchend', handleTouchEnd)

		return () => {
			mapInstance.off('touchstart', handleTouchStart)
			mapInstance.off('touchmove', handleTouchMove)
			mapInstance.off('touchend', handleTouchEnd)
		}
	}, [magnifierEnabled, mapRef])

	return {
		magnifierEnabled,
		setMagnifierEnabled,
		magnifierVisible,
		magnifierPosition,
		magnifierCenter,
		magnifierZoomOffset,
		setMagnifierZoomOffset,
		magnifierMenuOpen,
		setMagnifierMenuOpen,
		magnifierButtonRef,
		magnifierMenuRef,
		toggleMagnifier,
		handleMagnifierPointerDown,
		handleMagnifierPointerUp,
		clearMagnifierLongPress,
	}
}
