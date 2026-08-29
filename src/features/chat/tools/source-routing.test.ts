import { describe, expect, it } from 'bun:test'
import { dispatch } from './registry'
import { getWikipediaFetchRedirect } from './source-routing'

describe('research source routing', () => {
	it('redirects a canonical Wikipedia article from fetch_url to structured extraction', () => {
		const url = 'https://en.wikipedia.org/wiki/List_of_enclaves_and_exclaves'

		expect(getWikipediaFetchRedirect(url)).toEqual({
			ok: false,
			kind: 'tool_redirect',
			toolName: 'fetch_url',
			message:
				'Wikipedia articles have a bounded, provenance-preserving prose reader. Use wikipedia_extract article/section mode instead of fetch_url or alternate raw/API URLs.',
			redirectTool: 'wikipedia_extract',
			redirectArguments: {
				url,
				mode: 'article',
			},
		})
	})

	it('converts a Wikipedia API page request into callable extraction arguments', () => {
		const url =
			'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_enclaves_and_exclaves&prop=wikitext&format=json'

		expect(getWikipediaFetchRedirect(url)?.redirectArguments).toEqual({
			title: 'List of enclaves and exclaves',
			language: 'en',
			mode: 'article',
		})
	})

	it('preserves a requested Wikipedia section when redirecting raw/API prose detours', () => {
		const apiUrl =
			'https://en.wikipedia.org/w/api.php?action=parse&page=Example&section=4&prop=wikitext'
		expect(getWikipediaFetchRedirect(apiUrl)?.redirectArguments).toEqual({
			title: 'Example',
			language: 'en',
			mode: 'section',
			sectionIndex: '4',
		})

		const articleUrl = 'https://en.wikipedia.org/wiki/Example#Damage_assessment'
		expect(getWikipediaFetchRedirect(articleUrl)?.redirectArguments).toEqual({
			url: articleUrl,
			mode: 'section',
			sectionTitle: 'Damage assessment',
		})
	})

	it('leaves non-Wikipedia sources on the generic reader path', () => {
		expect(getWikipediaFetchRedirect('https://example.com/research/report')).toBeNull()
	})

	it('returns the redirect through the advertised fetch_url tool', async () => {
		const result = await dispatch('fetch_url', {
			url: 'https://de.wikipedia.org/wiki/Exklave',
			maxLength: 50_000,
		})

		expect(result).toMatchObject({
			ok: false,
			kind: 'tool_redirect',
			redirectTool: 'wikipedia_extract',
			redirectArguments: {
				url: 'https://de.wikipedia.org/wiki/Exklave',
				mode: 'article',
			},
		})
	})
})
