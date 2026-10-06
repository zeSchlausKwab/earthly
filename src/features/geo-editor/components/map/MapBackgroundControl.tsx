import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getMapBackground, setMapBackground, useSatelliteSettings } from '@/lib/satellite'

export function MapBackgroundControl() {
	const [settings] = useSatelliteSettings()
	return (
		<ToggleGroup
			type="single"
			aria-label="Map background"
			value={getMapBackground(settings)}
			onValueChange={(mode) => {
				if (mode === 'osm' || mode === 'satellite' || mode === 'combined') setMapBackground(mode)
			}}
			spacing={1}
			className="absolute left-3 top-3 z-10 gap-1 rounded-lg border border-border bg-background p-1 shadow-md md:top-[4.5rem]"
		>
			{(['osm', 'satellite', 'combined'] as const).map((mode) => (
				<ToggleGroupItem
					key={mode}
					value={mode}
					className="h-11 min-w-11 px-2.5 text-xs font-medium data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
				>
					{mode === 'osm' ? 'OSM' : mode === 'satellite' ? 'Satellite' : 'Combined'}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	)
}
