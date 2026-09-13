import type { Geometry, Position } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { EditorFeature } from '../types'
import { isFinitePosition } from '../utils/coordinates'

interface Vertex {
	position: Position
	path: number[]
}

interface CoordinateSequence {
	coordinates: Position[]
	path: number[]
	isRing: boolean
}

/** Detach coordinate arrays even when an in-memory geometry reuses the same ring or position. */
function cloneFeature(feature: EditorFeature): EditorFeature {
	const clone = structuredClone(feature)
	const geometry = clone.geometry
	const copyPosition = (position: Position): Position => [...position]
	const copyLine = (line: Position[]): Position[] => line.map(copyPosition)
	const copyPolygon = (polygon: Position[][]): Position[][] => polygon.map(copyLine)
	switch (geometry.type) {
		case 'Point':
			geometry.coordinates = copyPosition(geometry.coordinates)
			break
		case 'MultiPoint':
		case 'LineString':
			geometry.coordinates = copyLine(geometry.coordinates)
			break
		case 'MultiLineString':
		case 'Polygon':
			geometry.coordinates = copyPolygon(geometry.coordinates)
			break
		case 'MultiPolygon':
			geometry.coordinates = geometry.coordinates.map(copyPolygon)
			break
	}
	return clone
}

/** Enumerate editable sequences without erasing their geometry-specific path prefixes. */
function coordinateSequences(geometry: Geometry): CoordinateSequence[] {
	switch (geometry.type) {
		case 'MultiPoint':
		case 'LineString':
			return [{ coordinates: geometry.coordinates, path: [], isRing: false }]
		case 'MultiLineString':
		case 'Polygon':
			return geometry.coordinates.map((coordinates, index) => ({
				coordinates,
				path: [index],
				isRing: geometry.type === 'Polygon',
			}))
		case 'MultiPolygon':
			return geometry.coordinates.flatMap((polygon, polygonIndex) =>
				polygon.map((coordinates, ringIndex) => ({
					coordinates,
					path: [polygonIndex, ringIndex],
					isRing: true,
				})),
			)
		default:
			return []
	}
}

function isClosedRing(coordinates: Position[]): boolean {
	const first = coordinates[0]
	const last = coordinates.at(-1)
	return (
		coordinates.length >= 4 &&
		isFinitePosition(first) &&
		isFinitePosition(last) &&
		first.length === last.length &&
		first.every((value, index) => value === last[index])
	)
}

/** Reject stale, truncated and fractional paths before an array write can create holes. */
function resolveVertex(
	geometry: Geometry,
	path: number[],
): { coordinates: Position[]; index: number; isRing: boolean } | undefined {
	if (!path.every((index) => Number.isInteger(index) && index >= 0)) return undefined
	const [first, second, third] = path
	let coordinates: Position[] | undefined
	let index: number | undefined
	let isRing = false
	switch (geometry.type) {
		case 'MultiPoint':
		case 'LineString':
			if (path.length !== 1) return undefined
			coordinates = geometry.coordinates
			index = first
			break
		case 'MultiLineString':
		case 'Polygon':
			if (path.length !== 2 || first === undefined) return undefined
			coordinates = geometry.coordinates[first]
			index = second
			isRing = geometry.type === 'Polygon'
			break
		case 'MultiPolygon':
			if (path.length !== 3 || first === undefined || second === undefined) return undefined
			coordinates = geometry.coordinates[first]?.[second]
			index = third
			isRing = true
			break
		default:
			return undefined
	}
	if (!coordinates || index === undefined || !isFinitePosition(coordinates[index])) return undefined
	return { coordinates, index, isRing }
}

export interface EditState {
	feature?: EditorFeature
	draggingVertex?: {
		featureId: string
		coordinatePath: number[]
		startPosition: Position
	}
	draggingFeature?: {
		featureId: string
		startLngLat: Position
		startGeometry: Geometry
	}
	hoveredVertex?: {
		featureId: string
		coordinatePath: number[]
	}
	selectedVertex?: {
		featureId: string
		coordinatePath: number[]
	}
}

export class EditMode {
	private state: EditState = {}

	onAdd(_map: MapLibreMap): void {}

	onRemove(): void {
		this.reset()
	}

	reset(): void {
		this.state = {}
	}

	getState(): EditState {
		return this.state
	}

	setDraggingVertex(featureId: string, coordinatePath: number[], position: Position): void {
		this.state.draggingVertex = {
			featureId,
			coordinatePath,
			startPosition: position,
		}
	}

	setDraggingFeature(featureId: string, startLngLat: Position, startGeometry: Geometry): void {
		this.state.draggingFeature = {
			featureId,
			startLngLat,
			startGeometry,
		}
	}

	setHoveredVertex(featureId: string, coordinatePath: number[]): void {
		this.state.hoveredVertex = {
			featureId,
			coordinatePath,
		}
	}

	clearDragging(): void {
		this.state.draggingVertex = undefined
		this.state.draggingFeature = undefined
	}

	clearHovered(): void {
		this.state.hoveredVertex = undefined
	}

	setSelectedVertex(featureId: string, coordinatePath: number[]): void {
		this.state.selectedVertex = {
			featureId,
			coordinatePath,
		}
	}

	clearSelectedVertex(): void {
		this.state.selectedVertex = undefined
	}

	getSelectedVertex(): EditState['selectedVertex'] {
		return this.state.selectedVertex
	}

