import {
  type ColumnDef,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { type ReactNode, useState } from "react"
import { type CustomFeature, type CustomFeatureCollection } from "~/store/edit-collection-store"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"

const geoJsonMockData: CustomFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        id: "9894f143-e79a-4ee3-b103-fa3f8610db6c",
        name: "line",
        description: "line description",
        color: "#ff0000",
      },
      geometry: {
        coordinates: [
          [
            [16.323749688483872, 48.1862092832483],
            [16.32068722974782, 48.18768149123477],
            [16.31728628873111, 48.18699374970157],
            [16.314691257907953, 48.18499494848464],
            [16.319526719069046, 48.18279187834793],
            [16.321605967368413, 48.18468330041003],
            [16.324346062026507, 48.183608637346],
            [16.32679602901547, 48.184543595485906],
            [16.326908856442373, 48.185994358836524],
            [16.323749688483872, 48.1862092832483],
          ],
        ],
        type: "Polygon",
      },
    },
    {
      type: "Feature",
      properties: {
        id: "00811783-b93b-4645-ba2b-834b2a9d378f",
        name: "area hello",
        description: "area description",
        color: "#ff0000",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [16.32060663837501, 48.18213870627786],
            [16.320377203485496, 48.18213119066647],
            [16.320149978379607, 48.182108716218316],
            [16.319927151551834, 48.1820714993941],
            [16.319710869123767, 48.18201989864379],
            [16.319503214168936, 48.181954410953374],
            [16.31930618664568, 48.18187566705695],
            [16.31912168413159, 48.18178442536044],
            [16.318951483545117, 48.18168156463547],
            [16.318797224030664, 48.18156807555375],
            [16.318660391171946, 48.18144505114397],
            [16.31854230268577, 48.1813136762626],
            [16.31844409573398, 48.18117521618072],
            [16.318366715975568, 48.18103100439644],
            [16.318310908464387, 48.180882429790636],
            [16.318277210479856, 48.18073092324958],
            [16.318265946359478, 48.180577943883556],
            [16.3182772243827, 48.180424964974044],
            [16.318310935735795, 48.18027345978499],
            [16.318366755567517, 48.18012488737474],
            [16.318444146124975, 48.179980678545164],
            [16.31854236193931, 48.1798422220636],
            [16.318660457010946, 48.179710851289805],
            [16.31879729392498, 48.17958783133702],
            [16.318951554808745, 48.17947434689041],
            [16.319121754025904, 48.17937149080053],
            [16.319306252484683, 48.179280253561004],
            [16.31950327342247, 48.179201513772156],
            [16.319710919514762, 48.17913602968207],
            [16.319927191143783, 48.17908443188646],
            [16.320150005651012, 48.17904721725779],
            [16.32037721738834, 48.179024744161644],
            [16.32060663837501, 48.179017229006774],
            [16.32083605936168, 48.179024744161644],
            [16.32106327109901, 48.17904721725779],
            [16.32128608560624, 48.17908443188646],
            [16.32150235723526, 48.17913602968207],
            [16.321710003327553, 48.179201513772156],
            [16.32190702426534, 48.179280253561004],
            [16.32209152272412, 48.17937149080053],
            [16.322261721941278, 48.17947434689041],
            [16.322415982825042, 48.17958783133702],
            [16.322552819739077, 48.179710851289805],
            [16.32267091481071, 48.1798422220636],
            [16.322769130625048, 48.179980678545164],
            [16.322846521182505, 48.18012488737474],
            [16.322902341014228, 48.18027345978499],
            [16.322936052367325, 48.180424964974044],
            [16.322947330390544, 48.180577943883556],
            [16.322936066270167, 48.18073092324958],
            [16.322902368285636, 48.180882429790636],
            [16.322846560774455, 48.18103100439644],
            [16.322769181016042, 48.18117521618072],
            [16.322670974064252, 48.1813136762626],
            [16.322552885578077, 48.18144505114397],
            [16.32241605271936, 48.18156807555375],
            [16.322261793204905, 48.18168156463547],
            [16.322091592618435, 48.18178442536044],
            [16.321907090104343, 48.18187566705695],
            [16.32171006258109, 48.181954410953374],
            [16.321502407626255, 48.18201989864379],
            [16.32128612519819, 48.1820714993941],
            [16.32106329837042, 48.182108716218316],
            [16.320836073264527, 48.18213119066647],
            [16.32060663837501, 48.18213870627786],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        id: "8d798acf-df08-4643-b323-b37eccd3f22d",
        name: "point",
        description: "point description",
        color: "#ff0000",
      },
      geometry: {
        coordinates: [16.324491125508303, 48.1886056308864],
        type: "Point",
      },
    },
    {
      type: "Feature",
      properties: {
        id: "85a5ccbd-79a5-4652-b771-f5edec689beb",
        name: "point",
        description: "point description",
        color: "#ff0000",
      },
      geometry: {
        coordinates: [16.327279574778004, 48.18669286137711],
        type: "Point",
      },
    },
    {
      type: "Feature",
      properties: {
        id: "52c9c256-c2f4-496b-ac8c-e2aaad095615",
        name: "point",
        description: "point description",
        color: "#ff0000",
      },
      geometry: {
        coordinates: [16.33235680899736, 48.185940629091704],
        type: "Point",
      },
    },
    {
      type: "Feature",
      properties: {
        id: "c18f0af1-b156-4b45-8835-a7eb69538354",
        name: "MULTI",
        description: "MULTI description",
        color: "#ff0000",
      },
      geometry: {
        coordinates: [
          [
            [
              [16.324091418889367, 48.182553830562625],
              [16.322327025575845, 48.182523665787244],
              [16.321162073580922, 48.18179216455641],
              [16.322926466894444, 48.18077407845965],
              [16.324792652129446, 48.181256729203966],
              [16.324091418889367, 48.182553830562625],
            ],
            [
              [16.327484482953736, 48.18139247390718],
              [16.32593498369758, 48.181837412358135],
              [16.325177199389515, 48.18061570769379],
              [16.325686159119357, 48.1801104261819],
              [16.327683271021044, 48.180458422268885],
              [16.328305332766405, 48.18088074451941],
              [16.327484482953736, 48.18139247390718],
            ],
            [
              [16.32468466842127, 48.17980026251212],
              [16.323881643259767, 48.18034325459493],
              [16.3217440128995, 48.17997371894177],
              [16.321529118842136, 48.17868409405801],
              [16.32417570881185, 48.17807320779036],
              [16.325408522088082, 48.178970680169016],
              [16.32468466842127, 48.17980026251212],
            ],
          ],
        ],
        type: "MultiPolygon",
      },
    },
    {
      type: "Feature",
      properties: {
        id: "ccf5304e-7fff-44f8-a23b-aedd922964ec",
        name: "point",
        description: "point description",
        color: "#ff0000",
      },
      geometry: {
        coordinates: [16.328133839582563, 48.18140550912284],
        type: "Point",
      },
    },
    {
      type: "Feature",
      properties: {
        id: "f3223bb3-07c9-4383-b42f-30a50f3949d4",
        name: "line string",
        description: "line string description",
        color: "#ff0000",
      },
      geometry: {
        coordinates: [
          [16.320380983521176, 48.18958347985608],
          [16.320542165559715, 48.18858413949053],
          [16.320638874783043, 48.18806834329044],
          [16.321992803907648, 48.1874343366822],
          [16.323524033275277, 48.18691852891007],
          [16.3246523075469, 48.18634898513085],
          [16.326924974292837, 48.18674659183239],
          [16.327634175262432, 48.185671972028416],
          [16.32702168351534, 48.18555376247414],
          [16.32765029346683, 48.184554343531005],
          [16.32636083715667, 48.18430717239963],
          [16.327505229631868, 48.18397402681464],
          [16.327053919923372, 48.18353341158641],
          [16.326941092496497, 48.182630675874776],
          [16.326989447108133, 48.18005134338139],
        ],
        type: "LineString",
      },
    },
  ],
}

