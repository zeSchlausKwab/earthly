import 'package:earthly_native/nostr/callout_overlay.dart';
import 'package:earthly_native/nostr/nip55_signer.dart';
import 'package:earthly_native/nostr/story_presentation.dart';
import 'package:earthly_native/shell/account_session_sheet.dart';
import 'package:earthly_native/shell/agent_drawer.dart';
import 'package:earthly_native/shell/atlas_composer_sheet.dart';
import 'package:earthly_native/shell/atlas_detail_margin.dart';
import 'package:earthly_native/shell/basemap_switcher_sheet.dart';
import 'package:earthly_native/shell/dataset_detail_margin.dart';
import 'package:earthly_native/shell/discussion_margin_sheet.dart';
import 'package:earthly_native/shell/guided_tour_dialog.dart';
import 'package:earthly_native/shell/help_shortcuts_sheet.dart';
import 'package:earthly_native/shell/location_inspector_sheet.dart';
import 'package:earthly_native/shell/mcp_bridge_sheet.dart';
import 'package:earthly_native/shell/osm_import_sheet.dart';
import 'package:earthly_native/shell/person_margin.dart';
import 'package:earthly_native/shell/raw_event_inspector_dialog.dart';
import 'package:earthly_native/shell/routing_sheet.dart';
import 'package:earthly_native/shell/shoutbox_sheet.dart';
import 'package:earthly_native/shell/story_composer_sheet.dart';
import 'package:earthly_native/shell/story_reader_margin.dart';
import 'package:earthly_native/shell/zap_dialog.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:earthly_native/src/rust/api/nwc.dart';
import 'package:earthly_native/theme/earthly_theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

const List<Size> _mobileViewports = <Size>[
  Size(384, 854),
  Size(412, 915),
];

Widget _themedStack(Widget child, {Brightness brightness = Brightness.dark}) {
  return MaterialApp(
    theme: buildEarthlyTheme(brightness),
    home: Scaffold(
      body: Stack(children: [child]),
    ),
  );
}

void _expectNoChipSoup() {
  expect(find.byType(ActionChip), findsNothing);
  expect(find.byType(FilterChip), findsNothing);
  expect(find.byType(ChoiceChip), findsNothing);
  expect(find.byType(InputChip), findsNothing);
}

void _expectSameHorizontalRow(
  WidgetTester tester,
  List<Finder> finders, {
  required String label,
}) {
  expect(finders.length, greaterThanOrEqualTo(2));
  final baselineY = tester.getTopLeft(finders.first).dy;
  for (var i = 1; i < finders.length; i++) {
    final dy = tester.getTopLeft(finders[i]).dy;
    expect(
      dy,
      closeTo(baselineY, 1.5),
      reason: '$label item #$i broke onto a second row ($dy vs $baselineY)',
    );
  }
}

