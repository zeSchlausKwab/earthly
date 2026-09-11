import { describe, expect, test } from 'bun:test'
import type { ColumnDef } from '@tanstack/react-table'
import { renderToStaticMarkup } from 'react-dom/server'
import { EntityListTable } from './EntityListTable'
import { ListRow } from './ListRow'
import { EntityListTranslucencyContext } from './TranslucencyContext'

interface TestRow {
	id: string
	selected?: boolean
	selectedClassName?: string
}

const columns: ColumnDef<TestRow, unknown>[] = [
	{
		id: 'entity',
		cell: ({ row }) => (
			<ListRow
				title={row.original.id}
				selected={row.original.selected}
				selectedClassName={row.original.selectedClassName}
			/>
		),
	},
]

function list(data: TestRow[] = [{ id: 'River map' }]) {
	return <EntityListTable columns={columns} data={data} getRowId={(row) => row.id} />
}

function surfaceTag(markup: string) {
	return markup.slice(0, markup.indexOf('>') + 1)
}

describe('entity list translucency', () => {
	test('keeps desktop lists opaque without a sheet provider', () => {
		const markup = renderToStaticMarkup(list())
		expect(surfaceTag(markup)).toContain('data-translucent="false"')
		expect(surfaceTag(markup)).toContain('bg-card')
		expect(surfaceTag(markup)).not.toContain('bg-transparent')
	})

	test('removes the card fill from the actual list surface inside a translucent sheet', () => {
		const markup = renderToStaticMarkup(
			<EntityListTranslucencyContext.Provider value={true}>
				{list()}
			</EntityListTranslucencyContext.Provider>,
		)
		expect(surfaceTag(markup)).toContain('data-translucent="true"')
		expect(surfaceTag(markup)).toContain('bg-transparent')
		expect(markup).not.toContain('bg-card')
		expect(markup).toContain('border-l-transparent bg-transparent hover:bg-muted/40')
	})

	test('preserves selection and hover overlays over a translucent surface', () => {
		const markup = renderToStaticMarkup(
			<EntityListTranslucencyContext.Provider value={true}>
				{list([
					{ id: 'Selected map', selected: true },
					{
						id: 'Live location',
						selected: true,
						selectedClassName: 'border-l-ok bg-ok/[0.08]',
					},
					{ id: 'Other map' },
				])}
			</EntityListTranslucencyContext.Provider>,
		)
		expect(markup).toContain('border-l-primary bg-primary/[0.08]')
		expect(markup).toContain('border-l-ok bg-ok/[0.08]')
		expect(markup).toContain('hover:bg-muted/40')
		expect(markup).not.toContain('bg-card')
	})

	test('restores an opaque list when the sheet disables translucency', () => {
		const markup = renderToStaticMarkup(
			<EntityListTranslucencyContext.Provider value={true}>
				<EntityListTranslucencyContext.Provider value={false}>
					{list()}
				</EntityListTranslucencyContext.Provider>
			</EntityListTranslucencyContext.Provider>,
		)
		expect(surfaceTag(markup)).toContain('data-translucent="false"')
		expect(surfaceTag(markup)).toContain('bg-card')
	})
})
