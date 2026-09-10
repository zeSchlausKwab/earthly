/**
 * Story lifecycle service (kind 37520) — the single source-of-truth publish path.
 *
 * A thin, testable wrapper over `ArticleFactory` (Phase 8) that, on EVERY publish,
 * re-derives the queryable `a` (address-reference) tags from the Markdown body's
 * inline `nostr:naddr…` refs (STORY-03 — the body is the single source of truth;
 * prior `a` tags are dropped and re-appended) and preserves the `d`-tag lineage on
 * edit (STORY-04 — parameterized-replaceable, no fork).
 *
 * This mirrors the inline analog in `GroupEditorPanel.handleSave`
 * (extractReferencedCoordinates(body) → modifyPublicTags(setAddressReferenceTags))
 * so the authoring panel (Plan 02) and the proposal-accept republish (Plan 04)
 * share one tested code path.
 *
 * Malformed `nostr:naddr…` refs are inherited-handled: `naddrToCoordinate` returns
 * null on a bad decode (references.ts), so `extractReferencedCoordinates` silently
 * excludes them and never throws (T-10-01).
 *
 * The service does NOT cast — callers cast the returned signed event via
 * `castEvent(signed, Article, eventStore)`.
 */

import { DeleteFactory } from 'applesauce-core/factories'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { SignerLike } from '@/lib/nostr/entityFactory'
import { assertCanDeleteOwnedEntity } from '@/lib/nostr/deletion'
import { publish } from '@/lib/nostr'
import { ArticleFactory, getArticleContent, getArticleId, isArticle } from '@/lib/nostr/article'
import type { ArticleContent } from '@/lib/nostr/article'
import {
	authorizePresentationLayer,
	deriveStoryPresentationAuthorization,
	extractSemanticStoryReferencedCoordinates,
	getUsableMapPresentation,
	parseMapPresentation,
	reduceStoryMarkdownViews,
	type MapPresentationIssue,
} from '@/lib/map-presentation'
import { setAddressReferenceTags } from '@/lib/nostr/references'
import { noteSessionPublish } from '@/lib/nostr/sessionPublishes'
import { assertPublishedStoryReferences } from './localReferences'

/** AI-chat session breadcrumb (one line per publish) — see sessionPublishes.ts. */
function noteStorySessionPublish(signed: NostrEvent, content: Partial<ArticleContent>): void {
	const dTag = getArticleId(signed)
	if (!dTag) return
	noteSessionPublish({
		type: 'story',
		name: content.title?.trim() || dTag,
		coordinate: `${signed.kind}:${signed.pubkey}:${dTag}`,
	})
}

export type StoryPresentationValidationCode =
	| 'invalid-presentation'
	| 'unauthorized-source'
	| 'unauthorized-features'
	| 'unknown-view-layer'

export class StoryPresentationValidationError extends Error {
	readonly code: StoryPresentationValidationCode
	readonly layerId?: string
	readonly featureIds: readonly string[]
	readonly issues: readonly MapPresentationIssue[]

	constructor(options: {
		code: StoryPresentationValidationCode
		message: string
		layerId?: string
		featureIds?: readonly string[]
		issues?: readonly MapPresentationIssue[]
	}) {
		super(options.message)
		this.name = 'StoryPresentationValidationError'
		this.code = options.code
		this.layerId = options.layerId
		this.featureIds = Object.freeze([...(options.featureIds ?? [])])
		this.issues = Object.freeze([...(options.issues ?? [])])
	}
}

function assertStoryViewTargets(
	presentation: Parameters<typeof reduceStoryMarkdownViews>[0],
	markdown: string,
) {
	const viewReduction = reduceStoryMarkdownViews(presentation, markdown)
	const unknownLayerIssues = viewReduction.issues.filter(
		(issue) => issue.code === 'unknown-layer-id',
	)
	if (unknownLayerIssues.length === 0) return
	throw new StoryPresentationValidationError({
		code: 'unknown-view-layer',
		message: `A Story view changes a layer that is not in the opening view: ${unknownLayerIssues
			.map((issue) => issue.path)
			.join(', ')}.`,
		issues: unknownLayerIssues,
	})
}

/**
 * Validate V1 presentation intent against the authoritative Markdown body.
 * Absent, malformed, and future versions keep legacy fallback/preservation;
 * only a usable V1 is interpreted and therefore subject to strict grants.
 */