void main() {
  group('Mobile layout cleanup (384x854 & 412x915)', () {
    for (final viewport in _mobileViewports) {
      final tag = '${viewport.width.toInt()}x${viewport.height.toInt()}';

      testWidgets(
        'AgentDrawer renders zero chip soup and keeps controls single-row at $tag',
        (WidgetTester tester) async {
          setTestViewport(tester, viewport);
          var promptSent = '';

          await tester.pumpWidget(
            _themedStack(
              AgentDrawer(
                messages: const [],
                settings: CopilotProviderSettings.openRouter,
                busy: false,
                safeEditing: true,
                onSafeEditingChanged: (_) {},
                visionSupport: 'vision',
                attachMapView: true,
                onAttachMapViewChanged: (_) {},
                threads: const [
                  CopilotThread(
                    id: 't1',
                    title: 'Danube River Survey Notes',
                    updatedAtMs: 1000,
                  ),
                  CopilotThread(
                    id: 't2',
                    title: 'Alpine Ridge',
                    updatedAtMs: 900,
                  ),
                ],
                activeThreadId: 't1',
                onCreateThread: () {},
                onSelectThread: (_) {},
                onDeleteThread: (_) {},
                shelfMaps: const [
                  (address: '37515:alice:danube', title: 'Danube Bikeway'),
                  (address: '37515:bob:alps', title: 'Alpine Pass'),
                ],
                workingSetAddresses: const {'37515:alice:danube'},
                onToggleWorkingSet: (_) {},
                pendingEdit: const PendingAiEdit(
                  proposedGeojson: '{"type":"FeatureCollection","features":[]}',
                  diffAdded: 2,
                  diffModified: 1,
                  diffRemoved: 0,
                  summary: 'Buffered 120m cycling corridor',
                ),
                onAcceptPendingEdit: () {},
                onDiscardPendingEdit: () {},
                onPickAttachment: () {},
                onSettingsChanged: (_) {},
                onSendPrompt: (p) => promptSent = p,
                onClearChat: () {},
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          expect(find.byKey(const Key('agent-starter-prompts')), findsOneWidget);

          // Composer action strip stays strictly on ONE row.
          _expectSameHorizontalRow(
            tester,
            [
              find.text('Map View'),
              find.text('Source').last,
              find.text('Prompts ▾'),
            ],
            label: 'AgentDrawer composer bar ($tag)',
          );

          // Pending ghost card Accept + Discard sit on ONE row.
          _expectSameHorizontalRow(
            tester,
            [find.text('Accept to Draft'), find.text('Discard')],
            label: 'AgentDrawer ghost actions ($tag)',
          );

          // Starter prompt taps cleanly submit without pills.
          await tester.ensureVisible(find.text('Measure my draft'));
          await tester.tap(find.text('Measure my draft'));
          await tester.pump();
          expect(promptSent, 'Measure my draft');

          // Open Provider settings -> presets + buttons stay single-row, zero chips.
          await tester.tap(find.byTooltip('Provider settings'));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          _expectSameHorizontalRow(
            tester,
            [
              find.text('Offline'),
              find.text('Ollama'),
              find.text('OpenRouter'),
              find.text('Routstr'),
            ],
            label: 'AgentDrawer provider presets ($tag)',
          );
          _expectSameHorizontalRow(
            tester,
            [
              find.text('Discover Models'),
              find.text('Apply Provider'),
            ],
            label: 'AgentDrawer provider actions ($tag)',
          );
        },
      );

      testWidgets(
        'DatasetDetailMargin keeps all 4 actions + reaction bar single-row and supports onBack at $tag',
        (WidgetTester tester) async {
          setTestViewport(tester, viewport);
          var backPressed = false;

          final sampleMap = makeTestMap(
            address: '37515:alice:danube-long',
            eventId: 'ev-danube',
            pubkey: 'alice1234567890',
            dTag: 'danube-long',
            title: 'Danube Valley Protected Bikeway Network & Bridges',
            description:
                'Full survey of protected cycling infrastructure along the Danube.',
            featureCount: 2,
            sizeBytes: 4096,
            geojson: '''
            {
              "type": "FeatureCollection",
              "features": [
                {"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.37,48.20]},"properties":{"name":"North Pier"}},
                {"type":"Feature","id":"l1","geometry":{"type":"LineString","coordinates":[[16.37,48.20],[16.39,48.21]]},"properties":{"name":"Towpath"}}
              ]
            }
            ''',
            hashtags: const ['cycling', 'vienna'],
          );

          // 1) Owned map (4 actions: Remove/Show, Zoom, Edit in Desk, Delete)
          await tester.pumpWidget(
            _themedStack(
              DatasetDetailMargin(
                map: sampleMap,
                relayUrls: const ['wss://relay.earthly.city'],
                onShelf: true,
                isOwned: true,
                authorProfile: const ProfileMetadataDto(
                  pubkey: 'alice1234567890',
                  displayName: 'Alice Cartographer',
                ),
                initialSocialCounts: EntitySocialCountsDto(
                  address: sampleMap.address,
                  reactionCount: 14,
                  userHasReacted: true,
                  zapCount: 3,
                  zapSats: BigInt.from(2100),
                ),
                onToggleReaction: (c) async => c,
                onZap: () {},
                onToggleOnShelf: () {},
                onZoomToMap: () {},
                onJumpToFeature: (_) {},
                onEditOrForkMap: () {},
                onOpenDiscussion: () {},
                onDeleteMap: (_) async => testPublishOutcome(),
                onBack: () => backPressed = true,
                onClose: () {},
              ),
              brightness: Brightness.light,
            ),
          );
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          _expectNoChipSoup();

          // Back button present and works.
          expect(find.byKey(const Key('drawer-back-btn')), findsOneWidget);
          await tester.tap(find.byKey(const Key('drawer-back-btn')));
          await tester.pump();
          expect(backPressed, isTrue);

          // All 4 map action buttons stay strictly on ONE horizontal row!
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('dataset-detail-shelf-btn')),
              find.byKey(const Key('dataset-detail-zoom-btn')),
              find.byKey(const Key('dataset-detail-edit-btn')),
              find.byKey(const Key('dataset-detail-delete-btn')),
            ],
            label: 'DatasetDetailMargin owned 4-button action bar ($tag)',
          );

          // SocialActionsBar Like + Zap stay strictly on ONE horizontal row!
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('entity-reaction-btn')),
              find.byKey(const Key('entity-zap-badge')),
            ],
            label: 'EntityReactionBar ($tag)',
          );

          // 2) Unowned map with Propose Edit (4 actions: Show on Map, Zoom, Create Copy, Propose Edit)
          await tester.pumpWidget(
            _themedStack(
              DatasetDetailMargin(
                map: sampleMap,
                relayUrls: const ['wss://relay.earthly.city'],
                onShelf: false,
                isOwned: false,
                authorProfile: null,
                onToggleOnShelf: () {},
                onZoomToMap: () {},
                onJumpToFeature: (_) {},
                onEditOrForkMap: () {},
                onProposeEdit: () {},
                onOpenDiscussion: () {},
                onDeleteMap: (_) async => testPublishOutcome(),
                onBack: () {},
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('dataset-detail-shelf-btn')),
              find.byKey(const Key('dataset-detail-zoom-btn')),
              find.byKey(const Key('dataset-detail-edit-btn')),
              find.byKey(const Key('dataset-detail-propose-edit-btn')),
            ],
            label: 'DatasetDetailMargin unowned 4-button action bar ($tag)',
          );
        },
      );

      testWidgets(
        'StoryReaderMargin, AtlasDetailMargin, and PersonMarginSheet support onBack and stay single-row at $tag',
        (WidgetTester tester) async {
          setTestViewport(tester, viewport);

          var storyBack = false;
          const md = '''
## Ridge Crossing

```earthly-view
{"id":"v1","title":"Trailhead","caption":"Base camp","display":"both","camera":{"center":[16.36,48.20],"zoom":14.0}}
```
''';
          final story = StorySummaryDto(
            address: '37520:alice:ridge-long',
            eventId: 'st-1',
            pubkey: 'alice1234567890',
            dTag: 'ridge-long',
            title: 'Trans-Alpine Field Survey Journal and Glacier Report',
            summary: 'Detailed hydrography notes across the high alpine pass.',
            content: md,
            referencedAddresses: const [],
            publishedAt: BigInt.from(1791000000),
          );

          await tester.pumpWidget(
            _themedStack(
              StoryReaderMargin(
                story: story,
                relayUrls: const ['wss://relay.earthly.city'],
                parsed: parseStoryDocument(markdown: md),
                datasetsByAddress: const {},
                decodedRefsByToken: const {},
                loadingLinkedMaps: false,
                activeViewIndex: 0,
                calloutCount: 2,
                isOwned: true,
                authorLabel: 'Alice Cartographer',
                onOpenPerson: (_) {},
                onEditStory: () {},
                onDeleteStory: () async {},
                initialSocialCounts: EntitySocialCountsDto(
                  address: story.address,
                  reactionCount: 5,
                  userHasReacted: false,
                  zapCount: 1,
                  zapSats: BigInt.from(500),
                ),
                onToggleReaction: (c) async => c,
                onZap: () {},
                onSelectViewIndex: (_) {},
                onFocusDataset: (_) {},
                onActivateNaddrRef: (_) {},
                onActivateGeoRef: (_, _, _) {},
                onFitAllGeometry: () {},
                onOpenDiscussion: () {},
                onKeepOnShelf: () {},
                onBack: () => storyBack = true,
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          await tester.tap(find.byKey(const Key('drawer-back-btn')));
          await tester.pump();
          expect(storyBack, isTrue);

          _expectSameHorizontalRow(
            tester,
            [find.text('Fit Map'), find.text('Comments'), find.text('Edit')],
            label: 'StoryReaderMargin action bar ($tag)',
          );

          // AtlasDetailMargin (owned + schema governance)
          var atlasBack = false;
          final atlas = AtlasSummaryDto(
            address: '37518:alice:alpine-atlas',
            eventId: 'at-1',
            pubkey: 'alice1234567890',
            dTag: 'alpine-atlas',
            name: 'Eastern Alps Trail & Water Sources Collective Atlas',
            description: 'Curated alpine routes and drinking water points.',
            governance: 'schema',
            schemaJson: '{"type":"object"}',
            schemaHash: 'abcdef1234',
            pinnedAddresses: const [],
            hashtags: const ['alps', 'hiking'],
            createdAt: BigInt.from(1791000000),
          );

          await tester.pumpWidget(
            _themedStack(
              AtlasDetailMargin(
                atlas: atlas,
                relayUrls: const ['wss://relay.earthly.city'],
                catalogMaps: const [],
                catalogStories: const [],
                shelfAddresses: const {},
                profilesByPubkey: const {},
                isActiveLens: false,
                isOwned: true,
                onEditAtlas: () {},
                onDeleteAtlas: () async {},
                onLockDownAtlas: () async {},
                onOpenPerson: (_) {},
                onToggleReaction: (c) async => c,
                onZap: () {},
                onToggleLens: () {},
                onShowAllOnMap: () {},
                onToggleMapOnShelf: (_) {},
                onFocusMap: (_) {},
                onOpenStory: (_) {},
                onOpenDiscussion: () {},
                onBack: () => atlasBack = true,
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          await tester.tap(find.byKey(const Key('drawer-back-btn')));
          await tester.pump();
          expect(atlasBack, isTrue);

          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('atlas-lens-btn')),
              find.byKey(const Key('atlas-show-all-btn')),
              find.byKey(const Key('atlas-lockdown-btn')),
              find.byKey(const Key('atlas-detail-overflow-btn')),
            ],
            label: 'AtlasDetailMargin action bar ($tag)',
          );

          await tester.scrollUntilVisible(
            find.byKey(const Key('atlas-schema-filter-bar')),
            120,
            scrollable: find.byType(Scrollable).first,
          );
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('atlas-schema-filter-off')),
              find.byKey(const Key('atlas-schema-filter-warn')),
              find.byKey(const Key('atlas-schema-filter-strict')),
            ],
            label: 'AtlasDetailMargin schema filter ($tag)',
          );

          // PersonMarginSheet
          var personBack = false;
          const pk =
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
          await tester.pumpWidget(
            _themedStack(
              PersonMarginSheet(
                pubkey: pk,
                relayUrls: const ['wss://relay.earthly.city'],
                isCurrentUser: true,
                initialProfile: const ProfileMetadataDto(
                  pubkey: pk,
                  displayName: 'Dr. Alexander von Humboldt Cartographer',
                  nip05: 'humboldt@earthly.city',
                  website: 'https://earthly.city/cartographers/humboldt',
                  lud16: 'humboldt@getalby.com',
                ),
                initialPortfolio: const AuthorPortfolioDto(
                  pubkey: pk,
                  npub: 'npub1humboldt',
                  maps: [],
                  stories: [],
                  atlases: [],
                ),
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
                onBack: () => personBack = true,
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          await tester.tap(find.byKey(const Key('drawer-back-btn')));
          await tester.pump();
          expect(personBack, isTrue);
        },
      );

      testWidgets(
        'Audited utility sheets render zero overflows and zero broken button rows at $tag',
        (WidgetTester tester) async {
          setTestViewport(tester, viewport);

          // 1) LocationInspectorSheet — 4 actions on ONE row
          await tester.pumpWidget(
            _themedStack(
              LocationInspectorSheet(
                lat: 48.2082,
                lon: 16.3738,
                initialReverseGeocode: const ReverseGeocodeDto(
                  displayName: 'Stephansplatz',
                  subtitle: 'Innere Stadt, Vienna, Austria',
                  lat: 48.2082,
                  lon: 16.3738,
                ),
                onDropPointHere: () {},
                onCreateSightingHere: () {},
                onImportOsmHere: () {},
                onIsochroneHere: () {},
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('location-drop-point-btn')),
              find.byKey(const Key('location-sighting-here-btn')),
              find.byKey(const Key('location-import-osm-btn')),
              find.byKey(const Key('location-isochrone-btn')),
            ],
            label: 'LocationInspectorSheet actions ($tag)',
          );

          // 2) RoutingSheet — profile bar, waypoint bar, and 5 isochrone bands single-row
          await tester.pumpWidget(
            _themedStack(
              RoutingSheet(
                mapCenter: const Geographic(lon: 16.3738, lat: 48.2082),
                draftWaypoints: const [
                  Geographic(lon: 16.37, lat: 48.205),
                  Geographic(lon: 16.38, lat: 48.215),
                ],
                onImportGeoJsonToDraft: (_, _) {},
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('routing-profile-pedestrian')),
              find.byKey(const Key('routing-profile-bicycle')),
              find.byKey(const Key('routing-profile-auto')),
            ],
            label: 'RoutingSheet profiles ($tag)',
          );
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('routing-add-center-btn')),
              find.byKey(const Key('routing-add-draft-btn')),
            ],
            label: 'RoutingSheet waypoints ($tag)',
          );
          await tester.tap(find.byKey(const Key('routing-tab-iso')));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('routing-iso-min-5')),
              find.byKey(const Key('routing-iso-min-10')),
              find.byKey(const Key('routing-iso-min-15')),
              find.byKey(const Key('routing-iso-min-20')),
              find.byKey(const Key('routing-iso-min-30')),
            ],
            label: 'RoutingSheet isochrone bands ($tag)',
          );

          // 3) OsmImportSheet — 5x2 structured matrix
          await tester.pumpWidget(
            _themedStack(
              OsmImportSheet(
                west: 16.36,
                south: 48.20,
                east: 16.38,
                north: 48.22,
                onImportFeatures: (_) {},
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('osm-preset-highway')),
              find.byKey(const Key('osm-preset-waterway')),
              find.byKey(const Key('osm-preset-building')),
              find.byKey(const Key('osm-preset-natural')),
              find.byKey(const Key('osm-preset-amenity')),
            ],
            label: 'OsmImportSheet row 1 ($tag)',
          );

          // 4) BasemapSwitcherSheet
          await tester.pumpWidget(
            MaterialApp(
              theme: buildEarthlyTheme(Brightness.light),
              home: Scaffold(
                body: BasemapSwitcherSheet(
                  activeBasemap: BasemapKind.auto,
                  offlineBasemap: null,
                  showLabels: true,
                  calloutMode: CalloutDisplayMode.full,
                  themeMode: ThemeMode.system,
                  onThemeModeChanged: (_) {},
                  backgroundMode: MapBackgroundMode.combined,
                  satelliteOpacity: 0.75,
                  onBackgroundModeChanged: (_) {},
                  onSatelliteOpacityChanged: (_) {},
                  onExportMapPosterPng: () {},
                  onTogglePointClustering: (_) {},
                  onSelectBasemap: (_) {},
                  onLoadedOfflinePmtiles: (_) {},
                  onToggleLabels: (_) {},
                  onChangeCalloutMode: (_) {},
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('theme-mode-system')),
              find.byKey(const Key('theme-mode-light')),
              find.byKey(const Key('theme-mode-dark')),
            ],
            label: 'BasemapSwitcherSheet theme mode ($tag)',
          );
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('bg-mode-osm')),
              find.byKey(const Key('bg-mode-combined')),
              find.byKey(const Key('bg-mode-satellite')),
            ],
            label: 'BasemapSwitcherSheet bg mode ($tag)',
          );

          // 5) AccountSessionSheet (signed in with 4-action bar + NWC bar)
          const pk =
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
          await tester.pumpWidget(
            _themedStack(
              AccountSessionSheet(
                account: const Nip55Account(pubkey: pk),
                localNsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqwxyz',
                profile: const ProfileMetadataDto(
                  pubkey: pk,
                  displayName: 'Alice Cartographer',
                ),
                activeSessionSummary: 'Local LAN active',
                nwcUri: 'nostr+walletconnect://svc?relay=wss://relay.earthly.city&secret=sec',
                onNwcUriChanged: (_) {},
                onAddReadOnlyNpub: (_) {},
                onOpenCashuWallet: () {},
                onBlossomServerChanged: (_) {},
                onAccountChanged: (_) {},
                onLocalKeyChanged: (_) {},
                onSaveProfile: (_) async => testPublishOutcome(),
                onOpenSpaces: () {},
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          _expectSameHorizontalRow(
            tester,
            [
              find.text('Edit Profile'),
              find.text('Copy Pubkey'),
              find.text('Backup Key'),
              find.text('Sign out'),
            ],
            label: 'AccountSessionSheet 4-action bar ($tag)',
          );

          // 6) StoryComposerDrawer + AtlasComposerSheet
          await tester.pumpWidget(
            _themedStack(
              StoryComposerDrawer(
                shelfMaps: const [],
                getCameraSnapshot: () => null,
                onUploadBlossomImage: (_) async => null,
                onPublishStory: (_) async => testPublishOutcome(),
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('story-composer-write-tab')),
              find.byKey(const Key('story-composer-preview-tab')),
            ],
            label: 'StoryComposerDrawer Write/Preview ($tag)',
          );
          _expectSameHorizontalRow(
            tester,
            [
              find.text('geo:'),
              find.text('View'),
              find.text('\$ Map'),
              find.text('@ Person'),
              find.text('+ Upload Photo'),
            ],
            label: 'StoryComposerDrawer insert toolbar ($tag)',
          );

          await tester.pumpWidget(
            _themedStack(
              AtlasComposerSheet(
                shelfMaps: const [],
                catalogMaps: const [],
                catalogStories: const [],
                onPublishAtlas: (_) async => testPublishOutcome(),
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('atlas-gov-open')),
              find.byKey(const Key('atlas-gov-schema')),
              find.byKey(const Key('atlas-gov-closed')),
            ],
            label: 'AtlasComposerSheet governance ($tag)',
          );

          // 7) DiscussionMarginSheet (indented geo comment + proposals)
          final rootComment = GeoCommentDto(
            address: '37517:bob:c1',
            eventId: 'ev-c1',
            pubkey: 'bob1234567890',
            dTag: 'c1',
            text: 'Root comment on bridge status',
            geojson: '{"type":"FeatureCollection","features":[]}',
            createdAt: BigInt.from(1791000100),
          );
          final nestedComment = GeoCommentDto(
            address: '37517:carol:c2',
            eventId: 'ev-c2',
            pubkey: 'carol1234567890',
            dTag: 'c2',
            text: 'Deeply nested reply with attached geometry',
            parentEventId: 'ev-c1',
            geojson: '{"type":"FeatureCollection","features":[]}',
            createdAt: BigInt.from(1791000200),
          );
          final mapProposal = GeoProposalDto(
            address: '37519:bob:pr1',
            eventId: 'pr1',
            pubkey: 'bob1234567890',
            dTag: 'pr1',
            targetAddress: '37515:alice:map1',
            description: 'Updated trailhead coordinates',
            geojson: '{"type":"FeatureCollection","features":[]}',
            isStoryProposal: false,
            addedCount: 2,
            modifiedCount: 1,
            removedCount: 0,
            status: 'open',
            createdAt: BigInt.from(1791000300),
          );
          await tester.pumpWidget(
            _themedStack(
              DiscussionMarginSheet(
                target: const DiscussionTarget(
                  address: '37515:alice:map1',
                  kind: 37515,
                  pubkey: 'alice',
                  title: 'Danube Bridge Network',
                ),
                relayUrls: const ['wss://relay.earthly.city'],
                hasDraftGeometry: true,
                activeCommentGeojsonId: null,
                activeProposalId: null,
                profilesByPubkey: const {
                  'bob1234567890': ProfileMetadataDto(
                    pubkey: 'bob1234567890',
                    displayName: 'Bob VeryLongCartographerHandle',
                  ),
                  'carol1234567890': ProfileMetadataDto(
                    pubkey: 'carol1234567890',
                    displayName: 'Carol AlpineFieldSurveyor',
                  ),
                },
                currentUserPubkey: 'alice',
                initialSnapshot: EntityDiscussionSnapshot(
                  rootAddress: '37515:alice:map1',
                  comments: [rootComment, nestedComment],
                  proposals: [mapProposal],
                ),
                onMuteAuthor: (_) {},
                onUploadBlossomImage: () async => 'https://blossom.earthly.city/a.jpg',
                onRequestChangesProposal: (_, _) async => testPublishOutcome(),
                onToggleCommentOverlay: (_) {},
                onToggleProposalOverlay: (_) {},
                onPostComment: (_, _, {replyTo}) async => testPublishOutcome(),
                onSubmitProposal: (_) async => testPublishOutcome(),
                onLoadProposalToDraft: (_) {},
                onApplyProposal: (_) async => testPublishOutcome(),
                onCloseProposal: (_) async => testPublishOutcome(),
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectNoChipSoup();

          await tester.tap(find.text('Proposals (1)'));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectSameHorizontalRow(
            tester,
            [
              find.text('Diff'),
              find.text('Preview'),
            ],
            label: 'DiscussionMarginSheet proposal preview bar ($tag)',
          );
          _expectSameHorizontalRow(
            tester,
            [
              find.text('Accept & Apply'),
              find.text('Request Changes'),
            ],
            label: 'DiscussionMarginSheet proposal decision bar ($tag)',
          );

          // 8) McpBridgeSheet, ShoutboxSheet, HelpShortcutsSheet, GuidedTourDialog, RawEventInspectorDialog, ZapDialog
          await tester.pumpWidget(
            _themedStack(
              McpBridgeSheet(
                state: const McpBridgeViewState(
                  running: true,
                  endpointUrl: 'http://127.0.0.1:47832/mcp',
                  authToken: 'secret1234567890',
                  port: 47832,
                  toolCount: 23,
                  totalCalls: 4,
                ),
                onStart: (_) {},
                onStop: () {},
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);

          await tester.pumpWidget(
            _themedStack(
              ShoutboxSheet(
                relayUrls: const ['wss://relay.earthly.city'],
                profilesByPubkey: const {},
                currentUserPubkey: 'alice',
                initialPostsByCategory: const {
                  'announcements': [],
                  'features': [],
                  'greetings': [],
                  'bugs': [],
                },
                onPublishPost: (_, _) async => testPublishOutcome(),
                onClose: () {},
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);

          await tester.pumpWidget(
            _themedStack(HelpShortcutsSheet(onClose: () {})),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);

          // Dialogs: ZapDialog, GuidedTourDialog, RawEventInspectorDialog
          await tester.pumpWidget(
            MaterialApp(
              theme: buildEarthlyTheme(Brightness.dark),
              home: Scaffold(
                body: Builder(
                  builder: (ctx) => Column(
                    children: [
                      TextButton(
                        key: const Key('open-zap'),
                        onPressed: () => showEarthlyZapDialog(
                          ctx,
                          recipientName: 'Alice Cartographer',
                          recipientPubkey: 'alice',
                          recipientLud16: 'alice@earthly.city',
                          targetTitle: 'Danube Trail Map',
                          targetAddress: '37515:alice:danube',
                          cashuBalanceSats: 1000,
                          hasNwcWallet: true,
                          onPayWithCashu: (_) async => 'Paid',
                          onPayWithNwc: (_) async => const NwcPaymentResultDto(
                            preimage: 'abc123',
                            feesPaidMsats: null,
                          ),
                          onSendNutzap: ({required amountSats, required comment}) async =>
                              'Sent',
                          onGenerateInvoice: ({required amountSats, required comment}) async =>
                              ZapInvoiceDto(
                            pr: 'lnbc2100n1ptest',
                            verifyUrl: null,
                            callback: 'https://earthly.city/lnurlp/alice',
                            minSats: BigInt.from(1),
                            maxSats: BigInt.from(100000),
                            allowsNostr: true,
                            amountSats: BigInt.from(amountSats),
                          ),
                        ),
                        child: const Text('Zap'),
                      ),
                      TextButton(
                        key: const Key('open-tour'),
                        onPressed: () => showEarthlyGuidedTourDialog(ctx),
                        child: const Text('Tour'),
                      ),
                      TextButton(
                        key: const Key('open-raw'),
                        onPressed: () => showRawEventInspectorDialog(
                          ctx,
                          kind: 37515,
                          title: 'Danube Map',
                          eventId: 'ev1',
                          pubkey: 'alice',
                          address: '37515:alice:danube',
                          dTag: 'danube',
                          payloadLabel: 'GeoJSON',
                          payloadContent: '{"type":"FeatureCollection","features":[]}',
                        ),
                        child: const Text('Raw'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();

          await tester.tap(find.byKey(const Key('open-zap')));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectNoChipSoup();
          await tester.tap(find.byKey(const Key('zap-generate-btn')));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          _expectSameHorizontalRow(
            tester,
            [
              find.byKey(const Key('zap-copy-invoice-btn')),
              find.byKey(const Key('zap-open-wallet-btn')),
            ],
            label: 'ZapDialog Copy/Open Wallet ($tag)',
          );
          await tester.tap(find.text('Done'));
          await tester.pumpAndSettle();

          await tester.tap(find.byKey(const Key('open-tour')));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          await tester.tap(find.text('Skip'));
          await tester.pumpAndSettle();

          await tester.tap(find.byKey(const Key('open-raw')));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          await tester.tap(find.text('Close'));
          await tester.pumpAndSettle();
        },
      );
    }
  });
}
