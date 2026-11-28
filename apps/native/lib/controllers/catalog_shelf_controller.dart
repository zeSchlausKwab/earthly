import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:maplibre/maplibre.dart';
import 'package:path_provider/path_provider.dart';

import '../nostr/callout_overlay.dart';
import '../nostr/nip55_signer.dart';
import '../nostr/shelf_renderer.dart';
import '../nostr/story_presentation.dart';
import '../runtime/rust_bridge.dart';
import '../shell/atlas_composer_sheet.dart';
import '../shell/desk_sheet.dart';
import '../shell/discussion_margin_sheet.dart';
import '../shell/sighting_composer_sheet.dart';
import '../shell/story_composer_sheet.dart';
import '../src/rust/api/blossom.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/private_groups.dart';
import '../src/rust/api/publish.dart';
import '../src/rust/api/spike.dart';

/// Manages the Explore catalog, Shelf mounted maps, Desk stories & atlases,
/// Sightings & Live Beacons, Active Story Reader, Comment/Proposal map
/// overlays, Blossom blob resolution/uploads, and entity inspection targets.
class CatalogShelfController extends ChangeNotifier {
  CatalogShelfController({this.resolveMapBlobsOverride});

  /// Optional test hook replacing Rust FFI Blossom blob fetching in unit/widget tests.
  final Future<String> Function(MapSummaryDto map)? resolveMapBlobsOverride;

  final ChangeNotifier mapContentListenable = ChangeNotifier();
  final ChangeNotifier shelfListenable = ChangeNotifier();
  final ChangeNotifier beaconsListenable = ChangeNotifier();
  final ChangeNotifier lensListenable = ChangeNotifier();
  final ChangeNotifier overlayListenable = ChangeNotifier();

  static const List<String> defaultProductionRelayUrls = <String>[
    'wss://relay.earthly.city',
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
  ];

  List<String> relayUrls = List<String>.from(defaultProductionRelayUrls);
  bool publicRelaysEnabled = true;
  EarthlyCatalogSnapshot? catalog;
  bool catalogLoading = false;

  final List<ShelfMapEntry> shelfMaps = <ShelfMapEntry>[];
  final List<StorySummaryDto> deskStories = <StorySummaryDto>[];
  final List<AtlasSummaryDto> deskAtlases = <AtlasSummaryDto>[];

  /// Ephemeral Mobile Gallery preview state (cleared when leaving Gallery Mode
  /// so swiping through Stories, Atlases, and Maps never pollutes [shelfMaps]).
  bool galleryModeActive = false;
  String? galleryPreviewKey;
  bool galleryPreviewLoading = false;
  final List<ShelfMapEntry> galleryPreviewMaps = <ShelfMapEntry>[];
  int _galleryPreviewSeq = 0;

  /// Shelf entries currently rendered on the map canvas — swaps in the active
  /// Gallery preview when Gallery Mode is displaying an entity.
  List<ShelfMapEntry> get effectiveDisplayShelfMaps =>
      galleryModeActive && galleryPreviewMaps.isNotEmpty
          ? List<ShelfMapEntry>.unmodifiable(galleryPreviewMaps)
          : shelfMaps;

  final Set<String> pinnedEntityIds = <String>{};
  final List<String> recentEntityIds = <String>[];

  AtlasSummaryDto? activeAtlasLens;
  AtlasSummaryDto? inspectedAtlas;
  MapSummaryDto? inspectedMap;
  Geographic? inspectedLocation;
  Geographic? routingOrigin;
  InspectedFeature? inspectedFeature;
  DiscussionTarget? discussionTarget;
  String? inspectedPersonPubkey;

  final List<SightingSummaryDto> localSightings = <SightingSummaryDto>[];
  final List<LiveBeaconDto> localBeacons = <LiveBeaconDto>[];

  StorySummaryDto? editingStory;
  AtlasSummaryDto? editingAtlas;
  Map<String, dynamic>? savedStoryDraft;

  String blossomServerUrl = 'https://blossom.earthly.city';
  final Set<String> resolvingBlobAddresses = <String>{};
  final Map<String, Future<MapSummaryDto>> _inFlightBlobResolutions =
      <String, Future<MapSummaryDto>>{};
  final Map<String, String> resolvedBlobGeojsonByEventId = <String, String>{};

  String? activeCommentOverlayId;
  bool showingAllCommentPins = false;
  List<ShelfShape> commentOverlayShapes = const <ShelfShape>[];
  List<MapCommentPinItem> activeCommentPins = const <MapCommentPinItem>[];
  String? activeProposalOverlayId;
  String? activeProposalLabel;
  List<ShelfShape> proposalOverlayShapes = const <ShelfShape>[];

  StorySummaryDto? activeStory;
  ParsedStoryDocument? parsedStory;
  final Map<String, ShelfMapEntry> storyDatasets = <String, ShelfMapEntry>{};
  final Map<String, DecodedNaddrDto> storyDecodedRefs =
      <String, DecodedNaddrDto>{};
  bool loadingStoryMaps = false;
  int? activeStoryViewIndex;
  String? focusedStoryDatasetAddress;
  String? focusedStoryFeatureId;
  final List<GeoPinOverlayItem> storyGeoPins = <GeoPinOverlayItem>[];

  int shelfRevision = 0;
  int sightingsRevision = 0;
  int beaconsRevision = 0;
  int storyRevision = 0;
  int commentOverlayRevision = 0;
  int proposalOverlayRevision = 0;

  List<SightingSummaryDto> get allSightings {
    final byAddr = <String, SightingSummaryDto>{};
    for (final s in catalog?.sightings ?? const <SightingSummaryDto>[]) {
      byAddr[s.address] = s;
    }
    for (final s in localSightings) {
      byAddr[s.address] = s;
    }
    return byAddr.values.toList(growable: false);
  }

  List<LiveBeaconDto> get allBeacons {
    final nowSec = BigInt.from(DateTime.now().millisecondsSinceEpoch ~/ 1000);
    final byAddr = <String, LiveBeaconDto>{};
    for (final b in catalog?.beacons ?? const <LiveBeaconDto>[]) {
      if (b.expiresAt == null || b.expiresAt! > nowSec) {
        byAddr[b.address] = b;
      }
    }
    for (final b in localBeacons) {
      if (b.expiresAt == null || b.expiresAt! > nowSec) {
        byAddr[b.address] = b;
      }
    }
    return byAddr.values.toList(growable: false);
  }

  ActiveStoryRenderContext? get activeStoryContext {
    if (activeStory == null || parsedStory == null) return null;
    final layers = (activeStoryViewIndex != null &&
            activeStoryViewIndex! < parsedStory!.viewSnapshots.length)
        ? parsedStory!.viewSnapshots[activeStoryViewIndex!].layers
        : parsedStory!.baseLayers;
    return ActiveStoryRenderContext(
      story: activeStory!,
      datasetsByAddress: storyDatasets,
      presentationLayers: layers,
      focusedDatasetAddress: focusedStoryDatasetAddress,
      focusedFeatureId: focusedStoryFeatureId,
      geoPins: storyGeoPins,
    );
  }

  static ShelfMapEntry entryFromSummary(MapSummaryDto map) => ShelfMapEntry(
        summary: map,
        visible: true,
        shapes: parseGeoJsonShapes(
          map.geojson,
          datasetTitle: map.title,
          datasetAddress: map.address,
        ),
      );

  void _notifyShelfChanged() {
    shelfRevision += 1;
    shelfListenable.notifyListeners();
    mapContentListenable.notifyListeners();
    notifyListeners();
  }

  void _notifySightingsChanged() {
    sightingsRevision += 1;
    mapContentListenable.notifyListeners();
    notifyListeners();
  }

  void _notifyBeaconsChanged() {
    beaconsRevision += 1;
    beaconsListenable.notifyListeners();
    mapContentListenable.notifyListeners();
    notifyListeners();
  }

  void _notifyStoryChanged() {
    storyRevision += 1;
    mapContentListenable.notifyListeners();
    notifyListeners();
  }

  void _notifyCommentOverlayChanged() {
    commentOverlayRevision += 1;
    overlayListenable.notifyListeners();
    mapContentListenable.notifyListeners();
    notifyListeners();
  }

  void _notifyProposalOverlayChanged() {
    proposalOverlayRevision += 1;
    overlayListenable.notifyListeners();
    mapContentListenable.notifyListeners();
    notifyListeners();
  }

  void applyRestoredSettings({
    required List<String> restoredRelayUrls,
    required List<String> restoredPinnedEntityIds,
    required List<String> restoredRecentEntityIds,
    required String restoredBlossomServerUrl,
    required String? restoredStoryDraftJson,
    bool? restoredPublicRelaysEnabled,
  }) {
    if (restoredRelayUrls.isNotEmpty) {
      relayUrls = List<String>.from(restoredRelayUrls);
    }
    if (restoredPublicRelaysEnabled != null) {
      publicRelaysEnabled = restoredPublicRelaysEnabled;
    }
    pinnedEntityIds
      ..clear()
      ..addAll(restoredPinnedEntityIds);
    recentEntityIds
      ..clear()
      ..addAll(restoredRecentEntityIds);
    if (restoredBlossomServerUrl.trim().isNotEmpty) {
      blossomServerUrl = restoredBlossomServerUrl.trim();
    }
    if (restoredStoryDraftJson != null &&
        restoredStoryDraftJson.trim().isNotEmpty) {
      try {
        final parsedDraft = jsonDecode(restoredStoryDraftJson);
        if (parsedDraft is Map<String, dynamic>) {
          savedStoryDraft = parsedDraft;
        }
      } catch (_) {}
    }
    notifyListeners();
  }

