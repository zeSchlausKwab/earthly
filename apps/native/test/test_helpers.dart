import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:earthly_native/src/rust/api/publish.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

/// Sets the test surface size with a 1.0 device pixel ratio and registers reset.
void setTestViewport(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

/// Wraps a drawer/sheet widget in a `MaterialApp` + `Scaffold` + `Stack`.
Widget wrapSheetInStack(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: Stack(
        children: [child],
      ),
    ),
  );
}

/// Wraps a non-positioned body widget in a `MaterialApp` + `Scaffold`.
Widget wrapInScaffold(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: child,
    ),
  );
}

/// Scrolls until [finder] is visible inside the first [Scrollable] and taps it.
Future<void> scrollAndTap(
  WidgetTester tester,
  Finder finder, {
  double delta = 160,
}) async {
  if (finder.evaluate().isEmpty) {
    try {
      await tester.scrollUntilVisible(
        finder,
        delta,
        scrollable: find.byType(Scrollable).first,
      );
    } catch (_) {
      await tester.scrollUntilVisible(
        finder,
        -delta,
        scrollable: find.byType(Scrollable).first,
      );
    }
  }
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

/// Standard mock publish outcome used across widget tests.
PublishOutcomeDto testPublishOutcome([String eventId = '0123456789abcdef']) {
  return PublishOutcomeDto(
    eventId: eventId,
    outboxState: 'sent',
    relays: const [],
  );
}

/// Builds a lightweight `MapSummaryDto` for unit/widget tests.
MapSummaryDto makeTestMap({
  required String address,
  String eventId = 'ev-map',
  String pubkey = 'aaa',
  String dTag = 'map',
  required String title,
  String? description,
  int featureCount = 1,
  int sizeBytes = 512,
  String geojson = '{"type":"FeatureCollection","features":[]}',
  List<BlobRefDto> blobRefs = const [],
  List<String> hashtags = const [],
  List<String> labels = const [],
  List<String> contextRefs = const [],
  double? west,
  double? south,
  double? east,
  double? north,
  BigInt? createdAt,
}) {
  return MapSummaryDto(
    address: address,
    eventId: eventId,
    pubkey: pubkey,
    dTag: dTag,
    title: title,
    description: description,
    featureCount: featureCount,
    sizeBytes: sizeBytes,
    geojson: geojson,
    blobRefs: blobRefs,
    hashtags: hashtags,
    labels: labels,
    contextRefs: contextRefs,
    west: west,
    south: south,
    east: east,
    north: north,
    createdAt: createdAt ?? BigInt.from(1791000000),
  );
}
