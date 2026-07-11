/**
 * StoryEditorPanel — the author-facing create/edit surface for a kind-37520 Story
 * (NIP-23 long-form geo narrative; Phase 10, STORY-01/02/03/04). The structural
 * twin of `GroupEditorPanel`, copied wholesale with Article substituted for Group.
 *
 * Metadata block (Title `Input`, Summary `Textarea`, Cover image
 * `BlossomUploaderButton` + 16:9 preview) feeds NIP-23 `title`/`summary`/`image`.
 * The Markdown body is authored in the shared TipTap `GeoRichTextEditor` (its
 * built-in `@`-mention picker / `GeoMentionExtension` / `MediaExtensions` cover the
 * STORY-02 insert half — inline `nostr:naddr…` geo-refs and image/video embeds),
 * wrapped in a Write/Preview `Tabs` pair where Preview renders ONLY through the
 * sanitized `RichContentRenderer` exactly as readers see it (T-10-04: no raw HTML,
 * no inner-HTML injection sink).
 *
 * Publish/edit goes through the Plan-01 `publishStory`/`editStory` service — NOT a
 * re-inlined ArticleFactory — which destructively re-derives the queryable `a` tags
 * from the body's inline refs on every publish (STORY-03) and preserves the `d`-tag
 * lineage on edit (STORY-04). A local-first draft (`writeStoryDraft`/`readStoryDraft`/
 * `clearStoryDraft`) is saved before publish and cleared on publish.
 *
 * Accent (`--primary`) is reserved per the UI-SPEC for the submit button only
 * (Publish Story / Save changes).
 */

import { castEvent } from 'applesauce-core/casts'
import { useActiveAccount } from 'applesauce-react/hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BlossomUploaderButton } from '@/components/blossom/BlossomUploaderButton'
import {
	GeoRichTextEditor,
	type GeoFeatureItem,
	type GeoRichTextEditorRef,
	RichContentRenderer,
} from '@/components/editor'
import {
	EntityPanelSectionHeader,
	EntityPanelShell,
	EntityPanelSurface,
} from '@/components/info-panel/EntityPanelShell'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { AspectRatio } from '@/components/ui/aspect-ratio'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { accounts, eventStore } from '@/lib/nostr'
import { Article, type ArticleContent, getArticleContent, isArticle } from '@/lib/nostr/article'
import {
	NEW_STORY_DRAFT_KEY,
	clearStoryDraft,
	editStory,
	publishStory,
	readStoryDraft,
	writeStoryDraft,
} from '@/lib/nostr/story'

interface StoryEditorPanelProps {
	/** The Story being edited (published Article cast). Absent ⇒ create mode. */
	initialStory?: Article | null
	onClose: () => void
	/** Returns the saved Story as an Article cast. */
	onSave: (story: Article) => void
	availableFeatures?: GeoFeatureItem[]
}

/**
 * Pre-fill source for the editor fields. When editing a published Story, read the
 * NIP-23 content out of the raw event; otherwise fall back to the local draft (keyed
 * by the Story's `d`-tag, or the `new-story` sentinel for an unsaved create).
 */
function readInitialContent(initialStory?: Article | null): {
	title: string
	summary: string
	image: string
	body: string
	draftKey: string
} {
	const editedEvent = initialStory?.rawEvent()
	if (editedEvent && isArticle(editedEvent)) {
		const content = getArticleContent(editedEvent)
		return {
			title: content.title ?? '',
			summary: content.summary ?? '',
			image: content.image ?? '',
			body: content.content ?? '',
			draftKey: initialStory?.dTag ?? NEW_STORY_DRAFT_KEY,
		}
	}
	const draftKey = initialStory?.dTag ?? NEW_STORY_DRAFT_KEY
	const draft = readStoryDraft(draftKey)
	return {
		title: draft?.title ?? '',
		summary: draft?.summary ?? '',
		image: draft?.image ?? '',
		body: draft?.content ?? '',
		draftKey,
	}
}

