import { localStoryReferences, resolveLocalStoryReference } from '@/lib/nostr/story/localReferences'
import { mapWorkTarget, workTargetIdentity } from '../workingSet'
import { captureTargetDatasetPublication } from './storyReferenceGate'
import { requestReferencePublish } from './requestStore'
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
		onProgress: (markdown: string, completed: number, total: number) => void
		/** Injected in tests; production always uses the explicit publish confirmation. */
		publishDependency?: (captured: CapturedDatasetPublication) => Promise<PublishedDatasetReference>
	},
): Promise<string> {
	const dependencies = captureLocalStoryDependencies(markdown, options.storyDraftKey)
	const owner = accounts.active?.pubkey
	let current = markdown
	for (const [index, captured] of dependencies.entries()) {
		const published = options.publishDependency
			? await options.publishDependency(captured)
			: await (async () => {
					const decision = await requestReferencePublish(captured, () => {
						if (accounts.active?.pubkey !== owner)
							throw new Error('The account changed. Cancel and publish from the original account.')
						return publishCapturedPublicDataset(captured)
					})
					if (decision.decision === 'cancelled')
						throw new Error(
							'Story publication cancelled. Already published Maps remain published; the Story draft and unresolved references are kept.',
						)
					return decision.published
				})()
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
