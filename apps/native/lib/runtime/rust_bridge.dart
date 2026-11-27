import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_rust_bridge/flutter_rust_bridge_for_generated.dart';

import '../src/rust/frb_generated.dart';

/// Singleton guard ensuring `EarthlyRustLib.init()` runs at most once per isolate
/// and locates `earthly_ffi` cleanly across macOS, Linux, Windows, and Android.
abstract final class RustBridge {
  static bool _initialized = false;
  static Future<void>? _pending;

  static bool _isRunningInWidgetTest() {
    try {
      return WidgetsBinding.instance.runtimeType
          .toString()
          .contains('TestWidgetsFlutterBinding');
    } catch (_) {
      return false;
    }
  }

  static ExternalLibrary? _resolveExternalLibrary() {
    final envOverride = Platform.environment['EARTHLY_FFI_DYLIB']?.trim();
    if (envOverride != null &&
        envOverride.isNotEmpty &&
        File(envOverride).existsSync()) {
      return ExternalLibrary.open(envOverride);
    }

    final exeDir = File(Platform.resolvedExecutable).parent.path;
    final candidates = <String>[];
    if (Platform.isMacOS) {
      candidates.addAll([
        '$exeDir/../Frameworks/libearthly_ffi.dylib',
        'libearthly_ffi.dylib',
        '${Directory.current.path}/macos/Frameworks/libearthly_ffi.dylib',
        '${Directory.current.path}/target/release/libearthly_ffi.dylib',
        '${Directory.current.path}/../../target/release/libearthly_ffi.dylib',
      ]);
    } else if (Platform.isLinux) {
      candidates.addAll([
        '$exeDir/lib/libearthly_ffi.so',
        'libearthly_ffi.so',
        '${Directory.current.path}/linux/lib/libearthly_ffi.so',
        '${Directory.current.path}/target/release/libearthly_ffi.so',
        '${Directory.current.path}/../../target/release/libearthly_ffi.so',
      ]);
    } else if (Platform.isWindows) {
      candidates.addAll([
        '$exeDir\\earthly_ffi.dll',
        'earthly_ffi.dll',
        '${Directory.current.path}\\windows\\lib\\earthly_ffi.dll',
        '${Directory.current.path}\\target\\release\\earthly_ffi.dll',
        '${Directory.current.path}\\..\\..\\target\\release\\earthly_ffi.dll',
      ]);
    } else {
      return null;
    }

    for (final path in candidates) {
      if (File(path).existsSync()) {
        return ExternalLibrary.open(path);
      }
    }
    return null;
  }

  static Future<void> ensureInitialized() async {
    if (_isRunningInWidgetTest()) {
      throw StateError('RustBridge disabled inside TestWidgetsFlutterBinding');
    }
    if (_initialized || EarthlyRustLib.instance.initialized) {
      _initialized = true;
      return;
    }
    final lib = _resolveExternalLibrary();
    await (_pending ??= EarthlyRustLib.init(externalLibrary: lib).then((_) {
      _initialized = true;
    }).whenComplete(() {
      _pending = null;
    }));
  }
}
