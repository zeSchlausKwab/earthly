import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import '../drawing/drawing_model.dart';
import '../nostr/basemap_config.dart';
import '../nostr/callout_overlay.dart';
import '../nostr/shelf_renderer.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../shell/basemap_switcher_sheet.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/settings.dart';
import '../src/rust/api/spike.dart';

/// Immutable bundle of derived map GPU layers and screen-space overlays
/// produced by [MapLayerCache.resolve].
@immutable
class MapLayerSnapshot {
  const MapLayerSnapshot({
    required this.gpuLayers,
    required this.visibleCallouts,
    required this.visibleIconPins,
    required this.visibleArrowheads,
    required this.externalSnapShapes,
    required this.combinedProposalShapes,
    this.clusteredShelfPoints = const <Feature<Point>>[],
    this.clusteredShelfPointMeta = const <InspectedFeature>[],
  });

  final List<Layer> gpuLayers;
  final List<MapCalloutItem> visibleCallouts;
  final List<MapIconPinItem> visibleIconPins;
  final List<MapArrowheadItem> visibleArrowheads;
  final List<List<Geographic>> externalSnapShapes;
  final List<ShelfShape> combinedProposalShapes;
  final List<Feature<Point>> clusteredShelfPoints;
  final List<InspectedFeature> clusteredShelfPointMeta;
}

/// Content/revision key used by [MapLayerCache] to memoize heavy GeoJSON and
/// MapLibre GPU layer builds across unrelated UI rebuilds.
@immutable
class MapLayerCacheKey {
  const MapLayerCacheKey({
    required this.shelfRevision,
    required this.draftRevision,
    required this.selectionRevision,
    required this.sightingsRevision,
    required this.beaconsRevision,
    required this.storyRevision,
    required this.commentOverlayRevision,
    required this.proposalOverlayRevision,
    required this.aiGhostRevision,
    required this.gpsTrackRevision,
    required this.accentColorValue,
    required this.isDarkMap,
    required this.showLabels,
    required this.effectiveBasemap,
    required this.pointClusteringEnabled,
    required this.pointClusterRadius,
    required this.pointClusterMaxZoom,
  });

  final int shelfRevision;
  final int draftRevision;
  final int selectionRevision;
  final int sightingsRevision;
  final int beaconsRevision;
  final int storyRevision;
  final int commentOverlayRevision;
  final int proposalOverlayRevision;
  final int aiGhostRevision;
  final int gpsTrackRevision;
  final int accentColorValue;
  final bool isDarkMap;
  final bool showLabels;
  final BasemapKind effectiveBasemap;
  final bool pointClusteringEnabled;
  final int pointClusterRadius;
  final int pointClusterMaxZoom;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MapLayerCacheKey &&
          other.shelfRevision == shelfRevision &&
          other.draftRevision == draftRevision &&
          other.selectionRevision == selectionRevision &&
          other.sightingsRevision == sightingsRevision &&
          other.beaconsRevision == beaconsRevision &&
          other.storyRevision == storyRevision &&
          other.commentOverlayRevision == commentOverlayRevision &&
          other.proposalOverlayRevision == proposalOverlayRevision &&
          other.aiGhostRevision == aiGhostRevision &&
          other.gpsTrackRevision == gpsTrackRevision &&
          other.accentColorValue == accentColorValue &&
          other.isDarkMap == isDarkMap &&
          other.showLabels == showLabels &&
          other.effectiveBasemap == effectiveBasemap &&
          other.pointClusteringEnabled == pointClusteringEnabled &&
          other.pointClusterRadius == pointClusterRadius &&
          other.pointClusterMaxZoom == pointClusterMaxZoom;

  @override
  int get hashCode => Object.hash(
        shelfRevision,
        draftRevision,
        selectionRevision,
        sightingsRevision,
        beaconsRevision,
        storyRevision,
        commentOverlayRevision,
        proposalOverlayRevision,
        aiGhostRevision,
        gpsTrackRevision,
        accentColorValue,
        isDarkMap,
        showLabels,
        effectiveBasemap,
        pointClusteringEnabled,
        pointClusterRadius,
        pointClusterMaxZoom,
      );
}

/// Manages basemap/presentation state, macOS security-scoped bookmarks, and
/// revision-memoized MapLibre GPU layers + overlays.
class MapLayerCache extends ChangeNotifier {
  final ChangeNotifier layerConfigListenable = ChangeNotifier();
  final ChangeNotifier presentationListenable = ChangeNotifier();

