import 'package:earthly_native/shell/cashu_wallet_sheet.dart';
import 'package:earthly_native/shell/qr_code_view.dart';
import 'package:earthly_native/theme/earthly_theme.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  Finder verticalScrollable() => find
      .descendant(
        of: find.byType(ListView),
        matching: find.byType(Scrollable),
      )
      .first;

  Future<void> scrollAndTap(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(
      finder,
      120,
      scrollable: verticalScrollable(),
    );
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  Widget wrapSheet(
    Widget sheet, {
    Brightness brightness = Brightness.light,
  }) {
    return MaterialApp(
      theme: buildEarthlyTheme(brightness),
      home: Scaffold(
        body: Stack(
          children: [sheet],
        ),
      ),
    );
  }

  CashuWalletSheet buildSheet({
    required CashuWalletViewState state,
    Future<void> Function(List<String> mints, bool enableNutzaps)?
        onInitializeWallet,
    Future<void> Function()? onSyncWallet,
    Future<void> Function(String url)? onAddMint,
    Future<void> Function(String url)? onRemoveMint,
    Future<CashuMintQuoteView> Function(String mintUrl, int amountSats)?
        onRequestDeposit,
    Future<void> Function(String mintUrl, String quoteId)? onClaimDeposit,
    Future<void> Function(String cashuToken)? onReceiveToken,
    Future<String> Function(String mintUrl, int amountSats)? onSendToken,
    Future<void> Function(String mintUrl, String bolt11)? onWithdrawBolt11,
    Future<void> Function()? onToggleNutzaps,
    Future<void> Function()? onClaimNutzaps,
    VoidCallback? onClose,
  }) {
    return CashuWalletSheet(
      state: state,
      onInitializeWallet: onInitializeWallet ?? (_, _) async {},
      onSyncWallet: onSyncWallet ?? () async {},
      onAddMint: onAddMint ?? (_) async {},
      onRemoveMint: onRemoveMint ?? (_) async {},
      onRequestDeposit: onRequestDeposit ??
          (mintUrl, amountSats) async => CashuMintQuoteView(
                quoteId: 'q-default',
                mintUrl: mintUrl,
                amountSats: amountSats,
                bolt11: 'lnbc500n1ptestinvoice',
              ),
      onClaimDeposit: onClaimDeposit ?? (_, _) async {},
      onReceiveToken: onReceiveToken ?? (_) async {},
      onSendToken: onSendToken ?? (_, _) async => 'cashuAeyJ0b2tlbiI6W119',
      onWithdrawBolt11: onWithdrawBolt11 ?? (_, _) async {},
      onToggleNutzaps: onToggleNutzaps ?? () async {},
      onClaimNutzaps: onClaimNutzaps ?? () async {},
      onClose: onClose ?? () {},
    );
  }

  CashuWalletViewState initializedState() {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    return CashuWalletViewState(
      initialized: true,
      totalBalanceSats: 1420,
      defaultMint: 'https://mint.minibits.cash/Bitcoin',
      mints: const [
        CashuMintBalanceView(
          mintUrl: 'https://mint.minibits.cash/Bitcoin',
          balanceSats: 1000,
          proofCount: 4,
        ),
        CashuMintBalanceView(
          mintUrl: 'https://mint.coinos.io',
          balanceSats: 420,
          proofCount: 2,
        ),
      ],
      nutzapEnabled: true,
      p2pkPubkeyHex:
          '02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      pendingIncomingNutzaps: 2,
      history: [
        CashuHistoryView(
          id: 'h-1',
          direction: 'mint',
          amountSats: 1000,
          mintUrl: 'https://mint.minibits.cash/Bitcoin',
          timestampMs: nowMs - 120000,
          memo: 'Lightning deposit',
        ),
        CashuHistoryView(
          id: 'h-2',
          direction: 'out',
          amountSats: 210,
          mintUrl: 'https://mint.coinos.io',
          timestampMs: nowMs - 180000,
          memo: 'Field survey tip',
        ),
      ],
    );
  }

  group('CashuWalletSheet', () {
    testWidgets('uninitialized create flow pre-fills minibits mint and passes nutzap toggle',
        (WidgetTester tester) async {
      List<String>? createdMints;
      bool? createdNutzaps;
      var closed = false;

      await tester.pumpWidget(
        wrapSheet(
          buildSheet(
            state: const CashuWalletViewState(initialized: false),
            onInitializeWallet: (mints, enableNutzaps) async {
              createdMints = mints;
              createdNutzaps = enableNutzaps;
            },
            onClose: () => closed = true,
          ),
        ),
      );

      expect(find.text('CASHU WALLET'), findsOneWidget);
      expect(find.text('SETUP'), findsOneWidget);
      expect(find.text('Enable NIP-61 Nutzaps'), findsOneWidget);

      final starterField = tester.widget<TextField>(
        find.byKey(const Key('cashu-starter-mint-input')),
      );
      expect(
        starterField.controller?.text,
        'https://mint.minibits.cash/Bitcoin',
      );

      // Toggle off NIP-61 Nutzaps before creating
      await tester.tap(find.byKey(const Key('cashu-enable-nutzaps-switch')));
      await tester.pump();

      await tester.tap(find.byKey(const Key('cashu-create-wallet-btn')));
      await tester.pumpAndSettle();

      expect(createdMints, ['https://mint.minibits.cash/Bitcoin']);
      expect(createdNutzaps, isFalse);

      await tester.tap(find.byTooltip('Close Cashu Wallet'));
      await tester.pump();
      expect(closed, isTrue);
    });

    testWidgets('initialized view displays balance, sync, mint management, and nutzap claim',
        (WidgetTester tester) async {
      var syncCount = 0;
      String? addedMint;
      String? removedMint;
      var toggledNutzaps = 0;
      var claimedNutzaps = 0;

      await tester.pumpWidget(
        wrapSheet(
          buildSheet(
            state: initializedState(),
            onSyncWallet: () async => syncCount++,
            onAddMint: (url) async => addedMint = url,
            onRemoveMint: (url) async => removedMint = url,
            onToggleNutzaps: () async => toggledNutzaps++,
            onClaimNutzaps: () async => claimedNutzaps++,
          ),
          brightness: Brightness.dark,
        ),
      );

      expect(find.text('1420 sats'), findsOneWidget);
      expect(find.byKey(const Key('cashu-balance-sats')), findsOneWidget);
      expect(find.text('2 mints'), findsOneWidget);

      await tester.tap(find.byKey(const Key('cashu-sync-btn')));
      await tester.pumpAndSettle();
      expect(syncCount, 1);

      // Claim Nutzaps & toggle Nutzaps
      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-claim-nutzaps-btn')),
      );
      expect(claimedNutzaps, 1);

      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-toggle-nutzaps-btn')),
      );
      expect(toggledNutzaps, 1);

      // Mints list
      await tester.scrollUntilVisible(
        find.text('https://mint.coinos.io'),
        120,
        scrollable: verticalScrollable(),
      );
      await tester.pumpAndSettle();
      expect(find.text('https://mint.minibits.cash/Bitcoin'), findsOneWidget);
      expect(find.text('https://mint.coinos.io'), findsOneWidget);
      expect(find.text('DEFAULT'), findsOneWidget);

      // Add and remove mint
      final addMintInput = find.byKey(const Key('cashu-add-mint-input'));
      await tester.scrollUntilVisible(
        addMintInput,
        120,
        scrollable: verticalScrollable(),
      );
      await tester.ensureVisible(addMintInput);
      await tester.pumpAndSettle();
      await tester.enterText(addMintInput, 'https://8333.space:3338');
      await scrollAndTap(tester, find.byKey(const Key('cashu-add-mint-btn')));
      expect(addedMint, 'https://8333.space:3338');

      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-remove-mint-https://mint.coinos.io')),
      );
      expect(removedMint, 'https://mint.coinos.io');

      // History items
      await tester.scrollUntilVisible(
        find.text('Field survey tip · 3m ago'),
        120,
        scrollable: verticalScrollable(),
      );
      expect(find.text('Field survey tip · 3m ago'), findsOneWidget);
    });

    testWidgets('deposit flow requests quote, renders QR, and claims deposit',
        (WidgetTester tester) async {
      String? requestedMint;
      int? requestedAmount;
      String? claimedMint;
      String? claimedQuoteId;

      await tester.pumpWidget(
        wrapSheet(
          buildSheet(
            state: initializedState(),
            onRequestDeposit: (mintUrl, amountSats) async {
              requestedMint = mintUrl;
              requestedAmount = amountSats;
              return CashuMintQuoteView(
                quoteId: 'quote-abc-123',
                mintUrl: mintUrl,
                amountSats: amountSats,
                bolt11: 'lnbc750n1pdepositquote',
              );
            },
            onClaimDeposit: (mintUrl, quoteId) async {
              claimedMint = mintUrl;
              claimedQuoteId = quoteId;
            },
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('cashu-deposit-btn')));
      await tester.pumpAndSettle();

      final depositAmountInput =
          find.byKey(const Key('cashu-deposit-amount-input'));
      await tester.scrollUntilVisible(
        depositAmountInput,
        120,
        scrollable: verticalScrollable(),
      );
      await tester.ensureVisible(depositAmountInput);
      await tester.pumpAndSettle();
      await tester.enterText(depositAmountInput, '750');
      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-request-deposit-btn')),
      );

      expect(requestedMint, 'https://mint.minibits.cash/Bitcoin');
      expect(requestedAmount, 750);
      await tester.scrollUntilVisible(
        find.byType(EarthlyQrCode),
        120,
        scrollable: verticalScrollable(),
      );
      expect(find.byType(EarthlyQrCode), findsOneWidget);
      final qr = tester.widget<EarthlyQrCode>(find.byType(EarthlyQrCode));
      expect(qr.data, 'LNBC750N1PDEPOSITQUOTE');

      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-claim-deposit-btn')),
      );

      expect(claimedMint, 'https://mint.minibits.cash/Bitcoin');
      expect(claimedQuoteId, 'quote-abc-123');
    });

    testWidgets('receive token flow submits cashu token',
        (WidgetTester tester) async {
      String? receivedToken;

      await tester.pumpWidget(
        wrapSheet(
          buildSheet(
            state: initializedState(),
            onReceiveToken: (token) async => receivedToken = token,
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('cashu-receive-btn')));
      await tester.pumpAndSettle();

      final receiveInput = find.byKey(const Key('cashu-receive-token-input'));
      await tester.scrollUntilVisible(
        receiveInput,
        120,
        scrollable: verticalScrollable(),
      );
      await tester.ensureVisible(receiveInput);
      await tester.pumpAndSettle();
      await tester.enterText(
        receiveInput,
        'cashuAeyJ0b2tlbiI6W3sicHJvb2ZzIjpbXX1dfQ==',
      );
      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-receive-submit-btn')),
      );

      expect(
        receivedToken,
        'cashuAeyJ0b2tlbiI6W3sicHJvb2ZzIjpbXX1dfQ==',
      );
    });

    testWidgets('send token flow creates outgoing token QR and copies to clipboard',
        (WidgetTester tester) async {
      String? sentMint;
      int? sentAmount;
      String? copiedText;

      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (MethodCall call) async {
          if (call.method == 'Clipboard.setData') {
            copiedText = (call.arguments as Map)['text'] as String?;
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
        wrapSheet(
          buildSheet(
            state: initializedState(),
            onSendToken: (mintUrl, amountSats) async {
              sentMint = mintUrl;
              sentAmount = amountSats;
              return 'cashuAoutgoingTokenSample123';
            },
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('cashu-send-btn')));
      await tester.pumpAndSettle();

      final sendAmountInput = find.byKey(const Key('cashu-send-amount-input'));
      await tester.scrollUntilVisible(
        sendAmountInput,
        120,
        scrollable: verticalScrollable(),
      );
      await tester.ensureVisible(sendAmountInput);
      await tester.pumpAndSettle();
      await tester.enterText(sendAmountInput, '250');
      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-send-submit-btn')),
      );

      expect(sentMint, 'https://mint.minibits.cash/Bitcoin');
      expect(sentAmount, 250);
      await tester.scrollUntilVisible(
        find.byType(EarthlyQrCode),
        120,
        scrollable: verticalScrollable(),
      );
      expect(find.byType(EarthlyQrCode), findsOneWidget);
      final qr = tester.widget<EarthlyQrCode>(find.byType(EarthlyQrCode));
      expect(qr.data, 'cashuAoutgoingTokenSample123');

      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-copy-token-btn')),
      );
      expect(copiedText, 'cashuAoutgoingTokenSample123');
    });

    testWidgets('withdraw BOLT-11 flow pays invoice from selected mint',
        (WidgetTester tester) async {
      String? paidMint;
      String? paidInvoice;

      await tester.pumpWidget(
        wrapSheet(
          buildSheet(
            state: initializedState(),
            onWithdrawBolt11: (mintUrl, bolt11) async {
              paidMint = mintUrl;
              paidInvoice = bolt11;
            },
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('cashu-withdraw-btn')));
      await tester.pumpAndSettle();

      final withdrawInput =
          find.byKey(const Key('cashu-withdraw-bolt11-input'));
      await tester.scrollUntilVisible(
        withdrawInput,
        120,
        scrollable: verticalScrollable(),
      );
      await tester.ensureVisible(withdrawInput);
      await tester.pumpAndSettle();
      await tester.enterText(withdrawInput, 'lnbc200n1pwithdrawtest');
      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-withdraw-submit-btn')),
      );

      expect(paidMint, 'https://mint.minibits.cash/Bitcoin');
      expect(paidInvoice, 'lnbc200n1pwithdrawtest');
    });
  });
}
