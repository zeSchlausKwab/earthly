import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import '../nostr/nip55_signer.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../spike/rust_node_sheet.dart';
import '../src/rust/api/publish.dart';
import '../src/rust/api/spike.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';
import 'qr_code_view.dart';

/// Spaces drawer: Identity (Android NIP-55 Amber OR Desktop/Local keypair) +
/// Nearby Field Sessions (LAN Wi-Fi hosting with QR code, live Pending Claims &
/// Approved Peers list, Android ZXing QR scanner, and NIP-42 peer sync).
class SpacesSheet extends StatefulWidget {
  const SpacesSheet({
    required this.account,
    required this.localNsec,
    required this.onAccountChanged,
    required this.onLocalKeyChanged,
    required this.onSessionStateChanged,
    required this.onNearbySynced,
    required this.onBroadcastBeacon,
    required this.onClose,
    super.key,
  });

  final Nip55Account? account;
  final String? localNsec;
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
  final VoidCallback onClose;

  @override
  State<SpacesSheet> createState() => _SpacesSheetState();
}

class _SpacesSheetState extends State<SpacesSheet> {
  final _inviteInputController = TextEditingController();
  final _beaconStatusController = TextEditingController();
  Timer? _pollTimer;

  bool _amberInstalled = false;
  bool _busy = false;
  bool _bindLan = true;
  int _beaconDurationMinutes = 60;
  bool _beaconNearby = false;
  String? _error;
  String? _infoBanner;
  LocalNodeSnapshot? _node;
  String? _hostedSessionId;
  String? _sessionInvite;
  NearbyPeersSnapshot? _peers;

