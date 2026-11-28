import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import '../drawing/drawing_model.dart';
import '../nostr/callout_overlay.dart';
import '../nostr/nip55_signer.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/agent.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../src/rust/api/settings.dart';
import '../src/rust/api/spike.dart';
import '../theme/earthly_theme.dart';
import 'agent_drawer.dart';
import 'basemap_switcher_sheet.dart';
import 'map_drawer.dart';

/// Top-level tabs inside the unified Earthly General Settings drawer.
enum EarthlySettingsTab {
  map,
  relays,
  chat,
  account,
  system,
}

const _defaultCordnProdPubkey =
    'fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37';
const _defaultCordnDevPubkey =
    '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const _defaultRelayUrl = 'wss://relay.earthly.city';
const _profileDiscoveryRelayUrl = 'wss://purplepag.es';

const _defaultProductionRelays = <String>[
  'wss://relay.earthly.city',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const _relayPresets = <String>[
  'wss://relay.earthly.city',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.wine',
];

const _blossomPresets = <String>[
  'https://blossom.earthly.city',
  'https://blossom.primal.net',
  'https://nostr.build',
];

/// Unified multi-tab General Settings drawer covering Map source & clustering,
/// Relays & media servers, Chat/AI credentials, Account & Wallet, and System
/// drawing/node preferences.
class SettingsSheet extends StatefulWidget {
  const SettingsSheet({
    required this.themeMode,
    required this.onThemeModeChanged,
    required this.activeBasemap,
    required this.offlineBasemap,
    required this.onSelectBasemap,
    required this.onLoadedOfflinePmtiles,
    required this.backgroundMode,
    required this.satelliteOpacity,
    required this.onBackgroundModeChanged,
    required this.onSatelliteOpacityChanged,
    required this.pointClusteringEnabled,
    required this.pointClusterRadius,
    required this.pointClusterMaxZoom,
    required this.onPointClusteringChanged,
    required this.onPointClusterRadiusChanged,
    required this.onPointClusterMaxZoomChanged,
    required this.showLabels,
    required this.onToggleLabels,
    required this.calloutMode,
    required this.onChangeCalloutMode,
    required this.relayUrls,
    required this.relayStreamLive,
    required this.onRelayUrlsChanged,
    required this.blossomServerUrl,
    required this.onBlossomServerChanged,
    required this.cordnServerPubkey,
    required this.onCordnPubkeyChanged,
    required this.agentSettings,
    required this.onAgentSettingsChanged,
    required this.safeEditing,
    required this.onSafeEditingChanged,
    required this.visionSupport,
    required this.attachMapView,
    required this.onAttachMapViewChanged,
    required this.account,
    required this.signerModeLabel,
    required this.cashuWalletEnabled,
    required this.onSetCashuWalletEnabled,
    required this.onOpenAccount,
    required this.onClose,
    this.initialTab = EarthlySettingsTab.map,
    this.savedOfflinePacks = const <SavedOfflinePackDto>[],
    this.onMountSavedPack,
    this.onRemoveSavedPack,
    this.mountedAtlasWorkspaces = const <MountedAtlasWorkspaceDto>[],
    this.onMountAtlasWorkspace,
    this.onUnmountAtlasWorkspace,
    this.onExportMapPosterPng,
    this.onProbeRelaysHealth,
    this.onProbeRelaysQuality,
    this.onDiscoverNip66Relays,
    this.onLoadRelayManagerSnapshot,
    this.publicRelaysEnabled,
    this.onSetPublicRelaysEnabled,
    this.onFetchNip65Relays,
    this.onPublishNip65Relays,
    this.onDiscoverModels,
    this.mcpBridgeRunning = false,
    this.onOpenMcpBridge,
    this.cashuBalanceSats,
    this.onOpenCashuWallet,
    this.mutedPubkeys = const <String>[],
    this.onUnmutePubkey,
    this.placementStyle = TouchPlacementStyle.drawDrag,
    this.onPlacementStyleChanged,
    this.loupeEnabled = true,
    this.onLoupeChanged,
    this.snappingEnabled = true,
    this.onSnappingChanged,
    this.snapToEdgesEnabled = true,
    this.onSnapToEdgesChanged,
    this.pendingOutboxCount = 0,
    this.onOpenRustNode,
    this.onOpenOutbox,
    this.onRefreshCatalog,
    this.onOpenHelp,
    this.onBack,
    super.key,
  });

  final EarthlySettingsTab initialTab;

  // Map tab
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeModeChanged;
  final BasemapKind activeBasemap;
  final OfflinePmtilesBasemap? offlineBasemap;
  final ValueChanged<BasemapKind> onSelectBasemap;
  final ValueChanged<OfflinePmtilesBasemap> onLoadedOfflinePmtiles;
  final MapBackgroundMode backgroundMode;
  final double satelliteOpacity;
  final ValueChanged<MapBackgroundMode> onBackgroundModeChanged;
  final ValueChanged<double> onSatelliteOpacityChanged;
  final bool pointClusteringEnabled;
  final int pointClusterRadius;
  final int pointClusterMaxZoom;
  final ValueChanged<bool> onPointClusteringChanged;
  final ValueChanged<int> onPointClusterRadiusChanged;
  final ValueChanged<int> onPointClusterMaxZoomChanged;
  final bool showLabels;
  final ValueChanged<bool> onToggleLabels;
  final CalloutDisplayMode calloutMode;
  final ValueChanged<CalloutDisplayMode> onChangeCalloutMode;
  final List<SavedOfflinePackDto> savedOfflinePacks;
  final Future<void> Function(SavedOfflinePackDto pack)? onMountSavedPack;
  final ValueChanged<String>? onRemoveSavedPack;
  final List<MountedAtlasWorkspaceDto> mountedAtlasWorkspaces;
  final Future<void> Function(AtlasBundleInspectionDto bundle)?
      onMountAtlasWorkspace;
  final ValueChanged<String>? onUnmountAtlasWorkspace;
  final VoidCallback? onExportMapPosterPng;

  // Relays tab
  final List<String> relayUrls;
  final bool relayStreamLive;
  final ValueChanged<List<String>> onRelayUrlsChanged;
  final String blossomServerUrl;
  final ValueChanged<String> onBlossomServerChanged;
  final String cordnServerPubkey;
  final ValueChanged<String> onCordnPubkeyChanged;
  final Future<List<RelayHealthDto>> Function(List<String> urls)?
      onProbeRelaysHealth;
  final Future<List<RelayQualityReportDto>> Function(List<String> urls)?
      onProbeRelaysQuality;
  final Future<List<Nip66RelayCandidateDto>> Function()? onDiscoverNip66Relays;
  final Future<RelayManagerSnapshotDto> Function(List<String> urls)?
      onLoadRelayManagerSnapshot;
  final bool? publicRelaysEnabled;
  final Future<void> Function(bool enabled)? onSetPublicRelaysEnabled;
  final Future<List<RelayListEntryDto>> Function()? onFetchNip65Relays;
  final Future<PublishOutcomeDto> Function(List<RelayListEntryDto> relays)?
      onPublishNip65Relays;

  // Chat / AI credentials tab
  final CopilotProviderSettings agentSettings;
  final ValueChanged<CopilotProviderSettings> onAgentSettingsChanged;
  final bool safeEditing;
  final ValueChanged<bool> onSafeEditingChanged;
  final String visionSupport;
  final bool attachMapView;
  final ValueChanged<bool> onAttachMapViewChanged;
  final Future<List<String>> Function(String baseUrl, String apiKey)?
      onDiscoverModels;
  final bool mcpBridgeRunning;
  final VoidCallback? onOpenMcpBridge;

  // Account & Wallet tab
  final Nip55Account? account;
  final String signerModeLabel;
  final bool cashuWalletEnabled;
  final ValueChanged<bool> onSetCashuWalletEnabled;
  final int? cashuBalanceSats;
  final VoidCallback? onOpenCashuWallet;
  final VoidCallback onOpenAccount;
  final List<String> mutedPubkeys;
  final ValueChanged<String>? onUnmutePubkey;

  // System tab
  final TouchPlacementStyle placementStyle;
  final ValueChanged<TouchPlacementStyle>? onPlacementStyleChanged;
  final bool loupeEnabled;
  final ValueChanged<bool>? onLoupeChanged;
  final bool snappingEnabled;
  final ValueChanged<bool>? onSnappingChanged;
  final bool snapToEdgesEnabled;
  final ValueChanged<bool>? onSnapToEdgesChanged;
  final int pendingOutboxCount;
  final VoidCallback? onOpenRustNode;
  final VoidCallback? onOpenOutbox;
  final VoidCallback? onRefreshCatalog;
  final VoidCallback? onOpenHelp;
  final VoidCallback? onBack;

  final VoidCallback onClose;

  @override
  State<SettingsSheet> createState() => _SettingsSheetState();
}

class _SettingsSheetState extends State<SettingsSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(
    length: EarthlySettingsTab.values.length,
    initialIndex: widget.initialTab.index,
    vsync: this,
  );

  // Map offline state
  final _atlasPathController = TextEditingController();
  bool _loadingPmtiles = false;
  bool _scanningAtlas = false;
  List<AtlasBundleInspectionDto> _discoveredAtlases = const [];
  String? _mapError;

  // Relays / Blossom / Cordn state
  final _relayInputController = TextEditingController();
  late final TextEditingController _blossomController =
      TextEditingController(text: widget.blossomServerUrl);
  late final TextEditingController _cordnController =
      TextEditingController(text: widget.cordnServerPubkey);
  final Map<String, RelayQualityReportDto> _relayQuality =
      <String, RelayQualityReportDto>{};
  final Map<String, ManagedRelayStatusDto> _managedRelayMeta =
      <String, ManagedRelayStatusDto>{};
  List<RelayListEntryDto> _nip65Relays = const <RelayListEntryDto>[];
  List<Nip66RelayCandidateDto> _nip66Candidates =
      const <Nip66RelayCandidateDto>[];
  late bool _publicRelaysEnabled = widget.publicRelaysEnabled ?? true;
  bool _probingRelays = false;
  bool _discoveringNip66 = false;
  bool _updatingPublicPolicy = false;
  bool _syncingNip65 = false;
  String? _relayStatus;
  String? _relayError;

  @override
  void initState() {
    super.initState();
    unawaited(_refreshRelayManagerSnapshot());
  }

  // Chat / AI credentials state
  late final TextEditingController _baseUrlController =
      TextEditingController(text: widget.agentSettings.baseUrl);
  late final TextEditingController _modelController =
      TextEditingController(text: widget.agentSettings.model);
  late final TextEditingController _apiKeyController =
      TextEditingController(text: widget.agentSettings.apiKey);
  late final TextEditingController _cashuTokenController =
      TextEditingController(text: widget.agentSettings.cashuToken);
  late final TextEditingController _cashuMaxSatsController =
      TextEditingController(text: widget.agentSettings.cashuMaxSats.toString());
  bool _obscureApiKey = true;
  bool _discoveringModels = false;
  List<String> _discoveredModels = const <String>[];
  String? _chatInfo;
  String? _chatError;

  @override
  void didUpdateWidget(covariant SettingsSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialTab != widget.initialTab &&
        _tabs.index != widget.initialTab.index) {
      _tabs.animateTo(widget.initialTab.index);
    }
    if (oldWidget.publicRelaysEnabled != widget.publicRelaysEnabled &&
        widget.publicRelaysEnabled != null) {
      _publicRelaysEnabled = widget.publicRelaysEnabled!;
    }
    if (oldWidget.relayUrls != widget.relayUrls) {
      unawaited(_refreshRelayManagerSnapshot());
    }
    if (oldWidget.blossomServerUrl != widget.blossomServerUrl &&
        _blossomController.text != widget.blossomServerUrl) {
      _blossomController.text = widget.blossomServerUrl;
    }
    if (oldWidget.cordnServerPubkey != widget.cordnServerPubkey &&
        _cordnController.text != widget.cordnServerPubkey) {
      _cordnController.text = widget.cordnServerPubkey;
    }
    if (oldWidget.agentSettings != widget.agentSettings) {
      if (_baseUrlController.text != widget.agentSettings.baseUrl) {
        _baseUrlController.text = widget.agentSettings.baseUrl;
      }
      if (_modelController.text != widget.agentSettings.model) {
        _modelController.text = widget.agentSettings.model;
      }
      if (_apiKeyController.text != widget.agentSettings.apiKey) {
        _apiKeyController.text = widget.agentSettings.apiKey;
      }
      if (_cashuTokenController.text != widget.agentSettings.cashuToken) {
        _cashuTokenController.text = widget.agentSettings.cashuToken;
      }
      final maxStr = widget.agentSettings.cashuMaxSats.toString();
      if (_cashuMaxSatsController.text != maxStr) {
        _cashuMaxSatsController.text = maxStr;
      }
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    _atlasPathController.dispose();
    _relayInputController.dispose();
    _blossomController.dispose();
    _cordnController.dispose();
    _baseUrlController.dispose();
    _modelController.dispose();
    _apiKeyController.dispose();
    _cashuTokenController.dispose();
    _cashuMaxSatsController.dispose();
    super.dispose();
  }

  // --- Map helpers ---

  Future<void> _pickAndLoadPmtiles() async {
    setState(() {
      _loadingPmtiles = true;
      _mapError = null;
    });
    try {
      final picked = await DeviceBridge.pickPmtilesFile();
      await RustBridge.ensureInitialized();
      final dir = await getApplicationSupportDirectory();
      await startLocalNode(dataDir: '${dir.path}/local-node');
      final ingested = await ingestLocalPmtiles(
        bytes: picked.bytes,
        label: picked.name,
      );
      final offline = OfflinePmtilesBasemap(
        snapshot: ingested,
        styleJson: buildPmtilesStyleJson(ingested),
      );
      widget.onLoadedOfflinePmtiles(offline);
    } catch (err) {
      if (mounted) setState(() => _mapError = err.toString());
    } finally {
      if (mounted) setState(() => _loadingPmtiles = false);
    }
  }

  Future<void> _scanAtlasDirectories() async {
    setState(() {
      _scanningAtlas = true;
      _mapError = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final support = await getApplicationSupportDirectory();
      final docs = await getApplicationDocumentsDirectory();
      final found = await discoverLocalAtlasBundles(
        searchDirs: <String>[
          support.path,
          '${support.path}/atlases',
          docs.path,
          '${docs.path}/Earthly',
        ],
      );
      if (!mounted) return;
      setState(() {
        _discoveredAtlases = found;
        if (found.isEmpty) {
          _mapError =
              'No .atlas bundles found in app folders yet. Paste a local .atlas path below.';
        }
      });
    } catch (err) {
      if (mounted) setState(() => _mapError = err.toString());
    } finally {
      if (mounted) setState(() => _scanningAtlas = false);
    }
  }

  Future<void> _mountAtlasFromPath(String rawPath) async {
    final trimmed = rawPath.trim();
    if (trimmed.isEmpty) return;
    setState(() {
      _scanningAtlas = true;
      _mapError = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final bundle = await inspectAtlasWorkspacePath(path: trimmed);
      await widget.onMountAtlasWorkspace?.call(bundle);
      _atlasPathController.clear();
    } catch (err) {
      if (mounted) setState(() => _mapError = err.toString());
    } finally {
      if (mounted) setState(() => _scanningAtlas = false);
    }
  }

  // --- Relay / Blossom / Cordn helpers ---

  static String _normalizeRelayUrl(String raw) {
    var clean = raw.trim();
    if (!clean.startsWith('wss://') && !clean.startsWith('ws://')) {
      clean = 'wss://$clean';
    }
    return clean.replaceFirst(RegExp(r'/+$'), '');
  }

  static RelayQualityReportDto _qualityFromBasicHealth(RelayHealthDto health) {
    final status = !health.reachable
        ? 'offline'
        : health.latencyMs > 800
            ? 'slow'
            : 'healthy';
    final score = !health.reachable
        ? 0
        : health.latencyMs <= 150
            ? 92
            : health.latencyMs <= 400
                ? 80
                : health.latencyMs <= 800
                    ? 66
                    : 45;
    return RelayQualityReportDto(
      url: _normalizeRelayUrl(health.url),
      reachable: health.reachable,
      rttMs: health.latencyMs,
      status: status,
      qualityScore: score,
      authRequired: false,
      paymentRequired: false,
      nip11: null,
      error: health.error,
      probedAt: BigInt.from(DateTime.now().millisecondsSinceEpoch ~/ 1000),
    );
  }

  Future<void> _refreshRelayManagerSnapshot() async {
    try {
      final RelayManagerSnapshotDto snap;
      if (widget.onLoadRelayManagerSnapshot != null) {
        snap = await widget.onLoadRelayManagerSnapshot!(widget.relayUrls);
      } else {
        await RustBridge.ensureInitialized();
        snap = await getRelayManagerSnapshot(configuredRelays: widget.relayUrls);
      }
      if (!mounted) return;
      setState(() {
        if (widget.publicRelaysEnabled == null) {
          _publicRelaysEnabled = snap.publicRelaysEnabled;
        }
        _nip65Relays = snap.nip65Relays;
        _managedRelayMeta
          ..clear()
          ..addEntries(snap.configuredRelays.map((r) => MapEntry(r.url, r)));
        for (final row in snap.configuredRelays) {
          if (row.quality != null && !_relayQuality.containsKey(row.url)) {
            _relayQuality[row.url] = row.quality!;
          }
        }
      });
    } catch (_) {
      // Headless widget tests without native Rust dylib fall back gracefully.
    }
  }

  Future<void> _togglePublicRelays(bool enabled) async {
    if (_updatingPublicPolicy) return;
    setState(() {
      _updatingPublicPolicy = true;
      _publicRelaysEnabled = enabled;
      _relayError = null;
    });
    try {
      if (widget.onSetPublicRelaysEnabled != null) {
        await widget.onSetPublicRelaysEnabled!(enabled);
      } else {
        try {
          await RustBridge.ensureInitialized();
          final dir = await getApplicationSupportDirectory();
          final updated = await setPublicRelaysEnabled(
            databasePath: '${dir.path}/earthly.sqlite3',
            enabled: enabled,
          );
          widget.onRelayUrlsChanged(updated.relayUrls);
        } catch (_) {
          // Fallback in headless widget tests without Rust FFI / path_provider.
          final next = List<String>.from(widget.relayUrls);
          if (enabled) {
            for (final pubRelay in _defaultProductionRelays) {
              if (!next.contains(pubRelay)) next.add(pubRelay);
            }
          } else {
            next.removeWhere(
              (u) =>
                  u != _defaultRelayUrl && _defaultProductionRelays.contains(u),
            );
            if (next.isEmpty) next.add(_defaultRelayUrl);
          }
          widget.onRelayUrlsChanged(next);
        }
      }
      if (!mounted) return;
      setState(() {
        _relayStatus = enabled
            ? 'Public Nostr relays enabled.'
            : 'Public default relays disabled (Earthly + custom relays kept).';
      });
      unawaited(_refreshRelayManagerSnapshot());
    } catch (err) {
      if (mounted) setState(() => _relayError = err.toString());
    } finally {
      if (mounted) setState(() => _updatingPublicPolicy = false);
    }
  }

  void _addRelay([String? explicit, bool fromNip66 = false]) {
    final input = (explicit ?? _relayInputController.text).trim();
    if (input.isEmpty) return;
    final raw = _normalizeRelayUrl(input);
    if (widget.relayUrls.contains(raw)) {
      setState(() {
        _relayStatus = 'Relay already configured: $raw';
        _relayError = null;
      });
      return;
    }
    if (fromNip66) {
      unawaited(
        () async {
          try {
            await RustBridge.ensureInitialized();
            await markNip66RelayAdded(url: raw);
          } catch (_) {}
        }(),
      );
    }
    final next = <String>[...widget.relayUrls, raw];
    widget.onRelayUrlsChanged(next);
    if (explicit == null) _relayInputController.clear();
    setState(() {
      _relayStatus = fromNip66 ? 'Added $raw from NIP-66' : 'Added $raw';
      _relayError = null;
    });
  }

  void _removeRelay(String url) {
    if (widget.relayUrls.length <= 1) {
      setState(() => _relayError = 'Keep at least one Nostr relay active.');
      return;
    }
    final next = widget.relayUrls.where((r) => r != url).toList();
    widget.onRelayUrlsChanged(next);
    setState(() {
      _relayQuality.remove(url);
      _managedRelayMeta.remove(url);
      _relayStatus = 'Removed $url';
      _relayError = null;
    });
  }

  Future<void> _probeRelays() async {
    if (_probingRelays || widget.relayUrls.isEmpty) return;
    setState(() {
      _probingRelays = true;
      _relayError = null;
      _relayStatus = 'Probing ${widget.relayUrls.length} relay(s) + NIP-11…';
    });
    try {
      final List<RelayQualityReportDto> results;
      if (widget.onProbeRelaysQuality != null) {
        results = await widget.onProbeRelaysQuality!(widget.relayUrls);
      } else {
        List<RelayQualityReportDto>? probed;
        try {
          await RustBridge.ensureInitialized();
          probed = await probeRelaysQuality(relayUrls: widget.relayUrls);
        } catch (_) {
          if (widget.onProbeRelaysHealth != null) {
            final basic = await widget.onProbeRelaysHealth!(widget.relayUrls);
            probed = basic.map(_qualityFromBasicHealth).toList(growable: false);
          } else {
            rethrow;
          }
        }
        results = probed;
      }
      if (!mounted) return;
      setState(() {
        for (final item in results) {
          _relayQuality[item.url] = item;
        }
        final healthyCount =
            results.where((r) => r.status == 'healthy').length;
        final slowCount = results.where((r) => r.status == 'slow').length;
        final authCount =
            results.where((r) => r.status == 'auth_required').length;
        final offlineCount = results.where((r) => !r.reachable).length;
        final parts = <String>[
          '$healthyCount/${results.length} healthy',
          if (slowCount > 0) '$slowCount slow',
          if (authCount > 0) '$authCount auth',
          if (offlineCount > 0) '$offlineCount offline',
        ];
        _relayStatus = parts.join(' · ');
      });
      unawaited(_refreshRelayManagerSnapshot());
    } catch (err) {
      if (mounted) setState(() => _relayError = err.toString());
    } finally {
      if (mounted) setState(() => _probingRelays = false);
    }
  }

  Future<void> _discoverNip66Relays() async {
    if (_discoveringNip66) return;
    setState(() {
      _discoveringNip66 = true;
      _relayError = null;
      _relayStatus = 'Querying nostr.watch (NIP-66) & probing top relays…';
    });
    try {
      final List<Nip66RelayCandidateDto> candidates;
      if (widget.onDiscoverNip66Relays != null) {
        candidates = await widget.onDiscoverNip66Relays!();
      } else {
        await RustBridge.ensureInitialized();
        candidates = await discoverPublicRelaysNip66(
          limit: 16,
          probeCandidates: true,
        );
      }
      if (!mounted) return;
      setState(() {
        _nip66Candidates = candidates;
        for (final c in candidates) {
          if (c.liveProbe != null) {
            _relayQuality[c.url] = c.liveProbe!;
          }
        }
        _relayStatus = candidates.isEmpty
            ? 'No public relays returned by NIP-66 monitors.'
            : 'Discovered ${candidates.length} public relay(s) via NIP-66.';
      });
    } catch (err) {
      if (mounted) setState(() => _relayError = err.toString());
    } finally {
      if (mounted) setState(() => _discoveringNip66 = false);
    }
  }

  Future<void> _importNip65Relays() async {
    final fetch = widget.onFetchNip65Relays;
    if (fetch == null || _syncingNip65) return;
    setState(() {
      _syncingNip65 = true;
      _relayError = null;
      _relayStatus = 'Importing NIP-65 relay list…';
    });
    try {
      final entries = await fetch();
      if (!mounted) return;
      if (entries.isEmpty) {
        setState(() => _relayStatus = 'No NIP-65 relay list found for account.');
      } else {
        final merged = <String>[...widget.relayUrls];
        for (final e in entries) {
          final norm = _normalizeRelayUrl(e.url);
          if (!merged.contains(norm)) merged.add(norm);
        }
        _nip65Relays = entries;
        widget.onRelayUrlsChanged(merged);
        setState(
          () => _relayStatus = 'Imported ${entries.length} NIP-65 relay(s).',
        );
        unawaited(_refreshRelayManagerSnapshot());
      }
    } catch (err) {
      if (mounted) setState(() => _relayError = err.toString());
    } finally {
      if (mounted) setState(() => _syncingNip65 = false);
    }
  }

  Future<void> _publishNip65Relays() async {
    final publish = widget.onPublishNip65Relays;
    if (publish == null || _syncingNip65) return;
    setState(() {
      _syncingNip65 = true;
      _relayError = null;
      _relayStatus = 'Publishing NIP-65 relay list…';
    });
    try {
      final entries = [
        for (final url in widget.relayUrls)
          () {
            final meta = _managedRelayMeta[url];
            return RelayListEntryDto(
              url: url,
              read: meta?.read ?? true,
              write: meta?.write ?? true,
            );
          }(),
      ];
      await publish(entries);
      if (mounted) {
        setState(
          () => _relayStatus =
              'Published ${entries.length} relay(s) as NIP-65 (kind 10002).',
        );
      }
    } catch (err) {
      if (mounted) setState(() => _relayError = err.toString());
    } finally {
      if (mounted) setState(() => _syncingNip65 = false);
    }
  }

  void _saveBlossom([String? explicit]) {
    var raw = (explicit ?? _blossomController.text).trim();
    if (raw.isEmpty) return;
    if (!raw.startsWith('https://') && !raw.startsWith('http://')) {
      raw = 'https://$raw';
    }
    _blossomController.text = raw;
    widget.onBlossomServerChanged(raw);
    setState(() {
      _relayStatus = 'Saved Blossom server: $raw';
      _relayError = null;
    });
  }

  void _saveCordn([String? explicit]) {
    final raw = (explicit ?? _cordnController.text).trim().toLowerCase();
    if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(raw)) {
      setState(
        () => _relayError = 'Cordn coordinator pubkey must be 64 hex chars.',
      );
      return;
    }
    _cordnController.text = raw;
    widget.onCordnPubkeyChanged(raw);
    setState(() {
      _relayStatus = 'Saved Cordn coordinator pubkey.';
      _relayError = null;
    });
  }

  // --- Chat / AI credentials helpers ---

  CopilotProviderSettings _buildAgentSettings({
    String? presetOverride,
    String? providerTypeOverride,
    bool? autoPayOverride,
  }) {
    final baseUrl = _baseUrlController.text.trim();
    final model = _modelController.text.trim();
    final apiKey = _apiKeyController.text.trim();
    final cashuToken = _cashuTokenController.text.trim();
    final maxSats =
        (int.tryParse(_cashuMaxSatsController.text.trim()) ?? 25).clamp(1, 100000);
    final isRoutstr = providerTypeOverride == 'routstr' ||
        baseUrl.toLowerCase().contains('routstr.com');
    final preset = presetOverride ??
        (baseUrl.isEmpty
            ? 'Offline Rust Spatial'
            : isRoutstr
                ? 'Routstr (Cashu)'
                : baseUrl.contains('11434')
                    ? 'Local Ollama'
                    : baseUrl.contains('openrouter.ai')
                        ? 'OpenRouter'
                        : baseUrl.contains('api.openai.com')
                            ? 'OpenAI'
                            : 'Custom Endpoint');
    return CopilotProviderSettings(
      presetName: preset,
      baseUrl: baseUrl,
      model: model.isEmpty ? 'offline-spatial' : model,
      apiKey: apiKey,
      providerType:
          providerTypeOverride ?? (isRoutstr ? 'routstr' : null),
      autoPayCashu: autoPayOverride ?? widget.agentSettings.autoPayCashu,
      cashuMaxSats: maxSats,
      cashuToken: cashuToken,
    );
  }

  void _applyAgentPreset(CopilotProviderSettings preset) {
    final keepKey =
        preset.baseUrl.isNotEmpty && _apiKeyController.text.trim().isNotEmpty
            ? _apiKeyController.text.trim()
            : preset.apiKey;
    final next = preset.copyWith(apiKey: keepKey);
    _baseUrlController.text = next.baseUrl;
    _modelController.text = next.model;
    _apiKeyController.text = next.apiKey;
    _cashuTokenController.text = next.cashuToken;
    _cashuMaxSatsController.text = next.cashuMaxSats.toString();
    widget.onAgentSettingsChanged(next);
    setState(() {
      _discoveredModels = const [];
      _chatError = null;
      _chatInfo = 'Switched chat provider to ${next.presetName}.';
    });
  }

  void _saveAgentSettings() {
    final next = _buildAgentSettings();
    widget.onAgentSettingsChanged(next);
    setState(() {
      _chatError = null;
      _chatInfo = 'Saved chat credentials (${next.presetName} · ${next.model}).';
    });
  }

  Future<void> _discoverModels() async {
    final baseUrl = _baseUrlController.text.trim();
    if (baseUrl.isEmpty || _discoveringModels) {
      setState(() => _chatError = 'Enter an OpenAI-compatible Base URL first.');
      return;
    }
    setState(() {
      _discoveringModels = true;
      _chatError = null;
    });
    try {
      final apiKey = _apiKeyController.text.trim();
      final models = widget.onDiscoverModels != null
          ? await widget.onDiscoverModels!(baseUrl, apiKey)
          : await (() async {
              await RustBridge.ensureInitialized();
              return fetchAgentProviderModels(
                baseUrl: baseUrl,
                apiKey: apiKey.isEmpty ? null : apiKey,
              );
            })();
      if (!mounted) return;
      setState(() {
        _discoveredModels = models;
        if (models.isEmpty) {
          _chatError = 'Provider returned no models at /models.';
        } else {
          _chatInfo = 'Found ${models.length} model(s). Tap one to select.';
        }
      });
    } catch (err) {
      if (mounted) setState(() => _chatError = err.toString());
    } finally {
      if (mounted) setState(() => _discoveringModels = false);
    }
  }

  // --- Build ---

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return EarthlyMapDrawer(
      key: const Key('earthly-settings-drawer'),
      initialFraction: 0.72,
      minFraction: 0.34,
      maxFraction: 0.94,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(
              widget.onBack != null ? 6 : 14,
              0,
              8,
              2,
            ),
            child: Row(
              children: [
                if (widget.onBack != null) ...[
                  EarthlyDrawerBackButton(
                    key: const Key('settings-back-btn'),
                    onBack: widget.onBack!,
                  ),
                  const SizedBox(width: 2),
                ],
                const Icon(
                  Icons.tune,
                  size: 18,
                  color: EarthlyColors.amber,
                ),
                const SizedBox(width: 8),
                Text(
                  'Settings',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const Spacer(),
                IconButton(
                  tooltip: 'Close Settings',
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
          ),
          TabBar(
            controller: _tabs,
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            labelStyle: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
            ),
            tabs: const [
              Tab(key: Key('settings-tab-map'), text: 'Map'),
              Tab(key: Key('settings-tab-relays'), text: 'Relays'),
              Tab(key: Key('settings-tab-chat'), text: 'Chat'),
              Tab(key: Key('settings-tab-account'), text: 'Account'),
              Tab(key: Key('settings-tab-system'), text: 'System'),
            ],
          ),
        ],
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          _buildMapTab(theme),
          _buildRelaysTab(theme),
          _buildChatTab(theme),
          _buildAccountTab(theme),
          _buildSystemTab(theme),
        ],
      ),
    );
  }

  Widget _sectionCard(
    ThemeData theme, {
    required String title,
    String? subtitle,
    Widget? trailing,
    required List<Widget> children,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.45),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(13),
          side: BorderSide(color: theme.dividerColor),
        ),
        clipBehavior: Clip.antiAlias,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title.toUpperCase(),
                          style: theme.textTheme.labelSmall?.copyWith(
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.6,
                          ),
                        ),
                        if (subtitle != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            subtitle,
                            style: theme.textTheme.bodySmall?.copyWith(
                              fontSize: 11.5,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  ?trailing,
                ],
              ),
              const SizedBox(height: 10),
              ...children,
            ],
          ),
        ),
      ),
    );
  }

  // --- Tab 1: Map ---

  Widget _buildMapTab(ThemeData theme) {
    final offline = widget.offlineBasemap;
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      children: [
        _sectionCard(
          theme,
          title: 'Appearance',
          subtitle: 'App light/dark theme',
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                for (final entry in const [
                  (ThemeMode.system, 'System', Icons.brightness_auto_outlined),
                  (ThemeMode.light, 'Light', Icons.light_mode_outlined),
                  (ThemeMode.dark, 'Dark', Icons.dark_mode_outlined),
                ])
                  ChoiceChip(
                    key: Key('settings-theme-${entry.$1.name}'),
                    avatar: Icon(entry.$3, size: 15),
                    label: Text(entry.$2),
                    selected: widget.themeMode == entry.$1,
                    onSelected: (_) => widget.onThemeModeChanged(entry.$1),
                  ),
              ],
            ),
          ],
        ),
        _sectionCard(
          theme,
          title: 'Map Source & Style',
          subtitle: 'Vector basemap tiles and EOxCloudless satellite imagery',
          children: [
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                for (final kind in const [
                  BasemapKind.auto,
                  BasemapKind.openFreeMapPositron,
                  BasemapKind.openFreeMapBright,
                  BasemapKind.openFreeMapLiberty,
                  BasemapKind.openFreeMapDark,
                  BasemapKind.openFreeMapFiord,
                ])
                  ChoiceChip(
                    key: Key('settings-basemap-${kind.name}'),
                    label: Text(basemapStyleLabel(kind)),
                    selected: widget.activeBasemap == kind,
                    onSelected: (_) => widget.onSelectBasemap(kind),
                  ),
                if (offline != null)
                  ChoiceChip(
                    label: Text('Offline: ${offline.snapshot.label}'),
                    selected: widget.activeBasemap == BasemapKind.offlinePmtiles,
                    onSelected: (_) =>
                        widget.onSelectBasemap(BasemapKind.offlinePmtiles),
                  ),
              ],
            ),
            if (widget.activeBasemap != BasemapKind.offlinePmtiles) ...[
              const SizedBox(height: 12),
              Text(
                'IMAGERY OVERLAY',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontSize: 10,
                ),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  for (final item in const [
                    (MapBackgroundMode.osm, 'Vector'),
                    (MapBackgroundMode.combined, 'Combined'),
                    (MapBackgroundMode.satellite, 'Satellite'),
                  ])
                    ChoiceChip(
                      key: Key('settings-bg-mode-${item.$1.name}'),
                      label: Text(item.$2),
                      selected: widget.backgroundMode == item.$1,
                      onSelected: (_) => widget.onBackgroundModeChanged(item.$1),
                    ),
                ],
              ),
              if (widget.backgroundMode == MapBackgroundMode.combined)
                Row(
                  children: [
                    const Text(
                      'OPACITY',
                      style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                    ),
                    Expanded(
                      child: Slider(
                        key: const Key('settings-satellite-opacity-slider'),
                        min: 0.1,
                        max: 1.0,
                        divisions: 9,
                        value: widget.satelliteOpacity.clamp(0.1, 1.0),
                        onChanged: widget.onSatelliteOpacityChanged,
                      ),
                    ),
                    Text(
                      '${(widget.satelliteOpacity * 100).round()}%',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                      ),
                    ),
                  ],
                ),
            ],
          ],
        ),
        _sectionCard(
          theme,
          title: 'Point Clustering',
          subtitle:
              'Group dense map markers into clickable clusters while zoomed out',
          children: [
            SwitchListTile(
              key: const Key('settings-point-clustering-switch'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Point clustering'),
              subtitle: const Text(
                'Tap any cluster bubble on the map to zoom in',
                style: TextStyle(fontSize: 11.5),
              ),
              value: widget.pointClusteringEnabled,
              onChanged: widget.onPointClusteringChanged,
            ),
            if (widget.pointClusteringEnabled) ...[
              Row(
                children: [
                  const SizedBox(
                    width: 82,
                    child: Text(
                      'RADIUS',
                      style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                    ),
                  ),
                  Expanded(
                    child: Slider(
                      key: const Key('settings-cluster-radius-slider'),
                      min: 20,
                      max: 120,
                      divisions: 10,
                      value: widget.pointClusterRadius.toDouble().clamp(20, 120),
                      onChanged: (v) =>
                          widget.onPointClusterRadiusChanged(v.round()),
                    ),
                  ),
                  SizedBox(
                    width: 44,
                    child: Text(
                      '${widget.pointClusterRadius}px',
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                      ),
                    ),
                  ),
                ],
              ),
              Row(
                children: [
                  const SizedBox(
                    width: 82,
                    child: Text(
                      'MAX ZOOM',
                      style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                    ),
                  ),
                  Expanded(
                    child: Slider(
                      key: const Key('settings-cluster-max-zoom-slider'),
                      min: 4,
                      max: 18,
                      divisions: 14,
                      value: widget.pointClusterMaxZoom.toDouble().clamp(4, 18),
                      onChanged: (v) =>
                          widget.onPointClusterMaxZoomChanged(v.round()),
                    ),
                  ),
                  SizedBox(
                    width: 44,
                    child: Text(
                      'z${widget.pointClusterMaxZoom}',
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
        _sectionCard(
          theme,
          title: 'Labels, Callouts & Export',
          children: [
            SwitchListTile(
              key: const Key('settings-feature-labels-switch'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Feature Labels on Map'),
              subtitle: const Text(
                'Native GPU collision-free feature names',
                style: TextStyle(fontSize: 11.5),
              ),
              value: widget.showLabels,
              onChanged: widget.onToggleLabels,
            ),
            const SizedBox(height: 6),
            Text(
              'CALLOUT DISPLAY MODE',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontSize: 10,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final mode in CalloutDisplayMode.values)
                  ChoiceChip(
                    key: Key('settings-callout-${mode.name}'),
                    label: Text(calloutModeShortLabel(mode)),
                    selected: widget.calloutMode == mode,
                    onSelected: (_) => widget.onChangeCalloutMode(mode),
                  ),
              ],
            ),
            if (widget.onExportMapPosterPng != null) ...[
              const SizedBox(height: 10),
              OutlinedButton.icon(
                key: const Key('settings-export-poster-btn'),
                onPressed: widget.onExportMapPosterPng,
                icon: const Icon(Icons.image_outlined, size: 16),
                label: const Text('Export High-Res Map Poster (PNG)'),
              ),
            ],
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Material(
            color: theme.colorScheme.surfaceContainerHighest
                .withValues(alpha: 0.45),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(13),
              side: BorderSide(color: theme.dividerColor),
            ),
            clipBehavior: Clip.antiAlias,
            child: ExpansionTile(
              shape: const Border(),
              collapsedShape: const Border(),
              tilePadding: const EdgeInsets.symmetric(horizontal: 12),
              childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            title: Text(
              'OFFLINE MAPS (.PMTILES & .ATLAS)',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w800,
              ),
            ),
            subtitle: Text(
              '${widget.savedOfflinePacks.length} pack(s) · ${widget.mountedAtlasWorkspaces.length} .atlas bundle(s)',
              style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5),
            ),
            children: [
              OutlinedButton.icon(
                onPressed: _loadingPmtiles ? null : _pickAndLoadPmtiles,
                icon: _loadingPmtiles
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.folder_open_outlined, size: 16),
                label: Text(
                  offline == null
                      ? 'Load Offline .pmtiles Archive'
                      : 'Switch Offline .pmtiles Archive',
                ),
              ),
              if (widget.savedOfflinePacks.isNotEmpty) ...[
                const SizedBox(height: 8),
                for (final pack in widget.savedOfflinePacks)
                  ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(pack.label, maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                      '${pack.format.toUpperCase()} · z${pack.minZoom}–${pack.maxZoom} · ${(pack.sizeBytes.toInt() / 1024).toStringAsFixed(0)} KB',
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 10),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (widget.onMountSavedPack != null)
                          TextButton(
                            onPressed: _loadingPmtiles
                                ? null
                                : () => unawaited(widget.onMountSavedPack!(pack)),
                            child: const Text('Mount'),
                          ),
                        if (widget.onRemoveSavedPack != null)
                          IconButton(
                            tooltip: 'Forget pack',
                            visualDensity: VisualDensity.compact,
                            onPressed: () =>
                                widget.onRemoveSavedPack!(pack.sha256),
                            icon: const Icon(Icons.close, size: 15),
                          ),
                      ],
                    ),
                  ),
              ],
              const Divider(height: 18),
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      '.ATLAS WORKSPACES',
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: _scanningAtlas ? null : _scanAtlasDirectories,
                    icon: const Icon(Icons.search, size: 14),
                    label: const Text('Scan'),
                  ),
                ],
              ),
              for (final ws in widget.mountedAtlasWorkspaces)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(
                    Icons.sd_storage_outlined,
                    size: 16,
                    color: EarthlyColors.commentGreen,
                  ),
                  title: Text(ws.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text(
                    ws.coverageSummary,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 10),
                  ),
                  trailing: widget.onUnmountAtlasWorkspace != null
                      ? IconButton(
                          tooltip: 'Unmount .atlas',
                          visualDensity: VisualDensity.compact,
                          onPressed: () =>
                              widget.onUnmountAtlasWorkspace!(ws.path),
                          icon: const Icon(Icons.close, size: 15),
                        )
                      : null,
                ),
              for (final found in _discoveredAtlases)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(found.name),
                  subtitle: Text(
                    found.coverageSummary,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 10),
                  ),
                  trailing: FilledButton(
                    onPressed: _scanningAtlas
                        ? null
                        : () => unawaited(_mountAtlasFromPath(found.path)),
                    child: const Text('Mount'),
                  ),
                ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _atlasPathController,
                      onSubmitted: (v) => unawaited(_mountAtlasFromPath(v)),
                      decoration: const InputDecoration(
                        hintText: 'Local .atlas path…',
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton(
                    onPressed: _scanningAtlas
                        ? null
                        : () =>
                            unawaited(_mountAtlasFromPath(_atlasPathController.text)),
                    child: const Text('Mount'),
                  ),
                ],
              ),
              if (_mapError != null) ...[
                const SizedBox(height: 6),
                Text(
                  _mapError!,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: EarthlyColors.destructive,
                  ),
                ),
              ],
            ],
            ),
          ),
        ),
      ],
    );
  }

  // --- Tab 2: Relays, Blossom & Cordn ---

  Color _relayStatusColor(ThemeData theme, RelayQualityReportDto? quality, bool connected) {
    if (quality == null) {
      return connected
          ? EarthlyColors.commentGreen
          : theme.colorScheme.onSurfaceVariant;
    }
    switch (quality.status) {
      case 'healthy':
        return EarthlyColors.commentGreen;
      case 'slow':
        return EarthlyColors.amber;
      case 'auth_required':
        return Colors.deepOrange;
      default:
        return EarthlyColors.destructive;
    }
  }

  String _relayStatusLabel(RelayQualityReportDto? quality, bool connected) {
    if (quality == null) {
      return connected ? 'CONNECTED' : 'UNPROBED';
    }
    switch (quality.status) {
      case 'healthy':
        return 'HEALTHY';
      case 'slow':
        return 'SLOW';
      case 'auth_required':
        return 'AUTH REQ';
      default:
        return 'OFFLINE';
    }
  }

  String _relayRoleLabel(bool read, bool write) {
    if (read && write) return 'R/W';
    if (read) return 'READ';
    if (write) return 'WRITE';
    return 'OFF';
  }

  String _relaySourceLabel(String url, ManagedRelayStatusDto? meta) {
    final src = meta?.source;
    if (src == 'earthly' || url == _defaultRelayUrl) return 'Earthly';
    if (src == 'public_default' || _defaultProductionRelays.contains(url)) {
      return 'Public';
    }
    if (src == 'nip65' || _nip65Relays.any((e) => _normalizeRelayUrl(e.url) == url)) {
      return 'NIP-65';
    }
    if (src == 'nip66') return 'NIP-66';
    if (src == 'profile_discovery' || url == _profileDiscoveryRelayUrl) {
      return 'Profiles';
    }
    return 'Custom';
  }

  String? _nip11SummaryLine(RelayNip11InfoDto? nip11) {
    if (nip11 == null) return null;
    final parts = <String>[];
    if (nip11.name != null && nip11.name!.isNotEmpty) {
      parts.add(nip11.name!);
    }
    if (nip11.software != null && nip11.software!.isNotEmpty) {
      final shortSw = nip11.software!
          .replaceFirst(RegExp(r'^https?://'), '')
          .split('/')
          .last;
      final swText = (nip11.version != null && nip11.version!.isNotEmpty)
          ? '$shortSw ${nip11.version}'
          : shortSw;
      if (swText.isNotEmpty) parts.add(swText);
    }
    if (nip11.supportedNips.isNotEmpty) {
      final preview = nip11.supportedNips.take(6).join(', ');
      final suffix = nip11.supportedNips.length > 6
          ? ' +${nip11.supportedNips.length - 6}'
          : '';
      parts.add('NIPs: $preview$suffix');
    }
    return parts.isEmpty ? null : parts.join(' · ');
  }

  Widget _relayBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(5),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontFamily: 'monospace',
          fontSize: 9.5,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }

  Widget _buildRelaysTab(ThemeData theme) {
    return SingleChildScrollView(
      key: const Key('settings-relays-scroll'),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
        if (_relayStatus != null)
          _statusBanner(_relayStatus!, EarthlyColors.commentGreen),
        if (_relayError != null)
          _statusBanner(_relayError!, EarthlyColors.destructive),
        _sectionCard(
          theme,
          title: 'Nostr Relays (${widget.relayUrls.length})',
          subtitle: widget.relayStreamLive
              ? 'Live WebSocket stream connected · Earthly + public network'
              : 'Connecting to configured relays…',
          trailing: Container(
            width: 9,
            height: 9,
            decoration: BoxDecoration(
              color: widget.relayStreamLive
                  ? EarthlyColors.commentGreen
                  : EarthlyColors.amber,
              shape: BoxShape.circle,
            ),
          ),
          children: [
            SwitchListTile(
              key: const Key('settings-public-relays-switch'),
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text(
                'Public Nostr Relays',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
              ),
              subtitle: const Text(
                'Broadcast & discover public maps, profiles, zaps, and Cashu wallets across major Nostr relays',
                style: TextStyle(fontSize: 11),
              ),
              value: _publicRelaysEnabled,
              onChanged: _updatingPublicPolicy
                  ? null
                  : (v) => unawaited(_togglePublicRelays(v)),
            ),
            const SizedBox(height: 4),
            for (final url in widget.relayUrls)
              () {
                final normUrl = _normalizeRelayUrl(url);
                final meta = _managedRelayMeta[normUrl] ?? _managedRelayMeta[url];
                final quality = _relayQuality[normUrl] ??
                    _relayQuality[url] ??
                    meta?.quality;
                final connected = meta?.connected ?? false;
                final statusColor =
                    _relayStatusColor(theme, quality, connected);
                final statusText = _relayStatusLabel(quality, connected);
                final nip65Entry = _nip65Relays
                    .where((e) => _normalizeRelayUrl(e.url) == normUrl)
                    .firstOrNull;
                final canRead = meta?.read ?? nip65Entry?.read ?? true;
                final canWrite = meta?.write ?? nip65Entry?.write ?? true;
                final sourceLabel = _relaySourceLabel(normUrl, meta);
                final nip11Line = _nip11SummaryLine(quality?.nip11);
                return Container(
                  key: Key('settings-relay-row-$normUrl'),
                  margin: const EdgeInsets.only(bottom: 7),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: theme.dividerColor),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            Icons.cell_tower,
                            size: 15,
                            color: statusColor,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              url,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          IconButton(
                            key: Key('settings-remove-relay-$url'),
                            tooltip: 'Remove relay',
                            visualDensity: VisualDensity.compact,
                            constraints: const BoxConstraints(
                              minWidth: 28,
                              minHeight: 28,
                            ),
                            padding: EdgeInsets.zero,
                            onPressed: widget.relayUrls.length > 1
                                ? () => _removeRelay(url)
                                : null,
                            icon: const Icon(Icons.close, size: 16),
                          ),
                        ],
                      ),
                      const SizedBox(height: 5),
                      Wrap(
                        spacing: 5,
                        runSpacing: 4,
                        children: [
                          _relayBadge(statusText, statusColor),
                          if (quality != null && quality.reachable)
                            _relayBadge(
                              '${quality.rttMs} ms · Q${quality.qualityScore}',
                              statusColor,
                            ),
                          _relayBadge(
                            _relayRoleLabel(canRead, canWrite),
                            theme.colorScheme.primary,
                          ),
                          _relayBadge(
                            sourceLabel,
                            theme.colorScheme.onSurfaceVariant,
                          ),
                          if (quality?.authRequired == true)
                            _relayBadge('Auth', Colors.deepOrange),
                          if (quality?.paymentRequired == true)
                            _relayBadge('Paid', EarthlyColors.amber),
                        ],
                      ),
                      if (nip11Line != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          nip11Line,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ] else if (quality != null &&
                          !quality.reachable &&
                          quality.error != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          quality.error!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10,
                            color: EarthlyColors.destructive,
                          ),
                        ),
                      ],
                    ],
                  ),
                );
              }(),
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
              decoration: BoxDecoration(
                color: theme.colorScheme.surface.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: theme.dividerColor.withValues(alpha: 0.7),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.person_search_outlined,
                    size: 14,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Profile & NIP-65 discovery: $_profileDiscoveryRelayUrl'
                      '${_nip65Relays.isNotEmpty ? ' · ${_nip65Relays.length} NIP-65 active' : ''}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('settings-add-relay-field'),
                    controller: _relayInputController,
                    onSubmitted: (_) => _addRelay(),
                    decoration: const InputDecoration(
                      hintText: 'wss://relay.example.com',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('settings-add-relay-btn'),
                  onPressed: _addRelay,
                  child: const Text('Add'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final preset in _relayPresets)
                  if (!widget.relayUrls.contains(preset))
                    ActionChip(
                      label: Text(
                        preset.replaceFirst('wss://', ''),
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                        ),
                      ),
                      onPressed: () => _addRelay(preset),
                    ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                OutlinedButton.icon(
                  key: const Key('settings-probe-all-relays-btn'),
                  onPressed: _probingRelays ? null : _probeRelays,
                  icon: _probingRelays
                      ? const SizedBox(
                          width: 13,
                          height: 13,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.speed, size: 15),
                  label: Text(_probingRelays ? 'Probing…' : 'Probe All'),
                ),
                FilledButton.tonalIcon(
                  key: const Key('settings-discover-nip66-btn'),
                  onPressed: _discoveringNip66 ? null : _discoverNip66Relays,
                  icon: _discoveringNip66
                      ? const SizedBox(
                          width: 13,
                          height: 13,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.travel_explore, size: 15),
                  label: Text(
                    _discoveringNip66
                        ? 'Discovering…'
                        : 'Discover Public Relays (NIP-66)',
                  ),
                ),
                if (widget.onFetchNip65Relays != null)
                  OutlinedButton.icon(
                    key: const Key('settings-import-nip65-btn'),
                    onPressed: _syncingNip65 ? null : _importNip65Relays,
                    icon: const Icon(Icons.download_outlined, size: 15),
                    label: const Text('Import NIP-65'),
                  ),
                if (widget.onPublishNip65Relays != null)
                  OutlinedButton.icon(
                    key: const Key('settings-publish-nip65-btn'),
                    onPressed: _syncingNip65 ? null : _publishNip65Relays,
                    icon: const Icon(Icons.cloud_upload_outlined, size: 15),
                    label: const Text('Publish NIP-65'),
                  ),
                OutlinedButton(
                  key: const Key('settings-reset-relays-btn'),
                  onPressed: () {
                    widget.onRelayUrlsChanged(
                      List<String>.from(_defaultProductionRelays),
                    );
                    setState(() {
                      _publicRelaysEnabled = true;
                      _relayStatus =
                          'Restored default Earthly + public Nostr relays.';
                      _relayError = null;
                    });
                  },
                  child: const Text('Reset Defaults'),
                ),
              ],
            ),
            if (_nip66Candidates.isNotEmpty) ...[
              const Divider(height: 20),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'DISCOVERED PUBLIC RELAYS (NIP-66 · ${_nip66Candidates.length})',
                      style: theme.textTheme.labelSmall?.copyWith(
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => setState(() => _nip66Candidates = const []),
                    child: const Text('Clear'),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              for (final candidate in _nip66Candidates)
                () {
                  final norm = _normalizeRelayUrl(candidate.url);
                  final alreadyAdded = widget.relayUrls.any(
                    (u) => _normalizeRelayUrl(u) == norm,
                  );
                  final probe = candidate.liveProbe;
                  final color = _relayStatusColor(theme, probe, false);
                  final rtt = probe != null && probe.reachable
                      ? probe.rttMs
                      : candidate.rttOpenMs ?? candidate.rttReadMs;
                  final swShort = candidate.software
                      ?.replaceFirst(RegExp(r'^https?://'), '')
                      .split('/')
                      .last;
                  final metaParts = <String>[
                    if (swShort != null && swShort.isNotEmpty) swShort,
                    if (candidate.supportedNips.isNotEmpty)
                      '${candidate.supportedNips.length} NIPs',
                    if (candidate.countryCode != null &&
                        candidate.countryCode!.isNotEmpty)
                      candidate.countryCode!,
                    if (candidate.monitorCount > 0)
                      '${candidate.monitorCount} mon',
                  ];
                  return Container(
                    key: Key('settings-nip66-candidate-$norm'),
                    margin: const EdgeInsets.only(bottom: 6),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surface,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: theme.dividerColor),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                norm,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Wrap(
                                spacing: 4,
                                runSpacing: 4,
                                children: [
                                  if (probe != null)
                                    _relayBadge(
                                      _relayStatusLabel(probe, false),
                                      color,
                                    ),
                                  if (rtt != null)
                                    _relayBadge('$rtt ms', color),
                                  if (probe != null && probe.reachable)
                                    _relayBadge('Q${probe.qualityScore}', color),
                                  if (candidate.authRequired)
                                    _relayBadge('Auth', Colors.deepOrange),
                                  if (candidate.paymentRequired)
                                    _relayBadge('Paid', EarthlyColors.amber),
                                ],
                              ),
                              if (metaParts.isNotEmpty) ...[
                                const SizedBox(height: 3),
                                Text(
                                  metaParts.join(' · '),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 10,
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        alreadyAdded
                            ? _relayBadge('ADDED', EarthlyColors.commentGreen)
                            : FilledButton.tonal(
                                key: Key('settings-nip66-add-$norm'),
                                onPressed: () => _addRelay(norm, true),
                                style: FilledButton.styleFrom(
                                  visualDensity: VisualDensity.compact,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 4,
                                  ),
                                ),
                                child: const Text('Add'),
                              ),
                      ],
                    ),
                  );
                }(),
            ],
          ],
        ),
        _sectionCard(
          theme,
          title: 'Blossom Media Server',
          subtitle:
              'Used for large datasets, encrypted MLS attachments, and multi-device backups',
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('settings-blossom-url-field'),
                    controller: _blossomController,
                    onSubmitted: (_) => _saveBlossom(),
                    decoration: const InputDecoration(
                      hintText: 'https://blossom.earthly.city',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  key: const Key('settings-blossom-save-btn'),
                  onPressed: _saveBlossom,
                  child: const Text('Save'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final url in _blossomPresets)
                  ActionChip(
                    label: Text(
                      url.replaceFirst('https://', ''),
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                      ),
                    ),
                    onPressed: () => _saveBlossom(url),
                  ),
              ],
            ),
          ],
        ),
        _sectionCard(
          theme,
          title: 'MLS Coordinator (Cordn)',
          subtitle:
              'Content-opaque ContextVM server ordering MLS group commits',
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('settings-cordn-pubkey-field'),
                    controller: _cordnController,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
                    onSubmitted: (_) => _saveCordn(),
                    decoration: const InputDecoration(
                      hintText: '64-char hex pubkey',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  key: const Key('settings-cordn-save-btn'),
                  onPressed: _saveCordn,
                  child: const Text('Save'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                ActionChip(
                  label: const Text('earthly.city Prod'),
                  onPressed: () => _saveCordn(_defaultCordnProdPubkey),
                ),
                ActionChip(
                  label: const Text('Local Dev Cordn'),
                  onPressed: () => _saveCordn(_defaultCordnDevPubkey),
                ),
              ],
            ),
          ],
        ),
        ],
      ),
    );
  }

  // --- Tab 3: Chat / AI Credentials ---

  Widget _buildChatTab(ThemeData theme) {
    final showCashuControls = widget.agentSettings.isRoutstr ||
        _baseUrlController.text.trim().toLowerCase().contains('routstr.com') ||
        widget.agentSettings.autoPayCashu;
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      children: [
        if (_chatInfo != null)
          _statusBanner(_chatInfo!, EarthlyColors.commentGreen),
        if (_chatError != null)
          _statusBanner(_chatError!, EarthlyColors.destructive),
        _sectionCard(
          theme,
          title: 'Chat Provider & Credentials',
          subtitle: 'API keys are encrypted at rest using your device keystore',
          children: [
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                ChoiceChip(
                  key: const Key('settings-chat-preset-offline'),
                  label: const Text('Offline Rust'),
                  selected: widget.agentSettings.baseUrl.isEmpty,
                  onSelected: (_) =>
                      _applyAgentPreset(CopilotProviderSettings.offline),
                ),
                ChoiceChip(
                  key: const Key('settings-chat-preset-ollama'),
                  label: const Text('Local Ollama'),
                  selected: widget.agentSettings.baseUrl.contains('11434'),
                  onSelected: (_) =>
                      _applyAgentPreset(CopilotProviderSettings.localOllama),
                ),
                ChoiceChip(
                  key: const Key('settings-chat-preset-openrouter'),
                  label: const Text('OpenRouter'),
                  selected: widget.agentSettings.baseUrl.contains('openrouter.ai'),
                  onSelected: (_) =>
                      _applyAgentPreset(CopilotProviderSettings.openRouter),
                ),
                ChoiceChip(
                  key: const Key('settings-chat-preset-openai'),
                  label: const Text('OpenAI'),
                  selected:
                      widget.agentSettings.baseUrl.contains('api.openai.com'),
                  onSelected: (_) => _applyAgentPreset(
                    const CopilotProviderSettings(
                      presetName: 'OpenAI',
                      baseUrl: 'https://api.openai.com/v1',
                      model: 'gpt-4o-mini',
                    ),
                  ),
                ),
                ChoiceChip(
                  key: const Key('settings-chat-preset-routstr'),
                  label: const Text('Routstr (Cashu)'),
                  selected: widget.agentSettings.isRoutstr,
                  onSelected: (_) =>
                      _applyAgentPreset(CopilotProviderSettings.routstr),
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              key: const Key('settings-chat-baseurl-field'),
              controller: _baseUrlController,
              decoration: const InputDecoration(
                labelText: 'OpenAI-compatible Base URL (blank = offline)',
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              key: const Key('settings-chat-model-field'),
              controller: _modelController,
              decoration: const InputDecoration(labelText: 'Model'),
            ),
            const SizedBox(height: 8),
            TextField(
              key: const Key('settings-chat-apikey-field'),
              controller: _apiKeyController,
              obscureText: _obscureApiKey,
              decoration: InputDecoration(
                labelText: 'API Key / Bearer Credential',
                suffixIcon: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      tooltip: _obscureApiKey ? 'Show key' : 'Hide key',
                      onPressed: () =>
                          setState(() => _obscureApiKey = !_obscureApiKey),
                      icon: Icon(
                        _obscureApiKey
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                        size: 18,
                      ),
                    ),
                    if (_apiKeyController.text.isNotEmpty)
                      IconButton(
                        tooltip: 'Clear API key',
                        onPressed: () {
                          _apiKeyController.clear();
                          _saveAgentSettings();
                        },
                        icon: const Icon(Icons.close, size: 18),
                      ),
                  ],
                ),
              ),
            ),
            if (showCashuControls) ...[
              const SizedBox(height: 8),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Auto-pay with Cashu Wallet'),
                subtitle: const Text(
                  'Attach X-Cashu ecash on Routstr requests & redeem change',
                  style: TextStyle(fontSize: 11.5),
                ),
                value: widget.agentSettings.autoPayCashu,
                onChanged: (val) => widget.onAgentSettingsChanged(
                  _buildAgentSettings(autoPayOverride: val),
                ),
              ),
              Row(
                children: [
                  SizedBox(
                    width: 118,
                    child: TextField(
                      controller: _cashuMaxSatsController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Max prepay (sat)',
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _cashuTokenController,
                      decoration: const InputDecoration(
                        labelText: 'Manual X-Cashu token',
                      ),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  key: const Key('settings-chat-discover-btn'),
                  onPressed: _discoveringModels ? null : _discoverModels,
                  icon: _discoveringModels
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.manage_search, size: 16),
                  label: Text(
                    _discoveringModels ? 'Checking /models…' : 'Discover Models',
                  ),
                ),
                FilledButton(
                  key: const Key('settings-chat-apply-btn'),
                  onPressed: _saveAgentSettings,
                  child: const Text('Apply Credentials'),
                ),
              ],
            ),
            if (_discoveredModels.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 5,
                children: [
                  for (final m in _discoveredModels.take(18))
                    ActionChip(
                      label: Text(
                        m,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                        ),
                      ),
                      onPressed: () {
                        _modelController.text = m;
                        _saveAgentSettings();
                      },
                    ),
                ],
              ),
            ],
          ],
        ),
        _sectionCard(
          theme,
          title: 'Chat Behavior & Vision',
          children: [
            SwitchListTile(
              key: const Key('settings-safe-editing-switch'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Safe Editing (Ghost Diffs)'),
              subtitle: const Text(
                'Preview AI geometry edits as amber ghosts before applying',
                style: TextStyle(fontSize: 11.5),
              ),
              value: widget.safeEditing,
              onChanged: widget.onSafeEditingChanged,
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Attach Map View to Prompts'),
              subtitle: Text(
                'Model vision status: ${widget.visionSupport}',
                style: const TextStyle(fontSize: 11.5),
              ),
              value: widget.attachMapView,
              onChanged: widget.onAttachMapViewChanged,
            ),
          ],
        ),
        if (widget.onOpenMcpBridge != null)
          _sectionCard(
            theme,
            title: 'MCP Bridge',
            subtitle: widget.mcpBridgeRunning
                ? 'Local MCP bridge is running for external AI agents'
                : 'Expose local map tools to external MCP clients',
            children: [
              OutlinedButton.icon(
                onPressed: widget.onOpenMcpBridge,
                icon: const Icon(Icons.hub_outlined, size: 16),
                label: const Text('Manage MCP Bridge'),
              ),
            ],
          ),
      ],
    );
  }

  // --- Tab 4: Account & Wallet ---

  Widget _buildAccountTab(ThemeData theme) {
    final pk = widget.account?.pubkey;
    final shortPk = pk != null && pk.length > 16
        ? '${pk.substring(0, 8)}…${pk.substring(pk.length - 6)}'
        : (pk ?? 'Not signed in');
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      children: [
        _sectionCard(
          theme,
          title: 'Nostr Identity & Signer',
          subtitle: widget.signerModeLabel,
          children: [
            Text(
              shortPk,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 10),
            FilledButton.icon(
              key: const Key('settings-open-account-btn'),
              onPressed: widget.onOpenAccount,
              icon: const Icon(Icons.verified_user_outlined, size: 16),
              label: const Text('Manage Accounts, Keys & Bunker'),
            ),
          ],
        ),
        _sectionCard(
          theme,
          title: 'Cashu Wallet (NIP-60 / NIP-61)',
          subtitle: 'Disabled by default for new users · remembered across restarts',
          children: [
            SwitchListTile(
              key: const Key('settings-cashu-wallet-switch'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Enable NIP-60 Cashu Wallet'),
              subtitle: Text(
                widget.cashuWalletEnabled
                    ? (widget.cashuBalanceSats != null
                        ? 'Balance: ${widget.cashuBalanceSats} sats'
                        : 'Enabled · tap below to sync & manage ecash')
                    : 'Turn on to sync ecash proofs and zap/pay Routstr',
                style: const TextStyle(fontSize: 11.5),
              ),
              value: widget.cashuWalletEnabled,
              onChanged: widget.onSetCashuWalletEnabled,
            ),
            if (widget.cashuWalletEnabled && widget.onOpenCashuWallet != null)
              OutlinedButton.icon(
                onPressed: widget.onOpenCashuWallet,
                icon: const Icon(Icons.account_balance_wallet_outlined, size: 16),
                label: const Text('Open Cashu Wallet'),
              ),
          ],
        ),
        _sectionCard(
          theme,
          title: 'Muted Accounts (${widget.mutedPubkeys.length})',
          subtitle: 'Events from muted pubkeys are hidden across Explore & Chat',
          children: [
            if (widget.mutedPubkeys.isEmpty)
              Text(
                'No muted accounts.',
                style: theme.textTheme.bodySmall,
              )
            else
              for (final muted in widget.mutedPubkeys)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    muted.length > 18
                        ? '${muted.substring(0, 10)}…${muted.substring(muted.length - 6)}'
                        : muted,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11.5),
                  ),
                  trailing: widget.onUnmutePubkey != null
                      ? TextButton(
                          onPressed: () => widget.onUnmutePubkey!(muted),
                          child: const Text('Unmute'),
                        )
                      : null,
                ),
          ],
        ),
      ],
    );
  }

  // --- Tab 5: System ---

  Widget _buildSystemTab(ThemeData theme) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      children: [
        _sectionCard(
          theme,
          title: 'Drawing & Precision Defaults',
          children: [
            if (widget.onPlacementStyleChanged != null) ...[
              Text(
                'TOUCH PLACEMENT',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontSize: 10,
                ),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                children: [
                  ChoiceChip(
                    label: const Text('Draw-Drag'),
                    selected:
                        widget.placementStyle == TouchPlacementStyle.drawDrag,
                    onSelected: (_) => widget.onPlacementStyleChanged!(
                      TouchPlacementStyle.drawDrag,
                    ),
                  ),
                  ChoiceChip(
                    label: const Text('Crosshair'),
                    selected:
                        widget.placementStyle == TouchPlacementStyle.crosshair,
                    onSelected: (_) => widget.onPlacementStyleChanged!(
                      TouchPlacementStyle.crosshair,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
            ],
            if (widget.onLoupeChanged != null)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Precision Magnifier Loupe'),
                value: widget.loupeEnabled,
                onChanged: widget.onLoupeChanged,
              ),
            if (widget.onSnappingChanged != null)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Vertex Snapping'),
                value: widget.snappingEnabled,
                onChanged: widget.onSnappingChanged,
              ),
            if (widget.onSnapToEdgesChanged != null)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Snap to Line & Polygon Edges'),
                value: widget.snapToEdgesEnabled,
                onChanged: widget.onSnapToEdgesChanged,
              ),
          ],
        ),
        _sectionCard(
          theme,
          title: 'Local Rust Node & Outbox',
          subtitle: 'Embedded Blossom blob store, P2P relay, and durable delivery queue',
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (widget.onOpenRustNode != null)
                  OutlinedButton.icon(
                    onPressed: widget.onOpenRustNode,
                    icon: const Icon(Icons.memory, size: 16),
                    label: const Text('Rust Node Diagnostics'),
                  ),
                if (widget.onOpenOutbox != null)
                  OutlinedButton.icon(
                    onPressed: widget.onOpenOutbox,
                    icon: const Icon(Icons.outbox_outlined, size: 16),
                    label: Text(
                      widget.pendingOutboxCount > 0
                          ? 'Outbox Queue (${widget.pendingOutboxCount})'
                          : 'Outbox Queue',
                    ),
                  ),
              ],
            ),
          ],
        ),
        _sectionCard(
          theme,
          title: 'Catalog & Help',
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (widget.onRefreshCatalog != null)
                  OutlinedButton.icon(
                    onPressed: widget.onRefreshCatalog,
                    icon: const Icon(Icons.refresh, size: 16),
                    label: const Text('Refresh Nostr Catalog'),
                  ),
                if (widget.onOpenHelp != null)
                  OutlinedButton.icon(
                    onPressed: widget.onOpenHelp,
                    icon: const Icon(Icons.help_outline, size: 16),
                    label: const Text('Help & Keyboard Shortcuts'),
                  ),
              ],
            ),
          ],
        ),
      ],
    );
  }

  Widget _statusBanner(String text, Color color) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontFamily: 'monospace',
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}
