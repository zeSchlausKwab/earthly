import { describe, expect, test } from 'bun:test'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { createContextColumns, type ContextRowData } from '@/features/contexts/contexts-columns'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { LoadEditorActionIcon, ProposalActionIcon } from './entity-action-icons'
import { RowActionButton } from './entity-list'
import { createDatasetColumns, type DatasetRowData } from './datasets-columns'

interface RowActionProps {
	icon: unknown
	label: string
	onClick: () => void
}

function actionPropsFromCell(cell: unknown, original: unknown): RowActionProps[] {
	if (typeof cell !== 'function') throw new Error('Expected a column cell renderer')
	const listRow = cell({ row: { original } }) as ReactElement<{ actions: ReactNode }>
	const fragment = listRow.props.actions as ReactElement<{ children: ReactNode }>
	return Children.toArray(fragment.props.children)
		.filter(
			(child): child is ReactElement<RowActionProps> =>
				isValidElement(child) && child.type === RowActionButton,
		)
		.map((child) => child.props)
}

const mapEvent = {
	id: 'map-event',
	dTag: 'map-id',
	datasetId: 'map-id',
	kind: 31991,
	pubkey: 'map-author',
} as unknown as GeoDataset

function mapRow(isOwned: boolean, isInMapStack = false): DatasetRowData {
	return {
		event: mapEvent,
		datasetKey: 'map-author:map-id',
		datasetName: 'River map',
		isActive: false,
		isOwned,
		isVisible: true,
		isInMapStack,
		primaryLabel: isOwned ? 'Edit map' : 'Propose changes',
	}
}

describe('catalog row vocabulary', () => {
	test('uses proposal semantics and iconography for a foreign map', () => {
		const loaded: GeoDataset[] = []
		const columns = createDatasetColumns({
			currentUserPubkey: 'reader',
			onLoadDataset: (event) => loaded.push(event),
			onDeleteDataset: () => {},
			onToggleVisibility: () => {},
			onToggleAllVisibility: () => {},
			onZoomToDataset: () => {},
			onAddDatasetToMap: () => {},
			isPublishing: false,
			deletingKey: null,
			allVisibleState: 'all',
		})
		const actions = actionPropsFromCell(columns[0]?.cell, mapRow(true))
		const proposal = actions.find((action) => action.label === 'Propose changes')

		expect(proposal?.icon).toBe(ProposalActionIcon)
		expect(actions.map((action) => action.label)).toContain('Add to Shelf')
		expect(actions.map((action) => action.label)).not.toContain('Load into editor')

		proposal?.onClick()
		expect(loaded).toEqual([mapEvent])
	})

	test('keeps the edit affordance for a map owned by the signed-in user', () => {
		const columns = createDatasetColumns({
			currentUserPubkey: 'map-author',
			onLoadDataset: () => {},
			onDeleteDataset: () => {},
			onToggleVisibility: () => {},
			onToggleAllVisibility: () => {},
			onZoomToDataset: () => {},
			isPublishing: false,
			deletingKey: null,
			allVisibleState: 'all',
		})
		const actions = actionPropsFromCell(columns[0]?.cell, mapRow(false))
		const edit = actions.find((action) => action.label === 'Edit map')

		expect(edit?.icon).toBe(LoadEditorActionIcon)
		expect(actions.map((action) => action.label)).not.toContain('Propose changes')
	})

	test('uses Atlas and Shelf language for atlas rows', () => {
		const atlas = {
			id: 'atlas-event',
			pubkey: 'atlas-author',
			contextId: 'atlas-id',
			context: { name: 'Field atlas' },
		} as unknown as MapContext
		const row: ContextRowData = {
			context: atlas,
			contextName: 'Field atlas',
			contextUse: 'collection',
			validationMode: null,
			attachmentPolicy: 'closed',
			displayDepth: 0,
			displayParentName: null,
			isCuratedChild: false,
			attachmentCount: 0,
			isMapActive: false,
			isInMapStack: false,
		}
		const columns = createContextColumns({
			currentUserPubkey: 'atlas-author',
			onInspectContext: () => {},
			onEditContext: () => {},
			onToggleContextOnMap: () => {},
		})
		const labels = actionPropsFromCell(columns[0]?.cell, row).map((action) => action.label)

		expect(labels).toContain('Add to Shelf')
		expect(labels).toContain('Open Atlas')
		expect(labels).toContain('Edit atlas')
		expect(labels.some((label) => /context|map stack/i.test(label))).toBe(false)
	})
})
