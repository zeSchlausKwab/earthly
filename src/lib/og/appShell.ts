import { nip19 } from 'nostr-tools'
import { ARTICLE_KIND } from '../nostr/kinds'
import { createStoryReadOGMeta, generateOGHeadTags, type OGMeta } from './template'

export const APP_SHELL_METADATA_START = '<!-- earthly:metadata:start -->'
export const APP_SHELL_METADATA_END = '<!-- earthly:metadata:end -->'

export interface StoryReadAppShellOptions {
	baseUrl: string
	naddr: string
	title: string
	description: string
	image?: string
	/** Event/dependency identity used to version the generated Story image. */
	imageIdentity?: string
}

/**
 * Reject malformed and wrong-kind addresses before they reach the relay/cache.
 * The caller can then serve the ordinary SPA shell and let the client render its
 * normal not-found state, without manufacturing canonical metadata for junk.
 */
export function isStoryReadAddress(naddr: string): boolean {
	return isNaddrForKind(naddr, ARTICLE_KIND)
}

/**
 * Replace only the default metadata region of the built app shell. Returning
 * null on a missing/malformed marker is deliberate: callers can safely fall
 * back to the unmodified executable shell rather than emitting partial HTML.
 */
export function injectOGMetadataIntoAppShell(appShell: string, metadata: string): string | null {
	const start = appShell.indexOf(APP_SHELL_METADATA_START)
	const end = appShell.indexOf(APP_SHELL_METADATA_END)
	if (start < 0 || end < 0 || end <= start) return null

	const contentStart = start + APP_SHELL_METADATA_START.length
	return `${appShell.slice(0, contentStart)}\n    ${metadata.replaceAll('\n', '\n    ')}\n    ${appShell.slice(end)}`
}

/** Build an entity-specific application document without replacing its scripts,
 * styles, root element, or client-side routing boundary. */
export function generateEntityAppShell(appShell: string, metadata: OGMeta): string | null {
	return injectOGMetadataIntoAppShell(appShell, generateOGHeadTags(metadata))
}

/** Build a Story-specific app document while preserving all executable shell content. */
export function generateStoryReadAppShell(
	appShell: string,
	options: StoryReadAppShellOptions,
): string | null {
	return generateEntityAppShell(
		appShell,
		createStoryReadOGMeta(
			options.baseUrl,
			options.naddr,
			options.title,
			options.description,
			options.image,
			options.imageIdentity,
		),
	)
}

/** Check a parameterized replaceable address before using it in a relay query. */
export function isNaddrForKind(naddr: string, expectedKind: number): boolean {
	try {
		const decoded = nip19.decode(naddr)
		return decoded.type === 'naddr' && decoded.data.kind === expectedKind
	} catch {
		return false
	}
}
