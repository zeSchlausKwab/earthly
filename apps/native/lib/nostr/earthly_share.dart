import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../shell/earthly_toast.dart';
import '../src/rust/api/nostr_client.dart';

/// Builds a canonical public https://earthly.city web URL matching Web's
/// `/map/<naddr>`, `/story/<naddr>`, and `/context/<naddr>` routes.
String buildEarthlyWebShareUrl({
  required int kind,
  required String naddrUri,
}) {
  final bare = naddrUri.trim().replaceFirst(RegExp(r'^nostr:'), '');
  final route = switch (kind) {
    37520 => 'story',
    37518 => 'context',
    _ => 'map',
  };
  return 'https://earthly.city/$route/$bare';
}

/// Encodes a Nostr addressable coordinate as both `https://earthly.city/...`
/// and `nostr:naddr1...`, then invokes the native OS Share Sheet (falling back
/// cleanly to clipboard copy on unsupported environments).
Future<void> shareEarthlyEntity({
  required BuildContext context,
  required int kind,
  required String pubkeyHex,
  required String dTag,
  required List<String> relayUrls,
  required String title,
}) async {
  try {
    await RustBridge.ensureInitialized();
    final naddrUri = await encodeNaddrCoordinate(
      kind: kind,
      pubkeyHex: pubkeyHex,
      dTag: dTag,
      relays: relayUrls,
    );
    final webUrl = buildEarthlyWebShareUrl(kind: kind, naddrUri: naddrUri);
    final shared = await DeviceBridge.shareText(
      text: '$title\n$webUrl\n$naddrUri',
      subject: title,
    );
    if (!shared) {
      await Clipboard.setData(ClipboardData(text: webUrl));
      if (context.mounted) {
        EarthlyToast.success(context, 'Copied share link $webUrl');
      }
    }
  } catch (err) {
    if (context.mounted) {
      EarthlyToast.error(context, 'Could not share link: $err');
    }
  }
}
