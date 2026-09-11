import { useMemo } from 'react'
import { use$ } from 'applesauce-react/hooks'
import { castEvent } from 'applesauce-core/casts'
import { Database, FileText } from 'lucide-react'
import { eventStore } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { resolveEntityReference } from '@/lib/nostr/entityReference'
import { GeometryThumb, GlyphTile } from '@/components/entity-list'
import { UserProfile } from '@/components/user-profile'
import { Button } from '@/components/ui/button'

export function PinnedReferenceRow({ coordinate, onInspect, onZoom }: {
	coordinate: string
	onInspect?: (coordinate: string) => void
	onZoom?: (coordinate: string) => void
}) {
	const reference = useMemo(() => resolveEntityReference(coordinate), [coordinate])
	const event = use$(() => reference ? eventStore.replaceable(reference.kind, reference.pubkey, reference.identifier) : undefined, [reference])
	const dataset = useMemo(() => {
		if (!event || reference?.entityKind !== 'map') return null
		try { return castEvent(event, GeoDataset, eventStore) } catch { return null }
	}, [event, reference])
	const collectionName = (dataset?.featureCollection as { name?: unknown } | undefined)?.name
	const title = (typeof collectionName === 'string' && collectionName) || event?.tags.find(t => t[0] === 'title' || t[0] === 'name')?.[1] || reference?.identifier || 'Unavailable reference'
	return <div className="flex items-center gap-2 border-b border-border py-2">
		{dataset ? <GeometryThumb collection={dataset.featureCollection} fallbackIcon={Database} /> : <GlyphTile icon={FileText} />}
		<div className="min-w-0 flex-1">
			<button type="button" className="block w-full truncate text-left text-sm font-semibold" disabled={!reference || !onInspect} onClick={() => onInspect?.(coordinate)}>{String(title)}</button>
			{reference && <UserProfile pubkey={reference.pubkey} mode="name-only" size="xs" showNip05Badge={false} />}
			<details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer">Reference details</summary><code className="break-all">{coordinate}</code></details>
		</div>
		<div className="flex shrink-0 gap-1">
			<Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={!reference || !onInspect} onClick={() => onInspect?.(coordinate)}>Inspect</Button>
			{reference?.entityKind === 'map' && <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={!dataset || !onZoom} onClick={() => onZoom?.(coordinate)} title={dataset ? 'Frame Map without leaving this Atlas' : 'Waiting for Map data'}>Zoom</Button>}
		</div>
	</div>
}
