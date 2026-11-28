import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import '../nostr/nip55_signer.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../spike/rust_node_sheet.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/private_groups.dart';
import '../src/rust/api/publish.dart';
import '../src/rust/api/spike.dart';
import '../theme/earthly_theme.dart';
import 'earthly_toast.dart';
import 'map_drawer.dart';
import 'qr_code_view.dart';

enum _LocalBindChoice { lanWifi, fipsMesh, loopback }

/// Spaces drawer: 3-tab (`Groups` | `Nearby` | `Network`) hub for MLS Groups,
/// Inbox/Outbox Activity, Nearby Field Sessions + Live Beacon, and Nostr Relays,
/// Tools (Cashu Wallet, MCP Bridge, Shoutbox, Help), Account, and Diagnostics.
class SpacesSheet extends StatefulWidget {
  const SpacesSheet({
    required this.account,
    required this.localNsec,
    required this.relayUrls,
    required this.onRelayUrlsChanged,
    required this.onAccountChanged,
    required this.onLocalKeyChanged,
    required this.onSessionStateChanged,
    required this.onNearbySynced,
    required this.onBroadcastBeacon,
    this.onBack,
    required this.onClose,
    this.circles = const <CircleWorkspaceDto>[],
    this.pendingCircleJoinsCount = 0,
    this.activeCircleId,
    this.onOpenCircles,
    this.onSelectCircle,
    this.inboxUnreadCount = 0,
    this.onOpenInbox,
    this.pendingOutboxCount = 0,
    this.onOpenOutbox,
    this.initialPairingLink,
    this.onFetchNip65Relays,
    this.onPublishNip65Relays,
    this.onProbeRelaysHealth,
    this.onOpenShoutbox,
    this.onOpenHelp,
    this.onOpenCashuWallet,
    this.cashuBalanceSats,
    this.cashuWalletEnabled = false,
    this.onOpenMcpBridge,
    this.mcpBridgeRunning = false,
    super.key,
  });

  final Nip55Account? account;
  final String? localNsec;
  final List<String> relayUrls;
  final ValueChanged<List<String>> onRelayUrlsChanged;
  final ValueChanged<Nip55Account?> onAccountChanged;
  final ValueChanged<LocalKeypairDto?> onLocalKeyChanged;
  final void Function(String? hostedSessionId, RemotePeerDto? acceptedPeer)
      onSessionStateChanged;
  final VoidCallback onNearbySynced;
  final Future<PublishOutcomeDto> Function(
    String status,
    int durationMinutes,
    bool nearby,
  ) onBroadcastBeacon;
  final List<CircleWorkspaceDto> circles;
  final int pendingCircleJoinsCount;
  final String? activeCircleId;
  final VoidCallback? onOpenCircles;
  final ValueChanged<CircleWorkspaceDto>? onSelectCircle;
  final int inboxUnreadCount;
  final VoidCallback? onOpenInbox;
  final int pendingOutboxCount;
  final VoidCallback? onOpenOutbox;
  final String? initialPairingLink;
  final Future<List<RelayListEntryDto>> Function()? onFetchNip65Relays;
  final Future<PublishOutcomeDto> Function(List<RelayListEntryDto> relays)?
      onPublishNip65Relays;
  final Future<List<RelayHealthDto>> Function(List<String> urls)?
      onProbeRelaysHealth;
  final VoidCallback? onOpenShoutbox;
  final VoidCallback? onOpenHelp;
  final VoidCallback? onOpenCashuWallet;
  final int? cashuBalanceSats;
  final bool cashuWalletEnabled;
  final VoidCallback? onOpenMcpBridge;
  final bool mcpBridgeRunning;
  final VoidCallback? onBack;
  final VoidCallback onClose;

  @override
  State<SpacesSheet> createState() => _SpacesSheetState();
}