export function validateStoryPresentation(content: Partial<ArticleContent>, options?: { allowLocalDraftReferences?: boolean }): ArticleContent {
	const markdown = content.content ?? ''
	if (!options?.allowLocalDraftReferences) assertPublishedStoryReferences(markdown)
	const parsed = parseMapPresentation(content.presentation)
	if (parsed.status !== 'valid') {
		if (parsed.status === 'absent') {
			assertStoryViewTargets({ version: 1, layers: [] }, markdown)
		}
		return { ...content }
	}
	if (parsed.issues.length > 0) {
		throw new StoryPresentationValidationError({
			code: 'invalid-presentation',
			message:
				'The Story opening view contains invalid presentation fields. Fix or remove it before publishing.',
			issues: parsed.issues,
		})
	}
	const presentation = getUsableMapPresentation(parsed)
	if (!presentation) {
		throw new StoryPresentationValidationError({
			code: 'invalid-presentation',
			message: 'The Story opening view has an invalid layers value. Recreate it before publishing.',
			issues: parsed.issues,
		})
	}

	const authorization = deriveStoryPresentationAuthorization(markdown)
	for (const layer of presentation.layers) {
		const result = authorizePresentationLayer(layer, authorization)
		if (result.status === 'authorized') continue
		if (result.status === 'unauthorized-source') {
			throw new StoryPresentationValidationError({
				code: 'unauthorized-source',
				layerId: layer.id,
				message: `Opening-view layer '${layer.id}' must reference a Map mentioned in the Story body.`,
			})
		}
		throw new StoryPresentationValidationError({
			code: 'unauthorized-features',
			layerId: layer.id,
			featureIds: result.featureIds,
			message: result.requestedWholeMap
				? `Opening-view layer '${layer.id}' requests the whole Map, but the Story body mentions only individual features.`
				: `Opening-view layer '${layer.id}' uses features not mentioned in the Story body: ${result.featureIds.join(', ')}.`,
		})
	}

	assertStoryViewTargets(presentation, markdown)

	return { ...content, presentation }
}

/**
 * Publish a NEW Story (new `d`-tag). The `a` tags are derived from the body's
 * `nostr:naddr…` refs (STORY-03). Returns the signed event; the caller casts it.
 */
export async function publishStory(
	content: Partial<ArticleContent>,
	signer: SignerLike,
): Promise<NostrEvent> {
	const effectiveContent = validateStoryPresentation(content)
	const referencedCoords = extractSemanticStoryReferencedCoordinates(effectiveContent.content)

	const signed = await ArticleFactory.create(effectiveContent)
		// Destructively re-derive `a` from the body — body is the single source of
		// truth (STORY-03). No prior `a` tags exist on a fresh create, but the same
		// call keeps create/edit on one path.
		.modifyPublicTags(setAddressReferenceTags(referencedCoords))
		.sign(signer)

	await publish(signed, { routing: 'outbox' })
	noteStorySessionPublish(signed, effectiveContent)
	return signed
}

/**
 * Edit an EXISTING Story, preserving its `d`-tag lineage (STORY-04). The `a` tags
 * are destructively re-derived from the new body (STORY-03) — refs removed since
 * the last publish are dropped, refs added are appended.
 */
export async function editStory(
	existingEvent: NostrEvent,
	content: Partial<ArticleContent>,
	signer: SignerLike,
): Promise<NostrEvent> {
	if (!isArticle(existingEvent)) {
		throw new Error('The event is not a Story and cannot be edited.')
	}
	const existingContent = getArticleContent(existingEvent)
	const effectiveContent = validateStoryPresentation({ ...existingContent, ...content })
	const referencedCoords = extractSemanticStoryReferencedCoordinates(effectiveContent.content)

	const signed = await ArticleFactory.modify(existingEvent)
		.article(effectiveContent)
		.modifyPublicTags(setAddressReferenceTags(referencedCoords))
		.sign(signer)

	await publish(signed, { routing: 'outbox' })
	noteStorySessionPublish(signed, effectiveContent)
	return signed
}

/** Publish a NIP-09 deletion event for a Story the active account owns. */
export async function deleteStory(
	story: NostrEvent,
	signer: EventSigner,
	reason?: string,
): Promise<void> {
	if (!getArticleId(story)) {
		throw new Error('Story is missing a d tag and cannot be deleted.')
	}
	await assertCanDeleteOwnedEntity(story, signer, 'Story')
	const event = await DeleteFactory.fromEvents([story], reason).sign(signer)
	await publish(event as NostrEvent, { routing: 'outbox' })
}
