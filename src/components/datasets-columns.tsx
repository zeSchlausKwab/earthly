import { type ColumnDef } from "@tanstack/react-table";
import { Bug, Eye, EyeOff, Maximize2, Pencil, Trash2, Search, Download } from "lucide-react";
import type { NDKGeoEvent } from "../lib/ndk/NDKGeoEvent";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export interface DatasetRowData {
  event: NDKGeoEvent;
  datasetKey: string;
  datasetName: string;
  isActive: boolean;
  isOwned: boolean;
  isVisible: boolean;
  primaryLabel: string;
}

export interface DatasetColumnsContext {
  onLoadDataset: (event: NDKGeoEvent) => void;
  onDeleteDataset: (event: NDKGeoEvent) => void;
  onToggleVisibility: (event: NDKGeoEvent) => void;
  onZoomToDataset: (event: NDKGeoEvent) => void;
  onInspectDataset?: (event: NDKGeoEvent) => void;
  onOpenDebug?: (event: NDKGeoEvent) => void;
  isPublishing: boolean;
  deletingKey: string | null;
}

export const createDatasetColumns = (
  context: DatasetColumnsContext
): ColumnDef<DatasetRowData>[] => [
  {
    accessorKey: "datasetName",
    header: "Dataset",
    cell: ({ row }) => {
      const { event, datasetName } = row.original;
      return (
        <div className="space-y-1 min-w-[200px]">
          <div className="font-semibold text-gray-900 truncate">
            {datasetName}
          </div>
          <div className="text-[11px] text-gray-500 truncate">
            Owner: {event.pubkey.slice(0, 8)}…{event.pubkey.slice(-4)}
          </div>
          {event.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {event.hashtags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    },
  },
  {
    id: "actions",
    header: "Actions",
    cell: ({ row }) => {
      const { event, isActive, isOwned, isVisible, datasetKey } =
        row.original;
      return (
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            className={cn(
              isActive
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-blue-600 text-white hover:bg-blue-700"
            )}
            onClick={() => context.onLoadDataset(event)}
            disabled={!!isActive || context.isPublishing}
            aria-label={isActive ? "Loaded in editor" : isOwned ? "Edit dataset" : "Load copy"}
            title={isActive ? "Loaded in editor" : isOwned ? "Edit dataset" : "Load copy"}
          >
            {isOwned ? <Pencil className="h-4 w-4" /> : <Download className="h-4 w-4" />}
          </Button>
          {isOwned && (
            <Button
              size="icon-sm"
              variant="destructive"
              onClick={() => context.onDeleteDataset(event)}
              disabled={context.deletingKey === datasetKey}
              aria-label="Delete dataset"
              title={context.deletingKey === datasetKey ? "Deleting…" : "Delete dataset"}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => context.onInspectDataset?.(event)}
            aria-label="Inspect dataset"
            title="Inspect dataset"
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => context.onToggleVisibility(event)}
            aria-label={isVisible ? "Hide dataset" : "Show dataset"}
            title={isVisible ? "Hide dataset" : "Show dataset"}
          >
            {isVisible ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => context.onZoomToDataset(event)}
            aria-label="Zoom to dataset"
            title="Zoom to dataset"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          {context.onOpenDebug && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Open debug"
              title="Open debug"
              onClick={() => context.onOpenDebug?.(event)}
            >
              <Bug className="h-4 w-4" />
            </Button>
          )}
        </div>
      );
    },
  },
];