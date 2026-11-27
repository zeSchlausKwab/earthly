import 'dart:async';
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
  static Future<void> _serialQueue = Future<void>.value();

  static Future<T> _enqueue<T>(Future<T> Function() action) {
    final completer = Completer<T>();
    _serialQueue = _serialQueue.catchError((_) {}).then((_) async {
      try {
        completer.complete(await action());
      } catch (err, st) {
        completer.completeError(err, st);
      }
    });
    return completer.future;
  }

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

  static Future<Nip55Account> getPublicKey() {
    return _enqueue(() async {
      final raw =
          await _channel.invokeMapMethod<String, dynamic>('getPublicKey');
      final pubkey = raw?['pubkey'] as String?;
      if (pubkey == null || pubkey.isEmpty) {
        throw StateError('NIP-55 signer returned an empty public key');
      }
      return Nip55Account(
        pubkey: pubkey,
        signerPackage: raw?['package'] as String?,
      );
    });
  }

  static Future<Nip55SignResult> signEvent({
    required String eventJson,
    String? currentUser,
    String? signerPackage,
  }) {
    return _enqueue(() async {
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
    });
  }

  static Future<String> nip44Decrypt({
    required String ciphertext,
    required String pubkey,
    String? currentUser,
    String? signerPackage,
  }) {
    return _enqueue(() async {
      final out = await _channel.invokeMethod<String>(
        'nip44Decrypt',
        <String, dynamic>{
          'ciphertext': ciphertext,
          'pubkey': pubkey,
          'currentUser': ?currentUser,
          'package': ?signerPackage,
        },
      );
      if (out == null || out.isEmpty) {
        throw StateError(
          'NIP-55 signer returned an empty NIP-44 decryption result',
        );
      }
      return out;
    });
  }

  static Future<String> nip44Encrypt({
    required String plaintext,
    required String pubkey,
    String? currentUser,
    String? signerPackage,
  }) {
    return _enqueue(() async {
      final out = await _channel.invokeMethod<String>(
        'nip44Encrypt',
        <String, dynamic>{
          'plaintext': plaintext,
          'pubkey': pubkey,
          'currentUser': ?currentUser,
          'package': ?signerPackage,
        },
      );
      if (out == null || out.isEmpty) {
        throw StateError(
          'NIP-55 signer returned an empty NIP-44 encryption result',
        );
      }
      return out;
    });
  }
}
