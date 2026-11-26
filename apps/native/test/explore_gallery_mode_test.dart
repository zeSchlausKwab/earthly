import 'package:earthly_native/controllers/catalog_shelf_controller.dart';
import 'package:earthly_native/nostr/story_presentation.dart';
import 'package:earthly_native/shell/explore_sheet.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
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
        "geometry": { "type": "LineString", "coordinates": [[16.36, 48.20], [16.38, 48.22]] },
        "properties": { "name": "Danube Line" }
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
        "geometry": { "type": "LineString", "coordinates": [[15.42, 47.06], [15.46, 47.08]] },
        "properties": { "name": "Mur Trail" }
      }
    ]
  }
  ''';

  const geoInnsbruck = '''
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": { "type": "Point", "coordinates": [11.39, 47.27] },
        "properties": { "name": "Nordkette" }
      }
    ]
  }
  ''';

  final map1 = makeTestMap(
    address: '37515:aaa:danube',
    eventId: 'ev-1',
    dTag: 'danube',
    title: 'Danube Path',
    geojson: geoVienna,
    west: 16.36,
    south: 48.20,
    east: 16.38,
    north: 48.22,
    createdAt: BigInt.from(1791000900),
  );

  final map2 = makeTestMap(
    address: '37515:aaa:graz',
    eventId: 'ev-2',
    dTag: 'graz',
    title: 'Mur Valley Trail',
    geojson: geoGraz,
    west: 15.42,
    south: 47.06,
    east: 15.46,
    north: 47.08,
    createdAt: BigInt.from(1791000800),
  );

  final map3 = makeTestMap(
    address: '37515:bbb:tirol',
    eventId: 'ev-3',
    pubkey: 'bbb',
    dTag: 'tirol',
    title: 'Nordkette Ridge',
    geojson: geoInnsbruck,
    west: 11.39,
    south: 47.27,
    east: 11.39,
    north: 47.27,
    contextRefs: const ['37518:bbb:alps-west'],
    createdAt: BigInt.from(1791000700),
  );

  final story1 = StorySummaryDto(
    address: '37520:aaa:story-vienna',
    eventId: 'st-1',
    pubkey: 'aaa',
    dTag: 'story-vienna',
    title: 'River Walks in Vienna',
    summary: 'Exploring the Danube canal.',
    content: '# Vienna\n\nWalking the canal.',
    referencedAddresses: const ['37515:aaa:danube'],
    publishedAt: BigInt.from(1791000900),
  );

  final story2 = StorySummaryDto(
    address: '37520:bbb:story-graz',
    eventId: 'st-2',
    pubkey: 'bbb',
    dTag: 'story-graz',
    title: 'Alpine South: Graz',
    summary: 'Steiermark routes and Mur river trails.',
    content: '# Graz\n\nCycling south along the Mur.',
    presentationJson:
        '{"version":1,"initialView":{"center":[15.44,47.07],"zoom":14.0},"layers":[]}',
    referencedAddresses: const ['37515:aaa:graz'],
    publishedAt: BigInt.from(1791000800),
  );

  final atlas1 = AtlasSummaryDto(
    address: '37518:aaa:austria-east',
    eventId: 'at-1',
    pubkey: 'aaa',
    dTag: 'austria-east',
    name: 'Eastern Austria Atlas',
    description: 'Curated trails around Vienna & Graz.',
    governance: 'closed',
    pinnedAddresses: const ['37515:aaa:danube', '37515:aaa:graz'],
    hashtags: const ['austria'],
    createdAt: BigInt.from(1791000900),
  );

  final atlas2 = AtlasSummaryDto(
    address: '37518:bbb:alps-west',
    eventId: 'at-2',
    pubkey: 'bbb',
    dTag: 'alps-west',
    name: 'Western Alps Atlas',
    description: 'Tyrol summits.',
    governance: 'open',
    pinnedAddresses: const [],
    hashtags: const ['alps'],
    createdAt: BigInt.from(1791000800),
  );

  EarthlyCatalogSnapshot makeCatalog() => EarthlyCatalogSnapshot(
        relayUrls: const ['wss://relay.earthly.city'],
        maps: [map1, map2, map3],
        stories: [story1, story2],
        atlases: [atlas1, atlas2],
        sightings: const [],
        beacons: const [],
      );

  test(
      'CatalogShelfController previews maps, stories, and atlases ephemerally with auto-zoom bounds',
      () async {
    final controller = CatalogShelfController()..setCatalog(makeCatalog());
    final persistentMap = makeTestMap(
      address: '37515:zzz:pinned',
      eventId: 'ev-pinned',
      title: 'Persistent Shelf Map',
      geojson: geoInnsbruck,
    );
    controller.toggleMapOnShelf(persistentMap);
    expect(controller.shelfMaps.length, 1);

    final zoomedBounds = <GeoBox>[];
    final zoomedCameras = <StoryCameraTarget>[];

    await controller.previewGalleryMap(
      map1,
      onFlyToBounds: zoomedBounds.add,
    );
    expect(controller.galleryModeActive, isTrue);
    expect(
      controller.effectiveDisplayShelfMaps.map((e) => e.summary.address),
      ['37515:aaa:danube'],
    );
    expect(zoomedBounds.last.west, closeTo(16.36, 0.001));
    expect(zoomedBounds.last.east, closeTo(16.38, 0.001));

    await controller.previewGalleryStory(
      story1,
      onFlyToCamera: zoomedCameras.add,
      onFlyToBounds: zoomedBounds.add,
    );
    expect(
      controller.effectiveDisplayShelfMaps.map((e) => e.summary.address),
      ['37515:aaa:danube'],
    );
    expect(zoomedBounds.length, 2);

    await controller.previewGalleryStory(
      story2,
      onFlyToCamera: zoomedCameras.add,
      onFlyToBounds: zoomedBounds.add,
    );
    expect(zoomedCameras.length, 1);
    expect(zoomedCameras.single.lon, closeTo(15.44, 0.001));
    expect(zoomedCameras.single.lat, closeTo(47.07, 0.001));

    await controller.previewGalleryAtlas(
      atlas1,
      mutedPubkeys: const <String>{},
      onFlyToBounds: zoomedBounds.add,
    );
    expect(
      controller.effectiveDisplayShelfMaps
          .map((e) => e.summary.address)
          .toList(),
      ['37515:aaa:danube', '37515:aaa:graz'],
    );
    expect(zoomedBounds.last.west, closeTo(15.42, 0.001));
    expect(zoomedBounds.last.east, closeTo(16.38, 0.001));

    // Open governance atlas collects matching non-muted catalog maps too.
    await controller.previewGalleryAtlas(
      atlas2,
      mutedPubkeys: const <String>{},
      onFlyToBounds: zoomedBounds.add,
    );
    expect(
      controller.effectiveDisplayShelfMaps.map((e) => e.summary.address),
      ['37515:bbb:tirol'],
    );
    // Degenerate single-point bounds are padded rather than zero-area.
    expect(zoomedBounds.last.east - zoomedBounds.last.west, greaterThan(0.003));

    // Leaving gallery mode restores persistent shelf cleanly without pollution.
    controller.setGalleryModeActive(false);
    expect(controller.galleryPreviewMaps, isEmpty);
    expect(
      controller.effectiveDisplayShelfMaps.map((e) => e.summary.address),
      ['37515:zzz:pinned'],
    );
  });

  test('Rapid gallery previews drop stale async results cleanly', () async {
    final controller = CatalogShelfController()
      ..setCatalog(makeCatalog())
      ..relayUrls = const <String>[];
    final zoomedBounds = <GeoBox>[];

    // Story pointing to an uncached map (triggers async guard) immediately followed
    // by local map2 preview.
    final uncachedStory = StorySummaryDto(
      address: '37520:ccc:remote',
      eventId: 'st-remote',
      pubkey: 'ccc',
      dTag: 'remote',
      title: 'Remote Story',
      content: '# Remote',
      referencedAddresses: const ['37515:ccc:missing-map'],
      publishedAt: BigInt.from(1791000950),
    );
    final f1 = controller.previewGalleryStory(
      uncachedStory,
      onFlyToCamera: (_) {},
      onFlyToBounds: zoomedBounds.add,
    );
    final f2 = controller.previewGalleryMap(
      map2,
      onFlyToBounds: zoomedBounds.add,
    );
    await Future.wait([f1, f2]);

    expect(controller.galleryPreviewKey, 'map:37515:aaa:graz');
    expect(
      controller.effectiveDisplayShelfMaps.map((e) => e.summary.address),
      ['37515:aaa:graz'],
    );
    expect(controller.galleryPreviewLoading, isFalse);
  });

  testWidgets(
      'Mobile ExploreSheet toggles Gallery Mode and previews every card on sideways swipe across Maps, Stories, and Atlases',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(390, 844));
    final controller = CatalogShelfController()..setCatalog(makeCatalog());
    final previewEvents = <String>[];
    final boundsFlyCalls = <GeoBox>[];
    final cameraFlyCalls = <StoryCameraTarget>[];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              ListenableBuilder(
                listenable: controller,
                builder: (context, _) => ExploreSheet(
                  initialCatalog: controller.catalog,
                  catalogLoading: false,
                  relayUrls: const ['wss://relay.earthly.city'],
                  shelfAddresses: const <String>{},
                  profilesByPubkey: const {},
                  pinnedEntityIds: const <String>{},
                  recentEntityIds: const <String>[],
                  activeAtlasLens: null,
                  galleryMode: controller.galleryModeActive,
                  galleryPreviewLoading: controller.galleryPreviewLoading,
                  onGalleryModeChanged: controller.setGalleryModeActive,
                  onPreviewGalleryMap: (m) {
                    previewEvents.add('map:${m.dTag}');
                    controller.previewGalleryMap(
                      m,
                      onFlyToBounds: boundsFlyCalls.add,
                    );
                  },
                  onPreviewGalleryStory: (s) {
                    previewEvents.add('story:${s.dTag}');
                    controller.previewGalleryStory(
                      s,
                      onFlyToCamera: cameraFlyCalls.add,
                      onFlyToBounds: boundsFlyCalls.add,
                    );
                  },
                  onPreviewGalleryAtlas: (a) {
                    previewEvents.add('atlas:${a.dTag}');
                    controller.previewGalleryAtlas(
                      a,
                      mutedPubkeys: const <String>{},
                      onFlyToBounds: boundsFlyCalls.add,
                    );
                  },
                  onClearGalleryPreview: controller.clearGalleryPreview,
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
                  onClose: () => controller.setGalleryModeActive(false),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Starts in standard List Mode on mobile.
    expect(find.byKey(const Key('explore-gallery-toggle')), findsOneWidget);
    expect(find.byKey(const Key('explore-gallery-carousel')), findsNothing);

    // Toggle into Gallery Mode -> compact bottom carousel appears & auto-previews Map 0.
    await tester.tap(find.byKey(const Key('explore-gallery-toggle')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('explore-gallery-carousel')), findsOneWidget);
    expect(controller.galleryModeActive, isTrue);
    expect(previewEvents, ['map:danube']);
    expect(boundsFlyCalls.length, 1);

    // Swipe sideways to second map card -> displays & zooms Map 1.
    await tester.drag(
      find.byKey(const Key('explore-gallery-pageview-0')),
      const Offset(-340, 0),
    );
    await tester.pumpAndSettle();
    expect(previewEvents, ['map:danube', 'map:graz']);
    expect(boundsFlyCalls.length, 2);

    // Switch to Stories tab inside Gallery Mode -> resets & previews Story 0.
    await tester.tap(find.byKey(const Key('gallery-tab-1')));
    await tester.pumpAndSettle();
    expect(previewEvents.last, 'story:story-vienna');
    expect(boundsFlyCalls.length, 3);

    // Swipe sideways to Story 1 -> triggers Story 1 camera/bounds preview.
    await tester.drag(
      find.byKey(const Key('explore-gallery-pageview-1')),
      const Offset(-340, 0),
    );
    await tester.pumpAndSettle();
    expect(previewEvents.last, 'story:story-graz');
    expect(cameraFlyCalls.length, 1);

    // Switch to Atlases tab -> previews Atlas 0, swipe to Atlas 1 -> previews Atlas 1.
    await tester.tap(find.byKey(const Key('gallery-tab-2')));
    await tester.pumpAndSettle();
    expect(previewEvents.last, 'atlas:austria-east');

    await tester.drag(
      find.byKey(const Key('explore-gallery-pageview-2')),
      const Offset(-340, 0),
    );
    await tester.pumpAndSettle();
    expect(previewEvents.last, 'atlas:alps-west');

    // Switch back to List Mode -> clears ephemeral gallery preview.
    await tester.tap(find.byKey(const Key('explore-gallery-toggle')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('explore-gallery-carousel')), findsNothing);
    expect(controller.galleryModeActive, isFalse);
    expect(controller.galleryPreviewMaps, isEmpty);
  });
}