  Future<void> preloadCatalog({
    bool isHeadlessTest = false,
    void Function(EarthlyCatalogSnapshot catalog)? onCatalogLoaded,
  }) async {
    if (isHeadlessTest || catalogLoading) return;
    catalogLoading = true;
    notifyListeners();
    try {
      await RustBridge.ensureInitialized();
      final fetched = await fetchEarthlyCatalog(
        relayUrls: relayUrls,
        limitPerKind: 250,
      );
      setCatalog(fetched);
      onCatalogLoaded?.call(fetched);
    } catch (_) {
    } finally {
      catalogLoading = false;
      notifyListeners();
    }
  }

  void setCatalog(EarthlyCatalogSnapshot? next) {
    final prevSightingsCount = catalog?.sightings.length ?? 0;
    final prevBeaconsCount = catalog?.beacons.length ?? 0;
    catalog = next;
    if ((next?.sightings.length ?? 0) != prevSightingsCount) {
      sightingsRevision += 1;
      mapContentListenable.notifyListeners();
    }
    if ((next?.beacons.length ?? 0) != prevBeaconsCount) {
      beaconsRevision += 1;
      beaconsListenable.notifyListeners();
      mapContentListenable.notifyListeners();
    }
    notifyListeners();
  }

  void toggleFavoriteEntity(String entityId, {VoidCallback? onPersist}) {
    if (!pinnedEntityIds.add(entityId)) {
      pinnedEntityIds.remove(entityId);
    }
    notifyListeners();
    onPersist?.call();
  }

  void recordRecentEntity(String entityId, {VoidCallback? onPersist}) {
    recentEntityIds.remove(entityId);
    recentEntityIds.insert(0, entityId);
    if (recentEntityIds.length > 40) {
      recentEntityIds.removeRange(40, recentEntityIds.length);
    }
    notifyListeners();
    onPersist?.call();
  }

  void updateRelayUrls(
    List<String> next, {
    VoidCallback? onPersist,
    VoidCallback? onSyncRelays,
  }) {
    final normalized = <String>[];
    for (final raw in next) {
      final clean = raw.trim().replaceFirst(RegExp(r'/+$'), '');
      if ((clean.startsWith('wss://') || clean.startsWith('ws://')) &&
          !normalized.contains(clean)) {
        normalized.add(clean);
      }
    }
    relayUrls = normalized.isEmpty
        ? List<String>.from(defaultProductionRelayUrls)
        : normalized;
    catalog = null;
    notifyListeners();
    onPersist?.call();
    onSyncRelays?.call();
  }

  /// Merges additional relay URLs (e.g., from NIP-65 or NIP-66 discovery) into
  /// [relayUrls] without duplicating existing entries. Returns `true` if added.
  bool mergeRelayUrls(
    Iterable<String> incoming, {
    VoidCallback? onPersist,
    VoidCallback? onSyncRelays,
  }) {
    final next = List<String>.from(relayUrls);
    var changed = false;
    for (final raw in incoming) {
      final clean = raw.trim().replaceFirst(RegExp(r'/+$'), '');
      if ((clean.startsWith('wss://') || clean.startsWith('ws://')) &&
          !next.contains(clean)) {
        next.add(clean);
        changed = true;
      }
    }
    if (!changed) return false;
    updateRelayUrls(next, onPersist: onPersist, onSyncRelays: onSyncRelays);
    return true;
  }

  void setPublicRelaysEnabledState(bool enabled) {
    if (publicRelaysEnabled == enabled) return;
    publicRelaysEnabled = enabled;
    notifyListeners();
  }

  void setBlossomServerUrl(String url, {VoidCallback? onPersist}) {
    blossomServerUrl = url;
    notifyListeners();
    onPersist?.call();
  }

  MapSummaryDto _withResolvedBlobGeojson(
    MapSummaryDto map,
    String resolvedGeojson,
    int resolvedFeatureCount,
  ) {
    return MapSummaryDto(
      address: map.address,
      eventId: map.eventId,
      pubkey: map.pubkey,
      dTag: map.dTag,
      title: map.title,
      description: map.description,
      featureCount: resolvedFeatureCount > map.featureCount
          ? resolvedFeatureCount
          : map.featureCount,
      sizeBytes: map.sizeBytes > resolvedGeojson.length
          ? map.sizeBytes
          : resolvedGeojson.length,
      geojson: resolvedGeojson,
      blobRefs: map.blobRefs,
      west: map.west,
      south: map.south,
      east: map.east,
      north: map.north,
      hashtags: map.hashtags,
      labels: map.labels,
      contextRefs: map.contextRefs,
      createdAt: map.createdAt,
    );
  }

  void applyResolvedMapToState(MapSummaryDto updated) {
    if (catalog != null) {
      final nextMaps = catalog!.maps
          .map((m) => m.address == updated.address ? updated : m)
          .toList(growable: false);
      catalog = EarthlyCatalogSnapshot(
        relayUrls: catalog!.relayUrls,
        maps: nextMaps,
        stories: catalog!.stories,
        atlases: catalog!.atlases,
        sightings: catalog!.sightings,
        beacons: catalog!.beacons,
      );
    }
    var shelfChanged = false;
    for (var i = 0; i < shelfMaps.length; i++) {
      if (shelfMaps[i].summary.address == updated.address) {
        shelfMaps[i] =
            entryFromSummary(updated).copyWith(visible: shelfMaps[i].visible);
        shelfChanged = true;
      }
    }
    for (var i = 0; i < galleryPreviewMaps.length; i++) {
      if (galleryPreviewMaps[i].summary.address == updated.address) {
        galleryPreviewMaps[i] = entryFromSummary(updated);
        shelfChanged = true;
      }
    }
    var storyChanged = false;
    if (storyDatasets.containsKey(updated.address)) {
      storyDatasets[updated.address] = entryFromSummary(updated);
      storyChanged = true;
    }
    if (inspectedMap?.address == updated.address) {
      inspectedMap = updated;
    }
    if (shelfChanged) _notifyShelfChanged();
    if (storyChanged) _notifyStoryChanged();
    if (!shelfChanged && !storyChanged) notifyListeners();
  }

  Future<MapSummaryDto> ensureMapBlobsResolved(
    MapSummaryDto map, {
    void Function(String error)? onError,
  }) async {
    if (map.blobRefs.isEmpty) return map;
    final cached = resolvedBlobGeojsonByEventId[map.eventId];
    if (cached != null) {
      if (map.geojson == cached) return map;
      final shapes = parseGeoJsonShapes(
        cached,
        datasetTitle: map.title,
        datasetAddress: map.address,
      );
      final updated = _withResolvedBlobGeojson(map, cached, shapes.length);
      applyResolvedMapToState(updated);
      return updated;
    }
    final inFlight = _inFlightBlobResolutions[map.address];
    if (inFlight != null) {
      return inFlight;
    }
    resolvingBlobAddresses.add(map.address);
    notifyListeners();
    final future = () async {
      try {
        final String resolved;
        if (resolveMapBlobsOverride != null) {
          resolved = await resolveMapBlobsOverride!(map);
        } else {
          await RustBridge.ensureInitialized();
          resolved = await resolveMapBlobGeojson(
            baseGeojson: map.geojson,
            blobRefs: map.blobRefs,
          );
        }
        resolvedBlobGeojsonByEventId[map.eventId] = resolved;
        final shapes = parseGeoJsonShapes(
          resolved,
          datasetTitle: map.title,
          datasetAddress: map.address,
        );
        final updated = _withResolvedBlobGeojson(map, resolved, shapes.length);
        applyResolvedMapToState(updated);
        return updated;
      } catch (err) {
        onError?.call('Blossom blob fetch failed: $err');
        return map;
      } finally {
        _inFlightBlobResolutions.remove(map.address);
        resolvingBlobAddresses.remove(map.address);
        notifyListeners();
      }
    }();
    _inFlightBlobResolutions[map.address] = future;
    return future;
  }

  /// Toggles a map on the Shelf. Returns `true` if added, `false` if removed.
  bool toggleMapOnShelf(
    MapSummaryDto map, {
    VoidCallback? onPersist,
    VoidCallback? onSyncMcp,
  }) {
    final idx = shelfMaps.indexWhere((e) => e.summary.address == map.address);
    if (idx >= 0) {
      shelfMaps.removeAt(idx);
      _notifyShelfChanged();
      onSyncMcp?.call();
      return false;
    }
    shelfMaps.add(entryFromSummary(map));
    _notifyShelfChanged();
    recordRecentEntity('map:${map.address}', onPersist: onPersist);
    if (map.blobRefs.isNotEmpty) {
      unawaited(ensureMapBlobsResolved(map));
    }
    onSyncMcp?.call();
    return true;
  }

