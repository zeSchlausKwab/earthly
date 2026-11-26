import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:maplibre/maplibre.dart';

import '../drawing/drawing_model.dart';
import '../nostr/shelf_renderer.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../shell/agent_drawer.dart';
import '../shell/mcp_bridge_sheet.dart';
import '../src/rust/api/agent.dart';
import '../src/rust/api/geo.dart';
import '../src/rust/api/mcp_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/settings.dart';

/// Manages AI Copilot threads, SSE token streaming, safeEditing amber ghost
/// previews, Vision attachment detection, and the Desktop MCP Bridge.
///
/// High-frequency SSE token deltas notify [streamListenable] exclusively so
/// heavy map GeoJSON/layer trees and unrelated drawers do not rebuild during
/// streaming.
class AgentController extends ChangeNotifier {
  final ChangeNotifier streamListenable = ChangeNotifier();
  final ChangeNotifier ghostListenable = ChangeNotifier();
  final ChangeNotifier mcpListenable = ChangeNotifier();

  final List<CopilotThread> threads = <CopilotThread>[
    const CopilotThread(
      id: 'thread-1',
      title: 'Thread 1',
      updatedAtMs: 0,
    ),
  ];
  String activeThreadId = 'thread-1';

  CopilotProviderSettings settings = CopilotProviderSettings.offline;
  bool busy = false;
  bool safeEditing = true;
  PendingAiEdit? pendingAiEdit;
  List<ShelfShape> aiGhostShapes = const <ShelfShape>[];
  int aiGhostRevision = 0;

  String streamingText = '';
  String? activeToolStatus;
  List<AgentToolRecordDto> liveToolCalls = const <AgentToolRecordDto>[];

  final Set<String> workingSetAddresses = <String>{};
  AgentAttachment? pendingAttachment;
  StreamSubscription<AgentStreamEventDto>? _agentStreamSub;
  String visionSupport = 'no-vision';
  bool attachMapView = false;

  String? cashuWalletDbPath;
  String? cashuWalletPubkeyHex;
  String? cashuWalletMasterKeyB64;
  VoidCallback? onCashuWalletUpdated;

  McpBridgeStatusDto? mcpBridgeStatus;
  bool mcpBridgeBusy = false;
  Timer? _mcpPollTimer;

  void configureCashuWallet({
    String? databasePath,
    String? pubkeyHex,
    String? masterKeyB64,
    VoidCallback? onWalletUpdated,
  }) {
    cashuWalletDbPath = databasePath;
    cashuWalletPubkeyHex = pubkeyHex;
    cashuWalletMasterKeyB64 = masterKeyB64;
    onCashuWalletUpdated = onWalletUpdated;
  }

  CopilotThread get activeThread {
    if (threads.isEmpty) {
      final fallback = CopilotThread(
        id: 'thread-1',
        title: 'Thread 1',
        updatedAtMs: DateTime.now().millisecondsSinceEpoch,
      );
      threads.add(fallback);
      activeThreadId = fallback.id;
      return fallback;
    }
    final idx = threads.indexWhere((t) => t.id == activeThreadId);
    return idx >= 0 ? threads[idx] : threads.first;
  }

  List<CopilotMessage> get messages => activeThread.messages;

  void _updateActiveThread(
    CopilotThread Function(CopilotThread cur) updater,
  ) {
    final cur = activeThread;
    final idx = threads.indexWhere((t) => t.id == cur.id);
    if (idx >= 0) {
      threads[idx] = updater(cur);
    }
  }

  void restoreThreadsFromJson(String? rawJson) {
    if (rawJson == null || rawJson.trim().isEmpty) return;
    try {
      final restored = CopilotThread.decodePersistedJson(rawJson);
      if (restored.isNotEmpty) {
        threads
          ..clear()
          ..addAll(restored);
        activeThreadId = restored.first.id;
        notifyListeners();
      }
    } catch (_) {}
  }

  void applyRestoredSettings(CopilotProviderSettings restored) {
    settings = restored;
    notifyListeners();
  }

  String? encodePersistedThreadsJson() {
    if (threads.every((t) => t.messages.isEmpty)) return null;
    return jsonEncode({
      'threads': [
        for (final t in threads.take(12)) t.toJson(),
      ],
    });
  }

