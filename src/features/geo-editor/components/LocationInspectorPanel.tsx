import { Button } from "../../../components/ui/button";
import { X } from "lucide-react";
import type { ReverseLookupOutput } from "../../../ctxcn/EarthlyGeoServerClient";

type ReverseLookupResult = ReverseLookupOutput["result"];

interface LocationInspectorPanelProps {
  inspectorActive: boolean;
  loading: boolean;
  error: string | null;
  result: ReverseLookupResult | null;
  onPause: () => void;
  onClear: () => void;
  className?: string;
}

export function LocationInspectorPanel({
  inspectorActive,
  loading,
  error,
  result,
  onPause,
  onClear,
  className = "",
}: LocationInspectorPanelProps) {
  return (
    <div
      className={`pointer-events-auto flex h-full flex-col ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <div className="text-xs text-gray-500">
          {inspectorActive
            ? "Click on the map to get details"
            : "Inspector paused"}
        </div>
        <div className="flex items-center gap-1">
          {inspectorActive && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={onPause}
            >
              Pause
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label="Clear location details"
            onClick={onClear}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 text-sm text-gray-700">
        {loading && (
          <div className="text-xs text-gray-600">Fetching location info...</div>
        )}
        {error && <div className="text-xs text-red-600">{error}</div>}
        {result && (
          <div className="space-y-3">
            <div>
              <div className="font-medium leading-tight">
                {result.result?.displayName ?? "No address found"}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {result.coordinates.lat.toFixed(4)},{" "}
                {result.coordinates.lon.toFixed(4)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              {result.result?.type && (
                <span className="rounded-full bg-gray-100 px-2 py-1 capitalize">
                  {result.result.type}
                </span>
              )}
              {result.result?.class && (
                <span className="rounded-full bg-gray-100 px-2 py-1 capitalize">
                  {result.result.class}
                </span>
              )}
              {result.zoom !== undefined && (
                <span className="rounded-full bg-gray-100 px-2 py-1">
                  zoom {result.zoom}
                </span>
              )}
            </div>
            {result.result?.address && (
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-2 text-[11px] text-gray-700">
                {Object.entries(result.result.address)
                  .slice(0, 12)
                  .map(([key, value]) => (
                    <div key={key} className="flex items-center gap-1">
                      <span className="capitalize text-gray-500">{key}:</span>
                      <span className="truncate">{value}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
        {inspectorActive && !result && !loading && !error && (
          <div className="text-xs text-gray-600">
            Click anywhere on the map to reverse geocode.
          </div>
        )}
      </div>
    </div>
  );
}
