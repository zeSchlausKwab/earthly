import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';
import 'earthly_toast.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';
import 'qr_code_view.dart';

/// Immutable balance summary for a single Cashu mint in the NIP-60 wallet.
@immutable
class CashuMintBalanceView {
  const CashuMintBalanceView({
    required this.mintUrl,
    required this.balanceSats,
    this.proofCount = 0,
  });

  final String mintUrl;
  final int balanceSats;
  final int proofCount;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CashuMintBalanceView &&
          runtimeType == other.runtimeType &&
          mintUrl == other.mintUrl &&
          balanceSats == other.balanceSats &&
          proofCount == other.proofCount;

  @override
  int get hashCode => Object.hash(mintUrl, balanceSats, proofCount);
}

/// Immutable history record for a Cashu mint, melt, receive, send, or nutzap.
@immutable
class CashuHistoryView {
  const CashuHistoryView({
    required this.id,
    required this.direction,
    required this.amountSats,
    required this.mintUrl,
    required this.timestampMs,
    this.memo = '',
  });

  final String id;
  final String direction;
  final int amountSats;
  final String mintUrl;
  final int timestampMs;
  final String memo;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CashuHistoryView &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          direction == other.direction &&
          amountSats == other.amountSats &&
          mintUrl == other.mintUrl &&
          timestampMs == other.timestampMs &&
          memo == other.memo;

  @override
  int get hashCode =>
      Object.hash(id, direction, amountSats, mintUrl, timestampMs, memo);
}

/// Immutable view state for the NIP-60 Cashu Wallet & NIP-61 Nutzap drawer.
@immutable
class CashuWalletViewState {
  const CashuWalletViewState({
    required this.initialized,
    this.totalBalanceSats = 0,
    this.defaultMint,
    this.mints = const <CashuMintBalanceView>[],
    this.nutzapEnabled = false,
    this.p2pkPubkeyHex,
    this.pendingIncomingNutzaps = 0,
    this.history = const <CashuHistoryView>[],
  });

  final bool initialized;
  final int totalBalanceSats;
  final String? defaultMint;
  final List<CashuMintBalanceView> mints;
  final bool nutzapEnabled;
  final String? p2pkPubkeyHex;
  final int pendingIncomingNutzaps;
  final List<CashuHistoryView> history;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CashuWalletViewState &&
          runtimeType == other.runtimeType &&
          initialized == other.initialized &&
          totalBalanceSats == other.totalBalanceSats &&
          defaultMint == other.defaultMint &&
          _listEquals(mints, other.mints) &&
          nutzapEnabled == other.nutzapEnabled &&
          p2pkPubkeyHex == other.p2pkPubkeyHex &&
          pendingIncomingNutzaps == other.pendingIncomingNutzaps &&
          _listEquals(history, other.history);

  @override
  int get hashCode => Object.hash(
        initialized,
        totalBalanceSats,
        defaultMint,
        Object.hashAll(mints),
        nutzapEnabled,
        p2pkPubkeyHex,
        pendingIncomingNutzaps,
        Object.hashAll(history),
      );

