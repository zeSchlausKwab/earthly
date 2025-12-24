import { useNDK, useNDKCurrentUser } from "@nostr-dev-kit/react";
import * as turf from "@turf/turf";
import type { FeatureCollection } from "geojson";
import { Edit3, FilePenLine, Layers, Search, UploadCloud } from "lucide-react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeoDatasetsPanelContent } from "../../components/GeoDatasetsPanel";
import { GeoEditorInfoPanelContent } from "../../components/GeoEditorInfoPanel";
import { LoginSessionButtons } from "../../components/LoginSessionButtom";
import { Button } from "../../components/ui/button";
import { Sheet, SheetContent } from "../../components/ui/sheet";
import {
  earthlyGeoServer,
  type ReverseLookupOutput,
} from "../../ctxcn/EarthlyGeoServerClient";
import { resolveGeoEventFeatureCollection } from "../../lib/geo/resolveBlobReferences";
import { useIsMobile } from "../../lib/hooks/useIsMobile";
import { useGeoCollections, useStations } from "../../lib/hooks/useStations";
import { NDKGeoCollectionEvent } from "../../lib/ndk/NDKGeoCollectionEvent";
import type { GeoBlobReference } from "../../lib/ndk/NDKGeoEvent";
import { NDKGeoEvent } from "../../lib/ndk/NDKGeoEvent";
import { Editor } from "./components/Editor";
import { LocationInspectorPanel } from "./components/LocationInspectorPanel";
import { Magnifier } from "./components/Magnifier";
import { Map as MapComponent } from "./components/Map";
import { Toolbar } from "./components/Toolbar";
import type { EditorFeature, EditorMode } from "./core";
import { useEditorStore } from "./store";
import type { EditorBlobReference } from "./types";
import {
  convertGeoEventsToEditorFeatures,
  convertGeoEventsToFeatureCollection,
  createDefaultCollectionMeta,
  ensureFeatureCollection,
  extractCollectionMeta,
  parseCustomValue,
  sanitizeEditorProperties,
} from "./utils";

const REMOTE_SOURCE_ID = "geo-editor-remote-datasets";
const REMOTE_FILL_LAYER = "geo-editor-remote-fill";
const REMOTE_LINE_LAYER = "geo-editor-remote-line";
const BLOB_PREVIEW_SOURCE_ID = "geo-editor-blob-preview";
const BLOB_PREVIEW_FILL_LAYER = "geo-editor-blob-preview-fill";
const BLOB_PREVIEW_LINE_LAYER = "geo-editor-blob-preview-line";
const MAGNIFIER_SIZE = 140;
const MAGNIFIER_OFFSET = { x: 80, y: -80 };
const POINTER_OFFSET = { x: 0, y: -48 }; // keep in sync with GeoEditor pointerOffsetPx

import type { GeoSearchResult } from "./types";
type ReverseLookupResult = ReverseLookupOutput["result"];