  BasemapKind selectedBasemap = BasemapKind.auto;
  MapBackgroundMode backgroundMode = MapBackgroundMode.osm;
  double satelliteOpacity = 0.75;
  OfflinePmtilesBasemap? offlineBasemap;
  final List<SavedOfflinePackDto> savedOfflinePacks = <SavedOfflinePackDto>[];
  final List<MountedAtlasWorkspaceDto> mountedAtlasWorkspaces =
      <MountedAtlasWorkspaceDto>[];
  bool showLabels = true;
  bool pointClusteringEnabled = true;
  int pointClusterRadius = 50;
  int pointClusterMaxZoom = 14;
  CalloutDisplayMode calloutMode = CalloutDisplayMode.full;
  final Map<String, String> macOsSecurityBookmarks = <String, String>{};
  int _lastSyncedClusterRadius = 50;
  int _lastSyncedClusterMaxZoom = 14;

  MapLayerCacheKey? _lastKey;
  MapLayerSnapshot? _lastSnapshot;
  int _buildCount = 0;
  int _cacheHits = 0;
  int _revision = 0;

  /// Number of times [resolve] recomputed the layer snapshot.
  int get buildCount => _buildCount;

  /// Number of times [resolve] returned the memoized snapshot on a cache hit.
  int get cacheHits => _cacheHits;

  /// Monotonically increasing revision of computed snapshots.
  int get revision => _revision;

  MapLayerSnapshot? get lastSnapshot => _lastSnapshot;

  bool isDark({required bool systemIsDark}) => isDarkBasemap(
        selectedBasemap,
        systemIsDark: systemIsDark,
        backgroundMode: backgroundMode,
      );

  MapStyle resolveMapStyle({required bool systemIsDark}) {
    if (selectedBasemap == BasemapKind.offlinePmtiles &&
        offlineBasemap != null) {
      return MapStyle.json(offlineBasemap!.styleJson);
    }
    return MapStyle.url(
      openFreeMapStyleUrl(selectedBasemap, systemIsDark: systemIsDark),
    );
  }

  /// Resolves derived map layers and overlays, returning the cached
  /// [MapLayerSnapshot] whenever all content/revision inputs match [_lastKey].
  MapLayerSnapshot resolve({
    required List<ShelfMapEntry> shelfMaps,
    required int shelfRevision,
    required List<DrawnFeature> draftFeatures,
    required int draftRevision,
    required Set<String> selectedDraftFeatureIds,
    required int selectionRevision,
    required List<SightingSummaryDto> sightings,
    required int sightingsRevision,
    required List<LiveBeaconDto> beacons,
    required int beaconsRevision,
    required ActiveStoryRenderContext? activeStory,
    required int storyRevision,
    required List<ShelfShape> commentOverlayShapes,
    required int commentOverlayRevision,
    required List<ShelfShape> proposalOverlayShapes,
    required int proposalOverlayRevision,
    required List<ShelfShape> aiGhostShapes,
    required int aiGhostRevision,
    required bool gpsTrackRecording,
    required List<Geographic> gpsTrackPoints,
    required int gpsTrackRevision,
    required Color accentColor,
    required bool systemIsDark,
    required ValueChanged<InspectedFeature> onInspectFeature,
  }) {
    final effectiveShowLabels =
        showLabels && selectedBasemap != BasemapKind.offlinePmtiles;
    final darkMap = isDark(systemIsDark: systemIsDark);
    final effectiveGpsRevision = gpsTrackRecording ? gpsTrackRevision : 0;

    final key = MapLayerCacheKey(
      shelfRevision: shelfRevision,
      draftRevision: draftRevision,
      selectionRevision: selectionRevision,
      sightingsRevision: sightingsRevision,
      beaconsRevision: beaconsRevision,
      storyRevision: storyRevision,
      commentOverlayRevision: commentOverlayRevision,
      proposalOverlayRevision: proposalOverlayRevision,
      aiGhostRevision: aiGhostRevision,
      gpsTrackRevision: effectiveGpsRevision,
      accentColorValue: accentColor.toARGB32(),
      isDarkMap: darkMap,
      showLabels: effectiveShowLabels,
      effectiveBasemap: selectedBasemap,
      pointClusteringEnabled: pointClusteringEnabled,
      pointClusterRadius: pointClusterRadius,
      pointClusterMaxZoom: pointClusterMaxZoom,
    );

    final cached = _lastSnapshot;
    if (cached != null && _lastKey == key) {
      _cacheHits += 1;
      return cached;
    }

    final visibleCallouts = collectVisibleCallouts(
      shelfMaps: shelfMaps,
      draftFeatures: draftFeatures,
      activeStory: activeStory,
    );
    final visibleIconPins = collectVisibleIconPins(
      shelfMaps: shelfMaps,
      draftAccentColor: accentColor,
      draftFeatures: draftFeatures,
      activeStory: activeStory,
    );
    final visibleArrowheads = collectVisibleArrowheads(
      shelfMaps: shelfMaps,
      draftAccentColor: accentColor,
      draftFeatures: draftFeatures,
      activeStory: activeStory,
    );
    final externalSnapShapes = <List<Geographic>>[
      for (final entry in shelfMaps)
        if (entry.visible)
          for (final shape in entry.shapes)
            if (shape.coords.isNotEmpty) shape.coords,
    ];
    final combinedProposalShapes = <ShelfShape>[
      ...proposalOverlayShapes,
      ...aiGhostShapes,
    ];

    final clustered = pointClusteringEnabled
        ? collectClusterableShelfPoints(
            shelfMaps: shelfMaps,
            activeStory: activeStory,
          )
        : (
            points: const <Feature<Point>>[],
            meta: const <InspectedFeature>[],
          );

    final gpuLayers = buildEarthlyGpuLayers(
      shelfMaps: shelfMaps,
      sightings: sightings,
      beacons: beacons,
      draftFeatures: draftFeatures,
      accentColor: accentColor,
      isDarkMap: darkMap,
      showLabels: effectiveShowLabels,
      onInspectFeature: onInspectFeature,
      clusterShelfPoints: pointClusteringEnabled,
      gpsTrackPoints: gpsTrackRecording ? gpsTrackPoints : const [],
      activeStory: activeStory,
      commentOverlayShapes: commentOverlayShapes,
      proposalOverlayShapes: combinedProposalShapes,
      selectedDraftFeatureIds: selectedDraftFeatureIds,
    );

    final snapshot = MapLayerSnapshot(
      gpuLayers: gpuLayers,
      visibleCallouts: visibleCallouts,
      visibleIconPins: visibleIconPins,
      visibleArrowheads: visibleArrowheads,
      externalSnapShapes: externalSnapShapes,
      combinedProposalShapes: combinedProposalShapes,
      clusteredShelfPoints: clustered.points,
      clusteredShelfPointMeta: clustered.meta,
    );

    _lastKey = key;
    _lastSnapshot = snapshot;
    _buildCount += 1;
    _revision += 1;
    return snapshot;
  }