  List<ShelfMapEntry> addMapsBulkToShelf(List<MapSummaryDto> maps) {
    if (maps.isEmpty) return const <ShelfMapEntry>[];
    final added = <ShelfMapEntry>[];
    for (final m in maps) {
      if (shelfMaps.any((e) => e.summary.address == m.address)) continue;
      final entry = entryFromSummary(m);
      shelfMaps.add(entry);
      added.add(entry);
    }
    if (added.isNotEmpty) {
      _notifyShelfChanged();
      for (final entry in added) {
        if (entry.summary.blobRefs.isNotEmpty) {
          unawaited(ensureMapBlobsResolved(entry.summary));
        }
      }
    }
    return added;
  }

  void toggleShelfVisibility(String address) {
    final idx = shelfMaps.indexWhere((e) => e.summary.address == address);
    if (idx < 0) return;
    shelfMaps[idx] = shelfMaps[idx].copyWith(visible: !shelfMaps[idx].visible);
    _notifyShelfChanged();
  }

  void removeShelfMap(String address) {
    final before = shelfMaps.length;
    shelfMaps.removeWhere((e) => e.summary.address == address);
    if (shelfMaps.length != before) _notifyShelfChanged();
  }

  void clearShelf() {
    if (shelfMaps.isEmpty) return;
    shelfMaps.clear();
    _notifyShelfChanged();
  }

  void ensureMapOnShelf(MapSummaryDto map) {
    if (shelfMaps.any((e) => e.summary.address == map.address)) return;
    shelfMaps.add(entryFromSummary(map));
    _notifyShelfChanged();
  }

  void removeDeskStory(String address) {
    deskStories.removeWhere((s) => s.address == address);
    notifyListeners();
  }

  void removeDeskAtlas(String address) {
    deskAtlases.removeWhere((a) => a.address == address);
    notifyListeners();
  }

  void setInspectedAtlas(AtlasSummaryDto atlas, {VoidCallback? onPersist}) {
    recordRecentEntity('atlas:${atlas.address}', onPersist: onPersist);
    inspectedAtlas = atlas;
    deskAtlases.removeWhere((a) => a.address == atlas.address);
    deskAtlases.insert(0, atlas);
    notifyListeners();
  }

  void enterAtlasLens(AtlasSummaryDto atlas, {VoidCallback? onPersist}) {
    recordRecentEntity('atlas:${atlas.address}', onPersist: onPersist);
    activeAtlasLens = atlas;
    deskAtlases.removeWhere((a) => a.address == atlas.address);
    deskAtlases.insert(0, atlas);
    lensListenable.notifyListeners();
    notifyListeners();
  }

  void leaveAtlasLens() {
    if (activeAtlasLens == null) return;
    activeAtlasLens = null;
    lensListenable.notifyListeners();
    notifyListeners();
  }

  Future<List<ShelfMapEntry>> openAtlas(
    AtlasSummaryDto atlas, {
    required Set<String> mutedPubkeys,
    VoidCallback? onPersist,
  }) async {
    recordRecentEntity('atlas:${atlas.address}', onPersist: onPersist);
    final mapAddresses = <String>{
      ...atlas.pinnedAddresses.where((a) => a.startsWith('37515:')),
      if (atlas.governance != 'closed')
        for (final m in catalog?.maps ?? const <MapSummaryDto>[])
          if (m.contextRefs.contains(atlas.address) &&
              !mutedPubkeys.contains(m.pubkey))
            m.address,
    }.toList(growable: false);
    if (mapAddresses.isEmpty) return const <ShelfMapEntry>[];

    final knownByAddr = <String, MapSummaryDto>{
      for (final m in catalog?.maps ?? const <MapSummaryDto>[]) m.address: m,
      for (final s in shelfMaps) s.summary.address: s.summary,
    };
    final missing =
        mapAddresses.where((a) => !knownByAddr.containsKey(a)).toList();

    if (missing.isNotEmpty) {
      try {
        await RustBridge.ensureInitialized();
        final fetched = await fetchMapsByAddresses(
          relayUrls: relayUrls,
          addresses: missing,
        );
        for (final m in fetched) {
          knownByAddr[m.address] = m;
        }
      } catch (_) {}
    }

    final added = <ShelfMapEntry>[];
    deskAtlases.removeWhere((a) => a.address == atlas.address);
    deskAtlases.insert(0, atlas);
    for (final addr in mapAddresses) {
      final map = knownByAddr[addr];
      if (map == null) continue;
      final existingIdx =
          shelfMaps.indexWhere((e) => e.summary.address == map.address);
      if (existingIdx >= 0) {
        added.add(shelfMaps[existingIdx]);
      } else {
        final entry = entryFromSummary(map);
        shelfMaps.add(entry);
        added.add(entry);
      }
    }
    _notifyShelfChanged();
    for (final entry in added) {
      if (entry.summary.blobRefs.isNotEmpty) {
        unawaited(ensureMapBlobsResolved(entry.summary));
      }
    }
    return added;
  }

  void setInspectedMap(MapSummaryDto map, {VoidCallback? onPersist}) {
    recordRecentEntity('map:${map.address}', onPersist: onPersist);
    inspectedMap = map;
    notifyListeners();
    if (map.blobRefs.isNotEmpty) {
      unawaited(ensureMapBlobsResolved(map));
    }
  }

  void setInspectedFeature(InspectedFeature? feature) {
    inspectedFeature = feature;
    notifyListeners();
  }

  void setDiscussionTarget(DiscussionTarget target) {
    discussionTarget = target;
    notifyListeners();
  }

  void setInspectedPersonPubkey(String pubkey) {
    inspectedPersonPubkey = pubkey;
    notifyListeners();
  }

  void setInspectedLocation(Geographic pt) {
    inspectedLocation = pt;
    notifyListeners();
  }

  void setRoutingOrigin(Geographic? origin) {
    routingOrigin = origin;
    notifyListeners();
  }

  void setEditingStory(StorySummaryDto? story) {
    editingStory = story;
    notifyListeners();
  }

  void setEditingAtlas(AtlasSummaryDto? atlas) {
    editingAtlas = atlas;
    notifyListeners();
  }

  void setSavedStoryDraft(
    Map<String, dynamic>? draft, {
    bool notify = true,
    VoidCallback? onPersist,
  }) {
    savedStoryDraft = draft;
    if (notify) notifyListeners();
    onPersist?.call();
  }

  // --- Story Reader ---

  Future<void> openStory(
    StorySummaryDto story, {
    required VoidCallback onPrepareDrawer,
    required void Function(StoryCameraTarget camera) onFlyToCamera,
    required void Function(GeoBox bounds) onFlyToBounds,
  }) async {
    final parsed = parseStoryDocument(
      markdown: story.content,
      presentationJson: story.presentationJson,
    );

    final knownByAddr = <String, MapSummaryDto>{
      for (final m in catalog?.maps ?? const <MapSummaryDto>[]) m.address: m,
      for (final s in shelfMaps) s.summary.address: s.summary,
    };

    final targetAddresses = <String>{
      ...story.referencedAddresses.where((a) => a.startsWith('37515:')),
      ...parsed.presentationMapAddresses,
    };

    final initialDatasets = <String, ShelfMapEntry>{};
    for (final addr in targetAddresses) {
      final found = knownByAddr[addr];
      if (found != null) {
        initialDatasets[addr] = entryFromSummary(found);
      }
    }

    final initialPins = <GeoPinOverlayItem>[];
    for (final ref in parsed.inlineRefs) {
      if (ref.kind == StoryInlineRefKind.geoCoord &&
          ref.lat != null &&
          ref.lon != null) {
        initialPins.add(
          GeoPinOverlayItem(
            id: ref.rawToken,
            position: Geographic(lon: ref.lon!, lat: ref.lat!),
            label:
                '${ref.lat!.toStringAsFixed(4)}, ${ref.lon!.toStringAsFixed(4)}',
          ),
        );
      }
    }

    onPrepareDrawer();
    activeStory = story;
    parsedStory = parsed;
    deskStories.removeWhere((s) => s.address == story.address);
    deskStories.insert(0, story);
    storyDatasets
      ..clear()
      ..addAll(initialDatasets);
    storyDecodedRefs.clear();
    loadingStoryMaps = true;
    activeStoryViewIndex = null;
    focusedStoryDatasetAddress = null;
    focusedStoryFeatureId = null;
    storyGeoPins
      ..clear()
      ..addAll(initialPins);
    _notifyStoryChanged();

    if (parsed.initialView != null) {
      onFlyToCamera(parsed.initialView!);
    } else if (initialDatasets.isNotEmpty) {
      final bounds = computeCombinedBounds(initialDatasets.values);
      if (bounds != null) onFlyToBounds(bounds);
    }

    try {
      await RustBridge.ensureInitialized();
      final decodedMap = <String, DecodedNaddrDto>{};
      final hintedRelays = <String>{...relayUrls};

      for (final ref in parsed.inlineRefs) {
        if (ref.kind != StoryInlineRefKind.naddr || ref.naddrUri == null) {
          continue;
        }
        final decoded = await decodeNaddrCoordinate(naddrUri: ref.naddrUri!);
        if (decoded != null) {
          decodedMap[ref.rawToken] = decoded;
          if (decoded.kind == 37515) {
            targetAddresses.add(decoded.address);
          }
          for (final r in decoded.relays) {
            if (r.startsWith('wss://')) hintedRelays.add(r);
          }
        }
      }

      for (final addr in targetAddresses) {
        if (!initialDatasets.containsKey(addr) &&
            knownByAddr.containsKey(addr)) {
          initialDatasets[addr] = entryFromSummary(knownByAddr[addr]!);
        }
      }

      final missingAddresses = targetAddresses
          .where((a) => !initialDatasets.containsKey(a))
          .toList(growable: false);

      if (missingAddresses.isNotEmpty) {
        final fetched = await fetchMapsByAddresses(
          relayUrls: hintedRelays.toList(growable: false),
          addresses: missingAddresses,
        );
        for (final map in fetched) {
          initialDatasets[map.address] = entryFromSummary(map);
        }
      }

      if (activeStory?.address != story.address) return;
      storyDecodedRefs
        ..clear()
        ..addAll(decodedMap);
      storyDatasets
        ..clear()
        ..addAll(initialDatasets);
      loadingStoryMaps = false;
      _notifyStoryChanged();

      for (final entry in initialDatasets.values) {
        if (entry.summary.blobRefs.isNotEmpty) {
          unawaited(ensureMapBlobsResolved(entry.summary));
        }
      }

      if (parsed.initialView == null && initialDatasets.isNotEmpty) {
        final bounds = computeCombinedBounds(initialDatasets.values);
        if (bounds != null) onFlyToBounds(bounds);
      }
    } catch (_) {
      if (activeStory?.address == story.address) {
        loadingStoryMaps = false;
        notifyListeners();
      }
    }
  }

