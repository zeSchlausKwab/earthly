import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'qr_code_view.dart';

/// Opens a clean modal displaying a scannable QR code and copyable
/// `nostr:naddr1...` URI for any published Earthly Map, Story, or Atlas.
Future<void> showEarthlyShareSheet(
  BuildContext context, {
  required int kind,
  required String pubkey,
  required String dTag,
  required String title,
  required List<String> relays,
  String? featureId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _EarthlyShareNaddrSheet(
      kind: kind,
      pubkey: pubkey,
      dTag: dTag,
      title: title,
      relays: relays,
      featureId: featureId,
    ),
  );
}

class _EarthlyShareNaddrSheet extends StatefulWidget {
  const _EarthlyShareNaddrSheet({
    required this.kind,
    required this.pubkey,
    required this.dTag,
    required this.title,
    required this.relays,
    this.featureId,
  });

  final int kind;
  final String pubkey;
  final String dTag;
  final String title;
  final List<String> relays;
  final String? featureId;

  @override
  State<_EarthlyShareNaddrSheet> createState() =>
      _EarthlyShareNaddrSheetState();
}

class _EarthlyShareNaddrSheetState extends State<_EarthlyShareNaddrSheet> {
  String? _naddrUri;
  String? _error;

  @override
  void initState() {
    super.initState();
    _encode();
  }

  Future<void> _encode() async {
    try {
      await RustBridge.ensureInitialized();
      final uri = await encodeNaddrCoordinate(
        kind: widget.kind,
        pubkeyHex: widget.pubkey,
        dTag: widget.dTag,
        relays: widget.relays,
        featureId: widget.featureId,
      );
      if (mounted) setState(() => _naddrUri = uri);
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    }
  }

  String get _kindLabel => switch (widget.kind) {
        37515 => 'MAP · 37515',
        37518 => 'ATLAS · 37518',
        37520 => 'STORY · 37520',
        37522 => 'SIGHTING · 37522',
        _ => 'KIND ${widget.kind}',
      };

  Color get _kindColor => switch (widget.kind) {
        37515 => EarthlyColors.commentGreen,
        37518 => EarthlyColors.amber,
        37520 => EarthlyColors.infoCyan,
        _ => EarthlyColors.proposedAmber,
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final uri = _naddrUri;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 14, 20, 22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.22),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            Row(
              children: [
                EarthlyBadge(label: _kindLabel, color: _kindColor),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    widget.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (_error != null)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: EarthlyColors.destructive.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  _error!,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: EarthlyColors.destructive,
                  ),
                ),
              )
            else if (uri == null)
              const SizedBox(
                height: 180,
                child: Center(child: CircularProgressIndicator()),
              )
            else ...[
              Center(
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.14),
                        blurRadius: 18,
                        offset: const Offset(0, 6),
                      ),
                    ],
                  ),
                  child: EarthlyQrCode(data: uri, size: 204),
                ),
              ),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: theme.dividerColor),
                ),
                child: Text(
                  uri,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    height: 1.4,
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: uri));
                        Navigator.of(context).pop();
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Copied nostr:naddr1… link'),
                          ),
                        );
                      },
                      icon: const Icon(Icons.copy, size: 16),
                      label: const Text('Copy nostr:naddr'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: () {
                      final bare = uri.replaceFirst('nostr:', '');
                      Clipboard.setData(
                        ClipboardData(text: 'https://earthly.city/$bare'),
                      );
                      Navigator.of(context).pop();
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Copied Earthly web link'),
                        ),
                      );
                    },
                    icon: const Icon(Icons.link, size: 16),
                    label: const Text('Web Link'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
