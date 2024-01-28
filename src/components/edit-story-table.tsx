import {
  flexRender,
  getCoreRowModel,
  type RowData,
  useReactTable,
} from "@tanstack/react-table"
import { type ReactNode, useEffect, useState } from "react"
import {
  type CustomFeature,
  type CustomFeatureCollection,
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
import { Button } from "./ui/button"

type CustomFeatureWithSubRows = CustomFeature & {
  selected: boolean
  subRows: CustomFeature[]
  getCheckboxProps: (roe: typeof TableRow) => { disabled: boolean }
}

declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnId: string, value: unknown) => void
  }
}

export default function EditingStoryTable({
  tableData,
  gorupItems,
  splitItems,
}: {
  tableData: CustomFeatureCollection
  gorupItems: (ids: string[]) => void
  splitItems: (ids: string) => void
}) {
  const [data, setData] = useState<CustomFeatureWithSubRows[]>(
    tableData.features as CustomFeatureWithSubRows[],
  )
  const [selectedGeometryType, setSelectedGeometryType] = useState<string>()
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setData(tableData.features as CustomFeatureWithSubRows[])
  }, [tableData])

  const table = useReactTable<CustomFeatureWithSubRows>({
    data,
    columns: [
      {
        cell: ({ getValue, cell, row, column: { id }, table }) => {
          const localId = row.original.properties.id
          const isDisabled = selectedGeometryType
            ? selectedGeometryType !== row.original.geometry.type
            : false

          const onCheckedChange = (e: boolean) => {
            const numberOfSelectedRows = Object.values(selectedRows).filter(
              (v) => v === true,
            ).length

            if (numberOfSelectedRows === 0) {
              setSelectedGeometryType(row.original.geometry.type)
            }

            setSelectedRows((prev) => {
              const newValue = !prev[localId]

              const isLastItem =
                Object.entries(prev).filter((k, v) => {
                  return k[1] === true
                }).length === 1

              if (isLastItem && !newValue) {
                setSelectedGeometryType(undefined)
              }
              return {
                ...prev,
                [localId]: newValue,
              }
            })
          }
          return (
            <Checkbox
              checked={selectedRows[localId]}
              disabled={isDisabled}
              onCheckedChange={onCheckedChange}
            />
          )
        },
        header: "Group",
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
    ],
    defaultColumn: {
      // cell: ({ getValue, row: { index }, column: { id }, table }) => {
      //   const initialValue = getValue()
      //   const [value, setValue] = useState(initialValue)
      //   const onBlur = () => {
      //     table.options.meta?.updateData(index, id, value)
      //   }
      //   useEffect(() => {
      //     setValue(initialValue)
      //   }, [initialValue])
      //   return (
      //     <input
      //       value={value as string}
      //       onChange={(e) => setValue(e.target.value)}
      // onBlur={onBlur}
      //     />
      //   )
      // },
    },
    getCoreRowModel: getCoreRowModel(),
    meta: {
      updateData: (rowIndex, columnId, value) => {
        console.log(rowIndex, columnId, value)
      },
    },
  })

  const handleGroupItems = () => {
    const selectedIds = Object.entries(selectedRows)
      .filter((k, v) => {
        return k[1] === true
      })
      .map((k) => k[0])

    gorupItems(selectedIds)
    setSelectedRows({})
    setSelectedGeometryType(undefined)
  }

  const handleSplitItems = () => {
    const selectedIds = Object.entries(selectedRows)
      .filter((k, v) => {
        return k[1] === true
      })
      .map((k) => k[0])

    splitItems(selectedIds[0] ?? "")
    setSelectedRows({})
    setSelectedGeometryType(undefined)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-row">
        {selectedGeometryType && selectedGeometryType?.startsWith("Multi") ? (
          <Button onClick={() => handleSplitItems()}>Split group</Button>
        ) : (
          <Button onClick={() => handleGroupItems()}>Group items</Button>
        )}
      </div>
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
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getAllColumns().length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
