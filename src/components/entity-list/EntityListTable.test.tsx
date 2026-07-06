import { describe, expect, test } from 'bun:test'
import type { ColumnDef } from '@tanstack/react-table'
import { renderToStaticMarkup } from 'react-dom/server'
import { EntityListTable } from './EntityListTable'

interface TestRow {
	id: string
	name: string
}

const columns: ColumnDef<TestRow, unknown>[] = [
	{
		id: 'name',
		cell: ({ row }) => <div>{row.original.name}</div>,
	},
]

describe('EntityListTable', () => {
	test('renders cells and duplicate row ids without React key warnings', () => {
		const originalError = console.error
		const errors: string[] = []
		console.error = (...args: unknown[]) => {
			errors.push(args.map(String).join(' '))
		}

		try {
			renderToStaticMarkup(
				<EntityListTable
					columns={columns}
					data={[
						{ id: 'same-d-tag', name: 'First' },
						{ id: 'same-d-tag', name: 'Second' },
					]}
					getRowId={(row) => row.id}
				/>,
			)
		} finally {
			console.error = originalError
		}

		expect(errors).toEqual([])
	})
})
