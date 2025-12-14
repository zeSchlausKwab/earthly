import React, { useEffect, useMemo, useState } from "react";
import { Bug, Eye, EyeOff, Maximize2, X } from "lucide-react";
import type { NDKGeoEvent } from "../lib/ndk/NDKGeoEvent";
import type { NDKGeoCollectionEvent } from "../lib/ndk/NDKGeoCollectionEvent";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { cn } from "@/lib/utils";

export interface GeoDatasetsPanelProps {
  geoEvents: NDKGeoEvent[];
  collectionEvents: NDKGeoCollectionEvent[];
  activeDataset: NDKGeoEvent | null;
  currentUserPubkey?: string;
  datasetVisibility: Record<string, boolean>;
  isPublishing: boolean;
  deletingKey: string | null;
  onClearEditing: () => void;
  onLoadDataset: (event: NDKGeoEvent) => void;
  onToggleVisibility: (event: NDKGeoEvent) => void;
  onZoomToDataset: (event: NDKGeoEvent) => void;
  onDeleteDataset: (event: NDKGeoEvent) => void;
  getDatasetKey: (event: NDKGeoEvent) => string;
  getDatasetName: (event: NDKGeoEvent) => string;
  onZoomToCollection?: (
    collection: NDKGeoCollectionEvent,
    events: NDKGeoEvent[]
  ) => void;
  onInspectDataset?: (event: NDKGeoEvent) => void;
  onInspectCollection?: (
    collection: NDKGeoCollectionEvent,
    events: NDKGeoEvent[]
  ) => void;
  onOpenDebug?: (event: NDKGeoEvent | NDKGeoCollectionEvent) => void;
  onClose?: () => void;
}