  void createNewThread({VoidCallback? onPersistSettings}) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final nextId = 'thread-$now';
    threads.insert(
      0,
      CopilotThread(
        id: nextId,
        title: 'Thread ${threads.length + 1}',
        updatedAtMs: now,
      ),
    );
    activeThreadId = nextId;
    notifyListeners();
    onPersistSettings?.call();
  }

  void selectThread(String id) {
    if (activeThreadId == id) return;
    activeThreadId = id;
    notifyListeners();
  }

  void deleteThread(String id, {VoidCallback? onPersistSettings}) {
    if (threads.length <= 1) return;
    threads.removeWhere((t) => t.id == id);
    if (activeThreadId == id && threads.isNotEmpty) {
      activeThreadId = threads.first.id;
    }
    notifyListeners();
    onPersistSettings?.call();
  }

  void clearActiveThread({VoidCallback? onPersistSettings}) {
    _updateActiveThread((t) => t.copyWith(messages: const []));
    notifyListeners();
    onPersistSettings?.call();
  }

  void toggleWorkingSet(String address) {
    if (!workingSetAddresses.remove(address)) {
      workingSetAddresses.add(address);
    }
    notifyListeners();
  }

  void clearPendingAttachment() {
    if (pendingAttachment == null) return;
    pendingAttachment = null;
    notifyListeners();
  }

  void setAttachMapView(bool value) {
    if (attachMapView == value) return;
    attachMapView = value;
    notifyListeners();
  }

  void setSafeEditing(bool value) {
    if (safeEditing == value) return;
    safeEditing = value;
    notifyListeners();
  }

  void updateSettings(
    CopilotProviderSettings next, {
    bool isHeadlessTest = false,
    VoidCallback? onPersistSettings,
  }) {
    settings = next;
    notifyListeners();
    onPersistSettings?.call();
    if (!isHeadlessTest) {
      unawaited(refreshVisionSupport(isHeadlessTest: isHeadlessTest));
    }
  }

  Future<void> refreshVisionSupport({bool isHeadlessTest = false}) async {
    if (isHeadlessTest) return;
    try {
      await RustBridge.ensureInitialized();
      final verdict = await detectAgentVisionSupport(
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey.isEmpty ? null : settings.apiKey,
      );
      var changed = visionSupport != verdict;
      visionSupport = verdict;
      if (verdict == 'no-vision' && attachMapView) {
        attachMapView = false;
        changed = true;
      }
      if (changed) notifyListeners();
    } catch (_) {}
  }

  Future<String?> pickAttachment({
    Future<PickedBinaryFile> Function()? pickFileOverride,
    Future<XlsxParseDto> Function(String filename, Uint8List bytes)?
        parseXlsxOverride,
    bool isHeadlessTest = false,
  }) async {
    try {
      final picked = pickFileOverride != null
          ? await pickFileOverride()
          : await DeviceBridge.pickGeoJsonFile();
      if (!isHeadlessTest && parseXlsxOverride == null) {
        await RustBridge.ensureInitialized();
      }
      final lowerName = picked.name.toLowerCase();
      final isXlsx = lowerName.endsWith('.xlsx');
      final isZipOrShp = !isXlsx &&
          (lowerName.endsWith('.zip') ||
              lowerName.endsWith('.shp') ||
              (picked.bytes.length >= 2 &&
                  picked.bytes[0] == 0x50 &&
                  picked.bytes[1] == 0x4B));
      final rawText = (isXlsx || isZipOrShp)
          ? ''
          : utf8.decode(picked.bytes, allowMalformed: true);
      var formatLabel = lowerName.contains('.')
          ? lowerName.split('.').last.toUpperCase()
          : 'FILE';
      var featureCount = 0;
      String? importedGeojson;
      var summary = '';
      try {
        if (isXlsx) {
          final parsed = parseXlsxOverride != null
              ? await parseXlsxOverride(picked.name, picked.bytes)
              : await geoParseXlsxBytes(
                  filename: picked.name,
                  bytes: picked.bytes,
                );
          formatLabel = 'XLSX';
          featureCount = parsed.featureCount;
          importedGeojson = parsed.geojson;
          final tablePreview = parsed.markdownTable.length > 2000
              ? '${parsed.markdownTable.substring(0, 2000)}…'
              : parsed.markdownTable;
          final geoNote = parsed.featureCount > 0
              ? 'Detected ${parsed.featureCount} GeoJSON point feature(s) across ${parsed.sheets.length} sheet(s).\n'
              : 'Parsed ${parsed.sheets.length} sheet(s) as table.\n';
          summary = '$geoNote$tablePreview';
        } else {
          final converted = isZipOrShp
              ? await geoImportShapefileBytes(
                  filename: picked.name,
                  bytes: picked.bytes,
                )
              : await geoImportSpatialFile(
                  filename: picked.name,
                  content: rawText,
                );
          formatLabel = converted.format.toUpperCase();
          featureCount = converted.featureCount;
          importedGeojson = converted.geojson;
          final preview = converted.geojson.length > 2400
              ? '${converted.geojson.substring(0, 2400)}…'
              : converted.geojson;
          summary =
              'Converted $formatLabel with $featureCount feature(s).\n$preview';
        }
      } catch (_) {
        final trimmed = rawText.trim();
        summary = trimmed.length > 2400
            ? '${trimmed.substring(0, 2400)}…'
            : trimmed;
      }
      pendingAttachment = AgentAttachment(
        fileName: picked.name,
        formatLabel: formatLabel,
        featureCount: featureCount,
        summaryText: summary,
        importedGeojson: importedGeojson,
      );
      notifyListeners();
      return null;
    } catch (err) {
      if (err.toString().contains('cancelled')) return null;
      return 'Attachment failed: $err';
    }
  }

  /// Applies a single SSE [AgentStreamEventDto] to the streaming state.
  ///
  /// High-frequency events (`status`, `delta`, `tool_started`, `tool_finished`)
  /// notify ONLY [streamListenable] so map layers and unrelated UI stay idle.
  void handleStreamEvent(
    AgentStreamEventDto ev, {
    Completer<AgentTurnResultDto>? completer,
  }) {
    switch (ev.eventType) {
      case 'status':
        activeToolStatus = ev.text;
        streamListenable.notifyListeners();
      case 'delta':
        final piece = ev.text ?? '';
        if (piece.isNotEmpty) {
          streamingText += piece;
          streamListenable.notifyListeners();
        }
      case 'tool_started':
        final stepLabel = ev.step != null ? 'Step ${ev.step} · ' : '';
        activeToolStatus = '${stepLabel}Running ${ev.toolName ?? 'tool'}…';
        streamListenable.notifyListeners();
      case 'tool_finished':
        if (ev.toolName != null && ev.toolSummary != null) {
          liveToolCalls = <AgentToolRecordDto>[
            ...liveToolCalls,
            AgentToolRecordDto(
              name: ev.toolName!,
              ok: ev.toolOk ?? true,
              summary: ev.toolSummary!,
            ),
          ];
          streamListenable.notifyListeners();
        }
      case 'completed':
        if (ev.result != null && completer != null && !completer.isCompleted) {
          completer.complete(ev.result!);
        }
      case 'error':
        if (completer != null && !completer.isCompleted) {
          completer.completeError(ev.text ?? 'Agent streaming error');
        }
    }
  }

  Future<void> sendPrompt(
    String prompt, {
    required Geographic center,
    required double zoom,
    required String draftTitle,
    required List<DrawnFeature> draftFeatures,
    required List<ShelfMapEntry> shelfMaps,
    required List<MountedAtlasWorkspaceDto> atlasWorkspaces,
    required EarthlyCatalogSnapshot? catalog,
    required Future<String?> Function() captureMapSnapshotBase64,
    required void Function(
      String proposedGeojson,
      int diffAdded,
      int diffModified,
      int diffRemoved,
      String summary,
    ) onProposedGeojson,
    required void Function(double lon, double lat, double zoom) onCameraAction,
    VoidCallback? onPersistSettings,
    String? cashuWalletDbPathOverride,
    String? cashuWalletPubkeyHexOverride,
    String? cashuWalletMasterKeyB64Override,
    String? cashuTokenOverride,
  }) async {
    final attachment = pendingAttachment;
    final visiblePrompt =
        attachment == null ? prompt : '📎 ${attachment.fileName}\n$prompt';
    final effectivePrompt = attachment == null
        ? prompt
        : '[Attached File: ${attachment.fileName} (${attachment.formatLabel})]\n'
            '${attachment.summaryText}\n\nUser request: $prompt';

    final now = DateTime.now().millisecondsSinceEpoch;
    _updateActiveThread((t) {
      final nextTitle = t.messages.isEmpty
          ? (prompt.length > 26 ? '${prompt.substring(0, 26)}…' : prompt)
          : t.title;
      return t.copyWith(
        title: nextTitle,
        updatedAtMs: now,
        messages: [
          ...t.messages,
          CopilotMessage(role: 'user', content: visiblePrompt),
        ],
      );
    });
    pendingAttachment = null;
    busy = true;
    streamingText = '';
    activeToolStatus = 'Starting agent…';
    liveToolCalls = const <AgentToolRecordDto>[];
    notifyListeners();
    streamListenable.notifyListeners();

    try {
      await RustBridge.ensureInitialized();
      await _agentStreamSub?.cancel();
      final draftGeojson = draftFeaturesToGeoJson(
        title: draftTitle,
        features: draftFeatures,
      );
      final history = messages
          .take(messages.length - 1)
          .map((m) => AgentMessageDto(role: m.role, content: m.content))
          .toList(growable: false);
      final workingSetTitles = shelfMaps
          .where((e) => workingSetAddresses.contains(e.summary.address))
          .map((e) => '${e.summary.title} (${e.summary.address})')
          .toList(growable: false);
      final catalogItems = <String>[
        if (catalog != null) ...[
          for (final m in catalog.maps.take(20))
            '[Map] ${m.title} | ${m.address}${m.hashtags.isNotEmpty ? ' | #${m.hashtags.join(" #")}' : ''} | ${m.featureCount} features',
          for (final s in catalog.stories.take(10))
            '[Story] ${s.title} | ${s.address}',
          for (final a in catalog.atlases.take(10))
            '[Atlas] ${a.name} | ${a.address} | ${a.governance}',
        ],
      ];

      final allowVision = attachMapView && visionSupport != 'no-vision';
      final snapshotB64 =
          allowVision ? await captureMapSnapshotBase64() : null;

      final completer = Completer<AgentTurnResultDto>();
      final effectiveCashuToken = (cashuTokenOverride ?? settings.cashuToken).trim();
      final effectiveWalletDb =
          (cashuWalletDbPathOverride ?? cashuWalletDbPath)?.trim();
      final effectiveWalletPk =
          (cashuWalletPubkeyHexOverride ?? cashuWalletPubkeyHex)?.trim();
      final effectiveWalletKey =
          cashuWalletMasterKeyB64Override ?? cashuWalletMasterKeyB64;

      _agentStreamSub = streamEarthlyAgentTurn(
        prompt: effectivePrompt,
        history: history,
        providerBaseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey.isEmpty ? null : settings.apiKey,
        centerLon: center.lon,
        centerLat: center.lat,
        zoom: zoom,
        draftTitle: draftTitle,
        draftGeojson: draftGeojson,
        shelfMapTitles: shelfMaps.map((e) => e.summary.title).toList(),
        atlasWorkspaces:
            atlasWorkspaces.map((w) => w.coverageSummary).toList(),
        workingSetTitles: workingSetTitles,
        catalogItems: catalogItems,
        mapSnapshotBase64: snapshotB64,
        allowVision: allowVision,
        providerType: settings.effectiveProviderType.isEmpty
            ? null
            : settings.effectiveProviderType,
        cashuToken: effectiveCashuToken.isEmpty ? null : effectiveCashuToken,
        autoPayCashu: settings.isRoutstr ? settings.autoPayCashu : false,
        cashuMaxSats: settings.cashuMaxSats > 0
            ? BigInt.from(settings.cashuMaxSats)
            : null,
        cashuWalletDbPath:
            (effectiveWalletDb == null || effectiveWalletDb.isEmpty)
                ? null
                : effectiveWalletDb,
        cashuWalletPubkeyHex:
            (effectiveWalletPk == null || effectiveWalletPk.isEmpty)
                ? null
                : effectiveWalletPk,
        cashuWalletMasterKeyB64: effectiveWalletKey,
      ).listen(
        (ev) => handleStreamEvent(ev, completer: completer),
        onError: (Object err) {
          if (!completer.isCompleted) completer.completeError(err);
        },
        onDone: () {
          if (!completer.isCompleted) {
            completer.completeError('Agent stream ended unexpectedly');
          }
        },
      );

      final result = await completer.future;
      final completedNow = DateTime.now().millisecondsSinceEpoch;
      _updateActiveThread(
        (t) => t.copyWith(
          updatedAtMs: completedNow,
          messages: [
            ...t.messages,
            CopilotMessage(
              role: 'assistant',
              content: result.reply,
              toolCalls: result.toolCalls,
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
              totalTokens: result.totalTokens,
              cashuSpentSats: result.cashuSpentSats?.toInt(),
              cashuRefundedSats: result.cashuRefundedSats?.toInt(),
              cashuRefundToken: result.cashuRefundToken,
            ),
          ],
        ),
      );
      if (result.cashuSpentSats != null || result.cashuRefundedSats != null) {
        onCashuWalletUpdated?.call();
      }
      notifyListeners();

      final proposed = result.updatedDraftGeojson;
      if (proposed != null) {
        onProposedGeojson(
          proposed,
          result.diffAdded,
          result.diffModified,
          result.diffRemoved,
          result.toolCalls.isNotEmpty
              ? result.toolCalls.map((t) => t.summary).join(' · ')
              : result.reply,
        );
      }
      if (result.cameraAction != null) {
        final ca = result.cameraAction!;
        onCameraAction(ca.lon, ca.lat, ca.zoom);
      }
    } catch (err) {
      final errNow = DateTime.now().millisecondsSinceEpoch;
      _updateActiveThread(
        (t) => t.copyWith(
          updatedAtMs: errNow,
          messages: [
            ...t.messages,
            CopilotMessage(
              role: 'assistant',
              content: err.toString(),
              isError: true,
            ),
          ],
        ),
      );
      notifyListeners();
    } finally {
      busy = false;
      streamingText = '';
      activeToolStatus = null;
      liveToolCalls = const <AgentToolRecordDto>[];
      streamListenable.notifyListeners();
      onPersistSettings?.call();
    }
  }

  /// Stages [proposedGeojson] into the safeEditing ghost overlay or applies it
  /// immediately via [onApplyDirect]. Returns bounds of the first ghost shape
  /// when staged so the caller can fly the camera.
  GeoBox? stageOrApplyAiGeojson({
    required String proposedGeojson,
    required int diffAdded,
    required int diffModified,
    required int diffRemoved,
    required String summary,
    required void Function(List<DrawnFeature> parsed) onApplyDirect,
  }) {
    if (safeEditing) {
      final ghostShapes = parseGeoJsonShapes(
        proposedGeojson,
        datasetTitle: 'AI Proposal',
      );
      pendingAiEdit = PendingAiEdit(
        proposedGeojson: proposedGeojson,
        diffAdded: diffAdded,
        diffModified: diffModified,
        diffRemoved: diffRemoved,
        summary: summary,
      );
      aiGhostShapes = ghostShapes;
      aiGhostRevision += 1;
      ghostListenable.notifyListeners();
      notifyListeners();
      if (ghostShapes.isNotEmpty) {
        return computeFeatureBounds(ghostShapes.first);
      }
      return null;
    }
    final parsed = parseDraftFeaturesFromGeoJson(proposedGeojson);
    onApplyDirect(parsed);
    clearPendingGhost();
    return null;
  }

  PendingAiEdit? takeAndClearPendingAiEdit() {
    final pending = pendingAiEdit;
    if (pending == null) return null;
    clearPendingGhost();
    return pending;
  }

  void clearPendingGhost() {
    if (pendingAiEdit == null && aiGhostShapes.isEmpty) return;
    pendingAiEdit = null;
    aiGhostShapes = const <ShelfShape>[];
    aiGhostRevision += 1;
    ghostListenable.notifyListeners();
    notifyListeners();
  }

  List<DrawnFeature>? buildExtractedResearchFeatures({
    required ResearchSourceDto src,
    required List<DrawnFeature> existingFeatures,
  }) {
    final baseFeatures = List<DrawnFeature>.from(existingFeatures);
    var addedCount = 0;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    if (src.directGeojson != null && src.directGeojson!.isNotEmpty) {
      final parsed = parseDraftFeaturesFromGeoJson(src.directGeojson!);
      for (final f in parsed) {
        addedCount += 1;
        baseFeatures.add(
          DrawnFeature(
            id: 'src-$nowMs-$addedCount',
            kind: f.kind,
            vertices: f.vertices,
            name: f.name ?? src.title,
            description: f.description ?? 'Source: ${src.url}',
            colorHex: f.colorHex ?? '#1F5F8B',
            strokeWidth: f.strokeWidth,
            fillOpacity: f.fillOpacity,
            radius: f.radius,
            callouts: f.callouts,
          ),
        );
      }
    } else {
      for (var i = 0; i < src.coordinates.length && i < 12; i++) {
        final c = src.coordinates[i];
        addedCount += 1;
        final label = src.coordinates.length == 1
            ? src.title
            : '${src.title} #${i + 1}';
        baseFeatures.add(
          DrawnFeature(
            id: 'src-$nowMs-$addedCount',
            kind: DrawToolMode.point,
            vertices: [Geographic(lon: c.lon, lat: c.lat)],
            name: label,
            description: 'Extracted from ${src.url}',
            colorHex: '#1F5F8B',
            callouts: [
              DraftCallout(
                id: 'cite-$addedCount',
                title: src.title,
                text: src.url,
              ),
            ],
          ),
        );
      }
    }
    return addedCount == 0 ? null : baseFeatures;
  }

  StorySummaryDto buildResearchCitationStory(
    ResearchSourceDto src, {
    required String pubkey,
  }) {
    final buf = StringBuffer()
      ..writeln('# ${src.title}')
      ..writeln()
      ..writeln('> Source: [${src.title}](${src.url})')
      ..writeln();
    if (src.coordinates.isNotEmpty) {
      final c = src.coordinates.first;
      buf.writeln(
        'Location: geo:${c.lat.toStringAsFixed(5)},${c.lon.toStringAsFixed(5)}',
      );
      buf.writeln();
    }
    if (src.excerpt.isNotEmpty) {
      final snippet = src.excerpt.length > 500
          ? '${src.excerpt.substring(0, 500)}…'
          : src.excerpt;
      buf.writeln(snippet);
    }
    return StorySummaryDto(
      address: '',
      eventId: '',
      pubkey: pubkey,
      dTag: '',
      title: src.title,
      summary: 'Field notes citing ${src.url}',
      content: buf.toString(),
      referencedAddresses: const [],
      publishedAt: BigInt.from(DateTime.now().millisecondsSinceEpoch ~/ 1000),
    );
  }

  McpWorkspaceDto buildMcpWorkspaceDto({
    required Geographic center,
    required double zoom,
    required String draftTitle,
    required List<DrawnFeature> draftFeatures,
    required List<ShelfMapEntry> shelfMaps,
    required List<MountedAtlasWorkspaceDto> atlasWorkspaces,
    required EarthlyCatalogSnapshot? catalog,
  }) {
    final draftGeojson = draftFeaturesToGeoJson(
      title: draftTitle,
      features: draftFeatures,
    );
    final workingSetTitles = shelfMaps
        .where((e) => workingSetAddresses.contains(e.summary.address))
        .map((e) => '${e.summary.title} (${e.summary.address})')
        .toList(growable: false);
    final catalogItems = <String>[
      if (catalog != null) ...[
        for (final m in catalog.maps.take(20))
          '[Map] ${m.title} | ${m.address}${m.hashtags.isNotEmpty ? ' | #${m.hashtags.join(" #")}' : ''} | ${m.featureCount} features',
        for (final s in catalog.stories.take(10))
          '[Story] ${s.title} | ${s.address}',
        for (final a in catalog.atlases.take(10))
          '[Atlas] ${a.name} | ${a.address} | ${a.governance}',
      ],
    ];
    return McpWorkspaceDto(
      centerLon: center.lon,
      centerLat: center.lat,
      zoom: zoom,
      draftTitle: draftTitle,
      draftGeojson: draftGeojson,
      shelfMapTitles: shelfMaps.map((e) => e.summary.title).toList(),
      atlasWorkspaces:
          atlasWorkspaces.map((w) => w.coverageSummary).toList(),
      workingSetTitles: workingSetTitles,
      catalogItems: catalogItems,
    );
  }

  void syncMcpWorkspaceIfRunning({
    required bool isHeadlessTest,
    required McpWorkspaceDto Function() buildWorkspace,
  }) {
    if (mcpBridgeStatus?.running != true || isHeadlessTest) return;
    unawaited(syncMcpWorkspace(workspace: buildWorkspace()));
  }

  void _startMcpPolling(Future<void> Function() onTick) {
    _mcpPollTimer?.cancel();
    _mcpPollTimer = Timer.periodic(
      const Duration(milliseconds: 1500),
      (_) => unawaited(onTick()),
    );
  }

  void stopMcpPolling() {
    _mcpPollTimer?.cancel();
    _mcpPollTimer = null;
  }

  Future<void> pollMcpBridgeTick({
    required bool isHeadlessTest,
    required McpWorkspaceDto Function() buildWorkspace,
    required void Function(List<DrawnFeature> parsed) onDraftMutated,
    required void Function(double lon, double lat, double zoom) onCameraAction,
  }) async {
    if (isHeadlessTest) return;
    try {
      await RustBridge.ensureInitialized();
      await syncMcpWorkspace(workspace: buildWorkspace());
      final mutations = await drainMcpMutations();
      for (final m in mutations) {
        if (m.updatedDraftGeojson != null) {
          final parsed = parseDraftFeaturesFromGeoJson(m.updatedDraftGeojson!);
          onDraftMutated(parsed);
        }
        if (m.cameraAction != null) {
          final ca = m.cameraAction!;
          onCameraAction(ca.lon, ca.lat, ca.zoom);
        }
      }
      final status = await getMcpBridgeStatus();
      final changed = mcpBridgeStatus?.running != status.running ||
          mcpBridgeStatus?.totalCalls != status.totalCalls ||
          mcpBridgeStatus?.recentCalls.length != status.recentCalls.length;
      mcpBridgeStatus = status;
      if (!status.running) {
        stopMcpPolling();
      }
      if (changed) {
        mcpListenable.notifyListeners();
      }
    } catch (_) {}
  }

  Future<void> startMcpBridgeServer(
    int port, {
    required McpWorkspaceDto Function() buildWorkspace,
    required Future<void> Function() onTick,
  }) async {
    mcpBridgeBusy = true;
    mcpListenable.notifyListeners();
    try {
      await RustBridge.ensureInitialized();
      final status = await startMcpBridge(
        port: port,
        workspace: buildWorkspace(),
      );
      mcpBridgeStatus = status;
      if (status.running) {
        _startMcpPolling(onTick);
      }
    } finally {
      mcpBridgeBusy = false;
      mcpListenable.notifyListeners();
    }
  }

  Future<void> stopMcpBridgeServer() async {
    mcpBridgeBusy = true;
    mcpListenable.notifyListeners();
    try {
      await RustBridge.ensureInitialized();
      final status = await stopMcpBridge();
      stopMcpPolling();
      mcpBridgeStatus = status;
    } finally {
      mcpBridgeBusy = false;
      mcpListenable.notifyListeners();
    }
  }

  Future<void> refreshMcpBridgeStatus({
    required bool isHeadlessTest,
    required Future<void> Function() onTick,
  }) async {
    if (isHeadlessTest) return;
    try {
      await RustBridge.ensureInitialized();
      final status = await getMcpBridgeStatus();
      mcpBridgeStatus = status;
      if (status.running && _mcpPollTimer == null) {
        _startMcpPolling(onTick);
      }
      mcpListenable.notifyListeners();
    } catch (_) {}
  }

  McpBridgeViewState get mcpBridgeViewState {
    final s = mcpBridgeStatus;
    if (s == null) {
      return const McpBridgeViewState(
        running: false,
        port: McpBridgeSheet.defaultPort,
      );
    }
    return McpBridgeViewState(
      running: s.running,
      endpointUrl: s.endpointUrl.isNotEmpty ? s.endpointUrl : null,
      authToken: s.authToken.isNotEmpty ? s.authToken : null,
      port: s.port > 0 ? s.port : McpBridgeSheet.defaultPort,
      toolCount: s.toolCount,
      totalCalls: s.totalCalls.toInt(),
      recentCalls: [
        for (final c in s.recentCalls)
          McpBridgeCallEntry(
            timestampMs: c.timestampMs.toInt(),
            toolName: c.toolName,
            ok: c.ok,
            summary: c.summary,
          ),
      ],
    );
  }

  @override
  void dispose() {
    unawaited(_agentStreamSub?.cancel());
    _mcpPollTimer?.cancel();
    streamListenable.dispose();
    ghostListenable.dispose();
    mcpListenable.dispose();
    super.dispose();
  }
}
