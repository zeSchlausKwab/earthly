import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/nip55_signer.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/private_groups.dart';
import '../theme/earthly_theme.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';
import 'qr_code_view.dart';

const _prodCordnPubkey =
    'fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37';
const _devCordnPubkey =
    '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

String _shortHex(String value) {
  if (value.length <= 16) return value;
  return '${value.substring(0, 8)}…${value.substring(value.length - 6)}';
}

String _formatRelativeSecs(int unixSecs) {
  final dt = DateTime.fromMillisecondsSinceEpoch(unixSecs * 1000);
  final diff = DateTime.now().difference(dt);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inHours < 1) return '${diff.inMinutes}m ago';
  if (diff.inDays < 1) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
}

/// Native Earthly Circles (MLS RFC 9420 + Cordn ContextVM) drawer with full
/// Web feature parity: create Circle, signed 24h invite links & QR codes,
/// join request + admin approval with current-map checkpoint replay,
/// encrypted Chat/Comments with GeoJSON attachments, encrypted Map projection
/// into the live MapLibre stack, and member/administrator governance.
class CirclesSheet extends StatefulWidget {
  const CirclesSheet({
    required this.account,
    required this.localNsec,
    required this.bunkerUri,
    required this.bunkerClientNsec,
    required this.mlsDatabasePath,
    required this.cordnServerPubkey,
    required this.relayUrls,
    required this.workspaces,
    required this.pendingJoins,
    required this.activeCircleId,
    required this.mountedCircleDatasetKeys,
    required this.activeCommentOverlayId,
    required this.hasDraftGeometry,
    required this.profilesByPubkey,
    required this.onCordnPubkeyChanged,
    required this.onRefreshCircles,
    required this.onWorkspaceUpdated,
    required this.onEnterCircleLens,
    required this.onLeaveCircleLens,
    required this.onToggleDatasetOnMap,
    required this.onZoomToDataset,
    required this.onEditDatasetInDraft,
    required this.onStartNewPrivateMap,
    required this.onToggleCommentGeometry,
    required this.onSendCircleComment,
    required this.onOpenAccount,
    required this.onClose,
    this.initialWorkspaceId,
    this.initialInviteLink,
    super.key,
  });

  final Nip55Account? account;
  final String? localNsec;
  final String? bunkerUri;
  final String? bunkerClientNsec;
  final String mlsDatabasePath;
  final String cordnServerPubkey;
  final List<String> relayUrls;
  final List<CircleWorkspaceDto> workspaces;
  final List<CirclePendingJoinDto> pendingJoins;
  final String? activeCircleId;
  final Set<String> mountedCircleDatasetKeys;
  final String? activeCommentOverlayId;
  final bool hasDraftGeometry;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final ValueChanged<String> onCordnPubkeyChanged;
  final Future<void> Function() onRefreshCircles;
  final ValueChanged<CircleWorkspaceDto> onWorkspaceUpdated;
  final ValueChanged<CircleWorkspaceDto> onEnterCircleLens;
  final VoidCallback onLeaveCircleLens;
  final void Function(CircleWorkspaceDto ws, CircleDatasetDto dataset)
      onToggleDatasetOnMap;
  final void Function(CircleWorkspaceDto ws, CircleDatasetDto dataset)
      onZoomToDataset;
  final void Function(CircleWorkspaceDto ws, CircleDatasetDto dataset)
      onEditDatasetInDraft;
  final ValueChanged<CircleWorkspaceDto> onStartNewPrivateMap;
  final ValueChanged<CircleMessageDto> onToggleCommentGeometry;
  final Future<CircleWorkspaceDto> Function(
    String workspaceId,
    String text,
    bool attachDraft,
  ) onSendCircleComment;
  final VoidCallback onOpenAccount;
  final VoidCallback onClose;
  final String? initialWorkspaceId;
  final String? initialInviteLink;

  @override
  State<CirclesSheet> createState() => _CirclesSheetState();
}

