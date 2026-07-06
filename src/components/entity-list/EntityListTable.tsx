/**
 * EntityListTable — the shared table substrate for every entity list rail.
 *
 * It's a headless TanStack `useReactTable` (so all rails share one row model /
 * `getRowId` / selection-capable substrate — "based on data tables") rendered as
 * a dense, header-less single column of `ListRow`s inside one hairline-bordered
 * scroll frame. Each entity supplies a one-column `ColumnDef` whose `cell` is a
 * `<ListRow/>`, so Datasets, Contexts, Beacons, Sightings and Stories all flow
 * through the exact same grammar and chrome.
 */

import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { Fragment } from 'react'
import { cn } from '@/lib/utils'

interface EntityListTableProps<TData> {
	/** Typically a single display column whose `cell` renders a `<ListRow/>`. */
	columns: ColumnDef<TData, unknown>[]
	data: TData[]
	getRowId: (row: TData, index: number) => string
	className?: string
}

export function EntityListTable<TData>({
	columns,
	data,
	getRowId,
	className,
}: EntityListTableProps<TData>) {
	const table = useReactTable({
		data,
		columns,
		getRowId,
		getCoreRowModel: getCoreRowModel(),
	})
	const rowKeyCounts = new Map<string, number>()

	return (
		<div
			className={cn(
				// Hide the final row's hairline so it doesn't double up with the frame.
				'overflow-hidden rounded-[3px] border border-border bg-card [&>div:last-child>div]:border-b-0',
				className,
			)}
		>
			{table.getRowModel().rows.map((row) => {
				const seen = rowKeyCounts.get(row.id) ?? 0
				rowKeyCounts.set(row.id, seen + 1)
				const rowKey = seen === 0 ? row.id : `${row.id}:${seen}`

				return (
					<div key={rowKey}>
						{row.getVisibleCells().map((cell) => (
							<Fragment key={cell.id}>
								{flexRender(cell.column.columnDef.cell, cell.getContext())}
							</Fragment>
						))}
					</div>
				)
			})}
		</div>
	)
}
