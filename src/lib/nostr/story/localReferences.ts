import { semanticMarkdownText } from '@/lib/map-presentation/storyMarkdown'
import { encodeNostrFeatureId } from '@/lib/nostr/references'

/** Local authoring notation only. Never sent as an event or a presentation source. */
export function localMapReference(workspaceId: string, featureId?: string): string {
	return `earthly-draft:${encodeNostrFeatureId(workspaceId)}${featureId ? `#${encodeNostrFeatureId(featureId)}` : ''}`
}

export function localStoryReferences(markdown: string) {
	const semantic = semanticMarkdownText(markdown)
	return [...semantic.matchAll(/earthly-draft:([a-zA-Z0-9_%~-]+)(?:#([a-zA-Z0-9_%~-]+))?/g)]
		.filter((match) => match.index === 0 || semantic[match.index - 1] !== '\\')
		.map((match) => ({
			start: match.index,
			end: match.index + match[0].length,
			workspaceId: decodeURIComponent(match[1]!),
			featureId: match[2] ? decodeURIComponent(match[2]) : undefined,
		}))
}

export function resolveLocalStoryReference(
	markdown: string,
	workspaceId: string,
	publishedMention: string,
): string {
	let result = markdown
	for (const reference of localStoryReferences(markdown).reverse()) {
		if (reference.workspaceId !== workspaceId) continue
		const mention = `${publishedMention}${reference.featureId ? `#${encodeNostrFeatureId(reference.featureId)}` : ''}`
		result = result.slice(0, reference.start) + mention + result.slice(reference.end)
	}
	return result
}

export function assertPublishedStoryReferences(markdown: string): void {
	if (localStoryReferences(markdown).length)
		throw new Error(
			'This Story still references local Map drafts. Publish its referenced Maps from the Story editor before publishing the Story.',
		)
}