  void selectStoryView(
    int? index, {
    required void Function(StoryCameraTarget camera) onFlyToCamera,
    required void Function(GeoBox bounds) onFlyToBounds,
  }) {
    final parsed = parsedStory;
    if (parsed == null) return;
    activeStoryViewIndex = index;
    focusedStoryDatasetAddress = null;
    focusedStoryFeatureId = null;
    _notifyStoryChanged();
    if (index == null) {
      if (parsed.initialView != null) {
        onFlyToCamera(parsed.initialView!);
      } else {
        final bounds = computeCombinedBounds(storyDatasets.values);
        if (bounds != null) onFlyToBounds(bounds);
      }
      return;
    }
    if (index >= 0 && index < parsed.viewSnapshots.length) {
      final snap = parsed.viewSnapshots[index];
      if (snap.camera != null) {
        onFlyToCamera(snap.camera!);
      }
    }
  }

  void focusStoryDataset(String address) {
    focusedStoryDatasetAddress = address;
    focusedStoryFeatureId = null;
    _notifyStoryChanged();
  }

  ShelfMapEntry? activateStoryNaddrRef(DecodedNaddrDto ref) {
    focusedStoryDatasetAddress = ref.address;
    focusedStoryFeatureId = ref.featureId;
    _notifyStoryChanged();
    return storyDatasets[ref.address];
  }

  void addStoryGeoPin(double lat, double lon, String label) {
    final pos = Geographic(lon: lon, lat: lat);
    if (!storyGeoPins.any((p) => p.label == label)) {
      storyGeoPins.add(
        GeoPinOverlayItem(id: 'geo-$label', position: pos, label: label),
      );
      _notifyStoryChanged();
    }
  }

  int keepStoryMapsOnShelf() {
    var added = 0;
    for (final entry in storyDatasets.values) {
      final exists = shelfMaps.any(
        (e) => e.summary.address == entry.summary.address,
      );
      if (!exists) {
        shelfMaps.add(entry);
        added += 1;
      }
    }
    if (added > 0) _notifyShelfChanged();
    return storyDatasets.length;
  }

  void closeStory() {
    activeStory = null;
    parsedStory = null;
    storyDatasets.clear();
    storyDecodedRefs.clear();
    loadingStoryMaps = false;
    activeStoryViewIndex = null;
    focusedStoryDatasetAddress = null;
    focusedStoryFeatureId = null;
    storyGeoPins.clear();
    _notifyStoryChanged();
  }

  // --- Mobile Gallery Ephemeral Map Preview & Auto-Zoom ---

  static GeoBox? _summaryGeoBox(MapSummaryDto map) {
    final west = map.west;
    final south = map.south;
    final east = map.east;
    final north = map.north;
    if (west == null || south == null || east == null || north == null) {
      return null;
    }
    if ((east - west).abs() < 1e-6 && (north - south).abs() < 1e-6) {
      return GeoBox(
        west: (west - 0.005).clamp(-180.0, 180.0),
        south: (south - 0.005).clamp(-85.0, 85.0),
        east: (east + 0.005).clamp(-180.0, 180.0),
        north: (north + 0.005).clamp(-85.0, 85.0),
      );
    }
    return GeoBox(west: west, south: south, east: east, north: north);
  }

  static GeoBox? _boundsForEntriesOrMaps(
    Iterable<ShelfMapEntry> entries, [
    Iterable<MapSummaryDto> fallbackMaps = const <MapSummaryDto>[],
  ]) {
    final fromShapes = computeCombinedBounds(entries);
    if (fromShapes != null) return fromShapes;
    double? west;
    double? south;
    double? east;
    double? north;
    for (final m in fallbackMaps) {
      final b = _summaryGeoBox(m);
      if (b == null) continue;
      west = west == null ? b.west : (b.west < west ? b.west : west);
      south = south == null ? b.south : (b.south < south ? b.south : south);
      east = east == null ? b.east : (b.east > east ? b.east : east);
      north = north == null ? b.north : (b.north > north ? b.north : north);
    }
    if (west == null || south == null || east == null || north == null) {
      return null;
    }
    return GeoBox(west: west, south: south, east: east, north: north);
  }

  MapSummaryDto _withCachedBlobIfAvailable(MapSummaryDto map) {
    final cached = resolvedBlobGeojsonByEventId[map.eventId];
    if (cached != null && cached != map.geojson) {
      final shapes = parseGeoJsonShapes(
        cached,
        datasetTitle: map.title,
        datasetAddress: map.address,
      );
      return _withResolvedBlobGeojson(map, cached, shapes.length);
    }
    return map;
  }

  void setGalleryModeActive(bool active) {
    if (!active) {
      final hadState = galleryModeActive ||
          galleryPreviewMaps.isNotEmpty ||
          galleryPreviewKey != null ||
          galleryPreviewLoading;
      _galleryPreviewSeq += 1;
      galleryModeActive = false;
      galleryPreviewKey = null;
      galleryPreviewLoading = false;
      galleryPreviewMaps.clear();
      if (hadState) {
        _notifyShelfChanged();
      }
      return;
    }
    if (galleryModeActive) return;
    galleryModeActive = true;
    _notifyShelfChanged();
  }

  void clearGalleryPreview() {
    _galleryPreviewSeq += 1;
    if (galleryPreviewMaps.isEmpty &&
        galleryPreviewKey == null &&
        !galleryPreviewLoading) {
      return;
    }
    galleryPreviewKey = null;
    galleryPreviewLoading = false;
    galleryPreviewMaps.clear();
    _notifyShelfChanged();
  }

  Future<void> previewGalleryMap(
    MapSummaryDto map, {
    required void Function(GeoBox bounds) onFlyToBounds,
  }) async {
    final seq = ++_galleryPreviewSeq;
    galleryModeActive = true;
    galleryPreviewKey = 'map:${map.address}';
    final effective = _withCachedBlobIfAvailable(map);
    final initialEntry = entryFromSummary(effective);
    final needsBlobFetch = effective.blobRefs.isNotEmpty &&
        !resolvedBlobGeojsonByEventId.containsKey(effective.eventId);

    galleryPreviewMaps
      ..clear()
      ..add(initialEntry);
    galleryPreviewLoading = needsBlobFetch;
    _notifyShelfChanged();

    final initialBounds = _boundsForEntriesOrMaps([initialEntry], [effective]);
    if (initialBounds != null) {
      onFlyToBounds(initialBounds);
    }

    if (!needsBlobFetch) return;
    final resolved = await ensureMapBlobsResolved(effective);
    if (_galleryPreviewSeq != seq || !galleryModeActive) return;
    final resolvedEntry = entryFromSummary(resolved);
    galleryPreviewMaps
      ..clear()
      ..add(resolvedEntry);
    galleryPreviewLoading = false;
    _notifyShelfChanged();

    final resolvedBounds = _boundsForEntriesOrMaps([resolvedEntry], [resolved]);
    if (resolvedBounds != null) {
      onFlyToBounds(resolvedBounds);
    }
  }