  /// Forces the next [resolve] call to recompute layers even if revisions match.
  void invalidate() {
    _lastKey = null;
    layerConfigListenable.notifyListeners();
    notifyListeners();
  }

  void _notifyLayerConfig() {
    layerConfigListenable.notifyListeners();
    presentationListenable.notifyListeners();
    notifyListeners();
  }

  void _notifyPresentationOnly() {
    presentationListenable.notifyListeners();
    notifyListeners();
  }

  void setSelectedBasemap(BasemapKind kind) {
    if (selectedBasemap == kind) return;
    selectedBasemap = kind;
    _notifyLayerConfig();
  }

  void setBackgroundMode(MapBackgroundMode mode) {
    if (backgroundMode == mode) return;
    backgroundMode = mode;
    _notifyLayerConfig();
  }

  void setSatelliteOpacity(double opacity) {
    final clamped = opacity.clamp(0.05, 1.0);
    if (satelliteOpacity == clamped) return;
    satelliteOpacity = clamped;
    _notifyPresentationOnly();
  }

  void setShowLabels(bool value) {
    if (showLabels == value) return;
    showLabels = value;
    _notifyLayerConfig();
  }

  void setPointClusteringEnabled(bool value) {
    if (pointClusteringEnabled == value) return;
    pointClusteringEnabled = value;
    _notifyLayerConfig();
  }

  void setPointClusterRadius(int radius) {
    final clamped = radius.clamp(20, 120);
    if (pointClusterRadius == clamped) return;
    pointClusterRadius = clamped;
    _notifyLayerConfig();
  }

  void setPointClusterMaxZoom(int maxZoom) {
    final clamped = maxZoom.clamp(4, 18);
    if (pointClusterMaxZoom == clamped) return;
    pointClusterMaxZoom = clamped;
    _notifyLayerConfig();
  }

  void setCalloutMode(CalloutDisplayMode mode) {
    if (calloutMode == mode) return;
    calloutMode = mode;
    _notifyPresentationOnly();
  }

  void cycleCalloutMode() {
    calloutMode = nextCalloutDisplayMode(calloutMode);
    _notifyPresentationOnly();
  }

