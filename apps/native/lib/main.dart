import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter/services.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import 'drawing/drawing_model.dart';
import 'drawing/touch_draw_overlay.dart';
import 'nostr/callout_overlay.dart';
import 'nostr/nip55_signer.dart';
import 'nostr/shelf_renderer.dart';
import 'nostr/story_presentation.dart';
import 'runtime/device_bridge.dart';
import 'runtime/rust_bridge.dart';
import 'shell/account_session_sheet.dart';
import 'shell/agent_drawer.dart';
import 'shell/atlas_composer_sheet.dart';
import 'shell/atlas_detail_margin.dart';
import 'shell/basemap_switcher_sheet.dart';
import 'shell/circles_sheet.dart';
import 'shell/dataset_detail_margin.dart';
import 'shell/desk_sheet.dart';
import 'shell/discussion_margin_sheet.dart';
import 'shell/explore_sheet.dart';
import 'shell/feature_inspector_sheet.dart';
import 'shell/inbox_sheet.dart';
import 'shell/person_margin.dart';
import 'shell/place_search_sheet.dart';
import 'shell/sighting_composer_sheet.dart';
import 'shell/spaces_sheet.dart';
import 'shell/story_composer_sheet.dart';
import 'shell/story_reader_margin.dart';
import 'spike/rust_node_sheet.dart';
import 'src/rust/api/agent.dart';
import 'src/rust/api/blossom.dart';
import 'src/rust/api/geo.dart';
import 'src/rust/api/nip46.dart';
import 'src/rust/api/nostr_client.dart';
import 'src/rust/api/private_groups.dart';
import 'src/rust/api/publish.dart';
import 'src/rust/api/settings.dart';
import 'src/rust/api/spike.dart';
import 'theme/earthly_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      systemNavigationBarColor: Colors.transparent,
      systemNavigationBarDividerColor: Colors.transparent,
      systemNavigationBarContrastEnforced: false,
    ),
  );
  runApp(const EarthlyNativeApp());
}

enum _ActiveDrawer {
  none,
  explore,
  desk,
  spaces,
  circles,
  inbox,
  person,
  account,
  search,
  agent,
  storyReader,
  storyComposer,
  atlasComposer,
  atlasDetail,
  datasetDetail,
  inspector,
  discussion,
}

class EarthlyNativeApp extends StatelessWidget {
  const EarthlyNativeApp({this.mapBuilder, super.key});

  /// Optional test hook allowing widget tests to swap out the native MapLibre
  /// texture surface without a GPU/platform runner.
  final Widget Function(
    BuildContext context,
    MapGestures gestures,
    ValueChanged<MapController> onMapCreated,
    VoidCallback onCameraMove,
  )? mapBuilder;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Earthly',
      debugShowCheckedModeBanner: false,
      theme: buildEarthlyTheme(Brightness.light),
      darkTheme: buildEarthlyTheme(Brightness.dark),
      themeMode: ThemeMode.system,
      home: EarthlySpikeHome(mapBuilder: mapBuilder),
    );
  }
}

class EarthlySpikeHome extends StatefulWidget {
  const EarthlySpikeHome({this.mapBuilder, super.key});

  final Widget Function(
    BuildContext context,
    MapGestures gestures,
    ValueChanged<MapController> onMapCreated,
    VoidCallback onCameraMove,
  )? mapBuilder;

  @override
  State<EarthlySpikeHome> createState() => _EarthlySpikeHomeState();
}

class _EarthlySpikeHomeState extends State<EarthlySpikeHome> {
  static const String _openFreeMapLiberty =
      'https://tiles.openfreemap.org/styles/liberty';
  static const String _openFreeMapDark =
      'https://tiles.openfreemap.org/styles/dark';

  MapController? _controller;
  DrawToolMode _mode = DrawToolMode.browse;
  TouchPlacementStyle _placementStyle = TouchPlacementStyle.drawDrag;
  bool _loupeEnabled = true;

  // Unified non-blocking Google-Maps-style drawer (mobile) / left Margin rail (desktop)
  _ActiveDrawer _drawer = _ActiveDrawer.none;
  InspectedFeature? _inspectedFeature;
  DiscussionTarget? _discussionTarget;
  String? _pendingDeepLinkPairing;

  // Map presentation & basemap state
  BasemapKind? _selectedBasemap;
  OfflinePmtilesBasemap? _offlineBasemap;
  final List<SavedOfflinePackDto> _savedOfflinePacks = <SavedOfflinePackDto>[];
  final List<MountedAtlasWorkspaceDto> _mountedAtlasWorkspaces =
      <MountedAtlasWorkspaceDto>[];
  bool _showLabels = true;
  CalloutDisplayMode _calloutMode = CalloutDisplayMode.full;

  // Measure Ruler telemetry (uses DrawToolMode.measure with full Draw-Drag + Loupe!)
  double _measureDistanceMeters = 0.0;
  double _measureAreaM2 = 0.0;

  // Durable working drafts state (multi-draft auto-persisted to SQLite)
  String _activeDraftId = 'active-working-map';
  List<LocalDraftDto> _savedDrafts = <LocalDraftDto>[];
  String _draftDTag = 'field-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
  String _draftTitle = 'Field Map';
  DraftAudienceChoice _draftAudience = DraftAudienceChoice.publicRelay;
  final List<DrawnFeature> _features = <DrawnFeature>[];
  final List<Geographic> _draftVertices = <Geographic>[];
  DrawnFeature? _editingDraftFeature;
  int _featureCounter = 0;

  // Live preview state synced into MapGeometryLayer
  Offset? _previewScreen;
  bool _previewSnapped = false;
  bool _previewLoupeActive = false;

  // Nostr Explore / Shelf (Maps + Stories + Atlases) / Account / Nearby Peer state
  List<String> _relayUrls = <String>['wss://relay.earthly.city'];
  EarthlyCatalogSnapshot? _catalog;
  bool _catalogLoading = false;
  final Map<String, ProfileMetadataDto> _profilesByPubkey =
      <String, ProfileMetadataDto>{};
  final Set<String> _requestedProfilePubkeys = <String>{};
  final List<ShelfMapEntry> _shelfMaps = <ShelfMapEntry>[];
  final List<StorySummaryDto> _deskStories = <StorySummaryDto>[];
  final List<AtlasSummaryDto> _deskAtlases = <AtlasSummaryDto>[];
  final Set<String> _pinnedEntityIds = <String>{};
  final List<String> _recentEntityIds = <String>[];
  AtlasSummaryDto? _activeAtlasLens;
  AtlasSummaryDto? _inspectedAtlas;
  MapSummaryDto? _inspectedMap;
  final List<SightingSummaryDto> _localSightings = <SightingSummaryDto>[];
  final List<LiveBeaconDto> _localBeacons = <LiveBeaconDto>[];
  Nip55Account? _account;
  String? _localNsec;
  String? _bunkerUri;
  String? _bunkerClientNsec;
  String _cordnServerPubkey =
      'fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37';
  String _mlsDatabasePath = '';
  List<CircleWorkspaceDto> _circles = <CircleWorkspaceDto>[];
  List<CirclePendingJoinDto> _circlePendingJoins = <CirclePendingJoinDto>[];
  String? _activeCircleLensId;
  String? _selectedCircleId;
  String? _pendingDeepLinkCircleInvite;
  StorySummaryDto? _editingStory;
  AtlasSummaryDto? _editingAtlas;
  String _blossomServerUrl = 'https://blossom.earthly.city';
  List<InboxItemDto> _inboxItems = <InboxItemDto>[];
  bool _inboxLoading = false;
  int _inboxReadAllBefore = 0;
  final Set<String> _inboxReadIds = <String>{};
  String? _inspectedPersonPubkey;
  String? _hostedSessionId;
  RemotePeerDto? _acceptedRemotePeer;

  // Live public relay WebSocket stream + Nearby / Local-Node background listener state
  StreamSubscription<LiveRelayEventDto>? _relayStreamSub;
  bool _relayStreamLive = false;
  Timer? _liveListenerTimer;
  int _liveTickCount = 0;
  int _pendingClaimCount = 0;
  final Map<String, String> _seenLocalEventIds = <String, String>{};
  bool _initialLocalBaselineCaptured = false;

  // Rust AI Agent Copilot state
  final List<CopilotMessage> _agentMessages = <CopilotMessage>[];
  CopilotProviderSettings _agentSettings = CopilotProviderSettings.offline;
  bool _agentBusy = false;

  // Discussion (Comment 37517 & Proposal 37519) map overlays
  String? _activeCommentOverlayId;
  List<ShelfShape> _commentOverlayShapes = const [];
  String? _activeProposalOverlayId;
  String? _activeProposalLabel;
  List<ShelfShape> _proposalOverlayShapes = const [];

  // Active Story Reader state (live map + associated geometry/callouts/labels)
  StorySummaryDto? _activeStory;
  ParsedStoryDocument? _parsedStory;
  final Map<String, ShelfMapEntry> _storyDatasets = <String, ShelfMapEntry>{};
  final Map<String, DecodedNaddrDto> _storyDecodedRefs =
      <String, DecodedNaddrDto>{};
  bool _loadingStoryMaps = false;
  int? _activeStoryViewIndex;
  String? _focusedStoryDatasetAddress;
  String? _focusedStoryFeatureId;
  final List<GeoPinOverlayItem> _storyGeoPins = <GeoPinOverlayItem>[];

  List<String> get _activeRelayUrls => _relayUrls;

  String? get _activeNearbySessionId =>
      _acceptedRemotePeer?.sessionId ?? _hostedSessionId;

  @override
  void initState() {
    super.initState();
    if (widget.mapBuilder == null) {
      unawaited(_bootstrapPersistentState());
      _liveListenerTimer = Timer.periodic(
        const Duration(seconds: 2),
        (_) => unawaited(_pollLiveNearbyUpdates()),
      );
    }
  }

  Future<void> _bootstrapPersistentState() async {
    DeviceBridge.setDeepLinkHandler(_handleIncomingDeepLink);
    DeviceBridge.setDroppedFileHandler(
      (file) => unawaited(_handleDroppedSpatialOrPmtilesFile(file)),
    );
    final dir = await getApplicationSupportDirectory();
    if (mounted) {
      setState(() => _mlsDatabasePath = '${dir.path}/mls.sqlite3');
    }
    await _restoreAppSettings();
    await _restoreSavedDraft();
    unawaited(_refreshCirclesSnapshot());
    unawaited(_preloadCatalog());
    unawaited(_refreshInbox());
    unawaited(_startLiveRelayStream());
    final initialLink = await DeviceBridge.getInitialDeepLink();
    if (initialLink != null && mounted) {
      _handleIncomingDeepLink(initialLink);
    }
    final initialDropped = await DeviceBridge.getInitialDroppedFile();
    if (initialDropped != null && mounted) {
      unawaited(_handleDroppedSpatialOrPmtilesFile(initialDropped));
    }
  }

  /// Loads the full Earthly entity lists (Maps, Stories, Atlases, Sightings,
  /// Live Beacons) immediately at app launch so Explore is ready right away.
  Future<void> _preloadCatalog() async {
    if (widget.mapBuilder != null || _catalogLoading) return;
    if (mounted) setState(() => _catalogLoading = true);
    try {
      await RustBridge.ensureInitialized();
      final catalog = await fetchEarthlyCatalog(
        relayUrls: _activeRelayUrls,
        limitPerKind: 250,
      );
      if (!mounted) return;
      setState(() => _catalog = catalog);
      unawaited(_resolveCatalogProfiles(catalog));
    } catch (_) {
    } finally {
      if (mounted) setState(() => _catalogLoading = false);
    }
  }

  void _handleIncomingDeepLink(String rawUri) {
    final trimmed = rawUri.trim();
    final lower = trimmed.toLowerCase();
    if (lower.contains('private-invite=') ||
        lower.contains('/circle/') ||
        lower.contains('/privategroup/') ||
        lower.contains('/private-group/')) {
      setState(() {
        _pendingDeepLinkCircleInvite = trimmed;
        _drawer = _ActiveDrawer.circles;
      });
      return;
    }
    if (lower.startsWith('earthly://pair') ||
        lower.contains('earthly-pair-v1:')) {
      setState(() {
        _pendingDeepLinkPairing = trimmed;
        _drawer = _ActiveDrawer.spaces;
      });
      return;
    }
    if (lower.contains('naddr1')) {
      unawaited(
        _jumpToNaddr(trimmed).catchError((Object err) {
          if (!mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Deep link error: $err')),
          );
        }),
      );
      return;
    }
    if (lower.startsWith('geo:')) {
      final cleaned = trimmed.substring(4).split('?').first;
      final parts = cleaned.split(',');
      if (parts.length >= 2) {
        final lat = double.tryParse(parts[0].trim());
        final lon = double.tryParse(parts[1].trim());
        if (lat != null && lon != null) {
          _controller?.animateCamera(
            CameraUpdate.position(
              center: Geographic(lon: lon, lat: lat),
              zoom: 15.0,
            ),
          );
        }
      }
    }
  }

