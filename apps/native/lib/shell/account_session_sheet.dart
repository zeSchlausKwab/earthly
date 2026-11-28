import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/nip55_signer.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/blossom.dart';
import '../src/rust/api/nip46.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/nwc.dart';
import '../src/rust/api/publish.dart';
import '../src/rust/api/settings.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'map_drawer.dart';
import 'qr_code_view.dart';

@immutable
class ProfileEditRequest {
  const ProfileEditRequest({
    required this.name,
    required this.displayName,
    required this.about,
    required this.picture,
    required this.nip05,
    this.website = '',
    this.banner = '',
    this.lud16 = '',
  });

  final String name;
  final String displayName;
  final String about;
  final String picture;
  final String nip05;
  final String website;
  final String banner;
  final String lud16;
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
    this.mutedPubkeys = const <String>{},
    this.onUnmutePubkey,
    this.nwcUri,
    this.onNwcUriChanged,
    this.onCheckNwcStatus,
    this.onOpenCashuWallet,
    this.cashuBalanceSats,
    this.cashuWalletEnabled = false,
    this.relayUrls = const <String>['wss://relay.earthly.city'],
    super.key,
  });

  final List<String> relayUrls;
  final String? nwcUri;
  final ValueChanged<String?>? onNwcUriChanged;
  final Future<NwcWalletStatusDto> Function(String uri)? onCheckNwcStatus;
  final VoidCallback? onOpenCashuWallet;
  final int? cashuBalanceSats;
  final bool cashuWalletEnabled;

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
  final Set<String> mutedPubkeys;
  final ValueChanged<String>? onUnmutePubkey;
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
  late final TextEditingController _websiteController;
  late final TextEditingController _bannerController;
  late final TextEditingController _lud16Controller;
  final TextEditingController _nwcController = TextEditingController();

  bool _checkingNwc = false;
  NwcWalletStatusDto? _nwcStatus;
  String? _nwcError;
  bool _amberInstalled = false;
  bool _busy = false;
  bool _uploadingAvatar = false;
  bool _uploadingBanner = false;
  bool _showImport = false;
  bool _showBunker = false;
  bool _showReadOnly = false;
  bool _editingProfile = false;
  final Set<String> _backedUpAccountKeys = <String>{};
  Nip46ClientOfferDto? _nostrConnectOffer;
  bool _awaitingNostrConnect = false;
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
    _websiteController =
        TextEditingController(text: widget.profile?.website ?? '');
    _bannerController =
        TextEditingController(text: widget.profile?.banner ?? '');
    _lud16Controller = TextEditingController(text: widget.profile?.lud16 ?? '');
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
      _websiteController.text = widget.profile?.website ?? '';
      _bannerController.text = widget.profile?.banner ?? '';
      _lud16Controller.text = widget.profile?.lud16 ?? '';
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
    _websiteController.dispose();
    _bannerController.dispose();
    _lud16Controller.dispose();
    _nwcController.dispose();
    super.dispose();
  }

  Future<void> _connectNwcUri([String? rawOverride]) async {
    final raw = (rawOverride ?? _nwcController.text).trim();
    if (raw.isEmpty) return;
    setState(() {
      _checkingNwc = true;
      _nwcError = null;
    });
    try {
      String validatedUri = raw;
      if (widget.onCheckNwcStatus == null) {
        await RustBridge.ensureInitialized();
        await parseNwcUri(uri: raw);
      } else if (!raw.toLowerCase().startsWith('nostr+walletconnect://')) {
        throw StateError('URI must start with nostr+walletconnect://');
      }
      widget.onNwcUriChanged?.call(validatedUri);
      _nwcController.clear();
      final status = widget.onCheckNwcStatus != null
          ? await widget.onCheckNwcStatus!(validatedUri)
          : await fetchNwcWalletStatus(nwcUri: validatedUri);
      if (!mounted) return;
      setState(() => _nwcStatus = status);
    } catch (err) {
      if (!mounted) return;
      setState(() => _nwcError = err.toString());
    } finally {
      if (mounted) setState(() => _checkingNwc = false);
    }
  }

  Future<void> _refreshNwcStatus() async {
    final uri = widget.nwcUri?.trim() ?? '';
    if (uri.isEmpty || _checkingNwc) return;
    setState(() {
      _checkingNwc = true;
      _nwcError = null;
    });
    try {
      final status = widget.onCheckNwcStatus != null
          ? await widget.onCheckNwcStatus!(uri)
          : await (() async {
              await RustBridge.ensureInitialized();
              return fetchNwcWalletStatus(nwcUri: uri);
            })();
      if (!mounted) return;
      setState(() => _nwcStatus = status);
    } catch (err) {
      if (!mounted) return;
      setState(() => _nwcError = err.toString());
    } finally {
      if (mounted) setState(() => _checkingNwc = false);
    }
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

  Future<void> _startNostrConnectQr() async {
    setState(() {
      _error = null;
      _info = null;
      _awaitingNostrConnect = true;
    });
    try {
      await RustBridge.ensureInitialized();
      final offer = await createNostrconnectOffer(
        relays: widget.relayUrls,
        appName: 'Earthly',
      );
      if (!mounted) return;
      setState(() => _nostrConnectOffer = offer);
      final conn = await awaitNostrconnectSession(
        connectUri: offer.connectUri,
        clientNsec: offer.clientNsec,
        timeoutSecs: BigInt.from(90),
      );
      if (!mounted || _nostrConnectOffer?.connectUri != offer.connectUri) {
        return;
      }
      widget.onBunkerConnected?.call(conn);
      setState(() {
        _nostrConnectOffer = null;
        _awaitingNostrConnect = false;
        _showBunker = false;
        _info = 'Connected via nostrconnect:// QR (${conn.relays.length} relay).';
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _awaitingNostrConnect = false;
        _error = err.toString();
      });
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
        EarthlyActionGrid(
          key: const Key('account-add-methods-grid'),
          columns: 2,
          items: [
            EarthlyActionBarItem(
              icon: Icons.vpn_key_outlined,
              label: 'Create Local Key',
              emphasized: true,
              onTap: _busy ? null : _createLocalKey,
            ),
            EarthlyActionBarItem(
              icon: Icons.login,
              label: 'Import nsec1…',
              active: _showImport,
              onTap: () => setState(() {
                _showImport = !_showImport;
                if (_showImport) {
                  _showBunker = false;
                  _showReadOnly = false;
                }
              }),
            ),
            EarthlyActionBarItem(
              icon: Icons.cloud_done_outlined,
              label: 'Connect Bunker (NIP-46)',
              active: _showBunker,
              onTap: () => setState(() {
                _showBunker = !_showBunker;
                if (_showBunker) {
                  _showImport = false;
                  _showReadOnly = false;
                }
              }),
            ),
            if (widget.onAddReadOnlyNpub != null)
              EarthlyActionBarItem(
                icon: Icons.visibility_outlined,
                label: 'Watch npub1…',
                active: _showReadOnly,
                onTap: () => setState(() {
                  _showReadOnly = !_showReadOnly;
                  if (_showReadOnly) {
                    _showImport = false;
                    _showBunker = false;
                  }
                }),
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
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  key: const Key('bunker-nostrconnect-qr-btn'),
                  onPressed:
                      _awaitingNostrConnect ? null : _startNostrConnectQr,
                  icon: const Icon(Icons.qr_code_2, size: 16),
                  label: const Text(
                    'Show nostrconnect:// QR',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
              if (_nostrConnectOffer != null) ...[
                const SizedBox(width: 6),
                TextButton(
                  onPressed: () => setState(() {
                    _nostrConnectOffer = null;
                    _awaitingNostrConnect = false;
                  }),
                  child: const Text('Cancel QR'),
                ),
              ],
            ],
          ),
          if (_nostrConnectOffer != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: theme.dividerColor),
              ),
              child: Column(
                children: [
                  EarthlyQrCode(
                    data: _nostrConnectOffer!.connectUri,
                    size: 184,
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (_awaitingNostrConnect) ...[
                        const SizedBox(
                          width: 12,
                          height: 12,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        const SizedBox(width: 8),
                      ],
                      const Flexible(
                        child: Text(
                          'Scan with Amber / nsecBunker… awaiting approval',
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10.5,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  TextButton.icon(
                    onPressed: () {
                      Clipboard.setData(
                        ClipboardData(text: _nostrConnectOffer!.connectUri),
                      );
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Copied nostrconnect:// URI'),
                        ),
                      );
                    },
                    icon: const Icon(Icons.copy, size: 14),
                    label: const Text('Copy nostrconnect:// URI'),
                  ),
                ],
              ),
            ),
          ],
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
          website: _websiteController.text.trim(),
          banner: _bannerController.text.trim(),
          lud16: _lud16Controller.text.trim(),
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
            Expanded(
              child: Text(
                'Account & Session',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
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
                  if (profile != null &&
                      ((profile.website?.isNotEmpty ?? false) ||
                          (profile.lud16?.isNotEmpty ?? false))) ...[
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        if (profile.website != null &&
                            profile.website!.isNotEmpty)
                          Text(
                            profile.website!,
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10.5,
                              color: EarthlyColors.infoCyan,
                            ),
                          ),
                        if (profile.lud16 != null &&
                            profile.lud16!.isNotEmpty)
                          Text(
                            '⚡ ${profile.lud16!}',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10.5,
                              color: EarthlyColors.amber,
                            ),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 10),
            EarthlyActionBar(
              key: const Key('account-actions-bar'),
              items: [
                EarthlyActionBarItem(
                  icon:
                      _editingProfile ? Icons.expand_less : Icons.edit_outlined,
                  label: _editingProfile ? 'Hide Editor' : 'Edit Profile',
                  active: _editingProfile,
                  onTap: () =>
                      setState(() => _editingProfile = !_editingProfile),
                ),
                EarthlyActionBarItem(
                  icon: Icons.copy,
                  label: 'Copy Pubkey',
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: account.pubkey));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Copied public key')),
                    );
                  },
                ),
                if (widget.localNsec != null)
                  EarthlyActionBarItem(
                    key: const Key('account-backup-wizard-btn'),
                    icon: _backedUpAccountKeys.contains(account.pubkey)
                        ? Icons.verified_outlined
                        : Icons.key_outlined,
                    label: _backedUpAccountKeys.contains(account.pubkey)
                        ? 'Backup Verified'
                        : 'Backup Key',
                    accentColor: _backedUpAccountKeys.contains(account.pubkey)
                        ? EarthlyColors.commentGreen
                        : null,
                    onTap: () async {
                      final confirmed = await showDialog<bool>(
                        context: context,
                        builder: (_) => _LocalKeyBackupWizardDialog(
                          nsec: widget.localNsec!,
                        ),
                      );
                      if (confirmed == true && mounted) {
                        setState(() {
                          _backedUpAccountKeys.add(account.pubkey);
                          _info = 'Key backup verified ✓';
                        });
                      }
                    },
                  ),
                EarthlyActionBarItem(
                  icon: Icons.logout,
                  label: 'Sign out',
                  destructive: true,
                  onTap: () {
                    if (widget.activeAccountId != null &&
                        widget.onRemoveSession != null) {
                      widget.onRemoveSession!(widget.activeAccountId!);
                    } else {
                      widget.onAccountChanged(null);
                      widget.onLocalKeyChanged(null);
                      widget.onBunkerConnected?.call(null);
                    }
                  },
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
                    const SizedBox(height: 8),
                    TextField(
                      key: const Key('profile-website-field'),
                      controller: _websiteController,
                      decoration: const InputDecoration(
                        labelText: 'Website URL (optional)',
                        hintText: 'https://earthly.city',
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      key: const Key('profile-lud16-field'),
                      controller: _lud16Controller,
                      decoration: const InputDecoration(
                        labelText: 'Lightning Address (lud16, optional)',
                        hintText: 'name@getalby.com',
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            key: const Key('profile-banner-field'),
                            controller: _bannerController,
                            decoration: const InputDecoration(
                              labelText: 'Banner Image URL (optional)',
                              hintText: 'https://blossom.earthly.city/…',
                            ),
                          ),
                        ),
                        if (widget.onUploadBlossomImage != null) ...[
                          const SizedBox(width: 8),
                          OutlinedButton.icon(
                            onPressed: (_busy || _uploadingBanner)
                                ? null
                                : () async {
                                    setState(() {
                                      _uploadingBanner = true;
                                      _error = null;
                                    });
                                    try {
                                      final uploaded =
                                          await widget.onUploadBlossomImage!(
                                        'Profile banner',
                                      );
                                      if (!mounted || uploaded == null) return;
                                      setState(() {
                                        _bannerController.text = uploaded.url;
                                        _info = 'Uploaded banner to Blossom!';
                                      });
                                    } catch (err) {
                                      if (!mounted) return;
                                      setState(() => _error = err.toString());
                                    } finally {
                                      if (mounted) {
                                        setState(
                                          () => _uploadingBanner = false,
                                        );
                                      }
                                    }
                                  },
                            icon: _uploadingBanner
                                ? const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(
                                    Icons.cloud_upload_outlined,
                                    size: 15,
                                  ),
                            label: const Text('Banner'),
                          ),
                        ],
                      ],
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
          if (widget.onNwcUriChanged != null) ...[
            Text(
              'NOSTR WALLET CONNECT (NIP-47)',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            if (widget.nwcUri == null || widget.nwcUri!.trim().isEmpty) ...[
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('nwc-uri-input'),
                      controller: _nwcController,
                      obscureText: true,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                      ),
                      decoration: const InputDecoration(
                        hintText: 'nostr+walletconnect://…',
                      ),
                    ),
                  ),
                  if (Platform.isAndroid) ...[
                    const SizedBox(width: 6),
                    IconButton(
                      tooltip: 'Scan NWC QR',
                      onPressed: _checkingNwc
                          ? null
                          : () async {
                              try {
                                final scanned = await DeviceBridge.scanQrCode();
                                await _connectNwcUri(scanned);
                              } catch (err) {
                                if (mounted) {
                                  setState(() => _nwcError = err.toString());
                                }
                              }
                            },
                      icon: const Icon(Icons.qr_code_scanner, size: 19),
                    ),
                  ],
                  const SizedBox(width: 8),
                  FilledButton(
                    key: const Key('nwc-connect-btn'),
                    onPressed:
                        _checkingNwc ? null : () => unawaited(_connectNwcUri()),
                    child: Text(_checkingNwc ? '…' : 'Connect NWC'),
                  ),
                ],
              ),
            ] else ...[
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: EarthlyColors.commentGreen.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: EarthlyColors.commentGreen.withValues(alpha: 0.5),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(
                          Icons.bolt,
                          size: 16,
                          color: EarthlyColors.amber,
                        ),
                        const SizedBox(width: 6),
                        const Expanded(
                          child: Text(
                            'NWC Connected',
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 12.5,
                            ),
                          ),
                        ),
                        if (_nwcStatus?.balanceSats != null)
                          Text(
                            '${_nwcStatus!.balanceSats} sats',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11.5,
                              fontWeight: FontWeight.w700,
                              color: EarthlyColors.commentGreen,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    EarthlyActionBar(
                      stacked: false,
                      items: [
                        EarthlyActionBarItem(
                          key: const Key('nwc-check-btn'),
                          icon: Icons.refresh,
                          label: _checkingNwc ? 'Checking…' : 'Check Balance',
                          loading: _checkingNwc,
                          onTap: _checkingNwc ? null : _refreshNwcStatus,
                        ),
                        EarthlyActionBarItem(
                          key: const Key('nwc-disconnect-btn'),
                          icon: Icons.link_off,
                          label: 'Disconnect',
                          destructive: true,
                          onTap: _checkingNwc
                              ? null
                              : () {
                                  widget.onNwcUriChanged!(null);
                                  setState(() {
                                    _nwcStatus = null;
                                    _nwcError = null;
                                  });
                                },
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
            if (_nwcError != null) ...[
              const SizedBox(height: 6),
              Text(
                _nwcError!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10.5,
                  color: EarthlyColors.destructive,
                ),
              ),
            ],
            const Divider(height: 24),
          ],
          if (widget.onOpenCashuWallet != null) ...[
            Text(
              'CASHU ECASH WALLET (NIP-60 / NIP-61)',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: theme.dividerColor),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.account_balance_wallet_outlined,
                    size: 18,
                    color: EarthlyColors.amber,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Encrypted Cashu Wallet',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 12.5,
                          ),
                        ),
                        Text(
                          !widget.cashuWalletEnabled
                              ? 'Disabled (opt-in) · NIP-60 / NIP-61'
                              : widget.cashuBalanceSats != null
                                  ? '${widget.cashuBalanceSats} sats · SecretBox encrypted'
                                  : 'Enabled · NIP-60 ecash & NIP-61 Nutzaps',
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10.5,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton(
                    key: const Key('account-cashu-wallet-btn'),
                    onPressed: widget.onOpenCashuWallet,
                    child: const Text('Open'),
                  ),
                ],
              ),
            ),
            const Divider(height: 24),
          ],
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
          if (widget.mutedPubkeys.isNotEmpty) ...[
            Text(
              'MUTED CONTRIBUTORS (${widget.mutedPubkeys.length})',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            for (final pk in widget.mutedPubkeys)
              Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: theme.dividerColor),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.volume_off_outlined,
                      size: 15,
                      color: EarthlyColors.destructive,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        widget.profilesByPubkey[pk]?.displayName ??
                            widget.profilesByPubkey[pk]?.name ??
                            (pk.length > 14
                                ? '${pk.substring(0, 8)}…${pk.substring(pk.length - 4)}'
                                : pk),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    if (widget.onUnmutePubkey != null)
                      TextButton(
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                        ),
                        onPressed: () => widget.onUnmutePubkey!(pk),
                        child: const Text('Unmute'),
                      ),
                  ],
                ),
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
            label: const Text(
              'Open Spaces (QR Pairing, FIPS, Beacons, Relays)',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _LocalKeyBackupWizardDialog extends StatefulWidget {
  const _LocalKeyBackupWizardDialog({required this.nsec});

  final String nsec;

  @override
  State<_LocalKeyBackupWizardDialog> createState() =>
      _LocalKeyBackupWizardDialogState();
}

class _LocalKeyBackupWizardDialogState
    extends State<_LocalKeyBackupWizardDialog> {
  final _verifyController = TextEditingController();
  int _step = 0;
  bool _revealed = false;
  bool _copied = false;

  @override
  void dispose() {
    _verifyController.dispose();
    super.dispose();
  }

  String get _expectedSuffix {
    final s = widget.nsec.trim();
    return s.length <= 4 ? s : s.substring(s.length - 4);
  }

  bool get _suffixMatches =>
      _verifyController.text.trim().toLowerCase() ==
      _expectedSuffix.toLowerCase();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final nsec = widget.nsec.trim();
    final masked = nsec.length > 14
        ? '${nsec.substring(0, 8)}••••••••••••••••${nsec.substring(nsec.length - 4)}'
        : '••••••••';

    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      title: Text(
        _step == 0 ? 'Backup Local Key (Step 1/2)' : 'Verify Backup (Step 2/2)',
      ),
      content: SizedBox(
        width: 340,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_step == 0) ...[
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: EarthlyColors.proposedAmber.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: EarthlyColors.proposedAmber.withValues(alpha: 0.5),
                    ),
                  ),
                  child: const Text(
                    'Anyone with your nsec1 secret key controls your Nostr identity and published maps. Store it in a password manager or offline note.',
                    style: TextStyle(fontSize: 12),
                  ),
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: theme.dividerColor),
                  ),
                  child: SelectableText(
                    _revealed ? nsec : masked,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
                  ),
                ),
                const SizedBox(height: 8),
                EarthlyActionBar(
                  stacked: false,
                  items: [
                    EarthlyActionBarItem(
                      key: const Key('backup-reveal-btn'),
                      icon: _revealed ? Icons.visibility_off : Icons.visibility,
                      label: _revealed ? 'Hide Key' : 'Reveal Key',
                      onTap: () => setState(() => _revealed = !_revealed),
                    ),
                    EarthlyActionBarItem(
                      key: const Key('backup-copy-btn'),
                      icon: Icons.copy,
                      label: _copied ? 'Copied ✓' : 'Copy nsec',
                      onTap: () {
                        Clipboard.setData(ClipboardData(text: nsec));
                        setState(() => _copied = true);
                      },
                    ),
                  ],
                ),
                if (_revealed) ...[
                  const SizedBox(height: 12),
                  Center(child: EarthlyQrCode(data: nsec, size: 168)),
                ],
              ] else ...[
                const Text(
                  'To confirm you saved your secret key, enter its last 4 characters:',
                  style: TextStyle(fontSize: 12.5),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('backup-verify-input'),
                  controller: _verifyController,
                  onChanged: (_) => setState(() {}),
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Last 4 characters of nsec',
                    hintText: 'e.g. a1b2',
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        if (_step == 0)
          FilledButton(
            key: const Key('backup-next-btn'),
            onPressed: () => setState(() => _step = 1),
            child: const Text('Next: Verify'),
          )
        else ...[
          TextButton(
            onPressed: () => setState(() => _step = 0),
            child: const Text('Back'),
          ),
          FilledButton(
            key: const Key('backup-confirm-btn'),
            onPressed: _suffixMatches
                ? () => Navigator.of(context).pop(true)
                : null,
            child: const Text('Confirm Backup'),
          ),
        ],
      ],
    );
  }
}
