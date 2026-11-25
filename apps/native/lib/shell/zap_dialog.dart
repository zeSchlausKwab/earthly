import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/device_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
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
    required this.onGenerateInvoice,
  });

  final String recipientName;
  final String recipientPubkey;
  final String? recipientLud16;
  final String targetTitle;
  final String targetAddress;
  final String? targetEventId;
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
  String? _error;
  ZapInvoiceDto? _invoice;

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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'No Lightning wallet handler found — BOLT-11 invoice copied to clipboard.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final lud16 = widget.recipientLud16?.trim() ?? '';
    final hasLud16 = lud16.isNotEmpty;

    return AlertDialog(
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
                  child: const Text(
                    'This author has not added a Lightning Address (lud16) to their kind-0 profile yet.',
                    style: TextStyle(fontSize: 12),
                  ),
                ),
              const SizedBox(height: 12),
              if (_invoice == null) ...[
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final amt in _presets)
                      ChoiceChip(
                        key: Key('zap-amount-$amt'),
                        label: Text('⚡ $amt'),
                        selected: _customAmountController.text.trim().isEmpty &&
                            _selectedAmount == amt,
                        onSelected: hasLud16 && !_loading
                            ? (_) {
                                setState(() {
                                  _selectedAmount = amt;
                                  _customAmountController.clear();
                                });
                              }
                            : null,
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('zap-custom-amount-field'),
                  controller: _customAmountController,
                  enabled: hasLud16 && !_loading,
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
                  enabled: hasLud16 && !_loading,
                  maxLines: 2,
                  minLines: 1,
                  decoration: const InputDecoration(
                    labelText: 'Zap comment (optional)',
                    hintText: 'Helpful survey data!',
                  ),
                ),
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
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  alignment: WrapAlignment.center,
                  children: [
                    OutlinedButton.icon(
                      key: const Key('zap-copy-invoice-btn'),
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: _invoice!.pr));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Copied BOLT-11 Lightning invoice'),
                          ),
                        );
                      },
                      icon: const Icon(Icons.copy, size: 15),
                      label: const Text('Copy Invoice'),
                    ),
                    FilledButton.icon(
                      key: const Key('zap-open-wallet-btn'),
                      onPressed: () => _openWallet(_invoice!.pr),
                      icon: const Icon(Icons.bolt, size: 15),
                      label: const Text('Open Wallet'),
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
        if (_invoice != null)
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
          child: Text(_invoice == null ? 'Cancel' : 'Done'),
        ),
        if (_invoice == null)
          FilledButton.icon(
            key: const Key('zap-generate-btn'),
            onPressed: (!hasLud16 || _loading) ? null : _generate,
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
            ),
          ),
      ],
    );
  }
}
