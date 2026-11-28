import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/device_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/nwc.dart';
import '../theme/earthly_theme.dart';
import 'earthly_toast.dart';
import 'map_drawer.dart';
import 'qr_code_view.dart';

/// Opens the NIP-57 Lightning Zap dialog for a Map, Story, Atlas, or Profile.
Future<void> showEarthlyZapDialog(
  BuildContext context, {
  required String recipientName,
  required String recipientPubkey,
  required String? recipientLud16,
  required String targetTitle,
  required String targetAddress,
  String? targetEventId,
  bool hasNwcWallet = false,
  Future<NwcPaymentResultDto> Function(String bolt11)? onPayWithNwc,
  int? cashuBalanceSats,
  Future<String?> Function(String bolt11)? onPayWithCashu,
  Future<String?> Function({
    required int amountSats,
    required String comment,
  })? onSendNutzap,
  required Future<ZapInvoiceDto> Function({
    required int amountSats,
    required String comment,
  }) onGenerateInvoice,
}) {
  return showDialog<void>(
    context: context,
    builder: (_) => _EarthlyZapDialog(
      recipientName: recipientName,
      recipientPubkey: recipientPubkey,
      recipientLud16: recipientLud16,
      targetTitle: targetTitle,
      targetAddress: targetAddress,
      targetEventId: targetEventId,
      hasNwcWallet: hasNwcWallet,
      onPayWithNwc: onPayWithNwc,
      cashuBalanceSats: cashuBalanceSats,
      onPayWithCashu: onPayWithCashu,
      onSendNutzap: onSendNutzap,
      onGenerateInvoice: onGenerateInvoice,
    ),
  );
}

class _EarthlyZapDialog extends StatefulWidget {
  const _EarthlyZapDialog({
    required this.recipientName,
    required this.recipientPubkey,
    required this.recipientLud16,
    required this.targetTitle,
    required this.targetAddress,
    this.targetEventId,
    this.hasNwcWallet = false,
    this.onPayWithNwc,
    this.cashuBalanceSats,
    this.onPayWithCashu,
    this.onSendNutzap,
    required this.onGenerateInvoice,
  });

  final String recipientName;
  final String recipientPubkey;
  final String? recipientLud16;
  final String targetTitle;
  final String targetAddress;
  final String? targetEventId;
  final bool hasNwcWallet;
  final Future<NwcPaymentResultDto> Function(String bolt11)? onPayWithNwc;
  final int? cashuBalanceSats;
  final Future<String?> Function(String bolt11)? onPayWithCashu;
  final Future<String?> Function({
    required int amountSats,
    required String comment,
  })? onSendNutzap;
  final Future<ZapInvoiceDto> Function({
    required int amountSats,
    required String comment,
  }) onGenerateInvoice;

  @override
  State<_EarthlyZapDialog> createState() => _EarthlyZapDialogState();
}

class _EarthlyZapDialogState extends State<_EarthlyZapDialog> {
  static const List<int> _presets = [10, 21, 100, 210, 500, 1000];

  int _selectedAmount = 210;
  final _customAmountController = TextEditingController();
  final _commentController = TextEditingController();
  bool _loading = false;
  bool _payingNwc = false;
  bool _payingCashu = false;
  bool _sendingNutzap = false;
  String? _error;
  ZapInvoiceDto? _invoice;
  NwcPaymentResultDto? _nwcPaidResult;
  String? _cashuPaidMessage;
  String? _nutzapSentMessage;

  @override
  void dispose() {
    _customAmountController.dispose();
    _commentController.dispose();
    super.dispose();
  }

  int get _effectiveAmountSats {
    final custom = int.tryParse(_customAmountController.text.trim());
    if (custom != null && custom > 0) return custom;
    return _selectedAmount;
  }