  static bool _listEquals<T>(List<T> a, List<T> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

/// Immutable view model for a NUT-04 mint deposit quote (BOLT-11 invoice).
@immutable
class CashuMintQuoteView {
  const CashuMintQuoteView({
    required this.quoteId,
    required this.mintUrl,
    required this.amountSats,
    required this.bolt11,
    this.paid = false,
  });

  final String quoteId;
  final String mintUrl;
  final int amountSats;
  final String bolt11;
  final bool paid;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CashuMintQuoteView &&
          runtimeType == other.runtimeType &&
          quoteId == other.quoteId &&
          mintUrl == other.mintUrl &&
          amountSats == other.amountSats &&
          bolt11 == other.bolt11 &&
          paid == other.paid;

  @override
  int get hashCode =>
      Object.hash(quoteId, mintUrl, amountSats, bolt11, paid);
}

enum _CashuActionPanel { deposit, withdraw, receive, send }

/// Non-blocking frosted-glass drawer for the NIP-60 Cashu Ecash Wallet &
/// NIP-61 Nutzap flows (`EarthlyMapDrawer` shell).
class CashuWalletSheet extends StatefulWidget {
  const CashuWalletSheet({
    required this.state,
    required this.onInitializeWallet,
    required this.onSyncWallet,
    required this.onAddMint,
    required this.onRemoveMint,
    required this.onRequestDeposit,
    required this.onClaimDeposit,
    required this.onReceiveToken,
    required this.onSendToken,
    required this.onWithdrawBolt11,
    required this.onToggleNutzaps,
    required this.onClaimNutzaps,
    this.onBack,
    required this.onClose,
    this.walletEnabled = true,
    this.onSetWalletEnabled,
    this.busy = false,
    super.key,
  });

  static const String defaultStarterMintUrl =
      'https://mint.minibits.cash/Bitcoin';

  final CashuWalletViewState state;
  final FutureOr<void> Function(List<String> mints, bool enableNutzaps)
      onInitializeWallet;
  final FutureOr<void> Function() onSyncWallet;
  final FutureOr<void> Function(String url) onAddMint;
  final FutureOr<void> Function(String url) onRemoveMint;
  final FutureOr<CashuMintQuoteView> Function(String mintUrl, int amountSats)
      onRequestDeposit;
  final FutureOr<void> Function(String mintUrl, String quoteId) onClaimDeposit;
  final FutureOr<void> Function(String cashuToken) onReceiveToken;
  final FutureOr<String> Function(String mintUrl, int amountSats) onSendToken;
  final FutureOr<void> Function(String mintUrl, String bolt11)
      onWithdrawBolt11;
  final FutureOr<void> Function() onToggleNutzaps;
  final FutureOr<void> Function() onClaimNutzaps;
  final VoidCallback? onBack;
  final VoidCallback onClose;
  final bool walletEnabled;
  final FutureOr<void> Function(bool enabled)? onSetWalletEnabled;
  final bool busy;

  @override
  State<CashuWalletSheet> createState() => _CashuWalletSheetState();
}

class _CashuWalletSheetState extends State<CashuWalletSheet> {
  final _starterMintController = TextEditingController(
    text: CashuWalletSheet.defaultStarterMintUrl,
  );
  final _addMintController = TextEditingController();
  final _depositAmountController = TextEditingController(text: '500');
  final _withdrawBolt11Controller = TextEditingController();
  final _receiveTokenController = TextEditingController();
  final _sendAmountController = TextEditingController(text: '100');

  bool _enableNutzapsOnCreate = true;
  bool _nutzapsExpanded = true;
  bool _mintsExpanded = true;
  bool _historyExpanded = true;
  bool _settingsExpanded = true;
  bool _localBusy = false;
  String? _error;
  String? _notice;
  String? _selectedMintUrl;
  _CashuActionPanel? _activePanel;
  CashuMintQuoteView? _activeQuote;
  String? _outgoingToken;

  bool get _isBusy => widget.busy || _localBusy;

  @override
  void initState() {
    super.initState();
    _selectedMintUrl = _resolveSelectedMint(widget.state, null);
  }

  @override
  void didUpdateWidget(covariant CashuWalletSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) {
      _selectedMintUrl = _resolveSelectedMint(widget.state, _selectedMintUrl);
    }
  }

  @override
  void dispose() {
    _starterMintController.dispose();
    _addMintController.dispose();
    _depositAmountController.dispose();
    _withdrawBolt11Controller.dispose();
    _receiveTokenController.dispose();
    _sendAmountController.dispose();
    super.dispose();
  }

  static String? _resolveSelectedMint(
    CashuWalletViewState state,
    String? current,
  ) {
    final mintUrls = state.mints.map((m) => m.mintUrl).toList();
    if (current != null && mintUrls.contains(current)) {
      return current;
    }
    final preferred = state.defaultMint?.trim();
    if (preferred != null && preferred.isNotEmpty) {
      if (mintUrls.isEmpty || mintUrls.contains(preferred)) {
        return preferred;
      }
    }
    return mintUrls.isNotEmpty ? mintUrls.first : null;
  }

  static String _shortMintHost(String url) {
    final uri = Uri.tryParse(url.trim());
    if (uri == null || uri.host.isEmpty) return url;
    final path = uri.path == '/' ? '' : uri.path;
    return '${uri.host}$path';
  }

  static String _shortHex(String value) {
    final trimmed = value.trim();
    if (trimmed.length <= 16) return trimmed;
    return '${trimmed.substring(0, 8)}…${trimmed.substring(trimmed.length - 6)}';
  }

  static bool _isValidHttpUrl(String raw) {
    final uri = Uri.tryParse(raw.trim());
    return uri != null &&
        (uri.scheme == 'https' || uri.scheme == 'http') &&
        uri.host.isNotEmpty;
  }

  Future<void> _runGuarded(Future<void> Function() task) async {
    if (_isBusy) return;
    setState(() {
      _localBusy = true;
      _error = null;
      _notice = null;
    });
    try {
      await task();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) {
        setState(() => _localBusy = false);
      }
    }
  }

  Future<void> _createWallet() async {
    final raw = _starterMintController.text.trim();
    final urls = raw
        .split(RegExp(r'[\s,]+'))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    if (urls.isEmpty || !urls.every(_isValidHttpUrl)) {
      setState(() {
        _error = 'Enter a valid http(s) Cashu mint URL to initialize wallet.';
      });
      return;
    }
    await _runGuarded(() async {
      await widget.onInitializeWallet(urls, _enableNutzapsOnCreate);
      if (!mounted) return;
      setState(() => _notice = 'NIP-60 wallet initialized');
    });
  }

  Future<void> _addMint() async {
    final url = _addMintController.text.trim();
    if (!_isValidHttpUrl(url)) {
      setState(() => _error = 'Enter a valid http(s) mint URL.');
      return;
    }
    await _runGuarded(() async {
      await widget.onAddMint(url);
      if (!mounted) return;
      _addMintController.clear();
      setState(() {
        _selectedMintUrl = url;
        _notice = 'Added mint ${_shortMintHost(url)}';
      });
    });
  }