	isDragging(): boolean {
		return !!(this.state.draggingVertex || this.state.draggingFeature)
	}

	// Polygon closing coordinates share a handle with the first vertex only when closed.
	extractVerticesWithPaths(feature: EditorFeature): Vertex[] {
		const { geometry } = feature
		if (geometry.type === 'Point') {
			return isFinitePosition(geometry.coordinates)
				? [{ position: geometry.coordinates, path: [] }]
				: []
		}

		const vertices: Vertex[] = []
		for (const { coordinates, path, isRing } of coordinateSequences(geometry)) {
			const closed = isRing && isClosedRing(coordinates)
			coordinates.forEach((position, index) => {
				if (isFinitePosition(position) && (!closed || index < coordinates.length - 1)) {
					vertices.push({ position, path: [...path, index] })
				}
			})
		}
		return vertices
	}

	extractMidpoints(feature: EditorFeature): Vertex[] {
		if (feature.geometry.type === 'MultiPoint') return []

		const midpoints: Vertex[] = []
		for (const { coordinates, path } of coordinateSequences(feature.geometry)) {
			for (let index = 1; index < coordinates.length; index++) {
				const before = coordinates[index - 1]
				const after = coordinates[index]
				if (!isFinitePosition(before) || !isFinitePosition(after)) continue
				midpoints.push({
					position: [before[0] / 2 + after[0] / 2, before[1] / 2 + after[1] / 2],
					path: [...path, index - 1, index],
				})
			}
		}
		return midpoints
	}

	updateVertexPosition(
		feature: EditorFeature,
		path: number[],
		newPosition: Position,
	): EditorFeature {
		if (!isFinitePosition(newPosition)) return feature
		const updatedFeature = cloneFeature(feature)
		const { geometry } = updatedFeature
		if (geometry.type === 'Point') {
			if (path.length !== 0 || !isFinitePosition(geometry.coordinates)) return feature
			geometry.coordinates = [...newPosition]
			return updatedFeature
		}

		const vertex = resolveVertex(geometry, path)
		if (!vertex) return feature
		const { coordinates, index, isRing } = vertex
		const closed = isRing && isClosedRing(coordinates)
		coordinates[index] = [...newPosition]
		if (closed && (index === 0 || index === coordinates.length - 1)) {
			coordinates[0] = [...newPosition]
			coordinates[coordinates.length - 1] = [...newPosition]
		}
		return updatedFeature
	}

	// Midpoint paths end in two adjacent, existing vertex indices.
	insertVertex(feature: EditorFeature, path: number[], position: Position): EditorFeature {
		if (!isFinitePosition(position) || feature.geometry.type === 'MultiPoint') return feature
		const updatedFeature = cloneFeature(feature)
		const vertex = resolveVertex(updatedFeature.geometry, path.slice(0, -1))
		const afterIndex = path.at(-1)
		if (
			!vertex ||
			afterIndex !== vertex.index + 1 ||
			!isFinitePosition(vertex.coordinates[afterIndex])
		) {
			return feature
		}
		vertex.coordinates.splice(afterIndex, 0, [...position])
		return updatedFeature
	}

	// null means the removal would leave too few vertices; invalid paths are no-ops.
	removeVertex(feature: EditorFeature, path: number[]): EditorFeature | null {
		if (feature.geometry.type === 'Point') {
			return path.length === 0 && isFinitePosition(feature.geometry.coordinates) ? null : feature
		}
		const updatedFeature = cloneFeature(feature)
		const vertex = resolveVertex(updatedFeature.geometry, path)
		if (!vertex) return feature
		const { coordinates, index, isRing } = vertex
		if (!coordinates.every(isFinitePosition)) return feature
		if (isRing) {
			if (!isClosedRing(coordinates)) return feature
			if (coordinates.length <= 4) return null
			// A path to the duplicate closing coordinate refers to the first vertex.
			coordinates.splice(index === coordinates.length - 1 ? 0 : index, 1)
			const first = coordinates[0]
			if (!isFinitePosition(first)) return feature
			coordinates[coordinates.length - 1] = [...first]
		} else {
			const minimum = feature.geometry.type === 'MultiPoint' ? 1 : 2
			if (coordinates.length <= minimum) return null
			coordinates.splice(index, 1)
		}
		return updatedFeature
	}

	translateFeature(
		feature: EditorFeature,
		fromLngLat: Position,
		toLngLat: Position,
	): EditorFeature {
		if (!isFinitePosition(fromLngLat) || !isFinitePosition(toLngLat)) return feature
		const deltaLng = toLngLat[0] - fromLngLat[0]
		const deltaLat = toLngLat[1] - fromLngLat[1]
		if (!Number.isFinite(deltaLng) || !Number.isFinite(deltaLat)) return feature
		const updatedFeature = cloneFeature(feature)
		const { geometry } = updatedFeature
		const coordinates =
			geometry.type === 'Point'
				? [geometry.coordinates]
				: coordinateSequences(geometry).flatMap((sequence) => sequence.coordinates)
		if (coordinates.length === 0) return feature
		for (const position of coordinates) {
			if (!isFinitePosition(position)) return feature
			const lng = position[0] + deltaLng
			const lat = position[1] + deltaLat
			if (!Number.isFinite(lng) || !Number.isFinite(lat)) return feature
			// Preserve altitude and any further coordinate dimensions.
			position[0] = lng
			position[1] = lat
		}
		return updatedFeature
	}
}
