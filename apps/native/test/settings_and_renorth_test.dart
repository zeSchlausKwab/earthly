import 'dart:math' as math;
import 'dart:typed_data';

import 'package:earthly_native/controllers/account_wallet_controller.dart';
import 'package:earthly_native/controllers/agent_controller.dart';
import 'package:earthly_native/controllers/catalog_shelf_controller.dart';
import 'package:earthly_native/controllers/draft_workbench_controller.dart';
import 'package:earthly_native/controllers/map_layer_cache.dart';
import 'package:earthly_native/controllers/spaces_sync_controller.dart';
import 'package:earthly_native/main.dart';
import 'package:earthly_native/nostr/basemap_config.dart';
import 'package:earthly_native/nostr/callout_overlay.dart';
import 'package:earthly_native/nostr/shelf_renderer.dart';
import 'package:earthly_native/shell/agent_drawer.dart';
import 'package:earthly_native/shell/settings_sheet.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:earthly_native/theme/earthly_theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

void _setViewport(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

Widget _wrapHome({
  MapLayerCache? mapLayerCache,
  AgentController? agentController,
  DraftWorkbenchController? draftController,
  AccountWalletController? accountController,
  CatalogShelfController? catalogController,
  SpacesSyncController? spacesController,
  ValueNotifier<({double bearing, double pitch})>? cameraOrientationNotifier,
  VoidCallback? onReNorthRequested,
  ThemeMode themeMode = ThemeMode.light,
  ValueChanged<ThemeMode>? onThemeModeChanged,
}) {
  return MaterialApp(
    theme: buildEarthlyTheme(Brightness.light),
    darkTheme: buildEarthlyTheme(Brightness.dark),
    themeMode: themeMode,
    home: EarthlySpikeHome(
      mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
          const ColoredBox(color: Color(0xFFEDF0EA)),
      mapLayerCache: mapLayerCache,
      agentController: agentController,
      draftController: draftController,
      accountController: accountController,
      catalogController: catalogController,
      spacesController: spacesController,
      cameraOrientationNotifier: cameraOrientationNotifier,
      onReNorthRequested: onReNorthRequested,
      themeMode: themeMode,
      onThemeModeChanged: onThemeModeChanged,
    ),
  );
}

void main() {
  group('Re-North compass control', () {
    testWidgets(
      'Mobile thumb rail includes uniform 46x46 icon-only Re-North button that rotates and resets orientation',
      (WidgetTester tester) async {
        _setViewport(tester, const Size(412, 915));
        final orientation = ValueNotifier<({double bearing, double pitch})>(
          (bearing: 42.0, pitch: 18.0),
        );
        addTearDown(orientation.dispose);
        var reNorthCalls = 0;

        await tester.pumpWidget(
          _wrapHome(
            cameraOrientationNotifier: orientation,
            onReNorthRequested: () => reNorthCalls += 1,
          ),
        );
        await tester.pump();

        final railFinder = find.byKey(const Key('earthly-right-thumb-rail'));
        final reNorthBtn = find.byKey(const Key('earthly-renorth-btn'));
        expect(railFinder, findsOneWidget);
        expect(
          find.descendant(of: railFinder, matching: reNorthBtn),
          findsOneWidget,
        );
        // Zero Text widgets inside the entire thumb rail
        expect(
          find.descendant(of: railFinder, matching: find.byType(Text)),
          findsNothing,
        );
        // Exact uniform 46x46 sizing
        expect(tester.getSize(reNorthBtn), const Size(46.0, 46.0));
        expect(find.byTooltip('Re-north map (42°)'), findsOneWidget);

        // Compass needle rotates counter to map bearing (-42 deg)
        final transform = tester.widget<Transform>(
          find.descendant(of: reNorthBtn, matching: find.byType(Transform)),
        );
        final expectedAngle = -42.0 * math.pi / 180.0;
        expect(transform.transform.entry(0, 0), closeTo(math.cos(expectedAngle), 1e-4));

        // Tap Re-North -> resets bearing & pitch to 0 and triggers callback
        await tester.tap(reNorthBtn);
        await tester.pump();

        expect(reNorthCalls, 1);
        expect(orientation.value.bearing, 0.0);
        expect(orientation.value.pitch, 0.0);
        expect(find.byTooltip('Re-north map'), findsOneWidget);
      },
    );

    testWidgets(
      'Desktop top bar exposes compact Re-North and Settings buttons',
      (WidgetTester tester) async {
        _setViewport(tester, const Size(1440, 900));
        final orientation = ValueNotifier<({double bearing, double pitch})>(
          (bearing: 90.0, pitch: 0.0),
        );
        addTearDown(orientation.dispose);

        await tester.pumpWidget(
          _wrapHome(cameraOrientationNotifier: orientation),
        );
        await tester.pump();

        expect(find.byKey(const Key('earthly-renorth-btn')), findsOneWidget);
        expect(
          find.byKey(const Key('earthly-desktop-settings-btn')),
          findsOneWidget,
        );

        await tester.tap(find.byKey(const Key('earthly-renorth-btn')));
        await tester.pump();
        expect(orientation.value.bearing, 0.0);

        await tester.tap(find.byKey(const Key('earthly-desktop-settings-btn')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('earthly-settings-drawer')), findsOneWidget);
      },
    );
  });

  group('Earthly pill menu & multi-tab General Settings', () {
    testWidgets(
      'Cleaned-up pill menu leads to Settings drawer and direct section jumps',
      (WidgetTester tester) async {
        _setViewport(tester, const Size(412, 915));

        await tester.pumpWidget(_wrapHome());
        await tester.pump();

        // Tap Earthly brand pill
        await tester.tap(find.byKey(const Key('earthly-brand-pill')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('earthly-pill-settings-btn')), findsOneWidget);
        expect(find.byKey(const Key('earthly-pill-jump-map')), findsOneWidget);
        expect(find.byKey(const Key('earthly-pill-jump-relays')), findsOneWidget);
        expect(find.byKey(const Key('earthly-pill-jump-chat')), findsOneWidget);
        expect(find.byKey(const Key('earthly-pill-jump-account')), findsOneWidget);
        // Old cluttered basemap wall & raw Rust Node button removed from top pill menu
        expect(find.text('APPEARANCE & MAP STYLE'), findsNothing);
        expect(find.text('Rust Node & Outbox'), findsNothing);

        // Quick-jump directly to Chat AI tab
        await tester.tap(find.byKey(const Key('earthly-pill-jump-chat')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('earthly-settings-drawer')), findsOneWidget);
        expect(find.byKey(const Key('settings-chat-apikey-field')), findsOneWidget);
      },
    );

    testWidgets(
      'Settings tabs control Map clustering, Relays/Blossom/Cordn, Chat credentials, Account Cashu opt-in, and System defaults',
      (WidgetTester tester) async {
        _setViewport(tester, const Size(1440, 900));

        final mapLayers = MapLayerCache();
        final agent = AgentController();
        final draft = DraftWorkbenchController();
        final account = AccountWalletController();
        final catalog = CatalogShelfController();
        final spaces = SpacesSyncController();
        addTearDown(() {
          mapLayers.dispose();
          agent.dispose();
          draft.dispose();
          account.dispose();
          catalog.dispose();
          spaces.dispose();
        });

        await tester.pumpWidget(
          _wrapHome(
            mapLayerCache: mapLayers,
            agentController: agent,
            draftController: draft,
            accountController: account,
            catalogController: catalog,
            spacesController: spaces,
          ),
        );
        await tester.pump();

        // Open Settings via desktop gear button
        await tester.tap(find.byKey(const Key('earthly-desktop-settings-btn')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('earthly-settings-drawer')), findsOneWidget);

        // --- TAB 1: MAP (Basemap + Point Clustering) ---
        expect(mapLayers.pointClusteringEnabled, isTrue);
        final darkBasemapChip =
            find.byKey(const Key('settings-basemap-openFreeMapDark'));
        await tester.ensureVisible(darkBasemapChip);
        await tester.tap(darkBasemapChip);
        await tester.pump();
        expect(mapLayers.selectedBasemap, BasemapKind.openFreeMapDark);

        final clusterSwitch =
            find.byKey(const Key('settings-point-clustering-switch'));
        await tester.scrollUntilVisible(
          clusterSwitch,
          120,
          scrollable: find.descendant(
            of: find.byKey(const Key('earthly-settings-drawer')),
            matching: find.byType(Scrollable),
          ).first,
        );
        expect(find.byKey(const Key('settings-cluster-radius-slider')), findsOneWidget);
        expect(find.byKey(const Key('settings-cluster-max-zoom-slider')), findsOneWidget);
        await tester.tap(clusterSwitch);
        await tester.pump();
        expect(mapLayers.pointClusteringEnabled, isFalse);

        // --- TAB 2: RELAYS (Relays + Blossom + Cordn) ---
        await tester.tap(find.byKey(const Key('settings-tab-relays')));
        await tester.pumpAndSettle();

        await tester.enterText(
          find.byKey(const Key('settings-add-relay-field')),
          'wss://relay.damus.io',
        );
        await tester.tap(find.byKey(const Key('settings-add-relay-btn')));
        await tester.pump();
        expect(catalog.relayUrls, contains('wss://relay.damus.io'));

        final blossomField = find.byKey(const Key('settings-blossom-url-field'));
        await tester.ensureVisible(blossomField);
        await tester.enterText(blossomField, 'https://blossom.primal.net');
        await tester.tap(find.byKey(const Key('settings-blossom-save-btn')));
        await tester.pump();
        expect(catalog.blossomServerUrl, 'https://blossom.primal.net');

        // --- TAB 3: CHAT (AI Provider & Credentials) ---
        await tester.tap(find.byKey(const Key('settings-tab-chat')));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('settings-chat-preset-openrouter')));
        await tester.pump();
        await tester.enterText(
          find.byKey(const Key('settings-chat-apikey-field')),
          'sk-or-v1-settings-test-key',
        );
        final applyBtn = find.byKey(const Key('settings-chat-apply-btn'));
        await tester.ensureVisible(applyBtn);
        await tester.tap(applyBtn);
        await tester.pump();
        expect(agent.settings.presetName, 'OpenRouter');
        expect(agent.settings.apiKey, 'sk-or-v1-settings-test-key');

        // --- TAB 4: ACCOUNT (Cashu NIP-60 opt-in) ---
        await tester.tap(find.byKey(const Key('settings-tab-account')));
        await tester.pumpAndSettle();

        expect(account.nip60WalletEnabled, isFalse);
        final cashuSwitch = find.byKey(const Key('settings-cashu-wallet-switch'));
        await tester.ensureVisible(cashuSwitch);
        await tester.tap(cashuSwitch);
        await tester.pump();
        expect(account.nip60WalletEnabled, isTrue);

        // --- TAB 5: SYSTEM (Drawing defaults) ---
        await tester.tap(find.byKey(const Key('settings-tab-system')));
        await tester.pumpAndSettle();

        expect(draft.loupeEnabled, isTrue);
        final loupeTile = find.text('Precision Magnifier Loupe');
        await tester.ensureVisible(loupeTile);
        await tester.tap(loupeTile);
        await tester.pump();
        expect(draft.loupeEnabled, isFalse);
      },
    );

    testWidgets(
      'SettingsSheet Relays tab probes live quality/NIP-11 badges and discovers/adds NIP-66 relays in 1 tap on narrow phone',
      (WidgetTester tester) async {
        _setViewport(tester, const Size(384, 854));

        var relays = <String>[
          'wss://relay.earthly.city',
          'wss://relay.damus.io',
        ];
        var publicEnabled = true;

        Widget buildSheet() => MaterialApp(
              theme: buildEarthlyTheme(Brightness.light),
              home: Scaffold(
                body: Stack(
                  children: [
                    StatefulBuilder(
                      builder: (context, setModalState) => SettingsSheet(
                        initialTab: EarthlySettingsTab.relays,
                        themeMode: ThemeMode.light,
                        onThemeModeChanged: (_) {},
                        activeBasemap: BasemapKind.openFreeMapLiberty,
                        offlineBasemap: null,
                        onSelectBasemap: (_) {},
                        onLoadedOfflinePmtiles: (_) {},
                        backgroundMode: MapBackgroundMode.osm,
                        satelliteOpacity: 0.75,
                        onBackgroundModeChanged: (_) {},
                        onSatelliteOpacityChanged: (_) {},
                        pointClusteringEnabled: true,
                        pointClusterRadius: 50,
                        pointClusterMaxZoom: 14,
                        onPointClusteringChanged: (_) {},
                        onPointClusterRadiusChanged: (_) {},
                        onPointClusterMaxZoomChanged: (_) {},
                        showLabels: true,
                        onToggleLabels: (_) {},
                        calloutMode: CalloutDisplayMode.compact,
                        onChangeCalloutMode: (_) {},
                        relayUrls: relays,
                        relayStreamLive: true,
                        publicRelaysEnabled: publicEnabled,
                        onSetPublicRelaysEnabled: (enabled) async {
                          setModalState(() => publicEnabled = enabled);
                        },
                        onRelayUrlsChanged: (next) {
                          setModalState(() => relays = next);
                        },
                        onLoadRelayManagerSnapshot: (urls) async =>
                            RelayManagerSnapshotDto(
                          publicRelaysEnabled: publicEnabled,
                          primaryEarthlyRelay: 'wss://relay.earthly.city',
                          defaultPublicRelays: const [
                            'wss://relay.damus.io',
                            'wss://nos.lol',
                            'wss://relay.primal.net',
                          ],
                          profileDiscoveryRelays: const ['wss://purplepag.es'],
                          configuredRelays: [
                            const ManagedRelayStatusDto(
                              url: 'wss://relay.earthly.city',
                              read: true,
                              write: true,
                              source: 'earthly',
                              connected: true,
                            ),
                            const ManagedRelayStatusDto(
                              url: 'wss://relay.damus.io',
                              read: true,
                              write: false,
                              source: 'nip65',
                              connected: true,
                            ),
                          ],
                          nip65Relays: const [
                            RelayListEntryDto(
                              url: 'wss://relay.damus.io',
                              read: true,
                              write: false,
                            ),
                          ],
                        ),
                        onProbeRelaysQuality: (urls) async => [
                          RelayQualityReportDto(
                            url: 'wss://relay.earthly.city',
                            reachable: true,
                            rttMs: 42,
                            status: 'healthy',
                            qualityScore: 98,
                            authRequired: false,
                            paymentRequired: false,
                            nip11: RelayNip11InfoDto(
                              name: 'Earthly City Relay',
                              software: 'khatru',
                              version: '0.9.1',
                              supportedNips: Uint32List.fromList([1, 11, 33, 50]),
                              authRequired: false,
                              paymentRequired: false,
                              restrictedWrites: false,
                            ),
                            probedAt: BigInt.from(1750000000),
                          ),
                          RelayQualityReportDto(
                            url: 'wss://relay.damus.io',
                            reachable: true,
                            rttMs: 920,
                            status: 'slow',
                            qualityScore: 52,
                            authRequired: false,
                            paymentRequired: false,
                            probedAt: BigInt.from(1750000000),
                          ),
                        ],
                        onDiscoverNip66Relays: () async => [
                          Nip66RelayCandidateDto(
                            url: 'wss://relay.primal.net',
                            network: 'clearnet',
                            rttOpenMs: 55,
                            supportedNips: Uint32List.fromList([1, 11, 50]),
                            authRequired: false,
                            paymentRequired: false,
                            writesRestricted: false,
                            software: 'strfry',
                            countryCode: 'US',
                            monitorCount: 3,
                            lastSeenAt: BigInt.from(1750000000),
                            liveProbe: RelayQualityReportDto(
                              url: 'wss://relay.primal.net',
                              reachable: true,
                              rttMs: 58,
                              status: 'healthy',
                              qualityScore: 96,
                              authRequired: false,
                              paymentRequired: false,
                              probedAt: BigInt.from(1750000000),
                            ),
                          ),
                        ],
                        blossomServerUrl: 'https://blossom.earthly.city',
                        onBlossomServerChanged: (_) {},
                        cordnServerPubkey:
                            'fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37',
                        onCordnPubkeyChanged: (_) {},
                        agentSettings: CopilotProviderSettings.offline,
                        onAgentSettingsChanged: (_) {},
                        safeEditing: true,
                        onSafeEditingChanged: (_) {},
                        visionSupport: 'none',
                        attachMapView: false,
                        onAttachMapViewChanged: (_) {},
                        account: null,
                        signerModeLabel: 'Signed out',
                        cashuWalletEnabled: false,
                        onSetCashuWalletEnabled: (_) {},
                        onOpenAccount: () {},
                        onClose: () {},
                      ),
                    ),
                  ],
                ),
              ),
            );

        await tester.pumpWidget(buildSheet());
        await tester.pumpAndSettle();

        // Snapshot loaded roles & profile discovery info cleanly.
        expect(find.text('R/W'), findsOneWidget);
        expect(find.text('READ'), findsOneWidget);
        expect(find.textContaining('wss://purplepag.es'), findsOneWidget);

        // Tap Probe All -> displays HEALTHY / SLOW badges, RTT ms, quality score, and NIP-11 metadata.
        final probeBtn = find.byKey(const Key('settings-probe-all-relays-btn'));
        await tester.ensureVisible(probeBtn);
        await tester.pumpAndSettle();
        await tester.tap(probeBtn);
        await tester.pumpAndSettle();

        expect(find.text('HEALTHY'), findsOneWidget);
        expect(find.text('42 ms · Q98'), findsOneWidget);
        expect(find.textContaining('Earthly City Relay'), findsOneWidget);
        expect(find.text('SLOW'), findsOneWidget);
        expect(find.text('920 ms · Q52'), findsOneWidget);

        // Tap Discover Public Relays (NIP-66) -> shows candidate and adds in 1 tap.
        final discoverBtn = find.byKey(const Key('settings-discover-nip66-btn'));
        await tester.ensureVisible(discoverBtn);
        await tester.pumpAndSettle();
        await tester.tap(discoverBtn);
        await tester.pumpAndSettle();

        expect(
          find.byKey(const Key('settings-nip66-candidate-wss://relay.primal.net')),
          findsOneWidget,
        );
        expect(find.text('58 ms'), findsOneWidget);

        final addNip66Btn =
            find.byKey(const Key('settings-nip66-add-wss://relay.primal.net'));
        await tester.ensureVisible(addNip66Btn);
        await tester.pumpAndSettle();
        await tester.tap(addNip66Btn);
        await tester.pumpAndSettle();

        expect(relays, contains('wss://relay.primal.net'));
        expect(find.text('ADDED'), findsOneWidget);
      },
    );
  });

  group('MapLayerCache point clustering state & GPU layer routing', () {
    test(
      'collects clusterable shelf points and omits unclustered shelf point layer when clustering is enabled',
      () {
        final cache = MapLayerCache();
        addTearDown(cache.dispose);

        final shelf = <ShelfMapEntry>[
          ShelfMapEntry(
            summary: makeTestMap(
              address: '37515:aaaa:vienna-cafes',
              title: 'Vienna Cafes',
            ),
            visible: true,
            shapes: const [
              ShelfShape(
                kind: ShelfShapeKind.point,
                coords: [Geographic(lon: 16.37, lat: 48.20)],
                anchor: Geographic(lon: 16.37, lat: 48.20),
                featureId: 'cafe-a',
                label: 'Cafe A',
              ),
              ShelfShape(
                kind: ShelfShapeKind.point,
                coords: [Geographic(lon: 16.38, lat: 48.21)],
                anchor: Geographic(lon: 16.38, lat: 48.21),
                featureId: 'cafe-b',
                label: 'Cafe B',
              ),
            ],
          ),
        ];

        final clusteredSnap = cache.resolve(
          shelfMaps: shelf,
          shelfRevision: 1,
          draftFeatures: const [],
          draftRevision: 0,
          selectedDraftFeatureIds: const {},
          selectionRevision: 0,
          sightings: const [],
          sightingsRevision: 0,
          beacons: const [],
          beaconsRevision: 0,
          activeStory: null,
          storyRevision: 0,
          commentOverlayShapes: const [],
          commentOverlayRevision: 0,
          proposalOverlayShapes: const [],
          proposalOverlayRevision: 0,
          aiGhostShapes: const [],
          aiGhostRevision: 0,
          gpsTrackRecording: false,
          gpsTrackPoints: const [],
          gpsTrackRevision: 0,
          accentColor: EarthlyColors.amber,
          systemIsDark: false,
          onInspectFeature: (_) {},
        );

        expect(cache.pointClusteringEnabled, isTrue);
        expect(clusteredSnap.clusteredShelfPoints, hasLength(2));
        expect(clusteredSnap.clusteredShelfPointMeta, hasLength(2));
        expect(
          clusteredSnap.gpuLayers.whereType<CircleLayer>(),
          isEmpty,
        );

        // Changing radius / max zoom invalidates cache cleanly
        cache.setPointClusterRadius(75);
        cache.setPointClusterMaxZoom(12);
        expect(cache.pointClusterRadius, 75);
        expect(cache.pointClusterMaxZoom, 12);

        // Disabling clustering restores the regular CircleLayer for shelf points
        cache.setPointClusteringEnabled(false);
        final unclusteredSnap = cache.resolve(
          shelfMaps: shelf,
          shelfRevision: 1,
          draftFeatures: const [],
          draftRevision: 0,
          selectedDraftFeatureIds: const {},
          selectionRevision: 0,
          sightings: const [],
          sightingsRevision: 0,
          beacons: const [],
          beaconsRevision: 0,
          activeStory: null,
          storyRevision: 0,
          commentOverlayShapes: const [],
          commentOverlayRevision: 0,
          proposalOverlayShapes: const [],
          proposalOverlayRevision: 0,
          aiGhostShapes: const [],
          aiGhostRevision: 0,
          gpsTrackRecording: false,
          gpsTrackPoints: const [],
          gpsTrackRevision: 0,
          accentColor: EarthlyColors.amber,
          systemIsDark: false,
          onInspectFeature: (_) {},
        );

        expect(unclusteredSnap.clusteredShelfPoints, isEmpty);
        expect(
          unclusteredSnap.gpuLayers.whereType<CircleLayer>(),
          hasLength(1),
        );
      },
    );
  });
}
