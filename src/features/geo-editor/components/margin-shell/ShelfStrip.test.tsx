import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	canReorderShelfItem,
	getShelfKeyboardReorderIntent,
	ShelfStrip,
	type ShelfStripItem,
} from './ShelfStrip'

function item(id: string, visible: boolean): ShelfStripItem {
	return {
		id,
		title: 'Shared map',
		visible,
		color: '#5b8c72',
	}
}

describe('ShelfStrip', () => {
	it('keeps duplicate map instances independently addressable', () => {
		const markup = renderToStaticMarkup(
			<ShelfStrip
				items={[item('story-view:0', true), item('story-view:1', false)]}
				onOpenItem={() => {}}
				onToggleItem={() => {}}
				onRemoveItem={() => {}}
			/>,
		)

		expect(markup).toContain('data-shelf-item="story-view:0"')
		expect(markup).toContain('data-shelf-item="story-view:1"')
		expect(markup.match(/earthly-shelf__name/g)).toHaveLength(2)
		expect(markup).toContain('aria-label="Hide Shared map"')
		expect(markup).toContain('aria-label="Show Shared map"')
	})

	it('exposes the live layer and save-view actions without replacing map chips', () => {
		const markup = renderToStaticMarkup(
			<ShelfStrip
				items={[item('map:one', true)]}
				live={{ count: 4, visible: true, onToggle: () => {} }}
				onSaveView={() => {}}
			/>,
		)

		expect(markup).toContain('Live · 4')
		expect(markup).toContain('Save this view')
		expect(markup).toContain('data-shelf-item="map:one"')
	})

	it('keeps Shelf ordering keyboard reachable', () => {
		const markup = renderToStaticMarkup(
			<ShelfStrip
				items={[item('map:one', true), { ...item('map:two', true), title: 'Second map' }]}
				onReorderItem={() => {}}
			/>,
		)

		expect(markup).toContain('aria-label="Move Shared map right"')
		expect(markup).toContain('aria-label="Move Second map left"')
		expect(markup).toContain('aria-live="polite"')
		expect(
			getShelfKeyboardReorderIntent([item('one', true), item('two', true)], 0, 'right'),
		).toEqual({ targetId: 'two', placement: 'after' })
		expect(
			getShelfKeyboardReorderIntent([item('one', true), item('two', true)], 1, 'left'),
		).toEqual({ targetId: 'one', placement: 'before' })
	})

	it('keeps unavailable item controls visible, labelled, and disabled', () => {
		const protectedItem = {
			...item('draft:active', true),
			toggleable: false,
			toggleDisabledLabel: 'Visible while editing',
			removable: false,
			removeDisabledLabel: 'Finish editing before removing',
		}
		const markup = renderToStaticMarkup(
			<ShelfStrip
				items={[protectedItem]}
				onOpenShelf={() => {}}
				onOpenItem={() => {}}
				onToggleItem={() => {}}
				onRemoveItem={() => {}}
			/>,
		)

		expect(markup).toContain('aria-label="Hide Shared map. Visible while editing"')
		expect(markup).toContain(
			'aria-label="Remove Shared map from the map. Finish editing before removing"',
		)
		expect(markup.match(/disabled=""/g)).toHaveLength(2)
	})

	it('keeps authored presentation items fixed and blocks moves across them', () => {
		const items = [
			{ ...item('map:one', true), title: 'First map' },
			{ ...item('presentation:fixed', true), title: 'Authored layer', reorderable: false },
			{ ...item('map:two', true), title: 'Second map' },
		]
		const markup = renderToStaticMarkup(<ShelfStrip items={items} onReorderItem={() => {}} />)

		expect(markup).toContain('data-shelf-item="presentation:fixed" draggable="false"')
		expect(markup).not.toContain('aria-label="Move Authored layer')
		expect(markup).not.toContain('aria-label="Move First map right"')
		expect(markup).not.toContain('aria-label="Move Second map left"')
		expect(canReorderShelfItem(items, 'map:one', 'map:two')).toBe(false)
		expect(getShelfKeyboardReorderIntent(items, 0, 'right')).toBeNull()
	})
})