  Future<void> _restoreAppSettings() async {
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final loaded = await loadAppSettings(databasePath: dbPath);
      if (!mounted) return;
      setState(() {
        if (loaded.relayUrls.isNotEmpty) {
          _relayUrls = List<String>.from(loaded.relayUrls);
        }
        if (loaded.localPubkeyHex != null &&
            loaded.localPubkeyHex!.isNotEmpty &&
            loaded.localNsec != null &&
            loaded.localNsec!.isNotEmpty) {
          _account = Nip55Account(pubkey: loaded.localPubkeyHex!);
          _localNsec = loaded.localNsec;
        } else if (loaded.localPubkeyHex != null &&
            loaded.localPubkeyHex!.isNotEmpty &&
            loaded.bunkerUri != null &&
            loaded.bunkerUri!.isNotEmpty &&
            loaded.bunkerClientNsec != null &&
            loaded.bunkerClientNsec!.isNotEmpty) {
          _account = Nip55Account(pubkey: loaded.localPubkeyHex!);
          _bunkerUri = loaded.bunkerUri;
          _bunkerClientNsec = loaded.bunkerClientNsec;
        }
        if (loaded.cordnServerPubkey.length == 64) {
          _cordnServerPubkey = loaded.cordnServerPubkey;
        }
        _agentSettings = CopilotProviderSettings(
          presetName: loaded.agentPreset,
          baseUrl: loaded.agentBaseUrl,
          model: loaded.agentModel,
          apiKey: loaded.agentApiKey,
        );
        _savedOfflinePacks
          ..clear()
          ..addAll(loaded.offlinePacks);
        _mountedAtlasWorkspaces
          ..clear()
          ..addAll(loaded.mountedAtlasWorkspaces);
        _pinnedEntityIds
          ..clear()
          ..addAll(loaded.pinnedEntityIds);
        _recentEntityIds
          ..clear()
          ..addAll(loaded.recentEntityIds);
        if (loaded.blossomServerUrl.trim().isNotEmpty) {
          _blossomServerUrl = loaded.blossomServerUrl.trim();
        }
        _inboxReadAllBefore = loaded.inboxReadAllBefore.toInt();
        _inboxReadIds
          ..clear()
          ..addAll(loaded.inboxReadIds);
      });
    } catch (_) {}
  }

  Future<void> _persistAppSettings() async {
    if (widget.mapBuilder != null) return;
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      await saveAppSettings(
        databasePath: dbPath,
        settings: AppSettingsDto(
          relayUrls: _relayUrls,
          localPubkeyHex: (_localNsec != null || _bunkerUri != null)
              ? _account?.pubkey
              : null,
          localNsec: _localNsec,
          agentPreset: _agentSettings.presetName,
          agentBaseUrl: _agentSettings.baseUrl,
          agentModel: _agentSettings.model,
          agentApiKey: _agentSettings.apiKey,
          offlinePacks: List<SavedOfflinePackDto>.from(_savedOfflinePacks),
          pinnedEntityIds: _pinnedEntityIds.toList(growable: false),
          recentEntityIds: List<String>.from(_recentEntityIds),
          cordnServerPubkey: _cordnServerPubkey,
          bunkerUri: _bunkerUri,
          bunkerClientNsec: _bunkerClientNsec,
          mountedAtlasWorkspaces:
              List<MountedAtlasWorkspaceDto>.from(_mountedAtlasWorkspaces),
          blossomServerUrl: _blossomServerUrl,
          inboxReadAllBefore: BigInt.from(_inboxReadAllBefore),
          inboxReadIds: _inboxReadIds.take(500).toList(growable: false),
        ),
      );
    } catch (_) {}
  }

  void _toggleFavoriteEntity(String entityId) {
    setState(() {
      if (!_pinnedEntityIds.add(entityId)) {
        _pinnedEntityIds.remove(entityId);
      }
    });
    unawaited(_persistAppSettings());
  }

  void _recordRecentEntity(String entityId) {
    setState(() {
      _recentEntityIds.remove(entityId);
      _recentEntityIds.insert(0, entityId);
      if (_recentEntityIds.length > 40) {
        _recentEntityIds.removeRange(40, _recentEntityIds.length);
      }
    });
    unawaited(_persistAppSettings());
  }

  void _updateRelayUrls(List<String> next) {
    setState(() {
      _relayUrls = next;
      _catalog = null;
    });
    unawaited(_persistAppSettings());
    unawaited(_preloadCatalog());
    unawaited(_startLiveRelayStream());
  }

  Future<void> _mountSavedOfflinePack(SavedOfflinePackDto pack) async {
    try {
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
      if (!mounted) return;
      setState(() {
        _offlineBasemap = offline;
        _selectedBasemap = BasemapKind.offlinePmtiles;
      });
      _controller?.animateCamera(
        CameraUpdate.position(
          center: Geographic(lon: pack.centerLon, lat: pack.centerLat),
          zoom: pack.centerZoom.toDouble().clamp(2.0, 18.0),
        ),
      );
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not mount offline pack: $err')),
      );
    }
  }

  Future<void> _handleDroppedSpatialOrPmtilesFile(
    PickedBinaryFile file,
  ) async {
    final lower = file.name.toLowerCase();
    if (lower.endsWith('.pmtiles')) {
      try {
        await RustBridge.ensureInitialized();
        final dir = await getApplicationSupportDirectory();
        await startLocalNode(dataDir: '${dir.path}/local-node');
        final ingested = await ingestLocalPmtiles(
          bytes: file.bytes,
          label: file.name,
        );
        final offline = OfflinePmtilesBasemap(
          snapshot: ingested,
          styleJson: buildPmtilesStyleJson(ingested),
        );
        if (!mounted) return;
        final h = ingested.header;
        setState(() {
          _offlineBasemap = offline;
          _selectedBasemap = BasemapKind.offlinePmtiles;
        });
        _controller?.animateCamera(
          CameraUpdate.position(
            center: Geographic(lon: h.centerLon, lat: h.centerLat),
            zoom: h.centerZoom.toDouble().clamp(2.0, 18.0),
          ),
        );
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Loaded offline PMTiles "${file.name}"')),
        );
      } catch (err) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('PMTiles drop failed: $err')),
        );
      }
      return;
    }
    await _importSpatialPickedFile(file);
  }

  Future<void> _importSpatialPickedFile(PickedBinaryFile picked) async {
    try {
      await RustBridge.ensureInitialized();
      final text = utf8.decode(picked.bytes, allowMalformed: true);
      final converted = await geoImportSpatialFile(
        filename: picked.name,
        content: text,
      );
      final imported = parseDraftFeaturesFromGeoJson(converted.geojson);
      if (imported.isEmpty) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No Point, LineString, or Polygon features found in file'),
          ),
        );
        return;
      }
      setState(() {
        for (final feat in imported) {
          _featureCounter += 1;
          _features.add(
            DrawnFeature(
              id: 'imp-$_featureCounter',
              kind: feat.kind,
              vertices: feat.vertices,
              name: feat.name,
              description: feat.description,
              colorHex: feat.colorHex,
              strokeWidth: feat.strokeWidth,
              fillOpacity: feat.fillOpacity,
              radius: feat.radius,
              callouts: feat.callouts,
            ),
          );
        }
        if (_draftTitle == 'Field Map' && converted.title.isNotEmpty) {
          _draftTitle = converted.title;
        }
      });
      unawaited(_persistWorkingDraft());

      final allVerts = imported.expand((f) => f.vertices).toList();
      if (allVerts.isNotEmpty) {
        double west = allVerts.first.lon;
        double east = allVerts.first.lon;
        double south = allVerts.first.lat;
        double north = allVerts.first.lat;
        for (final v in allVerts) {
          if (v.lon < west) west = v.lon;
          if (v.lon > east) east = v.lon;
          if (v.lat < south) south = v.lat;
          if (v.lat > north) north = v.lat;
        }
        const pad = 0.002;
        _flyToBounds(
          GeoBox(
            west: (west - pad).clamp(-180.0, 180.0),
            south: (south - pad).clamp(-85.0, 85.0),
            east: (east + pad).clamp(-180.0, 180.0),
            north: (north + pad).clamp(-85.0, 85.0),
          ),
        );
      }

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Imported ${imported.length} feature${imported.length == 1 ? '' : 's'} (${converted.format.toUpperCase()}) from ${picked.name}',
          ),
        ),
      );
    } catch (err) {
      if (!mounted || err.toString().contains('cancelled')) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Import failed: $err')),
      );
    }
  }

  Future<void> _importGeoJsonFile() async {
    try {
      final picked = await DeviceBridge.pickGeoJsonFile();
      await _importSpatialPickedFile(picked);
    } catch (err) {
      if (!mounted || err.toString().contains('cancelled')) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Import failed: $err')),
      );
    }
  }

  Future<void> _exportSpatialFile(String format) async {
    if (_features.isEmpty) return;
    try {
      await RustBridge.ensureInitialized();
      final geojson = draftFeaturesToGeoJson(
        title: _draftTitle,
        features: _features,
      );
      final safeName = _draftTitle
          .trim()
          .toLowerCase()
          .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
          .replaceAll(RegExp(r'^-|-$'), '');
      final stem = safeName.isEmpty ? 'earthly-map' : safeName;
      final String content;
      final String filename;
      final String mimeType;
      switch (format) {
        case 'gpx':
          content = await geoExportGpx(geojson: geojson, title: _draftTitle);
          filename = '$stem.gpx';
          mimeType = 'application/gpx+xml';
        case 'kml':
          content = await geoExportKml(geojson: geojson, title: _draftTitle);
          filename = '$stem.kml';
          mimeType = 'application/vnd.google-earth.kml+xml';
        default:
          content = geojson;
          filename = '$stem.geojson';
          mimeType = 'application/geo+json';
      }
      final savedName = await DeviceBridge.saveGeoJsonFile(
        filename: filename,
        content: content,
        mimeType: mimeType,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Exported $savedName')),
      );
    } catch (err) {
      if (!mounted || err.toString().contains('cancelled')) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Export failed: $err')),
      );
    }
  }

  Future<void> _exportGeoJsonFile() => _exportSpatialFile('geojson');

  void _copyGeoJsonToClipboard() {
    if (_features.isEmpty) return;
    final geojson = draftFeaturesToGeoJson(
      title: _draftTitle,
      features: _features,
    );
    Clipboard.setData(ClipboardData(text: geojson));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Copied GeoJSON (${_features.length} features) to clipboard',
        ),
      ),
    );
  }

  void _startEditingDraftFeature(String featureId) {
    final idx = _features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return;
    final target = _features[idx];
    setState(() {
      _editingDraftFeature = target;
      _features.removeAt(idx);
      _draftVertices
        ..clear()
        ..addAll(target.vertices);
      _mode = target.kind;
      _drawer = _ActiveDrawer.none;
    });
  }

  void _cancelEditingDraftFeature() {
    if (_editingDraftFeature == null) {
      setState(() {
        _draftVertices.clear();
        _mode = DrawToolMode.browse;
      });
      return;
    }
    setState(() {
      _features.add(_editingDraftFeature!);
      _editingDraftFeature = null;
      _draftVertices.clear();
      _mode = DrawToolMode.browse;
    });
  }

  Future<void> _resolveCatalogProfiles(EarthlyCatalogSnapshot catalog) async {
    final needed = <String>{};
    for (final m in catalog.maps) {
      needed.add(m.pubkey);
    }
    for (final s in catalog.stories) {
      needed.add(s.pubkey);
    }
    for (final a in catalog.atlases) {
      needed.add(a.pubkey);
    }
    for (final s in catalog.sightings) {
      needed.add(s.pubkey);
    }
    for (final b in catalog.beacons) {
      needed.add(b.pubkey);
    }
    final missing = needed
        .where((pk) => !_requestedProfilePubkeys.contains(pk))
        .toList(growable: false);
    if (missing.isEmpty) return;
    _requestedProfilePubkeys.addAll(missing);
    try {
      await RustBridge.ensureInitialized();
      final profiles = await fetchProfiles(
        relayUrls: _activeRelayUrls,
        pubkeys: missing,
      );
      if (!mounted || profiles.isEmpty) return;
      setState(() {
        for (final p in profiles) {
          _profilesByPubkey[p.pubkey] = p;
        }
      });
    } catch (_) {}
  }

  void _cloneGeoJsonToDraft(String sourceTitle, String geojson) {
    final cloned = parseDraftFeaturesFromGeoJson(geojson);
    if (cloned.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No editable features found to clone')),
      );
      return;
    }
    setState(() {
      _features
        ..clear()
        ..addAll(cloned);
      _draftVertices.clear();
      _featureCounter = _features.length;
      _draftTitle = '$sourceTitle (Draft)';
      _drawer = _ActiveDrawer.desk;
    });
    unawaited(_persistWorkingDraft());
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Cloned ${cloned.length} feature${cloned.length == 1 ? '' : 's'} into Working Draft',
        ),
      ),
    );
  }

  Future<PublishOutcomeDto> _publishAtlas(AtlasPublishRequest req) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
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
          ? _activeNearbySessionId
          : null,
    );
    final signedEventJson =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome = await _deliverForAudience(req.audience, signedEventJson);
    if (mounted) {
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
        createdAt: BigInt.from(DateTime.now().millisecondsSinceEpoch ~/ 1000),
      );
      setState(() {
        _deskAtlases.removeWhere((a) => a.address == created.address);
        _deskAtlases.insert(0, created);
      });
    }
    return outcome;
  }

  Future<PublishOutcomeDto> _publishProfile(ProfileEditRequest req) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final prepared = await prepareUnsignedProfileEvent(
      pubkeyOrNpub: account.pubkey,
      name: req.name.isEmpty ? null : req.name,
      displayName: req.displayName.isEmpty ? null : req.displayName,
      about: req.about.isEmpty ? null : req.about,
      picture: req.picture.isEmpty ? null : req.picture,
      nip05: req.nip05.isEmpty ? null : req.nip05,
    );
    final signedEventJson =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final dbPath = await _databasePath();
    final outcome = await publishSignedEventViaOutbox(
      databasePath: dbPath,
      signedEventJson: signedEventJson,
      relayUrls: _activeRelayUrls,
    );
    if (mounted) {
      setState(() {
        _profilesByPubkey[account.pubkey] = ProfileMetadataDto(
          pubkey: account.pubkey,
          name: req.name.isEmpty ? null : req.name,
          displayName: req.displayName.isEmpty ? null : req.displayName,
          about: req.about.isEmpty ? null : req.about,
          picture: req.picture.isEmpty ? null : req.picture,
          nip05: req.nip05.isEmpty ? null : req.nip05,
        );
      });
    }
    return outcome;
  }

  Future<PublishOutcomeDto> _applyProposal(
    DiscussionTarget target,
    GeoProposalDto proposal,
  ) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final dTag = target.address.split(':').length >= 3
        ? target.address.split(':').sublist(2).join(':')
        : target.title;
    // 1. Republish the updated kind-37515 map with the proposed FeatureCollection.
    final preparedMap = await prepareUnsignedMapEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: dTag,
      title: target.title,
      geojson: proposal.geojson,
      hashtags: const ['earthly-native'],
      contextRefs: const <String>[],
    );
    final signedMap =
        await _signUnsignedEvent(account, preparedMap.unsignedEventJson);
    await _deliverForAudience(DraftAudienceChoice.publicRelay, signedMap);

    // 2. Publish NIP-34 kind-1631 Applied status referencing the proposal.
    final preparedStatus = await prepareUnsignedProposalStatusEvent(
      pubkeyOrNpub: account.pubkey,
      proposalAddress: proposal.address,
      proposalEventId: proposal.eventId,
      proposalAuthorPubkey: proposal.pubkey,
      statusKind: 1631,
      note: 'Applied proposal into ${target.title}',
    );
    final signedStatus =
        await _signUnsignedEvent(account, preparedStatus.unsignedEventJson);
    return _deliverForAudience(DraftAudienceChoice.publicRelay, signedStatus);
  }

  Future<PublishOutcomeDto> _closeProposal(
    DiscussionTarget target,
    GeoProposalDto proposal,
  ) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final preparedStatus = await prepareUnsignedProposalStatusEvent(
      pubkeyOrNpub: account.pubkey,
      proposalAddress: proposal.address,
      proposalEventId: proposal.eventId,
      proposalAuthorPubkey: proposal.pubkey,
      statusKind: 1632,
      note: 'Closed proposal',
    );
    final signedStatus =
        await _signUnsignedEvent(account, preparedStatus.unsignedEventJson);
    return _deliverForAudience(DraftAudienceChoice.publicRelay, signedStatus);
  }

  void _jumpToPlace(PlaceSearchResultDto place) {
    final controller = _controller;
    if (controller == null) return;
    if (place.west != null &&
        place.south != null &&
        place.east != null &&
        place.north != null &&
        (place.east! - place.west!).abs() > 1e-4) {
      _flyToBounds(
        GeoBox(
          west: place.west!,
          south: place.south!,
          east: place.east!,
          north: place.north!,
        ),
      );
      return;
    }
    controller.animateCamera(
      CameraUpdate.position(
        center: Geographic(lon: place.lon, lat: place.lat),
        zoom: 14.5,
      ),
    );
  }

  Future<void> _jumpToNaddr(String naddrUri) async {
    await RustBridge.ensureInitialized();
    final decoded = await decodeNaddrCoordinate(naddrUri: naddrUri);
    if (decoded == null) {
      throw StateError('Could not decode Nostr naddr link');
    }
    final relays = <String>{
      ..._activeRelayUrls,
      ...decoded.relays.where((r) => r.startsWith('wss://')),
    }.toList(growable: false);
    final fetched = await fetchEntityByAddress(
      relayUrls: relays,
      address: decoded.address,
    );
    if (fetched == null) {
      throw StateError(
        'Entity ${decoded.dTag} (kind ${decoded.kind}) not found on configured relays',
      );
    }
    if (fetched.map != null) {
      final map = fetched.map!;
      if (!_shelfMaps.any((e) => e.summary.address == map.address)) {
        setState(() => _shelfMaps.add(_entryFromSummary(map)));
      }
      _flyToMap(map);
      return;
    }
    if (fetched.story != null) {
      await _openStory(fetched.story!);
      return;
    }
    if (fetched.atlas != null) {
      await _openAtlas(fetched.atlas!);
      return;
    }
    if (fetched.sighting != null) {
      _focusSighting(fetched.sighting!);
      return;
    }
    throw StateError('Unsupported naddr kind ${decoded.kind}');
  }

  Future<void> _recomputeMeasureTelemetry() async {
    if (_mode != DrawToolMode.measure) return;
    if (_draftVertices.length < 2) {
      if (mounted) {
        setState(() {
          _measureDistanceMeters = 0.0;
          _measureAreaM2 = 0.0;
        });
      }
      return;
    }
    try {
      await RustBridge.ensureInitialized();
      final pts = _draftVertices
          .map((p) => LonLatPoint(lon: p.lon, lat: p.lat))
          .toList(growable: false);
      final dist = await geoMeasureLineMeters(points: pts);
      final area = _draftVertices.length >= 3
          ? await geoMeasurePolygonAreaM2(ring: pts)
          : 0.0;
      if (!mounted || _mode != DrawToolMode.measure) return;
      setState(() {
        _measureDistanceMeters = dist;
        _measureAreaM2 = area;
      });
    } catch (_) {}
  }

  void _toggleMeasureMode() {
    setState(() {
      if (_mode == DrawToolMode.measure) {
        _mode = DrawToolMode.browse;
        _draftVertices.clear();
        _measureDistanceMeters = 0.0;
        _measureAreaM2 = 0.0;
      } else {
        _draftVertices.clear();
        _measureDistanceMeters = 0.0;
        _measureAreaM2 = 0.0;
        _drawer = _ActiveDrawer.none;
        _mode = DrawToolMode.measure;
      }
    });
  }

  String? get _activeSessionSummaryText {
    if (_acceptedRemotePeer != null) {
      return 'Paired to ${_acceptedRemotePeer!.sessionName ?? _acceptedRemotePeer!.relayUrl}';
    }
    if (_hostedSessionId != null) {
      return 'Hosting Field Session ($_hostedSessionId)';
    }
    return null;
  }

  String get _accountChipLabel {
    final acct = _account;
    if (acct == null) return 'Sign in';
    final p = _profilesByPubkey[acct.pubkey];
    final name = p?.displayName ?? p?.name;
    if (name != null && name.isNotEmpty) {
      return name.length > 12 ? '${name.substring(0, 12)}…' : name;
    }
    return acct.shortLabel.substring(0, 8);
  }

  @override
  void dispose() {
    unawaited(_relayStreamSub?.cancel());
    _liveListenerTimer?.cancel();
    super.dispose();
  }

  /// Opens a persistent Rust `nostr-sdk` WebSocket subscription (`StreamSink`)
  /// to `wss://relay.earthly.city` so new Maps, Stories, Atlases, Sightings,
  /// and Live Beacons appear live on the map without manual refresh.
  Future<void> _startLiveRelayStream() async {
    try {
      await RustBridge.ensureInitialized();
      if (!mounted) return;
      await _relayStreamSub?.cancel();
      final stream = subscribeEarthlyRelayStream(relayUrls: _activeRelayUrls);
      if (mounted) setState(() => _relayStreamLive = true);
      _relayStreamSub = stream.listen(
        _handleLiveRelayEvent,
        onError: (_) {
          if (mounted) setState(() => _relayStreamLive = false);
        },
        onDone: () {
          if (mounted) setState(() => _relayStreamLive = false);
        },
      );
    } catch (_) {
      if (mounted) setState(() => _relayStreamLive = false);
    }
  }

  void _handleLiveRelayEvent(LiveRelayEventDto event) {
    if (!mounted) return;
    setState(() {
      final base = _catalog;
      final mapsByAddr = <String, MapSummaryDto>{
        for (final m in base?.maps ?? const <MapSummaryDto>[]) m.address: m,
      };
      final storiesByAddr = <String, StorySummaryDto>{
        for (final s in base?.stories ?? const <StorySummaryDto>[])
          s.address: s,
      };
      final atlasesByAddr = <String, AtlasSummaryDto>{
        for (final a in base?.atlases ?? const <AtlasSummaryDto>[])
          a.address: a,
      };
      final sightingsByAddr = <String, SightingSummaryDto>{
        for (final s in base?.sightings ?? const <SightingSummaryDto>[])
          s.address: s,
      };
      final beaconsByAddr = <String, LiveBeaconDto>{
        for (final b in base?.beacons ?? const <LiveBeaconDto>[]) b.address: b,
      };

      if (event.map != null) {
        final m = event.map!;
        mapsByAddr[m.address] = m;
        for (var i = 0; i < _shelfMaps.length; i++) {
          if (_shelfMaps[i].summary.address == m.address &&
              _shelfMaps[i].summary.eventId != m.eventId) {
            _shelfMaps[i] = _entryFromSummary(m)
                .copyWith(visible: _shelfMaps[i].visible);
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

      final mergedMaps = mapsByAddr.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      final mergedStories = storiesByAddr.values.toList()
        ..sort((a, b) => b.publishedAt.compareTo(a.publishedAt));
      final mergedAtlases = atlasesByAddr.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      final mergedSightings = sightingsByAddr.values.toList()
        ..sort((a, b) => b.start.compareTo(a.start));
      final mergedBeacons = beaconsByAddr.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

      _catalog = EarthlyCatalogSnapshot(
        relayUrls: base?.relayUrls ?? _activeRelayUrls,
        maps: mergedMaps,
        stories: mergedStories,
        atlases: mergedAtlases,
        sightings: mergedSightings,
        beacons: mergedBeacons,
      );
    });

    if (event.beacon != null) {
      final b = event.beacon!;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Live Beacon: ${b.status?.isNotEmpty == true ? b.status : b.dTag}',
          ),
          action: SnackBarAction(
            label: 'Locate',
            onPressed: () => _focusBeacon(b),
          ),
        ),
      );
    }
  }

  /// Actively listens for incoming Nearby Field Session data (both local host
  /// LMDB writes from paired peers AND periodic NIP-42 sync pulls from approved
  /// remote hosts), updating Shelf maps, Sightings, Explore, and Spaces badges
  /// in real time without manual refresh!
  Future<void> _pollLiveNearbyUpdates() async {
    if (!mounted) return;
    _liveTickCount += 1;
    try {
      await RustBridge.ensureInitialized();
      final status = await localNodeStatus();
      if (!status.running) return;

      final peers = await nearbyPeersStatus();
      final pendingCount = peers.pendingClaims.length;
      if (mounted && pendingCount != _pendingClaimCount) {
        setState(() => _pendingClaimCount = pendingCount);
      }

      // Every 4s on joined peer devices, pull newly published events from approved hosts.
      if (_liveTickCount % 2 == 0) {
        for (final remote in peers.remotePeers) {
          if (remote.status == 'accepted') {
            try {
              await syncNearbyPeer(nodeId: remote.nodeId);
            } catch (_) {}
          }
        }
      }

      // Fast (~1 ms) LMDB scan for newly arrived or updated Nearby entities.
      final localSnap = await fetchLocalNodeCatalog();
      if (!mounted) return;

      final newlyArrivedMaps = <MapSummaryDto>[];
      var anyChange = false;

      for (final m in localSnap.maps) {
        final prevId = _seenLocalEventIds[m.address];
        if (prevId != m.eventId) {
          _seenLocalEventIds[m.address] = m.eventId;
          anyChange = true;
          if (_initialLocalBaselineCaptured) {
            newlyArrivedMaps.add(m);
          }
        }
      }
      for (final s in localSnap.sightings) {
        if (_seenLocalEventIds[s.address] != s.eventId) {
          _seenLocalEventIds[s.address] = s.eventId;
          anyChange = true;
        }
      }
      for (final st in localSnap.stories) {
        if (_seenLocalEventIds[st.address] != st.eventId) {
          _seenLocalEventIds[st.address] = st.eventId;
          anyChange = true;
        }
      }
      for (final b in localSnap.beacons) {
        if (_seenLocalEventIds[b.address] != b.eventId) {
          _seenLocalEventIds[b.address] = b.eventId;
          anyChange = true;
        }
      }
      _initialLocalBaselineCaptured = true;

      if (!anyChange) return;

      setState(() {
        // Merge local/Nearby items into active catalog snapshot live.
        final base = _catalog;
        final mapsByAddr = <String, MapSummaryDto>{
          for (final m in base?.maps ?? const <MapSummaryDto>[]) m.address: m,
          for (final m in localSnap.maps) m.address: m,
        };
        final storiesByAddr = <String, StorySummaryDto>{
          for (final s in base?.stories ?? const <StorySummaryDto>[])
            s.address: s,
          for (final s in localSnap.stories) s.address: s,
        };
        final atlasesByAddr = <String, AtlasSummaryDto>{
          for (final a in base?.atlases ?? const <AtlasSummaryDto>[])
            a.address: a,
          for (final a in localSnap.atlases) a.address: a,
        };
        final sightingsByAddr = <String, SightingSummaryDto>{
          for (final s in base?.sightings ?? const <SightingSummaryDto>[])
            s.address: s,
          for (final s in localSnap.sightings) s.address: s,
        };
        final beaconsByAddr = <String, LiveBeaconDto>{
          for (final b in base?.beacons ?? const <LiveBeaconDto>[])
            b.address: b,
          for (final b in localSnap.beacons) b.address: b,
        };

        final mergedMaps = mapsByAddr.values.toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
        final mergedStories = storiesByAddr.values.toList()
          ..sort((a, b) => b.publishedAt.compareTo(a.publishedAt));
        final mergedAtlases = atlasesByAddr.values.toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
        final mergedSightings = sightingsByAddr.values.toList()
          ..sort((a, b) => b.start.compareTo(a.start));
        final mergedBeacons = beaconsByAddr.values.toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

        _catalog = EarthlyCatalogSnapshot(
          relayUrls: base?.relayUrls ?? localSnap.relayUrls,
          maps: mergedMaps,
          stories: mergedStories,
          atlases: mergedAtlases,
          sightings: mergedSightings,
          beacons: mergedBeacons,
        );

        // Live-refresh any Map already mounted on the Shelf!
        for (var i = 0; i < _shelfMaps.length; i++) {
          final updated = mapsByAddr[_shelfMaps[i].summary.address];
          if (updated != null &&
              updated.eventId != _shelfMaps[i].summary.eventId) {
            _shelfMaps[i] = _entryFromSummary(updated)
                .copyWith(visible: _shelfMaps[i].visible);
          }
        }
      });

      // Notify user with a 1-tap Show button when a brand-new Nearby map arrives!
      if (newlyArrivedMaps.isNotEmpty && mounted) {
        final latest = newlyArrivedMaps.first;
        final alreadyOnShelf =
            _shelfMaps.any((e) => e.summary.address == latest.address);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              alreadyOnShelf
                  ? 'Live update: "${latest.title}" refreshed on map'
                  : 'New Nearby Map received: "${latest.title}"',
            ),
            action: alreadyOnShelf
                ? null
                : SnackBarAction(
                    label: 'Show',
                    onPressed: () => _toggleMapOnShelf(latest),
                  ),
          ),
        );
      }
    } catch (_) {}
  }

  Future<void> _sendAgentPrompt(String prompt) async {
    setState(() {
      _agentMessages.add(CopilotMessage(role: 'user', content: prompt));
      _agentBusy = true;
    });
    try {
      await RustBridge.ensureInitialized();
      final cam = _controller?.camera;
      final center =
          cam?.center ?? const Geographic(lon: 16.3738, lat: 48.2082);
      final draftGeojson = draftFeaturesToGeoJson(
        title: _draftTitle,
        features: _features,
      );
      final history = _agentMessages
          .take(_agentMessages.length - 1)
          .map((m) => AgentMessageDto(role: m.role, content: m.content))
          .toList(growable: false);

      final result = await runEarthlyAgentTurn(
        prompt: prompt,
        history: history,
        providerBaseUrl: _agentSettings.baseUrl,
        model: _agentSettings.model,
        apiKey: _agentSettings.apiKey.isEmpty ? null : _agentSettings.apiKey,
        centerLon: center.lon,
        centerLat: center.lat,
        zoom: cam?.zoom ?? 13.5,
        draftTitle: _draftTitle,
        draftGeojson: draftGeojson,
        shelfMapTitles: _shelfMaps.map((e) => e.summary.title).toList(),
        atlasWorkspaces:
            _mountedAtlasWorkspaces.map((w) => w.coverageSummary).toList(),
      );

      if (!mounted) return;
      setState(() {
        if (result.updatedDraftGeojson != null) {
          final parsed =
              parseDraftFeaturesFromGeoJson(result.updatedDraftGeojson!);
          _features
            ..clear()
            ..addAll(parsed);
          _featureCounter = _features.length;
        }
        _agentMessages.add(
          CopilotMessage(
            role: 'assistant',
            content: result.reply,
            toolCalls: result.toolCalls,
          ),
        );
      });
      if (result.updatedDraftGeojson != null) {
        unawaited(_persistWorkingDraft());
      }
      if (result.cameraAction != null) {
        final ca = result.cameraAction!;
        _controller?.animateCamera(
          CameraUpdate.position(
            center: Geographic(lon: ca.lon, lat: ca.lat),
            zoom: ca.zoom,
          ),
        );
      }
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _agentMessages.add(
          CopilotMessage(
            role: 'assistant',
            content: err.toString(),
            isError: true,
          ),
        );
      });
    } finally {
      if (mounted) setState(() => _agentBusy = false);
    }
  }

  Future<String> _databasePath() async {
    final dir = await getApplicationSupportDirectory();
    return '${dir.path}/earthly.sqlite3';
  }

  Future<void> _refreshSavedDrafts() async {
    if (widget.mapBuilder != null) return;
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final all = await listLocalDrafts(databasePath: dbPath);
      if (mounted) setState(() => _savedDrafts = all);
    } catch (_) {}
  }

  Future<void> _restoreSavedDraft() async {
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final all = await listLocalDrafts(databasePath: dbPath);
      final saved = await loadLocalDraft(
        databasePath: dbPath,
        draftId: _activeDraftId,
      );
      if (!mounted) return;
      setState(() => _savedDrafts = all);
      final target = saved ?? (all.isNotEmpty ? all.first : null);
      if (target == null) return;
      final restored = parseDraftFeaturesFromGeoJson(target.geojson);
      setState(() {
        _activeDraftId = target.draftId;
        _draftDTag = target.dTag;
        _draftTitle = target.title;
        _draftAudience = target.audienceChannel == 'nearby'
            ? DraftAudienceChoice.nearbyLocalNode
            : DraftAudienceChoice.publicRelay;
        _features
          ..clear()
          ..addAll(restored);
        _featureCounter = restored.length;
      });
    } catch (_) {}
  }

  void _selectSavedDraft(LocalDraftDto draft) {
    final restored = parseDraftFeaturesFromGeoJson(draft.geojson);
    setState(() {
      _activeDraftId = draft.draftId;
      _draftDTag = draft.dTag;
      _draftTitle = draft.title;
      _draftAudience = draft.audienceChannel == 'nearby'
          ? DraftAudienceChoice.nearbyLocalNode
          : DraftAudienceChoice.publicRelay;
      _features
        ..clear()
        ..addAll(restored);
      _draftVertices.clear();
      _editingDraftFeature = null;
      _featureCounter = restored.length;
    });
  }

  void _createNewDraft() {
    final nowSec = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    setState(() {
      _activeDraftId = 'draft-$nowSec';
      _draftDTag = 'field-$nowSec';
      _draftTitle = 'Field Map ${_savedDrafts.length + 1}';
      _features.clear();
      _draftVertices.clear();
      _editingDraftFeature = null;
      _featureCounter = 0;
    });
    unawaited(_persistWorkingDraft());
  }

  Future<void> _deleteSavedDraft(String draftId) async {
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      await deleteLocalDraft(databasePath: dbPath, draftId: draftId);
      final remaining = await listLocalDrafts(databasePath: dbPath);
      if (!mounted) return;
      setState(() => _savedDrafts = remaining);
      if (_activeDraftId == draftId) {
        if (remaining.isNotEmpty) {
          _selectSavedDraft(remaining.first);
        } else {
          _createNewDraft();
        }
      }
    } catch (_) {}
  }

  Future<void> _persistWorkingDraft() async {
    if (widget.mapBuilder != null) return;
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final geojson = draftFeaturesToGeoJson(
        title: _draftTitle,
        features: _features,
      );
      await saveLocalDraft(
        databasePath: dbPath,
        draftId: _activeDraftId,
        dTag: _draftDTag,
        title: _draftTitle,
        audienceChannel: _draftAudience == DraftAudienceChoice.nearbyLocalNode
            ? 'nearby'
            : 'public',
        geojson: geojson,
      );
      await _refreshSavedDrafts();
    } catch (_) {}
  }

  /// Ensures an active signer identity (Android Amber NIP-55 OR Desktop local
  /// keypair) and returns `(pubkey, signedEventJson)` for any unsigned event.
  Future<Nip55Account> _ensureAccount() async {
    if (_account != null) return _account!;
    if (Platform.isAndroid && await Nip55Signer.isSignerInstalled()) {
      final acct = await Nip55Signer.getPublicKey();
      if (mounted) setState(() => _account = acct);
      return acct;
    }
    // Desktop / non-Amber host: auto-generate an ephemeral local Nostr keypair.
    await RustBridge.ensureInitialized();
    final kp = await generateLocalNostrKeypair();
    final acct = Nip55Account(pubkey: kp.pubkeyHex);
    if (mounted) {
      setState(() {
        _account = acct;
        _localNsec = kp.nsec;
      });
      unawaited(_persistAppSettings());
    }
    return acct;
  }

  Future<String> _signUnsignedEvent(
    Nip55Account account,
    String unsignedEventJson,
  ) async {
    if (_bunkerUri != null &&
        _bunkerUri!.isNotEmpty &&
        _bunkerClientNsec != null &&
        _bunkerClientNsec!.isNotEmpty) {
      await RustBridge.ensureInitialized();
      return signEventWithNip46Bunker(
        bunkerUri: _bunkerUri!,
        clientNsec: _bunkerClientNsec!,
        unsignedEventJson: unsignedEventJson,
      );
    }
    if (_localNsec != null && _localNsec!.isNotEmpty) {
      await RustBridge.ensureInitialized();
      return signEventWithNsec(
        nsecOrHex: _localNsec!,
        unsignedEventJson: unsignedEventJson,
      );
    }
    final signed = await Nip55Signer.signEvent(
      eventJson: unsignedEventJson,
      currentUser: account.pubkey,
      signerPackage: account.signerPackage,
    );
    final json = signed.signedEventJson;
    if (json == null || json.isEmpty) {
      throw StateError('Signer did not return a full signed event JSON');
    }
    return json;
  }

  Future<PublishOutcomeDto> _deliverForAudience(
    DraftAudienceChoice audience,
    String signedEventJson,
  ) async {
    final dbPath = await _databasePath();
    if (audience == DraftAudienceChoice.nearbyLocalNode) {
      final dir = await getApplicationSupportDirectory();
      final existing = await localNodeStatus();
      if (!existing.running) {
        await startLocalNode(dataDir: '${dir.path}/local-node');
      }
      return publishNearbyEventViaOutbox(
        databasePath: dbPath,
        signedEventJson: signedEventJson,
        remoteNodeIds: _acceptedRemotePeer != null
            ? <String>[_acceptedRemotePeer!.nodeId]
            : const <String>[],
      );
    }
    return publishSignedEventViaOutbox(
      databasePath: dbPath,
      signedEventJson: signedEventJson,
      relayUrls: _activeRelayUrls,
    );
  }

  bool get _isDrawingMode => _mode != DrawToolMode.browse;
  bool get _isMeasureMode => _mode == DrawToolMode.measure;
  bool get _canFinishDraft => switch (_mode) {
        DrawToolMode.line => _draftVertices.length >= 2,
        DrawToolMode.polygon => _draftVertices.length >= 3,
        _ => false,
      };

  List<SightingSummaryDto> get _allSightings {
    final byAddr = <String, SightingSummaryDto>{};
    for (final s in _catalog?.sightings ?? const <SightingSummaryDto>[]) {
      byAddr[s.address] = s;
    }
    for (final s in _localSightings) {
      byAddr[s.address] = s;
    }
    return byAddr.values.toList(growable: false);
  }

  List<LiveBeaconDto> get _allBeacons {
    final nowSec = BigInt.from(DateTime.now().millisecondsSinceEpoch ~/ 1000);
    final byAddr = <String, LiveBeaconDto>{};
    for (final b in _catalog?.beacons ?? const <LiveBeaconDto>[]) {
      if (b.expiresAt == null || b.expiresAt! > nowSec) {
        byAddr[b.address] = b;
      }
    }
    for (final b in _localBeacons) {
      if (b.expiresAt == null || b.expiresAt! > nowSec) {
        byAddr[b.address] = b;
      }
    }
    return byAddr.values.toList(growable: false);
  }

  void _focusBeacon(LiveBeaconDto beacon) {
    _controller?.animateCamera(
      CameraUpdate.position(
        center: Geographic(lon: beacon.lon, lat: beacon.lat),
        zoom: 15.5,
      ),
    );
  }

  Future<PublishOutcomeDto> _broadcastLiveBeacon(
    String status,
    int durationMinutes,
    bool nearby,
  ) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();

    Geographic loc = _controller?.camera?.center ??
        const Geographic(lon: 16.3738, lat: 48.2082);
    if (Platform.isAndroid) {
      try {
        final gps = await DeviceBridge.getCurrentLocation();
        loc = Geographic(lon: gps.lon, lat: gps.lat);
      } catch (_) {}
    }

    final prepared = await prepareUnsignedBeaconEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: 'live-beacon',
      lon: loc.lon,
      lat: loc.lat,
      status: status.isEmpty ? null : status,
      durationMinutes: durationMinutes,
      fieldSessionId: nearby ? _activeNearbySessionId : null,
    );
    final signedJson =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome = await _deliverForAudience(
      nearby
          ? DraftAudienceChoice.nearbyLocalNode
          : DraftAudienceChoice.publicRelay,
      signedJson,
    );

    final liveDto = LiveBeaconDto(
      address: prepared.address,
      eventId: outcome.eventId,
      pubkey: account.pubkey,
      dTag: prepared.dTag,
      lon: loc.lon,
      lat: loc.lat,
      status: status.isEmpty ? 'Live here' : status,
      expiresAt: prepared.expiresAt,
      createdAt: prepared.start,
    );
    if (mounted) {
      setState(() {
        _localBeacons.removeWhere((b) => b.address == liveDto.address);
        _localBeacons.add(liveDto);
      });
      _focusBeacon(liveDto);
    }
    return outcome;
  }

  MapGestures get _activeMapGestures {
    if (_isDrawingMode && _placementStyle == TouchPlacementStyle.drawDrag) {
      return const MapGestures(
        drag: false,
        fling: false,
        pinch: true,
        scrollWheel: true,
        doubleTap: false,
        doubleTapDrag: false,
        twoFingerDrag: true,
      );
    }
    return const MapGestures();
  }

  void _selectMode(DrawToolMode next) {
    setState(() {
      if (_mode == next) {
        _mode = DrawToolMode.browse;
      } else {
        _draftVertices.clear();
        _drawer = _ActiveDrawer.none;
        _mode = next;
      }
    });
  }

  void _commitVertex(Geographic point) {
    setState(() {
      if (_mode == DrawToolMode.point) {
        if (_editingDraftFeature != null) {
          _features.add(
            _editingDraftFeature!.copyWith(vertices: <Geographic>[point]),
          );
          _editingDraftFeature = null;
          _draftVertices.clear();
          _mode = DrawToolMode.browse;
        } else {
          _featureCounter += 1;
          _features.add(
            DrawnFeature(
              id: 'pt-$_featureCounter',
              kind: DrawToolMode.point,
              vertices: <Geographic>[point],
            ),
          );
        }
      } else if (_mode == DrawToolMode.line ||
          _mode == DrawToolMode.polygon ||
          _mode == DrawToolMode.measure) {
        _draftVertices.add(point);
      }
    });
    if (_mode == DrawToolMode.measure) {
      unawaited(_recomputeMeasureTelemetry());
    } else if (_mode == DrawToolMode.point || _mode == DrawToolMode.browse) {
      unawaited(_persistWorkingDraft());
    }
  }

  void _dropCrosshairPoint() {
    final center = _controller?.camera?.center;
    if (center == null) return;
    HapticFeedback.mediumImpact();
    _commitVertex(center);
  }

  void _finishDraft() {
    if (!_canFinishDraft) return;
    HapticFeedback.mediumImpact();
    setState(() {
      if (_editingDraftFeature != null) {
        _features.add(
          _editingDraftFeature!.copyWith(
            vertices: List<Geographic>.unmodifiable(_draftVertices),
          ),
        );
        _editingDraftFeature = null;
        _draftVertices.clear();
        _mode = DrawToolMode.browse;
      } else {
        _featureCounter += 1;
        _features.add(
          DrawnFeature(
            id: 'feat-$_featureCounter',
            kind: _mode,
            vertices: List<Geographic>.unmodifiable(_draftVertices),
          ),
        );
        _draftVertices.clear();
      }
    });
    unawaited(_persistWorkingDraft());
  }

  void _undoLastPoint() {
    if (_draftVertices.isNotEmpty) {
      setState(() => _draftVertices.removeLast());
      if (_mode == DrawToolMode.measure) {
        unawaited(_recomputeMeasureTelemetry());
      }
    } else if (_mode != DrawToolMode.measure && _features.isNotEmpty) {
      setState(() => _features.removeLast());
      unawaited(_persistWorkingDraft());
    }
  }

  ShelfMapEntry _entryFromSummary(MapSummaryDto map) => ShelfMapEntry(
        summary: map,
        visible: true,
        shapes: parseGeoJsonShapes(
          map.geojson,
          datasetTitle: map.title,
          datasetAddress: map.address,
        ),
      );

  void _toggleMapOnShelf(MapSummaryDto map) {
    final idx = _shelfMaps.indexWhere((e) => e.summary.address == map.address);
    if (idx >= 0) {
      setState(() => _shelfMaps.removeAt(idx));
      return;
    }
    setState(() => _shelfMaps.add(_entryFromSummary(map)));
    _recordRecentEntity('map:${map.address}');
    _flyToMap(map);
  }

  void _addMapsBulkToShelf(List<MapSummaryDto> maps) {
    if (maps.isEmpty) return;
    final added = <ShelfMapEntry>[];
    setState(() {
      for (final m in maps) {
        if (_shelfMaps.any((e) => e.summary.address == m.address)) continue;
        final entry = _entryFromSummary(m);
        _shelfMaps.add(entry);
        added.add(entry);
      }
    });
    if (added.isNotEmpty) {
      final bounds = computeCombinedBounds(added);
      if (bounds != null) _flyToBounds(bounds);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Added ${added.length} map${added.length == 1 ? '' : 's'} to Shelf',
          ),
        ),
      );
    }
  }

  EdgeInsets _cameraPadding() {
    final width = MediaQuery.sizeOf(context).width;
    if (width >= 880 && _drawer != _ActiveDrawer.none) {
      return const EdgeInsets.fromLTRB(440, 72, 40, 48);
    }
    return EdgeInsets.fromLTRB(
      36,
      72,
      36,
      _drawer != _ActiveDrawer.none ? 320 : 96,
    );
  }

  void _flyToMap(MapSummaryDto map) {
    final controller = _controller;
    if (controller == null) return;
    if (map.west != null &&
        map.south != null &&
        map.east != null &&
        map.north != null) {
      controller.animateCamera(
        CameraUpdate.bounds(
          GeoBox(
            west: map.west!,
            south: map.south!,
            east: map.east!,
            north: map.north!,
          ),
          padding: _cameraPadding(),
        ),
      );
    }
  }

  void _flyToBounds(GeoBox bounds) {
    _controller?.animateCamera(
      CameraUpdate.bounds(bounds, padding: _cameraPadding()),
    );
  }

  void _flyToStoryCamera(StoryCameraTarget camera) {
    _controller?.animateCamera(
      CameraUpdate.position(
        center: Geographic(lon: camera.lon, lat: camera.lat),
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: camera.pitch,
      ),
    );
  }

  void _focusSighting(SightingSummaryDto sighting) {
    _controller?.animateCamera(
      CameraUpdate.position(
        center: Geographic(lon: sighting.lon, lat: sighting.lat),
        zoom: 15,
      ),
    );
  }

  Future<void> _openStory(StorySummaryDto story) async {
    final parsed = parseStoryDocument(
      markdown: story.content,
      presentationJson: story.presentationJson,
    );

    final knownByAddr = <String, MapSummaryDto>{
      for (final m in _catalog?.maps ?? const <MapSummaryDto>[]) m.address: m,
      for (final s in _shelfMaps) s.summary.address: s.summary,
    };

    final targetAddresses = <String>{
      ...story.referencedAddresses.where((a) => a.startsWith('37515:')),
      ...parsed.presentationMapAddresses,
    };

    final initialDatasets = <String, ShelfMapEntry>{};
    for (final addr in targetAddresses) {
      final found = knownByAddr[addr];
      if (found != null) {
        initialDatasets[addr] = _entryFromSummary(found);
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

    setState(() {
      _mode = DrawToolMode.browse;
      _drawer = _ActiveDrawer.storyReader;
      _activeStory = story;
      _parsedStory = parsed;
      _deskStories.removeWhere((s) => s.address == story.address);
      _deskStories.insert(0, story);
      _storyDatasets
        ..clear()
        ..addAll(initialDatasets);
      _storyDecodedRefs.clear();
      _loadingStoryMaps = true;
      _activeStoryViewIndex = null;
      _focusedStoryDatasetAddress = null;
      _focusedStoryFeatureId = null;
      _storyGeoPins
        ..clear()
        ..addAll(initialPins);
    });

    if (parsed.initialView != null) {
      _flyToStoryCamera(parsed.initialView!);
    } else if (initialDatasets.isNotEmpty) {
      final bounds = computeCombinedBounds(initialDatasets.values);
      if (bounds != null) _flyToBounds(bounds);
    }

    try {
      await RustBridge.ensureInitialized();
      final decodedMap = <String, DecodedNaddrDto>{};
      final hintedRelays = <String>{..._activeRelayUrls};

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
          initialDatasets[addr] = _entryFromSummary(knownByAddr[addr]!);
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
          initialDatasets[map.address] = _entryFromSummary(map);
        }
      }

      if (!mounted || _activeStory?.address != story.address) return;
      setState(() {
        _storyDecodedRefs
          ..clear()
          ..addAll(decodedMap);
        _storyDatasets
          ..clear()
          ..addAll(initialDatasets);
        _loadingStoryMaps = false;
      });

      if (parsed.initialView == null && initialDatasets.isNotEmpty) {
        final bounds = computeCombinedBounds(initialDatasets.values);
        if (bounds != null) _flyToBounds(bounds);
      }
    } catch (_) {
      if (mounted && _activeStory?.address == story.address) {
        setState(() => _loadingStoryMaps = false);
      }
    }
  }

  void _selectStoryView(int? index) {
    final parsed = _parsedStory;
    if (parsed == null) return;
    setState(() {
      _activeStoryViewIndex = index;
      _focusedStoryDatasetAddress = null;
      _focusedStoryFeatureId = null;
    });
    if (index == null) {
      if (parsed.initialView != null) {
        _flyToStoryCamera(parsed.initialView!);
      } else {
        final bounds = computeCombinedBounds(_storyDatasets.values);
        if (bounds != null) _flyToBounds(bounds);
      }
      return;
    }
    if (index >= 0 && index < parsed.viewSnapshots.length) {
      final snap = parsed.viewSnapshots[index];
      if (snap.camera != null) {
        _flyToStoryCamera(snap.camera!);
      }
    }
  }

  void _activateStoryNaddrRef(DecodedNaddrDto ref) {
    final dataset = _storyDatasets[ref.address];
    setState(() {
      _focusedStoryDatasetAddress = ref.address;
      _focusedStoryFeatureId = ref.featureId;
    });
    if (dataset == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Referenced map ${ref.dTag} is not on relay')),
      );
      return;
    }
    if (ref.featureId != null) {
      final matches =
          dataset.shapes.where((s) => s.featureId == ref.featureId).toList();
      if (matches.isNotEmpty) {
        final bounds = computeFeatureBounds(matches.first);
        if (bounds != null) {
          _flyToBounds(bounds);
          return;
        }
      }
    }
    _flyToMap(dataset.summary);
  }

  void _activateStoryGeoRef(double lat, double lon, String label) {
    final pos = Geographic(lon: lon, lat: lat);
    setState(() {
      if (!_storyGeoPins.any((p) => p.label == label)) {
        _storyGeoPins.add(
          GeoPinOverlayItem(id: 'geo-$label', position: pos, label: label),
        );
      }
    });
    _controller?.animateCamera(
      CameraUpdate.position(center: pos, zoom: 15.5),
    );
  }

  void _keepStoryMapsOnShelf() {
    setState(() {
      for (final entry in _storyDatasets.values) {
        final exists = _shelfMaps.any(
          (e) => e.summary.address == entry.summary.address,
        );
        if (!exists) {
          _shelfMaps.add(entry);
        }
      }
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Pinned ${_storyDatasets.length} Story map${_storyDatasets.length == 1 ? '' : 's'} to Shelf',
        ),
      ),
    );
  }

  void _closeStory() {
    setState(() {
      _drawer = _ActiveDrawer.none;
      _activeStory = null;
      _parsedStory = null;
      _storyDatasets.clear();
      _storyDecodedRefs.clear();
      _loadingStoryMaps = false;
      _activeStoryViewIndex = null;
      _focusedStoryDatasetAddress = null;
      _focusedStoryFeatureId = null;
      _storyGeoPins.clear();
    });
  }

  void _inspectMap(MapSummaryDto map) {
    _recordRecentEntity('map:${map.address}');
    setState(() {
      _inspectedMap = map;
      _drawer = _ActiveDrawer.datasetDetail;
    });
  }

  void _editOrForkMap(MapSummaryDto map) {
    final isOwned = _account != null && _account!.pubkey == map.pubkey;
    final cloned = parseDraftFeaturesFromGeoJson(map.geojson);
    if (cloned.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No editable features found in map')),
      );
      return;
    }
    setState(() {
      _features
        ..clear()
        ..addAll(cloned);
      _draftVertices.clear();
      _featureCounter = _features.length;
      if (isOwned) {
        _draftDTag = map.dTag;
        _draftTitle = map.title;
      } else {
        _draftDTag = 'field-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
        _draftTitle = '${map.title} (Fork)';
      }
      _drawer = _ActiveDrawer.desk;
    });
    unawaited(_persistWorkingDraft());
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          isOwned
              ? 'Loaded "${map.title}" for in-place edit (preserving d-tag)'
              : 'Forked ${cloned.length} features into Working Draft',
        ),
      ),
    );
  }

  Future<PublishOutcomeDto> _deleteOwnedMap(MapSummaryDto map) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final prepared = await prepareUnsignedDeletionEvent(
      pubkeyOrNpub: account.pubkey,
      targetAddress: map.address,
      targetEventId: map.eventId,
      targetKind: 37515,
      reason: 'Deleted map "${map.title}"',
    );
    final signed =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome =
        await _deliverForAudience(DraftAudienceChoice.publicRelay, signed);
    if (mounted) {
      setState(() {
        _shelfMaps.removeWhere((e) => e.summary.address == map.address);
        if (_catalog != null) {
          _catalog = EarthlyCatalogSnapshot(
            relayUrls: _catalog!.relayUrls,
            maps: _catalog!.maps
                .where((m) => m.address != map.address)
                .toList(growable: false),
            stories: _catalog!.stories,
            atlases: _catalog!.atlases,
            sightings: _catalog!.sightings,
            beacons: _catalog!.beacons,
          );
        }
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Published NIP-09 deletion for "${map.title}" (${outcome.outboxState})',
          ),
        ),
      );
    }
    return outcome;
  }

  void _jumpToMapFeature(MapSummaryDto map, ShelfShape shape) {
    if (!_shelfMaps.any((e) => e.summary.address == map.address)) {
      setState(() => _shelfMaps.add(_entryFromSummary(map)));
    }
    final bounds = computeFeatureBounds(shape);
    if (bounds != null) _flyToBounds(bounds);
    _inspectFeature(
      InspectedFeature(
        sourceLabel: map.title,
        isDraft: false,
        featureId: shape.featureId,
        geometryType: switch (shape.kind) {
          ShelfShapeKind.point => 'Point',
          ShelfShapeKind.line => 'LineString',
          ShelfShapeKind.polygon => 'Polygon',
        },
        title: shape.label ?? shape.featureId ?? map.title,
        properties: shape.properties,
        callouts: shape.callouts,
        datasetAddress: map.address,
        datasetPubkey: map.pubkey,
        datasetTitle: map.title,
        datasetEventId: map.eventId,
        datasetGeojson: map.geojson,
      ),
    );
  }

  void _fitAllMountedLayers() {
    final bounds = computeCombinedBounds(_shelfMaps);
    if (bounds != null) {
      _flyToBounds(bounds);
      return;
    }
    final verts = _features.expand((f) => f.vertices).toList();
    if (verts.isNotEmpty) {
      double west = verts.first.lon;
      double east = verts.first.lon;
      double south = verts.first.lat;
      double north = verts.first.lat;
      for (final v in verts) {
        if (v.lon < west) west = v.lon;
        if (v.lon > east) east = v.lon;
        if (v.lat < south) south = v.lat;
        if (v.lat > north) north = v.lat;
      }
      _flyToBounds(
        GeoBox(
          west: (west - 0.002).clamp(-180.0, 180.0),
          south: (south - 0.002).clamp(-85.0, 85.0),
          east: (east + 0.002).clamp(-180.0, 180.0),
          north: (north + 0.002).clamp(-85.0, 85.0),
        ),
      );
    }
  }

  void _openEarthlyCommandSheet(BasemapKind effectiveBasemap) {
    final cam = _controller?.camera;
    final center = cam?.center ?? const Geographic(lon: 16.3738, lat: 48.2082);
    final zoom = cam?.zoom ?? 13.5;
    final geoUri =
        'geo:${center.lat.toStringAsFixed(5)},${center.lon.toStringAsFixed(5)}';

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        final theme = Theme.of(ctx);
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 12),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.24),
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ),
                Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: const BoxDecoration(
                        color: EarthlyColors.amber,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.explore,
                        size: 17,
                        color: EarthlyColors.amberInk,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'EARTHLY',
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1.0,
                            ),
                          ),
                          Text(
                            _relayStreamLive
                                ? 'Live stream · ${_relayUrls.first}'
                                : 'Connecting · ${_relayUrls.first}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10.5,
                              color: _relayStreamLive
                                  ? EarthlyColors.commentGreen
                                  : theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    OutlinedButton.icon(
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        unawaited(_preloadCatalog());
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Refreshing Nostr catalog…'),
                          ),
                        );
                      },
                      icon: const Icon(Icons.refresh, size: 15),
                      label: const Text('Sync'),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Text(
                  'MAP STYLE',
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontFamily: 'monospace',
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    ChoiceChip(
                      label: const Text('Liberty'),
                      selected:
                          effectiveBasemap == BasemapKind.openFreeMapLiberty,
                      onSelected: (_) {
                        setState(
                          () =>
                              _selectedBasemap = BasemapKind.openFreeMapLiberty,
                        );
                        Navigator.of(ctx).pop();
                      },
                    ),
                    ChoiceChip(
                      label: const Text('Dark'),
                      selected: effectiveBasemap == BasemapKind.openFreeMapDark,
                      onSelected: (_) {
                        setState(
                          () => _selectedBasemap = BasemapKind.openFreeMapDark,
                        );
                        Navigator.of(ctx).pop();
                      },
                    ),
                    ActionChip(
                      avatar: const Icon(Icons.layers_outlined, size: 15),
                      label: const Text('Offline / Overlays…'),
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        _openBasemapSwitcher(effectiveBasemap);
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 9,
                  ),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: theme.dividerColor),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.my_location, size: 15),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${center.lat.toStringAsFixed(5)}, ${center.lon.toStringAsFixed(5)} · z${zoom.toStringAsFixed(1)}',
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      TextButton(
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                        ),
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: geoUri));
                          Navigator.of(ctx).pop();
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Copied $geoUri')),
                          );
                        },
                        child: const Text('Copy geo:'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (_shelfMaps.isNotEmpty || _features.isNotEmpty)
                      OutlinedButton.icon(
                        onPressed: () {
                          Navigator.of(ctx).pop();
                          _fitAllMountedLayers();
                        },
                        icon: const Icon(Icons.fit_screen, size: 16),
                        label: const Text('Fit All Layers'),
                      ),
                    if (_shelfMaps.isNotEmpty)
                      OutlinedButton.icon(
                        onPressed: () {
                          Navigator.of(ctx).pop();
                          setState(() => _shelfMaps.clear());
                        },
                        icon: const Icon(Icons.layers_clear_outlined, size: 16),
                        label: Text('Clear Shelf (${_shelfMaps.length})'),
                      ),
                    OutlinedButton.icon(
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        setState(() => _drawer = _ActiveDrawer.inbox);
                        unawaited(_refreshInbox());
                      },
                      icon: const Icon(Icons.inbox_outlined, size: 16),
                      label: Text(
                        _inboxUnreadCount > 0
                            ? 'Inbox ($_inboxUnreadCount)'
                            : 'Inbox',
                      ),
                    ),
                    OutlinedButton.icon(
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        setState(() => _drawer = _ActiveDrawer.circles);
                      },
                      icon: const Icon(Icons.lock_outline, size: 16),
                      label: Text(
                        _circles.isEmpty
                            ? 'Circles (MLS)'
                            : 'Circles (${_circles.length})',
                      ),
                    ),
                    OutlinedButton.icon(
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        showModalBottomSheet<void>(
                          context: context,
                          builder: (_) => const RustNodeSheet(),
                        );
                      },
                      icon: const Icon(Icons.memory, size: 16),
                      label: const Text('Rust Node & Outbox'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _inspectAtlas(AtlasSummaryDto atlas) {
    _recordRecentEntity('atlas:${atlas.address}');
    setState(() {
      _inspectedAtlas = atlas;
      _deskAtlases.removeWhere((a) => a.address == atlas.address);
      _deskAtlases.insert(0, atlas);
      _drawer = _ActiveDrawer.atlasDetail;
    });
  }

  void _enterAtlasLens(AtlasSummaryDto atlas) {
    _recordRecentEntity('atlas:${atlas.address}');
    setState(() {
      _activeAtlasLens = atlas;
      _deskAtlases.removeWhere((a) => a.address == atlas.address);
      _deskAtlases.insert(0, atlas);
    });
    unawaited(_openAtlas(atlas));
  }

  void _leaveAtlasLens() {
    setState(() => _activeAtlasLens = null);
  }

  Future<void> _openAtlas(AtlasSummaryDto atlas) async {
    _recordRecentEntity('atlas:${atlas.address}');
    final mapAddresses = <String>{
      ...atlas.pinnedAddresses.where((a) => a.startsWith('37515:')),
      for (final m in _catalog?.maps ?? const <MapSummaryDto>[])
        if (m.contextRefs.contains(atlas.address)) m.address,
    }.toList(growable: false);
    if (mapAddresses.isEmpty) return;

    final knownByAddr = <String, MapSummaryDto>{
      for (final m in _catalog?.maps ?? const <MapSummaryDto>[]) m.address: m,
      for (final s in _shelfMaps) s.summary.address: s.summary,
    };
    final missing =
        mapAddresses.where((a) => !knownByAddr.containsKey(a)).toList();

    if (missing.isNotEmpty) {
      try {
        await RustBridge.ensureInitialized();
        final fetched = await fetchMapsByAddresses(
          relayUrls: _activeRelayUrls,
          addresses: missing,
        );
        for (final m in fetched) {
          knownByAddr[m.address] = m;
        }
      } catch (_) {}
    }

    final added = <ShelfMapEntry>[];
    setState(() {
      _deskAtlases.removeWhere((a) => a.address == atlas.address);
      _deskAtlases.insert(0, atlas);
      for (final addr in mapAddresses) {
        final map = knownByAddr[addr];
        if (map == null) continue;
        final existingIdx =
            _shelfMaps.indexWhere((e) => e.summary.address == map.address);
        if (existingIdx >= 0) {
          added.add(_shelfMaps[existingIdx]);
        } else {
          final entry = _entryFromSummary(map);
          _shelfMaps.add(entry);
          added.add(entry);
        }
      }
    });
    final bounds = computeCombinedBounds(added);
    if (bounds != null) _flyToBounds(bounds);
  }

  void _inspectFeature(InspectedFeature feature) {
    if (_isDrawingMode) return;
    setState(() {
      _inspectedFeature = feature;
      _drawer = _ActiveDrawer.inspector;
    });
  }

  void _refreshInspectedDraftFeature(String featureId) {
    final idx = _features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return;
    final f = _features[idx];
    final existing = _inspectedFeature;
    if (existing == null || existing.draftFeatureId != featureId) return;
    final anchor = f.vertices.isEmpty
        ? const Geographic(lon: 0, lat: 0)
        : f.vertices.first;
    setState(() {
      _inspectedFeature = InspectedFeature(
        sourceLabel: 'Working draft',
        isDraft: true,
        draftFeatureId: f.id,
        geometryType: existing.geometryType,
        title: f.name ?? existing.title,
        lengthMeters: existing.lengthMeters,
        areaSquareMeters: existing.areaSquareMeters,
        properties: {
          ...existing.properties,
          if (f.description != null && f.description!.isNotEmpty)
            'description': f.description!,
          if (f.colorHex != null) 'color': f.colorHex!,
          if (f.strokeWidth != null) 'strokeWidth': f.strokeWidth!,
          if (f.fillOpacity != null) 'fillOpacity': f.fillOpacity!,
          if (f.radius != null) 'radius': f.radius!,
          if (f.lineDash != null) 'lineDash': f.lineDash!,
          if (f.displayIcon != null)
            'displayIcon': f.displayIcon!
          else
            'displayIcon': null,
        },
        callouts: [
          for (final c in f.callouts)
            MapCalloutItem(
              key: 'draft::${f.id}::${c.id}',
              id: c.id,
              text: c.text,
              anchor: anchor,
              datasetTitle: 'Working draft',
              featureId: f.id,
              featureLabel: f.name,
              title: c.title,
              preferredSide: c.side,
            ),
        ],
      );
    });
  }

  void _inspectSighting(SightingSummaryDto s) {
    _inspectFeature(
      InspectedFeature(
        sourceLabel: 'Sighting (37522)',
        isDraft: false,
        geometryType: 'Point',
        title: s.title ?? 'Temporal Sighting',
        imageUrl: s.imageUrl,
        properties: {
          'note': s.note,
          'lat': s.lat.toStringAsFixed(5),
          'lon': s.lon.toStringAsFixed(5),
        },
      ),
    );
  }

  void _openDiscussion(DiscussionTarget target) {
    setState(() {
      _discussionTarget = target;
      _drawer = _ActiveDrawer.discussion;
    });
  }

  Future<PublishOutcomeDto> _postComment(
    DiscussionTarget target,
    String text,
    bool attachDraft,
  ) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final dTag = 'comment-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
    final geojson = (attachDraft && _features.isNotEmpty)
        ? draftFeaturesToGeoJson(title: 'Comment annotation', features: _features)
        : null;
    final prepared = await prepareUnsignedCommentEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: dTag,
      rootAddress: target.address,
      rootKind: target.kind,
      rootPubkey: target.pubkey,
      text: text,
      geojson: geojson,
    );
    final signedEventJson =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final dbPath = await _databasePath();
    return publishSignedEventViaOutbox(
      databasePath: dbPath,
      signedEventJson: signedEventJson,
      relayUrls: _activeRelayUrls,
    );
  }

  Future<PublishOutcomeDto> _submitProposal(
    DiscussionTarget target,
    String description,
  ) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final dTag = 'pr-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
    final proposedGeojson =
        draftFeaturesToGeoJson(title: target.title, features: _features);
    final prepared = await prepareUnsignedProposalEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: dTag,
      targetAddress: target.address,
      targetOwnerPubkey: target.pubkey,
      baseEventId: target.eventId,
      description: description,
      proposedGeojson: proposedGeojson,
    );
    final signedEventJson =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final dbPath = await _databasePath();
    return publishSignedEventViaOutbox(
      databasePath: dbPath,
      signedEventJson: signedEventJson,
      relayUrls: _activeRelayUrls,
    );
  }

  Future<PublishOutcomeDto> _publishStory(StoryPublishRequest req) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
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
          ? _activeNearbySessionId
          : null,
    );
    final signedEventJson =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome = await _deliverForAudience(req.audience, signedEventJson);
    if (mounted) {
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
      setState(() {
        _deskStories.removeWhere((s) => s.address == created.address);
        _deskStories.insert(0, created);
      });
    }
    return outcome;
  }

  Future<void> _locateMe() async {
    try {
      final fix = await DeviceBridge.getCurrentLocation();
      _controller?.animateCamera(
        CameraUpdate.position(
          center: Geographic(lon: fix.lon, lat: fix.lat),
          zoom: 15.5,
        ),
      );
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('GPS unavailable: $err')),
      );
    }
  }

  Future<PublishOutcomeDto> _publishDraft(
    String title,
    DraftAudienceChoice audience,
  ) async {
    await RustBridge.ensureInitialized();
    final geojson = draftFeaturesToGeoJson(title: title, features: _features);

    // Encrypted MLS / Cordn Circle destination: NEVER leaks to public Nostr!
    if (audience == DraftAudienceChoice.privateCircle) {
      final targetId = _selectedCircleId ??
          _activeCircleLensId ??
          _circles.firstOrNull?.workspaceId;
      if (targetId == null || targetId.isEmpty) {
        throw StateError('Create or select a Circle first');
      }
      final mlsPath = await _ensureMlsDatabasePath();
      final updated = await sendCircleDataset(
        databasePath: mlsPath,
        signerNsec: _localNsec,
        bunkerUri: _bunkerUri,
        bunkerClientNsec: _bunkerClientNsec,
        workspaceId: targetId,
        geojsonJson: geojson,
        datasetId: _draftDTag,
        name: title,
      );
      _handleCircleWorkspaceUpdated(updated);
      unawaited(_persistWorkingDraft());
      return PublishOutcomeDto(
        eventId: updated.datasets.firstOrNull?.envelopeId ?? _draftDTag,
        outboxState: 'mls-encrypted (epoch ${updated.epoch})',
        relays: [
          RelayDeliveryStatusDto(
            relayUrl: 'cordn://${updated.name}',
            ok: true,
            message: 'cursor ${updated.cursor}',
          ),
        ],
      );
    }

    final account = await _ensureAccount();
    final prepared = await prepareUnsignedMapEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: _draftDTag,
      title: title,
      geojson: geojson,
      hashtags: const ['earthly-native'],
      contextRefs: _activeAtlasLens != null
          ? <String>[_activeAtlasLens!.address]
          : const <String>[],
      fieldSessionId: audience == DraftAudienceChoice.nearbyLocalNode
          ? _activeNearbySessionId
          : null,
    );
    final signedEventJson =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome = await _deliverForAudience(audience, signedEventJson);
    unawaited(_persistWorkingDraft());
    return outcome;
  }

  Future<String> _ensureMlsDatabasePath() async {
    if (_mlsDatabasePath.isNotEmpty) return _mlsDatabasePath;
    final dir = await getApplicationSupportDirectory();
    final path = '${dir.path}/mls.sqlite3';
    if (mounted) setState(() => _mlsDatabasePath = path);
    return path;
  }

  Future<void> _refreshCirclesSnapshot() async {
    if (widget.mapBuilder != null) return;
    final pk = _account?.pubkey;
    if (pk == null || pk.isEmpty) {
      if (mounted) {
        setState(() {
          _circles = const [];
          _circlePendingJoins = const [];
          _activeCircleLensId = null;
        });
      }
      return;
    }
    try {
      await RustBridge.ensureInitialized();
      final mlsPath = await _ensureMlsDatabasePath();
      final snap = await loadCirclesSnapshot(
        databasePath: mlsPath,
        ownerPubkeyHex: pk,
      );
      if (!mounted) return;
      setState(() {
        _circles = snap.workspaces;
        _circlePendingJoins = snap.pendingJoins;
      });
    } catch (_) {}
  }

  CircleWorkspaceDto? get _activeCircleLens {
    final id = _activeCircleLensId;
    if (id == null) return null;
    for (final c in _circles) {
      if (c.workspaceId == id) return c;
    }
    return null;
  }

  MapSummaryDto _circleDatasetToSummary(
    CircleWorkspaceDto ws,
    CircleDatasetDto ds,
  ) {
    final addr = 'private-group:${ws.workspaceId}:${ds.datasetId}';
    return MapSummaryDto(
      address: addr,
      eventId: ds.envelopeId,
      pubkey: ds.pubkey,
      dTag: ds.datasetId,
      title: '🔒 ${ds.title}',
      description: 'MLS-encrypted Circle Map (${ws.name})',
      featureCount: ds.featureCount,
      sizeBytes: ds.geojsonJson.length,
      geojson: ds.geojsonJson,
      hashtags: const ['circle-mls'],
      labels: const <String>[],
      contextRefs: [ws.workspaceId],
      createdAt: ds.createdAt,
    );
  }

  void _handleCircleWorkspaceUpdated(CircleWorkspaceDto ws) {
    if (!mounted) return;
    setState(() {
      final idx = _circles.indexWhere((c) => c.workspaceId == ws.workspaceId);
      if (idx >= 0) {
        _circles = [
          ..._circles.sublist(0, idx),
          ws,
          ..._circles.sublist(idx + 1),
        ];
      } else {
        _circles = [ws, ..._circles];
      }
      if (_activeCircleLensId == ws.workspaceId) {
        for (final ds in ws.datasets) {
          final summary = _circleDatasetToSummary(ws, ds);
          final sIdx =
              _shelfMaps.indexWhere((e) => e.summary.address == summary.address);
          if (sIdx >= 0) {
            _shelfMaps[sIdx] = _entryFromSummary(summary)
                .copyWith(visible: _shelfMaps[sIdx].visible);
          } else {
            _shelfMaps.add(_entryFromSummary(summary));
          }
        }
      }
    });
  }

  void _enterCircleLens(CircleWorkspaceDto ws) {
    final added = <ShelfMapEntry>[];
    setState(() {
      _activeCircleLensId = ws.workspaceId;
      _selectedCircleId = ws.workspaceId;
      _draftAudience = DraftAudienceChoice.privateCircle;
      _shelfMaps.removeWhere(
        (e) =>
            e.summary.address.startsWith('private-group:') &&
            !e.summary.address.startsWith('private-group:${ws.workspaceId}:'),
      );
      for (final ds in ws.datasets) {
        final summary = _circleDatasetToSummary(ws, ds);
        final existingIdx =
            _shelfMaps.indexWhere((e) => e.summary.address == summary.address);
        if (existingIdx >= 0) {
          added.add(_shelfMaps[existingIdx]);
        } else {
          final entry = _entryFromSummary(summary);
          _shelfMaps.add(entry);
          added.add(entry);
        }
      }
    });
    final bounds = computeCombinedBounds(added);
    if (bounds != null) _flyToBounds(bounds);
  }

  void _leaveCircleLens() {
    setState(() {
      _activeCircleLensId = null;
      _shelfMaps.removeWhere(
        (e) => e.summary.address.startsWith('private-group:'),
      );
      if (_draftAudience == DraftAudienceChoice.privateCircle) {
        _draftAudience = DraftAudienceChoice.publicRelay;
      }
    });
  }

  void _toggleCircleDatasetOnMap(CircleWorkspaceDto ws, CircleDatasetDto ds) {
    final summary = _circleDatasetToSummary(ws, ds);
    final idx =
        _shelfMaps.indexWhere((e) => e.summary.address == summary.address);
    if (idx >= 0) {
      setState(() => _shelfMaps.removeAt(idx));
    } else {
      final entry = _entryFromSummary(summary);
      setState(() => _shelfMaps.add(entry));
      final bounds = computeCombinedBounds([entry]);
      if (bounds != null) _flyToBounds(bounds);
    }
  }

  void _zoomToCircleDataset(CircleWorkspaceDto ws, CircleDatasetDto ds) {
    final summary = _circleDatasetToSummary(ws, ds);
    final existingIdx =
        _shelfMaps.indexWhere((e) => e.summary.address == summary.address);
    final ShelfMapEntry entry;
    if (existingIdx >= 0) {
      entry = _shelfMaps[existingIdx];
    } else {
      entry = _entryFromSummary(summary);
      setState(() => _shelfMaps.add(entry));
    }
    final bounds = computeCombinedBounds([entry]);
    if (bounds != null) _flyToBounds(bounds);
  }

  void _editCircleDatasetInDraft(CircleWorkspaceDto ws, CircleDatasetDto ds) {
    final parsed = parseDraftFeaturesFromGeoJson(ds.geojsonJson);
    setState(() {
      _activeCircleLensId = ws.workspaceId;
      _selectedCircleId = ws.workspaceId;
      _draftAudience = DraftAudienceChoice.privateCircle;
      _draftDTag = ds.datasetId;
      _draftTitle = ds.title;
      _features
        ..clear()
        ..addAll(parsed);
      _draftVertices.clear();
      _featureCounter = parsed.length;
      _drawer = _ActiveDrawer.desk;
    });
    unawaited(_persistWorkingDraft());
  }

  void _startNewPrivateMapInCircle(CircleWorkspaceDto ws) {
    final nowSec = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    setState(() {
      _activeCircleLensId = ws.workspaceId;
      _selectedCircleId = ws.workspaceId;
      _draftAudience = DraftAudienceChoice.privateCircle;
      _draftDTag = 'circle-map-$nowSec';
      _draftTitle = '${ws.name} Map';
      _features.clear();
      _draftVertices.clear();
      _featureCounter = 0;
      _drawer = _ActiveDrawer.desk;
    });
    unawaited(_persistWorkingDraft());
  }

  void _toggleCircleCommentGeometry(CircleMessageDto msg) {
    if (_activeCommentOverlayId == msg.envelopeId) {
      setState(() {
        _activeCommentOverlayId = null;
        _commentOverlayShapes = const [];
      });
      return;
    }
    if (msg.geojsonJson == null || msg.geojsonJson!.isEmpty) return;
    final shapes = parseGeoJsonShapes(
      msg.geojsonJson!,
      datasetTitle: 'Circle Comment',
    );
    setState(() {
      _activeCommentOverlayId = msg.envelopeId;
      _commentOverlayShapes = shapes;
    });
    if (shapes.isNotEmpty) {
      final bounds = computeFeatureBounds(shapes.first);
      if (bounds != null) _flyToBounds(bounds);
    }
  }

  Future<CircleWorkspaceDto> _sendCircleComment(
    String workspaceId,
    String text,
    bool attachDraft,
  ) async {
    await RustBridge.ensureInitialized();
    final mlsPath = await _ensureMlsDatabasePath();
    final geojson = (attachDraft && _features.isNotEmpty)
        ? draftFeaturesToGeoJson(title: 'Circle attachment', features: _features)
        : null;
    final updated = await sendCircleComment(
      databasePath: mlsPath,
      signerNsec: _localNsec,
      bunkerUri: _bunkerUri,
      bunkerClientNsec: _bunkerClientNsec,
      workspaceId: workspaceId,
      text: text,
      geojsonJson: geojson,
    );
    _handleCircleWorkspaceUpdated(updated);
    return updated;
  }

  Future<void> _deleteOwnedStory(StorySummaryDto story) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final prepared = await prepareUnsignedDeletionEvent(
      pubkeyOrNpub: account.pubkey,
      targetAddress: story.address,
      targetEventId: story.eventId,
      targetKind: 37520,
      reason: 'Deleted story "${story.title}"',
    );
    final signed =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome =
        await _deliverForAudience(DraftAudienceChoice.publicRelay, signed);
    if (!mounted) return;
    setState(() {
      _deskStories.removeWhere((s) => s.address == story.address);
      if (_catalog != null) {
        _catalog = EarthlyCatalogSnapshot(
          relayUrls: _catalog!.relayUrls,
          maps: _catalog!.maps,
          stories: _catalog!.stories
              .where((s) => s.address != story.address)
              .toList(growable: false),
          atlases: _catalog!.atlases,
          sightings: _catalog!.sightings,
          beacons: _catalog!.beacons,
        );
      }
    });
    _closeStory();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Published NIP-09 deletion for "${story.title}" (${outcome.outboxState})',
        ),
      ),
    );
  }

  Future<void> _deleteOwnedAtlas(AtlasSummaryDto atlas) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final prepared = await prepareUnsignedDeletionEvent(
      pubkeyOrNpub: account.pubkey,
      targetAddress: atlas.address,
      targetEventId: atlas.eventId,
      targetKind: 37518,
      reason: 'Deleted atlas "${atlas.name}"',
    );
    final signed =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome =
        await _deliverForAudience(DraftAudienceChoice.publicRelay, signed);
    if (!mounted) return;
    setState(() {
      _deskAtlases.removeWhere((a) => a.address == atlas.address);
      if (_activeAtlasLens?.address == atlas.address) {
        _activeAtlasLens = null;
      }
      if (_catalog != null) {
        _catalog = EarthlyCatalogSnapshot(
          relayUrls: _catalog!.relayUrls,
          maps: _catalog!.maps,
          stories: _catalog!.stories,
          atlases: _catalog!.atlases
              .where((a) => a.address != atlas.address)
              .toList(growable: false),
          sightings: _catalog!.sightings,
          beacons: _catalog!.beacons,
        );
      }
      _drawer = _ActiveDrawer.none;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Published NIP-09 deletion for "${atlas.name}" (${outcome.outboxState})',
        ),
      ),
    );
  }

  Future<void> _mountAtlasWorkspace(AtlasBundleInspectionDto bundle) async {
    final record = MountedAtlasWorkspaceDto(
      name: bundle.name,
      path: bundle.path,
      sizeBytes: bundle.sizeBytes,
      families: bundle.families,
      coverageSummary: bundle.coverageSummary,
    );
    setState(() {
      _mountedAtlasWorkspaces.removeWhere((w) => w.path == record.path);
      _mountedAtlasWorkspaces.insert(0, record);
    });
    unawaited(_persistAppSettings());

    // Auto-mount embedded PMTiles basemap inside the .atlas bundle if present!
    if (bundle.embeddedPmtilesPath != null &&
        bundle.embeddedPmtilesPath!.isNotEmpty) {
      try {
        final dir = await getApplicationSupportDirectory();
        await startLocalNode(dataDir: '${dir.path}/local-node');
        final ingested = await ingestLocalPmtilesFromPath(
          path: bundle.embeddedPmtilesPath!,
          label: bundle.name,
        );
        final offline = OfflinePmtilesBasemap(
          snapshot: ingested,
          styleJson: buildPmtilesStyleJson(ingested),
        );
        if (mounted) {
          setState(() {
            _offlineBasemap = offline;
            _selectedBasemap = BasemapKind.offlinePmtiles;
          });
        }
      } catch (_) {}
    }

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Mounted .atlas workspace "${bundle.name}"')),
      );
    }
  }

  int get _inboxUnreadCount => _inboxItems
      .where(
        (i) => !InboxSheet.isItemRead(
          i,
          readAllBeforeSecs: _inboxReadAllBefore,
          readIds: _inboxReadIds,
        ),
      )
      .length;

  Future<void> _refreshInbox() async {
    if (widget.mapBuilder != null || _inboxLoading) return;
    final pk = _account?.pubkey;
    if (pk == null || pk.isEmpty) {
      if (mounted) setState(() => _inboxItems = const []);
      return;
    }
    if (mounted) setState(() => _inboxLoading = true);
    try {
      await RustBridge.ensureInitialized();
      final ownedAtlases = <String>[
        for (final a in _catalog?.atlases ?? const <AtlasSummaryDto>[])
          if (a.pubkey == pk) a.address,
        for (final a in _deskAtlases)
          if (a.pubkey == pk) a.address,
      ];
      final titles = <String, String>{
        for (final m in _catalog?.maps ?? const <MapSummaryDto>[])
          m.address: m.title,
        for (final s in _catalog?.stories ?? const <StorySummaryDto>[])
          s.address: s.title,
        for (final a in _catalog?.atlases ?? const <AtlasSummaryDto>[])
          a.address: a.name,
      };
      final items = await fetchInboxItems(
        relayUrls: _activeRelayUrls,
        currentUserPubkey: pk,
        ownedAtlasAddresses: ownedAtlases.toSet().toList(growable: false),
        knownTitlesJson: jsonEncode(titles),
      );
      if (!mounted) return;
      setState(() => _inboxItems = items);

      // Resolve missing actor profiles for Inbox rows.
      final actorPks = items
          .map((i) => i.actorPubkey)
          .where((p) => !_profilesByPubkey.containsKey(p))
          .toSet()
          .toList(growable: false);
      if (actorPks.isNotEmpty) {
        final fetched = await fetchProfiles(
          relayUrls: _activeRelayUrls,
          pubkeys: actorPks,
        );
        if (mounted && fetched.isNotEmpty) {
          setState(() {
            for (final p in fetched) {
              _profilesByPubkey[p.pubkey] = p;
            }
          });
        }
      }
    } catch (_) {
    } finally {
      if (mounted) setState(() => _inboxLoading = false);
    }
  }

  void _markInboxItemRead(String itemId) {
    setState(() => _inboxReadIds.add(itemId));
    unawaited(_persistAppSettings());
  }

  void _markAllInboxRead() {
    var maxTs = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    for (final item in _inboxItems) {
      final ts = item.createdAt.toInt();
      if (ts > maxTs) maxTs = ts;
    }
    setState(() {
      _inboxReadAllBefore = maxTs;
      _inboxReadIds.clear();
    });
    unawaited(_persistAppSettings());
  }

  void _openPerson(String pubkey) {
    setState(() {
      _inspectedPersonPubkey = pubkey;
      _drawer = _ActiveDrawer.person;
    });
  }

  Future<void> _openInboxItem(InboxItemDto item) async {
    if (item.targetTab == 'person' ||
        item.targetAddress == null ||
        item.targetAddress!.isEmpty) {
      _openPerson(item.actorPubkey);
      return;
    }
    final addr = item.targetAddress!;
    final parts = addr.split(':');
    final kind = item.targetKind ?? (parts.isNotEmpty ? int.tryParse(parts[0]) : null);
    final ownerPk = parts.length >= 2 ? parts[1] : item.actorPubkey;

    if (item.targetTab == 'comments' && kind != null) {
      final mapMatch = _catalog?.maps.where((m) => m.address == addr).firstOrNull;
      _openDiscussion(
        DiscussionTarget(
          address: addr,
          kind: kind,
          pubkey: ownerPk,
          title: mapMatch?.title ?? item.thingLabel,
          eventId: mapMatch?.eventId,
          baseGeojson: mapMatch?.geojson,
        ),
      );
      return;
    }

    // Open Map / Story / Atlas directly (from cache or live relay lookup).
    final cachedMap = _catalog?.maps.where((m) => m.address == addr).firstOrNull;
    if (cachedMap != null) {
      _inspectMap(cachedMap);
      return;
    }
    final cachedStory =
        _catalog?.stories.where((s) => s.address == addr).firstOrNull;
    if (cachedStory != null) {
      await _openStory(cachedStory);
      return;
    }
    final cachedAtlas =
        _catalog?.atlases.where((a) => a.address == addr).firstOrNull;
    if (cachedAtlas != null) {
      _inspectAtlas(cachedAtlas);
      return;
    }

    try {
      await RustBridge.ensureInitialized();
      final fetched = await fetchEntityByAddress(
        relayUrls: _activeRelayUrls,
        address: addr,
      );
      if (!mounted || fetched == null) return;
      if (fetched.map != null) {
        _inspectMap(fetched.map!);
      } else if (fetched.story != null) {
        await _openStory(fetched.story!);
      } else if (fetched.atlas != null) {
        _inspectAtlas(fetched.atlas!);
      }
    } catch (_) {}
  }

  Future<BlossomUploadDto> _uploadBlossomBytes({
    required Uint8List bytes,
    required String mimeType,
    required String purpose,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final sha = await computeSha256Hex(bytes: bytes);
    final unsignedAuth = await prepareUnsignedBlossomUploadAuth(
      pubkeyOrNpub: account.pubkey,
      sha256Hex: sha,
      message: purpose,
    );
    final signedAuth = await _signUnsignedEvent(account, unsignedAuth);
    return uploadBlobToBlossom(
      serverUrl: _blossomServerUrl,
      bytes: bytes,
      mimeType: mimeType,
      signedAuthEventJson: signedAuth,
    );
  }

  Future<BlossomUploadDto?> _pickAndUploadBlossomImage(String purpose) async {
    try {
      final picked = await DeviceBridge.pickImage();
      final uploaded = await _uploadBlossomBytes(
        bytes: picked.bytes,
        mimeType: picked.mimeType,
        purpose: purpose,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Uploaded to Blossom: ${uploaded.url}')),
        );
      }
      return uploaded;
    } catch (err) {
      if (err.toString().contains('cancelled')) return null;
      rethrow;
    }
  }

  Future<SightingPublishResult> _publishSighting(
    SightingPublishRequest req,
  ) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();

    String? imageUrl;
    String? imageMime;
    String? imageSha256;
    if (req.photoBytes != null && req.photoBytes!.isNotEmpty) {
      final mime = req.photoMimeType ?? 'image/jpeg';
      var uploadedPublic = false;
      if (req.audience == DraftAudienceChoice.publicRelay) {
        try {
          final uploaded = await _uploadBlossomBytes(
            bytes: req.photoBytes!,
            mimeType: mime,
            purpose: 'Upload Earthly Sighting photo',
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
          ? _activeNearbySessionId
          : null,
    );
    final signedEventJson =
        await _signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome = await _deliverForAudience(req.audience, signedEventJson);

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

    if (mounted) {
      setState(() => _localSightings.add(localSighting));
      _focusSighting(localSighting);
    }

    return SightingPublishResult(outcome: outcome, sighting: localSighting);
  }

  Future<void> _runGeoAction(RustGeoAction action) async {
    try {
      await RustBridge.ensureInitialized();
      List<LonLatPoint> toPoints(List<Geographic> verts) =>
          verts.map((v) => LonLatPoint(lon: v.lon, lat: v.lat)).toList();
      List<Geographic> fromPoints(List<LonLatPoint> pts) =>
          pts.map((p) => Geographic(lon: p.lon, lat: p.lat)).toList();

      switch (action) {
        case RustGeoAction.simplifyLastLine:
          final idx =
              _features.lastIndexWhere((f) => f.kind == DrawToolMode.line);
          if (idx < 0) return;
          final out = await geoSimplifyLine(
            points: toPoints(_features[idx].vertices),
            toleranceMeters: 25.0,
          );
          setState(() {
            _features[idx] = _features[idx].copyWith(vertices: fromPoints(out));
          });
        case RustGeoAction.corridorLastLine:
          final line = _features.lastWhere((f) => f.kind == DrawToolMode.line);
          final ring = await geoLineCorridor(
            points: toPoints(line.vertices),
            totalWidthMeters: 120.0,
          );
          setState(() {
            _featureCounter += 1;
            _features.add(DrawnFeature(
              id: 'corridor-$_featureCounter',
              kind: DrawToolMode.polygon,
              vertices: fromPoints(ring),
              name: 'Corridor (120m)',
            ));
          });
        case RustGeoAction.arrowLastLine:
          final line = _features.lastWhere((f) => f.kind == DrawToolMode.line);
          final ring = await geoExtrudeArrow(
            points: toPoints(line.vertices),
            startWidthMeters: 60.0,
            endWidthMeters: 120.0,
          );
          setState(() {
            _featureCounter += 1;
            _features.add(DrawnFeature(
              id: 'arrow-$_featureCounter',
              kind: DrawToolMode.polygon,
              vertices: fromPoints(ring),
              name: 'Flow Arrow',
            ));
          });
        case RustGeoAction.offsetLastLine:
          final line = _features.lastWhere((f) => f.kind == DrawToolMode.line);
          final out = await geoOffsetLine(
            points: toPoints(line.vertices),
            distanceMeters: 80.0,
          );
          setState(() {
            _featureCounter += 1;
            _features.add(DrawnFeature(
              id: 'offset-$_featureCounter',
              kind: DrawToolMode.line,
              vertices: fromPoints(out),
              name: 'Parallel (+80m)',
            ));
          });
        case RustGeoAction.splitLastLineAtMidpoint:
          final idx =
              _features.lastIndexWhere((f) => f.kind == DrawToolMode.line);
          if (idx < 0) return;
          final verts = _features[idx].vertices;
          if (verts.length < 2) return;
          final midIdx = verts.length ~/ 2;
          final splitPt = verts.length == 2
              ? DrawingMath.midpoint(verts[0], verts[1])
              : verts[midIdx];
          final parts = await geoSplitLineAtPoint(
            points: toPoints(verts),
            splitPoint: LonLatPoint(lon: splitPt.lon, lat: splitPt.lat),
          );
          if (parts.length < 2) return;
          setState(() {
            final baseName = _features[idx].name ?? 'Line';
            _features.removeAt(idx);
            for (var i = 0; i < parts.length; i++) {
              _featureCounter += 1;
              _features.add(DrawnFeature(
                id: 'split-line-$_featureCounter',
                kind: DrawToolMode.line,
                vertices: fromPoints(parts[i]),
                name: '$baseName (Part ${i + 1})',
              ));
            }
          });
        case RustGeoAction.offsetLastPolygon:
          final poly =
              _features.lastWhere((f) => f.kind == DrawToolMode.polygon);
          final out = await geoOffsetPolygon(
            ring: toPoints(poly.vertices),
            distanceMeters: 100.0,
          );
          setState(() {
            _featureCounter += 1;
            _features.add(DrawnFeature(
              id: 'poly-offset-$_featureCounter',
              kind: DrawToolMode.polygon,
              vertices: fromPoints(out),
              name: 'Offset (+100m)',
            ));
          });
        case RustGeoAction.unionAllPolygons:
          final polys = _features
              .where((f) => f.kind == DrawToolMode.polygon)
              .map((f) => toPoints(f.vertices))
              .toList();
          if (polys.length < 2) return;
          final merged = await geoUnionPolygons(rings: polys);
          setState(() {
            _features.removeWhere((f) => f.kind == DrawToolMode.polygon);
            for (final ring in merged) {
              _featureCounter += 1;
              _features.add(DrawnFeature(
                id: 'union-$_featureCounter',
                kind: DrawToolMode.polygon,
                vertices: fromPoints(ring),
                name: 'Merged Area',
              ));
            }
          });
        case RustGeoAction.differenceLastTwoPolygons:
          final polyIndices = <int>[
            for (var i = 0; i < _features.length; i++)
              if (_features[i].kind == DrawToolMode.polygon) i,
          ];
          if (polyIndices.length < 2) return;
          final subjectIdx = polyIndices[polyIndices.length - 2];
          final clipIdx = polyIndices[polyIndices.length - 1];
          final diffRings = await geoDifferencePolygons(
            subjectRing: toPoints(_features[subjectIdx].vertices),
            clipRing: toPoints(_features[clipIdx].vertices),
          );
          setState(() {
            _features.removeAt(clipIdx);
            _features.removeAt(subjectIdx);
            for (final ring in diffRings) {
              _featureCounter += 1;
              _features.add(DrawnFeature(
                id: 'diff-$_featureCounter',
                kind: DrawToolMode.polygon,
                vertices: fromPoints(ring),
                name: 'Difference Area',
              ));
            }
          });
        case RustGeoAction.splitLastPolygonByLine:
          final polyIdx =
              _features.lastIndexWhere((f) => f.kind == DrawToolMode.polygon);
          final lineIdx =
              _features.lastIndexWhere((f) => f.kind == DrawToolMode.line);
          if (polyIdx < 0 || lineIdx < 0) return;
          final pieces = await geoSplitPolygonByLine(
            ring: toPoints(_features[polyIdx].vertices),
            splitter: toPoints(_features[lineIdx].vertices),
          );
          if (pieces.isEmpty) return;
          setState(() {
            _features.removeAt(polyIdx);
            for (var i = 0; i < pieces.length; i++) {
              _featureCounter += 1;
              _features.add(DrawnFeature(
                id: 'split-$_featureCounter',
                kind: DrawToolMode.polygon,
                vertices: fromPoints(pieces[i]),
                name: 'Split Part ${i + 1}',
              ));
            }
          });
      }
      HapticFeedback.mediumImpact();
      unawaited(_persistWorkingDraft());
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Rust geo op failed: $error')),
      );
    }
  }

  void _toggleDrawer(_ActiveDrawer next) {
    setState(() {
      _drawer = _drawer == next ? _ActiveDrawer.none : next;
    });
  }

  void _openSightingComposer() {
    final center = _controller?.camera?.center ??
        const Geographic(lon: 16.3738, lat: 48.2082);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => SightingComposerSheet(
        initialLocation: center,
        account: _account,
        onPublishSighting: _publishSighting,
      ),
    );
  }

  void _openBasemapSwitcher(BasemapKind effectiveBasemap) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => BasemapSwitcherSheet(
        activeBasemap: effectiveBasemap,
        offlineBasemap: _offlineBasemap,
        showLabels: _showLabels,
        calloutMode: _calloutMode,
        savedOfflinePacks: _savedOfflinePacks,
        onSelectBasemap: (kind) => setState(() => _selectedBasemap = kind),
        onLoadedOfflinePmtiles: (offline) {
          final s = offline.snapshot;
          final h = s.header;
          final record = SavedOfflinePackDto(
            label: s.label,
            sha256: s.sha256,
            sizeBytes: s.sizeBytes,
            format: h.format,
            minZoom: h.minZoom,
            maxZoom: h.maxZoom,
            west: h.west,
            south: h.south,
            east: h.east,
            north: h.north,
            centerLon: h.centerLon,
            centerLat: h.centerLat,
            centerZoom: h.centerZoom,
          );
          setState(() {
            _offlineBasemap = offline;
            _selectedBasemap = BasemapKind.offlinePmtiles;
            _savedOfflinePacks.removeWhere((p) => p.sha256 == record.sha256);
            _savedOfflinePacks.insert(0, record);
          });
          unawaited(_persistAppSettings());
          _controller?.animateCamera(
            CameraUpdate.position(
              center: Geographic(lon: h.centerLon, lat: h.centerLat),
              zoom: h.centerZoom.toDouble().clamp(2.0, 18.0),
            ),
          );
        },
        onMountSavedPack: _mountSavedOfflinePack,
        onRemoveSavedPack: (sha) {
          setState(() {
            _savedOfflinePacks.removeWhere((p) => p.sha256 == sha);
            if (_offlineBasemap?.snapshot.sha256 == sha) {
              _offlineBasemap = null;
              _selectedBasemap = BasemapKind.openFreeMapLiberty;
            }
          });
          unawaited(_persistAppSettings());
        },
        onToggleLabels: (val) => setState(() => _showLabels = val),
        onChangeCalloutMode: (mode) => setState(() => _calloutMode = mode),
        mountedAtlasWorkspaces: _mountedAtlasWorkspaces,
        onMountAtlasWorkspace: _mountAtlasWorkspace,
        onUnmountAtlasWorkspace: (path) {
          setState(
            () => _mountedAtlasWorkspaces.removeWhere((w) => w.path == path),
          );
          unawaited(_persistAppSettings());
        },
      ),
    );
  }

  Widget? _buildActiveDrawer(int visibleCalloutCount) {
    if (_isDrawingMode) return null;
    switch (_drawer) {
      case _ActiveDrawer.none:
        return null;
      case _ActiveDrawer.explore:
        return ExploreSheet(
          initialCatalog: _catalog,
          catalogLoading: _catalogLoading,
          relayUrls: _activeRelayUrls,
          shelfAddresses: _shelfMaps.map((e) => e.summary.address).toSet(),
          profilesByPubkey: _profilesByPubkey,
          pinnedEntityIds: _pinnedEntityIds,
          recentEntityIds: _recentEntityIds,
          activeAtlasLens: _activeAtlasLens,
          onCatalogLoaded: (catalog) {
            setState(() => _catalog = catalog);
            unawaited(_resolveCatalogProfiles(catalog));
          },
          onToggleFavorite: _toggleFavoriteEntity,
          onToggleMapOnShelf: _toggleMapOnShelf,
          onAddMapsBulk: _addMapsBulkToShelf,
          onInspectMap: _inspectMap,
          onFocusMap: (map) {
            _recordRecentEntity('map:${map.address}');
            _flyToMap(map);
          },
          onCloneMapToDraft: (map) =>
              _cloneGeoJsonToDraft(map.title, map.geojson),
          onOpenMapDiscussion: (map) => _openDiscussion(
            DiscussionTarget(
              address: map.address,
              kind: 37515,
              pubkey: map.pubkey,
              title: map.title,
              eventId: map.eventId,
              baseGeojson: map.geojson,
            ),
          ),
          onOpenStory: (story) {
            _recordRecentEntity('story:${story.address}');
            unawaited(_openStory(story));
          },
          onOpenStoryDiscussion: (story) => _openDiscussion(
            DiscussionTarget(
              address: story.address,
              kind: 37520,
              pubkey: story.pubkey,
              title: story.title,
              eventId: story.eventId,
            ),
          ),
          onInspectAtlas: _inspectAtlas,
          onOpenAtlas: (atlas) => unawaited(_openAtlas(atlas)),
          onEnterAtlasLens: _enterAtlasLens,
          onLeaveAtlasLens: _leaveAtlasLens,
          onFocusSighting: _focusSighting,
          onFocusBeacon: _focusBeacon,
          onCreateSighting: _openSightingComposer,
          onComposeStory: () => setState(() {
            _editingStory = null;
            _drawer = _ActiveDrawer.storyComposer;
          }),
          onCreateAtlas: () => setState(() {
            _editingAtlas = null;
            _drawer = _ActiveDrawer.atlasComposer;
          }),
          onOpenBeaconBroadcaster: () =>
              setState(() => _drawer = _ActiveDrawer.spaces),
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.desk:
        return DeskSheet(
          activeDraftId: _activeDraftId,
          savedDrafts: _savedDrafts,
          relayUrls: _activeRelayUrls,
          draftTitle: _draftTitle,
          audience: _draftAudience,
          account: _account,
          shelfMaps: _shelfMaps,
          deskStories: _deskStories,
          deskAtlases: _deskAtlases,
          drawnFeatures: _features,
          activeAtlasLensName: _activeAtlasLens?.name,
          circles: _circles,
          selectedCircleId: _selectedCircleId ?? _activeCircleLensId,
          onSelectedCircleChanged: (id) =>
              setState(() => _selectedCircleId = id),
          onSelectDraft: _selectSavedDraft,
          onCreateNewDraft: _createNewDraft,
          onDeleteDraft: (id) => unawaited(_deleteSavedDraft(id)),
          onDraftTitleChanged: (title) {
            setState(() => _draftTitle = title);
            unawaited(_persistWorkingDraft());
          },
          onAudienceChanged: (audience) {
            setState(() => _draftAudience = audience);
            unawaited(_persistWorkingDraft());
          },
          onToggleShelfVisibility: (addr) {
            setState(() {
              final idx =
                  _shelfMaps.indexWhere((e) => e.summary.address == addr);
              if (idx >= 0) {
                _shelfMaps[idx] =
                    _shelfMaps[idx].copyWith(visible: !_shelfMaps[idx].visible);
              }
            });
          },
          onRemoveShelfMap: (addr) {
            setState(
              () => _shelfMaps.removeWhere((e) => e.summary.address == addr),
            );
          },
          onInspectShelfMap: _inspectMap,
          onFlyToShelfMap: _flyToMap,
          onCloneShelfMapToDraft: (map) =>
              _cloneGeoJsonToDraft(map.title, map.geojson),
          onOpenShelfDiscussion: (map) => _openDiscussion(
            DiscussionTarget(
              address: map.address,
              kind: 37515,
              pubkey: map.pubkey,
              title: map.title,
              eventId: map.eventId,
              baseGeojson: map.geojson,
            ),
          ),
          onOpenDeskStory: (story) => unawaited(_openStory(story)),
          onRemoveDeskStory: (addr) => setState(
            () => _deskStories.removeWhere((s) => s.address == addr),
          ),
          onOpenDeskAtlas: _inspectAtlas,
          onRemoveDeskAtlas: (addr) => setState(
            () => _deskAtlases.removeWhere((a) => a.address == addr),
          ),
          onRunGeoAction: _runGeoAction,
          onPublishDraft: _publishDraft,
          onComposeStory: () => setState(() {
            _editingStory = null;
            _drawer = _ActiveDrawer.storyComposer;
          }),
          onCreateAtlas: () => setState(() {
            _editingAtlas = null;
            _drawer = _ActiveDrawer.atlasComposer;
          }),
          onImportGeoJson: () => unawaited(_importGeoJsonFile()),
          onExportGeoJsonFile: () => unawaited(_exportGeoJsonFile()),
          onExportGpxFile: () => unawaited(_exportSpatialFile('gpx')),
          onExportKmlFile: () => unawaited(_exportSpatialFile('kml')),
          onCopyGeoJson: _copyGeoJsonToClipboard,
          onClearDraftFeatures: () {
            setState(() {
              _features.clear();
              _draftVertices.clear();
            });
            unawaited(_persistWorkingDraft());
          },
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.spaces:
        return SpacesSheet(
          account: _account,
          localNsec: _localNsec,
          relayUrls: _relayUrls,
          initialPairingLink: _pendingDeepLinkPairing,
          circles: _circles,
          pendingCircleJoinsCount: _circlePendingJoins.length,
          activeCircleId: _activeCircleLensId,
          inboxUnreadCount: _inboxUnreadCount,
          onOpenInbox: () {
            setState(() => _drawer = _ActiveDrawer.inbox);
            unawaited(_refreshInbox());
          },
          onOpenCircles: () => setState(() => _drawer = _ActiveDrawer.circles),
          onSelectCircle: (ws) => setState(() {
            _selectedCircleId = ws.workspaceId;
            _drawer = _ActiveDrawer.circles;
          }),
          onRelayUrlsChanged: _updateRelayUrls,
          onAccountChanged: (account) {
            setState(() {
              _account = account;
              if (account == null) {
                _localNsec = null;
                _bunkerUri = null;
                _bunkerClientNsec = null;
              }
            });
            unawaited(_persistAppSettings());
            unawaited(_refreshCirclesSnapshot());
            unawaited(_refreshInbox());
          },
          onLocalKeyChanged: (kp) {
            setState(() {
              if (kp == null) {
                _localNsec = null;
              } else {
                _account = Nip55Account(pubkey: kp.pubkeyHex);
                _localNsec = kp.nsec;
                _bunkerUri = null;
                _bunkerClientNsec = null;
              }
            });
            unawaited(_persistAppSettings());
            unawaited(_refreshCirclesSnapshot());
            unawaited(_refreshInbox());
          },
          onSessionStateChanged: (hostedId, acceptedPeer) {
            setState(() {
              if (hostedId != null) _hostedSessionId = hostedId;
              _acceptedRemotePeer = acceptedPeer;
            });
          },
          onNearbySynced: () {
            // Invalidate cached Explore snapshot so newly synced maps appear immediately.
            setState(() => _catalog = null);
          },
          onBroadcastBeacon: _broadcastLiveBeacon,
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.circles:
        return CirclesSheet(
          account: _account,
          localNsec: _localNsec,
          bunkerUri: _bunkerUri,
          bunkerClientNsec: _bunkerClientNsec,
          mlsDatabasePath: _mlsDatabasePath,
          cordnServerPubkey: _cordnServerPubkey,
          relayUrls: _activeRelayUrls,
          workspaces: _circles,
          pendingJoins: _circlePendingJoins,
          activeCircleId: _activeCircleLensId,
          mountedCircleDatasetKeys:
              _shelfMaps.map((e) => e.summary.address).toSet(),
          activeCommentOverlayId: _activeCommentOverlayId,
          hasDraftGeometry: _features.isNotEmpty,
          profilesByPubkey: _profilesByPubkey,
          initialWorkspaceId: _selectedCircleId,
          initialInviteLink: _pendingDeepLinkCircleInvite,
          onCordnPubkeyChanged: (pubkey) {
            setState(() => _cordnServerPubkey = pubkey);
            unawaited(_persistAppSettings());
          },
          onRefreshCircles: _refreshCirclesSnapshot,
          onWorkspaceUpdated: _handleCircleWorkspaceUpdated,
          onEnterCircleLens: _enterCircleLens,
          onLeaveCircleLens: _leaveCircleLens,
          onToggleDatasetOnMap: _toggleCircleDatasetOnMap,
          onZoomToDataset: _zoomToCircleDataset,
          onEditDatasetInDraft: _editCircleDatasetInDraft,
          onStartNewPrivateMap: _startNewPrivateMapInCircle,
          onToggleCommentGeometry: _toggleCircleCommentGeometry,
          onSendCircleComment: _sendCircleComment,
          onOpenAccount: () => setState(() => _drawer = _ActiveDrawer.account),
          onClose: () => setState(() {
            _pendingDeepLinkCircleInvite = null;
            _drawer = _ActiveDrawer.none;
          }),
        );
      case _ActiveDrawer.inbox:
        return InboxSheet(
          account: _account,
          items: _inboxItems,
          loading: _inboxLoading,
          readAllBeforeSecs: _inboxReadAllBefore,
          readIds: _inboxReadIds,
          profilesByPubkey: _profilesByPubkey,
          pendingCircleJoinsCount: _circlePendingJoins.length,
          pendingNearbyClaimsCount: _pendingClaimCount,
          onRefresh: _refreshInbox,
          onMarkItemRead: _markInboxItemRead,
          onMarkAllRead: _markAllInboxRead,
          onOpenItem: (item) => unawaited(_openInboxItem(item)),
          onOpenPerson: _openPerson,
          onOpenCircles: () => setState(() => _drawer = _ActiveDrawer.circles),
          onOpenSpaces: () => setState(() => _drawer = _ActiveDrawer.spaces),
          onOpenAccount: () => setState(() => _drawer = _ActiveDrawer.account),
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.person:
        final personPk = _inspectedPersonPubkey;
        if (personPk == null) return null;
        return PersonMarginSheet(
          pubkey: personPk,
          relayUrls: _activeRelayUrls,
          isCurrentUser: _account?.pubkey == personPk,
          initialProfile: _profilesByPubkey[personPk],
          catalogMaps: _catalog?.maps ?? const <MapSummaryDto>[],
          catalogStories: _catalog?.stories ?? const <StorySummaryDto>[],
          catalogAtlases: _catalog?.atlases ?? const <AtlasSummaryDto>[],
          shelfAddresses: _shelfMaps.map((e) => e.summary.address).toSet(),
          onProfileResolved: (p) {
            if (mounted) setState(() => _profilesByPubkey[p.pubkey] = p);
          },
          onToggleMapOnShelf: _toggleMapOnShelf,
          onInspectMap: _inspectMap,
          onFocusMap: _flyToMap,
          onOpenStory: (story) {
            _recordRecentEntity('story:${story.address}');
            unawaited(_openStory(story));
          },
          onInspectAtlas: _inspectAtlas,
          onEnterAtlasLens: _enterAtlasLens,
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.account:
        return AccountSessionSheet(
          account: _account,
          localNsec: _localNsec,
          bunkerUri: _bunkerUri,
          blossomServerUrl: _blossomServerUrl,
          onBlossomServerChanged: (url) {
            setState(() => _blossomServerUrl = url);
            unawaited(_persistAppSettings());
          },
          onUploadBlossomImage: _pickAndUploadBlossomImage,
          profile: _account != null ? _profilesByPubkey[_account!.pubkey] : null,
          activeSessionSummary: _activeSessionSummaryText,
          onAccountChanged: (account) {
            setState(() {
              _account = account;
              if (account == null) {
                _localNsec = null;
                _bunkerUri = null;
                _bunkerClientNsec = null;
              }
            });
            unawaited(_persistAppSettings());
            unawaited(_refreshCirclesSnapshot());
            unawaited(_refreshInbox());
            if (account != null) {
              unawaited(
                fetchProfiles(
                  relayUrls: _activeRelayUrls,
                  pubkeys: [account.pubkey],
                ).then((list) {
                  if (!mounted || list.isEmpty) return;
                  setState(() => _profilesByPubkey[list.first.pubkey] = list.first);
                }),
              );
            }
          },
          onLocalKeyChanged: (kp) {
            setState(() {
              if (kp == null) {
                _localNsec = null;
              } else {
                _account = Nip55Account(pubkey: kp.pubkeyHex);
                _localNsec = kp.nsec;
                _bunkerUri = null;
                _bunkerClientNsec = null;
              }
            });
            unawaited(_persistAppSettings());
            unawaited(_refreshCirclesSnapshot());
            unawaited(_refreshInbox());
          },
          onBunkerConnected: (conn) {
            setState(() {
              if (conn == null) {
                _bunkerUri = null;
                _bunkerClientNsec = null;
              } else {
                _account = Nip55Account(pubkey: conn.userPubkeyHex);
                _localNsec = null;
                _bunkerUri = conn.bunkerUri;
                _bunkerClientNsec = conn.clientNsec;
              }
            });
            unawaited(_persistAppSettings());
            unawaited(_refreshCirclesSnapshot());
            unawaited(_refreshInbox());
            if (conn != null) {
              unawaited(
                fetchProfiles(
                  relayUrls: _activeRelayUrls,
                  pubkeys: [conn.userPubkeyHex],
                ).then((list) {
                  if (!mounted || list.isEmpty) return;
                  setState(() => _profilesByPubkey[list.first.pubkey] = list.first);
                }),
              );
            }
          },
          onSaveProfile: _publishProfile,
          onOpenSpaces: () => setState(() => _drawer = _ActiveDrawer.spaces),
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.search:
        return PlaceSearchSheet(
          onJumpToPlace: _jumpToPlace,
          onJumpToNaddr: _jumpToNaddr,
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.agent:
        return AgentDrawer(
          messages: _agentMessages,
          settings: _agentSettings,
          busy: _agentBusy,
          onSettingsChanged: (s) {
            setState(() => _agentSettings = s);
            unawaited(_persistAppSettings());
          },
          onSendPrompt: (p) => unawaited(_sendAgentPrompt(p)),
          onClearChat: () => setState(() => _agentMessages.clear()),
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.storyReader:
        if (_activeStory == null || _parsedStory == null) return null;
        return StoryReaderMargin(
          story: _activeStory!,
          relayUrls: _activeRelayUrls,
          parsed: _parsedStory!,
          datasetsByAddress: _storyDatasets,
          decodedRefsByToken: _storyDecodedRefs,
          loadingLinkedMaps: _loadingStoryMaps,
          activeViewIndex: _activeStoryViewIndex,
          calloutCount: visibleCalloutCount,
          onSelectViewIndex: _selectStoryView,
          onFocusDataset: (entry) {
            setState(() {
              _focusedStoryDatasetAddress = entry.summary.address;
              _focusedStoryFeatureId = null;
            });
            _flyToMap(entry.summary);
          },
          onActivateNaddrRef: _activateStoryNaddrRef,
          onActivateGeoRef: _activateStoryGeoRef,
          onFitAllGeometry: () {
            final bounds = computeCombinedBounds(_storyDatasets.values);
            if (bounds != null) _flyToBounds(bounds);
          },
          onOpenDiscussion: () => _openDiscussion(
            DiscussionTarget(
              address: _activeStory!.address,
              kind: 37520,
              pubkey: _activeStory!.pubkey,
              title: _activeStory!.title,
              eventId: _activeStory!.eventId,
            ),
          ),
          onKeepOnShelf: _keepStoryMapsOnShelf,
          isOwned: _account != null && _account!.pubkey == _activeStory!.pubkey,
          authorLabel: _profilesByPubkey[_activeStory!.pubkey]?.displayName ??
              _profilesByPubkey[_activeStory!.pubkey]?.name,
          onOpenPerson: _openPerson,
          onEditStory: () => setState(() {
            _editingStory = _activeStory;
            _drawer = _ActiveDrawer.storyComposer;
          }),
          onDeleteStory: () => _deleteOwnedStory(_activeStory!),
          onClose: _closeStory,
        );
      case _ActiveDrawer.storyComposer:
        return StoryComposerDrawer(
          key: ValueKey(_editingStory?.address ?? 'new-story'),
          shelfMaps: _shelfMaps,
          editingStory: _editingStory,
          onUploadBlossomImage: _pickAndUploadBlossomImage,
          getCameraSnapshot: () => _controller?.camera,
          onPublishStory: _publishStory,
          onClose: () => setState(() {
            _editingStory = null;
            _drawer = _ActiveDrawer.none;
          }),
        );
      case _ActiveDrawer.atlasComposer:
        return AtlasComposerSheet(
          key: ValueKey(_editingAtlas?.address ?? 'new-atlas'),
          shelfMaps: _shelfMaps,
          catalogMaps: _catalog?.maps ?? const <MapSummaryDto>[],
          catalogStories: _catalog?.stories ?? const <StorySummaryDto>[],
          editingAtlas: _editingAtlas,
          onUploadBlossomImage: _pickAndUploadBlossomImage,
          onPublishAtlas: _publishAtlas,
          onClose: () => setState(() {
            _editingAtlas = null;
            _drawer = _ActiveDrawer.none;
          }),
        );
      case _ActiveDrawer.atlasDetail:
        final atlas = _inspectedAtlas ?? _activeAtlasLens;
        if (atlas == null) return null;
        return AtlasDetailMargin(
          atlas: atlas,
          relayUrls: _activeRelayUrls,
          catalogMaps: _catalog?.maps ?? const <MapSummaryDto>[],
          catalogStories: _catalog?.stories ?? const <StorySummaryDto>[],
          shelfAddresses: _shelfMaps.map((e) => e.summary.address).toSet(),
          profilesByPubkey: _profilesByPubkey,
          isActiveLens: _activeAtlasLens?.address == atlas.address,
          isOwned: _account != null && _account!.pubkey == atlas.pubkey,
          onOpenPerson: _openPerson,
          onEditAtlas: () => setState(() {
            _editingAtlas = atlas;
            _drawer = _ActiveDrawer.atlasComposer;
          }),
          onDeleteAtlas: () => _deleteOwnedAtlas(atlas),
          onToggleLens: () {
            if (_activeAtlasLens?.address == atlas.address) {
              _leaveAtlasLens();
            } else {
              _enterAtlasLens(atlas);
            }
          },
          onShowAllOnMap: () => unawaited(_openAtlas(atlas)),
          onToggleMapOnShelf: _toggleMapOnShelf,
          onFocusMap: _flyToMap,
          onOpenStory: (story) {
            _recordRecentEntity('story:${story.address}');
            unawaited(_openStory(story));
          },
          onOpenDiscussion: () => _openDiscussion(
            DiscussionTarget(
              address: atlas.address,
              kind: 37518,
              pubkey: atlas.pubkey,
              title: atlas.name,
              eventId: atlas.eventId,
            ),
          ),
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.datasetDetail:
        final map = _inspectedMap;
        if (map == null) return null;
        return DatasetDetailMargin(
          map: map,
          relayUrls: _activeRelayUrls,
          onShelf: _shelfMaps.any((e) => e.summary.address == map.address),
          isOwned: _account != null && _account!.pubkey == map.pubkey,
          authorProfile: _profilesByPubkey[map.pubkey],
          onToggleOnShelf: () => _toggleMapOnShelf(map),
          onZoomToMap: () {
            if (!_shelfMaps.any((e) => e.summary.address == map.address)) {
              _toggleMapOnShelf(map);
            } else {
              _flyToMap(map);
            }
          },
          onJumpToFeature: (shape) => _jumpToMapFeature(map, shape),
          onEditOrForkMap: () => _editOrForkMap(map),
          onOpenDiscussion: () => _openDiscussion(
            DiscussionTarget(
              address: map.address,
              kind: 37515,
              pubkey: map.pubkey,
              title: map.title,
              eventId: map.eventId,
              baseGeojson: map.geojson,
            ),
          ),
          onDeleteMap: _deleteOwnedMap,
          onOpenPerson: _openPerson,
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.inspector:
        final feature = _inspectedFeature;
        if (feature == null) return null;
        return FeatureInspectorSheet(
          feature: feature,
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
          onRenameDraftFeature: (featureId, newName) {
            setState(() {
              final idx = _features.indexWhere((f) => f.id == featureId);
              if (idx >= 0) {
                _features[idx] = _features[idx].copyWith(name: newName);
              }
            });
            _refreshInspectedDraftFeature(featureId);
            unawaited(_persistWorkingDraft());
          },
          onRecolorDraftFeature: (featureId, colorHex) {
            setState(() {
              final idx = _features.indexWhere((f) => f.id == featureId);
              if (idx >= 0) {
                _features[idx] = _features[idx].copyWith(colorHex: colorHex);
              }
            });
            _refreshInspectedDraftFeature(featureId);
            unawaited(_persistWorkingDraft());
          },
          onUpdateDraftStyle: (
            featureId, {
            strokeWidth,
            fillOpacity,
            radius,
            lineDash,
            displayIcon,
            clearDisplayIcon = false,
            description,
          }) {
            setState(() {
              final idx = _features.indexWhere((f) => f.id == featureId);
              if (idx >= 0) {
                _features[idx] = _features[idx].copyWith(
                  strokeWidth: strokeWidth,
                  fillOpacity: fillOpacity,
                  radius: radius,
                  lineDash: lineDash,
                  displayIcon: displayIcon,
                  clearDisplayIcon: clearDisplayIcon,
                  description: description,
                );
              }
            });
            _refreshInspectedDraftFeature(featureId);
            unawaited(_persistWorkingDraft());
          },
          onEditDraftGeometry: _startEditingDraftFeature,
          onDeleteDraftFeature: (featureId) {
            setState(() => _features.removeWhere((f) => f.id == featureId));
            unawaited(_persistWorkingDraft());
          },
          onAddDraftCallout: (featureId, callout) {
            setState(() {
              final idx = _features.indexWhere((f) => f.id == featureId);
              if (idx >= 0) {
                _features[idx] = _features[idx].copyWith(
                  callouts: [..._features[idx].callouts, callout],
                );
              }
            });
            _refreshInspectedDraftFeature(featureId);
            unawaited(_persistWorkingDraft());
          },
          onRemoveDraftCallout: (featureId, calloutId) {
            setState(() {
              final idx = _features.indexWhere((f) => f.id == featureId);
              if (idx >= 0) {
                _features[idx] = _features[idx].copyWith(
                  callouts: _features[idx]
                      .callouts
                      .where((c) => c.id != calloutId)
                      .toList(growable: false),
                );
              }
            });
            _refreshInspectedDraftFeature(featureId);
            unawaited(_persistWorkingDraft());
          },
          onOpenDiscussion: (feature.datasetAddress != null &&
                  feature.datasetPubkey != null)
              ? () => _openDiscussion(
                    DiscussionTarget(
                      address: feature.datasetAddress!,
                      kind: 37515,
                      pubkey: feature.datasetPubkey!,
                      title: feature.datasetTitle ?? feature.sourceLabel,
                      eventId: feature.datasetEventId,
                      baseGeojson: feature.datasetGeojson,
                    ),
                  )
              : null,
          onCloneDatasetToDraft: (!feature.isDraft &&
                  feature.datasetGeojson != null &&
                  feature.datasetGeojson!.isNotEmpty)
              ? () => _cloneGeoJsonToDraft(
                    feature.datasetTitle ?? feature.sourceLabel,
                    feature.datasetGeojson!,
                  )
              : null,
          onShareFeature: (!feature.isDraft &&
                  feature.datasetAddress != null &&
                  feature.datasetPubkey != null)
              ? () {
                  final parts = feature.datasetAddress!.split(':');
                  final kind = int.tryParse(parts.first) ?? 37515;
                  final dTag = parts.length >= 3
                      ? parts.sublist(2).join(':')
                      : feature.sourceLabel;
                  unawaited(
                    RustBridge.ensureInitialized().then((_) async {
                      final uri = await encodeNaddrCoordinate(
                        kind: kind,
                        pubkeyHex: feature.datasetPubkey!,
                        dTag: dTag,
                        relays: _activeRelayUrls,
                        featureId: feature.featureId,
                      );
                      await Clipboard.setData(ClipboardData(text: uri));
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Copied nostr:naddr1… link'),
                          ),
                        );
                      }
                    }),
                  );
                }
              : null,
        );
      case _ActiveDrawer.discussion:
        final target = _discussionTarget;
        if (target == null) return null;
        return DiscussionMarginSheet(
          target: target,
          relayUrls: _activeRelayUrls,
          hasDraftGeometry: _features.isNotEmpty,
          activeCommentGeojsonId: _activeCommentOverlayId,
          activeProposalId: _activeProposalOverlayId,
          profilesByPubkey: _profilesByPubkey,
          currentUserPubkey: _account?.pubkey,
          onToggleCommentOverlay: (comment) {
            if (_activeCommentOverlayId == comment.eventId) {
              setState(() {
                _activeCommentOverlayId = null;
                _commentOverlayShapes = const [];
              });
              return;
            }
            final shapes = comment.geojson != null
                ? parseGeoJsonShapes(comment.geojson!, datasetTitle: 'Comment')
                : const <ShelfShape>[];
            setState(() {
              _activeCommentOverlayId = comment.eventId;
              _commentOverlayShapes = shapes;
            });
          },
          onToggleProposalOverlay: (proposal) {
            if (_activeProposalOverlayId == proposal.eventId) {
              setState(() {
                _activeProposalOverlayId = null;
                _activeProposalLabel = null;
                _proposalOverlayShapes = const [];
              });
              return;
            }
            final shapes = parseGeoJsonShapes(
              proposal.geojson,
              datasetTitle: proposal.description ?? 'Proposal',
            );
            setState(() {
              _activeProposalOverlayId = proposal.eventId;
              _activeProposalLabel =
                  'Proposal (${proposal.status}) +${proposal.addedCount} ~${proposal.modifiedCount} -${proposal.removedCount}';
              _proposalOverlayShapes = shapes;
            });
          },
          onPostComment: (text, attachDraft) =>
              _postComment(target, text, attachDraft),
          onSubmitProposal: (description) => _submitProposal(target, description),
          onLoadProposalToDraft: (proposal) => _cloneGeoJsonToDraft(
            '${target.title} (PR)',
            proposal.geojson,
          ),
          onApplyProposal: (proposal) => _applyProposal(target, proposal),
          onCloseProposal: (proposal) => _closeProposal(target, proposal),
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDesktop = MediaQuery.sizeOf(context).width >= 880;
    final systemIsDark = theme.brightness == Brightness.dark;
    final effectiveBasemap = _selectedBasemap ??
        (systemIsDark
            ? BasemapKind.openFreeMapDark
            : BasemapKind.openFreeMapLiberty);
    final isDarkMap = effectiveBasemap == BasemapKind.openFreeMapDark;

    final MapStyle mapStyle;
    if (effectiveBasemap == BasemapKind.offlinePmtiles &&
        _offlineBasemap != null) {
      mapStyle = MapStyle.json(_offlineBasemap!.styleJson);
    } else if (effectiveBasemap == BasemapKind.openFreeMapDark) {
      mapStyle = const MapStyle.url(_openFreeMapDark);
    } else {
      mapStyle = const MapStyle.url(_openFreeMapLiberty);
    }

    final gestures = _activeMapGestures;

    ActiveStoryRenderContext? activeStoryContext;
    if (_activeStory != null && _parsedStory != null) {
      final layers = (_activeStoryViewIndex != null &&
              _activeStoryViewIndex! < _parsedStory!.viewSnapshots.length)
          ? _parsedStory!.viewSnapshots[_activeStoryViewIndex!].layers
          : _parsedStory!.baseLayers;
      activeStoryContext = ActiveStoryRenderContext(
        story: _activeStory!,
        datasetsByAddress: _storyDatasets,
        presentationLayers: layers,
        focusedDatasetAddress: _focusedStoryDatasetAddress,
        focusedFeatureId: _focusedStoryFeatureId,
        geoPins: _storyGeoPins,
      );
    }

    final visibleSightings = _allSightings;
    final visibleBeacons = _allBeacons;
    final visibleCallouts = collectVisibleCallouts(
      shelfMaps: _shelfMaps,
      draftFeatures: _features,
      activeStory: activeStoryContext,
    );
    final visibleIconPins = collectVisibleIconPins(
      shelfMaps: _shelfMaps,
      draftAccentColor: theme.colorScheme.primary,
      draftFeatures: _features,
      activeStory: activeStoryContext,
    );

    final gpuLayers = buildEarthlyGpuLayers(
      shelfMaps: _shelfMaps,
      sightings: visibleSightings,
      beacons: visibleBeacons,
      draftFeatures: _features,
      accentColor: theme.colorScheme.primary,
      isDarkMap: isDarkMap,
      showLabels:
          _showLabels && effectiveBasemap != BasemapKind.offlinePmtiles,
      onInspectFeature: _inspectFeature,
      activeStory: activeStoryContext,
      commentOverlayShapes: _commentOverlayShapes,
      proposalOverlayShapes: _proposalOverlayShapes,
    );

    final activeDrawerWidget = _buildActiveDrawer(visibleCallouts.length);
    final hideBottomDockOnMobile =
        !isDesktop && activeDrawerWidget != null && !_isDrawingMode;
    final bottomSafeInset = MediaQuery.paddingOf(context).bottom;
    final screenHeight = MediaQuery.sizeOf(context).height;
    final rightThumbRailBottom = hideBottomDockOnMobile
        ? (screenHeight * 0.54).clamp(180.0, screenHeight - 220.0)
        : bottomSafeInset + (_isDrawingMode ? 76.0 : 74.0);

    final mapWidget = widget.mapBuilder != null
        ? widget.mapBuilder!(
            context,
            gestures,
            (controller) => setState(() => _controller = controller),
            () => setState(() {}),
          )
        : MapLibreMap(
            options: MapOptions(
              style: mapStyle,
              initCamera: CameraUpdate.position(
                center: const Geographic(lon: 16.3738, lat: 48.2082),
                zoom: 13.5,
              ),
              gestures: gestures,
            ),
            onMapCreated: (controller) =>
                setState(() => _controller = controller),
            layers: gpuLayers,
            children: [
              EarthlyCalloutOverlay(
                callouts: visibleCallouts,
                sightings: visibleSightings,
                iconPins: visibleIconPins,
                displayMode: _calloutMode,
                bottomInset:
                    (hideBottomDockOnMobile ? 340 : 108) + bottomSafeInset,
                onInspectFeature: _inspectFeature,
                onInspectSighting: _inspectSighting,
              ),
              MapGeometryLayer(
                features: _features,
                draftVertices: _draftVertices,
                mode: _mode,
                previewScreen: _previewScreen,
                snapped: _previewSnapped,
                loupeActive: _previewLoupeActive,
              ),
            ],
          );

    return CallbackShortcuts(
      bindings: <ShortcutActivator, VoidCallback>{
        const SingleActivator(LogicalKeyboardKey.escape): () {
          if (_isDrawingMode) {
            _cancelEditingDraftFeature();
          } else if (_drawer != _ActiveDrawer.none) {
            setState(() => _drawer = _ActiveDrawer.none);
          }
        },
        const SingleActivator(LogicalKeyboardKey.keyZ, meta: true): () {
          if (_isDrawingMode) _undoLastPoint();
        },
        const SingleActivator(LogicalKeyboardKey.keyZ, control: true): () {
          if (_isDrawingMode) _undoLastPoint();
        },
        const SingleActivator(LogicalKeyboardKey.digit1, meta: true): () =>
            _selectMode(DrawToolMode.point),
        const SingleActivator(LogicalKeyboardKey.digit2, meta: true): () =>
            _selectMode(DrawToolMode.line),
        const SingleActivator(LogicalKeyboardKey.digit3, meta: true): () =>
            _selectMode(DrawToolMode.polygon),
      },
      child: Focus(
        autofocus: true,
        child: Scaffold(
          body: Stack(
        fit: StackFit.expand,
        children: [
          mapWidget,

          // Zero-lock touch drawing & GPU loupe overlay.
          TouchDrawOverlay(
            controller: _controller,
            mode: _mode,
            placementStyle: _placementStyle,
            loupeEnabled: _loupeEnabled,
            features: _features,
            draftVertices: _draftVertices,
            onCommitVertex: _commitVertex,
            onUpdateDraftVertex: (index, pos) {
              if (index >= 0 && index < _draftVertices.length) {
                setState(() => _draftVertices[index] = pos);
                if (_mode == DrawToolMode.measure) {
                  unawaited(_recomputeMeasureTelemetry());
                }
              }
            },
            onInsertDraftVertex: (insertIndex, pos) {
              setState(() => _draftVertices.insert(insertIndex, pos));
              if (_mode == DrawToolMode.measure) {
                unawaited(_recomputeMeasureTelemetry());
              }
            },
            onTwoFingerUndo: _undoLastPoint,
            onPreviewChanged: (screen, snapped, loupeActive) {
              setState(() {
                _previewScreen = screen;
                _previewSnapped = snapped;
                _previewLoupeActive = loupeActive;
              });
            },
          ),

          // Top frosted-glass instrument bar (Field Posture on mobile; full Studio bar on Desktop)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
                child: Row(
                  children: [
                    Flexible(
                      fit: isDesktop ? FlexFit.loose : FlexFit.tight,
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: GestureDetector(
                          key: const Key('earthly-brand-pill'),
                          onTap: () =>
                              _openEarthlyCommandSheet(effectiveBasemap),
                          child: EarthlyGlassSurface(
                            borderRadius: BorderRadius.circular(999),
                            padding: const EdgeInsets.fromLTRB(7, 5, 10, 5),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (!_isDrawingMode) ...[
                                  Container(
                                    width: 24,
                                    height: 24,
                                    decoration: const BoxDecoration(
                                      color: EarthlyColors.amber,
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(
                                      Icons.explore,
                                      size: 15,
                                      color: EarthlyColors.amberInk,
                                    ),
                                  ),
                                  const SizedBox(width: 7),
                                  Text(
                                    'EARTHLY',
                                    style:
                                        theme.textTheme.labelMedium?.copyWith(
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: 1.1,
                                    ),
                                  ),
                                  if (_relayStreamLive) ...[
                                    const SizedBox(width: 6),
                                    Container(
                                      width: 7,
                                      height: 7,
                                      decoration: BoxDecoration(
                                        color: EarthlyColors.commentGreen,
                                        shape: BoxShape.circle,
                                        boxShadow: [
                                          BoxShadow(
                                            color: EarthlyColors.commentGreen
                                                .withValues(alpha: 0.65),
                                            blurRadius: 6,
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                  const SizedBox(width: 6),
                                ],
                                Flexible(
                                  child: Text(
                                    isDesktop
                                        ? '${_shelfMaps.length} shelf · ${_features.length} draft${visibleBeacons.isNotEmpty ? ' · ${visibleBeacons.length} live' : ''}'
                                        : '${_shelfMaps.length}·${_features.length}${visibleBeacons.isNotEmpty ? '·${visibleBeacons.length}' : ''}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 3),
                                Icon(
                                  Icons.keyboard_arrow_down,
                                  size: 15,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                    if (isDesktop && !_isDrawingMode) ...[
                      const SizedBox(width: 10),
                      _MiniToggle(
                        label: 'Explore',
                        icon: Icons.explore_outlined,
                        active: _drawer == _ActiveDrawer.explore,
                        onTap: () => _toggleDrawer(_ActiveDrawer.explore),
                      ),
                      const SizedBox(width: 6),
                      _MiniToggle(
                        label: 'Desk',
                        icon: Icons.layers_outlined,
                        active: _drawer == _ActiveDrawer.desk,
                        onTap: () => _toggleDrawer(_ActiveDrawer.desk),
                      ),
                      const SizedBox(width: 6),
                      _MiniToggle(
                        label: _pendingClaimCount > 0
                            ? 'Spaces ($_pendingClaimCount)'
                            : 'Spaces',
                        icon: Icons.hub_outlined,
                        active: _drawer == _ActiveDrawer.spaces ||
                            _pendingClaimCount > 0,
                        onTap: () => _toggleDrawer(_ActiveDrawer.spaces),
                      ),
                      const SizedBox(width: 6),
                      _MiniToggle(
                        label: _circlePendingJoins.isNotEmpty
                            ? 'Circles (${_circlePendingJoins.length})'
                            : 'Circles',
                        icon: Icons.lock_outline,
                        active: _drawer == _ActiveDrawer.circles ||
                            _activeCircleLensId != null,
                        onTap: () => _toggleDrawer(_ActiveDrawer.circles),
                      ),
                      const SizedBox(width: 6),
                      _MiniToggle(
                        label: _inboxUnreadCount > 0
                            ? 'Inbox ($_inboxUnreadCount)'
                            : 'Inbox',
                        icon: Icons.inbox_outlined,
                        active: _drawer == _ActiveDrawer.inbox ||
                            _inboxUnreadCount > 0,
                        onTap: () {
                          _toggleDrawer(_ActiveDrawer.inbox);
                          if (_drawer == _ActiveDrawer.inbox) {
                            unawaited(_refreshInbox());
                          }
                        },
                      ),
                      const SizedBox(width: 6),
                      _MiniToggle(
                        label: 'Agent',
                        icon: Icons.auto_awesome,
                        active: _drawer == _ActiveDrawer.agent,
                        onTap: () => _toggleDrawer(_ActiveDrawer.agent),
                      ),
                      const SizedBox(width: 6),
                      _MiniToggle(
                        label: 'Draw',
                        icon: Icons.edit,
                        active: true,
                        onTap: () => _selectMode(DrawToolMode.line),
                      ),
                    ],
                    if (isDesktop) const Spacer() else const SizedBox(width: 8),
                    if (isDesktop && _isDrawingMode) ...[
                      _MiniToggle(
                        label: _placementStyle == TouchPlacementStyle.drawDrag
                            ? 'Draw-Drag'
                            : 'Crosshair',
                        icon: _placementStyle == TouchPlacementStyle.drawDrag
                            ? Icons.touch_app
                            : Icons.gps_fixed,
                        active: true,
                        onTap: () => setState(() {
                          _placementStyle =
                              _placementStyle == TouchPlacementStyle.drawDrag
                                  ? TouchPlacementStyle.crosshair
                                  : TouchPlacementStyle.drawDrag;
                        }),
                      ),
                      const SizedBox(width: 6),
                      _MiniToggle(
                        label: 'Loupe',
                        icon: Icons.zoom_in,
                        active: _loupeEnabled,
                        onTap: () =>
                            setState(() => _loupeEnabled = !_loupeEnabled),
                      ),
                    ] else if (!_isDrawingMode) ...[
                      if (isDesktop && visibleCallouts.isNotEmpty) ...[
                        _MiniToggle(
                          label: calloutModeShortLabel(_calloutMode),
                          icon: Icons.chat_bubble_outline,
                          active: _calloutMode != CalloutDisplayMode.hidden,
                          onTap: () => setState(
                            () => _calloutMode =
                                nextCalloutDisplayMode(_calloutMode),
                          ),
                        ),
                        const SizedBox(width: 6),
                      ],
                      _MiniIconButton(
                        tooltip: 'Search Place / Coords / naddr',
                        icon: Icons.search,
                        active: _drawer == _ActiveDrawer.search,
                        onTap: () => _toggleDrawer(_ActiveDrawer.search),
                      ),
                      if (isDesktop) ...[
                        const SizedBox(width: 6),
                        _MiniIconButton(
                          tooltip: 'Measure Distance & Area',
                          icon: Icons.straighten,
                          active: _isMeasureMode,
                          onTap: _toggleMeasureMode,
                        ),
                        const SizedBox(width: 6),
                        _MiniIconButton(
                          tooltip: 'Basemap & Overlays',
                          icon: Icons.map_outlined,
                          active:
                              effectiveBasemap == BasemapKind.offlinePmtiles,
                          onTap: () => _openBasemapSwitcher(effectiveBasemap),
                        ),
                      ],
                      const SizedBox(width: 6),
                      if (isDesktop)
                        _MiniToggle(
                          label: _accountChipLabel,
                          icon: _account != null
                              ? Icons.verified_user
                              : Icons.account_circle_outlined,
                          active: _drawer == _ActiveDrawer.account,
                          onTap: () => _toggleDrawer(_ActiveDrawer.account),
                        )
                      else
                        _MiniIconButton(
                          tooltip: _account != null
                              ? 'Account ($_accountChipLabel)'
                              : 'Account & Session',
                          icon: _account != null
                              ? Icons.verified_user
                              : Icons.account_circle_outlined,
                          active: _drawer == _ActiveDrawer.account ||
                              _account != null,
                          onTap: () => _toggleDrawer(_ActiveDrawer.account),
                        ),
                    ],
                  ],
                ),
              ),
            ),
          ),

          // Right-thumb uniform icon-only Map Controls Rail on Mobile (strictly 46x46 frosted squircles!)
          if (!isDesktop)
            Positioned(
              key: const Key('earthly-right-thumb-rail'),
              right: 12,
              bottom: rightThumbRailBottom,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (_isDrawingMode) ...[
                    _ThumbMapButton(
                      tooltip: _placementStyle == TouchPlacementStyle.drawDrag
                          ? 'Draw-Drag'
                          : 'Crosshair',
                      icon: _placementStyle == TouchPlacementStyle.drawDrag
                          ? Icons.touch_app
                          : Icons.gps_fixed,
                      active: true,
                      onTap: () => setState(() {
                        _placementStyle =
                            _placementStyle == TouchPlacementStyle.drawDrag
                                ? TouchPlacementStyle.crosshair
                                : TouchPlacementStyle.drawDrag;
                      }),
                    ),
                    const SizedBox(height: 8),
                    _ThumbMapButton(
                      tooltip: 'Loupe',
                      icon: Icons.zoom_in,
                      active: _loupeEnabled,
                      onTap: () =>
                          setState(() => _loupeEnabled = !_loupeEnabled),
                    ),
                  ] else ...[
                    _ThumbMapButton(
                      tooltip: 'Measure',
                      icon: Icons.straighten,
                      active: _isMeasureMode,
                      activeBackground: EarthlyColors.measureViolet,
                      activeForeground: Colors.white,
                      onTap: _toggleMeasureMode,
                    ),
                    const SizedBox(height: 8),
                    _ThumbMapButton(
                      tooltip: 'Map Style & Overlays',
                      icon: Icons.layers_outlined,
                      active: effectiveBasemap == BasemapKind.offlinePmtiles,
                      onTap: () => _openBasemapSwitcher(effectiveBasemap),
                    ),
                    const SizedBox(height: 8),
                    _ThumbMapButton(
                      tooltip: switch (_calloutMode) {
                        CalloutDisplayMode.full => 'Callouts: Full',
                        CalloutDisplayMode.compact => 'Callouts: Compact',
                        CalloutDisplayMode.pins => 'Callouts: Pins',
                        CalloutDisplayMode.hidden => 'Callouts: Off',
                      },
                      icon: switch (_calloutMode) {
                        CalloutDisplayMode.full => Icons.chat_bubble_outline,
                        CalloutDisplayMode.compact => Icons.short_text,
                        CalloutDisplayMode.pins => Icons.push_pin_outlined,
                        CalloutDisplayMode.hidden =>
                          Icons.comments_disabled_outlined,
                      },
                      active: _calloutMode != CalloutDisplayMode.hidden &&
                          visibleCallouts.isNotEmpty,
                      badgeDotColor: _calloutMode == CalloutDisplayMode.hidden
                          ? null
                          : EarthlyColors.amber,
                      onTap: () => setState(
                        () => _calloutMode =
                            nextCalloutDisplayMode(_calloutMode),
                      ),
                    ),
                  ],
                  if (Platform.isAndroid) ...[
                    const SizedBox(height: 8),
                    _ThumbMapButton(
                      tooltip: 'Center on GPS',
                      icon: Icons.my_location,
                      active: false,
                      onTap: () => unawaited(_locateMe()),
                    ),
                  ],
                ],
              ),
            ),

          // Active Atlas Lens Bar (matches Web's `.earthly-lensbar`: signals Atlas-scoped browse & authoring)
          if (_activeAtlasLens != null && !_isDrawingMode)
            Positioned(
              key: const Key('earthly-atlas-lens-bar'),
              top: 62,
              left: isDesktop && activeDrawerWidget != null ? 440 : 12,
              right: 12,
              child: SafeArea(
                bottom: false,
                child: Align(
                  alignment: Alignment.topLeft,
                  child: EarthlyGlassSurface(
                    borderRadius: BorderRadius.circular(14),
                    color: EarthlyColors.amber.withValues(
                      alpha: systemIsDark ? 0.24 : 0.92,
                    ),
                    borderColor: EarthlyColors.amber,
                    borderWidth: 1.4,
                    padding: const EdgeInsets.fromLTRB(10, 6, 6, 6),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.public,
                          size: 16,
                          color: systemIsDark
                              ? EarthlyColors.amber
                              : EarthlyColors.amberInk,
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _activeAtlasLens!.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w800,
                                  color: systemIsDark
                                      ? EarthlyColors.darkInk
                                      : EarthlyColors.amberInk,
                                ),
                              ),
                              Text(
                                '${_activeAtlasLens!.pinnedAddresses.length} pinned · ${_activeAtlasLens!.governance} · Atlas Lens',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 9.5,
                                  color: (systemIsDark
                                          ? EarthlyColors.darkInk
                                          : EarthlyColors.amberInk)
                                      .withValues(alpha: 0.8),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        TextButton(
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                            foregroundColor: systemIsDark
                                ? EarthlyColors.amber
                                : EarthlyColors.amberInk,
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                          ),
                          onPressed: () => _inspectAtlas(_activeAtlasLens!),
                          child: const Text('About'),
                        ),
                        IconButton(
                          tooltip: 'Leave Atlas Lens',
                          visualDensity: VisualDensity.compact,
                          onPressed: _leaveAtlasLens,
                          icon: Icon(
                            Icons.close,
                            size: 16,
                            color: systemIsDark
                                ? EarthlyColors.darkInk
                                : EarthlyColors.amberInk,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

          // Active Circle Lens Bar (MLS-encrypted private workspace scoping & indicator)
          if (_activeCircleLens != null && !_isDrawingMode)
            Positioned(
              key: const Key('earthly-circle-lens-bar'),
              top: _activeAtlasLens != null ? 114 : 62,
              left: isDesktop && activeDrawerWidget != null ? 440 : 12,
              right: 12,
              child: SafeArea(
                bottom: false,
                child: Align(
                  alignment: Alignment.topLeft,
                  child: EarthlyGlassSurface(
                    borderRadius: BorderRadius.circular(14),
                    color: EarthlyColors.measureViolet.withValues(
                      alpha: systemIsDark ? 0.28 : 0.92,
                    ),
                    borderColor: EarthlyColors.measureViolet,
                    borderWidth: 1.4,
                    padding: const EdgeInsets.fromLTRB(10, 6, 6, 6),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.lock,
                          size: 15,
                          color: Colors.white,
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _activeCircleLens!.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w800,
                                  color: Colors.white,
                                ),
                              ),
                              Text(
                                '${_activeCircleLens!.datasets.length} maps · ${_activeCircleLens!.members.length} members · epoch ${_activeCircleLens!.epoch} · MLS',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 9.5,
                                  color: Colors.white.withValues(alpha: 0.85),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        TextButton(
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                          ),
                          onPressed: () => setState(() {
                            _selectedCircleId = _activeCircleLens!.workspaceId;
                            _drawer = _ActiveDrawer.circles;
                          }),
                          child: const Text('Open'),
                        ),
                        IconButton(
                          tooltip: 'Leave Circle Lens',
                          visualDensity: VisualDensity.compact,
                          onPressed: _leaveCircleLens,
                          icon: const Icon(
                            Icons.close,
                            size: 16,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

          // Active Proposal / Comment map overlay banner
          if ((_activeProposalLabel != null || _activeCommentOverlayId != null) &&
              !_isDrawingMode)
            Positioned(
              top: 66,
              left: isDesktop && activeDrawerWidget != null ? 440 : 12,
              right: 12,
              child: SafeArea(
                bottom: false,
                child: Align(
                  alignment: Alignment.topLeft,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: (_activeProposalLabel != null
                              ? EarthlyColors.proposedAmber
                              : EarthlyColors.commentGreen)
                          .withValues(alpha: 0.94),
                      borderRadius: BorderRadius.circular(999),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.22),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _activeProposalLabel ?? 'Comment geometry overlay',
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(width: 8),
                        GestureDetector(
                          onTap: () => setState(() {
                            _activeProposalOverlayId = null;
                            _activeProposalLabel = null;
                            _proposalOverlayShapes = const [];
                            _activeCommentOverlayId = null;
                            _commentOverlayShapes = const [];
                          }),
                          child: const Icon(
                            Icons.close,
                            size: 14,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

          // Precision Draw-Drag Measure Ruler live HUD pill
          if (_isMeasureMode)
            Positioned(
              top: 66,
              left: 12,
              right: 12,
              child: SafeArea(
                bottom: false,
                child: Align(
                  alignment: Alignment.topCenter,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: EarthlyColors.measureViolet.withValues(alpha: 0.95),
                      borderRadius: BorderRadius.circular(999),
                      boxShadow: [
                        BoxShadow(
                          color: EarthlyColors.measureViolet
                              .withValues(alpha: 0.35),
                          blurRadius: 16,
                          offset: const Offset(0, 5),
                        ),
                      ],
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.straighten,
                          size: 15,
                          color: Colors.white,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _draftVertices.isEmpty
                              ? 'Drag with 1 finger to place vertices'
                              : _draftVertices.length < 3
                                  ? '${DrawingMath.formatDistance(_measureDistanceMeters)} (${_draftVertices.length} pts)'
                                  : '${DrawingMath.formatDistance(_measureDistanceMeters)} · ${(_measureAreaM2 / 10000).toStringAsFixed(2)} ha',
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        if (_draftVertices.isNotEmpty) ...[
                          const SizedBox(width: 8),
                          GestureDetector(
                            onTap: () => setState(() {
                              _draftVertices.clear();
                              _measureDistanceMeters = 0.0;
                              _measureAreaM2 = 0.0;
                            }),
                            child: const Text(
                              'CLEAR',
                              style: TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                                color: Colors.white70,
                              ),
                            ),
                          ),
                        ],
                        const SizedBox(width: 8),
                        GestureDetector(
                          onTap: _toggleMeasureMode,
                          child: const Icon(
                            Icons.close,
                            size: 15,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

          // Contextual floating guidance pill while drawing
          if (_isDrawingMode)
            Positioned(
              left: 14,
              right: 70,
              bottom: 84 + bottomSafeInset,
              child: Align(
                alignment: Alignment.bottomLeft,
                child: EarthlyGlassSurface(
                  borderRadius: BorderRadius.circular(999),
                  color: EarthlyColors.darkSurface.withValues(alpha: 0.88),
                  borderColor: Colors.white.withValues(alpha: 0.14),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 7,
                  ),
                  child: Text(
                    _placementStyle == TouchPlacementStyle.drawDrag
                        ? '1 finger: place & drag · 2 fingers: pan/zoom · 2-finger tap: undo'
                        : 'Pan map under reticle · tap Drop to place',
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 10.5,
                      color: EarthlyColors.darkInk,
                    ),
                  ),
                ),
              ),
            ),

          // Unified Google-Maps-style independent bottom drawer (mobile) or docked left Margin (desktop)
          ?activeDrawerWidget,

          // Frosted-Glass Bottom Dock: surface extends flush to bottom: 0 behind gesture pill & rounded corners;
          // SafeArea pads ONLY the inner row so there is NEVER a gap on any phone screen shape!
          if (!hideBottomDockOnMobile && (!isDesktop || _isDrawingMode))
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: ClipRect(
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
                  child: Container(
                    key: const Key('earthly-bottom-dock'),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surface.withValues(
                        alpha: systemIsDark ? 0.90 : 0.93,
                      ),
                      border: Border(
                        top: BorderSide(
                          color: systemIsDark
                              ? Colors.white.withValues(alpha: 0.12)
                              : Colors.black.withValues(alpha: 0.08),
                        ),
                      ),
                    ),
                    child: SafeArea(
                      top: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(8, 7, 8, 7),
                        child: _isDrawingMode
                      ? LayoutBuilder(
                          builder: (context, constraints) =>
                              SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: ConstrainedBox(
                              constraints: BoxConstraints(
                                minWidth: constraints.maxWidth,
                              ),
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      if (_isMeasureMode)
                                        const Padding(
                                          padding: EdgeInsets.symmetric(
                                            horizontal: 8,
                                          ),
                                          child: Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              Icon(
                                                Icons.straighten,
                                                size: 18,
                                                color: EarthlyColors.measureViolet,
                                              ),
                                              SizedBox(width: 6),
                                              Text(
                                                'MEASURE',
                                                style: TextStyle(
                                                  fontFamily: 'monospace',
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.w800,
                                                  color: EarthlyColors.measureViolet,
                                                ),
                                              ),
                                            ],
                                          ),
                                        )
                                      else ...[
                                        _DockTool(
                                          label: 'Point',
                                          icon: Icons.location_on_outlined,
                                          selected: _mode == DrawToolMode.point,
                                          onTap: () =>
                                              _selectMode(DrawToolMode.point),
                                        ),
                                        _DockTool(
                                          label: 'Line',
                                          icon: Icons.timeline,
                                          selected: _mode == DrawToolMode.line,
                                          onTap: () =>
                                              _selectMode(DrawToolMode.line),
                                        ),
                                        _DockTool(
                                          label: 'Area',
                                          icon: Icons.pentagon_outlined,
                                          selected:
                                              _mode == DrawToolMode.polygon,
                                          onTap: () =>
                                              _selectMode(DrawToolMode.polygon),
                                        ),
                                      ],
                                    ],
                                  ),
                                  const SizedBox(width: 8),
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      if (_placementStyle ==
                                          TouchPlacementStyle.crosshair) ...[
                                        FilledButton.icon(
                                          style: FilledButton.styleFrom(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 11,
                                              vertical: 8,
                                            ),
                                            minimumSize: const Size(0, 36),
                                          ),
                                          onPressed: _dropCrosshairPoint,
                                          icon: const Icon(
                                            Icons.add_location_alt,
                                            size: 16,
                                          ),
                                          label: const Text('Drop'),
                                        ),
                                        const SizedBox(width: 4),
                                      ],
                                      if (_canFinishDraft) ...[
                                        FilledButton(
                                          style: FilledButton.styleFrom(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 11,
                                              vertical: 8,
                                            ),
                                            minimumSize: const Size(0, 36),
                                          ),
                                          onPressed: _finishDraft,
                                          child: Text(
                                            _editingDraftFeature != null
                                                ? 'Save · ${_draftVertices.length}'
                                                : 'Finish · ${_draftVertices.length}',
                                          ),
                                        ),
                                        const SizedBox(width: 4),
                                      ],
                                      IconButton(
                                        tooltip: 'Undo',
                                        visualDensity: VisualDensity.compact,
                                        onPressed: (_draftVertices.isNotEmpty ||
                                                _features.isNotEmpty)
                                            ? _undoLastPoint
                                            : null,
                                        icon: const Icon(Icons.undo, size: 20),
                                      ),
                                      OutlinedButton(
                                        style: OutlinedButton.styleFrom(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 11,
                                            vertical: 8,
                                          ),
                                          minimumSize: const Size(0, 36),
                                        ),
                                        onPressed: _cancelEditingDraftFeature,
                                        child: Text(
                                          _editingDraftFeature != null
                                              ? 'Cancel'
                                              : 'Done',
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        )
                      : Row(
                          children: [
                            Expanded(
                              child: _DockTool(
                                label: 'Explore',
                                icon: Icons.explore_outlined,
                                selected: _drawer == _ActiveDrawer.explore,
                                onTap: () =>
                                    _toggleDrawer(_ActiveDrawer.explore),
                              ),
                            ),
                            Expanded(
                              child: _DockTool(
                                label: 'Desk',
                                icon: Icons.layers_outlined,
                                selected: _drawer == _ActiveDrawer.desk,
                                onTap: () => _toggleDrawer(_ActiveDrawer.desk),
                              ),
                            ),
                            Expanded(
                              child: _DockTool(
                                label: (_pendingClaimCount +
                                            _circlePendingJoins.length +
                                            _inboxUnreadCount) >
                                        0
                                    ? 'Spaces (${_pendingClaimCount + _circlePendingJoins.length + _inboxUnreadCount})'
                                    : 'Spaces',
                                icon: Icons.hub_outlined,
                                selected: _drawer == _ActiveDrawer.spaces ||
                                    _drawer == _ActiveDrawer.circles ||
                                    _drawer == _ActiveDrawer.inbox ||
                                    _pendingClaimCount > 0 ||
                                    _circlePendingJoins.isNotEmpty ||
                                    _inboxUnreadCount > 0,
                                onTap: () =>
                                    _toggleDrawer(_ActiveDrawer.spaces),
                              ),
                            ),
                            Expanded(
                              child: _DockTool(
                                label: 'Agent',
                                icon: Icons.auto_awesome,
                                selected: _drawer == _ActiveDrawer.agent,
                                onTap: () => _toggleDrawer(_ActiveDrawer.agent),
                              ),
                            ),
                            const SizedBox(width: 4),
                            Container(
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surfaceContainerHighest,
                                shape: BoxShape.circle,
                                border: Border.all(color: theme.dividerColor),
                              ),
                              child: IconButton(
                                tooltip: 'Drop Field Sighting',
                                visualDensity: VisualDensity.compact,
                                onPressed: _openSightingComposer,
                                icon: const Icon(
                                  Icons.add_a_photo_outlined,
                                  size: 18,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            FilledButton.icon(
                              style: FilledButton.styleFrom(
                                backgroundColor: EarthlyColors.amber,
                                foregroundColor: EarthlyColors.amberInk,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(13),
                                ),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 9,
                                ),
                                minimumSize: const Size(0, 40),
                              ),
                              onPressed: () => _selectMode(DrawToolMode.line),
                              icon: const Icon(Icons.edit, size: 15),
                              label: const Text('Draw'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    ),
    ),
    );
  }
}

/// Strictly uniform 46×46 icon-only frosted-glass squircle button for the
/// right-thumb map controls rail on phones (zero text labels -> identical sizing!).
class _ThumbMapButton extends StatelessWidget {
  const _ThumbMapButton({
    required this.tooltip,
    required this.icon,
    required this.active,
    required this.onTap,
    this.activeBackground,
    this.activeForeground,
    this.badgeDotColor,
  });

  final String tooltip;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;
  final Color? activeBackground;
  final Color? activeForeground;
  final Color? badgeDotColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final bg = active
        ? (activeBackground ?? EarthlyColors.amber)
        : (isDark
            ? EarthlyColors.darkSurface.withValues(alpha: 0.86)
            : EarthlyColors.lightSurface.withValues(alpha: 0.90));
    final fg = active
        ? (activeForeground ?? EarthlyColors.amberInk)
        : theme.colorScheme.onSurface;
    final borderColor = active
        ? (activeBackground ?? EarthlyColors.amber)
        : (isDark
            ? Colors.white.withValues(alpha: 0.14)
            : Colors.black.withValues(alpha: 0.10));

    return Tooltip(
      message: tooltip,
      child: SizedBox(
        width: 46,
        height: 46,
        child: EarthlyGlassSurface(
          borderRadius: BorderRadius.circular(14),
          color: bg,
          borderColor: borderColor,
          blurSigma: active ? 4 : 14,
          shadows: [
            BoxShadow(
              color: active
                  ? (activeBackground ?? EarthlyColors.amber)
                      .withValues(alpha: 0.34)
                  : Colors.black.withValues(alpha: isDark ? 0.42 : 0.16),
              blurRadius: active ? 14 : 14,
              offset: const Offset(0, 5),
            ),
          ],
          child: Material(
            type: MaterialType.transparency,
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: onTap,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Icon(icon, size: 20, color: fg),
                  if (badgeDotColor != null && !active)
                    Positioned(
                      top: 8,
                      right: 8,
                      child: Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: badgeDotColor,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _MiniIconButton extends StatelessWidget {
  const _MiniIconButton({
    required this.tooltip,
    required this.icon,
    required this.active,
    required this.onTap,
  });

  final String tooltip;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Tooltip(
      message: tooltip,
      child: SizedBox(
        width: 38,
        height: 38,
        child: EarthlyGlassSurface(
          borderRadius: BorderRadius.circular(12),
          color: active ? EarthlyColors.amber : null,
          borderColor: active ? EarthlyColors.amber : null,
          blurSigma: active ? 4 : 14,
          child: Material(
            type: MaterialType.transparency,
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: onTap,
              child: Center(
                child: Icon(
                  icon,
                  size: 18,
                  color: active
                      ? EarthlyColors.amberInk
                      : theme.colorScheme.onSurface,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _MiniToggle extends StatelessWidget {
  const _MiniToggle({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fg = active ? EarthlyColors.amberInk : theme.colorScheme.onSurface;

    return EarthlyGlassSurface(
      borderRadius: BorderRadius.circular(12),
      color: active ? EarthlyColors.amber : null,
      borderColor: active ? EarthlyColors.amber : null,
      blurSigma: active ? 4 : 14,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 15, color: fg),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DockTool extends StatelessWidget {
  const _DockTool({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final fg = selected
        ? (isDark ? EarthlyColors.amber : EarthlyColors.lightAccent)
        : theme.colorScheme.onSurfaceVariant;

    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          decoration: BoxDecoration(
            color: selected
                ? EarthlyColors.amber.withValues(alpha: isDark ? 0.18 : 0.16)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected
                  ? EarthlyColors.amber.withValues(alpha: 0.55)
                  : Colors.transparent,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 19, color: fg),
              const SizedBox(height: 2),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
