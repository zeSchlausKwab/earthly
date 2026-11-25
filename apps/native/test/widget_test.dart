import 'package:earthly_native/main.dart';
import 'package:earthly_native/nostr/callout_overlay.dart';
import 'package:earthly_native/nostr/shelf_renderer.dart';
import 'package:earthly_native/nostr/story_presentation.dart';
import 'package:earthly_native/shell/basemap_switcher_sheet.dart';
import 'package:earthly_native/shell/map_drawer.dart';
import 'package:earthly_native/shell/qr_code_view.dart';
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
}
