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
