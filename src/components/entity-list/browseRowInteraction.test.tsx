import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { createDatasetColumns, type DatasetRowData } from '../datasets-columns'
import { ListRow, type ListRowProps } from './ListRow'

function renderMapRow({ onMap = false, visible = true } = {}) {
	const calls: string[] = []
	const event = { pubkey: 'author', event: { tags: [] } } as unknown as GeoDataset
	const original: DatasetRowData = {
		event,
		datasetKey: 'map',
		datasetName: 'River map',
		isActive: false,
		isOwned: false,
		isVisible: visible,
		isInMapStack: onMap,
		primaryLabel: 'Propose changes',
	}
	const cell = createDatasetColumns({
		onAddDatasetToMap: () => calls.push('add'),
		onRemoveDatasetFromMap: () => calls.push('remove'),
		onZoomToDataset: () => calls.push('zoom'),
		onInspectDataset: () => calls.push('inspect'),
		onToggleVisibility: () => calls.push('show'),
		onLoadDataset: () => calls.push('edit'),
		onDeleteDataset: () => calls.push('delete'),
		onToggleAllVisibility: () => {},
		isPublishing: false,
		deletingKey: null,
		allVisibleState: 'all',
	})[0]?.cell
	if (typeof cell !== 'function') throw new Error('Expected list cell')
	const row = cell({ row: { original } } as Parameters<
		typeof cell
	>[0]) as ReactElement<ListRowProps>
	return { calls, row }
}

describe('Browse row interaction', () => {
	test('opening a Map shows, frames and inspects without starting an edit', () => {
		const { calls, row } = renderMapRow()
		row.props.onTitleClick?.()
		expect(calls).toEqual(['add', 'zoom', 'inspect'])
		expect(row.props.titleAriaLabel).toBe('Open map River map')
	})

	test('opening a hidden Shelf map restores visibility without duplicating it', () => {
		const { calls, row } = renderMapRow({ onMap: true, visible: false })
		row.props.onTitleClick?.()
		expect(calls).toEqual(['show', 'zoom', 'inspect'])
	})

	test('the primary Shelf toggle never navigates or opens an editor', () => {
		const { calls, row } = renderMapRow({ onMap: true })
		const primary = row.props.primaryAction as ReactElement<{ onClick: () => void }>
		primary.props.onClick()
		expect(calls).toEqual(['remove'])
	})

	test('row background opens the entity but interactive descendants keep their own action', () => {
		let opened = 0
		const row = ListRow({ title: 'River map', onTitleClick: () => opened++ })
		const click = row.props.onClick
		click({ target: { closest: () => null } })
		click({ target: { closest: () => ({}) } })
		expect(opened).toBe(1)
	})
})
