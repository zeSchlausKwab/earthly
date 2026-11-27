import 'dart:convert';
import 'dart:io';

import 'package:earthly_native/src/rust/api/geo.dart';
import 'package:earthly_native/src/rust/api/mcp_bridge.dart';
import 'package:earthly_native/src/rust/api/private_groups.dart';
import 'package:earthly_native/src/rust/api/publish.dart';
import 'package:earthly_native/src/rust/api/settings.dart';
import 'package:earthly_native/src/rust/api/wallet.dart';
import 'package:earthly_native/src/rust/frb_generated.dart';
import 'package:flutter_rust_bridge/flutter_rust_bridge_for_generated.dart';
import 'package:flutter_test/flutter_test.dart';

String? _probeEarthlyFfiDylib() {
  final envOverride = Platform.environment['EARTHLY_FFI_DYLIB']?.trim();
  if (envOverride != null &&
      envOverride.isNotEmpty &&
      File(envOverride).existsSync()) {
    return envOverride;
  }

  final candidates = <String>[];
  if (Platform.isMacOS) {
    candidates.addAll([
      'macos/Frameworks/libearthly_ffi.dylib',
      'apps/native/macos/Frameworks/libearthly_ffi.dylib',
      'build/macos/Build/Products/Release/Earthly.app/Contents/Frameworks/libearthly_ffi.dylib',
      'build/macos/Build/Products/Debug/Earthly.app/Contents/Frameworks/libearthly_ffi.dylib',
      'build/macos/Build/Products/Release/earthly_native.app/Contents/Frameworks/libearthly_ffi.dylib',
      '../../target/aarch64-apple-darwin/release/libearthly_ffi.dylib',
      '../../target/x86_64-apple-darwin/release/libearthly_ffi.dylib',
      '../../target/release/libearthly_ffi.dylib',
      '../../target/debug/libearthly_ffi.dylib',
      '../../crates/earthly-ffi/target/release/libearthly_ffi.dylib',
    ]);
  } else if (Platform.isLinux) {
    candidates.addAll([
      'build/linux/x64/release/bundle/lib/libearthly_ffi.so',
      'build/linux/arm64/release/bundle/lib/libearthly_ffi.so',
      '../../target/release/libearthly_ffi.so',
      '../../target/debug/libearthly_ffi.so',
      '../../crates/earthly-ffi/target/release/libearthly_ffi.so',
    ]);
  } else if (Platform.isWindows) {
    candidates.addAll([
      'build/windows/x64/runner/Release/earthly_ffi.dll',
      '../../target/release/earthly_ffi.dll',
      '../../crates/earthly-ffi/target/release/earthly_ffi.dll',
    ]);
  }

  for (final path in candidates) {
    if (File(path).existsSync()) {
      return path;
    }
  }
  return null;
}

