export interface ToolRedirect {
	ok: false
	kind: 'tool_redirect'
	toolName: string
	message: string
	redirectTool: string
	redirectArguments: Record<string, unknown>
}

export function isToolRedirect(value: unknown): value is ToolRedirect {
	if (!value || typeof value !== 'object') return false
	const candidate = value as Record<string, unknown>
	return (
		candidate.ok === false &&
		candidate.kind === 'tool_redirect' &&
		typeof candidate.redirectTool === 'string' &&
		Boolean(candidate.redirectArguments) &&
		typeof candidate.redirectArguments === 'object'
	)
}

const WIKIPEDIA_ARTICLE_HOST = /^([a-z][a-z0-9-]{0,11})\.wikipedia\.org$/iu

/**
 * Keep generic URL fetching available for arbitrary sources while steering
 * Wikipedia articles through the structured reader used by Earthly research.
 */
export function getWikipediaFetchRedirect(rawUrl: string): ToolRedirect | null {
	let url: URL
	try {
		url = new URL(rawUrl)
	} catch {
		return null
	}

	const hostMatch = url.hostname.match(WIKIPEDIA_ARTICLE_HOST)
	if (!hostMatch) return null

	const language = hostMatch[1]?.toLowerCase()
	const apiTitle =
		url.pathname === '/w/api.php'
			? (url.searchParams.get('page') ?? url.searchParams.get('titles'))
			: url.pathname.startsWith('/wiki/Special:Export')
				? url.searchParams.get('pages')
				: null
	const normalizedApiTitle = apiTitle?.split('|', 1)[0]?.replaceAll('_', ' ').trim()
	const requestedSectionIndex = url.searchParams.get('section')?.trim()
	let requestedSectionTitle: string | undefined
	if (url.hash.length > 1) {
		try {
			requestedSectionTitle = decodeURIComponent(url.hash.slice(1)).replaceAll('_', ' ').trim()
		} catch {
			requestedSectionTitle = undefined
		}
	}
	const proseMode =
		(requestedSectionIndex && requestedSectionIndex !== '0') || requestedSectionTitle
			? 'section'
			: 'article'
	const redirectArguments: Record<string, unknown> = normalizedApiTitle
		? { title: normalizedApiTitle, language, mode: proseMode }
		: { url: rawUrl, mode: proseMode }
	if (requestedSectionIndex && requestedSectionIndex !== '0') {
		redirectArguments.sectionIndex = requestedSectionIndex
	} else if (requestedSectionTitle) {
		redirectArguments.sectionTitle = requestedSectionTitle
	}

	return {
		ok: false,
		kind: 'tool_redirect',
		toolName: 'fetch_url',
		message:
			'Wikipedia articles have a bounded, provenance-preserving prose reader. Use wikipedia_extract article/section mode instead of fetch_url or alternate raw/API URLs.',
		redirectTool: 'wikipedia_extract',
		redirectArguments,
	}
}