  void applyRestoredPresentation({
    required List<SavedOfflinePackDto> offlinePacks,
    required List<MountedAtlasWorkspaceDto> atlasWorkspaces,
    required BasemapKind restoredBasemap,
    required MapBackgroundMode restoredBackgroundMode,
    required double restoredSatelliteOpacity,
    bool restoredPointClusteringEnabled = true,
    int restoredPointClusterRadius = 50,
    int restoredPointClusterMaxZoom = 14,
  }) {
    savedOfflinePacks
      ..clear()
      ..addAll(offlinePacks);
    mountedAtlasWorkspaces
      ..clear()
      ..addAll(atlasWorkspaces);
    if (restoredBasemap != BasemapKind.offlinePmtiles ||
        offlineBasemap != null) {
      selectedBasemap = restoredBasemap;
    }
    backgroundMode = restoredBackgroundMode;
    satelliteOpacity = restoredSatelliteOpacity.clamp(0.05, 1.0);
    pointClusteringEnabled = restoredPointClusteringEnabled;
    pointClusterRadius = restoredPointClusterRadius.clamp(20, 120);
    pointClusterMaxZoom = restoredPointClusterMaxZoom.clamp(4, 18);
    _notifyLayerConfig();
  }

  void setOfflineBasemap(
    OfflinePmtilesBasemap offline, {
    SavedOfflinePackDto? packRecord,
  }) {
    offlineBasemap = offline;
    selectedBasemap = BasemapKind.offlinePmtiles;
    if (packRecord != null) {
      savedOfflinePacks.removeWhere((p) => p.sha256 == packRecord.sha256);
      savedOfflinePacks.insert(0, packRecord);
    }
    _notifyLayerConfig();
  }

  void removeSavedOfflinePack(String sha256) {
    savedOfflinePacks.removeWhere((p) => p.sha256 == sha256);
    if (offlineBasemap?.snapshot.sha256 == sha256) {
      offlineBasemap = null;
      selectedBasemap = BasemapKind.openFreeMapLiberty;
    }
    _notifyLayerConfig();
  }

  void addMountedAtlasWorkspace(MountedAtlasWorkspaceDto workspace) {
    mountedAtlasWorkspaces.removeWhere((w) => w.path == workspace.path);
    mountedAtlasWorkspaces.insert(0, workspace);
    _notifyPresentationOnly();
  }

  void removeMountedAtlasWorkspace(String path) {
    mountedAtlasWorkspaces.removeWhere((w) => w.path == path);
    _notifyPresentationOnly();
  }

  Future<void> syncSatellite(StyleController? style) async {
    if (style == null) return;
    final isOffline =
        selectedBasemap == BasemapKind.offlinePmtiles && offlineBasemap != null;
    await syncSatelliteOverlayLayer(
      style: style,
      mode: backgroundMode,
      opacity: satelliteOpacity,
      isOfflinePmtiles: isOffline,
    );
  }

  Future<void> syncClusteredPoints({
    required MapController? controller,
    required ValueChanged<InspectedFeature> onInspectFeature,
  }) async {
    final style = controller?.style;
    if (controller == null || style == null) return;
    final snap = _lastSnapshot;
    final forceRebuild = _lastSyncedClusterRadius != pointClusterRadius ||
        _lastSyncedClusterMaxZoom != pointClusterMaxZoom;
    _lastSyncedClusterRadius = pointClusterRadius;
    _lastSyncedClusterMaxZoom = pointClusterMaxZoom;
    await syncClusteredShelfPointsLayer(
      controller: controller,
      style: style,
      enabled: pointClusteringEnabled,
      clusterRadius: pointClusterRadius,
      clusterMaxZoom: pointClusterMaxZoom,
      points: snap?.clusteredShelfPoints ?? const <Feature<Point>>[],
      meta: snap?.clusteredShelfPointMeta ?? const <InspectedFeature>[],
      forceRebuildSource: forceRebuild,
      onInspectFeature: onInspectFeature,
      showCountLabels: selectedBasemap != BasemapKind.offlinePmtiles,
    );
  }

