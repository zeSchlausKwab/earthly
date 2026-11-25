import 'package:earthly_native/drawing/drawing_model.dart';
import 'package:earthly_native/main.dart';
import 'package:earthly_native/nostr/atlas_schema.dart';
import 'package:earthly_native/nostr/basemap_config.dart';
import 'package:earthly_native/nostr/callout_overlay.dart';
import 'package:earthly_native/nostr/earthly_share.dart';
import 'package:earthly_native/nostr/map_poster_exporter.dart';
import 'package:earthly_native/nostr/nip55_signer.dart';
import 'package:earthly_native/nostr/shelf_renderer.dart';
import 'package:earthly_native/nostr/story_presentation.dart';
import 'package:earthly_native/shell/account_session_sheet.dart';
import 'package:earthly_native/shell/agent_drawer.dart';
import 'package:earthly_native/shell/atlas_composer_sheet.dart';
import 'package:earthly_native/shell/atlas_detail_margin.dart';
import 'package:earthly_native/shell/basemap_switcher_sheet.dart';
import 'package:earthly_native/shell/circles_sheet.dart';
import 'package:earthly_native/shell/dataset_detail_margin.dart';
import 'package:earthly_native/shell/desk_sheet.dart';
import 'package:earthly_native/shell/discussion_margin_sheet.dart';
import 'package:earthly_native/shell/earthly_rich_text.dart';
import 'package:earthly_native/shell/entity_list_row.dart';
import 'package:earthly_native/shell/explore_sheet.dart';
import 'package:earthly_native/shell/feature_inspector_sheet.dart';
import 'package:earthly_native/shell/help_shortcuts_sheet.dart';
import 'package:earthly_native/shell/inbox_sheet.dart';
import 'package:earthly_native/shell/location_inspector_sheet.dart';
import 'package:earthly_native/shell/map_drawer.dart';
import 'package:earthly_native/shell/osm_import_sheet.dart';
import 'package:earthly_native/shell/person_margin.dart';
import 'package:earthly_native/shell/place_search_sheet.dart';
import 'package:earthly_native/shell/qr_code_view.dart';
import 'package:earthly_native/shell/raw_event_inspector_dialog.dart';
import 'package:earthly_native/shell/routing_sheet.dart';
import 'package:earthly_native/shell/social_actions_bar.dart';
import 'package:earthly_native/shell/spaces_sheet.dart';
import 'package:earthly_native/shell/story_composer_sheet.dart';
import 'package:earthly_native/shell/story_reader_margin.dart';
import 'package:earthly_native/src/rust/api/agent.dart';
import 'package:earthly_native/src/rust/api/blossom.dart';
import 'package:earthly_native/src/rust/api/geo.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:earthly_native/src/rust/api/private_groups.dart';
import 'package:earthly_native/src/rust/api/publish.dart';
import 'package:earthly_native/src/rust/api/settings.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  testWidgets(
      'switches between Explore/Desk/Spaces bar, Draw-Drag, and Crosshair', (
    WidgetTester tester,
  ) async {
    bool? lastDragGesture;
    bool? lastPinchGesture;

    await tester.pumpWidget(
      EarthlyNativeApp(
        mapBuilder: (context, gestures, onMapCreated, onCameraMove) {
          lastDragGesture = gestures.drag;
          lastPinchGesture = gestures.pinch;
          return const ColoredBox(color: Color(0xFFEDF0EA));
        },
      ),
    );

    // Browse mode: 3-intent bottom bar (Explore · Desk · Spaces) + Draw button.
    expect(find.text('EARTHLY'), findsOneWidget);
    expect(find.text('Explore'), findsOneWidget);
    expect(find.text('Desk'), findsOneWidget);
    expect(find.text('Spaces'), findsOneWidget);
    expect(find.text('Draw'), findsOneWidget);
    expect(lastDragGesture, isTrue);
    expect(lastPinchGesture, isTrue);

    // Tap Draw -> enters Line drawing mode (1-finger draw, 2-finger pinch/pan).
    await tester.tap(find.text('Draw'));
    await tester.pump();

    expect(lastDragGesture, isFalse);
    expect(lastPinchGesture, isTrue);
    expect(find.byTooltip('Draw-Drag'), findsOneWidget);
    expect(find.byTooltip('Loupe'), findsOneWidget);

    // Switch to Crosshair mode -> MapLibre regains 1-finger pan under center reticle.
    await tester.tap(find.byTooltip('Draw-Drag'));
    await tester.pump();

    expect(lastDragGesture, isTrue);
    expect(find.byTooltip('Crosshair'), findsOneWidget);
    expect(find.text('Drop'), findsOneWidget);

    // Tap Done -> returns cleanly to Explore/Desk/Spaces navigation.
    await tester.tap(find.text('Done'));
    await tester.pump();

    expect(find.text('Explore'), findsOneWidget);
    expect(lastDragGesture, isTrue);
  });

  test('parseGeoJsonShapes extracts labels, callouts, and round-trips drafts',
      () {
    const sample = '''
    {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "id": "gate-north",
          "geometry": { "type": "Point", "coordinates": [16.37, 48.20] },
          "properties": {
            "color": "#1F5F8B",
            "name": "North Entrance",
            "earthly:callouts": [
              {
                "id": "access",
                "title": "Access",
                "text": "Open 06:00-22:00",
                "placement": { "side": "right", "offset": [10, -4], "leader": "line" }
              }
            ]
          }
        },
        { "type": "Feature", "id": "trail-1", "geometry": { "type": "LineString", "coordinates": [[16.36, 48.20], [16.38, 48.21]] }, "properties": { "label": "Danube Path" } },
        { "type": "Feature", "id": "park-1", "geometry": { "type": "Polygon", "coordinates": [[[16.3, 48.2], [16.4, 48.2], [16.4, 48.3], [16.3, 48.2]]] }, "properties": {} }
      ]
    }
    ''';
    final shapes = parseGeoJsonShapes(
      sample,
      datasetTitle: 'Vienna Parks',
      datasetAddress: '37515:abc:vienna-parks',
    );
    expect(shapes.length, 3);
    expect(shapes[0].kind, ShelfShapeKind.point);
    expect(shapes[0].featureId, 'gate-north');
    expect(shapes[0].label, 'North Entrance');
    expect(shapes[0].callouts.length, 1);
    expect(shapes[0].callouts.first.title, 'Access');
    expect(shapes[0].callouts.first.preferredSide, 'right');
    expect(shapes[1].label, 'Danube Path');

    final draftFeatures = parseDraftFeaturesFromGeoJson(sample);
    expect(draftFeatures.length, 3);
    final roundTripped = draftFeaturesToGeoJson(
      title: 'Round Trip',
      features: draftFeatures,
    );
    expect(parseDraftFeaturesFromGeoJson(roundTripped).length, 3);
  });

  test('parseStoryDocument reduces earthly-view patches and extracts inline refs',
      () {
    const presentation = '''
    {
      "version": 1,
      "initialView": { "center": [16.3738, 48.2082], "zoom": 13 },
      "layers": [
        { "id": "base", "source": "37515:deadbeef:vienna", "visible": true, "opacityMultiplier": 1.0 },
        { "id": "overlay", "source": "37515:deadbeef:trails", "visible": false, "opacityMultiplier": 1.0 }
      ]
    }
    ''';
    const markdown = '''
# Exploring Vienna

Visit geo:48.2082,16.3738 for the cathedral.

```earthly-view
{
  "version": 1,
  "type": "view",
  "id": "v1",
  "title": "Show Trails",
  "caption": "Trails layer fades in",
  "display": "both",
  "camera": { "center": [16.38, 48.21], "zoom": 14.5 },
  "layers": {
    "overlay": { "visible": true, "style": { "color": "#C2410C" } }
  }
}
```

See also nostr:naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsrhuxx8l9ex3s#trail-1 for details.
''';

    final parsed = parseStoryDocument(
      markdown: markdown,
      presentationJson: presentation,
    );
    expect(parsed.initialView?.zoom, 13);
    expect(parsed.baseLayers.length, 2);
    expect(parsed.viewSnapshots.length, 1);
    expect(parsed.viewSnapshots.first.camera?.zoom, 14.5);
    expect(parsed.viewSnapshots.first.layers[1].visible, isTrue);
    expect(parsed.viewSnapshots.first.layers[1].style?.color, '#C2410C');
    expect(parsed.inlineRefs.length, 2);
    expect(parsed.inlineRefs.any((r) => r.kind == StoryInlineRefKind.geoCoord),
        isTrue);
    expect(parsed.inlineRefs.any((r) => r.kind == StoryInlineRefKind.naddr),
        isTrue);
  });

  testWidgets(
      'BasemapSwitcherSheet toggles Feature Labels switch cleanly off and back on',
      (WidgetTester tester) async {
    var showLabels = true;
    var calloutMode = CalloutDisplayMode.full;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BasemapSwitcherSheet(
            activeBasemap: BasemapKind.openFreeMapLiberty,
            offlineBasemap: null,
            showLabels: showLabels,
            calloutMode: calloutMode,
            onSelectBasemap: (_) {},
            onLoadedOfflinePmtiles: (_) {},
            onToggleLabels: (val) => showLabels = val,
            onChangeCalloutMode: (mode) => calloutMode = mode,
          ),
        ),
      ),
    );

    final labelSwitch = find.byType(SwitchListTile);
    expect(tester.widget<SwitchListTile>(labelSwitch).value, isTrue);

    await tester.tap(labelSwitch);
    await tester.pump();
    expect(showLabels, isFalse);
    expect(tester.widget<SwitchListTile>(labelSwitch).value, isFalse);

    await tester.tap(labelSwitch);
    await tester.pump();
    expect(showLabels, isTrue);
    expect(tester.widget<SwitchListTile>(labelSwitch).value, isTrue);
  });

  testWidgets('EarthlyMapDrawer scrolls body independently of 50/50 height and renders QR',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    double? reportedFraction;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              EarthlyMapDrawer(
                initialFraction: 0.50,
                onClose: () {},
                onHeightFractionChanged: (f) => reportedFraction = f,
                header: const Padding(
                  padding: EdgeInsets.all(8),
                  child: Text('STICKY HEADER'),
                ),
                body: ListView(
                  children: [
                    const EarthlyQrCode(
                      data: 'earthly://pair?invitation=earthly-pair-v1:test',
                      size: 140,
                    ),
                    for (var i = 0; i < 20; i++)
                      ListTile(title: Text('Story paragraph $i')),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('STICKY HEADER'), findsOneWidget);
    // Scroll the body list — drawer height fraction must NOT change!
    await tester.drag(find.byType(ListView), const Offset(0, -240));
    await tester.pumpAndSettle();
    expect(reportedFraction, isNull);
    expect(find.text('STICKY HEADER'), findsOneWidget);

    // Drag the sticky header upward — drawer height fraction SHOULD increase!
    await tester.drag(find.text('STICKY HEADER'), const Offset(0, -220));
    await tester.pumpAndSettle();
    expect(reportedFraction, isNotNull);
    expect(reportedFraction!, greaterThan(0.55));
  });

  test('Point features with white strokeColor retain their backing fill color',
      () {
    const bushbySample = '''
    {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "id": "waypoint-1",
          "geometry": { "type": "Point", "coordinates": [-77.0, 8.5] },
          "properties": {
            "name": "Darien Gap Crossing",
            "color": "#D97706",
            "strokeColor": "#FFFFFF"
          }
        }
      ]
    }
    ''';
    final shapes = parseGeoJsonShapes(
      bushbySample,
      datasetTitle: 'Karl Bushby Expedition',
      datasetAddress: '37515:abc:bushby',
    );
    expect(shapes.length, 1);
    expect(shapes.first.colorHex, '#D97706');
    expect(shapes.first.fillColorHex, '#D97706');
    expect(shapes.first.strokeColorHex, '#FFFFFF');
  });

  testWidgets(
      'Bottom dock extends flush to bottom edge behind rounded-screen safe area',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(412, 915);
    tester.view.devicePixelRatio = 1.0;
    tester.view.padding = const FakeViewPadding(top: 44, bottom: 34);
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      EarthlyNativeApp(
        mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
            const ColoredBox(color: Color(0xFFEDF0EA)),
      ),
    );

    final dockRect = tester.getRect(find.byKey(const Key('earthly-bottom-dock')));
    expect(dockRect.bottom, closeTo(915.0, 0.5));
    expect(find.byTooltip('Account & Session'), findsOneWidget);

    // Right-thumb map controls rail sits in lower-right thumb zone on phones
    // with strictly uniform icon-only 46x46 buttons (zero variable-width text labels!).
    final railFinder = find.byKey(const Key('earthly-right-thumb-rail'));
    final railRect = tester.getRect(railFinder);
    expect(railRect.right, greaterThan(380.0));
    expect(railRect.bottom, greaterThan(600.0));
    expect(
      find.descendant(of: railFinder, matching: find.byType(Text)),
      findsNothing,
    );
    final tooltips = find.descendant(
      of: railFinder,
      matching: find.byType(Tooltip),
    );
    expect(tooltips, findsAtLeastNWidgets(3));
    for (final el in tooltips.evaluate()) {
      final box = el.renderObject! as RenderBox;
      expect(box.size, const Size(46.0, 46.0));
    }
    expect(find.byTooltip('Measure'), findsOneWidget);
    expect(find.byTooltip('Map Style & Overlays'), findsOneWidget);
    expect(find.byTooltip('Callouts: Full'), findsOneWidget);
  });

  testWidgets(
      'EarthlyEntityListRow renders vector GeometryThumb and clean action menu without QR clutter',
      (WidgetTester tester) async {
    const sampleGeo = '''
    {
      "type": "FeatureCollection",
      "features": [
        { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [[16.36, 48.20], [16.39, 48.22]] }, "properties": {} }
      ]
    }
    ''';
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: EarthlyEntityListRow(
            leading: const EarthlyGeometryThumb(
              cacheKey: 'test-map-1',
              geojson: sampleGeo,
            ),
            title: 'Danube Cycling Route',
            meta: 'cartographer · 2d ago · 1 feat · 1 KB',
            onTap: () {},
            primaryAction: IconButton(
              onPressed: () {},
              icon: const Icon(Icons.layers_outlined),
            ),
            menuActions: [
              EntityRowMenuAction(
                label: 'Copy nostr:naddr1… link',
                icon: Icons.link,
                onSelected: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('Danube Cycling Route'), findsOneWidget);
    expect(find.byType(EarthlyGeometryThumb), findsOneWidget);
    expect(find.byIcon(Icons.qr_code_2), findsNothing);
    expect(find.byIcon(Icons.more_vert), findsOneWidget);
  });

  testWidgets(
      'ExploreSheet filters All / Favorites / Recent and AtlasDetailMargin opens Markdown & maps',
      (WidgetTester tester) async {
    final mapA = MapSummaryDto(
      address: '37515:aaa:trail-a',
      eventId: 'ev-a',
      pubkey: 'aaa',
      dTag: 'trail-a',
      title: 'Alpine Ridge Trail',
      featureCount: 5,
      sizeBytes: 2048,
      geojson: '{"type":"FeatureCollection","features":[]}',
      blobRefs: const [],
      hashtags: const ['hiking'],
      labels: const [],
      contextRefs: const ['37518:aaa:alps'],
      createdAt: BigInt.from(1791000000),
    );
    final mapB = MapSummaryDto(
      address: '37515:bbb:city-b',
      eventId: 'ev-b',
      pubkey: 'bbb',
      dTag: 'city-b',
      title: 'Vienna Cafes',
      featureCount: 12,
      sizeBytes: 4096,
      geojson: '{"type":"FeatureCollection","features":[]}',
      blobRefs: const [],
      hashtags: const ['coffee'],
      labels: const [],
      contextRefs: const [],
      createdAt: BigInt.from(1791000500),
    );
    final atlas = AtlasSummaryDto(
      address: '37518:aaa:alps',
      eventId: 'ev-atlas',
      pubkey: 'aaa',
      dTag: 'alps',
      name: 'Global Hiking Trails',
      description: '# A world of walks\n\nCurated alpine paths.',
      governance: 'open',
      pinnedAddresses: const ['37515:aaa:trail-a'],
      hashtags: const ['hiking'],
      createdAt: BigInt.from(1791000100),
    );
    final catalog = EarthlyCatalogSnapshot(
      relayUrls: const ['wss://relay.earthly.city'],
      maps: [mapA, mapB],
      stories: const [],
      atlases: [atlas],
      sightings: const [],
      beacons: const [],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              ExploreSheet(
                initialCatalog: catalog,
                catalogLoading: false,
                relayUrls: const ['wss://relay.earthly.city'],
                shelfAddresses: const <String>{},
                profilesByPubkey: const {},
                pinnedEntityIds: const {'map:37515:aaa:trail-a'},
                recentEntityIds: const ['map:37515:bbb:city-b'],
                activeAtlasLens: null,
                onCatalogLoaded: (_) {},
                onToggleFavorite: (_) {},
                onToggleMapOnShelf: (_) {},
                onAddMapsBulk: (_) {},
                onInspectMap: (_) {},
                onFocusMap: (_) {},
                onCloneMapToDraft: (_) {},
                onOpenMapDiscussion: (_) {},
                onOpenStory: (_) {},
                onOpenStoryDiscussion: (_) {},
                onInspectAtlas: (_) {},
                onOpenAtlas: (_) {},
                onEnterAtlasLens: (_) {},
                onLeaveAtlasLens: () {},
                onFocusSighting: (_) {},
                onFocusBeacon: (_) {},
                onCreateSighting: () {},
                onComposeStory: () {},
                onCreateAtlas: () {},
                onOpenBeaconBroadcaster: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('Alpine Ridge Trail'), findsOneWidget);
    expect(find.text('Vienna Cafes'), findsOneWidget);

    await tester.tap(find.text('Favorites'));
    await tester.pump();
    expect(find.text('Alpine Ridge Trail'), findsOneWidget);
    expect(find.text('Vienna Cafes'), findsNothing);

    await tester.tap(find.text('Recent'));
    await tester.pump();
    expect(find.text('Vienna Cafes'), findsOneWidget);
    expect(find.text('Alpine Ridge Trail'), findsNothing);

    // Also verify AtlasDetailMargin displays Markdown heading & linked maps.
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              AtlasDetailMargin(
                atlas: atlas,
                relayUrls: const ['wss://relay.earthly.city'],
                catalogMaps: [mapA, mapB],
                catalogStories: const [],
                shelfAddresses: const <String>{},
                profilesByPubkey: const {},
                isActiveLens: false,
                onToggleLens: () {},
                onShowAllOnMap: () {},
                onToggleMapOnShelf: (_) {},
                onFocusMap: (_) {},
                onOpenStory: (_) {},
                onOpenDiscussion: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );
    expect(find.text('Global Hiking Trails'), findsOneWidget);
    expect(find.text('A world of walks'), findsOneWidget);
    expect(find.text('Alpine Ridge Trail'), findsOneWidget);
    expect(find.text('Enter Atlas Lens'), findsOneWidget);

    // Verify DatasetDetailMargin renders feature browser & owned Edit/Delete controls.
    final richMap = MapSummaryDto(
      address: '37515:aaa:rich',
      eventId: 'ev-rich',
      pubkey: 'aaa',
      dTag: 'rich',
      title: 'Danube Waypoints',
      featureCount: 2,
      sizeBytes: 1024,
      geojson: '''
      {
        "type": "FeatureCollection",
        "features": [
          { "type": "Feature", "id": "p1", "geometry": { "type": "Point", "coordinates": [16.37, 48.20] }, "properties": { "name": "North Pier" } },
          { "type": "Feature", "id": "l1", "geometry": { "type": "LineString", "coordinates": [[16.37, 48.20], [16.39, 48.21]] }, "properties": { "name": "Towpath" } }
        ]
      }
      ''',
      blobRefs: const [],
      hashtags: const ['river'],
      labels: const [],
      contextRefs: const [],
      createdAt: BigInt.from(1791000200),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              DatasetDetailMargin(
                map: richMap,
                relayUrls: const ['wss://relay.earthly.city'],
                onShelf: true,
                isOwned: true,
                authorProfile: null,
                onToggleOnShelf: () {},
                onZoomToMap: () {},
                onJumpToFeature: (_) {},
                onEditOrForkMap: () {},
                onOpenDiscussion: () {},
                onDeleteMap: (_) => throw UnimplementedError(),
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );
    expect(find.text('Edit in Draft'), findsOneWidget);
    expect(find.text('Delete'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('North Pier'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('North Pier'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Towpath'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Towpath'), findsOneWidget);
  });

  testWidgets('EarthlyMapDrawer dismisses implicitly when swiped down past threshold',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    var closed = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              EarthlyMapDrawer(
                initialFraction: 0.50,
                onClose: () => closed = true,
                header: const Padding(
                  padding: EdgeInsets.all(8),
                  child: Text('DRAG ME DOWN'),
                ),
                body: const SizedBox.expand(),
              ),
            ],
          ),
        ),
      ),
    );

    await tester.drag(find.text('DRAG ME DOWN'), const Offset(0, 360));
    await tester.pumpAndSettle();
    expect(closed, isTrue);
  });

  testWidgets(
      'CirclesSheet renders MLS Circle list, encrypted Chat/Maps/Settings tabs, and Lens toggle',
      (WidgetTester tester) async {
    const alicePk =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const bobPk =
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const sampleGeo =
        '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[16.37,48.20]},"properties":{"name":"Base Camp"}}]}';

    final ws = CircleWorkspaceDto(
      workspaceId: 'ws-alpine-1',
      groupId: 'grp-alpine-1',
      name: 'Alpine Survey Crew',
      description: 'Private ridge mapping team',
      recommendedBasemap: 'OpenFreeMap Liberty',
      role: 'admin',
      status: 'active',
      cursor: BigInt.from(4),
      epoch: BigInt.from(2),
      coordinatorPubkey:
          'fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37',
      relays: const ['wss://relay.earthly.city'],
      members: const [alicePk, bobPk],
      administrators: const [alicePk],
      datasets: [
        CircleDatasetDto(
          workspaceId: 'ws-alpine-1',
          envelopeId: 'env-map-1',
          datasetId: 'ridge-routes',
          title: 'Ridge Routes',
          pubkey: alicePk,
          createdAt: BigInt.from(1791000000),
          geojsonJson: sampleGeo,
          featureCount: 1,
        ),
      ],
      messages: [
        CircleMessageDto(
          envelopeId: 'env-msg-1',
          pubkey: bobPk,
          createdAt: BigInt.from(1791000100),
          kind: 37517,
          text: 'Check the north saddle crossing',
          geojsonJson: sampleGeo,
          geometryFeatureCount: 1,
        ),
      ],
      createdAtMs: BigInt.from(1791000000000),
    );

    String? enteredLensId;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              CirclesSheet(
                account: const Nip55Account(pubkey: alicePk),
                localNsec: 'nsec1testlocalkey',
                bunkerUri: null,
                bunkerClientNsec: null,
                mlsDatabasePath: '/tmp/test_mls.sqlite3',
                cordnServerPubkey:
                    'fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37',
                relayUrls: const ['wss://relay.earthly.city'],
                workspaces: [ws],
                pendingJoins: const [],
                activeCircleId: null,
                mountedCircleDatasetKeys: const {},
                activeCommentOverlayId: null,
                hasDraftGeometry: true,
                profilesByPubkey: const {},
                onCordnPubkeyChanged: (_) {},
                onRefreshCircles: () async {},
                onWorkspaceUpdated: (_) {},
                onEnterCircleLens: (w) => enteredLensId = w.workspaceId,
                onLeaveCircleLens: () {},
                onToggleDatasetOnMap: (_, _) {},
                onZoomToDataset: (_, _) {},
                onEditDatasetInDraft: (_, _) {},
                onStartNewPrivateMap: (_) {},
                onToggleCommentGeometry: (_) {},
                onSendCircleComment: (_, _, _) async => ws,
                onOpenAccount: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('Alpine Survey Crew'), findsOneWidget);
    await tester.tap(find.text('Alpine Survey Crew'));
    await tester.pumpAndSettle();

    // Chat tab shows encrypted message & geometry attachment pill.
    expect(find.text('Check the north saddle crossing'), findsOneWidget);
    expect(find.text('1 geometry attached'), findsOneWidget);

    // Maps tab shows encrypted GeoJSON dataset.
    await tester.tap(find.text('Maps (1)'));
    await tester.pumpAndSettle();
    expect(find.text('Ridge Routes'), findsOneWidget);

    // Circle Lens button works.
    await tester.tap(find.byTooltip('Enter Circle Lens'));
    await tester.pump();
    expect(enteredLensId, 'ws-alpine-1');
  });

  testWidgets(
      'AccountSessionSheet shows NIP-46 Bunker connection controls and status',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              AccountSessionSheet(
                account: null,
                localNsec: null,
                bunkerUri: null,
                profile: null,
                activeSessionSummary: null,
                onAccountChanged: (_) {},
                onLocalKeyChanged: (_) {},
                onBunkerConnected: (_) {},
                onSaveProfile: (_) async => const PublishOutcomeDto(
                  eventId: 'ev',
                  outboxState: 'sent',
                  relays: [],
                ),
                onOpenSpaces: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('Connect Bunker (NIP-46)'), findsOneWidget);
    await tester.tap(find.text('Connect Bunker (NIP-46)'));
    await tester.pump();
    expect(find.text('Connect'), findsOneWidget);
  });

  testWidgets(
      'StoryComposerDrawer & AtlasComposerSheet preserve existing d-tag in edit-in-place mode',
      (WidgetTester tester) async {
    StoryPublishRequest? publishedStory;
    final existingStory = StorySummaryDto(
      address: '37520:aaa:my-story',
      eventId: 'ev-st',
      pubkey: 'aaa',
      dTag: 'my-story',
      title: 'Danube Journal',
      summary: 'Notes along the river',
      content: '# Day 1\n\nStarted in Vienna.',
      referencedAddresses: const [],
      publishedAt: BigInt.from(1791000000),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              StoryComposerDrawer(
                shelfMaps: const [],
                editingStory: existingStory,
                getCameraSnapshot: () => null,
                onPublishStory: (req) async {
                  publishedStory = req;
                  return const PublishOutcomeDto(
                    eventId: '0123456789abcdef0123456789abcdef',
                    outboxState: 'sent',
                    relays: [],
                  );
                },
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('EDIT STORY (37520)'), findsOneWidget);
    expect(find.text('Danube Journal'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Save & Update Story (37520)'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Save & Update Story (37520)'));
    await tester.pumpAndSettle();
    expect(publishedStory?.existingDTag, 'my-story');

    AtlasPublishRequest? publishedAtlas;
    final existingAtlas = AtlasSummaryDto(
      address: '37518:aaa:my-atlas',
      eventId: 'ev-at',
      pubkey: 'aaa',
      dTag: 'my-atlas',
      name: 'Vienna Cycling',
      description: 'Best protected lanes',
      governance: 'schema',
      pinnedAddresses: const [],
      hashtags: const ['cycling'],
      createdAt: BigInt.from(1791000000),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              AtlasComposerSheet(
                shelfMaps: const [],
                catalogMaps: const [],
                catalogStories: const [],
                editingAtlas: existingAtlas,
                onPublishAtlas: (req) async {
                  publishedAtlas = req;
                  return const PublishOutcomeDto(
                    eventId: '0123456789abcdef0123456789abcdef',
                    outboxState: 'sent',
                    relays: [],
                  );
                },
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('EDIT ATLAS (KIND 37518)'), findsOneWidget);
    expect(find.text('Vienna Cycling'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Save & Update Atlas (37518)'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(find.text('Save & Update Atlas (37518)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save & Update Atlas (37518)'));
    await tester.pumpAndSettle();
    expect(publishedAtlas?.existingDTag, 'my-atlas');
    expect(publishedAtlas?.governance, 'schema');
  });

  testWidgets(
      'BasemapSwitcherSheet displays mounted .atlas workspaces and unmounts cleanly',
      (WidgetTester tester) async {
    String? unmountedPath;
    final bundle = MountedAtlasWorkspaceDto(
      name: 'alps-2026.atlas',
      path: '/tmp/alps-2026.atlas',
      sizeBytes: BigInt.from(4 * 1024 * 1024),
      families: const ['tiles', 'datasets', 'terrain'],
      coverageSummary: 'alps-2026.atlas (tiles, datasets, terrain)',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BasemapSwitcherSheet(
            activeBasemap: BasemapKind.openFreeMapLiberty,
            offlineBasemap: null,
            showLabels: true,
            calloutMode: CalloutDisplayMode.full,
            mountedAtlasWorkspaces: [bundle],
            onUnmountAtlasWorkspace: (p) => unmountedPath = p,
            onSelectBasemap: (_) {},
            onLoadedOfflinePmtiles: (_) {},
            onToggleLabels: (_) {},
            onChangeCalloutMode: (_) {},
          ),
        ),
      ),
    );

    await tester.scrollUntilVisible(
      find.text('alps-2026.atlas'),
      160,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('alps-2026.atlas'), findsOneWidget);
    await tester.tap(find.byTooltip('Unmount .atlas'));
    await tester.pump();
    expect(unmountedPath, '/tmp/alps-2026.atlas');
  });

  testWidgets(
      'InboxSheet filters Proposals/Replies/Activity, shows unread count, and marks read on tap',
      (WidgetTester tester) async {
    const me =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const bob =
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    final items = [
      InboxItemDto(
        id: 'proposal:ev1',
        eventId: 'ev1',
        kind: 'proposal',
        category: 'proposals',
        actorPubkey: bob,
        createdAt: BigInt.from(1791000200),
        action: 'proposed changes to',
        thingLabel: 'Danube Route',
        preview: 'Adjusted bridge crossing',
        targetAddress: '37515:$me:danube-route',
        targetKind: 37515,
        targetTab: 'comments',
      ),
      InboxItemDto(
        id: 'reply:ev2',
        eventId: 'ev2',
        kind: 'reply',
        category: 'replies',
        actorPubkey: bob,
        createdAt: BigInt.from(1791000100),
        action: 'replied on',
        thingLabel: 'Vienna Atlas',
        preview: 'Looks great!',
        targetAddress: '37518:$me:vienna',
        targetKind: 37518,
        targetTab: 'comments',
      ),
    ];

    String? markedReadId;
    InboxItemDto? openedItem;
    var markedAll = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              InboxSheet(
                account: const Nip55Account(pubkey: me),
                items: items,
                loading: false,
                readAllBeforeSecs: 0,
                readIds: const {},
                profilesByPubkey: const {
                  bob: ProfileMetadataDto(
                    pubkey: bob,
                    displayName: 'Bob Mapper',
                  ),
                },
                pendingCircleJoinsCount: 1,
                pendingNearbyClaimsCount: 0,
                onRefresh: () async {},
                onMarkItemRead: (id) => markedReadId = id,
                onMarkAllRead: () => markedAll = true,
                onOpenItem: (item) => openedItem = item,
                onOpenPerson: (_) {},
                onOpenCircles: () {},
                onOpenSpaces: () {},
                onOpenAccount: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('2 unread'), findsOneWidget);
    expect(find.text('Adjusted bridge crossing'), findsOneWidget);
    expect(find.text('Looks great!'), findsOneWidget);

    await tester.tap(find.text('Proposals'));
    await tester.pump();
    expect(find.text('Adjusted bridge crossing'), findsOneWidget);
    expect(find.text('Looks great!'), findsNothing);

    await tester.tap(find.text('Adjusted bridge crossing'));
    await tester.pump();
    expect(markedReadId, 'proposal:ev1');
    expect(openedItem?.id, 'proposal:ev1');

    await tester.tap(find.text('Mark all read'));
    await tester.pump();
    expect(markedAll, isTrue);
  });

  testWidgets(
      'PersonMarginSheet displays author profile, NIP-05, bio, and Maps/Stories/Atlases tabs',
      (WidgetTester tester) async {
    const alice =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    final portfolio = AuthorPortfolioDto(
      pubkey: alice,
      npub: 'npub1aliceexample',
      profile: const ProfileMetadataDto(
        pubkey: alice,
        displayName: 'Alice Cartographer',
        about: 'Mapping European rivers and alpine trails.',
        nip05: 'alice@earthly.city',
      ),
      maps: [
        MapSummaryDto(
          address: '37515:$alice:danube',
          eventId: 'ev-m1',
          pubkey: alice,
          dTag: 'danube',
          title: 'Danube Bikeway',
          featureCount: 4,
          sizeBytes: 1200,
          geojson: '{"type":"FeatureCollection","features":[]}',
          blobRefs: const [],
          hashtags: const ['cycling'],
          labels: const [],
          contextRefs: const [],
          createdAt: BigInt.from(1791000000),
        ),
      ],
      stories: [
        StorySummaryDto(
          address: '37520:$alice:river-notes',
          eventId: 'ev-s1',
          pubkey: alice,
          dTag: 'river-notes',
          title: 'River Notes',
          content: '# Hello river',
          referencedAddresses: const [],
          publishedAt: BigInt.from(1791000000),
        ),
      ],
      atlases: [
        AtlasSummaryDto(
          address: '37518:$alice:waterways',
          eventId: 'ev-a1',
          pubkey: alice,
          dTag: 'waterways',
          name: 'European Waterways',
          governance: 'open',
          pinnedAddresses: const [],
          hashtags: const ['rivers'],
          createdAt: BigInt.from(1791000000),
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              PersonMarginSheet(
                pubkey: alice,
                relayUrls: const ['wss://relay.earthly.city'],
                isCurrentUser: true,
                initialProfile: portfolio.profile,
                initialPortfolio: portfolio,
                catalogMaps: const [],
                catalogStories: const [],
                catalogAtlases: const [],
                shelfAddresses: const {},
                onToggleMapOnShelf: (_) {},
                onInspectMap: (_) {},
                onFocusMap: (_) {},
                onOpenStory: (_) {},
                onInspectAtlas: (_) {},
                onEnterAtlasLens: (_) {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('Alice Cartographer'), findsOneWidget);
    expect(find.text('alice@earthly.city'), findsOneWidget);
    expect(find.text('YOU'), findsOneWidget);
    expect(find.text('Danube Bikeway'), findsOneWidget);

    await tester.tap(find.text('Stories (1)'));
    await tester.pumpAndSettle();
    expect(find.text('River Notes'), findsOneWidget);

    await tester.tap(find.text('Atlases (1)'));
    await tester.pumpAndSettle();
    expect(find.text('European Waterways'), findsOneWidget);
  });

  testWidgets(
      'StoryComposerDrawer uploads Blossom cover & inline photo and DeskSheet exposes GPX/KML export',
      (WidgetTester tester) async {
    StoryPublishRequest? published;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              StoryComposerDrawer(
                shelfMaps: const [],
                getCameraSnapshot: () => null,
                onUploadBlossomImage: (_) async => BlossomUploadDto(
                  url: 'https://blossom.earthly.city/abc123.jpg',
                  sha256: 'a' * 64,
                  sizeBytes: BigInt.from(1024),
                  mimeType: 'image/jpeg',
                ),
                onPublishStory: (req) async {
                  published = req;
                  return const PublishOutcomeDto(
                    eventId: '0123456789abcdef0123456789abcdef',
                    outboxState: 'sent',
                    relays: [],
                  );
                },
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    await tester.enterText(find.byType(TextField).first, 'Blossom Photo Story');
    await tester.tap(find.text('Cover'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('+ Upload Photo'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('+ Upload Photo'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Sign & Publish Story (37520)'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Sign & Publish Story (37520)'));
    await tester.pumpAndSettle();

    expect(published?.image, 'https://blossom.earthly.city/abc123.jpg');
    expect(
      published?.markdown,
      contains('![Photo](https://blossom.earthly.city/abc123.jpg)'),
    );

    var exportedGpx = false;
    var exportedKml = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              DeskSheet(
                activeDraftId: 'draft-1',
                savedDrafts: const [],
                relayUrls: const ['wss://relay.earthly.city'],
                draftTitle: 'Track Export Test',
                audience: DraftAudienceChoice.publicRelay,
                account: null,
                shelfMaps: const [],
                deskStories: const [],
                deskAtlases: const [],
                drawnFeatures: const [],
                onSelectDraft: (_) {},
                onCreateNewDraft: () {},
                onDeleteDraft: (_) {},
                onDraftTitleChanged: (_) {},
                onAudienceChanged: (_) {},
                onToggleShelfVisibility: (_) {},
                onRemoveShelfMap: (_) {},
                onInspectShelfMap: (_) {},
                onFlyToShelfMap: (_) {},
                onCloneShelfMapToDraft: (_) {},
                onOpenShelfDiscussion: (_) {},
                onOpenDeskStory: (_) {},
                onRemoveDeskStory: (_) {},
                onOpenDeskAtlas: (_) {},
                onRemoveDeskAtlas: (_) {},
                onRunGeoAction: (_) {},
                onPublishDraft: (_, _) async => const PublishOutcomeDto(
                  eventId: '0123456789abcdef0123456789abcdef',
                  outboxState: 'sent',
                  relays: [],
                ),
                onComposeStory: () {},
                onCreateAtlas: () {},
                onImportGeoJson: () {},
                onExportGeoJsonFile: () {},
                onExportGpxFile: () => exportedGpx = true,
                onExportKmlFile: () => exportedKml = true,
                onCopyGeoJson: () {},
                onClearDraftFeatures: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );
    await tester.scrollUntilVisible(
      find.text('Import GeoJSON / GPX / KML'),
      140,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Import GeoJSON / GPX / KML'), findsOneWidget);
    expect(find.text('Export ▾'), findsOneWidget);
    expect(exportedGpx, isFalse);
    expect(exportedKml, isFalse);
  });

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
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              AgentDrawer(
                messages: const [],
                settings: CopilotProviderSettings.offline,
                busy: false,
                safeEditing: true,
                onSafeEditingChanged: (v) => toggledSafe = v,
                pendingEdit: const PendingAiEdit(
                  proposedGeojson:
                      '{"type":"FeatureCollection","features":[]}',
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
            ],
          ),
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
      'macOS Wide Studio (>=1100px) docks left Explore + right Agent simultaneously',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      EarthlyNativeApp(
        mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
            const ColoredBox(color: Color(0xFFEDF0EA)),
      ),
    );
    await tester.pump();

    await tester.tap(find.text('Explore'));
    await tester.pumpAndSettle();
    expect(find.byType(ExploreSheet), findsOneWidget);

    await tester.ensureVisible(find.text('Agent'));
    await tester.tap(find.text('Agent'));
    await tester.pumpAndSettle();

    // BOTH left Explore margin AND right Agent Studio pane stay mounted side-by-side!
    expect(find.byType(ExploreSheet), findsOneWidget);
    expect(find.byType(AgentDrawer), findsOneWidget);

    final leftRect = tester.getRect(find.byType(ExploreSheet));
    final rightRect = tester.getRect(find.byType(AgentDrawer));
    expect(leftRect.left, lessThan(40));
    expect(rightRect.right, greaterThan(1400));
    expect(leftRect.right, lessThan(rightRect.left));
  });

  testWidgets(
      'DeskSheet exposes Undo/Redo controls and phone right-thumb rail stays strictly uniform icon-only',
      (WidgetTester tester) async {
    var undoTapped = false;
    var redoTapped = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              DeskSheet(
                activeDraftId: 'draft-1',
                savedDrafts: const [],
                relayUrls: const ['wss://relay.earthly.city'],
                draftTitle: 'Undo Test',
                audience: DraftAudienceChoice.publicRelay,
                account: null,
                shelfMaps: const [],
                deskStories: const [],
                deskAtlases: const [],
                drawnFeatures: const [],
                canUndo: true,
                canRedo: true,
                onUndo: () => undoTapped = true,
                onRedo: () => redoTapped = true,
                onSelectDraft: (_) {},
                onCreateNewDraft: () {},
                onDeleteDraft: (_) {},
                onDraftTitleChanged: (_) {},
                onAudienceChanged: (_) {},
                onToggleShelfVisibility: (_) {},
                onRemoveShelfMap: (_) {},
                onInspectShelfMap: (_) {},
                onFlyToShelfMap: (_) {},
                onCloneShelfMapToDraft: (_) {},
                onOpenShelfDiscussion: (_) {},
                onOpenDeskStory: (_) {},
                onRemoveDeskStory: (_) {},
                onOpenDeskAtlas: (_) {},
                onRemoveDeskAtlas: (_) {},
                onRunGeoAction: (_) {},
                onPublishDraft: (_, _) async => const PublishOutcomeDto(
                  eventId: '0123456789abcdef0123456789abcdef',
                  outboxState: 'sent',
                  relays: [],
                ),
                onComposeStory: () {},
                onCreateAtlas: () {},
                onImportGeoJson: () {},
                onExportGeoJsonFile: () {},
                onCopyGeoJson: () {},
                onClearDraftFeatures: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );
    await tester.scrollUntilVisible(
      find.byTooltip('Undo draft change (Cmd+Z)'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byTooltip('Undo draft change (Cmd+Z)'));
    await tester.tap(find.byTooltip('Redo draft change (Cmd+Shift+Z)'));
    await tester.pump();
    expect(undoTapped, isTrue);
    expect(redoTapped, isTrue);

    // Verify phone right-thumb rail includes GPS Track & stays 100% uniform icon-only (zero Text!)
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      EarthlyNativeApp(
        mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
            const ColoredBox(color: Color(0xFFEDF0EA)),
      ),
    );
    await tester.pump();

    final rail = find.byKey(const Key('earthly-right-thumb-rail'));
    expect(rail, findsOneWidget);
    expect(
      find.descendant(of: rail, matching: find.byType(Text)),
      findsNothing,
    );
    expect(
      find.descendant(of: rail, matching: find.byTooltip('Record GPS Track')),
      findsOneWidget,
    );
  });

  testWidgets(
      'EarthlyRichText renders GFM tables and clickable nostr:naddr1… reference pills across descriptions',
      (WidgetTester tester) async {
    String? openedNaddr;
    (double, double)? openedGeo;
    const naddr =
        'nostr:naddr1qvzqqqyj3vpzqmhhw7nckfq9ltttfke2vxg3v3q3ywcreu2gdzqgg2qdk92rnkkyqq2nw6ejgs65znt2wdhxzdzrwfm5vcjjvax5cqrfw9m';
    const atlasMarkdown = '''
## Vienna's Stadtwanderwege

| Trail | Destination | Official distance |
| --- | --- | ---: |
| 1 | [Kahlenberg]($naddr) | 11 km |

Start at geo:48.2764,16.3338 and check $naddr
''';

    await tester.pumpWidget(
      MaterialApp(
        home: EarthlyReferenceScope(
          onOpenNaddr: (uri) async => openedNaddr = uri,
          onOpenGeo: (lat, lon, _) => openedGeo = (lat, lon),
          onOpenPerson: (_) {},
          resolveNaddrTitle: (d) => d.dTag == 'kahlenberg' ? 'Kahlenberg Trail' : null,
          resolvePersonLabel: (_) => null,
          child: Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: EarthlyRichText(
                text: atlasMarkdown,
                preDecodedRefs: const {
                  naddr: DecodedNaddrDto(
                    kind: 37515,
                    pubkey: 'aaa',
                    dTag: 'kahlenberg',
                    address: '37515:aaa:kahlenberg',
                    relays: ['wss://relay.earthly.city'],
                  ),
                },
              ),
            ),
          ),
        ),
      ),
    );

    // GFM Table widget renders cleanly without raw markdown pipes or raw naddr bech32 blobs!
    expect(find.byType(Table), findsOneWidget);
    expect(find.text('Kahlenberg'), findsOneWidget);
    expect(find.text('Kahlenberg Trail'), findsOneWidget);
    expect(find.textContaining('naddr1qvzqqqyj3'), findsNothing);

    await tester.tap(find.text('Kahlenberg'));
    await tester.pump();
    expect(openedNaddr, naddr);

    await tester.tap(find.text('48.2764, 16.3338'));
    await tester.pump();
    expect(openedGeo, (48.2764, 16.3338));
  });

  testWidgets(
      'ExploreSheet places compact square New Story / New Atlas button inline on the toolbar row',
      (WidgetTester tester) async {
    var composedStory = false;
    var createdAtlas = false;
    const emptyCatalog = EarthlyCatalogSnapshot(
      relayUrls: ['wss://relay.earthly.city'],
      maps: [],
      stories: [],
      atlases: [],
      sightings: [],
      beacons: [],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              ExploreSheet(
                initialCatalog: emptyCatalog,
                catalogLoading: false,
                relayUrls: const ['wss://relay.earthly.city'],
                shelfAddresses: const {},
                profilesByPubkey: const {},
                pinnedEntityIds: const {},
                recentEntityIds: const [],
                activeAtlasLens: null,
                onCatalogLoaded: (_) {},
                onToggleFavorite: (_) {},
                onToggleMapOnShelf: (_) {},
                onAddMapsBulk: (_) {},
                onInspectMap: (_) {},
                onFocusMap: (_) {},
                onCloneMapToDraft: (_) {},
                onOpenMapDiscussion: (_) {},
                onOpenStory: (_) {},
                onOpenStoryDiscussion: (_) {},
                onInspectAtlas: (_) {},
                onOpenAtlas: (_) {},
                onEnterAtlasLens: (_) {},
                onLeaveAtlasLens: () {},
                onFocusSighting: (_) {},
                onFocusBeacon: (_) {},
                onCreateSighting: () {},
                onComposeStory: () => composedStory = true,
                onCreateAtlas: () => createdAtlas = true,
                onOpenBeaconBroadcaster: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    // Switch to Stories tab -> square 34x34 New Story button sits inline with Sort!
    await tester.tap(find.text('Stories (0)'));
    await tester.pumpAndSettle();

    final btnFinder = find.byKey(const Key('explore-new-action-btn'));
    expect(btnFinder, findsOneWidget);
    final btnRect = tester.getRect(btnFinder);
    final sortRect = tester.getRect(find.byTooltip('Sort order'));
    expect(btnRect.width, closeTo(34, 1));
    expect(btnRect.height, closeTo(34, 1));
    expect((btnRect.center.dy - sortRect.center.dy).abs(), lessThan(6));

    await tester.tap(btnFinder);
    await tester.pump();
    expect(composedStory, isTrue);

    // Switch to Atlases tab -> same square slot triggers New Atlas!
    await tester.tap(find.text('Atlases (0)'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('explore-new-action-btn')));
    await tester.pump();
    expect(createdAtlas, isTrue);
  });

  testWidgets(
      'AccountSessionSheet lists multiple saved login sessions, switches accounts, and allows adding more while signed in',
      (WidgetTester tester) async {
    const alicePk =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const bobPk =
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const aliceSession = SavedAccountSessionDto(
      id: 'local:$alicePk',
      kind: 'local',
      pubkeyHex: alicePk,
      localNsec: 'nsec1alice',
      label: 'Alice Local',
    );
    const bobSession = SavedAccountSessionDto(
      id: 'bunker:$bobPk',
      kind: 'bunker',
      pubkeyHex: bobPk,
      bunkerUri: 'bunker://$bobPk?relay=wss://relay.earthly.city',
      bunkerClientNsec: 'nsec1client',
      label: 'Bob Bunker',
    );

    SavedAccountSessionDto? switchedTo;
    String? removedId;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              AccountSessionSheet(
                account: const Nip55Account(pubkey: alicePk),
                localNsec: 'nsec1alice',
                bunkerUri: null,
                savedAccounts: const [aliceSession, bobSession],
                activeAccountId: aliceSession.id,
                profilesByPubkey: const {
                  alicePk: ProfileMetadataDto(
                    pubkey: alicePk,
                    displayName: 'Alice Field',
                  ),
                  bobPk: ProfileMetadataDto(
                    pubkey: bobPk,
                    displayName: 'Bob Studio',
                  ),
                },
                onSwitchSession: (s) => switchedTo = s,
                onRemoveSession: (id) => removedId = id,
                onAddReadOnlyNpub: (_) {},
                profile: const ProfileMetadataDto(
                  pubkey: alicePk,
                  displayName: 'Alice Field',
                ),
                activeSessionSummary: null,
                onAccountChanged: (_) {},
                onLocalKeyChanged: (_) {},
                onBunkerConnected: (_) {},
                onSaveProfile: (_) async => const PublishOutcomeDto(
                  eventId: 'ev',
                  outboxState: 'sent',
                  relays: [],
                ),
                onOpenSpaces: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    await tester.scrollUntilVisible(
      find.text('Bob Studio'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('SAVED SESSIONS (2)'), findsOneWidget);
    expect(find.text('Bob Studio'), findsOneWidget);

    await tester.ensureVisible(find.text('Switch'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Switch'));
    await tester.pump();
    expect(switchedTo?.id, bobSession.id);

    await tester.ensureVisible(find.byTooltip('Remove session').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Remove session').last);
    await tester.pump();
    expect(removedId, bobSession.id);

    await tester.scrollUntilVisible(
      find.text('ADD ANOTHER ACCOUNT'),
      140,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('ADD ANOTHER ACCOUNT'), findsOneWidget);
  });

  testWidgets(
      'AtlasDetailMargin enforces two-lane Curated vs Community governance, owner Bless/Lockdown, and muted contributor filtering',
      (WidgetTester tester) async {
    const ownerPk =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const contribPk =
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const mutedPk =
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

    final curatedMap = MapSummaryDto(
      address: '37515:$ownerPk:canon-trail',
      eventId: 'ev-canon',
      pubkey: ownerPk,
      dTag: 'canon-trail',
      title: 'Curated Alpine Spine',
      featureCount: 3,
      sizeBytes: 512,
      geojson: '{"type":"FeatureCollection","features":[]}',
      blobRefs: const [],
      hashtags: const ['alps'],
      labels: const [],
      contextRefs: const ['37518:$ownerPk:alps'],
      createdAt: BigInt.from(1791000100),
    );
    final communityMap = MapSummaryDto(
      address: '37515:$contribPk:side-valley',
      eventId: 'ev-comm',
      pubkey: contribPk,
      dTag: 'side-valley',
      title: 'Community Side Valley',
      featureCount: 2,
      sizeBytes: 400,
      geojson: '{"type":"FeatureCollection","features":[]}',
      blobRefs: const [],
      hashtags: const ['alps'],
      labels: const [],
      contextRefs: const ['37518:$ownerPk:alps'],
      createdAt: BigInt.from(1791000200),
    );
    final mutedMap = MapSummaryDto(
      address: '37515:$mutedPk:spam-map',
      eventId: 'ev-spam',
      pubkey: mutedPk,
      dTag: 'spam-map',
      title: 'Muted Spam Route',
      featureCount: 1,
      sizeBytes: 200,
      geojson: '{"type":"FeatureCollection","features":[]}',
      blobRefs: const [],
      hashtags: const [],
      labels: const [],
      contextRefs: const ['37518:$ownerPk:alps'],
      createdAt: BigInt.from(1791000300),
    );
    final openAtlas = AtlasSummaryDto(
      address: '37518:$ownerPk:alps',
      eventId: 'ev-atlas-open',
      pubkey: ownerPk,
      dTag: 'alps',
      name: 'Alpine Atlas',
      governance: 'open',
      pinnedAddresses: ['37515:$ownerPk:canon-trail'],
      hashtags: const ['alps'],
      createdAt: BigInt.from(1791000000),
    );

    String? blessedAddress;
    var lockedDown = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              AtlasDetailMargin(
                atlas: openAtlas,
                relayUrls: const ['wss://relay.earthly.city'],
                catalogMaps: [curatedMap, communityMap, mutedMap],
                catalogStories: const [],
                shelfAddresses: const {},
                profilesByPubkey: const {},
                isActiveLens: false,
                isOwned: true,
                currentUserPubkey: ownerPk,
                mutedPubkeys: const {mutedPk},
                onBlessContribution: (addr) async => blessedAddress = addr,
                onLockDownAtlas: () async => lockedDown = true,
                onToggleLens: () {},
                onShowAllOnMap: () {},
                onToggleMapOnShelf: (_) {},
                onFocusMap: (_) {},
                onOpenStory: (_) {},
                onOpenDiscussion: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('CURATED (1)'), findsOneWidget);
    expect(find.text('Curated Alpine Spine'), findsOneWidget);
    expect(find.text('COMMUNITY CONTRIBUTIONS (1)'), findsOneWidget);
    expect(find.text('Community Side Valley'), findsOneWidget);
    // Muted contributor is strictly filtered out!
    expect(find.text('Muted Spam Route'), findsNothing);

    // Owner 1-tap Bless ("Add to Curated")
    final blessFinder = find.byKey(Key('bless-${communityMap.address}'));
    await tester.ensureVisible(blessFinder);
    await tester.pumpAndSettle();
    await tester.tap(blessFinder);
    await tester.pumpAndSettle();
    expect(blessedAddress, communityMap.address);

    // Owner Lock Down -> Closed dialog
    final lockFinder = find.byKey(const Key('atlas-lockdown-btn'));
    await tester.ensureVisible(lockFinder);
    await tester.pumpAndSettle();
    await tester.tap(lockFinder);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Lock Down').last);
    await tester.pumpAndSettle();
    expect(lockedDown, isTrue);

    // When Atlas is `closed`, Community Contributions lane is completely hidden!
    final closedAtlas = AtlasSummaryDto(
      address: openAtlas.address,
      eventId: 'ev-atlas-closed',
      pubkey: ownerPk,
      dTag: 'alps',
      name: 'Alpine Atlas',
      governance: 'closed',
      pinnedAddresses: ['37515:$ownerPk:canon-trail'],
      hashtags: const ['alps'],
      createdAt: BigInt.from(1791000500),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              AtlasDetailMargin(
                atlas: closedAtlas,
                relayUrls: const ['wss://relay.earthly.city'],
                catalogMaps: [curatedMap, communityMap],
                catalogStories: const [],
                shelfAddresses: const {},
                profilesByPubkey: const {},
                isActiveLens: false,
                isOwned: true,
                onToggleLens: () {},
                onShowAllOnMap: () {},
                onToggleMapOnShelf: (_) {},
                onFocusMap: (_) {},
                onOpenStory: (_) {},
                onOpenDiscussion: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );
    expect(find.text('Curated Alpine Spine'), findsOneWidget);
    expect(find.text('Community Side Valley'), findsNothing);
    expect(
      find.text('Closed Atlas — only author-curated picks are shown.'),
      findsOneWidget,
    );
  });

  testWidgets(
      'DiscussionMarginSheet renders nested NIP-22 replies, Reply target banner, and Story Markdown diff proposals',
      (WidgetTester tester) async {
    const ownerPk =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const bobPk =
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const mutedPk =
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const storyAddr = '37520:$ownerPk:danube-journal';

    final rootComment = GeoCommentDto(
      address: '37517:$bobPk:c1',
      eventId: 'ev-c1',
      pubkey: bobPk,
      dTag: 'c1',
      text: 'Is the northern towpath paved?',
      rootAddress: storyAddr,
      parentAddress: storyAddr,
      createdAt: BigInt.from(1791000100),
    );
    final childReply = GeoCommentDto(
      address: '37517:$ownerPk:c2',
      eventId: 'ev-c2',
      pubkey: ownerPk,
      dTag: 'c2',
      text: 'Yes, fresh gravel near kilometer 12.',
      rootAddress: storyAddr,
      parentAddress: rootComment.address,
      parentEventId: rootComment.eventId,
      createdAt: BigInt.from(1791000200),
    );
    final mutedComment = GeoCommentDto(
      address: '37517:$mutedPk:c3',
      eventId: 'ev-c3',
      pubkey: mutedPk,
      dTag: 'c3',
      text: 'Hidden muted comment',
      rootAddress: storyAddr,
      parentAddress: storyAddr,
      createdAt: BigInt.from(1791000300),
    );
    final storyProposal = GeoProposalDto(
      address: '37519:$bobPk:pr-story-1',
      eventId: 'ev-pr1',
      pubkey: bobPk,
      dTag: 'pr-story-1',
      targetAddress: storyAddr,
      description: 'Add ferry schedule note',
      status: 'open',
      geojson: '',
      isStoryProposal: true,
      proposedMarkdown: '# Danube Journal\n\nFerry runs every 30 min.',
      addedCount: 1,
      modifiedCount: 0,
      removedCount: 1,
      createdAt: BigInt.from(1791000400),
    );

    GeoCommentDto? repliedToTarget;
    GeoProposalDto? appliedProposal;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              DiscussionMarginSheet(
                target: const DiscussionTarget(
                  address: storyAddr,
                  kind: 37520,
                  pubkey: ownerPk,
                  title: 'Danube Journal',
                  baseMarkdown: '# Danube Journal\n\nOld ferry line.',
                ),
                initialSnapshot: EntityDiscussionSnapshot(
                  rootAddress: storyAddr,
                  comments: [rootComment, childReply, mutedComment],
                  proposals: [storyProposal],
                ),
                relayUrls: const ['wss://relay.earthly.city'],
                hasDraftGeometry: false,
                activeCommentGeojsonId: null,
                activeProposalId: null,
                profilesByPubkey: const {
                  ownerPk: ProfileMetadataDto(pubkey: ownerPk, name: 'alice'),
                  bobPk: ProfileMetadataDto(pubkey: bobPk, name: 'bob'),
                },
                currentUserPubkey: ownerPk,
                mutedPubkeys: const {mutedPk},
                onToggleCommentOverlay: (_) {},
                onToggleProposalOverlay: (_) {},
                onPostComment: (text, attach, {replyTo}) async {
                  repliedToTarget = replyTo;
                  return const PublishOutcomeDto(
                    eventId: '0123456789abcdef',
                    outboxState: 'sent',
                    relays: [],
                  );
                },
                onSubmitProposal: (_) async => const PublishOutcomeDto(
                  eventId: '0123456789abcdef',
                  outboxState: 'sent',
                  relays: [],
                ),
                onSubmitStoryProposal: (_, _) async => const PublishOutcomeDto(
                  eventId: '0123456789abcdef',
                  outboxState: 'sent',
                  relays: [],
                ),
                onLoadProposalToDraft: (_) {},
                onApplyProposal: (p) async {
                  appliedProposal = p;
                  return const PublishOutcomeDto(
                    eventId: '0123456789abcdef',
                    outboxState: 'sent',
                    relays: [],
                  );
                },
                onCloseProposal: (_) async => const PublishOutcomeDto(
                  eventId: '0123456789abcdef',
                  outboxState: 'sent',
                  relays: [],
                ),
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    // Muted author comment is hidden; nested reply is indented!
    expect(find.text('Hidden muted comment'), findsNothing);
    expect(find.byKey(const Key('thread-indent-ev-c2')), findsOneWidget);

    // Tap Reply on root comment -> shows reply target banner & sends replyTo!
    await tester.tap(find.byKey(const Key('reply-btn-ev-c1')));
    await tester.pump();
    expect(find.byKey(const Key('reply-target-banner')), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Thanks for confirming!');
    await tester.tap(find.widgetWithText(FilledButton, 'Reply'));
    await tester.pumpAndSettle();
    expect(repliedToTarget?.eventId, 'ev-c1');

    // Switch to Proposals tab -> Story Markdown diff & Accept & Update Story!
    await tester.tap(find.text('Proposals (1)'));
    await tester.pumpAndSettle();
    expect(find.text('+1  -1 lines'), findsOneWidget);
    await tester.tap(find.byKey(const Key('story-diff-btn-ev-pr1')));
    await tester.pump();
    expect(find.byKey(const Key('story-diff-view-ev-pr1')), findsOneWidget);
    expect(find.text('+ Ferry runs every 30 min.'), findsOneWidget);
    expect(find.text('- Old ferry line.'), findsOneWidget);

    final acceptBtn = find.text('Accept & Update Story');
    await tester.ensureVisible(acceptBtn);
    await tester.pumpAndSettle();
    await tester.tap(acceptBtn);
    await tester.pumpAndSettle();
    expect(appliedProposal?.eventId, 'ev-pr1');
  });

  testWidgets(
      'EntityReactionBar toggles NIP-25 Like & shows Zap sats, and DatasetDetailMargin displays BLOSSOM BLOB badge',
      (WidgetTester tester) async {
    var toggled = false;
    final blobMap = MapSummaryDto(
      address: '37515:aaa:huge-country',
      eventId: 'ev-huge',
      pubkey: 'aaa',
      dTag: 'huge-country',
      title: 'Austria Bike Network',
      featureCount: 420,
      sizeBytes: 340000,
      geojson: '{"type":"FeatureCollection","features":[]}',
      blobRefs: [
        BlobRefDto(
          scope: 'collection',
          url: 'https://blossom.earthly.city/abc.geojson',
          sha256: 'a' * 64,
          size: BigInt.from(340000),
          mime: 'application/geo+json',
        ),
      ],
      hashtags: const ['cycling'],
      labels: const [],
      contextRefs: const [],
      createdAt: BigInt.from(1791000100),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              DatasetDetailMargin(
                map: blobMap,
                relayUrls: const ['wss://relay.earthly.city'],
                onShelf: false,
                isOwned: false,
                authorProfile: null,
                initialSocialCounts: EntitySocialCountsDto(
                  address: blobMap.address,
                  reactionCount: 7,
                  userHasReacted: false,
                  zapCount: 2,
                  zapSats: BigInt.from(2100),
                ),
                onToggleReaction: (cur) async {
                  toggled = true;
                  return EntitySocialCountsDto(
                    address: blobMap.address,
                    reactionCount: 8,
                    userHasReacted: true,
                    userReactionEventId: 'rx-1',
                    zapCount: 2,
                    zapSats: BigInt.from(2100),
                  );
                },
                onToggleOnShelf: () {},
                onZoomToMap: () {},
                onJumpToFeature: (_) {},
                onEditOrForkMap: () {},
                onOpenDiscussion: () {},
                onDeleteMap: (_) => throw UnimplementedError(),
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('BLOSSOM BLOB'), findsOneWidget);
    expect(find.byType(EntityReactionBar), findsOneWidget);
    expect(find.text('7'), findsOneWidget);
    expect(find.text('2100 sats'), findsOneWidget);

    await tester.tap(find.byKey(const Key('entity-reaction-btn')));
    await tester.pumpAndSettle();
    expect(toggled, isTrue);
    expect(find.text('8'), findsOneWidget);
  });

  test(
      'Draft GeoJSON round-trips fillColor, strokeColor, arrowheads, custom properties, callout offset/media, and collects arrowheads',
      () {
    const polyFeature = DrawnFeature(
      id: 'zone-1',
      kind: DrawToolMode.polygon,
      vertices: [
        Geographic(lon: 16.36, lat: 48.20),
        Geographic(lon: 16.38, lat: 48.20),
        Geographic(lon: 16.38, lat: 48.22),
      ],
      name: 'Alpine Meadow',
      fillColorHex: '#15803D',
      strokeColorHex: '#0F766E',
      fillOpacity: 0.4,
    );
    const lineFeature = DrawnFeature(
      id: 'route-1',
      kind: DrawToolMode.line,
      vertices: [
        Geographic(lon: 16.36, lat: 48.20),
        Geographic(lon: 16.38, lat: 48.22),
      ],
      name: 'Danube Ridge',
      description: 'Scenic **ridge** climb.',
      strokeColorHex: '#EA580C',
      strokeWidth: 4.5,
      lineDash: 'dashed',
      arrowStart: true,
      arrowEnd: true,
      customProperties: {'difficulty': 'T3', 'surface': 'gravel'},
      callouts: [
        DraftCallout(
          id: 'c-1',
          title: 'Trailhead',
          text: 'Water fountain here',
          side: 'right',
          offsetX: 28.5,
          offsetY: -16.0,
          mediaUrls: ['https://blossom.earthly.city/fountain.jpg'],
        ),
      ],
    );

    final geojson = draftFeaturesToGeoJson(
      title: 'Workbench Roundtrip',
      features: const [polyFeature, lineFeature],
    );
    final parsed = parseDraftFeaturesFromGeoJson(geojson);
    expect(parsed, hasLength(2));
    final p = parsed[0];
    expect(p.fillColorHex, '#15803D');
    expect(p.strokeColorHex, '#0F766E');

    final f = parsed[1];
    expect(f.name, 'Danube Ridge');
    expect(f.description, 'Scenic **ridge** climb.');
    expect(f.strokeColorHex, '#EA580C');
    expect(f.arrowStart, isTrue);
    expect(f.arrowEnd, isTrue);
    expect(f.customProperties['difficulty'], 'T3');
    expect(f.customProperties['surface'], 'gravel');
    expect(f.callouts, hasLength(1));
    expect(f.callouts.first.offsetX, closeTo(28.5, 1e-4));
    expect(f.callouts.first.offsetY, closeTo(-16.0, 1e-4));
    expect(
      f.callouts.first.mediaUrls,
      const ['https://blossom.earthly.city/fountain.jpg'],
    );

    final arrows = collectVisibleArrowheads(
      shelfMaps: const [],
      draftAccentColor: const Color(0xFF1F5F8B),
      draftFeatures: parsed,
    );
    expect(arrows, hasLength(2));
    expect(arrows.map((a) => a.key), containsAll([
      'draft::route-1::start',
      'draft::route-1::end',
    ]));
  });

  testWidgets(
      'FeatureInspectorSheet edits Fill/Stroke custom hex, arrowheads, searchable icons, description, custom properties, callout photo, and duplicate',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(900, 1100);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    String? updatedFill;
    String? updatedStroke;
    bool? updatedArrowEnd;
    String? updatedIcon;
    String? updatedDescription;
    Map<String, String>? updatedCustomProps;
    String? duplicatedId;
    DraftCallout? addedCallout;

    const inspectedLine = InspectedFeature(
      sourceLabel: 'Working draft',
      isDraft: true,
      draftFeatureId: 'line-42',
      geometryType: 'LineString',
      title: 'Alpine Traverse',
      properties: {
        'id': 'line-42',
        'vertices': 3,
        'strokeColor': '#1F5F8B',
        'elevation': '1850m',
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              FeatureInspectorSheet(
                feature: inspectedLine,
                onClose: () {},
                onUpdateDraftStyle: (
                  _, {
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
                  if (fillColorHex != null) updatedFill = fillColorHex;
                  if (strokeColorHex != null) updatedStroke = strokeColorHex;
                  if (arrowEnd != null) updatedArrowEnd = arrowEnd;
                  if (displayIcon != null) updatedIcon = displayIcon;
                  if (description != null) updatedDescription = description;
                  if (customProperties != null) {
                    updatedCustomProps = customProperties;
                  }
                },
                onDuplicateDraftFeature: (id) => duplicatedId = id,
                onAddDraftCallout: (_, c) => addedCallout = c,
                onUploadBlossomImage: (_) async => BlossomUploadDto(
                  url: 'https://blossom.earthly.city/callout-photo.jpg',
                  sha256: 'b' * 64,
                  sizeBytes: BigInt.from(4096),
                  mimeType: 'image/jpeg',
                ),
              ),
            ],
          ),
        ),
      ),
    );

    // 1. Custom Stroke hex on LineString
    await tester.enterText(
      find.byKey(const Key('inspector-custom-hex-field')),
      '#FF5500',
    );
    await tester.tap(find.byKey(const Key('inspector-custom-hex-apply')));
    await tester.pump();
    expect(updatedStroke, '#FF5500');

    // 2. Line arrowhead toggle
    final arrowEndBtn = find.byKey(const Key('inspector-arrow-end'));
    await tester.ensureVisible(arrowEndBtn);
    await tester.tap(arrowEndBtn);
    await tester.pump();
    expect(updatedArrowEnd, isTrue);

    // 3. Description save
    final descField = find.byKey(const Key('inspector-description-field'));
    await tester.ensureVisible(descField);
    await tester.enterText(descField, 'Updated **ridge** notes.');
    final saveDesc = find.byKey(const Key('inspector-save-description'));
    await tester.ensureVisible(saveDesc);
    await tester.tap(saveDesc);
    await tester.pump();
    expect(updatedDescription, 'Updated **ridge** notes.');

    // 4. Custom properties add
    final propKey = find.byKey(const Key('inspector-prop-key'));
    await tester.ensureVisible(propKey);
    await tester.enterText(propKey, 'grade');
    await tester.enterText(find.byKey(const Key('inspector-prop-value')), 'A+');
    await tester.tap(find.byKey(const Key('inspector-prop-add')));
    await tester.pump();
    expect(updatedCustomProps?['grade'], 'A+');
    expect(updatedCustomProps?['elevation'], '1850m');

    // 5. Add callout with Blossom photo upload
    final addCalloutChip = find.text('Add Callout');
    await tester.ensureVisible(addCalloutChip);
    await tester.tap(addCalloutChip);
    await tester.pumpAndSettle();
    final uploadBtn = find.byKey(const Key('callout-upload-photo-btn'));
    await tester.ensureVisible(uploadBtn);
    await tester.tap(uploadBtn);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Callout card text (draggable on map!)'),
      'Summit view',
    );
    final saveCalloutBtn = find.widgetWithText(FilledButton, 'Attach Callout');
    await tester.ensureVisible(saveCalloutBtn);
    await tester.tap(saveCalloutBtn);
    await tester.pump();
    expect(addedCallout?.text, 'Summit view');
    expect(
      addedCallout?.mediaUrls,
      const ['https://blossom.earthly.city/callout-photo.jpg'],
    );

    // 6. Duplicate feature
    final dupBtn = find.byKey(const Key('inspector-duplicate-btn'));
    await tester.ensureVisible(dupBtn);
    await tester.tap(dupBtn);
    await tester.pump();
    expect(duplicatedId, 'line-42');

    // 7. Fill/Stroke tabs + searchable 30-icon picker on Point feature
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              FeatureInspectorSheet(
                feature: const InspectedFeature(
                  sourceLabel: 'Working draft',
                  isDraft: true,
                  draftFeatureId: 'pt-9',
                  geometryType: 'Point',
                  title: 'Summit',
                  properties: {},
                ),
                onClose: () {},
                onUpdateDraftStyle: (
                  _, {
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
                  if (fillColorHex != null) updatedFill = fillColorHex;
                  if (displayIcon != null) updatedIcon = displayIcon;
                },
              ),
            ],
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(const Key('inspector-color-fill-tab')));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('inspector-custom-hex-field')),
      '#22AA44',
    );
    await tester.tap(find.byKey(const Key('inspector-custom-hex-apply')));
    await tester.pump();
    expect(updatedFill, '#22AA44');

    final iconSearch = find.byKey(const Key('inspector-icon-search'));
    await tester.ensureVisible(iconSearch);
    await tester.enterText(iconSearch, 'mountain');
    await tester.pump();
    final mountainChip = find.byKey(const Key('icon-chip-lucide:mountain'));
    expect(mountainChip, findsOneWidget);
    await tester.tap(mountainChip);
    await tester.pump();
    expect(updatedIcon, 'lucide:mountain');
  });

  testWidgets(
      'DeskSheet supports multi-selection, primitive shapes, paste/validate GeoJSON, and parameterized Rust workbench ops',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(900, 1100);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    String? toggledFeatureId;
    var duplicatedSelected = false;
    var deletedSelected = false;
    var pastedClipboard = false;
    (String, double)? addedPrimitive;
    (RustGeoAction, double?, double?)? lastWorkbenchOp;

    const draftFeatures = [
      DrawnFeature(
        id: 'l-1',
        kind: DrawToolMode.line,
        name: 'East Path',
        vertices: [
          Geographic(lon: 16.36, lat: 48.20),
          Geographic(lon: 16.37, lat: 48.20),
        ],
      ),
      DrawnFeature(
        id: 'l-2',
        kind: DrawToolMode.line,
        name: 'West Path',
        vertices: [
          Geographic(lon: 16.37, lat: 48.20),
          Geographic(lon: 16.38, lat: 48.20),
        ],
      ),
      DrawnFeature(
        id: 'p-1',
        kind: DrawToolMode.polygon,
        name: 'Park',
        vertices: [
          Geographic(lon: 16.36, lat: 48.20),
          Geographic(lon: 16.37, lat: 48.20),
          Geographic(lon: 16.37, lat: 48.21),
        ],
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              DeskSheet(
                activeDraftId: 'draft-wb',
                savedDrafts: const [],
                relayUrls: const ['wss://relay.earthly.city'],
                draftTitle: 'Workbench Draft',
                audience: DraftAudienceChoice.publicRelay,
                account: null,
                shelfMaps: const [],
                deskStories: const [],
                deskAtlases: const [],
                drawnFeatures: draftFeatures,
                selectedDraftFeatureIds: const {'l-1', 'l-2', 'p-1'},
                onToggleSelectDraftFeature: (id) => toggledFeatureId = id,
                onSelectAllDraftFeatures: () {},
                onClearDraftSelection: () {},
                onInspectDraftFeature: (_) {},
                onDuplicateSelectedFeatures: () => duplicatedSelected = true,
                onDeleteSelectedFeatures: () => deletedSelected = true,
                onPasteGeoJsonFromClipboard: () => pastedClipboard = true,
                onValidateDraft: () async => const DraftValidationDto(
                  valid: true,
                  featureCount: 3,
                  message: 'Valid RFC 7946 GeoJSON (3 features)',
                ),
                onAddPrimitiveShape: (shape, r) async {
                  addedPrimitive = (shape, r);
                },
                onSelectDraft: (_) {},
                onCreateNewDraft: () {},
                onDeleteDraft: (_) {},
                onDraftTitleChanged: (_) {},
                onAudienceChanged: (_) {},
                onToggleShelfVisibility: (_) {},
                onRemoveShelfMap: (_) {},
                onInspectShelfMap: (_) {},
                onFlyToShelfMap: (_) {},
                onCloneShelfMapToDraft: (_) {},
                onOpenShelfDiscussion: (_) {},
                onOpenDeskStory: (_) {},
                onRemoveDeskStory: (_) {},
                onOpenDeskAtlas: (_) {},
                onRemoveDeskAtlas: (_) {},
                onRunGeoAction: (_) {},
                onRunParameterizedGeoAction: (
                  action, {
                  meters,
                  angleDeg,
                  scale,
                }) {
                  lastWorkbenchOp = (action, meters, angleDeg);
                },
                onPublishDraft: (_, _) async => const PublishOutcomeDto(
                  eventId: '0123456789abcdef',
                  outboxState: 'sent',
                  relays: [],
                ),
                onComposeStory: () {},
                onCreateAtlas: () {},
                onImportGeoJson: () {},
                onExportGeoJsonFile: () {},
                onCopyGeoJson: () {},
                onClearDraftFeatures: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    Future<void> scrollAndTap(Finder finder) async {
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    // 1. Paste GeoJSON & Validate RFC 7946
    await scrollAndTap(find.byKey(const Key('desk-paste-geojson-btn')));
    expect(pastedClipboard, isTrue);

    await scrollAndTap(find.byKey(const Key('desk-validate-draft-btn')));
    expect(
      find.textContaining('Valid RFC 7946 GeoJSON (3 features)'),
      findsOneWidget,
    );

    // 2. Multi-selection row toggle + Duplicate / Delete selected
    await scrollAndTap(find.byKey(const Key('desk-duplicate-selected-btn')));
    await scrollAndTap(find.byKey(const Key('desk-delete-selected-btn')));
    await scrollAndTap(find.byKey(const Key('draft-feature-row-p-1')));
    expect(duplicatedSelected, isTrue);
    expect(deletedSelected, isTrue);
    expect(toggledFeatureId, 'p-1');

    // 3. Meter step preset (250m) + Primitive shape + Parameterized geo actions
    await scrollAndTap(find.byKey(const Key('workbench-meters-250')));
    await scrollAndTap(find.byKey(const Key('primitive-circle')));
    expect(addedPrimitive, ('circle', 250.0));

    await scrollAndTap(find.byKey(const Key('workbench-connect-lines')));
    expect(lastWorkbenchOp, (RustGeoAction.connectLines, 250.0, null));

    await scrollAndTap(find.byKey(const Key('workbench-inset-polygon')));
    expect(lastWorkbenchOp, (RustGeoAction.insetPolygon, 250.0, null));

    await scrollAndTap(find.byKey(const Key('workbench-rotate-selected')));
    expect(lastWorkbenchOp, (RustGeoAction.rotateSelected, 250.0, 15.0));
  });

  testWidgets(
      'BasemapSwitcherSheet switches Light/Dark theme, OpenFreeMap style, Satellite Combined overlay, and Poster PNG export',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(900, 1100);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    ThemeMode? selectedTheme;
    BasemapKind? selectedBasemap;
    MapBackgroundMode? selectedBgMode;
    double? selectedOpacity;
    var posterExported = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BasemapSwitcherSheet(
            activeBasemap: BasemapKind.auto,
            offlineBasemap: null,
            showLabels: true,
            calloutMode: CalloutDisplayMode.full,
            themeMode: ThemeMode.system,
            onThemeModeChanged: (m) => selectedTheme = m,
            backgroundMode: MapBackgroundMode.osm,
            satelliteOpacity: 0.75,
            onBackgroundModeChanged: (bg) => selectedBgMode = bg,
            onSatelliteOpacityChanged: (op) => selectedOpacity = op,
            onExportMapPosterPng: () => posterExported = true,
            onSelectBasemap: (k) => selectedBasemap = k,
            onLoadedOfflinePmtiles: (_) {},
            onToggleLabels: (_) {},
            onChangeCalloutMode: (_) {},
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('theme-mode-dark')));
    await tester.pump();
    expect(selectedTheme, ThemeMode.dark);

    await tester.tap(find.byKey(const Key('bg-mode-combined')));
    await tester.pumpAndSettle();
    expect(selectedBgMode, MapBackgroundMode.combined);
    expect(find.byKey(const Key('satellite-opacity-slider')), findsOneWidget);

    await tester.drag(
      find.byKey(const Key('satellite-opacity-slider')),
      const Offset(-80, 0),
    );
    await tester.pump();
    expect(selectedOpacity, isNotNull);

    await tester.ensureVisible(find.byKey(const Key('basemap-export-poster-btn')));
    await tester.tap(find.byKey(const Key('basemap-export-poster-btn')));
    await tester.pump();
    expect(posterExported, isTrue);

    expect(
      openFreeMapStyleUrl(BasemapKind.openFreeMapPositron, systemIsDark: false),
      'https://tiles.openfreemap.org/styles/positron',
    );
    expect(
      openFreeMapStyleUrl(BasemapKind.openFreeMapFiord, systemIsDark: false),
      'https://tiles.openfreemap.org/styles/fiord',
    );
    expect(selectedBasemap, isNull);
  });

  testWidgets(
      'StoryReaderMargin toggles Follow Text scrollytelling and renders inline vector map figures',
      (WidgetTester tester) async {
    const md = '''
## Ridge Crossing

```earthly-view
{"id":"v1","title":"Trailhead","caption":"Base camp","display":"both","camera":{"center":[16.36,48.20],"zoom":14.0}}
```
''';
    final parsed = parseStoryDocument(markdown: md);
    expect(parsed.viewSnapshots.first.step?.display, 'both');

    final story = StorySummaryDto(
      address: '37520:aaa:ridge',
      eventId: 'st-ev-1',
      pubkey: 'aaa',
      dTag: 'ridge',
      title: 'Alpine Ridge',
      content: md,
      referencedAddresses: const [],
      publishedAt: BigInt.zero,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              StoryReaderMargin(
                story: story,
                relayUrls: const ['wss://relay.earthly.city'],
                parsed: parsed,
                datasetsByAddress: const {},
                decodedRefsByToken: const {},
                loadingLinkedMaps: false,
                activeViewIndex: 0,
                calloutCount: 0,
                onSelectViewIndex: (_) {},
                onFocusDataset: (_) {},
                onActivateNaddrRef: (_) {},
                onActivateGeoRef: (_, _, _) {},
                onFitAllGeometry: () {},
                onOpenDiscussion: () {},
                onKeepOnShelf: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.byKey(const Key('story-follow-text-toggle')), findsOneWidget);
    expect(find.text('FOLLOW ON'), findsOneWidget);
    await tester.tap(find.byKey(const Key('story-follow-text-toggle')));
    await tester.pump();
    expect(find.text('FOLLOW OFF'), findsOneWidget);

    expect(find.byKey(const Key('story-inline-figure-0')), findsOneWidget);
    expect(find.textContaining('z14.0'), findsOneWidget);
  });

  testWidgets(
      'StoryComposerDrawer restores local draft and switches Write/Preview tabs',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(900, 1100);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    Map<String, dynamic>? latestDraft;
    var discarded = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              StoryComposerDrawer(
                shelfMaps: const [],
                getCameraSnapshot: () => null,
                initialDraft: const {
                  'title': 'Danube Field Log',
                  'summary': 'Water stations along the bank.',
                  'markdown': '## Stop 1\nVisited geo:48.2082,16.3738 today.',
                },
                onDraftChanged: (d) => latestDraft = d,
                onDiscardDraft: () => discarded = true,
                onPublishStory: (_) async => const PublishOutcomeDto(
                  eventId: '0123456789abcdef',
                  outboxState: 'sent',
                  relays: [],
                ),
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('DRAFT RESTORED'), findsOneWidget);
    await tester.tap(find.byKey(const Key('story-composer-preview-tab')));
    await tester.pumpAndSettle();
    expect(find.text('Danube Field Log'), findsOneWidget);
    expect(find.text('Stop 1'), findsOneWidget);

    await tester.tap(find.byKey(const Key('story-composer-write-tab')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Discard'));
    await tester.pump();
    expect(discarded, isTrue);
    expect(latestDraft, isNull);
  });

  testWidgets(
      'AccountSessionSheet exposes nostrconnect:// QR login and extended kind 0 fields (website, banner, lud16)',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(900, 1100);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    ProfileEditRequest? savedProfile;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              AccountSessionSheet(
                account: Nip55Account(pubkey: 'a' * 64),
                localNsec: null,
                profile: const ProfileMetadataDto(
                  pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  name: 'alice',
                  displayName: 'Alice Explorer',
                  website: 'https://earthly.city',
                  lud16: 'alice@getalby.com',
                ),
                activeSessionSummary: null,
                onAccountChanged: (_) {},
                onLocalKeyChanged: (_) {},
                onSaveProfile: (req) async {
                  savedProfile = req;
                  return const PublishOutcomeDto(
                    eventId: '0123456789abcdef',
                    outboxState: 'sent',
                    relays: [],
                  );
                },
                onOpenSpaces: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('https://earthly.city'), findsOneWidget);
    expect(find.text('⚡ alice@getalby.com'), findsOneWidget);

    await tester.tap(find.text('Edit Profile'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('profile-website-field')),
      'https://alice.example',
    );
    await tester.enterText(
      find.byKey(const Key('profile-lud16-field')),
      'zap@alice.example',
    );
    await tester.enterText(
      find.byKey(const Key('profile-banner-field')),
      'https://blossom.earthly.city/banner.png',
    );
    final saveBtn = find.text('Save & Publish Profile (kind 0)');
    await tester.ensureVisible(saveBtn);
    await tester.tap(saveBtn);
    await tester.pumpAndSettle();

    expect(savedProfile?.website, 'https://alice.example');
    expect(savedProfile?.lud16, 'zap@alice.example');
    expect(savedProfile?.banner, 'https://blossom.earthly.city/banner.png');

    final bunkerBtn = find.text('Connect Bunker (NIP-46)');
    await tester.ensureVisible(bunkerBtn);
    await tester.tap(bunkerBtn);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('bunker-nostrconnect-qr-btn')), findsOneWidget);
  });

  test(
      'renderEarthlyMapPosterPng outputs valid PNG and buildEarthlyWebShareUrl builds web routes',
      () async {
    expect(
      buildEarthlyWebShareUrl(kind: 37515, naddrUri: 'nostr:naddr1abc'),
      'https://earthly.city/map/naddr1abc',
    );
    expect(
      buildEarthlyWebShareUrl(kind: 37520, naddrUri: 'naddr1story'),
      'https://earthly.city/story/naddr1story',
    );
    expect(
      buildEarthlyWebShareUrl(kind: 37518, naddrUri: 'nostr:naddr1atlas'),
      'https://earthly.city/context/naddr1atlas',
    );

    final png = await renderEarthlyMapPosterPng(
      title: 'Test Poster',
      shelfMaps: const [],
      draftFeatures: const [
        DrawnFeature(
          id: 'l-1',
          kind: DrawToolMode.line,
          name: 'Ridge Path',
          arrowEnd: true,
          vertices: [
            Geographic(lon: 16.36, lat: 48.20),
            Geographic(lon: 16.38, lat: 48.22),
          ],
        ),
      ],
      width: 400,
      height: 300,
    );
    expect(png.length, greaterThan(100));
    expect(png.sublist(0, 4), [0x89, 0x50, 0x4E, 0x47]);
  });

  testWidgets(
      'PlaceSearchSheet omnibox live-filters Maps, Stories, People, inserts operator chips, and merges NIP-50 + Photon results',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    MapSummaryDto? selectedMap;
    String? nip50Queried;

    final map = MapSummaryDto(
      address: '37515:alice:danube',
      eventId: 'ev1',
      pubkey: 'alice',
      dTag: 'danube',
      title: 'Danube Bike Trail',
      description: 'Cycling route along the river',
      geojson: '{"type":"FeatureCollection","features":[]}',
      sizeBytes: 128,
      blobRefs: const [],
      hashtags: const ['cycling'],
      labels: const [],
      contextRefs: const [],
      featureCount: 4,
      createdAt: BigInt.from(1700000000),
    );
    final nip50Map = MapSummaryDto(
      address: '37515:bob:alpine',
      eventId: 'ev2',
      pubkey: 'bob',
      dTag: 'alpine',
      title: 'Alpine Ridge Pass',
      description: 'High trail',
      geojson: '{"type":"FeatureCollection","features":[]}',
      sizeBytes: 128,
      blobRefs: const [],
      hashtags: const ['hiking'],
      labels: const [],
      contextRefs: const [],
      featureCount: 2,
      createdAt: BigInt.from(1700000100),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
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
            ],
          ),
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
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    var droppedPoint = false;
    var openedOsm = false;
    MapSummaryDto? inspected;

    final nearbyMap = MapSummaryDto(
      address: '37515:alice:prater',
      eventId: 'm1',
      pubkey: 'alice',
      dTag: 'prater',
      title: 'Prater Walk',
      geojson: '{"type":"FeatureCollection","features":[]}',
      sizeBytes: 128,
      blobRefs: const [],
      hashtags: const [],
      labels: const [],
      contextRefs: const [],
      featureCount: 3,
      west: 16.38,
      south: 48.20,
      east: 16.41,
      north: 48.22,
      createdAt: BigInt.from(1700000000),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
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
            ],
          ),
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
      'DiscussionMarginSheet supports Blossom comment photo upload, per-feature Map proposal diff, and owner Request Changes',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(900, 1000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    String? requestedChangesNote;

    const baseGeo = '''
{"type":"FeatureCollection","features":[{"type":"Feature","id":"f1","properties":{"name":"Old Hut"},"geometry":{"type":"Point","coordinates":[16.37,48.21]}}]}
''';
    const proposedGeo = '''
{"type":"FeatureCollection","features":[{"type":"Feature","id":"f1","properties":{"name":"New Hut"},"geometry":{"type":"Point","coordinates":[16.37,48.21]}},{"type":"Feature","id":"f2","properties":{"name":"Ridge Spur"},"geometry":{"type":"LineString","coordinates":[[16.37,48.21],[16.38,48.22]]}}]}
''';

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              DiscussionMarginSheet(
                target: const DiscussionTarget(
                  address: '37515:owner:hutmap',
                  kind: 37515,
                  pubkey: 'owner',
                  title: 'Hut Map',
                  baseGeojson: baseGeo,
                ),
                relayUrls: const ['wss://relay.earthly.city'],
                hasDraftGeometry: false,
                activeCommentGeojsonId: null,
                activeProposalId: null,
                profilesByPubkey: const {},
                currentUserPubkey: 'owner',
                initialSnapshot: EntityDiscussionSnapshot(
                  rootAddress: '37515:owner:hutmap',
                  comments: const [],
                  proposals: [
                    GeoProposalDto(
                      address: '37519:contrib:pr1',
                      eventId: 'pr1',
                      pubkey: 'contrib',
                      dTag: 'pr1',
                      targetAddress: '37515:owner:hutmap',
                      description: 'Add Ridge Spur & rename hut',
                      geojson: proposedGeo,
                      isStoryProposal: false,
                      addedCount: 1,
                      modifiedCount: 1,
                      removedCount: 0,
                      status: 'open',
                      createdAt: BigInt.from(1700000100),
                    ),
                  ],
                ),
                onToggleCommentOverlay: (_) {},
                onToggleProposalOverlay: (_) {},
                onPostComment: (_, _, {replyTo}) async =>
                    const PublishOutcomeDto(
                  eventId: 'c1',
                  outboxState: 'sent',
                  relays: [],
                ),
                onUploadBlossomImage: () async =>
                    'https://blossom.earthly.city/photo.jpg',
                onSubmitProposal: (_) async => const PublishOutcomeDto(
                  eventId: 'p1',
                  outboxState: 'sent',
                  relays: [],
                ),
                onLoadProposalToDraft: (_) {},
                onApplyProposal: (_) async => const PublishOutcomeDto(
                  eventId: 'a1',
                  outboxState: 'sent',
                  relays: [],
                ),
                onCloseProposal: (_) async => const PublishOutcomeDto(
                  eventId: 'cl1',
                  outboxState: 'sent',
                  relays: [],
                ),
                onRequestChangesProposal: (_, note) async {
                  requestedChangesNote = note;
                  return const PublishOutcomeDto(
                    eventId: 'rc1',
                    outboxState: 'sent',
                    relays: [],
                  );
                },
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('comment-upload-photo-btn')));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('https://blossom.earthly.city/photo.jpg'),
      findsOneWidget,
    );

    await tester.tap(find.text('Proposals (1)'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('proposal-feature-diff-btn-pr1')));
    await tester.pump();
    expect(find.byKey(const Key('proposal-feature-diff-view-pr1')), findsOneWidget);
    expect(find.text('+ Ridge Spur (line, 2 pts)'), findsOneWidget);

    await tester.tap(find.byKey(const Key('proposal-request-changes-btn-pr1')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('request-changes-note-field')),
      'Please snap Ridge Spur to trail',
    );
    await tester.tap(find.byKey(const Key('request-changes-confirm-btn')));
    await tester.pumpAndSettle();
    expect(requestedChangesNote, 'Please snap Ridge Spur to trail');
  });

  testWidgets(
      'SpacesSheet probes relay health badges and syncs/publishes NIP-65 10002 relay list',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(900, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    List<String>? updatedRelays;
    List<RelayListEntryDto>? publishedRelays;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              SpacesSheet(
                account: const Nip55Account(pubkey: 'alice'),
                localNsec: null,
                relayUrls: const [
                  'wss://relay.earthly.city',
                  'wss://offline.example',
                ],
                onRelayUrlsChanged: (next) => updatedRelays = next,
                onProbeRelaysHealth: (urls) async => [
                  const RelayHealthDto(
                    url: 'wss://relay.earthly.city',
                    reachable: true,
                    latencyMs: 42,
                  ),
                  const RelayHealthDto(
                    url: 'wss://offline.example',
                    reachable: false,
                    latencyMs: 0,
                    error: 'timeout',
                  ),
                ],
                onFetchNip65Relays: () async => const [
                  RelayListEntryDto(
                    url: 'wss://nos.lol',
                    read: true,
                    write: true,
                  ),
                ],
                onPublishNip65Relays: (relays) async {
                  publishedRelays = relays;
                  return const PublishOutcomeDto(
                    eventId: 'rk1',
                    outboxState: 'sent',
                    relays: [],
                  );
                },
                onAccountChanged: (_) {},
                onLocalKeyChanged: (_) {},
                onSessionStateChanged: (_, _) {},
                onNearbySynced: () {},
                onBroadcastBeacon: (_, _, _) async => const PublishOutcomeDto(
                  eventId: 'b1',
                  outboxState: 'sent',
                  relays: [],
                ),
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    final probeBtn = find.byKey(const Key('spaces-probe-relays-btn'));
    await tester.ensureVisible(probeBtn);
    await tester.tap(probeBtn);
    await tester.pumpAndSettle();

    expect(find.text('42 ms'), findsOneWidget);
    expect(find.text('OFFLINE'), findsOneWidget);

    await tester.tap(find.byKey(const Key('spaces-sync-nip65-btn')));
    await tester.pumpAndSettle();
    expect(updatedRelays, contains('wss://nos.lol'));

    await tester.tap(find.byKey(const Key('spaces-publish-nip65-btn')));
    await tester.pumpAndSettle();
    expect(publishedRelays?.length, 2);
  });

  testWidgets(
      'OsmImportSheet queries Overpass presets and imports GeoJSON features to draft',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(420, 1300);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    String? queriedPreset;
    OsmImportResultDto? imported;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
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
            ],
          ),
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
    tester.view.physicalSize = const Size(420, 1000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    String? importedGeoJson;
    String? importedLabel;
    String? isoProfile;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
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
            ],
          ),
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
      'AtlasComposerSheet compiles Schema Builder rules and AtlasDetailMargin filters Community lane with Off/Warn/Strict',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(420, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    AtlasPublishRequest? published;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              AtlasComposerSheet(
                shelfMaps: const [],
                catalogMaps: const [],
                catalogStories: const [],
                onPublishAtlas: (req) async {
                  published = req;
                  return const PublishOutcomeDto(
                    eventId: 'atl1',
                    outboxState: 'sent',
                    relays: [],
                  );
                },
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    await tester.enterText(find.byType(TextField).first, 'Alpine Huts Schema');
    await tester.tap(find.byKey(const Key('atlas-gov-schema')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('schema-geom-Point')));
    await tester.tap(find.byKey(const Key('schema-add-field-btn')));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('schema-field-name-0')),
      'elevation',
    );
    await tester.tap(find.byKey(const Key('schema-field-req-0')));
    await tester.pump();

    final publishBtn = find.text('Publish Atlas (37518)');
    await tester.scrollUntilVisible(
      publishBtn,
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(publishBtn);
    await tester.pumpAndSettle();
    await tester.tap(publishBtn);
    await tester.pumpAndSettle();

    expect(published?.governance, 'schema');
    expect(published?.schemaJson, contains('elevation'));
    expect(decodeAtlasAllowedGeometries(published?.schemaJson), ['Point']);

    // Now test Strict -> Warn filtering on AtlasDetailMargin
    final schemaAtlas = AtlasSummaryDto(
      address: '37518:owner:huts',
      eventId: 'ev_atlas',
      pubkey: 'owner',
      dTag: 'huts',
      name: 'Alpine Huts Schema',
      governance: 'schema',
      pinnedAddresses: const [],
      hashtags: const [],
      schemaJson: published!.schemaJson,
      createdAt: BigInt.from(1700000000),
    );
    final goodMap = MapSummaryDto(
      address: '37515:alice:valid',
      eventId: 'm_good',
      pubkey: 'alice',
      dTag: 'valid',
      title: 'Valid Hut Point',
      featureCount: 1,
      sizeBytes: 120,
      geojson:
          '{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[11.4,47.2]},"properties":{"elevation":"2100m"}}]}',
      blobRefs: const [],
      hashtags: const [],
      labels: const [],
      contextRefs: const ['37518:owner:huts'],
      createdAt: BigInt.from(1700000100),
    );
    final badMap = MapSummaryDto(
      address: '37515:bob:invalid',
      eventId: 'm_bad',
      pubkey: 'bob',
      dTag: 'invalid',
      title: 'Invalid Trail Line',
      featureCount: 1,
      sizeBytes: 120,
      geojson:
          '{"type":"FeatureCollection","features":[{"type":"Feature","id":"l1","geometry":{"type":"LineString","coordinates":[[11.4,47.2],[11.5,47.3]]},"properties":{}}]}',
      blobRefs: const [],
      hashtags: const [],
      labels: const [],
      contextRefs: const ['37518:owner:huts'],
      createdAt: BigInt.from(1700000050),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              AtlasDetailMargin(
                atlas: schemaAtlas,
                relayUrls: const ['wss://relay.earthly.city'],
                catalogMaps: [goodMap, badMap],
                catalogStories: const [],
                shelfAddresses: const {},
                profilesByPubkey: const {},
                isActiveLens: false,
                onToggleLens: () {},
                onShowAllOnMap: () {},
                onToggleMapOnShelf: (_) {},
                onFocusMap: (_) {},
                onOpenStory: (_) {},
                onOpenDiscussion: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Valid Hut Point'), findsOneWidget);
    expect(find.text('Invalid Trail Line'), findsNothing);
    expect(find.textContaining('1 map(s) hidden by Strict schema filter'), findsOneWidget);

    await tester.tap(find.byKey(const Key('atlas-schema-filter-warn')));
    await tester.pumpAndSettle();
    expect(find.text('Invalid Trail Line'), findsOneWidget);
    expect(find.textContaining('missing required `elevation`'), findsOneWidget);
  });

  testWidgets(
      'StoryComposerDrawer opens StoryViewBlockEditorDialog and inserts canonical earthly-view JSON',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(480, 1000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              StoryComposerDrawer(
                shelfMaps: const [],
                getCameraSnapshot: () => const CameraPosition(
                  center: Geographic(lon: 16.3738, lat: 48.2082),
                  zoom: 14.0,
                  bearing: 0.0,
                  pitch: 0.0,
                ),
                onPublishStory: (_) async => const PublishOutcomeDto(
                  eventId: 'st1',
                  outboxState: 'sent',
                  relays: [],
                ),
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    await tester.ensureVisible(find.byKey(const Key('story-insert-view-block-btn')));
    await tester.tap(find.byKey(const Key('story-insert-view-block-btn')));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('view-editor-title')),
      'Stephansdom Overview',
    );
    await tester.tap(find.byKey(const Key('view-editor-display-figure')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('view-editor-insert-btn')));
    await tester.pumpAndSettle();

    expect(find.textContaining('Stephansdom Overview'), findsOneWidget);
    expect(find.textContaining('```earthly-view'), findsOneWidget);
    expect(find.textContaining('"display": "figure"'), findsOneWidget);
  });

  testWidgets(
      'ExploreSheet renders People directory tab with entity counts and triggers onOpenPerson',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    String? openedPubkey;
    final catalog = EarthlyCatalogSnapshot(
      relayUrls: const ['wss://relay.earthly.city'],
      maps: [
        MapSummaryDto(
          address: '37515:alicepk:m1',
          eventId: 'm1',
          pubkey: 'alicepk',
          dTag: 'm1',
          title: 'Trail 1',
          featureCount: 2,
          sizeBytes: 100,
          geojson: '{"type":"FeatureCollection","features":[]}',
          blobRefs: const [],
          hashtags: const [],
          labels: const [],
          contextRefs: const [],
          createdAt: BigInt.from(1700000000),
        ),
      ],
      stories: const [],
      atlases: const [],
      sightings: const [],
      beacons: const [],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              ExploreSheet(
                initialCatalog: catalog,
                catalogLoading: false,
                relayUrls: const ['wss://relay.earthly.city'],
                shelfAddresses: const {},
                profilesByPubkey: const {
                  'alicepk': ProfileMetadataDto(
                    pubkey: 'alicepk',
                    name: 'alice',
                    displayName: 'Alice Cartographer',
                    nip05: 'alice@earthly.city',
                  ),
                },
                pinnedEntityIds: const {},
                recentEntityIds: const [],
                activeAtlasLens: null,
                onCatalogLoaded: (_) {},
                onToggleFavorite: (_) {},
                onToggleMapOnShelf: (_) {},
                onAddMapsBulk: (_) {},
                onInspectMap: (_) {},
                onFocusMap: (_) {},
                onCloneMapToDraft: (_) {},
                onOpenMapDiscussion: (_) {},
                onOpenStory: (_) {},
                onOpenStoryDiscussion: (_) {},
                onInspectAtlas: (_) {},
                onOpenAtlas: (_) {},
                onEnterAtlasLens: (_) {},
                onLeaveAtlasLens: () {},
                onFocusSighting: (_) {},
                onFocusBeacon: (_) {},
                onCreateSighting: () {},
                onComposeStory: () {},
                onCreateAtlas: () {},
                onOpenBeaconBroadcaster: () {},
                onOpenPerson: (pk) => openedPubkey = pk,
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    await tester.ensureVisible(find.byKey(const Key('explore-tab-people')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('explore-tab-people')));
    await tester.pumpAndSettle();

    expect(find.text('Alice Cartographer'), findsOneWidget);
    expect(find.text('alice@earthly.city · 1 maps'), findsOneWidget);

    await tester.tap(find.byKey(const Key('explore-person-alicepk')));
    await tester.pump();
    expect(openedPubkey, 'alicepk');
  });

  testWidgets(
      'RawEventInspectorDialog and HelpShortcutsSheet render cleanly without overflows',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(420, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (ctx) => Stack(
              children: [
                HelpShortcutsSheet(onClose: () {}),
                Positioned(
                  top: 8,
                  left: 8,
                  child: TextButton(
                    key: const Key('open-raw-inspector-test-btn'),
                    onPressed: () => showRawEventInspectorDialog(
                      ctx,
                      kind: 37515,
                      title: 'Raw Test Map',
                      eventId: 'ev123',
                      pubkey: 'pk123',
                      address: '37515:pk123:test',
                      dTag: 'test',
                      payloadLabel: 'GeoJSON Content',
                      payloadContent: '{"type":"FeatureCollection","features":[]}',
                    ),
                    child: const Text('Inspect'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    expect(find.text('HELP & KEYBOARD SHORTCUTS'), findsOneWidget);
    expect(find.text('Cmd / Ctrl + Z'), findsOneWidget);

    await tester.tap(find.byKey(const Key('open-raw-inspector-test-btn')));
    await tester.pumpAndSettle();
    expect(find.text('RAW EVENT INSPECTOR (KIND 37515)'), findsOneWidget);
    expect(find.byKey(const Key('raw-inspector-copy-btn')), findsOneWidget);
  });
}
