import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import 'controllers/account_wallet_controller.dart';
import 'controllers/agent_controller.dart';
import 'controllers/catalog_shelf_controller.dart';
import 'controllers/draft_workbench_controller.dart';
import 'controllers/map_layer_cache.dart';
import 'controllers/spaces_sync_controller.dart';
import 'drawing/drawing_model.dart';
import 'drawing/touch_draw_overlay.dart';
import 'nostr/basemap_config.dart';
import 'nostr/callout_overlay.dart';
import 'nostr/map_poster_exporter.dart';
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
import 'shell/cashu_wallet_sheet.dart';
import 'shell/circles_sheet.dart';
import 'shell/dataset_detail_margin.dart';
import 'shell/desk_sheet.dart';
import 'shell/discussion_margin_sheet.dart';
import 'shell/drawer_navigation.dart';
import 'shell/earthly_rich_text.dart';
import 'shell/earthly_toast.dart';
import 'shell/explore_sheet.dart';
import 'shell/feature_inspector_sheet.dart';
import 'shell/help_shortcuts_sheet.dart';
import 'shell/inbox_sheet.dart';
import 'shell/location_inspector_sheet.dart';
import 'shell/map_drawer.dart';
import 'shell/mcp_bridge_sheet.dart';
import 'shell/mobile_drawing_tools_sheet.dart';
import 'shell/osm_import_sheet.dart';
import 'shell/outbox_queue_sheet.dart';
import 'shell/person_margin.dart';
import 'shell/place_search_sheet.dart';
import 'shell/routing_sheet.dart';
import 'shell/settings_sheet.dart';
import 'shell/shoutbox_sheet.dart';
import 'shell/sighting_composer_sheet.dart';
import 'shell/spaces_sheet.dart';
import 'shell/story_composer_sheet.dart';
import 'shell/story_reader_margin.dart';
import 'shell/zap_dialog.dart';
import 'spike/rust_node_sheet.dart';
import 'src/rust/api/agent.dart';
import 'src/rust/api/blossom.dart';
import 'src/rust/api/mcp_bridge.dart';
import 'src/rust/api/nostr_client.dart';
import 'src/rust/api/private_groups.dart';
import 'src/rust/api/publish.dart';
import 'src/rust/api/settings.dart';
import 'src/rust/api/spike.dart';
import 'src/rust/api/wallet.dart';
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

class EarthlyNativeApp extends StatefulWidget {
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
  State<EarthlyNativeApp> createState() => _EarthlyNativeAppState();
}

class _EarthlyNativeAppState extends State<EarthlyNativeApp> {
  ThemeMode _themeMode = ThemeMode.system;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Earthly',
      debugShowCheckedModeBanner: false,
      theme: buildEarthlyTheme(Brightness.light),
      darkTheme: buildEarthlyTheme(Brightness.dark),
      themeMode: _themeMode,
      home: EarthlySpikeHome(
        mapBuilder: widget.mapBuilder,
        themeMode: _themeMode,
        onThemeModeChanged: (mode) => setState(() => _themeMode = mode),
      ),
    );
  }
}

class EarthlySpikeHome extends StatefulWidget {
  const EarthlySpikeHome({
    this.mapBuilder,
    this.themeMode = ThemeMode.system,
    this.onThemeModeChanged,
    this.mapLayerCache,
    this.agentController,
    this.draftController,
    this.accountController,
    this.catalogController,
    this.spacesController,
    this.toastController,
    this.drawerNavigationController,
    this.cameraOrientationNotifier,
    this.onReNorthRequested,
    this.onFlyToBoundsRequested,
    this.onCameraPositionRequested,
    this.onExitAppRequested,
    this.clock,
    super.key,
  });

  final Widget Function(
    BuildContext context,
    MapGestures gestures,
    ValueChanged<MapController> onMapCreated,
    VoidCallback onCameraMove,
  )? mapBuilder;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode>? onThemeModeChanged;
  final MapLayerCache? mapLayerCache;
  final AgentController? agentController;
  final DraftWorkbenchController? draftController;
  final AccountWalletController? accountController;
  final CatalogShelfController? catalogController;
  final SpacesSyncController? spacesController;
  final EarthlyToastController? toastController;
  final DrawerNavigationController? drawerNavigationController;
  final ValueNotifier<({double bearing, double pitch})>?
      cameraOrientationNotifier;
  final VoidCallback? onReNorthRequested;
  final ValueChanged<GeoBox>? onFlyToBoundsRequested;
  final void Function(double lon, double lat, double zoom)?
      onCameraPositionRequested;
  final VoidCallback? onExitAppRequested;
  final DateTime Function()? clock;

  @override
  State<EarthlySpikeHome> createState() => _EarthlySpikeHomeState();
}