const getDatasetDescriptionText = (
  event: NDKGeoEvent
): string | undefined => {
  const featureCollection = event.featureCollection as Record<string, any>;
  if (!featureCollection) return undefined;
  const candidates = [
    featureCollection?.description,
    featureCollection?.summary,
    featureCollection?.properties?.description,
    featureCollection?.properties?.summary,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const getCollectionDisplayName = (collection: NDKGeoCollectionEvent): string => {
  const metadata = collection.metadata;
  return (
    metadata.name ??
    collection.collectionId ??
    collection.id ??
    "Untitled"
  );
};

export function GeoDatasetsPanelContent({
  geoEvents,
  collectionEvents,
  activeDataset,
  currentUserPubkey,
  datasetVisibility,
  isPublishing,
  deletingKey,
  onClearEditing,
  onLoadDataset,
  onToggleVisibility,
  onZoomToDataset,
  onDeleteDataset,
  getDatasetKey,
  getDatasetName,
  onZoomToCollection,
  onInspectDataset,
  onInspectCollection,
  onOpenDebug,
  onClose,
}: GeoDatasetsPanelProps) {
  const [activeTab, setActiveTab] = useState<"datasets" | "collections">(
    "datasets"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);

  useEffect(() => {
    if (!currentUserPubkey) {
      setOwnedOnly(false);
    }
  }, [currentUserPubkey]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const datasetReferenceMap = useMemo(() => {
    const map = new Map<string, NDKGeoEvent>();
    geoEvents.forEach((event) => {
      const datasetId = event.datasetId ?? event.dTag ?? event.id;
      if (!datasetId) return;
      const kind = event.kind ?? NDKGeoEvent.kinds[0];
      map.set(`${kind}:${event.pubkey}:${datasetId}`, event);
    });
    return map;
  }, [geoEvents]);

  const filteredGeoEvents = useMemo(() => {
    return geoEvents.filter((event) => {
      if (ownedOnly && (!currentUserPubkey || event.pubkey !== currentUserPubkey)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const datasetDescription = getDatasetDescriptionText(event);
      const searchValues = [getDatasetName(event), datasetDescription];
      return searchValues.some(
        (value) =>
          typeof value === "string" &&
          value.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [
    geoEvents,
    ownedOnly,
    currentUserPubkey,
    getDatasetName,
    normalizedQuery,
  ]);

  const filteredCollections = useMemo(() => {
    return collectionEvents.filter((collection) => {
      if (ownedOnly && (!currentUserPubkey || collection.pubkey !== currentUserPubkey)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const metadata = collection.metadata;
      const searchValues = [
        metadata.name,
        metadata.description,
        collection.collectionId,
        collection.id,
      ];
      return searchValues.some(
        (value) =>
          typeof value === "string" &&
          value.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [collectionEvents, ownedOnly, currentUserPubkey, normalizedQuery]);

  const renderCollectionTab = (collections: NDKGeoCollectionEvent[]) => {
    return collections.map((collection: NDKGeoCollectionEvent) => {
      const metadata = collection.metadata;
      const collectionName = getCollectionDisplayName(collection);
      const datasetCount = collection.datasetReferences.length;
      const referencedEvents = collection.datasetReferences
        .map((reference) => datasetReferenceMap.get(reference))
        .filter((event): event is NDKGeoEvent => Boolean(event));
      const zoomDisabled =
        !onZoomToCollection ||
        (!collection.boundingBox && referencedEvents.length === 0);

      return (
        <div
          key={`${collection.id ?? collection.collectionId}-${collection.pubkey}`}
          className="rounded-lg border border-gray-200 bg-white p-3 text-sm space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-gray-900 truncate">
              {collectionName}
            </div>
            {onOpenDebug && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Open debug dialog"
                onClick={() => onOpenDebug(collection)}
              >
                <Bug className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="text-[11px] text-gray-500 truncate">
            Maintainer: {collection.pubkey.slice(0, 8)}…
            {collection.pubkey.slice(-4)}
          </div>
          {metadata.description && (
            <p className="text-xs text-gray-600">{metadata.description}</p>
          )}
          <div className="text-[11px] text-gray-500">
            {datasetCount} dataset{datasetCount === 1 ? "" : "s"} referenced
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={zoomDisabled}
              onClick={() =>
                onZoomToCollection?.(collection, referencedEvents)
              }
            >
              <Maximize2 className="h-3 w-3" />
              Zoom bounds
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() =>
                onInspectCollection?.(collection, referencedEvents)
              }
            >
              Inspect
            </Button>
          </div>
          {metadata.tags && metadata.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {metadata.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600">
              Geo events
            </div>
            {referencedEvents.length === 0 ? (
              <p className="text-[11px] text-gray-500">
                No referenced datasets loaded yet.
              </p>
            ) : (
              <ul className="list-disc space-y-1 pl-4 text-[11px] text-gray-700">
                {referencedEvents.map((event) => (
                  <li key={event.id ?? event.datasetId}>
                    {getDatasetName(event)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      );
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Datasets</h3>
          <p className="text-xs text-gray-500">
            Remote GeoJSON datasets and collections available to load.
          </p>
        </div>
        {onClose && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close datasets panel"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={activeTab === "datasets" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setActiveTab("datasets")}
        >
          Geo events
        </Button>
        <Button
          size="sm"
          variant={activeTab === "collections" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setActiveTab("collections")}
        >
          Collections
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          size="xs"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search name or description…"
          className="flex-1 min-w-0"
        />
        <Button
          size="xs"
          variant={ownedOnly ? "default" : "outline"}
          onClick={() => setOwnedOnly((value) => !value)}
          aria-pressed={ownedOnly}
          disabled={!currentUserPubkey}
          className="whitespace-nowrap"
          title={
            currentUserPubkey
              ? undefined
              : "Connect a pubkey to filter datasets you own"
          }
        >
          Owned by me
        </Button>
      </div>

      {activeTab === "datasets" ? (
        <>
          {activeDataset && (
            <Button
              size="sm"
              onClick={onClearEditing}
              variant="destructive"
              className="w-full"
            >
              Cancel editing
            </Button>
          )}

          {geoEvents.length === 0 ? (
            <p className="text-xs text-gray-500">
              Listening for GeoJSON datasets…
            </p>
          ) : filteredGeoEvents.length === 0 ? (
            <p className="text-xs text-gray-500">
              No datasets match your filters.
            </p>
          ) : (
            filteredGeoEvents.map((event: NDKGeoEvent) => {
              const datasetKey = getDatasetKey(event);
              const isActive =
                activeDataset && getDatasetKey(activeDataset) === datasetKey;
              const isOwned = currentUserPubkey === event.pubkey;
              const primaryLabel = isActive
                ? "Loaded in editor"
                : isOwned
                  ? "Edit dataset"
                  : "Load copy";
              const datasetName = getDatasetName(event);
              const isVisible = datasetVisibility[datasetKey] !== false;

              return (
                <div
                  key={`${event.id}-${datasetKey}`}
                  className={cn(
                    "rounded-lg border border-gray-200 bg-white p-2 text-sm space-y-2",
                    !isVisible && "opacity-60"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-gray-900 truncate">
                      {datasetName}
                    </div>
                    {onOpenDebug && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Open debug"
                        onClick={() => onOpenDebug(event)}
                      >
                        <Bug className="h-4 w-4" />
                      </Button>
                    )}
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
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        size="xs"
                        className={cn(
                          isActive
                            ? "bg-green-600 text-white hover:bg-green-700"
                            : "bg-blue-600 text-white hover:bg-blue-700"
                        )}
                        onClick={() => onLoadDataset(event)}
                        disabled={!!isActive || isPublishing}
                      >
                        {primaryLabel}
                      </Button>
                      {isOwned && (
                        <Button
                          size="xs"
                          variant="destructive"
                          onClick={() => onDeleteDataset(event)}
                          disabled={deletingKey === datasetKey}
                        >
                          {deletingKey === datasetKey ? "Deleting…" : "Delete"}
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onInspectDataset?.(event)}
                      >
                        Inspect
                      </Button>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <Button
                        size="xs"
                        variant="outline"
                        className="flex-1"
                        onClick={() => onToggleVisibility(event)}
                      >
                        {isVisible ? (
                          <Eye className="h-3 w-3" />
                        ) : (
                          <EyeOff className="h-3 w-3" />
                        )}
                        {isVisible ? "Hide" : "Show"}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        className="flex-1"
                        onClick={() => onZoomToDataset(event)}
                      >
                        <Maximize2 className="h-3 w-3" />
                        Zoom
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </>
      ) : (
        <div className="space-y-2">
          {collectionEvents.length === 0 ? (
            <p className="text-xs text-gray-500">
              Listening for GeoJSON collections…
            </p>
          ) : filteredCollections.length === 0 ? (
            <p className="text-xs text-gray-500">
              No collections match your filters.
            </p>
          ) : (
            renderCollectionTab(filteredCollections)
          )}
        </div>
      )}
    </div>
  );
}

export function GeoDatasetsSidebar({ className, ...props }: GeoDatasetsPanelProps & { className?: string }) {
  return (
    <div className={cn("w-80 rounded-2xl bg-white/95 p-4 shadow-xl backdrop-blur", className)}>
      <GeoDatasetsPanelContent {...props} />
    </div>
  );
}
