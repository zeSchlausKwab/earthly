/**
 * StoryViewPanel — the reader-facing view surface for a kind-37520 Story
 * (NIP-23 long-form geo narrative; Phase 10, STORY-02 render + STORY-05).
 *
 * The structural twin of `GroupViewPanel`, copied with Article substituted for Group
 * and the Group-only CuratedLane/ForeignLane two-lane machinery STRIPPED — a Story is
 * a closed/curated narrative, so there is no foreign-attach lane. The main map stays
 * the canvas (D-03); the panel renders in the right info-panel column.
 *
 * The Markdown narrative renders ONLY through the sanitized `RichContentRenderer`
 * (T-10-07: no `dangerouslySetInnerHTML`, no raw HTML). Inline `nostr:naddr…` geo-refs
 * render in place with an eye-toggle (Show/Hide on map) and a fly-to button via the
 * renderer's existing inline-ref machinery — refs default HIDDEN on load (the renderer
 * starts each chip hidden and only emits a visibility toggle when the reader opts in;
 * opening a Story never auto-dumps attacker-controllable targets onto the map — T-10-08).
 *
 * A `CommentsPanel` mounts against the Story's 37520 coordinate for comment + react
 * (STORY-05), exactly as Phase 9 mounted it on Groups — zero new comment UI.
 */

import {
	BookOpen,
	ChevronLeft,
	ChevronRight,
	LocateFixed,
	Pencil,
	PencilLine,
	Play,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CommentsPanel } from '@/features/social/comments'
import { StoryProposalsPanel, StoryProposeEditDialog } from '@/features/social/proposals'
import type { Article } from '@/lib/nostr/article'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import { getStoryReaderPath } from '@/lib/nostr/story/routes'
import { navigateEarthly } from '@/router/navigation'
import type { EarthlyObjectTab } from '@/router/routeContract'
import {
	getUsableMapPresentation,
	parseMapPresentation,
	reduceStoryMarkdownViews,
	type StoryViewSnapshotV1,
} from '@/lib/map-presentation'
import { RichContentRenderer } from '../editor'
import type { GeoFeatureItem } from '../editor/GeoRichTextEditor'
import { AspectRatio } from '../ui/aspect-ratio'
import { Button } from '../ui/button'
import { ConfirmDeleteAction } from './ConfirmDeleteAction'
import { EntityPanelSectionHeader, EntityPanelShell, EntityPanelSurface } from './EntityPanelShell'
import { ObjectTabs, ThreadTabNotice } from './ObjectTabs'

interface StoryViewPanelProps {
	/** The Story being viewed (published Article cast). Absent ⇒ empty fallback. */
	story?: Article | null
	currentUserPubkey?: string
	onDeleteStory?: (story: Article) => void
	onEditStory?: (story: Article) => void
	/** Fly the map to this Story's footprint (the inspect-panel "Zoom to" button). */
	onZoomTo?: () => void
	/** The d-tag key of a Story whose delete is in flight. */
	deletingKey?: string | null
	availableFeatures?: GeoFeatureItem[]
	/** Show/hide a comment's attached geojson annotation on the map. */
	onCommentGeometryVisibility?: (comment: GeoComment, visible: boolean) => void
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	/** Map-stack-derived visibility for inline narrative refs (single source of truth). */
	isMentionVisible?: (address: string, featureId: string | undefined) => boolean
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	/** Called with the republished Story after an accepted proposed edit, to refresh the view in place. */
	onStoryUpdated?: (updated: Article) => void
	focusCommentId?: string
	/**
	 * Controlled proposal-dialog state. Route controllers use this to materialize
	 * a direct `/story/:naddr/edit` request for a non-owner reader.
	 */
	proposeEditOpen?: boolean
	/** Initial proposal-dialog state for an otherwise uncontrolled panel. */
	defaultProposeEditOpen?: boolean
	/** Receives both local button actions and controlled dialog dismissals. */
	onProposeEditOpenChange?: (open: boolean) => void
	/** Receives the cumulative state at the clicked/presented physical view. */
	onStoryViewActivate?: (snapshot: StoryViewSnapshotV1, index: number) => void
	/** Caller-supplied live-map figure using the same presentation runtime as the main canvas. */
	renderStoryViewFigure?: (snapshot: StoryViewSnapshotV1, index: number) => ReactNode
	activeStoryViewId?: string | null
	/** Route-backed social-object tab. Omit to let the panel manage it locally. */
	objectTab?: EarthlyObjectTab
	onObjectTabChange?: (tab: EarthlyObjectTab) => void
}

function formatRelativeDate(createdAt?: number): string {
	if (!createdAt) return ''
	const date = new Date(createdAt * 1000)
	const diffMs = Date.now() - date.getTime()
	const diffMins = Math.floor(diffMs / 60000)
	const diffHours = Math.floor(diffMins / 60)
	const diffDays = Math.floor(diffHours / 24)
	if (diffMins < 1) return 'just now'
	if (diffMins < 60) return `${diffMins}m ago`
	if (diffHours < 24) return `${diffHours}h ago`
	if (diffDays < 7) return `${diffDays}d ago`
	return date.toLocaleDateString()
}