class _EarthlySpikeHomeState extends State<EarthlySpikeHome>
    with WidgetsBindingObserver {
  late final MapLayerCache _mapLayers;
  late final AgentController _agent;
  late final DraftWorkbenchController _draft;
  late final AccountWalletController _accountWallet;
  late final CatalogShelfController _catalog;
  late final SpacesSyncController _spaces;
  late final EarthlyToastController _toast;
  late final DrawerNavigationController _drawerNav;

  late final bool _ownsMapLayers;
  late final bool _ownsAgent;
  late final bool _ownsDraft;
  late final bool _ownsAccountWallet;
  late final bool _ownsCatalog;
  late final bool _ownsSpaces;
  late final bool _ownsToast;
  late final bool _ownsDrawerNav;
  late final ValueNotifier<({double bearing, double pitch})>
      _cameraOrientationNotifier;
  late final bool _ownsCameraOrientationNotifier;
  EarthlySettingsTab _settingsInitialTab = EarthlySettingsTab.map;
  int _lastClusteredSyncRevision = -1;
  String _lastSearchQuery = '';

  final ValueNotifier<MapController?> _controllerNotifier =
      ValueNotifier<MapController?>(null);
  final GlobalKey _mapRepaintBoundaryKey = GlobalKey();

  MapController? get _controller => _controllerNotifier.value;
  EarthlyDrawer get _drawer => _drawerNav.left;
  EarthlyDrawer get _rightStudioDrawer => _drawerNav.right;
  bool get _isHeadlessTest => widget.mapBuilder != null;
  bool get _isWideStudio => mounted && MediaQuery.sizeOf(context).width >= 1100;

  @override
  void initState() {
    super.initState();
    _ownsMapLayers = widget.mapLayerCache == null;
    _ownsAgent = widget.agentController == null;
    _ownsDraft = widget.draftController == null;
    _ownsAccountWallet = widget.accountController == null;
    _ownsCatalog = widget.catalogController == null;
    _ownsSpaces = widget.spacesController == null;
    _ownsToast = widget.toastController == null;
    _ownsDrawerNav = widget.drawerNavigationController == null;
    _ownsCameraOrientationNotifier = widget.cameraOrientationNotifier == null;

    _mapLayers = widget.mapLayerCache ?? MapLayerCache();
    _agent = widget.agentController ?? AgentController();
    _draft = widget.draftController ?? DraftWorkbenchController();
    _accountWallet = widget.accountController ?? AccountWalletController();
    _catalog = widget.catalogController ?? CatalogShelfController();
    _spaces = widget.spacesController ?? SpacesSyncController();
    _toast = widget.toastController ?? EarthlyToastController();
    _drawerNav = widget.drawerNavigationController ??
        DrawerNavigationController(clock: widget.clock);
    _cameraOrientationNotifier = widget.cameraOrientationNotifier ??
        ValueNotifier<({double bearing, double pitch})>(
          (bearing: 0.0, pitch: 0.0),
        );

    WidgetsBinding.instance.addObserver(this);
    if (!_isHeadlessTest) {
      unawaited(_bootstrapPersistentState());
      _spaces.startTimers(
        isHeadlessTest: _isHeadlessTest,
        onLivePollTick: _pollLiveNearbyUpdates,
        onOutboxFlushTick: () =>
            _spaces.flushAndRefreshOutbox(isHeadlessTest: _isHeadlessTest),
      );
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !_isHeadlessTest) {
      unawaited(_spaces.flushAndRefreshOutbox(isHeadlessTest: _isHeadlessTest));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controllerNotifier.dispose();
    if (_ownsDrawerNav) _drawerNav.dispose();
    if (_ownsToast) _toast.dispose();
    if (_ownsCameraOrientationNotifier) _cameraOrientationNotifier.dispose();
    if (_ownsMapLayers) _mapLayers.dispose();
    if (_ownsAgent) _agent.dispose();
    if (_ownsDraft) _draft.dispose();
    if (_ownsAccountWallet) _accountWallet.dispose();
    if (_ownsCatalog) _catalog.dispose();
    if (_ownsSpaces) _spaces.dispose();
    super.dispose();
  }

  // --- Bootstrap & Settings Persistence ---

  Future<String> _databasePath() async {
    final dir = await getApplicationSupportDirectory();
    return '${dir.path}/earthly.sqlite3';
  }

  Future<void> _bootstrapPersistentState() async {
    DeviceBridge.setDeepLinkHandler(_handleIncomingDeepLink);
    DeviceBridge.setDroppedFileHandler(
      (file) => unawaited(_handleDroppedSpatialOrPmtilesFile(file)),
    );
    DeviceBridge.setGpsTrackPointHandler(_draft.onGpsTrackPoint);
    final dir = await getApplicationSupportDirectory();
    _spaces.supportDirPath = dir.path;
    if (mounted) _spaces.setMlsDatabasePath('${dir.path}/mls.sqlite3');

    var masterKeyReady = false;
    try {
      await RustBridge.ensureInitialized();
      final masterKey = await DeviceBridge.getOrCreateMasterKey();
      if (masterKey != null && masterKey.isNotEmpty) {
        _accountWallet.settingsMasterKey = masterKey;
        await setSettingsMasterKey(masterKeyBase64: masterKey);
        masterKeyReady = true;
      }
    } catch (_) {}

    final hasSecrets = await _restoreAppSettings();
    if (masterKeyReady && hasSecrets) {
      unawaited(_persistAppSettings());
    }
    unawaited(
      _accountWallet.syncExternalCircleSigner(isHeadlessTest: _isHeadlessTest),
    );
    if (_accountWallet.nip60WalletEnabled) {
      unawaited(
        _accountWallet.refreshCashuWalletState(isHeadlessTest: _isHeadlessTest),
      );
    }
    unawaited(_agent.refreshVisionSupport(isHeadlessTest: _isHeadlessTest));
    final bookmarksUpdated =
        await _mapLayers.restoreMacOsSecurityScopedBookmarks(
      supportDirPath: _spaces.supportDirPath,
    );
    if (bookmarksUpdated) unawaited(_persistAppSettings());
    await _spaces.initPersistentRelayPool(
      dir.path,
      _catalog.relayUrls,
      isHeadlessTest: _isHeadlessTest,
    );
    await _draft.restoreSavedDraft();
    unawaited(_spaces.flushAndRefreshOutbox(isHeadlessTest: _isHeadlessTest));
    unawaited(_draft.syncActiveGpsTrackFromService());
    unawaited(
      _spaces
          .refreshCirclesSnapshot(
            accountPubkey: _accountWallet.account?.pubkey,
            isHeadlessTest: _isHeadlessTest,
          )
          .whenComplete(() {
        if (mounted) unawaited(_startCircleLiveStream());
      }),
    );
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

  Future<bool> _restoreAppSettings() async {
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final loaded = await loadAppSettings(databasePath: dbPath);
      final hasSecrets = (loaded.localNsec?.isNotEmpty ?? false) ||
          (loaded.bunkerClientNsec?.isNotEmpty ?? false) ||
          (loaded.nwcUri?.isNotEmpty ?? false) ||
          loaded.agentApiKey.isNotEmpty ||
          loaded.savedAccounts.any(
            (a) =>
                (a.localNsec?.isNotEmpty ?? false) ||
                (a.bunkerClientNsec?.isNotEmpty ?? false),
          );
      if (!mounted) return hasSecrets;

      _accountWallet.applyRestoredSessions(loaded);
      _spaces.applyRestoredSettings(loaded);
      _agent.applyRestoredSettings(
        CopilotProviderSettings(
          presetName: loaded.agentPreset,
          baseUrl: loaded.agentBaseUrl,
          model: loaded.agentModel,
          apiKey: loaded.agentApiKey,
          providerType: loaded.agentProviderType,
          autoPayCashu: loaded.agentAutoPayCashu,
          cashuMaxSats: loaded.agentCashuMaxSats,
        ),
      );
      _agent.restoreThreadsFromJson(loaded.agentMessagesJson);
      _catalog.applyRestoredSettings(
        restoredRelayUrls: loaded.relayUrls,
        restoredPinnedEntityIds: loaded.pinnedEntityIds,
        restoredRecentEntityIds: loaded.recentEntityIds,
        restoredBlossomServerUrl: loaded.blossomServerUrl,
        restoredStoryDraftJson: loaded.storyDraftJson,
      );
      _mapLayers.applyRestoredPresentation(
        offlinePacks: loaded.offlinePacks,
        atlasWorkspaces: loaded.mountedAtlasWorkspaces,
        restoredBasemap: basemapKindFromId(loaded.basemapStyle),
        restoredBackgroundMode: backgroundModeFromId(loaded.satelliteMode),
        restoredSatelliteOpacity: loaded.satelliteOpacity,
        restoredPointClusteringEnabled: loaded.pointClusteringEnabled,
        restoredPointClusterRadius: loaded.pointClusterRadius,
        restoredPointClusterMaxZoom: loaded.pointClusterMaxZoom,
      );
      widget.onThemeModeChanged?.call(themeModeFromId(loaded.themeMode));

      if (_accountWallet.savedAccounts.isNotEmpty) {
        unawaited(
          _accountWallet.resolveSessionProfiles(
            _catalog.relayUrls,
            isHeadlessTest: _isHeadlessTest,
          ),
        );
      }
      return hasSecrets;
    } catch (_) {
      return false;
    }
  }

  Future<void> _persistAppSettings() async {
    if (_isHeadlessTest) return;
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final syncedSessions = _accountWallet.buildSyncedSavedAccounts();
      await saveAppSettings(
        databasePath: dbPath,
        settings: AppSettingsDto(
          relayUrls: _catalog.relayUrls,
          localPubkeyHex: (_accountWallet.localNsec != null ||
                  _accountWallet.bunkerUri != null)
              ? _accountWallet.account?.pubkey
              : null,
          localNsec: _accountWallet.localNsec,
          agentPreset: _agent.settings.presetName,
          agentBaseUrl: _agent.settings.baseUrl,
          agentModel: _agent.settings.model,
          agentApiKey: _agent.settings.apiKey,
          offlinePacks:
              List<SavedOfflinePackDto>.from(_mapLayers.savedOfflinePacks),
          pinnedEntityIds: _catalog.pinnedEntityIds.toList(growable: false),
          recentEntityIds: List<String>.from(_catalog.recentEntityIds),
          cordnServerPubkey: _spaces.cordnServerPubkey,
          bunkerUri: _accountWallet.bunkerUri,
          bunkerClientNsec: _accountWallet.bunkerClientNsec,
          mountedAtlasWorkspaces: List<MountedAtlasWorkspaceDto>.from(
            _mapLayers.mountedAtlasWorkspaces,
          ),
          blossomServerUrl: _catalog.blossomServerUrl,
          inboxReadAllBefore: BigInt.from(_spaces.inboxReadAllBefore),
          inboxReadIds: _spaces.inboxReadIds.take(500).toList(growable: false),
          savedAccounts: syncedSessions,
          activeAccountId: _accountWallet.activeAccountId,
          mutedPubkeys: _accountWallet.mutedPubkeys.toList(growable: false),
          themeMode: themeModeToId(widget.themeMode),
          basemapStyle: basemapKindToId(_mapLayers.selectedBasemap),
          satelliteMode: backgroundModeToId(_mapLayers.backgroundMode),
          satelliteOpacity: _mapLayers.satelliteOpacity,
          storyDraftJson: _catalog.savedStoryDraft != null
              ? jsonEncode(_catalog.savedStoryDraft)
              : null,
          agentMessagesJson: _agent.encodePersistedThreadsJson(),
          nwcUri: _accountWallet.nwcUri,
          nip60WalletEnabled: _accountWallet.nip60WalletEnabled,
          pointClusteringEnabled: _mapLayers.pointClusteringEnabled,
          pointClusterRadius: _mapLayers.pointClusterRadius,
          pointClusterMaxZoom: _mapLayers.pointClusterMaxZoom,
          agentProviderType: _agent.settings.providerType,
          agentAutoPayCashu: _agent.settings.autoPayCashu,
          agentCashuMaxSats: _agent.settings.cashuMaxSats,
        ),
      );
    } catch (_) {}
  }

  void _schedulePersistWorkingDraft() {
    unawaited(
      _draft.persistWorkingDraft(
        isHeadlessTest: _isHeadlessTest,
        onAfterPersist: _syncMcpWorkspaceIfRunning,
      ),
    );
  }

  void _syncMcpWorkspaceIfRunning() {
    _agent.syncMcpWorkspaceIfRunning(
      isHeadlessTest: _isHeadlessTest,
      buildWorkspace: _buildMcpWorkspaceDto,
    );
  }

  McpWorkspaceDto _buildMcpWorkspaceDto() {
    final cam = _controller?.camera;
    return _agent.buildMcpWorkspaceDto(
      center: cam?.center ?? const Geographic(lon: 16.3738, lat: 48.2082),
      zoom: cam?.zoom ?? 13.5,
      draftTitle: _draft.draftTitle,
      draftFeatures: _draft.features,
      shelfMaps: _catalog.shelfMaps,
      atlasWorkspaces: _mapLayers.mountedAtlasWorkspaces,
      catalog: _catalog.catalog,
    );
  }

  Future<void> _pollMcpBridgeTick() => _agent.pollMcpBridgeTick(
        isHeadlessTest: _isHeadlessTest,
        buildWorkspace: _buildMcpWorkspaceDto,
        onDraftMutated: (parsed) {
          _draft.applyAiFeatures(parsed, onPersist: _schedulePersistWorkingDraft);
        },
        onCameraAction: _animateCameraPosition,
      );

  // --- Coordinated Cross-Controller Helpers ---

  void _showToast(
    String message, {
    EarthlyToastSeverity severity = EarthlyToastSeverity.info,
    String? actionLabel,
    VoidCallback? onAction,
    Duration? duration,
    String? copyText,
  }) {
    if (!mounted) return;
    _toast.show(
      message,
      severity: severity,
      actionLabel: actionLabel,
      onAction: onAction,
      duration: duration,
      copyText: copyText,
    );
  }

  void _showSuccessToast(
    String message, {
    String? actionLabel,
    VoidCallback? onAction,
    Duration? duration,
  }) =>
      _showToast(
        message,
        severity: EarthlyToastSeverity.success,
        actionLabel: actionLabel,
        onAction: onAction,
        duration: duration,
      );

  void _showWarningToast(
    String message, {
    String? actionLabel,
    VoidCallback? onAction,
    Duration? duration,
  }) =>
      _showToast(
        message,
        severity: EarthlyToastSeverity.warning,
        actionLabel: actionLabel,
        onAction: onAction,
        duration: duration,
      );

  void _showErrorToast(
    String message, {
    String? copyText,
    String? actionLabel,
    VoidCallback? onAction,
    Duration? duration,
  }) =>
      _showToast(
        message,
        severity: EarthlyToastSeverity.error,
        copyText: copyText,
        actionLabel: actionLabel,
        onAction: onAction,
        duration: duration,
      );

  void _animateCameraPosition(double lon, double lat, double zoom) {
    widget.onCameraPositionRequested?.call(lon, lat, zoom);
    _controller?.animateCamera(
      CameraUpdate.position(
        center: Geographic(lon: lon, lat: lat),
        zoom: zoom,
      ),
    );
  }

  bool get _isMapRotatedOrTilted {
    final ori = _cameraOrientationNotifier.value;
    final b = ((ori.bearing % 360) + 360) % 360;
    final offNorth = b > 1.0 && b < 359.0;
    return offNorth || ori.pitch.abs() > 1.0;
  }

  String _reNorthTooltip(({double bearing, double pitch}) ori) {
    final b = ((ori.bearing % 360) + 360) % 360;
    if (b > 1.0 && b < 359.0) {
      return 'Re-north map (${b.round()}°)';
    }
    if (ori.pitch.abs() > 1.0) {
      return 'Reset map tilt (${ori.pitch.round()}°)';
    }
    return 'Re-north map';
  }

  void _reNorthMap() {
    _cameraOrientationNotifier.value = (bearing: 0.0, pitch: 0.0);
    widget.onReNorthRequested?.call();
    _controller?.animateCamera(
      CameraUpdate.position(bearing: 0.0, pitch: 0.0),
      animation: const CameraAnimation.ease(
        duration: Duration(milliseconds: 240),
      ),
    );
  }

  void _scheduleClusteredPointsSync({bool force = false}) {
    if (_isHeadlessTest) return;
    final rev = _mapLayers.revision;
    if (!force && _lastClusteredSyncRevision == rev) return;
    _lastClusteredSyncRevision = rev;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(
        _mapLayers.syncClusteredPoints(
          controller: _controller,
          onInspectFeature: _inspectFeature,
        ),
      );
    });
  }

  void _openSettings({EarthlySettingsTab tab = EarthlySettingsTab.map}) {
    setState(() => _settingsInitialTab = tab);
    _openDrawer(EarthlyDrawer.settings);
  }

  String _signerModeLabel() {
    if (_accountWallet.account == null) return 'Not signed in';
    if (_accountWallet.isReadOnlySession) return 'Read-only watch (npub)';
    if (_accountWallet.localNsec?.trim().isNotEmpty ?? false) {
      return 'Local nsec key';
    }
    if (_accountWallet.bunkerUri?.trim().isNotEmpty ?? false) {
      return 'NIP-46 Remote Bunker';
    }
    if (Platform.isAndroid) return 'Android Amber (NIP-55)';
    return 'Signed in';
  }

  void _handleLoadedOfflinePmtiles(OfflinePmtilesBasemap offline) {
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
    _mapLayers.setOfflineBasemap(offline, packRecord: record);
    unawaited(_persistAppSettings());
    _animateCameraPosition(
      h.centerLon,
      h.centerLat,
      h.centerZoom.toDouble().clamp(2.0, 18.0),
    );
  }

  EdgeInsets _cameraPadding() {
    final width = MediaQuery.sizeOf(context).width;
    if (width >= 1100) {
      final leftPad = _drawer != EarthlyDrawer.none ? 440.0 : 40.0;
      final rightPad = _rightStudioDrawer != EarthlyDrawer.none ? 440.0 : 40.0;
      return EdgeInsets.fromLTRB(leftPad, 72, rightPad, 48);
    }
    if (width >= 880 && _drawer != EarthlyDrawer.none) {
      return const EdgeInsets.fromLTRB(440, 72, 40, 48);
    }
    if (width < 880 &&
        _drawer == EarthlyDrawer.explore &&
        _catalog.galleryModeActive) {
      return const EdgeInsets.fromLTRB(28, 72, 28, 250);
    }
    return EdgeInsets.fromLTRB(
      36,
      72,
      36,
      _drawer != EarthlyDrawer.none ? 320 : 96,
    );
  }

  void _flyToBounds(GeoBox bounds) {
    widget.onFlyToBoundsRequested?.call(bounds);
    _controller?.animateCamera(
      CameraUpdate.bounds(bounds, padding: _cameraPadding()),
    );
  }

  void _flyToMap(MapSummaryDto map) {
    final shelfEntry = _catalog.shelfMaps
        .where((e) => e.summary.address == map.address)
        .firstOrNull;
    final bounds = computeCombinedBounds([
      shelfEntry ?? CatalogShelfController.entryFromSummary(map),
    ]);
    if (bounds != null) {
      _flyToBounds(bounds);
    }
  }

  void _flyToStoryCamera(StoryCameraTarget camera) {
    widget.onCameraPositionRequested?.call(camera.lon, camera.lat, camera.zoom);
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
    _animateCameraPosition(sighting.lon, sighting.lat, 15);
  }

  void _focusBeacon(LiveBeaconDto beacon) {
    _animateCameraPosition(beacon.lon, beacon.lat, 15.5);
  }

  void _onSessionActivated() {
    unawaited(_persistAppSettings());
    unawaited(
      _accountWallet.syncExternalCircleSigner(isHeadlessTest: _isHeadlessTest),
    );
    unawaited(
      _accountWallet.resolveSessionProfiles(
        _catalog.relayUrls,
        isHeadlessTest: _isHeadlessTest,
      ),
    );
    unawaited(
      _spaces
          .refreshCirclesSnapshot(
            accountPubkey: _accountWallet.account?.pubkey,
            isHeadlessTest: _isHeadlessTest,
          )
          .whenComplete(() {
        if (mounted) unawaited(_startCircleLiveStream());
      }),
    );
    unawaited(_refreshInbox());
    if (_accountWallet.nip60WalletEnabled) {
      unawaited(
        _accountWallet.refreshCashuWalletState(isHeadlessTest: _isHeadlessTest),
      );
    }
  }

  Future<void> _startCircleLiveStream() => _spaces.startCircleLiveStream(
        accountPubkey: _accountWallet.account?.pubkey,
        isReadOnlySession: _accountWallet.isReadOnlySession,
        onWorkspaceUpdated: (ws) {
          if (!mounted) return;
          _handleCircleWorkspaceUpdated(ws);
        },
        isCirclesDrawerOpen: () => _isDrawerOpen(EarthlyDrawer.circles),
        isHeadlessTest: _isHeadlessTest,
      );

  Future<Nip55Account> _ensureAccount() =>
      _accountWallet.ensureAccount(onSessionActivated: _onSessionActivated);

  Future<PublishOutcomeDto> _deliverForAudience(
    DraftAudienceChoice audience,
    String signedEventJson,
  ) =>
      _spaces.deliverForAudience(
        audience,
        signedEventJson,
        relayUrls: _catalog.relayUrls,
      );

  Future<void> _preloadCatalog() => _catalog.preloadCatalog(
        isHeadlessTest: _isHeadlessTest,
        onCatalogLoaded: (cat) => unawaited(
          _accountWallet.resolveCatalogProfiles(cat, _catalog.relayUrls),
        ),
      );

  Future<void> _syncRelayPoolAndRefresh() async {
    final dirPath =
        _spaces.supportDirPath ?? (await getApplicationSupportDirectory()).path;
    await _spaces.initPersistentRelayPool(
      dirPath,
      _catalog.relayUrls,
      isHeadlessTest: _isHeadlessTest,
    );
    unawaited(_preloadCatalog());
    unawaited(_startLiveRelayStream());
  }

  Future<void> _startLiveRelayStream() => _spaces.startLiveRelayStream(
        _catalog.relayUrls,
        onEvent: (event) {
          if (!mounted) return;
          _catalog.mergeLiveRelayEvent(event);
          if (event.beacon != null) {
            final b = event.beacon!;
            _showToast(
              'Live Beacon: ${b.status?.isNotEmpty == true ? b.status : b.dTag}',
              actionLabel: 'Locate',
              onAction: () => _focusBeacon(b),
            );
          }
        },
      );

  Future<void> _pollLiveNearbyUpdates() => _spaces.pollLiveNearbyUpdates(
        onLocalSnapChanged: (localSnap) {
          if (mounted) _catalog.mergeLocalNodeCatalog(localSnap);
        },
        onNewlyArrivedMaps: (newlyArrivedMaps) {
          if (!mounted) return;
          final latest = newlyArrivedMaps.first;
          final alreadyOnShelf = _catalog.shelfMaps
              .any((e) => e.summary.address == latest.address);
          _showToast(
            alreadyOnShelf
                ? 'Live update: "${latest.title}" refreshed on map'
                : 'New Nearby Map received: "${latest.title}"',
            severity: alreadyOnShelf
                ? EarthlyToastSeverity.success
                : EarthlyToastSeverity.info,
            actionLabel: alreadyOnShelf ? null : 'Show',
            onAction: alreadyOnShelf ? null : () => _toggleMapOnShelf(latest),
          );
        },
      );

  Future<void> _refreshInbox() => _spaces.refreshInbox(
        accountPubkey: _accountWallet.account?.pubkey,
        relayUrls: _catalog.relayUrls,
        catalog: _catalog.catalog,
        deskAtlases: _catalog.deskAtlases,
        hasProfile: _accountWallet.profilesByPubkey.containsKey,
        onProfilesFetched: (fetched) {
          for (final p in fetched) {
            _accountWallet.cacheProfile(p);
          }
        },
        isHeadlessTest: _isHeadlessTest,
      );

  void _handleIncomingDeepLink(String rawUri) {
    final trimmed = rawUri.trim();
    final lower = trimmed.toLowerCase();
    if (lower.startsWith('earthly://circle/') &&
        !lower.contains('private-invite=') &&
        !lower.contains('cordn1')) {
      final parsed = Uri.tryParse(trimmed);
      final rawSegment = parsed != null && parsed.pathSegments.isNotEmpty
          ? parsed.pathSegments.first
          : trimmed
              .substring('earthly://circle/'.length)
              .split('?')
              .first
              .split('#')
              .first;
      String workspaceId;
      try {
        workspaceId = Uri.decodeComponent(rawSegment).trim();
      } catch (_) {
        workspaceId = rawSegment.trim();
      }
      if (workspaceId.isNotEmpty) {
        _spaces.clearPendingCircleInvite();
        _spaces.setSelectedCircleId(workspaceId);
        _openDrawer(EarthlyDrawer.circles, pushHistory: false);
        return;
      }
    }
    if (lower.contains('private-invite=') ||
        lower.contains('cordn1') ||
        lower.contains('/circle/') ||
        lower.contains('/privategroup/') ||
        lower.contains('/private-group/')) {
      _spaces.setPendingDeepLinkCircleInvite(trimmed);
      _openDrawer(EarthlyDrawer.circles, pushHistory: false);
      return;
    }
    if (lower.startsWith('earthly://pair') ||
        lower.contains('earthly-pair-v1:')) {
      _spaces.setPendingDeepLinkPairing(trimmed);
      _openDrawer(EarthlyDrawer.spaces, pushHistory: false);
      return;
    }
    if (lower.contains('naddr1')) {
      unawaited(
        _jumpToNaddr(trimmed).catchError((Object err) {
          _showErrorToast('Deep link error: $err');
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
          _animateCameraPosition(lon, lat, 15.0);
        }
      }
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
        _mapLayers.setOfflineBasemap(offline);
        _animateCameraPosition(
          h.centerLon,
          h.centerLat,
          h.centerZoom.toDouble().clamp(2.0, 18.0),
        );
        _showSuccessToast('Loaded offline PMTiles "${file.name}"');
      } catch (err) {
        _showErrorToast('PMTiles drop failed: $err');
      }
      return;
    }
    await _importSpatialPickedFile(file);
  }

  Future<void> _importSpatialPickedFile(PickedBinaryFile picked) async {
    try {
      final res = await _draft.importSpatialPickedFile(
        picked,
        onPersist: _schedulePersistWorkingDraft,
      );
      if (res.imported.isEmpty) {
        _showWarningToast(
          'No Point, LineString, or Polygon features found in file',
        );
        return;
      }
      if (res.bounds != null) _flyToBounds(res.bounds!);
      _showSuccessToast(
        'Imported ${res.imported.length} feature${res.imported.length == 1 ? '' : 's'} (${res.format}) from ${picked.name}',
      );
    } catch (err) {
      if (err.toString().contains('cancelled')) return;
      _showErrorToast('Import failed: $err');
    }
  }

  Future<void> _importGeoJsonFile() async {
    try {
      final picked = await DeviceBridge.pickGeoJsonFile();
      await _importSpatialPickedFile(picked);
    } catch (err) {
      if (err.toString().contains('cancelled')) return;
      _showErrorToast('Import failed: $err');
    }
  }

  Future<void> _exportSpatialFile(String format) async {
    try {
      final savedName = await _draft.exportSpatialFile(format);
      if (savedName != null) _showSuccessToast('Exported $savedName');
    } catch (err) {
      if (err.toString().contains('cancelled')) return;
      _showErrorToast('Export failed: $err');
    }
  }

  Future<void> _exportShapefileZip() async {
    try {
      final savedName = await _draft.exportShapefileZip();
      if (savedName != null) {
        _showSuccessToast('Exported Shapefile bundle "$savedName"');
      }
    } catch (err) {
      if (err.toString().contains('cancelled')) return;
      _showErrorToast('Shapefile export failed: $err');
    }
  }

  void _copyGeoJsonToClipboard() {
    final count = _draft.copyGeoJsonToClipboard();
    if (count > 0) {
      _showSuccessToast('Copied GeoJSON ($count features) to clipboard');
    }
  }

  Future<void> _pasteGeoJsonFromClipboard() async {
    try {
      final res = await _draft.pasteGeoJsonFromClipboard(
        onPersist: _schedulePersistWorkingDraft,
      );
      if (res == null) {
        _showWarningToast('Clipboard is empty');
        return;
      }
      if (res.count == 0) {
        _showWarningToast('No valid GeoJSON, GPX, or KML features on clipboard');
        return;
      }
      if (res.bounds != null) _flyToBounds(res.bounds!);
      _showSuccessToast(
        'Pasted ${res.count} ${res.formatLabel} feature${res.count == 1 ? '' : 's'} into draft',
      );
    } catch (err) {
      _showErrorToast('Paste failed: $err');
    }
  }

  Future<void> _exportMapPosterPng() async {
    try {
      GeoBox? bounds;
      try {
        bounds = _controller?.getVisibleBounds();
      } catch (_) {}
      final sysDark =
          mounted && Theme.of(context).brightness == Brightness.dark;
      final isDark = _mapLayers.isDark(systemIsDark: sysDark);
      final bytes = await renderEarthlyMapPosterPng(
        title: _draft.draftTitle.trim().isEmpty
            ? 'Earthly Map'
            : _draft.draftTitle.trim(),
        shelfMaps: _catalog.shelfMaps,
        draftFeatures: _draft.features,
        sightings: _catalog.allSightings,
        isDark: isDark,
        bounds: bounds,
      );
      final safeName = _draft.draftTitle
          .trim()
          .toLowerCase()
          .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
          .replaceAll(RegExp(r'^-|-$'), '');
      final filename = '${safeName.isEmpty ? 'earthly' : safeName}-poster.png';
      final saved = await DeviceBridge.saveBinaryFile(
        filename: filename,
        bytes: bytes,
        mimeType: 'image/png',
      );
      _showSuccessToast('Saved poster $saved');
    } catch (err) {
      if (err.toString().contains('cancelled')) return;
      _showErrorToast('Poster export failed: $err');
    }
  }

  Future<String?> _captureMapSnapshotBase64() async {
    try {
      final ctx = _mapRepaintBoundaryKey.currentContext;
      final ro = ctx?.findRenderObject();
      if (ro is! RenderRepaintBoundary) return null;
      final image = await ro.toImage(pixelRatio: 1.0);
      try {
        final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
        if (byteData == null) return null;
        return base64Encode(byteData.buffer.asUint8List());
      } finally {
        image.dispose();
      }
    } catch (_) {
      return null;
    }
  }

  Future<void> _sendAgentPrompt(String prompt) async {
    final cam = _controller?.camera;
    await _agent.sendPrompt(
      prompt,
      center: cam?.center ?? const Geographic(lon: 16.3738, lat: 48.2082),
      zoom: cam?.zoom ?? 13.5,
      draftTitle: _draft.draftTitle,
      draftFeatures: _draft.features,
      shelfMaps: _catalog.shelfMaps,
      atlasWorkspaces: _mapLayers.mountedAtlasWorkspaces,
      catalog: _catalog.catalog,
      captureMapSnapshotBase64: _captureMapSnapshotBase64,
      onProposedGeojson: (
        proposedGeojson,
        diffAdded,
        diffModified,
        diffRemoved,
        summary,
      ) {
        final bounds = _agent.stageOrApplyAiGeojson(
          proposedGeojson: proposedGeojson,
          diffAdded: diffAdded,
          diffModified: diffModified,
          diffRemoved: diffRemoved,
          summary: summary,
          onApplyDirect: (parsed) => _draft.applyAiFeatures(
            parsed,
            onPersist: _schedulePersistWorkingDraft,
          ),
        );
        if (bounds != null) _flyToBounds(bounds);
      },
      onCameraAction: _animateCameraPosition,
      onPersistSettings: () => unawaited(_persistAppSettings()),
    );
  }

  void _acceptPendingAiEdit() {
    final pending = _agent.takeAndClearPendingAiEdit();
    if (pending == null) return;
    final parsed = parseDraftFeaturesFromGeoJson(pending.proposedGeojson);
    HapticFeedback.mediumImpact();
    _draft.applyAiFeatures(parsed, onPersist: _schedulePersistWorkingDraft);
    _showSuccessToast('Applied AI edit to Working Draft');
  }

  void _extractResearchSourceToMap(ResearchSourceDto src) {
    final nextFeatures = _agent.buildExtractedResearchFeatures(
      src: src,
      existingFeatures: _draft.features,
    );
    if (nextFeatures == null) return;
    final proposed = draftFeaturesToGeoJson(
      title: _draft.draftTitle,
      features: nextFeatures,
    );
    final bounds = _agent.stageOrApplyAiGeojson(
      proposedGeojson: proposed,
      diffAdded: nextFeatures.length - _draft.features.length,
      diffModified: 0,
      diffRemoved: 0,
      summary:
          'Extracted ${nextFeatures.length - _draft.features.length} feature(s) from ${src.title}',
      onApplyDirect: (parsed) => _draft.applyAiFeatures(
        parsed,
        onPersist: _schedulePersistWorkingDraft,
      ),
    );
    if (bounds != null) _flyToBounds(bounds);
  }

  void _citeResearchSourceInStory(ResearchSourceDto src) {
    _catalog.setEditingStory(
      _agent.buildResearchCitationStory(
        src,
        pubkey: _accountWallet.account?.pubkey ?? '',
      ),
    );
    _openDrawer(EarthlyDrawer.storyComposer);
  }

  Future<void> _mountAtlasWorkspace(AtlasBundleInspectionDto bundle) async {
    final record = MountedAtlasWorkspaceDto(
      name: bundle.name,
      path: bundle.path,
      sizeBytes: bundle.sizeBytes,
      families: bundle.families,
      coverageSummary: bundle.coverageSummary,
    );
    _mapLayers.addMountedAtlasWorkspace(record);
    unawaited(
      _mapLayers.saveMacOsSecurityScopedBookmark(
        bundle.path,
        supportDirPath: _spaces.supportDirPath,
      ),
    );
    unawaited(_persistAppSettings());

    if (bundle.embeddedPmtilesPath != null &&
        bundle.embeddedPmtilesPath!.isNotEmpty) {
      try {
        unawaited(
          _mapLayers.saveMacOsSecurityScopedBookmark(
            bundle.embeddedPmtilesPath!,
            supportDirPath: _spaces.supportDirPath,
          ),
        );
        final dir = await getApplicationSupportDirectory();
        await startLocalNode(dataDir: '${dir.path}/local-node');
        final ingested = await ingestLocalPmtilesFromPath(
          path: bundle.embeddedPmtilesPath!,
          label: bundle.name,
        );
        _mapLayers.setOfflineBasemap(
          OfflinePmtilesBasemap(
            snapshot: ingested,
            styleJson: buildPmtilesStyleJson(ingested),
          ),
        );
      } catch (_) {}
    }

    _showSuccessToast('Mounted .atlas workspace "${bundle.name}"');
  }

  void _toggleMapOnShelf(MapSummaryDto map) {
    final added = _catalog.toggleMapOnShelf(
      map,
      onPersist: () => unawaited(_persistAppSettings()),
      onSyncMcp: _syncMcpWorkspaceIfRunning,
    );
    if (added) _flyToMap(map);
  }

  void _ensureMapVisibleOnShelf(MapSummaryDto map) {
    _catalog.ensureMapOnShelf(map);
    final idx =
        _catalog.shelfMaps.indexWhere((e) => e.summary.address == map.address);
    if (idx >= 0 && !_catalog.shelfMaps[idx].visible) {
      _catalog.toggleShelfVisibility(map.address);
    }
    _syncMcpWorkspaceIfRunning();
  }

  void _addMapsBulkToShelf(List<MapSummaryDto> maps) {
    final added = _catalog.addMapsBulkToShelf(maps);
    if (added.isNotEmpty) {
      final bounds = computeCombinedBounds(added);
      if (bounds != null) _flyToBounds(bounds);
      _showSuccessToast(
        'Added ${added.length} map${added.length == 1 ? '' : 's'} to Shelf',
      );
    }
  }

  String _authorLabelForPubkey(String pubkey) {
    final profile = _accountWallet.profilesByPubkey[pubkey];
    final name = profile?.displayName?.trim().isNotEmpty == true
        ? profile!.displayName!.trim()
        : (profile?.name?.trim().isNotEmpty == true
            ? profile!.name!.trim()
            : null);
    if (name != null) return name;
    if (pubkey.length > 12) {
      return '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}';
    }
    return pubkey;
  }

  void _cloneGeoJsonToDraft(
    String sourceTitle,
    String geojson, {
    String? sourceAuthorPubkey,
    String? targetAddress,
  }) {
    final count = _draft.cloneGeoJsonToDraft(
      sourceTitle,
      geojson,
      sourceAuthorPubkey: sourceAuthorPubkey,
      sourceAuthorLabel: sourceAuthorPubkey != null
          ? _authorLabelForPubkey(sourceAuthorPubkey)
          : null,
      targetAddress: targetAddress,
      suffix: '(Copy)',
      onPersist: _schedulePersistWorkingDraft,
    );
    if (count == 0) {
      _showWarningToast('No editable features found to copy');
      return;
    }
    _openDrawer(EarthlyDrawer.desk);
    _showSuccessToast(
      'Created editable copy ($count feature${count == 1 ? '' : 's'}) in Desk',
    );
  }

  Future<void> _editOrForkMap(MapSummaryDto map) async {
    final resolvedMap = map.blobRefs.isNotEmpty
        ? await _catalog.ensureMapBlobsResolved(
            map,
            onError: _showErrorToast,
          )
        : map;
    if (!mounted) return;
    final isOwned = _accountWallet.account != null &&
        _accountWallet.account!.pubkey.toLowerCase() ==
            resolvedMap.pubkey.toLowerCase();
    final cloned = parseDraftFeaturesFromGeoJson(resolvedMap.geojson);
    if (cloned.isEmpty) {
      _showWarningToast('No editable features found in map');
      return;
    }
    _draft.loadForkOrOwnedMap(
      cloned: cloned,
      isOwned: isOwned,
      dTag: resolvedMap.dTag,
      title: resolvedMap.title,
      sourceAuthorPubkey: resolvedMap.pubkey,
      sourceAuthorLabel: _authorLabelForPubkey(resolvedMap.pubkey),
      targetAddress: resolvedMap.address,
      targetEventId: resolvedMap.eventId,
      onPersist: _schedulePersistWorkingDraft,
    );
    _openDrawer(EarthlyDrawer.desk);
    _showSuccessToast(
      isOwned
          ? 'Loaded "${resolvedMap.title}" to update in place'
          : 'Created editable copy of "${resolvedMap.title}" in Desk',
    );
  }

  Future<void> _proposeEditForPublicMap(MapSummaryDto map) async {
    final resolvedMap = map.blobRefs.isNotEmpty
        ? await _catalog.ensureMapBlobsResolved(
            map,
            onError: _showErrorToast,
          )
        : map;
    if (!mounted) return;
    final parsed = parseDraftFeaturesFromGeoJson(resolvedMap.geojson);
    if (parsed.isEmpty) {
      _showWarningToast('No editable features found in map');
      return;
    }
    _draft.loadPublicMapForProposal(
      parsed: parsed,
      dTag: resolvedMap.dTag,
      title: resolvedMap.title,
      targetAddress: resolvedMap.address,
      targetEventId: resolvedMap.eventId,
      targetAuthorPubkey: resolvedMap.pubkey,
      targetAuthorLabel: _authorLabelForPubkey(resolvedMap.pubkey),
      onPersist: _schedulePersistWorkingDraft,
    );
    _openDrawer(EarthlyDrawer.desk);
    _showToast(
      'Loaded "${resolvedMap.title}" in Desk to propose an edit',
    );
  }

  void _jumpToMapFeature(MapSummaryDto map, ShelfShape shape) {
    _catalog.ensureMapOnShelf(map);
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
    final bounds = computeCombinedBounds(_catalog.shelfMaps) ??
        _draft.computeDraftBounds();
    if (bounds != null) _flyToBounds(bounds);
  }

  Future<void> _openStory(StorySummaryDto story) async {
    var flewToCameraOrBounds = false;
    await _catalog.openStory(
      story,
      onPrepareDrawer: () {
        if (_draft.isDrawingMode) {
          _draft.cancelEditingDraftFeature();
        }
        _openDrawer(EarthlyDrawer.storyReader);
      },
      onFlyToCamera: (cam) {
        flewToCameraOrBounds = true;
        _flyToStoryCamera(cam);
      },
      onFlyToBounds: (bounds) {
        flewToCameraOrBounds = true;
        _flyToBounds(bounds);
      },
    );
    if (!mounted || flewToCameraOrBounds) return;
    final pins = _catalog.storyGeoPins;
    if (_catalog.activeStory?.address == story.address && pins.isNotEmpty) {
      if (pins.length == 1) {
        final p = pins.first.position;
        _animateCameraPosition(p.lon, p.lat, 14.5);
      } else {
        var west = pins.first.position.lon;
        var east = pins.first.position.lon;
        var south = pins.first.position.lat;
        var north = pins.first.position.lat;
        for (final pin in pins) {
          west = math.min(west, pin.position.lon);
          east = math.max(east, pin.position.lon);
          south = math.min(south, pin.position.lat);
          north = math.max(north, pin.position.lat);
        }
        _flyToBounds(GeoBox(west: west, south: south, east: east, north: north));
      }
    }
  }

  Future<void> _jumpToNaddr(String naddrUri) async {
    await RustBridge.ensureInitialized();
    final decoded = await decodeNaddrCoordinate(naddrUri: naddrUri);
    if (decoded == null) {
      throw StateError('Could not decode Nostr naddr link');
    }

    if (decoded.kind == 37515) {
      final localMap = _catalog.shelfMaps
              .where((e) => e.summary.address == decoded.address)
              .firstOrNull
              ?.summary ??
          _catalog.storyDatasets[decoded.address]?.summary ??
          _catalog.catalog?.maps
              .where((m) => m.address == decoded.address)
              .firstOrNull;
      if (localMap != null) {
        _openMapFromNaddr(localMap, decoded.featureId);
        return;
      }
    } else if (decoded.kind == 37520) {
      final localStory = _catalog.catalog?.stories
          .where((s) => s.address == decoded.address)
          .firstOrNull;
      if (localStory != null) {
        await _openStory(localStory);
        return;
      }
    } else if (decoded.kind == 37518) {
      final localAtlas = _catalog.catalog?.atlases
          .where((a) => a.address == decoded.address)
          .firstOrNull;
      if (localAtlas != null) {
        _inspectAtlas(localAtlas);
        return;
      }
    }

    final relays = <String>{
      ..._catalog.relayUrls,
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
      _openMapFromNaddr(fetched.map!, decoded.featureId);
      return;
    }
    if (fetched.story != null) {
      await _openStory(fetched.story!);
      return;
    }
    if (fetched.atlas != null) {
      _inspectAtlas(fetched.atlas!);
      return;
    }
    if (fetched.sighting != null) {
      _focusSighting(fetched.sighting!);
      _inspectSighting(fetched.sighting!);
      return;
    }
    throw StateError('Unsupported naddr kind ${decoded.kind}');
  }

  void _openMapFromNaddr(MapSummaryDto map, String? featureId) {
    final existingIdx =
        _catalog.shelfMaps.indexWhere((e) => e.summary.address == map.address);
    final ShelfMapEntry entry;
    if (existingIdx >= 0) {
      entry = _catalog.shelfMaps[existingIdx];
    } else {
      entry = CatalogShelfController.entryFromSummary(map);
      _catalog.ensureMapOnShelf(map);
    }
    if (map.blobRefs.isNotEmpty) {
      unawaited(_catalog.ensureMapBlobsResolved(map, onError: _showErrorToast));
    }
    if (featureId != null && featureId.isNotEmpty) {
      final shape =
          entry.shapes.where((s) => s.featureId == featureId).firstOrNull;
      if (shape != null) {
        _jumpToMapFeature(map, shape);
        return;
      }
    }
    _inspectMap(map);
  }

  /// Immediately pins/shows [map] on the map canvas, opens its detail drawer
  /// (preserving navigation history), and flies/fits the camera to its bounds.
  void _inspectMap(MapSummaryDto map) {
    _ensureMapVisibleOnShelf(map);
    _catalog.setInspectedMap(
      map,
      onPersist: () => unawaited(_persistAppSettings()),
    );
    _openDrawer(EarthlyDrawer.datasetDetail);
    final initialEntry = _catalog.shelfMaps
            .where((e) => e.summary.address == map.address)
            .firstOrNull ??
        CatalogShelfController.entryFromSummary(map);
    final initialBounds = computeCombinedBounds([initialEntry]);
    if (initialBounds != null) {
      _flyToBounds(initialBounds);
    } else if (map.blobRefs.isNotEmpty) {
      unawaited(
        _catalog
            .ensureMapBlobsResolved(map, onError: _showErrorToast)
            .then((resolved) {
          if (!mounted || _catalog.inspectedMap?.address != map.address) return;
          _flyToMap(resolved);
        }),
      );
    }
  }

  /// Immediately opens [atlas] details AND pins/displays its linked maps on
  /// the map canvas while fitting the camera to their combined bounds.
  void _inspectAtlas(AtlasSummaryDto atlas) {
    _catalog.setInspectedAtlas(
      atlas,
      onPersist: () => unawaited(_persistAppSettings()),
    );
    _openDrawer(EarthlyDrawer.atlasDetail);
    unawaited(_openAtlas(atlas));
  }

  /// Ensures [sighting] is rendered on the map, opens its inspector detail
  /// drawer (preserving navigation history), and flies the camera to it.
  void _openSightingFromCatalog(SightingSummaryDto sighting) {
    if (!_catalog.allSightings.any((e) => e.address == sighting.address)) {
      _catalog.addLocalSighting(sighting);
    }
    _inspectSighting(sighting);
    _focusSighting(sighting);
  }

  void _enterAtlasLens(AtlasSummaryDto atlas) {
    _catalog.enterAtlasLens(
      atlas,
      onPersist: () => unawaited(_persistAppSettings()),
    );
    unawaited(_openAtlas(atlas));
  }

  Future<void> _openAtlas(AtlasSummaryDto atlas) async {
    final added = await _catalog.openAtlas(
      atlas,
      mutedPubkeys: _accountWallet.mutedPubkeys,
      onPersist: () => unawaited(_persistAppSettings()),
    );
    final bounds = computeCombinedBounds(added);
    if (bounds != null) _flyToBounds(bounds);
  }

  void _inspectFeature(InspectedFeature feature) {
    if (_draft.isDrawingMode) {
      if (feature.isDraft && feature.draftFeatureId != null) {
        if (_draft.mode == DrawToolMode.select) {
          _draft.toggleSelectFeature(feature.draftFeatureId!);
        } else if (_draft.mode == DrawToolMode.editVertices) {
          _draft.selectEditingTargetFeature(feature.draftFeatureId!);
        }
      }
      return;
    }
    _catalog.setInspectedFeature(feature);
    _openDrawer(EarthlyDrawer.inspector);
  }

  InspectedFeature _buildInspectedDraftFeature(DrawnFeature f) {
    final anchor = f.vertices.isEmpty
        ? const Geographic(lon: 0, lat: 0)
        : f.vertices.first;
    final geomType = switch (f.kind) {
      DrawToolMode.polygon => 'Polygon',
      DrawToolMode.line => 'LineString',
      _ => 'Point',
    };
    double? lengthMeters;
    if (f.kind == DrawToolMode.line && f.vertices.length >= 2) {
      var total = 0.0;
      for (var i = 1; i < f.vertices.length; i++) {
        total += DrawingMath.distanceMeters(f.vertices[i - 1], f.vertices[i]);
      }
      lengthMeters = total;
    } else if (f.kind == DrawToolMode.polygon && f.vertices.length >= 3) {
      var total = 0.0;
      for (var i = 1; i < f.vertices.length; i++) {
        total += DrawingMath.distanceMeters(f.vertices[i - 1], f.vertices[i]);
      }
      total += DrawingMath.distanceMeters(f.vertices.last, f.vertices.first);
      lengthMeters = total;
    }
    return InspectedFeature(
      sourceLabel: 'Working draft',
      isDraft: true,
      draftFeatureId: f.id,
      geometryType: geomType,
      title: f.name ?? 'Draft $geomType',
      lengthMeters: lengthMeters,
      properties: {
        ...f.customProperties,
        'id': f.id,
        if (f.kind == DrawToolMode.point && f.vertices.isNotEmpty) ...{
          'lat': f.vertices.first.lat.toStringAsFixed(6),
          'lon': f.vertices.first.lon.toStringAsFixed(6),
        } else
          'vertices': f.vertices.length,
        if (f.description != null && f.description!.isNotEmpty)
          'description': f.description!,
        if (f.colorHex != null) 'color': f.colorHex!,
        if (f.fillColorHex != null) 'fillColor': f.fillColorHex!,
        if (f.strokeColorHex != null) 'strokeColor': f.strokeColorHex!,
        if (f.strokeWidth != null) 'strokeWidth': f.strokeWidth!,
        if (f.fillOpacity != null) 'fillOpacity': f.fillOpacity!,
        if (f.radius != null) 'radius': f.radius!,
        if (f.lineDash != null) 'lineDash': f.lineDash!,
        if (f.arrowStart) 'arrowStart': true,
        if (f.arrowEnd) 'arrowEnd': true,
        if (f.displayIcon != null) 'displayIcon': f.displayIcon!,
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
            mediaUrls: c.mediaUrls,
            preferredSide: c.side,
            offset: Offset(c.offsetX, c.offsetY),
            accentColorHex: f.strokeColorHex ?? f.fillColorHex ?? f.colorHex,
          ),
      ],
    );
  }

  void _refreshInspectedDraftFeature(String featureId) {
    final existing = _catalog.inspectedFeature;
    if (existing == null || existing.draftFeatureId == null) return;
    final targetId = featureId.isEmpty ? existing.draftFeatureId! : featureId;
    if (existing.draftFeatureId != targetId) return;
    final idx = _draft.features.indexWhere((f) => f.id == targetId);
    if (idx < 0) return;
    _catalog.setInspectedFeature(_buildInspectedDraftFeature(_draft.features[idx]));
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
    _catalog.setDiscussionTarget(target);
    _openDrawer(EarthlyDrawer.discussion);
  }

  void _openPerson(String pubkey) {
    _catalog.setInspectedPersonPubkey(pubkey);
    _openDrawer(EarthlyDrawer.person);
  }

  void _openLocationInspector(Geographic pt) {
    _catalog.setInspectedLocation(pt);
    _openDrawer(EarthlyDrawer.locationInspector);
  }

  Future<BlossomUploadDto?> _pickAndUploadBlossomImage(String purpose) async {
    try {
      final picked = await DeviceBridge.pickImage();
      final uploaded = await _catalog.uploadBlossomBytes(
        bytes: picked.bytes,
        mimeType: picked.mimeType,
        purpose: purpose,
        ensureAccount: _ensureAccount,
        signUnsignedEvent: _accountWallet.signUnsignedEvent,
      );
      _showSuccessToast('Uploaded to Blossom: ${uploaded.url}');
      return uploaded;
    } catch (err) {
      if (err.toString().contains('cancelled')) return null;
      rethrow;
    }
  }

  void _showPublishedToast({
    required String message,
    VoidCallback? onReopen,
  }) {
    if (!mounted) return;
    _toast.showSuccess(
      message,
      duration: const Duration(seconds: 4),
      actionLabel: onReopen != null ? 'Reopen' : null,
      onAction: onReopen,
    );
  }

  void _releaseDeskAfterPublish() {
    _draft.releaseAfterPublish(onPersist: _schedulePersistWorkingDraft);
    if (mounted && MediaQuery.sizeOf(context).width < 880) {
      _closeDrawer(EarthlyDrawer.desk);
    }
  }

  Future<PublishOutcomeDto> _publishDraft(
    String title,
    DraftAudienceChoice audience,
  ) async {
    await RustBridge.ensureInitialized();
    final publishedFeatures = List<DrawnFeature>.from(_draft.features);
    final publishedDTag = _draft.draftDTag;
    final publishedProvenance = _draft.provenance;
    final publishedSummary = _draft.proposalSummary.trim();
    final publishedBounds = _draft.computeDraftBounds();
    final geojson =
        draftFeaturesToGeoJson(title: title, features: publishedFeatures);

    // --- Mode A: Edit Proposal (MLS encrypted 37519 or Public 37519) ---
    if (publishedProvenance.isProposingEdit) {
      if (publishedProvenance.targetCircleWorkspaceId != null &&
          publishedProvenance.targetDatasetId != null &&
          publishedProvenance.sourceAuthorPubkey != null) {
        final mlsPath = await _spaces.ensureMlsDatabasePath();
        await _accountWallet.syncExternalCircleSigner(
          isHeadlessTest: _isHeadlessTest,
        );
        final updated = await sendCircleDatasetProposal(
          databasePath: mlsPath,
          signerNsec: _accountWallet.localNsec,
          bunkerUri: _accountWallet.bunkerUri,
          bunkerClientNsec: _accountWallet.bunkerClientNsec,
          workspaceId: publishedProvenance.targetCircleWorkspaceId!,
          targetDatasetId: publishedProvenance.targetDatasetId!,
          targetAuthorPubkey: publishedProvenance.sourceAuthorPubkey!,
          geojsonJson: geojson,
          name: title,
          summary: publishedSummary.isNotEmpty
              ? publishedSummary
              : 'Proposed map update',
          proposalId: publishedDTag,
        );
        _handleCircleWorkspaceUpdated(updated);
        _releaseDeskAfterPublish();
        _showPublishedToast(
          message:
              'Sent edit proposal for "${publishedProvenance.sourceTitle ?? title}" to "${updated.name}"',
        );
        return PublishOutcomeDto(
          eventId: updated.proposals.firstOrNull?.envelopeId ?? publishedDTag,
          outboxState: 'mls-proposal (epoch ${updated.epoch})',
          relays: [
            RelayDeliveryStatusDto(
              relayUrl: 'cordn://${updated.name}',
              ok: true,
              message: 'cursor ${updated.cursor}',
            ),
          ],
        );
      }

      if (publishedProvenance.targetAddress != null &&
          publishedProvenance.sourceAuthorPubkey != null) {
        final account = await _ensureAccount();
        final prepared = await prepareUnsignedProposalEvent(
          pubkeyOrNpub: account.pubkey,
          dTag: publishedDTag,
          targetAddress: publishedProvenance.targetAddress!,
          targetOwnerPubkey: publishedProvenance.sourceAuthorPubkey!,
          baseEventId: publishedProvenance.targetEventId ?? '',
          description: publishedSummary.isNotEmpty
              ? publishedSummary
              : 'Proposed update to ${publishedProvenance.sourceTitle ?? title}',
          proposedGeojson: geojson,
        );
        final signed = await _accountWallet.signUnsignedEvent(
          account,
          prepared.unsignedEventJson,
        );
        final outcome =
            await _deliverForAudience(DraftAudienceChoice.publicRelay, signed);
        _releaseDeskAfterPublish();
        _showPublishedToast(
          message:
              'Published edit proposal (37519) for "${publishedProvenance.sourceTitle ?? title}"',
        );
        return outcome;
      }
    }

    // --- Mode B: MLS Encrypted Group Publish / Update / Copy ---
    if (audience == DraftAudienceChoice.privateCircle) {
      final validSelected = _spaces.selectedCircleId != null &&
              _spaces.circles
                  .any((c) => c.workspaceId == _spaces.selectedCircleId)
          ? _spaces.selectedCircleId
          : null;
      final targetId = validSelected ??
          publishedProvenance.targetCircleWorkspaceId ??
          _spaces.activeCircleLensId ??
          _spaces.circles.firstOrNull?.workspaceId;
      if (targetId == null || targetId.isEmpty) {
        throw StateError('Create or select an MLS Group first');
      }
      final mlsPath = await _spaces.ensureMlsDatabasePath();
      await _accountWallet.syncExternalCircleSigner(
        isHeadlessTest: _isHeadlessTest,
      );
      final updated = await sendCircleDataset(
        databasePath: mlsPath,
        signerNsec: _accountWallet.localNsec,
        bunkerUri: _accountWallet.bunkerUri,
        bunkerClientNsec: _accountWallet.bunkerClientNsec,
        workspaceId: targetId,
        geojsonJson: geojson,
        datasetId: publishedDTag,
        name: title,
      );
      _handleCircleWorkspaceUpdated(updated);
      // Always mount the newly published MLS dataset on the shelf so geometry
      // stays visible on the map right after Desk releases.
      final publishedDs = updated.datasets
          .where((d) => d.datasetId == publishedDTag)
          .firstOrNull;
      if (publishedDs != null) {
        final summary =
            SpacesSyncController.circleDatasetToSummary(updated, publishedDs);
        _catalog.applyResolvedMapToState(summary);
        _catalog.ensureMapOnShelf(summary);
      }
      _releaseDeskAfterPublish();
      final verb = publishedProvenance.isUpdatingOwned
          ? 'Updated'
          : publishedProvenance.isCopyingOther
              ? 'Published copy'
              : 'Published';
      _showPublishedToast(
        message: '$verb "$title" in "${updated.name}"',
        onReopen: () {
          _spaces.setSelectedCircleId(updated.workspaceId);
          _draft.loadCircleDataset(
            dTag: publishedDTag,
            title: title,
            parsed: publishedFeatures,
            isOwned: true,
            sourceAuthorPubkey: _accountWallet.account?.pubkey,
            circleWorkspaceId: updated.workspaceId,
            circleName: updated.name,
            onPersist: _schedulePersistWorkingDraft,
          );
          _openDrawer(EarthlyDrawer.desk);
        },
      );
      return PublishOutcomeDto(
        eventId: publishedDs?.envelopeId ??
            updated.datasets.firstOrNull?.envelopeId ??
            publishedDTag,
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

    // --- Mode C: Public Relay or Nearby Local Node Publish / Update / Copy ---
    final account = await _ensureAccount();
    ExternalGeoBlobDto? externalBlob;
    final rawBytes = Uint8List.fromList(utf8.encode(geojson));
    if (audience == DraftAudienceChoice.publicRelay &&
        rawBytes.length > 60 * 1024) {
      final uploaded = await _catalog.uploadBlossomBytes(
        bytes: rawBytes,
        mimeType: 'application/geo+json',
        purpose: 'Externalize large Earthly Map ($title)',
        ensureAccount: _ensureAccount,
        signUnsignedEvent: _accountWallet.signUnsignedEvent,
      );
      externalBlob = ExternalGeoBlobDto(
        url: uploaded.url,
        sha256: uploaded.sha256,
        sizeBytes: uploaded.sizeBytes,
      );
      _showSuccessToast(
        'Uploaded ${(rawBytes.length / 1024).toStringAsFixed(0)} KB GeoJSON to Blossom blob',
      );
    }
    final prepared = await prepareUnsignedMapEvent(
      pubkeyOrNpub: account.pubkey,
      dTag: publishedDTag,
      title: title,
      geojson: geojson,
      hashtags: const ['earthly-native'],
      contextRefs: _catalog.activeAtlasLens != null
          ? <String>[_catalog.activeAtlasLens!.address]
          : const <String>[],
      fieldSessionId: audience == DraftAudienceChoice.nearbyLocalNode
          ? _spaces.activeNearbySessionId
          : null,
      externalBlob: externalBlob,
    );
    final signedEventJson =
        await _accountWallet.signUnsignedEvent(account, prepared.unsignedEventJson);
    final outcome = await _deliverForAudience(audience, signedEventJson);

    // Mount the just-published map onto the Shelf so it remains visible on the
    // canvas when the Desk form releases cleanly.
    final publishedAddress = '37515:${account.pubkey}:$publishedDTag';
    final publishedSummaryDto = MapSummaryDto(
      address: publishedAddress,
      eventId: outcome.eventId,
      pubkey: account.pubkey,
      dTag: publishedDTag,
      title: title,
      description: null,
      featureCount: publishedFeatures.length,
      sizeBytes: rawBytes.length,
      geojson: geojson,
      blobRefs: const <BlobRefDto>[],
      west: publishedBounds?.west,
      south: publishedBounds?.south,
      east: publishedBounds?.east,
      north: publishedBounds?.north,
      hashtags: const ['earthly-native'],
      labels: const <String>[],
      contextRefs: _catalog.activeAtlasLens != null
          ? <String>[_catalog.activeAtlasLens!.address]
          : const <String>[],
      createdAt: BigInt.from(DateTime.now().millisecondsSinceEpoch ~/ 1000),
    );
    _catalog.applyResolvedMapToState(publishedSummaryDto);
    _catalog.ensureMapOnShelf(publishedSummaryDto);
    _releaseDeskAfterPublish();

    final verb = publishedProvenance.isUpdatingOwned
        ? 'Updated'
        : publishedProvenance.isCopyingOther
            ? 'Published copy'
            : 'Published';
    _showPublishedToast(
      message: '$verb "$title" (${outcome.outboxState})',
      onReopen: () {
        _draft.loadForkOrOwnedMap(
          cloned: publishedFeatures,
          isOwned: true,
          dTag: publishedDTag,
          title: title,
          sourceAuthorPubkey: account.pubkey,
          targetAddress: publishedAddress,
          targetEventId: outcome.eventId,
          audience: audience,
          onPersist: _schedulePersistWorkingDraft,
        );
        _openDrawer(EarthlyDrawer.desk);
      },
    );
    return outcome;
  }

  void _handleCircleWorkspaceUpdated(CircleWorkspaceDto ws) {
    _spaces.upsertCircleWorkspace(ws);
    if (_spaces.activeCircleLensId == ws.workspaceId) {
      for (final ds in ws.datasets) {
        final summary = SpacesSyncController.circleDatasetToSummary(ws, ds);
        _catalog.applyResolvedMapToState(summary);
        _catalog.ensureMapOnShelf(summary);
      }
    }
  }

  void _enterCircleLens(CircleWorkspaceDto ws) {
    _spaces.enterCircleLensState(ws);
    _draft.setDraftAudience(DraftAudienceChoice.privateCircle);
    for (final existing in List<ShelfMapEntry>.from(_catalog.shelfMaps)) {
      if (existing.summary.address.startsWith('private-group:') &&
          !existing.summary.address
              .startsWith('private-group:${ws.workspaceId}:')) {
        _catalog.removeShelfMap(existing.summary.address);
      }
    }
    final added = <ShelfMapEntry>[];
    for (final ds in ws.datasets) {
      final summary = SpacesSyncController.circleDatasetToSummary(ws, ds);
      _catalog.ensureMapOnShelf(summary);
      final found = _catalog.shelfMaps
          .where((e) => e.summary.address == summary.address)
          .firstOrNull;
      if (found != null) added.add(found);
    }
    final bounds = computeCombinedBounds(added);
    if (bounds != null) _flyToBounds(bounds);
  }

  void _leaveCircleLens() {
    _spaces.leaveCircleLensState();
    for (final existing in List<ShelfMapEntry>.from(_catalog.shelfMaps)) {
      if (existing.summary.address.startsWith('private-group:')) {
        _catalog.removeShelfMap(existing.summary.address);
      }
    }
    if (_draft.draftAudience == DraftAudienceChoice.privateCircle) {
      _draft.setDraftAudience(DraftAudienceChoice.publicRelay);
    }
  }

  void _toggleCircleDatasetOnMap(CircleWorkspaceDto ws, CircleDatasetDto ds) {
    final summary = SpacesSyncController.circleDatasetToSummary(ws, ds);
    final added = _catalog.toggleMapOnShelf(summary);
    if (added) {
      final entry = CatalogShelfController.entryFromSummary(summary);
      final bounds = computeCombinedBounds([entry]);
      if (bounds != null) _flyToBounds(bounds);
    }
  }

  void _zoomToCircleDataset(CircleWorkspaceDto ws, CircleDatasetDto ds) {
    final summary = SpacesSyncController.circleDatasetToSummary(ws, ds);
    _catalog.ensureMapOnShelf(summary);
    final entry = _catalog.shelfMaps
            .where((e) => e.summary.address == summary.address)
            .firstOrNull ??
        CatalogShelfController.entryFromSummary(summary);
    final bounds = computeCombinedBounds([entry]);
    if (bounds != null) _flyToBounds(bounds);
  }

  Future<void> _locateMe() async {
    try {
      final fix = await DeviceBridge.getCurrentLocation();
      _animateCameraPosition(fix.lon, fix.lat, 15.5);
    } catch (err) {
      _showErrorToast('GPS unavailable: $err');
    }
  }

  Future<PublishOutcomeDto> _broadcastLiveBeacon(
    String status,
    int durationMinutes,
    bool nearby,
  ) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    var loc = _controller?.camera?.center ??
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
      fieldSessionId: nearby ? _spaces.activeNearbySessionId : null,
    );
    final signedJson = await _accountWallet.signUnsignedEvent(
      account,
      prepared.unsignedEventJson,
    );
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
    _catalog.upsertLocalBeacon(liveDto);
    _focusBeacon(liveDto);
    return outcome;
  }

  Future<EntitySocialCountsDto?> _toggleEntityReaction({
    required String address,
    required String? eventId,
    required String pubkey,
    required int kind,
    required EntitySocialCountsDto? current,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final prevCount = current?.reactionCount ?? 0;

    if (current?.userHasReacted == true &&
        current?.userReactionEventId != null &&
        current!.userReactionEventId!.isNotEmpty) {
      final del = await prepareUnsignedDeletionEvent(
        pubkeyOrNpub: account.pubkey,
        targetAddress: '',
        targetEventId: current.userReactionEventId,
        targetKind: 7,
        reason: 'Removed reaction',
      );
      final signed = await _accountWallet.signUnsignedEvent(
        account,
        del.unsignedEventJson,
      );
      await _deliverForAudience(DraftAudienceChoice.publicRelay, signed);
      return EntitySocialCountsDto(
        address: address,
        reactionCount: prevCount > 0 ? prevCount - 1 : 0,
        userHasReacted: false,
        userReactionEventId: null,
        zapCount: current.zapCount,
        zapSats: current.zapSats,
      );
    }

    final prepared = await prepareUnsignedReactionEvent(
      pubkeyOrNpub: account.pubkey,
      targetAddress: address,
      targetEventId: eventId,
      targetPubkey: pubkey,
      targetKind: kind,
      content: '+',
    );
    final signed = await _accountWallet.signUnsignedEvent(
      account,
      prepared.unsignedEventJson,
    );
    final outcome =
        await _deliverForAudience(DraftAudienceChoice.publicRelay, signed);
    return EntitySocialCountsDto(
      address: address,
      reactionCount: prevCount + 1,
      userHasReacted: true,
      userReactionEventId: outcome.eventId,
      zapCount: current?.zapCount ?? 0,
      zapSats: current?.zapSats ?? BigInt.zero,
    );
  }

  Future<void> _openZapDialogForEntity({
    required String recipientPubkey,
    required String targetTitle,
    required String targetAddress,
    String? targetEventId,
  }) async {
    if (!_accountWallet.profilesByPubkey.containsKey(recipientPubkey)) {
      await _accountWallet.fetchMissingProfiles(
        <String>[recipientPubkey],
        _catalog.relayUrls,
      );
    }
    if (!mounted) return;
    final profile = _accountWallet.profilesByPubkey[recipientPubkey];
    final recipientName = _accountWallet.displayNameForPubkey(recipientPubkey);
    final lud16 = profile?.lud16;
    final cashuSats = _accountWallet.nip60WalletEnabled
        ? _accountWallet.cashuWalletState?.balanceSats.toInt()
        : null;
    final canCashuNutzap = _accountWallet.account != null &&
        _accountWallet.localNsec != null &&
        _accountWallet.localNsec!.isNotEmpty &&
        (cashuSats ?? 0) > 0;
    await showEarthlyZapDialog(
      context,
      recipientName: recipientName,
      recipientPubkey: recipientPubkey,
      recipientLud16: lud16,
      targetTitle: targetTitle,
      targetAddress: targetAddress,
      targetEventId: targetEventId,
      hasNwcWallet:
          _accountWallet.nwcUri != null && _accountWallet.nwcUri!.isNotEmpty,
      onPayWithNwc:
          (_accountWallet.nwcUri != null && _accountWallet.nwcUri!.isNotEmpty)
              ? _accountWallet.payInvoiceViaNwcUri
              : null,
      cashuBalanceSats: cashuSats,
      onPayWithCashu: (_accountWallet.account != null && (cashuSats ?? 0) > 0)
          ? (bolt11) => _accountWallet.payBolt11WithCashu(
                bolt11: bolt11,
                onSessionActivated: _onSessionActivated,
              )
          : null,
      onSendNutzap: canCashuNutzap
          ? ({required amountSats, required comment}) =>
              _accountWallet.sendNutzapWithCashu(
                recipientPubkey: recipientPubkey,
                amountSats: amountSats,
                comment: comment,
                targetEventId: targetEventId,
                relayUrls: _catalog.relayUrls,
                onSessionActivated: _onSessionActivated,
              )
          : null,
      onGenerateInvoice: ({required amountSats, required comment}) async {
        final targetLud16 = lud16?.trim() ?? '';
        if (targetLud16.isEmpty) {
          throw StateError('Author has no Lightning Address (lud16)');
        }
        await RustBridge.ensureInitialized();
        String? signedZapJson;
        if (_accountWallet.account != null &&
            _accountWallet.activeSavedSession?.kind != 'readonly') {
          try {
            final prepared = await prepareUnsignedZapRequestEvent(
              senderPubkeyOrNpub: _accountWallet.account!.pubkey,
              recipientPubkeyHex: recipientPubkey,
              amountSats: BigInt.from(amountSats),
              relayUrls: _catalog.relayUrls,
              targetEventId: targetEventId,
              targetAddress: targetAddress,
              comment: comment.isEmpty ? null : comment,
              lnurl: targetLud16,
            );
            signedZapJson = await _accountWallet.signUnsignedEvent(
              _accountWallet.account!,
              prepared.unsignedEventJson,
            );
          } catch (_) {
            signedZapJson = null;
          }
        }
        return fetchLnurlZapInvoice(
          lud16: targetLud16,
          amountSats: BigInt.from(amountSats),
          signedZapRequestJson: signedZapJson,
          comment: comment.isEmpty ? null : comment,
        );
      },
    );
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
    final kind =
        item.targetKind ?? (parts.isNotEmpty ? int.tryParse(parts[0]) : null);
    final ownerPk = parts.length >= 2 ? parts[1] : item.actorPubkey;

    if (item.targetTab == 'comments' && kind != null) {
      final mapMatch =
          _catalog.catalog?.maps.where((m) => m.address == addr).firstOrNull;
      final storyMatch =
          _catalog.catalog?.stories.where((s) => s.address == addr).firstOrNull;
      _openDiscussion(
        DiscussionTarget(
          address: addr,
          kind: kind,
          pubkey: ownerPk,
          title: mapMatch?.title ?? storyMatch?.title ?? item.thingLabel,
          eventId: mapMatch?.eventId ?? storyMatch?.eventId,
          baseGeojson: mapMatch?.geojson,
          baseMarkdown: storyMatch?.content,
        ),
      );
      return;
    }

    final cachedMap =
        _catalog.catalog?.maps.where((m) => m.address == addr).firstOrNull;
    if (cachedMap != null) {
      _inspectMap(cachedMap);
      return;
    }
    final cachedStory =
        _catalog.catalog?.stories.where((s) => s.address == addr).firstOrNull;
    if (cachedStory != null) {
      await _openStory(cachedStory);
      return;
    }
    final cachedAtlas =
        _catalog.catalog?.atlases.where((a) => a.address == addr).firstOrNull;
    if (cachedAtlas != null) {
      _inspectAtlas(cachedAtlas);
      return;
    }

    try {
      await RustBridge.ensureInitialized();
      final fetched = await fetchEntityByAddress(
        relayUrls: _catalog.relayUrls,
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

  // --- Drawer Routing & Back Navigation ---

  bool _isDrawerAllowedInDrawingMode(EarthlyDrawer target) =>
      target == EarthlyDrawer.inspector;

  bool _isDrawerOpen(EarthlyDrawer target) => _drawerNav.isOpen(target);

  void _cleanupDiscardedDrawers(Iterable<EarthlyDrawer> discarded) {
    for (final drawer in discarded) {
      switch (drawer) {
        case EarthlyDrawer.storyReader:
          _catalog.closeStory();
        case EarthlyDrawer.explore:
          if (_catalog.galleryModeActive) {
            _catalog.setGalleryModeActive(false);
          }
        case EarthlyDrawer.circles:
          _spaces.clearPendingCircleInvite();
        case EarthlyDrawer.storyComposer:
          _catalog.setEditingStory(null);
        case EarthlyDrawer.atlasComposer:
          _catalog.setEditingAtlas(null);
        default:
          break;
      }
    }
  }

  void _openDrawer(EarthlyDrawer target, {bool pushHistory = true}) {
    if (target != EarthlyDrawer.explore && _catalog.galleryModeActive) {
      _catalog.setGalleryModeActive(false);
    }
    _drawerNav.open(
      target,
      isWideStudio: _isWideStudio,
      pushHistory: pushHistory,
    );
    if (target == EarthlyDrawer.cashuWallet) {
      if (_accountWallet.nip60WalletEnabled) {
        unawaited(() async {
          await _accountWallet.refreshCashuWalletState(
            isHeadlessTest: _isHeadlessTest,
          );
          if (_isHeadlessTest || !_accountWallet.nip60WalletEnabled) return;
          final hasSilentSigner =
              (_accountWallet.localNsec?.trim().isNotEmpty ?? false) ||
                  ((_accountWallet.bunkerUri?.trim().isNotEmpty ?? false) &&
                      (_accountWallet.bunkerClientNsec?.trim().isNotEmpty ??
                          false));
          final needsInitialSync =
              !_accountWallet.cashuWalletViewState.initialized;
          if (hasSilentSigner || needsInitialSync) {
            try {
              await _accountWallet.syncNip60WalletForActiveAccount(
                _catalog.relayUrls,
                isHeadlessTest: _isHeadlessTest,
              );
            } catch (_) {}
          }
        }());
      }
    } else if (target == EarthlyDrawer.circles) {
      unawaited(
        _accountWallet.syncExternalCircleSigner(isHeadlessTest: _isHeadlessTest),
      );
    } else if (target == EarthlyDrawer.mcpBridge) {
      unawaited(
        _agent.refreshMcpBridgeStatus(
          isHeadlessTest: _isHeadlessTest,
          onTick: _pollMcpBridgeTick,
        ),
      );
    } else if (target == EarthlyDrawer.agent) {
      unawaited(_agent.refreshVisionSupport(isHeadlessTest: _isHeadlessTest));
    }
  }

  void _closeDrawer(EarthlyDrawer target) {
    final removed = _drawerNav.closeDrawer(target);
    _cleanupDiscardedDrawers(removed);
  }

  void _closeAllDrawers() {
    final removed = _drawerNav.closeAll();
    _cleanupDiscardedDrawers(removed);
  }

  void _toggleDrawer(EarthlyDrawer next) {
    final removed = _drawerNav.toggleRoot(next, isWideStudio: _isWideStudio);
    _cleanupDiscardedDrawers(removed);
  }

  VoidCallback? _backCallbackFor(EarthlyDrawer target) {
    if (!_drawerNav.canGoBackFrom(target, isWideStudio: _isWideStudio)) {
      return null;
    }
    return () => _popDrawerBack(target);
  }

  void _popDrawerBack(EarthlyDrawer target) {
    final res = _drawerNav.popBackFor(target, isWideStudio: _isWideStudio);
    if (res.leavingDrawer != EarthlyDrawer.none &&
        !_drawerNav.isRetained(res.leavingDrawer)) {
      _cleanupDiscardedDrawers([res.leavingDrawer]);
    }
  }

  void _handleBackNavigation({bool allowExitPrompt = true}) {
    if (!mounted) return;
    // 1. Pop any open Navigator modal, dialog, or menu first.
    final nav = Navigator.maybeOf(context);
    if (nav != null && nav.canPop()) {
      nav.pop();
      return;
    }

    // 2. Cancel active drawing stroke or exit drawing mode cleanly.
    if (_draft.isDrawingMode) {
      _drawerNav.resetExitConfirmation();
      if (_draft.isMeasureMode && _draft.draftVertices.isNotEmpty) {
        _draft.clearMeasureVertices();
        return;
      }
      if (_draft.draftVertices.isEmpty &&
          _draft.editingDraftFeature == null &&
          _drawerNav.hasAnyOpenDrawer &&
          (_isDrawerAllowedInDrawingMode(_drawer) ||
              _isDrawerAllowedInDrawingMode(_rightStudioDrawer))) {
        final target = _isDrawerAllowedInDrawingMode(_rightStudioDrawer)
            ? _rightStudioDrawer
            : _drawer;
        _popDrawerBack(target);
        return;
      }
      _draft.cancelEditingDraftFeature();
      return;
    }

    // 3–5. Pop drawer stack -> close root drawer -> double-back to exit.
    final result = _drawerNav.handleBack(
      isWideStudio: _isWideStudio,
      allowExitPrompt: allowExitPrompt,
    );
    switch (result.action) {
      case DrawerBackAction.poppedToPreviousDrawer:
      case DrawerBackAction.closedRootDrawer:
        if (result.leavingDrawer != EarthlyDrawer.none &&
            !_drawerNav.isRetained(result.leavingDrawer)) {
          _cleanupDiscardedDrawers([result.leavingDrawer]);
        }
      case DrawerBackAction.armExitToast:
        if (allowExitPrompt) {
          _toast.showInfo(
            'Press back again to exit',
            duration: const Duration(milliseconds: 2500),
          );
        }
      case DrawerBackAction.exitApp:
        _toast.dismiss();
        (widget.onExitAppRequested ?? SystemNavigator.pop)();
    }
  }

  void _openSightingComposer({Geographic? initialLocation}) {
    final center = initialLocation ??
        _controller?.camera?.center ??
        const Geographic(lon: 16.3738, lat: 48.2082);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => SightingComposerSheet(
        initialLocation: center,
        account: _accountWallet.account,
        onPublishSighting: (req) async {
          final res = await _catalog.publishSighting(
            req,
            activeNearbySessionId: _spaces.activeNearbySessionId,
            ensureAccount: _ensureAccount,
            signUnsignedEvent: _accountWallet.signUnsignedEvent,
            deliverForAudience: _deliverForAudience,
          );
          _focusSighting(res.sighting);
          return res;
        },
      ),
    );
  }

  void _openBasemapSwitcher() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
          builder: (_) => ListenableBuilder(
        listenable: _mapLayers.presentationListenable,
        builder: (context, _) => BasemapSwitcherSheet(
          activeBasemap: _mapLayers.selectedBasemap,
          offlineBasemap: _mapLayers.offlineBasemap,
          showLabels: _mapLayers.showLabels,
          calloutMode: _mapLayers.calloutMode,
          themeMode: widget.themeMode,
          onThemeModeChanged: (mode) {
            widget.onThemeModeChanged?.call(mode);
            unawaited(_persistAppSettings());
          },
          backgroundMode: _mapLayers.backgroundMode,
          satelliteOpacity: _mapLayers.satelliteOpacity,
          onBackgroundModeChanged: (bg) {
            _mapLayers.setBackgroundMode(bg);
            unawaited(_mapLayers.syncSatellite(_controller?.style));
            unawaited(_persistAppSettings());
          },
          onSatelliteOpacityChanged: (v) {
            _mapLayers.setSatelliteOpacity(v);
            unawaited(_mapLayers.syncSatellite(_controller?.style));
            unawaited(_persistAppSettings());
          },
          onExportMapPosterPng: () => unawaited(_exportMapPosterPng()),
          savedOfflinePacks: _mapLayers.savedOfflinePacks,
          onSelectBasemap: (kind) {
            _mapLayers.setSelectedBasemap(kind);
            unawaited(_persistAppSettings());
          },
          onLoadedOfflinePmtiles: _handleLoadedOfflinePmtiles,
          onMountSavedPack: (pack) async {
            try {
              await _mapLayers.mountSavedOfflinePack(
                pack,
                onFlyTo: (center, zoom) =>
                    _animateCameraPosition(center.lon, center.lat, zoom),
              );
            } catch (err) {
              _showErrorToast('Could not mount offline pack: $err');
            }
          },
          onRemoveSavedPack: (sha) {
            _mapLayers.removeSavedOfflinePack(sha);
            unawaited(_persistAppSettings());
          },
          onToggleLabels: _mapLayers.setShowLabels,
          onChangeCalloutMode: _mapLayers.setCalloutMode,
          pointClusteringEnabled: _mapLayers.pointClusteringEnabled,
          onTogglePointClustering: (enabled) {
            _mapLayers.setPointClusteringEnabled(enabled);
            unawaited(_persistAppSettings());
          },
          mountedAtlasWorkspaces: _mapLayers.mountedAtlasWorkspaces,
          onMountAtlasWorkspace: _mountAtlasWorkspace,
          onUnmountAtlasWorkspace: (path) {
            _mapLayers.removeMountedAtlasWorkspace(path);
            unawaited(
              _mapLayers.removeMacOsSecurityScopedBookmark(
                path,
                supportDirPath: _spaces.supportDirPath,
              ),
            );
            unawaited(_persistAppSettings());
          },
        ),
      ),
    );
  }

  void _openEarthlyCommandSheet() {
    final cam = _controller?.camera;
    final center = cam?.center ?? const Geographic(lon: 16.3738, lat: 48.2082);
    final zoom = cam?.zoom ?? 13.5;
    final geoUri =
        'geo:${center.lat.toStringAsFixed(5)},${center.lon.toStringAsFixed(5)}';
    final nextTheme = switch (widget.themeMode) {
      ThemeMode.system => ThemeMode.light,
      ThemeMode.light => ThemeMode.dark,
      ThemeMode.dark => ThemeMode.system,
    };
    final themeLabel = switch (widget.themeMode) {
      ThemeMode.system => 'System',
      ThemeMode.light => 'Light',
      ThemeMode.dark => 'Dark',
    };
    final themeIcon = switch (widget.themeMode) {
      ThemeMode.system => Icons.brightness_auto_outlined,
      ThemeMode.light => Icons.light_mode_outlined,
      ThemeMode.dark => Icons.dark_mode_outlined,
    };

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        final theme = Theme.of(ctx);
        return SafeArea(
          child: SingleChildScrollView(
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
                      width: 30,
                      height: 30,
                      decoration: const BoxDecoration(
                        color: EarthlyColors.amber,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.explore,
                        size: 18,
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
                            _spaces.relayStreamLive
                                ? 'Live · ${_catalog.relayUrls.first}'
                                : 'Connecting · ${_catalog.relayUrls.first}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10.5,
                              color: _spaces.relayStreamLive
                                  ? EarthlyColors.commentGreen
                                  : theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Theme: $themeLabel (tap to cycle)',
                      onPressed: () {
                        widget.onThemeModeChanged?.call(nextTheme);
                        unawaited(_persistAppSettings());
                        Navigator.of(ctx).pop();
                      },
                      icon: Icon(themeIcon, size: 19),
                    ),
                    OutlinedButton.icon(
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        unawaited(_preloadCatalog());
                        _showToast('Refreshing Nostr catalog…');
                      },
                      icon: const Icon(Icons.refresh, size: 15),
                      label: const Text('Sync'),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Material(
                  color: theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.7),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                    side: BorderSide(
                      color: theme.colorScheme.primary.withValues(alpha: 0.35),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      InkWell(
                        key: const Key('earthly-pill-settings-btn'),
                        borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(14),
                        ),
                        onTap: () {
                          Navigator.of(ctx).pop();
                          _openSettings(tab: EarthlySettingsTab.map);
                        },
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(14, 12, 12, 10),
                          child: Row(
                            children: [
                              Container(
                                width: 34,
                                height: 34,
                                decoration: BoxDecoration(
                                  color: EarthlyColors.amber
                                      .withValues(alpha: 0.18),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: const Icon(
                                  Icons.settings_outlined,
                                  size: 19,
                                  color: EarthlyColors.amber,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Settings',
                                      style:
                                          theme.textTheme.titleSmall?.copyWith(
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    Text(
                                      'Map source, clustering, relays, chat credentials & more',
                                      style:
                                          theme.textTheme.bodySmall?.copyWith(
                                        color:
                                            theme.colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Icon(
                                Icons.chevron_right,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ],
                          ),
                        ),
                      ),
                      Divider(
                        height: 1,
                        color: theme.dividerColor.withValues(alpha: 0.6),
                      ),
                      IntrinsicHeight(
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            for (final item in [
                              (
                                const Key('earthly-pill-jump-map'),
                                Icons.map_outlined,
                                'Map',
                                EarthlySettingsTab.map,
                              ),
                              (
                                const Key('earthly-pill-jump-relays'),
                                Icons.hub_outlined,
                                'Relays',
                                EarthlySettingsTab.relays,
                              ),
                              (
                                const Key('earthly-pill-jump-chat'),
                                Icons.auto_awesome,
                                'Chat AI',
                                EarthlySettingsTab.chat,
                              ),
                              (
                                const Key('earthly-pill-jump-account'),
                                Icons.account_circle_outlined,
                                'Account',
                                EarthlySettingsTab.account,
                              ),
                            ].indexed) ...[
                              if (item.$1 > 0)
                                VerticalDivider(
                                  width: 1,
                                  color:
                                      theme.dividerColor.withValues(alpha: 0.6),
                                ),
                              Expanded(
                                child: InkWell(
                                  key: item.$2.$1,
                                  onTap: () {
                                    Navigator.of(ctx).pop();
                                    _openSettings(tab: item.$2.$4);
                                  },
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 4,
                                      vertical: 9,
                                    ),
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(
                                          item.$2.$2,
                                          size: 16,
                                          color: theme.colorScheme.onSurface,
                                        ),
                                        const SizedBox(height: 3),
                                        Text(
                                          item.$2.$3,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            fontSize: 11,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
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
                      if (_isMapRotatedOrTilted)
                        TextButton(
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                          ),
                          onPressed: () {
                            Navigator.of(ctx).pop();
                            _reNorthMap();
                          },
                          child: const Text('Re-north'),
                        ),
                      TextButton(
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                        ),
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: geoUri));
                          Navigator.of(ctx).pop();
                          _showSuccessToast('Copied $geoUri');
                        },
                        child: const Text('Copy geo:'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                // Clean grouped action list (replaces multi-row pill wrap)
                Material(
                  key: const Key('earthly-pill-actions-group'),
                  color: theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.55),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                    side: BorderSide(color: theme.dividerColor),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final entry in [
                        if (_catalog.shelfMaps.isNotEmpty ||
                            _draft.features.isNotEmpty)
                          (
                            Icons.fit_screen,
                            'Fit All Layers',
                            null as String?,
                            () {
                              Navigator.of(ctx).pop();
                              _fitAllMountedLayers();
                            },
                          ),
                        if (_catalog.shelfMaps.isNotEmpty)
                          (
                            Icons.layers_clear_outlined,
                            'Clear Shelf',
                            '${_catalog.shelfMaps.length}',
                            () {
                              Navigator.of(ctx).pop();
                              _catalog.clearShelf();
                            },
                          ),
                        (
                          _draft.gpsTrackRecording
                              ? Icons.stop_circle_outlined
                              : Icons.route,
                          _draft.gpsTrackRecording
                              ? 'Save GPS Track'
                              : 'Record GPS Track',
                          _draft.gpsTrackRecording
                              ? '${_draft.gpsTrackPoints.length} pts'
                              : null,
                          () {
                            Navigator.of(ctx).pop();
                            if (_draft.gpsTrackRecording) {
                              unawaited(_finishGpsTrackToDraft());
                            } else {
                              unawaited(_startGpsTrack());
                            }
                          },
                        ),
                        (
                          Icons.image_outlined,
                          'Export Map Poster (PNG)',
                          null as String?,
                          () {
                            Navigator.of(ctx).pop();
                            unawaited(_exportMapPosterPng());
                          },
                        ),
                        (
                          Icons.inbox_outlined,
                          'Inbox',
                          _spaces.inboxUnreadCount > 0
                              ? '${_spaces.inboxUnreadCount} unread'
                              : null,
                          () {
                            Navigator.of(ctx).pop();
                            _openDrawer(EarthlyDrawer.inbox);
                            unawaited(_refreshInbox());
                          },
                        ),
                        (
                          Icons.lock_outline,
                          'Circles (MLS Groups)',
                          _spaces.circles.isNotEmpty
                              ? '${_spaces.circles.length}'
                              : null,
                          () {
                            Navigator.of(ctx).pop();
                            _openDrawer(EarthlyDrawer.circles);
                          },
                        ),
                        (
                          Icons.help_outline,
                          'Help & Shortcuts',
                          null as String?,
                          () {
                            Navigator.of(ctx).pop();
                            _openDrawer(EarthlyDrawer.help);
                          },
                        ),
                      ].indexed) ...[
                        if (entry.$1 > 0)
                          Divider(
                            height: 1,
                            color: theme.dividerColor.withValues(alpha: 0.6),
                          ),
                        InkWell(
                          onTap: entry.$2.$4,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 11,
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  entry.$2.$1,
                                  size: 18,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    entry.$2.$2,
                                    style: const TextStyle(
                                      fontSize: 13.5,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                if (entry.$2.$3 != null) ...[
                                  Text(
                                    entry.$2.$3!,
                                    style: TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                ],
                                Icon(
                                  Icons.chevron_right,
                                  size: 17,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _startGpsTrack() async {
    try {
      await _draft.startGpsTrack(
        fallbackCenter: _controller?.camera?.center,
      );
      _showToast(
        Platform.isAndroid
            ? 'Background GPS track started (foreground notification active)'
            : 'GPS Track recorder started — pan & tap +Pt to log waypoints',
      );
    } catch (err) {
      _showErrorToast('Could not start GPS track: $err');
    }
  }

  Future<void> _finishGpsTrackToDraft() async {
    final res = await _draft.finishGpsTrackToDraft(
      onPersist: _schedulePersistWorkingDraft,
    );
    if (res == null) return;
    _openDrawer(EarthlyDrawer.desk);
    _showSuccessToast(
      'Saved GPS Track (${res.pointCount} pts · ${DrawingMath.formatDistance(res.distanceMeters)}) to Working Draft',
    );
  }

  GeoBox _currentImportBounds() {
    final cam = _controller?.camera;
    final center = _catalog.inspectedLocation ??
        cam?.center ??
        const Geographic(lon: 16.3738, lat: 48.2082);
    final zoom = cam?.zoom ?? 14.0;
    final delta = (0.8 / (1 << zoom.round().clamp(4, 18))).clamp(0.004, 0.22);
    return GeoBox(
      west: (center.lon - delta).clamp(-180.0, 180.0),
      south: (center.lat - delta).clamp(-85.0, 85.0),
      east: (center.lon + delta).clamp(-180.0, 180.0),
      north: (center.lat + delta).clamp(-85.0, 85.0),
    );
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
    _animateCameraPosition(place.lon, place.lat, 14.5);
  }

  void _importGeoJsonStringToDraft(
    String geojson, {
    required String prefix,
    required String snackLabel,
  }) {
    final res = _draft.importGeoJsonString(
      geojson,
      prefix: prefix,
      onPersist: _schedulePersistWorkingDraft,
    );
    if (res.imported.isEmpty) {
      _showWarningToast('No Point, LineString, or Polygon features found to import');
      return;
    }
    _openDrawer(EarthlyDrawer.desk);
    if (res.bounds != null) _flyToBounds(res.bounds!);
    _showSuccessToast(
      'Added ${res.imported.length} feature(s) to Working Draft ($snackLabel)',
    );
  }

  MapLayerSnapshot _resolveMapLayers({required bool systemIsDark}) {
    return _mapLayers.resolve(
      shelfMaps: _catalog.effectiveDisplayShelfMaps,
      shelfRevision: _catalog.shelfRevision,
      draftFeatures: _draft.features,
      draftRevision: _draft.draftRevision,
      selectedDraftFeatureIds: _draft.selectedDraftFeatureIds,
      selectionRevision: _draft.selectionRevision,
      sightings: _catalog.allSightings,
      sightingsRevision: _catalog.sightingsRevision,
      beacons: _catalog.allBeacons,
      beaconsRevision: _catalog.beaconsRevision,
      activeStory: _catalog.activeStoryContext,
      storyRevision: _catalog.storyRevision,
      commentOverlayShapes: _catalog.commentOverlayShapes,
      commentOverlayRevision: _catalog.commentOverlayRevision,
      proposalOverlayShapes: _catalog.proposalOverlayShapes,
      proposalOverlayRevision: _catalog.proposalOverlayRevision,
      aiGhostShapes: _agent.aiGhostShapes,
      aiGhostRevision: _agent.aiGhostRevision,
      gpsTrackRecording: _draft.gpsTrackRecording,
      gpsTrackPoints: _draft.gpsTrackPoints,
      gpsTrackRevision: _draft.gpsTrackRevision,
      accentColor: Theme.of(context).colorScheme.primary,
      systemIsDark: systemIsDark,
      onInspectFeature: _inspectFeature,
    );
  }

  Listenable _listenableForDrawer(EarthlyDrawer target) => switch (target) {
        EarthlyDrawer.agent => Listenable.merge([
            _agent,
            _agent.streamListenable,
            _agent.ghostListenable,
            _catalog.shelfListenable,
          ]),
        EarthlyDrawer.explore => Listenable.merge([
            _catalog,
            _accountWallet.profilesListenable,
          ]),
        EarthlyDrawer.desk => Listenable.merge([
            _draft,
            _catalog,
            _spaces.outboxListenable,
            _spaces.circleLensListenable,
            _accountWallet.accountListenable,
          ]),
        EarthlyDrawer.spaces => Listenable.merge([
            _spaces,
            _accountWallet.accountListenable,
            _accountWallet.walletListenable,
            _agent.mcpListenable,
            _catalog,
          ]),
        EarthlyDrawer.circles => Listenable.merge([
            _spaces,
            _catalog.shelfListenable,
            _catalog.overlayListenable,
            _draft.geometryListenable,
            _accountWallet,
          ]),
        EarthlyDrawer.inbox => Listenable.merge([
            _spaces.inboxListenable,
            _spaces.badgeListenable,
            _accountWallet,
          ]),
        EarthlyDrawer.outbox => _spaces.outboxListenable,
        EarthlyDrawer.cashuWallet => Listenable.merge([
            _accountWallet.walletListenable,
            _accountWallet.accountListenable,
          ]),
        EarthlyDrawer.mcpBridge => _agent.mcpListenable,
        EarthlyDrawer.account => Listenable.merge([_accountWallet, _catalog]),
        EarthlyDrawer.settings => Listenable.merge([
            _mapLayers,
            _catalog,
            _spaces,
            _agent,
            _agent.mcpListenable,
            _accountWallet,
            _accountWallet.walletListenable,
            _draft.placementListenable,
          ]),
        _ => Listenable.merge([_catalog, _draft, _accountWallet]),
      };

  Widget _buildScopedDrawerSlot(EarthlyDrawer target) {
    return ListenableBuilder(
      listenable: _listenableForDrawer(target),
      builder: (context, _) =>
          _buildDrawerFor(target) ?? const SizedBox.shrink(),
    );
  }

  Widget? _buildDrawerFor(EarthlyDrawer target) {
    if (_draft.isDrawingMode && !_isDrawerAllowedInDrawingMode(target)) {
      return null;
    }
    switch (target) {
      case EarthlyDrawer.none:
        return null;
      case EarthlyDrawer.explore:
        return ExploreSheet(
          initialCatalog: _catalog.catalog,
          catalogLoading: _catalog.catalogLoading,
          relayUrls: _catalog.relayUrls,
          shelfAddresses:
              _catalog.shelfMaps.map((e) => e.summary.address).toSet(),
          profilesByPubkey: _accountWallet.profilesByPubkey,
          pinnedEntityIds: _catalog.pinnedEntityIds,
          recentEntityIds: _catalog.recentEntityIds,
          activeAtlasLens: _catalog.activeAtlasLens,
          onCatalogLoaded: (catalog) {
            _catalog.setCatalog(catalog);
            unawaited(
              _accountWallet.resolveCatalogProfiles(
                catalog,
                _catalog.relayUrls,
              ),
            );
          },
          onToggleFavorite: (id) => _catalog.toggleFavoriteEntity(
            id,
            onPersist: () => unawaited(_persistAppSettings()),
          ),
          onToggleMapOnShelf: _toggleMapOnShelf,
          onAddMapsBulk: _addMapsBulkToShelf,
          onInspectMap: _inspectMap,
          onFocusMap: (map) {
            _catalog.recordRecentEntity(
              'map:${map.address}',
              onPersist: () => unawaited(_persistAppSettings()),
            );
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
            _catalog.recordRecentEntity(
              'story:${story.address}',
              onPersist: () => unawaited(_persistAppSettings()),
            );
            unawaited(_openStory(story));
          },
          onOpenStoryDiscussion: (story) => _openDiscussion(
            DiscussionTarget(
              address: story.address,
              kind: 37520,
              pubkey: story.pubkey,
              title: story.title,
              eventId: story.eventId,
              baseMarkdown: story.content,
            ),
          ),
          onInspectAtlas: _inspectAtlas,
          onOpenAtlas: (atlas) => unawaited(_openAtlas(atlas)),
          onEnterAtlasLens: _enterAtlasLens,
          onLeaveAtlasLens: _catalog.leaveAtlasLens,
          onFocusSighting: _openSightingFromCatalog,
          onFocusBeacon: _focusBeacon,
          onCreateSighting: _openSightingComposer,
          onComposeStory: () {
            _catalog.setEditingStory(null);
            _openDrawer(EarthlyDrawer.storyComposer);
          },
          onCreateAtlas: () {
            _catalog.setEditingAtlas(null);
            _openDrawer(EarthlyDrawer.atlasComposer);
          },
          onOpenBeaconBroadcaster: () => _openDrawer(EarthlyDrawer.spaces),
          onOpenPerson: _openPerson,
          galleryMode: _catalog.galleryModeActive,
          galleryPreviewLoading: _catalog.galleryPreviewLoading,
          onGalleryModeChanged: _catalog.setGalleryModeActive,
          onPreviewGalleryMap: (map) => unawaited(
            _catalog.previewGalleryMap(
              map,
              onFlyToBounds: _flyToBounds,
            ),
          ),
          onPreviewGalleryStory: (story) => unawaited(
            _catalog.previewGalleryStory(
              story,
              onFlyToCamera: _flyToStoryCamera,
              onFlyToBounds: _flyToBounds,
            ),
          ),
          onPreviewGalleryAtlas: (atlas) => unawaited(
            _catalog.previewGalleryAtlas(
              atlas,
              mutedPubkeys: _accountWallet.mutedPubkeys,
              onFlyToBounds: _flyToBounds,
            ),
          ),
          onClearGalleryPreview: _catalog.clearGalleryPreview,
          onBack: _backCallbackFor(target),
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.desk:
        // Integrator: wire onBack: _backCallbackFor(target) & docked draw mode
        // once @drawing-ux-desk merges DeskSheet updates.
        return DeskSheet(
          activeDraftId: _draft.activeDraftId,
          savedDrafts: _draft.savedDrafts,
          relayUrls: _catalog.relayUrls,
          draftTitle: _draft.draftTitle,
          audience: _draft.draftAudience,
          account: _accountWallet.account,
          shelfMaps: _catalog.shelfMaps,
          deskStories: _catalog.deskStories,
          deskAtlases: _catalog.deskAtlases,
          drawnFeatures: _draft.features,
          activeAtlasLensName: _catalog.activeAtlasLens?.name,
          circles: _spaces.circles,
          selectedCircleId:
              _spaces.selectedCircleId ?? _spaces.activeCircleLensId,
          onSelectedCircleChanged: _spaces.setSelectedCircleId,
          onOpenCircles: () => _openDrawer(EarthlyDrawer.circles),
          canUndo: _draft.undoStack.isNotEmpty,
          canRedo: _draft.redoStack.isNotEmpty,
          onUndo: () => _draft.undoDraftEdit(
            onRefreshInspectedFeature: _refreshInspectedDraftFeature,
            onPersist: _schedulePersistWorkingDraft,
          ),
          onRedo: () => _draft.redoDraftEdit(
            onRefreshInspectedFeature: _refreshInspectedDraftFeature,
            onPersist: _schedulePersistWorkingDraft,
          ),
          onSelectDraft: _draft.selectSavedDraft,
          provenance: _draft.provenance,
          proposalSummary: _draft.proposalSummary,
          onProposalSummaryChanged: _draft.setProposalSummary,
          onDetachAsNewCopy: () =>
              _draft.detachAsNewCopy(onPersist: _schedulePersistWorkingDraft),
          onCreateNewDraft: () =>
              _draft.createNewDraft(onPersist: _schedulePersistWorkingDraft),
          onDeleteDraft: (id) => unawaited(
            _draft.deleteSavedDraft(
              id,
              onPersist: _schedulePersistWorkingDraft,
            ),
          ),
          onDraftTitleChanged: (title) => _draft.setDraftTitle(
            title,
            onPersist: _schedulePersistWorkingDraft,
          ),
          onAudienceChanged: (audience) => _draft.setDraftAudience(
            audience,
            onPersist: _schedulePersistWorkingDraft,
          ),
          onToggleShelfVisibility: _catalog.toggleShelfVisibility,
          onRemoveShelfMap: _catalog.removeShelfMap,
          onInspectShelfMap: _inspectMap,
          onFlyToShelfMap: _flyToMap,
          onCloneShelfMapToDraft: (map) => unawaited(_editOrForkMap(map)),
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
          onRemoveDeskStory: _catalog.removeDeskStory,
          onOpenDeskAtlas: _inspectAtlas,
          onRemoveDeskAtlas: _catalog.removeDeskAtlas,
          onRunGeoAction: (action) => unawaited(_runGeoActionUi(action)),
          onRunParameterizedGeoAction: (
            action, {
            meters,
            angleDeg,
            scale,
          }) =>
              unawaited(
            _runGeoActionUi(
              action,
              meters: meters,
              angleDeg: angleDeg,
              scale: scale,
            ),
          ),
          onPublishDraft: _publishDraft,
          onComposeStory: () {
            _catalog.setEditingStory(null);
            _openDrawer(EarthlyDrawer.storyComposer);
          },
          onCreateAtlas: () {
            _catalog.setEditingAtlas(null);
            _openDrawer(EarthlyDrawer.atlasComposer);
          },
          onImportGeoJson: () => unawaited(_importGeoJsonFile()),
          onImportOsm: () => _openDrawer(EarthlyDrawer.osmImport),
          onOpenRouting: () {
            _catalog.setRoutingOrigin(null);
            _openDrawer(EarthlyDrawer.routing);
          },
          onExportGeoJsonFile: () => unawaited(_exportSpatialFile('geojson')),
          onExportGpxFile: () => unawaited(_exportSpatialFile('gpx')),
          onExportKmlFile: () => unawaited(_exportSpatialFile('kml')),
          onExportShapefileZip: () => unawaited(_exportShapefileZip()),
          onExportPosterPng: () => unawaited(_exportMapPosterPng()),
          onCopyGeoJson: _copyGeoJsonToClipboard,
          onPasteGeoJsonFromClipboard: () =>
              unawaited(_pasteGeoJsonFromClipboard()),
          onValidateDraft: _draft.validateCurrentDraft,
          selectedDraftFeatureIds: _draft.selectedDraftFeatureIds,
          onToggleSelectDraftFeature: _draft.toggleSelectFeature,
          onSelectAllDraftFeatures: _draft.selectAllFeatures,
          onClearDraftSelection: _draft.clearSelection,
          onInspectDraftFeature: (f) =>
              _inspectFeature(_buildInspectedDraftFeature(f)),
          onDuplicateSelectedFeatures: () => unawaited(
            _duplicateDraftFeaturesUi(_draft.selectedDraftFeatureIds),
          ),
          onDeleteSelectedFeatures: () {
            final deleted = _draft.deleteSelectedFeatures(
              onPersist: _schedulePersistWorkingDraft,
            );
            final inspected = _catalog.inspectedFeature;
            if (inspected?.draftFeatureId != null &&
                deleted.contains(inspected!.draftFeatureId)) {
              _catalog.setInspectedFeature(null);
              _closeDrawer(EarthlyDrawer.inspector);
            }
          },
          onClearDraftFeatures: () =>
              _draft.clearDraftFeatures(onPersist: _schedulePersistWorkingDraft),
          pendingOutboxCount: _spaces.pendingOutboxCount,
          onOpenOutbox: () {
            _openDrawer(EarthlyDrawer.outbox);
            unawaited(
              _spaces.refreshOutboxItems(isHeadlessTest: _isHeadlessTest),
            );
          },
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.spaces:
        return SpacesSheet(
          account: _accountWallet.account,
          localNsec: _accountWallet.localNsec,
          relayUrls: _catalog.relayUrls,
          initialPairingLink: _spaces.pendingDeepLinkPairing,
          circles: _spaces.circles,
          pendingCircleJoinsCount: _spaces.circlePendingJoins.length,
          activeCircleId: _spaces.activeCircleLensId,
          inboxUnreadCount: _spaces.inboxUnreadCount,
          onOpenInbox: () {
            _openDrawer(EarthlyDrawer.inbox);
            unawaited(_refreshInbox());
          },
          pendingOutboxCount: _spaces.pendingOutboxCount,
          onOpenOutbox: () {
            _openDrawer(EarthlyDrawer.outbox);
            unawaited(
              _spaces.refreshOutboxItems(isHeadlessTest: _isHeadlessTest),
            );
          },
          onOpenCircles: () => _openDrawer(EarthlyDrawer.circles),
          onSelectCircle: (ws) {
            _spaces.setSelectedCircleId(ws.workspaceId);
            _openDrawer(EarthlyDrawer.circles);
          },
          onRelayUrlsChanged: (next) => _catalog.updateRelayUrls(
            next,
            onPersist: () => unawaited(_persistAppSettings()),
            onSyncRelays: () => unawaited(_syncRelayPoolAndRefresh()),
          ),
          onFetchNip65Relays: () => _spaces.fetchNip65Relays(
            relayUrls: _catalog.relayUrls,
            ensureAccount: _ensureAccount,
          ),
          onPublishNip65Relays: (relays) => _spaces.publishNip65Relays(
            relays,
            relayUrls: _catalog.relayUrls,
            ensureAccount: _ensureAccount,
            signUnsignedEvent: _accountWallet.signUnsignedEvent,
          ),
          onOpenShoutbox: () => _openDrawer(EarthlyDrawer.shoutbox),
          onOpenHelp: () => _openDrawer(EarthlyDrawer.help),
          onOpenCashuWallet: () => _openDrawer(EarthlyDrawer.cashuWallet),
          cashuWalletEnabled: _accountWallet.nip60WalletEnabled,
          cashuBalanceSats: _accountWallet.nip60WalletEnabled
              ? _accountWallet.cashuWalletState?.balanceSats.toInt()
              : null,
          onOpenMcpBridge: () => _openDrawer(EarthlyDrawer.mcpBridge),
          mcpBridgeRunning: _agent.mcpBridgeStatus?.running ?? false,
          onAccountChanged: _onAmberAccountChanged,
          onLocalKeyChanged: _onLocalKeyChanged,
          onSessionStateChanged: _spaces.setSessionState,
          onNearbySynced: () => _catalog.setCatalog(null),
          onBroadcastBeacon: _broadcastLiveBeacon,
          onBack: _backCallbackFor(target),
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.circles:
        return CirclesSheet(
          account: _accountWallet.account,
          localNsec: _accountWallet.localNsec,
          bunkerUri: _accountWallet.bunkerUri,
          bunkerClientNsec: _accountWallet.bunkerClientNsec,
          isReadOnlySession: _accountWallet.isReadOnlySession,
          onEnsureExternalSigner: () => _accountWallet.syncExternalCircleSigner(
            isHeadlessTest: _isHeadlessTest,
          ),
          mlsDatabasePath: _spaces.mlsDatabasePath,
          cordnServerPubkey: _spaces.cordnServerPubkey,
          blossomServerUrl: _catalog.blossomServerUrl,
          relayUrls: _catalog.relayUrls,
          workspaces: _spaces.circles,
          pendingJoins: _spaces.circlePendingJoins,
          activeCircleId: _spaces.activeCircleLensId,
          mountedCircleDatasetKeys:
              _catalog.shelfMaps.map((e) => e.summary.address).toSet(),
          activeCommentOverlayId: _catalog.activeCommentOverlayId,
          hasDraftGeometry: _draft.features.isNotEmpty,
          profilesByPubkey: _accountWallet.profilesByPubkey,
          initialWorkspaceId: _spaces.selectedCircleId,
          initialInviteLink: _spaces.pendingDeepLinkCircleInvite,
          onCordnPubkeyChanged: (pk) => _spaces.setCordnServerPubkey(
            pk,
            onPersist: () => unawaited(_persistAppSettings()),
          ),
          onRefreshCircles: () => _spaces.refreshCirclesSnapshot(
            accountPubkey: _accountWallet.account?.pubkey,
            isHeadlessTest: _isHeadlessTest,
          ),
          onSyncWorkspaceReadonly: (workspaceId) async {
            final pk = _accountWallet.account?.pubkey;
            if (pk == null || pk.isEmpty) {
              throw StateError('Sign in to sync Circles');
            }
            return _spaces.syncCircleReadonly(
              accountPubkey: pk,
              workspaceId: workspaceId,
              onWorkspaceUpdated: (ws) {
                if (mounted) _handleCircleWorkspaceUpdated(ws);
              },
            );
          },
          onUploadBlossomBlob: ({
            required bytes,
            required mimeType,
            required purpose,
            sha256Hex,
            serverUrl,
          }) async {
            await RustBridge.ensureInitialized();
            final account = await _ensureAccount();
            final sha = (sha256Hex != null && sha256Hex.isNotEmpty)
                ? sha256Hex
                : await computeSha256Hex(bytes: bytes);
            final unsignedAuth = await prepareUnsignedBlossomUploadAuth(
              pubkeyOrNpub: account.pubkey,
              sha256Hex: sha,
              message: purpose,
            );
            final signedAuth = await _accountWallet.signUnsignedEvent(
              account,
              unsignedAuth,
            );
            return uploadBlobToBlossom(
              serverUrl: (serverUrl != null && serverUrl.trim().isNotEmpty)
                  ? serverUrl.trim()
                  : _catalog.blossomServerUrl,
              bytes: bytes,
              mimeType: mimeType,
              signedAuthEventJson: signedAuth,
            );
          },
          onSignUnsignedEvent: (unsignedEventJson) async {
            final account = await _ensureAccount();
            return _accountWallet.signUnsignedEvent(account, unsignedEventJson);
          },
          onNip44EncryptSelf: _accountWallet.nip44EncryptForSelfExternal,
          onNip44DecryptSelf: _accountWallet.nip44DecryptForSelfExternal,
          onWorkspaceUpdated: _handleCircleWorkspaceUpdated,
          onEnterCircleLens: _enterCircleLens,
          onLeaveCircleLens: _leaveCircleLens,
          onToggleDatasetOnMap: _toggleCircleDatasetOnMap,
          onZoomToDataset: _zoomToCircleDataset,
          onEditDatasetInDraft: (ws, ds) {
            final parsed = parseDraftFeaturesFromGeoJson(ds.geojsonJson);
            final isOwned = _accountWallet.account != null &&
                _accountWallet.account!.pubkey.toLowerCase() ==
                    ds.pubkey.toLowerCase();
            _spaces.enterCircleLensState(ws);
            _spaces.setSelectedCircleId(ws.workspaceId);
            _draft.loadCircleDataset(
              dTag: ds.datasetId,
              title: ds.title,
              parsed: parsed,
              isOwned: isOwned,
              sourceAuthorPubkey: ds.pubkey,
              sourceAuthorLabel: _authorLabelForPubkey(ds.pubkey),
              circleWorkspaceId: ws.workspaceId,
              circleName: ws.name,
              onPersist: _schedulePersistWorkingDraft,
            );
            _openDrawer(EarthlyDrawer.desk);
          },
          onCopyDatasetToDraft: (ws, ds) {
            final parsed = parseDraftFeaturesFromGeoJson(ds.geojsonJson);
            _spaces.enterCircleLensState(ws);
            _spaces.setSelectedCircleId(ws.workspaceId);
            _draft.loadCircleDataset(
              dTag: ds.datasetId,
              title: ds.title,
              parsed: parsed,
              isOwned: false,
              sourceAuthorPubkey: ds.pubkey,
              sourceAuthorLabel: _authorLabelForPubkey(ds.pubkey),
              circleWorkspaceId: ws.workspaceId,
              circleName: ws.name,
              onPersist: _schedulePersistWorkingDraft,
            );
            _openDrawer(EarthlyDrawer.desk);
            _showSuccessToast(
              'Created editable copy of "${ds.title}" in Desk',
            );
          },
          onProposeDatasetEdit: (ws, ds) {
            final parsed = parseDraftFeaturesFromGeoJson(ds.geojsonJson);
            _spaces.enterCircleLensState(ws);
            _spaces.setSelectedCircleId(ws.workspaceId);
            _draft.loadCircleDatasetForProposal(
              targetDatasetId: ds.datasetId,
              targetAuthorPubkey: ds.pubkey,
              targetAuthorLabel: _authorLabelForPubkey(ds.pubkey),
              circleWorkspaceId: ws.workspaceId,
              circleName: ws.name,
              title: ds.title,
              parsed: parsed,
              onPersist: _schedulePersistWorkingDraft,
            );
            _openDrawer(EarthlyDrawer.desk);
            _showToast(
              'Loaded "${ds.title}" to propose an edit to "${ws.name}"',
            );
          },
          activeProposalOverlayId: _catalog.activeProposalOverlayId,
          onToggleProposalOverlay: (ws, prop) {
            final shapes = _catalog.toggleCircleProposalOverlay(prop);
            if (shapes.isNotEmpty) {
              final bounds = computeFeatureBounds(shapes.first);
              if (bounds != null) _flyToBounds(bounds);
            }
          },
          onRespondProposal: (ws, prop, statusKind, note) async {
            await RustBridge.ensureInitialized();
            await _accountWallet.syncExternalCircleSigner(
              isHeadlessTest: _isHeadlessTest,
            );
            final mlsPath = await _spaces.ensureMlsDatabasePath();
            final updated = await respondCircleDatasetProposal(
              databasePath: mlsPath,
              signerNsec: _accountWallet.localNsec,
              bunkerUri: _accountWallet.bunkerUri,
              bunkerClientNsec: _accountWallet.bunkerClientNsec,
              workspaceId: ws.workspaceId,
              proposalId: prop.proposalId,
              statusKind: statusKind,
              note: note,
            );
            _handleCircleWorkspaceUpdated(updated);
            if (statusKind == 1631) {
              final refreshed = updated.datasets
                  .where((d) => d.datasetId == prop.targetDatasetId)
                  .firstOrNull;
              if (refreshed != null) {
                final summary = SpacesSyncController.circleDatasetToSummary(
                  updated,
                  refreshed,
                );
                _catalog.applyResolvedMapToState(summary);
                _catalog.ensureMapOnShelf(summary);
              }
              if (_catalog.activeProposalOverlayId == prop.proposalId) {
                _catalog.clearAllMapOverlays();
              }
            }
            return updated;
          },
          onStartNewPrivateMap: (ws) {
            _spaces.enterCircleLensState(ws);
            _draft.startNewCircleDraft(
              circleName: ws.name,
              onPersist: _schedulePersistWorkingDraft,
            );
            _openDrawer(EarthlyDrawer.desk);
          },
          onToggleCommentGeometry: (msg) {
            if (_catalog.activeCommentOverlayId == msg.envelopeId) {
              _catalog.setCircleCommentOverlay(null, const <ShelfShape>[]);
              return;
            }
            if (msg.geojsonJson == null || msg.geojsonJson!.isEmpty) return;
            final shapes = parseGeoJsonShapes(
              msg.geojsonJson!,
              datasetTitle: 'Circle Comment',
            );
            _catalog.setCircleCommentOverlay(msg.envelopeId, shapes);
            if (shapes.isNotEmpty) {
              final bounds = computeFeatureBounds(shapes.first);
              if (bounds != null) _flyToBounds(bounds);
            }
          },
          onSendCircleComment: (workspaceId, text, attachDraft) async {
            await RustBridge.ensureInitialized();
            await _accountWallet.syncExternalCircleSigner(
              isHeadlessTest: _isHeadlessTest,
            );
            final mlsPath = await _spaces.ensureMlsDatabasePath();
            final geojson = (attachDraft && _draft.features.isNotEmpty)
                ? draftFeaturesToGeoJson(
                    title: 'Circle attachment',
                    features: _draft.features,
                  )
                : null;
            final updated = await sendCircleComment(
              databasePath: mlsPath,
              signerNsec: _accountWallet.localNsec,
              bunkerUri: _accountWallet.bunkerUri,
              bunkerClientNsec: _accountWallet.bunkerClientNsec,
              workspaceId: workspaceId,
              text: text,
              geojsonJson: geojson,
            );
            _handleCircleWorkspaceUpdated(updated);
            return updated;
          },
          onSendCircleCommentWithMedia: (
            workspaceId,
            text,
            attachDraft,
            imetaTags,
          ) async {
            await RustBridge.ensureInitialized();
            await _accountWallet.syncExternalCircleSigner(
              isHeadlessTest: _isHeadlessTest,
            );
            final mlsPath = await _spaces.ensureMlsDatabasePath();
            final geojson = (attachDraft && _draft.features.isNotEmpty)
                ? draftFeaturesToGeoJson(
                    title: 'Circle attachment',
                    features: _draft.features,
                  )
                : null;
            final updated = await sendCircleCommentWithMedia(
              databasePath: mlsPath,
              signerNsec: _accountWallet.localNsec,
              bunkerUri: _accountWallet.bunkerUri,
              bunkerClientNsec: _accountWallet.bunkerClientNsec,
              workspaceId: workspaceId,
              text: text,
              geojsonJson: geojson,
              imetaTags: imetaTags,
            );
            _handleCircleWorkspaceUpdated(updated);
            return updated;
          },
          onOpenAccount: () => _openDrawer(EarthlyDrawer.account),
          onClose: () {
            _spaces.clearPendingCircleInvite();
            _closeDrawer(target);
          },
        );
      case EarthlyDrawer.inbox:
        return InboxSheet(
          account: _accountWallet.account,
          items: _spaces.inboxItems,
          loading: _spaces.inboxLoading,
          readAllBeforeSecs: _spaces.inboxReadAllBefore,
          readIds: _spaces.inboxReadIds,
          profilesByPubkey: _accountWallet.profilesByPubkey,
          pendingCircleJoinsCount: _spaces.circlePendingJoins.length,
          pendingNearbyClaimsCount: _spaces.pendingClaimCount,
          onRefresh: _refreshInbox,
          onMarkItemRead: (id) => _spaces.markInboxItemRead(
            id,
            onPersist: () => unawaited(_persistAppSettings()),
          ),
          onMarkAllRead: () => _spaces.markAllInboxRead(
            onPersist: () => unawaited(_persistAppSettings()),
          ),
          onOpenItem: (item) => unawaited(_openInboxItem(item)),
          onOpenPerson: _openPerson,
          onOpenCircles: () => _openDrawer(EarthlyDrawer.circles),
          onOpenSpaces: () => _openDrawer(EarthlyDrawer.spaces),
          onOpenAccount: () => _openDrawer(EarthlyDrawer.account),
          onBack: _backCallbackFor(target),
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.outbox:
        return OutboxQueueSheet(
          items: _spaces.outboxItems,
          flushing: _spaces.outboxFlushing,
          onFlushAll: () => unawaited(
            _spaces.flushAndRefreshOutbox(isHeadlessTest: _isHeadlessTest),
          ),
          onRetryItem: (id) => unawaited(
            _spaces.retryOutboxEntry(id).catchError((Object err) {
              _showErrorToast('Outbox retry failed: $err');
            }),
          ),
          onDiscardItem: (id) => unawaited(
            _spaces.discardOutboxEntry(id).catchError((Object err) {
              _showErrorToast('Outbox discard failed: $err');
            }),
          ),
          onBack: _backCallbackFor(target),
          onClose: () => _closeDrawer(EarthlyDrawer.outbox),
        );
      case EarthlyDrawer.person:
        final personPk = _catalog.inspectedPersonPubkey;
        if (personPk == null) return null;
        // Integrator: wire onBack: _backCallbackFor(target) once @ui-layout-cleanup merges.
        return PersonMarginSheet(
          pubkey: personPk,
          relayUrls: _catalog.relayUrls,
          isCurrentUser: _accountWallet.account?.pubkey == personPk,
          initialProfile: _accountWallet.profilesByPubkey[personPk],
          catalogMaps: _catalog.catalog?.maps ?? const <MapSummaryDto>[],
          catalogStories:
              _catalog.catalog?.stories ?? const <StorySummaryDto>[],
          catalogAtlases:
              _catalog.catalog?.atlases ?? const <AtlasSummaryDto>[],
          shelfAddresses:
              _catalog.shelfMaps.map((e) => e.summary.address).toSet(),
          onProfileResolved: _accountWallet.cacheProfile,
          onToggleMapOnShelf: _toggleMapOnShelf,
          onInspectMap: _inspectMap,
          onFocusMap: _flyToMap,
          onOpenStory: (story) {
            _catalog.recordRecentEntity(
              'story:${story.address}',
              onPersist: () => unawaited(_persistAppSettings()),
            );
            unawaited(_openStory(story));
          },
          onInspectAtlas: _inspectAtlas,
          onEnterAtlasLens: _enterAtlasLens,
          isMuted: _accountWallet.mutedPubkeys.contains(personPk),
          onToggleMute: () {
            if (_accountWallet.mutedPubkeys.contains(personPk)) {
              _accountWallet.unmutePubkey(
                personPk,
                onPersistSettings: () => unawaited(_persistAppSettings()),
              );
            } else {
              _mutePubkeyUi(personPk);
            }
          },
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.account:
        return AccountSessionSheet(
          account: _accountWallet.account,
          localNsec: _accountWallet.localNsec,
          bunkerUri: _accountWallet.bunkerUri,
          relayUrls: _catalog.relayUrls,
          savedAccounts: _accountWallet.savedAccounts,
          activeAccountId: _accountWallet.activeAccountId,
          profilesByPubkey: _accountWallet.profilesByPubkey,
          onSwitchSession: (session) {
            final name = _accountWallet.switchSavedSession(
              session,
              onSessionActivated: _onSessionActivated,
            );
            _showSuccessToast('Switched account to $name');
          },
          onRemoveSession: (id) => _accountWallet.removeSavedSession(
            id,
            onSessionActivated: _onSessionActivated,
          ),
          onAddReadOnlyNpub: (pk) => _accountWallet.addReadOnlySession(
            pk,
            onSessionActivated: _onSessionActivated,
          ),
          mutedPubkeys: _accountWallet.mutedPubkeys,
          onUnmutePubkey: (pk) => _accountWallet.unmutePubkey(
            pk,
            onPersistSettings: () => unawaited(_persistAppSettings()),
          ),
          blossomServerUrl: _catalog.blossomServerUrl,
          onBlossomServerChanged: (url) => _catalog.setBlossomServerUrl(
            url,
            onPersist: () => unawaited(_persistAppSettings()),
          ),
          onUploadBlossomImage: _pickAndUploadBlossomImage,
          profile: _accountWallet.account != null
              ? _accountWallet.profilesByPubkey[_accountWallet.account!.pubkey]
              : null,
          activeSessionSummary: _spaces.activeSessionSummaryText,
          onAccountChanged: _onAmberAccountChanged,
          onLocalKeyChanged: _onLocalKeyChanged,
          onBunkerConnected: (conn) {
            if (conn == null) {
              if (_accountWallet.activeAccountId != null &&
                  _accountWallet.activeAccountId!.startsWith('bunker:')) {
                _accountWallet.removeSavedSession(
                  _accountWallet.activeAccountId!,
                  onSessionActivated: _onSessionActivated,
                );
              } else {
                _accountWallet.clearBunkerCredentials();
              }
              return;
            }
            _accountWallet.upsertAndActivateSession(
              SavedAccountSessionDto(
                id: 'bunker:${conn.userPubkeyHex}',
                kind: 'bunker',
                pubkeyHex: conn.userPubkeyHex,
                bunkerUri: conn.bunkerUri,
                bunkerClientNsec: conn.clientNsec,
              ),
              onSessionActivated: _onSessionActivated,
            );
          },
          nwcUri: _accountWallet.nwcUri,
          onNwcUriChanged: (uri) => _accountWallet.setNwcUri(
            uri,
            onPersistSettings: () => unawaited(_persistAppSettings()),
          ),
          onOpenCashuWallet: () => _openDrawer(EarthlyDrawer.cashuWallet),
          cashuWalletEnabled: _accountWallet.nip60WalletEnabled,
          cashuBalanceSats: _accountWallet.nip60WalletEnabled
              ? _accountWallet.cashuWalletState?.balanceSats.toInt()
              : null,
          onSaveProfile: (req) => _accountWallet.publishProfile(
            req,
            relayUrls: _catalog.relayUrls,
            onSessionActivated: _onSessionActivated,
          ),
          onOpenSpaces: () => _openDrawer(EarthlyDrawer.spaces),
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.cashuWallet:
        return CashuWalletSheet(
          state: _accountWallet.cashuWalletViewState,
          walletEnabled: _accountWallet.nip60WalletEnabled,
          onSetWalletEnabled: (enabled) async {
            _accountWallet.setNip60WalletEnabled(
              enabled,
              onPersistSettings: () => unawaited(_persistAppSettings()),
            );
            if (enabled) {
              await _accountWallet.refreshCashuWalletState(
                isHeadlessTest: _isHeadlessTest,
              );
              if (!_isHeadlessTest) {
                await _accountWallet.syncNip60WalletForActiveAccount(
                  _catalog.relayUrls,
                  isHeadlessTest: _isHeadlessTest,
                );
              }
            }
          },
          busy: _accountWallet.cashuBusy,
          onInitializeWallet: (mints, enableNutzaps) async {
            var next = await _accountWallet.runCashuOp(
              (dbPath, pubkeyHex, masterKey) => initCashuWallet(
                databasePath: dbPath,
                pubkeyHex: pubkeyHex,
                mints: mints,
                relays: _catalog.relayUrls,
                masterKeyB64: masterKey,
              ),
              onSessionActivated: _onSessionActivated,
            );
            if (enableNutzaps &&
                _accountWallet.localNsec != null &&
                _accountWallet.localNsec!.trim().isNotEmpty) {
              await _accountWallet.runCashuOp(
                (dbPath, pubkeyHex, masterKey) async {
                  await publishNip61NutzapInfo(
                    databasePath: dbPath,
                    nsecOrHex: _accountWallet.requireCashuNsec(),
                    mints: mints,
                    relays: _catalog.relayUrls,
                    masterKeyB64: masterKey,
                  );
                  next = await loadCashuWalletState(
                    databasePath: dbPath,
                    pubkeyHex: pubkeyHex,
                    masterKeyB64: masterKey,
                  );
                },
                onSessionActivated: _onSessionActivated,
              );
            }
            _accountWallet.updateCashuWalletState(next);
          },
          onSyncWallet: () => _accountWallet.syncNip60WalletForActiveAccount(
            _catalog.relayUrls,
            isHeadlessTest: _isHeadlessTest,
          ),
          onAddMint: (url) async {
            final next = await _accountWallet.runCashuOp(
              (dbPath, pubkeyHex, masterKey) => addCashuMint(
                databasePath: dbPath,
                pubkeyHex: pubkeyHex,
                mintUrl: url,
                masterKeyB64: masterKey,
              ),
              onSessionActivated: _onSessionActivated,
            );
            _accountWallet.updateCashuWalletState(next);
          },
          onRemoveMint: (url) async {
            final next = await _accountWallet.runCashuOp(
              (dbPath, pubkeyHex, masterKey) => removeCashuMint(
                databasePath: dbPath,
                pubkeyHex: pubkeyHex,
                mintUrl: url,
                masterKeyB64: masterKey,
              ),
              onSessionActivated: _onSessionActivated,
            );
            _accountWallet.updateCashuWalletState(next);
          },
          onRequestDeposit: (mintUrl, amountSats) async {
            final quote = await _accountWallet.runCashuOp(
              (dbPath, pubkeyHex, masterKey) => requestCashuMintQuote(
                databasePath: dbPath,
                pubkeyHex: pubkeyHex,
                mintUrl: mintUrl,
                amountSats: BigInt.from(amountSats),
                masterKeyB64: masterKey,
              ),
              onSessionActivated: _onSessionActivated,
            );
            _accountWallet.cashuQuoteAmounts[quote.quoteId] =
                quote.amountSats.toInt();
            return CashuMintQuoteView(
              quoteId: quote.quoteId,
              mintUrl: quote.mintUrl,
              amountSats: quote.amountSats.toInt(),
              bolt11: quote.request,
              paid: quote.paid,
            );
          },
          onClaimDeposit: (mintUrl, quoteId) async {
            final amountSats = _accountWallet.cashuQuoteAmounts[quoteId] ?? 0;
            final next = await _accountWallet.runCashuOp(
              (dbPath, pubkeyHex, masterKey) => claimCashuMintQuote(
                databasePath: dbPath,
                pubkeyHex: pubkeyHex,
                mintUrl: mintUrl,
                quoteId: quoteId,
                amountSats: BigInt.from(amountSats),
                masterKeyB64: masterKey,
              ),
              onSessionActivated: _onSessionActivated,
            );
            _accountWallet.updateCashuWalletState(next);
          },
          onReceiveToken: (cashuToken) async {
            final next = await _accountWallet.runCashuOp(
              (dbPath, pubkeyHex, masterKey) => receiveCashuToken(
                databasePath: dbPath,
                pubkeyHex: pubkeyHex,
                token: cashuToken,
                masterKeyB64: masterKey,
              ),
              onSessionActivated: _onSessionActivated,
            );
            _accountWallet.updateCashuWalletState(next);
          },
          onSendToken: (mintUrl, amountSats) async {
            final res = await _accountWallet.runCashuOp(
              (dbPath, pubkeyHex, masterKey) => sendCashuToken(
                databasePath: dbPath,
                pubkeyHex: pubkeyHex,
                mintUrl: mintUrl,
                amountSats: BigInt.from(amountSats),
                masterKeyB64: masterKey,
              ),
              onSessionActivated: _onSessionActivated,
            );
            _accountWallet.updateCashuWalletState(res.walletState);
            return res.token;
          },
          onWithdrawBolt11: (mintUrl, bolt11) async {
            final res = await _accountWallet.runCashuOp(
              (dbPath, pubkeyHex, masterKey) => payBolt11ViaCashu(
                databasePath: dbPath,
                pubkeyHex: pubkeyHex,
                mintUrl: mintUrl,
                bolt11: bolt11,
                masterKeyB64: masterKey,
              ),
              onSessionActivated: _onSessionActivated,
            );
            _accountWallet.updateCashuWalletState(res.walletState);
          },
          onToggleNutzaps: () async {
            final mints =
                _accountWallet.cashuWalletState?.mints ?? const <String>[];
            final next = await _accountWallet.runCashuOp(
              (dbPath, pubkeyHex, masterKey) async {
                await publishNip61NutzapInfo(
                  databasePath: dbPath,
                  nsecOrHex: _accountWallet.requireCashuNsec(),
                  mints: mints,
                  relays: _catalog.relayUrls,
                  masterKeyB64: masterKey,
                );
                return loadCashuWalletState(
                  databasePath: dbPath,
                  pubkeyHex: pubkeyHex,
                  masterKeyB64: masterKey,
                );
              },
              onSessionActivated: _onSessionActivated,
            );
            _accountWallet.updateCashuWalletState(next);
          },
          onClaimNutzaps: () async {
            final res = await _accountWallet.runCashuOp(
              (dbPath, _, masterKey) => claimIncomingNutzaps(
                databasePath: dbPath,
                nsecOrHex: _accountWallet.requireCashuNsec(),
                relays: _catalog.relayUrls,
                masterKeyB64: masterKey,
              ),
              onSessionActivated: _onSessionActivated,
            );
            _accountWallet.updateCashuWalletState(res.walletState);
          },
          onBack: _backCallbackFor(target),
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.mcpBridge:
        return McpBridgeSheet(
          state: _agent.mcpBridgeViewState,
          busy: _agent.mcpBridgeBusy,
          onStart: (port) => _agent.startMcpBridgeServer(
            port,
            buildWorkspace: _buildMcpWorkspaceDto,
            onTick: _pollMcpBridgeTick,
          ),
          onStop: _agent.stopMcpBridgeServer,
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.search:
        return PlaceSearchSheet(
          initialQuery: _lastSearchQuery,
          onQueryChanged: (q) => _lastSearchQuery = q,
          catalogMaps: _catalog.catalog?.maps ?? const <MapSummaryDto>[],
          catalogStories:
              _catalog.catalog?.stories ?? const <StorySummaryDto>[],
          catalogAtlases:
              _catalog.catalog?.atlases ?? const <AtlasSummaryDto>[],
          catalogSightings: _catalog.allSightings,
          profilesByPubkey: _accountWallet.profilesByPubkey,
          relayUrls: _catalog.relayUrls,
          onSelectMap: _inspectMap,
          onSelectStory: (story) {
            _catalog.recordRecentEntity(
              'story:${story.address}',
              onPersist: () => unawaited(_persistAppSettings()),
            );
            unawaited(_openStory(story));
          },
          onSelectAtlas: _inspectAtlas,
          onSelectSighting: _openSightingFromCatalog,
          onSelectPerson: _openPerson,
          onJumpToPlace: _jumpToPlace,
          onJumpToNaddr: _jumpToNaddr,
          onBack: _backCallbackFor(target),
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.agent:
        return AgentDrawer(
          messages: _agent.messages,
          threads: _agent.threads,
          activeThreadId: _agent.activeThread.id,
          onCreateThread: () => _agent.createNewThread(
            onPersistSettings: () => unawaited(_persistAppSettings()),
          ),
          onSelectThread: _agent.selectThread,
          onDeleteThread: (id) => _agent.deleteThread(
            id,
            onPersistSettings: () => unawaited(_persistAppSettings()),
          ),
          settings: _agent.settings,
          busy: _agent.busy,
          streamingText: _agent.streamingText,
          activeToolStatus: _agent.activeToolStatus,
          liveToolCalls: _agent.liveToolCalls,
          shelfMaps: [
            for (final entry in _catalog.shelfMaps)
              (address: entry.summary.address, title: entry.summary.title),
          ],
          workingSetAddresses: _agent.workingSetAddresses,
          onToggleWorkingSet: _agent.toggleWorkingSet,
          pendingAttachment: _agent.pendingAttachment,
          onPickAttachment: () => unawaited(
            _agent.pickAttachment().then((err) {
              if (err != null) _showErrorToast(err);
            }),
          ),
          onClearAttachment: _agent.clearPendingAttachment,
          visionSupport: _agent.visionSupport,
          attachMapView: _agent.attachMapView,
          onAttachMapViewChanged: _agent.setAttachMapView,
          safeEditing: _agent.safeEditing,
          onSafeEditingChanged: _agent.setSafeEditing,
          pendingEdit: _agent.pendingAiEdit,
          onAcceptPendingEdit: _acceptPendingAiEdit,
          onDiscardPendingEdit: _agent.clearPendingGhost,
          onExtractSourceToMap: _extractResearchSourceToMap,
          onFocusCoord: (lat, lon, _) => _animateCameraPosition(lon, lat, 15.0),
          onCiteSourceInStory: _citeResearchSourceInStory,
          onSettingsChanged: (s) => _agent.updateSettings(
            s,
            isHeadlessTest: _isHeadlessTest,
            onPersistSettings: () => unawaited(_persistAppSettings()),
          ),
          onSendPrompt: (p) => unawaited(_sendAgentPrompt(p)),
          onClearChat: () => _agent.clearActiveThread(
            onPersistSettings: () => unawaited(_persistAppSettings()),
          ),
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.storyReader:
        if (_catalog.activeStory == null || _catalog.parsedStory == null) {
          return null;
        }
        final activeStory = _catalog.activeStory!;
        final visibleCalloutCount = collectVisibleCallouts(
          shelfMaps: _catalog.shelfMaps,
          draftFeatures: _draft.features,
          activeStory: _catalog.activeStoryContext,
        ).length;
        // Integrator: wire onBack: _backCallbackFor(target) once @ui-layout-cleanup merges.
        return StoryReaderMargin(
          story: activeStory,
          relayUrls: _catalog.relayUrls,
          parsed: _catalog.parsedStory!,
          datasetsByAddress: _catalog.storyDatasets,
          decodedRefsByToken: _catalog.storyDecodedRefs,
          loadingLinkedMaps: _catalog.loadingStoryMaps,
          activeViewIndex: _catalog.activeStoryViewIndex,
          calloutCount: visibleCalloutCount,
          onSelectViewIndex: (index) => _catalog.selectStoryView(
            index,
            onFlyToCamera: _flyToStoryCamera,
            onFlyToBounds: _flyToBounds,
          ),
          onFocusDataset: (entry) {
            _catalog.focusStoryDataset(entry.summary.address);
            _flyToMap(entry.summary);
          },
          onActivateNaddrRef: (ref) {
            final dataset = _catalog.activateStoryNaddrRef(ref);
            if (dataset == null) {
              _showWarningToast('Referenced map ${ref.dTag} is not on relay');
              return;
            }
            if (ref.featureId != null) {
              final matches = dataset.shapes
                  .where((s) => s.featureId == ref.featureId)
                  .toList();
              if (matches.isNotEmpty) {
                final bounds = computeFeatureBounds(matches.first);
                if (bounds != null) {
                  _flyToBounds(bounds);
                  return;
                }
              }
            }
            _flyToMap(dataset.summary);
          },
          onActivateGeoRef: (lat, lon, label) {
            _catalog.addStoryGeoPin(lat, lon, label);
            _animateCameraPosition(lon, lat, 15.5);
          },
          onFitAllGeometry: () {
            final bounds = computeCombinedBounds(_catalog.storyDatasets.values);
            if (bounds != null) _flyToBounds(bounds);
          },
          onOpenDiscussion: () => _openDiscussion(
            DiscussionTarget(
              address: activeStory.address,
              kind: 37520,
              pubkey: activeStory.pubkey,
              title: activeStory.title,
              eventId: activeStory.eventId,
              baseMarkdown: activeStory.content,
            ),
          ),
          onKeepOnShelf: () {
            final count = _catalog.keepStoryMapsOnShelf();
            _showSuccessToast(
              'Pinned $count Story map${count == 1 ? '' : 's'} to Shelf',
            );
          },
          isOwned: _accountWallet.account != null &&
              _accountWallet.account!.pubkey == activeStory.pubkey,
          currentUserPubkey: _accountWallet.account?.pubkey,
          onToggleReaction: (current) => _toggleEntityReaction(
            address: activeStory.address,
            eventId: activeStory.eventId,
            pubkey: activeStory.pubkey,
            kind: 37520,
            current: current,
          ),
          onZap: () => unawaited(
            _openZapDialogForEntity(
              recipientPubkey: activeStory.pubkey,
              targetTitle: activeStory.title,
              targetAddress: activeStory.address,
              targetEventId: activeStory.eventId,
            ),
          ),
          authorLabel:
              _accountWallet.profilesByPubkey[activeStory.pubkey]?.displayName ??
                  _accountWallet.profilesByPubkey[activeStory.pubkey]?.name,
          onOpenPerson: _openPerson,
          onEditStory: () {
            _catalog.setEditingStory(activeStory);
            _openDrawer(EarthlyDrawer.storyComposer);
          },
          onDeleteStory: () async {
            final outcome = await _catalog.deleteOwnedStory(
              activeStory,
              ensureAccount: _ensureAccount,
              signUnsignedEvent: _accountWallet.signUnsignedEvent,
              deliverForAudience: _deliverForAudience,
            );
            _closeDrawer(EarthlyDrawer.storyReader);
            _showSuccessToast(
              'Published NIP-09 deletion for "${activeStory.title}" (${outcome.outboxState})',
            );
          },
          onClose: () {
            _closeDrawer(EarthlyDrawer.storyReader);
            _catalog.closeStory();
          },
        );
      case EarthlyDrawer.storyComposer:
        return StoryComposerDrawer(
          key: ValueKey(_catalog.editingStory?.address ?? 'new-story'),
          shelfMaps: _catalog.shelfMaps,
          catalogMaps: _catalog.catalog?.maps ?? const <MapSummaryDto>[],
          catalogAtlases:
              _catalog.catalog?.atlases ?? const <AtlasSummaryDto>[],
          profilesByPubkey: _accountWallet.profilesByPubkey,
          relayUrls: _catalog.relayUrls,
          editingStory: _catalog.editingStory,
          initialDraft:
              _catalog.editingStory == null ? _catalog.savedStoryDraft : null,
          onDraftChanged: (draft) => _catalog.setSavedStoryDraft(
            draft,
            notify: false,
            onPersist: () => unawaited(_persistAppSettings()),
          ),
          onDiscardDraft: () => _catalog.setSavedStoryDraft(
            null,
            onPersist: () => unawaited(_persistAppSettings()),
          ),
          onUploadBlossomImage: _pickAndUploadBlossomImage,
          getCameraSnapshot: () => _controller?.camera,
          onPublishStory: (req) => _catalog.publishStory(
            req,
            activeNearbySessionId: _spaces.activeNearbySessionId,
            ensureAccount: _ensureAccount,
            signUnsignedEvent: _accountWallet.signUnsignedEvent,
            deliverForAudience: _deliverForAudience,
          ),
          onClose: () {
            _catalog.setEditingStory(null);
            _closeDrawer(target);
          },
        );
      case EarthlyDrawer.atlasComposer:
        return AtlasComposerSheet(
          key: ValueKey(_catalog.editingAtlas?.address ?? 'new-atlas'),
          shelfMaps: _catalog.shelfMaps,
          catalogMaps: _catalog.catalog?.maps ?? const <MapSummaryDto>[],
          catalogStories:
              _catalog.catalog?.stories ?? const <StorySummaryDto>[],
          editingAtlas: _catalog.editingAtlas,
          onUploadBlossomImage: _pickAndUploadBlossomImage,
          onPublishAtlas: (req) => _catalog.publishAtlas(
            req,
            activeNearbySessionId: _spaces.activeNearbySessionId,
            ensureAccount: _ensureAccount,
            signUnsignedEvent: _accountWallet.signUnsignedEvent,
            deliverForAudience: _deliverForAudience,
          ),
          onClose: () {
            _catalog.setEditingAtlas(null);
            _closeDrawer(target);
          },
        );
      case EarthlyDrawer.atlasDetail:
        final atlas = _catalog.inspectedAtlas ?? _catalog.activeAtlasLens;
        if (atlas == null) return null;
        // Integrator: wire onBack: _backCallbackFor(target) once @ui-layout-cleanup merges.
        return AtlasDetailMargin(
          atlas: atlas,
          relayUrls: _catalog.relayUrls,
          catalogMaps: _catalog.catalog?.maps ?? const <MapSummaryDto>[],
          catalogStories:
              _catalog.catalog?.stories ?? const <StorySummaryDto>[],
          shelfAddresses:
              _catalog.shelfMaps.map((e) => e.summary.address).toSet(),
          profilesByPubkey: _accountWallet.profilesByPubkey,
          isActiveLens: _catalog.activeAtlasLens?.address == atlas.address,
          isOwned: _accountWallet.account != null &&
              _accountWallet.account!.pubkey == atlas.pubkey,
          currentUserPubkey: _accountWallet.account?.pubkey,
          mutedPubkeys: _accountWallet.mutedPubkeys,
          onToggleReaction: (current) => _toggleEntityReaction(
            address: atlas.address,
            eventId: atlas.eventId,
            pubkey: atlas.pubkey,
            kind: 37518,
            current: current,
          ),
          onZap: () => unawaited(
            _openZapDialogForEntity(
              recipientPubkey: atlas.pubkey,
              targetTitle: atlas.name,
              targetAddress: atlas.address,
              targetEventId: atlas.eventId,
            ),
          ),
          onBlessContribution: (entityAddr) async {
            final updatedPins = <String>[
              ...atlas.pinnedAddresses,
              if (!atlas.pinnedAddresses.contains(entityAddr)) entityAddr,
            ];
            await _catalog.publishAtlas(
              AtlasPublishRequest(
                name: atlas.name,
                description: atlas.description ?? '',
                image: atlas.image,
                governance: atlas.governance,
                pinnedAddresses: updatedPins,
                hashtags: atlas.hashtags,
                audience: DraftAudienceChoice.publicRelay,
                existingDTag: atlas.dTag,
              ),
              activeNearbySessionId: _spaces.activeNearbySessionId,
              ensureAccount: _ensureAccount,
              signUnsignedEvent: _accountWallet.signUnsignedEvent,
              deliverForAudience: _deliverForAudience,
            );
            _showSuccessToast('Added to Curated in "${atlas.name}"');
          },
          onLockDownAtlas: () async {
            await _catalog.publishAtlas(
              AtlasPublishRequest(
                name: atlas.name,
                description: atlas.description ?? '',
                image: atlas.image,
                governance: 'closed',
                pinnedAddresses: atlas.pinnedAddresses,
                hashtags: atlas.hashtags,
                audience: DraftAudienceChoice.publicRelay,
                existingDTag: atlas.dTag,
              ),
              activeNearbySessionId: _spaces.activeNearbySessionId,
              ensureAccount: _ensureAccount,
              signUnsignedEvent: _accountWallet.signUnsignedEvent,
              deliverForAudience: _deliverForAudience,
            );
            _showSuccessToast('Locked down "${atlas.name}" to Author Picks only');
          },
          onMuteAuthor: _mutePubkeyUi,
          onOpenPerson: _openPerson,
          onEditAtlas: () {
            _catalog.setEditingAtlas(atlas);
            _openDrawer(EarthlyDrawer.atlasComposer);
          },
          onDeleteAtlas: () async {
            final outcome = await _catalog.deleteOwnedAtlas(
              atlas,
              ensureAccount: _ensureAccount,
              signUnsignedEvent: _accountWallet.signUnsignedEvent,
              deliverForAudience: _deliverForAudience,
            );
            _closeDrawer(EarthlyDrawer.atlasDetail);
            _showSuccessToast(
              'Published NIP-09 deletion for "${atlas.name}" (${outcome.outboxState})',
            );
          },
          onToggleLens: () {
            if (_catalog.activeAtlasLens?.address == atlas.address) {
              _catalog.leaveAtlasLens();
            } else {
              _enterAtlasLens(atlas);
            }
          },
          onShowAllOnMap: () => unawaited(_openAtlas(atlas)),
          onToggleMapOnShelf: _toggleMapOnShelf,
          onFocusMap: _flyToMap,
          onOpenStory: (story) {
            _catalog.recordRecentEntity(
              'story:${story.address}',
              onPersist: () => unawaited(_persistAppSettings()),
            );
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
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.datasetDetail:
        final map = _catalog.inspectedMap;
        if (map == null) return null;
        // Integrator: wire onBack: _backCallbackFor(target) once @ui-layout-cleanup merges.
        return DatasetDetailMargin(
          map: map,
          relayUrls: _catalog.relayUrls,
          onShelf:
              _catalog.shelfMaps.any((e) => e.summary.address == map.address),
          isOwned: _accountWallet.account != null &&
              _accountWallet.account!.pubkey == map.pubkey,
          authorProfile: _accountWallet.profilesByPubkey[map.pubkey],
          currentUserPubkey: _accountWallet.account?.pubkey,
          resolvingBlobs: _catalog.resolvingBlobAddresses.contains(map.address),
          onToggleReaction: (current) => _toggleEntityReaction(
            address: map.address,
            eventId: map.eventId,
            pubkey: map.pubkey,
            kind: 37515,
            current: current,
          ),
          onZap: () => unawaited(
            _openZapDialogForEntity(
              recipientPubkey: map.pubkey,
              targetTitle: map.title,
              targetAddress: map.address,
              targetEventId: map.eventId,
            ),
          ),
          onToggleOnShelf: () => _toggleMapOnShelf(map),
          onZoomToMap: () {
            if (!_catalog.shelfMaps
                .any((e) => e.summary.address == map.address)) {
              _toggleMapOnShelf(map);
            } else {
              _flyToMap(map);
            }
          },
          onJumpToFeature: (shape) => _jumpToMapFeature(map, shape),
          onEditOrForkMap: () => unawaited(_editOrForkMap(map)),
          onProposeEdit: () => unawaited(_proposeEditForPublicMap(map)),
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
          onDeleteMap: (m) async {
            final outcome = await _catalog.deleteOwnedMap(
              m,
              ensureAccount: _ensureAccount,
              signUnsignedEvent: _accountWallet.signUnsignedEvent,
              deliverForAudience: _deliverForAudience,
            );
            _showSuccessToast(
              'Published NIP-09 deletion for "${m.title}" (${outcome.outboxState})',
            );
            return outcome;
          },
          onOpenPerson: _openPerson,
          onClose: () => _closeDrawer(target),
        );
      case EarthlyDrawer.inspector:
        final feature = _catalog.inspectedFeature;
        if (feature == null) return null;
        return FeatureInspectorSheet(
          feature: feature,
          onClose: () => _closeDrawer(target),
          onRenameDraftFeature: (featureId, newName) {
            if (_draft.renameDraftFeature(
              featureId,
              newName,
              onPersist: _schedulePersistWorkingDraft,
            )) {
              _refreshInspectedDraftFeature(featureId);
            }
          },
          onRecolorDraftFeature: (featureId, colorHex) {
            if (_draft.recolorDraftFeature(
              featureId,
              colorHex,
              onPersist: _schedulePersistWorkingDraft,
            )) {
              _refreshInspectedDraftFeature(featureId);
            }
          },
          onUpdateDraftStyle: (
            featureId, {
            fillColorHex,
            clearFillColor = false,
            strokeColorHex,
            clearStrokeColor = false,
            strokeWidth,
            fillOpacity,
            radius,
            lineDash,
            arrowStart,
            arrowEnd,
            displayIcon,
            clearDisplayIcon = false,
            description,
            customProperties,
          }) {
            if (_draft.updateDraftFeatureStyle(
              featureId,
              fillColorHex: fillColorHex,
              clearFillColor: clearFillColor,
              strokeColorHex: strokeColorHex,
              clearStrokeColor: clearStrokeColor,
              strokeWidth: strokeWidth,
              fillOpacity: fillOpacity,
              radius: radius,
              lineDash: lineDash,
              arrowStart: arrowStart,
              arrowEnd: arrowEnd,
              displayIcon: displayIcon,
              clearDisplayIcon: clearDisplayIcon,
              description: description,
              customProperties: customProperties,
              onPersist: _schedulePersistWorkingDraft,
            )) {
              _refreshInspectedDraftFeature(featureId);
            }
          },
          onEditDraftGeometry: (featureId) => _draft.startEditingDraftFeature(
            featureId,
            onCloseDrawers: _closeAllDrawers,
          ),
          onDuplicateDraftFeature: (featureId) =>
              unawaited(_duplicateDraftFeaturesUi([featureId])),
          onDeleteDraftFeature: (featureId) {
            _draft.deleteDraftFeature(
              featureId,
              onPersist: _schedulePersistWorkingDraft,
            );
            if (_catalog.inspectedFeature?.draftFeatureId == featureId) {
              _catalog.setInspectedFeature(null);
            }
            _closeDrawer(target);
          },
          onAddDraftCallout: (featureId, callout) {
            if (_draft.addDraftCallout(
              featureId,
              callout,
              onPersist: _schedulePersistWorkingDraft,
            )) {
              _refreshInspectedDraftFeature(featureId);
            }
          },
          onRemoveDraftCallout: (featureId, calloutId) {
            if (_draft.removeDraftCallout(
              featureId,
              calloutId,
              onPersist: _schedulePersistWorkingDraft,
            )) {
              _refreshInspectedDraftFeature(featureId);
            }
          },
          onResetDraftCalloutOffset: (featureId, calloutId) {
            if (_draft.repositionDraftCallout(
              featureId,
              calloutId,
              Offset.zero,
              onPersist: _schedulePersistWorkingDraft,
            )) {
              _refreshInspectedDraftFeature(featureId);
            }
          },
          onUploadBlossomImage: _pickAndUploadBlossomImage,
          onTransformDraftFeature: _transformDraftFeatureUi,
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
                        relays: _catalog.relayUrls,
                        featureId: feature.featureId,
                      );
                      await Clipboard.setData(ClipboardData(text: uri));
                      _showSuccessToast('Copied nostr:naddr1… link');
                    }),
                  );
                }
              : null,
        );
      case EarthlyDrawer.discussion:
        final dTarget = _catalog.discussionTarget;
        if (dTarget == null) return null;
        return DiscussionMarginSheet(
          target: dTarget,
          relayUrls: _catalog.relayUrls,
          catalogMaps: _catalog.catalog?.maps ?? const <MapSummaryDto>[],
          catalogAtlases:
              _catalog.catalog?.atlases ?? const <AtlasSummaryDto>[],
          hasDraftGeometry: _draft.features.isNotEmpty,
          activeCommentGeojsonId: _catalog.activeCommentOverlayId,
          activeProposalId: _catalog.activeProposalOverlayId,
          showingAllCommentPins: _catalog.showingAllCommentPins,
          onToggleAllCommentPins: (geoComments) => _catalog.toggleAllCommentPins(
            geoComments,
            resolveAuthorName: _accountWallet.displayNameForPubkey,
          ),
          profilesByPubkey: _accountWallet.profilesByPubkey,
          currentUserPubkey: _accountWallet.account?.pubkey,
          onToggleCommentOverlay: (comment) => _catalog.toggleCommentOverlay(
            comment,
            resolveAuthorName: _accountWallet.displayNameForPubkey,
          ),
          onToggleProposalOverlay: _catalog.toggleProposalOverlay,
          onPostComment: (text, attachDraft, {replyTo}) async {
            await RustBridge.ensureInitialized();
            final account = await _ensureAccount();
            final dTag =
                'comment-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
            final geojson = (attachDraft && _draft.features.isNotEmpty)
                ? draftFeaturesToGeoJson(
                    title: 'Comment annotation',
                    features: _draft.features,
                  )
                : null;
            final prepared = await prepareUnsignedCommentEvent(
              pubkeyOrNpub: account.pubkey,
              dTag: dTag,
              rootAddress: dTarget.address,
              rootKind: dTarget.kind,
              rootPubkey: dTarget.pubkey,
              text: text,
              geojson: geojson,
              parentAddress: replyTo?.address,
              parentEventId: replyTo?.eventId,
              parentPubkey: replyTo?.pubkey,
            );
            final signed = await _accountWallet.signUnsignedEvent(
              account,
              prepared.unsignedEventJson,
            );
            return _deliverForAudience(DraftAudienceChoice.publicRelay, signed);
          },
          onSubmitProposal: (description) async {
            await RustBridge.ensureInitialized();
            final account = await _ensureAccount();
            final dTag = 'pr-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
            final proposedGeojson = draftFeaturesToGeoJson(
              title: dTarget.title,
              features: _draft.features,
            );
            final prepared = await prepareUnsignedProposalEvent(
              pubkeyOrNpub: account.pubkey,
              dTag: dTag,
              targetAddress: dTarget.address,
              targetOwnerPubkey: dTarget.pubkey,
              baseEventId: dTarget.eventId,
              description: description,
              proposedGeojson: proposedGeojson,
            );
            final signed = await _accountWallet.signUnsignedEvent(
              account,
              prepared.unsignedEventJson,
            );
            return _deliverForAudience(DraftAudienceChoice.publicRelay, signed);
          },
          onSubmitStoryProposal: dTarget.kind == 37520
              ? (description, proposedMarkdown) async {
                  await RustBridge.ensureInitialized();
                  final account = await _ensureAccount();
                  final dTag =
                      'story-pr-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
                  final prepared = await prepareUnsignedStoryProposalEvent(
                    pubkeyOrNpub: account.pubkey,
                    dTag: dTag,
                    targetAddress: dTarget.address,
                    targetOwnerPubkey: dTarget.pubkey,
                    baseEventId: dTarget.eventId,
                    description: description,
                    proposedMarkdown: proposedMarkdown,
                  );
                  final signed = await _accountWallet.signUnsignedEvent(
                    account,
                    prepared.unsignedEventJson,
                  );
                  return _deliverForAudience(
                    DraftAudienceChoice.publicRelay,
                    signed,
                  );
                }
              : null,
          mutedPubkeys: _accountWallet.mutedPubkeys,
          onMuteAuthor: _mutePubkeyUi,
          onOpenPerson: _openPerson,
          onLoadProposalToDraft: (proposal) => _cloneGeoJsonToDraft(
            '${dTarget.title} (PR)',
            proposal.geojson,
          ),
          onApplyProposal: (proposal) => _catalog.applyProposal(
            dTarget,
            proposal,
            ensureAccount: _ensureAccount,
            signUnsignedEvent: _accountWallet.signUnsignedEvent,
            deliverForAudience: _deliverForAudience,
          ),
          onCloseProposal: (proposal) => _submitProposalStatus(
            proposal,
            statusKind: 1632,
            note: 'Closed proposal',
          ),
          onRequestChangesProposal: (proposal, note) => _submitProposalStatus(
            proposal,
            statusKind: 1633,
            note: note,
          ),
          onUploadBlossomImage: () async =>
              (await _pickAndUploadBlossomImage('Upload comment photo'))?.url ??
              '',
          onClose: () => _closeDrawer(EarthlyDrawer.discussion),
        );
      case EarthlyDrawer.locationInspector:
        final pt = _catalog.inspectedLocation;
        if (pt == null) return null;
        return LocationInspectorSheet(
          lat: pt.lat,
          lon: pt.lon,
          catalogMaps: _catalog.catalog?.maps ?? const <MapSummaryDto>[],
          catalogSightings: _catalog.allSightings,
          onInspectMap: (map) {
            _catalog.recordRecentEntity(
              'map:${map.address}',
              onPersist: () => unawaited(_persistAppSettings()),
            );
            _inspectMap(map);
          },
          onFocusSighting: _openSightingFromCatalog,
          onDropPointHere: () {
            final feat = _draft.dropDraftPointAt(
              pt,
              onPersist: _schedulePersistWorkingDraft,
            );
            _showSuccessToast(
              'Added ${feat.name} at ${pt.lat.toStringAsFixed(5)}, ${pt.lon.toStringAsFixed(5)}',
            );
          },
          onCreateSightingHere: () => _openSightingComposer(initialLocation: pt),
          onImportOsmHere: () => _openDrawer(EarthlyDrawer.osmImport),
          onIsochroneHere: () {
            _catalog.setRoutingOrigin(pt);
            _openDrawer(EarthlyDrawer.routing);
          },
          onClose: () => _closeDrawer(EarthlyDrawer.locationInspector),
        );
      case EarthlyDrawer.osmImport:
        final bbox = _currentImportBounds();
        return OsmImportSheet(
          west: bbox.west,
          south: bbox.south,
          east: bbox.east,
          north: bbox.north,
          onImportFeatures: (res) => _importGeoJsonStringToDraft(
            res.geojson,
            prefix: 'osm',
            snackLabel: res.querySummary,
          ),
          onClose: () => _closeDrawer(EarthlyDrawer.osmImport),
        );
      case EarthlyDrawer.routing:
        final draftPoints = _draft.features
            .where((f) => f.kind == DrawToolMode.point && f.vertices.isNotEmpty)
            .map((f) => f.vertices.first)
            .toList(growable: false);
        return RoutingSheet(
          mapCenter: _controller?.camera?.center ??
              const Geographic(lon: 16.3738, lat: 48.2082),
          draftWaypoints: draftPoints,
          initialOrigin: _catalog.routingOrigin,
          onImportGeoJsonToDraft: (geojson, summaryLabel) =>
              _importGeoJsonStringToDraft(
            geojson,
            prefix: 'route',
            snackLabel: summaryLabel,
          ),
          onClose: () => _closeDrawer(EarthlyDrawer.routing),
        );
      case EarthlyDrawer.shoutbox:
        return ShoutboxSheet(
          relayUrls: _catalog.relayUrls,
          profilesByPubkey: _accountWallet.profilesByPubkey,
          currentUserPubkey: _accountWallet.account?.pubkey,
          mutedPubkeys: _accountWallet.mutedPubkeys,
          onOpenPerson: _openPerson,
          onPublishPost: (category, content) => _spaces.publishShoutboxPost(
            category,
            content,
            relayUrls: _catalog.relayUrls,
            ensureAccount: _ensureAccount,
            signUnsignedEvent: _accountWallet.signUnsignedEvent,
          ),
          onClose: () => _closeDrawer(EarthlyDrawer.shoutbox),
        );
      case EarthlyDrawer.help:
        return HelpShortcutsSheet(
          onClose: () => _closeDrawer(EarthlyDrawer.help),
        );
      case EarthlyDrawer.settings:
        return SettingsSheet(
          initialTab: _settingsInitialTab,
          themeMode: widget.themeMode,
          onThemeModeChanged: (mode) {
            widget.onThemeModeChanged?.call(mode);
            unawaited(_persistAppSettings());
          },
          activeBasemap: _mapLayers.selectedBasemap,
          offlineBasemap: _mapLayers.offlineBasemap,
          onSelectBasemap: (kind) {
            _mapLayers.setSelectedBasemap(kind);
            unawaited(_persistAppSettings());
          },
          onLoadedOfflinePmtiles: _handleLoadedOfflinePmtiles,
          backgroundMode: _mapLayers.backgroundMode,
          satelliteOpacity: _mapLayers.satelliteOpacity,
          onBackgroundModeChanged: (bg) {
            _mapLayers.setBackgroundMode(bg);
            unawaited(_mapLayers.syncSatellite(_controller?.style));
            unawaited(_persistAppSettings());
          },
          onSatelliteOpacityChanged: (v) {
            _mapLayers.setSatelliteOpacity(v);
            unawaited(_mapLayers.syncSatellite(_controller?.style));
            unawaited(_persistAppSettings());
          },
          pointClusteringEnabled: _mapLayers.pointClusteringEnabled,
          pointClusterRadius: _mapLayers.pointClusterRadius,
          pointClusterMaxZoom: _mapLayers.pointClusterMaxZoom,
          onPointClusteringChanged: (enabled) {
            _mapLayers.setPointClusteringEnabled(enabled);
            unawaited(_persistAppSettings());
          },
          onPointClusterRadiusChanged: (radius) {
            _mapLayers.setPointClusterRadius(radius);
            unawaited(_persistAppSettings());
          },
          onPointClusterMaxZoomChanged: (maxZoom) {
            _mapLayers.setPointClusterMaxZoom(maxZoom);
            unawaited(_persistAppSettings());
          },
          showLabels: _mapLayers.showLabels,
          onToggleLabels: _mapLayers.setShowLabels,
          calloutMode: _mapLayers.calloutMode,
          onChangeCalloutMode: _mapLayers.setCalloutMode,
          savedOfflinePacks: _mapLayers.savedOfflinePacks,
          onMountSavedPack: (pack) async {
            try {
              await _mapLayers.mountSavedOfflinePack(
                pack,
                onFlyTo: (center, zoom) =>
                    _animateCameraPosition(center.lon, center.lat, zoom),
              );
            } catch (err) {
              _showErrorToast('Could not mount offline pack: $err');
            }
          },
          onRemoveSavedPack: (sha) {
            _mapLayers.removeSavedOfflinePack(sha);
            unawaited(_persistAppSettings());
          },
          mountedAtlasWorkspaces: _mapLayers.mountedAtlasWorkspaces,
          onMountAtlasWorkspace: _mountAtlasWorkspace,
          onUnmountAtlasWorkspace: (path) {
            _mapLayers.removeMountedAtlasWorkspace(path);
            unawaited(
              _mapLayers.removeMacOsSecurityScopedBookmark(
                path,
                supportDirPath: _spaces.supportDirPath,
              ),
            );
            unawaited(_persistAppSettings());
          },
          onExportMapPosterPng: () => unawaited(_exportMapPosterPng()),
          relayUrls: _catalog.relayUrls,
          relayStreamLive: _spaces.relayStreamLive,
          onRelayUrlsChanged: (next) => _catalog.updateRelayUrls(
            next,
            onPersist: () => unawaited(_persistAppSettings()),
            onSyncRelays: () => unawaited(_syncRelayPoolAndRefresh()),
          ),
          blossomServerUrl: _catalog.blossomServerUrl,
          onBlossomServerChanged: (url) => _catalog.setBlossomServerUrl(
            url,
            onPersist: () => unawaited(_persistAppSettings()),
          ),
          cordnServerPubkey: _spaces.cordnServerPubkey,
          onCordnPubkeyChanged: (pk) => _spaces.setCordnServerPubkey(
            pk,
            onPersist: () => unawaited(_persistAppSettings()),
          ),
          onProbeRelaysHealth: (urls) async {
            await RustBridge.ensureInitialized();
            return probeRelaysHealth(relayUrls: urls);
          },
          onFetchNip65Relays: () => _spaces.fetchNip65Relays(
            relayUrls: _catalog.relayUrls,
            ensureAccount: _ensureAccount,
          ),
          onPublishNip65Relays: (relays) => _spaces.publishNip65Relays(
            relays,
            relayUrls: _catalog.relayUrls,
            ensureAccount: _ensureAccount,
            signUnsignedEvent: _accountWallet.signUnsignedEvent,
          ),
          agentSettings: _agent.settings,
          onAgentSettingsChanged: (s) => _agent.updateSettings(
            s,
            isHeadlessTest: _isHeadlessTest,
            onPersistSettings: () => unawaited(_persistAppSettings()),
          ),
          safeEditing: _agent.safeEditing,
          onSafeEditingChanged: _agent.setSafeEditing,
          visionSupport: _agent.visionSupport,
          attachMapView: _agent.attachMapView,
          onAttachMapViewChanged: _agent.setAttachMapView,
          onDiscoverModels: (baseUrl, apiKey) async {
            await RustBridge.ensureInitialized();
            return fetchAgentProviderModels(
              baseUrl: baseUrl,
              apiKey: apiKey.trim().isEmpty ? null : apiKey.trim(),
            );
          },
          mcpBridgeRunning: _agent.mcpBridgeStatus?.running ?? false,
          onOpenMcpBridge: () => _openDrawer(EarthlyDrawer.mcpBridge),
          account: _accountWallet.account,
          signerModeLabel: _signerModeLabel(),
          cashuWalletEnabled: _accountWallet.nip60WalletEnabled,
          onSetCashuWalletEnabled: (enabled) {
            _accountWallet.setNip60WalletEnabled(
              enabled,
              onPersistSettings: () => unawaited(_persistAppSettings()),
            );
            if (enabled) {
              unawaited(
                _accountWallet.refreshCashuWalletState(
                  isHeadlessTest: _isHeadlessTest,
                ),
              );
              if (!_isHeadlessTest) {
                unawaited(
                  _accountWallet.syncNip60WalletForActiveAccount(
                    _catalog.relayUrls,
                    isHeadlessTest: _isHeadlessTest,
                  ),
                );
              }
            }
          },
          cashuBalanceSats: _accountWallet.nip60WalletEnabled
              ? _accountWallet.cashuWalletState?.balanceSats.toInt()
              : null,
          onOpenCashuWallet: () => _openDrawer(EarthlyDrawer.cashuWallet),
          onOpenAccount: () => _openDrawer(EarthlyDrawer.account),
          mutedPubkeys: _accountWallet.mutedPubkeys.toList(growable: false),
          onUnmutePubkey: (pk) => _accountWallet.unmutePubkey(
            pk,
            onPersistSettings: () => unawaited(_persistAppSettings()),
          ),
          placementStyle: _draft.placementStyle,
          onPlacementStyleChanged: _draft.setPlacementStyle,
          loupeEnabled: _draft.loupeEnabled,
          onLoupeChanged: (enabled) {
            if (enabled != _draft.loupeEnabled) {
              _draft.toggleLoupeEnabled();
            }
          },
          snappingEnabled: _draft.snappingEnabled,
          onSnappingChanged: _draft.setSnappingEnabled,
          snapToEdgesEnabled: _draft.snapToEdgesEnabled,
          onSnapToEdgesChanged: _draft.setSnapToEdgesEnabled,
          pendingOutboxCount: _spaces.pendingOutboxCount,
          onOpenRustNode: () {
            showModalBottomSheet<void>(
              context: context,
              builder: (_) => const RustNodeSheet(),
            );
          },
          onOpenOutbox: () {
            _openDrawer(EarthlyDrawer.outbox);
            unawaited(
              _spaces.refreshOutboxItems(isHeadlessTest: _isHeadlessTest),
            );
          },
          onRefreshCatalog: () {
            unawaited(_preloadCatalog());
            _showToast('Refreshing Nostr catalog…');
          },
          onOpenHelp: () => _openDrawer(EarthlyDrawer.help),
          onClose: () => _closeDrawer(EarthlyDrawer.settings),
        );
    }
  }

  void _onAmberAccountChanged(Nip55Account? account) {
    if (account == null) {
      if (_accountWallet.activeAccountId != null) {
        _accountWallet.removeSavedSession(
          _accountWallet.activeAccountId!,
          onSessionActivated: _onSessionActivated,
        );
      } else {
        _accountWallet.applyActiveSessionState(null);
        unawaited(_persistAppSettings());
      }
      return;
    }
    _accountWallet.upsertAndActivateSession(
      SavedAccountSessionDto(
        id: 'amber:${account.pubkey}',
        kind: 'amber',
        pubkeyHex: account.pubkey,
        signerPackage: account.signerPackage,
      ),
      onSessionActivated: _onSessionActivated,
    );
  }

  void _onLocalKeyChanged(LocalKeypairDto? kp) {
    if (kp == null) {
      if (_accountWallet.activeAccountId != null &&
          _accountWallet.activeAccountId!.startsWith('local:')) {
        _accountWallet.removeSavedSession(
          _accountWallet.activeAccountId!,
          onSessionActivated: _onSessionActivated,
        );
      } else {
        _accountWallet.clearLocalNsec();
      }
      return;
    }
    _accountWallet.upsertAndActivateSession(
      SavedAccountSessionDto(
        id: 'local:${kp.pubkeyHex}',
        kind: 'local',
        pubkeyHex: kp.pubkeyHex,
        localNsec: kp.nsec,
      ),
      onSessionActivated: _onSessionActivated,
    );
  }

  void _mutePubkeyUi(String pubkey) {
    final label = _accountWallet.mutePubkey(
      pubkey,
      onPersistSettings: () => unawaited(_persistAppSettings()),
    );
    if (label == null || !mounted) return;
    _toast.showWarning(
      'Muted $label on this device',
      duration: const Duration(seconds: 6),
      actionLabel: 'Undo',
      onAction: () => _accountWallet.unmutePubkey(
        pubkey.trim(),
        onPersistSettings: () => unawaited(_persistAppSettings()),
      ),
    );
  }

  Future<PublishOutcomeDto> _submitProposalStatus(
    GeoProposalDto proposal, {
    required int statusKind,
    required String note,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await _ensureAccount();
    final preparedStatus = await prepareUnsignedProposalStatusEvent(
      pubkeyOrNpub: account.pubkey,
      proposalAddress: proposal.address,
      proposalEventId: proposal.eventId,
      proposalAuthorPubkey: proposal.pubkey,
      statusKind: statusKind,
      note: note,
    );
    final signed = await _accountWallet.signUnsignedEvent(
      account,
      preparedStatus.unsignedEventJson,
    );
    return _deliverForAudience(DraftAudienceChoice.publicRelay, signed);
  }

  Future<void> _duplicateDraftFeaturesUi(Iterable<String> ids) async {
    final count = await _draft.duplicateDraftFeatures(
      ids,
      onPersist: _schedulePersistWorkingDraft,
    );
    if (count > 0) {
      _showSuccessToast('Duplicated $count feature${count == 1 ? '' : 's'}');
    }
  }

  Future<void> _addPrimitiveShapeUi(String shape, double radiusMeters) async {
    try {
      final center = _controller?.camera?.center ??
          const Geographic(lon: 16.3738, lat: 48.2082);
      final label = await _draft.addPrimitiveShape(
        shape,
        radiusMeters,
        center: center,
        onPersist: _schedulePersistWorkingDraft,
      );
      if (label != null) _showSuccessToast('Added $label at map center');
    } catch (err) {
      _showErrorToast('Primitive shape failed: $err');
    }
  }

  Future<void> _transformDraftFeatureUi(
    String featureId, {
    double translateEastM = 0.0,
    double translateNorthM = 0.0,
    double rotateDeg = 0.0,
    double scale = 1.0,
  }) async {
    try {
      final ok = await _draft.transformDraftFeature(
        featureId,
        translateEastM: translateEastM,
        translateNorthM: translateNorthM,
        rotateDeg: rotateDeg,
        scale: scale,
        onPersist: _schedulePersistWorkingDraft,
      );
      if (ok) _refreshInspectedDraftFeature(featureId);
    } catch (err) {
      _showErrorToast('Transform failed: $err');
    }
  }

  Future<void> _runGeoActionUi(
    RustGeoAction action, {
    double? meters,
    double? angleDeg,
    double? scale,
  }) async {
    try {
      await _draft.runGeoAction(
        action,
        meters: meters,
        angleDeg: angleDeg,
        scale: scale,
        onPersist: _schedulePersistWorkingDraft,
      );
      _refreshInspectedDraftFeature('');
    } catch (err) {
      _showErrorToast('Geo operation failed: $err');
    }
  }

  void _selectAuthoringTool(DrawToolMode next) {
    if (next == DrawToolMode.measure) {
      _draft.toggleMeasureMode(onCloseDrawers: _closeAllDrawers);
      return;
    }
    _draft.selectMode(next, onCloseDrawers: _closeAllDrawers);
  }

  Future<void> _finishActiveStroke() async {
    if (!_draft.canFinishDraft) return;
    if (_draft.mode == DrawToolMode.splitByLine) {
      final res = await _draft.finishSplitByLine(
        onPersist: _schedulePersistWorkingDraft,
      );
      _showToast(
        res.message,
        severity: res.ok
            ? EarthlyToastSeverity.success
            : EarthlyToastSeverity.warning,
      );
      return;
    }
    _draft.finishDraft(onPersist: _schedulePersistWorkingDraft);
  }

  void _undoInDrawingMode() {
    if (_draft.draftVertices.isNotEmpty) {
      _draft.undoLastPoint(onPersist: _schedulePersistWorkingDraft);
    } else if (_draft.undoStack.isNotEmpty) {
      _draft.undoDraftEdit(
        onRefreshInspectedFeature: _refreshInspectedDraftFeature,
        onPersist: _schedulePersistWorkingDraft,
      );
    } else {
      _draft.undoLastPoint(onPersist: _schedulePersistWorkingDraft);
    }
  }

  Future<void> _promptDropMapLabel(Geographic point) async {
    final label = await showDialog<String>(
      context: context,
      builder: (_) => _DropMapLabelDialog(point: point),
    );
    if (!mounted || label == null) return;
    final created = _draft.commitAnnotationAt(
      point,
      label,
      onPersist: _schedulePersistWorkingDraft,
    );
    _showSuccessToast('Added label "${created.name ?? 'Label'}"');
  }

  DrawnFeature? _primarySelectedDraftFeature() {
    for (var i = _draft.features.length - 1; i >= 0; i--) {
      final f = _draft.features[i];
      if (_draft.selectedDraftFeatureIds.contains(f.id)) return f;
    }
    return null;
  }

  void _editVerticesPrimarySelectedDraftFeature() {
    final target = _primarySelectedDraftFeature();
    final targetId = target?.id ??
        (_draft.selectedDraftFeatureIds.isNotEmpty
            ? _draft.selectedDraftFeatureIds.last
            : null);
    if (targetId != null) {
      _draft.selectEditingTargetFeature(targetId, enterMode: true);
    }
  }

  void _inspectPrimarySelectedDraftFeature() {
    final target = _primarySelectedDraftFeature();
    if (target == null) return;
    _catalog.setInspectedFeature(_buildInspectedDraftFeature(target));
    _openDrawer(EarthlyDrawer.inspector);
  }

  void _deleteSelectedDraftFeatures() {
    final deleted = _draft.deleteSelectedFeatures(
      onPersist: _schedulePersistWorkingDraft,
    );
    final inspected = _catalog.inspectedFeature;
    if (inspected?.draftFeatureId != null &&
        deleted.contains(inspected!.draftFeatureId)) {
      _catalog.setInspectedFeature(null);
      _closeDrawer(EarthlyDrawer.inspector);
    }
  }

  void _openMobileDrawingToolsSheet() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(ctx).height * 0.84,
        ),
        child: ListenableBuilder(
          listenable: Listenable.merge([
            _draft,
            _draft.modeListenable,
            _draft.placementListenable,
            _draft.geometryListenable,
            _draft.undoRedoListenable,
            _mapLayers.presentationListenable,
          ]),
          builder: (sheetCtx, _) => MobileDrawingToolsSheet(
            activeMode: _draft.mode,
            activePrimitiveShape: _draft.activePrimitiveShape,
            placementStyle: _draft.placementStyle,
            loupeEnabled: _draft.loupeEnabled,
            snappingEnabled: _draft.snappingEnabled,
            snapToEdgesEnabled: _draft.snapToEdgesEnabled,
            calloutMode: _mapLayers.calloutMode,
            drawnFeatures: _draft.features,
            selectedFeatureIds: _draft.selectedDraftFeatureIds,
            canUndo: _draft.undoStack.isNotEmpty,
            canRedo: _draft.redoStack.isNotEmpty,
            onSelectTool: (mode) {
              if (mode != _draft.mode) {
                _selectAuthoringTool(mode);
              }
            },
            onSelectPrimitiveShape: (shape) {
              _draft.setActivePrimitiveShape(shape);
              if (_draft.mode != DrawToolMode.shape) {
                _draft.selectMode(
                  DrawToolMode.shape,
                  onCloseDrawers: _closeAllDrawers,
                );
              }
            },
            onDropPrimitiveAtCenter: (shape, radiusMeters) =>
                _addPrimitiveShapeUi(shape.name, radiusMeters),
            onToggleSnapping: _draft.toggleSnapping,
            onToggleSnapToEdges: _draft.toggleSnapToEdges,
            onTogglePlacementStyle: _draft.togglePlacementStyle,
            onToggleLoupe: _draft.toggleLoupeEnabled,
            onCycleCalloutMode: _mapLayers.cycleCalloutMode,
            onUndo: () => _draft.undoDraftEdit(
              onRefreshInspectedFeature: _refreshInspectedDraftFeature,
              onPersist: _schedulePersistWorkingDraft,
            ),
            onRedo: () => _draft.redoDraftEdit(
              onRefreshInspectedFeature: _refreshInspectedDraftFeature,
              onPersist: _schedulePersistWorkingDraft,
            ),
            onSelectAll: _draft.selectAllFeatures,
            onClearSelection: _draft.clearSelection,
            onDuplicateSelected: () => unawaited(
              _duplicateDraftFeaturesUi(
                _draft.selectedDraftFeatureIds.toList(),
              ),
            ),
            onDeleteSelected: _deleteSelectedDraftFeatures,
            onClearDraft: () => _draft.clearDraftFeatures(
              onPersist: _schedulePersistWorkingDraft,
            ),
            onRunGeoAction: (
              action, {
              meters,
              angleDeg,
              scale,
            }) =>
                unawaited(
              _runGeoActionUi(
                action,
                meters: meters,
                angleDeg: angleDeg,
                scale: scale,
              ),
            ),
            onPasteGeoJson: () => unawaited(_pasteGeoJsonFromClipboard()),
            onImportGeoJson: () => unawaited(_importGeoJsonFile()),
            onImportOsm: () {
              if (_draft.isDrawingMode) {
                _draft.cancelEditingDraftFeature();
              }
              _openDrawer(EarthlyDrawer.osmImport);
            },
            onExportGeoJson: () => unawaited(_exportSpatialFile('geojson')),
            onOpenDeskAndPublish: () {
              if (_draft.isDrawingMode) {
                _draft.cancelEditingDraftFeature();
              }
              _openDrawer(EarthlyDrawer.desk);
            },
            onExitDrawingMode: _draft.cancelEditingDraftFeature,
            onClose: () => Navigator.of(sheetCtx).pop(),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final screenWidth = MediaQuery.sizeOf(context).width;
    final isDesktop = screenWidth >= 880;
    final isWideStudio = screenWidth >= 1100;
    final systemIsDark = theme.brightness == Brightness.dark;
    final bottomSafeInset = MediaQuery.paddingOf(context).bottom;
    final screenHeight = MediaQuery.sizeOf(context).height;

    return CallbackShortcuts(
      bindings: <ShortcutActivator, VoidCallback>{
        const SingleActivator(LogicalKeyboardKey.escape): () =>
            _handleBackNavigation(allowExitPrompt: false),
        const SingleActivator(LogicalKeyboardKey.keyZ, meta: true): () {
          if (_draft.isDrawingMode) {
            _draft.undoLastPoint(onPersist: _schedulePersistWorkingDraft);
          } else {
            _draft.undoDraftEdit(
              onRefreshInspectedFeature: _refreshInspectedDraftFeature,
              onPersist: _schedulePersistWorkingDraft,
            );
          }
        },
        const SingleActivator(LogicalKeyboardKey.keyZ, control: true): () {
          if (_draft.isDrawingMode) {
            _draft.undoLastPoint(onPersist: _schedulePersistWorkingDraft);
          } else {
            _draft.undoDraftEdit(
              onRefreshInspectedFeature: _refreshInspectedDraftFeature,
              onPersist: _schedulePersistWorkingDraft,
            );
          }
        },
        const SingleActivator(
          LogicalKeyboardKey.keyZ,
          meta: true,
          shift: true,
        ): () {
          if (!_draft.isDrawingMode) {
            _draft.redoDraftEdit(
              onRefreshInspectedFeature: _refreshInspectedDraftFeature,
              onPersist: _schedulePersistWorkingDraft,
            );
          }
        },
        const SingleActivator(
          LogicalKeyboardKey.keyZ,
          control: true,
          shift: true,
        ): () {
          if (!_draft.isDrawingMode) {
            _draft.redoDraftEdit(
              onRefreshInspectedFeature: _refreshInspectedDraftFeature,
              onPersist: _schedulePersistWorkingDraft,
            );
          }
        },
        const SingleActivator(LogicalKeyboardKey.keyY, control: true): () {
          if (!_draft.isDrawingMode) {
            _draft.redoDraftEdit(
              onRefreshInspectedFeature: _refreshInspectedDraftFeature,
              onPersist: _schedulePersistWorkingDraft,
            );
          }
        },
        const SingleActivator(LogicalKeyboardKey.keyD, meta: true): () =>
            _handleDuplicateShortcut(),
        const SingleActivator(LogicalKeyboardKey.keyD, control: true): () =>
            _handleDuplicateShortcut(),
        const SingleActivator(LogicalKeyboardKey.digit1, meta: true): () =>
            _draft.selectMode(
              DrawToolMode.point,
              onCloseDrawers: _closeAllDrawers,
            ),
        const SingleActivator(LogicalKeyboardKey.digit2, meta: true): () =>
            _draft.selectMode(
              DrawToolMode.line,
              onCloseDrawers: _closeAllDrawers,
            ),
        const SingleActivator(LogicalKeyboardKey.digit3, meta: true): () =>
            _draft.selectMode(
              DrawToolMode.polygon,
              onCloseDrawers: _closeAllDrawers,
            ),
      },
      child: Focus(
        autofocus: true,
        child: EarthlyToastScope(
          controller: _toast,
          child: EarthlyReferenceScope(
            onOpenNaddr: (uri) async {
              try {
                await _jumpToNaddr(uri);
              } catch (err) {
                _showErrorToast('Could not open reference: $err');
              }
            },
            onOpenGeo: (lat, lon, label) {
              _catalog.addStoryGeoPin(lat, lon, label);
              _animateCameraPosition(lon, lat, 15.5);
            },
            onOpenPerson: _openPerson,
            resolveNaddrTitle: _catalog.resolveNaddrTitle,
            resolvePersonLabel: (pk) =>
                _accountWallet.profilesByPubkey[pk]?.displayName ??
                _accountWallet.profilesByPubkey[pk]?.name,
            child: PopScope(
              canPop: false,
              onPopInvokedWithResult: (didPop, _) {
                if (didPop) return;
                _handleBackNavigation();
              },
              child: Scaffold(
                body: Stack(
                  fit: StackFit.expand,
                  children: [
                    // 1. Isolated Map Surface + Memoized GeoJSON/GPU Layer Scope
                    _buildIsolatedMapSurface(
                      systemIsDark: systemIsDark,
                      isDesktop: isDesktop,
                      isWideStudio: isWideStudio,
                      bottomSafeInset: bottomSafeInset,
                    ),

                    // 2. Touch Draw Overlay Scope (does not rebuild on AI tokens/drawer)
                    _buildTouchDrawOverlayScope(),

                    // 3. Top Instrument Bar Scope
                    _buildTopBarScope(isDesktop: isDesktop),

                    // 4. Mobile Right-Thumb Controls Rail Scope
                    if (!isDesktop)
                      _buildRightThumbRailScope(
                        screenHeight: screenHeight,
                        bottomSafeInset: bottomSafeInset,
                        isWideStudio: isWideStudio,
                      ),

                    // 5. Contextual Map HUD Bars Scope (Lens, Measure, Ghost, GPS)
                    _buildHudOverlaysScope(
                      isDesktop: isDesktop,
                      isWideStudio: isWideStudio,
                      systemIsDark: systemIsDark,
                      bottomSafeInset: bottomSafeInset,
                    ),

                    // 6. Left / Mobile Drawer Scope
                    _buildLeftDrawerScope(isWideStudio: isWideStudio),

                    // 7. Wide Studio Right Margin Drawer Scope
                    if (isWideStudio) _buildRightDrawerScope(),

                    // 8. Bottom Dock Scope
                    _buildBottomDockScope(
                      isDesktop: isDesktop,
                      isWideStudio: isWideStudio,
                      systemIsDark: systemIsDark,
                    ),

                    // 9. Auto-Decaying Toast Overlay Scope (always above drawers & dock)
                    EarthlyToastOverlay(controller: _toast),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _handleDuplicateShortcut() {
    if (_draft.isDrawingMode) return;
    if (_draft.selectedDraftFeatureIds.isNotEmpty) {
      unawaited(
        _duplicateDraftFeaturesUi(_draft.selectedDraftFeatureIds.toList()),
      );
    } else if (_catalog.inspectedFeature?.isDraft == true &&
        _catalog.inspectedFeature?.draftFeatureId != null) {
      unawaited(
        _duplicateDraftFeaturesUi([_catalog.inspectedFeature!.draftFeatureId!]),
      );
    }
  }

  Widget _buildIsolatedMapSurface({
    required bool systemIsDark,
    required bool isDesktop,
    required bool isWideStudio,
    required double bottomSafeInset,
  }) {
    return ListenableBuilder(
      listenable: Listenable.merge([
        _draft.geometryListenable,
        _draft.placementListenable,
        _catalog.mapContentListenable,
        _draft.gpsTrackListenable,
        _agent.ghostListenable,
        _mapLayers.layerConfigListenable,
      ]),
      builder: (context, _) {
        final snapshot = _resolveMapLayers(systemIsDark: systemIsDark);
        _scheduleClusteredPointsSync();
        final gestures = _draft.activeMapGestures;
        final mapStyle = _mapLayers.resolveMapStyle(systemIsDark: systemIsDark);

        final mapWidget = widget.mapBuilder != null
            ? widget.mapBuilder!(
                context,
                gestures,
                (controller) => _controllerNotifier.value = controller,
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
                onMapCreated: (controller) {
                  _controllerNotifier.value = controller;
                  _scheduleClusteredPointsSync(force: true);
                },
                onStyleLoaded: (style) {
                  unawaited(_mapLayers.syncSatellite(style));
                  _scheduleClusteredPointsSync(force: true);
                },
                onCameraMove: (event) {
                  final nextBearing = event.camera.bearing;
                  final nextPitch = event.camera.pitch;
                  final prev = _cameraOrientationNotifier.value;
                  if ((nextBearing - prev.bearing).abs() > 0.4 ||
                      (nextPitch - prev.pitch).abs() > 0.4) {
                    _cameraOrientationNotifier.value = (
                      bearing: nextBearing,
                      pitch: nextPitch,
                    );
                  }
                },
                onLongClick: (event) {
                  if (!_draft.isDrawingMode) {
                    _openLocationInspector(event.point);
                  }
                },
                layers: snapshot.gpuLayers,
                children: [
                  ListenableBuilder(
                    listenable: Listenable.merge([
                      _mapLayers.presentationListenable,
                      _drawerNav,
                      _catalog.shelfListenable,
                    ]),
                    builder: (context, _) {
                      final leftTarget = _drawer != EarthlyDrawer.none
                          ? _drawer
                          : (!isWideStudio
                              ? _rightStudioDrawer
                              : EarthlyDrawer.none);
                      final galleryOpen = !isDesktop &&
                          leftTarget == EarthlyDrawer.explore &&
                          _catalog.galleryModeActive;
                      final hideBottomDockOnMobile = !isDesktop &&
                          leftTarget != EarthlyDrawer.none &&
                          !_draft.isDrawingMode;
                      return EarthlyCalloutOverlay(
                        callouts: snapshot.visibleCallouts,
                        sightings: _catalog.allSightings,
                        iconPins: snapshot.visibleIconPins,
                        arrowheads: snapshot.visibleArrowheads,
                        commentPins: _catalog.activeCommentPins,
                        onInspectComment: (_) =>
                            _openDrawer(EarthlyDrawer.discussion),
                        onRepositionDraftCallout: (fid, cid, off) {
                          if (_draft.repositionDraftCallout(
                            fid,
                            cid,
                            off,
                            onPersist: _schedulePersistWorkingDraft,
                          )) {
                            _refreshInspectedDraftFeature(fid);
                          }
                        },
                        displayMode: _mapLayers.calloutMode,
                        bottomInset: (galleryOpen
                                ? 236
                                : (hideBottomDockOnMobile ? 340 : 108)) +
                            bottomSafeInset,
                        onInspectFeature: _inspectFeature,
                        onInspectSighting: _inspectSighting,
                      );
                    },
                  ),
                  ValueListenableBuilder<DraftPreviewState>(
                    valueListenable: _draft.previewNotifier,
                    builder: (context, preview, _) => MapGeometryLayer(
                      features: _draft.features,
                      draftVertices: _draft.draftVertices,
                      mode: _draft.mode,
                      previewScreen: preview.screen,
                      snapped: preview.snapped,
                      loupeActive: preview.loupeActive,
                      editingFeature: _draft.activeEditingFeature,
                      selectedVertexIndex: _draft.selectedVertexIndex,
                      selectedFeatureIds: _draft.selectedDraftFeatureIds,
                      activePrimitiveShape: _draft.activePrimitiveShape,
                    ),
                  ),
                ],
              );

        return RepaintBoundary(
          key: _mapRepaintBoundaryKey,
          child: mapWidget,
        );
      },
    );
  }

  Widget _buildTouchDrawOverlayScope() {
    return ListenableBuilder(
      listenable: Listenable.merge([
        _draft.modeListenable,
        _draft.geometryListenable,
        _draft.placementListenable,
        _catalog.shelfListenable,
        _controllerNotifier,
      ]),
      builder: (context, _) {
        final externalSnapShapes = _mapLayers.lastSnapshot?.externalSnapShapes ??
            <List<Geographic>>[
              for (final entry in _catalog.shelfMaps)
                if (entry.visible)
                  for (final shape in entry.shapes)
                    if (shape.coords.isNotEmpty) shape.coords,
            ];
        return TouchDrawOverlay(
          controller: _controller,
          mode: _draft.mode,
          placementStyle: _draft.placementStyle,
          loupeEnabled: _draft.loupeEnabled,
          features: _draft.features,
          externalSnapShapes: externalSnapShapes,
          draftVertices: _draft.draftVertices,
          activePrimitiveShape: _draft.activePrimitiveShape,
          snappingEnabled: _draft.snappingEnabled,
          snapToEdgesEnabled: _draft.snapToEdgesEnabled,
          editingFeature: _draft.activeEditingFeature,
          selectedVertexIndex: _draft.selectedVertexIndex,
          selectedFeatureIds: _draft.selectedDraftFeatureIds,
          onCommitVertex: (pt) => _draft.commitVertex(
            pt,
            onPersist: _schedulePersistWorkingDraft,
          ),
          onUpdateDraftVertex: _draft.updateDraftVertex,
          onInsertDraftVertex: _draft.insertDraftVertex,
          onTwoFingerUndo: () =>
              _draft.undoLastPoint(onPersist: _schedulePersistWorkingDraft),
          onPreviewChanged: _draft.updatePreview,
          onTapFeatureInSelectMode: _draft.toggleSelectFeature,
          onBoxSelect: (rect) {
            final controller = _controller;
            if (controller == null) return;
            final count = _draft.commitBoxSelect(
              rect,
              controller.toScreenLocation,
            );
            _showToast(
              count == 0
                  ? 'No draft features inside selection box'
                  : 'Selected $count feature${count == 1 ? '' : 's'}',
              severity: count == 0
                  ? EarthlyToastSeverity.warning
                  : EarthlyToastSeverity.info,
            );
          },
          onCommitFreehand: (pts) => _draft.commitFreehandStroke(
            pts,
            onPersist: _schedulePersistWorkingDraft,
          ),
          onCommitShape: (shape, ring, radiusMeters) =>
              _draft.commitPrimitiveRing(
            shape,
            ring,
            radiusMeters: radiusMeters,
            onPersist: _schedulePersistWorkingDraft,
          ),
          onRequestAnnotationAt: (pt) => unawaited(_promptDropMapLabel(pt)),
          onSelectEditingFeature: _draft.selectEditingTargetFeature,
          onSelectEditingVertex: _draft.selectVertexIndex,
          onUpdateEditingVertex: (index, pos, {pushUndoBefore = false}) =>
              _draft.updateEditingFeatureVertex(
            index,
            pos,
            pushUndoBefore: pushUndoBefore,
            onPersist: _schedulePersistWorkingDraft,
          ),
          onInsertEditingVertex: (insertIndex, pos) =>
              _draft.insertEditingFeatureVertex(
            insertIndex,
            pos,
            onPersist: _schedulePersistWorkingDraft,
          ),
          onTranslateFeature: (featureId, delta, {pushUndoBefore = false}) {
            final controller = _controller;
            if (controller == null) return;
            _draft.translateFeatureOnCanvas(
              featureId,
              delta,
              controller.toScreenLocation,
              controller.toLngLat,
              pushUndoBefore: pushUndoBefore,
              onPersist: _schedulePersistWorkingDraft,
            );
          },
          onRotateScaleFeature: (
            featureId,
            rotateDeg,
            scale, {
            baseFeature,
            pivotScreen,
            pushUndoBefore = false,
            persist = true,
          }) {
            final controller = _controller;
            if (controller == null) return;
            _draft.transformFeatureInScreenSpace(
              featureId,
              rotateDeg: rotateDeg,
              scale: scale,
              project: controller.toScreenLocation,
              unproject: controller.toLngLat,
              baseFeature: baseFeature,
              pivotScreen: pivotScreen,
              pushUndoBefore: pushUndoBefore,
              onPersist: persist ? _schedulePersistWorkingDraft : null,
            );
          },
        );
      },
    );
  }

  Widget _buildTopBarScope({required bool isDesktop}) {
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
          child: ListenableBuilder(
            listenable: Listenable.merge([
              _drawerNav,
              _catalog.shelfListenable,
              _catalog.beaconsListenable,
              _draft.geometryListenable,
              _draft.undoRedoListenable,
              _draft.placementListenable,
              _draft.gpsTrackListenable,
              _spaces.badgeListenable,
              _spaces,
              _accountWallet.accountListenable,
              _mapLayers.presentationListenable,
            ]),
            builder: (context, _) {
              final theme = Theme.of(context);
              final visibleBeacons = _catalog.allBeacons;
              final visibleCalloutCount =
                  _mapLayers.lastSnapshot?.visibleCallouts.length ?? 0;
              final brandPill = GestureDetector(
                key: const Key('earthly-brand-pill'),
                onTap: _openEarthlyCommandSheet,
                child: EarthlyGlassSurface(
                  borderRadius: BorderRadius.circular(999),
                  padding: const EdgeInsets.fromLTRB(7, 5, 10, 5),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (!_draft.isDrawingMode) ...[
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
                          style: theme.textTheme.labelMedium?.copyWith(
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1.1,
                          ),
                        ),
                        if (_spaces.relayStreamLive) ...[
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
                              ? '${_catalog.shelfMaps.length} shelf · ${_draft.features.length} draft${visibleBeacons.isNotEmpty ? ' · ${visibleBeacons.length} live' : ''}'
                              : '${_catalog.shelfMaps.length}·${_draft.features.length}${visibleBeacons.isNotEmpty ? '·${visibleBeacons.length}' : ''}',
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
              );

              return Row(
                children: [
                  if (isDesktop)
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 260),
                      child: brandPill,
                    )
                  else
                    Expanded(
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: brandPill,
                      ),
                    ),
                  if (isDesktop && !_draft.isDrawingMode) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            _MiniToggle(
                              label: 'Explore',
                              icon: Icons.explore_outlined,
                              active: _isDrawerOpen(EarthlyDrawer.explore),
                              onTap: () => _toggleDrawer(EarthlyDrawer.explore),
                            ),
                            const SizedBox(width: 6),
                            _MiniToggle(
                              label: _spaces.pendingOutboxCount > 0
                                  ? 'Desk (${_spaces.pendingOutboxCount})'
                                  : 'Desk',
                              icon: Icons.layers_outlined,
                              active: _isDrawerOpen(EarthlyDrawer.desk) ||
                                  _isDrawerOpen(EarthlyDrawer.outbox) ||
                                  _spaces.pendingOutboxCount > 0,
                              onTap: () => _toggleDrawer(EarthlyDrawer.desk),
                            ),
                            const SizedBox(width: 6),
                            _MiniToggle(
                              label: _spaces.pendingClaimCount > 0
                                  ? 'Spaces (${_spaces.pendingClaimCount})'
                                  : 'Spaces',
                              icon: Icons.hub_outlined,
                              active: _isDrawerOpen(EarthlyDrawer.spaces) ||
                                  _spaces.pendingClaimCount > 0,
                              onTap: () => _toggleDrawer(EarthlyDrawer.spaces),
                            ),
                            const SizedBox(width: 6),
                            _MiniToggle(
                              label: _spaces.circlePendingJoins.isNotEmpty
                                  ? 'Circles (${_spaces.circlePendingJoins.length})'
                                  : 'Circles',
                              icon: Icons.lock_outline,
                              active: _isDrawerOpen(EarthlyDrawer.circles) ||
                                  _spaces.activeCircleLensId != null,
                              onTap: () => _toggleDrawer(EarthlyDrawer.circles),
                            ),
                            const SizedBox(width: 6),
                            _MiniToggle(
                              label: _spaces.inboxUnreadCount > 0
                                  ? 'Inbox (${_spaces.inboxUnreadCount})'
                                  : 'Inbox',
                              icon: Icons.inbox_outlined,
                              active: _isDrawerOpen(EarthlyDrawer.inbox) ||
                                  _spaces.inboxUnreadCount > 0,
                              onTap: () {
                                _toggleDrawer(EarthlyDrawer.inbox);
                                if (_isDrawerOpen(EarthlyDrawer.inbox)) {
                                  unawaited(_refreshInbox());
                                }
                              },
                            ),
                            const SizedBox(width: 6),
                            _MiniToggle(
                              label: 'Agent',
                              icon: Icons.auto_awesome,
                              active: _isDrawerOpen(EarthlyDrawer.agent),
                              onTap: () => _toggleDrawer(EarthlyDrawer.agent),
                            ),
                            const SizedBox(width: 6),
                            _MiniToggle(
                              label: 'Draw',
                              icon: Icons.edit,
                              active: true,
                              onTap: () => _draft.selectMode(
                                DrawToolMode.line,
                                onCloseDrawers: _closeAllDrawers,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                  ] else if (isDesktop)
                    const Spacer()
                  else
                    const SizedBox(width: 8),
                  if (isDesktop && _draft.isDrawingMode) ...[
                    _MiniToggle(
                      label: _draft.placementStyle ==
                              TouchPlacementStyle.drawDrag
                          ? 'Draw-Drag'
                          : 'Crosshair',
                      icon: _draft.placementStyle ==
                              TouchPlacementStyle.drawDrag
                          ? Icons.touch_app
                          : Icons.gps_fixed,
                      active: true,
                      onTap: _draft.togglePlacementStyle,
                    ),
                    const SizedBox(width: 6),
                    _MiniToggle(
                      label: 'Loupe',
                      icon: Icons.zoom_in,
                      active: _draft.loupeEnabled,
                      onTap: _draft.toggleLoupeEnabled,
                    ),
                    const SizedBox(width: 6),
                    _MiniToggle(
                      label: 'Snap',
                      icon: Icons.filter_center_focus,
                      active: _draft.snappingEnabled,
                      onTap: _draft.toggleSnapping,
                    ),
                  ] else if (!_draft.isDrawingMode) ...[
                    if (isDesktop && _draft.undoStack.isNotEmpty) ...[
                      _MiniIconButton(
                        tooltip: 'Undo Draft Edit (Cmd+Z)',
                        icon: Icons.undo,
                        active: false,
                        onTap: () => _draft.undoDraftEdit(
                          onRefreshInspectedFeature:
                              _refreshInspectedDraftFeature,
                          onPersist: _schedulePersistWorkingDraft,
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    if (isDesktop && _draft.redoStack.isNotEmpty) ...[
                      _MiniIconButton(
                        tooltip: 'Redo Draft Edit (Cmd+Shift+Z)',
                        icon: Icons.redo,
                        active: false,
                        onTap: () => _draft.redoDraftEdit(
                          onRefreshInspectedFeature:
                              _refreshInspectedDraftFeature,
                          onPersist: _schedulePersistWorkingDraft,
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    if (isDesktop && visibleCalloutCount > 0) ...[
                      _MiniToggle(
                        label: calloutModeShortLabel(_mapLayers.calloutMode),
                        icon: Icons.chat_bubble_outline,
                        active: _mapLayers.calloutMode !=
                            CalloutDisplayMode.hidden,
                        onTap: _mapLayers.cycleCalloutMode,
                      ),
                      const SizedBox(width: 6),
                    ],
                    _MiniIconButton(
                      tooltip: 'Search Place / Coords / naddr',
                      icon: Icons.search,
                      active: _isDrawerOpen(EarthlyDrawer.search),
                      onTap: () => _toggleDrawer(EarthlyDrawer.search),
                    ),
                    if (isDesktop) ...[
                      const SizedBox(width: 6),
                      _MiniIconButton(
                        tooltip: _draft.gpsTrackRecording
                            ? 'Finish GPS Track'
                            : 'Record GPS Track',
                        icon: _draft.gpsTrackRecording
                            ? Icons.stop
                            : Icons.route,
                        active: _draft.gpsTrackRecording,
                        onTap: () => unawaited(
                          _draft.gpsTrackRecording
                              ? _finishGpsTrackToDraft()
                              : _startGpsTrack(),
                        ),
                      ),
                      const SizedBox(width: 6),
                      _MiniIconButton(
                        tooltip: 'Measure Distance & Area',
                        icon: Icons.straighten,
                        active: _draft.isMeasureMode,
                        onTap: () => _draft.toggleMeasureMode(
                          onCloseDrawers: _closeAllDrawers,
                        ),
                      ),
                      const SizedBox(width: 6),
                      ValueListenableBuilder<({double bearing, double pitch})>(
                        valueListenable: _cameraOrientationNotifier,
                        builder: (context, ori, _) {
                          final rotated = ((ori.bearing % 360) + 360) % 360;
                          final isOffNorth = (rotated > 1.0 && rotated < 359.0) ||
                              ori.pitch.abs() > 1.0;
                          return _MiniIconButton(
                            key: const Key('earthly-renorth-btn'),
                            tooltip: _reNorthTooltip(ori),
                            iconWidget: _CompassNorthIcon(
                              bearingDegrees: ori.bearing,
                              size: 18,
                              highlighted: isOffNorth,
                            ),
                            active: isOffNorth,
                            onTap: _reNorthMap,
                          );
                        },
                      ),
                      const SizedBox(width: 6),
                      _MiniIconButton(
                        tooltip: 'Basemap & Overlays',
                        icon: Icons.map_outlined,
                        active: _mapLayers.selectedBasemap ==
                            BasemapKind.offlinePmtiles,
                        onTap: _openBasemapSwitcher,
                      ),
                      const SizedBox(width: 6),
                      _MiniIconButton(
                        key: const Key('earthly-desktop-settings-btn'),
                        tooltip: 'Settings',
                        icon: Icons.settings_outlined,
                        active: _isDrawerOpen(EarthlyDrawer.settings),
                        onTap: () => _toggleDrawer(EarthlyDrawer.settings),
                      ),
                    ],
                    const SizedBox(width: 6),
                    if (isDesktop)
                      _MiniToggle(
                        label: _accountWallet.accountChipLabel,
                        icon: _accountWallet.account != null
                            ? Icons.verified_user
                            : Icons.account_circle_outlined,
                        active: _isDrawerOpen(EarthlyDrawer.account),
                        onTap: () => _toggleDrawer(EarthlyDrawer.account),
                      )
                    else
                      _MiniIconButton(
                        tooltip: _accountWallet.account != null
                            ? 'Account (${_accountWallet.accountChipLabel})'
                            : 'Account & Session',
                        icon: _accountWallet.account != null
                            ? Icons.verified_user
                            : Icons.account_circle_outlined,
                        active: _isDrawerOpen(EarthlyDrawer.account) ||
                            _accountWallet.account != null,
                        onTap: () => _toggleDrawer(EarthlyDrawer.account),
                      ),
                  ],
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildRightThumbRailScope({
    required double screenHeight,
    required double bottomSafeInset,
    required bool isWideStudio,
  }) {
    return ListenableBuilder(
      listenable: Listenable.merge([
        _drawerNav,
        _draft.placementListenable,
        _draft.gpsTrackListenable,
        _mapLayers.presentationListenable,
        _catalog.mapContentListenable,
      ]),
      builder: (context, _) {
        final leftTarget = _drawer != EarthlyDrawer.none
            ? _drawer
            : (!isWideStudio ? _rightStudioDrawer : EarthlyDrawer.none);
        final galleryOpen =
            leftTarget == EarthlyDrawer.explore && _catalog.galleryModeActive;
        final hideBottomDockOnMobile =
            leftTarget != EarthlyDrawer.none && !_draft.isDrawingMode;
        final rightThumbRailBottom = galleryOpen
            ? bottomSafeInset + 226.0
            : hideBottomDockOnMobile
                ? (screenHeight * 0.54).clamp(180.0, screenHeight - 220.0)
                : bottomSafeInset + (_draft.isDrawingMode ? 76.0 : 74.0);
        final hasCallouts =
            (_mapLayers.lastSnapshot?.visibleCallouts.isNotEmpty ?? false);

        return Positioned(
          key: const Key('earthly-right-thumb-rail'),
          right: 12,
          bottom: rightThumbRailBottom,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (_draft.isDrawingMode) ...[
                _ThumbMapButton(
                  tooltip: _draft.placementStyle == TouchPlacementStyle.drawDrag
                      ? 'Draw-Drag'
                      : 'Crosshair',
                  icon: _draft.placementStyle == TouchPlacementStyle.drawDrag
                      ? Icons.touch_app
                      : Icons.gps_fixed,
                  active: true,
                  onTap: _draft.togglePlacementStyle,
                ),
                const SizedBox(height: 8),
                _ThumbMapButton(
                  tooltip: 'Loupe',
                  icon: Icons.zoom_in,
                  active: _draft.loupeEnabled,
                  onTap: _draft.toggleLoupeEnabled,
                ),
                const SizedBox(height: 8),
                _ThumbMapButton(
                  tooltip: 'Snap',
                  icon: Icons.filter_center_focus,
                  active: _draft.snappingEnabled,
                  onTap: _draft.toggleSnapping,
                ),
              ] else ...[
                _ThumbMapButton(
                  tooltip: _draft.gpsTrackRecording
                      ? 'Finish GPS Track'
                      : 'Record GPS Track',
                  icon: _draft.gpsTrackRecording ? Icons.stop : Icons.route,
                  active: _draft.gpsTrackRecording,
                  activeBackground: EarthlyColors.destructive,
                  activeForeground: Colors.white,
                  onTap: () => unawaited(
                    _draft.gpsTrackRecording
                        ? _finishGpsTrackToDraft()
                        : _startGpsTrack(),
                  ),
                ),
                const SizedBox(height: 8),
                _ThumbMapButton(
                  tooltip: 'Measure',
                  icon: Icons.straighten,
                  active: _draft.isMeasureMode,
                  activeBackground: EarthlyColors.measureViolet,
                  activeForeground: Colors.white,
                  onTap: () => _draft.toggleMeasureMode(
                    onCloseDrawers: _closeAllDrawers,
                  ),
                ),
                const SizedBox(height: 8),
                _ThumbMapButton(
                  tooltip: 'Map Style & Overlays',
                  icon: Icons.layers_outlined,
                  active:
                      _mapLayers.selectedBasemap == BasemapKind.offlinePmtiles,
                  onTap: _openBasemapSwitcher,
                ),
                const SizedBox(height: 8),
                _ThumbMapButton(
                  tooltip: switch (_mapLayers.calloutMode) {
                    CalloutDisplayMode.full => 'Callouts: Full',
                    CalloutDisplayMode.compact => 'Callouts: Compact',
                    CalloutDisplayMode.pins => 'Callouts: Pins',
                    CalloutDisplayMode.hidden => 'Callouts: Off',
                  },
                  icon: switch (_mapLayers.calloutMode) {
                    CalloutDisplayMode.full => Icons.chat_bubble_outline,
                    CalloutDisplayMode.compact => Icons.short_text,
                    CalloutDisplayMode.pins => Icons.push_pin_outlined,
                    CalloutDisplayMode.hidden =>
                      Icons.comments_disabled_outlined,
                  },
                  active: _mapLayers.calloutMode != CalloutDisplayMode.hidden &&
                      hasCallouts,
                  badgeDotColor:
                      _mapLayers.calloutMode == CalloutDisplayMode.hidden
                          ? null
                          : EarthlyColors.amber,
                  onTap: _mapLayers.cycleCalloutMode,
                ),
              ],
              const SizedBox(height: 8),
              ValueListenableBuilder<({double bearing, double pitch})>(
                valueListenable: _cameraOrientationNotifier,
                builder: (context, ori, _) {
                  final rotated = ((ori.bearing % 360) + 360) % 360;
                  final isOffNorth = (rotated > 1.0 && rotated < 359.0) ||
                      ori.pitch.abs() > 1.0;
                  return _ThumbMapButton(
                    key: const Key('earthly-renorth-btn'),
                    tooltip: _reNorthTooltip(ori),
                    iconWidget: _CompassNorthIcon(
                      bearingDegrees: ori.bearing,
                      size: 22,
                      highlighted: isOffNorth,
                    ),
                    active: isOffNorth,
                    onTap: _reNorthMap,
                  );
                },
              ),
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
        );
      },
    );
  }

  Widget _buildHudOverlaysScope({
    required bool isDesktop,
    required bool isWideStudio,
    required bool systemIsDark,
    required double bottomSafeInset,
  }) {
    return ListenableBuilder(
      listenable: Listenable.merge([
        _drawerNav,
        _catalog.lensListenable,
        _catalog.overlayListenable,
        _spaces.circleLensListenable,
        _draft.modeListenable,
        _draft.placementListenable,
        _draft.geometryListenable,
        _draft.measureListenable,
        _draft.gpsTrackListenable,
        _agent.ghostListenable,
      ]),
      builder: (context, _) {
        final leftTarget = _drawer != EarthlyDrawer.none
            ? _drawer
            : (!isWideStudio ? _rightStudioDrawer : EarthlyDrawer.none);
        final hasLeft =
            !_draft.isDrawingMode && leftTarget != EarthlyDrawer.none;
        final hasRight = !_draft.isDrawingMode &&
            isWideStudio &&
            _rightStudioDrawer != EarthlyDrawer.none;
        final hudLeftInset = isDesktop && hasLeft ? 440.0 : 12.0;
        final hudRightInset = isWideStudio && hasRight ? 440.0 : 12.0;
        final activeAtlas = _catalog.activeAtlasLens;
        final activeCircle = _spaces.activeCircleLens;
        final pendingAi = _agent.pendingAiEdit;

        return Stack(
          fit: StackFit.expand,
          children: [
            if (activeAtlas != null && !_draft.isDrawingMode)
              Positioned(
                key: const Key('earthly-atlas-lens-bar'),
                top: 62,
                left: hudLeftInset,
                right: hudRightInset,
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
                                  activeAtlas.name,
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
                                  '${activeAtlas.pinnedAddresses.length} pinned · ${activeAtlas.governance} · Atlas Lens',
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
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 8),
                            ),
                            onPressed: () => _inspectAtlas(activeAtlas),
                            child: const Text('About'),
                          ),
                          IconButton(
                            tooltip: 'Leave Atlas Lens',
                            visualDensity: VisualDensity.compact,
                            onPressed: _catalog.leaveAtlasLens,
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
            if (activeCircle != null && !_draft.isDrawingMode)
              Positioned(
                key: const Key('earthly-circle-lens-bar'),
                top: activeAtlas != null ? 114 : 62,
                left: hudLeftInset,
                right: hudRightInset,
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
                          const Icon(Icons.lock, size: 15, color: Colors.white),
                          const SizedBox(width: 8),
                          Flexible(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  activeCircle.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w800,
                                    color: Colors.white,
                                  ),
                                ),
                                Text(
                                  '${activeCircle.datasets.length} maps · ${activeCircle.members.length} members · epoch ${activeCircle.epoch} · MLS',
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
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 8),
                            ),
                            onPressed: () {
                              _spaces
                                  .setSelectedCircleId(activeCircle.workspaceId);
                              _openDrawer(EarthlyDrawer.circles);
                            },
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
            if ((_catalog.activeProposalLabel != null ||
                    _catalog.activeCommentOverlayId != null) &&
                !_draft.isDrawingMode)
              Positioned(
                top: 66,
                left: hudLeftInset,
                right: hudRightInset,
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
                        color: (_catalog.activeProposalLabel != null
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
                            _catalog.activeProposalLabel ??
                                'Comment geometry overlay',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(width: 8),
                          GestureDetector(
                            onTap: _catalog.clearAllMapOverlays,
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
            if (_draft.isMeasureMode)
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
                        color:
                            EarthlyColors.measureViolet.withValues(alpha: 0.95),
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
                            _draft.draftVertices.isEmpty
                                ? 'Drag with 1 finger to place vertices'
                                : _draft.draftVertices.length < 3
                                    ? '${DrawingMath.formatDistance(_draft.measureDistanceMeters)} (${_draft.draftVertices.length} pts)'
                                    : '${DrawingMath.formatDistance(_draft.measureDistanceMeters)} · ${(_draft.measureAreaM2 / 10000).toStringAsFixed(2)} ha',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                          if (_draft.draftVertices.isNotEmpty) ...[
                            const SizedBox(width: 8),
                            GestureDetector(
                              onTap: _draft.clearMeasureVertices,
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
                            onTap: () => _draft.toggleMeasureMode(
                              onCloseDrawers: _closeAllDrawers,
                            ),
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
            if (_draft.isDrawingMode)
              _buildFloatingAuthoringChrome(
                isDesktop: isDesktop,
                systemIsDark: systemIsDark,
                bottomSafeInset: bottomSafeInset,
              ),
            if (pendingAi != null && !_draft.isDrawingMode)
              Positioned(
                key: const Key('earthly-ai-ghost-bar'),
                top: (activeAtlas != null || activeCircle != null) ? 118 : 66,
                left: hudLeftInset,
                right: hudRightInset,
                child: SafeArea(
                  bottom: false,
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: EarthlyGlassSurface(
                      borderRadius: BorderRadius.circular(999),
                      color: EarthlyColors.proposedAmber.withValues(alpha: 0.94),
                      borderColor: EarthlyColors.amber,
                      borderWidth: 1.4,
                      padding: const EdgeInsets.fromLTRB(12, 5, 6, 5),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.auto_awesome,
                            size: 14,
                            color: Colors.white,
                          ),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              'AI Ghost +${pendingAi.diffAdded} ~${pendingAi.diffModified} -${pendingAi.diffRemoved}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: Colors.white,
                              foregroundColor: EarthlyColors.amberInk,
                              visualDensity: VisualDensity.compact,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 4,
                              ),
                              minimumSize: const Size(0, 28),
                            ),
                            onPressed: _acceptPendingAiEdit,
                            child: const Text(
                              'Accept',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          const SizedBox(width: 4),
                          IconButton(
                            tooltip: 'Discard AI Ghost',
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(
                              minWidth: 28,
                              minHeight: 28,
                            ),
                            onPressed: _agent.clearPendingGhost,
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
            if (_draft.gpsTrackRecording)
              Positioned(
                key: const Key('earthly-gps-track-bar'),
                top: (pendingAi != null ? 116 : 66) +
                    ((activeAtlas != null || activeCircle != null) ? 52 : 0),
                left: hudLeftInset,
                right: hudRightInset,
                child: SafeArea(
                  bottom: false,
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: EarthlyGlassSurface(
                      borderRadius: BorderRadius.circular(999),
                      color: EarthlyColors.destructive.withValues(alpha: 0.94),
                      borderColor: Colors.white.withValues(alpha: 0.35),
                      borderWidth: 1.2,
                      padding: const EdgeInsets.fromLTRB(12, 5, 6, 5),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _draft.gpsTrackPaused
                                ? Icons.pause_circle_filled
                                : Icons.fiber_manual_record,
                            size: 13,
                            color: Colors.white,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            '${_draft.gpsTrackPaused ? 'PAUSED' : 'REC'} · ${DrawingMath.formatDistance(_draft.gpsTrackDistanceMeters)} · ${_draft.gpsTrackPoints.length} pts',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(width: 6),
                          IconButton(
                            tooltip: _draft.gpsTrackPaused
                                ? 'Resume GPS Track'
                                : 'Pause GPS Track',
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(
                              minWidth: 28,
                              minHeight: 28,
                            ),
                            onPressed: () =>
                                unawaited(_draft.togglePauseGpsTrack()),
                            icon: Icon(
                              _draft.gpsTrackPaused
                                  ? Icons.play_arrow
                                  : Icons.pause,
                              size: 16,
                              color: Colors.white,
                            ),
                          ),
                          TextButton(
                            style: TextButton.styleFrom(
                              foregroundColor: Colors.white,
                              visualDensity: VisualDensity.compact,
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 6),
                              minimumSize: const Size(0, 28),
                            ),
                            onPressed: () => unawaited(
                              _draft.addTrackWaypointNow(
                                fallbackCenter: _controller?.camera?.center,
                              ),
                            ),
                            child: const Text(
                              '+Pt',
                              style: TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: Colors.white,
                              foregroundColor: EarthlyColors.destructive,
                              visualDensity: VisualDensity.compact,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 4,
                              ),
                              minimumSize: const Size(0, 28),
                            ),
                            onPressed: () => unawaited(_finishGpsTrackToDraft()),
                            child: const Text(
                              'Save',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Discard GPS Track',
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(
                              minWidth: 28,
                              minHeight: 28,
                            ),
                            onPressed: () =>
                                unawaited(_draft.cancelGpsTrack()),
                            icon: const Icon(
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
          ],
        );
      },
    );
  }

  Widget _buildFloatingAuthoringChrome({
    required bool isDesktop,
    required bool systemIsDark,
    required double bottomSafeInset,
  }) {
    final showSelectionBar = _draft.selectedDraftFeatureIds.isNotEmpty &&
        _draft.draftVertices.isEmpty;
    final showShapeChips = _draft.mode == DrawToolMode.shape;
    final showDeleteVertexPill = _draft.mode == DrawToolMode.editVertices &&
        _draft.selectedVertexIndex != null;
    final showHintPill =
        !showSelectionBar && !showShapeChips && !showDeleteVertexPill;

    return Positioned(
      left: 12,
      right: isDesktop ? 12 : 68,
      bottom: 80 + bottomSafeInset,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showDeleteVertexPill)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: EarthlyGlassSurface(
                borderRadius: BorderRadius.circular(999),
                color: EarthlyColors.darkSurface.withValues(alpha: 0.92),
                borderColor: EarthlyColors.infoCyanBright.withValues(alpha: 0.6),
                padding: const EdgeInsets.fromLTRB(10, 4, 6, 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Pt ${_draft.selectedVertexIndex! + 1}',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        color: EarthlyColors.infoCyanBright,
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.icon(
                      key: const Key('mobile-drawing-delete-vertex-btn'),
                      style: FilledButton.styleFrom(
                        backgroundColor: EarthlyColors.destructive,
                        foregroundColor: Colors.white,
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 4,
                        ),
                        minimumSize: const Size(0, 28),
                      ),
                      onPressed: () {
                        final removed = _draft.removeSelectedEditingVertex(
                          onPersist: _schedulePersistWorkingDraft,
                        );
                        if (!removed) {
                          _showWarningToast(
                            'Minimum vertices required for this geometry',
                          );
                        }
                      },
                      icon: const Icon(Icons.delete_outline, size: 14),
                      label: const Text(
                        'Delete Vertex',
                        style: TextStyle(fontSize: 11.5),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (showShapeChips)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: EarthlyGlassSurface(
                key: const Key('mobile-drawing-shape-bar'),
                borderRadius: BorderRadius.circular(14),
                color: (systemIsDark
                        ? EarthlyColors.darkSurface
                        : EarthlyColors.lightSurface)
                    .withValues(alpha: 0.92),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final shape in mobilePrimitiveShapes)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: ChoiceChip(
                            key: Key('mobile-shape-chip-${shape.kind.name}'),
                            avatar: Icon(shape.icon, size: 15),
                            label: Text(shape.label),
                            selected:
                                _draft.activePrimitiveShape == shape.kind,
                            onSelected: (_) =>
                                _draft.setActivePrimitiveShape(shape.kind),
                          ),
                        ),
                      ActionChip(
                        key: const Key('mobile-shape-drop-center'),
                        avatar: const Icon(Icons.add_circle_outline, size: 15),
                        label: const Text('Drop at Center'),
                        onPressed: () => unawaited(
                          _addPrimitiveShapeUi(
                            _draft.activePrimitiveShape.name,
                            100.0,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          if (showSelectionBar)
            EarthlyGlassSurface(
              key: const Key('mobile-drawing-selection-bar'),
              borderRadius: BorderRadius.circular(14),
              color: EarthlyColors.darkSurface.withValues(alpha: 0.92),
              borderColor: EarthlyColors.amber.withValues(alpha: 0.55),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    EarthlyBadge(
                      label: '${_draft.selectedDraftFeatureIds.length} selected',
                      color: EarthlyColors.amber,
                      filled: false,
                    ),
                    const SizedBox(width: 6),
                    _SelectionBarAction(
                      label: 'Vertices',
                      icon: Icons.edit_location_alt_outlined,
                      onTap: _editVerticesPrimarySelectedDraftFeature,
                    ),
                    _SelectionBarAction(
                      label: 'Style',
                      icon: Icons.tune,
                      onTap: _inspectPrimarySelectedDraftFeature,
                    ),
                    _SelectionBarAction(
                      label: 'Rotate +15°',
                      icon: Icons.rotate_right,
                      onTap: () => unawaited(
                        _runGeoActionUi(
                          RustGeoAction.rotateSelected,
                          angleDeg: 15,
                        ),
                      ),
                    ),
                    _SelectionBarAction(
                      label: 'Duplicate',
                      icon: Icons.control_point_duplicate,
                      onTap: () => unawaited(
                        _duplicateDraftFeaturesUi(
                          _draft.selectedDraftFeatureIds.toList(),
                        ),
                      ),
                    ),
                    _SelectionBarAction(
                      label: 'Ops',
                      icon: Icons.build_outlined,
                      onTap: _openMobileDrawingToolsSheet,
                    ),
                    _SelectionBarAction(
                      label: 'Delete',
                      icon: Icons.delete_outline,
                      color: EarthlyColors.destructive,
                      onTap: _deleteSelectedDraftFeatures,
                    ),
                    IconButton(
                      tooltip: 'Clear selection',
                      visualDensity: VisualDensity.compact,
                      constraints: const BoxConstraints(
                        minWidth: 28,
                        minHeight: 28,
                      ),
                      padding: EdgeInsets.zero,
                      onPressed: _draft.clearSelection,
                      icon: const Icon(
                        Icons.close,
                        size: 16,
                        color: EarthlyColors.darkInk,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (showHintPill)
            EarthlyGlassSurface(
              borderRadius: BorderRadius.circular(999),
              color: EarthlyColors.darkSurface.withValues(alpha: 0.88),
              borderColor: Colors.white.withValues(alpha: 0.14),
              padding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 7,
              ),
              child: Text(
                _draft.placementStyle == TouchPlacementStyle.drawDrag
                    ? '1 finger: place & drag · 2 fingers: pan/zoom · 2-finger tap: undo'
                    : 'Pan map under reticle · tap Drop to place',
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10.5,
                  color: EarthlyColors.darkInk,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildLeftDrawerScope({required bool isWideStudio}) {
    return ListenableBuilder(
      listenable: Listenable.merge([_drawerNav, _draft.modeListenable]),
      builder: (context, _) {
        final leftTarget = _drawer != EarthlyDrawer.none
            ? _drawer
            : (!isWideStudio ? _rightStudioDrawer : EarthlyDrawer.none);
        if (leftTarget == EarthlyDrawer.none) return const SizedBox.shrink();
        if (_draft.isDrawingMode && !_isDrawerAllowedInDrawingMode(leftTarget)) {
          return const SizedBox.shrink();
        }
        return _buildScopedDrawerSlot(leftTarget);
      },
    );
  }

  Widget _buildRightDrawerScope() {
    return ListenableBuilder(
      listenable: Listenable.merge([_drawerNav, _draft.modeListenable]),
      builder: (context, _) {
        if (_rightStudioDrawer == EarthlyDrawer.none) {
          return const SizedBox.shrink();
        }
        if (_draft.isDrawingMode &&
            !_isDrawerAllowedInDrawingMode(_rightStudioDrawer)) {
          return const SizedBox.shrink();
        }
        return EarthlyDrawerPlacement(
          side: EarthlyDrawerSide.right,
          child: _buildScopedDrawerSlot(_rightStudioDrawer),
        );
      },
    );
  }

  /// Modular drawing-mode toolbar slot so `@drawing-ux-desk`'s `MobileDrawingBar`
  /// can be dropped in cleanly without touching `_buildBottomDockScope`.
  Widget _buildDrawingModeBottomBar(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => Row(
        children: [
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final tool in mobileAuthoringTools)
                    Padding(
                      padding: const EdgeInsets.only(right: 2),
                      child: _DockTool(
                        key: Key('mobile-draw-tool-${tool.mode.name}'),
                        label: tool.label,
                        icon: tool.icon,
                        selected: _draft.mode == tool.mode,
                        minWidth: 46,
                        onTap: () => _selectAuthoringTool(tool.mode),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 6),
          ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: (constraints.maxWidth * 0.78).clamp(200.0, 460.0),
            ),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerRight,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_draft.placementStyle == TouchPlacementStyle.crosshair &&
                      _draft.mode != DrawToolMode.select &&
                      _draft.mode != DrawToolMode.editVertices &&
                      _draft.mode != DrawToolMode.boxSelect &&
                      _draft.mode != DrawToolMode.freehand &&
                      _draft.mode != DrawToolMode.shape) ...[
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 6,
                        ),
                        minimumSize: const Size(0, 32),
                        textStyle: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      onPressed: () {
                        final center = _controller?.camera?.center;
                        if (_draft.mode == DrawToolMode.annotation) {
                          if (center != null) {
                            unawaited(_promptDropMapLabel(center));
                          }
                          return;
                        }
                        _draft.dropCrosshairPoint(
                          center,
                          onPersist: _schedulePersistWorkingDraft,
                        );
                      },
                      icon: const Icon(Icons.add_location_alt, size: 14),
                      label: const Text('Drop'),
                    ),
                    const SizedBox(width: 4),
                  ],
                  if (_draft.canFinishDraft) ...[
                    FilledButton(
                      style: FilledButton.styleFrom(
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 6,
                        ),
                        minimumSize: const Size(0, 32),
                        textStyle: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      onPressed: () => unawaited(_finishActiveStroke()),
                      child: Text(
                        _draft.mode == DrawToolMode.splitByLine
                            ? 'Cut · ${_draft.draftVertices.length}'
                            : _draft.editingDraftFeature != null
                                ? 'Save · ${_draft.draftVertices.length}'
                                : 'Finish · ${_draft.draftVertices.length}',
                      ),
                    ),
                    const SizedBox(width: 4),
                  ],
                  if (_draft.draftVertices.isNotEmpty)
                    Tooltip(
                      message: 'Undo',
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 7,
                            vertical: 6,
                          ),
                          minimumSize: const Size(0, 32),
                          textStyle: const TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        onPressed: _undoInDrawingMode,
                        icon: const Icon(Icons.undo, size: 14),
                        label: const Text('Undo pt'),
                      ),
                    )
                  else
                    IconButton(
                      tooltip: 'Undo',
                      visualDensity: VisualDensity.compact,
                      constraints: const BoxConstraints(
                        minWidth: 32,
                        minHeight: 32,
                      ),
                      padding: EdgeInsets.zero,
                      onPressed: (_draft.undoStack.isNotEmpty ||
                              _draft.features.isNotEmpty)
                          ? _undoInDrawingMode
                          : null,
                      icon: const Icon(Icons.undo, size: 19),
                    ),
                  IconButton(
                    key: const Key('mobile-drawing-more-tools'),
                    tooltip: 'More tools',
                    visualDensity: VisualDensity.compact,
                    constraints: const BoxConstraints(
                      minWidth: 32,
                      minHeight: 32,
                    ),
                    padding: EdgeInsets.zero,
                    onPressed: _openMobileDrawingToolsSheet,
                    icon: const Icon(Icons.more_horiz, size: 20),
                  ),
                  const SizedBox(width: 2),
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 6,
                      ),
                      minimumSize: const Size(0, 32),
                      textStyle: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    onPressed: _draft.cancelEditingDraftFeature,
                    child: Text(
                      (_draft.editingDraftFeature != null ||
                              _draft.draftVertices.isNotEmpty)
                          ? 'Cancel'
                          : 'Done',
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomDockScope({
    required bool isDesktop,
    required bool isWideStudio,
    required bool systemIsDark,
  }) {
    return ListenableBuilder(
      listenable: Listenable.merge([
        _drawerNav,
        _draft.modeListenable,
        _draft.placementListenable,
        _draft.geometryListenable,
        _draft.undoRedoListenable,
        _spaces.badgeListenable,
      ]),
      builder: (context, _) {
        final leftTarget = _drawer != EarthlyDrawer.none
            ? _drawer
            : (!isWideStudio ? _rightStudioDrawer : EarthlyDrawer.none);
        final hideBottomDockOnMobile = !isDesktop &&
            leftTarget != EarthlyDrawer.none &&
            !_draft.isDrawingMode;
        if (hideBottomDockOnMobile || (isDesktop && !_draft.isDrawingMode)) {
          return const SizedBox.shrink();
        }
        final theme = Theme.of(context);
        final totalBadge = _spaces.totalSpacesBadgeCount;

        return Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: ClipRect(
            child: BackdropFilter(
              filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
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
                    child: _draft.isDrawingMode
                        ? _buildDrawingModeBottomBar(context)
                        : Row(
                            children: [
                              Expanded(
                                child: _DockTool(
                                  label: 'Explore',
                                  icon: Icons.explore_outlined,
                                  selected:
                                      _isDrawerOpen(EarthlyDrawer.explore),
                                  onTap: () =>
                                      _toggleDrawer(EarthlyDrawer.explore),
                                ),
                              ),
                              Expanded(
                                child: _DockTool(
                                  label: 'Desk',
                                  icon: Icons.layers_outlined,
                                  selected: _isDrawerOpen(EarthlyDrawer.desk),
                                  onTap: () =>
                                      _toggleDrawer(EarthlyDrawer.desk),
                                ),
                              ),
                              Expanded(
                                child: _DockTool(
                                  label: totalBadge > 0
                                      ? 'Spaces ($totalBadge)'
                                      : 'Spaces',
                                  icon: Icons.hub_outlined,
                                  selected:
                                      _isDrawerOpen(EarthlyDrawer.spaces) ||
                                          _isDrawerOpen(EarthlyDrawer.circles) ||
                                          _isDrawerOpen(EarthlyDrawer.inbox) ||
                                          _isDrawerOpen(EarthlyDrawer.outbox) ||
                                          totalBadge > 0,
                                  onTap: () =>
                                      _toggleDrawer(EarthlyDrawer.spaces),
                                ),
                              ),
                              Expanded(
                                child: _DockTool(
                                  label: 'Agent',
                                  icon: Icons.auto_awesome,
                                  selected: _isDrawerOpen(EarthlyDrawer.agent),
                                  onTap: () =>
                                      _toggleDrawer(EarthlyDrawer.agent),
                                ),
                              ),
                              const SizedBox(width: 4),
                              Container(
                                decoration: BoxDecoration(
                                  color: theme
                                      .colorScheme.surfaceContainerHighest,
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
                                onPressed: () => _draft.selectMode(
                                  DrawToolMode.line,
                                  onCloseDrawers: _closeAllDrawers,
                                ),
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
        );
      },
    );
  }
}

/// Strictly uniform 46×46 icon-only frosted-glass squircle button for the
/// right-thumb map controls rail on phones (zero text labels -> identical sizing!).
class _ThumbMapButton extends StatelessWidget {
  const _ThumbMapButton({
    required this.tooltip,
    this.icon,
    this.iconWidget,
    required this.active,
    required this.onTap,
    this.activeBackground,
    this.activeForeground,
    this.badgeDotColor,
    super.key,
  }) : assert(icon != null || iconWidget != null);

  final String tooltip;
  final IconData? icon;
  final Widget? iconWidget;
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
              blurRadius: 14,
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
                  iconWidget ?? Icon(icon, size: 20, color: fg),
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
    this.icon,
    this.iconWidget,
    required this.active,
    required this.onTap,
    super.key,
  }) : assert(icon != null || iconWidget != null);

  final String tooltip;
  final IconData? icon;
  final Widget? iconWidget;
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
                child: iconWidget ??
                    Icon(
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

/// Crisp icon-only compass needle (zero `Text` descendants) that rotates live
/// against the map's bearing so tapping it intuitively snaps the map back to
/// true north (bearing 0°, pitch 0°).
class _CompassNorthIcon extends StatelessWidget {
  const _CompassNorthIcon({
    required this.bearingDegrees,
    this.size = 22,
    this.highlighted = false,
  });

  final double bearingDegrees;
  final double size;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final northColor = highlighted
        ? const Color(0xFFB91C1C)
        : const Color(0xFFDC2626);
    final southColor = highlighted
        ? EarthlyColors.amberInk.withValues(alpha: 0.78)
        : theme.colorScheme.onSurface.withValues(alpha: 0.55);
    final ringColor = highlighted
        ? EarthlyColors.amberInk.withValues(alpha: 0.45)
        : theme.colorScheme.onSurface.withValues(alpha: 0.28);

    return Transform.rotate(
      angle: -bearingDegrees * math.pi / 180.0,
      child: CustomPaint(
        size: Size.square(size),
        painter: _CompassNorthPainter(
          northColor: northColor,
          southColor: southColor,
          ringColor: ringColor,
        ),
      ),
    );
  }
}

class _CompassNorthPainter extends CustomPainter {
  const _CompassNorthPainter({
    required this.northColor,
    required this.southColor,
    required this.ringColor,
  });

  final Color northColor;
  final Color southColor;
  final Color ringColor;

  @override
  void paint(Canvas canvas, Size size) {
    final cx = size.width / 2;
    final cy = size.height / 2;
    final r = size.shortestSide / 2;

    // Subtle compass bezel ring
    canvas.drawCircle(
      Offset(cx, cy),
      r - 1.0,
      Paint()
        ..color = ringColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.35,
    );

    // Red north arrowhead
    final northPath = Path()
      ..moveTo(cx, cy - r * 0.72)
      ..lineTo(cx + r * 0.28, cy)
      ..lineTo(cx - r * 0.28, cy)
      ..close();
    canvas.drawPath(northPath, Paint()..color = northColor);

    // Muted south pointer
    final southPath = Path()
      ..moveTo(cx, cy + r * 0.72)
      ..lineTo(cx + r * 0.28, cy)
      ..lineTo(cx - r * 0.28, cy)
      ..close();
    canvas.drawPath(southPath, Paint()..color = southColor);

    // Center pivot dot
    canvas.drawCircle(
      Offset(cx, cy),
      r * 0.13,
      Paint()..color = Colors.white,
    );
  }

  @override
  bool shouldRepaint(covariant _CompassNorthPainter oldDelegate) =>
      northColor != oldDelegate.northColor ||
      southColor != oldDelegate.southColor ||
      ringColor != oldDelegate.ringColor;
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
    this.minWidth,
    super.key,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;
  final double? minWidth;

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
          constraints:
              minWidth != null ? BoxConstraints(minWidth: minWidth!) : null,
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

class _SelectionBarAction extends StatelessWidget {
  const _SelectionBarAction({
    required this.label,
    required this.icon,
    required this.onTap,
    this.color,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final fg = color ?? EarthlyColors.darkInk;
    return Padding(
      padding: const EdgeInsets.only(right: 4),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(9),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(9),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 14, color: fg),
                const SizedBox(width: 4),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 11.5,
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

class _DropMapLabelDialog extends StatefulWidget {
  const _DropMapLabelDialog({required this.point});

  final Geographic point;

  @override
  State<_DropMapLabelDialog> createState() => _DropMapLabelDialogState();
}

class _DropMapLabelDialogState extends State<_DropMapLabelDialog> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    Navigator.of(context).pop(_controller.text);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AlertDialog(
      title: const Text('Drop Map Label'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${widget.point.lat.toStringAsFixed(5)}, ${widget.point.lon.toStringAsFixed(5)}',
            style: theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
          ),
          const SizedBox(height: 10),
          TextField(
            key: const Key('drop-map-label-field'),
            controller: _controller,
            autofocus: true,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _submit(),
            decoration: const InputDecoration(
              labelText: 'Label text',
              hintText: 'e.g. North Gate, Trailhead…',
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('drop-map-label-confirm'),
          onPressed: _submit,
          child: const Text('Drop Label'),
        ),
      ],
    );
  }
}
