/**
 * StoriesPanelContent — the Stories browse rail panel body (Phase 10, D-01/D-02).
 *
 * The structural twin of `GeoDatasetsPanelContent`: it subscribes to kind-37520
 * Stories via `useStories()` (which `isArticle`-filters BEFORE cast, so a malformed/
 * legacy/forged 37520 never reaches a row — T-10-06), feeds the casts through the
 * same `useFilterState` + `useSortedFilteredItems` browse hooks, and renders the
 * `EntitySearchToolbar` search/sort header.
 *
 * An accent **New Story** button (`--primary`, reserved) sits at the TOP of the
 * panel (mirrors the Datasets/Groups create affordance, closing the Phase-9
 * discoverability gap). Each row is a `rounded-none` `Card`: a 16:9 cover thumbnail
 * (neutral placeholder on missing/error — cover renders as a plain `<img src>`, no
 * HTML injection sink; title is an auto-escaped React text node — T-10-05),
 * a title, author/date meta, a Draft/Published status `Badge`,
 * and an inline action footer matching the dataset/context catalog rows: a compact
 * `GeoSocialActions` bar (like / zap / comment / share — Share copies the deep link)
 * plus inspect/edit/delete buttons (edit + delete owner-gated). Loading shows
 * skeleton rows; empty shows the UI-SPEC empty states.
 *
 * Rail destination wiring (AppSidebar / GeoEditorInfoPanel mounts) is Plan 03 — this
 * plan delivers only the panel body component + its props contract.
 */

import { useMemo } from 'react'
import { useStories } from '@/lib/hooks/useStories'
import type { Article } from '@/lib/nostr/article'
import { readStoryDraft } from '@/lib/nostr/story'
import { cn } from '@/lib/utils'
import {
	DeleteActionIcon,
	InspectActionIcon,
	LoadEditorActionIcon,
} from '@/components/entity-action-icons'
import { GeoSocialActions } from '@/features/social/comments/GeoSocialActions'
import { UserProfile } from '@/components/user-profile'
import { useFilterState, useSortedFilteredItems, type FilterConfig } from './data-filter'
import { EntitySearchToolbar } from './entity-search'
import { AspectRatio } from './ui/aspect-ratio'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { Skeleton } from './ui/skeleton'

/** Shared ghost-button styling for the inline per-row action cluster (matches the
 * dataset/context catalog rows so every entity surface exposes the same affordances). */
const actionButtonClass =
	'rounded-none px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-info'

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

function formatRelativeDate(createdAt?: number): string {
	if (!createdAt) return ''
	const date = new Date(createdAt * 1000)
	const diffMs = Date.now() - date.getTime()
	const diffMins = Math.floor(diffMs / 60000)
	const diffHours = Math.floor(diffMs / 3600000)
	const diffDays = Math.floor(diffMs / 86400000)
	if (diffMins < 1) return 'just now'
	if (diffMins < 60) return `${diffMins}m ago`
	if (diffHours < 24) return `${diffHours}h ago`
	if (diffDays < 7) return `${diffDays}d ago`
	return date.toLocaleDateString()
}

interface StoryRowProps {
	story: Article
	hasLocalDraft: boolean
	isDeleting: boolean
	/** True when the signed-in user authored this Story — gates Edit/Delete. */
	isOwner: boolean
	onOpen: () => void
	onEdit: () => void
	onDelete: () => void
}

