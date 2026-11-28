import 'package:earthly_native/controllers/account_wallet_controller.dart';
import 'package:earthly_native/controllers/agent_controller.dart';
import 'package:earthly_native/controllers/catalog_shelf_controller.dart';
import 'package:earthly_native/controllers/draft_workbench_controller.dart';
import 'package:earthly_native/controllers/map_layer_cache.dart';
import 'package:earthly_native/controllers/spaces_sync_controller.dart';
import 'package:earthly_native/drawing/drawing_model.dart';
import 'package:earthly_native/main.dart';
import 'package:earthly_native/nostr/callout_overlay.dart';
import 'package:earthly_native/runtime/device_bridge.dart';
import 'package:earthly_native/shell/agent_drawer.dart';
import 'package:earthly_native/src/rust/api/agent.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:earthly_native/src/rust/api/settings.dart';
import 'package:earthly_native/src/rust/api/wallet.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  group('MapLayerCache memoization', () {
    test(
      'returns identical cached snapshot on matching revisions and rebuilds only when relevant inputs change',
      () {
        final cache = MapLayerCache();
        addTearDown(cache.dispose);

        final draft = DraftWorkbenchController();
        addTearDown(draft.dispose);

        final catalog = CatalogShelfController();
        addTearDown(catalog.dispose);

        final agent = AgentController();
        addTearDown(agent.dispose);

        MapLayerSnapshot resolveNow() => cache.resolve(
              shelfMaps: catalog.shelfMaps,
              shelfRevision: catalog.shelfRevision,
              draftFeatures: draft.features,
              draftRevision: draft.draftRevision,
              selectedDraftFeatureIds: draft.selectedDraftFeatureIds,
              selectionRevision: draft.selectionRevision,
              sightings: catalog.allSightings,
              sightingsRevision: catalog.sightingsRevision,
              beacons: catalog.allBeacons,
              beaconsRevision: catalog.beaconsRevision,
              activeStory: catalog.activeStoryContext,
              storyRevision: catalog.storyRevision,
              commentOverlayShapes: catalog.commentOverlayShapes,
              commentOverlayRevision: catalog.commentOverlayRevision,
              proposalOverlayShapes: catalog.proposalOverlayShapes,
              proposalOverlayRevision: catalog.proposalOverlayRevision,
              aiGhostShapes: agent.aiGhostShapes,
              aiGhostRevision: agent.aiGhostRevision,
              gpsTrackRecording: draft.gpsTrackRecording,
              gpsTrackPoints: draft.gpsTrackPoints,
              gpsTrackRevision: draft.gpsTrackRevision,
              accentColor: const Color(0xFFF59E0B),
              systemIsDark: false,
              onInspectFeature: (_) {},
            );

        final snap1 = resolveNow();
        expect(cache.buildCount, 1);
        expect(cache.cacheHits, 0);
        expect(cache.revision, 1);

        // Repeated calls with unchanged revisions hit the memoized snapshot.
        final snap2 = resolveNow();
        final snap3 = resolveNow();
        expect(identical(snap1, snap2), isTrue);
        expect(identical(snap1, snap3), isTrue);
        expect(cache.buildCount, 1);
        expect(cache.cacheHits, 2);
        expect(cache.revision, 1);

        // Background GPS ticks when NOT recording do not bust the layer cache.
        draft.onGpsTrackPoint(
          const GpsTrackSample(
            lat: 48.2082,
            lon: 16.3738,
            accuracyMeters: 4.0,
            timestampMs: 1000,
          ),
        );
        expect(draft.gpsTrackRevision, 0);
        final snapAfterIdleGps = resolveNow();
        expect(identical(snap1, snapAfterIdleGps), isTrue);
        expect(cache.buildCount, 1);
        expect(cache.cacheHits, 3);

        // Changing CalloutDisplayMode notifies presentationListenable only and
        // does not bust the GPU layer cache.
        var layerConfigNotifies = 0;
        var presentationNotifies = 0;
        cache.layerConfigListenable.addListener(() => layerConfigNotifies += 1);
        cache.presentationListenable.addListener(() => presentationNotifies += 1);
        cache.cycleCalloutMode();
        expect(cache.calloutMode, CalloutDisplayMode.compact);
        expect(layerConfigNotifies, 0);
        expect(presentationNotifies, 1);
        final snapAfterCalloutMode = resolveNow();
        expect(identical(snap1, snapAfterCalloutMode), isTrue);
        expect(cache.buildCount, 1);
        expect(cache.cacheHits, 4);

        // Mutating draft geometry increments draftRevision and rebuilds once.
        draft.dropDraftPointAt(const Geographic(lon: 16.3738, lat: 48.2082));
        final snap4 = resolveNow();
        expect(identical(snap1, snap4), isFalse);
        expect(cache.buildCount, 2);
        expect(cache.cacheHits, 4);

        // Next call hits cache again.
        final snap5 = resolveNow();
        expect(identical(snap4, snap5), isTrue);
        expect(cache.buildCount, 2);
        expect(cache.cacheHits, 5);

        // Toggling labels invalidates layerConfigListenable and rebuilds once.
        cache.setShowLabels(false);
        expect(layerConfigNotifies, 1);
        final snap6 = resolveNow();
        expect(identical(snap4, snap6), isFalse);
        expect(cache.buildCount, 3);

        // Explicit invalidate() forces next resolve() to rebuild.
        cache.invalidate();
        final snap7 = resolveNow();
        expect(identical(snap6, snap7), isFalse);
        expect(cache.buildCount, 4);
      },
    );
  });

  group('AgentController', () {
    test(
      'SSE token streaming notifies streamListenable only without firing ghostListenable or root controller',
      () {
        final agent = AgentController();
        addTearDown(agent.dispose);

        var rootNotifies = 0;
        var streamNotifies = 0;
        var ghostNotifies = 0;
        agent.addListener(() => rootNotifies += 1);
        agent.streamListenable.addListener(() => streamNotifies += 1);
        agent.ghostListenable.addListener(() => ghostNotifies += 1);

        agent.handleStreamEvent(
          const AgentStreamEventDto(
            eventType: 'status',
            text: 'Planning spatial query…',
          ),
        );
        agent.handleStreamEvent(
          const AgentStreamEventDto(
            eventType: 'tool_started',
            step: 1,
            toolName: 'inspect_draft',
          ),
        );
        agent.handleStreamEvent(
          const AgentStreamEventDto(
            eventType: 'tool_finished',
            toolName: 'inspect_draft',
            toolOk: true,
            toolSummary: 'Found 2 features',
          ),
        );
        agent.handleStreamEvent(
          const AgentStreamEventDto(eventType: 'delta', text: 'Hello '),
        );
        agent.handleStreamEvent(
          const AgentStreamEventDto(eventType: 'delta', text: 'Earthly!'),
        );

        expect(streamNotifies, 5);
        expect(rootNotifies, 0);
        expect(ghostNotifies, 0);
        expect(agent.streamingText, 'Hello Earthly!');
        expect(agent.activeToolStatus, 'Step 1 · Running inspect_draft…');
        expect(agent.liveToolCalls.length, 1);
        expect(agent.aiGhostRevision, 0);
      },
    );

    test('threads persist round-trip and safeEditing stages amber ghost shapes',
        () {
      final agent = AgentController();
      addTearDown(agent.dispose);

      agent.createNewThread();
      expect(agent.threads.length, 2);
      final createdId = agent.activeThreadId;
      agent.selectThread('thread-1');
      expect(agent.activeThreadId, 'thread-1');
      agent.deleteThread(createdId);
      expect(agent.threads.length, 1);

      const sampleGeoJson = '''
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [16.3738, 48.2082] },
      "properties": { "name": "AI Point" }
    }
  ]
}
''';
      var ghostNotifies = 0;
      agent.ghostListenable.addListener(() => ghostNotifies += 1);

      final bounds = agent.stageOrApplyAiGeojson(
        proposedGeojson: sampleGeoJson,
        diffAdded: 1,
        diffModified: 0,
        diffRemoved: 0,
        summary: 'Added 1 point',
        onApplyDirect: (_) => fail('safeEditing should stage ghost, not apply'),
      );

      expect(bounds, isNotNull);
      expect(ghostNotifies, 1);
      expect(agent.aiGhostRevision, 1);
      expect(agent.pendingAiEdit?.diffAdded, 1);
      expect(agent.aiGhostShapes.length, 1);

      final taken = agent.takeAndClearPendingAiEdit();
      expect(taken?.summary, 'Added 1 point');
      expect(agent.pendingAiEdit, isNull);
      expect(agent.aiGhostShapes, isEmpty);
      expect(agent.aiGhostRevision, 2);
      expect(ghostNotifies, 2);
    });
  });

  group('DraftWorkbenchController', () {
    test(
      'preview updates avoid geometry rebuilds; vertex commit, undo/redo, and GPS track recording work cleanly',
      () async {
        final draft = DraftWorkbenchController();
        addTearDown(draft.dispose);

        var geometryNotifies = 0;
        var previewNotifies = 0;
        draft.geometryListenable.addListener(() => geometryNotifies += 1);
        draft.previewNotifier.addListener(() => previewNotifies += 1);

        // Finger drag preview notifications never trigger heavy geometry builds.
        draft.updatePreview(const Offset(120, 240), true, true);
        expect(previewNotifies, 1);
        expect(geometryNotifies, 0);
        expect(draft.draftRevision, 0);

        // Draw a line and finish it.
        draft.selectMode(DrawToolMode.line);
        draft.commitVertex(const Geographic(lon: 16.37, lat: 48.20));
        draft.commitVertex(const Geographic(lon: 16.38, lat: 48.21));
        expect(draft.canFinishDraft, isTrue);
        draft.finishDraft();
        expect(draft.features.length, 1);
        expect(draft.undoStack.length, 1);
        final revAfterFinish = draft.draftRevision;
        expect(revAfterFinish, greaterThan(0));

        // Undo & redo.
        draft.undoDraftEdit();
        expect(draft.features, isEmpty);
        expect(draft.redoStack.length, 1);
        draft.redoDraftEdit();
        expect(draft.features.length, 1);

        // GPS track recording accumulates distance and commits a line feature.
        await draft.startGpsTrack(
          fallbackCenter: const Geographic(lon: 16.370, lat: 48.200),
        );
        expect(draft.gpsTrackRecording, isTrue);
        final revBeforeTrackPts = draft.gpsTrackRevision;
        draft.onGpsTrackPoint(
          const GpsTrackSample(
            lat: 48.205,
            lon: 16.375,
            accuracyMeters: 3.0,
            timestampMs: 2000,
          ),
        );
        expect(draft.gpsTrackPoints.length, 2);
        expect(draft.gpsTrackDistanceMeters, greaterThan(100));
        expect(draft.gpsTrackRevision, revBeforeTrackPts + 1);

        final finished = await draft.finishGpsTrackToDraft();
        expect(finished, isNotNull);
        expect(finished!.pointCount, 2);
        expect(draft.gpsTrackRecording, isFalse);
        expect(draft.features.length, 2);
      },
    );
  });

  group('AccountWallet, CatalogShelf, and SpacesSync controllers', () {
    test('session switching, Cashu view state, shelf ops, and inbox unread counts',
        () {
      final account = AccountWalletController();
      addTearDown(account.dispose);

      account.upsertAndActivateSession(
        const SavedAccountSessionDto(
          id: 'local:aaaa',
          kind: 'local',
          pubkeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          localNsec: 'nsec1test',
          label: 'Field',
        ),
      );
      expect(account.account?.pubkey, startsWith('aaaa'));
      expect(account.accountChipLabel, 'aaaaaaaa');
      account.cacheProfile(
        ProfileMetadataDto(
          pubkey: account.account!.pubkey,
          displayName: 'Field',
        ),
      );
      expect(account.accountChipLabel, 'Field');

      account.updateCashuWalletState(
        CashuWalletStateDto(
          pubkeyHex: account.account!.pubkey,
          mints: const ['https://mint.example'],
          relays: const ['wss://relay.earthly.city'],
          defaultMint: 'https://mint.example',
          balanceSats: BigInt.from(420),
          proofCount: BigInt.from(3),
          pendingTokens: const [],
          mintBalances: [
            CashuMintBalanceDto(
              mintUrl: 'https://mint.example',
              balanceSats: BigInt.from(420),
              proofCount: BigInt.from(3),
            ),
          ],
          p2PkPubkeyHex: '02abc',
          nutzapEnabled: true,
          history: const [],
          updatedAt: BigInt.from(1700000000),
        ),
      );
      expect(account.cashuWalletViewState.initialized, isTrue);
      expect(account.cashuWalletViewState.totalBalanceSats, 420);

      final catalog = CatalogShelfController();
      addTearDown(catalog.dispose);

      final sampleMap = MapSummaryDto(
        address: '37515:aaaa:vienna',
        eventId: 'ev1',
        pubkey: 'aaaa',
        dTag: 'vienna',
        title: 'Vienna Trails',
        featureCount: 1,
        sizeBytes: 120,
        geojson:
            '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[16.37,48.20]},"properties":{"name":"Stephensdom"}}]}',
        blobRefs: const [],
        hashtags: const [],
        labels: const [],
        contextRefs: const [],
        createdAt: BigInt.from(1700000000),
      );
      expect(catalog.toggleMapOnShelf(sampleMap), isTrue);
      expect(catalog.shelfMaps.length, 1);
      expect(catalog.shelfRevision, 1);
      expect(catalog.toggleMapOnShelf(sampleMap), isFalse);
      expect(catalog.shelfMaps, isEmpty);
      expect(catalog.shelfRevision, 2);

      final spaces = SpacesSyncController();
      addTearDown(spaces.dispose);

      spaces.inboxItems = [
        InboxItemDto(
          id: 'in-1',
          eventId: 'ev-in-1',
          kind: 'reply',
          category: 'replies',
          actorPubkey: 'bbbb',
          createdAt: BigInt.from(200),
          action: 'replied',
          thingLabel: 'Vienna Trails',
        ),
        InboxItemDto(
          id: 'in-2',
          eventId: 'ev-in-2',
          kind: 'zap',
          category: 'activity',
          actorPubkey: 'cccc',
          createdAt: BigInt.from(300),
          action: 'zapped',
          thingLabel: 'Vienna Trails',
        ),
      ];
      expect(spaces.inboxUnreadCount, 2);
      spaces.markInboxItemRead('in-1');
      expect(spaces.inboxUnreadCount, 1);
      spaces.markAllInboxRead();
      expect(spaces.inboxUnreadCount, 0);
    });

    test(
      'AccountWalletController.nip60WalletEnabled defaults false and applyRestoredSessions restores it',
      () {
        final account = AccountWalletController();
        addTearDown(account.dispose);

        expect(account.nip60WalletEnabled, isFalse);

        AppSettingsDto buildSettings({required bool enabled}) => AppSettingsDto(
              relayUrls: const ['wss://relay.earthly.city'],
              agentPreset: 'openrouter',
              agentBaseUrl: 'https://openrouter.ai/api/v1',
              agentModel: 'anthropic/claude-sonnet-4',
              agentApiKey: '',
              offlinePacks: const [],
              pinnedEntityIds: const [],
              recentEntityIds: const [],
              cordnServerPubkey: '',
              mountedAtlasWorkspaces: const [],
              blossomServerUrl: 'https://blossom.earthly.city',
              inboxReadAllBefore: BigInt.zero,
              inboxReadIds: const [],
              savedAccounts: const [],
              mutedPubkeys: const [],
              themeMode: 'system',
              basemapStyle: 'auto',
              satelliteMode: 'osm',
              satelliteOpacity: 0.75,
              nip60WalletEnabled: enabled,
              pointClusteringEnabled: true,
              pointClusterRadius: 50,
              pointClusterMaxZoom: 14,
              agentProviderType: null,
              agentAutoPayCashu: false,
              agentCashuMaxSats: 25,
            );

        account.applyRestoredSessions(buildSettings(enabled: true));
        expect(account.nip60WalletEnabled, isTrue);

        account.applyRestoredSessions(buildSettings(enabled: false));
        expect(account.nip60WalletEnabled, isFalse);
      },
    );

    test(
      'CatalogShelfController defaults to production Earthly + public relays and merges cleanly',
      () {
        final catalog = CatalogShelfController();
        addTearDown(catalog.dispose);

        expect(
          catalog.relayUrls,
          containsAll(<String>[
            'wss://relay.earthly.city',
            'wss://relay.damus.io',
            'wss://nos.lol',
            'wss://relay.primal.net',
          ]),
        );

        // Merging duplicate / trailing-slash relays is a no-op; new relay is normalized & appended.
        expect(catalog.mergeRelayUrls(const ['wss://relay.damus.io/']), isFalse);
        expect(
          catalog.mergeRelayUrls(const ['wss://relay.snort.social/']),
          isTrue,
        );
        expect(catalog.relayUrls, contains('wss://relay.snort.social'));
      },
    );
  });

  group('Widget rebuild isolation', () {
    testWidgets(
      'AgentController SSE token streaming, idle GPS ticks, and drawer switches do NOT rebuild map layers or map surface',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(1440, 900);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);

        final mapLayerCache = MapLayerCache();
        final agentController = AgentController();
        final draftController = DraftWorkbenchController();
        final catalogController = CatalogShelfController();
        final spacesController = SpacesSyncController();
        final accountController = AccountWalletController();
        addTearDown(() {
          mapLayerCache.dispose();
          agentController.dispose();
          draftController.dispose();
          catalogController.dispose();
          spacesController.dispose();
          accountController.dispose();
        });

        var mapBuilderCalls = 0;

        await tester.pumpWidget(
          MaterialApp(
            home: EarthlySpikeHome(
              mapLayerCache: mapLayerCache,
              agentController: agentController,
              draftController: draftController,
              catalogController: catalogController,
              spacesController: spacesController,
              accountController: accountController,
              mapBuilder: (context, gestures, onMapCreated, onCameraMove) {
                mapBuilderCalls += 1;
                return const SizedBox.expand(
                  key: Key('isolated-map-surface'),
                );
              },
            ),
          ),
        );

        expect(mapBuilderCalls, 1);
        expect(mapLayerCache.buildCount, 1);

        // Open AgentDrawer on Wide Studio.
        await tester.tap(find.text('Agent'));
        await tester.pump();
        expect(find.byType(AgentDrawer), findsOneWidget);
        // Opening a drawer must NOT rebuild the map surface or map layers.
        expect(mapBuilderCalls, 1);
        expect(mapLayerCache.buildCount, 1);

        // Stream 20 SSE delta tokens into AgentController.
        agentController.busy = true;
        agentController.handleStreamEvent(
          const AgentStreamEventDto(
            eventType: 'status',
            text: 'Streaming answer…',
          ),
        );
        for (var i = 0; i < 20; i++) {
          agentController.handleStreamEvent(
            AgentStreamEventDto(eventType: 'delta', text: 'tok$i '),
          );
          await tester.pump();
        }

        // AgentDrawer updated with the streamed tokens.
        expect(find.textContaining('tok19'), findsOneWidget);

        // Neither the map widget nor MapLayerCache rebuilt during token streaming.
        expect(mapBuilderCalls, 1);
        expect(mapLayerCache.buildCount, 1);

        // Idle GPS ticks and switching left drawers also preserve map isolation.
        draftController.onGpsTrackPoint(
          const GpsTrackSample(
            lat: 48.2082,
            lon: 16.3738,
            accuracyMeters: 3.5,
            timestampMs: 5000,
          ),
        );
        await tester.tap(find.text('Desk'));
        await tester.pump();
        await tester.tap(find.text('Explore'));
        await tester.pump();
        expect(mapBuilderCalls, 1);
        expect(mapLayerCache.buildCount, 1);

        // Mutating actual draft geometry DOES trigger a map layer rebuild.
        draftController.dropDraftPointAt(
          const Geographic(lon: 16.3738, lat: 48.2082),
        );
        await tester.pump();
        expect(mapBuilderCalls, 2);
        expect(mapLayerCache.buildCount, 2);
      },
    );
  });
}
