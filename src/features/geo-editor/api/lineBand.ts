import { featureCollection, union } from '@turf/turf'
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson'
import { MAX_DISTANCE_METERS, type PrimitiveUnits } from './primitives'

export interface LineBandOptions {
	/** Total width at the start, in the chosen units. */
	width: number
	/** Total width at the end. Defaults to width; zero makes a pointed taper. */
	endWidth?: number
	units?: PrimitiveUnits
	side?: 'center' | 'left' | 'right'
	arrowHeadLength?: number
	arrowHeadWidth?: number
}

type XY = [number, number]
interface BandNode {
	position: XY
	scale: number
	distance: number
}

const RADIUS = 6_378_137
const MAX_LATITUDE = 85.0511287798066
const METERS_PER_UNIT: Record<PrimitiveUnits, number> = {
	meters: 1,
	kilometers: 1000,
	miles: 1609.344,
}

function distanceMeters(value: number, units: PrimitiveUnits, label: string): number {
	const meters = value * METERS_PER_UNIT[units]
	if (
		typeof value !== 'number' ||
		!Number.isFinite(meters) ||
		meters < 0 ||
		meters >= MAX_DISTANCE_METERS
	) {
		throw new Error(
			`${label} must be a finite, non-negative distance below ${MAX_DISTANCE_METERS} meters.`,
		)
	}
	return meters
}

function unproject([x, y]: XY): XY {
	return [
		((x / RADIUS) * 180) / Math.PI,
		((2 * Math.atan(Math.exp(y / RADIUS)) - Math.PI / 2) * 180) / Math.PI,
	]
}

function nodesFor(coordinates: Position[]): BandNode[] {
	const nodes: BandNode[] = []
	for (const coordinate of coordinates) {
		const [lon, lat] = coordinate
		if (
			lon === undefined ||
			lat === undefined ||
			!Number.isFinite(lon) ||
			!Number.isFinite(lat) ||
			Math.abs(lon) > 180 ||
			Math.abs(lat) > MAX_LATITUDE
		) {
			throw new Error('Line extrusion requires finite map coordinates within Web Mercator bounds.')
		}
		const radians = (lat * Math.PI) / 180
		const position: XY = [
			(RADIUS * lon * Math.PI) / 180,
			RADIUS * Math.log(Math.tan(Math.PI / 4 + radians / 2)),
		]
		const scale = 1 / Math.cos(radians)
		const previous = nodes.at(-1)
		const length = previous
			? Math.hypot(position[0] - previous.position[0], position[1] - previous.position[1])
			: 0
		if (previous && length === 0) continue
		if (previous && Math.abs(lon - unproject(previous.position)[0]) > 180) {
			throw new Error('Split lines at the antimeridian before extruding them.')
		}
		nodes.push({
			position,
			scale,
			distance: (previous?.distance ?? 0) + length / ((scale + (previous?.scale ?? scale)) / 2),
		})
	}
	if (nodes.length < 2) throw new Error('Line extrusion requires at least two distinct positions.')
	return nodes
}

function normal(a: XY, b: XY): XY {
	const length = Math.hypot(b[0] - a[0], b[1] - a[1])
	return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length]
}

function offset(node: BandNode, direction: XY, meters: number): XY {
	return [
		node.position[0] + direction[0] * meters * node.scale,
		node.position[1] + direction[1] * meters * node.scale,
	]
}