  Future<void> previewGalleryStory(
    StorySummaryDto story, {
    required void Function(StoryCameraTarget camera) onFlyToCamera,
    required void Function(GeoBox bounds) onFlyToBounds,
  }) async {
    final seq = ++_galleryPreviewSeq;
    galleryModeActive = true;
    galleryPreviewKey = 'story:${story.address}';

    final parsed = parseStoryDocument(
      markdown: story.content,
      presentationJson: story.presentationJson,
    );
    final knownByAddr = <String, MapSummaryDto>{
      for (final m in catalog?.maps ?? const <MapSummaryDto>[])
        m.address: _withCachedBlobIfAvailable(m),
      for (final s in shelfMaps)
        s.summary.address: _withCachedBlobIfAvailable(s.summary),
    };
    final targetAddresses = <String>{
      ...story.referencedAddresses.where((a) => a.startsWith('37515:')),
      ...parsed.presentationMapAddresses,
    };

    final entriesByAddr = <String, ShelfMapEntry>{};
    for (final addr in targetAddresses) {
      final found = knownByAddr[addr];
      if (found != null) {
        entriesByAddr[addr] = entryFromSummary(found);
      }
    }

    final hasInlineNaddrs = parsed.inlineRefs
        .any((r) => r.kind == StoryInlineRefKind.naddr && r.naddrUri != null);
    final hasMissing =
        targetAddresses.any((a) => !entriesByAddr.containsKey(a));
    final needsAsync = hasInlineNaddrs ||
        hasMissing ||
        entriesByAddr.values.any(
          (e) =>
              e.summary.blobRefs.isNotEmpty &&
              !resolvedBlobGeojsonByEventId.containsKey(e.summary.eventId),
        );

    galleryPreviewMaps
      ..clear()
      ..addAll(entriesByAddr.values);
    galleryPreviewLoading = needsAsync;
    _notifyShelfChanged();

    if (parsed.initialView != null) {
      onFlyToCamera(parsed.initialView!);
    } else if (entriesByAddr.isNotEmpty) {
      final bounds = _boundsForEntriesOrMaps(
        entriesByAddr.values,
        entriesByAddr.values.map((e) => e.summary),
      );
      if (bounds != null) onFlyToBounds(bounds);
    } else {
      final geoRefs = parsed.inlineRefs
          .where(
            (r) =>
                r.kind == StoryInlineRefKind.geoCoord &&
                r.lat != null &&
                r.lon != null,
          )
          .toList(growable: false);
      if (geoRefs.isNotEmpty) {
        var west = geoRefs.first.lon!;
        var east = geoRefs.first.lon!;
        var south = geoRefs.first.lat!;
        var north = geoRefs.first.lat!;
        for (final r in geoRefs) {
          if (r.lon! < west) west = r.lon!;
          if (r.lon! > east) east = r.lon!;
          if (r.lat! < south) south = r.lat!;
          if (r.lat! > north) north = r.lat!;
        }
        onFlyToBounds(
          GeoBox(
            west: (west - 0.01).clamp(-180.0, 180.0),
            south: (south - 0.01).clamp(-85.0, 85.0),
            east: (east + 0.01).clamp(-180.0, 180.0),
            north: (north + 0.01).clamp(-85.0, 85.0),
          ),
        );
      }
    }

    if (!needsAsync) return;

    try {
      await RustBridge.ensureInitialized();
      if (_galleryPreviewSeq != seq || !galleryModeActive) return;
      final hintedRelays = <String>{...relayUrls};
      for (final ref in parsed.inlineRefs) {
        if (ref.kind != StoryInlineRefKind.naddr || ref.naddrUri == null) {
          continue;
        }
        final decoded = await decodeNaddrCoordinate(naddrUri: ref.naddrUri!);
        if (_galleryPreviewSeq != seq || !galleryModeActive) return;
        if (decoded != null) {
          if (decoded.kind == 37515) {
            targetAddresses.add(decoded.address);
          }
          for (final r in decoded.relays) {
            if (r.startsWith('wss://')) hintedRelays.add(r);
          }
        }
      }

      for (final addr in targetAddresses) {
        if (!entriesByAddr.containsKey(addr) && knownByAddr.containsKey(addr)) {
          entriesByAddr[addr] = entryFromSummary(knownByAddr[addr]!);
        }
      }

      final missingAddresses = targetAddresses
          .where((a) => !entriesByAddr.containsKey(a))
          .toList(growable: false);
      if (missingAddresses.isNotEmpty) {
        final fetched = await fetchMapsByAddresses(
          relayUrls: hintedRelays.toList(growable: false),
          addresses: missingAddresses,
        );
        if (_galleryPreviewSeq != seq || !galleryModeActive) return;
        for (final map in fetched) {
          entriesByAddr[map.address] =
              entryFromSummary(_withCachedBlobIfAvailable(map));
        }
      }

      for (final entry in List<ShelfMapEntry>.from(entriesByAddr.values)) {
        if (entry.summary.blobRefs.isNotEmpty &&
            !resolvedBlobGeojsonByEventId.containsKey(entry.summary.eventId)) {
          final resolved = await ensureMapBlobsResolved(entry.summary);
          if (_galleryPreviewSeq != seq || !galleryModeActive) return;
          entriesByAddr[resolved.address] = entryFromSummary(resolved);
        }
      }

      if (_galleryPreviewSeq != seq || !galleryModeActive) return;
      galleryPreviewMaps
        ..clear()
        ..addAll(entriesByAddr.values);
      galleryPreviewLoading = false;
      _notifyShelfChanged();

      if (parsed.initialView == null && entriesByAddr.isNotEmpty) {
        final bounds = _boundsForEntriesOrMaps(
          entriesByAddr.values,
          entriesByAddr.values.map((e) => e.summary),
        );
        if (bounds != null) onFlyToBounds(bounds);
      }
    } catch (_) {
      if (_galleryPreviewSeq == seq && galleryModeActive) {
        galleryPreviewLoading = false;
        notifyListeners();
      }
    }
  }

  Future<void> previewGalleryAtlas(
    AtlasSummaryDto atlas, {
    required Set<String> mutedPubkeys,
    required void Function(GeoBox bounds) onFlyToBounds,
  }) async {
    final seq = ++_galleryPreviewSeq;
    galleryModeActive = true;
    galleryPreviewKey = 'atlas:${atlas.address}';

    final mapAddresses = <String>{
      ...atlas.pinnedAddresses.where((a) => a.startsWith('37515:')),
      if (atlas.governance != 'closed')
        for (final m in catalog?.maps ?? const <MapSummaryDto>[])
          if (m.contextRefs.contains(atlas.address) &&
              !mutedPubkeys.contains(m.pubkey))
            m.address,
    }.toList(growable: false);

    final knownByAddr = <String, MapSummaryDto>{
      for (final m in catalog?.maps ?? const <MapSummaryDto>[])
        m.address: _withCachedBlobIfAvailable(m),
      for (final s in shelfMaps)
        s.summary.address: _withCachedBlobIfAvailable(s.summary),
    };

    final entriesByAddr = <String, ShelfMapEntry>{};
    final missing = <String>[];
    for (final addr in mapAddresses) {
      final found = knownByAddr[addr];
      if (found != null) {
        entriesByAddr[addr] = entryFromSummary(found);
      } else {
        missing.add(addr);
      }
    }

    final needsAsync = missing.isNotEmpty ||
        entriesByAddr.values.any(
          (e) =>
              e.summary.blobRefs.isNotEmpty &&
              !resolvedBlobGeojsonByEventId.containsKey(e.summary.eventId),
        );

    galleryPreviewMaps
      ..clear()
      ..addAll(entriesByAddr.values);
    galleryPreviewLoading = needsAsync;
    _notifyShelfChanged();

    final initialBounds = _boundsForEntriesOrMaps(
      entriesByAddr.values,
      entriesByAddr.values.map((e) => e.summary),
    );
    if (initialBounds != null) {
      onFlyToBounds(initialBounds);
    }

    if (!needsAsync) return;

    try {
      await RustBridge.ensureInitialized();
      if (_galleryPreviewSeq != seq || !galleryModeActive) return;
      if (missing.isNotEmpty) {
        final fetched = await fetchMapsByAddresses(
          relayUrls: relayUrls,
          addresses: missing,
        );
        if (_galleryPreviewSeq != seq || !galleryModeActive) return;
        for (final m in fetched) {
          entriesByAddr[m.address] =
              entryFromSummary(_withCachedBlobIfAvailable(m));
        }
      }

      for (final entry in List<ShelfMapEntry>.from(entriesByAddr.values)) {
        if (entry.summary.blobRefs.isNotEmpty &&
            !resolvedBlobGeojsonByEventId.containsKey(entry.summary.eventId)) {
          final resolved = await ensureMapBlobsResolved(entry.summary);
          if (_galleryPreviewSeq != seq || !galleryModeActive) return;
          entriesByAddr[resolved.address] = entryFromSummary(resolved);
        }
      }

      if (_galleryPreviewSeq != seq || !galleryModeActive) return;
      galleryPreviewMaps
        ..clear()
        ..addAll(entriesByAddr.values);
      galleryPreviewLoading = false;
      _notifyShelfChanged();

      final resolvedBounds = _boundsForEntriesOrMaps(
        entriesByAddr.values,
        entriesByAddr.values.map((e) => e.summary),
      );
      if (resolvedBounds != null) {
        onFlyToBounds(resolvedBounds);
      }
    } catch (_) {
      if (_galleryPreviewSeq == seq && galleryModeActive) {
        galleryPreviewLoading = false;
        notifyListeners();
      }
    }
  }

  // --- Comment / Proposal Map Overlays ---

  MapCommentPinItem? commentPinFromDto(
    GeoCommentDto comment, {
    required String Function(String pubkey) resolveAuthorName,
  }) {
    final raw = comment.geojson;
    if (raw == null || raw.isEmpty) return null;
    final shapes = parseGeoJsonShapes(raw, datasetTitle: 'Comment');
    final anchor = shapes.expand((s) => s.coords).firstOrNull;
    if (anchor == null) return null;
    return MapCommentPinItem(
      eventId: comment.eventId,
      authorName: resolveAuthorName(comment.pubkey),
      text: comment.text,
      anchor: anchor,
      comment: comment,
    );
  }

