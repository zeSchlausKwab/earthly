export interface ToolRedirect {
	ok: false
	kind: 'tool_redirect'
	toolName: string
	message: string
	redirectTool: string
	redirectArguments: Record<string, unknown>
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
	const redirectArguments: Record<string, unknown> = normalizedApiTitle
		? { title: normalizedApiTitle, language, mode: 'outline' }
		: { url: rawUrl, mode: 'outline' }

	return {
		ok: false,
		kind: 'tool_redirect',
		toolName: 'fetch_url',
		message:
			'Wikipedia articles have a structured, provenance-preserving reader. Use wikipedia_extract instead of fetch_url.',
		redirectTool: 'wikipedia_extract',
		redirectArguments,
	}
}