  Future<void> _generate() async {
    final sats = _effectiveAmountSats;
    if (sats <= 0) {
      setState(() => _error = 'Enter a positive amount in sats.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final inv = await widget.onGenerateInvoice(
        amountSats: sats,
        comment: _commentController.text.trim(),
      );
      if (!mounted) return;
      setState(() => _invoice = inv);
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openWallet(String pr) async {
    final opened = await DeviceBridge.openExternalUri('lightning:$pr');
    if (!mounted) return;
    if (!opened) {
      await Clipboard.setData(ClipboardData(text: pr));
      if (!mounted) return;
      EarthlyToast.info(
        context,
        'No Lightning wallet handler found — BOLT-11 invoice copied to clipboard.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final lud16 = widget.recipientLud16?.trim() ?? '';
    final hasLud16 = lud16.isNotEmpty;
    final cashuSats = widget.cashuBalanceSats ?? 0;
    final hasSufficientCashu = cashuSats >= _effectiveAmountSats;
    final canNutzap = widget.onSendNutzap != null && hasSufficientCashu;
    final canConfigureAmount = hasLud16 || widget.onSendNutzap != null;

    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      title: Row(
        children: [
          const Icon(Icons.bolt, size: 20, color: EarthlyColors.amber),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Zap ${widget.recipientName}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      content: SizedBox(
        width: 340,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                widget.targetTitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 6),
              if (hasLud16)
                Text(
                  '⚡ $lud16',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: EarthlyColors.amber,
                  ),
                )
              else
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: EarthlyColors.proposedAmber.withValues(alpha: 0.14),
                    border: Border.all(
                      color: EarthlyColors.proposedAmber.withValues(alpha: 0.5),
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    widget.onSendNutzap != null
                        ? 'No Lightning Address (lud16) on profile — you can still send a NIP-61 Cashu Nutzap.'
                        : 'This author has not added a Lightning Address (lud16) to their kind-0 profile yet.',
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              if (widget.cashuBalanceSats != null) ...[
                const SizedBox(height: 6),
                Text(
                  'Cashu wallet: $cashuSats sats',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10.5,
                    color: EarthlyColors.commentGreen,
                  ),
                ),
              ],
              const SizedBox(height: 12),
              if (_nutzapSentMessage != null) ...[
                Container(
                  key: const Key('zap-nutzap-paid-badge'),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: EarthlyColors.commentGreen.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: EarthlyColors.commentGreen.withValues(alpha: 0.6),
                    ),
                  ),
                  child: Text(
                    _nutzapSentMessage!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                      color: EarthlyColors.commentGreen,
                    ),
                  ),
                ),
              ] else if (_invoice == null) ...[
                EarthlySegmentGrid<int>(
                  key: const Key('zap-amount-grid'),
                  columns: 3,
                  compact: true,
                  monospace: true,
                  selectedValues: _customAmountController.text.trim().isEmpty
                      ? {_selectedAmount}
                      : const <int>{},
                  options: [
                    for (final amt in _presets)
                      EarthlySegmentOption(
                        key: Key('zap-amount-$amt'),
                        value: amt,
                        label: '⚡ $amt',
                        enabled:
                            canConfigureAmount && !_loading && !_sendingNutzap,
                      ),
                  ],
                  onSelected: (amt) {
                    setState(() {
                      _selectedAmount = amt;
                      _customAmountController.clear();
                    });
                  },
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('zap-custom-amount-field'),
                  controller: _customAmountController,
                  enabled: canConfigureAmount && !_loading && !_sendingNutzap,
                  keyboardType: TextInputType.number,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    labelText: 'Custom amount (sats)',
                    hintText: 'e.g. 420',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  key: const Key('zap-comment-field'),
                  controller: _commentController,
                  enabled: canConfigureAmount && !_loading && !_sendingNutzap,
                  maxLines: 2,
                  minLines: 1,
                  decoration: const InputDecoration(
                    labelText: 'Zap comment (optional)',
                    hintText: 'Helpful survey data!',
                  ),
                ),
                if (canNutzap) ...[
                  const SizedBox(height: 10),
                  FilledButton.tonalIcon(
                    key: const Key('zap-send-nutzap-btn'),
                    onPressed: (_loading || _sendingNutzap)
                        ? null
                        : () async {
                            final sats = _effectiveAmountSats;
                            if (sats <= 0) {
                              setState(
                                () =>
                                    _error = 'Enter a positive amount in sats.',
                              );
                              return;
                            }
                            setState(() {
                              _sendingNutzap = true;
                              _error = null;
                            });
                            try {
                              final msg = await widget.onSendNutzap!(
                                amountSats: sats,
                                comment: _commentController.text.trim(),
                              );
                              if (!mounted) return;
                              setState(
                                () => _nutzapSentMessage =
                                    msg?.trim().isNotEmpty == true
                                        ? msg!
                                        : 'Sent $sats sats via NIP-61 Nutzap ✓',
                              );
                            } catch (err) {
                              if (!mounted) return;
                              setState(() => _error = err.toString());
                            } finally {
                              if (mounted) {
                                setState(() => _sendingNutzap = false);
                              }
                            }
                          },
                    icon: _sendingNutzap
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(
                            Icons.account_balance_wallet_outlined,
                            size: 16,
                          ),
                    label: Text(
                      _sendingNutzap ? 'Sending Nutzap…' : 'Send NIP-61 Nutzap',
                      maxLines: 1,
                      softWrap: false,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ] else ...[
                Center(
                  child: EarthlyQrCode(
                    data: _invoice!.pr.toUpperCase(),
                    size: 196,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  '${_invoice!.amountSats} sats${_invoice!.allowsNostr ? ' · NIP-57 zap receipt enabled' : ''}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: EarthlyColors.commentGreen,
                  ),
                ),
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: theme.dividerColor),
                  ),
                  child: SelectableText(
                    _invoice!.pr,
                    maxLines: 3,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 10),
                  ),
                ),
                const SizedBox(height: 10),
                if (_nwcPaidResult != null)
                  Container(
                    key: const Key('zap-nwc-paid-badge'),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: EarthlyColors.commentGreen.withValues(alpha: 0.14),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: EarthlyColors.commentGreen.withValues(alpha: 0.6),
                      ),
                    ),
                    child: Text(
                      'Paid via NWC ✓ (${_nwcPaidResult!.preimage.substring(0, _nwcPaidResult!.preimage.length.clamp(0, 12))}…)',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: EarthlyColors.commentGreen,
                      ),
                    ),
                  )
                else if (_cashuPaidMessage != null)
                  Container(
                    key: const Key('zap-cashu-paid-badge'),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: EarthlyColors.commentGreen.withValues(alpha: 0.14),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: EarthlyColors.commentGreen.withValues(alpha: 0.6),
                      ),
                    ),
                    child: Text(
                      _cashuPaidMessage!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: EarthlyColors.commentGreen,
                      ),
                    ),
                  )
                else
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (widget.onPayWithCashu != null &&
                          cashuSats >= _invoice!.amountSats.toInt()) ...[
                        FilledButton.icon(
                          key: const Key('zap-pay-cashu-btn'),
                          onPressed: _payingCashu || _payingNwc
                              ? null
                              : () async {
                                  setState(() {
                                    _payingCashu = true;
                                    _error = null;
                                  });
                                  try {
                                    final msg = await widget.onPayWithCashu!(
                                      _invoice!.pr,
                                    );
                                    if (!mounted) return;
                                    setState(
                                      () => _cashuPaidMessage =
                                          msg?.trim().isNotEmpty == true
                                              ? msg!
                                              : 'Paid via Cashu ⚡',
                                    );
                                  } catch (err) {
                                    if (!mounted) return;
                                    setState(() => _error = err.toString());
                                  } finally {
                                    if (mounted) {
                                      setState(() => _payingCashu = false);
                                    }
                                  }
                                },
                          icon: _payingCashu
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(
                                  Icons.account_balance_wallet,
                                  size: 15,
                                ),
                          label: Text(
                            _payingCashu ? 'Paying Cashu…' : 'Pay via Cashu ⚡',
                            maxLines: 1,
                            softWrap: false,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(height: 8),
                      ],
                      if (widget.hasNwcWallet &&
                          widget.onPayWithNwc != null) ...[
                        FilledButton.icon(
                          key: const Key('zap-pay-nwc-btn'),
                          onPressed: _payingNwc || _payingCashu
                              ? null
                              : () async {
                                  setState(() {
                                    _payingNwc = true;
                                    _error = null;
                                  });
                                  try {
                                    final paid = await widget.onPayWithNwc!(
                                      _invoice!.pr,
                                    );
                                    if (!mounted) return;
                                    setState(() => _nwcPaidResult = paid);
                                  } catch (err) {
                                    if (!mounted) return;
                                    setState(() => _error = err.toString());
                                  } finally {
                                    if (mounted) {
                                      setState(() => _payingNwc = false);
                                    }
                                  }
                                },
                          icon: _payingNwc
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(Icons.bolt, size: 15),
                          label: Text(
                            _payingNwc ? 'Paying NWC…' : 'Pay with NWC ⚡',
                            maxLines: 1,
                            softWrap: false,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(height: 8),
                      ],
                      EarthlyActionBar(
                        key: const Key('zap-invoice-actions-bar'),
                        stacked: false,
                        items: [
                          EarthlyActionBarItem(
                            key: const Key('zap-copy-invoice-btn'),
                            icon: Icons.copy,
                            label: 'Copy Invoice',
                            onTap: () {
                              Clipboard.setData(
                                ClipboardData(text: _invoice!.pr),
                              );
                              EarthlyToast.success(
                                context,
                                'Copied BOLT-11 Lightning invoice',
                              );
                            },
                          ),
                          EarthlyActionBarItem(
                            key: const Key('zap-open-wallet-btn'),
                            icon: Icons.open_in_new,
                            label: 'Open Wallet',
                            onTap: () => _openWallet(_invoice!.pr),
                          ),
                        ],
                      ),
                    ],
                  ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(8),
                  color: EarthlyColors.destructive.withValues(alpha: 0.12),
                  child: Text(
                    _error!,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: EarthlyColors.destructive,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        if (_invoice != null && _nutzapSentMessage == null)
          TextButton(
            onPressed: _loading
                ? null
                : () => setState(() {
                      _invoice = null;
                      _error = null;
                    }),
            child: const Text('Change Amount'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(
            (_invoice == null && _nutzapSentMessage == null) ? 'Cancel' : 'Done',
          ),
        ),
        if (_invoice == null && _nutzapSentMessage == null)
          FilledButton.icon(
            key: const Key('zap-generate-btn'),
            onPressed: (!hasLud16 || _loading || _sendingNutzap)
                ? null
                : _generate,
            icon: _loading
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.bolt, size: 16),
            label: Text(
              _loading ? 'Fetching…' : 'Zap $_effectiveAmountSats sats',
              maxLines: 1,
              softWrap: false,
            ),
          ),
      ],
    );
  }
}
