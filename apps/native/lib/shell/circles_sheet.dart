import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/nip55_signer.dart';
import '../runtime/camera_capture.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/blossom.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/private_groups.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';
import 'qr_code_view.dart';

enum _AttachmentSource { camera, image, file }

String _formatByteSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

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
    this.onCopyDatasetToDraft,
    this.onProposeDatasetEdit,
    this.activeProposalOverlayId,
    this.onToggleProposalOverlay,
    this.onRespondProposal,
    required this.onStartNewPrivateMap,
    required this.onToggleCommentGeometry,
    required this.onSendCircleComment,
    required this.onOpenAccount,
    required this.onClose,
    this.initialWorkspaceId,
    this.initialInviteLink,
    this.isReadOnlySession = false,
    this.onEnsureExternalSigner,
    this.blossomServerUrl = 'https://blossom.earthly.city',
    this.onSendCircleCommentWithMedia,
    this.onUploadBlossomBlob,
    this.onSignUnsignedEvent,
    this.onNip44EncryptSelf,
    this.onNip44DecryptSelf,
    this.onSyncWorkspaceReadonly,
    this.onRepairSyncState,
    this.onSetAutoApprove,
    this.onPollAutoApprove,
    this.onDownloadMedia,
    this.onBackupMultiDevice,
    this.onPullMultiDevice,
    super.key,
  });

  final Nip55Account? account;
  final String? localNsec;
  final String? bunkerUri;
  final String? bunkerClientNsec;
  final String mlsDatabasePath;
  final String cordnServerPubkey;
  final String blossomServerUrl;
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
  final void Function(CircleWorkspaceDto ws, CircleDatasetDto dataset)?
      onCopyDatasetToDraft;
  final void Function(CircleWorkspaceDto ws, CircleDatasetDto dataset)?
      onProposeDatasetEdit;
  final String? activeProposalOverlayId;
  final void Function(CircleWorkspaceDto ws, CircleProposalDto proposal)?
      onToggleProposalOverlay;
  final Future<CircleWorkspaceDto> Function(
    CircleWorkspaceDto ws,
    CircleProposalDto proposal,
    int statusKind,
    String? note,
  )? onRespondProposal;
  final ValueChanged<CircleWorkspaceDto> onStartNewPrivateMap;
  final ValueChanged<CircleMessageDto> onToggleCommentGeometry;
  final Future<CircleWorkspaceDto> Function(
    String workspaceId,
    String text,
    bool attachDraft,
  ) onSendCircleComment;
  final Future<CircleWorkspaceDto> Function(
    String workspaceId,
    String text,
    bool attachDraft,
    List<List<String>> imetaTags,
  )? onSendCircleCommentWithMedia;
  final Future<BlossomUploadDto> Function({
    required Uint8List bytes,
    required String mimeType,
    required String purpose,
    String? sha256Hex,
    String? serverUrl,
  })? onUploadBlossomBlob;
  final Future<String> Function(String unsignedEventJson)? onSignUnsignedEvent;
  final Future<String> Function(String plaintext)? onNip44EncryptSelf;
  final Future<String> Function(String ciphertext)? onNip44DecryptSelf;
  final Future<CircleWorkspaceDto> Function(String workspaceId)?
      onSyncWorkspaceReadonly;
  final Future<CircleWorkspaceDto> Function(String workspaceId)?
      onRepairSyncState;
  final Future<CircleWorkspaceDto> Function(String workspaceId, bool enabled)?
      onSetAutoApprove;
  final Future<CircleWorkspaceDto> Function(String workspaceId)?
      onPollAutoApprove;
  final Future<Uint8List> Function(
    CircleWorkspaceDto ws,
    CircleMediaAttachmentDto att,
    BigInt? epoch,
  )? onDownloadMedia;
  final Future<MultiDeviceSyncSummaryDto> Function()? onBackupMultiDevice;
  final Future<MultiDeviceSyncSummaryDto> Function()? onPullMultiDevice;
  final VoidCallback onOpenAccount;
  final VoidCallback onClose;
  final String? initialWorkspaceId;
  final String? initialInviteLink;
  final bool isReadOnlySession;
  final Future<void> Function()? onEnsureExternalSigner;

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
  bool _showMultiDevicePanel = false;
  bool _attachDraftGeometry = false;
  bool _busy = false;
  String? _busyLabel;
  String? _error;
  String? _info;
  String? _multiDeviceStatus;
  String? _lastMultiDeviceDekHex;
  String? _autoRecoveryAttemptedForPubkey;
  bool _autoBackupInFlight = false;
  bool _autoBackupPending = false;
  String _pendingAutoBackupReason = 'group updated';
  bool _hasFetchedRemoteTip = false;
  final Map<String, Map<String, Object?>> _knownRemoteGroupPointers =
      <String, Map<String, Object?>>{};
  final Set<String> _locallyDeletedGroupIds = <String>{};
  String? _generatedInviteUrl;
  String? _generatedInviteWorkspaceId;
  List<CircleJoinRequestDto> _joinRequests = const [];
  bool _joinRequestsChecked = false;
  DecodedCircleInviteDto? _decodedInvitePreview;
  DecodedCordnGroupRefDto? _decodedCordnRefPreview;
  final List<PickedBinaryFile> _stagedAttachments = <PickedBinaryFile>[];
  final Map<String, Uint8List> _decryptedMediaCache = <String, Uint8List>{};
  final Set<String> _decryptingMediaKeys = <String>{};
  final Map<String, String> _mediaErrors = <String, String>{};

  bool get _hasDirectRustSigner =>
      (widget.localNsec != null && widget.localNsec!.isNotEmpty) ||
      (widget.bunkerUri != null &&
          widget.bunkerUri!.isNotEmpty &&
          widget.bunkerClientNsec != null &&
          widget.bunkerClientNsec!.isNotEmpty);

  bool get _hasSupportedSigner =>
      !widget.isReadOnlySession &&
      (_hasDirectRustSigner ||
          (widget.account != null && widget.account!.pubkey.trim().isNotEmpty));

  bool _isWorkspaceAdmin(CircleWorkspaceDto ws) {
    final myPk = widget.account?.pubkey.trim().toLowerCase();
    final role = ws.role.trim().toLowerCase();
    if (role == 'administrator' || role == 'admin') return true;
    if (myPk != null &&
        myPk.isNotEmpty &&
        ws.administrators.any((a) => a.trim().toLowerCase() == myPk)) {
      return true;
    }
    return false;
  }

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
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (_selectedWorkspaceId != null) {
        unawaited(_backgroundSyncSelected());
      }
      unawaited(_maybeAutoRecoverOnEmpty());
    });
  }

  @override
  void didUpdateWidget(covariant CirclesSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.cordnServerPubkey != widget.cordnServerPubkey &&
        _cordnInputController.text != widget.cordnServerPubkey) {
      _cordnInputController.text = widget.cordnServerPubkey;
    }
    final oldPk = oldWidget.account?.pubkey.trim().toLowerCase() ?? '';
    final newPk = widget.account?.pubkey.trim().toLowerCase() ?? '';
    if (oldPk != newPk) {
      _autoRecoveryAttemptedForPubkey = null;
      _lastMultiDeviceDekHex = null;
      _hasFetchedRemoteTip = false;
      _knownRemoteGroupPointers.clear();
      _locallyDeletedGroupIds.clear();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_maybeAutoRecoverOnEmpty());
      });
    } else if (oldWidget.mlsDatabasePath.isEmpty &&
        widget.mlsDatabasePath.isNotEmpty &&
        widget.workspaces.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_maybeAutoRecoverOnEmpty());
      });
    }
    if (widget.initialWorkspaceId != null &&
        widget.initialWorkspaceId != oldWidget.initialWorkspaceId &&
        widget.initialWorkspaceId != _selectedWorkspaceId) {
      _selectedWorkspaceId = widget.initialWorkspaceId;
      _joinRequests = const [];
      _joinRequestsChecked = false;
      unawaited(_backgroundSyncSelected());
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
    _detailTabs.dispose();
    _nameController.dispose();
    _descController.dispose();
    _basemapController.dispose();
    _inviteInputController.dispose();
    _cordnInputController.dispose();
    _chatInputController.dispose();
    super.dispose();
  }

  Widget _buildProposalCard(
    ThemeData theme,
    CircleWorkspaceDto ws,
    CircleProposalDto prop, {
    required bool isDatasetOwner,
  }) {
    final isOpen = prop.status == 'open';
    final isApplied = prop.status == 'applied';
    final isPreviewing = widget.activeProposalOverlayId == prop.proposalId;
    final isProposer = widget.account != null &&
        widget.account!.pubkey.toLowerCase() == prop.pubkey.toLowerCase();
    final badgeColor = isApplied
        ? EarthlyColors.commentGreen
        : isOpen
            ? EarthlyColors.proposedAmber
            : theme.colorScheme.onSurfaceVariant;

    return Container(
      key: Key('circle-proposal-${prop.proposalId}'),
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: badgeColor.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: badgeColor.withValues(alpha: 0.42)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.compare_arrows, size: 15, color: badgeColor),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${_authorLabel(prop.pubkey)} proposed an edit (${prop.featureCount} feat)',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              EarthlyBadge(
                label: prop.status.toUpperCase(),
                color: badgeColor,
              ),
            ],
          ),
          if (prop.summary.trim().isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              prop.summary,
              style: theme.textTheme.bodySmall,
            ),
          ],
          if (prop.statusNote != null && prop.statusNote!.trim().isNotEmpty) ...[
            const SizedBox(height: 3),
            Text(
              'Note: ${prop.statusNote!}',
              style: theme.textTheme.bodySmall?.copyWith(
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
          const SizedBox(height: 8),
          Material(
            color: theme.colorScheme.surface.withValues(alpha: 0.72),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(9),
              side: BorderSide(color: theme.dividerColor),
            ),
            clipBehavior: Clip.antiAlias,
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (widget.onToggleProposalOverlay != null)
                    Expanded(
                      child: InkWell(
                        key: Key('circle-proposal-preview-${prop.proposalId}'),
                        onTap: () => widget.onToggleProposalOverlay!(ws, prop),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 8,
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                isPreviewing
                                    ? Icons.visibility_off
                                    : Icons.visibility,
                                size: 14,
                              ),
                              const SizedBox(width: 4),
                              Flexible(
                                child: Text(
                                  isPreviewing ? 'Hide' : 'Diff',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  if (isOpen &&
                      isDatasetOwner &&
                      widget.onRespondProposal != null) ...[
                    if (widget.onToggleProposalOverlay != null)
                      VerticalDivider(width: 1, color: theme.dividerColor),
                    Expanded(
                      child: InkWell(
                        key: Key('circle-proposal-close-${prop.proposalId}'),
                        onTap: _busy
                            ? null
                            : () => unawaited(
                                  _handleRespondProposal(ws, prop, 1632),
                                ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 8,
                          ),
                          child: Center(
                            child: Text(
                              'Decline',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    VerticalDivider(width: 1, color: theme.dividerColor),
                    Expanded(
                      child: InkWell(
                        key: Key('circle-proposal-apply-${prop.proposalId}'),
                        onTap: _busy
                            ? null
                            : () => unawaited(
                                  _handleRespondProposal(ws, prop, 1631),
                                ),
                        child: ColoredBox(
                          color: EarthlyColors.commentGreen
                              .withValues(alpha: 0.14),
                          child: const Padding(
                            padding: EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 8,
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  Icons.check,
                                  size: 14,
                                  color: EarthlyColors.commentGreen,
                                ),
                                SizedBox(width: 4),
                                Flexible(
                                  child: Text(
                                    'Apply',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w800,
                                      color: EarthlyColors.commentGreen,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ] else if (isOpen &&
                      isProposer &&
                      widget.onRespondProposal != null) ...[
                    if (widget.onToggleProposalOverlay != null)
                      VerticalDivider(width: 1, color: theme.dividerColor),
                    Expanded(
                      child: InkWell(
                        key: Key('circle-proposal-withdraw-${prop.proposalId}'),
                        onTap: _busy
                            ? null
                            : () => unawaited(
                                  _handleRespondProposal(ws, prop, 1632),
                                ),
                        child: const Padding(
                          padding: EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 8,
                          ),
                          child: Center(
                            child: Text(
                              'Withdraw',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _handleRespondProposal(
    CircleWorkspaceDto ws,
    CircleProposalDto prop,
    int statusKind,
  ) async {
    if (widget.onRespondProposal == null) return;
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      final updated = await widget.onRespondProposal!(
        ws,
        prop,
        statusKind,
        null,
      );
      widget.onWorkspaceUpdated(updated);
      if (!mounted) return;
      setState(() {
        _info = statusKind == 1631
            ? 'Applied edit proposal to "${prop.title}" in place.'
            : 'Closed edit proposal.';
      });
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _authorLabel(String pubkey) {
    final p = widget.profilesByPubkey[pubkey];
    final name = p?.displayName ?? p?.name;
    if (name != null && name.isNotEmpty) return name;
    return _shortHex(pubkey);
  }

  Future<CircleWorkspaceDto> _performReadonlySync(String workspaceId) async {
    if (widget.onSyncWorkspaceReadonly != null) {
      return widget.onSyncWorkspaceReadonly!(workspaceId);
    }
    final ownerPk = widget.account?.pubkey.trim();
    if (ownerPk == null || ownerPk.isEmpty) {
      throw StateError('No active account pubkey available for sync');
    }
    await RustBridge.ensureInitialized();
    return syncCircleWorkspaceReadonly(
      databasePath: widget.mlsDatabasePath,
      ownerPubkeyHex: ownerPk,
      workspaceId: workspaceId,
    );
  }

  Future<void> _backgroundSyncSelected() async {
    final ws = _selectedWorkspace;
    if (ws == null ||
        _busy ||
        widget.isReadOnlySession ||
        ws.status != 'active' ||
        widget.account == null ||
        widget.account!.pubkey.trim().isEmpty) {
      return;
    }
    try {
      final updated = await _performReadonlySync(ws.workspaceId);
      if (mounted) widget.onWorkspaceUpdated(updated);
    } catch (_) {}
  }

  Future<void> _runAction(
    String label,
    Future<void> Function() action, {
    bool requireRustBridge = true,
    bool requireExternalSigner = true,
  }) async {
    setState(() {
      _busy = true;
      _busyLabel = label;
      _error = null;
      _info = null;
    });
    try {
      if (requireRustBridge) {
        await RustBridge.ensureInitialized();
      }
      if (requireExternalSigner && widget.onEnsureExternalSigner != null) {
        await widget.onEnsureExternalSigner!();
      }
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
    final trimmed = raw.trim();
    if (trimmed.isEmpty) {
      if (mounted) {
        setState(() {
          _decodedInvitePreview = null;
          _decodedCordnRefPreview = null;
        });
      }
      return;
    }
    try {
      await RustBridge.ensureInitialized();
      try {
        final decoded = await decodeCircleInviteLink(rawLink: trimmed);
        if (!mounted) return;
        setState(() {
          _decodedInvitePreview = decoded;
          _decodedCordnRefPreview = null;
          _error = null;
        });
        return;
      } catch (inviteErr) {
        try {
          final cordnRef = await decodeCordnGroupRefLink(rawLink: trimmed);
          if (!mounted) return;
          setState(() {
            _decodedInvitePreview = null;
            _decodedCordnRefPreview = cordnRef;
            _error = null;
          });
          return;
        } catch (_) {
          rethrow;
        }
      }
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _decodedInvitePreview = null;
        _decodedCordnRefPreview = null;
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
      _locallyDeletedGroupIds.remove(created.groupId);
      _scheduleAutoBackupMultiDevice('circle created');
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
        for (final ws in joined) {
          _locallyDeletedGroupIds.remove(ws.groupId);
        }
        widget.onWorkspaceUpdated(joined.first);
        setState(() {
          _selectedWorkspaceId = joined.first.workspaceId;
          _info =
              'Joined ${joined.length} Circle${joined.length == 1 ? '' : 's'} and decrypted checkpoint!';
        });
        _scheduleAutoBackupMultiDevice('circle joined');
      } else {
        setState(() => _info = 'No approved Welcomes yet from Cordn.');
      }
    });
  }

  Future<void> _syncSelected() async {
    final ws = _selectedWorkspace;
    if (ws == null) return;
    await _runAction(
      'Syncing encrypted records…',
      requireRustBridge: widget.onSyncWorkspaceReadonly == null,
      requireExternalSigner: false,
      () async {
        final updated = await _performReadonlySync(ws.workspaceId);
        widget.onWorkspaceUpdated(updated);
        if (mounted) {
          setState(
            () => _info =
                'Circle current · cursor ${updated.cursor} · epoch ${updated.epoch}',
          );
        }
      },
    );
  }

  Future<void> _repairSyncState(CircleWorkspaceDto ws) async {
    await _runAction(
      'Repairing sync state & re-syncing…',
      requireRustBridge: widget.onRepairSyncState == null,
      requireExternalSigner: false,
      () async {
        final updated = widget.onRepairSyncState != null
            ? await widget.onRepairSyncState!(ws.workspaceId)
            : await repairCircleSyncState(
                databasePath: widget.mlsDatabasePath,
                ownerPubkeyHex: widget.account!.pubkey,
                workspaceId: ws.workspaceId,
              );
        widget.onWorkspaceUpdated(updated);
        if (mounted) {
          setState(
            () => _info =
                'Repaired sync state (${updated.syncHealth}) · cursor ${updated.cursor} · epoch ${updated.epoch}',
          );
        }
      },
    );
  }

  Future<void> _toggleAutoApprove(CircleWorkspaceDto ws, bool enabled) async {
    await _runAction(
      enabled
          ? 'Enabling auto-approve join requests…'
          : 'Disabling auto-approve join requests…',
      requireRustBridge: widget.onSetAutoApprove == null,
      requireExternalSigner: false,
      () async {
        final updated = widget.onSetAutoApprove != null
            ? await widget.onSetAutoApprove!(ws.workspaceId, enabled)
            : await setCircleAutoApprove(
                databasePath: widget.mlsDatabasePath,
                ownerPubkeyHex: widget.account!.pubkey,
                workspaceId: ws.workspaceId,
                enabled: enabled,
              );
        widget.onWorkspaceUpdated(updated);
        if (mounted) {
          setState(
            () => _info = enabled
                ? 'Auto-approve enabled for incoming join requests.'
                : 'Auto-approve disabled.',
          );
        }
      },
    );
  }

  Future<void> _pollAndAutoApprove(CircleWorkspaceDto ws) async {
    await _runAction(
      'Approving pending join requests…',
      requireRustBridge: widget.onPollAutoApprove == null,
      requireExternalSigner: widget.onPollAutoApprove == null,
      () async {
        final updated = widget.onPollAutoApprove != null
            ? await widget.onPollAutoApprove!(ws.workspaceId)
            : await pollAndAutoApproveCircleRequests(
                databasePath: widget.mlsDatabasePath,
                signerNsec: widget.localNsec,
                bunkerUri: widget.bunkerUri,
                bunkerClientNsec: widget.bunkerClientNsec,
                workspaceId: ws.workspaceId,
              );
        widget.onWorkspaceUpdated(updated);
        if (mounted) {
          setState(() {
            _joinRequests = const [];
            _info =
                'Processed pending join requests · ${updated.members.length} members · epoch ${updated.epoch}';
          });
        }
        _scheduleAutoBackupMultiDevice('membership updated');
      },
    );
  }

  Future<PickedBinaryFile?> _pickMediaFile(_AttachmentSource source) async {
    try {
      return switch (source) {
        _AttachmentSource.camera => await CameraCapture.capturePhoto(context),
        _AttachmentSource.image => await DeviceBridge.pickImage(),
        _AttachmentSource.file => await DeviceBridge.pickAnyFile(),
      };
    } catch (err) {
      if (CameraCapture.isCancellation(err)) return null;
      if (mounted) setState(() => _error = err.toString());
      return null;
    }
  }

  Future<void> _stageChatAttachment(_AttachmentSource source) async {
    final picked = await _pickMediaFile(source);
    if (picked == null || !mounted) return;
    setState(() {
      _stagedAttachments.add(picked);
      _error = null;
    });
  }

  Future<BlossomUploadDto> _uploadEncryptedBlobToBlossom({
    required Uint8List bytes,
    required String sha256Hex,
    required String purpose,
    String mimeType = 'application/octet-stream',
    String? serverUrl,
  }) async {
    final uploader = widget.onUploadBlossomBlob;
    if (uploader != null) {
      return uploader(
        bytes: bytes,
        mimeType: mimeType,
        purpose: purpose,
        sha256Hex: sha256Hex,
        serverUrl: serverUrl ?? widget.blossomServerUrl,
      );
    }
    throw StateError(
      'Blossom upload signer is not configured for this session.',
    );
  }

  Future<List<String>> _encryptAndUploadAttachment({
    required String workspaceId,
    required PickedBinaryFile file,
    required bool persistentForMap,
  }) async {
    final ownerPk = widget.account?.pubkey.trim();
    if (ownerPk == null || ownerPk.isEmpty) {
      throw StateError('Sign in to encrypt attachments.');
    }
    final prepared = await prepareCircleEncryptedMedia(
      databasePath: widget.mlsDatabasePath,
      ownerPubkeyHex: ownerPk,
      workspaceId: workspaceId,
      bytes: file.bytes,
      mimeType: file.mimeType,
      filename: file.name,
      persistentForMap: persistentForMap,
      stripMetadata: true,
    );
    final uploaded = await _uploadEncryptedBlobToBlossom(
      bytes: prepared.encryptedBytes,
      sha256Hex: prepared.encryptedSha256Hex,
      purpose: persistentForMap
          ? 'Upload encrypted Circle map media'
          : 'Upload encrypted Circle attachment',
    );
    return buildCircleImetaTag(
      url: uploaded.url,
      mimeType: prepared.mimeType,
      filename: prepared.sanitizedFilename,
      sha256Hex: prepared.plaintextSha256Hex,
      nonceHex: prepared.nonceHex,
      version: prepared.version,
      persistentKeyHex: prepared.persistentKeyHex,
    );
  }

  String _mediaCacheKey(CircleMediaAttachmentDto att) =>
      '${att.url}#${att.sha256Hex}';

  Future<Uint8List> _fetchDecryptedMediaBytes(
    CircleWorkspaceDto ws,
    CircleMediaAttachmentDto att,
    BigInt? epoch,
  ) async {
    final key = _mediaCacheKey(att);
    final cached = _decryptedMediaCache[key];
    if (cached != null) return cached;
    final Uint8List bytes;
    if (widget.onDownloadMedia != null) {
      bytes = await widget.onDownloadMedia!(ws, att, epoch);
    } else {
      await RustBridge.ensureInitialized();
      bytes = await downloadAndDecryptCircleMedia(
        databasePath: widget.mlsDatabasePath,
        ownerPubkeyHex: widget.account!.pubkey,
        workspaceId: ws.workspaceId,
        url: att.url,
        mimeType: att.mimeType,
        filename: att.filename,
        sha256Hex: att.sha256Hex,
        nonceHex: att.nonceHex,
        version: att.version,
        persistentKeyHex: att.persistentKeyHex,
        messageEpoch: epoch,
      );
    }
    _decryptedMediaCache[key] = bytes;
    return bytes;
  }

  void _ensureImageDecrypted(
    CircleWorkspaceDto ws,
    CircleMediaAttachmentDto att,
    BigInt? epoch,
  ) {
    final key = _mediaCacheKey(att);
    if (_decryptedMediaCache.containsKey(key) ||
        _decryptingMediaKeys.contains(key) ||
        _mediaErrors.containsKey(key)) {
      return;
    }
    _decryptingMediaKeys.add(key);
    unawaited(() async {
      try {
        await _fetchDecryptedMediaBytes(ws, att, epoch);
        _mediaErrors.remove(key);
      } catch (err) {
        _mediaErrors[key] = err.toString();
      } finally {
        _decryptingMediaKeys.remove(key);
        if (mounted) setState(() {});
      }
    }());
  }

  void _retryDecryptImage(
    CircleWorkspaceDto ws,
    CircleMediaAttachmentDto att,
    BigInt? epoch,
  ) {
    final key = _mediaCacheKey(att);
    setState(() => _mediaErrors.remove(key));
    _ensureImageDecrypted(ws, att, epoch);
  }

  Future<void> _saveDecryptedBytes(
    CircleMediaAttachmentDto att,
    Uint8List bytes,
  ) async {
    try {
      final saved = await DeviceBridge.saveBinaryFile(
        filename: att.filename,
        bytes: bytes,
        mimeType: att.mimeType,
      );
      if (mounted) {
        setState(() => _info = 'Saved decrypted file: $saved');
      }
    } catch (err) {
      if (err.toString().toLowerCase().contains('cancel')) return;
      if (mounted) setState(() => _error = 'Save failed: $err');
    }
  }

  Future<void> _decryptAndSaveFile(
    CircleWorkspaceDto ws,
    CircleMediaAttachmentDto att,
    BigInt? epoch,
  ) async {
    final key = _mediaCacheKey(att);
    if (_decryptingMediaKeys.contains(key)) return;
    setState(() {
      _decryptingMediaKeys.add(key);
      _mediaErrors.remove(key);
    });
    try {
      final bytes = await _fetchDecryptedMediaBytes(ws, att, epoch);
      if (!mounted) return;
      setState(() => _decryptingMediaKeys.remove(key));
      await _saveDecryptedBytes(att, bytes);
    } catch (err) {
      if (mounted) {
        setState(() {
          _decryptingMediaKeys.remove(key);
          _mediaErrors[key] = err.toString();
          _error = 'Decrypt failed: $err';
        });
      }
    }
  }

  Future<void> _openImageLightbox(
    CircleMediaAttachmentDto att,
    Uint8List bytes,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        insetPadding: const EdgeInsets.all(16),
        backgroundColor: Colors.black.withValues(alpha: 0.92),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760, maxHeight: 760),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 10, 8, 8),
                child: Row(
                  children: [
                    const Icon(
                      Icons.lock_outline,
                      size: 16,
                      color: EarthlyColors.measureViolet,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        att.filename,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    EarthlyBadge(
                      label: att.version,
                      color: EarthlyColors.measureViolet,
                    ),
                    const SizedBox(width: 6),
                    TextButton.icon(
                      onPressed: () => unawaited(_saveDecryptedBytes(att, bytes)),
                      icon: const Icon(
                        Icons.download_outlined,
                        size: 16,
                        color: Colors.white,
                      ),
                      label: const Text(
                        'Save',
                        style: TextStyle(color: Colors.white),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Close lightbox',
                      onPressed: () => Navigator.of(ctx).pop(),
                      icon: const Icon(Icons.close, color: Colors.white),
                    ),
                  ],
                ),
              ),
              Flexible(
                child: InteractiveViewer(
                  minScale: 0.5,
                  maxScale: 4.0,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Image.memory(
                      bytes,
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'Image decrypted — tap Save to export binary.',
                          style: TextStyle(color: Colors.white70),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _attachPersistentMapMedia(
    CircleWorkspaceDto ws,
    CircleDatasetDto ds,
  ) async {
    final source = await showModalBottomSheet<_AttachmentSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(
              dense: true,
              title: Text(
                'Attach Encrypted Map Media (earthly-pm-v1)',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
              ),
              subtitle: Text(
                'Encrypted with a persistent map key so late joiners can decrypt it.',
                style: TextStyle(fontSize: 11.5),
              ),
            ),
            if (Platform.isAndroid)
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined),
                title: const Text('Take Photo'),
                onTap: () => Navigator.of(ctx).pop(_AttachmentSource.camera),
              ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Pick Image'),
              onTap: () => Navigator.of(ctx).pop(_AttachmentSource.image),
            ),
            ListTile(
              leading: const Icon(Icons.attach_file),
              title: const Text('Pick File'),
              onTap: () => Navigator.of(ctx).pop(_AttachmentSource.file),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    final picked = await _pickMediaFile(source);
    if (picked == null || !mounted) return;

    await _runAction('Encrypting & attaching map media…', () async {
      final preservedTags = <List<String>>[];
      for (final existing in ds.mediaAttachments) {
        preservedTags.add(
          await buildCircleImetaTag(
            url: existing.url,
            mimeType: existing.mimeType,
            filename: existing.filename,
            sha256Hex: existing.sha256Hex,
            nonceHex: existing.nonceHex,
            version: existing.version,
            dim: existing.dim,
            blurhash: existing.blurhash,
            alt: existing.alt,
            persistentKeyHex: existing.persistentKeyHex,
          ),
        );
      }
      final newTag = await _encryptAndUploadAttachment(
        workspaceId: ws.workspaceId,
        file: picked,
        persistentForMap: true,
      );
      preservedTags.add(newTag);
      final updated = await sendCircleDatasetWithMedia(
        databasePath: widget.mlsDatabasePath,
        signerNsec: widget.localNsec,
        bunkerUri: widget.bunkerUri,
        bunkerClientNsec: widget.bunkerClientNsec,
        workspaceId: ws.workspaceId,
        geojsonJson: ds.geojsonJson,
        datasetId: ds.datasetId,
        name: ds.title,
        imetaTags: preservedTags,
      );
      widget.onWorkspaceUpdated(updated);
      if (mounted) {
        setState(
          () => _info = 'Attached encrypted map media to "${ds.title}" (earthly-pm-v1).',
        );
      }
    });
  }

  void _cacheRemoteTipPointersFromJson(String tipPlaintextJson) {
    try {
      final decoded = jsonDecode(tipPlaintextJson);
      if (decoded is! Map) return;
      final dek = decoded['dekHex'];
      if (dek is String && dek.trim().length == 64) {
        _lastMultiDeviceDekHex = dek.trim().toLowerCase();
      }
      final groups = decoded['groups'];
      if (groups is Map) {
        for (final entry in groups.entries) {
          final gid = entry.key.toString();
          if (gid.isEmpty || entry.value is! Map) continue;
          _knownRemoteGroupPointers[gid] =
              Map<String, Object?>.from(entry.value as Map);
        }
      }
    } catch (_) {}
  }

  Future<void> _maybeAutoRecoverOnEmpty() async {
    final pubkey = widget.account?.pubkey.trim().toLowerCase() ?? '';
    if (pubkey.isEmpty ||
        !_hasSupportedSigner ||
        widget.workspaces.isNotEmpty ||
        widget.mlsDatabasePath.isEmpty ||
        _busy ||
        _autoRecoveryAttemptedForPubkey == pubkey) {
      return;
    }
    _autoRecoveryAttemptedForPubkey = pubkey;
    await _recoverGroupsFromRelays(automatic: true);
  }

  void _scheduleAutoBackupMultiDevice(String reason) {
    if (!_hasSupportedSigner || widget.mlsDatabasePath.isEmpty) return;
    _pendingAutoBackupReason = reason;
    if (_autoBackupInFlight) {
      _autoBackupPending = true;
      return;
    }
    _autoBackupInFlight = true;
    unawaited(() async {
      try {
        while (mounted) {
          _autoBackupPending = false;
          final currentReason = _pendingAutoBackupReason;
          try {
            final status = await _publishMultiDeviceSnapshotCore(
              allowExternalInit: true,
            );
            if (mounted && status != null) {
              setState(() => _multiDeviceStatus = '$status ($currentReason)');
            }
          } catch (_) {
            if (mounted) {
              setState(() {
                _multiDeviceStatus ??=
                    'Encrypted relay backup pending — tap Backup to Devices when online.';
              });
            }
          }
          if (!_autoBackupPending) break;
        }
      } finally {
        _autoBackupInFlight = false;
      }
    }());
  }

  Future<String?> _publishMultiDeviceSnapshotCore({
    bool allowExternalInit = true,
  }) async {
    if (widget.onBackupMultiDevice != null) {
      final summary = await widget.onBackupMultiDevice!();
      _lastMultiDeviceDekHex = summary.dekHex ?? _lastMultiDeviceDekHex;
      return 'Backed up ${summary.uploadedBlobs} encrypted blob${summary.uploadedBlobs == 1 ? '' : 's'}';
    }

    if (allowExternalInit) {
      await RustBridge.ensureInitialized();
    }

    final nsec = widget.localNsec?.trim();
    if (nsec != null && nsec.isNotEmpty) {
      final summary = await publishMultiDeviceSnapshotDirect(
        databasePath: widget.mlsDatabasePath,
        signerNsec: nsec,
        blossomServerUrl: widget.blossomServerUrl,
        relayUrls: widget.relayUrls,
      );
      _lastMultiDeviceDekHex = summary.dekHex ?? _lastMultiDeviceDekHex;
      _hasFetchedRemoteTip = true;
      return 'Backed up ${summary.uploadedBlobs} blob${summary.uploadedBlobs == 1 ? '' : 's'} (tip ${summary.tipEventId != null ? _shortHex(summary.tipEventId!) : 'published'}).';
    }

    // Android Amber (NIP-55) or NIP-46 Bunker step-by-step publish flow.
    final ownerPk = widget.account?.pubkey.trim();
    if (ownerPk == null || ownerPk.isEmpty) {
      throw StateError('Sign in to back up Circles.');
    }
    final encryptSelf = widget.onNip44EncryptSelf;
    final signEvent = widget.onSignUnsignedEvent;
    if (encryptSelf == null ||
        signEvent == null ||
        widget.onUploadBlossomBlob == null) {
      throw StateError(
        'Self-NIP-44 encryption, Blossom upload, and event signing callbacks are not available for this session.',
      );
    }

    // Best-effort check for an existing remote tip before first publish so we
    // reuse its DEK and preserve groups published from other devices.
    if (!_hasFetchedRemoteTip && widget.onNip44DecryptSelf != null) {
      _hasFetchedRemoteTip = true;
      try {
        final remoteFetched = await fetchMultiDeviceTipEvent(
          ownerPubkeyHex: ownerPk,
          relayUrls: widget.relayUrls,
        );
        if (remoteFetched != null) {
          final remotePlain =
              await widget.onNip44DecryptSelf!(remoteFetched.encryptedContent);
          _cacheRemoteTipPointersFromJson(remotePlain);
        }
      } catch (_) {}
    }

    final prepared = await prepareMultiDevicePublish(
      databasePath: widget.mlsDatabasePath,
      ownerPubkeyHex: ownerPk,
      blossomServerUrl: widget.blossomServerUrl,
      existingDekHex: _lastMultiDeviceDekHex,
    );
    final primaryServer = prepared.blossomServers.isNotEmpty
        ? prepared.blossomServers.first
        : widget.blossomServerUrl.replaceAll(RegExp(r'/+$'), '');

    final groupPointers = <String, Map<String, Object?>>{};
    Map<String, Object?>? metaPointer;
    var uploadedCount = 0;

    for (final blob in prepared.blobs) {
      final uploaded = await _uploadEncryptedBlobToBlossom(
        bytes: blob.encryptedBytes,
        sha256Hex: blob.xHex,
        mimeType: 'text/plain',
        purpose: 'Upload encrypted Circle sync snapshot',
        serverUrl: primaryServer,
      );
      final canonicalUrl = '$primaryServer/${blob.xHex}';
      final urls = <String>[
        uploaded.url,
        if (uploaded.url != canonicalUrl) canonicalUrl,
      ];
      final pointer = <String, Object?>{
        'x': blob.xHex,
        'urls': urls,
        'issuedAt': blob.issuedAt.toInt(),
      };
      if (blob.kind == 'group' && blob.gid != null) {
        groupPointers[blob.gid!] = pointer;
      } else if (blob.kind == 'meta') {
        metaPointer = pointer;
      }
      uploadedCount += 1;
    }

    // Preserve any non-deleted remote group pointers from other devices when
    // using the same DEK so auto-backup never clobbers another device's groups.
    if (_lastMultiDeviceDekHex == null ||
        _lastMultiDeviceDekHex == prepared.dekHex) {
      for (final entry in _knownRemoteGroupPointers.entries) {
        if (!groupPointers.containsKey(entry.key) &&
            !_locallyDeletedGroupIds.contains(entry.key)) {
          groupPointers[entry.key] = entry.value;
        }
      }
    }

    final tipPlaintext = await buildMultiDeviceTipPlaintext(
      dekHex: prepared.dekHex,
      blossomServers: prepared.blossomServers,
      groupPointersJson: jsonEncode(groupPointers),
      metaPointerJson: metaPointer != null ? jsonEncode(metaPointer) : null,
    );
    final encryptedTip = await encryptSelf(tipPlaintext);
    final unsignedTip = await prepareUnsignedMultiDeviceTipEvent(
      ownerPubkeyHex: ownerPk,
      encryptedTipContent: encryptedTip,
    );
    final signedTip = await signEvent(unsignedTip);
    final eventId = await publishSignedMultiDeviceTipEvent(
      signedEventJson: signedTip,
      relayUrls: widget.relayUrls,
    );

    _lastMultiDeviceDekHex = prepared.dekHex;
    _knownRemoteGroupPointers
      ..clear()
      ..addAll(groupPointers);
    return 'Backed up $uploadedCount blob${uploadedCount == 1 ? '' : 's'} (tip ${_shortHex(eventId)}).';
  }

  Future<void> _backupMultiDevice() async {
    await _runAction(
      'Sealing & backing up Circles to Blossom…',
      requireRustBridge: widget.onBackupMultiDevice == null,
      requireExternalSigner: false,
      () async {
        final status = await _publishMultiDeviceSnapshotCore(
          allowExternalInit: false,
        );
        if (mounted && status != null) {
          setState(() {
            _multiDeviceStatus = status;
            _info = status;
          });
        }
      },
    );
  }

  Future<void> _pullMultiDevice() => _recoverGroupsFromRelays(automatic: false);

  Future<void> _recoverGroupsFromRelays({required bool automatic}) async {
    if (automatic && widget.onPullMultiDevice == null) {
      try {
        await RustBridge.ensureInitialized();
      } catch (_) {
        // Headless widget tests disable RustBridge unless onPullMultiDevice is provided.
        return;
      }
    }

    if (automatic) {
      if (!mounted) return;
      setState(() {
        _busy = true;
        _busyLabel = 'Checking relays for encrypted MLS groups…';
      });
    } else {
      setState(() {
        _busy = true;
        _busyLabel = 'Recovering encrypted MLS groups & welcomes from relays…';
        _error = null;
        _info = null;
      });
    }

    try {
      if (widget.onPullMultiDevice == null) {
        await RustBridge.ensureInitialized();
      }

      MultiDeviceSyncSummaryDto? summary;
      var acceptedWelcomeCount = 0;

      if (widget.onPullMultiDevice != null) {
        summary = await widget.onPullMultiDevice!();
      } else {
        final ownerPk = widget.account?.pubkey.trim();
        if (ownerPk == null || ownerPk.isEmpty) {
          if (!automatic) {
            throw StateError('Sign in to recover MLS groups from relays.');
          }
          return;
        }
        final nsec = widget.localNsec?.trim();
        if (nsec != null && nsec.isNotEmpty) {
          summary = await syncMultiDeviceDirect(
            databasePath: widget.mlsDatabasePath,
            signerNsec: nsec,
            relayUrls: widget.relayUrls,
          );
          _hasFetchedRemoteTip = true;
        } else {
          // Android Amber (NIP-55) or NIP-46 Bunker recovery flow:
          // 1. Public read of kind 30078 tip event (ZERO signer prompts).
          final fetched = await fetchMultiDeviceTipEvent(
            ownerPubkeyHex: ownerPk,
            relayUrls: widget.relayUrls,
          );
          _hasFetchedRemoteTip = true;
          if (fetched != null) {
            final decryptSelf = widget.onNip44DecryptSelf;
            if (decryptSelf == null) {
              if (!automatic) {
                throw StateError(
                  'Self-NIP-44 decryption is not available for this session.',
                );
              }
            } else {
              final tipPlaintext = await decryptSelf(fetched.encryptedContent);
              _cacheRemoteTipPointersFromJson(tipPlaintext);
              summary = await applyDecryptedMultiDeviceTip(
                databasePath: widget.mlsDatabasePath,
                ownerPubkeyHex: ownerPk,
                tipPlaintextJson: tipPlaintext,
              );
            }
          }

          // 2. Scan Cordn pending/historical welcomes whenever triggered manually,
          //    when local pending joins exist, or when a backup snapshot was found.
          final shouldScanWelcomes = !automatic ||
              widget.pendingJoins.isNotEmpty ||
              fetched != null;
          if (shouldScanWelcomes) {
            try {
              if (widget.onEnsureExternalSigner != null) {
                await widget.onEnsureExternalSigner!();
              }
              final welcomed = await acceptCircleWelcomes(
                databasePath: widget.mlsDatabasePath,
                signerNsec: widget.localNsec,
                bunkerUri: widget.bunkerUri,
                bunkerClientNsec: widget.bunkerClientNsec,
              );
              acceptedWelcomeCount = welcomed.length;
              for (final ws in welcomed) {
                widget.onWorkspaceUpdated(ws);
              }
            } catch (_) {
              // Welcome scan is best-effort during multi-device recovery.
            }
          }
        }

        // 3. Catch up recovered workspaces from Cordn read-only (ZERO Amber prompts).
        if ((summary != null && summary.workspaces.isNotEmpty) ||
            acceptedWelcomeCount > 0) {
          try {
            final synced = await syncAllCircleWorkspacesReadonly(
              databasePath: widget.mlsDatabasePath,
              ownerPubkeyHex: ownerPk,
            );
            for (final ws in synced) {
              widget.onWorkspaceUpdated(ws);
            }
          } catch (_) {}
        }
      }

      if (summary != null) {
        _lastMultiDeviceDekHex = summary.dekHex ?? _lastMultiDeviceDekHex;
        for (final ws in summary.workspaces) {
          widget.onWorkspaceUpdated(ws);
        }
      }
      await widget.onRefreshCircles();

      final totalAdopted =
          (summary?.adoptedGroups ?? 0) + acceptedWelcomeCount;
      final totalUpdated = summary?.updatedGroups ?? 0;
      final totalMerged = summary?.mergedGroups ?? 0;
      final totalRemoved = summary?.removedGroupsMarked ?? 0;
      final warnings = summary?.skippedErrors ?? const <String>[];
      final foundTip = summary != null &&
          (summary.tipEventId != null ||
              summary.dekHex != null ||
              summary.adoptedGroups > 0 ||
              summary.updatedGroups > 0 ||
              summary.unchangedGroups > 0);

      final parts = <String>[
        '$totalAdopted adopted',
        if (totalUpdated > 0 || !automatic) '$totalUpdated updated',
        if (totalMerged > 0 || !automatic) '$totalMerged merged',
        if (totalRemoved > 0) '$totalRemoved removed',
        if (warnings.isNotEmpty)
          '${warnings.length} warning${warnings.length == 1 ? '' : 's'}',
      ];

      String? statusMessage;
      if (totalAdopted > 0 || totalUpdated > 0 || totalMerged > 0) {
        statusMessage = 'Recovered Circles from relays: ${parts.join(' · ')}.';
      } else if (foundTip) {
        statusMessage = automatic
            ? null
            : 'Pulled Circles: ${parts.join(' · ')}.';
      } else if (!automatic) {
        statusMessage =
            'No encrypted group backup or pending welcomes found on relays yet.';
      }

      if (mounted) {
        setState(() {
          if (statusMessage != null) {
            _multiDeviceStatus = statusMessage;
            _info = statusMessage;
          }
          if (!automatic && warnings.isNotEmpty) {
            _error = warnings.join('\n');
          }
        });
      }
    } catch (err) {
      if (!automatic && mounted) {
        setState(() => _error = err.toString());
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyLabel = null;
        });
      }
    }
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
      _scheduleAutoBackupMultiDevice('member approved');
    });
  }

  Future<void> _sendMessage() async {
    final ws = _selectedWorkspace;
    if (ws == null) return;
    final text = _chatInputController.text.trim();
    final hasGeo = _attachDraftGeometry && widget.hasDraftGeometry;
    final hasMedia = _stagedAttachments.isNotEmpty;
    if (text.isEmpty && !hasGeo && !hasMedia) {
      return;
    }
    await _runAction(
      hasMedia
          ? 'Encrypting attachment & posting to Cordn…'
          : 'Encrypting & posting to Cordn…',
      () async {
        CircleWorkspaceDto updated;
        if (hasMedia) {
          final imetaTags = <List<String>>[];
          for (final file in List<PickedBinaryFile>.from(_stagedAttachments)) {
            final tag = await _encryptAndUploadAttachment(
              workspaceId: ws.workspaceId,
              file: file,
              persistentForMap: false,
            );
            imetaTags.add(tag);
          }
          if (widget.onSendCircleCommentWithMedia != null) {
            updated = await widget.onSendCircleCommentWithMedia!(
              ws.workspaceId,
              text,
              hasGeo,
              imetaTags,
            );
          } else {
            updated = await sendCircleCommentWithMedia(
              databasePath: widget.mlsDatabasePath,
              signerNsec: widget.localNsec,
              bunkerUri: widget.bunkerUri,
              bunkerClientNsec: widget.bunkerClientNsec,
              workspaceId: ws.workspaceId,
              text: text,
              geojsonJson: null,
              imetaTags: imetaTags,
            );
          }
        } else {
          updated = await widget.onSendCircleComment(
            ws.workspaceId,
            text,
            hasGeo,
          );
        }
        _chatInputController.clear();
        widget.onWorkspaceUpdated(updated);
        if (mounted) {
          setState(() {
            _attachDraftGeometry = false;
            _stagedAttachments.clear();
          });
        }
      },
    );
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
        _scheduleAutoBackupMultiDevice('admin policy updated');
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
      _scheduleAutoBackupMultiDevice('member removed');
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
      _locallyDeletedGroupIds.add(ws.groupId);
      _knownRemoteGroupPointers.remove(ws.groupId);
      if (!mounted) return;
      setState(() {
        _selectedWorkspaceId = null;
        _info = 'Deleted "${ws.name}" from this device.';
      });
      _scheduleAutoBackupMultiDevice('circle removed');
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
            'MLS Groups',
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const Spacer(),
          if (_hasSupportedSigner)
            IconButton(
              key: const Key('circles-header-recover-btn'),
              tooltip: 'Recover Groups from Relays',
              visualDensity: VisualDensity.compact,
              onPressed: _busy ? null : _pullMultiDevice,
              icon: const Icon(Icons.cloud_sync_outlined, size: 18),
            ),
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
          widget.isReadOnlySession
              ? 'Read-Only Account Active'
              : 'MLS Groups',
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(
          widget.isReadOnlySession
              ? 'Read-only watch sessions cannot sign MLS messages. Switch to Amber (NIP-55), a NIP-46 Remote Bunker, or a Local Key in Account.'
              : 'Sign in with Amber (NIP-55), a NIP-46 Remote Bunker, or a Local Key to create or join MLS-encrypted Groups (compatible with Earthly Web).',
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
                  hintText: 'Paste Circle invitation link or cordn1… ref…',
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

        if (_decodedCordnRefPreview != null) ...[
          const SizedBox(height: 10),
          Builder(
            builder: (_) {
              final ref = _decodedCordnRefPreview!;
              final existingWs = widget.workspaces
                  .where((w) => w.groupId == ref.gid)
                  .firstOrNull;
              return Container(
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
                      'CORDN GROUP REFERENCE (cordn1)',
                      style: theme.textTheme.labelSmall?.copyWith(
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w800,
                        color: EarthlyColors.measureViolet,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Group ID: ${_shortHex(ref.gid)}\n'
                      'Cordn: ${ref.coordinatorPubkey != null ? _shortHex(ref.coordinatorPubkey!) : 'Default coordinator'}\n'
                      'Relays: ${ref.relays.isNotEmpty ? ref.relays.join(", ") : 'Default relay'}',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (existingWs != null)
                      FilledButton.icon(
                        onPressed: () {
                          setState(() {
                            _selectedWorkspaceId = existingWs.workspaceId;
                            _decodedCordnRefPreview = null;
                          });
                          unawaited(_backgroundSyncSelected());
                        },
                        icon: const Icon(Icons.lock_open_outlined, size: 16),
                        label: Text('Open "${existingWs.name}"'),
                      )
                    else ...[
                      Text(
                        'Already welcomed? Check Cordn below. New joiners need a signed 24h invitation link from a Circle admin.',
                        style: theme.textTheme.bodySmall,
                      ),
                      const SizedBox(height: 6),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _checkApprovals,
                        icon: const Icon(Icons.refresh, size: 15),
                        label: const Text('Check Approved Welcomes'),
                      ),
                    ],
                  ],
                ),
              );
            },
          ),
        ],

        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest
                .withValues(alpha: 0.6),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: theme.dividerColor),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              InkWell(
                key: const Key('circles-multi-device-tile'),
                borderRadius: BorderRadius.circular(12),
                onTap: () => setState(
                  () => _showMultiDevicePanel = !_showMultiDevicePanel,
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.devices_outlined,
                        size: 16,
                        color: EarthlyColors.measureViolet,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Multi-Device Sync',
                          style: theme.textTheme.labelMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Icon(
                        _showMultiDevicePanel
                            ? Icons.expand_less
                            : Icons.expand_more,
                        size: 18,
                      ),
                    ],
                  ),
                ),
              ),
              if (_showMultiDevicePanel)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'End-to-end encrypted MLS snapshot via Blossom + NIP-78 (cordn-md-tip-v1). Syncs Circles across Android, macOS, and Earthly Web.',
                        style: theme.textTheme.bodySmall,
                      ),
                      if (_multiDeviceStatus != null) ...[
                        const SizedBox(height: 6),
                        Text(
                          _multiDeviceStatus!,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10.5,
                            color: EarthlyColors.commentGreen,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: FilledButton.tonalIcon(
                              key: const Key('circles-multi-device-backup-btn'),
                              onPressed: _busy ? null : _backupMultiDevice,
                              icon: const Icon(Icons.cloud_upload_outlined, size: 16),
                              label: const Text('Backup to Devices'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton.icon(
                              key: const Key('circles-multi-device-pull-btn'),
                              onPressed: _busy ? null : _pullMultiDevice,
                              icon: const Icon(Icons.cloud_download_outlined, size: 16),
                              label: const Text('Pull from Devices'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),

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
          Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest
                  .withValues(alpha: 0.55),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: theme.dividerColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'No Circles on this device yet. After an app update or new sign-in, recover your encrypted MLS groups and pending welcomes from Nostr relays, or create/join a Circle above.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall,
                ),
                const SizedBox(height: 10),
                FilledButton.tonalIcon(
                  key: const Key('circles-empty-recover-btn'),
                  onPressed: _busy ? null : _pullMultiDevice,
                  icon: const Icon(Icons.cloud_download_outlined, size: 17),
                  label: const Text('Recover Groups from Relays'),
                ),
              ],
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
                  '${ws.role} · ${ws.members.length} member${ws.members.length == 1 ? '' : 's'} · ${ws.datasets.length} map${ws.datasets.length == 1 ? '' : 's'} · e${ws.epoch}${ws.syncHealth == 'behind' || ws.syncHealth == 'forked' ? ' · ⚠ ${ws.syncHealth}' : ''}',
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

  Widget _buildSyncHealthBanner(ThemeData theme, CircleWorkspaceDto ws) {
    if (ws.syncHealth != 'behind' && ws.syncHealth != 'forked') {
      return const SizedBox.shrink();
    }
    final isForked = ws.syncHealth == 'forked';
    final accent = isForked ? EarthlyColors.destructive : EarthlyColors.amber;
    final detail = isForked
        ? 'MLS state diverged (${ws.consecutiveDecryptErrors} decrypt error${ws.consecutiveDecryptErrors == 1 ? '' : 's'}). Repair resets transient journals and re-syncs from Cordn.'
        : 'Circle sync is behind (${ws.consecutiveDecryptErrors} decrypt error${ws.consecutiveDecryptErrors == 1 ? '' : 's'}). Repair & re-sync to catch up.';
    return Container(
      key: const Key('circle-sync-health-banner'),
      margin: const EdgeInsets.fromLTRB(14, 8, 14, 4),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: accent.withValues(alpha: 0.65)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            isForked ? Icons.warning_amber_rounded : Icons.sync_problem,
            size: 18,
            color: accent,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isForked ? 'SYNC STATE FORKED' : 'CIRCLE SYNC BEHIND',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    color: accent,
                  ),
                ),
                const SizedBox(height: 2),
                Text(detail, style: const TextStyle(fontSize: 11.5)),
                const SizedBox(height: 6),
                OutlinedButton.icon(
                  key: const Key('circle-repair-sync-btn'),
                  onPressed: _busy ? null : () => _repairSyncState(ws),
                  icon: const Icon(Icons.build_circle_outlined, size: 15),
                  label: const Text('Repair & Re-sync'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMediaAttachments(
    ThemeData theme,
    CircleWorkspaceDto ws,
    List<CircleMediaAttachmentDto> attachments,
    BigInt? epoch,
  ) {
    if (attachments.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final att in attachments) ...[
            Builder(
              builder: (_) {
                final key = _mediaCacheKey(att);
                final isImage = att.mimeType.toLowerCase().startsWith('image/');
                final decrypted = _decryptedMediaCache[key];
                final loading = _decryptingMediaKeys.contains(key);
                final err = _mediaErrors[key];

                if (isImage) {
                  if (decrypted == null && !loading && err == null) {
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      if (mounted) _ensureImageDecrypted(ws, att, epoch);
                    });
                  }
                  if (decrypted != null) {
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: InkWell(
                        key: Key('circle-media-thumb-${att.sha256Hex}'),
                        borderRadius: BorderRadius.circular(10),
                        onTap: () => unawaited(_openImageLightbox(att, decrypted)),
                        child: Stack(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(10),
                              child: Image.memory(
                                decrypted,
                                width: 184,
                                height: 124,
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) => Container(
                                  width: 184,
                                  height: 92,
                                  color: EarthlyColors.measureViolet
                                      .withValues(alpha: 0.12),
                                  padding: const EdgeInsets.all(10),
                                  child: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      const Icon(
                                        Icons.image_outlined,
                                        color: EarthlyColors.measureViolet,
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        att.filename,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(fontSize: 11),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            Positioned(
                              left: 6,
                              bottom: 6,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.black.withValues(alpha: 0.65),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(
                                      Icons.lock,
                                      size: 10,
                                      color: Colors.white,
                                    ),
                                    const SizedBox(width: 3),
                                    Text(
                                      att.version,
                                      style: const TextStyle(
                                        fontFamily: 'monospace',
                                        fontSize: 9,
                                        color: Colors.white,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }
                  if (err != null) {
                    return Container(
                      margin: const EdgeInsets.only(bottom: 6),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: EarthlyColors.destructive.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(9),
                        border: Border.all(
                          color: EarthlyColors.destructive.withValues(alpha: 0.4),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.broken_image_outlined,
                            size: 16,
                            color: EarthlyColors.destructive,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              '${att.filename} · decrypt failed',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 11),
                            ),
                          ),
                          TextButton(
                            onPressed: () => _retryDecryptImage(ws, att, epoch),
                            child: const Text('Retry'),
                          ),
                        ],
                      ),
                    );
                  }
                  return Container(
                    width: 184,
                    height: 84,
                    margin: const EdgeInsets.only(bottom: 6),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: theme.dividerColor),
                    ),
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Decrypting ${att.version}…',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 9.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }

                // Non-image encrypted file card.
                return Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: EarthlyColors.measureViolet.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(9),
                    border: Border.all(
                      color: EarthlyColors.measureViolet.withValues(alpha: 0.35),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.insert_drive_file_outlined,
                        size: 16,
                        color: EarthlyColors.measureViolet,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              att.filename,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Wrap(
                              spacing: 4,
                              runSpacing: 2,
                              children: [
                                EarthlyBadge(
                                  label: att.mimeType,
                                  color: theme.colorScheme.secondary,
                                ),
                                EarthlyBadge(
                                  label: att.version,
                                  color: EarthlyColors.measureViolet,
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 6),
                      loading
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : TextButton.icon(
                              onPressed: () =>
                                  unawaited(_decryptAndSaveFile(ws, att, epoch)),
                              icon: const Icon(Icons.download_outlined, size: 15),
                              label: Text(
                                decrypted != null ? 'Save' : 'Decrypt & Save',
                              ),
                            ),
                    ],
                  ),
                );
              },
            ),
          ],
        ],
      ),
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
        _buildSyncHealthBanner(theme, ws),
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
                  padding: const EdgeInsets.fromLTRB(14, 4, 14, 12),
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
                          EarthlyRichText(text: msg.text, compact: true),
                        ],
                        if (msg.mediaAttachments.isNotEmpty)
                          _buildMediaAttachments(
                            theme,
                            ws,
                            msg.mediaAttachments,
                            msg.epoch,
                          ),
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
              if (_stagedAttachments.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (var i = 0; i < _stagedAttachments.length; i++)
                        InputChip(
                          avatar: _stagedAttachments[i]
                                  .mimeType
                                  .toLowerCase()
                                  .startsWith('image/')
                              ? ClipRRect(
                                  borderRadius: BorderRadius.circular(4),
                                  child: Image.memory(
                                    _stagedAttachments[i].bytes,
                                    width: 22,
                                    height: 22,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, _, _) => const Icon(
                                      Icons.image_outlined,
                                      size: 16,
                                    ),
                                  ),
                                )
                              : const Icon(Icons.insert_drive_file_outlined, size: 16),
                          label: Text(
                            '${_stagedAttachments[i].name} (${_formatByteSize(_stagedAttachments[i].bytes.length)})',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          onDeleted: _busy
                              ? null
                              : () => setState(
                                    () => _stagedAttachments.removeAt(i),
                                  ),
                        ),
                    ],
                  ),
                ),
              Row(
                children: [
                  PopupMenuButton<_AttachmentSource>(
                    key: const Key('circle-chat-attach-btn'),
                    tooltip: 'Attach encrypted media (cordn-em-v1)',
                    enabled: ws.status == 'active' && !_busy,
                    onSelected: (source) => unawaited(_stageChatAttachment(source)),
                    itemBuilder: (_) => [
                      if (Platform.isAndroid)
                        const PopupMenuItem(
                          value: _AttachmentSource.camera,
                          child: ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            leading: Icon(Icons.photo_camera_outlined, size: 18),
                            title: Text('Take Photo'),
                          ),
                        ),
                      const PopupMenuItem(
                        value: _AttachmentSource.image,
                        child: ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(Icons.photo_library_outlined, size: 18),
                          title: Text('Pick Image'),
                        ),
                      ),
                      const PopupMenuItem(
                        value: _AttachmentSource.file,
                        child: ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(Icons.attach_file, size: 18),
                          title: Text('Pick File'),
                        ),
                      ),
                    ],
                    icon: const Icon(Icons.attach_file, size: 20),
                  ),
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
              if (widget.account != null &&
                  widget.account!.pubkey.toLowerCase() ==
                      ds.pubkey.toLowerCase())
                EntityRowMenuAction(
                  label: 'Edit Map in Desk',
                  icon: Icons.edit_outlined,
                  onSelected: () => widget.onEditDatasetInDraft(ws, ds),
                )
              else ...[
                EntityRowMenuAction(
                  label: 'Propose Edit',
                  icon: Icons.compare_arrows,
                  onSelected: () => (widget.onProposeDatasetEdit ??
                      widget.onEditDatasetInDraft)(ws, ds),
                ),
                EntityRowMenuAction(
                  label: 'Create Copy in Desk',
                  icon: Icons.copy_all_outlined,
                  onSelected: () => (widget.onCopyDatasetToDraft ??
                      widget.onEditDatasetInDraft)(ws, ds),
                ),
              ],
              if (ws.status == 'active')
                EntityRowMenuAction(
                  label: 'Attach Encrypted Map Media',
                  icon: Icons.attach_file,
                  onSelected: () => unawaited(_attachPersistentMapMedia(ws, ds)),
                ),
            ],
          ),
          if (ds.mediaAttachments.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: _buildMediaAttachments(
                theme,
                ws,
                ds.mediaAttachments,
                ds.epoch,
              ),
            ),
          for (final prop in ws.proposals.where(
            (p) =>
                p.targetDatasetId == ds.datasetId &&
                p.targetAuthorPubkey.toLowerCase() == ds.pubkey.toLowerCase(),
          ))
            _buildProposalCard(
              theme,
              ws,
              prop,
              isDatasetOwner: widget.account != null &&
                  widget.account!.pubkey.toLowerCase() ==
                      ds.pubkey.toLowerCase(),
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
    final isAdmin = _isWorkspaceAdmin(ws);
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
        if (ws.cordnGroupRef.isNotEmpty) ...[
          const SizedBox(height: 12),
          Container(
            key: const Key('circle-cordn-group-ref-card'),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest
                  .withValues(alpha: 0.65),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: theme.dividerColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'CORDN GROUP REF (cordn1…)',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelSmall?.copyWith(
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    TextButton.icon(
                      key: const Key('circle-copy-cordn-ref-btn'),
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                      ),
                      onPressed: () {
                        Clipboard.setData(
                          ClipboardData(text: ws.cordnGroupRef),
                        );
                        setState(
                          () => _info = 'Copied cordn1 group reference.',
                        );
                      },
                      icon: const Icon(Icons.copy, size: 14),
                      label: const Text('Copy cordn1…'),
                    ),
                  ],
                ),
                SelectableText(
                  ws.cordnGroupRef,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
        ],
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
        if (isAdmin) ...[
          const SizedBox(height: 12),
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: theme.dividerColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Material(
                  type: MaterialType.transparency,
                  child: SwitchListTile(
                    key: const Key('circle-auto-approve-switch'),
                    dense: true,
                    title: const Text(
                      'Auto-approve join requests',
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                    subtitle: const Text(
                      'Automatically welcome invited joiners when polling requests.',
                      style: TextStyle(fontSize: 11),
                    ),
                    value: ws.autoApproveJoins,
                    onChanged: _busy
                        ? null
                        : (enabled) => unawaited(_toggleAutoApprove(ws, enabled)),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                  child: OutlinedButton.icon(
                    key: const Key('circle-approve-pending-now-btn'),
                    onPressed:
                        _busy ? null : () => unawaited(_pollAndAutoApprove(ws)),
                    icon: const Icon(Icons.how_to_reg_outlined, size: 16),
                    label: const Text('Approve Pending Now'),
                  ),
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
            'HEALTH: ${ws.syncHealth.toUpperCase()}${ws.consecutiveDecryptErrors > 0 ? ' (${ws.consecutiveDecryptErrors} err)' : ''}\n'
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
