import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../nostr/nip55_signer.dart';
import '../runtime/rust_bridge.dart';
import '../shell/desk_sheet.dart';
import '../shell/inbox_sheet.dart';
import '../shell/outbox_queue_sheet.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/private_groups.dart';
import '../src/rust/api/publish.dart';
import '../src/rust/api/relay_pool.dart';
import '../src/rust/api/settings.dart';
import '../src/rust/api/spike.dart';

/// Manages background relay WebSocket streaming, Nearby P2P LocalNode sync,
/// Outbox queue flushing, MLS Circles, Inbox notifications, and deep links.
class SpacesSyncController extends ChangeNotifier {
  final ChangeNotifier badgeListenable = ChangeNotifier();
  final ChangeNotifier circleLensListenable = ChangeNotifier();
  final ChangeNotifier outboxListenable = ChangeNotifier();
  final ChangeNotifier inboxListenable = ChangeNotifier();

  StreamSubscription<LiveRelayEventDto>? _relayStreamSub;
  bool relayStreamLive = false;
  Timer? _liveListenerTimer;
  Timer? _outboxFlushTimer;

  String? supportDirPath;
  List<OutboxQueueEntry> outboxItems = const <OutboxQueueEntry>[];
  bool outboxFlushing = false;

  int liveTickCount = 0;
  int pendingClaimCount = 0;
  final Map<String, String> _seenLocalEventIds = <String, String>{};
  bool _initialLocalBaselineCaptured = false;

  String cordnServerPubkey =
      'fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37';
  String mlsDatabasePath = '';
  List<CircleWorkspaceDto> circles = <CircleWorkspaceDto>[];
  List<CirclePendingJoinDto> circlePendingJoins = <CirclePendingJoinDto>[];
  String? activeCircleLensId;
  String? selectedCircleId;
  String? pendingDeepLinkCircleInvite;
  String? pendingDeepLinkPairing;

  List<InboxItemDto> inboxItems = <InboxItemDto>[];
  bool inboxLoading = false;
  int inboxReadAllBefore = 0;
  final Set<String> inboxReadIds = <String>{};

  String? hostedSessionId;
  RemotePeerDto? acceptedRemotePeer;

  int get pendingOutboxCount =>
      outboxItems.where((item) => item.isPending).length;

  int get inboxUnreadCount => inboxItems
      .where(
        (i) => !InboxSheet.isItemRead(
          i,
          readAllBeforeSecs: inboxReadAllBefore,
          readIds: inboxReadIds,
        ),
      )
      .length;

  int get totalSpacesBadgeCount =>
      pendingClaimCount +
      circlePendingJoins.length +
      inboxUnreadCount +
      pendingOutboxCount;

  CircleWorkspaceDto? get activeCircleLens {
    final id = activeCircleLensId;
    if (id == null) return null;
    for (final c in circles) {
      if (c.workspaceId == id) return c;
    }
    return null;
  }

  String? get activeNearbySessionId =>
      acceptedRemotePeer?.sessionId ?? hostedSessionId;

  String? get activeSessionSummaryText {
    if (acceptedRemotePeer != null) {
      return 'Paired to ${acceptedRemotePeer!.sessionName ?? acceptedRemotePeer!.relayUrl}';
    }
    if (hostedSessionId != null) {
      return 'Hosting Field Session ($hostedSessionId)';
    }
    return null;
  }

  void applyRestoredSettings(AppSettingsDto loaded) {
    if (loaded.cordnServerPubkey.length == 64) {
      cordnServerPubkey = loaded.cordnServerPubkey;
    }
    inboxReadAllBefore = loaded.inboxReadAllBefore.toInt();
    inboxReadIds
      ..clear()
      ..addAll(loaded.inboxReadIds);
    badgeListenable.notifyListeners();
    inboxListenable.notifyListeners();
    notifyListeners();
  }

  void setMlsDatabasePath(String path) {
    if (mlsDatabasePath == path) return;
    mlsDatabasePath = path;
    notifyListeners();
  }

