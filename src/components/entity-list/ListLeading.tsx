/**
 * Leading elements for a ListRow — the 34×34 slot that opens every row. Redesign
 * §11a: "only the leading element and the badges change per entity". A tinted
 * type-glyph tile for datasets/contexts/sightings, a square cover thumb for
 * stories, and a status-tinted avatar disc for beacons (built inline where the
 * presence dot is needed).
 */

import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

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
