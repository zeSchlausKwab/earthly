import 'package:earthly_native/shell/entity_list_row.dart';
import 'package:earthly_native/shell/explore_sheet.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

void main() {
  Widget buildExploreWithTopPadding(Size viewport) {
    final catalog = EarthlyCatalogSnapshot(
      relayUrls: const ['wss://relay.earthly.city'],
      maps: [
        makeTestMap(
          address: '37515:aaa:vienna',
          eventId: 'ev-vienna',
          title: 'Vienna Trails',
          geojson:
              '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[16.37,48.20]},"properties":{"name":"Stephansplatz"}}]}',
        ),
        makeTestMap(
          address: '37515:aaa:graz',
          eventId: 'ev-graz',
          title: 'Graz Loop',
          geojson:
              '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[15.44,47.07]},"properties":{"name":"Schlossberg"}}]}',
        ),
      ],
      stories: const [],
      atlases: const [],
      sightings: const [],
      beacons: const [],
    );

    return MaterialApp(
      home: Scaffold(
        body: MediaQuery(
          data: MediaQueryData(
            size: viewport,
            padding: const EdgeInsets.only(top: 48),
          ),
          child: Stack(
            children: [
              ExploreSheet(
                initialCatalog: catalog,
                catalogLoading: false,
                relayUrls: const ['wss://relay.earthly.city'],
                shelfAddresses: const <String>{},
                profilesByPubkey: const {},
                pinnedEntityIds: const <String>{},
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
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );
  }

  testWidgets(
      'EarthlyMapDrawer removes top MediaQuery padding in mobile & desktop layouts so first list item sits flush below controls',
      (WidgetTester tester) async {
    for (final viewport in const [Size(420, 840), Size(1280, 800)]) {
      setTestViewport(tester, viewport);
      await tester.pumpWidget(buildExploreWithTopPadding(viewport));
      await tester.pumpAndSettle();

      final sortRect = tester.getRect(find.byTooltip('Sort order'));
      final firstRowRect =
          tester.getRect(find.byType(EarthlyEntityListRow).first);

      final gap = firstRowRect.top - sortRect.bottom;
      expect(
        gap,
        greaterThanOrEqualTo(0),
        reason: 'First item overlapped controls at $viewport',
      );
      expect(
        gap,
        lessThan(16),
        reason:
            'Expected zero 48px status-bar gap at $viewport, got ${gap.toStringAsFixed(1)}px',
      );
    }
  });
}
