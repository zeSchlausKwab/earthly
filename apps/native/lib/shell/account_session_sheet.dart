import 'dart:io';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/nip55_signer.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/blossom.dart';
import '../src/rust/api/nip46.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../src/rust/api/settings.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'map_drawer.dart';

@immutable
class ProfileEditRequest {
  const ProfileEditRequest({
    required this.name,
    required this.displayName,
    required this.about,
    required this.picture,
    required this.nip05,
  });

  final String name;
  final String displayName;
  final String about;
  final String picture;
  final String nip05;
}

/// Dedicated Account & Session drawer opened from the top-bar account pill.
/// Supports Android NIP-55 Amber, `nsec1...` key import, persisted local keypair
/// generation, resolved Nostr `kind 0` profile preview & live profile editor,
/// and active Field Session status.
class AccountSessionSheet extends StatefulWidget {
  const AccountSessionSheet({
    required this.account,
    required this.localNsec,
    required this.profile,
    required this.activeSessionSummary,
    required this.onAccountChanged,
    required this.onLocalKeyChanged,
    required this.onSaveProfile,
    required this.onOpenSpaces,
    required this.onClose,
    this.bunkerUri,
    this.onBunkerConnected,
    this.savedAccounts = const [],
    this.activeAccountId,
    this.profilesByPubkey = const {},
    this.onSwitchSession,
    this.onRemoveSession,
    this.onAddReadOnlyNpub,
    this.blossomServerUrl = 'https://blossom.earthly.city',
    this.onBlossomServerChanged,
    this.onUploadBlossomImage,
    super.key,
  });

  final Nip55Account? account;
  final String? localNsec;
  final String? bunkerUri;
  final List<SavedAccountSessionDto> savedAccounts;
  final String? activeAccountId;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final ValueChanged<SavedAccountSessionDto>? onSwitchSession;
  final ValueChanged<String>? onRemoveSession;
  final ValueChanged<String>? onAddReadOnlyNpub;
  final String blossomServerUrl;
  final ProfileMetadataDto? profile;
  final String? activeSessionSummary;
  final ValueChanged<Nip55Account?> onAccountChanged;
  final ValueChanged<LocalKeypairDto?> onLocalKeyChanged;
  final ValueChanged<Nip46ConnectionDto?>? onBunkerConnected;
  final ValueChanged<String>? onBlossomServerChanged;
  final Future<BlossomUploadDto?> Function(String purpose)?
      onUploadBlossomImage;
  final Future<PublishOutcomeDto> Function(ProfileEditRequest req)
      onSaveProfile;
  final VoidCallback onOpenSpaces;
  final VoidCallback onClose;

  @override
  State<AccountSessionSheet> createState() => _AccountSessionSheetState();
}

class _AccountSessionSheetState extends State<AccountSessionSheet> {
  final _nsecController = TextEditingController();
  final _bunkerController = TextEditingController();
  final _readonlyNpubController = TextEditingController();
  late final TextEditingController _blossomController =
      TextEditingController(text: widget.blossomServerUrl);
  late final TextEditingController _displayNameController;
  late final TextEditingController _nameController;
  late final TextEditingController _aboutController;
  late final TextEditingController _pictureController;
  late final TextEditingController _nip05Controller;

  bool _amberInstalled = false;
  bool _busy = false;
  bool _uploadingAvatar = false;
  bool _showImport = false;
  bool _showBunker = false;
  bool _showReadOnly = false;
  bool _editingProfile = false;
  String? _error;
  String? _info;

  @override
  void initState() {
    super.initState();
    _displayNameController =
        TextEditingController(text: widget.profile?.displayName ?? '');
    _nameController = TextEditingController(text: widget.profile?.name ?? '');
    _aboutController = TextEditingController(text: widget.profile?.about ?? '');
    _pictureController =
        TextEditingController(text: widget.profile?.picture ?? '');
    _nip05Controller = TextEditingController(text: widget.profile?.nip05 ?? '');
    _checkAmber();
  }