void main() {
  final dylibPath = _probeEarthlyFfiDylib();
  final skipReason = dylibPath == null
      ? 'Compiled earthly_ffi native library not present (probed macos/Frameworks/ and build/ target paths)'
      : null;

  group('Live Rust FFI bridge round-trips', skip: skipReason, () {
    Directory? tempDir;
    late String masterKeyB64;

    setUpAll(() async {
      if (!EarthlyRustLib.instance.initialized) {
        await EarthlyRustLib.init(
          externalLibrary: ExternalLibrary.open(dylibPath!),
        );
      }
      tempDir = await Directory.systemTemp.createTemp('earthly_live_ffi_test_');
      masterKeyB64 = base64Encode(List<int>.generate(32, (i) => (i * 7 + 3) & 0xff));
      await setSettingsMasterKey(masterKeyBase64: masterKeyB64);
    });

    tearDownAll(() async {
      if (EarthlyRustLib.instance.initialized) {
        try {
          await stopMcpBridge();
        } catch (_) {}
      }
      if (tempDir != null && await tempDir!.exists()) {
        await tempDir!.delete(recursive: true);
      }
    });

    test('encrypted settings persist with ChaCha20-Poly1305 and decrypt cleanly',
        () async {
      final dbPath = '${tempDir!.path}/settings.sqlite3';
      const secretNsec =
          'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqwxyz';
      const secretNwc =
          'nostr+walletconnect://svc?relay=wss://relay.earthly.city&secret=supersecret';
      const secretApiKey = 'sk-or-v1-live-ffi-secret-key';

      final input = AppSettingsDto(
        relayUrls: const ['wss://relay.earthly.city'],
        localPubkeyHex: 'a' * 64,
        localNsec: secretNsec,
        agentPreset: 'openrouter',
        agentBaseUrl: 'https://openrouter.ai/api/v1',
        agentModel: 'anthropic/claude-sonnet-4',
        agentApiKey: secretApiKey,
        offlinePacks: const [],
        pinnedEntityIds: const ['map:37515:aaa:danube'],
        recentEntityIds: const [],
        cordnServerPubkey: 'b' * 64,
        bunkerUri: null,
        bunkerClientNsec: 'nsec1clientbunkertest',
        mountedAtlasWorkspaces: const [],
        blossomServerUrl: 'https://blossom.earthly.city',
        inboxReadAllBefore: BigInt.zero,
        inboxReadIds: const [],
        savedAccounts: [
          SavedAccountSessionDto(
            id: 'local:${'a' * 64}',
            kind: 'local',
            pubkeyHex: 'a' * 64,
            localNsec: secretNsec,
            label: 'Live FFI Test',
          ),
        ],
        activeAccountId: 'local:${'a' * 64}',
        mutedPubkeys: const [],
        themeMode: 'system',
        basemapStyle: 'auto',
        satelliteMode: 'osm',
        satelliteOpacity: 0.75,
        storyDraftJson: null,
        agentMessagesJson: null,
        nwcUri: secretNwc,
        nip60WalletEnabled: false,
        pointClusteringEnabled: true,
        pointClusterRadius: 64,
        pointClusterMaxZoom: 15,
        agentProviderType: 'routstr',
        agentAutoPayCashu: true,
        agentCashuMaxSats: 42,
      );

      final saved = await saveAppSettings(databasePath: dbPath, settings: input);
      expect(saved.localNsec, secretNsec);
      expect(saved.nwcUri, secretNwc);
      expect(saved.agentApiKey, secretApiKey);
      expect(saved.nip60WalletEnabled, isFalse);
      expect(saved.pointClusteringEnabled, isTrue);
      expect(saved.pointClusterRadius, 64);
      expect(saved.pointClusterMaxZoom, 15);
      expect(saved.agentProviderType, 'routstr');
      expect(saved.agentAutoPayCashu, isTrue);
      expect(saved.agentCashuMaxSats, 42);

      final loaded = await loadAppSettings(databasePath: dbPath);
      expect(loaded.localNsec, secretNsec);
      expect(loaded.nwcUri, secretNwc);
      expect(loaded.agentApiKey, secretApiKey);
      expect(loaded.bunkerClientNsec, 'nsec1clientbunkertest');
      expect(loaded.savedAccounts.single.localNsec, secretNsec);
      expect(loaded.nip60WalletEnabled, isFalse);
      expect(loaded.pointClusteringEnabled, isTrue);
      expect(loaded.pointClusterRadius, 64);
      expect(loaded.pointClusterMaxZoom, 15);
      expect(loaded.agentProviderType, 'routstr');
      expect(loaded.agentAutoPayCashu, isTrue);
      expect(loaded.agentCashuMaxSats, 42);

      // Raw SQLite bytes must never leak plaintext sensitive credentials.
      final rawText = latin1.decode(await File(dbPath).readAsBytes());
      expect(rawText, contains('enc:v1:'));
      expect(rawText, isNot(contains(secretNsec)));
      expect(rawText, isNot(contains(secretNwc)));
      expect(rawText, isNot(contains(secretApiKey)));
    });

    test('local drafts save, load, list, and delete in SQLite', () async {
      final dbPath = '${tempDir!.path}/drafts.sqlite3';
      const geojson =
          '{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.3738,48.2082]},"properties":{"name":"Stephansplatz"}}]}';

      final saved = await saveLocalDraft(
        databasePath: dbPath,
        draftId: 'draft-live-1',
        dTag: 'vienna-live',
        title: 'Vienna Live Draft',
        description: 'FFI round-trip test',
        audienceChannel: 'public',
        audienceId: null,
        geojson: geojson,
      );
      expect(saved.draftId, 'draft-live-1');
      expect(saved.title, 'Vienna Live Draft');

      final loaded = await loadLocalDraft(
        databasePath: dbPath,
        draftId: 'draft-live-1',
      );
      expect(loaded, isNotNull);
      expect(loaded!.dTag, 'vienna-live');
      expect(loaded.geojson, contains('Stephansplatz'));

      final all = await listLocalDrafts(databasePath: dbPath);
      expect(all.map((d) => d.draftId), contains('draft-live-1'));

      final deleted = await deleteLocalDraft(
        databasePath: dbPath,
        draftId: 'draft-live-1',
      );
      expect(deleted, isTrue);
      expect(
        await loadLocalDraft(databasePath: dbPath, draftId: 'draft-live-1'),
        isNull,
      );
    });

    test('Cashu wallet initializes, manages mints, and persists encrypted state',
        () async {
      final dbPath = '${tempDir!.path}/cashu.sqlite3';
      final kp = await generateLocalNostrKeypair();
      expect(kp.pubkeyHex.length, 64);

      final initialized = await initCashuWallet(
        databasePath: dbPath,
        pubkeyHex: kp.pubkeyHex,
        mints: const ['https://mint.minibits.cash/Bitcoin'],
        relays: const ['wss://relay.earthly.city'],
        masterKeyB64: masterKeyB64,
      );
      expect(initialized.pubkeyHex, kp.pubkeyHex);
      expect(initialized.mints, ['https://mint.minibits.cash/Bitcoin']);
      expect(initialized.p2PkPubkeyHex.length, 66);
      expect(initialized.balanceSats, BigInt.zero);

      final withMint = await addCashuMint(
        databasePath: dbPath,
        pubkeyHex: kp.pubkeyHex,
        mintUrl: 'https://mint.coinos.io',
        masterKeyB64: masterKeyB64,
      );
      expect(withMint.mints.length, 2);

      final reloaded = await loadCashuWalletState(
        databasePath: dbPath,
        pubkeyHex: kp.pubkeyHex,
        masterKeyB64: masterKeyB64,
      );
      expect(reloaded.mints, contains('https://mint.coinos.io'));

      final afterRemove = await removeCashuMint(
        databasePath: dbPath,
        pubkeyHex: kp.pubkeyHex,
        mintUrl: 'https://mint.coinos.io',
        masterKeyB64: masterKeyB64,
      );
      expect(afterRemove.mints, ['https://mint.minibits.cash/Bitcoin']);
    });

    test('Geo bridge validates, measures, generates primitives, and round-trips GPX/Shapefile/Multipart',
        () async {
      const sampleGeojson =
          '{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.3738,48.2082]},"properties":{"name":"Vienna Center"}},{"type":"Feature","id":"l1","geometry":{"type":"LineString","coordinates":[[16.36,48.20],[16.38,48.22]]},"properties":{"name":"Danube Spur"}}]}';

      final validation = await geoValidateDraftGeojson(geojson: sampleGeojson);
      expect(validation.valid, isTrue);
      expect(validation.featureCount, 2);

      final meters = await geoMeasureLineMeters(
        points: const [
          LonLatPoint(lon: 16.36, lat: 48.20),
          LonLatPoint(lon: 16.38, lat: 48.22),
        ],
      );
      expect(meters, greaterThan(1000.0));

      final hexRing = await geoCreatePrimitiveShape(
        center: const LonLatPoint(lon: 16.3738, lat: 48.2082),
        shape: 'hexagon',
        radiusMeters: 200.0,
      );
      expect(hexRing.length, greaterThanOrEqualTo(6));

      final gpx = await geoExportGpx(geojson: sampleGeojson, title: 'LiveGPX');
      expect(gpx, contains('<gpx'));
      final importedGpx = await geoImportSpatialFile(
        filename: 'live.gpx',
        content: gpx,
      );
      expect(importedGpx.featureCount, greaterThanOrEqualTo(1));

      final shpZip = await geoExportShapefileZip(
        geojson:
            '{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.3738,48.2082]},"properties":{"name":"Vienna"}}]}',
        title: 'LiveSHP',
      );
      expect(shpZip.length, greaterThan(32));
      expect(shpZip.sublist(0, 2), [0x50, 0x4B]); // ZIP magic PK
      final importedShp = await geoImportShapefileBytes(
        filename: 'LiveSHP.zip',
        bytes: shpZip,
      );
      expect(importedShp.featureCount, 1);

      final merged = await geoMergeToMultipart(
        geojsonGeometries: const [
          '{"type":"Point","coordinates":[16.37,48.20]}',
          '{"type":"Point","coordinates":[16.39,48.22]}',
        ],
      );
      expect(jsonDecode(merged)['type'], 'MultiPoint');
      final exploded = await geoExplodeMultipart(geojsonGeometry: merged);
      expect(exploded.length, 2);
    });

    test('MCP bridge starts on loopback, syncs workspace, drains mutations, and stops',
        () async {
      await stopMcpBridge();

      const workspace = McpWorkspaceDto(
        centerLon: 16.3738,
        centerLat: 48.2082,
        zoom: 13.5,
        draftTitle: 'Live FFI MCP Workspace',
        draftGeojson: '{"type":"FeatureCollection","features":[]}',
        shelfMapTitles: ['Danube Trails'],
        atlasWorkspaces: [],
        workingSetTitles: [],
        catalogItems: [],
      );

      final started = await startMcpBridge(port: 0, workspace: workspace);
      expect(started.running, isTrue);
      expect(started.port, greaterThan(0));
      expect(started.endpointUrl, startsWith('http://127.0.0.1:'));
      expect(started.authToken, isNotEmpty);
      expect(started.toolCount, greaterThan(0));

      await syncMcpWorkspace(
        workspace: const McpWorkspaceDto(
          centerLon: 16.38,
          centerLat: 48.21,
          zoom: 14.0,
          draftTitle: 'Updated Workspace',
          draftGeojson: '{"type":"FeatureCollection","features":[]}',
          shelfMapTitles: ['Danube Trails'],
          atlasWorkspaces: [],
          workingSetTitles: ['Danube Trails'],
          catalogItems: [],
        ),
      );
      final mutations = await drainMcpMutations();
      expect(mutations, isEmpty);

      final status = await getMcpBridgeStatus();
      expect(status.running, isTrue);
      expect(status.port, started.port);

      final stopped = await stopMcpBridge();
      expect(stopped.running, isFalse);
    });

    test('External Dart Circle signer creates workspace and signs MLS invite across FRB DartFnFuture',
        () async {
      final dbPath = '${tempDir!.path}/mls_external.sqlite3';
      final kp = await generateLocalNostrKeypair();
      var callbackCount = 0;

      final normalized = await registerExternalCircleSigner(
        pubkeyOrNpub: kp.npub,
        signEvent: (unsignedEventJson) async {
          callbackCount += 1;
          final signed = await signEventWithNsec(
            nsecOrHex: kp.nsec,
            unsignedEventJson: unsignedEventJson,
          );
          return jsonEncode(<String, Object?>{
            'ok': <String, Object?>{'event': signed},
          });
        },
      );
      expect(normalized, kp.pubkeyHex);

      try {
        final ws = await createCircleWorkspace(
          databasePath: dbPath,
          coordinatorPubkey: await defaultCordnCoordinatorPubkey(),
          relays: const ['wss://relay.earthly.city'],
          name: 'Amber Live Group',
        );
        expect(ws.name, 'Amber Live Group');

        final inviteUrl = await createCircleInviteUrl(
          databasePath: dbPath,
          workspaceId: ws.workspaceId,
        );
        expect(callbackCount, greaterThanOrEqualTo(1));
        expect(inviteUrl, contains('private-invite='));

        final decoded = await decodeCircleInviteLink(rawLink: inviteUrl);
        expect(decoded.workspaceId, ws.workspaceId);
        expect(decoded.adminPubkey, kp.pubkeyHex);

        final snap = await loadCirclesSnapshot(
          databasePath: dbPath,
          ownerPubkeyHex: kp.npub,
        );
        expect(snap.workspaces.map((w) => w.workspaceId), contains(ws.workspaceId));
      } finally {
        await clearExternalCircleSigner();
      }
    });

    test(
        'Wave 2A/2B Circle FFI: encrypted media (cordn-em-v1 + earthly-pm-v1), cordn1 group-ref, auto-approve, and multi-device prepare',
        () async {
      final dbPath = '${tempDir!.path}/mls_wave2.sqlite3';
      final kp = await generateLocalNostrKeypair();
      final cordnPk = await defaultCordnCoordinatorPubkey();

      final ws = await createCircleWorkspace(
        databasePath: dbPath,
        signerNsec: kp.nsec,
        coordinatorPubkey: cordnPk,
        relays: const ['wss://relay.earthly.city'],
        name: 'Wave 2 Field Circle',
      );
      expect(ws.syncHealth, 'healthy');
      expect(ws.autoApproveJoins, isFalse);
      expect(ws.cordnGroupRef, startsWith('cordn1'));

      // 1. decodeCordnGroupRefLink parses both bare cordn1... and URL fragment.
      final decodedRef = await decodeCordnGroupRefLink(
        rawLink: 'https://earthly.city/circle#${ws.cordnGroupRef}',
      );
      expect(decodedRef.gid, ws.groupId);
      expect(decodedRef.coordinatorPubkey, cordnPk);
      expect(decodedRef.relays, contains('wss://relay.earthly.city'));

      // 2. prepareCircleEncryptedMedia + buildCircleImetaTag (cordn-em-v1 + earthly-pm-v1).
      final sampleBytes = utf8.encode('secret field report bytes');
      final chatMedia = await prepareCircleEncryptedMedia(
        databasePath: dbPath,
        ownerPubkeyHex: kp.pubkeyHex,
        workspaceId: ws.workspaceId,
        bytes: sampleBytes,
        mimeType: 'text/plain',
        filename: 'report.txt',
        persistentForMap: false,
        stripMetadata: true,
      );
      expect(chatMedia.version, 'cordn-em-v1');
      expect(chatMedia.persistentKeyHex, isNull);
      expect(chatMedia.encryptedBytes, isNotEmpty);
      expect(chatMedia.plaintextSha256Hex.length, 64);
      expect(chatMedia.nonceHex.length, 24);

      final chatImeta = await buildCircleImetaTag(
        url: 'https://blossom.earthly.city/${chatMedia.encryptedSha256Hex}',
        mimeType: chatMedia.mimeType,
        filename: chatMedia.sanitizedFilename,
        sha256Hex: chatMedia.plaintextSha256Hex,
        nonceHex: chatMedia.nonceHex,
        version: chatMedia.version,
      );
      expect(chatImeta.first, 'imeta');
      expect(chatImeta, contains('v cordn-em-v1'));
      expect(chatImeta.any((e) => e.startsWith('k ')), isFalse);

      final mapMedia = await prepareCircleEncryptedMedia(
        databasePath: dbPath,
        ownerPubkeyHex: kp.pubkeyHex,
        workspaceId: ws.workspaceId,
        bytes: sampleBytes,
        mimeType: 'image/png',
        filename: 'trail.png',
        persistentForMap: true,
        stripMetadata: false,
      );
      expect(mapMedia.version, 'earthly-pm-v1');
      expect(mapMedia.persistentKeyHex, isNotNull);
      expect(mapMedia.persistentKeyHex!.length, 64);

      final mapImeta = await buildCircleImetaTag(
        url: 'https://blossom.earthly.city/${mapMedia.encryptedSha256Hex}',
        mimeType: mapMedia.mimeType,
        filename: mapMedia.sanitizedFilename,
        sha256Hex: mapMedia.plaintextSha256Hex,
        nonceHex: mapMedia.nonceHex,
        version: mapMedia.version,
        persistentKeyHex: mapMedia.persistentKeyHex,
      );
      expect(mapImeta, contains('v earthly-pm-v1'));
      expect(mapImeta, contains('k ${mapMedia.persistentKeyHex}'));

      // 3. setCircleAutoApprove toggles cleanly without a signer prompt.
      final autoOn = await setCircleAutoApprove(
        databasePath: dbPath,
        ownerPubkeyHex: kp.pubkeyHex,
        workspaceId: ws.workspaceId,
        enabled: true,
      );
      expect(autoOn.autoApproveJoins, isTrue);

      final autoOff = await setCircleAutoApprove(
        databasePath: dbPath,
        ownerPubkeyHex: kp.pubkeyHex,
        workspaceId: ws.workspaceId,
        enabled: false,
      );
      expect(autoOff.autoApproveJoins, isFalse);

      // 4. prepareMultiDevicePublish seals group + meta blobs and tip payload.
      final preparedMd = await prepareMultiDevicePublish(
        databasePath: dbPath,
        ownerPubkeyHex: kp.pubkeyHex,
        blossomServerUrl: 'https://blossom.earthly.city',
      );
      expect(preparedMd.dekHex.length, 64);
      expect(preparedMd.blossomServers, ['https://blossom.earthly.city']);
      expect(preparedMd.blobs.any((b) => b.kind == 'group' && b.gid == ws.groupId), isTrue);
      expect(preparedMd.blobs.any((b) => b.kind == 'meta'), isTrue);
      expect(preparedMd.defaultTipPlaintextJson, contains(preparedMd.dekHex));

      final unsignedTip = await prepareUnsignedMultiDeviceTipEvent(
        ownerPubkeyHex: kp.pubkeyHex,
        encryptedTipContent: 'v2-ciphertext-placeholder',
      );
      final tipMap = jsonDecode(unsignedTip) as Map<String, dynamic>;
      expect(tipMap['kind'], 30078);
      expect(
        (tipMap['tags'] as List).any(
          (t) => t is List && t.length >= 2 && t[0] == 'd' && t[1] == 'cordn-md-tip-v1',
        ),
        isTrue,
      );
    });
  });
}
