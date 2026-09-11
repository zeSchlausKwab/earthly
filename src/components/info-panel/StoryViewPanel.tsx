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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CommentsPanel } from '@/features/social/comments'
import { StoryProposalsPanel } from '@/features/social/proposals'
import type { Article } from '@/lib/nostr/article'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import { getStoryReaderPath } from '@/lib/nostr/story/routes'
import { navigateEarthly } from '@/router/navigation'
import type { EarthlyObjectTab } from '@/router/routeContract'
import {
	buildFallbackStoryPresentation,
	drivingStoryViewIndexes,
	getUsableMapPresentation,
	parseMapPresentation,
	reduceStoryMarkdownViews,
	scrollStoryViewIntoView,
	type StoryViewSnapshotV1,
} from '@/lib/map-presentation'
import { RichContentRenderer } from '../editor'
import type { GeoFeatureItem } from '../editor/GeoRichTextEditor'
import { AspectRatio } from '../ui/aspect-ratio'
import { Button } from '../ui/button'
import { ConfirmDeleteAction } from './ConfirmDeleteAction'
import { EntityPanelSectionHeader, EntityPanelShell, EntityPanelSurface } from './EntityPanelShell'
import { ObjectTabs, ThreadTabNotice } from './ObjectTabs'
import { useObjectContentTab } from './ObjectThreadPlacement'
import { ObjectInspectLayout } from './ObjectInspectLayout'
import { UserProfile } from '@/components/user-profile'
import { GeoSocialActions } from '@/features/social/comments/GeoSocialActions'

interface StoryViewPanelProps {
	/** The Story being viewed (published Article cast). Absent ⇒ empty fallback. */
	story?: Article | null
	currentUserPubkey?: string
	onDeleteStory?: (story: Article) => void
	onEditStory?: (story: Article) => void
	onBack?: () => void
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
	onBack,
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
	onStoryViewActivate,
	renderStoryViewFigure,
	activeStoryViewId,
	objectTab,
	onObjectTabChange,
}: StoryViewPanelProps) {
	const [coverFailed, setCoverFailed] = useState(false)
	const [uncontrolledObjectTab, setUncontrolledObjectTab] = useState<EarthlyObjectTab>('details')
	const activeObjectTab = objectTab ?? uncontrolledObjectTab
	const contentTab = useObjectContentTab(activeObjectTab)
	const setActiveObjectTab = (tab: EarthlyObjectTab) => {
		if (objectTab === undefined) setUncontrolledObjectTab(tab)
		onObjectTabChange?.(tab)
	}
	const [presentIndex, setPresentIndex] = useState(-1)
	const narrativeRef = useRef<HTMLDivElement>(null)
	const storyContent = story?.article
	const viewReduction = useMemo(() => {
		const parsed = parseMapPresentation(storyContent?.presentation)
		const base =
			getUsableMapPresentation(parsed) ?? buildFallbackStoryPresentation(storyContent?.content)
		return reduceStoryMarkdownViews(base, storyContent?.content)
	}, [storyContent?.content, storyContent?.presentation])
	const drivingIndexes = drivingStoryViewIndexes(viewReduction.snapshots)
	const presentPosition = drivingIndexes.indexOf(presentIndex)

	// biome-ignore lint/correctness/useExhaustiveDependencies: a different Story resets step navigation.
	useEffect(() => {
		setPresentIndex(-1)
	}, [story?.id, story?.dTag])

	const activateView = (index: number | undefined, scroll = false) => {
		if (index === undefined) return
		const snapshot = viewReduction.snapshots[index]
		if (!snapshot || snapshot.view.display === 'figure') return
		setPresentIndex(index)
		onStoryViewActivate?.(snapshot, index)
		if (scroll) scrollStoryViewIntoView(narrativeRef.current, index)
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
		<ObjectInspectLayout
			contained={contentTab === 'comments'}
			kind="Story"
			title={title}
			state={`published · ${formatRelativeDate(story.created_at)}`}
			author={<UserProfile pubkey={story.pubkey} mode="avatar-name" size="xs" showNip05Badge={false} />}
			onBack={onBack}
			social={<GeoSocialActions target={story} compact showShareButton onReplyClick={() => setActiveObjectTab('comments')} />}
			actions={
								<div className="flex flex-wrap items-center gap-1.5">
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
									{drivingIndexes.length > 0 && onStoryViewActivate && (
										<Button
											type="button"
											variant={presentIndex >= 0 ? 'default' : 'outline'}
											size="sm"
											onClick={() =>
												activateView(presentPosition >= 0 ? presentIndex : drivingIndexes[0], true)
											}
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
									) : onEditStory ? (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => onEditStory(story)}
											className="gap-1 rounded-none px-2 text-[11px]"
										>
											<PencilLine className="h-3 w-3" />
											Propose an edit
										</Button>
									) : null}
								</div>
			}
			tabs={<ObjectTabs value={activeObjectTab} onValueChange={setActiveObjectTab} />}
		>
			{contentTab === 'details' ? (
				<div ref={narrativeRef} className="space-y-3 text-[13px]">
					<EntityPanelSurface tone="context" className="space-y-3">


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

						{presentPosition >= 0 && drivingIndexes.length > 0 && (
							<nav
								aria-label="Story map presentation"
								className="sticky top-0 z-10 flex items-center justify-between border border-primary/40 bg-background px-2 py-1.5"
							>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="gap-1 rounded-none px-2 text-xs"
									disabled={presentPosition <= 0}
									onClick={() => activateView(drivingIndexes[presentPosition - 1], true)}
								>
									<ChevronLeft className="h-3.5 w-3.5" /> Previous
								</Button>
								<span className="font-mono text-xs text-muted-foreground">
									{presentPosition + 1} / {drivingIndexes.length}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="gap-1 rounded-none px-2 text-xs"
									disabled={presentPosition >= drivingIndexes.length - 1}
									onClick={() => activateView(drivingIndexes[presentPosition + 1], true)}
								>
									Next <ChevronRight className="h-3.5 w-3.5" />
								</Button>
							</nav>
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
			) : contentTab === 'comments' ? (
				<EntityPanelSurface tone="discussion" className="h-full min-h-0 px-0 py-2">
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
		</ObjectInspectLayout>
	)
}