  Future<void> mountSavedOfflinePack(
    SavedOfflinePackDto pack, {
    required void Function(Geographic center, double zoom) onFlyTo,
  }) async {
    await RustBridge.ensureInitialized();
    final dir = await getApplicationSupportDirectory();
    await startLocalNode(dataDir: '${dir.path}/local-node');
    final blobUrl = await resolveLocalBlobUrl(sha256: pack.sha256);
    if (blobUrl == null) return;
    final snap = IngestedPmtilesSnapshot(
      label: pack.label,
      sha256: pack.sha256,
      sizeBytes: pack.sizeBytes,
      blobUrl: blobUrl,
      authorization: '',
      header: PmtilesHeaderSnapshot(
        format: pack.format,
        minZoom: pack.minZoom,
        maxZoom: pack.maxZoom,
        west: pack.west,
        south: pack.south,
        east: pack.east,
        north: pack.north,
        centerLon: pack.centerLon,
        centerLat: pack.centerLat,
        centerZoom: pack.centerZoom,
        clustered: true,
      ),
    );
    final offline = OfflinePmtilesBasemap(
      snapshot: snap,
      styleJson: buildPmtilesStyleJson(snap),
    );
    setOfflineBasemap(offline);
    onFlyTo(
      Geographic(lon: pack.centerLon, lat: pack.centerLat),
      pack.centerZoom.toDouble().clamp(2.0, 18.0),
    );
  }

  Future<File> _macOsBookmarksFile({String? supportDirPath}) async {
    final dirPath =
        supportDirPath ?? (await getApplicationSupportDirectory()).path;
    return File('$dirPath/security_bookmarks.json');
  }

  Future<void> _writeMacOsBookmarksFile({String? supportDirPath}) async {
    if (!Platform.isMacOS) return;
    try {
      final file = await _macOsBookmarksFile(supportDirPath: supportDirPath);
      await file.writeAsString(jsonEncode(macOsSecurityBookmarks));
    } catch (_) {}
  }

  Future<void> saveMacOsSecurityScopedBookmark(
    String path, {
    String? supportDirPath,
  }) async {
    if (!Platform.isMacOS) return;
    final clean = path.trim();
    if (clean.isEmpty) return;
    try {
      final bookmark = await DeviceBridge.createSecurityScopedBookmark(clean);
      if (bookmark != null && bookmark.isNotEmpty) {
        macOsSecurityBookmarks[clean] = bookmark;
        await _writeMacOsBookmarksFile(supportDirPath: supportDirPath);
      }
    } catch (_) {}
  }

  Future<void> removeMacOsSecurityScopedBookmark(
    String path, {
    String? supportDirPath,
  }) async {
    if (!Platform.isMacOS) return;
    if (macOsSecurityBookmarks.remove(path) != null) {
      await _writeMacOsBookmarksFile(supportDirPath: supportDirPath);
    }
  }

  Future<bool> restoreMacOsSecurityScopedBookmarks({
    String? supportDirPath,
  }) async {
    if (!Platform.isMacOS) return false;
    var workspacesUpdated = false;
    try {
      final file = await _macOsBookmarksFile(supportDirPath: supportDirPath);
      if (await file.exists()) {
        final raw = await file.readAsString();
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          for (final entry in decoded.entries) {
            final key = entry.key.toString();
            final val = entry.value?.toString() ?? '';
            if (key.isNotEmpty && val.isNotEmpty) {
              macOsSecurityBookmarks[key] = val;
            }
          }
        }
      }
      final rewrites = <String, String>{};
      for (final entry in macOsSecurityBookmarks.entries) {
        try {
          final resolved =
              await DeviceBridge.resolveSecurityScopedBookmark(entry.value);
          if (resolved != null && resolved.isNotEmpty && resolved != entry.key) {
            rewrites[entry.key] = resolved;
          }
        } catch (_) {}
      }
      if (rewrites.isNotEmpty) {
        for (final rw in rewrites.entries) {
          final bm = macOsSecurityBookmarks.remove(rw.key);
          if (bm != null) macOsSecurityBookmarks[rw.value] = bm;
          for (var i = 0; i < mountedAtlasWorkspaces.length; i++) {
            final ws = mountedAtlasWorkspaces[i];
            if (ws.path == rw.key) {
              mountedAtlasWorkspaces[i] = MountedAtlasWorkspaceDto(
                name: ws.name,
                path: rw.value,
                sizeBytes: ws.sizeBytes,
                families: ws.families,
                coverageSummary: ws.coverageSummary,
              );
              workspacesUpdated = true;
            }
          }
        }
        await _writeMacOsBookmarksFile(supportDirPath: supportDirPath);
        if (workspacesUpdated) {
          _notifyPresentationOnly();
        }
      }
      for (final ws in mountedAtlasWorkspaces) {
        if (!macOsSecurityBookmarks.containsKey(ws.path)) {
          await saveMacOsSecurityScopedBookmark(
            ws.path,
            supportDirPath: supportDirPath,
          );
        }
      }
    } catch (_) {}
    return workspacesUpdated;
  }

  @override
  void dispose() {
    layerConfigListenable.dispose();
    presentationListenable.dispose();
    super.dispose();
  }
}