export function StoryEditorPanel({
	initialStory,
	onClose,
	onSave,
	availableFeatures = [],
}: StoryEditorPanelProps) {
	const currentUser = useActiveAccount()
	const bodyEditorRef = useRef<GeoRichTextEditorRef>(null)

	const initial = useMemo(() => readInitialContent(initialStory), [initialStory])
	// Editing a *published* Article switches the submit to "Save changes" and the
	// edit code path; a draft-backed create stays in publish mode.
	const isEditing = useMemo(() => {
		const event = initialStory?.rawEvent()
		return Boolean(event && isArticle(event))
	}, [initialStory])

	const [title, setTitle] = useState(initial.title)
	const [summary, setSummary] = useState(initial.summary)
	const [image, setImage] = useState(initial.image)
	const [body, setBody] = useState(initial.body)
	const [bodyTab, setBodyTab] = useState<'write' | 'preview'>('write')
	const [isSaving, setIsSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)

	// Reset all fields when the edited Story changes.
	useEffect(() => {
		const next = readInitialContent(initialStory)
		setTitle(next.title)
		setSummary(next.summary)
		setImage(next.image)
		setBody(next.body)
		bodyEditorRef.current?.setContent(next.body)
		setBodyTab('write')
		setSaveError(null)
	}, [initialStory])

	const draftKey = initial.draftKey

	const handleSaveDraft = () => {
		setSaveError(null)
		try {
			writeStoryDraft(draftKey, {
				title: title.trim() || undefined,
				summary: summary.trim() || undefined,
				image: image.trim() || undefined,
				content: body || undefined,
			})
		} catch {
			setSaveError("Couldn't save your draft locally. Your text is still here — try again.")
		}
	}

	const handleDiscardDraft = () => {
		clearStoryDraft(draftKey)
		setTitle('')
		setSummary('')
		setImage('')
		setBody('')
		bodyEditorRef.current?.setContent('')
		setBodyTab('write')
	}

	const handleSave = async () => {
		if (!currentUser) return
		setSaveError(null)

		if (!title.trim()) {
			setSaveError('A title is required to publish.')
			return
		}
		if (!body.trim()) {
			setSaveError('Add some narrative before publishing.')
			return
		}

		setIsSaving(true)
		try {
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')

			const content: ArticleContent = {
				title: title.trim(),
				summary: summary.trim() || undefined,
				image: image.trim() || undefined,
				content: body,
			}

			const editedEvent = initialStory?.rawEvent()
			// publishStory/editStory (Plan 01) own the STORY-03 naddr→`a` re-derive
			// and the STORY-04 d-tag lineage — never re-inline ArticleFactory here.
			const signed =
				editedEvent && isArticle(editedEvent)
					? await editStory(editedEvent, content, signer)
					: await publishStory(content, signer)

			clearStoryDraft(draftKey)
			const cast = castEvent(signed, Article, eventStore)
			// onSave (handleSaveStory) both tears the editor down AND navigates to
			// the published story's canonical /stories/story/:naddr route. Do NOT
			// also call onClose() here: its close handler still sees the pre-render
			// editor mode and would re-navigate to the bare /stories catalog,
			// clobbering the publish destination (workflow audit P1).
			onSave(cast)
		} catch (error) {
			setSaveError(
				error instanceof Error && error.message === 'No active account'
					? error.message
					: "Couldn't publish — check your connection and try again.",
			)
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<EntityPanelShell title={isEditing ? 'Edit Story' : 'New Story'}>
			<EntityPanelSurface tone="context" className="space-y-3">
				<EntityPanelSectionHeader
					eyebrow="Story"
					title="Cover details"
					description="Title and summary appear on the story card and social previews."
				/>
				<div className="space-y-2">
					<Label htmlFor="story-title">Title</Label>
					<Input
						id="story-title"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="Roman ruins in Carinthia"
						className="rounded-none"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="story-summary">Summary</Label>
					<Textarea
						id="story-summary"
						value={summary}
						onChange={(event) => setSummary(event.target.value)}
						placeholder="A one-line summary readers see on the story card."
						rows={2}
						className="rounded-none"
					/>
				</div>
				<div className="space-y-2">
					<Label>Cover image</Label>
					<p className="text-[11px] text-muted-foreground">
						Optional — shown on the story card and social previews.
					</p>
					{image.trim() ? (
						<AspectRatio ratio={16 / 9} className="overflow-hidden border border-border bg-muted">
							{/* Cover renders as a plain <img src> — no HTML injection sink (T-10-05). */}
							<img
								src={image}
								alt="Story cover"
								className="h-full w-full object-cover"
								onError={(event) => {
									event.currentTarget.style.display = 'none'
								}}
							/>
						</AspectRatio>
					) : null}
					<div className="flex items-center gap-2">
						<Input
							value={image}
							onChange={(event) => setImage(event.target.value)}
							placeholder="https://..."
							className="rounded-none"
						/>
						<BlossomUploaderButton
							currentUrl={image}
							onUploaded={({ url }) => setImage(url)}
							buttonLabel="Blossom"
							className="rounded-none"
						/>
					</div>
				</div>
			</EntityPanelSurface>

			<EntityPanelSurface tone="neutral" className="space-y-3">
				<EntityPanelSectionHeader
					eyebrow="Narrative"
					title="Write your story"
					description="Markdown is stored verbatim. Type @ to reference a dataset, feature, image, or video."
				/>
				<Tabs
					value={bodyTab}
					onValueChange={(value) => setBodyTab(value as 'write' | 'preview')}
					className="space-y-3"
				>
					<TabsList className="h-8 w-full justify-start rounded-none border-b border-border bg-transparent p-0">
						<TabsTrigger
							value="write"
							className="h-8 rounded-none border-b-2 border-transparent px-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
						>
							Write
						</TabsTrigger>
						<TabsTrigger
							value="preview"
							className="h-8 rounded-none border-b-2 border-transparent px-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
						>
							Preview
						</TabsTrigger>
					</TabsList>

					<TabsContent value="write" className="mt-0">
						<GeoRichTextEditor
							ref={bodyEditorRef}
							initialValue={body}
							onChange={setBody}
							availableFeatures={availableFeatures}
							placeholder={`Start writing…
Type @ to reference a dataset, feature, image, or video.`}
							rows={12}
							className="min-h-[320px] w-full"
						/>
					</TabsContent>

					<TabsContent value="preview" className="mt-0">
						{/* Preview renders ONLY through the sanitized RichContentRenderer,
						    exactly as readers see it — never raw HTML (T-10-04). */}
						<RichContentRenderer
							content={body}
							availableFeatures={availableFeatures}
							emptyState="Nothing to preview yet — switch to Write and add some narrative."
							className="min-h-[160px]"
						/>
					</TabsContent>
				</Tabs>
			</EntityPanelSurface>

			<EntityPanelSurface tone="neutral" className="space-y-2">
				{saveError && <p className="text-xs text-destructive">{saveError}</p>}
				<div className="flex flex-wrap items-center justify-end gap-2">
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant="ghost" className="rounded-none text-destructive">
								Discard draft
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Discard this draft?</AlertDialogTitle>
								<AlertDialogDescription>
									Your unpublished changes will be lost. This can't be undone.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Keep editing</AlertDialogCancel>
								<AlertDialogAction
									onClick={handleDiscardDraft}
									className="bg-destructive text-destructive-foreground"
								>
									Discard
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
					<Button variant="outline" onClick={handleSaveDraft} className="rounded-none">
						Save draft
					</Button>
					<Button variant="outline" onClick={onClose} className="rounded-none">
						Cancel
					</Button>
					<Button
						onClick={handleSave}
						disabled={isSaving || !currentUser}
						className="rounded-none bg-primary text-primary-foreground"
					>
						{isSaving ? 'Publishing…' : isEditing ? 'Save changes' : 'Publish Story'}
					</Button>
				</div>
			</EntityPanelSurface>
		</EntityPanelShell>
	)
}
