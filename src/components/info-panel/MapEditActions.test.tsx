import { describe, expect, test } from 'bun:test'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { MapEditActions } from './MapEditActions'
import type { DatasetEditOptions } from './mapProposalPresentation'

const dataset = (tags: string[][] = []) => ({ event: { tags } }) as GeoDataset

function findAction(
	node: ReactNode,
	label: string,
): ReactElement<{ onClick?: () => void; onSelect?: () => void }> | undefined {
	for (const child of Children.toArray(node)) {
		if (
			!isValidElement<{
				children?: ReactNode
				'aria-label'?: string
				onClick?: () => void
				onSelect?: () => void
			}>(child)
		)
			continue
		if (child.props['aria-label'] === label) return child
		const found = findAction(child.props.children, label)
		if (found) return found
	}
}

describe('Map authoring entry', () => {
	test.each([
		{ owner: true, tags: [], label: 'Edit map', intent: 'edit' },
		{ owner: false, tags: [], label: 'Propose changes', intent: 'propose' },
		{ owner: false, tags: [['h', 'nearby']], label: 'Fork map', intent: 'fork' },
	] as const)('$label opens the selected local intent, never a publisher', ({
		owner,
		tags,
		label,
		intent,
	}) => {
		const map = dataset(tags.map((tag) => [...tag]))
		const calls: DatasetEditOptions[] = []
		const element = MapEditActions({
			dataset: map,
			isOwner: owner,
			onBegin: (target, options) => {
				expect(target).toBe(map)
				calls.push(options ?? {})
			},
		})
		expect(calls).toEqual([])
		expect(renderToStaticMarkup(element)).toContain(label)
		const primary = Children.toArray(element.props.children)[0] as ReactElement<{
			onClick: () => void
		}>
		primary.props.onClick()
		expect(calls).toEqual([{ intent }])
	})

	test('foreign public Map offers Fork before any draft is created', () => {
		const calls: DatasetEditOptions[] = []
		const element = MapEditActions({
			dataset: dataset(),
			isOwner: false,
			onBegin: (_map, options) => calls.push(options ?? {}),
		})
		expect(calls).toEqual([])
		const fork = findAction(element, 'Fork map')
		expect(fork).toBeDefined()
		fork?.props.onSelect?.()
		expect(calls).toEqual([{ intent: 'fork' }])
	})
})
