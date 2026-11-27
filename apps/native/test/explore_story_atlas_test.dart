import 'package:earthly_native/drawing/drawing_model.dart';
import 'package:earthly_native/nostr/atlas_schema.dart';
import 'package:earthly_native/nostr/basemap_config.dart';
import 'package:earthly_native/nostr/callout_overlay.dart';
import 'package:earthly_native/nostr/earthly_share.dart';
import 'package:earthly_native/nostr/map_poster_exporter.dart';
import 'package:earthly_native/nostr/story_presentation.dart';
import 'package:earthly_native/shell/atlas_composer_sheet.dart';
import 'package:earthly_native/shell/atlas_detail_margin.dart';
import 'package:earthly_native/shell/basemap_switcher_sheet.dart';
import 'package:earthly_native/shell/dataset_detail_margin.dart';
import 'package:earthly_native/shell/desk_sheet.dart';
import 'package:earthly_native/shell/earthly_rich_text.dart';
import 'package:earthly_native/shell/entity_list_row.dart';
import 'package:earthly_native/shell/explore_sheet.dart';
import 'package:earthly_native/shell/story_composer_sheet.dart';
import 'package:earthly_native/shell/story_reader_margin.dart';
import 'package:earthly_native/src/rust/api/blossom.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:earthly_native/src/rust/api/settings.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