  void toggleAllCommentPins(
    List<GeoCommentDto> geoComments, {
    required String Function(String pubkey) resolveAuthorName,
  }) {
    if (showingAllCommentPins) {
      showingAllCommentPins = false;
      activeCommentOverlayId = null;
      commentOverlayShapes = const <ShelfShape>[];
      activeCommentPins = const <MapCommentPinItem>[];
      _notifyCommentOverlayChanged();
      return;
    }
    final mergedShapes = <ShelfShape>[
      for (final c in geoComments)
        if (c.geojson != null && c.geojson!.isNotEmpty)
          ...parseGeoJsonShapes(
            c.geojson!,
            datasetTitle: 'Comment',
          ),
    ];
    final pins = <MapCommentPinItem>[
      for (final c in geoComments)
        ?commentPinFromDto(c, resolveAuthorName: resolveAuthorName),
    ];
    showingAllCommentPins = true;
    activeCommentOverlayId = 'all-comment-pins';
    commentOverlayShapes = mergedShapes;
    activeCommentPins = pins;
    _notifyCommentOverlayChanged();
  }

  void toggleCommentOverlay(
    GeoCommentDto comment, {
    required String Function(String pubkey) resolveAuthorName,
  }) {
    if (activeCommentOverlayId == comment.eventId) {
      showingAllCommentPins = false;
      activeCommentOverlayId = null;
      commentOverlayShapes = const <ShelfShape>[];
      activeCommentPins = const <MapCommentPinItem>[];
      _notifyCommentOverlayChanged();
      return;
    }
    final shapes = comment.geojson != null
        ? parseGeoJsonShapes(comment.geojson!, datasetTitle: 'Comment')
        : const <ShelfShape>[];
    final singlePin =
        commentPinFromDto(comment, resolveAuthorName: resolveAuthorName);
    showingAllCommentPins = false;
    activeCommentOverlayId = comment.eventId;
    commentOverlayShapes = shapes;
    activeCommentPins =
        singlePin == null ? const [] : <MapCommentPinItem>[singlePin];
    _notifyCommentOverlayChanged();
  }

  void toggleProposalOverlay(GeoProposalDto proposal) {
    if (activeProposalOverlayId == proposal.eventId) {
      activeProposalOverlayId = null;
      activeProposalLabel = null;
      proposalOverlayShapes = const <ShelfShape>[];
      _notifyProposalOverlayChanged();
      return;
    }
    final shapes = parseGeoJsonShapes(
      proposal.geojson,
      datasetTitle: proposal.description ?? 'Proposal',
    );
    activeProposalOverlayId = proposal.eventId;
    activeProposalLabel =
        'Proposal (${proposal.status}) +${proposal.addedCount} ~${proposal.modifiedCount} -${proposal.removedCount}';
    proposalOverlayShapes = shapes;
    _notifyProposalOverlayChanged();
  }

  List<ShelfShape> toggleCircleProposalOverlay(CircleProposalDto proposal) {
    if (activeProposalOverlayId == proposal.proposalId) {
      activeProposalOverlayId = null;
      activeProposalLabel = null;
      proposalOverlayShapes = const <ShelfShape>[];
      _notifyProposalOverlayChanged();
      return const <ShelfShape>[];
    }
    final shapes = parseGeoJsonShapes(
      proposal.geojsonJson,
      datasetTitle: proposal.summary.isNotEmpty
          ? proposal.summary
          : proposal.title,
    );
    activeProposalOverlayId = proposal.proposalId;
    activeProposalLabel =
        'MLS Proposal (${proposal.status}) · ${proposal.featureCount} feat';
    proposalOverlayShapes = shapes;
    _notifyProposalOverlayChanged();
    return shapes;
  }

  void setCircleCommentOverlay(String? envelopeId, List<ShelfShape> shapes) {
    activeCommentOverlayId = envelopeId;
    commentOverlayShapes = shapes;
    _notifyCommentOverlayChanged();
  }

  void clearAllMapOverlays() {
    activeProposalOverlayId = null;
    activeProposalLabel = null;
    proposalOverlayShapes = const <ShelfShape>[];
    activeCommentOverlayId = null;
    showingAllCommentPins = false;
    commentOverlayShapes = const <ShelfShape>[];
    activeCommentPins = const <MapCommentPinItem>[];
    commentOverlayRevision += 1;
    proposalOverlayRevision += 1;
    overlayListenable.notifyListeners();
    mapContentListenable.notifyListeners();
    notifyListeners();
  }

  // --- Live Stream & Local Node Merges ---

  void mergeLiveRelayEvent(LiveRelayEventDto event) {
    final base = catalog;
    final mapsByAddr = <String, MapSummaryDto>{
      for (final m in base?.maps ?? const <MapSummaryDto>[]) m.address: m,
    };
    final storiesByAddr = <String, StorySummaryDto>{
      for (final s in base?.stories ?? const <StorySummaryDto>[]) s.address: s,
    };
    final atlasesByAddr = <String, AtlasSummaryDto>{
      for (final a in base?.atlases ?? const <AtlasSummaryDto>[]) a.address: a,
    };
    final sightingsByAddr = <String, SightingSummaryDto>{
      for (final s in base?.sightings ?? const <SightingSummaryDto>[])
        s.address: s,
    };
    final beaconsByAddr = <String, LiveBeaconDto>{
      for (final b in base?.beacons ?? const <LiveBeaconDto>[]) b.address: b,
    };

    var shelfChanged = false;
    if (event.map != null) {
      final m = event.map!;
      mapsByAddr[m.address] = m;
      for (var i = 0; i < shelfMaps.length; i++) {
        if (shelfMaps[i].summary.address == m.address &&
            shelfMaps[i].summary.eventId != m.eventId) {
          shelfMaps[i] =
              entryFromSummary(m).copyWith(visible: shelfMaps[i].visible);
          shelfChanged = true;
        }
      }
    }
    if (event.story != null) storiesByAddr[event.story!.address] = event.story!;
    if (event.atlas != null) atlasesByAddr[event.atlas!.address] = event.atlas!;
    if (event.sighting != null) {
      sightingsByAddr[event.sighting!.address] = event.sighting!;
    }
    if (event.beacon != null) {
      beaconsByAddr[event.beacon!.address] = event.beacon!;
    }

    catalog = EarthlyCatalogSnapshot(
      relayUrls: base?.relayUrls ?? relayUrls,
      maps: mapsByAddr.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
      stories: storiesByAddr.values.toList()
        ..sort((a, b) => b.publishedAt.compareTo(a.publishedAt)),
      atlases: atlasesByAddr.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
      sightings: sightingsByAddr.values.toList()
        ..sort((a, b) => b.start.compareTo(a.start)),
      beacons: beaconsByAddr.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
    );

    if (shelfChanged) {
      shelfRevision += 1;
      shelfListenable.notifyListeners();
      mapContentListenable.notifyListeners();
    }
    if (event.sighting != null) {
      sightingsRevision += 1;
      mapContentListenable.notifyListeners();
    }
    if (event.beacon != null) {
      beaconsRevision += 1;
      beaconsListenable.notifyListeners();
      mapContentListenable.notifyListeners();
    }
    notifyListeners();
  }

  void mergeLocalNodeCatalog(EarthlyCatalogSnapshot localSnap) {
    final base = catalog;
    final mapsByAddr = <String, MapSummaryDto>{
      for (final m in base?.maps ?? const <MapSummaryDto>[]) m.address: m,
      for (final m in localSnap.maps) m.address: m,
    };
    final storiesByAddr = <String, StorySummaryDto>{
      for (final s in base?.stories ?? const <StorySummaryDto>[]) s.address: s,
      for (final s in localSnap.stories) s.address: s,
    };
    final atlasesByAddr = <String, AtlasSummaryDto>{
      for (final a in base?.atlases ?? const <AtlasSummaryDto>[]) a.address: a,
      for (final a in localSnap.atlases) a.address: a,
    };
    final sightingsByAddr = <String, SightingSummaryDto>{
      for (final s in base?.sightings ?? const <SightingSummaryDto>[])
        s.address: s,
      for (final s in localSnap.sightings) s.address: s,
    };
    final beaconsByAddr = <String, LiveBeaconDto>{
      for (final b in base?.beacons ?? const <LiveBeaconDto>[]) b.address: b,
      for (final b in localSnap.beacons) b.address: b,
    };

    catalog = EarthlyCatalogSnapshot(
      relayUrls: base?.relayUrls ?? localSnap.relayUrls,
      maps: mapsByAddr.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
      stories: storiesByAddr.values.toList()
        ..sort((a, b) => b.publishedAt.compareTo(a.publishedAt)),
      atlases: atlasesByAddr.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
      sightings: sightingsByAddr.values.toList()
        ..sort((a, b) => b.start.compareTo(a.start)),
      beacons: beaconsByAddr.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
    );

    var shelfChanged = false;
    for (var i = 0; i < shelfMaps.length; i++) {
      final updated = mapsByAddr[shelfMaps[i].summary.address];
      if (updated != null &&
          updated.eventId != shelfMaps[i].summary.eventId) {
        shelfMaps[i] =
            entryFromSummary(updated).copyWith(visible: shelfMaps[i].visible);
        shelfChanged = true;
      }
    }
    if (shelfChanged) {
      shelfRevision += 1;
      shelfListenable.notifyListeners();
      mapContentListenable.notifyListeners();
    }
    if (localSnap.sightings.isNotEmpty) {
      sightingsRevision += 1;
      mapContentListenable.notifyListeners();
    }
    if (localSnap.beacons.isNotEmpty) {
      beaconsRevision += 1;
      beaconsListenable.notifyListeners();
      mapContentListenable.notifyListeners();
    }
    notifyListeners();
  }