type CustomFeatureWithSubRows = CustomFeature & {
  subRows: CustomFeature[]
}

const columns: ColumnDef<CustomFeatureWithSubRows>[] = [
  {
    accessorFn: (row) => row.geometry.type,
    header: "Type",
    cell: (cell) => {
      return <div className="flex items-center">{cell.getValue() as ReactNode}</div>
    },
  },
  {
    accessorFn: (row) => row.properties.id,
    header: "Id",
    cell: (cell) => {
      return (
        <div className="flex items-center">
          <div className="mr-2 h-4 w-4 rounded-full bg-gray-400"></div>
          <div>{cell.getValue() as ReactNode}</div>
        </div>
      )
    },
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
          <div className="rounded-ful mr-2 h-4 w-4" style={{ backgroundColor: cell.getValue() as string }}></div>
          <div>{cell.getValue() as ReactNode}</div>
        </div>
      )
    },
  },
]

export default function GeoJsonUploadDialog({}) {
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const table = useReactTable<CustomFeatureWithSubRows>({
    data: geoJsonMockData.features.map((feature) => {
      if (feature.geometry.type === "MultiPolygon") {
        return {
          ...feature,
          subRows: feature.geometry.coordinates.map((coordinates) => {
            return {
              ...feature,
              geometry: {
                ...feature.geometry,
                coordinates,
              },
            }
          }),
        }
      } else {
        return feature
      }
    }) as CustomFeatureWithSubRows[],
    columns: columns,
    state: {
      expanded,
    },
    onExpandedChange: setExpanded,
    getSubRows: (row) => row.subRows as CustomFeatureWithSubRows[],
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    debugTable: true,
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
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
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