class _CirclesSheetState extends State<CirclesSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _detailTabs = TabController(length: 3, vsync: this);
  final _nameController = TextEditingController();
  final _descController = TextEditingController();
  final _basemapController = TextEditingController(
    text: 'OpenFreeMap Liberty / Local PMTiles',
  );
  final _inviteInputController = TextEditingController();
  final _cordnInputController = TextEditingController();
  final _chatInputController = TextEditingController();

  String? _selectedWorkspaceId;
  bool _showCreateForm = false;
  bool _showCoordinatorConfig = false;
  bool _attachDraftGeometry = false;
  bool _busy = false;
  String? _busyLabel;
  String? _error;
  String? _info;
  String? _generatedInviteUrl;
  String? _generatedInviteWorkspaceId;
  List<CircleJoinRequestDto> _joinRequests = const [];
  bool _joinRequestsChecked = false;
  DecodedCircleInviteDto? _decodedInvitePreview;
  Timer? _syncTimer;

  bool get _hasSupportedSigner =>
      (widget.localNsec != null && widget.localNsec!.isNotEmpty) ||
      (widget.bunkerUri != null &&
          widget.bunkerUri!.isNotEmpty &&
          widget.bunkerClientNsec != null &&
          widget.bunkerClientNsec!.isNotEmpty);

  CircleWorkspaceDto? get _selectedWorkspace {
    final id = _selectedWorkspaceId;
    if (id == null) return null;
    for (final w in widget.workspaces) {
      if (w.workspaceId == id) return w;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    _selectedWorkspaceId = widget.initialWorkspaceId;
    _cordnInputController.text = widget.cordnServerPubkey;
    if (widget.initialInviteLink != null &&
        widget.initialInviteLink!.trim().isNotEmpty) {
      _inviteInputController.text = widget.initialInviteLink!.trim();
      unawaited(_previewInvite(widget.initialInviteLink!.trim()));
    }
    _syncTimer = Timer.periodic(
      const Duration(seconds: 6),
      (_) => unawaited(_backgroundSyncSelected()),
    );
  }

  @override
  void didUpdateWidget(covariant CirclesSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.cordnServerPubkey != widget.cordnServerPubkey &&
        _cordnInputController.text != widget.cordnServerPubkey) {
      _cordnInputController.text = widget.cordnServerPubkey;
    }
    if (widget.initialInviteLink != null &&
        widget.initialInviteLink != oldWidget.initialInviteLink &&
        widget.initialInviteLink!.trim().isNotEmpty) {
      _inviteInputController.text = widget.initialInviteLink!.trim();
      unawaited(_previewInvite(widget.initialInviteLink!.trim()));
    }
  }

  @override
  void dispose() {
    _syncTimer?.cancel();
    _detailTabs.dispose();
    _nameController.dispose();
    _descController.dispose();
    _basemapController.dispose();
    _inviteInputController.dispose();
    _cordnInputController.dispose();
    _chatInputController.dispose();
    super.dispose();
  }

  String _authorLabel(String pubkey) {
    final p = widget.profilesByPubkey[pubkey];
    final name = p?.displayName ?? p?.name;
    if (name != null && name.isNotEmpty) return name;
    return _shortHex(pubkey);
  }

  Future<void> _backgroundSyncSelected() async {
    final ws = _selectedWorkspace;
    if (ws == null || _busy || !_hasSupportedSigner || ws.status != 'active') {
      return;
    }
    try {
      await RustBridge.ensureInitialized();
      final updated = await syncCircleWorkspace(
        databasePath: widget.mlsDatabasePath,
        signerNsec: widget.localNsec,
        bunkerUri: widget.bunkerUri,
        bunkerClientNsec: widget.bunkerClientNsec,
        workspaceId: ws.workspaceId,
      );
      if (mounted) widget.onWorkspaceUpdated(updated);
    } catch (_) {}
  }

  Future<void> _runAction(String label, Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _busyLabel = label;
      _error = null;
      _info = null;
    });
    try {
      await RustBridge.ensureInitialized();
      await action();
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyLabel = null;
        });
      }
    }
  }

  Future<void> _previewInvite(String raw) async {
    try {
      await RustBridge.ensureInitialized();
      final decoded = await decodeCircleInviteLink(rawLink: raw);
      if (!mounted) return;
      setState(() {
        _decodedInvitePreview = decoded;
        _error = null;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _decodedInvitePreview = null;
        _error = err.toString();
      });
    }
  }

  Future<void> _createCircle() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) return;
    await _runAction('Creating Circle…', () async {
      final created = await createCircleWorkspace(
        databasePath: widget.mlsDatabasePath,
        signerNsec: widget.localNsec,
        bunkerUri: widget.bunkerUri,
        bunkerClientNsec: widget.bunkerClientNsec,
        coordinatorPubkey: widget.cordnServerPubkey,
        relays: widget.relayUrls,
        name: name,
        description:
            _descController.text.trim().isEmpty ? null : _descController.text.trim(),
        recommendedBasemap: _basemapController.text.trim().isEmpty
            ? null
            : _basemapController.text.trim(),
      );
      _nameController.clear();
      _descController.clear();
      widget.onWorkspaceUpdated(created);
      await widget.onRefreshCircles();
      if (!mounted) return;
      setState(() {
        _showCreateForm = false;
        _selectedWorkspaceId = created.workspaceId;
        _info = 'Created MLS Circle "${created.name}" locally (epoch 0).';
      });
    });
  }

  Future<void> _scanInviteQr() async {
    await _runAction('Scanning QR…', () async {
      final scanned = await DeviceBridge.scanQrCode();
      if (!mounted) return;
      _inviteInputController.text = scanned.trim();
      await _previewInvite(scanned.trim());
    });
  }

  Future<void> _requestJoin() async {
    final raw = _inviteInputController.text.trim();
    if (raw.isEmpty) return;
    await _runAction('Publishing KeyPackage & requesting access…', () async {
      await requestJoinCircle(
        databasePath: widget.mlsDatabasePath,
        signerNsec: widget.localNsec,
        bunkerUri: widget.bunkerUri,
        bunkerClientNsec: widget.bunkerClientNsec,
        rawInvitation: raw,
      );
      await widget.onRefreshCircles();
      if (!mounted) return;
      _inviteInputController.clear();
      setState(() {
        _decodedInvitePreview = null;
        _info =
            'MLS last-resort KeyPackage published & join request sent! Ask an admin to approve, then tap Check Approval.';
      });
    });
  }

  Future<void> _checkApprovals() async {
    await _runAction('Checking Cordn for approved Welcomes…', () async {
      final joined = await acceptCircleWelcomes(
        databasePath: widget.mlsDatabasePath,
        signerNsec: widget.localNsec,
        bunkerUri: widget.bunkerUri,
        bunkerClientNsec: widget.bunkerClientNsec,
      );
      await widget.onRefreshCircles();
      if (!mounted) return;
      if (joined.isNotEmpty) {
        widget.onWorkspaceUpdated(joined.first);
        setState(() {
          _selectedWorkspaceId = joined.first.workspaceId;
          _info =
              'Joined ${joined.length} Circle${joined.length == 1 ? '' : 's'} and decrypted checkpoint!';
        });
      } else {
        setState(() => _info = 'No approved Welcomes yet from Cordn.');
      }
    });
  }

  Future<void> _syncSelected() async {
    final ws = _selectedWorkspace;
    if (ws == null) return;
    await _runAction('Syncing encrypted records…', () async {
      final updated = await syncCircleWorkspace(
        databasePath: widget.mlsDatabasePath,
        signerNsec: widget.localNsec,
        bunkerUri: widget.bunkerUri,
        bunkerClientNsec: widget.bunkerClientNsec,
        workspaceId: ws.workspaceId,
      );
      widget.onWorkspaceUpdated(updated);
      if (mounted) {
        setState(
          () => _info = 'Circle current · cursor ${updated.cursor} · epoch ${updated.epoch}',
        );
      }
    });
  }

  Future<void> _generateInvite({required bool copyImmediately}) async {
    final ws = _selectedWorkspace;
    if (ws == null) return;
    await _runAction('Signing 24h invitation…', () async {
      final url = await createCircleInviteUrl(
        databasePath: widget.mlsDatabasePath,
        signerNsec: widget.localNsec,
        bunkerUri: widget.bunkerUri,
        bunkerClientNsec: widget.bunkerClientNsec,
        workspaceId: ws.workspaceId,
      );
      if (copyImmediately) {
        await Clipboard.setData(ClipboardData(text: url));
      }
      if (!mounted) return;
      setState(() {
        _generatedInviteUrl = url;
        _generatedInviteWorkspaceId = ws.workspaceId;
        _info = copyImmediately
            ? 'Copied signed 24-hour Circle invitation link (Web & Native compatible)!'
            : 'Generated signed 24-hour Circle QR invitation.';
      });
    });
  }

  Future<void> _checkJoinRequests() async {
    final ws = _selectedWorkspace;
    if (ws == null) return;
    await _runAction('Checking pending join requests…', () async {
      final list = await fetchCircleJoinRequests(
        databasePath: widget.mlsDatabasePath,
        signerNsec: widget.localNsec,
        bunkerUri: widget.bunkerUri,
        bunkerClientNsec: widget.bunkerClientNsec,
        workspaceId: ws.workspaceId,
      );
      if (!mounted) return;
      setState(() {
        _joinRequests = list;
        _joinRequestsChecked = true;
        _info = list.isEmpty
            ? 'No pending join requests on Cordn.'
            : '${list.length} pending join request${list.length == 1 ? '' : 's'} found.';
      });
    });
  }

  Future<void> _approveRequest(CircleJoinRequestDto req) async {
    await _runAction('Approving member & sealing checkpoint…', () async {
      final updated = await approveCircleJoinRequest(
        databasePath: widget.mlsDatabasePath,
        signerNsec: widget.localNsec,
        bunkerUri: widget.bunkerUri,
        bunkerClientNsec: widget.bunkerClientNsec,
        workspaceId: req.workspaceId,
        pk: req.pk,
        kpRef: req.kpRef,
        at: req.at,
      );
      widget.onWorkspaceUpdated(updated);
      if (!mounted) return;
      setState(() {
        _joinRequests =
            _joinRequests.where((r) => r.kpRef != req.kpRef).toList();
        _info = 'Member added (epoch ${updated.epoch}) & Welcome stored on Cordn!';
      });
    });
  }

  Future<void> _sendMessage() async {
    final ws = _selectedWorkspace;
    if (ws == null) return;
    final text = _chatInputController.text.trim();
    if (text.isEmpty && !(_attachDraftGeometry && widget.hasDraftGeometry)) {
      return;
    }
    await _runAction('Encrypting & posting to Cordn…', () async {
      final updated = await widget.onSendCircleComment(
        ws.workspaceId,
        text,
        _attachDraftGeometry && widget.hasDraftGeometry,
      );
      _chatInputController.clear();
      widget.onWorkspaceUpdated(updated);
      if (mounted) {
        setState(() => _attachDraftGeometry = false);
      }
    });
  }

  Future<void> _toggleAdmin(CircleWorkspaceDto ws, String memberPk, bool promote) async {
    await _runAction(
      promote ? 'Promoting administrator…' : 'Demoting administrator…',
      () async {
        final updated = await setCircleAdministrator(
          databasePath: widget.mlsDatabasePath,
          signerNsec: widget.localNsec,
          bunkerUri: widget.bunkerUri,
          bunkerClientNsec: widget.bunkerClientNsec,
          workspaceId: ws.workspaceId,
          memberPubkey: memberPk,
          administrator: promote,
        );
        widget.onWorkspaceUpdated(updated);
        if (mounted) {
          setState(
            () => _info = promote
                ? 'Promoted ${_authorLabel(memberPk)} to administrator.'
                : 'Demoted ${_authorLabel(memberPk)}.',
          );
        }
      },
    );
  }

  Future<void> _removeMember(CircleWorkspaceDto ws, String memberPk) async {
    await _runAction('Removing member & advancing MLS epoch…', () async {
      final updated = await removeCircleMember(
        databasePath: widget.mlsDatabasePath,
        signerNsec: widget.localNsec,
        bunkerUri: widget.bunkerUri,
        bunkerClientNsec: widget.bunkerClientNsec,
        workspaceId: ws.workspaceId,
        memberPubkey: memberPk,
      );
      widget.onWorkspaceUpdated(updated);
      if (mounted) {
        setState(
          () => _info =
              'Removed ${_authorLabel(memberPk)} (epoch ${updated.epoch} protects future records).',
        );
      }
    });
  }

  Future<void> _confirmDeleteWorkspace(CircleWorkspaceDto ws) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Delete "${ws.name}"?'),
        content: const Text(
          'Removes this device\'s local MLS state and encrypted records. It cannot erase copies held by other members or Cordn.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: EarthlyColors.destructive,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete Local Copy'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _runAction('Deleting Circle…', () async {
      await deleteCircleWorkspace(
        databasePath: widget.mlsDatabasePath,
        ownerPubkeyHex: widget.account!.pubkey,
        workspaceId: ws.workspaceId,
      );
      if (widget.activeCircleId == ws.workspaceId) {
        widget.onLeaveCircleLens();
      }
      await widget.onRefreshCircles();
      if (!mounted) return;
      setState(() {
        _selectedWorkspaceId = null;
        _info = 'Deleted "${ws.name}" from this device.';
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final selected = _selectedWorkspace;

    return EarthlyMapDrawer(
      initialFraction: 0.62,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: selected != null
          ? _buildDetailHeader(theme, selected)
          : _buildListHeader(theme),
      body: !_hasSupportedSigner
          ? _buildNoSignerBody(theme)
          : selected != null
              ? _buildDetailBody(theme, selected)
              : _buildListBody(theme),
    );
  }

  Widget _buildListHeader(ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
      child: Row(
        children: [
          const Icon(
            Icons.lock_outline,
            size: 17,
            color: EarthlyColors.measureViolet,
          ),
          const SizedBox(width: 8),
          Text(
            'CIRCLES · MLS / CORDN',
            style: theme.textTheme.labelLarge?.copyWith(
              fontFamily: 'monospace',
              letterSpacing: 0.7,
            ),
          ),
          const Spacer(),
          IconButton(
            tooltip: 'Cordn Coordinator settings',
            visualDensity: VisualDensity.compact,
            onPressed: () =>
                setState(() => _showCoordinatorConfig = !_showCoordinatorConfig),
            icon: Icon(
              Icons.tune,
              size: 18,
              color: _showCoordinatorConfig ? theme.colorScheme.primary : null,
            ),
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            onPressed: widget.onClose,
            icon: const Icon(Icons.close, size: 18),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailHeader(ThemeData theme, CircleWorkspaceDto ws) {
    final isLens = widget.activeCircleId == ws.workspaceId;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 4),
          child: Row(
            children: [
              IconButton(
                tooltip: 'Back to Circles',
                visualDensity: VisualDensity.compact,
                onPressed: () => setState(() {
                  _selectedWorkspaceId = null;
                  _joinRequests = const [];
                  _joinRequestsChecked = false;
                }),
                icon: const Icon(Icons.arrow_back, size: 18),
              ),
              const Icon(
                Icons.lock,
                size: 15,
                color: EarthlyColors.measureViolet,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  ws.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              EarthlyBadge(
                label: ws.status.toUpperCase(),
                color: ws.status == 'active'
                    ? EarthlyColors.commentGreen
                    : EarthlyColors.destructive,
              ),
              const SizedBox(width: 4),
              IconButton(
                tooltip: isLens ? 'Leave Circle Lens' : 'Enter Circle Lens',
                visualDensity: VisualDensity.compact,
                onPressed: () {
                  if (isLens) {
                    widget.onLeaveCircleLens();
                  } else {
                    widget.onEnterCircleLens(ws);
                  }
                },
                icon: Icon(
                  isLens ? Icons.layers : Icons.layers_outlined,
                  size: 19,
                  color: isLens ? EarthlyColors.measureViolet : null,
                ),
              ),
              IconButton(
                tooltip: 'Sync Circle with Cordn',
                visualDensity: VisualDensity.compact,
                onPressed: _busy ? null : _syncSelected,
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
        TabBar(
          controller: _detailTabs,
          labelStyle: const TextStyle(
            fontFamily: 'monospace',
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
          tabs: [
            Tab(text: 'Chat (${ws.messages.length})'),
            Tab(text: 'Maps (${ws.datasets.length})'),
            Tab(
              text: _joinRequests.isNotEmpty
                  ? 'Settings (${_joinRequests.length})'
                  : 'Settings',
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildNoSignerBody(ThemeData theme) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Icon(
          Icons.lock_person_outlined,
          size: 40,
          color: EarthlyColors.measureViolet,
        ),
        const SizedBox(height: 12),
        Text(
          'MLS Private Circles',
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(
          'Sign in with a persisted Local Key or a NIP-46 Remote Bunker to create or join MLS-encrypted Cordn Circles (100% compatible with Earthly Web).',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: widget.onOpenAccount,
          icon: const Icon(Icons.account_circle_outlined, size: 18),
          label: const Text('Open Account & Sign In'),
        ),
      ],
    );
  }

  Widget _buildStatusBanners() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_busy) ...[
          const LinearProgressIndicator(minHeight: 2),
          if (_busyLabel != null)
            Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 6),
              child: Text(
                _busyLabel!,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
            ),
        ],
        if (_info != null)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: EarthlyColors.commentGreen.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(11),
              border: Border.all(
                color: EarthlyColors.commentGreen.withValues(alpha: 0.4),
              ),
            ),
            child: Text(
              _info!,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: EarthlyColors.commentGreen,
              ),
            ),
          ),
        if (_error != null)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: EarthlyColors.destructive.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(11),
              border: Border.all(
                color: EarthlyColors.destructive.withValues(alpha: 0.4),
              ),
            ),
            child: Text(
              _error!,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 11,
                color: EarthlyColors.destructive,
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildListBody(ThemeData theme) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
      children: [
        _buildStatusBanners(),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: EarthlyColors.measureViolet.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(11),
            border: Border.all(
              color: EarthlyColors.measureViolet.withValues(alpha: 0.35),
            ),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.verified_user_outlined,
                size: 16,
                color: EarthlyColors.measureViolet,
              ),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'RFC 9420 MLS encrypts maps & comments before Cordn stores them. Interoperable with earthly.city Web Circles.',
                  style: TextStyle(fontSize: 11.5, height: 1.35),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),

        if (_showCoordinatorConfig) ...[
          Container(
            padding: const EdgeInsets.all(12),
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: theme.dividerColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'CORDN COORDINATOR PUBKEY',
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: _cordnInputController,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
                  decoration: const InputDecoration(
                    hintText: '64-char hex Cordn coordinator pubkey',
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    ActionChip(
                      label: const Text('earthly.city Prod'),
                      onPressed: () {
                        _cordnInputController.text = _prodCordnPubkey;
                        widget.onCordnPubkeyChanged(_prodCordnPubkey);
                        setState(() => _info = 'Using production Cordn coordinator');
                      },
                    ),
                    ActionChip(
                      label: const Text('Local Dev Cordn'),
                      onPressed: () {
                        _cordnInputController.text = _devCordnPubkey;
                        widget.onCordnPubkeyChanged(_devCordnPubkey);
                        setState(() => _info = 'Using local dev Cordn coordinator');
                      },
                    ),
                    FilledButton(
                      onPressed: () {
                        final val = _cordnInputController.text.trim().toLowerCase();
                        if (val.length == 64) {
                          widget.onCordnPubkeyChanged(val);
                          setState(() {
                            _showCoordinatorConfig = false;
                            _info = 'Saved custom Cordn coordinator pubkey.';
                          });
                        } else {
                          setState(
                            () => _error = 'Coordinator pubkey must be 64 hex chars',
                          );
                        }
                      },
                      child: const Text('Save'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],

        // Actions: Create Circle + Join Invite
        Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: () =>
                    setState(() => _showCreateForm = !_showCreateForm),
                icon: Icon(_showCreateForm ? Icons.close : Icons.add, size: 16),
                label: Text(_showCreateForm ? 'Cancel' : 'New Circle'),
              ),
            ),
            if (Platform.isAndroid) ...[
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: _busy ? null : _scanInviteQr,
                icon: const Icon(Icons.qr_code_scanner, size: 16),
                label: const Text('Scan QR'),
              ),
            ],
          ],
        ),

        if (_showCreateForm) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: theme.dividerColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _nameController,
                  decoration: const InputDecoration(
                    labelText: 'Circle name',
                    hintText: 'e.g. Alpine Survey Crew',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _descController,
                  decoration: const InputDecoration(
                    labelText: 'Description (encrypted)',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _basemapController,
                  decoration: const InputDecoration(
                    labelText: 'Recommended basemap',
                  ),
                ),
                const SizedBox(height: 10),
                FilledButton.icon(
                  onPressed: _busy ? null : _createCircle,
                  icon: const Icon(Icons.lock_outline, size: 16),
                  label: const Text('Create MLS Circle'),
                ),
              ],
            ),
          ),
        ],

        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _inviteInputController,
                onSubmitted: (v) => unawaited(_previewInvite(v)),
                decoration: const InputDecoration(
                  hintText: 'Paste Circle invitation link…',
                ),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              onPressed: _busy
                  ? null
                  : () => unawaited(_previewInvite(_inviteInputController.text)),
              child: const Text('Open'),
            ),
          ],
        ),

        if (_decodedInvitePreview != null) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: EarthlyColors.measureViolet.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: EarthlyColors.measureViolet.withValues(alpha: 0.5),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'VERIFIED CIRCLE INVITATION',
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w800,
                    color: EarthlyColors.measureViolet,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Admin: ${_authorLabel(_decodedInvitePreview!.adminPubkey)}\n'
                  'Cordn: ${_shortHex(_decodedInvitePreview!.coordinatorPubkey)}\n'
                  'Relay: ${_decodedInvitePreview!.relays.join(", ")}',
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5),
                ),
                const SizedBox(height: 8),
                FilledButton.icon(
                  onPressed: _busy ? null : _requestJoin,
                  icon: const Icon(Icons.person_add_outlined, size: 16),
                  label: const Text('Request Access (Publish MLS KeyPackage)'),
                ),
              ],
            ),
          ),
        ],

        if (widget.pendingJoins.isNotEmpty) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: EarthlyColors.amber.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: EarthlyColors.amber),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'APPROVAL PENDING (${widget.pendingJoins.length})',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'An admin must approve your join request before Cordn delivers your MLS Welcome.',
                  style: TextStyle(fontSize: 11.5),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _checkApprovals,
                  icon: const Icon(Icons.refresh, size: 15),
                  label: const Text('Check Approved Welcomes'),
                ),
              ],
            ),
          ),
        ],

        const Divider(height: 24),
        Text(
          'YOUR CIRCLES (${widget.workspaces.length})',
          style: theme.textTheme.labelSmall?.copyWith(
            fontFamily: 'monospace',
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        if (widget.workspaces.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text(
              'No Circles on this device yet. Create a Circle above or paste an invitation link from Earthly Web.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall,
            ),
          )
        else
          for (final ws in widget.workspaces)
            EarthlyEntityListRow(
              leading: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: EarthlyColors.measureViolet.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(
                  Icons.lock_outline,
                  color: EarthlyColors.measureViolet,
                  size: 20,
                ),
              ),
              title: ws.name,
              subtitle: ws.description,
              meta:
                  '${ws.role} · ${ws.members.length} member${ws.members.length == 1 ? '' : 's'} · ${ws.datasets.length} map${ws.datasets.length == 1 ? '' : 's'} · e${ws.epoch}',
              selected: widget.activeCircleId == ws.workspaceId,
              onTap: () {
                setState(() {
                  _selectedWorkspaceId = ws.workspaceId;
                  _joinRequests = const [];
                  _joinRequestsChecked = false;
                });
                unawaited(_backgroundSyncSelected());
              },
              primaryAction: const Icon(Icons.chevron_right, size: 20),
            ),
      ],
    );
  }

  Widget _buildDetailBody(ThemeData theme, CircleWorkspaceDto ws) {
    return Column(
      children: [
        if (_busy || _info != null || _error != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
            child: _buildStatusBanners(),
          ),
        Expanded(
          child: TabBarView(
            controller: _detailTabs,
            children: [
              _buildChatTab(theme, ws),
              _buildGeometryTab(theme, ws),
              _buildSettingsTab(theme, ws),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildChatTab(ThemeData theme, CircleWorkspaceDto ws) {
    return Column(
      children: [
        Expanded(
          child: ws.messages.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'No encrypted Circle messages yet.\nMessages & attached geometries stay strictly inside MLS.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
                  itemCount: ws.messages.length,
                  separatorBuilder: (_, _) => const Divider(height: 16),
                  itemBuilder: (ctx, idx) {
                    final msg = ws.messages[idx];
                    final hasGeo = msg.geometryFeatureCount > 0 &&
                        msg.geojsonJson != null &&
                        msg.geojsonJson!.isNotEmpty;
                    final geoVisible =
                        widget.activeCommentOverlayId == msg.envelopeId;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                _authorLabel(msg.pubkey),
                                style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 11,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            Text(
                              _formatRelativeSecs(msg.createdAt.toInt()),
                              style: TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                        if (msg.text.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(msg.text, style: theme.textTheme.bodyMedium),
                        ],
                        if (hasGeo) ...[
                          const SizedBox(height: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 5,
                            ),
                            decoration: BoxDecoration(
                              color: EarthlyColors.commentGreen
                                  .withValues(alpha: 0.08),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: EarthlyColors.commentGreen
                                    .withValues(alpha: 0.4),
                              ),
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.place_outlined,
                                  size: 14,
                                  color: EarthlyColors.commentGreen,
                                ),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    '${msg.geometryFeatureCount} geometr${msg.geometryFeatureCount == 1 ? 'y' : 'ies'} attached',
                                    style: const TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      color: EarthlyColors.commentGreen,
                                    ),
                                  ),
                                ),
                                TextButton(
                                  style: TextButton.styleFrom(
                                    visualDensity: VisualDensity.compact,
                                  ),
                                  onPressed: () =>
                                      widget.onToggleCommentGeometry(msg),
                                  child: Text(geoVisible ? 'Hide' : 'Show'),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    );
                  },
                ),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.hasDraftGeometry)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: FilterChip(
                    avatar: const Icon(Icons.layers_outlined, size: 14),
                    label: const Text('Attach Working Draft geometry'),
                    selected: _attachDraftGeometry,
                    onSelected: (v) =>
                        setState(() => _attachDraftGeometry = v),
                  ),
                ),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _chatInputController,
                      enabled: ws.status == 'active' && !_busy,
                      onSubmitted: (_) => unawaited(_sendMessage()),
                      decoration: InputDecoration(
                        hintText: ws.status == 'active'
                            ? 'Encrypted message to ${ws.name}…'
                            : 'Removed from Circle',
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed:
                        (ws.status != 'active' || _busy) ? null : _sendMessage,
                    child: const Icon(Icons.send, size: 17),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildGeometryTab(ThemeData theme, CircleWorkspaceDto ws) {
    final geoComments =
        ws.messages.where((m) => m.geometryFeatureCount > 0).toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
      children: [
        Text(
          'MLS-encrypted Maps live strictly inside this Circle and never leak to public Nostr relays.',
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 10),
        FilledButton.icon(
          onPressed: ws.status != 'active'
              ? null
              : () => widget.onStartNewPrivateMap(ws),
          icon: const Icon(Icons.add_location_alt_outlined, size: 17),
          label: const Text('Author New Encrypted Map in Desk'),
        ),
        const SizedBox(height: 12),
        if (ws.datasets.isEmpty && geoComments.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 20),
            child: Text(
              'No encrypted Maps in this Circle yet.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall,
            ),
          ),
        for (final ds in ws.datasets) ...[
          EarthlyEntityListRow(
            leading: EarthlyGeometryThumb(
              cacheKey: ds.envelopeId,
              geojson: ds.geojsonJson,
              width: 56,
              height: 44,
            ),
            title: ds.title,
            meta:
                '${_authorLabel(ds.pubkey)} · ${ds.featureCount} feat · MLS encrypted',
            selected: widget.mountedCircleDatasetKeys.contains(
              'private-group:${ws.workspaceId}:${ds.datasetId}',
            ),
            onTap: () => widget.onZoomToDataset(ws, ds),
            primaryAction: IconButton(
              tooltip: widget.mountedCircleDatasetKeys.contains(
                'private-group:${ws.workspaceId}:${ds.datasetId}',
              )
                  ? 'Remove from map'
                  : 'Show on map',
              visualDensity: VisualDensity.compact,
              onPressed: () => widget.onToggleDatasetOnMap(ws, ds),
              icon: Icon(
                widget.mountedCircleDatasetKeys.contains(
                  'private-group:${ws.workspaceId}:${ds.datasetId}',
                )
                    ? Icons.layers
                    : Icons.layers_outlined,
                size: 19,
                color: widget.mountedCircleDatasetKeys.contains(
                  'private-group:${ws.workspaceId}:${ds.datasetId}',
                )
                    ? EarthlyColors.measureViolet
                    : null,
              ),
            ),
            menuActions: [
              EntityRowMenuAction(
                label: 'Zoom to map',
                icon: Icons.center_focus_strong,
                onSelected: () => widget.onZoomToDataset(ws, ds),
              ),
              EntityRowMenuAction(
                label: 'Edit private Map in Desk',
                icon: Icons.edit_outlined,
                onSelected: () => widget.onEditDatasetInDraft(ws, ds),
              ),
            ],
          ),
        ],
        if (geoComments.isNotEmpty) ...[
          const Divider(height: 20),
          Text(
            'COMMENT GEOMETRY ATTACHMENTS (${geoComments.length})',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          for (final c in geoComments)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: const Icon(
                Icons.place_outlined,
                color: EarthlyColors.commentGreen,
              ),
              title: Text(
                c.text.isEmpty ? 'Geometry attachment' : c.text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                '${_authorLabel(c.pubkey)} · ${c.geometryFeatureCount} features',
                style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5),
              ),
              trailing: TextButton(
                onPressed: () => widget.onToggleCommentGeometry(c),
                child: Text(
                  widget.activeCommentOverlayId == c.envelopeId ? 'Hide' : 'Show',
                ),
              ),
            ),
        ],
      ],
    );
  }

  Widget _buildSettingsTab(ThemeData theme, CircleWorkspaceDto ws) {
    final isAdmin = ws.role == 'administrator';
    final inviteUrl = _generatedInviteWorkspaceId == ws.workspaceId
        ? _generatedInviteUrl
        : null;
    final myPk = widget.account?.pubkey;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: _busy ? null : _syncSelected,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Sync Now'),
            ),
            if (isAdmin) ...[
              OutlinedButton.icon(
                onPressed:
                    _busy ? null : () => _generateInvite(copyImmediately: true),
                icon: const Icon(Icons.copy, size: 15),
                label: const Text('Copy Invite Link'),
              ),
              OutlinedButton.icon(
                onPressed: _busy
                    ? null
                    : () => _generateInvite(copyImmediately: false),
                icon: const Icon(Icons.qr_code_2, size: 16),
                label: const Text('Invite QR'),
              ),
            ],
          ],
        ),
        if (inviteUrl != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: theme.dividerColor),
            ),
            child: Column(
              children: [
                EarthlyQrCode(data: inviteUrl, size: 200),
                const SizedBox(height: 8),
                const Text(
                  'Signed 24-hour invitation · scan on Earthly Native or Web',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontFamily: 'monospace', fontSize: 10.5),
                ),
                const SizedBox(height: 6),
                OutlinedButton.icon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: inviteUrl));
                    setState(() => _info = 'Copied Circle invitation link.');
                  },
                  icon: const Icon(Icons.copy, size: 14),
                  label: const Text('Copy Invitation Link'),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: theme.dividerColor),
          ),
          child: Text(
            'ROLE: ${ws.role.toUpperCase()}  ·  EPOCH: ${ws.epoch}  ·  CURSOR: ${ws.cursor}\n'
            'CORDN: ${_shortHex(ws.coordinatorPubkey)}\n'
            'RELAYS: ${ws.relays.join(", ")}',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5),
          ),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Text(
              'MEMBERS (${ws.members.length})',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const Spacer(),
            if (isAdmin)
              OutlinedButton.icon(
                onPressed: _busy ? null : _checkJoinRequests,
                icon: const Icon(Icons.person_add_alt_1, size: 15),
                label: const Text('Check Requests'),
              ),
          ],
        ),
        const SizedBox(height: 6),
        if (_joinRequestsChecked && _joinRequests.isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              'No pending join requests on Cordn.',
              style: theme.textTheme.bodySmall,
            ),
          ),
        for (final req in _joinRequests)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: EarthlyColors.commentGreen.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(11),
              border: Border.all(
                color: EarthlyColors.commentGreen.withValues(alpha: 0.5),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'PENDING JOIN REQUEST',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 9.5,
                          fontWeight: FontWeight.w800,
                          color: EarthlyColors.commentGreen,
                        ),
                      ),
                      Text(
                        _authorLabel(req.pk),
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
                FilledButton.icon(
                  onPressed: _busy ? null : () => _approveRequest(req),
                  icon: const Icon(Icons.check, size: 15),
                  label: const Text('Approve'),
                ),
              ],
            ),
          ),
        for (final memberPk in ws.members) ...[
          Builder(
            builder: (_) {
              final memberIsAdmin = ws.administrators.contains(memberPk);
              final isSelf = memberPk == myPk;
              return ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  radius: 15,
                  backgroundColor:
                      EarthlyColors.measureViolet.withValues(alpha: 0.16),
                  child: const Icon(
                    Icons.person_outline,
                    size: 16,
                    color: EarthlyColors.measureViolet,
                  ),
                ),
                title: Row(
                  children: [
                    Flexible(
                      child: Text(
                        '${_authorLabel(memberPk)}${isSelf ? ' (you)' : ''}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    if (memberIsAdmin) ...[
                      const SizedBox(width: 6),
                      const EarthlyBadge(
                        label: 'ADMIN',
                        color: EarthlyColors.measureViolet,
                      ),
                    ],
                  ],
                ),
                subtitle: Text(
                  _shortHex(memberPk),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 10),
                ),
                trailing: (isAdmin && !isSelf)
                    ? Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            tooltip: memberIsAdmin
                                ? 'Demote admin'
                                : 'Promote to admin',
                            visualDensity: VisualDensity.compact,
                            onPressed: _busy
                                ? null
                                : () => _toggleAdmin(ws, memberPk, !memberIsAdmin),
                            icon: Icon(
                              memberIsAdmin
                                  ? Icons.remove_moderator_outlined
                                  : Icons.add_moderator_outlined,
                              size: 18,
                            ),
                          ),
                          if (!memberIsAdmin)
                            IconButton(
                              tooltip: 'Remove from future epochs',
                              visualDensity: VisualDensity.compact,
                              onPressed: _busy
                                  ? null
                                  : () => _removeMember(ws, memberPk),
                              icon: const Icon(
                                Icons.person_remove_outlined,
                                size: 18,
                                color: EarthlyColors.destructive,
                              ),
                            ),
                        ],
                      )
                    : null,
              );
            },
          ),
        ],
        const Divider(height: 24),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(
            foregroundColor: EarthlyColors.destructive,
            side: const BorderSide(color: EarthlyColors.destructive),
          ),
          onPressed: _busy ? null : () => _confirmDeleteWorkspace(ws),
          icon: const Icon(Icons.delete_outline, size: 17),
          label: const Text('Delete Circle from This Device'),
        ),
      ],
    );
  }
}