  Future<String> ensureMlsDatabasePath() async {
    if (mlsDatabasePath.isNotEmpty) return mlsDatabasePath;
    final dir = await getApplicationSupportDirectory();
    final path = '${dir.path}/mls.sqlite3';
    mlsDatabasePath = path;
    notifyListeners();
    return path;
  }

  Future<String> _databasePath() async {
    final dir = await getApplicationSupportDirectory();
    return '${dir.path}/earthly.sqlite3';
  }

  void startTimers({
    required bool isHeadlessTest,
    required Future<void> Function() onLivePollTick,
    required Future<void> Function() onOutboxFlushTick,
  }) {
    if (isHeadlessTest) return;
    _liveListenerTimer?.cancel();
    _liveListenerTimer = Timer.periodic(
      const Duration(seconds: 2),
      (_) => unawaited(onLivePollTick()),
    );
    _outboxFlushTimer?.cancel();
    _outboxFlushTimer = Timer.periodic(
      const Duration(seconds: 45),
      (_) => unawaited(onOutboxFlushTick()),
    );
  }

  Future<void> initPersistentRelayPool(
    String dirPath,
    List<String> relayUrls, {
    bool isHeadlessTest = false,
  }) async {
    supportDirPath = dirPath;
    if (isHeadlessTest) return;
    try {
      await RustBridge.ensureInitialized();
      await initRelayPool(
        dataDir: dirPath,
        relayUrls: relayUrls,
      );
    } catch (_) {}
  }

  Future<void> startLiveRelayStream(
    List<String> relayUrls, {
    required void Function(LiveRelayEventDto event) onEvent,
  }) async {
    try {
      await RustBridge.ensureInitialized();
      await _relayStreamSub?.cancel();
      final stream = subscribeEarthlyRelayStream(relayUrls: relayUrls);
      relayStreamLive = true;
      notifyListeners();
      _relayStreamSub = stream.listen(
        onEvent,
        onError: (_) {
          relayStreamLive = false;
          notifyListeners();
        },
        onDone: () {
          relayStreamLive = false;
          notifyListeners();
        },
      );
    } catch (_) {
      relayStreamLive = false;
      notifyListeners();
    }
  }

  Future<void> pollLiveNearbyUpdates({
    required void Function(EarthlyCatalogSnapshot localSnap) onLocalSnapChanged,
    required void Function(List<MapSummaryDto> newlyArrivedMaps)
        onNewlyArrivedMaps,
  }) async {
    liveTickCount += 1;
    try {
      await RustBridge.ensureInitialized();
      final status = await localNodeStatus();
      if (!status.running) return;

      final peers = await nearbyPeersStatus();
      final pendingCount = peers.pendingClaims.length;
      if (pendingCount != pendingClaimCount) {
        pendingClaimCount = pendingCount;
        badgeListenable.notifyListeners();
        notifyListeners();
      }

      if (liveTickCount % 2 == 0) {
        for (final remote in peers.remotePeers) {
          if (remote.status == 'accepted') {
            try {
              await syncNearbyPeer(nodeId: remote.nodeId);
            } catch (_) {}
          }
        }
      }

      final localSnap = await fetchLocalNodeCatalog();
      final newlyArrivedMaps = <MapSummaryDto>[];
      var anyChange = false;

      for (final m in localSnap.maps) {
        final prevId = _seenLocalEventIds[m.address];
        if (prevId != m.eventId) {
          _seenLocalEventIds[m.address] = m.eventId;
          anyChange = true;
          if (_initialLocalBaselineCaptured) {
            newlyArrivedMaps.add(m);
          }
        }
      }
      for (final s in localSnap.sightings) {
        if (_seenLocalEventIds[s.address] != s.eventId) {
          _seenLocalEventIds[s.address] = s.eventId;
          anyChange = true;
        }
      }
      for (final st in localSnap.stories) {
        if (_seenLocalEventIds[st.address] != st.eventId) {
          _seenLocalEventIds[st.address] = st.eventId;
          anyChange = true;
        }
      }
      for (final b in localSnap.beacons) {
        if (_seenLocalEventIds[b.address] != b.eventId) {
          _seenLocalEventIds[b.address] = b.eventId;
          anyChange = true;
        }
      }
      _initialLocalBaselineCaptured = true;

      if (!anyChange) return;

      onLocalSnapChanged(localSnap);
      if (newlyArrivedMaps.isNotEmpty) {
        onNewlyArrivedMaps(newlyArrivedMaps);
      }
    } catch (_) {}
  }

