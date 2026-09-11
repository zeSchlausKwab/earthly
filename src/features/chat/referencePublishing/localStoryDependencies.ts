import { localStoryReferences, resolveLocalStoryReference } from '@/lib/nostr/story/localReferences'
import { mapWorkTarget, workTargetIdentity } from '../workingSet'
import { captureTargetDatasetPublication } from './storyReferenceGate'
import { requestStoryPublicationApproval } from './storyPublicationApproval'
import { publishCapturedPublicDataset } from './publishCapturedDataset'
import type { CapturedDatasetPublication, PublishedDatasetReference } from './types'
import { accounts } from '@/lib/nostr'
import { coordinateToNaddrReference } from '@/lib/nostr/references'

/** Capture every dependency before the first approval; one failed/private source prevents publishing any. */
export function captureLocalStoryDependencies(
	markdown: string,
	storyDraftKey: string,
): CapturedDatasetPublication[] {
	const references = localStoryReferences(markdown)
	return [...new Set(references.map((reference) => reference.workspaceId))].map((workspaceId) => {
		const item = mapWorkTarget(workspaceId)
		if (!item)
			throw new Error(
				'A referenced local Map is unavailable. Restore it or remove its reference; no Map was substituted.',
			)
		const target = workTargetIdentity(item)
		const publishedSource =
			target.entityId && /^[0-9a-f]{64}:.+$/i.test(target.entityId)
				? coordinateToNaddrReference(`37515:${target.entityId}`)
				: null
		const capture = captureTargetDatasetPublication({
			markdown: publishedSource ?? '',
			referencesNewDataset: true,
			target,
			chatId: `story-dependencies:${storyDraftKey}`,
			toolCallId: `dependency:${workspaceId}`,
		})
		if (capture.kind === 'blocked')
			throw new Error(
				capture.result.status === 'blocked'
					? capture.result.message
					: 'Map dependency cannot be published.',
			)
		if (capture.kind !== 'captured')
			throw new Error(`Could not prepare the referenced Map: ${item.title}`)
		for (const reference of references.filter(
			(reference) => reference.workspaceId === workspaceId,
		)) {
			if (reference.featureId && !capture.captured.featureIds.includes(reference.featureId))
				throw new Error(
					`A referenced feature is missing from ${item.title}. Nothing was published.`,
				)
		}
		return capture.captured
	})
}

export async function resolveLocalStoryDependencies(
	markdown: string,
	options: {
		storyDraftKey: string
		storyTitle?: string
		validate?: () => void
		onProgress: (markdown: string, completed: number, total: number) => void
		/** Injected in tests; production always uses the explicit publish confirmation. */
		publishDependency?: (captured: CapturedDatasetPublication) => Promise<PublishedDatasetReference>
	},
): Promise<string> {
	const dependencies = captureLocalStoryDependencies(markdown, options.storyDraftKey)
	const owner = accounts.active?.pubkey
	let current = markdown
	if (dependencies.length && !options.publishDependency) {
		const confirmed = await requestStoryPublicationApproval(options.storyTitle || 'Story', dependencies.map(item => item.title))
		if (!confirmed) throw new Error('Story publication cancelled. Your drafts are kept.')
	}
	const validate = () => {
		if (accounts.active?.pubkey !== owner) throw new Error('The account changed. Nothing further was published.')
		options.validate?.()
	}
	for (const [index, captured] of dependencies.entries()) {
		validate()
		const published = options.publishDependency
			? await options.publishDependency(captured)
			: await publishCapturedPublicDataset(captured, validate)
		validate()
		current = resolveLocalStoryReference(
			current,
			captured.binding.workspaceId,
			published.datasetMention,
		)
		// Save each completed address immediately; retry does not republish earlier dependencies.
		options.onProgress(current, index + 1, dependencies.length)
	}
	return current
}
