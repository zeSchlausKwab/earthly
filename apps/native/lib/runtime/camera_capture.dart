import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'device_bridge.dart';

enum _CameraFallbackAction {
  cancel,
  retry,
  openSettings,
  gallery,
}

/// Shared camera capture helper handling runtime Android `CAMERA` permission
/// denial (including permanent denial after app updates where `CAMERA` is
/// merged into the APK by `zxing-android-embedded`), Android App Settings
/// deep-link guidance, and graceful Gallery fallback.
abstract final class CameraCapture {
  static bool isCancellation(Object error) {
    if (error is PlatformException && error.code == 'cancelled') {
      return true;
    }
    return error.toString().toLowerCase().contains('cancel');
  }

  static bool isPermanentDenial(Object error) {
    if (error is PlatformException) {
      if (error.code == 'camera_permanently_denied') return true;
      final details = error.details;
      if (details is Map && details['permanentlyDenied'] == true) {
        return true;
      }
    }
    return false;
  }

  static bool isPermissionError(Object error) {
    if (isPermanentDenial(error)) return true;
    if (error is PlatformException) {
      final code = error.code.toLowerCase();
      if (code == 'camera_denied' ||
          code == 'permission_denied' ||
          code == 'camera_permission_denied') {
        return true;
      }
    }
    final msg = error.toString().toLowerCase();
    return msg.contains('camera') &&
        (msg.contains('permission') ||
            msg.contains('denied') ||
            msg.contains('securityexception'));
  }

  static bool isNoCameraError(Object error) {
    if (error is PlatformException && error.code == 'no_camera') {
      return true;
    }
    return error.toString().toLowerCase().contains('no camera');
  }

  /// Captures a photo via [DeviceBridge.capturePhoto].
  ///
  /// - Returns `null` silently if the user cancels.
  /// - When Android reports a camera permission error (including permanent
  ///   denial after an app upgrade), guides the user with an interactive dialog
  ///   to retry, open Android App Settings, or pick a photo from Gallery.
  /// - When no camera app is available, offers Gallery fallback.
  static Future<PickedBinaryFile?> capturePhoto(
    BuildContext context, {
    bool allowGalleryFallback = true,
    Future<PickedBinaryFile> Function()? captureOverride,
    Future<PickedBinaryFile> Function()? pickGalleryOverride,
    Future<bool> Function()? openSettingsOverride,
  }) async {
    final captureFn = captureOverride ?? DeviceBridge.capturePhoto;
    final pickGalleryFn = pickGalleryOverride ?? DeviceBridge.pickImage;
    final openSettingsFn = openSettingsOverride ?? DeviceBridge.openAppSettings;

    try {
      return await captureFn();
    } catch (err) {
      if (isCancellation(err)) return null;
      if (!context.mounted) rethrow;

      if (isPermissionError(err)) {
        final permanent = isPermanentDenial(err);
        final action = await _showPermissionDialog(
          context,
          permanentlyDenied: permanent,
          allowGalleryFallback: allowGalleryFallback,
        );
        if (action == null || action == _CameraFallbackAction.cancel) {
          return null;
        }
        if (action == _CameraFallbackAction.openSettings) {
          await openSettingsFn();
          return null;
        }
        if (action == _CameraFallbackAction.gallery) {
          try {
            return await pickGalleryFn();
          } catch (galleryErr) {
            if (isCancellation(galleryErr)) return null;
            rethrow;
          }
        }
        if (action == _CameraFallbackAction.retry) {
          try {
            return await captureFn();
          } catch (retryErr) {
            if (isCancellation(retryErr)) return null;
            if (context.mounted && isPermissionError(retryErr)) {
              final nextAction = await _showPermissionDialog(
                context,
                permanentlyDenied: true,
                allowGalleryFallback: allowGalleryFallback,
              );
              if (nextAction == _CameraFallbackAction.openSettings) {
                await openSettingsFn();
                return null;
              }
              if (nextAction == _CameraFallbackAction.gallery) {
                try {
                  return await pickGalleryFn();
                } catch (galleryErr) {
                  if (isCancellation(galleryErr)) return null;
                  rethrow;
                }
              }
              return null;
            }
            rethrow;
          }
        }
        return null;
      }

      if (isNoCameraError(err) && allowGalleryFallback) {
        final pickFromGallery = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            key: const Key('camera-unavailable-dialog'),
            title: const Text('Camera Unavailable'),
            content: const Text(
              'No camera app could be opened on this device. You can choose an existing photo from your gallery instead.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton.icon(
                key: const Key('camera-unavailable-gallery-btn'),
                onPressed: () => Navigator.of(ctx).pop(true),
                icon: const Icon(Icons.photo_library_outlined, size: 16),
                label: const Text('Choose from Gallery'),
              ),
            ],
          ),
        );
        if (pickFromGallery == true) {
          try {
            return await pickGalleryFn();
          } catch (galleryErr) {
            if (isCancellation(galleryErr)) return null;
            rethrow;
          }
        }
        return null;
      }

      rethrow;
    }
  }

  static Future<_CameraFallbackAction?> _showPermissionDialog(
    BuildContext context, {
    required bool permanentlyDenied,
    required bool allowGalleryFallback,
  }) {
    return showDialog<_CameraFallbackAction>(
      context: context,
      builder: (ctx) => AlertDialog(
        key: const Key('camera-permission-dialog'),
        title: const Text('Camera Permission Required'),
        content: Text(
          permanentlyDenied
              ? 'Android blocked camera access for Earthly (this can happen if Camera was previously denied or reset after an app update). Open App Settings to allow Camera, or choose a photo from your gallery.'
              : 'Earthly needs Camera permission to take a photo. Allow Camera when prompted, open App Settings, or choose an existing photo from your gallery.',
        ),
        actions: [
          TextButton(
            key: const Key('camera-permission-cancel-btn'),
            onPressed: () => Navigator.of(ctx).pop(_CameraFallbackAction.cancel),
            child: const Text('Cancel'),
          ),
          if (allowGalleryFallback)
            OutlinedButton.icon(
              key: const Key('camera-permission-gallery-btn'),
              onPressed: () =>
                  Navigator.of(ctx).pop(_CameraFallbackAction.gallery),
              icon: const Icon(Icons.photo_library_outlined, size: 16),
              label: const Text('Gallery'),
            ),
          if (!permanentlyDenied)
            OutlinedButton(
              key: const Key('camera-permission-settings-btn'),
              onPressed: () =>
                  Navigator.of(ctx).pop(_CameraFallbackAction.openSettings),
              child: const Text('App Settings'),
            ),
          FilledButton.icon(
            key: Key(
              permanentlyDenied
                  ? 'camera-permission-settings-btn'
                  : 'camera-permission-retry-btn',
            ),
            onPressed: () => Navigator.of(ctx).pop(
              permanentlyDenied
                  ? _CameraFallbackAction.openSettings
                  : _CameraFallbackAction.retry,
            ),
            icon: Icon(
              permanentlyDenied
                  ? Icons.settings_outlined
                  : Icons.photo_camera_outlined,
              size: 16,
            ),
            label: Text(permanentlyDenied ? 'Open App Settings' : 'Try Again'),
          ),
        ],
      ),
    );
  }
}
