import { describe, expect, test } from 'bun:test'
import { generateOGHtml, generateStoryOGHtml } from './template'

// Regression coverage for T-10-09 (OG-HTML XSS). The Story title/summary are
// untrusted author content and `image`/`url` can be fully attacker-controlled
// (a Story's content.image; the Host-header-derived base URL). None of them
// may reach an HTML-attribute, http-refresh, <a href>, or <script> sink raw.

describe('generateOGHtml — XSS hardening (T-10-09)', () => {
	test('escapes a quote-breakout attempt in the title', () => {
		const html = generateOGHtml({
			title: '"><script>alert(1)</script>',
			description: 'desc',
			url: 'https://earthly.city/#/stories/story/naddr1',
		})
		expect(html).not.toContain('<script>alert(1)</script>')
		expect(html).toContain('&lt;script&gt;')
	})

	test('rejects a javascript: scheme in url, falling back to a safe value', () => {
		const html = generateOGHtml({
			title: 'Story',
			description: 'desc',
			// biome-ignore lint/suspicious/noExplicitAny: deliberately hostile input
			url: 'javascript:alert(document.domain)' as any,
		})
		expect(html).not.toContain('javascript:alert')
		// The inline-redirect script must not carry an executable js: payload.
		expect(html).toContain('window.location.href = "/"')
	})

	test('neutralises an attribute-breakout image URL in og:image', () => {
		const html = generateOGHtml({
			title: 'Story',
			description: 'desc',
			url: 'https://earthly.city/#/x',
			image: '"><img src=x onerror=alert(1)>',
		})
		expect(html).not.toContain('onerror=alert(1)')
		// hostile image is not a valid http(s) URL nor a site-relative path → default image
		expect(html).toContain('content="/static/og-default.png"')
	})

	test('prevents </script> breakout in the inline redirect script', () => {
		const html = generateOGHtml({
			title: 'Story',
			description: 'desc',
			// A site-relative path is allowed through sanitizeUrl, so the script-context
			// escaping (not URL validation) is what must neutralise the breakout here.
			url: '/#/x</script><script>alert(1)</script>',
		})
		const scriptOpenCount = (html.match(/<script>/g) ?? []).length
		// Exactly the one legitimate inline redirect script — no injected second <script>.
		expect(scriptOpenCount).toBe(1)
		expect(html).toContain('\\u003c/script')
	})

	test('preserves a legitimate https image and url', () => {
		const html = generateStoryOGHtml(
			'https://earthly.city',
			'naddr1abc',
			'My Story',
			'A summary',
			'https://cdn.example.com/cover.jpg',
		)
		expect(html).toContain('content="https://cdn.example.com/cover.jpg"')
		expect(html).toContain('https://earthly.city/#/stories/story/naddr1abc')
		expect(html).toContain('<title>My Story | Earthly</title>')
	})
})
