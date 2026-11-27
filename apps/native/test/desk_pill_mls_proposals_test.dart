import 'package:earthly_native/controllers/draft_workbench_controller.dart';
import 'package:earthly_native/drawing/drawing_model.dart';
import 'package:earthly_native/main.dart';
import 'package:earthly_native/nostr/nip55_signer.dart';
import 'package:earthly_native/shell/circles_sheet.dart';
import 'package:earthly_native/shell/desk_sheet.dart';
import 'package:earthly_native/src/rust/api/geo.dart';
import 'package:earthly_native/src/rust/api/private_groups.dart';
import 'package:earthly_native/src/rust/api/publish.dart';
import 'package:earthly_native/theme/earthly_theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

CircleWorkspaceDto _makeCircle({
  String workspaceId = 'ws-hello',
  String name = 'Hello Group!',
  List<CircleDatasetDto> datasets = const [],
  List<CircleProposalDto> proposals = const [],
}) =>
    CircleWorkspaceDto(
      workspaceId: workspaceId,
      groupId: 'grp-$workspaceId',
      name: name,
      description: 'Test group',
      recommendedBasemap: 'OpenFreeMap Liberty',
      role: 'admin',
      status: 'active',
      cursor: BigInt.from(3),
      epoch: BigInt.from(2),
      coordinatorPubkey: 'c' * 64,
      relays: const ['wss://relay.earthly.city'],
      members: [alicePk, bobPk],
      administrators: [alicePk],
      datasets: datasets,
      messages: const [],
      proposals: proposals,
      createdAtMs: BigInt.from(1791000000000),
      syncHealth: 'healthy',
      consecutiveDecryptErrors: 0,
      autoApproveJoins: false,
      cordnGroupRef: 'cordn1testgroup',
    );

const alicePk =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const bobPk =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const _sampleFeature = DrawnFeature(
  id: 'pt-1',
  kind: DrawToolMode.point,
  name: 'Trailhead',
  vertices: [Geographic(lon: 16.37, lat: 48.20)],
);

const _sampleGeoJson =
    '{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.37,48.20]},"properties":{"name":"Trailhead"}}]}';

