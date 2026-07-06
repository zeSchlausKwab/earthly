import { MousePointerClick, Scan, Settings2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export const OSM_FILTER_PRESETS = [
	{ label: 'Highways', value: 'highway' },
	{ label: 'Railways', value: 'railway' },
	{ label: 'Waterways', value: 'waterway' },
	{ label: 'Buildings', value: 'building' },
	{ label: 'Natural', value: 'natural' },
	{ label: 'Landuse', value: 'landuse' },
	{ label: 'Amenities', value: 'amenity' },
	{ label: 'All', value: 'all' },
] as const

export interface OsmImportPopoverProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	osmQueryFilter: string
	onOsmFilterChange: (filter: string) => void
	onOsmClickMode: () => void
	onOsmQueryView: () => void
	onOsmAdvanced?: () => void
	isClickMode?: boolean
	small?: boolean
}

export function OsmImportPopover({
	open,
	onOpenChange,
	osmQueryFilter,
	onOsmFilterChange,
	onOsmClickMode,
	onOsmQueryView,
	onOsmAdvanced,
	isClickMode,
	small,
}: OsmImportPopoverProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : 'h-9 w-9'
	// Uniform style with Chat / Lookup / Settings / Share: ghost variant +
	// transparent border + active state via `bg-primary text-primary-foreground`
	// (solid fill, high contrast — clearly distinct from inactive).
	const triggerClass = small
		? `${buttonSize} shrink-0 rounded-md border border-transparent shadow-none${
				isClickMode
					? ' bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
					: ''
			}`
		: buttonSize

	return (
		<TooltipProvider delayDuration={500}>
			<Popover open={open} onOpenChange={onOpenChange}>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button
								size={small ? 'icon-sm' : 'icon'}
								variant={small ? 'ghost' : isClickMode ? 'default' : 'outline'}
								className={triggerClass}
								aria-label="OSM Import"
							>
								<Sparkles className={iconSize} />
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>OSM Import</p>
					</TooltipContent>
				</Tooltip>

				<PopoverContent className="w-64 p-3" side="bottom" align="start">
					<div className="space-y-3">
						<div className="text-sm font-medium">Import from OpenStreetMap</div>

						<div className="space-y-2">
							<div className="text-xs text-muted-foreground font-medium">Feature Type</div>
							<Select value={osmQueryFilter} onValueChange={onOsmFilterChange}>
								<SelectTrigger className="h-8 text-sm">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{OSM_FILTER_PRESETS.map((preset) => (
										<SelectItem key={preset.value} value={preset.value}>
											{preset.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="flex gap-1">
								<Button
									variant="outline"
									size="sm"
									className="flex-1 gap-1.5 text-xs"
									onClick={onOsmClickMode}
								>
									<MousePointerClick className="h-3.5 w-3.5" />
									Click on Map
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="flex-1 gap-1.5 text-xs"
									onClick={onOsmQueryView}
								>
									<Scan className="h-3.5 w-3.5" />
									Query View
								</Button>
							</div>
							{onOsmAdvanced && (
								<Button
									variant="ghost"
									size="sm"
									className="w-full justify-start gap-2 text-xs text-muted-foreground"
									onClick={onOsmAdvanced}
								>
									<Settings2 className="h-3.5 w-3.5" />
									Advanced...
								</Button>
							)}
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</TooltipProvider>
	)
}