void main() {
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
      wrapInScaffold(
        BasemapSwitcherSheet(
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
      wrapInScaffold(
        EarthlyEntityListRow(
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
    );

    expect(find.text('Danube Cycling Route'), findsOneWidget);
    expect(find.byType(EarthlyGeometryThumb), findsOneWidget);
    expect(find.byIcon(Icons.qr_code_2), findsNothing);
    expect(find.byIcon(Icons.more_vert), findsOneWidget);
  });

  testWidgets(
      'ExploreSheet filters All / Favorites / Recent and AtlasDetailMargin opens Markdown & maps',
      (WidgetTester tester) async {
    final mapA = makeTestMap(
      address: '37515:aaa:trail-a',
      eventId: 'ev-a',
      pubkey: 'aaa',
      dTag: 'trail-a',
      title: 'Alpine Ridge Trail',
      featureCount: 5,
      sizeBytes: 2048,
      hashtags: const ['hiking'],
      contextRefs: const ['37518:aaa:alps'],
    );
    final mapB = makeTestMap(
      address: '37515:bbb:city-b',
      eventId: 'ev-b',
      pubkey: 'bbb',
      dTag: 'city-b',
      title: 'Vienna Cafes',
      featureCount: 12,
      sizeBytes: 4096,
      hashtags: const ['coffee'],
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
      wrapSheetInStack(
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
      wrapSheetInStack(
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
      ),
    );
    expect(find.text('Global Hiking Trails'), findsOneWidget);
    expect(find.text('A world of walks'), findsOneWidget);
    expect(find.text('Alpine Ridge Trail'), findsOneWidget);
    expect(find.text('Enter Atlas Lens'), findsOneWidget);

    // Verify DatasetDetailMargin renders feature browser & owned Edit/Delete controls.
    final richMap = makeTestMap(
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
      createdAt: BigInt.from(1791000200),
    );
    await tester.pumpWidget(
      wrapSheetInStack(
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
      wrapSheetInStack(
        StoryComposerDrawer(
          shelfMaps: const [],
          editingStory: existingStory,
          getCameraSnapshot: () => null,
          onPublishStory: (req) async {
            publishedStory = req;
            return testPublishOutcome('0123456789abcdef0123456789abcdef');
          },
          onClose: () {},
        ),
      ),
    );

    expect(find.text('Edit Story'), findsOneWidget);
    expect(find.text('Danube Journal'), findsOneWidget);
    await scrollAndTap(
      tester,
      find.text('Save & Update Story (37520)'),
      delta: 120,
    );
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
      wrapSheetInStack(
        AtlasComposerSheet(
          shelfMaps: const [],
          catalogMaps: const [],
          catalogStories: const [],
          editingAtlas: existingAtlas,
          onPublishAtlas: (req) async {
            publishedAtlas = req;
            return testPublishOutcome('0123456789abcdef0123456789abcdef');
          },
          onClose: () {},
        ),
      ),
    );

    expect(find.text('Edit Atlas'), findsOneWidget);
    expect(find.text('Vienna Cycling'), findsOneWidget);
    await scrollAndTap(
      tester,
      find.text('Save & Update Atlas (37518)'),
      delta: 120,
    );
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
      wrapInScaffold(
        BasemapSwitcherSheet(
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
      'StoryComposerDrawer uploads Blossom cover & inline photo and DeskSheet exposes GPX/KML export',
      (WidgetTester tester) async {
    StoryPublishRequest? published;
    await tester.pumpWidget(
      wrapSheetInStack(
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
            return testPublishOutcome('0123456789abcdef0123456789abcdef');
          },
          onClose: () {},
        ),
      ),
    );

    await tester.enterText(find.byType(TextField).first, 'Blossom Photo Story');
    await tester.tap(find.text('Cover'));
    await tester.pumpAndSettle();
    await scrollAndTap(tester, find.text('+ Upload Photo'), delta: 120);
    await scrollAndTap(
      tester,
      find.text('Sign & Publish Story (37520)'),
      delta: 120,
    );

    expect(published?.image, 'https://blossom.earthly.city/abc123.jpg');
    expect(
      published?.markdown,
      contains('![Photo](https://blossom.earthly.city/abc123.jpg)'),
    );

    var exportedGpx = false;
    var exportedKml = false;
    await tester.pumpWidget(
      wrapSheetInStack(
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
          onPublishDraft: (_, _) async =>
              testPublishOutcome('0123456789abcdef0123456789abcdef'),
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
      ),
    );
    await tester.scrollUntilVisible(
      find.byKey(const Key('desk-import-file-btn')),
      140,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.byKey(const Key('desk-import-file-btn')), findsOneWidget);
    expect(find.text('Export ▾'), findsOneWidget);
    expect(exportedGpx, isFalse);
    expect(exportedKml, isFalse);
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
          resolveNaddrTitle: (d) =>
              d.dTag == 'kahlenberg' ? 'Kahlenberg Trail' : null,
          resolvePersonLabel: (_) => null,
          child: const Scaffold(
            body: SingleChildScrollView(
              padding: EdgeInsets.all(16),
              child: EarthlyRichText(
                text: atlasMarkdown,
                preDecodedRefs: {
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
      wrapSheetInStack(
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
      'AtlasDetailMargin enforces two-lane Curated vs Community governance, owner Bless/Lockdown, and muted contributor filtering',
      (WidgetTester tester) async {
    const ownerPk =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const contribPk =
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const mutedPk =
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

    final curatedMap = makeTestMap(
      address: '37515:$ownerPk:canon-trail',
      eventId: 'ev-canon',
      pubkey: ownerPk,
      dTag: 'canon-trail',
      title: 'Curated Alpine Spine',
      featureCount: 3,
      hashtags: const ['alps'],
      contextRefs: ['37518:$ownerPk:alps'],
      createdAt: BigInt.from(1791000100),
    );
    final communityMap = makeTestMap(
      address: '37515:$contribPk:side-valley',
      eventId: 'ev-comm',
      pubkey: contribPk,
      dTag: 'side-valley',
      title: 'Community Side Valley',
      featureCount: 2,
      sizeBytes: 400,
      hashtags: const ['alps'],
      contextRefs: ['37518:$ownerPk:alps'],
      createdAt: BigInt.from(1791000200),
    );
    final mutedMap = makeTestMap(
      address: '37515:$mutedPk:spam-map',
      eventId: 'ev-spam',
      pubkey: mutedPk,
      dTag: 'spam-map',
      title: 'Muted Spam Route',
      featureCount: 1,
      sizeBytes: 200,
      contextRefs: ['37518:$ownerPk:alps'],
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
      wrapSheetInStack(
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
      wrapSheetInStack(
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
      'BasemapSwitcherSheet switches Light/Dark theme, OpenFreeMap style, Satellite Combined overlay, and Poster PNG export',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(900, 1100));

    ThemeMode? selectedTheme;
    BasemapKind? selectedBasemap;
    MapBackgroundMode? selectedBgMode;
    double? selectedOpacity;
    var posterExported = false;

    await tester.pumpWidget(
      wrapInScaffold(
        BasemapSwitcherSheet(
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
      wrapSheetInStack(
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
    setTestViewport(tester, const Size(900, 1100));

    Map<String, dynamic>? latestDraft;
    var discarded = false;

    await tester.pumpWidget(
      wrapSheetInStack(
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
          onPublishStory: (_) async => testPublishOutcome(),
          onClose: () {},
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
      'AtlasComposerSheet compiles Schema Builder rules and AtlasDetailMargin filters Community lane with Off/Warn/Strict',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(420, 1200));

    AtlasPublishRequest? published;
    await tester.pumpWidget(
      wrapSheetInStack(
        AtlasComposerSheet(
          shelfMaps: const [],
          catalogMaps: const [],
          catalogStories: const [],
          onPublishAtlas: (req) async {
            published = req;
            return testPublishOutcome('atl1');
          },
          onClose: () {},
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

    await scrollAndTap(tester, find.text('Publish Atlas (37518)'), delta: 120);

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
    final goodMap = makeTestMap(
      address: '37515:alice:valid',
      eventId: 'm_good',
      pubkey: 'alice',
      dTag: 'valid',
      title: 'Valid Hut Point',
      sizeBytes: 120,
      geojson:
          '{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[11.4,47.2]},"properties":{"elevation":"2100m"}}]}',
      contextRefs: const ['37518:owner:huts'],
      createdAt: BigInt.from(1700000100),
    );
    final badMap = makeTestMap(
      address: '37515:bob:invalid',
      eventId: 'm_bad',
      pubkey: 'bob',
      dTag: 'invalid',
      title: 'Invalid Trail Line',
      sizeBytes: 120,
      geojson:
          '{"type":"FeatureCollection","features":[{"type":"Feature","id":"l1","geometry":{"type":"LineString","coordinates":[[11.4,47.2],[11.5,47.3]]},"properties":{}}]}',
      contextRefs: const ['37518:owner:huts'],
      createdAt: BigInt.from(1700000050),
    );

    await tester.pumpWidget(
      wrapSheetInStack(
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
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Valid Hut Point'), findsOneWidget);
    expect(find.text('Invalid Trail Line'), findsNothing);
    expect(
      find.textContaining('1 map(s) hidden by Strict schema filter'),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('atlas-schema-filter-warn')));
    await tester.pumpAndSettle();
    expect(find.text('Invalid Trail Line'), findsOneWidget);
    expect(find.textContaining('missing required `elevation`'), findsOneWidget);
  });

  testWidgets(
      'StoryComposerDrawer opens StoryViewBlockEditorDialog and inserts canonical earthly-view JSON',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(480, 1000));

    await tester.pumpWidget(
      wrapSheetInStack(
        StoryComposerDrawer(
          shelfMaps: const [],
          getCameraSnapshot: () => const CameraPosition(
            center: Geographic(lon: 16.3738, lat: 48.2082),
            zoom: 14.0,
            bearing: 0.0,
            pitch: 0.0,
          ),
          onPublishStory: (_) async => testPublishOutcome('st1'),
          onClose: () {},
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
    setTestViewport(tester, const Size(440, 900));

    String? openedPubkey;
    final catalog = EarthlyCatalogSnapshot(
      relayUrls: const ['wss://relay.earthly.city'],
      maps: [
        makeTestMap(
          address: '37515:alicepk:m1',
          eventId: 'm1',
          pubkey: 'alicepk',
          dTag: 'm1',
          title: 'Trail 1',
          featureCount: 2,
          sizeBytes: 100,
          createdAt: BigInt.from(1700000000),
        ),
      ],
      stories: const [],
      atlases: const [],
      sightings: const [],
      beacons: const [],
    );

    await tester.pumpWidget(
      wrapSheetInStack(
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
      'StoryComposerDrawer inserts \$ Map and @ Person nostr references at cursor',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    final sampleMap = makeTestMap(
      address: '37515:alicepk:danube',
      eventId: 'map1',
      pubkey: 'alicepk',
      dTag: 'danube',
      title: 'Danube Greenway',
      featureCount: 3,
      createdAt: BigInt.from(1700000000),
    );

    await tester.pumpWidget(
      wrapSheetInStack(
        StoryComposerDrawer(
          shelfMaps: const [],
          catalogMaps: [sampleMap],
          profilesByPubkey: const {
            'alicepk': ProfileMetadataDto(
              pubkey: 'alicepk',
              displayName: 'Alice Cartographer',
            ),
          },
          relayUrls: const ['wss://relay.earthly.city'],
          onEncodeNaddr: ({
            required kind,
            required pubkeyHex,
            required dTag,
            required relays,
          }) async =>
              'nostr:naddr1testdanube',
          onEncodeNpub: (_) async => 'npub1testalice',
          getCameraSnapshot: () => null,
          onPublishStory: (_) async => testPublishOutcome('story-pub-1'),
          onClose: () {},
        ),
      ),
    );

    final mapRefBtn = find.byKey(const Key('story-insert-map-ref-btn'));
    await tester.ensureVisible(mapRefBtn);
    await tester.tap(mapRefBtn);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('mention-entity-danube')));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('[Danube Greenway](nostr:naddr1testdanube)'),
      findsOneWidget,
    );

    final personRefBtn = find.byKey(const Key('story-insert-person-ref-btn'));
    await tester.ensureVisible(personRefBtn);
    await tester.tap(personRefBtn);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('mention-person-alicepk')));
    await tester.pumpAndSettle();

    expect(find.textContaining('nostr:npub1testalice'), findsOneWidget);
  });

  testWidgets(
      'EarthlyCalloutOverlay renders map-pinned comment bubbles, opens popup card, and invokes onInspectComment',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    GeoCommentDto? inspectedComment;
    final dto = GeoCommentDto(
      eventId: 'c-map-1',
      pubkey: 'alice123456',
      address: '37517:alice123456:c-map-1',
      dTag: 'c-map-1',
      text: 'Bridge timber loose here **caution**.',
      geojson: '{"type":"FeatureCollection","features":[]}',
      createdAt: BigInt.zero,
    );

    await tester.pumpWidget(
      wrapInScaffold(
        SizedBox(
          width: 440,
          height: 900,
          child: EarthlyCalloutOverlay(
            callouts: const [],
            sightings: const [],
            displayMode: CalloutDisplayMode.full,
            onInspectFeature: (_) {},
            onInspectSighting: (_) {},
            screenProjector: (_) => const Offset(200, 320),
            commentPins: [
              MapCommentPinItem(
                eventId: dto.eventId,
                authorName: 'Alice',
                text: dto.text,
                anchor: const Geographic(lon: 16.3738, lat: 48.2082),
                comment: dto,
              ),
            ],
            onInspectComment: (c) => inspectedComment = c,
          ),
        ),
      ),
    );

    expect(find.byKey(const Key('map-comment-pin-c-map-1')), findsOneWidget);
    expect(find.byKey(const Key('map-comment-popup-c-map-1')), findsNothing);

    await tester.tap(find.byKey(const Key('map-comment-pin-c-map-1')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('map-comment-popup-c-map-1')), findsOneWidget);
    expect(find.textContaining('Bridge timber loose here'), findsOneWidget);

    await tester.tap(find.byKey(const Key('map-comment-open-thread-c-map-1')));
    await tester.pump();
    expect(inspectedComment?.eventId, 'c-map-1');
  });
}
