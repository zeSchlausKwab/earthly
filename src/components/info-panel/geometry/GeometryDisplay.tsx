import type {
	Geometry,
	Point,
	LineString,
	Polygon,
	MultiPoint,
	MultiLineString,
	MultiPolygon,
} from 'geojson'
import { ChevronDown, ChevronRight, Cloud } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatGeometryMeasurement } from '@/features/geo-editor/api/measure'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * Passive companion (AI_GEO_AWARENESS §2): computed length/area/perimeter for
 * the geometry, memoized per geometry object (rows re-render in lists; the
 * store replaces geometry objects on edit, so identity is a fresh-enough key).
 */
function useGeometryMeasurement(geometry: Geometry): string | null {
	return useMemo(() => formatGeometryMeasurement(geometry), [geometry])
}

interface CoordinateDisplayProps {
	coordinates: number[]
	index?: number
}

// Generate a stable key for coordinates
function coordKey(coords: number[], index: number): string {
	return `${index}-${coords[0]?.toFixed(5)}-${coords[1]?.toFixed(5)}`
}

function CoordinateDisplay({ coordinates, index }: CoordinateDisplayProps) {
	const [lng, lat, alt] = coordinates
	return (
		<div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
			{index !== undefined && <span className="text-muted-foreground w-4">{index}</span>}
			<span>{lng?.toFixed(5)}</span>
			<span className="text-muted-foreground">,</span>
			<span>{lat?.toFixed(5)}</span>
			{alt !== undefined && (
				<>
					<span className="text-muted-foreground">,</span>
					<span className="text-muted-foreground">{alt?.toFixed(1)}</span>
				</>
			)}
		</div>
	)
}

interface GeometryHeaderProps {
	type: string
	count: number
	unit: string
	measurement?: string | null
	expanded: boolean
	onToggle: () => void
}

