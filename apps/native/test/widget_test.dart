import 'package:earthly_native/main.dart';
import 'package:earthly_native/runtime/device_bridge.dart';
import 'package:earthly_native/shell/agent_drawer.dart';
import 'package:earthly_native/shell/explore_sheet.dart';
import 'package:earthly_native/shell/map_drawer.dart';
import 'package:earthly_native/shell/qr_code_view.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

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

  testWidgets(
      'EarthlyMapDrawer scrolls body independently of 50/50 height and renders QR',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(400, 800));

    double? reportedFraction;
    await tester.pumpWidget(
      wrapSheetInStack(
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

  testWidgets(
      'Bottom dock extends flush to bottom edge behind rounded-screen safe area',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(412, 915));
    tester.view.padding = const FakeViewPadding(top: 44, bottom: 34);

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
      'EarthlyMapDrawer dismisses implicitly when swiped down past threshold',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(400, 800));

    var closed = false;
    await tester.pumpWidget(
      wrapSheetInStack(
        EarthlyMapDrawer(
          initialFraction: 0.50,
          onClose: () => closed = true,
          header: const Padding(
            padding: EdgeInsets.all(8),
            child: Text('DRAG ME DOWN'),
          ),
          body: const SizedBox.expand(),
        ),
      ),
    );

    await tester.drag(find.text('DRAG ME DOWN'), const Offset(0, 360));
    await tester.pumpAndSettle();
    expect(closed, isTrue);
  });

  testWidgets(
      'macOS Wide Studio (>=1100px) docks left Explore + right Agent simultaneously',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(1440, 900));

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
      'DeviceBridge invokes getOrCreateMasterKey and macOS security-scoped bookmark channel methods',
      (WidgetTester tester) async {
    const channel = MethodChannel('city.earthly/device');
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      switch (call.method) {
        case 'getOrCreateMasterKey':
          return 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
        case 'createSecurityScopedBookmark':
          return 'Ym9va21hcms=';
        case 'resolveSecurityScopedBookmark':
          return '/Users/test/Maps/city.atlas';
        default:
          return null;
      }
    });
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    });

    final key = await DeviceBridge.getOrCreateMasterKey();
    final bookmark = await DeviceBridge.createSecurityScopedBookmark(
      '/Users/test/Maps/city.atlas',
    );
    final resolved = await DeviceBridge.resolveSecurityScopedBookmark(
      bookmark!,
    );

    expect(key, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    expect(bookmark, 'Ym9va21hcms=');
    expect(resolved, '/Users/test/Maps/city.atlas');
    expect(
      calls.map((c) => c.method).toList(),
      [
        'getOrCreateMasterKey',
        'createSecurityScopedBookmark',
        'resolveSecurityScopedBookmark',
      ],
    );
    expect(
      calls[1].arguments,
      {'path': '/Users/test/Maps/city.atlas'},
    );
    expect(
      calls[2].arguments,
      {'bookmark': 'Ym9va21hcms='},
    );

    // MissingPluginException returns null cleanly.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      channel,
      (call) async => throw MissingPluginException(),
    );
    expect(await DeviceBridge.getOrCreateMasterKey(), isNull);
    expect(await DeviceBridge.createSecurityScopedBookmark('/tmp/x'), isNull);
    expect(
      await DeviceBridge.resolveSecurityScopedBookmark('Ym9va21hcms='),
      isNull,
    );
  });
}
