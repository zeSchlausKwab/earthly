/**
 * StoryProposalsPanel (STORY-06) — the author-side "Proposed edits" surface for a
 * published Story. The narrative analog of {@link ProposalsPanel}, wired over
 * {@link useStoryProposals} instead of `useGeoProposals`.
 *
 * When there are pending proposals, an amber `Alert variant="default"` banner
 * invites review (NOT a destructive/error tone — a proposal is an invitation, not
 * a problem; UI-SPEC §7 Color). Each proposal is a **Review edit** row that expands
 * a diff preview: the proposed Markdown rendered through the sanitized
 * `RichContentRenderer` (T-10-11 — the SAME sanitized path as the live narrative;
 * the author never previews raw HTML) alongside the current body. The accent
 * **Accept edit** (`bg-primary`) republishes the Story in place via `editStory`
 * (re-deriving `a` tags, preserving the `d`-tag lineage); the destructive-toned
 * **Reject** dismisses. The proposed body is never injected as raw HTML — it only
 * ever renders through the sanitized renderer.
 */

import {
	Check,
	ChevronDown,
	ChevronRight,
	GitPullRequest,
	MessageSquareWarning,
	X,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RichContentRenderer } from '@/components/editor'
import type { GeoFeatureItem } from '@/components/editor'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { UserProfile } from '@/components/user-profile'
import type { Article } from '@/lib/nostr/article'
import type { GeoProposal } from '@/lib/nostr/geo-proposal'
import { GeoCommentForm } from '../comments'
import { useStoryProposals, type StoryProposalWithStatus } from '../hooks/useStoryProposals'

interface StoryProposalsPanelProps {
	/** The Story to show proposed narrative edits for. */
	target: Article | null
	currentUserPubkey?: string
	availableFeatures?: GeoFeatureItem[]
	className?: string
	/** Called with the republished Story after an accepted edit, so the view refreshes in place. */
	onStoryUpdated?: (updated: Article) => void
}

