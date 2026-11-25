import 'dart:io';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/nip55_signer.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
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
    super.key,
  });

  final Nip55Account? account;
  final String? localNsec;
  final ProfileMetadataDto? profile;
  final String? activeSessionSummary;
  final ValueChanged<Nip55Account?> onAccountChanged;
  final ValueChanged<LocalKeypairDto?> onLocalKeyChanged;
  final Future<PublishOutcomeDto> Function(ProfileEditRequest req)
      onSaveProfile;
  final VoidCallback onOpenSpaces;
  final VoidCallback onClose;

  @override
  State<AccountSessionSheet> createState() => _AccountSessionSheetState();
}

class _AccountSessionSheetState extends State<AccountSessionSheet> {
  final _nsecController = TextEditingController();
  late final TextEditingController _displayNameController;
  late final TextEditingController _nameController;
  late final TextEditingController _aboutController;
  late final TextEditingController _pictureController;
  late final TextEditingController _nip05Controller;

  bool _amberInstalled = false;
  bool _busy = false;
  bool _showImport = false;
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
                            Text(
                              '${widget.localNsec != null ? "Persisted local key" : "Amber NIP-55"}${profile?.nip05 != null ? ' · ${profile!.nip05}' : ''}',
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                              ),
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
                    Text(
                      profile.about!,
                      style: theme.textTheme.bodySmall,
                    ),
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
                    widget.onAccountChanged(null);
                    widget.onLocalKeyChanged(null);
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
                    TextField(
                      controller: _pictureController,
                      decoration: const InputDecoration(
                        labelText: 'Avatar Image URL (optional)',
                        hintText: 'https://…',
                      ),
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
          ] else ...[
            Text(
              'Sign in to publish Maps, Stories, Atlases, Sightings, Live Beacons, Comments, and Edit Proposals.',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
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
                  onPressed: () => setState(() => _showImport = !_showImport),
                  icon: const Icon(Icons.login, size: 16),
                  label: const Text('Import nsec1…'),
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
          ],

          const Divider(height: 24),
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
