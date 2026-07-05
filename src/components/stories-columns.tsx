import type { ColumnDef } from '@tanstack/react-table'
import { BookOpen } from 'lucide-react'
import {
	DeleteActionIcon,
	InspectActionIcon,
	LoadEditorActionIcon,
} from '@/components/entity-action-icons'
import { CoverThumb, ListRow, RowActionButton, RowBadge } from '@/components/entity-list'
import { GeoSocialActions } from '@/features/social/comments/GeoSocialActions'
import { UserProfile } from '@/components/user-profile'
import type { Article } from '@/lib/nostr/article'
import { formatRelativeDate } from '@/lib/nostr/temporal-sighting'

export interface StoryRowData {
	story: Article
	hasLocalDraft: boolean
	/** True when the signed-in user authored this Story — gates Edit/Delete. */
	isOwner: boolean
	isDeleting: boolean
}

export interface StoryColumnsContext {
	onOpen: (story: Article) => void
	onEdit: (story: Article) => void
	onDelete: (story: Article) => void
}

export const createStoryColumns = (context: StoryColumnsContext): ColumnDef<StoryRowData>[] => [
	{
		accessorKey: 'story',
		cell: ({ row }) => {
			const { story, hasLocalDraft, isOwner, isDeleting } = row.original
			const content = story.article
			const title = content.title?.trim() || 'Untitled'
			const image = content.image?.trim()

			return (
				<ListRow
					leading={
						<CoverThumb
							src={image}
							alt=""
							fallbackIcon={BookOpen}
							fallbackClassName="bg-info/15 text-info"
						/>
					}
					title={title}
					onTitleClick={() => context.onOpen(story)}
					titleAriaLabel={`Open story ${title}`}
					titleTitle="Open story"
					badges={
						hasLocalDraft ? (
							<RowBadge label="Draft" className="border border-border text-muted-foreground" />
						) : (
							<RowBadge label="Published" className="bg-muted text-muted-foreground" />
						)
					}
					meta={
						<>
							<UserProfile
								pubkey={story.pubkey}
								mode="name-only"
								size="sm"
								showNip05Badge={false}
							/>
							<span>·</span>
							<span>{formatRelativeDate(story.created_at)}</span>
						</>
					}
					engage={
						<GeoSocialActions
							target={story}
							onReplyClick={() => context.onOpen(story)}
							showCommentButton
							showAnnotateButton={false}
							loadCounts={false}
							compact
							className="-ml-2 shrink-0 gap-0"
						/>
					}
					actions={
						<>
							<RowActionButton
								icon={InspectActionIcon}
								label="Open story"
								hover="hover:text-ok"
								onClick={() => context.onOpen(story)}
							/>
							{isOwner ? (
								<>
									<RowActionButton
										icon={LoadEditorActionIcon}
										label="Edit story"
										disabled={isDeleting}
										onClick={() => context.onEdit(story)}
									/>
									<RowActionButton
										icon={DeleteActionIcon}
										label="Delete story"
										hover="hover:text-destructive"
										disabled={isDeleting}
										onClick={() => context.onDelete(story)}
									/>
								</>
							) : null}
						</>
					}
				/>
			)
		},
	},
]