function formatTimeAgo(createdAt?: number): string {
	if (!createdAt) return 'Unknown time'
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

interface StoryProposalCardProps {
	proposalWithStatus: StoryProposalWithStatus
	currentBody: string
	isOwner: boolean
	isExpanded: boolean
	availableFeatures: GeoFeatureItem[]
	onToggleExpanded: () => void
	onAccept: () => void
	onReject: () => void
	/** Close with a reason — derives to the shared `needs_changes` review state,
	 *  exactly like Dataset proposals (same status event + reason content). */
	onRequestChanges: (reason: string) => Promise<void>
}

function StoryProposalCard({
	proposalWithStatus,
	currentBody,
	isOwner,
	isExpanded,
	availableFeatures,
	onToggleExpanded,
	onAccept,
	onReject,
	onRequestChanges,
}: StoryProposalCardProps) {
	const { proposal, status } = proposalWithStatus
	const proposedBody = proposal.content
	const [showChangesNeededForm, setShowChangesNeededForm] = useState(false)

	const handleSubmitChangesNeeded = useCallback(
		async (text: string) => {
			const reason = text.trim()
			if (!reason) return
			await onRequestChanges(reason)
			setShowChangesNeededForm(false)
		},
		[onRequestChanges],
	)

	return (
		<Collapsible open={isExpanded} onOpenChange={onToggleExpanded}>
			<div className="rounded-none border border-border bg-card transition-colors hover:border-border/80">
				<CollapsibleTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						className="flex h-auto w-full items-center justify-start gap-2 px-2.5 py-2 text-left"
					>
						{isExpanded ? (
							<ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
						) : (
							<ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
						)}
						<div className="flex min-w-0 flex-1 items-center gap-2">
							<UserProfile
								pubkey={proposal.pubkey}
								mode="avatar-name"
								size="xs"
								showNip05Badge={false}
								interactive={false}
							/>
							<span className="flex-shrink-0 text-[10px] text-muted-foreground">
								{formatTimeAgo(proposal.created_at)}
							</span>
						</div>
						<span className="flex-shrink-0 text-[11px] font-medium text-primary">Review edit</span>
					</Button>
				</CollapsibleTrigger>

				<CollapsibleContent>
					<div className="space-y-3 px-2.5 pb-3">
						{/* Diff preview: proposed (sanitized) alongside the current narrative.
						    Both render ONLY through RichContentRenderer — the proposed body is
						    exactly as XSS-safe as the live story (T-10-11). */}
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="space-y-1">
								<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
									Proposed
								</p>
								<RichContentRenderer
									content={proposedBody}
									availableFeatures={availableFeatures}
									emptyState="The proposed edit has no narrative."
									className="rounded-none border border-primary/40 bg-primary/5 p-2 text-xs"
								/>
							</div>
							<div className="space-y-1">
								<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
									Current
								</p>
								<RichContentRenderer
									content={currentBody}
									availableFeatures={availableFeatures}
									emptyState="This story has no narrative yet."
									className="rounded-none border border-border bg-muted/30 p-2 text-xs"
								/>
							</div>
						</div>

						{/* Same review verbs as Dataset proposals (workflow audit P2):
						    Accept / Request changes / Reject, with the reasoned close
						    deriving to the shared needs_changes state. */}
						{isOwner && status === 'open' && (
							<div className="flex flex-wrap items-center justify-end gap-2">
								<Button
									type="button"
									variant={showChangesNeededForm ? 'default' : 'outline'}
									size="sm"
									onClick={() => setShowChangesNeededForm((prev) => !prev)}
									className="h-7 gap-1.5 rounded-none px-2 text-[11px]"
								>
									<MessageSquareWarning className="h-3.5 w-3.5" />
									Request changes
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={onReject}
									className="h-7 gap-1.5 rounded-none border-destructive/40 px-2 text-[11px] text-destructive hover:bg-destructive/10"
								>
									<X className="h-3.5 w-3.5" />
									Reject
								</Button>
								<Button
									type="button"
									size="sm"
									onClick={onAccept}
									className="h-7 gap-1.5 rounded-none bg-primary px-2 text-[11px] text-primary-foreground"
								>
									<Check className="h-3.5 w-3.5" />
									Accept
								</Button>
							</div>
						)}

						{isOwner && status === 'open' && showChangesNeededForm && (
							<div className="rounded-none border border-destructive/40 bg-destructive/10 p-2">
								<p className="mb-2 text-[11px] font-medium text-destructive">
									Describe what should be changed before this can be accepted.
								</p>
								<GeoCommentForm
									onSubmit={handleSubmitChangesNeeded}
									onCancel={() => setShowChangesNeededForm(false)}
									placeholder="What needs to change?"
								/>
							</div>
						)}
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	)
}

export function StoryProposalsPanel({
	target,
	currentUserPubkey,
	availableFeatures = [],
	className = '',
	onStoryUpdated,
}: StoryProposalsPanelProps) {
	const { proposals, openCount, acceptStoryProposal, rejectStoryProposal } = useStoryProposals({
		target,
	})
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

	const isOwner = !!(currentUserPubkey && target?.pubkey && currentUserPubkey === target.pubkey)
	const currentBody = target?.article.content ?? ''

	const toggleExpanded = useCallback((id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}, [])

	const handleAccept = useCallback(
		async (proposal: GeoProposal) => {
			try {
				const updated = await acceptStoryProposal(proposal)
				// Refresh the viewed Story in place so the body updates without a reload.
				onStoryUpdated?.(updated)
				toast.success('Edit applied — your story is updated.')
			} catch (error) {
				console.error('Failed to accept proposed edit', error)
				toast.error(
					error instanceof Error ? error.message : "Couldn't apply this proposed edit. Try again.",
				)
			}
		},
		[acceptStoryProposal, onStoryUpdated],
	)

	const handleReject = useCallback(
		async (proposal: GeoProposal) => {
			try {
				await rejectStoryProposal(proposal)
				toast.success('Proposed edit rejected — your story stays as-is.')
			} catch (error) {
				console.error('Failed to reject proposed edit', error)
				toast.error(
					error instanceof Error ? error.message : "Couldn't reject this proposed edit. Try again.",
				)
			}
		},
		[rejectStoryProposal],
	)

	// A reasoned close is the shared "changes requested" state — identical to the
	// Dataset review model (same status event; the reason rides in its content).
	const handleRequestChanges = useCallback(
		async (proposal: GeoProposal, reason: string) => {
			try {
				await rejectStoryProposal(proposal, reason)
				toast.success('Changes requested — the contributor can see your note.')
			} catch (error) {
				console.error('Failed to request changes on proposed edit', error)
				toast.error(error instanceof Error ? error.message : "Couldn't request changes. Try again.")
			}
		},
		[rejectStoryProposal],
	)

	const openProposals = useMemo(() => proposals.filter((p) => p.status === 'open'), [proposals])

	// Only the Story author sees the Proposed-edits surface.
	if (!target || !isOwner) return null

	return (
		<div className={`flex flex-col gap-3 ${className}`}>
			<div className="flex items-center gap-2">
				<GitPullRequest className="h-4 w-4 text-muted-foreground" />
				<h3 className="text-sm font-semibold text-foreground">Proposed edits</h3>
			</div>

			{openCount > 0 && (
				<Alert variant="default" className="border-primary/40 bg-primary/10 text-primary">
					<AlertTitle>
						{openCount} proposed edit{openCount === 1 ? '' : 's'} to review
					</AlertTitle>
					<AlertDescription className="text-primary">
						A reader suggested a change to your story. Review the edit, then accept or decline it.
					</AlertDescription>
				</Alert>
			)}

			{openProposals.length === 0 ? (
				<div className="rounded-none border border-dashed border-border p-4 text-center">
					<p className="text-sm font-medium text-foreground">No proposed edits</p>
					<p className="mt-1 text-xs text-muted-foreground">
						When a reader suggests a change, it'll appear here for you to review.
					</p>
				</div>
			) : (
				<div className="space-y-2">
					{openProposals.map((pw) => {
						const id = pw.proposal.id ?? pw.proposal.proposalId ?? ''
						return (
							<StoryProposalCard
								key={id}
								proposalWithStatus={pw}
								currentBody={currentBody}
								isOwner={isOwner}
								isExpanded={expandedIds.has(id)}
								availableFeatures={availableFeatures}
								onToggleExpanded={() => toggleExpanded(id)}
								onAccept={() => handleAccept(pw.proposal)}
								onReject={() => handleReject(pw.proposal)}
								onRequestChanges={(reason) => handleRequestChanges(pw.proposal, reason)}
							/>
						)
					})}
				</div>
			)}
		</div>
	)
}
