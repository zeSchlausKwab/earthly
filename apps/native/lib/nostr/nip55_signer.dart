import 'dart:io';

import 'package:flutter/services.dart';

class Nip55Account {
  const Nip55Account({
    required this.pubkey,
    this.signerPackage,
  });

  final String pubkey;
  final String? signerPackage;

  String get shortLabel =>
      pubkey.length > 16 ? '${pubkey.substring(0, 10)}…${pubkey.substring(pubkey.length - 6)}' : pubkey;
}

class Nip55SignResult {
  const Nip55SignResult({
    this.signedEventJson,
    this.signature,
  });

  final String? signedEventJson;
  final String? signature;
}

/// Native Android NIP-55 signer bridge (Amber and compatible Nostr signers).
abstract final class Nip55Signer {
  static const MethodChannel _channel = MethodChannel('city.earthly/nip55');

  static bool get isSupportedPlatform => Platform.isAndroid;

  static Future<bool> isSignerInstalled() async {
    if (!isSupportedPlatform) return false;
    try {
      final installed = await _channel.invokeMethod<bool>('isSignerInstalled');
      return installed ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<Nip55Account> getPublicKey() async {
    final raw = await _channel.invokeMapMethod<String, dynamic>('getPublicKey');
    final pubkey = raw?['pubkey'] as String?;
    if (pubkey == null || pubkey.isEmpty) {
      throw StateError('NIP-55 signer returned an empty public key');
    }
    return Nip55Account(
      pubkey: pubkey,
      signerPackage: raw?['package'] as String?,
    );
  }

  static Future<Nip55SignResult> signEvent({
    required String eventJson,
    String? currentUser,
    String? signerPackage,
  }) async {
    final raw = await _channel.invokeMapMethod<String, dynamic>(
      'signEvent',
      <String, dynamic>{
        'eventJson': eventJson,
        'currentUser': ?currentUser,
        'package': ?signerPackage,
      },
    );
    return Nip55SignResult(
      signedEventJson: raw?['event'] as String?,
      signature: raw?['signature'] as String?,
    );
  }
}