  String? resolveNaddrTitle(DecodedNaddrDto decoded) {
    final shelf = shelfMaps
        .where((e) => e.summary.address == decoded.address)
        .firstOrNull;
    final storyDs = storyDatasets[decoded.address];
    final entry = shelf ?? storyDs;
    if (entry != null) {
      if (decoded.featureId != null) {
        final match = entry.shapes
            .where((s) => s.featureId == decoded.featureId)
            .firstOrNull;
        if (match?.label != null && match!.label!.isNotEmpty) {
          return match.label;
        }
        return '${entry.summary.title} #${decoded.featureId}';
      }
      return entry.summary.title;
    }
    final catMap =
        catalog?.maps.where((m) => m.address == decoded.address).firstOrNull;
    if (catMap != null) {
      return decoded.featureId != null
          ? '${catMap.title} #${decoded.featureId}'
          : catMap.title;
    }
    final catStory = catalog?.stories
        .where((s) => s.address == decoded.address)
        .firstOrNull;
    if (catStory != null) return catStory.title;
    final catAtlas = catalog?.atlases
        .where((a) => a.address == decoded.address)
        .firstOrNull;
    if (catAtlas != null) return catAtlas.name;
    return null;
  }

  void addLocalSighting(SightingSummaryDto sighting) {
    localSightings.add(sighting);
    _notifySightingsChanged();
  }

  void upsertLocalBeacon(LiveBeaconDto beacon) {
    localBeacons.removeWhere((b) => b.address == beacon.address);
    localBeacons.add(beacon);
    _notifyBeaconsChanged();
  }

  // --- Blossom & Publishing ---