function GeometryHeader({
	type,
	count,
	unit,
	measurement,
	expanded,
	onToggle,
}: GeometryHeaderProps) {
	return (
		<Button
			type="button"
			variant="ghost"
			onClick={onToggle}
			className="flex items-center gap-1 text-xs w-full h-auto px-0 justify-start"
		>
			{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
			<span className="font-medium">{type}</span>
			<span className="text-muted-foreground">
				({count} {unit})
			</span>
			{measurement && <span className="text-muted-foreground">· {measurement}</span>}
		</Button>
	)
}

// Point
export function PointDisplay({ geometry }: { geometry: Point }) {
	return (
		<div className="text-xs">
			<span className="font-medium text-foreground">Point</span>
			<div className="mt-0.5">
				<CoordinateDisplay coordinates={geometry.coordinates} />
			</div>
		</div>
	)
}

// LineString
export function LineStringDisplay({ geometry }: { geometry: LineString }) {
	const [expanded, setExpanded] = useState(false)
	const coords = geometry.coordinates
	const measurement = useGeometryMeasurement(geometry)

	return (
		<div className="text-xs">
			<GeometryHeader
				type="LineString"
				count={coords.length}
				unit="vertices"
				measurement={measurement}
				expanded={expanded}
				onToggle={() => setExpanded(!expanded)}
			/>
			{expanded && (
				<div className="mt-1 pl-4 max-h-32 overflow-y-auto space-y-0.5">
					{coords.map((coord, i) => (
						<CoordinateDisplay key={coordKey(coord, i)} coordinates={coord} index={i} />
					))}
				</div>
			)}
		</div>
	)
}

// Polygon
export function PolygonDisplay({ geometry }: { geometry: Polygon }) {
	const [expanded, setExpanded] = useState(false)
	const rings = geometry.coordinates
	const totalVertices = rings.reduce((sum, ring) => sum + ring.length, 0)
	const measurement = useGeometryMeasurement(geometry)

	return (
		<div className="text-xs">
			<GeometryHeader
				type="Polygon"
				count={totalVertices}
				unit={`vertices, ${rings.length} ring${rings.length > 1 ? 's' : ''}`}
				measurement={measurement}
				expanded={expanded}
				onToggle={() => setExpanded(!expanded)}
			/>
			{expanded && (
				<div className="mt-1 pl-4 max-h-32 overflow-y-auto">
					{rings.map((ring, ringIdx) => {
						const firstCoord = ring[0]
						const ringKey = firstCoord ? `ring-${coordKey(firstCoord, ringIdx)}` : `ring-${ringIdx}`
						return (
							<div key={ringKey} className="mb-1">
								<div className="text-[10px] text-muted-foreground font-medium">
									{ringIdx === 0 ? 'Outer' : `Hole ${ringIdx}`}
								</div>
								<div className="space-y-0.5">
									{ring.map((coord, i) => (
										<CoordinateDisplay key={coordKey(coord, i)} coordinates={coord} index={i} />
									))}
								</div>
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}

// MultiPoint
export function MultiPointDisplay({ geometry }: { geometry: MultiPoint }) {
	const [expanded, setExpanded] = useState(false)
	const points = geometry.coordinates

	return (
		<div className="text-xs">
			<GeometryHeader
				type="MultiPoint"
				count={points.length}
				unit="points"
				expanded={expanded}
				onToggle={() => setExpanded(!expanded)}
			/>
			{expanded && (
				<div className="mt-1 pl-4 max-h-32 overflow-y-auto space-y-0.5">
					{points.map((coord, i) => (
						<CoordinateDisplay key={coordKey(coord, i)} coordinates={coord} index={i} />
					))}
				</div>
			)}
		</div>
	)
}

// MultiLineString
export function MultiLineStringDisplay({ geometry }: { geometry: MultiLineString }) {
	const [expanded, setExpanded] = useState(false)
	const lines = geometry.coordinates
	const totalVertices = lines.reduce((sum, line) => sum + line.length, 0)
	const measurement = useGeometryMeasurement(geometry)

	return (
		<div className="text-xs">
			<GeometryHeader
				type="MultiLineString"
				count={lines.length}
				unit={`lines, ${totalVertices} vertices`}
				measurement={measurement}
				expanded={expanded}
				onToggle={() => setExpanded(!expanded)}
			/>
			{expanded && (
				<div className="mt-1 pl-4 max-h-32 overflow-y-auto">
					{lines.map((line, lineIdx) => {
						const firstCoord = line[0]
						const lineKey = firstCoord ? `line-${coordKey(firstCoord, lineIdx)}` : `line-${lineIdx}`
						return (
							<div key={lineKey} className="mb-1">
								<div className="text-[10px] text-muted-foreground font-medium">
									Line {lineIdx + 1}
								</div>
								<div className="space-y-0.5">
									{line.map((coord, i) => (
										<CoordinateDisplay key={coordKey(coord, i)} coordinates={coord} index={i} />
									))}
								</div>
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}

// MultiPolygon
export function MultiPolygonDisplay({ geometry }: { geometry: MultiPolygon }) {
	const [expanded, setExpanded] = useState(false)
	const polygons = geometry.coordinates
	const totalVertices = polygons.reduce(
		(sum, poly) => sum + poly.reduce((s, ring) => s + ring.length, 0),
		0,
	)
	const measurement = useGeometryMeasurement(geometry)

	return (
		<div className="text-xs">
			<GeometryHeader
				type="MultiPolygon"
				count={polygons.length}
				unit={`polygons, ${totalVertices} vertices`}
				measurement={measurement}
				expanded={expanded}
				onToggle={() => setExpanded(!expanded)}
			/>
			{expanded && (
				<div className="mt-1 pl-4 max-h-32 overflow-y-auto">
					{polygons.map((poly, polyIdx) => {
						const outerRing = poly[0]
						const firstPolyCoord = outerRing?.[0]
						const polyKey = firstPolyCoord
							? `poly-${coordKey(firstPolyCoord, polyIdx)}`
							: `poly-${polyIdx}`
						return (
							<div key={polyKey} className="mb-1">
								<div className="text-[10px] text-muted-foreground font-medium">
									Polygon {polyIdx + 1}
								</div>
								{poly.map((ring, ringIdx) => {
									const firstRingCoord = ring[0]
									const ringKey = firstRingCoord
										? `ring-${coordKey(firstRingCoord, ringIdx)}`
										: `ring-${ringIdx}`
									return (
										<div key={ringKey} className="ml-2">
											<div className="text-[10px] text-muted-foreground">
												{ringIdx === 0 ? 'Outer' : `Hole ${ringIdx}`}
											</div>
											<div className="space-y-0.5">
												{ring.map((coord, i) => (
													<CoordinateDisplay
														key={coordKey(coord, i)}
														coordinates={coord}
														index={i}
													/>
												))}
											</div>
										</div>
									)
								})}
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}

// Generic dispatcher
export function GeometryDisplay({ geometry }: { geometry: Geometry }) {
	switch (geometry.type) {
		case 'Point':
			return <PointDisplay geometry={geometry} />
		case 'LineString':
			return <LineStringDisplay geometry={geometry} />
		case 'Polygon':
			return <PolygonDisplay geometry={geometry} />
		case 'MultiPoint':
			return <MultiPointDisplay geometry={geometry} />
		case 'MultiLineString':
			return <MultiLineStringDisplay geometry={geometry} />
		case 'MultiPolygon':
			return <MultiPolygonDisplay geometry={geometry} />
		default:
			return <span className="text-xs text-muted-foreground">Unknown geometry</span>
	}
}

// Compact badge for table display
export function GeometryBadge({
	geometry,
	isAnnotation,
	isExternal,
}: {
	geometry: Geometry | null
	isAnnotation?: boolean
	isExternal?: boolean
}) {
	const typeShort: Record<string, string> = {
		Point: 'Pt',
		LineString: 'Line',
		Polygon: 'Poly',
		MultiPoint: 'MPt',
		MultiLineString: 'MLine',
		MultiPolygon: 'MPoly',
	}

	const colors: Record<string, string> = {
		Point: 'bg-ok/15 text-ok',
		LineString: 'bg-info/15 text-info',
		Polygon: 'bg-edit/15 text-edit',
		MultiPoint: 'bg-ok/15 text-ok',
		MultiLineString: 'bg-info/15 text-info',
		MultiPolygon: 'bg-edit/15 text-edit',
	}

	// Special styling for annotations
	if (isAnnotation) {
		return (
			<span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
				Label
			</span>
		)
	}

	// External placeholder with no geometry
	if (!geometry || geometry === null) {
		return (
			<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-info/15 text-info">
				<Cloud className="h-2.5 w-2.5" />
				External
			</span>
		)
	}

	return (
		<span
			className={cn(
				'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
				colors[geometry.type],
			)}
		>
			{isExternal && <Cloud className="h-2.5 w-2.5 text-info" />}
			{typeShort[geometry.type] ?? geometry.type}
		</span>
	)
}
