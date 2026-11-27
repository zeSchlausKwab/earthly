import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_rust_bridge/flutter_rust_bridge_for_generated.dart';

import '../src/rust/frb_generated.dart';

/// Singleton guard ensuring `EarthlyRustLib.init()` runs at most once per isolate
/// and locates `libearthly_ffi.dylib` cleanly on macOS Desktop as well as Android.
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
    if (!Platform.isMacOS) return null;
    final exeDir = File(Platform.resolvedExecutable).parent.path;
    final candidates = <String>[
      '$exeDir/../Frameworks/libearthly_ffi.dylib',
      'libearthly_ffi.dylib',
      '${Directory.current.path}/target/release/libearthly_ffi.dylib',
      '${Directory.current.path}/../../target/release/libearthly_ffi.dylib',
      '/Users/schlaus/workspace/earthly/target/release/libearthly_ffi.dylib',
    ];
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
