import 'package:flutter/services.dart';

/// GPS fix returned by Android's native `LocationManager`.
class DeviceLocationFix {
  const DeviceLocationFix({
    required this.lat,
    required this.lon,
    required this.accuracyMeters,
  });

  final double lat;
  final double lon;
  final double accuracyMeters;
}

/// Binary file payload returned by Android's camera, gallery, or document picker.
class PickedBinaryFile {
  const PickedBinaryFile({
    required this.bytes,
    required this.mimeType,
    required this.name,
  });

  final Uint8List bytes;
  final String mimeType;
  final String name;
}

/// Native device capabilities channel (`city.earthly/device`) implemented in
/// Android `MainActivity.kt` with zero third-party Gradle plugin bloat.
class DeviceBridge {
  static const MethodChannel _channel = MethodChannel('city.earthly/device');

  static void Function(String uri)? _deepLinkHandler;
  static void Function(PickedBinaryFile file)? _droppedFileHandler;

  static void _ensureMethodCallHandler() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'onDeepLink' && call.arguments is String) {
        final raw = (call.arguments as String).trim();
        if (raw.isNotEmpty) _deepLinkHandler?.call(raw);
      } else if (call.method == 'onDroppedFile' && call.arguments is Map) {
        final map = Map<String, dynamic>.from(call.arguments as Map);
        final bytes = map['bytes'] as Uint8List?;
        if (bytes != null && bytes.isNotEmpty) {
          _droppedFileHandler?.call(
            PickedBinaryFile(
              bytes: bytes,
              mimeType:
                  (map['mimeType'] as String?) ?? 'application/octet-stream',
              name: (map['name'] as String?) ?? 'dropped-file',
            ),
          );
        }
      }
    });
  }

  static Future<String?> getInitialDeepLink() async {
    try {
      final raw = await _channel.invokeMethod<String>('getInitialDeepLink');
      return (raw != null && raw.trim().isNotEmpty) ? raw.trim() : null;
    } catch (_) {
      return null;
    }
  }

  static Future<PickedBinaryFile?> getInitialDroppedFile() async {
    try {
      final map = await _channel.invokeMapMethod<String, dynamic>(
        'getInitialDroppedFile',
      );
      if (map == null) return null;
      final bytes = map['bytes'] as Uint8List?;
      if (bytes == null || bytes.isEmpty) return null;
      return PickedBinaryFile(
        bytes: bytes,
        mimeType: (map['mimeType'] as String?) ?? 'application/octet-stream',
        name: (map['name'] as String?) ?? 'shared-file',
      );
    } catch (_) {
      return null;
    }
  }

  static void setDeepLinkHandler(void Function(String uri) onDeepLink) {
    _deepLinkHandler = onDeepLink;
    _ensureMethodCallHandler();
  }

  static void setDroppedFileHandler(
    void Function(PickedBinaryFile file) onDroppedFile,
  ) {
    _droppedFileHandler = onDroppedFile;
    _ensureMethodCallHandler();
  }

  static Future<DeviceLocationFix> getCurrentLocation() async {
    final map = await _channel.invokeMapMethod<String, dynamic>(
      'getCurrentLocation',
    );
    if (map == null) {
      throw StateError('No GPS location returned by device');
    }
    final lat = (map['lat'] as num?)?.toDouble();
    final lon = (map['lon'] as num?)?.toDouble();
    final accuracy = (map['accuracy'] as num?)?.toDouble() ?? 0.0;
    if (lat == null || lon == null) {
      throw StateError('Invalid GPS coordinates returned by device');
    }
    return DeviceLocationFix(lat: lat, lon: lon, accuracyMeters: accuracy);
  }

  static Future<PickedBinaryFile> capturePhoto() => _invokeFile('capturePhoto');

  static Future<PickedBinaryFile> pickImage() => _invokeFile('pickImage');

  static Future<PickedBinaryFile> pickPmtilesFile() =>
      _invokeFile('pickPmtilesFile');

  static Future<PickedBinaryFile> pickGeoJsonFile() =>
      _invokeFile('pickGeoJsonFile');

  static Future<String> saveGeoJsonFile({
    required String filename,
    required String content,
    String? mimeType,
  }) async {
    final savedName = await _channel.invokeMethod<String>(
      'saveGeoJsonFile',
      <String, Object>{
        'filename': filename,
        'content': content,
        'mimeType': ?mimeType,
      },
    );
    return savedName ?? filename;
  }

  static Future<String> scanQrCode() async {
    final raw = await _channel.invokeMethod<String>('scanQrCode');
    if (raw == null || raw.isEmpty) {
      throw StateError('No QR code scanned');
    }
    return raw;
  }

  static Future<PickedBinaryFile> _invokeFile(String method) async {
    final map = await _channel.invokeMapMethod<String, dynamic>(method);
    if (map == null) {
      throw StateError('No file returned');
    }
    final bytes = map['bytes'] as Uint8List?;
    if (bytes == null || bytes.isEmpty) {
      throw StateError('Selected file was empty');
    }
    return PickedBinaryFile(
      bytes: bytes,
      mimeType: (map['mimeType'] as String?) ?? 'application/octet-stream',
      name: (map['name'] as String?) ?? 'file',
    );
  }
}
