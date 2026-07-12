import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
	getDisplayIconSvg,
	isBundledDisplayIcon,
	lucideIconId,
} from '@/features/geo-editor/icons/displayIcon'
import { LUCIDE_ICON_NAMES } from '@/features/geo-editor/icons/lucideIcons'

export interface DisplayIconPickerControlProps {
	/** Current `displayIcon` value (`lucide:<name>`), if any. */
	value: string | undefined
	/** Set a new icon id, or clear with `undefined`. */
	onChange: (value: string | undefined) => void
}

/** Inline-render a bundled icon's SVG (24×24 stroke-based, tinted via currentColor). */
function InlineIconSvg({ iconId, className }: { iconId: string; className?: string }) {
	const svg = getDisplayIconSvg(iconId)
	if (!svg) return null
	return (
		<span
			className={className}
			aria-hidden="true"
			// Trusted content: bundled, build-time-generated Lucide SVG strings only.
			// biome-ignore lint/security/noDangerouslySetInnerHtml: static bundled SVGs
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	)
}

/**
 * "Icon" style row for Point features: a popover with a searchable grid of the
 * bundled Lucide icons (Phase 1 `lucide:<name>` namespace) plus a clear action.
 * Points with an icon render it on the map as a glyph (tinted by the point's
 * stroke color) on the color-filled disc.
 */
export function DisplayIconPickerControl({ value, onChange }: DisplayIconPickerControlProps) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')

	const filteredNames = useMemo(() => {
		const needle = query.trim().toLowerCase()
		if (!needle) return [...LUCIDE_ICON_NAMES]
		return LUCIDE_ICON_NAMES.filter((name) => name.includes(needle))
	}, [query])

	const hasValidIcon = isBundledDisplayIcon(value)
	const currentName = hasValidIcon ? value.slice(value.indexOf(':') + 1) : undefined

	return (
		<div className="flex items-center gap-1">
			<span className="text-[10px] text-muted-foreground w-8">Icon</span>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						size="sm"
						variant="outline"
						className="h-6 flex-1 justify-start gap-1.5 px-1.5 text-xs font-normal"
					>
						{hasValidIcon && value ? (
							<>
								<InlineIconSvg iconId={value} className="[&_svg]:h-3.5 [&_svg]:w-3.5" />
								<span className="truncate">{currentName}</span>
							</>
						) : (
							<span className="text-muted-foreground">{value ? `Unknown (${value})` : 'None'}</span>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-64 p-2" align="start">
					<div className="space-y-2">
						<Input
							type="text"
							className="h-7 text-xs"
							placeholder="Search icons..."
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
						<div className="grid max-h-48 grid-cols-6 gap-1 overflow-y-auto">
							{filteredNames.map((name) => {
								const iconId = lucideIconId(name)
								const isSelected = iconId === value
								return (
									<Button
										key={name}
										size="icon-xs"
										variant={isSelected ? 'default' : 'ghost'}
										className="h-8 w-8"
										title={name}
										onClick={() => {
											onChange(iconId)
											setOpen(false)
										}}
									>
										<InlineIconSvg iconId={iconId} className="[&_svg]:h-4 [&_svg]:w-4" />
									</Button>
								)
							})}
							{filteredNames.length === 0 && (
								<span className="col-span-6 py-2 text-center text-[10px] text-muted-foreground">
									No icons match "{query}"
								</span>
							)}
						</div>
					</div>
				</PopoverContent>
			</Popover>
			{value !== undefined && (
				<Button
					size="icon-xs"
					variant="ghost"
					className="h-6 w-6 shrink-0"
					title="Remove icon"
					onClick={() => onChange(undefined)}
				>
					<X className="h-3 w-3" />
				</Button>
			)}
		</div>
	)
}
