import 'dart:async';
import 'dart:convert';
import 'dart:io';

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
import 'shell/agent_drawer.dart';
import 'shell/basemap_switcher_sheet.dart';
import 'shell/desk_sheet.dart';
import 'shell/discussion_margin_sheet.dart';
import 'shell/explore_sheet.dart';
import 'shell/feature_inspector_sheet.dart';
import 'shell/sighting_composer_sheet.dart';
import 'shell/spaces_sheet.dart';
import 'shell/story_composer_sheet.dart';
import 'shell/story_reader_margin.dart';
import 'src/rust/api/agent.dart';
import 'src/rust/api/geo.dart';
import 'src/rust/api/nostr_client.dart';
import 'src/rust/api/publish.dart';
import 'src/rust/api/settings.dart';
import 'src/rust/api/spike.dart';
import 'theme/earthly_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const EarthlyNativeApp());
}

enum _ActiveDrawer {
  none,
  explore,
  desk,
  spaces,
  agent,
  storyReader,
  storyComposer,
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
  static const String _activeDraftId = 'active-working-map';

  MapController? _controller;
  DrawToolMode _mode = DrawToolMode.browse;
  TouchPlacementStyle _placementStyle = TouchPlacementStyle.drawDrag;
  bool _loupeEnabled = true;

  // Unified non-blocking Google-Maps-style drawer (mobile) / left Margin rail (desktop)
  _ActiveDrawer _drawer = _ActiveDrawer.none;
  InspectedFeature? _inspectedFeature;
  DiscussionTarget? _discussionTarget;

  // Map presentation & basemap state
  BasemapKind? _selectedBasemap;
  OfflinePmtilesBasemap? _offlineBasemap;
  final List<SavedOfflinePackDto> _savedOfflinePacks = <SavedOfflinePackDto>[];
  bool _showLabels = true;
  CalloutDisplayMode _calloutMode = CalloutDisplayMode.full;

  // Durable working draft state (auto-persisted to SQLite)
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

