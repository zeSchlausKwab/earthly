import { describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { renderToStaticMarkup } from 'react-dom/server'
import { MapletsPanel, type MapletsPanelProps } from './MapletsPanel'

function render(overrides: Partial<MapletsPanelProps> = {}) {
	return parseHTML(
		renderToStaticMarkup(
			<MapletsPanel
				catalog={[
					{
						id: 'my-maps-viewer',
						title: 'GMapper',
						description: 'View public Google My Maps.',
						source: 'bundled',
					},
				]}
				instances={[]}
				onAdd={() => {}}
				onRemove={() => {}}
				onToggleVisibility={() => {}}
				onRefresh={() => {}}
				onConfigure={() => {}}
				onCopy={() => {}}
				onFit={() => {}}
				onDiscover={() => {}}
				{...overrides}
			/>,
		),
	).document
}

describe('Maplet tool directory', () => {
	test('opens tools and scopes configuration discovery inside their Maplet', () => {
		const document = render()
		const text = document.querySelector('[role="tabpanel"]')?.textContent ?? ''
		expect(text).toContain('Tools that bring outside data onto your map.')
		expect(text).toContain('Explore or create configurations')
		expect(text).toContain('configured relays')
		expect(text).not.toContain('Published collections')
		expect(text).not.toContain('On your map')
		expect(document.querySelector('button[aria-label="Open GMapper"]')).not.toBeNull()
		expect(document.querySelector('input[aria-label="Find a Maplet"]')).not.toBeNull()
	})
	test('leaves a measured sidebar surface for the persistent sandbox', () => {
		const document = render({ appOpen: true })
		expect(document.querySelector('#browse-maplets-panel')).not.toBeNull()
		expect(document.querySelector('button[aria-label="Open GMapper"]')).toBeNull()
		expect(document.querySelector('dialog')).toBeNull()
	})
	test('renders third-party metadata as text and retains publisher identity', () => {
		const document = render({
			catalog: [
				{
					id: 'foreign',
					title: '<img src=x>',
					description: '<script>run()</script>',
					author: 'a'.repeat(64),
					source: 'nostr',
				},
			],
		})
		expect(document.querySelector('img')).toBeNull()
		expect(document.querySelector('script')).toBeNull()
		expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain('aaaaaaaaaaaa…')
		expect(document.querySelector('button[aria-label="Open <img src=x>"]')).not.toBeNull()
	})
	test('native users can open bundled GMapper and see unavailable downloaded tools', () => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'isTauri')
		Object.defineProperty(globalThis, 'isTauri', { configurable: true, value: true })
		try {
			const document = render({
				catalog: [
					{
						id: 'my-maps-viewer',
						title: 'GMapper',
						description: 'Public My Maps.',
						source: 'bundled',
					},
					{
						id: 'foreign',
						title: 'Foreign app',
						description: 'A published tool.',
						source: 'nostr',
					},
				],
			})
			expect(
				document.querySelector('button[aria-label="Open GMapper"]')?.hasAttribute('disabled'),
			).toBe(false)
			expect(
				document.querySelector('button[aria-label="Open Foreign app"]')?.hasAttribute('disabled'),
			).toBe(true)
		} finally {
			if (previous) Object.defineProperty(globalThis, 'isTauri', previous)
			else Reflect.deleteProperty(globalThis, 'isTauri')
		}
	})
})
