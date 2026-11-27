import 'package:earthly_native/runtime/device_bridge.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('city.earthly/device');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  group('DeviceBridge.pickAnyFile', () {
    test('returns PickedBinaryFile with bytes, mimeType, and name', () async {
      final calls = <MethodCall>[];
      final payload = Uint8List.fromList([0x25, 0x50, 0x44, 0x46]); // %PDF

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        if (call.method == 'pickAnyFile') {
          return <String, Object>{
            'bytes': payload,
            'mimeType': 'application/pdf',
            'name': 'field-report.pdf',
          };
        }
        return null;
      });

      final picked = await DeviceBridge.pickAnyFile();
      expect(calls.map((c) => c.method).toList(), ['pickAnyFile']);
      expect(picked.bytes, payload);
      expect(picked.mimeType, 'application/pdf');
      expect(picked.name, 'field-report.pdf');
    });

    test('applies default mimeType and name when omitted by platform', () async {
      final payload = Uint8List.fromList([1, 2, 3]);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'pickAnyFile') {
          return <String, Object>{'bytes': payload};
        }
        return null;
      });

      final picked = await DeviceBridge.pickAnyFile();
      expect(picked.bytes, payload);
      expect(picked.mimeType, 'application/octet-stream');
      expect(picked.name, 'file');
    });

    test('throws StateError when selected file is empty or null', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);
      await expectLater(DeviceBridge.pickAnyFile(), throwsStateError);

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
        channel,
        (call) async => <String, Object>{'bytes': Uint8List(0)},
      );
      await expectLater(DeviceBridge.pickAnyFile(), throwsStateError);
    });

    test('rejects files larger than the 25 MiB attachment cap', () async {
      final oversized = Uint8List(DeviceBridge.maxPickedFileBytes + 1);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'pickAnyFile') {
          return <String, Object>{
            'bytes': oversized,
            'mimeType': 'video/mp4',
            'name': 'huge.mp4',
          };
        }
        return null;
      });

      await expectLater(
        DeviceBridge.pickAnyFile(),
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            contains('25 MB'),
          ),
        ),
      );
    });

    test('propagates PlatformException such as cancelled or file_too_large',
        () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        throw PlatformException(
          code: 'file_too_large',
          message: 'Selected file exceeds the 25 MB limit',
        );
      });

      await expectLater(
        DeviceBridge.pickAnyFile(),
        throwsA(
          isA<PlatformException>().having(
            (e) => e.code,
            'code',
            'file_too_large',
          ),
        ),
      );
    });
  });

  group('DeviceBridge.pickImage', () {
    test('returns picked image bytes and preserves image MIME type', () async {
      final pngBytes = Uint8List.fromList([0x89, 0x50, 0x4E, 0x47]);
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        if (call.method == 'pickImage') {
          return <String, Object>{
            'bytes': pngBytes,
            'mimeType': 'image/png',
            'name': 'trail-marker.png',
          };
        }
        return null;
      });

      final picked = await DeviceBridge.pickImage();
      expect(calls.map((c) => c.method).toList(), ['pickImage']);
      expect(picked.bytes, pngBytes);
      expect(picked.mimeType, 'image/png');
      expect(picked.name, 'trail-marker.png');
    });
  });

  group('DeviceBridge.showLocalNotification', () {
    test('invokes showLocalNotification with title, body, channelId, payload',
        () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        if (call.method == 'showLocalNotification') {
          return true;
        }
        return null;
      });

      final shown = await DeviceBridge.showLocalNotification(
        title: 'Alpine Survey',
        body: 'Alice shared trail-photo.jpg',
        channelId: 'earthly_circles',
        payload: 'earthly://circle/group-42',
      );

      expect(shown, isTrue);
      expect(calls, hasLength(1));
      expect(calls.single.method, 'showLocalNotification');
      expect(calls.single.arguments, <String, Object>{
        'title': 'Alpine Survey',
        'body': 'Alice shared trail-photo.jpg',
        'channelId': 'earthly_circles',
        'payload': 'earthly://circle/group-42',
      });
    });

    test('omits empty or null optional arguments', () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return true;
      });

      final shown = await DeviceBridge.showLocalNotification(
        title: '  MLS Circle  ',
        body: '  New message  ',
        channelId: '   ',
        payload: null,
      );

      expect(shown, isTrue);
      expect(calls.single.arguments, <String, Object>{
        'title': 'MLS Circle',
        'body': 'New message',
      });
    });

    test('no-ops without invoking channel when both title and body are blank',
        () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return true;
      });

      final shown = await DeviceBridge.showLocalNotification(
        title: '   ',
        body: '',
      );

      expect(shown, isFalse);
      expect(calls, isEmpty);
    });

    test('returns false cleanly when platform declines notification permission',
        () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => false);

      final shown = await DeviceBridge.showLocalNotification(
        title: 'MLS Group',
        body: 'New update',
      );
      expect(shown, isFalse);
    });

    test('degrades gracefully on MissingPluginException and PlatformException',
        () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
        channel,
        (call) async => throw MissingPluginException(),
      );
      expect(
        await DeviceBridge.showLocalNotification(
          title: 'MLS Group',
          body: 'Update',
        ),
        isFalse,
      );

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
        channel,
        (call) async => throw PlatformException(code: 'unavailable'),
      );
      expect(
        await DeviceBridge.showLocalNotification(
          title: 'MLS Group',
          body: 'Update',
        ),
        isFalse,
      );
    });
  });

  group('DeviceBridge deep-link callback', () {
    test('routes notification tap onDeepLink to registered handler', () async {
      final received = <String>[];
      DeviceBridge.setDeepLinkHandler(received.add);

      final encoded = const StandardMethodCodec().encodeMethodCall(
        const MethodCall('onDeepLink', 'earthly://circle/group-42'),
      );
      await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .handlePlatformMessage(
        channel.name,
        encoded,
        (_) {},
      );

      expect(received, ['earthly://circle/group-42']);
    });
  });
}
