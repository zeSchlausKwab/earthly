/**
 * Leading elements for a ListRow — the 34×34 slot that opens every row. Redesign
 * §11a: "only the leading element and the badges change per entity". A tinted
 * type-glyph tile for datasets/contexts/sightings, a square cover thumb for
 * stories, and a status-tinted avatar disc for beacons (built inline where the
 * presence dot is needed).
 */

import { memo, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { geometryThumbnail } from './geometryThumbnail'

export const GeometryThumb = memo(function GeometryThumb({
	collection,
	fallbackIcon,
}: {
	collection: FeatureCollection | null | undefined
	fallbackIcon: LucideIcon
}) {
	const shapes = useMemo(() => geometryThumbnail(collection), [collection])
	if (!shapes.length) return <GlyphTile icon={fallbackIcon} />
	return (
		<div
			className="h-7 w-10 overflow-hidden border border-border bg-info/10 text-info"
			aria-hidden="true"
		>
			<svg viewBox="0 0 40 28" className="h-full w-full" aria-hidden="true">
				{shapes.map((shape, index) =>
					shape.points.length === 1 ? (
						<circle
							// biome-ignore lint/suspicious/noArrayIndexKey: Thumbnail primitives are stateless positional SVG shapes rebuilt together.
							key={index}
							cx={shape.points[0]?.[0]}
							cy={shape.points[0]?.[1]}
							r="1.25"
							fill="currentColor"
						/>
					) : (
						<path
							// biome-ignore lint/suspicious/noArrayIndexKey: Thumbnail primitives are stateless positional SVG shapes rebuilt together.
							key={index}
							d={`M${shape.points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L')}${shape.closed ? ' Z' : ''}`}
							stroke="currentColor"
							strokeWidth=".8"
							fill={shape.closed ? 'currentColor' : 'none'}
							fillOpacity=".15"
						/>
					),
				)}
			</svg>
		</div>
	)
})

/** A tinted square with a centered glyph — the datasets/contexts/sightings lead. */
export function GlyphTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
	return (
		<div
			className={cn(
				'flex h-[34px] w-[34px] items-center justify-center rounded-[2px] bg-info/15 text-info',
				className,
			)}
		>
			<Icon className="h-4 w-4" />
		</div>
	)
}

/** A 34×34 square cover thumbnail, falling back to a tinted glyph tile. */
export function CoverThumb({
	src,
	alt,
	fallbackIcon,
	fallbackClassName,
}: {
	src?: string
	alt?: string
	fallbackIcon: LucideIcon
	fallbackClassName?: string
}) {
	const [broken, setBroken] = useState(false)
	const showImage = Boolean(src) && !broken
	if (showImage) {
		return (
			<div className="h-[34px] w-[34px] overflow-hidden rounded-[2px] border border-border bg-muted">
				<img
					src={src}
					alt={alt ?? ''}
					className="h-full w-full object-cover"
					onError={() => setBroken(true)}
				/>
			</div>
		)
	}
	return <GlyphTile icon={fallbackIcon} className={fallbackClassName} />
}
