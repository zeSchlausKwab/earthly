import { Layers, Map as MapIcon, Satellite } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getMapBackground, setMapBackground, useSatelliteSettings } from '@/lib/satellite'

export function MapBackgroundControl() {
	const [settings] = useSatelliteSettings()
	const mode = getMapBackground(settings)
	const nextMode = mode === 'osm' ? 'satellite' : mode === 'satellite' ? 'combined' : 'osm'
	const labels = { osm: 'OSM', satellite: 'Satellite', combined: 'Combined' }
	const Icon = mode === 'osm' ? MapIcon : mode === 'satellite' ? Satellite : Layers
	const label = `Map background: ${labels[mode]}. Switch to ${labels[nextMode]}`
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={label}
					onClick={() => setMapBackground(nextMode)}
					className="group absolute left-2 top-2 z-10 flex size-11 items-center justify-center outline-none md:left-3 md:top-[4.5rem]"
				>
					<span className="flex size-8 items-center justify-center rounded-md border border-border bg-background shadow-sm transition-colors group-hover:bg-accent group-focus-visible:ring-2 group-focus-visible:ring-ring">
						<Icon className="size-4" aria-hidden="true" />
					</span>
				</button>
			</TooltipTrigger>
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	)
}
