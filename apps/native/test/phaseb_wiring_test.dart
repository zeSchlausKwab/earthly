import 'package:earthly_native/shell/account_session_sheet.dart';
import 'package:earthly_native/shell/agent_drawer.dart';
import 'package:earthly_native/shell/spaces_sheet.dart';
import 'package:earthly_native/shell/zap_dialog.dart';
import 'package:earthly_native/src/rust/api/nostr_client.dart';
import 'package:earthly_native/src/rust/api/publish.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  group('Phase B Flutter wiring', () {
    testWidgets(
      'AgentDrawer displays Vision badge (Text-only / Uncertain / Vision ✓) and toggles Attach Map View',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(440, 900);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);

        var attachMapView = false;
        var visionSupport = 'no-vision';

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: StatefulBuilder(
                builder: (context, setState) => Stack(
                  children: [
                    AgentDrawer(
                      messages: const <CopilotMessage>[],
                      settings: CopilotProviderSettings.offline,
                      busy: false,
                      visionSupport: visionSupport,
                      attachMapView: attachMapView,
                      onAttachMapViewChanged: (next) =>
                          setState(() => attachMapView = next),
                      onSettingsChanged: (_) {},
                      onSendPrompt: (_) {},
                      onClearChat: () {},
                      onClose: () {},
                    ),
                  ],
                ),
              ),
            ),
          ),
        );

        expect(find.byKey(const Key('agent-vision-badge')), findsOneWidget);
        expect(find.text('Text-only'), findsOneWidget);

        final toggleFinder =
            find.byKey(const Key('agent-attach-map-view-toggle'));
        expect(toggleFinder, findsOneWidget);
        // Text-only disables Attach Map View toggle.
        await tester.tap(toggleFinder);
        await tester.pump();
        expect(attachMapView, isFalse);

        // Uncertain badge enables Attach Map View toggle.
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: StatefulBuilder(
                builder: (context, setState) => Stack(
                  children: [
                    AgentDrawer(
                      messages: const <CopilotMessage>[],
                      settings: CopilotProviderSettings.openRouter,
                      busy: false,
                      visionSupport: 'uncertain',
                      attachMapView: attachMapView,
                      onAttachMapViewChanged: (next) =>
                          setState(() => attachMapView = next),
                      onSettingsChanged: (_) {},
                      onSendPrompt: (_) {},
                      onClearChat: () {},
                      onClose: () {},
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
        expect(find.text('Uncertain'), findsOneWidget);

        // Vision ✓ badge enables Attach Map View toggle and updates state.
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: StatefulBuilder(
                builder: (context, setState) => Stack(
                  children: [
                    AgentDrawer(
                      messages: const <CopilotMessage>[],
                      settings: CopilotProviderSettings.openRouter,
                      busy: false,
                      visionSupport: 'vision',
                      attachMapView: attachMapView,
                      onAttachMapViewChanged: (next) =>
                          setState(() => attachMapView = next),
                      onSettingsChanged: (_) {},
                      onSendPrompt: (_) {},
                      onClearChat: () {},
                      onClose: () {},
                    ),
                  ],
                ),
              ),
            ),
          ),
        );

        expect(find.text('Vision ✓'), findsOneWidget);
        await tester.tap(toggleFinder);
        await tester.pump();
        expect(attachMapView, isTrue);
      },
    );

    testWidgets(
      'ZapDialog shows 1-tap Send NIP-61 Nutzap and Pay via Cashu ⚡ when balance is sufficient',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(440, 900);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);

        int? nutzapAmount;
        String? nutzapComment;
        String? cashuPaidBolt11;

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (ctx) => Center(
                  child: FilledButton(
                    key: const Key('open-cashu-zap-test'),
                    onPressed: () => showEarthlyZapDialog(
                      ctx,
                      recipientName: 'Alice',
                      recipientPubkey: 'alicepk',
                      recipientLud16: 'alice@earthly.city',
                      targetTitle: 'Danube Trail Map',
                      targetAddress: '31991:alicepk:danube',
                      cashuBalanceSats: 500,
                      onPayWithCashu: (bolt11) async {
                        cashuPaidBolt11 = bolt11;
                        return 'Paid via Cashu ⚡';
                      },
                      onSendNutzap: ({required amountSats, required comment}) async {
                        nutzapAmount = amountSats;
                        nutzapComment = comment;
                        return 'Sent $amountSats sats via NIP-61 Nutzap ✓';
                      },
                      onGenerateInvoice:
                          ({required amountSats, required comment}) async =>
                              ZapInvoiceDto(
                        pr: 'lnbc2100n1ptestcashu',
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
                ),
              ),
            ),
          ),
        );

        // 1) Test 1-tap Send NIP-61 Nutzap directly from amount picker
        await tester.tap(find.byKey(const Key('open-cashu-zap-test')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('zap-send-nutzap-btn')), findsOneWidget);
        expect(find.text('Send NIP-61 Nutzap'), findsOneWidget);

        // Selecting 1000 sats exceeds 500-sat balance -> Nutzap button hides
        await tester.tap(find.byKey(const Key('zap-amount-1000')));
        await tester.pump();
        expect(find.byKey(const Key('zap-send-nutzap-btn')), findsNothing);

        // Selecting 100 sats restores Nutzap button
        await tester.tap(find.byKey(const Key('zap-amount-100')));
        await tester.pump();
        expect(find.byKey(const Key('zap-send-nutzap-btn')), findsOneWidget);

        await tester.enterText(
          find.byKey(const Key('zap-comment-field')),
          'Great trail!',
        );
        await tester.tap(find.byKey(const Key('zap-send-nutzap-btn')));
        await tester.pumpAndSettle();

        expect(nutzapAmount, 100);
        expect(nutzapComment, 'Great trail!');
        expect(find.byKey(const Key('zap-nutzap-paid-badge')), findsOneWidget);

        // Close and reopen to test Pay via Cashu ⚡ after generating BOLT-11
        await tester.tap(find.text('Done'));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('open-cashu-zap-test')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('zap-generate-btn')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('zap-pay-cashu-btn')), findsOneWidget);
        await tester.tap(find.byKey(const Key('zap-pay-cashu-btn')));
        await tester.pumpAndSettle();

        expect(cashuPaidBolt11, 'lnbc2100n1ptestcashu');
        expect(find.byKey(const Key('zap-cashu-paid-badge')), findsOneWidget);
      },
    );

    testWidgets(
      'AccountSessionSheet and SpacesSheet expose Cashu Wallet & MCP Bridge entry points',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(440, 900);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);

        var accountWalletOpened = false;
        var spacesWalletOpened = false;
        var spacesMcpOpened = false;

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Stack(
                children: [
                  AccountSessionSheet(
                    account: null,
                    localNsec: null,
                    profile: null,
                    activeSessionSummary: null,
                    cashuBalanceSats: 777,
                    onOpenCashuWallet: () => accountWalletOpened = true,
                    onAccountChanged: (_) {},
                    onLocalKeyChanged: (_) {},
                    onSaveProfile: (_) async => const PublishOutcomeDto(
                      eventId: 'ev0',
                      outboxState: 'sent',
                      relays: [],
                    ),
                    onOpenSpaces: () {},
                    onClose: () {},
                  ),
                ],
              ),
            ),
          ),
        );

        final accountWalletBtn =
            find.byKey(const Key('account-cashu-wallet-btn'));
        await tester.scrollUntilVisible(
          accountWalletBtn,
          160,
          scrollable: find.byType(Scrollable).first,
        );
        expect(find.text('777 sats · SecretBox encrypted'), findsOneWidget);
        await tester.tap(accountWalletBtn);
        await tester.pump();
        expect(accountWalletOpened, isTrue);

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Stack(
                children: [
                  SpacesSheet(
                    account: null,
                    localNsec: null,
                    relayUrls: const ['wss://relay.earthly.city'],
                    cashuBalanceSats: 777,
                    onOpenCashuWallet: () => spacesWalletOpened = true,
                    mcpBridgeRunning: true,
                    onOpenMcpBridge: () => spacesMcpOpened = true,
                    onRelayUrlsChanged: (_) {},
                    onAccountChanged: (_) {},
                    onLocalKeyChanged: (_) {},
                    onSessionStateChanged: (_, _) {},
                    onNearbySynced: () {},
                    onBroadcastBeacon: (_, _, _) async =>
                        const PublishOutcomeDto(
                      eventId: 'ev1',
                      outboxState: 'sent',
                      relays: [],
                    ),
                    onClose: () {},
                  ),
                ],
              ),
            ),
          ),
        );

        final spacesWalletBtn =
            find.byKey(const Key('spaces-cashu-wallet-btn'));
        await tester.scrollUntilVisible(
          spacesWalletBtn,
          160,
          scrollable: find.byType(Scrollable).first,
        );
        expect(find.text('Cashu Ecash Wallet (777 sats)'), findsOneWidget);
        await tester.tap(spacesWalletBtn);
        await tester.pump();
        expect(spacesWalletOpened, isTrue);

        final spacesMcpBtn = find.byKey(const Key('spaces-mcp-bridge-btn'));
        await tester.scrollUntilVisible(
          spacesMcpBtn,
          160,
          scrollable: find.byType(Scrollable).first,
        );
        expect(find.text('Local MCP Desktop Bridge (Running)'), findsOneWidget);
        await tester.tap(spacesMcpBtn);
        await tester.pump();
        expect(spacesMcpOpened, isTrue);
      },
    );
  });
}
