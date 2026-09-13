import { Layers2, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { UserProfile } from '@/components/user-profile/UserProfile'
import { filterMapletCollections, type MapletCollectionSummary } from './collectionDiscovery'
import { useMapletCollectionDiscovery } from './useMapletCollectionDiscovery'

const actionClass = 'min-h-10 rounded-sm px-2.5 text-[11px] md:min-h-8'

function CollectionCard({
	collection,
	onFollow,
}: {
	collection: MapletCollectionSummary
	onFollow: (address: string) => Promise<void>
}) {
	const [following, setFollowing] = useState(false)
	const [opened, setOpened] = useState(false)
	const [error, setError] = useState<string>()
	const npub = nip19.npubEncode(collection.pubkey)
	const published = new Date(collection.updatedAt * 1_000)
	const follow = async () => {
		setFollowing(true)
		setError(undefined)
		try {
			await onFollow(collection.address)
			setOpened(true)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Could not follow this collection.')
		} finally {
			setFollowing(false)
		}
	}
	return (
		<article
			aria-label={`${collection.name} published collection`}
			className="min-w-0 border-b border-border px-2 py-4 last:border-b-0"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h4 className="break-words text-sm font-semibold leading-snug">{collection.name}</h4>
					<div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
						<span>By</span>
						<UserProfile
							pubkey={collection.pubkey}
							mode="name-only"
							size="xs"
							showNip05Badge={false}
							className="min-w-0 truncate text-[11px]"
						/>
					</div>
					<p className="mt-1 font-mono text-[9px] text-muted-foreground" title={npub}>
						{npub.slice(0, 12)}…{npub.slice(-8)}
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					className={`${actionClass} shrink-0`}
					disabled={following}
					onClick={() => void follow()}
					aria-label={`${opened ? 'Open' : 'Follow'} ${collection.name} in Live Mapper`}
				>
					{following ? (
						<LoaderCircle className="animate-spin" aria-hidden="true" />
					) : opened ? (
						<Layers2 aria-hidden="true" />
					) : (
						<Plus aria-hidden="true" />
					)}
					{following ? 'Opening…' : opened ? 'Open' : 'Follow'}
				</Button>
			</div>
			{collection.groups.length > 0 ? (
				<p className="mt-3 break-words text-[10px] font-medium text-muted-foreground">
					{collection.groups.slice(0, 4).join(' / ')}
					{collection.groups.length > 4 ? ` / +${collection.groups.length - 4} groups` : ''}
				</p>
			) : null}
			{collection.layers.length > 0 ? (
				<p className="mt-1.5 break-words text-xs leading-relaxed">
					{collection.layers.slice(0, 4).join(' · ')}
					{collection.layers.length > 4 ? ` · +${collection.layers.length - 4} layers` : ''}
				</p>
			) : null}
			<p className="mt-2.5 font-mono text-[9px] leading-relaxed text-muted-foreground">
				{collection.layers.length} {collection.layers.length === 1 ? 'layer' : 'layers'} ·{' '}
				{collection.featureCount} {collection.featureCount === 1 ? 'geometry' : 'geometries'}
				<br />
				Published{' '}
				<time dateTime={published.toISOString()}>
					{published.toLocaleString([], {
						year: 'numeric',
						month: 'short',
						day: 'numeric',
						hour: '2-digit',
						minute: '2-digit',
					})}
				</time>
			</p>
			<details className="mt-2 text-[10px] text-muted-foreground">
				<summary className="w-fit cursor-pointer py-1.5">
					Collection identity &amp; all layers
				</summary>
				<div className="mt-1 space-y-2 border-l border-border pl-2.5">
					<p className="leading-relaxed">
						Signed by this publisher. Follow receives updates to this collection.
					</p>
					<label className="block">
						Publisher
						<input
							aria-label={`${collection.name} publisher public key`}
							readOnly
							value={npub}
							className="mt-1 min-h-9 w-full rounded-sm border border-input bg-background px-2 font-mono text-[10px]"
						/>
					</label>
					<label className="block">
						Collection address
						<input
							aria-label={`${collection.name} collection address`}
							readOnly
							value={collection.naddr}
							className="mt-1 min-h-9 w-full rounded-sm border border-input bg-background px-2 font-mono text-[10px]"
						/>
					</label>
					{collection.groups.length ? (
						<p className="break-words">Groups: {collection.groups.join(', ')}</p>
					) : null}
					{collection.layers.length ? (
						<p className="break-words">Layers: {collection.layers.join(', ')}</p>
					) : null}
				</div>
			</details>
			{error ? (
				<p role="alert" className="mt-2 text-xs text-destructive">
					{error}
				</p>
			) : null}
		</article>
	)
}

export function MapletCollectionDirectory({
	enabled = true,
	onFollow,
}: {
	enabled?: boolean
	onFollow: (address: string) => Promise<void>
}) {
	const directory = useMapletCollectionDiscovery(enabled)
	const [search, setSearch] = useState('')
	const searchId = useId()
	const collections = useMemo(
		() => filterMapletCollections(directory.collections, search),
		[directory.collections, search],
	)
	return (
		<section aria-label="Published collections" className="pt-5">
			<div className="flex items-center justify-between gap-2 px-2">
				<h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					Published collections
				</h3>
				<Button
					type="button"
					variant="ghost"
					className={actionClass}
					disabled={directory.loading || !enabled}
					onClick={() => void directory.refresh()}
					aria-label="Refresh published collections"
				>
					{directory.loading ? (
						<LoaderCircle className="animate-spin" aria-hidden="true" />
					) : (
						<RefreshCw aria-hidden="true" />
					)}
					Refresh
				</Button>
			</div>
			<p className="px-2 pb-3 text-xs leading-relaxed text-muted-foreground">
				Follow a publisher’s layers in Live Mapper. Updates arrive through your configured relays;
				no sign-in is needed to read.
			</p>
			<div className="px-2 pb-3">
				<label htmlFor={searchId} className="sr-only">
					Find published collections
				</label>
				<div className="relative">
					<Search
						className="pointer-events-none absolute left-2.5 top-3 size-3.5 text-muted-foreground"
						aria-hidden="true"
					/>
					<input
						id={searchId}
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Collection, layer, group, or publisher key"
						className="min-h-10 w-full rounded-sm border border-input bg-background py-2 pl-8 pr-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
					/>
				</div>
				<p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
					Search the collections loaded from your relays. Publisher keys can be npub or hex.
				</p>
			</div>
			{directory.error ? (
				<p
					role="alert"
					className="mx-2 mb-3 border-l-2 border-amber-500 px-2.5 py-2 text-xs leading-relaxed"
				>
					{directory.error}
				</p>
			) : null}
			{directory.loading ? (
				<p role="status" className="px-2 pb-3 text-[11px] text-muted-foreground">
					Looking for published collections on your relays…
				</p>
			) : null}
			{collections.length > 0 ? (
				<div className="border-y border-border">
					{collections.map((collection) => (
						<CollectionCard key={collection.address} collection={collection} onFollow={onFollow} />
					))}
				</div>
			) : !directory.loading || search.trim() ? (
				<div className="mx-2 border border-dashed border-border px-3 py-4 text-xs leading-relaxed text-muted-foreground">
					{search.trim()
						? 'No loaded collections match this search. Try another layer name or publisher key.'
						: 'No published collections found on your configured relays yet. Publish a collection from Manage, or use Follow inside Live Mapper if you already have an address.'}
				</div>
			) : null}
			{directory.hasMore ? (
				<div className="px-2 pt-3">
					<Button
						type="button"
						variant="outline"
						className={`${actionClass} w-full`}
						disabled={directory.loading || !enabled}
						onClick={() => void directory.loadMore()}
					>
						Load more collections
					</Button>
				</div>
			) : null}
		</section>
	)
}
