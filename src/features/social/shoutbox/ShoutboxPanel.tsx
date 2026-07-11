import { useMemo, useState } from 'react'
import type { Filter } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PostForm } from './PostForm'
import { PostCard } from './PostCard'
import {
	SHOUTBOX_CATEGORIES,
	EARTHLY_CITY_NPUB,
	type ShoutboxCategory,
	type CategoryConfig,
} from './types'

/** Convert npub to hex pubkey */
function npubToHex(npub: string): string | null {
	try {
		const decoded = nip19.decode(npub)
		if (decoded.type === 'npub') {
			return decoded.data as string
		}
		return null
	} catch {
		return null
	}
}

/** Convert note1 IDs to hex event IDs */
function noteIdsToHex(noteIds: string[]): string[] {
	return noteIds
		.map((noteId) => {
			try {
				const decoded = nip19.decode(noteId)
				if (decoded.type === 'note') {
					return decoded.data as string
				}
				return null
			} catch {
				return null
			}
		})
		.filter((id): id is string => id !== null)
}

interface CategoryTabProps {
	config: CategoryConfig
	developerPubkey: string | null
}

function CategoryTab({ config, developerPubkey }: CategoryTabProps) {
	const [filterVersion, setFilterVersion] = useState(0)

	const pinnedEventIds = useMemo(
		() => noteIdsToHex(config.pinnedEventIds ?? []),
		[config.pinnedEventIds],
	)

	// Build filters based on category
	const filters = useMemo<Filter[]>(() => {
		void filterVersion // Trigger re-subscription on refresh

		const result: Filter[] = []

		// Main filter — category-specific filterTag (not all tags, since that's OR)
		const mainFilter: Filter = {
			kinds: [1],
			'#t': [config.filterTag],
			limit: 50,
		}
		if (config.developerOnly && developerPubkey) {
			mainFilter.authors = [developerPubkey]
		}
		result.push(mainFilter)

		if (pinnedEventIds.length > 0) {
			result.push({ kinds: [1], ids: pinnedEventIds })
		}
		return result
	}, [config, developerPubkey, pinnedEventIds, filterVersion])

	const { events, eose } = useTimelineWithEose(filters)

	// Deduplicate and sort posts
	const sortedPosts = useMemo(() => {
		const seen = new Set<string>()
		const unique = events.filter((event) => {
			if (seen.has(event.id)) return false
			seen.add(event.id)
			return true
		})
		return unique.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	}, [events])

	const handleRefresh = () => {
		setFilterVersion((prev) => prev + 1)
	}

	const isLoading = !eose && events.length === 0

	return (
		<div className="flex flex-col h-full min-h-0">
			{/* Category Description */}
			<div className="px-2 py-2 border-b bg-muted/30 flex-shrink-0">
				<div className="flex items-center justify-between">
					<div>
						<p className="text-xs text-muted-foreground">{config.description}</p>
						<div className="flex gap-1 mt-1">
							{config.tags.map((tag) => (
								<span
									key={tag}
									className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
								>
									#{tag}
								</span>
							))}
						</div>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleRefresh}
						disabled={isLoading}
						aria-label={`Refresh ${config.label}`}
						className="h-8 w-8"
					>
						<RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
					</Button>
				</div>
			</div>

			{/* Post Form (not shown for announcements unless developer) */}
			{!config.developerOnly && (
				<div className="p-2 border-b flex-shrink-0">
					<PostForm category={config.id} onPostSuccess={handleRefresh} />
				</div>
			)}

			{/* Posts List - Scrollable area */}
			<div className="flex-1 min-h-0 overflow-auto">
				<div className="p-2 space-y-3">
					{isLoading && (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					)}

					{!isLoading && sortedPosts.length === 0 && (
						<div className="text-center py-8 text-muted-foreground text-sm">
							{config.developerOnly
								? 'No announcements have been published yet.'
								: 'No posts yet. Be the first to post!'}
						</div>
					)}

					{sortedPosts.map((event) => (
						<PostCard
							key={event.id}
							event={event}
							isDeveloperPost={event.pubkey === developerPubkey}
						/>
					))}

					{eose && sortedPosts.length > 0 && (
						<p className="text-xs text-center text-muted-foreground py-2">
							{sortedPosts.length} post{sortedPosts.length !== 1 ? 's' : ''} loaded
						</p>
					)}
				</div>
			</div>
		</div>
	)
}

/**
 * Main shoutbox panel with tabs for different categories.
 */
export function ShoutboxPanel() {
	const [activeTab, setActiveTab] = useState<ShoutboxCategory>('announcements')

	const developerPubkey = useMemo(() => npubToHex(EARTHLY_CITY_NPUB), [])

	return (
		<div className="flex flex-col h-full min-h-0">
			<h2 className="sr-only">Local posts</h2>
			{/* Tabs */}
			<Tabs
				value={activeTab}
				onValueChange={(v) => setActiveTab(v as ShoutboxCategory)}
				className="flex-1 flex flex-col min-h-0"
			>
				<TabsList className="w-full justify-start rounded-none border-b bg-transparent h-auto p-0 overflow-x-auto flex-shrink-0">
					{SHOUTBOX_CATEGORIES.map((config) => (
						<TabsTrigger
							key={config.id}
							value={config.id}
							className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 py-2 text-xs"
						>
							<span className="mr-1">{config.icon}</span>
							<span>{config.label}</span>
						</TabsTrigger>
					))}
				</TabsList>

				{SHOUTBOX_CATEGORIES.map((config) => (
					<TabsContent
						key={config.id}
						value={config.id}
						className="flex-1 mt-0 min-h-0 data-[state=inactive]:hidden"
					>
						<CategoryTab config={config} developerPubkey={developerPubkey} />
					</TabsContent>
				))}
			</Tabs>
		</div>
	)
}
