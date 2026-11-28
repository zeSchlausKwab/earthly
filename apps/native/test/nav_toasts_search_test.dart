import 'package:earthly_native/controllers/catalog_shelf_controller.dart';
import 'package:earthly_native/controllers/draft_workbench_controller.dart';
import 'package:earthly_native/main.dart';
import 'package:earthly_native/shell/atlas_detail_margin.dart';
import 'package:earthly_native/shell/cashu_wallet_sheet.dart';
import 'package:earthly_native/shell/circles_sheet.dart';
import 'package:earthly_native/shell/dataset_detail_margin.dart';
import 'package:earthly_native/shell/desk_sheet.dart';
import 'package:earthly_native/shell/drawer_navigation.dart';
import 'package:earthly_native/shell/earthly_toast.dart';
import 'package:earthly_native/shell/explore_sheet.dart';
import 'package:earthly_native/shell/feature_inspector_sheet.dart';
import 'package:earthly_native/shell/inbox_sheet.dart';
import 'package:earthly_native/shell/outbox_queue_sheet.dart';
import 'package:earthly_native/shell/place_search_sheet.dart';
import 'package:earthly_native/shell/settings_sheet.dart';
import 'package:earthly_native/shell/spaces_sheet.dart';
import 'package:earthly_native/shell/story_reader_margin.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:earthly_native/theme/earthly_theme.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