  Future<void> _requestDeposit() async {
    final mintUrl = _selectedMintUrl;
    final amount = int.tryParse(_depositAmountController.text.trim());
    if (mintUrl == null || mintUrl.isEmpty) {
      setState(() => _error = 'Add or select a Cashu mint first.');
      return;
    }
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a positive deposit amount in sats.');
      return;
    }
    await _runGuarded(() async {
      final quote = await widget.onRequestDeposit(mintUrl, amount);
      if (!mounted) return;
      setState(() {
        _activeQuote = quote;
        _notice = 'Mint quote ${quote.quoteId} ready (${quote.amountSats} sats)';
      });
    });
  }

  Future<void> _claimDeposit() async {
    final quote = _activeQuote;
    if (quote == null) return;
    await _runGuarded(() async {
      await widget.onClaimDeposit(quote.mintUrl, quote.quoteId);
      if (!mounted) return;
      setState(() {
        _activeQuote = null;
        _notice = 'Claimed ${quote.amountSats} sats from ${_shortMintHost(quote.mintUrl)}';
      });
    });
  }

  Future<void> _withdrawBolt11() async {
    final mintUrl = _selectedMintUrl;
    final bolt11 = _withdrawBolt11Controller.text.trim();
    if (mintUrl == null || mintUrl.isEmpty) {
      setState(() => _error = 'Add or select a Cashu mint first.');
      return;
    }
    if (bolt11.isEmpty) {
      setState(() => _error = 'Paste a BOLT-11 Lightning invoice to pay.');
      return;
    }
    await _runGuarded(() async {
      await widget.onWithdrawBolt11(mintUrl, bolt11);
      if (!mounted) return;
      _withdrawBolt11Controller.clear();
      setState(() => _notice = 'Lightning invoice paid from ${_shortMintHost(mintUrl)}');
    });
  }

  Future<void> _receiveToken() async {
    final token = _receiveTokenController.text.trim();
    if (token.isEmpty) {
      setState(() => _error = 'Paste a cashuA/cashuB ecash token to redeem.');
      return;
    }
    await _runGuarded(() async {
      await widget.onReceiveToken(token);
      if (!mounted) return;
      _receiveTokenController.clear();
      setState(() => _notice = 'Cashu token redeemed');
    });
  }

  Future<void> _sendToken() async {
    final mintUrl = _selectedMintUrl;
    final amount = int.tryParse(_sendAmountController.text.trim());
    if (mintUrl == null || mintUrl.isEmpty) {
      setState(() => _error = 'Add or select a Cashu mint first.');
      return;
    }
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a positive send amount in sats.');
      return;
    }
    await _runGuarded(() async {
      final token = await widget.onSendToken(mintUrl, amount);
      if (!mounted) return;
      setState(() {
        _outgoingToken = token;
        _notice = 'Created $amount sat ecash token';
      });
    });
  }

  void _copyToClipboard(String text, String message) {
    Clipboard.setData(ClipboardData(text: text));
    EarthlyToast.success(context, message);
  }

  void _togglePanel(_CashuActionPanel panel) {
    setState(() {
      _error = null;
      _notice = null;
      _activePanel = _activePanel == panel ? null : panel;
    });
  }

  Future<void> _setWalletEnabled(bool enabled) async {
    final handler = widget.onSetWalletEnabled;
    if (handler == null) return;
    await _runGuarded(() async {
      await handler(enabled);
      if (!mounted) return;
      setState(() {
        _notice = enabled
            ? 'NIP-60 Wallet enabled'
            : 'NIP-60 Wallet disabled';
      });
    });
  }

  Future<void> _syncWallet() async {
    await _runGuarded(() async {
      await widget.onSyncWallet();
      if (!mounted) return;
      setState(() => _notice = 'Wallet synced with relays');
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final state = widget.state;
    final walletEnabled = widget.walletEnabled;
    final badgeLabel = !walletEnabled
        ? 'Opt-in'
        : state.initialized
            ? 'NIP-60'
            : 'Setup';
    final badgeColor = !walletEnabled
        ? theme.colorScheme.onSurfaceVariant
        : state.initialized
            ? EarthlyColors.commentGreen
            : EarthlyColors.amber;

    return EarthlyMapDrawer(
      initialFraction: 0.68,
      accentTopBorder: true,
      desktopSide: EarthlyDrawerSide.right,
      onClose: widget.onClose,
      header: Padding(
        padding: EdgeInsets.fromLTRB(widget.onBack != null ? 4 : 14, 0, 8, 8),
        child: Row(
          children: [
            if (widget.onBack != null)
              IconButton(
                key: const Key('cashu-back-btn'),
                tooltip: 'Back',
                visualDensity: VisualDensity.compact,
                onPressed: widget.onBack,
                icon: const Icon(Icons.arrow_back, size: 18),
              ),
            const Icon(
              Icons.account_balance_wallet_outlined,
              size: 18,
              color: EarthlyColors.amber,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Row(
                children: [
                  Flexible(
                    child: Text(
                      'Wallet',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  EarthlyBadge(
                    label: badgeLabel,
                    color: badgeColor,
                  ),
                ],
              ),
            ),
            if (walletEnabled)
              TextButton.icon(
                key: const Key('cashu-sync-btn'),
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                ),
                onPressed: _isBusy ? null : _syncWallet,
                icon: _isBusy
                    ? const SizedBox(
                        width: 13,
                        height: 13,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.sync, size: 15),
                label: const Text('Sync'),
              ),
            IconButton(
              tooltip: 'Close Cashu Wallet',
              visualDensity: VisualDensity.compact,
              onPressed: widget.onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 8, 14, 24),
        children: [
          if (_error != null) ...[
            _StatusBanner(
              message: _error!,
              color: EarthlyColors.destructive,
              icon: Icons.error_outline,
            ),
            const SizedBox(height: 10),
          ],
          if (_notice != null) ...[
            _StatusBanner(
              message: _notice!,
              color: EarthlyColors.commentGreen,
              icon: Icons.check_circle_outline,
            ),
            const SizedBox(height: 10),
          ],
          if (!walletEnabled)
            _buildDisabledOptInView(theme, isDark)
          else if (!state.initialized)
            _buildUninitializedView(theme, isDark)
          else ...[
            _buildBalanceHero(theme, isDark, state),
            const SizedBox(height: 12),
            _buildActionRow(),
            if (_activePanel != null) ...[
              const SizedBox(height: 12),
              _buildActiveActionCard(theme, isDark, state),
            ],
            const SizedBox(height: 14),
            _buildNutzapsCard(theme, isDark, state),
            const SizedBox(height: 12),
            _buildMintsSection(theme, isDark, state),
            const SizedBox(height: 12),
            _buildHistorySection(theme, isDark, state),
            const SizedBox(height: 12),
            _buildSettingsSection(theme, isDark),
          ],
        ],
      ),
    );
  }

  Widget _buildDisabledOptInView(ThemeData theme, bool isDark) {
    return _SectionCard(
      isDark: isDark,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: EarthlyColors.amber.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(11),
                  border: Border.all(
                    color: EarthlyColors.amber.withValues(alpha: 0.35),
                  ),
                ),
                child: const Icon(
                  Icons.account_balance_wallet_outlined,
                  color: EarthlyColors.amber,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'NIP-60 Cashu Ecash Wallet',
                      style: theme.textTheme.titleSmall,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Disabled by default for new users.',
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Enable the opt-in NIP-60 wallet to store encrypted Cashu ecash proofs on Nostr relays, send and receive sats, and claim NIP-61 Nutzaps.',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            key: const Key('cashu-enable-wallet-btn'),
            onPressed: _isBusy ? null : () => _setWalletEnabled(true),
            icon: _isBusy
                ? const SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.bolt, size: 17),
            label: const Text('Enable NIP-60 Wallet'),
          ),
        ],
      ),
    );
  }

  Widget _buildUninitializedView(ThemeData theme, bool isDark) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionCard(
          isDark: isDark,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: EarthlyColors.amber.withValues(alpha: 0.16),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: EarthlyColors.amber.withValues(alpha: 0.4),
                      ),
                    ),
                    child: const Icon(
                      Icons.sync,
                      color: EarthlyColors.amber,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Already have a NIP-60 wallet?',
                          style: theme.textTheme.titleSmall,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Sync encrypted mints and proofs from your Nostr relays.',
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const Key('cashu-sync-existing-btn'),
                onPressed: _isBusy ? null : _syncWallet,
                icon: _isBusy
                    ? const SizedBox(
                        width: 15,
                        height: 15,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.cloud_download_outlined, size: 17),
                label: const Text('Sync Existing Wallet from Relays'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _SectionCard(
          isDark: isDark,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: EarthlyColors.amber.withValues(alpha: 0.16),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: EarthlyColors.amber.withValues(alpha: 0.4),
                      ),
                    ),
                    child: const Icon(
                      Icons.bolt,
                      color: EarthlyColors.amber,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Create New NIP-60 Wallet',
                          style: theme.textTheme.titleSmall,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Encrypted Cashu proofs synced to Nostr relays, with optional NIP-61 P2PK Nutzaps.',
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              TextField(
                key: const Key('cashu-starter-mint-input'),
                controller: _starterMintController,
                enabled: !_isBusy,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  labelText: 'Starter Mint URL',
                  hintText: CashuWalletSheet.defaultStarterMintUrl,
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Enable NIP-61 Nutzaps',
                          style: theme.textTheme.titleSmall,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Publish kind 10019 receiving info with a P2PK ecash key.',
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Switch.adaptive(
                    key: const Key('cashu-enable-nutzaps-switch'),
                    value: _enableNutzapsOnCreate,
                    onChanged: _isBusy
                        ? null
                        : (value) =>
                            setState(() => _enableNutzapsOnCreate = value),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const Key('cashu-create-wallet-btn'),
                onPressed: _isBusy ? null : _createWallet,
                icon: _isBusy
                    ? const SizedBox(
                        width: 15,
                        height: 15,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add_circle_outline, size: 17),
                label: Text(
                  _isBusy ? 'Creating Wallet…' : 'Create New NIP-60 Wallet',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: const Key('cashu-disable-wallet-btn'),
            onPressed: _isBusy ? null : () => _setWalletEnabled(false),
            style: TextButton.styleFrom(
              foregroundColor: theme.colorScheme.onSurfaceVariant,
            ),
            icon: const Icon(Icons.visibility_off_outlined, size: 15),
            label: const Text('Disable NIP-60 Wallet'),
          ),
        ),
      ],
    );
  }

  Widget _buildBalanceHero(
    ThemeData theme,
    bool isDark,
    CashuWalletViewState state,
  ) {
    final defaultMintLabel = (state.defaultMint ?? '').trim().isNotEmpty
        ? _shortMintHost(state.defaultMint!)
        : 'No default mint';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            EarthlyColors.amber.withValues(alpha: isDark ? 0.20 : 0.16),
            theme.colorScheme.surfaceContainerHighest
                .withValues(alpha: isDark ? 0.78 : 0.92),
          ],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: EarthlyColors.amber.withValues(alpha: isDark ? 0.45 : 0.55),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'ECASH BALANCE',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                ),
              ),
              const Spacer(),
              EarthlyBadge(
                label: '${state.mints.length} ${state.mints.length == 1 ? 'mint' : 'mints'}',
                color: isDark ? EarthlyColors.infoCyanBright : EarthlyColors.infoCyan,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '${state.totalBalanceSats} sats',
            key: const Key('cashu-balance-sats'),
            style: theme.textTheme.headlineMedium?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w800,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Default mint: $defaultMintLabel',
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(
              fontFamily: 'monospace',
              fontSize: 11.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionRow() {
    EarthlyActionBarItem actionItem({
      required Key buttonKey,
      required String label,
      required IconData icon,
      required _CashuActionPanel panel,
    }) {
      return EarthlyActionBarItem(
        key: buttonKey,
        label: label,
        icon: icon,
        emphasized: _activePanel == panel,
        onTap: () => _togglePanel(panel),
      );
    }

    return EarthlyActionBar(
      items: [
        actionItem(
          buttonKey: const Key('cashu-deposit-btn'),
          label: 'Deposit ⚡',
          icon: Icons.bolt,
          panel: _CashuActionPanel.deposit,
        ),
        actionItem(
          buttonKey: const Key('cashu-withdraw-btn'),
          label: 'Withdraw ⚡',
          icon: Icons.flash_on_outlined,
          panel: _CashuActionPanel.withdraw,
        ),
        actionItem(
          buttonKey: const Key('cashu-receive-btn'),
          label: 'Receive',
          icon: Icons.south_west,
          panel: _CashuActionPanel.receive,
        ),
        actionItem(
          buttonKey: const Key('cashu-send-btn'),
          label: 'Send',
          icon: Icons.north_east,
          panel: _CashuActionPanel.send,
        ),
      ],
    );
  }

  Widget _buildMintDropdown(CashuWalletViewState state) {
    final mints = state.mints.map((m) => m.mintUrl).toList();
    if (mints.isEmpty &&
        state.defaultMint != null &&
        state.defaultMint!.trim().isNotEmpty) {
      mints.add(state.defaultMint!.trim());
    }
    if (mints.isEmpty) {
      return const Text(
        'No mints configured — add a mint below first.',
        style: TextStyle(fontSize: 12, color: EarthlyColors.destructive),
      );
    }
    final current = mints.contains(_selectedMintUrl) ? _selectedMintUrl! : mints.first;
    return DropdownButtonFormField<String>(
      key: ValueKey<String>('cashu-mint-selector-$current'),
      initialValue: current,
      isExpanded: true,
      decoration: const InputDecoration(labelText: 'Mint'),
      items: [
        for (final url in mints)
          DropdownMenuItem<String>(
            value: url,
            child: Text(
              _shortMintHost(url),
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
          ),
      ],
      onChanged: _isBusy
          ? null
          : (value) {
              if (value != null) setState(() => _selectedMintUrl = value);
            },
    );
  }

  Widget _buildActiveActionCard(
    ThemeData theme,
    bool isDark,
    CashuWalletViewState state,
  ) {
    return _SectionCard(
      isDark: isDark,
      child: switch (_activePanel!) {
        _CashuActionPanel.deposit => _buildDepositForm(theme, state),
        _CashuActionPanel.withdraw => _buildWithdrawForm(theme, state),
        _CashuActionPanel.receive => _buildReceiveForm(theme),
        _CashuActionPanel.send => _buildSendForm(theme, state),
      },
    );
  }

  Widget _buildDepositForm(ThemeData theme, CashuWalletViewState state) {
    final quote = _activeQuote;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Deposit via Lightning (NUT-04)', style: theme.textTheme.titleSmall),
        const SizedBox(height: 10),
        _buildMintDropdown(state),
        const SizedBox(height: 8),
        TextField(
          key: const Key('cashu-deposit-amount-input'),
          controller: _depositAmountController,
          enabled: !_isBusy,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Amount (sats)',
            hintText: '500',
          ),
        ),
        const SizedBox(height: 8),
        EarthlySegmentBar<int>.single(
          compact: true,
          monospace: true,
          options: [
            for (final preset in const [100, 500, 1000, 5000])
              EarthlySegmentOption<int>(
                value: preset,
                label: '$preset sats',
                enabled: !_isBusy,
              ),
          ],
          value: int.tryParse(_depositAmountController.text.trim()),
          onChanged: (preset) => setState(
            () => _depositAmountController.text = '$preset',
          ),
        ),
        const SizedBox(height: 10),
        FilledButton.icon(
          key: const Key('cashu-request-deposit-btn'),
          onPressed: _isBusy ? null : _requestDeposit,
          icon: const Icon(Icons.qr_code_2, size: 16),
          label: const Text('Request Deposit Invoice'),
        ),
        if (quote != null) ...[
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 12),
          Center(
            child: EarthlyQrCode(
              data: quote.bolt11.toUpperCase(),
              size: 184,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '${quote.amountSats} sats · ${_shortMintHost(quote.mintUrl)} · ${quote.paid ? 'PAID' : 'AWAITING PAYMENT'}',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: EarthlyColors.amber,
            ),
          ),
          const SizedBox(height: 6),
          _MonoCopyBox(
            text: quote.bolt11,
            copyKey: const Key('cashu-copy-bolt11-btn'),
            copyTooltip: 'Copy BOLT-11 invoice',
            onCopy: () => _copyToClipboard(
              quote.bolt11,
              'Copied BOLT-11 mint invoice',
            ),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            key: const Key('cashu-claim-deposit-btn'),
            onPressed: _isBusy ? null : _claimDeposit,
            icon: const Icon(Icons.check_circle_outline, size: 16),
            label: const Text('Claim Deposit'),
          ),
        ],
      ],
    );
  }

  Widget _buildWithdrawForm(ThemeData theme, CashuWalletViewState state) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Withdraw via Lightning (NUT-05)', style: theme.textTheme.titleSmall),
        const SizedBox(height: 10),
        _buildMintDropdown(state),
        const SizedBox(height: 8),
        TextField(
          key: const Key('cashu-withdraw-bolt11-input'),
          controller: _withdrawBolt11Controller,
          enabled: !_isBusy,
          maxLines: 3,
          minLines: 2,
          decoration: const InputDecoration(
            labelText: 'BOLT-11 Lightning Invoice',
            hintText: 'lnbc...',
          ),
        ),
        const SizedBox(height: 10),
        FilledButton.icon(
          key: const Key('cashu-withdraw-submit-btn'),
          onPressed: _isBusy ? null : _withdrawBolt11,
          icon: const Icon(Icons.bolt, size: 16),
          label: const Text('Pay Lightning Invoice'),
        ),
      ],
    );
  }

  Widget _buildReceiveForm(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Receive Cashu Token', style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        TextField(
          key: const Key('cashu-receive-token-input'),
          controller: _receiveTokenController,
          enabled: !_isBusy,
          maxLines: 3,
          minLines: 2,
          decoration: const InputDecoration(
            labelText: 'Cashu Token (cashuA / cashuB)',
            hintText: 'cashuAeyJ0b2tlbiI6...',
          ),
        ),
        const SizedBox(height: 10),
        FilledButton.icon(
          key: const Key('cashu-receive-submit-btn'),
          onPressed: _isBusy ? null : _receiveToken,
          icon: const Icon(Icons.south_west, size: 16),
          label: const Text('Redeem Token'),
        ),
      ],
    );
  }

  Widget _buildSendForm(ThemeData theme, CashuWalletViewState state) {
    final token = _outgoingToken;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Send Cashu Token', style: theme.textTheme.titleSmall),
        const SizedBox(height: 10),
        _buildMintDropdown(state),
        const SizedBox(height: 8),
        TextField(
          key: const Key('cashu-send-amount-input'),
          controller: _sendAmountController,
          enabled: !_isBusy,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Amount (sats)',
            hintText: '100',
          ),
        ),
        const SizedBox(height: 10),
        FilledButton.icon(
          key: const Key('cashu-send-submit-btn'),
          onPressed: _isBusy ? null : _sendToken,
          icon: const Icon(Icons.north_east, size: 16),
          label: const Text('Generate Cashu Token'),
        ),
        if (token != null && token.isNotEmpty) ...[
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 12),
          Center(
            child: EarthlyQrCode(
              data: token,
              size: 184,
            ),
          ),
          const SizedBox(height: 8),
          _MonoCopyBox(
            text: token,
            copyKey: const Key('cashu-copy-token-btn'),
            copyTooltip: 'Copy Cashu token',
            onCopy: () => _copyToClipboard(token, 'Copied Cashu token'),
          ),
        ],
      ],
    );
  }

  Widget _buildNutzapsCard(
    ThemeData theme,
    bool isDark,
    CashuWalletViewState state,
  ) {
    final p2pk = state.p2pkPubkeyHex?.trim() ?? '';
    return _CollapsibleSectionCard(
      isDark: isDark,
      toggleKey: const Key('cashu-section-nutzaps-toggle'),
      icon: const Icon(Icons.bolt, size: 17, color: EarthlyColors.amber),
      title: 'NIP-61 Nutzaps',
      badge: EarthlyBadge(
        label: state.nutzapEnabled ? 'ENABLED' : 'OFF',
        color: state.nutzapEnabled
            ? EarthlyColors.commentGreen
            : EarthlyColors.published,
      ),
      trailing: Switch.adaptive(
        key: const Key('cashu-toggle-nutzaps-btn'),
        value: state.nutzapEnabled,
        onChanged: _isBusy
            ? null
            : (_) => _runGuarded(() async {
                  await widget.onToggleNutzaps();
                }),
      ),
      expanded: _nutzapsExpanded,
      onToggle: () => setState(() => _nutzapsExpanded = !_nutzapsExpanded),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (p2pk.isNotEmpty) ...[
            Row(
              children: [
                Expanded(
                  child: Text(
                    'P2PK: ${_shortHex(p2pk)}',
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11.5,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Copy P2PK pubkey',
                  visualDensity: VisualDensity.compact,
                  onPressed: () =>
                      _copyToClipboard(p2pk, 'Copied NIP-61 P2PK pubkey'),
                  icon: const Icon(Icons.copy, size: 14),
                ),
              ],
            ),
            const SizedBox(height: 6),
          ],
          Row(
            children: [
              Expanded(
                child: Text(
                  state.pendingIncomingNutzaps > 0
                      ? '${state.pendingIncomingNutzaps} pending incoming nutzap${state.pendingIncomingNutzaps == 1 ? '' : 's'}'
                      : 'No pending incoming nutzaps',
                  style: theme.textTheme.bodySmall,
                ),
              ),
              const SizedBox(width: 8),
              FilledButton.tonalIcon(
                key: const Key('cashu-claim-nutzaps-btn'),
                onPressed: _isBusy
                    ? null
                    : () => _runGuarded(() async {
                          await widget.onClaimNutzaps();
                          if (!mounted) return;
                          setState(() => _notice = 'Checked & claimed nutzaps');
                        }),
                icon: const Icon(Icons.download_done, size: 15),
                label: Text(
                  state.pendingIncomingNutzaps > 0
                      ? 'Claim (${state.pendingIncomingNutzaps})'
                      : 'Claim Nutzaps',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMintsSection(
    ThemeData theme,
    bool isDark,
    CashuWalletViewState state,
  ) {
    return _CollapsibleSectionCard(
      isDark: isDark,
      toggleKey: const Key('cashu-section-mints-toggle'),
      title: 'Mints',
      badge: EarthlyBadge(
        label: '${state.mints.length}',
        color: EarthlyColors.amber,
      ),
      expanded: _mintsExpanded,
      onToggle: () => setState(() => _mintsExpanded = !_mintsExpanded),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (state.mints.isEmpty)
            Text(
              'No mints added yet.',
              style: theme.textTheme.bodySmall,
            )
          else
            for (var i = 0; i < state.mints.length; i++) ...[
              _MintRow(
                mint: state.mints[i],
                isDefault: state.mints[i].mintUrl == state.defaultMint,
                busy: _isBusy,
                onRemove: () => _runGuarded(() async {
                  await widget.onRemoveMint(state.mints[i].mintUrl);
                }),
              ),
              if (i < state.mints.length - 1) const Divider(height: 12),
            ],
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('cashu-add-mint-input'),
                  controller: _addMintController,
                  enabled: !_isBusy,
                  keyboardType: TextInputType.url,
                  decoration: const InputDecoration(
                    hintText: 'https://mint.example.com',
                    labelText: 'Add Mint URL',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                key: const Key('cashu-add-mint-btn'),
                onPressed: _isBusy ? null : _addMint,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildHistorySection(
    ThemeData theme,
    bool isDark,
    CashuWalletViewState state,
  ) {
    return _CollapsibleSectionCard(
      isDark: isDark,
      toggleKey: const Key('cashu-section-history-toggle'),
      title: 'History',
      badge: EarthlyBadge(
        label: '${state.history.length}',
        color: EarthlyColors.published,
      ),
      expanded: _historyExpanded,
      onToggle: () => setState(() => _historyExpanded = !_historyExpanded),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (state.history.isEmpty)
            Text(
              'Deposits, withdrawals, ecash transfers, and nutzaps will appear here.',
              style: theme.textTheme.bodySmall,
            )
          else
            for (var i = 0; i < state.history.length; i++) ...[
              _HistoryRow(
                entry: state.history[i],
                shortHost: _shortMintHost(state.history[i].mintUrl),
              ),
              if (i < state.history.length - 1) const Divider(height: 12),
            ],
        ],
      ),
    );
  }

  Widget _buildSettingsSection(ThemeData theme, bool isDark) {
    return _CollapsibleSectionCard(
      isDark: isDark,
      toggleKey: const Key('cashu-section-settings-toggle'),
      icon: Icon(
        Icons.tune,
        size: 16,
        color: theme.colorScheme.onSurfaceVariant,
      ),
      title: 'Settings',
      expanded: _settingsExpanded,
      onToggle: () => setState(() => _settingsExpanded = !_settingsExpanded),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Disable the opt-in NIP-60 wallet to hide it from the drawer and skip relay wallet sync. Your encrypted proofs on relays and local database remain intact.',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const Key('cashu-disable-wallet-btn'),
            onPressed: _isBusy ? null : () => _setWalletEnabled(false),
            icon: const Icon(Icons.visibility_off_outlined, size: 16),
            label: const Text('Disable NIP-60 Wallet'),
          ),
        ],
      ),
    );
  }
}

class _CollapsibleSectionCard extends StatelessWidget {
  const _CollapsibleSectionCard({
    required this.isDark,
    required this.title,
    required this.expanded,
    required this.onToggle,
    required this.child,
    this.icon,
    this.badge,
    this.trailing,
    this.toggleKey,
  });

  final bool isDark;
  final String title;
  final bool expanded;
  final VoidCallback onToggle;
  final Widget child;
  final Widget? icon;
  final Widget? badge;
  final Widget? trailing;
  final Key? toggleKey;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return _SectionCard(
      isDark: isDark,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: InkWell(
                  key: toggleKey,
                  borderRadius: BorderRadius.circular(8),
                  onTap: onToggle,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      children: [
                        if (icon != null) ...[
                          icon!,
                          const SizedBox(width: 6),
                        ],
                        Expanded(
                          child: Row(
                            children: [
                              Flexible(
                                child: Text(
                                  title,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.titleSmall,
                                ),
                              ),
                              if (badge != null) ...[
                                const SizedBox(width: 6),
                                badge!,
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(
                          expanded ? Icons.expand_less : Icons.expand_more,
                          size: 18,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              if (trailing != null) ...[
                const SizedBox(width: 8),
                trailing!,
              ],
            ],
          ),
          if (expanded) ...[
            const SizedBox(height: 10),
            child,
          ],
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.isDark,
    required this.child,
  });

  final bool isDark;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest
            .withValues(alpha: isDark ? 0.72 : 0.90),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.dividerColor),
      ),
      child: child,
    );
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({
    required this.message,
    required this.color,
    required this.icon,
  });

  final String message;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MonoCopyBox extends StatelessWidget {
  const _MonoCopyBox({
    required this.text,
    required this.copyKey,
    required this.copyTooltip,
    required this.onCopy,
  });

  final String text;
  final Key copyKey;
  final String copyTooltip;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.dividerColor),
      ),
      child: Row(
        children: [
          Expanded(
            child: SelectableText(
              text,
              maxLines: 3,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5),
            ),
          ),
          IconButton(
            key: copyKey,
            tooltip: copyTooltip,
            visualDensity: VisualDensity.compact,
            onPressed: onCopy,
            icon: const Icon(Icons.copy, size: 15),
          ),
        ],
      ),
    );
  }
}

class _MintRow extends StatelessWidget {
  const _MintRow({
    required this.mint,
    required this.isDefault,
    required this.busy,
    required this.onRemove,
  });

  final CashuMintBalanceView mint;
  final bool isDefault;
  final bool busy;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(
                      mint.mintUrl,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  if (isDefault) ...[
                    const SizedBox(width: 6),
                    const EarthlyBadge(
                      label: 'DEFAULT',
                      color: EarthlyColors.amber,
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 2),
              Text(
                '${mint.balanceSats} sats${mint.proofCount > 0 ? ' · ${mint.proofCount} proofs' : ''}',
                style: theme.textTheme.bodySmall?.copyWith(
                  fontFamily: 'monospace',
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),
        IconButton(
          key: Key('cashu-remove-mint-${mint.mintUrl}'),
          tooltip: 'Remove mint',
          visualDensity: VisualDensity.compact,
          onPressed: busy ? null : onRemove,
          icon: const Icon(
            Icons.delete_outline,
            size: 16,
            color: EarthlyColors.destructive,
          ),
        ),
      ],
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({
    required this.entry,
    required this.shortHost,
  });

  final CashuHistoryView entry;
  final String shortHost;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dir = entry.direction.toLowerCase();
    final isIncoming =
        dir == 'in' || dir == 'mint' || dir == 'receive' || dir == 'nutzap';
    final color =
        isIncoming ? EarthlyColors.commentGreen : EarthlyColors.proposedAmber;
    final sign = isIncoming ? '+' : '-';
    final timeStr = formatRelativeUnixDate(entry.timestampMs ~/ 1000);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Icon(
            isIncoming ? Icons.south_west : Icons.north_east,
            size: 15,
            color: color,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  EarthlyBadge(
                    label: entry.direction.toUpperCase(),
                    color: color,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      shortHost,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    '$sign${entry.amountSats} sats',
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: color,
                    ),
                  ),
                ],
              ),
              if (entry.memo.trim().isNotEmpty || timeStr.isNotEmpty) ...[
                const SizedBox(height: 3),
                Text(
                  [
                    if (entry.memo.trim().isNotEmpty) entry.memo.trim(),
                    if (timeStr.isNotEmpty) timeStr,
                  ].join(' · '),
                  style: theme.textTheme.bodySmall?.copyWith(fontSize: 11.5),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
