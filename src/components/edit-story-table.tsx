import {
  ColumnDef,
  RowData,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ReactNode, useEffect, useState } from "react"
import {
  CustomFeature,
  CustomFeatureCollection,
} from "~/store/edit-collection-store"
import { Checkbox } from "./ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table"

type CustomFeatureWithSubRows = CustomFeature & {
  subRows: CustomFeature[]
}

declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnId: string, value: unknown) => void
  }
}

const defaultColumn: Partial<ColumnDef<CustomFeatureWithSubRows>> = {
  cell: ({ getValue, row: { index }, column: { id }, table }) => {
    const initialValue = getValue()
    const [value, setValue] = useState(initialValue)

    const onBlur = () => {
      table.options.meta?.updateData(index, id, value)
    }

    useEffect(() => {
      setValue(initialValue)
    }, [initialValue])

    return (
      <input
        value={value as string}
        onChange={(e) => setValue(e.target.value)}
        onBlur={onBlur}
      />
    )
  },
}

export const columns: ColumnDef<CustomFeatureWithSubRows>[] = [
  {
    accessorFn: (row) => row.geometry.type,
    header: "Group",
    cell: (cell) => {
      return <Checkbox />
    },
  },
  {
    accessorFn: (row) => row.geometry.type,
    header: "Type",
  },
  {
    accessorFn: (row) => row.properties.name,
    header: "Name",
  },
  {
    accessorFn: (row) => row.properties.description,
    header: "Descriptioin",
  },
  {
    accessorFn: (row) => row.properties.color,
    header: "Color",
    cell: (cell) => {
      return (
        <div className="flex items-center">
          <div
            className="rounded-ful mr-2 h-4 w-4"
            style={{ backgroundColor: cell.getValue() as string }}
          ></div>
          <div>{cell.getValue() as ReactNode}</div>
        </div>
      )
    },
  },
]

export default function EditingStoryTable({
  tableData,
}: {
  tableData: CustomFeatureCollection
}) {
  const [selectedRows, setSelectedRows] = useState<CustomFeatureWithSubRows[]>(
    [],
  )
  const table = useReactTable<CustomFeatureWithSubRows>({
    data: tableData.features as CustomFeatureWithSubRows[],
    columns: columns,
    defaultColumn,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      updateData: (rowIndex, columnId, value) => {
        console.log(rowIndex, columnId, value)
        // setData((old) =>
        //   old.map((row, index) => {
        //     if (index === rowIndex) {
        //       return {
        //         ...old[rowIndex]!,
        //         [columnId]: value,
        //       }
        //     }
        //     return row
        //   }),
        // )
      },
    },
  })

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
