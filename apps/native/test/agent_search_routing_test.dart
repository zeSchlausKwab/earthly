import 'dart:typed_data';

import 'package:earthly_native/controllers/agent_controller.dart';
import 'package:earthly_native/runtime/device_bridge.dart';
import 'package:earthly_native/shell/agent_drawer.dart';
import 'package:earthly_native/shell/location_inspector_sheet.dart';
import 'package:earthly_native/shell/osm_import_sheet.dart';
import 'package:earthly_native/shell/place_search_sheet.dart';
import 'package:earthly_native/shell/routing_sheet.dart';
import 'package:earthly_native/src/rust/api/agent.dart';
import 'package:earthly_native/src/rust/api/geo.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

void main() {
  testWidgets(
      'AgentDrawer renders safeEditing amber ghost preview + CORS-free Research Source pane',
      (WidgetTester tester) async {
    bool? toggledSafe;
    var accepted = false;
    var discarded = false;
    ResearchSourceDto? extractedSource;
    ResearchSourceDto? citedSource;
    (double, double)? focusedCoord;

    const sampleSource = ResearchSourceDto(
      url: 'https://example.org/alpine-pass',
      title: 'Grossglockner High Alpine Road',
      excerpt: 'Mountain pass connecting Salzburg and Carinthia across the Alps.',
      coordinates: [ResearchCoordDto(lat: 47.0742, lon: 12.8425)],
      osmLinks: ['https://www.openstreetmap.org/way/12345'],
      spatialLinks: ['https://example.org/alpine-pass.gpx'],
      directGeojson: null,
      directFormat: null,
      directFeatureCount: 0,
    );

    await tester.pumpWidget(
      wrapSheetInStack(
        AgentDrawer(
          messages: const [],
          settings: CopilotProviderSettings.offline,
          busy: false,
          safeEditing: true,
          onSafeEditingChanged: (v) => toggledSafe = v,
          pendingEdit: const PendingAiEdit(
            proposedGeojson: '{"type":"FeatureCollection","features":[]}',
            diffAdded: 2,
            diffModified: 1,
            diffRemoved: 0,
            summary: 'Created 120m river corridor',
          ),
          onAcceptPendingEdit: () => accepted = true,
          onDiscardPendingEdit: () => discarded = true,
          initialResearchSource: sampleSource,
          onExtractSourceToMap: (s) => extractedSource = s,
          onFocusCoord: (lat, lon, _) => focusedCoord = (lat, lon),
          onCiteSourceInStory: (s) => citedSource = s,
          onSettingsChanged: (_) {},
          onSendPrompt: (_) {},
          onClearChat: () {},
          onClose: () {},
        ),
      ),
    );

    // SAFE toggle + amber ghost diff card
    expect(find.byKey(const Key('agent-safe-editing-card')), findsOneWidget);
    expect(find.text('SAFE'), findsOneWidget);
    await tester.tap(find.text('SAFE'));
    await tester.pump();
    expect(toggledSafe, isFalse);

    await tester.tap(find.text('Accept to Draft'));
    await tester.pump();
    expect(accepted, isTrue);

    await tester.tap(find.text('Discard'));
    await tester.pump();
    expect(discarded, isTrue);

    // Switch to Research Source tab
    await tester.tap(find.text('Source (1)'));
    await tester.pumpAndSettle();

    expect(find.text('Grossglockner High Alpine Road'), findsOneWidget);
    await tester.ensureVisible(find.text('47.0742, 12.8425'));
    await tester.pumpAndSettle();
    expect(find.text('47.0742, 12.8425'), findsOneWidget);

    await tester.tap(find.text('47.0742, 12.8425'));
    await tester.pump();
    expect(focusedCoord, (47.0742, 12.8425));

    await tester.ensureVisible(find.text('Extract 1 Coord to Map'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Extract 1 Coord to Map'));
    await tester.pump();
    expect(extractedSource?.title, 'Grossglockner High Alpine Road');

    await tester.ensureVisible(find.text('Cite in Story'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cite in Story'));
    await tester.pump();
    expect(citedSource?.url, 'https://example.org/alpine-pass');
  });

  testWidgets(
      'PlaceSearchSheet omnibox live-filters Maps, Stories, People, inserts operator chips, and merges NIP-50 + Photon results',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(390, 844));

    MapSummaryDto? selectedMap;
    String? nip50Queried;

    final map = makeTestMap(
      address: '37515:alice:danube',
      eventId: 'ev1',
      pubkey: 'alice',
      dTag: 'danube',
      title: 'Danube Bike Trail',
      description: 'Cycling route along the river',
      sizeBytes: 128,
      hashtags: const ['cycling'],
      featureCount: 4,
      createdAt: BigInt.from(1700000000),
    );
    final nip50Map = makeTestMap(
      address: '37515:bob:alpine',
      eventId: 'ev2',
      pubkey: 'bob',
      dTag: 'alpine',
      title: 'Alpine Ridge Pass',
      description: 'High trail',
      sizeBytes: 128,
      hashtags: const ['hiking'],
      featureCount: 2,
      createdAt: BigInt.from(1700000100),
    );

    await tester.pumpWidget(
      wrapSheetInStack(
        PlaceSearchSheet(
          catalogMaps: [map],
          catalogStories: [
            StorySummaryDto(
              address: '37520:alice:story',
              eventId: 'st1',
              pubkey: 'alice',
              dTag: 'story',
              title: 'Danube Field Log',
              content: 'Notes',
              referencedAddresses: const [],
              publishedAt: BigInt.from(1700000000),
            ),
          ],
          profilesByPubkey: const {
            'alice': ProfileMetadataDto(
              pubkey: 'alice',
              name: 'alice',
              displayName: 'Danube Cartographer',
            ),
          },
          searchPlacesOverride: (q) async => [
            const PlaceSearchResultDto(
              name: 'Danube Island',
              subtitle: 'Vienna',
              lon: 16.41,
              lat: 48.23,
            ),
          ],
          searchNip50Override: (_, q) async {
            nip50Queried = q;
            return EarthlyCatalogSnapshot(
              relayUrls: const ['wss://relay.earthly.city'],
              maps: [nip50Map],
              stories: const [],
              atlases: const [],
              sightings: const [],
              beacons: const [],
            );
          },
          onSelectMap: (m) => selectedMap = m,
          onJumpToPlace: (_) {},
          onJumpToNaddr: (_) async {},
          onClose: () {},
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('search-chip-tag')));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('omnibox-search-field')),
      'danube',
    );
    await tester.pump();

    expect(find.text('Danube Bike Trail'), findsOneWidget);
    expect(find.text('Danube Field Log'), findsOneWidget);
    expect(find.text('Danube Cartographer'), findsOneWidget);

    await tester.tap(find.byKey(const Key('omnibox-go-btn')));
    await tester.pumpAndSettle();

    expect(nip50Queried, 'danube');
    expect(find.text('Danube Island'), findsOneWidget);

    await tester.tap(find.text('Danube Bike Trail'));
    await tester.pump();
    expect(selectedMap?.address, '37515:alice:danube');
  });

  testWidgets(
      'LocationInspectorSheet renders reverse geocode, nearby Maps/Sightings, and Drop Point / Import OSM actions',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(390, 844));

    var droppedPoint = false;
    var openedOsm = false;
    MapSummaryDto? inspected;

    final nearbyMap = makeTestMap(
      address: '37515:alice:prater',
      eventId: 'm1',
      pubkey: 'alice',
      dTag: 'prater',
      title: 'Prater Walk',
      sizeBytes: 128,
      featureCount: 3,
      west: 16.38,
      south: 48.20,
      east: 16.41,
      north: 48.22,
      createdAt: BigInt.from(1700000000),
    );

    await tester.pumpWidget(
      wrapSheetInStack(
        LocationInspectorSheet(
          lat: 48.21,
          lon: 16.39,
          initialReverseGeocode: const ReverseGeocodeDto(
            displayName: 'Praterstern',
            subtitle: 'Leopoldstadt, Vienna, Austria',
            lat: 48.21,
            lon: 16.39,
          ),
          catalogMaps: [nearbyMap],
          catalogSightings: [
            SightingSummaryDto(
              address: '37522:bob:fox',
              eventId: 's1',
              pubkey: 'bob',
              dTag: 'fox',
              title: 'Kestrel Sighting',
              note: 'Hovering near tower',
              lon: 16.392,
              lat: 48.211,
              start: BigInt.from(1700000000),
            ),
          ],
          onInspectMap: (m) => inspected = m,
          onDropPointHere: () => droppedPoint = true,
          onImportOsmHere: () => openedOsm = true,
          onClose: () {},
        ),
      ),
    );

    expect(find.text('Praterstern'), findsOneWidget);
    await tester.ensureVisible(find.text('Prater Walk'));
    expect(find.text('Prater Walk'), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, -180));
    await tester.pumpAndSettle();
    expect(find.text('Kestrel Sighting'), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, 180));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('location-drop-point-btn')));
    await tester.pump();
    expect(droppedPoint, isTrue);

    await tester.tap(find.byKey(const Key('location-import-osm-btn')));
    await tester.pump();
    expect(openedOsm, isTrue);

    await tester.tap(find.text('Prater Walk'));
    await tester.pump();
    expect(inspected?.address, '37515:alice:prater');
  });

  testWidgets(
      'OsmImportSheet queries Overpass presets and imports GeoJSON features to draft',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(420, 1300));

    String? queriedPreset;
    OsmImportResultDto? imported;

    await tester.pumpWidget(
      wrapSheetInStack(
        OsmImportSheet(
          west: 16.36,
          south: 48.20,
          east: 16.38,
          north: 48.22,
          queryOverride: ({
            required west,
            required south,
            required east,
            required north,
            required preset,
            customTag,
            limit,
          }) async {
            queriedPreset = preset;
            return const OsmImportResultDto(
              geojson:
                  '{"type":"FeatureCollection","features":[{"type":"Feature","id":"way/1","properties":{"name":"Donaukanal"},"geometry":{"type":"LineString","coordinates":[[16.36,48.20],[16.38,48.21]]}}]}',
              featureCount: 1,
              querySummary: '1 OSM feature (waterway)',
            );
          },
          onImportFeatures: (res) => imported = res,
          onClose: () {},
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('osm-preset-waterway')));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('osm-query-btn')));
    await tester.tap(find.byKey(const Key('osm-query-btn')));
    await tester.pumpAndSettle();

    expect(queriedPreset, 'waterway');
    expect(find.textContaining('Donaukanal'), findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('osm-import-btn')));
    await tester.tap(find.byKey(const Key('osm-import-btn')));
    await tester.pump();
    expect(imported?.featureCount, 1);
  });

  testWidgets(
      'RoutingSheet computes Valhalla route & isochrone and imports GeoJSON into draft',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(420, 1000));

    String? importedGeoJson;
    String? importedLabel;
    String? isoProfile;

    await tester.pumpWidget(
      wrapSheetInStack(
        RoutingSheet(
          mapCenter: const Geographic(lon: 16.3738, lat: 48.2082),
          draftWaypoints: const [
            Geographic(lon: 16.370, lat: 48.205),
            Geographic(lon: 16.385, lat: 48.215),
          ],
          routeOverride: ({
            required waypoints,
            required profile,
          }) async =>
              ValhallaRouteResultDto(
            geojson:
                '{"type":"FeatureCollection","features":[{"type":"Feature","id":"r1","properties":{"name":"Bike Route"},"geometry":{"type":"LineString","coordinates":[[16.37,48.205],[16.385,48.215]]}}]}',
            distanceMeters: 1850,
            durationSeconds: 360,
            profile: profile,
            summary: '1.85 km · 6 min ($profile)',
          ),
          isochroneOverride: ({
            required origin,
            required profile,
            required contoursMinutes,
          }) async {
            isoProfile = profile;
            return ValhallaIsochroneResultDto(
              geojson:
                  '{"type":"FeatureCollection","features":[{"type":"Feature","id":"iso1","properties":{"name":"10 min $profile"},"geometry":{"type":"Polygon","coordinates":[[[16.36,48.20],[16.38,48.20],[16.38,48.22],[16.36,48.20]]]}}]}',
              featureCount: 1,
              profile: profile,
              summary: '1 isochrone band(s) · $profile',
            );
          },
          onImportGeoJsonToDraft: (geojson, label) {
            importedGeoJson = geojson;
            importedLabel = label;
          },
          onClose: () {},
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('routing-compute-route-btn')));
    await tester.pumpAndSettle();
    expect(find.text('1.85 km · 6 min (bicycle)'), findsOneWidget);

    await tester.tap(find.byKey(const Key('routing-tab-iso')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('routing-profile-pedestrian')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('routing-compute-iso-btn')));
    await tester.pumpAndSettle();

    expect(isoProfile, 'pedestrian');
    expect(find.text('1 isochrone band(s) · pedestrian'), findsOneWidget);

    await tester.tap(find.byKey(const Key('routing-import-iso-btn')));
    await tester.pump();
    expect(importedLabel, '1 isochrone band(s) · pedestrian');
    expect(importedGeoJson, contains('Polygon'));
  });

  testWidgets(
      'AgentDrawer discovers models via /models and applies tapped model chip',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    CopilotProviderSettings? updatedSettings;

    await tester.pumpWidget(
      wrapSheetInStack(
        AgentDrawer(
          messages: const [],
          settings: CopilotProviderSettings.localOllama,
          busy: false,
          onDiscoverModels: (baseUrl, _) async {
            expect(baseUrl, contains('11434'));
            return const ['llama3.2:latest', 'qwen2.5:14b'];
          },
          onSettingsChanged: (s) => updatedSettings = s,
          onSendPrompt: (_) {},
          onClearChat: () {},
          onClose: () {},
        ),
      ),
    );

    await tester.tap(find.byTooltip('Provider settings'));
    await tester.pumpAndSettle();

    final discoverBtn = find.byKey(const Key('agent-discover-models-btn'));
    await tester.ensureVisible(discoverBtn);
    await tester.pumpAndSettle();
    await tester.tap(discoverBtn);
    await tester.pumpAndSettle();

    final chip = find.byKey(const Key('agent-discovered-model-qwen2.5:14b'));
    await tester.ensureVisible(chip);
    await tester.pumpAndSettle();
    expect(chip, findsOneWidget);
    await tester.tap(chip);
    await tester.pumpAndSettle();

    expect(updatedSettings?.model, 'qwen2.5:14b');
  });

  testWidgets(
      'AgentDrawer switches multi-threads, creates new thread, and shows token usage badge',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    var createdThread = false;
    String? selectedThread;

    final threads = [
      const CopilotThread(
        id: 't1',
        title: 'Danube Survey',
        updatedAtMs: 1000,
        messages: [
          CopilotMessage(
            role: 'assistant',
            content: 'Measured 2.4 km.',
            promptTokens: 120,
            completionTokens: 45,
            totalTokens: 165,
          ),
        ],
      ),
      const CopilotThread(
        id: 't2',
        title: 'Alps Huts',
        updatedAtMs: 900,
        messages: [],
      ),
    ];

    await tester.pumpWidget(
      wrapSheetInStack(
        AgentDrawer(
          messages: threads.first.messages,
          threads: threads,
          activeThreadId: 't1',
          onCreateThread: () => createdThread = true,
          onSelectThread: (id) => selectedThread = id,
          onDeleteThread: (_) {},
          settings: CopilotProviderSettings.offline,
          busy: false,
          onSettingsChanged: (_) {},
          onSendPrompt: (_) {},
          onClearChat: () {},
          onClose: () {},
        ),
      ),
    );

    expect(find.byKey(const Key('agent-tokens-badge')), findsOneWidget);
    expect(find.textContaining('165 tok'), findsOneWidget);

    await tester.tap(find.byKey(const Key('agent-new-thread-btn')));
    await tester.pump();
    expect(createdThread, isTrue);

    await tester.ensureVisible(find.byKey(const Key('agent-thread-t2')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('agent-thread-t2')));
    await tester.pump();
    expect(selectedThread, 't2');
  });

  testWidgets(
      'AgentDrawer renders live SSE streaming reply, tool progress bar, Working Set chips, and attachment controls',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    String? toggledWorkingSet;
    var attachTapped = false;
    var clearedAttachment = false;

    await tester.pumpWidget(
      wrapSheetInStack(
        AgentDrawer(
          messages: const [],
          settings: CopilotProviderSettings.offline,
          busy: true,
          streamingText: 'Streamed **Danube** summary...',
          activeToolStatus: 'Step 1 · Running query_catalog…',
          liveToolCalls: const [
            AgentToolRecordDto(
              name: 'query_catalog',
              ok: true,
              summary: 'Found 2 catalog item(s)',
            ),
          ],
          shelfMaps: const [
            (address: '37515:alice:danube', title: 'Danube Trails'),
            (address: '37515:bob:alps', title: 'Alps Ridge'),
          ],
          workingSetAddresses: const {'37515:alice:danube'},
          onToggleWorkingSet: (addr) => toggledWorkingSet = addr,
          pendingAttachment: const AgentAttachment(
            fileName: 'huts.csv',
            formatLabel: 'CSV',
            featureCount: 4,
            summaryText: 'Converted CSV',
          ),
          onPickAttachment: () => attachTapped = true,
          onClearAttachment: () => clearedAttachment = true,
          onSettingsChanged: (_) {},
          onSendPrompt: (_) {},
          onClearChat: () {},
          onClose: () {},
        ),
      ),
    );

    expect(find.byKey(const Key('agent-working-set-bar')), findsOneWidget);
    expect(find.byKey(const Key('agent-tool-progress-bar')), findsOneWidget);
    expect(find.byKey(const Key('agent-streaming-reply')), findsOneWidget);
    expect(find.byKey(const Key('agent-attachment-chip')), findsOneWidget);
    expect(find.textContaining('Streamed Danube summary'), findsOneWidget);
    expect(find.textContaining('Found 2 catalog item(s)'), findsOneWidget);
    expect(toggledWorkingSet, isNull);
    expect(attachTapped, isFalse);
    expect(clearedAttachment, isFalse);

    // Non-busy pass exercises interactive Working Set + Attachment controls.
    await tester.pumpWidget(
      wrapSheetInStack(
        AgentDrawer(
          messages: const [],
          settings: CopilotProviderSettings.offline,
          busy: false,
          shelfMaps: const [
            (address: '37515:alice:danube', title: 'Danube Trails'),
          ],
          workingSetAddresses: const <String>{},
          onToggleWorkingSet: (addr) => toggledWorkingSet = addr,
          pendingAttachment: const AgentAttachment(
            fileName: 'huts.csv',
            formatLabel: 'CSV',
            featureCount: 4,
            summaryText: 'Converted CSV',
          ),
          onPickAttachment: () => attachTapped = true,
          onClearAttachment: () => clearedAttachment = true,
          onSettingsChanged: (_) {},
          onSendPrompt: (_) {},
          onClearChat: () {},
          onClose: () {},
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('agent-ws-37515:alice:danube')));
    await tester.pump();
    expect(toggledWorkingSet, '37515:alice:danube');

    await tester.tap(find.byKey(const Key('agent-attach-file-btn')));
    await tester.pump();
    expect(attachTapped, isTrue);

    await tester.tap(
      find
          .descendant(
            of: find.byKey(const Key('agent-attachment-chip')),
            matching: find.byType(Icon),
          )
          .last,
    );
    await tester.pump();
    expect(clearedAttachment, isTrue);
  });

  testWidgets(
      'AgentDrawer selects Routstr (Cashu) preset, toggles Auto-pay, and renders sats spent/refunded badge',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    var currentSettings = CopilotProviderSettings.offline;

    await tester.pumpWidget(
      wrapSheetInStack(
        StatefulBuilder(
          builder: (context, setState) => AgentDrawer(
            messages: const [
              CopilotMessage(
                role: 'assistant',
                content: 'Routed via Routstr.',
                promptTokens: 30,
                completionTokens: 12,
                totalTokens: 42,
                cashuSpentSats: 7,
                cashuRefundedSats: 5,
                cashuRefundToken: 'cashuArefund',
              ),
            ],
            settings: currentSettings,
            busy: false,
            onSettingsChanged: (s) => setState(() => currentSettings = s),
            onSendPrompt: (_) {},
            onClearChat: () {},
            onClose: () {},
          ),
        ),
      ),
    );

    expect(find.byKey(const Key('agent-cashu-badge')), findsOneWidget);
    expect(find.text('⚡ 7 sat · ↩ 5 sat'), findsOneWidget);
    expect(find.byKey(const Key('agent-tokens-badge')), findsOneWidget);

    await tester.tap(find.byTooltip('Provider settings'));
    await tester.pumpAndSettle();

    final routstrChip = find.byKey(const Key('agent-preset-routstr'));
    await tester.ensureVisible(routstrChip);
    await tester.tap(routstrChip);
    await tester.pumpAndSettle();

    expect(currentSettings.isRoutstr, isTrue);
    expect(currentSettings.baseUrl, 'https://api.routstr.com/v1');
    expect(currentSettings.autoPayCashu, isTrue);

    final autoPaySwitch = find.byKey(const Key('agent-routstr-autopay-switch'));
    await tester.ensureVisible(autoPaySwitch);
    await tester.tap(autoPaySwitch);
    await tester.pumpAndSettle();

    expect(currentSettings.autoPayCashu, isFalse);
  });

  test('AgentController ingests .xlsx attachment and CopilotMessage persists Cashu metadata',
      () async {
    final agent = AgentController();
    addTearDown(agent.dispose);

    agent.configureCashuWallet(
      databasePath: '/tmp/test_wallet.sqlite3',
      pubkeyHex: 'a'.padRight(64, 'a'),
    );

    final err = await agent.pickAttachment(
      isHeadlessTest: true,
      pickFileOverride: () async => PickedBinaryFile(
        bytes: Uint8List.fromList(const [0x50, 0x4B, 0x03, 0x04]),
        mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        name: 'camps.xlsx',
      ),
      parseXlsxOverride: (filename, bytes) async {
        expect(filename, 'camps.xlsx');
        return const XlsxParseDto(
          title: 'camps',
          sheets: [
            XlsxSheetDto(
              name: 'Sites',
              rowCount: 2,
              columnCount: 3,
              headers: ['name', 'lat', 'lon'],
              markdownTable: '| name | lat | lon |\n| --- | --- | --- |\n| Camp A | 48.20 | 16.37 |',
              csvText: 'name,lat,lon\nCamp A,48.20,16.37',
            ),
          ],
          markdownTable: '| name | lat | lon |\n| --- | --- | --- |\n| Camp A | 48.20 | 16.37 |',
          csvText: 'name,lat,lon\nCamp A,48.20,16.37',
          geojson:
              '{"type":"FeatureCollection","features":[{"type":"Feature","id":"xlsx-1","geometry":{"type":"Point","coordinates":[16.37,48.20]},"properties":{"name":"Camp A"}}]}',
          featureCount: 1,
          warnings: [],
        );
      },
    );

    expect(err, isNull);
    expect(agent.pendingAttachment?.fileName, 'camps.xlsx');
    expect(agent.pendingAttachment?.formatLabel, 'XLSX');
    expect(agent.pendingAttachment?.featureCount, 1);
    expect(agent.pendingAttachment?.summaryText, contains('Camp A'));
    expect(agent.pendingAttachment?.importedGeojson, contains('16.37'));

    const msg = CopilotMessage(
      role: 'assistant',
      content: 'Done',
      cashuSpentSats: 8,
      cashuRefundedSats: 12,
      cashuRefundToken: 'cashuAchange',
    );
    final decoded = CopilotMessage.fromJson(msg.toJson())!;
    expect(decoded.cashuSpentSats, 8);
    expect(decoded.cashuRefundedSats, 12);
    expect(decoded.cashuRefundToken, 'cashuAchange');
  });
}