  // Nostr Explore / Shelf / Account (Amber or Local Desktop Key) / Nearby Peer state
  List<String> _relayUrls = <String>['wss://relay.earthly.city'];
  EarthlyCatalogSnapshot? _catalog;
  final List<ShelfMapEntry> _shelfMaps = <ShelfMapEntry>[];
  final List<SightingSummaryDto> _localSightings = <SightingSummaryDto>[];
  final List<LiveBeaconDto> _localBeacons = <LiveBeaconDto>[];
  Nip55Account? _account;
  String? _localNsec;
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
    await _restoreAppSettings();
    await _restoreSavedDraft();
    unawaited(_startLiveRelayStream());
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
          localPubkeyHex: _localNsec != null ? _account?.pubkey : null,
          localNsec: _localNsec,
          agentPreset: _agentSettings.presetName,
          agentBaseUrl: _agentSettings.baseUrl,
          agentModel: _agentSettings.model,
          agentApiKey: _agentSettings.apiKey,
          offlinePacks: List<SavedOfflinePackDto>.from(_savedOfflinePacks),
        ),
      );
    } catch (_) {}
  }

  void _updateRelayUrls(List<String> next) {
    setState(() {
      _relayUrls = next;
      _catalog = null;
    });
    unawaited(_persistAppSettings());
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

  Future<void> _importGeoJsonFile() async {
    try {
      final picked = await DeviceBridge.pickGeoJsonFile();
      final text = utf8.decode(picked.bytes);
      final imported = parseDraftFeaturesFromGeoJson(text);
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
              colorHex: feat.colorHex,
              callouts: feat.callouts,
            ),
          );
        }
        if (_draftTitle == 'Field Map') {
          _draftTitle = picked.name
              .replaceAll('.geojson', '')
              .replaceAll('.json', '');
        }
      });
      unawaited(_persistWorkingDraft());

      // Frame the imported geometry on the live map!
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
            'Imported ${imported.length} feature${imported.length == 1 ? '' : 's'} from ${picked.name}',
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

  Future<void> _exportGeoJsonFile() async {
    if (_features.isEmpty) return;
    try {
      final geojson = draftFeaturesToGeoJson(
        title: _draftTitle,
        features: _features,
      );
      final safeName = _draftTitle
          .trim()
          .toLowerCase()
          .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
          .replaceAll(RegExp(r'^-|-$'), '');
      final filename = '${safeName.isEmpty ? 'earthly-map' : safeName}.geojson';
      final savedName = await DeviceBridge.saveGeoJsonFile(
        filename: filename,
        content: geojson,
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

  Future<void> _restoreSavedDraft() async {
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final saved = await loadLocalDraft(
        databasePath: dbPath,
        draftId: _activeDraftId,
      );
      if (!mounted || saved == null) return;
      final restored = parseDraftFeaturesFromGeoJson(saved.geojson);
      setState(() {
        _draftDTag = saved.dTag;
        _draftTitle = saved.title;
        _draftAudience = saved.audienceChannel == 'nearby'
            ? DraftAudienceChoice.nearbyLocalNode
            : DraftAudienceChoice.publicRelay;
        _features
          ..clear()
          ..addAll(restored);
        _featureCounter = restored.length;
      });
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
      } else if (_mode == DrawToolMode.line || _mode == DrawToolMode.polygon) {
        _draftVertices.add(point);
      }
    });
    if (_mode == DrawToolMode.point || _mode == DrawToolMode.browse) {
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
    } else if (_features.isNotEmpty) {
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
    _flyToMap(map);
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

  Future<void> _openAtlas(AtlasSummaryDto atlas) async {
    final mapAddresses = atlas.pinnedAddresses
        .where((a) => a.startsWith('37515:'))
        .toList(growable: false);
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
          if (f.colorHex != null) 'color': f.colorHex!,
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
    final dTag = 'story-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
    final prepared = await prepareUnsignedStoryEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: dTag,
      title: req.title,
      summary: req.summary.isEmpty ? null : req.summary,
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
    return _deliverForAudience(req.audience, signedEventJson);
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
    final account = await _ensureAccount();
    final geojson = draftFeaturesToGeoJson(title: title, features: _features);
    final prepared = await prepareUnsignedMapEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: _draftDTag,
      title: title,
      geojson: geojson,
      hashtags: const ['earthly-native'],
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

  Future<SightingPublishResult> _publishSighting(
    SightingPublishRequest req,
  ) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();

    String? imageUrl;
    String? imageMime;
    String? imageSha256;
    if (req.photoBytes != null && req.photoBytes!.isNotEmpty) {
      final dir = await getApplicationSupportDirectory();
      final status = await localNodeStatus();
      if (!status.running) {
        await startLocalNode(dataDir: '${dir.path}/local-node');
      }
      final blob = await ingestLocalBlob(
        bytes: req.photoBytes!,
        mimeType: req.photoMimeType ?? 'image/jpeg',
      );
      imageUrl = blob.blobUrl;
      imageMime = blob.mimeType;
      imageSha256 = blob.sha256;
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
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
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
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
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
          relayUrls: _activeRelayUrls,
          shelfAddresses: _shelfMaps.map((e) => e.summary.address).toSet(),
          onCatalogLoaded: (catalog) => setState(() => _catalog = catalog),
          onToggleMapOnShelf: _toggleMapOnShelf,
          onOpenStory: (story) => unawaited(_openStory(story)),
          onOpenAtlas: (atlas) => unawaited(_openAtlas(atlas)),
          onFocusSighting: _focusSighting,
          onFocusBeacon: _focusBeacon,
          onCreateSighting: _openSightingComposer,
          onComposeStory: () =>
              setState(() => _drawer = _ActiveDrawer.storyComposer),
          onOpenBeaconBroadcaster: () =>
              setState(() => _drawer = _ActiveDrawer.spaces),
          onClose: () => setState(() => _drawer = _ActiveDrawer.none),
        );
      case _ActiveDrawer.desk:
        return DeskSheet(
          draftTitle: _draftTitle,
          audience: _draftAudience,
          account: _account,
          shelfMaps: _shelfMaps,
          drawnFeatures: _features,
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
          onFlyToShelfMap: _flyToMap,
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
          onRunGeoAction: _runGeoAction,
          onPublishDraft: _publishDraft,
          onComposeStory: () =>
              setState(() => _drawer = _ActiveDrawer.storyComposer),
          onImportGeoJson: () => unawaited(_importGeoJsonFile()),
          onExportGeoJsonFile: () => unawaited(_exportGeoJsonFile()),
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
          onRelayUrlsChanged: _updateRelayUrls,
          onAccountChanged: (account) {
            setState(() => _account = account);
            unawaited(_persistAppSettings());
          },
          onLocalKeyChanged: (kp) {
            setState(() {
              if (kp == null) {
                _localNsec = null;
              } else {
                _account = Nip55Account(pubkey: kp.pubkeyHex);
                _localNsec = kp.nsec;
              }
            });
            unawaited(_persistAppSettings());
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
          onClose: _closeStory,
        );
      case _ActiveDrawer.storyComposer:
        return StoryComposerDrawer(
          shelfMaps: _shelfMaps,
          getCameraSnapshot: () => _controller?.camera,
          onPublishStory: _publishStory,
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
                displayMode: _calloutMode,
                bottomInset: hideBottomDockOnMobile ? 340 : 108,
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

    return Scaffold(
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
              }
            },
            onInsertDraftVertex: (insertIndex, pos) {
              setState(() => _draftVertices.insert(insertIndex, pos));
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

          // Top status bar (Field Posture on mobile; full Studio bar on Desktop)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 0),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color:
                            theme.colorScheme.surface.withValues(alpha: 0.94),
                        border: Border.all(color: theme.dividerColor),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (!_isDrawingMode) ...[
                            if (_relayStreamLive) ...[
                              Container(
                                width: 7,
                                height: 7,
                                decoration: const BoxDecoration(
                                  color: EarthlyColors.commentGreen,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 6),
                            ],
                            Text(
                              'EARTHLY',
                              style: theme.textTheme.labelMedium?.copyWith(
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.9,
                              ),
                            ),
                            const SizedBox(width: 8),
                          ],
                          Text(
                            '${_shelfMaps.length} shelf · ${_features.length} draft${visibleBeacons.isNotEmpty ? ' · ${visibleBeacons.length} live' : ''}',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (isDesktop && !_isDrawingMode) ...[
                      const SizedBox(width: 8),
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
                        label: 'Agent',
                        icon: Icons.auto_awesome,
                        active: _drawer == _ActiveDrawer.agent,
                        onTap: () => _toggleDrawer(_ActiveDrawer.agent),
                      ),
                      const SizedBox(width: 6),
                      _MiniToggle(
                        label: 'Draw',
                        icon: Icons.edit,
                        active: false,
                        onTap: () => _selectMode(DrawToolMode.line),
                      ),
                    ],
                    const Spacer(),
                    if (_isDrawingMode) ...[
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
                    ] else ...[
                      if (visibleCallouts.isNotEmpty) ...[
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
                        tooltip: 'Basemap & Overlays',
                        icon: Icons.map_outlined,
                        active:
                            effectiveBasemap == BasemapKind.offlinePmtiles,
                        onTap: () => _openBasemapSwitcher(effectiveBasemap),
                      ),
                      if (Platform.isAndroid) ...[
                        const SizedBox(width: 6),
                        _MiniIconButton(
                          tooltip: 'Center on GPS',
                          icon: Icons.my_location,
                          active: false,
                          onTap: () => unawaited(_locateMe()),
                        ),
                      ],
                    ],
                  ],
                ),
              ),
            ),
          ),

          // Active Proposal / Comment map overlay banner
          if ((_activeProposalLabel != null || _activeCommentOverlayId != null) &&
              !_isDrawingMode)
            Positioned(
              top: 62,
              left: isDesktop && activeDrawerWidget != null ? 434 : 10,
              right: 10,
              child: SafeArea(
                bottom: false,
                child: Align(
                  alignment: Alignment.topLeft,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: (_activeProposalLabel != null
                              ? EarthlyColors.proposedAmber
                              : EarthlyColors.commentGreen)
                          .withValues(alpha: 0.94),
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
                        const SizedBox(width: 6),
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

          // Contextual guidance strip while drawing
          if (_isDrawingMode)
            Positioned(
              left: 12,
              right: 12,
              bottom: 84,
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: EarthlyColors.darkSurface.withValues(alpha: 0.88),
                    border: Border.all(
                      color: EarthlyColors.darkInk.withValues(alpha: 0.2),
                    ),
                  ),
                  child: Text(
                    _placementStyle == TouchPlacementStyle.drawDrag
                        ? '1 finger: place & drag · 2 fingers: pan/zoom · 2-finger tap: undo'
                        : 'Pan map under center reticle · tap Drop to place',
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: EarthlyColors.darkInk,
                    ),
                  ),
                ),
              ),
            ),

          // Unified Google-Maps-style independent bottom drawer (mobile) or docked left Margin (desktop)
          ?activeDrawerWidget,

          // Bottom Dock: always shown on mobile when no drawer is open (and always in Drawing mode)
          if (!hideBottomDockOnMobile && (!isDesktop || _isDrawingMode))
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: SafeArea(
                top: false,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surface.withValues(alpha: 0.96),
                    border: Border(top: BorderSide(color: theme.dividerColor)),
                  ),
                  child: _isDrawingMode
                      ? Row(
                          children: [
                            _DockTool(
                              label: 'Point',
                              icon: Icons.location_on_outlined,
                              selected: _mode == DrawToolMode.point,
                              onTap: () => _selectMode(DrawToolMode.point),
                            ),
                            _DockTool(
                              label: 'Line',
                              icon: Icons.timeline,
                              selected: _mode == DrawToolMode.line,
                              onTap: () => _selectMode(DrawToolMode.line),
                            ),
                            _DockTool(
                              label: 'Area',
                              icon: Icons.pentagon_outlined,
                              selected: _mode == DrawToolMode.polygon,
                              onTap: () => _selectMode(DrawToolMode.polygon),
                            ),
                            const Spacer(),
                            if (_placementStyle ==
                                TouchPlacementStyle.crosshair) ...[
                              FilledButton.icon(
                                onPressed: _dropCrosshairPoint,
                                icon: const Icon(
                                  Icons.add_location_alt,
                                  size: 16,
                                ),
                                label: const Text('Drop'),
                              ),
                              const SizedBox(width: 6),
                            ],
                            if (_canFinishDraft) ...[
                              FilledButton(
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
                              onPressed: (_draftVertices.isNotEmpty ||
                                      _features.isNotEmpty)
                                  ? _undoLastPoint
                                  : null,
                              icon: const Icon(Icons.undo, size: 20),
                            ),
                            OutlinedButton(
                              onPressed: _cancelEditingDraftFeature,
                              child: Text(
                                _editingDraftFeature != null ? 'Cancel' : 'Done',
                              ),
                            ),
                          ],
                        )
                      : Row(
                          children: [
                            _DockTool(
                              label: 'Explore',
                              icon: Icons.explore_outlined,
                              selected: _drawer == _ActiveDrawer.explore,
                              onTap: () => _toggleDrawer(_ActiveDrawer.explore),
                            ),
                            _DockTool(
                              label: 'Desk',
                              icon: Icons.layers_outlined,
                              selected: _drawer == _ActiveDrawer.desk,
                              onTap: () => _toggleDrawer(_ActiveDrawer.desk),
                            ),
                            _DockTool(
                              label: _pendingClaimCount > 0
                                  ? 'Spaces ($_pendingClaimCount)'
                                  : 'Spaces',
                              icon: Icons.hub_outlined,
                              selected: _drawer == _ActiveDrawer.spaces ||
                                  _pendingClaimCount > 0,
                              onTap: () => _toggleDrawer(_ActiveDrawer.spaces),
                            ),
                            _DockTool(
                              label: 'Agent',
                              icon: Icons.auto_awesome,
                              selected: _drawer == _ActiveDrawer.agent,
                              onTap: () => _toggleDrawer(_ActiveDrawer.agent),
                            ),
                            const Spacer(),
                            IconButton(
                              tooltip: 'Drop Field Sighting',
                              onPressed: _openSightingComposer,
                              icon: const Icon(
                                Icons.add_a_photo_outlined,
                                size: 20,
                              ),
                            ),
                            const SizedBox(width: 4),
                            FilledButton.icon(
                              onPressed: () => _selectMode(DrawToolMode.line),
                              icon: const Icon(Icons.edit, size: 16),
                              label: const Text('Draw'),
                            ),
                          ],
                        ),
                ),
              ),
            ),
        ],
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
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(7),
          decoration: BoxDecoration(
            color: active
                ? theme.colorScheme.primary
                : theme.colorScheme.surface.withValues(alpha: 0.94),
            border: Border.all(
              color: active ? theme.colorScheme.primary : theme.dividerColor,
            ),
          ),
          child: Icon(
            icon,
            size: 16,
            color: active
                ? theme.colorScheme.onPrimary
                : theme.colorScheme.onSurface,
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
    final bg = active
        ? theme.colorScheme.primary
        : theme.colorScheme.surface.withValues(alpha: 0.94);
    final fg = active
        ? theme.colorScheme.onPrimary
        : theme.colorScheme.onSurface;

    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
        decoration: BoxDecoration(
          color: bg,
          border: Border.all(
            color: active ? theme.colorScheme.primary : theme.dividerColor,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: fg),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: fg,
              ),
            ),
          ],
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
    final fg = selected
        ? theme.colorScheme.primary
        : theme.colorScheme.onSurface.withValues(alpha: 0.8);

    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: selected
              ? theme.colorScheme.primary.withValues(alpha: 0.12)
              : Colors.transparent,
          border: Border.all(
            color: selected ? theme.colorScheme.primary : Colors.transparent,
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 18, color: fg),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: fg,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
