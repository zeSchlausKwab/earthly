import type { Position } from 'geojson'
import type { Map, MapMouseEvent, Point } from 'maplibre-gl'
import type { EditorFeature, PrimitiveShape } from '../types'
import { generateId } from '../utils/geometry'
import { DrawMode } from './DrawMode'

const CIRCLE_VERTEX_COUNT = 48
const MINIMUM_SIZE_PX = 4

type ScreenPoint = Pick<Point, 'x' | 'y'>

function position(point: { lng: number; lat: number }): Position {
	return [point.lng, point.lat]
}

function closeRing(points: Position[]): Position[] {
	const first = points[0]
	return first ? [...points, first] : points
}

function radialRing(
	map: Map,
	center: ScreenPoint,
	radius: number,
	vertexCount: number,
	startAngle: number,
): Position[] {
	return closeRing(
		Array.from({ length: vertexCount }, (_, index) => {
			const angle = startAngle + (index / vertexCount) * Math.PI * 2
			return position(
				map.unproject([center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius]),
			)
		}),
	)
}

export class DrawPrimitiveMode extends DrawMode {
	readonly type = 'Polygon' as const
	private shape: PrimitiveShape = 'rectangle'

	setShape(shape: PrimitiveShape): void {
		this.shape = shape
		this.reset()
	}

	getShape(): PrimitiveShape {
		return this.shape
	}

	onClick(event: MapMouseEvent): EditorFeature | null {
		const pointer: Position = [event.lngLat.lng, event.lngLat.lat]
		const anchor = this.coordinates[0]
		if (!anchor) {
			this.coordinates = [pointer]
			this.currentFeature = undefined
			return null
		}

		const feature = this.createFeature(anchor, pointer, 'feature')
		if (!feature) return null
		this.reset()
		return feature
	}

	onMove(event: MapMouseEvent): void {
		const anchor = this.coordinates[0]
		if (!anchor) return
		const pointer: Position = [event.lngLat.lng, event.lngLat.lat]
		this.coordinates = [anchor, pointer]
		this.currentFeature = this.createFeature(anchor, pointer, 'feature-temp') ?? undefined
	}

	onKeyDown(event: KeyboardEvent): EditorFeature | null {
		if (event.key === 'Escape') {
			this.reset()
			return null
		}
		if (event.key !== 'Enter' || !this.currentFeature) return null

		const feature: EditorFeature = {
			...this.currentFeature,
			properties: {
				...this.currentFeature.properties,
				meta: 'feature',
			},
		}
		this.reset()
		return feature
	}

	private createFeature(
		anchor: Position,
		pointer: Position,
		meta: 'feature' | 'feature-temp',
	): EditorFeature | null {
		if (!this.map) return null
		const anchorPoint = this.map.project(anchor as [number, number])
		const pointerPoint = this.map.project(pointer as [number, number])
		const dx = pointerPoint.x - anchorPoint.x
		const dy = pointerPoint.y - anchorPoint.y
		const radius = Math.hypot(dx, dy)
		if (radius < MINIMUM_SIZE_PX) return null

		let ring: Position[]
		if (this.shape === 'rectangle' || this.shape === 'square') {
			let endX = pointerPoint.x
			let endY = pointerPoint.y
			if (this.shape === 'square') {
				const size = Math.max(Math.abs(dx), Math.abs(dy))
				endX = anchorPoint.x + Math.sign(dx || 1) * size
				endY = anchorPoint.y + Math.sign(dy || 1) * size
			}
			ring = closeRing([
				position(this.map.unproject([anchorPoint.x, anchorPoint.y])),
				position(this.map.unproject([endX, anchorPoint.y])),
				position(this.map.unproject([endX, endY])),
				position(this.map.unproject([anchorPoint.x, endY])),
			])
		} else {
			const direction = Math.atan2(dy, dx)
			const vertexCount =
				this.shape === 'circle' ? CIRCLE_VERTEX_COUNT : this.shape === 'triangle' ? 3 : 4
			const startAngle = this.shape === 'circle' ? 0 : direction
			ring = radialRing(this.map, anchorPoint, radius, vertexCount, startAngle)
		}

		return {
			type: 'Feature',
			id: this.currentFeature?.id ?? generateId(),
			geometry: { type: 'Polygon', coordinates: [ring] },
			properties: {
				meta,
				primitiveShape: this.shape,
				fillColor: '#1d4ed8',
				fillOpacity: 0.15,
				strokeColor: '#1d4ed8',
				strokeWidth: 2,
			},
		}
	}
}