export function GeoEditorView() {
  const map = useRef<maplibregl.Map | null>(null);
  const editor = useEditorStore((state) => state.editor);

  const resolvedCollectionsRef = useRef<
    Map<
      string,
      {
        eventId?: string | null;
        featureCollection: FeatureCollection;
      }
    >
  >(new Map());
  const isMountedRef = useRef(true);
  const geoEventsRef = useRef<NDKGeoEvent[]>([]);
  const [mounted, setMounted] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const features = useEditorStore((state) => state.features);
  const setFeatures = useEditorStore((state) => state.setFeatures);
  const stats = useEditorStore((state) => state.stats);
  const selectedFeatureIds = useEditorStore(
    (state) => state.selectedFeatureIds
  );
  const selectionCount = selectedFeatureIds.length;
  const selectedFeatureId = selectionCount === 1 ? selectedFeatureIds[0] : null;
  const setSelectedFeatureIds = useEditorStore(
    (state) => state.setSelectedFeatureIds
  );

  const { events: geoEvents } = useStations([{ limit: 50 }]);
  const { events: collectionEvents } = useGeoCollections([{ limit: 50 }]);
  const { ndk } = useNDK();
  const currentUser = useNDKCurrentUser();
  const activeDataset = useEditorStore((state) => state.activeDataset);
  const setActiveDataset = useEditorStore((state) => state.setActiveDataset);
  const datasetVisibility = useEditorStore((state) => state.datasetVisibility);
  const setDatasetVisibility = useEditorStore(
    (state) => state.setDatasetVisibility
  );
  const collectionMeta = useEditorStore((state) => state.collectionMeta);
  const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta);
  const setNewCollectionProp = useEditorStore(
    (state) => state.setNewCollectionProp
  );
  const setNewFeatureProp = useEditorStore((state) => state.setNewFeatureProp);
  const isPublishing = useEditorStore((state) => state.isPublishing);
  const setIsPublishing = useEditorStore((state) => state.setIsPublishing);
  const setPublishMessage = useEditorStore((state) => state.setPublishMessage);
  const setPublishError = useEditorStore((state) => state.setPublishError);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const showDatasetsPanel = useEditorStore((state) => state.showDatasetsPanel);
  const setShowDatasetsPanel = useEditorStore(
    (state) => state.setShowDatasetsPanel
  );
  const showInfoPanel = useEditorStore((state) => state.showInfoPanel);
  const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel);
  const mobileDatasetsOpen = useEditorStore(
    (state) => state.mobileDatasetsOpen
  );
  const setMobileDatasetsOpen = useEditorStore(
    (state) => state.setMobileDatasetsOpen
  );
  const mobileInfoOpen = useEditorStore((state) => state.mobileInfoOpen);
  const setMobileInfoOpen = useEditorStore((state) => state.setMobileInfoOpen);
  const setShowTips = useEditorStore((state) => state.setShowTips);
  const mobileToolsOpen = useEditorStore((state) => state.mobileToolsOpen);
  const mobileSearchOpen = useEditorStore((state) => state.mobileSearchOpen);
  const mobileActionsOpen = useEditorStore((state) => state.mobileActionsOpen);
  const setMobileActiveState = useEditorStore(
    (state) => state.setMobileActiveState
  );

  const panLocked = useEditorStore((state) => state.panLocked);
  const setPanLocked = useEditorStore((state) => state.setPanLocked);
  const canFinishDrawing = useEditorStore((state) => state.canFinishDrawing);
  const currentMode = useEditorStore((state) => state.mode);
  const setCurrentMode = useEditorStore((state) => state.setMode);

  // Local UI state
  const [showToolbar, setShowToolbar] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<
    "datasets" | "info" | "editor" | "dataset" | "inspector"
  >("datasets");
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [magnifierEnabled, setMagnifierEnabled] = useState(false);
  const [magnifierVisible, setMagnifierVisible] = useState(false);
  const [magnifierPosition, setMagnifierPosition] = useState({ x: 0, y: 0 });
  const [magnifierCenter, setMagnifierCenter] = useState<[number, number]>([
    0, 0,
  ]);
  const [infoMode, setInfoMode] = useState<
    "properties" | "json" | "edit" | "view"
  >("properties");
  const [previousMode, setPreviousMode] = useState<string | null>(null);

  const mapSource = useEditorStore((state) => state.mapSource);

  const inspectorActive = useEditorStore((state) => state.inspectorActive);
  const setInspectorActive = useEditorStore(
    (state) => state.setInspectorActive
  );
  const [reverseLookupResult, setReverseLookupResult] =
    useState<ReverseLookupResult | null>(null);
  const [remoteLayersReady, setRemoteLayersReady] = useState(false);
  const [reverseLookupStatus, setReverseLookupStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [reverseLookupError, setReverseLookupError] = useState<string | null>(
    null
  );
  const viewingDataset = useEditorStore((state) => state.viewDataset);
  const setViewingDataset = useEditorStore((state) => state.setViewDataset);
  const viewingCollection = useEditorStore((state) => state.viewCollection);
  const setViewingCollection = useEditorStore(
    (state) => state.setViewCollection
  );
  const setViewingCollectionEvents = useEditorStore(
    (state) => state.setViewCollectionEvents
  );
  const [debugEvent, setDebugEvent] = useState<
    NDKGeoEvent | NDKGeoCollectionEvent | null
  >(null);
  const [debugDialogOpen, setDebugDialogOpen] = useState(false);
  const [resolvedCollectionsVersion, setResolvedCollectionsVersion] =
    useState(0);
  const blobReferences = useEditorStore((state) => state.blobReferences);
  const setBlobReferences = useEditorStore((state) => state.setBlobReferences);
  const setBlobDraftUrl = useEditorStore((state) => state.setBlobDraftUrl);
  const setBlobDraftStatus = useEditorStore(
    (state) => state.setBlobDraftStatus
  );
  const setBlobDraftError = useEditorStore((state) => state.setBlobDraftError);
  const blobPreviewCollection = useEditorStore(
    (state) => state.blobPreviewCollection
  );
  const setBlobPreviewCollection = useEditorStore(
    (state) => state.setBlobPreviewCollection
  );
  const setPreviewingBlobReferenceId = useEditorStore(
    (state) => state.setPreviewingBlobReferenceId
  );

  const resetBlobReferenceState = useCallback(() => {
    setBlobReferences([]);
    setBlobPreviewCollection(null);
    setPreviewingBlobReferenceId(null);
    setBlobDraftUrl("");
    setBlobDraftStatus("idle");
    setBlobDraftError(null);
  }, [
    setBlobReferences,
    setBlobPreviewCollection,
    setPreviewingBlobReferenceId,
    setBlobDraftUrl,
    setBlobDraftStatus,
    setBlobDraftError,
  ]);

  const convertGeoBlobReferencesToEditor = useCallback(
    (references: GeoBlobReference[] = []): EditorBlobReference[] =>
      references.map((reference) => ({
        ...reference,
        id: crypto.randomUUID(),
        status: "idle",
      })),
    []
  );

  const serializeBlobReferences = useCallback(
    (): GeoBlobReference[] =>
      blobReferences
        .filter((reference) => reference.url)
        .map(
          ({
            scope,
            featureId,
            url,
            sha256,
            size,
            mimeType,
          }: EditorBlobReference) => ({
            scope,
            featureId,
            url,
            sha256,
            size,
            mimeType,
          })
        ),
    [blobReferences]
  );
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    geoEventsRef.current = geoEvents;
  }, [geoEvents]);
  const isMobile = useIsMobile();

  useEffect(() => {
    const shouldLock = isDrawingMode;
    setPanLocked(shouldLock);
    if (editor) {
      editor.setPanLocked(shouldLock);
    }
  }, [isDrawingMode, editor, setPanLocked]);

  useEffect(() => {}, [inspectorActive]);

  useEffect(() => {}, [reverseLookupResult]);

  const getDatasetName = useCallback(
    (event: NDKGeoEvent) =>
      ((event.featureCollection as any)?.name as string | undefined) ??
      event.datasetId ??
      event.id,
    []
  );
  const getDatasetKey = useCallback(
    (event: NDKGeoEvent) => `${event.pubkey}:${event.datasetId ?? event.id}`,
    []
  );

  const resolvedCollectionResolver = useCallback(
    (event: NDKGeoEvent) => {
      const datasetKey = getDatasetKey(event);
      return resolvedCollectionsRef.current.get(datasetKey)?.featureCollection;
    },
    [getDatasetKey]
  );

  const ensureResolvedFeatureCollection = useCallback(
    async (event: NDKGeoEvent) => {
      if (event.blobReferences.length === 0) {
        return event.featureCollection;
      }
      const datasetKey = getDatasetKey(event);
      const cached = resolvedCollectionsRef.current.get(datasetKey);
      if (cached && cached.eventId === event.id) {
        return cached.featureCollection;
      }
      const resolved = await resolveGeoEventFeatureCollection(event);
      resolvedCollectionsRef.current.set(datasetKey, {
        eventId: event.id,
        featureCollection: resolved,
      });
      if (isMountedRef.current) {
        setResolvedCollectionsVersion((version) => version + 1);
      }
      return resolved;
    },
    [getDatasetKey]
  );

  const handleDatasetSelect = (event: NDKGeoEvent) => {
    if (activeDataset?.id === event.id) return;
    if (editor) {
      // If we have an editor, we might want to do something specific
      // But mostly we just zoom
    }
    loadDatasetForEditing(event);
  };
  const zoomToDataset = useCallback(
    (event: NDKGeoEvent) => {
      if (!map.current) return;
      const resolvedCollection = resolvedCollectionResolver(event);
      const bbox =
        event.boundingBox ||
        ((resolvedCollection as any)?.bbox ??
          (event.featureCollection as any)?.bbox);
      if (bbox && Array.isArray(bbox) && bbox.length === 4) {
        map.current.fitBounds(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]],
          ],
          { padding: 40, duration: 500 }
        );
        return;
      }

      const collection = convertGeoEventsToFeatureCollection(
        [event],
        resolvedCollectionResolver
      );
      const coords = turf.coordAll(collection);
      if (coords.length === 0) return;
      const bounds = coords.reduce(
        (acc, coord) => acc.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(
          coords[0] as [number, number],
          coords[0] as [number, number]
        )
      );
      map.current.fitBounds(bounds, { padding: 40, duration: 500 });
    },
    [resolvedCollectionResolver]
  );

  const zoomToCollection = useCallback(
    (collection: NDKGeoCollectionEvent, eventsInCollection: NDKGeoEvent[]) => {
      if (!map.current) return;
      const bbox = collection.boundingBox;
      if (bbox && bbox.length === 4) {
        map.current.fitBounds(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]],
          ],
          { padding: 40, duration: 500 }
        );
        return;
      }

      const eventsToUse =
        eventsInCollection.length > 0
          ? eventsInCollection
          : geoEvents.filter((event) => {
              const datasetId = event.datasetId ?? event.dTag ?? event.id;
              if (!datasetId) return false;
              const coordinate = `${event.kind ?? NDKGeoEvent.kinds[0]}:${
                event.pubkey
              }:${datasetId}`;
              return collection.datasetReferences.includes(coordinate);
            });

      if (eventsToUse.length === 0) return;

      const collectionFc = convertGeoEventsToFeatureCollection(
        eventsToUse,
        resolvedCollectionResolver
      );
      const coords = turf.coordAll(collectionFc);
      if (coords.length === 0) return;
      const bounds = coords.reduce(
        (acc, coord) => acc.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(
          coords[0] as [number, number],
          coords[0] as [number, number]
        )
      );
      map.current.fitBounds(bounds, { padding: 40, duration: 500 });
    },
    [geoEvents, resolvedCollectionResolver]
  );

  const zoomToSearchResult = useCallback((result: GeoSearchResult) => {
    if (!map.current) return;
    if (result.boundingbox) {
      const [west, south, east, north] = result.boundingbox;
      map.current.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 40, duration: 500 }
      );
      return;
    }
    map.current.flyTo({
      center: [result.coordinates.lon, result.coordinates.lat],
      zoom: 14,
      duration: 500,
    });
  }, []);

  const handleSearchResultSelect = useCallback(
    (result: GeoSearchResult) => {
      if (editor) {
        // If we have an editor, we might want to do something specific
        // But mostly we just zoom
      }
      zoomToSearchResult(result);
    },
    [editor, zoomToSearchResult]
  );

  const disableInspector = useCallback(() => {
    setInspectorActive(false);
    if (editor) {
      editor.setMode((previousMode as EditorMode) || "select");
      setCurrentMode((previousMode as EditorMode) || "select");
    }
    setSidebarMode("info");
  }, [previousMode, editor, setCurrentMode, setInspectorActive]);

  const ensureInfoPanelVisible = () => {
    if (isMobile) {
      setMobileInfoOpen(true);
    } else {
      setShowInfoPanel(true);
    }
  };

  const exitViewMode = useCallback(() => {
    setInfoMode("edit");
    setViewingDataset(null);
    setViewingCollection(null);
    setViewingCollectionEvents([]);
    setSidebarMode("editor");
  }, [
    setInfoMode,
    setViewingDataset,
    setViewingCollection,
    setViewingCollectionEvents,
    setSidebarMode,
  ]);

  const resolveEventsForCollection = useCallback(
    (collection: NDKGeoCollectionEvent): NDKGeoEvent[] => {
      const references = new Set(collection.datasetReferences);
      if (references.size === 0) return [];
      return geoEvents.filter((event) => {
        const datasetId = event.datasetId ?? event.dTag ?? event.id;
        if (!datasetId) return false;
        const coordinate = `${event.kind ?? NDKGeoEvent.kinds[0]}:${
          event.pubkey
        }:${datasetId}`;
        return references.has(coordinate);
      });
    },
    [geoEvents]
  );

  const handleInspectDataset = useCallback(
    (event: NDKGeoEvent) => {
      setViewingDataset(event);
      setViewingCollection(null);
      setViewingCollectionEvents([]);
      setInfoMode("view");
      setSidebarMode("dataset");
      ensureInfoPanelVisible();
    },
    [
      setViewingDataset,
      setViewingCollection,
      setViewingCollectionEvents,
      setInfoMode,
      setSidebarMode,
    ]
  );

  const handleInspectCollection = useCallback(
    (collection: NDKGeoCollectionEvent, eventsInCollection: NDKGeoEvent[]) => {
      const referencedEvents =
        eventsInCollection.length > 0
          ? eventsInCollection
          : resolveEventsForCollection(collection);
      setViewingCollection(collection);
      setViewingCollectionEvents(referencedEvents);
      setViewingDataset(null);
      setInfoMode("view");
      setSidebarMode("dataset");
      ensureInfoPanelVisible();
    },
    [
      resolveEventsForCollection,
      setViewingCollection,
      setViewingCollectionEvents,
      setViewingDataset,
      setInfoMode,
      setSidebarMode,
    ]
  );

  const handleOpenDebug = useCallback(
    (event: NDKGeoEvent | NDKGeoCollectionEvent) => {
      setDebugEvent(event);
      setDebugDialogOpen(true);
    },
    [setDebugEvent, setDebugDialogOpen]
  );

  const toggleDatasetVisibility = useCallback(
    (event: NDKGeoEvent) => {
      const key = getDatasetKey(event);
      setDatasetVisibility((prev) => ({
        ...prev,
        [key]: !(prev[key] !== false),
      }));
    },
    [getDatasetKey, setDatasetVisibility]
  );

  const selectedFeature = useMemo(
    () => features.find((feature) => feature.id === selectedFeatureId) ?? null,
    [features, selectedFeatureId]
  );

  const serializeEditorFeature = (feature: EditorFeature) => {
    const sanitized = sanitizeEditorProperties(
      feature.properties as Record<string, any> | undefined
    );
    return {
      type: "Feature",
      id: feature.id,
      geometry: JSON.parse(JSON.stringify(feature.geometry)),
      ...(sanitized ? { properties: sanitized } : {}),
    };
  };

  const handleClear = useCallback(() => {
    if (!editor) return;
    const all = editor.getAllFeatures();
    editor.deleteFeatures(all.map((f) => f.id));
    setSelectedFeatureIds([]);
  }, [editor, setSelectedFeatureIds]);
  const buildCollectionFromEditor =
    useCallback((): FeatureCollection | null => {
      if (!editor) return null;
      const currentFeatures = editor.getAllFeatures();
      if (currentFeatures.length === 0) return null;

      const collectionName =
        collectionMeta.name ||
        (activeDataset
          ? getDatasetName(activeDataset)
          : `Geo dataset ${new Date().toLocaleString()}`);

      const collection: FeatureCollection & {
        name?: string;
        description?: string;
        color?: string;
        properties?: Record<string, any>;
      } = {
        type: "FeatureCollection",
        features: currentFeatures.map(serializeEditorFeature) as any,
      };

      const existingIds = new Set(
        collection.features
          .map((feature) =>
            typeof feature.id === "string"
              ? feature.id
              : typeof feature.id === "number"
              ? String(feature.id)
              : undefined
          )
          .filter((id): id is string => Boolean(id))
      );
      blobReferences.forEach((reference) => {
        if (reference.scope !== "feature" || !reference.featureId) return;
        if (existingIds.has(reference.featureId)) return;
        existingIds.add(reference.featureId);
        collection.features.push({
          type: "Feature",
          id: reference.featureId,
          geometry: null,
          properties: {
            externalPlaceholder: true,
            blobUrl: reference.url,
          },
        } as any);
      });

      (collection as any).name = collectionName;
      if (collectionMeta.description) {
        (collection as any).description = collectionMeta.description;
      }
      if (collectionMeta.color) {
        (collection as any).color = collectionMeta.color;
      }
      const extraProps: Record<string, any> = {
        ...collectionMeta.customProperties,
      };
      if (collectionMeta.color) {
        extraProps.color = collectionMeta.color;
      }
      if (collectionMeta.description) {
        extraProps.description = collectionMeta.description;
      }
      if (collectionMeta.name) {
        extraProps.name = collectionMeta.name;
      }
      if (Object.keys(extraProps).length > 0) {
        (collection as any).properties = {
          ...(collection as any).properties,
          ...extraProps,
        };
      }
      return collection;
    }, [editor, collectionMeta, activeDataset, getDatasetName, blobReferences]);

  const persistFeatureUpdate = useCallback(
    (updated: EditorFeature) => {
      if (editor) {
        editor.updateFeature(updated.id, updated);
      }
      // Store updates automatically via event listener in Editor component
      // But let's keep it for responsiveness if needed, but correctly.
      // setFeatures(prev => ...) is wrong because setFeatures expects array.
      // We can just let the store handle it via the event listener.
    },
    [editor]
  );

  const handlePublishNew = useCallback(async () => {
    if (!editor) return;
    setIsPublishing(true);
    setPublishMessage("Preparing dataset...");
    setPublishError(null);

    try {
      const collection = buildCollectionFromEditor();
      if (!collection) throw new Error("No features to publish");

      if (!ndk) {
        setPublishError("NDK is not ready.");
        return;
      }

      const event = new NDKGeoEvent(ndk);
      event.featureCollection = collection;
      event.blobReferences = serializeBlobReferences();
      await event.publishNew();
      setPublishMessage("Dataset published successfully.");
      setActiveDataset(event);
      setCollectionMeta(extractCollectionMeta(collection));
      setSelectedFeatureIds([]);
    } catch (error) {
      console.error("Failed to publish dataset", error);
      setPublishError("Failed to publish dataset. Check console for details.");
    } finally {
      setIsPublishing(false);
    }
  }, [
    editor,
    setIsPublishing,
    setPublishMessage,
    setPublishError,
    buildCollectionFromEditor,
    ndk,
    serializeBlobReferences,
    setActiveDataset,
    setCollectionMeta,
    setSelectedFeatureIds,
  ]);

  const handlePublishUpdate = useCallback(async () => {
    if (!editor || !activeDataset) return;
    setIsPublishing(true);
    setPublishMessage("Updating dataset...");
    setPublishError(null);

    if (currentUser?.pubkey !== activeDataset.pubkey) {
      setPublishError("You can only update datasets you own.");
      return;
    }

    const collection = buildCollectionFromEditor();
    if (!collection) {
      setPublishError("Draw or load geometry before publishing.");
      return;
    }

    try {
      setIsPublishing(true);
      setPublishError(null);
      setPublishMessage(null);

      const event = new NDKGeoEvent(ndk || undefined);
      event.featureCollection = collection;
      event.datasetId = activeDataset.datasetId ?? activeDataset.id;
      event.hashtags = activeDataset.hashtags;
      event.collectionReferences = activeDataset.collectionReferences;
      event.relayHints = activeDataset.relayHints;
      event.blobReferences = serializeBlobReferences();

      await event.publishUpdate(activeDataset);
      setPublishMessage("Dataset update published successfully.");
      setActiveDataset(event);
      setCollectionMeta(extractCollectionMeta(collection));
      setSelectedFeatureIds([]);
    } catch (error) {
      console.error("Failed to publish dataset update", error);
      setPublishError(
        "Failed to publish dataset update. Check console for details."
      );
    } finally {
      setIsPublishing(false);
    }
  }, [
    editor,
    activeDataset,
    setIsPublishing,
    setPublishMessage,
    setPublishError,
    currentUser?.pubkey,
    buildCollectionFromEditor,
    ndk,
    serializeBlobReferences,
    setActiveDataset,
    setCollectionMeta,
    setSelectedFeatureIds,
  ]);

  const clearEditingSession = useCallback(() => {
    if (!editor) return;
    editor.setFeatures([]);
    setFeatures([]);
    setActiveDataset(null);
    setPublishMessage(null);
    setPublishError(null);
    setSelectedFeatureIds([]);
    setCollectionMeta(createDefaultCollectionMeta());
    setNewCollectionProp({ key: "", value: "" });
    setNewFeatureProp({ key: "", value: "" });
    resetBlobReferenceState();
    exitViewMode();
  }, [
    editor,
    setFeatures,
    setActiveDataset,
    setPublishMessage,
    setPublishError,
    setSelectedFeatureIds,
    setCollectionMeta,
    setNewCollectionProp,
    setNewFeatureProp,
    resetBlobReferenceState,
    exitViewMode,
  ]);

  const handleDeleteDataset = useCallback(
    async (event: NDKGeoEvent) => {
      if (!ndk) {
        alert("NDK is not ready.");
        return;
      }
      if (!event.datasetId) {
        alert("Dataset is missing a d tag and cannot be deleted.");
        return;
      }
      if (
        !confirm(
          `Delete dataset "${getDatasetName(
            event
          )}"? This action cannot be undone.`
        )
      ) {
        return;
      }

      const key = getDatasetKey(event);
      try {
        setDeletingKey(key);
        await NDKGeoEvent.deleteDataset(ndk, event);
        if (activeDataset && getDatasetKey(activeDataset) === key) {
          clearEditingSession();
        }
      } catch (error) {
        console.error("Failed to delete dataset", error);
        alert("Failed to delete dataset. Check console for details.");
      } finally {
        setDeletingKey(null);
      }
    },
    [
      ndk,
      activeDataset,
      getDatasetKey,
      getDatasetName,
      setDeletingKey,
      clearEditingSession,
    ]
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (!editor) return;
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;

      try {
        const json = JSON.parse(text);
        const collection = ensureFeatureCollection(json);
        const newFeatures = collection.features.map((f: any) => ({
          ...f,
          id: f.id || crypto.randomUUID(),
          properties: {
            ...f.properties,
            meta: "feature",
            featureId: f.id || crypto.randomUUID(),
          },
        }));
        newFeatures.forEach((f) => editor.addFeature(f as EditorFeature));
      } catch (error) {
        console.error("Failed to paste GeoJSON:", error);
      }
    },
    [editor]
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  }, [handlePaste]);

  const loadDatasetForEditing = useCallback(
    async (event: NDKGeoEvent) => {
      if (!editor) return;
      try {
        await ensureResolvedFeatureCollection(event);
      } catch (error) {
        console.error("Failed to resolve external blobs for dataset", error);
        setPublishError(
          "Failed to load dataset blobs. Check console for details."
        );
        return;
      }
      const datasetFeatures = convertGeoEventsToEditorFeatures(
        [event],
        resolvedCollectionResolver
      );
      editor.setFeatures(datasetFeatures);
      setFeatures(datasetFeatures);
      setActiveDataset(event);
      setPublishMessage(null);
      setPublishError(null);
      setSelectedFeatureIds([]);
      const collection =
        resolvedCollectionResolver(event) ?? event.featureCollection;
      setCollectionMeta(extractCollectionMeta(collection));
      setNewCollectionProp({ key: "", value: "" });
      setNewFeatureProp({ key: "", value: "" });
      setBlobReferences(convertGeoBlobReferencesToEditor(event.blobReferences));
      setBlobPreviewCollection(null);
      setPreviewingBlobReferenceId(null);
      setBlobDraftUrl("");
      setBlobDraftStatus("idle");
      setBlobDraftError(null);
      exitViewMode();
    },
    [
      editor,
      ensureResolvedFeatureCollection,
      setPublishError,
      resolvedCollectionResolver,
      setFeatures,
      setActiveDataset,
      setPublishMessage,
      setSelectedFeatureIds,
      setCollectionMeta,
      setNewCollectionProp,
      setNewFeatureProp,
      setBlobReferences,
      convertGeoBlobReferencesToEditor,
      setBlobPreviewCollection,
      setPreviewingBlobReferenceId,
      setBlobDraftUrl,
      setBlobDraftStatus,
      setBlobDraftError,
      exitViewMode,
    ]
  );

  const handlePublishCopy = useCallback(async () => {
    if (!editor) return;
    setIsPublishing(true);
    setPublishMessage("Creating copy...");
    setPublishError(null);

    try {
      const collection = buildCollectionFromEditor();
      if (!collection) throw new Error("No features to publish");

      if (!ndk) {
        setPublishError("NDK is not ready.");
        return;
      }

      const event = new NDKGeoEvent(ndk);
      event.featureCollection = collection;
      event.blobReferences = serializeBlobReferences();
      await event.publishNew();
      setPublishMessage("Dataset copy published successfully.");
      setActiveDataset(event);
      setCollectionMeta(extractCollectionMeta(collection));
      setSelectedFeatureIds([]);
    } catch (error) {
      console.error("Failed to publish dataset copy", error);
      setPublishError(
        "Failed to publish dataset copy. Check console for details."
      );
    } finally {
      setIsPublishing(false);
    }
  }, [
    editor,
    setIsPublishing,
    setPublishMessage,
    setPublishError,
    buildCollectionFromEditor,
    ndk,
    serializeBlobReferences,
    setActiveDataset,
    setCollectionMeta,
    setSelectedFeatureIds,
  ]);

  // Initialize extra layers when map is ready
  useEffect(() => {
    if (!map.current || !mounted) return;
    const mapInstance = map.current;

    const initLayers = () => {
      if (mapInstance.getSource(REMOTE_SOURCE_ID)) return;

      // Remote dataset preview source/layers
      mapInstance.addSource(REMOTE_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      mapInstance.addLayer({
        id: REMOTE_FILL_LAYER,
        type: "fill",
        source: REMOTE_SOURCE_ID,
        filter: [
          "any",
          ["==", ["geometry-type"], "Polygon"],
          ["==", ["geometry-type"], "MultiPolygon"],
        ],
        paint: {
          "fill-color": "#1d4ed8",
          "fill-opacity": 0.15,
        },
      });
      mapInstance.addLayer({
        id: REMOTE_LINE_LAYER,
        type: "line",
        source: REMOTE_SOURCE_ID,
        paint: {
          "line-color": "#1d4ed8",
          "line-width": 2,
          "line-dasharray": [2, 2],
        },
      });

      mapInstance.addSource(BLOB_PREVIEW_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      mapInstance.addLayer({
        id: BLOB_PREVIEW_FILL_LAYER,
        type: "fill",
        source: BLOB_PREVIEW_SOURCE_ID,
        filter: [
          "any",
          ["==", ["geometry-type"], "Polygon"],
          ["==", ["geometry-type"], "MultiPolygon"],
        ],
        paint: {
          "fill-color": "#f97316",
          "fill-opacity": 0.2,
        },
      });
      mapInstance.addLayer({
        id: BLOB_PREVIEW_LINE_LAYER,
        type: "line",
        source: BLOB_PREVIEW_SOURCE_ID,
        paint: {
          "line-color": "#f97316",
          "line-width": 2,
        },
      });
      setRemoteLayersReady(true);
    };

    if (mapInstance.isStyleLoaded()) {
      initLayers();
    }

    // Re-initialize layers when style changes
    mapInstance.on("styledata", initLayers);

    return () => {
      mapInstance.off("styledata", initLayers);
    };
  }, [mounted, setRemoteLayersReady]);

  // The following block was part of updateFeatureStats, but its context is now unclear
  // if (
  //   selectedFeatureId &&
  //   !allFeatures.some((feature) => feature.id === selectedFeatureId)
  // ) {
  //   setSelectedFeatureId(null);
  // }

  const exportGeoJSON = useCallback(() => {
    if (!editor) return;

    const geojson = {
      type: "FeatureCollection",
      features: editor.getAllFeatures(),
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "features.geojson";
    a.click();
    URL.revokeObjectURL(url);
  }, [editor]);

  const handleImport = useCallback(
    async (file: File) => {
      if (!editor) return;
      const text = await file.text();
      try {
        const json = JSON.parse(text);
        const collection = ensureFeatureCollection(json);
        const newFeatures = collection.features.map((f: any) => ({
          ...f,
          id: f.id || crypto.randomUUID(),
          properties: {
            ...f.properties,
            meta: "feature",
            featureId: f.id || crypto.randomUUID(),
          },
        }));

        newFeatures.forEach((f) => editor.addFeature(f as EditorFeature));

        // Stats updated automatically via store

        const meta = extractCollectionMeta(collection);
        if (meta) {
          setCollectionMeta(meta);
        }
      } catch (e) {
        console.error("Failed to import GeoJSON:", e);
        alert("Failed to import GeoJSON");
      }
    },
    [editor, setCollectionMeta]
  );

  const togglePanLock = useCallback(() => {
    if (!editor) return;
    if (isDrawingMode) return;
    const next = !panLocked;
    editor.setPanLocked(next);
    setPanLocked(next);
  }, [editor, isDrawingMode, panLocked, setPanLocked]);

  const toggleMagnifier = useCallback(() => {
    const next = !magnifierEnabled;
    setMagnifierEnabled(next);
    if (!next) {
      setMagnifierVisible(false);
    }
  }, [magnifierEnabled, setMagnifierEnabled, setMagnifierVisible]);

  useEffect(() => {
    setDatasetVisibility((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      geoEvents.forEach((event) => {
        const key = getDatasetKey(event);
        const value = prev[key] === undefined ? true : prev[key];
        next[key] = value;
        if (prev[key] !== value) {
          changed = true;
        }
      });

      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [geoEvents, getDatasetKey, setDatasetVisibility]);

  const visibleGeoEvents = useMemo(
    () =>
      geoEvents.filter(
        (event) => datasetVisibility[getDatasetKey(event)] !== false
      ),
    [geoEvents, datasetVisibility, getDatasetKey]
  );

  useEffect(() => {
    if (!editor) return;
    if (!map.current) return;
    const source = map.current.getSource(REMOTE_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    if (!source) return;

    const collection = convertGeoEventsToFeatureCollection(
      visibleGeoEvents,
      resolvedCollectionResolver
    );
    source.setData(collection);
  }, [
    visibleGeoEvents,
    resolvedCollectionsVersion,
    resolvedCollectionResolver,
    editor,
    remoteLayersReady,
  ]);

  useEffect(() => {
    if (!map.current) return;
    const mapInstance = map.current;

    const updateMagnifier = (event: maplibregl.MapTouchEvent) => {
      if (!magnifierEnabled) return;
      const point = event.point;
      const container = mapInstance.getContainer();
      const width = container.clientWidth;
      const height = container.clientHeight;
      const posX = Math.min(
        Math.max(point.x + MAGNIFIER_OFFSET.x, MAGNIFIER_SIZE / 2),
        width - MAGNIFIER_SIZE / 2
      );
      const posY = Math.min(
        Math.max(point.y + MAGNIFIER_OFFSET.y, MAGNIFIER_SIZE / 2),
        height - MAGNIFIER_SIZE / 2
      );
      const targetX = Math.min(Math.max(point.x + POINTER_OFFSET.x, 0), width);
      const targetY = Math.min(Math.max(point.y + POINTER_OFFSET.y, 0), height);
      const lngLat = mapInstance.unproject([targetX, targetY]);

      setMagnifierPosition({ x: posX, y: posY });
      setMagnifierCenter([lngLat.lng, lngLat.lat]);
      setMagnifierVisible(true);
    };

    const handleTouchStart = (e: maplibregl.MapTouchEvent) =>
      updateMagnifier(e);
    const handleTouchMove = (e: maplibregl.MapTouchEvent) => updateMagnifier(e);
    const handleTouchEnd = () => {
      setMagnifierVisible(false);
    };

    mapInstance.on("touchstart", handleTouchStart);
    mapInstance.on("touchmove", handleTouchMove);
    mapInstance.on("touchend", handleTouchEnd);

    return () => {
      mapInstance.off("touchstart", handleTouchStart);
      mapInstance.off("touchmove", handleTouchMove);
      mapInstance.off("touchend", handleTouchEnd);
    };
  }, [
    magnifierEnabled,
    setMagnifierPosition,
    setMagnifierCenter,
    setMagnifierVisible,
  ]);

  useEffect(() => {
    if (!map.current) return;
    const source = map.current.getSource(BLOB_PREVIEW_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    if (!source) return;
    if (blobPreviewCollection) {
      source.setData(blobPreviewCollection);
    } else {
      source.setData({ type: "FeatureCollection", features: [] });
    }
  }, [blobPreviewCollection]);

  const multiSelectModifierLabel =
    editor?.getMultiSelectModifierLabel() ?? "Shift";

  useEffect(() => {
    if (isMobile) {
      setMobileDatasetsOpen(false);
      setMobileInfoOpen(false);
      setShowToolbar(false);
      setShowTips(false);
    } else {
      setShowDatasetsPanel(true);
      setShowInfoPanel(true);
      setShowToolbar(true);
      setShowTips(true);
    }
  }, [
    isMobile,
    setMobileDatasetsOpen,
    setMobileInfoOpen,
    setShowToolbar,
    setShowTips,
    setShowDatasetsPanel,
    setShowInfoPanel,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const event of geoEvents) {
        if (cancelled) break;
        if (event.blobReferences.length === 0) continue;
        try {
          await ensureResolvedFeatureCollection(event);
        } catch (error) {
          console.warn(
            "Failed to resolve external blob for dataset",
            event.id,
            error
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [geoEvents, ensureResolvedFeatureCollection]);

  useEffect(() => {
    if (!map.current) return;
    const mapInstance = map.current;

    const handleMapDatasetClick = (
      event: maplibregl.MapLayerMouseEvent & any
    ) => {
      const feature = event.features?.[0];
      if (!feature?.properties) return;
      const sourceEventId = feature.properties.sourceEventId as
        | string
        | undefined;
      const datasetId = feature.properties.datasetId as string | undefined;

      const dataset =
        geoEventsRef.current.find((ev) => ev.id === sourceEventId) ??
        geoEventsRef.current.find(
          (ev) => (ev.datasetId ?? ev.id) === datasetId
        );

      if (!dataset) return;

      ensureResolvedFeatureCollection(dataset).catch(() => undefined);
      handleInspectDataset(dataset);
    };

    mapInstance.on("click", REMOTE_FILL_LAYER, handleMapDatasetClick);
    mapInstance.on("click", REMOTE_LINE_LAYER, handleMapDatasetClick);

    return () => {
      mapInstance.off("click", REMOTE_FILL_LAYER, handleMapDatasetClick);
      mapInstance.off("click", REMOTE_LINE_LAYER, handleMapDatasetClick);
    };
  }, [handleInspectDataset, ensureResolvedFeatureCollection]);

  useEffect(() => {
    if (!map.current) return;
    const mapInstance = map.current;

    const handleInspectorClick = async (
      event: maplibregl.MapMouseEvent & any
    ) => {
      const { lng, lat } = event.lngLat;
      console.log("[Inspector] Map click", { lng, lat });
      setReverseLookupStatus("loading");
      setReverseLookupError(null);
      setReverseLookupResult(null);

      try {
        // Give the client a moment to connect if it hasn't already
        await new Promise((resolve) => setTimeout(resolve, 100));
        const response = await earthlyGeoServer.ReverseLookup(lat, lng);
        console.log("[Inspector] Reverse lookup response", response);
        setReverseLookupResult(response.result);
      } catch (error) {
        console.error("[Inspector] Reverse lookup error", error);
        const errorMessage =
          error instanceof Error && error.message === "Not connected"
            ? "Cannot connect to geo server. Make sure the relay is running (bun relay)."
            : error instanceof Error
            ? error.message
            : "Reverse lookup failed";
        setReverseLookupError(errorMessage);
        setReverseLookupResult(null);
      } finally {
        setReverseLookupStatus("idle");
      }
    };

    if (inspectorActive) {
      mapInstance.getCanvas().style.cursor = "crosshair";
      mapInstance.on("click", handleInspectorClick);
    }

    return () => {
      mapInstance.getCanvas().style.cursor = "";
      mapInstance.off("click", handleInspectorClick);
    };
  }, [
    inspectorActive,
    setReverseLookupStatus,
    setReverseLookupError,
    setReverseLookupResult,
  ]);

  return (
    <div className="relative h-screen w-full">
      {/* Map Container */}
      {/* Map Container */}
      <MapComponent
        onLoad={(m) => {
          map.current = m;
          setMounted(true);
        }}
        mapSource={mapSource}
      >
        <Editor />
      </MapComponent>

      <Magnifier
        enabled={magnifierEnabled}
        visible={magnifierVisible}
        position={magnifierPosition}
        center={magnifierCenter}
        mainMap={map.current}
        size={MAGNIFIER_SIZE}
      />

      {/* Error Message */}
      {mapError && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50">
          <p className="font-bold">Map Error</p>
          <p>{mapError}</p>
        </div>
      )}

      {!isMobile && (
        <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
          <div className="mx-auto w-full max-w-6xl px-6 pb-2 text-xs text-gray-500 text-center pointer-events-auto">
            Hold <strong>{multiSelectModifierLabel}</strong> to multi-select
            {selectionCount > 0 ? ` • ${selectionCount} selected` : ""}
          </div>
        </div>
      )}

      {/* Toolbar */}
      {mounted && editor && (
        <div className="absolute top-4 left-4 right-4 z-10 pointer-events-none flex">
          <div className="w-full">
            <Toolbar
              datasetActions={{
                onExport: exportGeoJSON,
                canExport: stats.total > 0,
                onImport: handleImport,
                onClear: handleClear,
                onPublishNew: handlePublishNew,
                canPublishNew: features.length > 0 && !activeDataset,
                onPublishUpdate: handlePublishUpdate,
                canPublishUpdate:
                  !!activeDataset &&
                  currentUser?.pubkey === activeDataset?.pubkey &&
                  features.length > 0,
                onPublishCopy: handlePublishCopy,
                canPublishCopy:
                  !!activeDataset &&
                  currentUser?.pubkey !== activeDataset?.pubkey &&
                  features.length > 0,
                isPublishing,
              }}
              isMobile={isMobile}
              showLogin={!isMobile}
              onSearchResultSelect={(result) =>
                handleSearchResultSelect(result as any)
              }
              onInspectorDeactivate={disableInspector}
            />
          </div>
        </div>
      )}

      {!isMobile && mounted && showDatasetsPanel && (
        <div className="pointer-events-auto absolute left-4 top-[88px] bottom-4 z-40 hidden md:flex w-[25vw]">
          <div className="flex-1 overflow-hidden rounded-2xl bg-white/95 shadow-xl backdrop-blur">
            <div className="h-full overflow-y-auto p-4">
              <GeoDatasetsPanelContent
                geoEvents={geoEvents}
                collectionEvents={collectionEvents}
                activeDataset={activeDataset}
                currentUserPubkey={currentUser?.pubkey}
                datasetVisibility={datasetVisibility}
                isPublishing={isPublishing}
                deletingKey={deletingKey}
                onClearEditing={clearEditingSession}
                onLoadDataset={handleDatasetSelect}
                onToggleVisibility={toggleDatasetVisibility}
                onZoomToDataset={zoomToDataset}
                onDeleteDataset={handleDeleteDataset}
                getDatasetKey={getDatasetKey}
                getDatasetName={getDatasetName}
                onZoomToCollection={zoomToCollection}
                onInspectDataset={handleInspectDataset}
                onInspectCollection={handleInspectCollection}
                onOpenDebug={handleOpenDebug}
                onClose={() => setShowDatasetsPanel(false)}
              />
            </div>
          </div>
        </div>
      )}

      {!isMobile && mounted && showInfoPanel && (
        <div className="pointer-events-auto absolute right-4 top-[88px] bottom-4 z-40 hidden md:flex w-96">
          <div className="flex-1 overflow-hidden rounded-2xl bg-white shadow-xl">
            {editor && (
              <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1 text-xs text-white backdrop-blur">
                {editor.getMode() === "select" && "Select features to edit"}
                {editor.getMode() === "draw_point" && "Click to place point"}
                {editor.getMode() === "draw_linestring" &&
                  "Click to add points, double-click to finish"}
                {editor.getMode() === "draw_polygon" &&
                  "Click to add points, double-click to finish"}
                {editor.getMode() === "edit" && "Drag vertices to edit"}
              </div>
            )}
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2 text-sm font-medium">
              {[
                { id: "editor", label: "Editor" },
                { id: "inspector", label: "Inspector" },
                { id: "dataset", label: "Dataset" },
              ].map((mode) => (
                <Button
                  key={mode.id}
                  size="sm"
                  variant={sidebarMode === mode.id ? "default" : "ghost"}
                  className="h-8 px-3"
                  onClick={() => setSidebarMode(mode.id as any)}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
            <div className="h-full overflow-y-auto p-4">
              {sidebarMode === "inspector" ? (
                <LocationInspectorPanel
                  inspectorActive={inspectorActive}
                  loading={reverseLookupStatus === "loading"}
                  error={reverseLookupError}
                  result={reverseLookupResult}
                  onPause={() => setInspectorActive(false)}
                  onClear={() => {
                    setReverseLookupResult(null);
                  }}
                />
              ) : sidebarMode === "dataset" ? (
                viewingDataset || viewingCollection ? (
                  <GeoEditorInfoPanelContent
                    currentUserPubkey={currentUser?.pubkey}
                    onLoadDataset={loadDatasetForEditing}
                    onToggleVisibility={toggleDatasetVisibility}
                    onZoomToDataset={zoomToDataset}
                    onDeleteDataset={handleDeleteDataset}
                    onZoomToCollection={zoomToCollection}
                    deletingKey={deletingKey}
                    onExitViewMode={exitViewMode}
                    onClose={() => setShowInfoPanel(false)}
                    getDatasetKey={getDatasetKey}
                    getDatasetName={getDatasetName}
                  />
                ) : (
                  <div className="text-sm text-gray-600">
                    Select a dataset or collection to inspect.
                  </div>
                )
              ) : (
                <GeoEditorInfoPanelContent
                  currentUserPubkey={currentUser?.pubkey}
                  onLoadDataset={loadDatasetForEditing}
                  onToggleVisibility={toggleDatasetVisibility}
                  onZoomToDataset={zoomToDataset}
                  onDeleteDataset={handleDeleteDataset}
                  onZoomToCollection={zoomToCollection}
                  deletingKey={deletingKey}
                  onExitViewMode={exitViewMode}
                  onClose={() => setShowInfoPanel(false)}
                  getDatasetKey={getDatasetKey}
                  getDatasetName={getDatasetName}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {isMobile && (
        <>
          <div className="fixed top-4 right-4 z-50">
            <LoginSessionButtons />
          </div>
          <Sheet
            open={mobileDatasetsOpen}
            onOpenChange={setMobileDatasetsOpen}
            modal={false}
          >
            <SheetContent
              side="bottom"
              className="p-0 h-[35vh] sm:hidden"
              hideOverlay
            >
              <div className="h-full w-full overflow-y-auto px-4 pb-6 pt-3">
                <GeoDatasetsPanelContent
                  geoEvents={geoEvents}
                  collectionEvents={collectionEvents}
                  activeDataset={activeDataset}
                  currentUserPubkey={currentUser?.pubkey}
                  datasetVisibility={datasetVisibility}
                  isPublishing={isPublishing}
                  deletingKey={deletingKey}
                  onClearEditing={clearEditingSession}
                  onLoadDataset={loadDatasetForEditing}
                  onToggleVisibility={toggleDatasetVisibility}
                  onZoomToDataset={zoomToDataset}
                  onDeleteDataset={handleDeleteDataset}
                  getDatasetKey={getDatasetKey}
                  getDatasetName={getDatasetName}
                  onZoomToCollection={zoomToCollection}
                  onInspectDataset={handleInspectDataset}
                  onInspectCollection={handleInspectCollection}
                  onOpenDebug={handleOpenDebug}
                  onClose={() => setMobileDatasetsOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet
            open={mobileInfoOpen}
            onOpenChange={setMobileInfoOpen}
            modal={false}
          >
            <SheetContent
              side="bottom"
              className="p-0 h-[35vh] sm:hidden"
              hideOverlay
            >
              <div className="h-full w-full overflow-y-auto px-4 pb-6 pt-3">
                <GeoEditorInfoPanelContent
                  currentUserPubkey={currentUser?.pubkey}
                  onLoadDataset={loadDatasetForEditing}
                  onToggleVisibility={toggleDatasetVisibility}
                  onZoomToDataset={zoomToDataset}
                  onDeleteDataset={handleDeleteDataset}
                  onZoomToCollection={zoomToCollection}
                  deletingKey={deletingKey}
                  onExitViewMode={exitViewMode}
                  onClose={() => setMobileInfoOpen(false)}
                  getDatasetKey={getDatasetKey}
                  getDatasetName={getDatasetName}
                />
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}

      {isMobile && (
        <>
          <div className="fixed bottom-4 left-4 z-50 md:hidden">
            <div className="flex gap-2">
              <Button
                variant={panLocked ? "default" : "outline"}
                className="shadow-lg"
                onClick={togglePanLock}
                aria-label="Toggle pan lock while drawing"
                disabled={isDrawingMode}
                title={
                  isDrawingMode
                    ? "Pan is auto-locked while drawing"
                    : "Toggle pan lock"
                }
              >
                {panLocked ? "Pan locked" : "Pan unlocked"}
              </Button>
              {(currentMode === "draw_linestring" ||
                currentMode === "draw_polygon") && (
                <Button
                  variant="default"
                  className="shadow-lg"
                  onClick={() => editor?.finishDrawing()}
                  aria-label="Finish current drawing"
                  disabled={!canFinishDrawing}
                >
                  Finish
                </Button>
              )}
              <Button
                variant={magnifierEnabled ? "default" : "outline"}
                className="shadow-lg"
                onClick={toggleMagnifier}
                aria-label="Toggle magnifier"
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3 md:hidden">
            <Button
              size="icon-lg"
              className="shadow-lg"
              variant={mobileDatasetsOpen ? "default" : "outline"}
              onClick={() =>
                setMobileActiveState(mobileDatasetsOpen ? null : "datasets")
              }
            >
              <Layers className="h-6 w-6" />
            </Button>
            <Button
              size="icon-lg"
              className="shadow-lg"
              variant={mobileInfoOpen ? "default" : "outline"}
              onClick={() =>
                setMobileActiveState(mobileInfoOpen ? null : "info")
              }
            >
              <FilePenLine className="h-6 w-6" />
            </Button>
            <Button
              size="icon-lg"
              className="shadow-lg"
              variant={mobileToolsOpen ? "default" : "outline"}
              onClick={() =>
                setMobileActiveState(mobileToolsOpen ? null : "tools")
              }
            >
              <Edit3 className="h-6 w-6" />
            </Button>
            <Button
              size="icon-lg"
              className="shadow-lg"
              variant={mobileSearchOpen ? "default" : "outline"}
              onClick={() =>
                setMobileActiveState(mobileSearchOpen ? null : "search")
              }
            >
              <Search className="h-6 w-6" />
            </Button>
            <Button
              size="icon-lg"
              className="shadow-lg"
              variant={mobileActionsOpen ? "default" : "outline"}
              onClick={() =>
                setMobileActiveState(mobileActionsOpen ? null : "actions")
              }
            >
              <UploadCloud className="h-6 w-6" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