export function StoryViewPanel({
	story,
	currentUserPubkey,
	onDeleteStory,
	onEditStory,
	onZoomTo,
	deletingKey,
	availableFeatures = [],
	onCommentGeometryVisibility,
	onMentionVisibilityToggle,
	onMentionZoomTo,
	isMentionVisible,
	onZoomToBounds,
	onStoryUpdated,
	focusCommentId,
	proposeEditOpen,
	defaultProposeEditOpen = false,
	onProposeEditOpenChange,
	onStoryViewActivate,
	renderStoryViewFigure,
	activeStoryViewId,
	objectTab,
	onObjectTabChange,
}: StoryViewPanelProps) {
	const [coverFailed, setCoverFailed] = useState(false)
	const [uncontrolledObjectTab, setUncontrolledObjectTab] = useState<EarthlyObjectTab>('details')
	const activeObjectTab = objectTab ?? uncontrolledObjectTab
	const setActiveObjectTab = (tab: EarthlyObjectTab) => {
		if (objectTab === undefined) setUncontrolledObjectTab(tab)
		onObjectTabChange?.(tab)
	}
	const [uncontrolledProposeOpen, setUncontrolledProposeOpen] = useState(defaultProposeEditOpen)
	const proposalDialogOpen = proposeEditOpen ?? uncontrolledProposeOpen
	const setProposalDialogOpen = (open: boolean) => {
		if (proposeEditOpen === undefined) setUncontrolledProposeOpen(open)
		onProposeEditOpenChange?.(open)
	}
	const [presentIndex, setPresentIndex] = useState(-1)
	const storyContent = story?.article
	const viewReduction = useMemo(() => {
		const parsed = parseMapPresentation(storyContent?.presentation)
		const base = getUsableMapPresentation(parsed) ?? { version: 1 as const, layers: [] }
		return reduceStoryMarkdownViews(base, storyContent?.content)
	}, [storyContent?.content, storyContent?.presentation])

	// biome-ignore lint/correctness/useExhaustiveDependencies: a different Story resets step navigation.
	useEffect(() => {
		setPresentIndex(-1)
	}, [story?.id, story?.dTag])

	const activateView = (index: number) => {
		const snapshot = viewReduction.snapshots[index]
		if (!snapshot) return
		setPresentIndex(index)
		onStoryViewActivate?.(snapshot, index)
	}

	if (!story) {
		return (
			<EntityPanelShell title="No story selected">
				<EntityPanelSurface tone="neutral">
					<p className="text-sm text-muted-foreground">
						No story selected. Pick a story from the Stories panel, or start a new one.
					</p>
				</EntityPanelSurface>
			</EntityPanelShell>
		)
	}

	const content = storyContent ?? story.article
	const title = content.title?.trim() || story.dTag || 'Untitled Story'
	const isOwner = !!currentUserPubkey && currentUserPubkey === story.pubkey
	const storyKey = story.dTag ?? story.id ?? null
	const isDeleting = storyKey ? deletingKey === `story:${storyKey}` : false
	const showCover = Boolean(content.image?.trim()) && !coverFailed
	const readerPath = getStoryReaderPath(story)

	return (
		<EntityPanelShell
			title={title}
			tabs={<ObjectTabs value={activeObjectTab} onValueChange={setActiveObjectTab} />}
		>
			{activeObjectTab === 'details' ? (
				<div className="space-y-3 text-[13px]">
					<EntityPanelSurface tone="context" className="space-y-3">
						<EntityPanelSectionHeader
							eyebrow="Story"
							title={title}
							description={formatRelativeDate(story.created_at)}
							action={
								<div className="flex items-center gap-2">
									{readerPath && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => navigateEarthly(readerPath)}
											className="gap-1 rounded-none px-2 text-[11px]"
										>
											<BookOpen className="h-3 w-3" />
											Read
										</Button>
									)}
									{viewReduction.snapshots.length > 0 && onStoryViewActivate && (
										<Button
											type="button"
											variant={presentIndex >= 0 ? 'default' : 'outline'}
											size="sm"
											onClick={() => activateView(presentIndex >= 0 ? presentIndex : 0)}
											className="gap-1 rounded-none px-2 text-[11px]"
										>
											<Play className="h-3 w-3" />
											Present
										</Button>
									)}
									{onZoomTo && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={onZoomTo}
											className="gap-1 rounded-none px-2 text-[11px]"
											title="Zoom to on map"
										>
											<LocateFixed className="h-3 w-3" />
											Zoom
										</Button>
									)}
									{isOwner ? (
										<>
											{onEditStory && (
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => onEditStory(story)}
													className="gap-1 rounded-none px-2 text-[11px]"
												>
													<Pencil className="h-3 w-3" />
													Edit
												</Button>
											)}
											{onDeleteStory && (
												<ConfirmDeleteAction
													label="story"
													isDeleting={isDeleting}
													onConfirm={() => onDeleteStory(story)}
												/>
											)}
										</>
									) : (
										// A reader (non-owner) can propose a narrative edit (STORY-06). The
										// dialog opens the body in an edit affordance and submits a
										// kind-37519 Markdown-content proposal targeting this Story.
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => setProposalDialogOpen(true)}
											className="gap-1 rounded-none px-2 text-[11px]"
										>
											<PencilLine className="h-3 w-3" />
											Propose an edit
										</Button>
									)}
								</div>
							}
						/>

						{showCover && (
							<AspectRatio ratio={16 / 9} className="overflow-hidden border border-border bg-muted">
								{/* Cover renders as a plain <img src> — no HTML injection sink. Falls
							    back to a neutral placeholder frame on error. */}
								<img
									src={content.image}
									alt=""
									loading="lazy"
									className="h-full w-full object-cover"
									onError={() => setCoverFailed(true)}
								/>
							</AspectRatio>
						)}

						{/* Narrative — sanitized render only; inline refs default HIDDEN, each carries
					    its own eye-toggle (show/hide on main map) + fly-to (T-10-07/T-10-08). */}
						<RichContentRenderer
							content={content.content ?? ''}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							isMentionVisible={isMentionVisible}
							emptyState="This story has no narrative yet."
							onStoryViewActivate={(_view, index) => activateView(index)}
							renderStoryViewFigure={
								renderStoryViewFigure
									? (_view, index) => {
											const snapshot = viewReduction.snapshots[index]
											return snapshot ? renderStoryViewFigure(snapshot, index) : null
										}
									: undefined
							}
							activeStoryViewId={
								activeStoryViewId ?? viewReduction.snapshots[presentIndex]?.view.id ?? null
							}
						/>
						{presentIndex >= 0 && viewReduction.snapshots.length > 0 && (
							<div className="flex items-center justify-between border border-primary/40 bg-primary/10 px-2 py-1.5">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 gap-1 rounded-none px-2 text-[10px]"
									disabled={presentIndex <= 0}
									onClick={() => activateView(presentIndex - 1)}
								>
									<ChevronLeft className="h-3.5 w-3.5" /> Previous
								</Button>
								<span className="font-mono text-[10px] text-muted-foreground">
									{presentIndex + 1} / {viewReduction.snapshots.length}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 gap-1 rounded-none px-2 text-[10px]"
									disabled={presentIndex >= viewReduction.snapshots.length - 1}
									onClick={() => activateView(presentIndex + 1)}
								>
									Next <ChevronRight className="h-3.5 w-3.5" />
								</Button>
							</div>
						)}
					</EntityPanelSurface>

					{/* Author-side Proposed edits (STORY-06). The panel self-gates on ownership and
				    renders nothing for a non-owner; the reader instead gets the Propose-an-edit
				    button above. Accept republishes the Story in place via editStory. */}
					{isOwner && (
						<EntityPanelSurface tone="neutral" className="space-y-4">
							<StoryProposalsPanel
								target={story}
								currentUserPubkey={currentUserPubkey}
								availableFeatures={availableFeatures}
								onStoryUpdated={onStoryUpdated}
							/>
						</EntityPanelSurface>
					)}
				</div>
			) : activeObjectTab === 'comments' ? (
				<EntityPanelSurface tone="discussion" className="space-y-4">
					<EntityPanelSectionHeader eyebrow="Discussion" title="Comments" />
					<CommentsPanel
						key={story.id ?? story.dTag ?? 'no-story'}
						target={story}
						onCommentGeojsonVisibilityChange={(comment, visible) =>
							onCommentGeometryVisibility?.(comment, visible)
						}
						onZoomToCommentGeojson={(comment) => {
							if (comment.boundingBox && onZoomToBounds) onZoomToBounds(comment.boundingBox)
						}}
						availableFeatures={availableFeatures}
						onMentionVisibilityToggle={onMentionVisibilityToggle}
						onMentionZoomTo={onMentionZoomTo}
						focusCommentId={focusCommentId}
					/>
				</EntityPanelSurface>
			) : (
				<ThreadTabNotice />
			)}

			{/* Reader-side Propose-an-edit dialog (STORY-06) — only mounted for a
			    non-owner reader; submits a kind-37519 Markdown-content proposal. */}
			{!isOwner && (
				<StoryProposeEditDialog
					story={story}
					open={proposalDialogOpen}
					onOpenChange={setProposalDialogOpen}
					availableFeatures={availableFeatures}
				/>
			)}
		</EntityPanelShell>
	)
}