  @override
  void initState() {
    super.initState();
    _checkEnvironment();
    _pollTimer = Timer.periodic(
      const Duration(seconds: 2),
      (_) => unawaited(_pollPeers()),
    );
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _inviteInputController.dispose();
    _beaconStatusController.dispose();
    super.dispose();
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
          _bindLan = status.scope == 'local-network';
        });
      }
      await _pollPeers();
    } catch (_) {}
  }

  Future<void> _pollPeers() async {
    try {
      await RustBridge.ensureInitialized();
      final snap = await nearbyPeersStatus();
      // Auto-refresh any pending remote peer to detect host approval promptly.
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
      final node = _bindLan
          ? await startLocalNodeLan(dataDir: dataDir)
          : await startLocalNode(dataDir: dataDir);
      final sessionId = 'field-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
      final invite = await createFieldSessionInvite(
        sessionId: sessionId,
        sessionName: _bindLan ? 'LAN Field Survey' : 'Local Field Survey',
        description: _bindLan
            ? 'Nearby Wi-Fi Field Session hosted on this device'
            : 'Loopback Field Session on this device',
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final account = widget.account;
    final pairingUri = _sessionInvite != null
        ? 'earthly://pair?invitation=$_sessionInvite'
        : null;
    final pendingClaims = _peers?.pendingClaims ?? const <PendingClaimDto>[];
    final approvedPeers = _peers?.approvedPeers ?? const <ApprovedPeerDto>[];
    final remotePeers = _peers?.remotePeers ?? const <RemotePeerDto>[];

    return EarthlyMapDrawer(
      initialFraction: 0.56,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            Text(
              'SPACES · ACCOUNT & NEARBY',
              style: theme.textTheme.labelLarge?.copyWith(
                fontFamily: 'monospace',
                letterSpacing: 0.7,
              ),
            ),
            const Spacer(),
            IconButton(
              tooltip: 'Refresh peers',
              visualDensity: VisualDensity.compact,
              onPressed: () => unawaited(_pollPeers()),
              icon: const Icon(Icons.refresh, size: 18),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: widget.onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          if (_infoBanner != null) ...[
            Container(
              padding: const EdgeInsets.all(10),
              color: EarthlyColors.commentGreen.withValues(alpha: 0.12),
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
            const SizedBox(height: 10),
          ],

          // Pending incoming pairing claims (Host approval prompt!)
          if (pendingClaims.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: EarthlyColors.proposedAmber.withValues(alpha: 0.12),
                border: Border.all(color: EarthlyColors.proposedAmber, width: 1.5),
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
                                  '${claim.peerPubkey.substring(0, 14)}…${claim.sessionName != null ? ' · ${claim.sessionName}' : ''}',
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
            const SizedBox(height: 14),
          ],

          // Identity section
          Text(
            Platform.isAndroid
                ? 'IDENTITY (NIP-55 / LOCAL)'
                : 'IDENTITY (DESKTOP KEY)',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          if (account != null)
            Row(
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
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                TextButton(
                  onPressed: () {
                    widget.onAccountChanged(null);
                    widget.onLocalKeyChanged(null);
                  },
                  child: const Text('Sign out'),
                ),
              ],
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (Platform.isAndroid)
                  FilledButton.icon(
                    onPressed:
                        (_busy || !_amberInstalled) ? null : _signInWithAmber,
                    icon: const Icon(Icons.key, size: 18),
                    label: Text(
                      _amberInstalled
                          ? 'Sign in with Amber (NIP-55)'
                          : 'Amber signer not detected',
                    ),
                  ),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _generateLocalKeypair,
                  icon: const Icon(Icons.vpn_key_outlined, size: 16),
                  label: const Text('Create Local Session Key'),
                ),
              ],
            ),

          const Divider(height: 22),

          // Live Beacon broadcaster (kind 37521, NIP-40 expiration)
          Text(
            'LIVE BEACON (KIND 37521)',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
              color: const Color(0xFF0891B2),
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: _beaconStatusController,
            decoration: const InputDecoration(
              isDense: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.zero),
              hintText: 'Status note (e.g. Surveying north ridge)',
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final mins in const [15, 60, 240])
                ChoiceChip(
                  label: Text(mins < 60 ? '${mins}m' : '${mins ~/ 60}h'),
                  selected: _beaconDurationMinutes == mins,
                  onSelected: (_) =>
                      setState(() => _beaconDurationMinutes = mins),
                ),
              ChoiceChip(
                label: const Text('Public'),
                selected: !_beaconNearby,
                onSelected: (_) => setState(() => _beaconNearby = false),
              ),
              ChoiceChip(
                label: const Text('Nearby'),
                selected: _beaconNearby,
                onSelected: (_) => setState(() => _beaconNearby = true),
              ),
            ],
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: _busy ? null : _broadcastBeacon,
            icon: const Icon(Icons.sensors, size: 18),
            label: Text(
              Platform.isAndroid
                  ? 'Broadcast Live GPS Beacon'
                  : 'Broadcast Map Center Beacon',
            ),
          ),

          const Divider(height: 22),

          // Host Nearby Field Session with scannable QR code
          Text(
            'HOST NEARBY FIELD SESSION',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            children: [
              ChoiceChip(
                label: const Text('LAN Wi-Fi (Nearby Peers)'),
                selected: _bindLan,
                onSelected: (_) => setState(() => _bindLan = true),
              ),
              ChoiceChip(
                label: const Text('Loopback Only'),
                selected: !_bindLan,
                onSelected: (_) => setState(() => _bindLan = false),
              ),
            ],
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: _busy ? null : _hostFieldSession,
            icon: const Icon(Icons.qr_code_2, size: 18),
            label: Text(
              _bindLan
                  ? 'Start LAN Node & Show Pairing QR'
                  : 'Start Loopback Node & Show QR',
            ),
          ),
          if (_node != null) ...[
            const SizedBox(height: 8),
            Text(
              'Scope: ${_node!.scope ?? "—"}\nRelay: ${_node!.relayUrl ?? "—"}\nBlossom: ${_node!.blossomUrl ?? "—"}',
              style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
            ),
          ],
          if (pairingUri != null) ...[
            const SizedBox(height: 12),
            Center(child: EarthlyQrCode(data: pairingUri, size: 210)),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                border: Border.all(color: theme.dividerColor),
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
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Copied Field Session pairing link'),
                        ),
                      );
                    },
                    icon: const Icon(Icons.copy, size: 18),
                  ),
                ],
              ),
            ),
          ],

          // Approved Peers connected to this host
          if (approvedPeers.isNotEmpty) ...[
            const SizedBox(height: 14),
            Text(
              'APPROVED PEERS ON THIS HOST (${approvedPeers.length})',
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
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: EarthlyColors.commentGreen.withValues(alpha: 0.08),
                  border: Border.all(
                    color: EarthlyColors.commentGreen.withValues(alpha: 0.6),
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
                            '${peer.peerPubkey.substring(0, 16)}…',
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
                        style: TextStyle(color: EarthlyColors.destructive),
                      ),
                    ),
                  ],
                ),
              ),
          ],

          const Divider(height: 22),

          // Join Nearby Field Session
          Text(
            'JOIN NEARBY FIELD SESSION',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
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
                    isDense: true,
                    border: OutlineInputBorder(borderRadius: BorderRadius.zero),
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

          // Joined Remote Peers
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
                            onPressed: _busy ? null : () => _syncRemote(remote),
                            icon: const Icon(Icons.sync, size: 14),
                            label: const Text('Sync'),
                          ),
                        IconButton(
                          tooltip: 'Disconnect',
                          visualDensity: VisualDensity.compact,
                          onPressed: _busy
                              ? null
                              : () async {
                                  await forgetNearbyPeer(nodeId: remote.nodeId);
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

          const Divider(height: 22),

          OutlinedButton.icon(
            onPressed: () {
              showModalBottomSheet<void>(
                context: context,
                shape: const RoundedRectangleBorder(
                  borderRadius: BorderRadius.zero,
                ),
                builder: (_) => const RustNodeSheet(),
              );
            },
            icon: const Icon(Icons.hub_outlined, size: 18),
            label: const Text('Open Rust Core & Outbox Diagnostics'),
          ),

          if (_error != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              color: EarthlyColors.destructive.withValues(alpha: 0.12),
              child: Text(
                _error!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: EarthlyColors.destructive,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
