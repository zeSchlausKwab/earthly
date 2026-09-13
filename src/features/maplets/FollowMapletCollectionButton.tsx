import { createContext, useContext, useMemo, useState } from 'react'
import type { NostrEvent } from 'nostr-tools'
import { Layers2, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { parseMapletCollectionSummary } from './collectionDiscovery'

/** One host-owned Follow action shared by Maps, profiles, search, and the directory. */
export const MapletFollowContext = createContext<((address: string) => Promise<void>) | null>(null)

export function FollowMapletCollectionButton({
	event,
	compact = false,
}: {
	event: NostrEvent
	compact?: boolean
}) {
	const follow = useContext(MapletFollowContext)
	const collection = useMemo(() => parseMapletCollectionSummary(event), [event])
	const [pending, setPending] = useState(false)
	if (!follow || !collection) return null
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="min-h-10 shrink-0 rounded-sm px-2 text-[11px] md:min-h-8"
			disabled={pending}
			aria-label={`Follow ${collection.name} in Live Mapper`}
			title="Follow in Live Mapper"
			onClick={(event) => {
				event.stopPropagation()
				setPending(true)
				void follow(collection.address)
					.catch((error) =>
						toast.error(error instanceof Error ? error.message : 'Could not follow collection'),
					)
					.finally(() => setPending(false))
			}}
		>
			{pending ? (
				<LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
			) : (
				<Layers2 className="size-3.5" aria-hidden="true" />
			)}
			{compact ? 'Follow' : 'Follow in Live Mapper'}
		</Button>
	)
}
