import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

/// Opens a monospace Nostr Event & Payload Inspector dialog displaying event
/// identifiers, coordinate `address`, `dTag`, extra metadata, and pretty JSON.
Future<void> showRawEventInspectorDialog(
  BuildContext context, {
  required int kind,
  required String title,
  required String eventId,
  required String pubkey,
  required String address,
  required String dTag,
  required String payloadLabel,
  required String payloadContent,
  Map<String, String> extraFields = const <String, String>{},
}) {
  String formattedPayload = payloadContent;
  try {
    final decoded = jsonDecode(payloadContent);
    formattedPayload = const JsonEncoder.withIndent('  ').convert(decoded);
  } catch (_) {}

  final summaryJson = const JsonEncoder.withIndent('  ').convert(<String, dynamic>{
    'kind': kind,
    'id': eventId,
    'pubkey': pubkey,
    'address': address,
    'd': dTag,
    ...extraFields,
    payloadLabel: payloadContent,
  });

  return showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      title: Text(
        'RAW EVENT INSPECTOR (KIND $kind)',
        style: const TextStyle(
          fontFamily: 'monospace',
          fontSize: 13,
          fontWeight: FontWeight.w800,
        ),
      ),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SelectableText(
                'Title: $title\n'
                'Address: $address\n'
                'Event ID: $eventId\n'
                'Pubkey: $pubkey\n'
                'd-tag: $dTag'
                '${extraFields.entries.map((e) => '\n${e.key}: ${e.value}').join()}',
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
              const SizedBox(height: 10),
              Text(
                payloadLabel.toUpperCase(),
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              Container(
                constraints: const BoxConstraints(maxHeight: 260),
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(ctx).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Theme.of(ctx).dividerColor),
                ),
                child: SingleChildScrollView(
                  child: SelectableText(
                    formattedPayload,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        OutlinedButton.icon(
          key: const Key('raw-inspector-copy-btn'),
          onPressed: () {
            Clipboard.setData(ClipboardData(text: summaryJson));
            ScaffoldMessenger.of(ctx).showSnackBar(
              const SnackBar(content: Text('Copied raw event JSON to clipboard')),
            );
          },
          icon: const Icon(Icons.copy, size: 15),
          label: const Text('Copy JSON'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(ctx).pop(),
          child: const Text('Close'),
        ),
      ],
    ),
  );
}