  @override
  void didUpdateWidget(covariant AccountSessionSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.profile != widget.profile && !_editingProfile) {
      _displayNameController.text = widget.profile?.displayName ?? '';
      _nameController.text = widget.profile?.name ?? '';
      _aboutController.text = widget.profile?.about ?? '';
      _pictureController.text = widget.profile?.picture ?? '';
      _nip05Controller.text = widget.profile?.nip05 ?? '';
    }
  }

  @override
  void dispose() {
    _nsecController.dispose();
    _bunkerController.dispose();
    _readonlyNpubController.dispose();
    _blossomController.dispose();
    _displayNameController.dispose();
    _nameController.dispose();
    _aboutController.dispose();
    _pictureController.dispose();
    _nip05Controller.dispose();
    super.dispose();
  }

  Future<void> _checkAmber() async {
    if (!Platform.isAndroid) return;
    final ok = await Nip55Signer.isSignerInstalled();
    if (mounted) setState(() => _amberInstalled = ok);
  }

  Future<void> _signInAmber() async {
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      final acct = await Nip55Signer.getPublicKey();
      if (!mounted) return;
      widget.onAccountChanged(acct);
      setState(() => _info = 'Connected to Amber NIP-55 signer.');
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _createLocalKey() async {
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final kp = await generateLocalNostrKeypair();
      if (!mounted) return;
      widget.onLocalKeyChanged(kp);
      setState(() => _info = 'Created & saved persistent local Nostr keypair.');
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _importNsec() async {
    final raw = _nsecController.text.trim();
    if (raw.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final kp = await importLocalNostrNsec(nsecOrHex: raw);
      if (!mounted) return;
      _nsecController.clear();
      widget.onLocalKeyChanged(kp);
      setState(() {
        _showImport = false;
        _info = 'Imported identity & persisted to SQLite.';
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _connectBunker() async {
    final uri = _bunkerController.text.trim();
    if (uri.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final conn = await connectNip46Bunker(bunkerUri: uri);
      if (!mounted) return;
      _bunkerController.clear();
      widget.onBunkerConnected?.call(conn);
      setState(() {
        _showBunker = false;
        _info = 'Connected to NIP-46 remote bunker (${conn.relays.length} relay).';
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _scanBunkerQr() async {
    try {
      final scanned = await DeviceBridge.scanQrCode();
      if (!mounted) return;
      _bunkerController.text = scanned.trim();
      setState(() => _showBunker = true);
      await _connectBunker();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    }
  }

  Future<void> _addReadOnlySession() async {
    final raw = _readonlyNpubController.text.trim();
    if (raw.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final hex = await decodeNpubToHex(pubkeyOrNpub: raw);
      if (hex == null || hex.isEmpty) {
        throw StateError('Enter a valid npub1…, nprofile1…, or 64-char hex key.');
      }
      if (!mounted) return;
      _readonlyNpubController.clear();
      widget.onAddReadOnlyNpub?.call(hex);
      setState(() {
        _showReadOnly = false;
        _info = 'Added read-only watch session.';
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _sessionKindLabel(String kind) => switch (kind) {
        'bunker' => 'NIP-46 Bunker',
        'local' => 'Local Key',
        'amber' => 'Amber NIP-55',
        'readonly' => 'Read-only',
        _ => kind,
      };

  String _sessionDisplayName(SavedAccountSessionDto session) {
    final prof = widget.profilesByPubkey[session.pubkeyHex];
    final name = prof?.displayName ?? prof?.name ?? session.label;
    if (name != null && name.trim().isNotEmpty) return name.trim();
    final pk = session.pubkeyHex;
    return pk.length > 14 ? '${pk.substring(0, 8)}…${pk.substring(pk.length - 4)}' : pk;
  }

  Widget _buildAddAccountControls(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (Platform.isAndroid) ...[
          FilledButton.icon(
            onPressed: (_busy || !_amberInstalled) ? null : _signInAmber,
            icon: const Icon(Icons.key, size: 18),
            label: Text(
              _amberInstalled
                  ? 'Sign in with Amber (NIP-55)'
                  : 'Amber signer not installed',
            ),
          ),
          const SizedBox(height: 8),
        ],
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.tonalIcon(
              onPressed: _busy ? null : _createLocalKey,
              icon: const Icon(Icons.vpn_key_outlined, size: 16),
              label: const Text('Create Local Key'),
            ),
            OutlinedButton.icon(
              onPressed: () => setState(() {
                _showImport = !_showImport;
                if (_showImport) {
                  _showBunker = false;
                  _showReadOnly = false;
                }
              }),
              icon: const Icon(Icons.login, size: 16),
              label: const Text('Import nsec1…'),
            ),
            OutlinedButton.icon(
              onPressed: () => setState(() {
                _showBunker = !_showBunker;
                if (_showBunker) {
                  _showImport = false;
                  _showReadOnly = false;
                }
              }),
              icon: const Icon(Icons.cloud_done_outlined, size: 16),
              label: const Text('Connect Bunker (NIP-46)'),
            ),
            if (widget.onAddReadOnlyNpub != null)
              OutlinedButton.icon(
                onPressed: () => setState(() {
                  _showReadOnly = !_showReadOnly;
                  if (_showReadOnly) {
                    _showImport = false;
                    _showBunker = false;
                  }
                }),
                icon: const Icon(Icons.visibility_outlined, size: 16),
                label: const Text('Watch npub1…'),
              ),
          ],
        ),
        if (_showImport) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _nsecController,
                  obscureText: true,
                  onSubmitted: (_) => _importNsec(),
                  decoration: const InputDecoration(
                    hintText: 'Paste nsec1… or 64-char hex',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _busy ? null : _importNsec,
                child: const Text('Import'),
              ),
            ],
          ),
        ],
        if (_showBunker) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _bunkerController,
                  onSubmitted: (_) => _connectBunker(),
                  decoration: const InputDecoration(
                    hintText: 'bunker://<pubkey>?relay=wss://…&secret=…',
                  ),
                ),
              ),
              if (Platform.isAndroid) ...[
                const SizedBox(width: 6),
                IconButton(
                  tooltip: 'Scan bunker QR',
                  onPressed: _busy ? null : _scanBunkerQr,
                  icon: const Icon(Icons.qr_code_scanner, size: 20),
                ),
              ],
              const SizedBox(width: 6),
              FilledButton(
                onPressed: _busy ? null : _connectBunker,
                child: _busy
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Connect'),
              ),
            ],
          ),
        ],
        if (_showReadOnly) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _readonlyNpubController,
                  onSubmitted: (_) => _addReadOnlySession(),
                  decoration: const InputDecoration(
                    hintText: 'Paste npub1… (read-only watch session)',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _busy ? null : _addReadOnlySession,
                child: const Text('Add'),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Future<void> _publishProfile() async {
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      final outcome = await widget.onSaveProfile(
        ProfileEditRequest(
          name: _nameController.text.trim(),
          displayName: _displayNameController.text.trim(),
          about: _aboutController.text.trim(),
          picture: _pictureController.text.trim(),
          nip05: _nip05Controller.text.trim(),
        ),
      );
      if (!mounted) return;
      setState(() {
        _editingProfile = false;
        _info =
            'Published profile (kind 0) · ${outcome.outboxState.toUpperCase()}';
      });
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
    final profile = widget.profile;
    final displayName = profile?.displayName ?? profile?.name;

    return EarthlyMapDrawer(
      initialFraction: 0.54,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            const Icon(Icons.account_circle_outlined, size: 18),
            const SizedBox(width: 8),
            Text(
              'ACCOUNT & SESSION',
              style: theme.textTheme.labelLarge?.copyWith(
                fontFamily: 'monospace',
                letterSpacing: 0.7,
              ),
            ),
            const Spacer(),
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
          if (_info != null) ...[
            Container(
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
            const SizedBox(height: 10),
          ],
          if (_error != null) ...[
            Container(
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
            const SizedBox(height: 10),
          ],

          if (account != null) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: EarthlyColors.commentGreen.withValues(alpha: 0.55),
                ),
                color: EarthlyColors.commentGreen.withValues(alpha: 0.08),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 22,
                        backgroundColor:
                            EarthlyColors.amber.withValues(alpha: 0.22),
                        backgroundImage: (profile?.picture != null &&
                                profile!.picture!.startsWith('http'))
                            ? NetworkImage(profile.picture!)
                            : null,
                        child: (profile?.picture == null ||
                                !profile!.picture!.startsWith('http'))
                            ? const Icon(Icons.person, size: 22)
                            : null,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              displayName ?? account.shortLabel,
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Builder(
                              builder: (_) {
                                final activeSession = widget.savedAccounts
                                    .where((s) => s.id == widget.activeAccountId)
                                    .firstOrNull;
                                final kindText = activeSession != null
                                    ? _sessionKindLabel(activeSession.kind)
                                    : (widget.bunkerUri != null
                                        ? 'NIP-46 Remote Bunker'
                                        : widget.localNsec != null
                                            ? 'Persisted local key'
                                            : 'Amber NIP-55');
                                return Text(
                                  '$kindText${profile?.nip05 != null ? ' · ${profile!.nip05}' : ''}',
                                  style: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 11,
                                  ),
                                );
                              },
                            ),
                            Text(
                              account.shortLabel,
                              style: TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  if (profile?.about != null && profile!.about!.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    EarthlyRichText(text: profile.about!, compact: true),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: () =>
                      setState(() => _editingProfile = !_editingProfile),
                  icon: Icon(
                    _editingProfile ? Icons.expand_less : Icons.edit_outlined,
                    size: 15,
                  ),
                  label: Text(_editingProfile ? 'Hide Editor' : 'Edit Profile'),
                ),
                OutlinedButton.icon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: account.pubkey));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Copied public key')),
                    );
                  },
                  icon: const Icon(Icons.copy, size: 15),
                  label: const Text('Copy Pubkey'),
                ),
                if (widget.localNsec != null)
                  OutlinedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: widget.localNsec!));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Copied nsec secret key (keep safe!)'),
                        ),
                      );
                    },
                    icon: const Icon(Icons.key_outlined, size: 15),
                    label: const Text('Backup nsec'),
                  ),
                OutlinedButton.icon(
                  onPressed: () {
                    if (widget.activeAccountId != null &&
                        widget.onRemoveSession != null) {
                      widget.onRemoveSession!(widget.activeAccountId!);
                    } else {
                      widget.onAccountChanged(null);
                      widget.onLocalKeyChanged(null);
                      widget.onBunkerConnected?.call(null);
                    }
                  },
                  icon: const Icon(
                    Icons.logout,
                    size: 15,
                    color: EarthlyColors.destructive,
                  ),
                  label: const Text(
                    'Sign out',
                    style: TextStyle(color: EarthlyColors.destructive),
                  ),
                ),
              ],
            ),

            if (_editingProfile) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: theme.dividerColor),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'PUBLIC NOSTR PROFILE (KIND 0)',
                      style: theme.textTheme.labelSmall?.copyWith(
                        fontFamily: 'monospace',
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _displayNameController,
                      decoration: const InputDecoration(
                        labelText: 'Display Name',
                        hintText: 'e.g. Field Cartographer',
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _nameController,
                      decoration: const InputDecoration(
                        labelText: 'Handle (@name)',
                        hintText: 'e.g. explorer',
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _aboutController,
                      minLines: 2,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: 'Bio / About',
                        hintText: 'Mapping rivers, trails, and field notes…',
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _pictureController,
                            decoration: const InputDecoration(
                              labelText: 'Avatar Image URL (optional)',
                              hintText: 'https://blossom.earthly.city/…',
                            ),
                          ),
                        ),
                        if (widget.onUploadBlossomImage != null) ...[
                          const SizedBox(width: 8),
                          OutlinedButton.icon(
                            onPressed: (_busy || _uploadingAvatar)
                                ? null
                                : () async {
                                    setState(() {
                                      _uploadingAvatar = true;
                                      _error = null;
                                    });
                                    try {
                                      final uploaded =
                                          await widget.onUploadBlossomImage!(
                                        'Profile avatar',
                                      );
                                      if (!mounted || uploaded == null) return;
                                      setState(() {
                                        _pictureController.text = uploaded.url;
                                        _info = 'Uploaded avatar to Blossom!';
                                      });
                                    } catch (err) {
                                      if (!mounted) return;
                                      setState(() => _error = err.toString());
                                    } finally {
                                      if (mounted) {
                                        setState(() => _uploadingAvatar = false);
                                      }
                                    }
                                  },
                            icon: _uploadingAvatar
                                ? const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.cloud_upload_outlined,
                                    size: 15),
                            label: const Text('Upload'),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _nip05Controller,
                      decoration: const InputDecoration(
                        labelText: 'NIP-05 Identifier (optional)',
                        hintText: 'name@earthly.city',
                      ),
                    ),
                    const SizedBox(height: 10),
                    FilledButton.icon(
                      onPressed: _busy ? null : _publishProfile,
                      icon: _busy
                          ? const SizedBox(
                              width: 15,
                              height: 15,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.publish, size: 17),
                      label: const Text('Save & Publish Profile (kind 0)'),
                    ),
                  ],
                ),
              ),
            ],
            if (widget.savedAccounts.isNotEmpty) ...[
              const Divider(height: 24),
              Row(
                children: [
                  const Icon(Icons.people_outline, size: 15),
                  const SizedBox(width: 6),
                  Text(
                    'SAVED SESSIONS (${widget.savedAccounts.length})',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              for (final session in widget.savedAccounts) ...[
                Builder(
                  builder: (ctx) {
                    final isActive = widget.activeAccountId == session.id ||
                        (widget.activeAccountId == null &&
                            account.pubkey == session.pubkeyHex);
                    final prof = widget.profilesByPubkey[session.pubkeyHex];
                    return Container(
                      key: Key('saved-session-${session.id}'),
                      margin: const EdgeInsets.only(bottom: 8),
                      decoration: BoxDecoration(
                        color: isActive
                            ? EarthlyColors.commentGreen.withValues(alpha: 0.10)
                            : theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isActive
                              ? EarthlyColors.commentGreen.withValues(alpha: 0.55)
                              : theme.dividerColor,
                        ),
                      ),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: isActive || widget.onSwitchSession == null
                            ? null
                            : () => widget.onSwitchSession!(session),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
                          child: Row(
                            children: [
                              CircleAvatar(
                                radius: 16,
                                backgroundColor:
                                    EarthlyColors.amber.withValues(alpha: 0.20),
                                backgroundImage: (prof?.picture != null &&
                                        prof!.picture!.startsWith('http'))
                                    ? NetworkImage(prof.picture!)
                                    : null,
                                child: (prof?.picture == null ||
                                        !prof!.picture!.startsWith('http'))
                                    ? const Icon(Icons.person, size: 16)
                                    : null,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Flexible(
                                          child: Text(
                                            _sessionDisplayName(session),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: theme.textTheme.bodySmall
                                                ?.copyWith(
                                              fontWeight: FontWeight.w800,
                                            ),
                                          ),
                                        ),
                                        if (isActive) ...[
                                          const SizedBox(width: 6),
                                          const EarthlyBadge(
                                            label: 'ACTIVE',
                                            color: EarthlyColors.commentGreen,
                                          ),
                                        ],
                                      ],
                                    ),
                                    Text(
                                      _sessionKindLabel(session.kind),
                                      style: TextStyle(
                                        fontFamily: 'monospace',
                                        fontSize: 10,
                                        color: theme
                                            .colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (!isActive && widget.onSwitchSession != null)
                                TextButton(
                                  style: TextButton.styleFrom(
                                    visualDensity: VisualDensity.compact,
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 8,
                                    ),
                                  ),
                                  onPressed: () =>
                                      widget.onSwitchSession!(session),
                                  child: const Text('Switch'),
                                ),
                              if (widget.onRemoveSession != null)
                                IconButton(
                                  tooltip: 'Remove session',
                                  visualDensity: VisualDensity.compact,
                                  onPressed: () =>
                                      widget.onRemoveSession!(session.id),
                                  icon: const Icon(
                                    Icons.logout,
                                    size: 16,
                                    color: EarthlyColors.destructive,
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ],
            ],
            const Divider(height: 24),
            Text(
              'ADD ANOTHER ACCOUNT',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            _buildAddAccountControls(theme),
          ] else ...[
            if (widget.savedAccounts.isNotEmpty) ...[
              Text(
                'SAVED SESSIONS (${widget.savedAccounts.length})',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              for (final session in widget.savedAccounts)
                Container(
                  key: Key('saved-session-${session.id}'),
                  margin: const EdgeInsets.only(bottom: 8),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: theme.dividerColor),
                  ),
                  child: ListTile(
                    dense: true,
                    leading: const CircleAvatar(
                      radius: 16,
                      child: Icon(Icons.person, size: 16),
                    ),
                    title: Text(
                      _sessionDisplayName(session),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      _sessionKindLabel(session.kind),
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10,
                      ),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (widget.onSwitchSession != null)
                          TextButton(
                            onPressed: () => widget.onSwitchSession!(session),
                            child: const Text('Use'),
                          ),
                        if (widget.onRemoveSession != null)
                          IconButton(
                            tooltip: 'Remove session',
                            visualDensity: VisualDensity.compact,
                            onPressed: () =>
                                widget.onRemoveSession!(session.id),
                            icon: const Icon(
                              Icons.logout,
                              size: 16,
                              color: EarthlyColors.destructive,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              const Divider(height: 20),
            ],
            Text(
              'Sign in to publish Maps, Stories, Atlases, Sightings, Live Beacons, Comments, and Edit Proposals.',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            _buildAddAccountControls(theme),
          ],

          const Divider(height: 24),
          if (widget.onBlossomServerChanged != null) ...[
            Text(
              'BLOSSOM MEDIA SERVER (BUD-02)',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _blossomController,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11.5),
                    decoration: const InputDecoration(
                      hintText: 'https://blossom.earthly.city',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: () {
                    final url = _blossomController.text.trim();
                    if (url.startsWith('https://') || url.startsWith('http://')) {
                      widget.onBlossomServerChanged!(url);
                      setState(() => _info = 'Saved Blossom server: $url');
                    } else {
                      setState(
                        () => _error = 'Blossom server must start with https://',
                      );
                    }
                  },
                  child: const Text('Save'),
                ),
              ],
            ),
            const Divider(height: 24),
          ],
          Text(
            'NEARBY FIELD SESSION & NETWORK',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            widget.activeSessionSummary ??
                'No active Nearby LAN or FIPS Mesh session.',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: widget.onOpenSpaces,
            icon: const Icon(Icons.hub_outlined, size: 17),
            label:
                const Text('Open Spaces (QR Pairing, FIPS, Beacons, Relays)'),
          ),
        ],
      ),
    );
  }
}
