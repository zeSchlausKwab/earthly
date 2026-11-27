import 'package:earthly_native/controllers/account_wallet_controller.dart';
import 'package:earthly_native/shell/cashu_wallet_sheet.dart';
import 'package:earthly_native/shell/qr_code_view.dart';
import 'package:earthly_native/src/rust/api/settings.dart';
import 'package:earthly_native/src/rust/api/wallet.dart';
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

  Future<void> scrollAndTap(
    WidgetTester tester,
    Finder finder, {
    double delta = 120,
  }) async {
    await tester.scrollUntilVisible(
      finder,
      delta,
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
    bool walletEnabled = true,
    Future<void> Function(bool enabled)? onSetWalletEnabled,
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
      walletEnabled: walletEnabled,
      onSetWalletEnabled: onSetWalletEnabled,
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
    testWidgets(
        'disabled opt-in state hides sync, explains default, and enables wallet',
        (WidgetTester tester) async {
      bool? setEnabledArg;

      await tester.pumpWidget(
        wrapSheet(
          buildSheet(
            walletEnabled: false,
            state: const CashuWalletViewState(initialized: false),
            onSetWalletEnabled: (enabled) async => setEnabledArg = enabled,
          ),
        ),
      );

      expect(find.text('Wallet'), findsOneWidget);
      expect(find.text('Opt-in'), findsOneWidget);
      expect(find.byKey(const Key('cashu-sync-btn')), findsNothing);
      expect(find.text('Disabled by default for new users.'), findsOneWidget);
      expect(find.byKey(const Key('cashu-enable-wallet-btn')), findsOneWidget);

      await tester.tap(find.byKey(const Key('cashu-enable-wallet-btn')));
      await tester.pumpAndSettle();

      expect(setEnabledArg, isTrue);
    });

    testWidgets(
        'uninitialized enabled flow supports header sync, sync existing CTA, create wallet, and disable toggle',
        (WidgetTester tester) async {
      List<String>? createdMints;
      bool? createdNutzaps;
      var syncCount = 0;
      bool? setEnabledArg;
      var closed = false;

      await tester.pumpWidget(
        wrapSheet(
          buildSheet(
            walletEnabled: true,
            state: const CashuWalletViewState(initialized: false),
            onSetWalletEnabled: (enabled) async => setEnabledArg = enabled,
            onSyncWallet: () async => syncCount++,
            onInitializeWallet: (mints, enableNutzaps) async {
              createdMints = mints;
              createdNutzaps = enableNutzaps;
            },
            onClose: () => closed = true,
          ),
        ),
      );

      expect(find.text('Wallet'), findsOneWidget);
      expect(find.text('Setup'), findsOneWidget);
      // Sync button in header is visible even when uninitialized.
      expect(find.byKey(const Key('cashu-sync-btn')), findsOneWidget);
      expect(find.byKey(const Key('cashu-sync-existing-btn')), findsOneWidget);
      expect(find.text('Enable NIP-61 Nutzaps'), findsOneWidget);

      await tester.tap(find.byKey(const Key('cashu-sync-btn')));
      await tester.pumpAndSettle();
      expect(syncCount, 1);

      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-sync-existing-btn')),
      );
      expect(syncCount, 2);

      final starterField = tester.widget<TextField>(
        find.byKey(const Key('cashu-starter-mint-input')),
      );
      expect(
        starterField.controller?.text,
        'https://mint.minibits.cash/Bitcoin',
      );

      // Toggle off NIP-61 Nutzaps before creating
      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-enable-nutzaps-switch')),
      );

      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-create-wallet-btn')),
      );

      expect(createdMints, ['https://mint.minibits.cash/Bitcoin']);
      expect(createdNutzaps, isFalse);

      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-disable-wallet-btn')),
      );
      expect(setEnabledArg, isFalse);

      await tester.tap(find.byTooltip('Close Cashu Wallet'));
      await tester.pump();
      expect(closed, isTrue);
    });

    testWidgets(
        'initialized view displays balance, sync, collapsible sections, mint management, nutzap claim, and disable button',
        (WidgetTester tester) async {
      var syncCount = 0;
      String? addedMint;
      String? removedMint;
      var toggledNutzaps = 0;
      var claimedNutzaps = 0;
      bool? setEnabledArg;

      await tester.pumpWidget(
        wrapSheet(
          buildSheet(
            state: initializedState(),
            onSetWalletEnabled: (enabled) async => setEnabledArg = enabled,
            onSyncWallet: () async => syncCount++,
            onAddMint: (url) async => addedMint = url,
            onRemoveMint: (url) async => removedMint = url,
            onToggleNutzaps: () async => toggledNutzaps++,
            onClaimNutzaps: () async => claimedNutzaps++,
          ),
          brightness: Brightness.dark,
        ),
      );

      expect(find.text('Wallet'), findsOneWidget);
      expect(find.text('NIP-60'), findsOneWidget);
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

      // Collapse & re-expand Nutzaps section
      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-section-nutzaps-toggle')),
      );
      expect(find.byKey(const Key('cashu-claim-nutzaps-btn')), findsNothing);
      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-section-nutzaps-toggle')),
      );
      expect(find.byKey(const Key('cashu-claim-nutzaps-btn')), findsOneWidget);

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

      // Collapse History section
      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-section-history-toggle')),
      );
      expect(find.text('Field survey tip · 3m ago'), findsNothing);

      // Disable wallet inside Settings section
      await scrollAndTap(
        tester,
        find.byKey(const Key('cashu-disable-wallet-btn')),
      );
      expect(setEnabledArg, isFalse);
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

    testWidgets(
        'send token flow creates outgoing token QR and copies to clipboard',
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

  group('AccountWalletController NIP-60 opt-in & NIP-44 helpers', () {
    test(
        'nip60WalletEnabled defaults false, guards refreshCashuWalletState, and toggles cleanly',
        () async {
      final controller = AccountWalletController();
      addTearDown(controller.dispose);

      expect(controller.nip60WalletEnabled, isFalse);

      controller.updateCashuWalletState(
        CashuWalletStateDto(
          pubkeyHex: 'aaaa',
          mints: const ['https://mint.example'],
          relays: const ['wss://relay.earthly.city'],
          defaultMint: 'https://mint.example',
          balanceSats: BigInt.from(100),
          proofCount: BigInt.from(1),
          pendingTokens: const [],
          mintBalances: const [],
          p2PkPubkeyHex: '',
          nutzapEnabled: false,
          history: const [],
          updatedAt: BigInt.from(1700000000),
        ),
      );
      expect(controller.cashuWalletState, isNotNull);

      var walletNotifications = 0;
      controller.walletListenable.addListener(() => walletNotifications++);

      // Guarded refresh clears state immediately when disabled without loading SQLite.
      await controller.refreshCashuWalletState();
      expect(controller.cashuWalletState, isNull);
      expect(walletNotifications, 1);

      var persisted = 0;
      controller.setNip60WalletEnabled(
        true,
        onPersistSettings: () => persisted++,
      );
      expect(controller.nip60WalletEnabled, isTrue);
      expect(persisted, 1);
      expect(walletNotifications, 2);

      controller.updateCashuWalletState(
        CashuWalletStateDto(
          pubkeyHex: 'aaaa',
          mints: const ['https://mint.example'],
          relays: const ['wss://relay.earthly.city'],
          defaultMint: 'https://mint.example',
          balanceSats: BigInt.from(250),
          proofCount: BigInt.from(2),
          pendingTokens: const [],
          mintBalances: const [],
          p2PkPubkeyHex: '',
          nutzapEnabled: false,
          history: const [],
          updatedAt: BigInt.from(1700000001),
        ),
      );

      controller.setNip60WalletEnabled(
        false,
        onPersistSettings: () => persisted++,
      );
      expect(controller.nip60WalletEnabled, isFalse);
      expect(controller.cashuWalletState, isNull);
      expect(persisted, 2);
    });

    test('canDecryptNip44 and nip44DecryptForSelf dispatch across signers',
        () async {
      final controller = AccountWalletController();
      addTearDown(controller.dispose);

      expect(controller.canDecryptNip44, isFalse);

      // Read-only watch session cannot decrypt.
      controller.addReadOnlySession(
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      );
      expect(controller.canDecryptNip44, isFalse);
      await expectLater(
        controller.nip44DecryptForSelf(
          'cipher',
          decryptWithLocalNsec: (_) async => 'local',
          decryptWithBunker: (_, _) async => 'bunker',
        ),
        throwsStateError,
      );

      // Local nsec session dispatches to decryptWithLocalNsec.
      controller.upsertAndActivateSession(
        const SavedAccountSessionDto(
          id: 'local:aaaa',
          kind: 'local',
          pubkeyHex:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          localNsec: 'nsec1test',
        ),
      );
      expect(controller.canDecryptNip44, isTrue);
      final localPlain = await controller.nip44DecryptForSelf(
        'cipher-local',
        decryptWithLocalNsec: (c) async => 'plain:$c',
        decryptWithBunker: (_, _) async => 'unexpected',
      );
      expect(localPlain, 'plain:cipher-local');

      // NIP-46 bunker session dispatches to decryptWithBunker.
      controller.upsertAndActivateSession(
        const SavedAccountSessionDto(
          id: 'bunker:cccc',
          kind: 'bunker',
          pubkeyHex:
              'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          bunkerUri: 'bunker://cccc?relay=wss://relay.earthly.city',
          bunkerClientNsec: 'nsec1client',
        ),
      );
      expect(controller.canDecryptNip44, isTrue);
      final bunkerPlain = await controller.nip44DecryptForSelf(
        'cipher-bunker',
        decryptWithLocalNsec: (_) async => 'unexpected',
        decryptWithBunker: (pk, c) async => '$pk:$c',
      );
      expect(
        bunkerPlain,
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:cipher-bunker',
      );
    });
  });
}