/** Extrude rendered map segments, then union in projected space to resolve bends and overlaps. */
export function makeLineBand(
	geometry: LineString | MultiLineString,
	options: LineBandOptions,
	arrow: boolean,
): Polygon | MultiPolygon {
	const units = options.units ?? 'meters'
	if (!(units in METERS_PER_UNIT)) throw new Error('Choose meters, kilometers, or miles.')
	const width = distanceMeters(options.width, units, 'Start width')
	const endWidth = distanceMeters(options.endWidth ?? options.width, units, 'End width')
	if (width === 0 && endWidth === 0) throw new Error('At least one band width must be positive.')
	const side = options.side ?? 'center'
	if (!['center', 'left', 'right'].includes(side))
		throw new Error('Side must be center, left, or right.')
	if (arrow && endWidth === 0)
		throw new Error('An arrow needs a positive end width; use a fat line for a taper to zero.')
	const requestedHeadLength =
		!arrow || options.arrowHeadLength === undefined
			? undefined
			: distanceMeters(options.arrowHeadLength, units, 'Arrowhead length')
	const headWidth = arrow
		? distanceMeters(
				options.arrowHeadWidth ?? (options.endWidth ?? options.width) * 2,
				units,
				'Arrowhead width',
			)
		: 0
	if (arrow && (headWidth <= 0 || requestedHeadLength === 0))
		throw new Error('Arrowhead dimensions must be positive.')
	if (arrow && headWidth < endWidth)
		throw new Error('Arrowhead width must be at least the end width.')
	const pieces: Array<Feature<Polygon>> = []
	function addPiece(points: XY[], exactVertex?: XY) {
		// A 0.1 mm grid stabilizes the planar clipping graph at map-scale coordinates.
		points = points.map((position) =>
			position === exactVertex
				? position
				: [Math.round(position[0] * 1e4) / 1e4, Math.round(position[1] * 1e4) / 1e4],
		)
		// Translate before computing area to avoid cancellation far from the origin.
		const origin = points[0]!
		const signedArea = points.reduce((sum, p, i) => {
			const next = points[(i + 1) % points.length]!
			return (
				sum +
				(p[0] - origin[0]) * (next[1] - origin[1]) -
				(next[0] - origin[0]) * (p[1] - origin[1])
			)
		}, 0)
		if (signedArea === 0) return
		const ring = signedArea > 0 ? points : [...points].reverse()
		pieces.push({
			type: 'Feature',
			properties: {},
			geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] },
		})
	}
	const parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
	if (parts.length === 0) throw new Error('The source line has no parts.')
	for (const coordinates of parts) {
		const nodes = nodesFor(coordinates)
		const tip = nodes.at(-1)!
		const total = tip.distance
		const headLength = arrow ? (requestedHeadLength ?? Math.min(endWidth * 3, total / 4)) : 0
		if (headLength >= total)
			throw new Error('Arrowhead length must be shorter than each source line part.')
		const shaftLength = total - headLength
		if (arrow && shaftLength === total)
			throw new Error('Arrowhead length is below map coordinate precision. Increase it.')
		let headBase: BandNode | undefined
		const shaft: BandNode[] = []
		for (const node of nodes) {
			const previous = shaft.at(-1)
			if (node.distance > shaftLength && previous) {
				const fraction = (shaftLength - previous.distance) / (node.distance - previous.distance)
				headBase = {
					position: [
						previous.position[0] + (node.position[0] - previous.position[0]) * fraction,
						previous.position[1] + (node.position[1] - previous.position[1]) * fraction,
					],
					scale: previous.scale + (node.scale - previous.scale) * fraction,
					distance: shaftLength,
				}
				if (fraction > 0) shaft.push(headBase)
				break
			}
			shaft.push(node)
		}
		let previousEdges: [XY, XY] | undefined
		let lastNormal: XY | undefined
		for (let i = 1; i < shaft.length; i++) {
			const a = shaft[i - 1]!
			const b = shaft[i]!
			const direction = normal(a.position, b.position)
			lastNormal = direction
			function edges(node: BandNode): [XY, XY] {
				const value = width + ((endWidth - width) * node.distance) / shaftLength
				return [
					offset(node, direction, side === 'right' ? 0 : side === 'left' ? value : value / 2),
					offset(node, direction, side === 'left' ? 0 : side === 'right' ? -value : -value / 2),
				]
			}
			const start = edges(a)
			const end = edges(b)
			// Overlap at interior cross-sections by a millimeter. Coincident
			// oblique edges otherwise sometimes become disconnected clipping faces.
			const segmentLength = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1])
			const overlap = Math.min(segmentLength * 1e-6, 1e-3)
			const tangent: XY = [direction[1], -direction[0]]
			function extend(p: XY, amount: number): XY {
				return [p[0] + tangent[0] * amount, p[1] + tangent[1] * amount]
			}
			const startOverlap = i > 1 ? -overlap : 0
			const endOverlap = i < shaft.length - 1 || arrow ? overlap : 0
			addPiece([
				extend(start[0], startOverlap),
				extend(start[1], startOverlap),
				extend(end[1], endOverlap),
				extend(end[0], endOverlap),
			])
			if (previousEdges) {
				addPiece([a.position, previousEdges[0], start[0]])
				addPiece([a.position, previousEdges[1], start[1]])
			}
			previousEdges = end
		}
		if (arrow && headBase && lastNormal) {
			const center = side === 'left' ? endWidth / 2 : side === 'right' ? -endWidth / 2 : 0
			addPiece(
				[
					offset(headBase, lastNormal, center + headWidth / 2),
					offset(headBase, lastNormal, center - headWidth / 2),
					tip.position,
				],
				tip.position,
			)
		}
	}
	if (pieces.length === 0) throw new Error('The line could not be extruded into a polygon.')
	const merged = pieces.length === 1 ? pieces[0]! : union(featureCollection(pieces))
	if (!merged) throw new Error('The line band polygons could not be joined.')
	function ringToMap(ring: Position[]): Position[] {
		const mapped = ring.map((position) => {
			const result = unproject(position as XY)
			if (Math.abs(result[0]) > 180 || Math.abs(result[1]) > MAX_LATITUDE)
				throw new Error('The extruded shape extends beyond map bounds. Reduce its width.')
			return result
		})
		// Clipping may leave sub-precision sliver rings at touching segment corners.
		// Remove consecutive duplicates after projection back to geographic coordinates.
		const clean = mapped.filter(
			(p, i) => i === 0 || p[0] !== mapped[i - 1]![0] || p[1] !== mapped[i - 1]![1],
		)
		return clean
	}
	function polygonToMap(rings: Position[][]): Position[][] {
		const mapped = rings.map(ringToMap)
		if (!mapped[0] || mapped[0].length < 4)
			throw new Error('The line band collapses below map coordinate precision. Increase its width.')
		return [mapped[0], ...mapped.slice(1).filter((ring) => ring.length >= 4)]
	}
	return merged.geometry.type === 'Polygon'
		? { type: 'Polygon', coordinates: polygonToMap(merged.geometry.coordinates) }
		: { type: 'MultiPolygon', coordinates: merged.geometry.coordinates.map(polygonToMap) }
}