class _SpacesSheetState extends State<SpacesSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _inviteInputController = TextEditingController();
  final _beaconStatusController = TextEditingController();
  final _relayInputController = TextEditingController();
  final _fipsAddressController = TextEditingController();
  Timer? _pollTimer;

  bool _amberInstalled = false;
  bool _busy = false;
  _LocalBindChoice _bindChoice = _LocalBindChoice.lanWifi;
  int _beaconDurationMinutes = 60;
  bool _beaconNearby = false;
  String? _error;
  String? _infoBanner;
  LocalNodeSnapshot? _node;
  String? _hostedSessionId;
  String? _sessionInvite;
  NearbyPeersSnapshot? _peers;
  final Map<String, RelayHealthDto> _relayHealth = <String, RelayHealthDto>{};
  bool _probingRelays = false;
  bool _syncingNip65 = false;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
    if (widget.initialPairingLink != null &&
        widget.initialPairingLink!.isNotEmpty) {
      _inviteInputController.text = widget.initialPairingLink!;
    }
    _checkEnvironment();
    _pollTimer = Timer.periodic(
      const Duration(seconds: 2),
      (_) => unawaited(_pollPeers()),
    );
  }

  @override
  void didUpdateWidget(covariant SpacesSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialPairingLink != null &&
        widget.initialPairingLink != oldWidget.initialPairingLink &&
        widget.initialPairingLink!.isNotEmpty) {
      _inviteInputController.text = widget.initialPairingLink!;
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _tabs.dispose();
    _inviteInputController.dispose();
    _beaconStatusController.dispose();
    _relayInputController.dispose();
    _fipsAddressController.dispose();
    super.dispose();
  }

  void _addCustomRelay() {
    final raw = _relayInputController.text.trim();
    if (raw.isEmpty) return;
    final normalized = (raw.startsWith('wss://') || raw.startsWith('ws://'))
        ? raw
        : 'wss://$raw';
    if (widget.relayUrls.contains(normalized)) {
      _relayInputController.clear();
      return;
    }
    _relayInputController.clear();
    widget.onRelayUrlsChanged([...widget.relayUrls, normalized]);
    setState(() => _infoBanner = 'Added relay $normalized (saved to SQLite)');
  }

  void _removeRelay(String url) {
    final next = widget.relayUrls.where((r) => r != url).toList();
    if (next.isEmpty) {
      next.add('wss://relay.earthly.city');
    }
    widget.onRelayUrlsChanged(next);
  }

  Future<void> _probeRelays() async {
    setState(() {
      _probingRelays = true;
      _error = null;
    });
    try {
      final results = widget.onProbeRelaysHealth != null
          ? await widget.onProbeRelaysHealth!(widget.relayUrls)
          : await (() async {
              await RustBridge.ensureInitialized();
              return probeRelaysHealth(relayUrls: widget.relayUrls);
            })();
      if (!mounted) return;
      setState(() {
        for (final r in results) {
          _relayHealth[r.url] = r;
        }
        final okCount = results.where((r) => r.reachable).length;
        _infoBanner =
            'Relay health probe complete ($okCount/${results.length} reachable).';
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _probingRelays = false);
    }
  }

  Future<void> _syncNip65() async {
    setState(() {
      _syncingNip65 = true;
      _error = null;
    });
    try {
      List<RelayListEntryDto> entries;
      if (widget.onFetchNip65Relays != null) {
        entries = await widget.onFetchNip65Relays!();
      } else {
        final acct = widget.account;
        if (acct == null) {
          throw StateError('Sign in first to sync your NIP-65 relay list');
        }
        await RustBridge.ensureInitialized();
        entries = await fetchUserRelayList(
          relayUrls: widget.relayUrls,
          pubkeyOrNpub: acct.pubkey,
        );
      }
      if (!mounted) return;
      if (entries.isEmpty) {
        setState(() {
          _infoBanner = 'No NIP-65 (kind 10002) relays found for this account.';
        });
        return;
      }
      final merged = <String>[
        ...widget.relayUrls,
        for (final e in entries)
          if (!widget.relayUrls.contains(e.url)) e.url,
      ];
      widget.onRelayUrlsChanged(merged);
      setState(() {
        _infoBanner =
            'Synced ${entries.length} NIP-65 relay(s) into active relay list.';
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _syncingNip65 = false);
    }
  }

  Future<void> _publishNip65() async {
    if (widget.onPublishNip65Relays == null) return;
    setState(() {
      _syncingNip65 = true;
      _error = null;
    });
    try {
      final entries = widget.relayUrls
          .map((url) => RelayListEntryDto(url: url, read: true, write: true))
          .toList(growable: false);
      final outcome = await widget.onPublishNip65Relays!(entries);
      if (!mounted) return;
      final okCount = outcome.relays.where((r) => r.ok).length;
      setState(() {
        _infoBanner =
            'Published NIP-65 (kind 10002) relay list ($okCount/${outcome.relays.length} ok).';
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _syncingNip65 = false);
    }
  }

  Future<void> _broadcastBeacon() async {
    setState(() {
      _busy = true;
      _error = null;
      _infoBanner = null;
    });
    try {
      final outcome = await widget.onBroadcastBeacon(
        _beaconStatusController.text.trim(),
        _beaconDurationMinutes,
        _beaconNearby,
      );
      if (!mounted) return;
      final okCount = outcome.relays.where((r) => r.ok).length;
      setState(() {
        _infoBanner =
            'Live Beacon broadcast ($okCount/${outcome.relays.length} relay ok · ${_beaconDurationMinutes}m expiry)';
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkEnvironment() async {
    if (Platform.isAndroid) {
      final amber = await Nip55Signer.isSignerInstalled();
      if (mounted) setState(() => _amberInstalled = amber);
    }
    try {
      await RustBridge.ensureInitialized();
      final status = await localNodeStatus();
      if (mounted && status.running) {
        setState(() {
          _node = status;
          _bindChoice = switch (status.scope) {
            'fips-mesh' => _LocalBindChoice.fipsMesh,
            'local-network' => _LocalBindChoice.lanWifi,
            _ => _LocalBindChoice.loopback,
          };
        });
      }
      await _pollPeers();
    } catch (_) {}
  }

  Future<void> _pollPeers() async {
    try {
      await RustBridge.ensureInitialized();
      final snap = await nearbyPeersStatus();
      var updatedSnap = snap;
      for (final remote in snap.remotePeers) {
        if (remote.status == 'pending') {
          try {
            await refreshNearbyPeer(nodeId: remote.nodeId);
            updatedSnap = await nearbyPeersStatus();
          } catch (_) {}
        }
      }
      if (!mounted) return;
      setState(() => _peers = updatedSnap);
      _notifySessionState(updatedSnap);
    } catch (_) {}
  }

  void _notifySessionState(NearbyPeersSnapshot snap) {
    RemotePeerDto? accepted;
    for (final r in snap.remotePeers) {
      if (r.status == 'accepted') {
        accepted = r;
        break;
      }
    }
    widget.onSessionStateChanged(_hostedSessionId, accepted);
  }

  Future<void> _signInWithAmber() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final account = await Nip55Signer.getPublicKey();
      if (!mounted) return;
      widget.onAccountChanged(account);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _generateLocalKeypair() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final kp = await generateLocalNostrKeypair();
      if (!mounted) return;
      widget.onLocalKeyChanged(kp);
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _hostFieldSession() async {
    setState(() {
      _busy = true;
      _error = null;
      _infoBanner = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final appDir = await getApplicationSupportDirectory();
      final dataDir = '${appDir.path}/local-node';
      final LocalNodeSnapshot node;
      final String sessionName;
      final String sessionDesc;
      switch (_bindChoice) {
        case _LocalBindChoice.lanWifi:
          node = await startLocalNodeLan(dataDir: dataDir);
          sessionName = 'LAN Field Survey';
          sessionDesc = 'Nearby Wi-Fi Field Session hosted on this device';
        case _LocalBindChoice.fipsMesh:
          final manualV6 = _fipsAddressController.text.trim();
          node = await startLocalNodeFips(
            dataDir: dataDir,
            fipsIpv6: manualV6.isEmpty ? null : manualV6,
          );
          sessionName = 'FIPS Mesh Survey';
          sessionDesc = 'FIPS fd00::/8 IPv6 mesh Field Session';
        case _LocalBindChoice.loopback:
          node = await startLocalNode(dataDir: dataDir);
          sessionName = 'Local Field Survey';
          sessionDesc = 'Loopback Field Session on this device';
      }
      final sessionId = 'field-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
      final invite = await createFieldSessionInvite(
        sessionId: sessionId,
        sessionName: sessionName,
        description: sessionDesc,
        allowPeerWrites: true,
      );
      if (!mounted) return;
      setState(() {
        _node = node;
        _hostedSessionId = sessionId;
        _sessionInvite = invite;
      });
      await _pollPeers();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _scanQrAndJoin() async {
    setState(() {
      _busy = true;
      _error = null;
      _infoBanner = null;
    });
    try {
      final raw = await DeviceBridge.scanQrCode();
      if (!mounted) return;
      _inviteInputController.text = raw;
      await _submitPairingJoin();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitPairingJoin() async {
    final raw = _inviteInputController.text.trim();
    if (raw.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
      _infoBanner = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final appDir = await getApplicationSupportDirectory();
      final dataDir = '${appDir.path}/local-node';
      final peerLabel = Platform.isAndroid
          ? 'Android Field Device'
          : Platform.isMacOS
              ? 'macOS Studio'
              : 'Earthly Peer';
      final record = await joinNearbySession(
        dataDir: dataDir,
        rawLink: raw,
        peerName: peerLabel,
      );
      if (!mounted) return;
      final status = await localNodeStatus();
      setState(() {
        _node = status;
        _infoBanner =
            'Pairing request sent to ${record.relayUrl}. Tap Approve on the host device!';
      });
      await _pollPeers();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _approveClaim(PendingClaimDto claim) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await approveNearbyClaim(claimId: claim.claimId);
      if (!mounted) return;
      setState(() {
        _infoBanner =
            'Approved ${claim.peerName ?? claim.peerPubkey.substring(0, 10)}! Peer can now publish & sync over LAN.';
      });
      await _pollPeers();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rejectClaim(PendingClaimDto claim) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await rejectNearbyClaim(
        claimId: claim.claimId,
        reason: 'Declined by host',
      );
      await _pollPeers();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _syncRemote(RemotePeerDto remote) async {
    setState(() {
      _busy = true;
      _error = null;
      _infoBanner = null;
    });
    try {
      final count = await syncNearbyPeer(nodeId: remote.nodeId);
      if (!mounted) return;
      setState(() {
        _infoBanner =
            'Synced $count event${count == 1 ? '' : 's'} from ${remote.sessionName ?? remote.relayUrl}! Open Explore → Refresh to view.';
      });
      widget.onNearbySynced();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _buildExpandableCard(
    ThemeData theme, {
    required Widget child,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.dividerColor),
      ),
      child: child,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pendingClaims = _peers?.pendingClaims ?? const <PendingClaimDto>[];
    final approvedPeers = _peers?.approvedPeers ?? const <ApprovedPeerDto>[];
    final remotePeers = _peers?.remotePeers ?? const <RemotePeerDto>[];

    return EarthlyMapDrawer(
      initialFraction: 0.56,
      onClose: widget.onClose,
      header: Padding(
        padding: EdgeInsets.fromLTRB(widget.onBack != null ? 4 : 8, 0, 4, 0),
        child: Row(
          children: [
            if (widget.onBack != null)
              IconButton(
                key: const Key('spaces-back-btn'),
                tooltip: 'Back',
                visualDensity: VisualDensity.compact,
                onPressed: widget.onBack,
                icon: const Icon(Icons.arrow_back, size: 18),
              ),
            Expanded(
              child: TabBar(
                controller: _tabs,
                dividerHeight: 0,
                tabs: const [
                  Tab(key: Key('spaces-tab-groups'), text: 'Groups'),
                  Tab(key: Key('spaces-tab-nearby'), text: 'Nearby'),
                  Tab(key: Key('spaces-tab-network'), text: 'Network'),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Refresh peers',
              visualDensity: VisualDensity.compact,
              onPressed: () => unawaited(_pollPeers()),
              icon: const Icon(Icons.refresh, size: 18),
            ),
            IconButton(
              tooltip: 'Close',
              visualDensity: VisualDensity.compact,
              onPressed: widget.onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_infoBanner != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              color: EarthlyColors.commentGreen.withValues(alpha: 0.12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _infoBanner!,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: EarthlyColors.commentGreen,
                      ),
                    ),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: () => setState(() => _infoBanner = null),
                    icon: const Icon(Icons.close, size: 15),
                  ),
                ],
              ),
            ),
          if (_error != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              color: EarthlyColors.destructive.withValues(alpha: 0.12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _error!,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11.5,
                        color: EarthlyColors.destructive,
                      ),
                    ),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: () => setState(() => _error = null),
                    icon: const Icon(Icons.close, size: 15),
                  ),
                ],
              ),
            ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                _buildGroupsTab(theme),
                _buildNearbyTab(
                  theme,
                  pendingClaims: pendingClaims,
                  approvedPeers: approvedPeers,
                  remotePeers: remotePeers,
                ),
                _buildNetworkTab(theme),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildGroupsTab(ThemeData theme) {
    return MediaQuery.removePadding(
      context: context,
      removeTop: true,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 24),
        children: [
          // MLS Groups / Circles section
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: EarthlyColors.measureViolet.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: EarthlyColors.measureViolet.withValues(alpha: 0.4),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.lock_outline,
                      size: 16,
                      color: EarthlyColors.measureViolet,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'MLS GROUPS (${widget.circles.length})',
                      style: theme.textTheme.labelSmall?.copyWith(
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w800,
                        color: EarthlyColors.measureViolet,
                      ),
                    ),
                    const Spacer(),
                    if (widget.pendingCircleJoinsCount > 0)
                      EarthlyBadge(
                        label: '${widget.pendingCircleJoinsCount} PENDING',
                        color: EarthlyColors.amber,
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  widget.circles.isEmpty
                      ? 'End-to-end encrypted private maps & chat synced via Cordn (Web & Native compatible).'
                      : 'Tap a group to inspect encrypted maps, chat, invites, or member roles.',
                  style: theme.textTheme.bodySmall,
                ),
                if (widget.circles.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  for (final circle in widget.circles)
                    InkWell(
                      key: Key('spaces-circle-${circle.workspaceId}'),
                      onTap: () => widget.onSelectCircle?.call(circle),
                      borderRadius: BorderRadius.circular(10),
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 5),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          color: widget.activeCircleId == circle.workspaceId
                              ? EarthlyColors.measureViolet
                                  .withValues(alpha: 0.16)
                              : theme.colorScheme.surface,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: widget.activeCircleId == circle.workspaceId
                                ? EarthlyColors.measureViolet
                                : theme.dividerColor,
                            width: widget.activeCircleId == circle.workspaceId
                                ? 1.5
                                : 1.0,
                          ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                circle.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                            Text(
                              '${circle.datasets.length}m · ${circle.members.length}p',
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10.5,
                              ),
                            ),
                            const SizedBox(width: 4),
                            const Icon(Icons.chevron_right, size: 17),
                          ],
                        ),
                      ),
                    ),
                ],
                if (widget.onOpenCircles != null) ...[
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    key: const Key('spaces-open-circles-btn'),
                    onPressed: widget.onOpenCircles,
                    icon: const Icon(Icons.groups_outlined, size: 17),
                    label: const Text('Create or Join MLS Group'),
                  ),
                ],
              ],
            ),
          ),

          if (widget.onOpenInbox != null || widget.onOpenOutbox != null) ...[
            const SizedBox(height: 12),
            Text(
              'ACTIVITY',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
          ],

          if (widget.onOpenInbox != null) ...[
            InkWell(
              key: const Key('spaces-inbox-btn'),
              onTap: widget.onOpenInbox,
              borderRadius: BorderRadius.circular(14),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: widget.inboxUnreadCount > 0
                      ? EarthlyColors.amber.withValues(alpha: 0.14)
                      : theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: widget.inboxUnreadCount > 0
                        ? EarthlyColors.amber.withValues(alpha: 0.55)
                        : theme.dividerColor,
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.inbox_outlined,
                      size: 18,
                      color: EarthlyColors.amber,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'INBOX & NOTIFICATIONS',
                            style: theme.textTheme.labelSmall?.copyWith(
                              fontFamily: 'monospace',
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            widget.inboxUnreadCount > 0
                                ? '${widget.inboxUnreadCount} unread proposal${widget.inboxUnreadCount == 1 ? '' : 's'}, reply or mention'
                                : 'Proposals, replies, mentions & Atlas arrivals',
                            style: theme.textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    if (widget.inboxUnreadCount > 0) ...[
                      EarthlyBadge(
                        label: '${widget.inboxUnreadCount}',
                        color: EarthlyColors.amber,
                      ),
                      const SizedBox(width: 4),
                    ],
                    const Icon(Icons.chevron_right, size: 18),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
          ],

          if (widget.onOpenOutbox != null)
            InkWell(
              key: const Key('spaces-outbox-btn'),
              onTap: widget.onOpenOutbox,
              borderRadius: BorderRadius.circular(14),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: widget.pendingOutboxCount > 0
                      ? EarthlyColors.amber.withValues(alpha: 0.14)
                      : theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: widget.pendingOutboxCount > 0
                        ? EarthlyColors.amber.withValues(alpha: 0.55)
                        : theme.dividerColor,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.outbox_outlined,
                      size: 18,
                      color: widget.pendingOutboxCount > 0
                          ? EarthlyColors.amber
                          : EarthlyColors.commentGreen,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'OUTBOX QUEUE',
                            style: theme.textTheme.labelSmall?.copyWith(
                              fontFamily: 'monospace',
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            widget.pendingOutboxCount > 0
                                ? '${widget.pendingOutboxCount} pending publish${widget.pendingOutboxCount == 1 ? '' : 'es'} waiting for relay'
                                : 'All queued publishes delivered',
                            style: theme.textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    if (widget.pendingOutboxCount > 0) ...[
                      EarthlyBadge(
                        label: '${widget.pendingOutboxCount}',
                        color: EarthlyColors.amber,
                      ),
                      const SizedBox(width: 4),
                    ],
                    const Icon(Icons.chevron_right, size: 18),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildNearbyTab(
    ThemeData theme, {
    required List<PendingClaimDto> pendingClaims,
    required List<ApprovedPeerDto> approvedPeers,
    required List<RemotePeerDto> remotePeers,
  }) {
    final pairingUri = _sessionInvite != null
        ? 'earthly://pair?invitation=$_sessionInvite'
        : null;

    return MediaQuery.removePadding(
      context: context,
      removeTop: true,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 24),
        children: [
          if (pendingClaims.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: EarthlyColors.proposedAmber.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border:
                    Border.all(color: EarthlyColors.proposedAmber, width: 1.5),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'INCOMING PAIRING REQUESTS (${pendingClaims.length})',
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: EarthlyColors.proposedAmber,
                    ),
                  ),
                  const SizedBox(height: 8),
                  for (final claim in pendingClaims)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  claim.peerName ?? 'Nearby Device',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 13,
                                  ),
                                ),
                                Text(
                                  '${claim.peerPubkey.substring(0, claim.peerPubkey.length.clamp(0, 14))}…${claim.sessionName != null ? ' · ${claim.sessionName}' : ''}',
                                  style: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          FilledButton(
                            onPressed: _busy ? null : () => _approveClaim(claim),
                            child: const Text('Approve'),
                          ),
                          const SizedBox(width: 6),
                          IconButton(
                            tooltip: 'Reject',
                            onPressed: _busy ? null : () => _rejectClaim(claim),
                            icon: const Icon(
                              Icons.close,
                              size: 18,
                              color: EarthlyColors.destructive,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 10),
          ],

          // Expandable: Host Field Session
          _buildExpandableCard(
            theme,
            child: ExpansionTile(
              key: const Key('spaces-host-session-tile'),
              initiallyExpanded:
                  _sessionInvite != null || approvedPeers.isNotEmpty,
              shape: const Border(),
              collapsedShape: const Border(),
              tilePadding: const EdgeInsets.symmetric(horizontal: 12),
              childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              leading: const Icon(Icons.qr_code_2, size: 18),
              title: Text(
                'Host Field Session',
                style: theme.textTheme.titleSmall,
              ),
              subtitle: Text(
                _node != null
                    ? 'Active (${_node!.scope ?? "local"}) · ${approvedPeers.length} peer${approvedPeers.length == 1 ? '' : 's'}'
                    : 'Share LAN Wi-Fi, FIPS Mesh, or Loopback QR',
                style: theme.textTheme.bodySmall,
              ),
              children: [
                EarthlySegmentBar<_LocalBindChoice>.single(
                  compact: true,
                  options: const [
                    EarthlySegmentOption<_LocalBindChoice>(
                      value: _LocalBindChoice.lanWifi,
                      label: 'LAN Wi-Fi',
                    ),
                    EarthlySegmentOption<_LocalBindChoice>(
                      value: _LocalBindChoice.fipsMesh,
                      label: 'FIPS Mesh (fd00::)',
                    ),
                    EarthlySegmentOption<_LocalBindChoice>(
                      value: _LocalBindChoice.loopback,
                      label: 'Loopback',
                    ),
                  ],
                  value: _bindChoice,
                  onChanged: (next) => setState(() => _bindChoice = next),
                ),
                if (_bindChoice == _LocalBindChoice.fipsMesh) ...[
                  const SizedBox(height: 8),
                  TextField(
                    controller: _fipsAddressController,
                    decoration: const InputDecoration(
                      hintText: 'FIPS fd00::/8 IPv6 (leave blank to auto-detect)',
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _busy ? null : _hostFieldSession,
                    icon: const Icon(Icons.qr_code_2, size: 18),
                    label: Text(
                      switch (_bindChoice) {
                        _LocalBindChoice.lanWifi =>
                          'Start LAN Node & Show Pairing QR',
                        _LocalBindChoice.fipsMesh =>
                          'Start FIPS Mesh Node & Show Pairing QR',
                        _LocalBindChoice.loopback =>
                          'Start Loopback Node & Show QR',
                      },
                    ),
                  ),
                ),
                if (_node != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Scope: ${_node!.scope ?? "—"}\nRelay: ${_node!.relayUrl ?? "—"}\nBlossom: ${_node!.blossomUrl ?? "—"}',
                    style:
                        const TextStyle(fontFamily: 'monospace', fontSize: 11),
                  ),
                ],
                if (pairingUri != null) ...[
                  const SizedBox(height: 12),
                  Center(child: EarthlyQrCode(data: pairingUri, size: 200)),
                  const SizedBox(height: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      border: Border.all(color: theme.dividerColor),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${pairingUri.substring(0, pairingUri.length.clamp(0, 44))}…',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Copy pairing link',
                          onPressed: () {
                            Clipboard.setData(ClipboardData(text: pairingUri));
                            EarthlyToast.success(
                              context,
                              'Copied Field Session pairing link',
                            );
                          },
                          icon: const Icon(Icons.copy, size: 18),
                        ),
                      ],
                    ),
                  ),
                ],
                if (approvedPeers.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    'APPROVED PEERS (${approvedPeers.length})',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w700,
                      color: EarthlyColors.commentGreen,
                    ),
                  ),
                  const SizedBox(height: 6),
                  for (final peer in approvedPeers)
                    Container(
                      margin: const EdgeInsets.only(bottom: 6),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: EarthlyColors.commentGreen.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color:
                              EarthlyColors.commentGreen.withValues(alpha: 0.6),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.devices,
                            size: 16,
                            color: EarthlyColors.commentGreen,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${peer.peerPubkey.substring(0, peer.peerPubkey.length.clamp(0, 16))}…',
                                  style: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                Text(
                                  peer.sessionIds.isNotEmpty
                                      ? 'Sessions: ${peer.sessionIds.join(", ")}'
                                      : 'Capabilities: ${peer.capabilities.join(", ")}',
                                  style: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 10,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          TextButton(
                            onPressed: _busy
                                ? null
                                : () async {
                                    await revokeNearbyPeer(
                                      peerPubkey: peer.peerPubkey,
                                    );
                                    await _pollPeers();
                                  },
                            child: const Text(
                              'Revoke',
                              style:
                                  TextStyle(color: EarthlyColors.destructive),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ],
            ),
          ),

          const SizedBox(height: 10),

          // Expandable: Join Field Session
          _buildExpandableCard(
            theme,
            child: ExpansionTile(
              key: const Key('spaces-join-session-tile'),
              initiallyExpanded:
                  (widget.initialPairingLink?.isNotEmpty ?? false) ||
                      remotePeers.isNotEmpty,
              shape: const Border(),
              collapsedShape: const Border(),
              tilePadding: const EdgeInsets.symmetric(horizontal: 12),
              childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              leading: const Icon(Icons.qr_code_scanner, size: 18),
              title: Text(
                'Join Field Session',
                style: theme.textTheme.titleSmall,
              ),
              subtitle: Text(
                remotePeers.isNotEmpty
                    ? '${remotePeers.length} joined host${remotePeers.length == 1 ? '' : 's'}'
                    : 'Scan QR or paste pairing link',
                style: theme.textTheme.bodySmall,
              ),
              children: [
                if (Platform.isAndroid) ...[
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _busy ? null : _scanQrAndJoin,
                      icon: const Icon(Icons.qr_code_scanner, size: 18),
                      label: const Text('Scan Pairing QR Code'),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _inviteInputController,
                        decoration: const InputDecoration(
                          hintText: 'Or paste earthly://pair?invitation=…',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      onPressed: _busy ? null : _submitPairingJoin,
                      child: const Text('Join'),
                    ),
                  ],
                ),
                if (remotePeers.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    'JOINED NEARBY HOSTS (${remotePeers.length})',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  for (final remote in remotePeers)
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: (remote.status == 'accepted'
                                ? EarthlyColors.commentGreen
                                : remote.status == 'rejected'
                                    ? EarthlyColors.destructive
                                    : EarthlyColors.proposedAmber)
                            .withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: remote.status == 'accepted'
                              ? EarthlyColors.commentGreen
                              : remote.status == 'rejected'
                                  ? EarthlyColors.destructive
                                  : EarthlyColors.proposedAmber,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                remote.status == 'accepted'
                                    ? '✓ PAIRED & APPROVED'
                                    : remote.status == 'rejected'
                                        ? '✗ REJECTED'
                                        : '⏳ PENDING HOST APPROVAL',
                                style: TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 11,
                                  fontWeight: FontWeight.w800,
                                  color: remote.status == 'accepted'
                                      ? EarthlyColors.commentGreen
                                      : remote.status == 'rejected'
                                          ? EarthlyColors.destructive
                                          : EarthlyColors.proposedAmber,
                                ),
                              ),
                              const Spacer(),
                              if (remote.status == 'accepted')
                                FilledButton.icon(
                                  onPressed:
                                      _busy ? null : () => _syncRemote(remote),
                                  icon: const Icon(Icons.sync, size: 14),
                                  label: const Text('Sync'),
                                ),
                              IconButton(
                                tooltip: 'Disconnect',
                                visualDensity: VisualDensity.compact,
                                onPressed: _busy
                                    ? null
                                    : () async {
                                        await forgetNearbyPeer(
                                          nodeId: remote.nodeId,
                                        );
                                        await _pollPeers();
                                      },
                                icon: const Icon(Icons.close, size: 16),
                              ),
                            ],
                          ),
                          Text(
                            '${remote.sessionName ?? "Field Session"} · ${remote.relayUrl}',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                            ),
                          ),
                          if (remote.rejectionReason != null)
                            Text(
                              remote.rejectionReason!,
                              style: const TextStyle(
                                fontSize: 11,
                                color: EarthlyColors.destructive,
                              ),
                            ),
                        ],
                      ),
                    ),
                ],
              ],
            ),
          ),

          const SizedBox(height: 10),

          // Expandable: Live Beacon
          _buildExpandableCard(
            theme,
            child: ExpansionTile(
              key: const Key('spaces-live-beacon-tile'),
              initiallyExpanded: false,
              shape: const Border(),
              collapsedShape: const Border(),
              tilePadding: const EdgeInsets.symmetric(horizontal: 12),
              childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              leading: const Icon(
                Icons.sensors,
                size: 18,
                color: Color(0xFF0891B2),
              ),
              title: Text(
                'Live Beacon',
                style: theme.textTheme.titleSmall,
              ),
              subtitle: Text(
                'Share temporary location (kind 37521)',
                style: theme.textTheme.bodySmall,
              ),
              children: [
                TextField(
                  controller: _beaconStatusController,
                  decoration: const InputDecoration(
                    hintText: 'Status note (e.g. Surveying north ridge)',
                  ),
                ),
                const SizedBox(height: 8),
                EarthlySegmentBar<int>.single(
                  compact: true,
                  monospace: true,
                  options: [
                    for (final mins in const [15, 60, 240])
                      EarthlySegmentOption<int>(
                        value: mins,
                        label: mins < 60 ? '${mins}m' : '${mins ~/ 60}h',
                      ),
                  ],
                  value: _beaconDurationMinutes,
                  onChanged: (mins) =>
                      setState(() => _beaconDurationMinutes = mins),
                ),
                const SizedBox(height: 6),
                EarthlySegmentBar<bool>.single(
                  compact: true,
                  options: const [
                    EarthlySegmentOption<bool>(
                      value: false,
                      label: 'Public',
                      icon: Icons.public,
                    ),
                    EarthlySegmentOption<bool>(
                      value: true,
                      label: 'Nearby',
                      icon: Icons.wifi_tethering,
                    ),
                  ],
                  value: _beaconNearby,
                  onChanged: (nearby) =>
                      setState(() => _beaconNearby = nearby),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _busy ? null : _broadcastBeacon,
                    icon: const Icon(Icons.sensors, size: 18),
                    label: Text(
                      Platform.isAndroid
                          ? 'Broadcast Live GPS Beacon'
                          : 'Broadcast Map Center Beacon',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNetworkTab(ThemeData theme) {
    final account = widget.account;
    final hasTools = widget.onOpenCashuWallet != null ||
        widget.onOpenMcpBridge != null ||
        widget.onOpenShoutbox != null ||
        widget.onOpenHelp != null;

    return MediaQuery.removePadding(
      context: context,
      removeTop: true,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 24),
        children: [
          // Compact single-row Account summary / sign-in
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: theme.dividerColor),
            ),
            child: account != null
                ? Row(
                    children: [
                      const Icon(
                        Icons.verified_user,
                        size: 18,
                        color: EarthlyColors.commentGreen,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${account.shortLabel} (${widget.localNsec != null ? "Local key" : "Amber"})',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      TextButton(
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                        ),
                        onPressed: () {
                          widget.onAccountChanged(null);
                          widget.onLocalKeyChanged(null);
                        },
                        child: const Text('Sign out'),
                      ),
                    ],
                  )
                : Row(
                    children: [
                      const Icon(Icons.person_outline, size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Not signed in',
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                      if (Platform.isAndroid && _amberInstalled)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: FilledButton(
                            style: FilledButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 6,
                              ),
                            ),
                            onPressed: _busy ? null : _signInWithAmber,
                            child: const Text('Amber'),
                          ),
                        ),
                      OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 6,
                          ),
                        ),
                        onPressed: _busy ? null : _generateLocalKeypair,
                        child: const Text('Local Key'),
                      ),
                    ],
                  ),
          ),

          const SizedBox(height: 14),

          // Nostr Relays section
          Text(
            'NOSTR RELAYS (${widget.relayUrls.length} · PERSISTED)',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          EarthlyActionBar(
            stacked: false,
            items: [
              EarthlyActionBarItem(
                key: const Key('spaces-probe-relays-btn'),
                icon: Icons.network_check,
                label: _probingRelays ? 'Probing…' : 'Check Health',
                loading: _probingRelays,
                onTap: _probingRelays ? null : _probeRelays,
              ),
              if (widget.account != null || widget.onFetchNip65Relays != null)
                EarthlyActionBarItem(
                  key: const Key('spaces-sync-nip65-btn'),
                  icon: Icons.cloud_sync_outlined,
                  label: 'Sync NIP-65',
                  onTap: _syncingNip65 ? null : _syncNip65,
                ),
              if (widget.onPublishNip65Relays != null && widget.account != null)
                EarthlyActionBarItem(
                  key: const Key('spaces-publish-nip65-btn'),
                  icon: Icons.publish,
                  label: 'Publish 10002',
                  onTap: _syncingNip65 ? null : _publishNip65,
                ),
            ],
          ),
          const SizedBox(height: 8),
          for (final url in widget.relayUrls)
            Container(
              margin: const EdgeInsets.only(bottom: 4),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                border: Border.all(color: theme.dividerColor),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      url,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                      ),
                    ),
                  ),
                  if (_relayHealth[url] != null) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: (_relayHealth[url]!.reachable
                                ? EarthlyColors.commentGreen
                                : EarthlyColors.destructive)
                            .withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        _relayHealth[url]!.reachable
                            ? '${_relayHealth[url]!.latencyMs} ms'
                            : 'OFFLINE',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          color: _relayHealth[url]!.reachable
                              ? EarthlyColors.commentGreen
                              : EarthlyColors.destructive,
                        ),
                      ),
                    ),
                  ],
                  if (widget.relayUrls.length > 1)
                    IconButton(
                      tooltip: 'Remove relay',
                      visualDensity: VisualDensity.compact,
                      onPressed: () => _removeRelay(url),
                      icon: const Icon(Icons.close, size: 15),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _relayInputController,
                  onSubmitted: (_) => _addCustomRelay(),
                  decoration: const InputDecoration(
                    hintText: 'Add relay wss://relay.example.org',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: _addCustomRelay,
                child: const Text('Add'),
              ),
            ],
          ),

          // Tools list
          if (hasTools) ...[
            const SizedBox(height: 14),
            Text(
              'TOOLS',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Builder(
              builder: (_) {
                final toolRows = <Widget>[
                  if (widget.onOpenCashuWallet != null)
                    _buildToolRow(
                      theme,
                      key: const Key('spaces-cashu-wallet-btn'),
                      icon: Icons.account_balance_wallet_outlined,
                      title: 'Cashu Ecash Wallet',
                      trailing: widget.cashuWalletEnabled
                          ? (widget.cashuBalanceSats != null
                              ? '${widget.cashuBalanceSats} sats'
                              : 'Enabled (NIP-60)')
                          : 'Disabled (opt-in)',
                      onTap: widget.onOpenCashuWallet!,
                    ),
                  if (widget.onOpenMcpBridge != null)
                    _buildToolRow(
                      theme,
                      key: const Key('spaces-mcp-bridge-btn'),
                      icon: Icons.dns_outlined,
                      title: 'Local MCP Desktop Bridge',
                      trailing: widget.mcpBridgeRunning ? 'Running' : 'Stopped',
                      onTap: widget.onOpenMcpBridge!,
                    ),
                  if (widget.onOpenShoutbox != null)
                    _buildToolRow(
                      theme,
                      key: const Key('spaces-shoutbox-btn'),
                      icon: Icons.campaign_outlined,
                      title: 'Community Shoutbox',
                      onTap: widget.onOpenShoutbox!,
                    ),
                  if (widget.onOpenHelp != null)
                    _buildToolRow(
                      theme,
                      key: const Key('spaces-help-btn'),
                      icon: Icons.help_outline,
                      title: 'Help & Keyboard Shortcuts',
                      onTap: widget.onOpenHelp!,
                    ),
                ];
                return Container(
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: theme.dividerColor),
                  ),
                  child: Column(
                    children: [
                      for (var i = 0; i < toolRows.length; i++) ...[
                        if (i > 0) const Divider(height: 1, indent: 40),
                        toolRows[i],
                      ],
                    ],
                  ),
                );
              },
            ),
          ],

          const SizedBox(height: 12),

          // Collapsed-by-default Diagnostics ExpansionTile
          _buildExpandableCard(
            theme,
            child: ExpansionTile(
              key: const Key('spaces-diagnostics-tile'),
              initiallyExpanded: false,
              shape: const Border(),
              collapsedShape: const Border(),
              tilePadding: const EdgeInsets.symmetric(horizontal: 12),
              childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              leading: const Icon(Icons.hub_outlined, size: 18),
              title: Text('Diagnostics', style: theme.textTheme.titleSmall),
              children: [
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () {
                      showModalBottomSheet<void>(
                        context: context,
                        builder: (_) => const RustNodeSheet(),
                      );
                    },
                    icon: const Icon(Icons.hub_outlined, size: 18),
                    label: const Text('Open Rust Core & Outbox Diagnostics'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildToolRow(
    ThemeData theme, {
    required Key key,
    required IconData icon,
    required String title,
    String? trailing,
    required VoidCallback onTap,
  }) {
    return InkWell(
      key: key,
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Icon(icon, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                title,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            if (trailing != null) ...[
              Text(
                trailing,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontFamily: 'monospace',
                  fontSize: 11,
                ),
              ),
              const SizedBox(width: 4),
            ],
            const Icon(Icons.chevron_right, size: 17),
          ],
        ),
      ),
    );
  }
}