  Future<BlossomUploadDto> uploadBlossomBytes({
    required Uint8List bytes,
    required String mimeType,
    required String purpose,
    required Future<Nip55Account> Function() ensureAccount,
    required Future<String> Function(Nip55Account, String) signUnsignedEvent,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();
    final sha = await computeSha256Hex(bytes: bytes);
    final unsignedAuth = await prepareUnsignedBlossomUploadAuth(
      pubkeyOrNpub: account.pubkey,
      sha256Hex: sha,
      message: purpose,
    );
    final signedAuth = await signUnsignedEvent(account, unsignedAuth);
    return uploadBlobToBlossom(
      serverUrl: blossomServerUrl,
      bytes: bytes,
      mimeType: mimeType,
      signedAuthEventJson: signedAuth,
    );
  }

  Future<PublishOutcomeDto> publishAtlas(
    AtlasPublishRequest req, {
    required String? activeNearbySessionId,
    required Future<Nip55Account> Function() ensureAccount,
    required Future<String> Function(Nip55Account, String) signUnsignedEvent,
    required Future<PublishOutcomeDto> Function(DraftAudienceChoice, String)
        deliverForAudience,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();
    final dTag = (req.existingDTag != null && req.existingDTag!.isNotEmpty)
        ? req.existingDTag!
        : 'atlas-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
    final prepared = await prepareUnsignedAtlasEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: dTag,
      name: req.name,
      description: req.description.isEmpty ? null : req.description,
      image: req.image,
      governance: req.governance,
      pinnedAddresses: req.pinnedAddresses,
      hashtags: req.hashtags,
      fieldSessionId: req.audience == DraftAudienceChoice.nearbyLocalNode
          ? activeNearbySessionId
          : null,
      schemaJson: req.schemaJson,
    );
    final signedEventJson =
        await signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome = await deliverForAudience(req.audience, signedEventJson);
    final created = AtlasSummaryDto(
      address: prepared.address,
      eventId: outcome.eventId,
      pubkey: account.pubkey,
      dTag: prepared.dTag,
      name: req.name,
      description: req.description.isEmpty ? null : req.description,
      image: req.image,
      governance: req.governance,
      pinnedAddresses: req.pinnedAddresses,
      hashtags: req.hashtags,
      schemaJson: req.schemaJson,
      createdAt: BigInt.from(DateTime.now().millisecondsSinceEpoch ~/ 1000),
    );
    deskAtlases.removeWhere((a) => a.address == created.address);
    deskAtlases.insert(0, created);
    if (inspectedAtlas?.address == created.address) {
      inspectedAtlas = created;
    }
    if (activeAtlasLens?.address == created.address) {
      activeAtlasLens = created;
      lensListenable.notifyListeners();
    }
    if (catalog != null) {
      final others = catalog!.atlases
          .where((a) => a.address != created.address)
          .toList(growable: false);
      catalog = EarthlyCatalogSnapshot(
        relayUrls: catalog!.relayUrls,
        maps: catalog!.maps,
        stories: catalog!.stories,
        atlases: [created, ...others],
        sightings: catalog!.sightings,
        beacons: catalog!.beacons,
      );
    }
    notifyListeners();
    return outcome;
  }

  Future<PublishOutcomeDto> publishStory(
    StoryPublishRequest req, {
    required String? activeNearbySessionId,
    required Future<Nip55Account> Function() ensureAccount,
    required Future<String> Function(Nip55Account, String) signUnsignedEvent,
    required Future<PublishOutcomeDto> Function(DraftAudienceChoice, String)
        deliverForAudience,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();
    final dTag = (req.existingDTag != null && req.existingDTag!.isNotEmpty)
        ? req.existingDTag!
        : 'story-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
    final prepared = await prepareUnsignedStoryEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: dTag,
      title: req.title,
      summary: req.summary.isEmpty ? null : req.summary,
      image: req.image,
      markdownContent: req.markdown,
      referencedMapAddresses: req.linkedMapAddresses,
      presentationJson: req.presentationJson,
      hashtags: const ['earthly-story'],
      fieldSessionId: req.audience == DraftAudienceChoice.nearbyLocalNode
          ? activeNearbySessionId
          : null,
    );
    final signedEventJson =
        await signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome = await deliverForAudience(req.audience, signedEventJson);
    final created = StorySummaryDto(
      address: prepared.address,
      eventId: outcome.eventId,
      pubkey: account.pubkey,
      dTag: prepared.dTag,
      title: req.title,
      summary: req.summary.isEmpty ? null : req.summary,
      image: req.image,
      content: req.markdown,
      presentationJson: req.presentationJson,
      referencedAddresses: req.linkedMapAddresses,
      publishedAt: BigInt.from(DateTime.now().millisecondsSinceEpoch ~/ 1000),
    );
    deskStories.removeWhere((s) => s.address == created.address);
    deskStories.insert(0, created);
    notifyListeners();
    return outcome;
  }

  Future<PublishOutcomeDto> deleteOwnedMap(
    MapSummaryDto map, {
    required Future<Nip55Account> Function() ensureAccount,
    required Future<String> Function(Nip55Account, String) signUnsignedEvent,
    required Future<PublishOutcomeDto> Function(DraftAudienceChoice, String)
        deliverForAudience,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();
    final prepared = await prepareUnsignedDeletionEvent(
      pubkeyOrNpub: account.pubkey,
      targetAddress: map.address,
      targetEventId: map.eventId,
      targetKind: 37515,
      reason: 'Deleted map "${map.title}"',
    );
    final signed = await signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome =
        await deliverForAudience(DraftAudienceChoice.publicRelay, signed);
    shelfMaps.removeWhere((e) => e.summary.address == map.address);
    if (catalog != null) {
      catalog = EarthlyCatalogSnapshot(
        relayUrls: catalog!.relayUrls,
        maps: catalog!.maps
            .where((m) => m.address != map.address)
            .toList(growable: false),
        stories: catalog!.stories,
        atlases: catalog!.atlases,
        sightings: catalog!.sightings,
        beacons: catalog!.beacons,
      );
    }
    _notifyShelfChanged();
    return outcome;
  }

  Future<PublishOutcomeDto> deleteOwnedStory(
    StorySummaryDto story, {
    required Future<Nip55Account> Function() ensureAccount,
    required Future<String> Function(Nip55Account, String) signUnsignedEvent,
    required Future<PublishOutcomeDto> Function(DraftAudienceChoice, String)
        deliverForAudience,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();
    final prepared = await prepareUnsignedDeletionEvent(
      pubkeyOrNpub: account.pubkey,
      targetAddress: story.address,
      targetEventId: story.eventId,
      targetKind: 37520,
      reason: 'Deleted story "${story.title}"',
    );
    final signed = await signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome =
        await deliverForAudience(DraftAudienceChoice.publicRelay, signed);
    deskStories.removeWhere((s) => s.address == story.address);
    if (catalog != null) {
      catalog = EarthlyCatalogSnapshot(
        relayUrls: catalog!.relayUrls,
        maps: catalog!.maps,
        stories: catalog!.stories
            .where((s) => s.address != story.address)
            .toList(growable: false),
        atlases: catalog!.atlases,
        sightings: catalog!.sightings,
        beacons: catalog!.beacons,
      );
    }
    closeStory();
    return outcome;
  }

  Future<PublishOutcomeDto> deleteOwnedAtlas(
    AtlasSummaryDto atlas, {
    required Future<Nip55Account> Function() ensureAccount,
    required Future<String> Function(Nip55Account, String) signUnsignedEvent,
    required Future<PublishOutcomeDto> Function(DraftAudienceChoice, String)
        deliverForAudience,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();
    final prepared = await prepareUnsignedDeletionEvent(
      pubkeyOrNpub: account.pubkey,
      targetAddress: atlas.address,
      targetEventId: atlas.eventId,
      targetKind: 37518,
      reason: 'Deleted atlas "${atlas.name}"',
    );
    final signed = await signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome =
        await deliverForAudience(DraftAudienceChoice.publicRelay, signed);
    deskAtlases.removeWhere((a) => a.address == atlas.address);
    if (activeAtlasLens?.address == atlas.address) {
      activeAtlasLens = null;
      lensListenable.notifyListeners();
    }
    if (inspectedAtlas?.address == atlas.address) {
      inspectedAtlas = null;
    }
    if (catalog != null) {
      catalog = EarthlyCatalogSnapshot(
        relayUrls: catalog!.relayUrls,
        maps: catalog!.maps,
        stories: catalog!.stories,
        atlases: catalog!.atlases
            .where((a) => a.address != atlas.address)
            .toList(growable: false),
        sightings: catalog!.sightings,
        beacons: catalog!.beacons,
      );
    }
    notifyListeners();
    return outcome;
  }

  Future<SightingPublishResult> publishSighting(
    SightingPublishRequest req, {
    required String? activeNearbySessionId,
    required Future<Nip55Account> Function() ensureAccount,
    required Future<String> Function(Nip55Account, String) signUnsignedEvent,
    required Future<PublishOutcomeDto> Function(DraftAudienceChoice, String)
        deliverForAudience,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();

    String? imageUrl;
    String? imageMime;
    String? imageSha256;
    if (req.photoBytes != null && req.photoBytes!.isNotEmpty) {
      final mime = req.photoMimeType ?? 'image/jpeg';
      var uploadedPublic = false;
      if (req.audience == DraftAudienceChoice.publicRelay) {
        try {
          final uploaded = await uploadBlossomBytes(
            bytes: req.photoBytes!,
            mimeType: mime,
            purpose: 'Upload Earthly Sighting photo',
            ensureAccount: ensureAccount,
            signUnsignedEvent: signUnsignedEvent,
          );
          imageUrl = uploaded.url;
          imageMime = uploaded.mimeType;
          imageSha256 = uploaded.sha256;
          uploadedPublic = true;
        } catch (_) {}
      }
      if (!uploadedPublic) {
        final dir = await getApplicationSupportDirectory();
        final status = await localNodeStatus();
        if (!status.running) {
          await startLocalNode(dataDir: '${dir.path}/local-node');
        }
        final blob = await ingestLocalBlob(
          bytes: req.photoBytes!,
          mimeType: mime,
        );
        imageUrl = blob.blobUrl;
        imageMime = blob.mimeType;
        imageSha256 = blob.sha256;
      }
    }

    final dTag = 'sighting-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
    final prepared = await prepareUnsignedSightingEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: dTag,
      title: req.title.isEmpty ? null : req.title,
      note: req.note,
      lon: req.lon,
      lat: req.lat,
      durationHours: req.durationHours,
      imageUrl: imageUrl,
      imageMime: imageMime,
      imageSha256: imageSha256,
      hashtags: const ['earthly-field'],
      fieldSessionId: req.audience == DraftAudienceChoice.nearbyLocalNode
          ? activeNearbySessionId
          : null,
    );
    final signedEventJson =
        await signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome = await deliverForAudience(req.audience, signedEventJson);

    final localSighting = SightingSummaryDto(
      address: prepared.address,
      eventId: outcome.eventId,
      pubkey: account.pubkey,
      dTag: prepared.dTag,
      title: req.title.isEmpty ? null : req.title,
      note: req.note,
      lon: req.lon,
      lat: req.lat,
      imageUrl: imageUrl,
      start: prepared.start,
      expiresAt: prepared.expiresAt,
    );
    addLocalSighting(localSighting);
    return SightingPublishResult(outcome: outcome, sighting: localSighting);
  }

  Future<PublishOutcomeDto> applyProposal(
    DiscussionTarget target,
    GeoProposalDto proposal, {
    required Future<Nip55Account> Function() ensureAccount,
    required Future<String> Function(Nip55Account, String) signUnsignedEvent,
    required Future<PublishOutcomeDto> Function(DraftAudienceChoice, String)
        deliverForAudience,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();
    final dTag = target.address.split(':').length >= 3
        ? target.address.split(':').sublist(2).join(':')
        : target.title;

    if (proposal.isStoryProposal || target.kind == 37520) {
      final proposedMd = proposal.proposedMarkdown;
      if (proposedMd == null || proposedMd.trim().isEmpty) {
        throw StateError('Story proposal has no Markdown content');
      }
      final existingStory = activeStory?.address == target.address
          ? activeStory
          : (catalog?.stories
                  .where((s) => s.address == target.address)
                  .firstOrNull ??
              deskStories
                  .where((s) => s.address == target.address)
                  .firstOrNull);
      final preparedStory = await prepareUnsignedStoryEvent(
        pubkeyOrNpub: account.pubkey,
        dTag: existingStory?.dTag ?? dTag,
        title: existingStory?.title ?? target.title,
        summary: existingStory?.summary,
        image: existingStory?.image,
        markdownContent: proposedMd,
        referencedMapAddresses:
            existingStory?.referencedAddresses ?? const <String>[],
        presentationJson: existingStory?.presentationJson,
        hashtags: const ['earthly-story'],
      );
      final signedStory =
          await signUnsignedEvent(account, preparedStory.unsignedEventJson);
      final storyOutcome =
          await deliverForAudience(DraftAudienceChoice.publicRelay, signedStory);

      final updatedStory = StorySummaryDto(
        address: target.address,
        eventId: storyOutcome.eventId,
        pubkey: account.pubkey,
        dTag: existingStory?.dTag ?? dTag,
        title: existingStory?.title ?? target.title,
        summary: existingStory?.summary,
        image: existingStory?.image,
        content: proposedMd,
        presentationJson: existingStory?.presentationJson,
        referencedAddresses:
            existingStory?.referencedAddresses ?? const <String>[],
        publishedAt: BigInt.from(DateTime.now().millisecondsSinceEpoch ~/ 1000),
      );
      if (activeStory?.address == updatedStory.address) {
        activeStory = updatedStory;
        parsedStory = parseStoryDocument(
          markdown: updatedStory.content,
          presentationJson: updatedStory.presentationJson,
        );
        _notifyStoryChanged();
      }
      deskStories.removeWhere((s) => s.address == updatedStory.address);
      deskStories.insert(0, updatedStory);
      if (catalog != null) {
        final others = catalog!.stories
            .where((s) => s.address != updatedStory.address)
            .toList(growable: false);
        catalog = EarthlyCatalogSnapshot(
          relayUrls: catalog!.relayUrls,
          maps: catalog!.maps,
          stories: [updatedStory, ...others],
          atlases: catalog!.atlases,
          sightings: catalog!.sightings,
          beacons: catalog!.beacons,
        );
      }
      notifyListeners();
    } else {
      ExternalGeoBlobDto? externalBlob;
      final rawBytes = Uint8List.fromList(utf8.encode(proposal.geojson));
      if (rawBytes.length > 60 * 1024) {
        final uploaded = await uploadBlossomBytes(
          bytes: rawBytes,
          mimeType: 'application/geo+json',
          purpose: 'Externalize Earthly Map GeoJSON (${target.title})',
          ensureAccount: ensureAccount,
          signUnsignedEvent: signUnsignedEvent,
        );
        externalBlob = ExternalGeoBlobDto(
          url: uploaded.url,
          sha256: uploaded.sha256,
          sizeBytes: uploaded.sizeBytes,
        );
      }
      final preparedMap = await prepareUnsignedMapEvent(
        pubkeyOrNpub: account.pubkey,
        dTag: dTag,
        title: target.title,
        geojson: proposal.geojson,
        hashtags: const ['earthly-native'],
        contextRefs: const <String>[],
        externalBlob: externalBlob,
      );
      final signedMap =
          await signUnsignedEvent(account, preparedMap.unsignedEventJson);
      await deliverForAudience(DraftAudienceChoice.publicRelay, signedMap);
    }

    final preparedStatus = await prepareUnsignedProposalStatusEvent(
      pubkeyOrNpub: account.pubkey,
      proposalAddress: proposal.address,
      proposalEventId: proposal.eventId,
      proposalAuthorPubkey: proposal.pubkey,
      statusKind: 1631,
      note: 'Applied proposal into ${target.title}',
    );
    final signedStatus =
        await signUnsignedEvent(account, preparedStatus.unsignedEventJson);
    return deliverForAudience(DraftAudienceChoice.publicRelay, signedStatus);
  }

  @override
  void dispose() {
    mapContentListenable.dispose();
    shelfListenable.dispose();
    beaconsListenable.dispose();
    lensListenable.dispose();
    overlayListenable.dispose();
    super.dispose();
  }
}