  static OutboxQueueEntry _outboxEntryFromDto(OutboxItemDto dto) {
    return OutboxQueueEntry(
      id: dto.id,
      eventId: dto.eventId,
      kind: dto.kind,
      state: dto.state,
      attemptCount: dto.attemptCount.toInt(),
      nextRetryAt: dto.nextRetryAt?.toInt(),
      createdAt: dto.createdAt.toInt(),
      relays: dto.relays
          .map(
            (r) => OutboxRelayEntry(
              relayUrl: r.relayUrl,
              state: r.state,
              lastError: r.lastError,
            ),
          )
          .toList(growable: false),
    );
  }

  Future<void> refreshOutboxItems({bool isHeadlessTest = false}) async {
    if (isHeadlessTest) return;
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final raw = await listOutboxItems(databasePath: dbPath);
      outboxItems = raw.map(_outboxEntryFromDto).toList(growable: false);
      outboxListenable.notifyListeners();
      badgeListenable.notifyListeners();
      notifyListeners();
    } catch (_) {}
  }

  Future<void> flushAndRefreshOutbox({bool isHeadlessTest = false}) async {
    if (isHeadlessTest || outboxFlushing) return;
    outboxFlushing = true;
    outboxListenable.notifyListeners();
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      await flushOutboxQueue(databasePath: dbPath);
      final raw = await listOutboxItems(databasePath: dbPath);
      outboxItems = raw.map(_outboxEntryFromDto).toList(growable: false);
    } catch (_) {
    } finally {
      outboxFlushing = false;
      outboxListenable.notifyListeners();
      badgeListenable.notifyListeners();
      notifyListeners();
    }
  }

  Future<void> retryOutboxEntry(String id) async {
    await RustBridge.ensureInitialized();
    final dbPath = await _databasePath();
    await retryOutboxItem(databasePath: dbPath, itemId: id);
    await flushAndRefreshOutbox();
  }

  Future<void> discardOutboxEntry(String id) async {
    await RustBridge.ensureInitialized();
    final dbPath = await _databasePath();
    await discardOutboxItem(databasePath: dbPath, itemId: id);
    await refreshOutboxItems();
  }

  Future<PublishOutcomeDto> deliverForAudience(
    DraftAudienceChoice audience,
    String signedEventJson, {
    required List<String> relayUrls,
  }) async {
    final dbPath = await _databasePath();
    final PublishOutcomeDto outcome;
    if (audience == DraftAudienceChoice.nearbyLocalNode) {
      final dir = await getApplicationSupportDirectory();
      final existing = await localNodeStatus();
      if (!existing.running) {
        await startLocalNode(dataDir: '${dir.path}/local-node');
      }
      outcome = await publishNearbyEventViaOutbox(
        databasePath: dbPath,
        signedEventJson: signedEventJson,
        remoteNodeIds: acceptedRemotePeer != null
            ? <String>[acceptedRemotePeer!.nodeId]
            : const <String>[],
      );
    } else {
      outcome = await publishSignedEventViaOutbox(
        databasePath: dbPath,
        signedEventJson: signedEventJson,
        relayUrls: relayUrls,
      );
    }
    unawaited(refreshOutboxItems());
    return outcome;
  }

  void setSessionState(String? hostedId, RemotePeerDto? acceptedPeer) {
    if (hostedId != null) hostedSessionId = hostedId;
    acceptedRemotePeer = acceptedPeer;
    notifyListeners();
  }

  void setCordnServerPubkey(String pubkey, {VoidCallback? onPersist}) {
    cordnServerPubkey = pubkey;
    notifyListeners();
    onPersist?.call();
  }

  void setSelectedCircleId(String? circleId) {
    selectedCircleId = circleId;
    notifyListeners();
  }

  void clearPendingCircleInvite() {
    if (pendingDeepLinkCircleInvite == null) return;
    pendingDeepLinkCircleInvite = null;
    notifyListeners();
  }

  void setPendingDeepLinkCircleInvite(String uri) {
    pendingDeepLinkCircleInvite = uri;
    notifyListeners();
  }

  void setPendingDeepLinkPairing(String uri) {
    pendingDeepLinkPairing = uri;
    notifyListeners();
  }

  Future<void> refreshCirclesSnapshot({
    required String? accountPubkey,
    bool isHeadlessTest = false,
  }) async {
    if (isHeadlessTest) return;
    if (accountPubkey == null || accountPubkey.isEmpty) {
      circles = const <CircleWorkspaceDto>[];
      circlePendingJoins = const <CirclePendingJoinDto>[];
      activeCircleLensId = null;
      circleLensListenable.notifyListeners();
      badgeListenable.notifyListeners();
      notifyListeners();
      return;
    }
    try {
      await RustBridge.ensureInitialized();
      final mlsPath = await ensureMlsDatabasePath();
      final snap = await loadCirclesSnapshot(
        databasePath: mlsPath,
        ownerPubkeyHex: accountPubkey,
      );
      circles = snap.workspaces;
      circlePendingJoins = snap.pendingJoins;
      badgeListenable.notifyListeners();
      notifyListeners();
    } catch (_) {}
  }

  static MapSummaryDto circleDatasetToSummary(
    CircleWorkspaceDto ws,
    CircleDatasetDto ds,
  ) {
    final addr = 'private-group:${ws.workspaceId}:${ds.datasetId}';
    return MapSummaryDto(
      address: addr,
      eventId: ds.envelopeId,
      pubkey: ds.pubkey,
      dTag: ds.datasetId,
      title: '🔒 ${ds.title}',
      description: 'MLS-encrypted Circle Map (${ws.name})',
      featureCount: ds.featureCount,
      sizeBytes: ds.geojsonJson.length,
      geojson: ds.geojsonJson,
      blobRefs: const <BlobRefDto>[],
      hashtags: const ['circle-mls'],
      labels: const <String>[],
      contextRefs: [ws.workspaceId],
      createdAt: ds.createdAt,
    );
  }

  void upsertCircleWorkspace(CircleWorkspaceDto ws) {
    final idx = circles.indexWhere((c) => c.workspaceId == ws.workspaceId);
    if (idx >= 0) {
      circles = [
        ...circles.sublist(0, idx),
        ws,
        ...circles.sublist(idx + 1),
      ];
    } else {
      circles = [ws, ...circles];
    }
    circleLensListenable.notifyListeners();
    notifyListeners();
  }

  void enterCircleLensState(CircleWorkspaceDto ws) {
    activeCircleLensId = ws.workspaceId;
    selectedCircleId = ws.workspaceId;
    circleLensListenable.notifyListeners();
    notifyListeners();
  }

  void leaveCircleLensState() {
    activeCircleLensId = null;
    circleLensListenable.notifyListeners();
    notifyListeners();
  }

  // --- Inbox ---

  Future<void> refreshInbox({
    required String? accountPubkey,
    required List<String> relayUrls,
    required EarthlyCatalogSnapshot? catalog,
    required List<AtlasSummaryDto> deskAtlases,
    required bool Function(String pubkey) hasProfile,
    required void Function(List<ProfileMetadataDto> fetched) onProfilesFetched,
    bool isHeadlessTest = false,
  }) async {
    if (isHeadlessTest || inboxLoading) return;
    if (accountPubkey == null || accountPubkey.isEmpty) {
      inboxItems = const <InboxItemDto>[];
      inboxListenable.notifyListeners();
      badgeListenable.notifyListeners();
      notifyListeners();
      return;
    }
    inboxLoading = true;
    inboxListenable.notifyListeners();
    try {
      await RustBridge.ensureInitialized();
      final ownedAtlases = <String>[
        for (final a in catalog?.atlases ?? const <AtlasSummaryDto>[])
          if (a.pubkey == accountPubkey) a.address,
        for (final a in deskAtlases)
          if (a.pubkey == accountPubkey) a.address,
      ];
      final titles = <String, String>{
        for (final m in catalog?.maps ?? const <MapSummaryDto>[])
          m.address: m.title,
        for (final s in catalog?.stories ?? const <StorySummaryDto>[])
          s.address: s.title,
        for (final a in catalog?.atlases ?? const <AtlasSummaryDto>[])
          a.address: a.name,
      };
      final items = await fetchInboxItems(
        relayUrls: relayUrls,
        currentUserPubkey: accountPubkey,
        ownedAtlasAddresses: ownedAtlases.toSet().toList(growable: false),
        knownTitlesJson: jsonEncode(titles),
      );
      inboxItems = items;
      badgeListenable.notifyListeners();

      final actorPks = items
          .map((i) => i.actorPubkey)
          .where((p) => !hasProfile(p))
          .toSet()
          .toList(growable: false);
      if (actorPks.isNotEmpty) {
        final fetched = await fetchProfiles(
          relayUrls: relayUrls,
          pubkeys: actorPks,
        );
        if (fetched.isNotEmpty) {
          onProfilesFetched(fetched);
        }
      }
    } catch (_) {
    } finally {
      inboxLoading = false;
      inboxListenable.notifyListeners();
      badgeListenable.notifyListeners();
      notifyListeners();
    }
  }

  void markInboxItemRead(String itemId, {VoidCallback? onPersist}) {
    inboxReadIds.add(itemId);
    inboxListenable.notifyListeners();
    badgeListenable.notifyListeners();
    notifyListeners();
    onPersist?.call();
  }

  void markAllInboxRead({VoidCallback? onPersist}) {
    var maxTs = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    for (final item in inboxItems) {
      final ts = item.createdAt.toInt();
      if (ts > maxTs) maxTs = ts;
    }
    inboxReadAllBefore = maxTs;
    inboxReadIds.clear();
    inboxListenable.notifyListeners();
    badgeListenable.notifyListeners();
    notifyListeners();
    onPersist?.call();
  }

  // --- NIP-65 & Shoutbox ---

  Future<List<RelayListEntryDto>> fetchNip65Relays({
    required List<String> relayUrls,
    required Future<Nip55Account> Function() ensureAccount,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();
    return fetchUserRelayList(
      relayUrls: relayUrls,
      pubkeyOrNpub: account.pubkey,
    );
  }

  Future<PublishOutcomeDto> publishNip65Relays(
    List<RelayListEntryDto> relays, {
    required List<String> relayUrls,
    required Future<Nip55Account> Function() ensureAccount,
    required Future<String> Function(Nip55Account, String) signUnsignedEvent,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();
    final prepared = await prepareUnsignedRelayListEvent(
      pubkeyOrNpub: account.pubkey,
      relays: relays,
    );
    final signed = await signUnsignedEvent(account, prepared.unsignedEventJson);
    return deliverForAudience(
      DraftAudienceChoice.publicRelay,
      signed,
      relayUrls: relayUrls,
    );
  }

  Future<PublishOutcomeDto> publishShoutboxPost(
    String category,
    String content, {
    required List<String> relayUrls,
    required Future<Nip55Account> Function() ensureAccount,
    required Future<String> Function(Nip55Account, String) signUnsignedEvent,
  }) async {
    await RustBridge.ensureInitialized();
    final account = await ensureAccount();
    final prepared = await prepareUnsignedShoutboxPost(
      pubkeyOrNpub: account.pubkey,
      category: category,
      content: content,
    );
    final signed = await signUnsignedEvent(account, prepared.unsignedEventJson);
    return deliverForAudience(
      DraftAudienceChoice.publicRelay,
      signed,
      relayUrls: relayUrls,
    );
  }

  @override
  void dispose() {
    unawaited(_relayStreamSub?.cancel());
    _liveListenerTimer?.cancel();
    _outboxFlushTimer?.cancel();
    badgeListenable.dispose();
    circleLensListenable.dispose();
    outboxListenable.dispose();
    inboxListenable.dispose();
    super.dispose();
  }
}
