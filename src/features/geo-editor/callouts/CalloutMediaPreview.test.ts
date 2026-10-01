import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CalloutMediaPreview } from './CalloutMediaPreview'

describe('callout media preview', () => {
	test('renders an extensionless image with alt text inside a bounded preview', () => {
		const html = renderToStaticMarkup(
			createElement(CalloutMediaPreview, {
				media: [{ url: 'https://images.test/photo/123', alt: 'A river crossing' }],
			}),
		)
		expect(html).toContain('<img')
		expect(html).toContain('alt="A river crossing"')
		expect(html).toContain('aria-label="Open callout image"')
	})

	test('compact previews stay bounded and indicate additional attachments', () => {
		const html = renderToStaticMarkup(
			createElement(CalloutMediaPreview, {
				media: [{ url: 'https://images.test/a.jpg' }, { url: 'https://images.test/b.jpg' }],
				thumbnail: true,
				className: 'size-8',
			}),
		)
		expect(html).toContain('+1')
		expect(html.match(/<img/g)).toHaveLength(1)
	})

	test('preserves video controls in full previews and uses the poster for thumbnails', () => {
		const media = [
			{
				url: 'https://images.test/clip',
				mimeType: 'video/mp4',
				thumbnailUrl: 'https://images.test/poster.jpg',
			},
		]
		const full = renderToStaticMarkup(createElement(CalloutMediaPreview, { media }))
		const thumbnail = renderToStaticMarkup(
			createElement(CalloutMediaPreview, { media, thumbnail: true }),
		)
		expect(full).toContain('<video controls=""')
		expect(full).toContain('type="video/mp4"')
		expect(thumbnail).not.toContain('<video')
		expect(thumbnail).toContain('src="https://images.test/poster.jpg"')
	})
})
