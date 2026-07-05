/**
 * StoriesPanelContent — the Stories browse rail (Phase 10, D-01/D-02), rebuilt on
 * the shared entity-list grammar (redesign §11a "Four panels, one row grammar").
 *
 * It subscribes to kind-37520 Stories via `useStories()` (which `isArticle`-filters
 * BEFORE cast, so a malformed/legacy/forged 37520 never reaches a row — T-10-06),
 * feeds the casts through the shared `useFilterState` + `useSortedFilteredItems`
 * browse hooks, and renders them through the common `ListPanel` shell (header ·
 * search · body · footer) + `EntityListTable` + `createStoryColumns` `ListRow`s —
 * the same substrate as Datasets/Contexts/Sightings/Beacons.
 *
 * SECURITY (T-10-05): title is an auto-escaped React text node; the cover renders
 * as a plain `<img src>` — no HTML injection sink.
 */

import { useMemo } from 'react'
import { BookOpen } from 'lucide-react'
import { useStories } from '@/lib/hooks/useStories'
import type { Article } from '@/lib/nostr/article'
import { readStoryDraft } from '@/lib/nostr/story'
import { EntityListTable, ListPanel } from '@/components/entity-list'
import { createStoryColumns, type StoryColumnsContext, type StoryRowData } from './stories-columns'
import { useFilterState, useSortedFilteredItems, type FilterConfig } from './data-filter'
import { EntitySearchToolbar } from './entity-search'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { Skeleton } from './ui/skeleton'

export interface StoriesPanelProps {
	currentUserPubkey?: string
	onOpenStory: (story: Article) => void
	onCreateStory: () => void
	onEditStory: (story: Article) => void
	onDeleteStory: (story: Article) => void
	/** The d-tag key of a Story whose delete is in flight (disables its row menu). */
	deletingKey?: string | null
}

const storyFilterConfig: FilterConfig<Article> = {
	getSearchableText: (story) => {
		const content = story.article
		return [content.title, content.summary, story.dTag]
	},
	getName: (story) => story.article.title ?? story.dTag ?? 'Untitled',
}

export function StoriesPanelContent({
	currentUserPubkey,
	onOpenStory,
	onCreateStory,
	onEditStory,
	onDeleteStory,
	deletingKey,
}: StoriesPanelProps) {
	const filterState = useFilterState()
	const { events: stories, eose } = useStories()

	const result = useSortedFilteredItems(stories, storyFilterConfig, filterState)
	const displayed = result.items

	// Detect a local (unpublished) draft per Story so the row shows a Draft chip.
	const draftKeys = useMemo(() => {
		const keys = new Set<string>()
		for (const story of displayed) {
			const dTag = story.dTag
			if (dTag && readStoryDraft(dTag, currentUserPubkey)) keys.add(dTag)
		}
		return keys
	}, [displayed, currentUserPubkey])

	const columnsContext: StoryColumnsContext = useMemo(
		() => ({ onOpen: onOpenStory, onEdit: onEditStory, onDelete: onDeleteStory }),
		[onOpenStory, onEditStory, onDeleteStory],
	)
	const columns = useMemo(() => createStoryColumns(columnsContext), [columnsContext])

	const rows: StoryRowData[] = useMemo(
		() =>
			displayed.map((story) => {
				const dTag = story.dTag ?? story.id
				return {
					story,
					hasLocalDraft: Boolean(story.dTag && draftKeys.has(story.dTag)),
					isOwner: Boolean(currentUserPubkey) && story.pubkey === currentUserPubkey,
					isDeleting: deletingKey === dTag,
				}
			}),
		[displayed, draftKeys, currentUserPubkey, deletingKey],
	)

	const hasSearch = filterState.searchQuery.trim().length > 0

	return (
		<ListPanel
			icon={BookOpen}
			title="Stories"
			count={result.totalCount}
			onNew={onCreateStory}
			newLabel="New Story"
			toolbar={
				<EntitySearchToolbar
					{...filterState}
					totalCount={result.totalCount}
					filteredCount={result.filteredCount}
					displayedCount={result.displayedCount}
					hasMore={result.hasMore}
					placeholder="Search stories…"
				/>
			}
			footerLeft={`${rows.length} shown`}
			footerRight={draftKeys.size > 0 ? `${draftKeys.size} draft` : undefined}
		>
			{!eose && stories.length === 0 ? (
				<div className="space-y-2">
					{[0, 1, 2].map((key) => (
						<Skeleton key={key} className="h-16 w-full rounded-[3px]" />
					))}
				</div>
			) : rows.length === 0 ? (
				<Empty className="rounded-[3px]">
					<EmptyHeader>
						<EmptyTitle>{hasSearch ? 'No stories match' : 'No stories yet'}</EmptyTitle>
						<EmptyDescription>
							{hasSearch
								? 'Try a different search, or clear the filter.'
								: 'Start a story — write a narrative and weave in your datasets, places, and media.'}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<EntityListTable
					columns={columns}
					data={rows}
					getRowId={(row) => row.story.dTag ?? row.story.id}
				/>
			)}
		</ListPanel>
	)
}
