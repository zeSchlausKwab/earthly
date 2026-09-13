import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'

interface UserLocationMarkerProps {
	map: maplibregl.Map | null
	coordinates: { lat: number; lon: number } | null
	accuracy?: number
}

export function UserLocationMarker({ map, coordinates, accuracy }: UserLocationMarkerProps) {
	const markerRef = useRef<maplibregl.Marker | null>(null)
	const accuracyCircleRef = useRef<string | null>(null)

	useEffect(() => {
		if (!map || !coordinates) {
			// Clean up marker if coordinates become null
			if (markerRef.current) {
				markerRef.current.remove()
				markerRef.current = null
			}
			// Clean up accuracy circle
			if (accuracyCircleRef.current && map) {
				if (map.getLayer(accuracyCircleRef.current)) {
					map.removeLayer(accuracyCircleRef.current)
				}
				if (map.getSource(accuracyCircleRef.current)) {
					map.removeSource(accuracyCircleRef.current)
				}
				accuracyCircleRef.current = null
			}
			return
		}

		// Create or update the marker
		if (!markerRef.current) {
			// Create the pulsating dot element
			const el = document.createElement('div')
			el.className = 'user-location-marker'
			el.innerHTML = `
				<div class="user-location-pulse"></div>
				<div class="user-location-dot"></div>
			`

			// Add styles
			const style = document.createElement('style')
			style.textContent = `
				.user-location-marker {
					position: relative;
					width: 24px;
					height: 24px;
				}
				.user-location-dot {
					position: absolute;
					top: 50%;
					left: 50%;
					transform: translate(-50%, -50%);
					width: 14px;
					height: 14px;
					background: #3b82f6;
					border: 3px solid white;
					border-radius: 50%;
					box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
					z-index: 2;
				}
				.user-location-pulse {
					position: absolute;
					top: 50%;
					left: 50%;
					transform: translate(-50%, -50%);
					width: 24px;
					height: 24px;
					background: rgba(59, 130, 246, 0.4);
					border-radius: 50%;
					z-index: 1;
					animation: user-location-pulse 2s ease-out infinite;
				}
				@keyframes user-location-pulse {
					0% {
						transform: translate(-50%, -50%) scale(1);
						opacity: 1;
					}
					100% {
						transform: translate(-50%, -50%) scale(2.5);
						opacity: 0;
					}
				}
			`
			if (!document.querySelector('style[data-user-location]')) {
				style.setAttribute('data-user-location', 'true')
				document.head.appendChild(style)
			}

			markerRef.current = new maplibregl.Marker({
				element: el,
				anchor: 'center',
			})
				.setLngLat([coordinates.lon, coordinates.lat])
				.addTo(map)
		} else {
			// Update existing marker position
			markerRef.current.setLngLat([coordinates.lon, coordinates.lat])
		}

		// Update accuracy circle if provided
		if (accuracy && accuracy > 0) {
			const sourceId = 'user-location-accuracy'
			accuracyCircleRef.current = sourceId

			// Create a circle polygon for accuracy
			const circleFeature = createCirclePolygon([coordinates.lon, coordinates.lat], accuracy)

			if (map.getSource(sourceId)) {
				// Update existing source
				;(map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(circleFeature)
			} else {
				// Add new source and layer
				map.addSource(sourceId, {
					type: 'geojson',
					data: circleFeature,
				})
				map.addLayer(
					{
						id: sourceId,
						type: 'fill',
						source: sourceId,
						paint: {
							'fill-color': '#3b82f6',
							'fill-opacity': 0.15,
						},
					},
					// Add below the marker
					undefined,
				)
			}
		}

		return () => {
			// Cleanup on unmount
			if (markerRef.current) {
				markerRef.current.remove()
				markerRef.current = null
			}
			if (accuracyCircleRef.current && map) {
				try {
					if (map.getLayer(accuracyCircleRef.current)) {
						map.removeLayer(accuracyCircleRef.current)
					}
					if (map.getSource(accuracyCircleRef.current)) {
						map.removeSource(accuracyCircleRef.current)
					}
				} catch {
					// Map may have been removed
				}
				accuracyCircleRef.current = null
			}
		}
	}, [map, coordinates, accuracy])

	return null
}

// Helper to create a circle polygon from center and radius in meters
function createCirclePolygon(
	center: [number, number],
	radiusMeters: number,
	points = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
	const coords: [number, number][] = []
	const distanceX = radiusMeters / (111320 * Math.cos((center[1] * Math.PI) / 180))
	const distanceY = radiusMeters / 110540

	for (let i = 0; i < points; i++) {
		const theta = (i / points) * (2 * Math.PI)
		const x = distanceX * Math.cos(theta)
		const y = distanceY * Math.sin(theta)
		coords.push([center[0] + x, center[1] + y])
	}
	coords.push(coords[0]) // Close the ring

	return {
		type: 'Feature',
		properties: {},
		geometry: {
			type: 'Polygon',
			coordinates: [coords],
		},
	}
}