void main() {
  testWidgets(
    'Earthly pill menu uses flush 4-segment bar and grouped action list (no multi-row pills)',
    (WidgetTester tester) async {
      setTestViewport(tester, const Size(390, 844));
      await tester.pumpWidget(
        MaterialApp(
          theme: buildEarthlyTheme(Brightness.light),
          home: EarthlySpikeHome(
            mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
                const ColoredBox(color: Color(0xFFEDF0EA)),
          ),
        ),
      );
      await tester.pump();

      await tester.tap(find.byKey(const Key('earthly-brand-pill')));
      await tester.pumpAndSettle();

      // Zero ActionChips in the pill menu!
      expect(find.byType(ActionChip), findsNothing);
      expect(find.byKey(const Key('earthly-pill-actions-group')), findsOneWidget);

      // All 4 quick-jump segments sit on the exact same single horizontal row
      final mapTop =
          tester.getTopLeft(find.byKey(const Key('earthly-pill-jump-map'))).dy;
      final relaysTop = tester
          .getTopLeft(find.byKey(const Key('earthly-pill-jump-relays')))
          .dy;
      final chatTop =
          tester.getTopLeft(find.byKey(const Key('earthly-pill-jump-chat'))).dy;
      final acctTop = tester
          .getTopLeft(find.byKey(const Key('earthly-pill-jump-account')))
          .dy;
      expect(relaysTop, closeTo(mapTop, 1.0));
      expect(chatTop, closeTo(mapTop, 1.0));
      expect(acctTop, closeTo(mapTop, 1.0));
    },
  );

  testWidgets(
    'Desk segmented toolbar stays on ONE line at 360px phone width and adapts Publish button to New / Update / Copy / Propose',
    (WidgetTester tester) async {
      setTestViewport(tester, const Size(360, 820));
      final circle = _makeCircle();

      Widget buildDesk({
        required DraftProvenance provenance,
        DraftAudienceChoice audience = DraftAudienceChoice.privateCircle,
        VoidCallback? onDetach,
      }) =>
          wrapSheetInStack(
            DeskSheet(
              activeDraftId: 'draft-1',
              savedDrafts: const [],
              relayUrls: const ['wss://relay.earthly.city'],
              draftTitle: 'Danube Loop',
              audience: audience,
              account: const Nip55Account(pubkey: alicePk),
              shelfMaps: const [],
              deskStories: const [],
              deskAtlases: const [],
              drawnFeatures: const [_sampleFeature],
              provenance: provenance,
              onDetachAsNewCopy: onDetach,
              circles: [circle],
              selectedCircleId: circle.workspaceId,
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
              onPublishDraft: (_, _) async => PublishOutcomeDto(
                eventId: 'ev1',
                outboxState: 'sent',
                relays: const [],
              ),
              onComposeStory: () {},
              onCreateAtlas: () {},
              onImportGeoJson: () {},
              onImportOsm: () {},
              onOpenRouting: () {},
              onExportGeoJsonFile: () {},
              onCopyGeoJson: () {},
              onPasteGeoJsonFromClipboard: () {},
              onValidateDraft: () async => const DraftValidationDto(
                valid: true,
                featureCount: 1,
                message: 'Valid',
              ),
              onClearDraftFeatures: () {},
              onClose: () {},
            ),
          );

      // 1. New draft -> single-line toolbar + "Publish to ..."
      await tester.pumpWidget(buildDesk(provenance: DraftProvenance.fresh));
      await tester.pump();

      final importTop =
          tester.getTopLeft(find.byKey(const Key('desk-import-file-btn'))).dy;
      final osmTop =
          tester.getTopLeft(find.byKey(const Key('desk-import-osm-btn'))).dy;
      final routeTop =
          tester.getTopLeft(find.byKey(const Key('desk-routing-btn'))).dy;
      final pasteTop = tester
          .getTopLeft(find.byKey(const Key('desk-paste-geojson-btn')))
          .dy;
      final exportTop =
          tester.getTopLeft(find.byKey(const Key('desk-export-menu-btn'))).dy;
      expect(osmTop, closeTo(importTop, 1.0));
      expect(routeTop, closeTo(importTop, 1.0));
      expect(pasteTop, closeTo(importTop, 1.0));
      expect(exportTop, closeTo(importTop, 1.0));
      expect(find.byKey(const Key('desk-provenance-banner')), findsNothing);
      final listScrollable = find
          .descendant(
            of: find.byType(ListView),
            matching: find.byType(Scrollable),
          )
          .first;
      await tester.scrollUntilVisible(
        find.byKey(const Key('desk-publish-btn')),
        120,
        scrollable: listScrollable,
      );
      expect(find.text('Publish to "Hello Group!"'), findsOneWidget);

      // 2. Updating owned map -> "Editing your map" banner + "Update in ..." + Save as Copy
      var detached = false;
      await tester.pumpWidget(
        buildDesk(
          provenance: const DraftProvenance(
            mode: DraftPublishMode.updatingOwned,
            sourceTitle: 'Danube Loop',
            targetDatasetId: 'ds-1',
            targetCircleWorkspaceId: 'ws-hello',
            targetCircleName: 'Hello Group!',
          ),
          onDetach: () => detached = true,
        ),
      );
      await tester.pump();
      await tester.scrollUntilVisible(
        find.byKey(const Key('desk-publish-btn')),
        120,
        scrollable: listScrollable,
      );
      expect(find.text('Update in "Hello Group!"'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(const Key('desk-provenance-banner')),
        -120,
        scrollable: listScrollable,
      );
      expect(find.byKey(const Key('desk-provenance-banner')), findsOneWidget);
      expect(find.text('Editing your map'), findsOneWidget);
      await tester.tap(find.byKey(const Key('desk-detach-copy-btn')));
      expect(detached, isTrue);

      // 3. Copying someone else's map -> "Creating your own copy" + "Publish Copy to ..."
      await tester.pumpWidget(
        buildDesk(
          provenance: const DraftProvenance(
            mode: DraftPublishMode.copyingOther,
            sourceTitle: 'Alpine Pass',
            sourceAuthorPubkey: bobPk,
            sourceAuthorLabel: 'Bob',
            targetCircleWorkspaceId: 'ws-hello',
            targetCircleName: 'Hello Group!',
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Creating your own copy'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(const Key('desk-publish-btn')),
        120,
        scrollable: listScrollable,
      );
      expect(find.text('Publish Copy to "Hello Group!"'), findsOneWidget);

      // 4. Proposing edit -> amber banner + proposal summary field + "Send Edit Proposal to ..."
      await tester.pumpWidget(
        buildDesk(
          provenance: const DraftProvenance(
            mode: DraftPublishMode.proposingEdit,
            sourceTitle: 'Alpine Pass',
            sourceAuthorPubkey: bobPk,
            sourceAuthorLabel: 'Bob',
            targetDatasetId: 'ds-bob',
            targetCircleWorkspaceId: 'ws-hello',
            targetCircleName: 'Hello Group!',
          ),
        ),
      );
      await tester.pump();
      await tester.scrollUntilVisible(
        find.byKey(const Key('desk-publish-btn')),
        120,
        scrollable: listScrollable,
      );
      expect(find.text('Send Edit Proposal to "Hello Group!"'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(const Key('desk-proposal-summary-field')),
        -120,
        scrollable: listScrollable,
      );
      expect(
        find.byKey(const Key('desk-proposal-summary-field')),
        findsOneWidget,
      );
      await tester.scrollUntilVisible(
        find.byKey(const Key('desk-provenance-banner')),
        -120,
        scrollable: listScrollable,
      );
      expect(find.text('Proposing edit'), findsOneWidget);
    },
  );

  test(
    'DraftWorkbenchController tracks owned/copy/proposal provenance, detaches to copy, and releases cleanly after publish',
    () {
      final ctrl = DraftWorkbenchController();
      addTearDown(ctrl.dispose);

      // Loading someone else's MLS map as copy mints a fresh dTag & sets copyingOther
      ctrl.loadCircleDataset(
        dTag: 'bob-trail',
        title: 'Bob Trail',
        parsed: const [_sampleFeature],
        isOwned: false,
        sourceAuthorPubkey: bobPk,
        sourceAuthorLabel: 'Bob',
        circleWorkspaceId: 'ws-hello',
        circleName: 'Hello Group!',
      );
      expect(ctrl.provenance.isCopyingOther, isTrue);
      expect(ctrl.draftDTag, isNot('bob-trail'));
      expect(ctrl.draftTitle, 'Bob Trail (Copy)');

      // Loading own MLS map keeps dTag & sets updatingOwned
      ctrl.loadCircleDataset(
        dTag: 'alice-trail',
        title: 'Alice Trail',
        parsed: const [_sampleFeature],
        isOwned: true,
        sourceAuthorPubkey: alicePk,
        circleWorkspaceId: 'ws-hello',
        circleName: 'Hello Group!',
      );
      expect(ctrl.provenance.isUpdatingOwned, isTrue);
      expect(ctrl.draftDTag, 'alice-trail');

      // Detaching converts to standalone copy with fresh dTag
      ctrl.detachAsNewCopy();
      expect(ctrl.provenance.isCopyingOther, isTrue);
      expect(ctrl.draftDTag, isNot('alice-trail'));
      expect(ctrl.draftTitle, 'Alice Trail (Copy)');

      // Releasing after publish resets title, features, provenance, and dTag
      final prevDTag = ctrl.draftDTag;
      ctrl.releaseAfterPublish();
      expect(ctrl.features, isEmpty);
      expect(ctrl.draftTitle, isEmpty);
      expect(ctrl.provenance.isNew, isTrue);
      expect(ctrl.draftDTag, isNot(prevDTag));
    },
  );

  testWidgets(
    'CirclesSheet distinguishes own Edit vs other Propose/Copy and supports owner Accept & Apply on MLS proposals',
    (WidgetTester tester) async {
      setTestViewport(tester, const Size(430, 900));

      final bobDs = CircleDatasetDto(
        workspaceId: 'ws-hello',
        envelopeId: 'env-bob-1',
        datasetId: 'bob-route',
        title: 'Bob Route',
        pubkey: bobPk,
        createdAt: BigInt.from(1791000010),
        geojsonJson: _sampleGeoJson,
        featureCount: 1,
        mediaAttachments: const [],
      );
      final aliceDs = CircleDatasetDto(
        workspaceId: 'ws-hello',
        envelopeId: 'env-alice-1',
        datasetId: 'alice-route',
        title: 'Alice Route',
        pubkey: alicePk,
        createdAt: BigInt.from(1791000020),
        geojsonJson: _sampleGeoJson,
        featureCount: 1,
        mediaAttachments: const [],
      );
      final bobPropOnAlice = CircleProposalDto(
        workspaceId: 'ws-hello',
        envelopeId: 'env-prop-1',
        proposalId: 'prop-water-1',
        targetDatasetId: 'alice-route',
        targetAuthorPubkey: alicePk,
        pubkey: bobPk,
        createdAt: BigInt.from(1791000030),
        title: 'Alice Route',
        summary: 'Added water fountain',
        geojsonJson: _sampleGeoJson,
        featureCount: 2,
        status: 'open',
      );
      final ws = _makeCircle(
        datasets: [aliceDs, bobDs],
        proposals: [bobPropOnAlice],
      );

      CircleDatasetDto? proposedTarget;
      CircleDatasetDto? copiedTarget;
      CircleProposalDto? previewedProposal;
      int? appliedStatusKind;

      await tester.pumpWidget(
        wrapSheetInStack(
          CirclesSheet(
            account: const Nip55Account(pubkey: alicePk),
            localNsec: 'nsec1test',
            bunkerUri: null,
            bunkerClientNsec: null,
            mlsDatabasePath: '/tmp/mls.sqlite3',
            cordnServerPubkey: 'c' * 64,
            relayUrls: const ['wss://relay.earthly.city'],
            workspaces: [ws],
            pendingJoins: const [],
            activeCircleId: ws.workspaceId,
            mountedCircleDatasetKeys: const {},
            activeCommentOverlayId: null,
            hasDraftGeometry: false,
            profilesByPubkey: const {},
            initialWorkspaceId: ws.workspaceId,
            onCordnPubkeyChanged: (_) {},
            onRefreshCircles: () async {},
            onWorkspaceUpdated: (_) {},
            onEnterCircleLens: (_) {},
            onLeaveCircleLens: () {},
            onToggleDatasetOnMap: (_, _) {},
            onZoomToDataset: (_, _) {},
            onEditDatasetInDraft: (_, _) {},
            onCopyDatasetToDraft: (_, ds) => copiedTarget = ds,
            onProposeDatasetEdit: (_, ds) => proposedTarget = ds,
            onToggleProposalOverlay: (_, p) => previewedProposal = p,
            onRespondProposal: (w, p, kind, _) async {
              appliedStatusKind = kind;
              return w;
            },
            onStartNewPrivateMap: (_) {},
            onToggleCommentGeometry: (_) {},
            onSendCircleComment: (_, _, _) async => ws,
            onOpenAccount: () {},
            onClose: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Switch to Maps tab inside the active MLS workspace
      await tester.tap(find.textContaining('Maps (2)'));
      await tester.pumpAndSettle();

      // Open proposal card under Alice's map shows Preview Diff & Accept & Apply
      expect(
        find.byKey(const Key('circle-proposal-prop-water-1')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const Key('circle-proposal-preview-prop-water-1')),
      );
      await tester.pump();
      expect(previewedProposal?.proposalId, 'prop-water-1');

      await tester.tap(
        find.byKey(const Key('circle-proposal-apply-prop-water-1')),
      );
      await tester.pumpAndSettle();
      expect(appliedStatusKind, 1631);

      // Open menu on Bob's map (second PopupMenuButton in Maps tab): shows Propose Edit & Create Editable Copy, NOT Edit Map
      final menus = find.byType(PopupMenuButton<int>);
      expect(menus, findsAtLeastNWidgets(2));
      await tester.tap(menus.last);
      await tester.pumpAndSettle();
      expect(find.text('Edit Map in Desk'), findsNothing);
      expect(find.text('Propose Edit'), findsOneWidget);
      expect(find.text('Create Copy in Desk'), findsOneWidget);

      await tester.tap(find.text('Propose Edit'));
      await tester.pumpAndSettle();
      expect(proposedTarget?.datasetId, 'bob-route');

      // Re-open Bob's menu and test Create Copy in Desk
      await tester.tap(menus.last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Create Copy in Desk'));
      await tester.pumpAndSettle();
      expect(copiedTarget?.datasetId, 'bob-route');
    },
  );
}