function StoryRow({
	story,
	hasLocalDraft,
	isDeleting,
	isOwner,
	onOpen,
	onEdit,
	onDelete,
}: StoryRowProps) {
	const content = story.article
	const title = content.title?.trim() || 'Untitled'
	const image = content.image?.trim()

	return (
		<Card size="sm" className="rounded-none ring-1 ring-border">
			{/* Compact, dataset/context-density layout: a small cover thumb beside the
			    title + status, author/date below, social + actions at the bottom. The
			    full summary lives in the detail view. */}
			<div className="space-y-1 p-2.5">
				<button
					type="button"
					onClick={onOpen}
					className="flex w-full min-w-0 items-center gap-2.5 text-left"
				>
					<div className="w-12 shrink-0">
						<AspectRatio ratio={16 / 9} className="overflow-hidden border border-border bg-muted">
							{image ? (
								<img
									src={image}
									alt=""
									className="h-full w-full object-cover"
									onError={(event) => {
										event.currentTarget.style.display = 'none'
									}}
								/>
							) : null}
						</AspectRatio>
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
								{title}
							</p>
							{hasLocalDraft ? (
								<Badge variant="outline" className="shrink-0 rounded-none text-[11px]">
									Draft
								</Badge>
							) : (
								<Badge variant="secondary" className="shrink-0 rounded-none text-[11px]">
									Published
								</Badge>
							)}
						</div>
						<div className="flex items-center gap-1 text-[11px] text-muted-foreground">
							<UserProfile
								pubkey={story.pubkey}
								mode="name-only"
								size="sm"
								showNip05Badge={false}
							/>
							<span>·</span>
							<span>{formatRelativeDate(story.created_at)}</span>
						</div>
					</div>
				</button>

				{/* Inline social + action cluster — parity with the dataset/context rows:
				    like / zap / comment / share on the left (Share copies the deep link,
				    replacing the old "Copy link" menu item), inspect/edit/delete on the
				    right (edit + delete owner-gated). */}
				<div className="flex min-w-0 items-center justify-between gap-3">
					<GeoSocialActions
						target={story}
						onReplyClick={onOpen}
						showCommentButton
						showAnnotateButton={false}
						loadCounts={false}
						compact
						className="-ml-2 shrink-0 gap-0"
					/>
					<div className="flex shrink-0 items-center gap-0.5">
						<Button
							size="icon-sm"
							variant="ghost"
							className={cn(actionButtonClass, 'hover:text-ok')}
							onClick={onOpen}
							aria-label="Open story"
							title="Open story"
						>
							<InspectActionIcon className="h-4 w-4" />
						</Button>
						{isOwner ? (
							<>
								<Button
									size="icon-sm"
									variant="ghost"
									className={cn(actionButtonClass, 'hover:text-info')}
									onClick={onEdit}
									disabled={isDeleting}
									aria-label="Edit story"
									title="Edit story"
								>
									<LoadEditorActionIcon className="h-4 w-4" />
								</Button>
								<Button
									size="icon-sm"
									variant="ghost"
									className={cn(actionButtonClass, 'hover:text-destructive')}
									onClick={onDelete}
									disabled={isDeleting}
									aria-label="Delete story"
									title="Delete story"
								>
									<DeleteActionIcon className="h-4 w-4" />
								</Button>
							</>
						) : null}
					</div>
				</div>
			</div>
		</Card>
	)
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

	const hasSearch = filterState.searchQuery.trim().length > 0

	return (
		<div className="space-y-3">
			<Button
				onClick={onCreateStory}
				className="w-full rounded-none bg-primary text-primary-foreground"
			>
				New Story
			</Button>

			<EntitySearchToolbar
				{...filterState}
				totalCount={result.totalCount}
				filteredCount={result.filteredCount}
				displayedCount={result.displayedCount}
				hasMore={result.hasMore}
				placeholder="Search stories…"
			/>

			{!eose && stories.length === 0 ? (
				<div className="space-y-2">
					{[0, 1, 2].map((key) => (
						<Skeleton key={key} className="h-20 w-full rounded-none" />
					))}
				</div>
			) : displayed.length === 0 ? (
				<Empty className="rounded-none">
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
				<div className="space-y-2">
					{displayed.map((story) => {
						const dTag = story.dTag ?? story.id
						return (
							<StoryRow
								key={dTag}
								story={story}
								hasLocalDraft={Boolean(story.dTag && draftKeys.has(story.dTag))}
								isDeleting={deletingKey === dTag}
								isOwner={Boolean(currentUserPubkey) && story.pubkey === currentUserPubkey}
								onOpen={() => onOpenStory(story)}
								onEdit={() => onEditStory(story)}
								onDelete={() => onDeleteStory(story)}
							/>
						)
					})}
				</div>
			)}
		</div>
	)
}