void main() {
  const geoVienna = '''
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "id": "line-1",
        "geometry": { "type": "LineString", "coordinates": [[16.36, 48.20], [16.39, 48.22]] },
        "properties": { "name": "Danube Path" }
      }
    ]
  }
  ''';

  const geoGraz = '''
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "id": "pt-1",
        "geometry": { "type": "Point", "coordinates": [15.44, 47.07] },
        "properties": { "name": "Schlossberg" }
      }
    ]
  }
  ''';

  EarthlyCatalogSnapshot makeRichCatalog() {
    final mapVienna = makeTestMap(
      address: '37515:alice:danube-loop',
      eventId: 'ev-vienna',
      pubkey: 'alice',
      dTag: 'danube-loop',
      title: 'Danube River Loop',
      geojson: geoVienna,
      west: 16.36,
      south: 48.20,
      east: 16.39,
      north: 48.22,
      featureCount: 1,
      createdAt: BigInt.from(1791000900),
    );
    // Deliberately omit explicit bbox to prove GeoJSON shape fallback bounds work too!
    final mapGraz = makeTestMap(
      address: '37515:bob:graz-walk',
      eventId: 'ev-graz',
      pubkey: 'bob',
      dTag: 'graz-walk',
      title: 'Graz Schlossberg Walk',
      geojson: geoGraz,
      featureCount: 1,
      createdAt: BigInt.from(1791000800),
    );
    final storyVienna = StorySummaryDto(
      address: '37520:alice:vienna-journal',
      eventId: 'st-vienna',
      pubkey: 'alice',
      dTag: 'vienna-journal',
      title: 'Danube Field Journal',
      summary: 'Notes along the river canal.',
      content: '# Vienna\n\nExploring the Danube.',
      referencedAddresses: const ['37515:alice:danube-loop'],
      publishedAt: BigInt.from(1791000900),
    );
    final atlasAustria = AtlasSummaryDto(
      address: '37518:alice:austria-trails',
      eventId: 'at-austria',
      pubkey: 'alice',
      dTag: 'austria-trails',
      name: 'Austria Trails Atlas',
      description: 'Curated Austrian loops.',
      governance: 'closed',
      pinnedAddresses: const ['37515:alice:danube-loop', '37515:bob:graz-walk'],
      hashtags: const ['austria'],
      createdAt: BigInt.from(1791000900),
    );
    final sightingBridge = SightingSummaryDto(
      address: '37522:carol:danube-heron',
      eventId: 'sg-1',
      pubkey: 'carol',
      dTag: 'danube-heron',
      title: 'Danube Heron Sighting',
      note: 'Spotted near the northern footbridge',
      lon: 16.405,
      lat: 48.231,
      start: BigInt.from(1791000950),
    );
    return EarthlyCatalogSnapshot(
      relayUrls: const ['wss://relay.earthly.city'],
      maps: [mapVienna, mapGraz],
      stories: [storyVienna],
      atlases: [atlasAustria],
      sightings: [sightingBridge],
      beacons: const [],
    );
  }

  group('EarthlyToast auto-decay, countdown bar, swipe/close & error copy', () {
    testWidgets(
      'auto-dismisses published toast with Reopen action via smooth countdown bar and never stays stuck',
      (WidgetTester tester) async {
        setTestViewport(tester, const Size(390, 844));
        final controller = EarthlyToastController();
        addTearDown(controller.dispose);

        var reopened = false;
        await tester.pumpWidget(
          MaterialApp(
            theme: buildEarthlyTheme(Brightness.dark),
            home: EarthlyToastScope(
              controller: controller,
              child: Scaffold(
                body: Stack(
                  fit: StackFit.expand,
                  children: [
                    const SizedBox.expand(),
                    EarthlyToastOverlay(controller: controller),
                  ],
                ),
              ),
            ),
          ),
        );

        controller.showSuccess(
          'Published "map" in "MLS group"',
          actionLabel: 'Reopen',
          onAction: () => reopened = true,
        );
        await tester.pump();

        expect(find.byKey(const Key('earthly-toast-card')), findsOneWidget);
        expect(find.text('Published "map" in "MLS group"'), findsOneWidget);
        expect(find.byKey(const Key('earthly-toast-action-btn')), findsOneWidget);
        expect(find.byKey(const Key('earthly-toast-progress-bar')), findsOneWidget);
        expect(find.byKey(const Key('earthly-toast-copy-btn')), findsNothing);

        // Countdown progress bar starts full, drains smoothly, and dismisses
        // cleanly at the end of the 4s total duration — even with Reopen!
        double barFactor() {
          final box = tester.widget<FractionallySizedBox>(
            find.descendant(
              of: find.byKey(const Key('earthly-toast-progress-bar')),
              matching: find.byType(FractionallySizedBox),
            ),
          );
          return box.widthFactor!;
        }

        expect(barFactor(), closeTo(1.0, 0.05));

        // Advance past brief entrance reading hold (750ms), then halfway through
        // the 3250ms smooth countdown bar animation.
        await tester.pump(const Duration(milliseconds: 800));
        await tester.pump(const Duration(milliseconds: 1625));
        expect(barFactor(), closeTo(0.5, 0.08));
        expect(find.byKey(const Key('earthly-toast-card')), findsOneWidget);

        // After full 4s duration elapses, toast auto-dismisses cleanly even with action!
        await tester.pump(const Duration(milliseconds: 1700));
        await tester.pump();
        expect(find.byKey(const Key('earthly-toast-card')), findsNothing);
        expect(controller.current, isNull);
        expect(reopened, isFalse);

        // Tapping Reopen triggers action callback and dismisses immediately.
        controller.showSuccess(
          'Published "map" in "MLS group"',
          actionLabel: 'Reopen',
          onAction: () => reopened = true,
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('earthly-toast-action-btn')));
        await tester.pump();
        expect(reopened, isTrue);
        expect(find.byKey(const Key('earthly-toast-card')), findsNothing);
      },
    );

    testWidgets(
      'error toast includes one-tap Copy button with Copied feedback, zero overflow at 360px, and supports close + swipe dismiss',
      (WidgetTester tester) async {
        setTestViewport(tester, const Size(360, 800));
        final controller = EarthlyToastController();
        addTearDown(controller.dispose);

        String? copiedClipboard;
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          (MethodCall call) async {
            if (call.method == 'Clipboard.setData') {
              copiedClipboard = (call.arguments as Map)['text'] as String?;
            }
            return null;
          },
        );
        addTearDown(
          () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            SystemChannels.platform,
            null,
          ),
        );

        await tester.pumpWidget(
          MaterialApp(
            theme: buildEarthlyTheme(Brightness.light),
            home: EarthlyToastScope(
              controller: controller,
              child: Scaffold(
                body: Stack(
                  fit: StackFit.expand,
                  children: [
                    const SizedBox.expand(),
                    EarthlyToastOverlay(controller: controller),
                  ],
                ),
              ),
            ),
          ),
        );

        const fullError =
            'Publish failed: relay wss://relay.earthly.city rejected event (rate-limit exceeded on kind 37515)';
        controller.showError(fullError);
        await tester.pump();

        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('earthly-toast-copy-btn')), findsOneWidget);
        expect(find.text('Copy'), findsOneWidget);

        await tester.tap(find.byKey(const Key('earthly-toast-copy-btn')));
        await tester.pump();
        expect(copiedClipboard, fullError);
        expect(find.text('Copied'), findsOneWidget);

        // Close button dismisses cleanly.
        await tester.tap(find.byKey(const Key('earthly-toast-close-btn')));
        await tester.pump();
        expect(find.byKey(const Key('earthly-toast-card')), findsNothing);

        // Horizontal swipe dismisses cleanly.
        controller.showWarning('Relay offline — retrying soon');
        await tester.pump();
        expect(find.byKey(const Key('earthly-toast-card')), findsOneWidget);
        await tester.drag(
          find.byKey(const Key('earthly-toast-card')),
          const Offset(320, 0),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('earthly-toast-card')), findsNothing);
      },
    );

    testWidgets(
      'EarthlyToast static fallback works via Overlay in standalone screens without EarthlyToastScope',
      (WidgetTester tester) async {
        await tester.pumpWidget(
          MaterialApp(
            theme: buildEarthlyTheme(Brightness.light),
            home: Scaffold(
              body: Builder(
                builder: (ctx) => Center(
                  child: FilledButton(
                    onPressed: () =>
                        EarthlyToast.success(ctx, 'Copied nostr:naddr1… link'),
                    child: const Text('Copy'),
                  ),
                ),
              ),
            ),
          ),
        );

        await tester.tap(find.text('Copy'));
        await tester.pumpAndSettle();
        // Remains visible immediately after entrance + button ripple settle.
        expect(find.text('Copied nostr:naddr1… link'), findsOneWidget);

        // Auto-decays and removes OverlayEntry cleanly after the 4s duration.
        await tester.pump(const Duration(seconds: 4));
        await tester.pump();
        expect(find.text('Copied nostr:naddr1… link'), findsNothing);
      },
    );
  });

  group('DrawerNavigationController unit tests', () {
    test('pushes sub-drawers onto history stack and pops back step-by-step on mobile',
        () {
      var now = DateTime(2026, 11, 28, 12, 0, 0);
      final nav = DrawerNavigationController(clock: () => now);
      addTearDown(nav.dispose);

      // Desk -> Outbox -> Back -> Desk -> Back -> root map
      nav.toggleRoot(EarthlyDrawer.desk, isWideStudio: false);
      expect(nav.left, EarthlyDrawer.desk);
      expect(nav.canGoBackFrom(EarthlyDrawer.desk, isWideStudio: false), isFalse);

      nav.open(EarthlyDrawer.outbox, isWideStudio: false);
      expect(nav.left, EarthlyDrawer.outbox);
      expect(nav.leftHistory, [EarthlyDrawer.desk]);
      expect(
        nav.canGoBackFrom(EarthlyDrawer.outbox, isWideStudio: false),
        isTrue,
      );

      final back1 = nav.handleBack(isWideStudio: false);
      expect(back1.action, DrawerBackAction.poppedToPreviousDrawer);
      expect(back1.leavingDrawer, EarthlyDrawer.outbox);
      expect(back1.restoredDrawer, EarthlyDrawer.desk);
      expect(nav.left, EarthlyDrawer.desk);
      expect(nav.leftHistory, isEmpty);

      final back2 = nav.handleBack(isWideStudio: false);
      expect(back2.action, DrawerBackAction.closedRootDrawer);
      expect(back2.leavingDrawer, EarthlyDrawer.desk);
      expect(nav.left, EarthlyDrawer.none);

      // Root map double-back confirmation window (2.5s)
      final rootBack1 = nav.handleBack(isWideStudio: false);
      expect(rootBack1.action, DrawerBackAction.armExitToast);

      // Expired after 3s -> re-arms instead of exiting
      now = now.add(const Duration(seconds: 3));
      final rootBackExpired = nav.handleBack(isWideStudio: false);
      expect(rootBackExpired.action, DrawerBackAction.armExitToast);

      // Second Back within 1.2s -> exits cleanly!
      now = now.add(const Duration(milliseconds: 1200));
      final rootBackExit = nav.handleBack(isWideStudio: false);
      expect(rootBackExit.action, DrawerBackAction.exitApp);
    });

    test('maintains independent left & right stacks on Wide Studio desktop', () {
      final nav = DrawerNavigationController();
      addTearDown(nav.dispose);

      nav.toggleRoot(EarthlyDrawer.explore, isWideStudio: true);
      nav.open(EarthlyDrawer.datasetDetail, isWideStudio: true);
      nav.open(EarthlyDrawer.discussion, isWideStudio: true);

      expect(nav.left, EarthlyDrawer.explore);
      expect(nav.right, EarthlyDrawer.discussion);
      expect(nav.rightHistory, [EarthlyDrawer.datasetDetail]);

      // Back pops right history first (Discussion -> DatasetDetail), keeping Explore open!
      final r1 = nav.handleBack(isWideStudio: true);
      expect(r1.action, DrawerBackAction.poppedToPreviousDrawer);
      expect(nav.right, EarthlyDrawer.datasetDetail);
      expect(nav.left, EarthlyDrawer.explore);

      // Next Back closes right root drawer (DatasetDetail), keeping Explore open!
      final r2 = nav.handleBack(isWideStudio: true);
      expect(r2.action, DrawerBackAction.closedRootDrawer);
      expect(nav.right, EarthlyDrawer.none);
      expect(nav.left, EarthlyDrawer.explore);

      // Next Back closes left root drawer (Explore)
      final r3 = nav.handleBack(isWideStudio: true);
      expect(r3.action, DrawerBackAction.closedRootDrawer);
      expect(nav.left, EarthlyDrawer.none);
    });
  });

  group('Native Back / PopScope & Header Back Buttons in EarthlySpikeHome', () {
    testWidgets(
      'Desk -> Outbox shows header Back button and system Back returns Desk -> Map -> double-back exit toast',
      (WidgetTester tester) async {
        setTestViewport(tester, const Size(412, 915));
        var now = DateTime(2026, 11, 28, 12, 0, 0);
        var exitCalled = 0;
        final toastController = EarthlyToastController();
        final drawerNav = DrawerNavigationController(clock: () => now);
        addTearDown(() {
          toastController.dispose();
          drawerNav.dispose();
        });

        await tester.pumpWidget(
          MaterialApp(
            theme: buildEarthlyTheme(Brightness.light),
            home: EarthlySpikeHome(
              mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
                  const ColoredBox(color: Color(0xFFEDF0EA)),
              toastController: toastController,
              drawerNavigationController: drawerNav,
              onExitAppRequested: () => exitCalled += 1,
              clock: () => now,
            ),
          ),
        );
        await tester.pump();

        // Open Desk -> navigate to Outbox Queue
        await tester.tap(find.text('Desk'));
        await tester.pumpAndSettle();
        expect(find.byType(DeskSheet), findsOneWidget);

        drawerNav.open(EarthlyDrawer.outbox, isWideStudio: false);
        await tester.pumpAndSettle();
        expect(find.byType(OutboxQueueSheet), findsOneWidget);
        expect(find.byKey(const Key('outbox-back-btn')), findsOneWidget);

        // Tap header <- Back arrow -> returns directly to Desk!
        await tester.tap(find.byKey(const Key('outbox-back-btn')));
        await tester.pumpAndSettle();
        expect(find.byType(DeskSheet), findsOneWidget);
        expect(find.byType(OutboxQueueSheet), findsNothing);

        // Re-open Outbox, then test hardware Back / left-edge swipe via PopScope!
        drawerNav.open(EarthlyDrawer.outbox, isWideStudio: false);
        await tester.pumpAndSettle();
        expect(find.byType(OutboxQueueSheet), findsOneWidget);

        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(DeskSheet), findsOneWidget);
        expect(exitCalled, 0);

        // System Back at root Desk -> closes Desk to reveal full map
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(DeskSheet), findsNothing);
        expect(drawerNav.hasAnyOpenDrawer, isFalse);
        expect(exitCalled, 0);

        // System Back at root map -> shows 2.5s "Press back again to exit" toast
        await tester.binding.handlePopRoute();
        await tester.pump();
        expect(find.text('Press back again to exit'), findsOneWidget);
        expect(exitCalled, 0);

        // Waiting 2.6s lets the exit toast auto-decay cleanly!
        await tester.pump(const Duration(milliseconds: 2600));
        await tester.pump();
        expect(find.text('Press back again to exit'), findsNothing);

        // Back again after 3s re-arms toast instead of exiting.
        now = now.add(const Duration(seconds: 3));
        await tester.binding.handlePopRoute();
        await tester.pump();
        expect(find.text('Press back again to exit'), findsOneWidget);
        expect(exitCalled, 0);

        // Second Back within 1s triggers clean exit!
        now = now.add(const Duration(seconds: 1));
        await tester.binding.handlePopRoute();
        await tester.pump();
        expect(exitCalled, 1);
      },
    );

    testWidgets(
      'Back priority pops Navigator modal first, then cancels active drawing stroke/mode, then pops Spaces -> Inbox / Wallet',
      (WidgetTester tester) async {
        setTestViewport(tester, const Size(412, 915));
        final draft = DraftWorkbenchController();
        final drawerNav = DrawerNavigationController();
        var exitCalled = 0;
        addTearDown(() {
          draft.dispose();
          drawerNav.dispose();
        });

        await tester.pumpWidget(
          MaterialApp(
            theme: buildEarthlyTheme(Brightness.light),
            home: EarthlySpikeHome(
              mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
                  const ColoredBox(color: Color(0xFFEDF0EA)),
              draftController: draft,
              drawerNavigationController: drawerNav,
              onExitAppRequested: () => exitCalled += 1,
            ),
          ),
        );
        await tester.pump();

        // 1) Open Earthly Pill modal bottom sheet -> Back pops modal first!
        await tester.tap(find.byKey(const Key('earthly-brand-pill')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('earthly-pill-settings-btn')), findsOneWidget);

        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('earthly-pill-settings-btn')), findsNothing);
        expect(exitCalled, 0);

        // 2) Enter drawing mode with an active stroke -> Back cancels stroke & exits draw mode!
        await tester.tap(find.text('Draw'));
        await tester.pump();
        expect(draft.isDrawingMode, isTrue);
        draft.commitVertex(const Geographic(lon: 16.37, lat: 48.20));
        draft.commitVertex(const Geographic(lon: 16.38, lat: 48.21));
        await tester.pump();
        expect(draft.draftVertices, hasLength(2));

        await tester.binding.handlePopRoute();
        await tester.pump();
        expect(draft.isDrawingMode, isFalse);
        expect(draft.draftVertices, isEmpty);
        expect(exitCalled, 0);

        // 3) Spaces -> Inbox shows visible Back button and pops back to Spaces
        await tester.tap(find.text('Spaces'));
        await tester.pumpAndSettle();
        expect(find.byType(SpacesSheet), findsOneWidget);

        await tester.tap(find.byKey(const Key('spaces-inbox-btn')));
        await tester.pumpAndSettle();
        expect(find.byType(InboxSheet), findsOneWidget);
        expect(find.byKey(const Key('inbox-back-btn')), findsOneWidget);

        await tester.tap(find.byKey(const Key('inbox-back-btn')));
        await tester.pumpAndSettle();
        expect(find.byType(SpacesSheet), findsOneWidget);

        // 4) Spaces -> Cashu Wallet shows visible Back button and pops back to Spaces
        await tester.tap(find.byKey(const Key('spaces-tab-network')));
        await tester.pumpAndSettle();
        final cashuBtn = find.byKey(const Key('spaces-cashu-wallet-btn'));
        await tester.scrollUntilVisible(
          cashuBtn,
          180,
          scrollable: find
              .descendant(
                of: find.byType(SpacesSheet),
                matching: find.byWidgetPredicate(
                  (w) =>
                      w is Scrollable && w.axisDirection == AxisDirection.down,
                ),
              )
              .last,
        );
        await tester.ensureVisible(cashuBtn);
        await tester.pumpAndSettle();
        await tester.tap(cashuBtn);
        await tester.pumpAndSettle();
        expect(find.byType(CashuWalletSheet), findsOneWidget);
        expect(find.byKey(const Key('cashu-back-btn')), findsOneWidget);

        await tester.tap(find.byKey(const Key('cashu-back-btn')));
        await tester.pumpAndSettle();
        expect(find.byType(SpacesSheet), findsOneWidget);
        expect(exitCalled, 0);
      },
    );

    testWidgets('SpacesSheet renders visible Back arrow when onBack is provided',
        (WidgetTester tester) async {
      var backTapped = false;
      await tester.pumpWidget(
        wrapSheetInStack(
          SpacesSheet(
            account: null,
            localNsec: null,
            relayUrls: const ['wss://relay.earthly.city'],
            onRelayUrlsChanged: (_) {},
            onAccountChanged: (_) {},
            onLocalKeyChanged: (_) {},
            onSessionStateChanged: (_, _) {},
            onNearbySynced: () {},
            onBroadcastBeacon: (_, _, _) async => testPublishOutcome(),
            onBack: () => backTapped = true,
            onClose: () {},
          ),
        ),
      );
      expect(find.byKey(const Key('spaces-back-btn')), findsOneWidget);
      await tester.tap(find.byKey(const Key('spaces-back-btn')));
      await tester.pump();
      expect(backTapped, isTrue);
    });

    testWidgets(
      'Cross-branch header Back arrows work for Explore -> Pill -> Settings, Spaces -> Circles, and Explore -> Detail margins',
      (WidgetTester tester) async {
        setTestViewport(tester, const Size(412, 915));
        final catalog = CatalogShelfController()..setCatalog(makeRichCatalog());
        final drawerNav = DrawerNavigationController();
        addTearDown(() {
          catalog.dispose();
          drawerNav.dispose();
        });

        await tester.pumpWidget(
          MaterialApp(
            theme: buildEarthlyTheme(Brightness.light),
            home: EarthlySpikeHome(
              mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
                  const ColoredBox(color: Color(0xFFEDF0EA)),
              catalogController: catalog,
              drawerNavigationController: drawerNav,
            ),
          ),
        );
        await tester.pump();

        // 1. Explore -> DatasetDetailMargin shows header Back arrow returning to Explore
        await tester.tap(find.text('Explore'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Danube River Loop'));
        await tester.pumpAndSettle();
        expect(find.byType(DatasetDetailMargin), findsOneWidget);
        expect(find.byKey(const Key('drawer-back-btn')), findsOneWidget);
        await tester.tap(find.byKey(const Key('drawer-back-btn')));
        await tester.pumpAndSettle();
        expect(find.byType(ExploreSheet), findsOneWidget);

        // 2. Explore -> Pill -> Settings shows header Back arrow returning to Explore
        await tester.tap(find.byKey(const Key('earthly-brand-pill')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('earthly-pill-settings-btn')));
        await tester.pumpAndSettle();
        expect(find.byType(SettingsSheet), findsOneWidget);
        expect(find.byKey(const Key('settings-back-btn')), findsOneWidget);
        await tester.tap(find.byKey(const Key('settings-back-btn')));
        await tester.pumpAndSettle();
        expect(find.byType(ExploreSheet), findsOneWidget);

        // 3. Spaces -> Circles shows header Back arrow returning to Spaces
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await tester.tap(find.text('Spaces'));
        await tester.pumpAndSettle();
        expect(find.byType(SpacesSheet), findsOneWidget);
        drawerNav.open(EarthlyDrawer.circles, isWideStudio: false);
        await tester.pumpAndSettle();
        expect(find.byType(CirclesSheet), findsOneWidget);
        expect(find.byKey(const Key('circles-back-btn')), findsOneWidget);
        await tester.tap(find.byKey(const Key('circles-back-btn')));
        await tester.pumpAndSettle();
        expect(find.byType(SpacesSheet), findsOneWidget);
      },
    );
  });

  group('Immediate map display & camera fly-to on Search / Explore entity tap',
      () {
    testWidgets(
      'PlaceSearchSheet tap immediately shows Map, Story, Atlas, and Sighting on map + flies camera + opens detail with Back to Search',
      (WidgetTester tester) async {
        setTestViewport(tester, const Size(412, 915));
        final catalog = CatalogShelfController()..setCatalog(makeRichCatalog());
        final drawerNav = DrawerNavigationController();
        final boundsCalls = <GeoBox>[];
        final positionCalls = <({double lon, double lat, double zoom})>[];
        addTearDown(() {
          catalog.dispose();
          drawerNav.dispose();
        });

        await tester.pumpWidget(
          MaterialApp(
            theme: buildEarthlyTheme(Brightness.light),
            home: EarthlySpikeHome(
              mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
                  const ColoredBox(color: Color(0xFFEDF0EA)),
              catalogController: catalog,
              drawerNavigationController: drawerNav,
              onFlyToBoundsRequested: boundsCalls.add,
              onCameraPositionRequested: (lon, lat, zoom) =>
                  positionCalls.add((lon: lon, lat: lat, zoom: zoom)),
            ),
          ),
        );
        await tester.pump();

        // Open Search omnibox
        await tester.tap(find.byTooltip('Search Place / Coords / naddr'));
        await tester.pumpAndSettle();
        expect(find.byType(PlaceSearchSheet), findsOneWidget);

        // 1) Search "danube" -> tap Map -> IMMEDIATELY pins on shelf, flies camera, opens DatasetDetailMargin!
        await tester.enterText(
          find.byKey(const Key('omnibox-search-field')),
          'danube',
        );
        await tester.pump();

        expect(catalog.shelfMaps, isEmpty);
        await tester.tap(find.text('Danube River Loop'));
        await tester.pumpAndSettle();

        expect(find.byType(DatasetDetailMargin), findsOneWidget);
        expect(
          catalog.shelfMaps.any((e) => e.summary.address == '37515:alice:danube-loop'),
          isTrue,
        );
        expect(boundsCalls, isNotEmpty);
        expect(boundsCalls.last.west, closeTo(16.36, 0.01));
        expect(boundsCalls.last.east, closeTo(16.39, 0.01));

        // Back pops cleanly back to PlaceSearchSheet with query preserved!
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(PlaceSearchSheet), findsOneWidget);
        expect(find.text('Danube Field Journal'), findsOneWidget);
        expect(find.text('Danube Heron Sighting'), findsOneWidget);

        // 2) Tap Sighting in Search -> IMMEDIATELY flies camera to sighting AND opens FeatureInspectorSheet!
        await tester.tap(find.text('Danube Heron Sighting'));
        await tester.pumpAndSettle();
        expect(find.byType(FeatureInspectorSheet), findsOneWidget);
        expect(positionCalls, isNotEmpty);
        expect(positionCalls.last.lon, closeTo(16.405, 0.001));
        expect(positionCalls.last.lat, closeTo(48.231, 0.001));

        // Back returns to Search
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(PlaceSearchSheet), findsOneWidget);

        // 3) Tap Story in Search -> IMMEDIATELY mounts story datasets on map, flies camera, opens StoryReaderMargin!
        final boundsBeforeStory = boundsCalls.length;
        await tester.tap(find.text('Danube Field Journal'));
        await tester.pumpAndSettle();
        expect(find.byType(StoryReaderMargin), findsOneWidget);
        expect(
          catalog.storyDatasets.containsKey('37515:alice:danube-loop'),
          isTrue,
        );
        expect(boundsCalls.length, greaterThan(boundsBeforeStory));

        // Back returns to Search
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(PlaceSearchSheet), findsOneWidget);

        // 4) Search "austria" -> tap Atlas -> IMMEDIATELY mounts Atlas maps on shelf, flies camera, opens AtlasDetailMargin!
        catalog.clearShelf();
        final boundsBeforeAtlas = boundsCalls.length;
        await tester.enterText(
          find.byKey(const Key('omnibox-search-field')),
          'austria',
        );
        await tester.pump();
        await tester.tap(find.text('Austria Trails Atlas'));
        await tester.pumpAndSettle();

        expect(find.byType(AtlasDetailMargin), findsOneWidget);
        expect(
          catalog.shelfMaps.map((e) => e.summary.address),
          containsAll(['37515:alice:danube-loop', '37515:bob:graz-walk']),
        );
        expect(boundsCalls.length, greaterThan(boundsBeforeAtlas));
      },
    );

    testWidgets(
      'ExploreSheet tap immediately displays Map, Story, Atlas, and Sighting on map + flies camera + opens detail with Back to Explore',
      (WidgetTester tester) async {
        setTestViewport(tester, const Size(412, 915));
        final catalog = CatalogShelfController()..setCatalog(makeRichCatalog());
        final drawerNav = DrawerNavigationController();
        final boundsCalls = <GeoBox>[];
        final positionCalls = <({double lon, double lat, double zoom})>[];
        addTearDown(() {
          catalog.dispose();
          drawerNav.dispose();
        });

        await tester.pumpWidget(
          MaterialApp(
            theme: buildEarthlyTheme(Brightness.light),
            home: EarthlySpikeHome(
              mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
                  const ColoredBox(color: Color(0xFFEDF0EA)),
              catalogController: catalog,
              drawerNavigationController: drawerNav,
              onFlyToBoundsRequested: boundsCalls.add,
              onCameraPositionRequested: (lon, lat, zoom) =>
                  positionCalls.add((lon: lon, lat: lat, zoom: zoom)),
            ),
          ),
        );
        await tester.pump();

        // Open Explore
        await tester.tap(find.text('Explore'));
        await tester.pumpAndSettle();
        expect(find.byType(ExploreSheet), findsOneWidget);

        // 1) Tap Map without explicit bbox (Graz Schlossberg Walk) -> immediately pins on shelf, computes GeoJSON bounds, flies camera, opens DatasetDetailMargin!
        await tester.tap(find.text('Graz Schlossberg Walk'));
        await tester.pumpAndSettle();
        expect(find.byType(DatasetDetailMargin), findsOneWidget);
        expect(
          catalog.shelfMaps.any((e) => e.summary.address == '37515:bob:graz-walk'),
          isTrue,
        );
        expect(boundsCalls, isNotEmpty);
        expect(boundsCalls.last.west, closeTo(15.44, 0.01));

        // Back returns directly to Explore!
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(ExploreSheet), findsOneWidget);

        // 2) Switch to Stories tab -> tap Story -> immediately mounts story dataset & flies to bounds + opens StoryReaderMargin!
        final boundsBeforeStory = boundsCalls.length;
        await tester.ensureVisible(find.text('Stories (1)'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Stories (1)'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Danube Field Journal'));
        await tester.pumpAndSettle();

        expect(find.byType(StoryReaderMargin), findsOneWidget);
        expect(
          catalog.storyDatasets.containsKey('37515:alice:danube-loop'),
          isTrue,
        );
        expect(boundsCalls.length, greaterThan(boundsBeforeStory));

        // Back returns directly to Explore!
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(ExploreSheet), findsOneWidget);

        // 3) Switch to Atlases tab -> tap Atlas -> immediately mounts Atlas maps & flies to bounds + opens AtlasDetailMargin!
        catalog.clearShelf();
        final boundsBeforeAtlas = boundsCalls.length;
        await tester.ensureVisible(find.text('Atlases (1)'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Atlases (1)'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Austria Trails Atlas'));
        await tester.pumpAndSettle();

        expect(find.byType(AtlasDetailMargin), findsOneWidget);
        expect(catalog.shelfMaps, hasLength(2));
        expect(boundsCalls.length, greaterThan(boundsBeforeAtlas));

        // Back returns directly to Explore!
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(ExploreSheet), findsOneWidget);

        // 4) Switch to Sightings tab -> tap Sighting -> immediately flies camera + opens FeatureInspectorSheet!
        await tester.ensureVisible(find.text('Sightings (1)'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Sightings (1)'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Danube Heron Sighting'));
        await tester.pumpAndSettle();

        expect(find.byType(FeatureInspectorSheet), findsOneWidget);
        expect(positionCalls, isNotEmpty);
        expect(positionCalls.last.lon, closeTo(16.405, 0.001));
        expect(positionCalls.last.lat, closeTo(48.231, 0.001));
      },
    );
  });
}
