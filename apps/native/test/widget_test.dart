import 'package:earthly_native/main.dart';
import 'package:earthly_native/nostr/callout_overlay.dart';
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
import 'package:earthly_native/shell/earthly_rich_text.dart';
import 'package:earthly_native/shell/entity_list_row.dart';
import 'package:earthly_native/shell/explore_sheet.dart';
import 'package:earthly_native/shell/inbox_sheet.dart';
import 'package:earthly_native/shell/map_drawer.dart';
import 'package:earthly_native/shell/person_margin.dart';
import 'package:earthly_native/shell/qr_code_view.dart';
import 'package:earthly_native/shell/story_composer_sheet.dart';
import 'package:earthly_native/src/rust/api/agent.dart';
import 'package:earthly_native/src/rust/api/blossom.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:earthly_native/src/rust/api/private_groups.dart';
import 'package:earthly_native/src/rust/api/publish.dart';
import 'package:earthly_native/src/rust/api/settings.dart';
import 'package:flutter_test/flutter_test.dart';
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
}
