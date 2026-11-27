import 'package:earthly_native/nostr/nip55_signer.dart';
import 'package:earthly_native/shell/account_session_sheet.dart';
import 'package:earthly_native/shell/circles_sheet.dart';
import 'package:earthly_native/shell/desk_sheet.dart';
import 'package:earthly_native/shell/spaces_sheet.dart';
import 'package:earthly_native/shell/zap_dialog.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:earthly_native/src/rust/api/nwc.dart';
import 'package:earthly_native/src/rust/api/private_groups.dart';
import 'package:earthly_native/src/rust/api/settings.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

void main() {
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
      wrapSheetInStack(
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
      'CirclesSheet supports Android Amber NIP-55 sessions without local nsec or bunker and blocks read-only sessions',
      (WidgetTester tester) async {
    const amberPk =
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

    await tester.pumpWidget(
      wrapSheetInStack(
        CirclesSheet(
          account: const Nip55Account(
            pubkey: amberPk,
            signerPackage: 'com.greenart7c3.nostrsigner',
          ),
          localNsec: null,
          bunkerUri: null,
          bunkerClientNsec: null,
          isReadOnlySession: false,
          mlsDatabasePath: '/tmp/test_mls_amber.sqlite3',
          cordnServerPubkey:
              'fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37',
          relayUrls: const ['wss://relay.earthly.city'],
          workspaces: const [],
          pendingJoins: const [],
          activeCircleId: null,
          mountedCircleDatasetKeys: const {},
          activeCommentOverlayId: null,
          hasDraftGeometry: false,
          profilesByPubkey: const {},
          onCordnPubkeyChanged: (_) {},
          onRefreshCircles: () async {},
          onWorkspaceUpdated: (_) {},
          onEnterCircleLens: (_) {},
          onLeaveCircleLens: () {},
          onToggleDatasetOnMap: (_, _) {},
          onZoomToDataset: (_, _) {},
          onEditDatasetInDraft: (_, _) {},
          onStartNewPrivateMap: (_) {},
          onToggleCommentGeometry: (_) {},
          onSendCircleComment: (_, _, _) async => throw UnimplementedError(),
          onOpenAccount: () {},
          onClose: () {},
        ),
      ),
    );

    // Amber NIP-55 session should render the full MLS Groups UI, NOT the sign-in wall.
    expect(find.text('Open Account & Sign In'), findsNothing);
    expect(find.text('MLS Groups'), findsOneWidget);

    // Read-only watch session should display read-only guidance instead.
    await tester.pumpWidget(
      wrapSheetInStack(
        CirclesSheet(
          account: const Nip55Account(pubkey: amberPk),
          localNsec: null,
          bunkerUri: null,
          bunkerClientNsec: null,
          isReadOnlySession: true,
          mlsDatabasePath: '/tmp/test_mls_ro.sqlite3',
          cordnServerPubkey:
              'fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37',
          relayUrls: const ['wss://relay.earthly.city'],
          workspaces: const [],
          pendingJoins: const [],
          activeCircleId: null,
          mountedCircleDatasetKeys: const {},
          activeCommentOverlayId: null,
          hasDraftGeometry: false,
          profilesByPubkey: const {},
          onCordnPubkeyChanged: (_) {},
          onRefreshCircles: () async {},
          onWorkspaceUpdated: (_) {},
          onEnterCircleLens: (_) {},
          onLeaveCircleLens: () {},
          onToggleDatasetOnMap: (_, _) {},
          onZoomToDataset: (_, _) {},
          onEditDatasetInDraft: (_, _) {},
          onStartNewPrivateMap: (_) {},
          onToggleCommentGeometry: (_) {},
          onSendCircleComment: (_, _, _) async => throw UnimplementedError(),
          onOpenAccount: () {},
          onClose: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Read-Only Account Active'), findsOneWidget);
    expect(find.text('Open Account & Sign In'), findsOneWidget);
  });

  testWidgets(
      'AccountSessionSheet shows NIP-46 Bunker connection controls and status',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      wrapSheetInStack(
        AccountSessionSheet(
          account: null,
          localNsec: null,
          bunkerUri: null,
          profile: null,
          activeSessionSummary: null,
          onAccountChanged: (_) {},
          onLocalKeyChanged: (_) {},
          onBunkerConnected: (_) {},
          onSaveProfile: (_) async => testPublishOutcome('ev'),
          onOpenSpaces: () {},
          onClose: () {},
        ),
      ),
    );

    expect(find.text('Connect Bunker (NIP-46)'), findsOneWidget);
    await tester.tap(find.text('Connect Bunker (NIP-46)'));
    await tester.pump();
    expect(find.text('Connect'), findsOneWidget);
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
      wrapSheetInStack(
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
          onSaveProfile: (_) async => testPublishOutcome('ev'),
          onOpenSpaces: () {},
          onClose: () {},
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

  testWidgets(
      'AccountSessionSheet exposes nostrconnect:// QR login and extended kind 0 fields (website, banner, lud16)',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(900, 1100));

    ProfileEditRequest? savedProfile;

    await tester.pumpWidget(
      wrapSheetInStack(
        AccountSessionSheet(
          account: Nip55Account(pubkey: 'a' * 64),
          localNsec: null,
          profile: const ProfileMetadataDto(
            pubkey:
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            name: 'alice',
            displayName: 'Alice Explorer',
            website: 'https://earthly.city',
            lud16: 'alice@getalby.com',
          ),
          activeSessionSummary: null,
          onAccountChanged: (_) {},
          onLocalKeyChanged: (_) {},
          onSaveProfile: (req) async {
            savedProfile = req;
            return testPublishOutcome();
          },
          onOpenSpaces: () {},
          onClose: () {},
        ),
      ),
    );

    expect(find.text('https://earthly.city'), findsOneWidget);
    expect(find.text('⚡ alice@getalby.com'), findsOneWidget);

    await tester.tap(find.text('Edit Profile'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('profile-website-field')),
      'https://alice.example',
    );
    await tester.enterText(
      find.byKey(const Key('profile-lud16-field')),
      'zap@alice.example',
    );
    await tester.enterText(
      find.byKey(const Key('profile-banner-field')),
      'https://blossom.earthly.city/banner.png',
    );
    final saveBtn = find.text('Save & Publish Profile (kind 0)');
    await tester.ensureVisible(saveBtn);
    await tester.tap(saveBtn);
    await tester.pumpAndSettle();

    expect(savedProfile?.website, 'https://alice.example');
    expect(savedProfile?.lud16, 'zap@alice.example');
    expect(savedProfile?.banner, 'https://blossom.earthly.city/banner.png');

    final bunkerBtn = find.text('Connect Bunker (NIP-46)');
    await tester.ensureVisible(bunkerBtn);
    await tester.tap(bunkerBtn);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('bunker-nostrconnect-qr-btn')), findsOneWidget);
  });

  testWidgets(
      'SpacesSheet probes relay health badges and syncs/publishes NIP-65 10002 relay list',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(900, 1200));

    List<String>? updatedRelays;
    List<RelayListEntryDto>? publishedRelays;

    await tester.pumpWidget(
      wrapSheetInStack(
        SpacesSheet(
          account: const Nip55Account(pubkey: 'alice'),
          localNsec: null,
          relayUrls: const [
            'wss://relay.earthly.city',
            'wss://offline.example',
          ],
          onRelayUrlsChanged: (next) => updatedRelays = next,
          onProbeRelaysHealth: (urls) async => [
            const RelayHealthDto(
              url: 'wss://relay.earthly.city',
              reachable: true,
              latencyMs: 42,
            ),
            const RelayHealthDto(
              url: 'wss://offline.example',
              reachable: false,
              latencyMs: 0,
              error: 'timeout',
            ),
          ],
          onFetchNip65Relays: () async => const [
            RelayListEntryDto(
              url: 'wss://nos.lol',
              read: true,
              write: true,
            ),
          ],
          onPublishNip65Relays: (relays) async {
            publishedRelays = relays;
            return testPublishOutcome('rk1');
          },
          onAccountChanged: (_) {},
          onLocalKeyChanged: (_) {},
          onSessionStateChanged: (_, _) {},
          onNearbySynced: () {},
          onBroadcastBeacon: (_, _, _) async => testPublishOutcome('b1'),
          onClose: () {},
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('spaces-tab-network')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('spaces-tab-network')));
    await tester.pumpAndSettle();

    final probeBtn = find.byKey(const Key('spaces-probe-relays-btn'));
    await tester.ensureVisible(probeBtn);
    await tester.tap(probeBtn);
    await tester.pumpAndSettle();

    expect(find.text('42 ms'), findsOneWidget);
    expect(find.text('OFFLINE'), findsOneWidget);

    await tester.tap(find.byKey(const Key('spaces-sync-nip65-btn')));
    await tester.pumpAndSettle();
    expect(updatedRelays, contains('wss://nos.lol'));

    await tester.tap(find.byKey(const Key('spaces-publish-nip65-btn')));
    await tester.pumpAndSettle();
    expect(publishedRelays?.length, 2);
  });

  testWidgets(
      'AccountSessionSheet runs guided Local-Key Backup Wizard and verifies suffix',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    const testNsec =
        'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqwxyz';
    const testPubkey =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    await tester.pumpWidget(
      wrapSheetInStack(
        AccountSessionSheet(
          account: const Nip55Account(pubkey: testPubkey),
          localNsec: testNsec,
          profile: const ProfileMetadataDto(
            pubkey: testPubkey,
            displayName: 'Field Cartographer',
          ),
          activeSessionSummary: null,
          onAccountChanged: (_) {},
          onLocalKeyChanged: (_) {},
          onSaveProfile: (_) async => testPublishOutcome('ev0'),
          onOpenSpaces: () {},
          onClose: () {},
        ),
      ),
    );

    final backupBtn = find.byKey(const Key('account-backup-wizard-btn'));
    await tester.ensureVisible(backupBtn);
    await tester.tap(backupBtn);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('backup-reveal-btn')));
    await tester.pumpAndSettle();
    expect(find.text(testNsec), findsOneWidget);

    await tester.tap(find.byKey(const Key('backup-next-btn')));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('backup-verify-input')), '0000');
    await tester.pump();
    final confirmBtn =
        tester.widget<FilledButton>(find.byKey(const Key('backup-confirm-btn')));
    expect(confirmBtn.onPressed, isNull);

    await tester.enterText(find.byKey(const Key('backup-verify-input')), 'wxyz');
    await tester.pump();
    await tester.tap(find.byKey(const Key('backup-confirm-btn')));
    await tester.pumpAndSettle();

    expect(find.textContaining('Backup Verified'), findsOneWidget);
  });

  testWidgets(
      'AccountSessionSheet connects NWC wallet & ZapDialog pays invoice 1-tap via NWC',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    String? connectedUri;

    await tester.pumpWidget(
      wrapInScaffold(
        StatefulBuilder(
          builder: (ctx, setModalState) => Stack(
            children: [
              AccountSessionSheet(
                account: null,
                localNsec: null,
                profile: null,
                activeSessionSummary: null,
                nwcUri: connectedUri,
                onNwcUriChanged: (u) => setModalState(() => connectedUri = u),
                onCheckNwcStatus: (uri) async => NwcWalletStatusDto(
                  servicePubkey: 'svc',
                  relays: const ['wss://relay.earthly.city'],
                  lud16: null,
                  methods: const ['pay_invoice', 'get_balance'],
                  balanceSats: BigInt.from(4200),
                  canPay: true,
                ),
                onAccountChanged: (_) {},
                onLocalKeyChanged: (_) {},
                onSaveProfile: (_) async => testPublishOutcome('ev0'),
                onOpenSpaces: () {},
                onClose: () {},
              ),
            ],
          ),
        ),
      ),
    );

    final nwcInput = find.byKey(const Key('nwc-uri-input'));
    await tester.scrollUntilVisible(
      nwcInput,
      160,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.enterText(
      nwcInput,
      'nostr+walletconnect://svc?relay=wss://relay.earthly.city&secret=sec',
    );
    await tester.tap(find.byKey(const Key('nwc-connect-btn')));
    await tester.pumpAndSettle();

    expect(find.text('NWC Connected'), findsOneWidget);
    expect(find.text('4200 sats'), findsOneWidget);

    String? paidBolt11;
    await tester.pumpWidget(
      wrapInScaffold(
        Builder(
          builder: (ctx) => Center(
            child: FilledButton(
              key: const Key('open-nwc-zap-test'),
              onPressed: () => showEarthlyZapDialog(
                ctx,
                recipientName: 'Bob',
                recipientPubkey: 'bobpk',
                recipientLud16: 'bob@earthly.city',
                targetTitle: 'Trail Atlas',
                targetAddress: '37518:bobpk:atlas',
                hasNwcWallet: true,
                onPayWithNwc: (bolt11) async {
                  paidBolt11 = bolt11;
                  return const NwcPaymentResultDto(
                    preimage: 'deadbeef1234567890',
                    feesPaidMsats: null,
                  );
                },
                onGenerateInvoice: ({required amountSats, required comment}) async =>
                    ZapInvoiceDto(
                  pr: 'lnbc2100n1ptestnwc',
                  verifyUrl: null,
                  callback: 'https://earthly.city/lnurlp/bob',
                  minSats: BigInt.from(1),
                  maxSats: BigInt.from(100000),
                  allowsNostr: true,
                  amountSats: BigInt.from(amountSats),
                ),
              ),
              child: const Text('Zap'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('open-nwc-zap-test')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('zap-generate-btn')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('zap-pay-nwc-btn')));
    await tester.pumpAndSettle();

    expect(paidBolt11, 'lnbc2100n1ptestnwc');
    expect(find.byKey(const Key('zap-nwc-paid-badge')), findsOneWidget);
  });

  testWidgets(
      'SpacesSheet and DeskSheet render Outbox Queue buttons with pending badge and trigger callbacks',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(900, 1200));

    var spacesOutboxTapped = false;
    await tester.pumpWidget(
      wrapSheetInStack(
        SpacesSheet(
          account: const Nip55Account(pubkey: 'alice'),
          localNsec: null,
          relayUrls: const ['wss://relay.earthly.city'],
          pendingOutboxCount: 3,
          onOpenOutbox: () => spacesOutboxTapped = true,
          onRelayUrlsChanged: (_) {},
          onAccountChanged: (_) {},
          onLocalKeyChanged: (_) {},
          onSessionStateChanged: (_, _) {},
          onNearbySynced: () {},
          onBroadcastBeacon: (_, _, _) async => testPublishOutcome('b1'),
          onClose: () {},
        ),
      ),
    );

    final spacesOutboxBtn = find.byKey(const Key('spaces-outbox-btn'));
    expect(spacesOutboxBtn, findsOneWidget);
    expect(find.text('OUTBOX QUEUE'), findsOneWidget);
    expect(find.text('3 pending publishes waiting for relay'), findsOneWidget);
    await tester.tap(spacesOutboxBtn);
    await tester.pump();
    expect(spacesOutboxTapped, isTrue);

    var deskOutboxTapped = false;
    await tester.pumpWidget(
      wrapSheetInStack(
        DeskSheet(
          activeDraftId: 'd-outbox',
          savedDrafts: const [],
          relayUrls: const ['wss://relay.earthly.city'],
          draftTitle: 'Outbox Draft',
          audience: DraftAudienceChoice.publicRelay,
          account: null,
          shelfMaps: const [],
          deskStories: const [],
          deskAtlases: const [],
          drawnFeatures: const [],
          pendingOutboxCount: 2,
          onOpenOutbox: () => deskOutboxTapped = true,
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
          onPublishDraft: (_, _) async => testPublishOutcome(),
          onComposeStory: () {},
          onCreateAtlas: () {},
          onImportGeoJson: () {},
          onExportGeoJsonFile: () {},
          onCopyGeoJson: () {},
          onClearDraftFeatures: () {},
          onClose: () {},
        ),
      ),
    );

    final deskOutboxBtn = find.byKey(const Key('desk-outbox-btn'));
    await tester.scrollUntilVisible(
      deskOutboxBtn,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(deskOutboxBtn);
    await tester.pumpAndSettle();
    expect(find.text('Outbox Queue (2 pending)'), findsOneWidget);
    await tester.tap(deskOutboxBtn);
    await tester.pump();
    expect(deskOutboxTapped, isTrue);
  });

  testWidgets(
      'SpacesSheet renders 3 tabs (Groups | Nearby | Network), MLS group list, expandable Nearby/Diagnostics sections',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    final ws = CircleWorkspaceDto(
      workspaceId: 'ws-ridge',
      groupId: 'grp-ridge',
      name: 'Ridge Mappers',
      description: 'Private group',
      recommendedBasemap: 'OpenFreeMap Liberty',
      role: 'admin',
      status: 'active',
      cursor: BigInt.from(1),
      epoch: BigInt.from(1),
      coordinatorPubkey: 'c' * 64,
      relays: const ['wss://relay.earthly.city'],
      members: const ['a', 'b'],
      administrators: const ['a'],
      datasets: const [],
      messages: const [],
      createdAtMs: BigInt.from(1791000000000),
    );

    CircleWorkspaceDto? selectedCircle;
    var openedCircles = false;

    await tester.pumpWidget(
      wrapSheetInStack(
        SpacesSheet(
          account: const Nip55Account(pubkey: 'alice'),
          localNsec: null,
          relayUrls: const ['wss://relay.earthly.city'],
          circles: [ws],
          pendingCircleJoinsCount: 2,
          activeCircleId: 'ws-ridge',
          onOpenCircles: () => openedCircles = true,
          onSelectCircle: (c) => selectedCircle = c,
          inboxUnreadCount: 1,
          onOpenInbox: () {},
          pendingOutboxCount: 1,
          onOpenOutbox: () {},
          onOpenShoutbox: () {},
          onOpenHelp: () {},
          onOpenCashuWallet: () {},
          onOpenMcpBridge: () {},
          onRelayUrlsChanged: (_) {},
          onAccountChanged: (_) {},
          onLocalKeyChanged: (_) {},
          onSessionStateChanged: (_, _) {},
          onNearbySynced: () {},
          onBroadcastBeacon: (_, _, _) async => testPublishOutcome('b1'),
          onClose: () {},
        ),
      ),
    );

    // No old banner; 3 tabs visible
    expect(find.text('SPACES · CIRCLES & NEARBY'), findsNothing);
    expect(find.byKey(const Key('spaces-tab-groups')), findsOneWidget);
    expect(find.byKey(const Key('spaces-tab-nearby')), findsOneWidget);
    expect(find.byKey(const Key('spaces-tab-network')), findsOneWidget);

    // Groups tab: MLS group row + pending badge + Create or Join MLS Group
    expect(find.text('Ridge Mappers'), findsOneWidget);
    expect(find.text('2 PENDING'), findsOneWidget);
    await tester.tap(find.byKey(const Key('spaces-circle-ws-ridge')));
    await tester.pump();
    expect(selectedCircle?.workspaceId, 'ws-ridge');

    await tester.tap(find.byKey(const Key('spaces-open-circles-btn')));
    await tester.pump();
    expect(openedCircles, isTrue);

    // Nearby tab: expandable Host / Join / Live Beacon sections
    await tester.tap(find.byKey(const Key('spaces-tab-nearby')));
    await tester.pumpAndSettle();
    expect(find.text('Host Field Session'), findsOneWidget);
    expect(find.text('Join Field Session'), findsOneWidget);
    expect(find.text('Live Beacon'), findsOneWidget);

    // Collapsed by default -> expand Host Field Session
    expect(find.text('Start LAN Node & Show Pairing QR'), findsNothing);
    await tester.tap(find.byKey(const Key('spaces-host-session-tile')));
    await tester.pumpAndSettle();
    expect(find.text('Start LAN Node & Show Pairing QR'), findsOneWidget);

    // Expand Live Beacon
    final verticalScrollable = find
        .byWidgetPredicate(
          (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
        )
        .first;
    final liveBeaconTile = find.byKey(const Key('spaces-live-beacon-tile'));
    await tester.scrollUntilVisible(
      liveBeaconTile,
      160,
      scrollable: verticalScrollable,
    );
    await tester.ensureVisible(liveBeaconTile);
    await tester.pumpAndSettle();
    await tester.tap(liveBeaconTile);
    await tester.pumpAndSettle();
    expect(find.text('Broadcast Map Center Beacon'), findsOneWidget);

    // Network tab: Account, Relays, Tools, collapsed Diagnostics
    await tester.tap(find.byKey(const Key('spaces-tab-network')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('spaces-cashu-wallet-btn')), findsOneWidget);
    expect(find.text('Disabled (opt-in)'), findsOneWidget);
    expect(find.text('Open Rust Core & Outbox Diagnostics'), findsNothing);

    final diagnosticsTile = find.byKey(const Key('spaces-diagnostics-tile'));
    await tester.scrollUntilVisible(
      diagnosticsTile,
      160,
      scrollable: verticalScrollable,
    );
    await tester.ensureVisible(diagnosticsTile);
    await tester.pumpAndSettle();
    await tester.tap(diagnosticsTile);
    await tester.pumpAndSettle();
    expect(find.text('Open Rust Core & Outbox Diagnostics'), findsOneWidget);
  });
}
