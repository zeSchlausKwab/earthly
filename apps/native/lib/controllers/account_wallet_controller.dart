import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../nostr/nip55_signer.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../shell/account_session_sheet.dart';
import '../shell/cashu_wallet_sheet.dart';
import '../src/rust/api/nip46.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/nwc.dart';
import '../src/rust/api/publish.dart';
import '../src/rust/api/settings.dart';
import '../src/rust/api/wallet.dart';

/// Manages Nostr account sessions (Amber NIP-55, local nsec, NIP-46 Bunker,
/// read-only watch), profile metadata resolution, muted pubkeys, NWC, and the
/// encrypted NIP-60/61 Cashu Wallet.
class AccountWalletController extends ChangeNotifier {
  final ChangeNotifier accountListenable = ChangeNotifier();
  final ChangeNotifier walletListenable = ChangeNotifier();
  final ChangeNotifier profilesListenable = ChangeNotifier();

  Nip55Account? account;
  String? localNsec;
  String? bunkerUri;
  String? bunkerClientNsec;
  final List<SavedAccountSessionDto> savedAccounts = <SavedAccountSessionDto>[];
  String? activeAccountId;

  final Map<String, ProfileMetadataDto> profilesByPubkey =
      <String, ProfileMetadataDto>{};
  final Set<String> _requestedProfilePubkeys = <String>{};
  final Set<String> mutedPubkeys = <String>{};

  String? nwcUri;
  String? settingsMasterKey;
  bool nip60WalletEnabled = false;
  CashuWalletStateDto? cashuWalletState;
  bool cashuBusy = false;
  final Map<String, int> cashuQuoteAmounts = <String, int>{};

  void setNip60WalletEnabled(bool enabled, {VoidCallback? onPersistSettings}) {
    nip60WalletEnabled = enabled;
    if (!enabled) {
      cashuWalletState = null;
    }
    walletListenable.notifyListeners();
    notifyListeners();
    onPersistSettings?.call();
  }

  bool get canDecryptNip44 {
    if (activeSavedSession?.kind == 'readonly') return false;
    if (localNsec != null && localNsec!.trim().isNotEmpty) return true;
    if (bunkerUri != null &&
        bunkerUri!.trim().isNotEmpty &&
        bunkerClientNsec != null &&
        bunkerClientNsec!.trim().isNotEmpty) {
      return true;
    }
    if (Platform.isAndroid && account != null) return true;
    return false;
  }

  Future<String> nip44DecryptForSelf(
    String ciphertext, {
    required Future<String> Function(String ciphertext) decryptWithLocalNsec,
    required Future<String> Function(String pubkeyHex, String ciphertext)
        decryptWithBunker,
  }) async {
    if (activeSavedSession?.kind == 'readonly') {
      throw StateError(
        'Active account is a read-only watch session. Switch to a signing session in Account.',
      );
    }
    final nsec = localNsec?.trim();
    if (nsec != null && nsec.isNotEmpty) {
      return decryptWithLocalNsec(ciphertext);
    }
    final bunker = bunkerUri?.trim();
    final clientNsec = bunkerClientNsec?.trim();
    final acct = account;
    if (bunker != null &&
        bunker.isNotEmpty &&
        clientNsec != null &&
        clientNsec.isNotEmpty) {
      final pubkeyHex = acct?.pubkey ?? activeSavedSession?.pubkeyHex ?? '';
      if (pubkeyHex.isEmpty) {
        throw StateError(
          'Active bunker session is missing a user public key.',
        );
      }
      return decryptWithBunker(pubkeyHex, ciphertext);
    }
    if (Platform.isAndroid && acct != null) {
      return Nip55Signer.nip44Decrypt(
        ciphertext: ciphertext,
        pubkey: acct.pubkey,
        currentUser: acct.pubkey,
        signerPackage: acct.signerPackage,
      );
    }
    throw StateError(
      'Active session cannot decrypt NIP-44 payloads. Sign in with nsec, NIP-46 bunker, or Android Amber.',
    );
  }

  SavedAccountSessionDto? get activeSavedSession =>
      savedAccounts.where((s) => s.id == activeAccountId).firstOrNull;

  String get accountChipLabel {
    final acct = account;
    if (acct == null) return 'Sign in';
    final p = profilesByPubkey[acct.pubkey];
    final name = p?.displayName ?? p?.name;
    if (name != null && name.isNotEmpty) {
      return name.length > 12 ? '${name.substring(0, 12)}…' : name;
    }
    return acct.shortLabel.substring(0, 8);
  }

  String displayNameForPubkey(String pubkey) {
    final prof = profilesByPubkey[pubkey];
    final candidate = prof?.displayName?.trim().isNotEmpty == true
        ? prof!.displayName!.trim()
        : prof?.name?.trim();
    if (candidate != null && candidate.isNotEmpty) return candidate;
    return pubkey.length >= 10 ? '${pubkey.substring(0, 8)}…' : pubkey;
  }

  CashuWalletViewState get cashuWalletViewState {
    final s = cashuWalletState;
    if (s == null) {
      return const CashuWalletViewState(initialized: false);
    }
    final initialized = s.mints.isNotEmpty ||
        s.p2PkPubkeyHex.isNotEmpty ||
        s.updatedAt > BigInt.zero;
    return CashuWalletViewState(
      initialized: initialized,
      totalBalanceSats: s.balanceSats.toInt(),
      defaultMint: s.defaultMint,
      mints: [
        for (final m in s.mints)
          () {
            final bal =
                s.mintBalances.where((b) => b.mintUrl == m).firstOrNull;
            return CashuMintBalanceView(
              mintUrl: m,
              balanceSats: bal?.balanceSats.toInt() ?? 0,
              proofCount: bal?.proofCount.toInt() ??
                  (m == s.defaultMint ? s.proofCount.toInt() : 0),
            );
          }(),
      ],
      nutzapEnabled: s.nutzapEnabled,
      p2pkPubkeyHex: s.p2PkPubkeyHex.isNotEmpty ? s.p2PkPubkeyHex : null,
      history: [
        for (final h in s.history.reversed)
          CashuHistoryView(
            id: h.id,
            direction: h.direction,
            amountSats: h.amountSats.toInt(),
            mintUrl: h.mintUrl,
            timestampMs: h.createdAt.toInt() * 1000,
            memo: h.memo ?? '',
          ),
      ],
    );
  }

  Future<String> _databasePath() async {
    final dir = await getApplicationSupportDirectory();
    return '${dir.path}/earthly.sqlite3';
  }

  Future<String?> ensureSettingsMasterKey() async {
    if (settingsMasterKey != null && settingsMasterKey!.isNotEmpty) {
      return settingsMasterKey;
    }
    try {
      final masterKey = await DeviceBridge.getOrCreateMasterKey();
      if (masterKey != null && masterKey.isNotEmpty) {
        settingsMasterKey = masterKey;
        await RustBridge.ensureInitialized();
        await setSettingsMasterKey(masterKeyBase64: masterKey);
      }
    } catch (_) {}
    return settingsMasterKey;
  }

  void applyRestoredSessions(AppSettingsDto loaded) {
    savedAccounts
      ..clear()
      ..addAll(loaded.savedAccounts);
    activeAccountId = loaded.activeAccountId;
    final restoredSession = savedAccounts
            .where((s) => s.id == activeAccountId)
            .firstOrNull ??
        (savedAccounts.isNotEmpty ? savedAccounts.first : null);
    if (restoredSession != null) {
      activeAccountId = restoredSession.id;
      account = Nip55Account(
        pubkey: restoredSession.pubkeyHex,
        signerPackage: restoredSession.signerPackage,
      );
      localNsec = restoredSession.localNsec;
      bunkerUri = restoredSession.bunkerUri;
      bunkerClientNsec = restoredSession.bunkerClientNsec;
    } else if (loaded.localPubkeyHex != null &&
        loaded.localPubkeyHex!.isNotEmpty &&
        loaded.localNsec != null &&
        loaded.localNsec!.isNotEmpty) {
      account = Nip55Account(pubkey: loaded.localPubkeyHex!);
      localNsec = loaded.localNsec;
    } else if (loaded.localPubkeyHex != null &&
        loaded.localPubkeyHex!.isNotEmpty &&
        loaded.bunkerUri != null &&
        loaded.bunkerUri!.isNotEmpty &&
        loaded.bunkerClientNsec != null &&
        loaded.bunkerClientNsec!.isNotEmpty) {
      account = Nip55Account(pubkey: loaded.localPubkeyHex!);
      bunkerUri = loaded.bunkerUri;
      bunkerClientNsec = loaded.bunkerClientNsec;
    }
    mutedPubkeys
      ..clear()
      ..addAll(loaded.mutedPubkeys);
    nwcUri = loaded.nwcUri?.trim().isEmpty ?? true ? null : loaded.nwcUri!.trim();
    nip60WalletEnabled = loaded.nip60WalletEnabled;
    if (!nip60WalletEnabled) {
      cashuWalletState = null;
    }
    accountListenable.notifyListeners();
    walletListenable.notifyListeners();
    notifyListeners();
  }

  List<SavedAccountSessionDto> buildSyncedSavedAccounts() {
    return savedAccounts.map((s) {
      final prof = profilesByPubkey[s.pubkeyHex];
      final resolved = prof?.displayName ?? prof?.name;
      if (resolved != null && resolved.isNotEmpty && s.label != resolved) {
        return SavedAccountSessionDto(
          id: s.id,
          kind: s.kind,
          pubkeyHex: s.pubkeyHex,
          localNsec: s.localNsec,
          bunkerUri: s.bunkerUri,
          bunkerClientNsec: s.bunkerClientNsec,
          signerPackage: s.signerPackage,
          label: resolved,
        );
      }
      return s;
    }).toList(growable: false);
  }

  Future<void> resolveSessionProfiles(
    List<String> relayUrls, {
    bool isHeadlessTest = false,
  }) async {
    if (isHeadlessTest) return;
    final pks = savedAccounts
        .map((s) => s.pubkeyHex)
        .where((p) => p.isNotEmpty && !profilesByPubkey.containsKey(p))
        .toSet()
        .toList(growable: false);
    if (pks.isEmpty) return;
    await fetchMissingProfiles(pks, relayUrls);
  }

  Future<void> resolveCatalogProfiles(
    EarthlyCatalogSnapshot catalog,
    List<String> relayUrls,
  ) async {
    final needed = <String>{
      for (final m in catalog.maps) m.pubkey,
      for (final s in catalog.stories) s.pubkey,
      for (final a in catalog.atlases) a.pubkey,
      for (final s in catalog.sightings) s.pubkey,
      for (final b in catalog.beacons) b.pubkey,
    };
    final missing = needed
        .where((pk) => !_requestedProfilePubkeys.contains(pk))
        .toList(growable: false);
    if (missing.isEmpty) return;
    _requestedProfilePubkeys.addAll(missing);
    await fetchMissingProfiles(missing, relayUrls);
  }

  Future<void> fetchMissingProfiles(
    List<String> pubkeys,
    List<String> relayUrls,
  ) async {
    if (pubkeys.isEmpty) return;
    try {
      await RustBridge.ensureInitialized();
      final fetched = await fetchProfiles(
        relayUrls: relayUrls,
        pubkeys: pubkeys,
      );
      if (fetched.isEmpty) return;
      for (final p in fetched) {
        profilesByPubkey[p.pubkey] = p;
      }
      profilesListenable.notifyListeners();
      accountListenable.notifyListeners();
      notifyListeners();
    } catch (_) {}
  }

  void cacheProfile(ProfileMetadataDto profile) {
    profilesByPubkey[profile.pubkey] = profile;
    profilesListenable.notifyListeners();
    accountListenable.notifyListeners();
    notifyListeners();
  }

  void applyActiveSessionState(SavedAccountSessionDto? session) {
    final prevPubkey = account?.pubkey;
    if (session == null) {
      activeAccountId = null;
      account = null;
      localNsec = null;
      bunkerUri = null;
      bunkerClientNsec = null;
    } else {
      activeAccountId = session.id;
      account = Nip55Account(
        pubkey: session.pubkeyHex,
        signerPackage: session.signerPackage,
      );
      localNsec = session.localNsec;
      bunkerUri = session.bunkerUri;
      bunkerClientNsec = session.bunkerClientNsec;
    }
    if (session == null || session.pubkeyHex != prevPubkey) {
      cashuWalletState = null;
      walletListenable.notifyListeners();
    }
    accountListenable.notifyListeners();
    notifyListeners();
  }

  void clearLocalNsec() {
    localNsec = null;
    accountListenable.notifyListeners();
    notifyListeners();
  }

  void clearBunkerCredentials() {
    bunkerUri = null;
    bunkerClientNsec = null;
    accountListenable.notifyListeners();
    notifyListeners();
  }

  void upsertAndActivateSession(
    SavedAccountSessionDto session, {
    VoidCallback? onSessionActivated,
  }) {
    final idx = savedAccounts.indexWhere((s) => s.id == session.id);
    if (idx >= 0) {
      savedAccounts[idx] = session;
    } else {
      savedAccounts.add(session);
    }
    applyActiveSessionState(session);
    onSessionActivated?.call();
  }

  String switchSavedSession(
    SavedAccountSessionDto session, {
    VoidCallback? onSessionActivated,
  }) {
    if (!savedAccounts.any((s) => s.id == session.id)) {
      savedAccounts.add(session);
    }
    applyActiveSessionState(session);
    onSessionActivated?.call();
    final prof = profilesByPubkey[session.pubkeyHex];
    return prof?.displayName ??
        prof?.name ??
        session.label ??
        session.pubkeyHex.substring(0, 8);
  }

  void removeSavedSession(
    String sessionId, {
    VoidCallback? onSessionActivated,
  }) {
    savedAccounts.removeWhere((s) => s.id == sessionId);
    if (activeAccountId == sessionId) {
      applyActiveSessionState(
        savedAccounts.isNotEmpty ? savedAccounts.first : null,
      );
    } else {
      accountListenable.notifyListeners();
      notifyListeners();
    }
    onSessionActivated?.call();
  }

  void addReadOnlySession(
    String pubkeyHex, {
    VoidCallback? onSessionActivated,
  }) {
    upsertAndActivateSession(
      SavedAccountSessionDto(
        id: 'readonly:$pubkeyHex',
        kind: 'readonly',
        pubkeyHex: pubkeyHex,
      ),
      onSessionActivated: onSessionActivated,
    );
  }

  void setNwcUri(String? uri, {VoidCallback? onPersistSettings}) {
    nwcUri = uri;
    accountListenable.notifyListeners();
    notifyListeners();
    onPersistSettings?.call();
  }

  String? mutePubkey(String pubkey, {VoidCallback? onPersistSettings}) {
    final clean = pubkey.trim();
    if (clean.isEmpty) return null;
    mutedPubkeys.add(clean);
    profilesListenable.notifyListeners();
    notifyListeners();
    onPersistSettings?.call();
    return displayNameForPubkey(clean);
  }

  void unmutePubkey(String pubkey, {VoidCallback? onPersistSettings}) {
    mutedPubkeys.remove(pubkey);
    profilesListenable.notifyListeners();
    notifyListeners();
    onPersistSettings?.call();
  }

  /// Ensures an active signer identity (Android Amber NIP-55 OR Desktop local
  /// keypair).
  Future<Nip55Account> ensureAccount({
    VoidCallback? onSessionActivated,
  }) async {
    if (account != null) return account!;
    if (Platform.isAndroid && await Nip55Signer.isSignerInstalled()) {
      final acct = await Nip55Signer.getPublicKey();
      upsertAndActivateSession(
        SavedAccountSessionDto(
          id: 'amber:${acct.pubkey}',
          kind: 'amber',
          pubkeyHex: acct.pubkey,
          signerPackage: acct.signerPackage,
        ),
        onSessionActivated: onSessionActivated,
      );
      return acct;
    }
    await RustBridge.ensureInitialized();
    final kp = await generateLocalNostrKeypair();
    final acct = Nip55Account(pubkey: kp.pubkeyHex);
    upsertAndActivateSession(
      SavedAccountSessionDto(
        id: 'local:${kp.pubkeyHex}',
        kind: 'local',
        pubkeyHex: kp.pubkeyHex,
        localNsec: kp.nsec,
      ),
      onSessionActivated: onSessionActivated,
    );
    return acct;
  }

  Future<String> signUnsignedEvent(
    Nip55Account signingAccount,
    String unsignedEventJson,
  ) async {
    if (activeSavedSession?.kind == 'readonly') {
      throw StateError(
        'Active account is a read-only watch session. Switch to a signing session in Account.',
      );
    }
    if (bunkerUri != null &&
        bunkerUri!.isNotEmpty &&
        bunkerClientNsec != null &&
        bunkerClientNsec!.isNotEmpty) {
      await RustBridge.ensureInitialized();
      return signEventWithNip46Bunker(
        bunkerUri: bunkerUri!,
        clientNsec: bunkerClientNsec!,
        unsignedEventJson: unsignedEventJson,
      );
    }
    if (localNsec != null && localNsec!.isNotEmpty) {
      await RustBridge.ensureInitialized();
      return signEventWithNsec(
        nsecOrHex: localNsec!,
        unsignedEventJson: unsignedEventJson,
      );
    }
    final signed = await Nip55Signer.signEvent(
      eventJson: unsignedEventJson,
      currentUser: signingAccount.pubkey,
      signerPackage: signingAccount.signerPackage,
    );
    final json = signed.signedEventJson;
    if (json == null || json.isEmpty) {
      throw StateError('Signer did not return a full signed event JSON');
    }
    return json;
  }

  Future<PublishOutcomeDto> publishProfile(
    ProfileEditRequest req, {
    required List<String> relayUrls,
    VoidCallback? onSessionActivated,
  }) async {
    await RustBridge.ensureInitialized();
    final acct = await ensureAccount(onSessionActivated: onSessionActivated);
    final prepared = await prepareUnsignedProfileEvent(
      pubkeyOrNpub: acct.pubkey,
      name: req.name.isEmpty ? null : req.name,
      displayName: req.displayName.isEmpty ? null : req.displayName,
      about: req.about.isEmpty ? null : req.about,
      picture: req.picture.isEmpty ? null : req.picture,
      nip05: req.nip05.isEmpty ? null : req.nip05,
      website: req.website.isEmpty ? null : req.website,
      banner: req.banner.isEmpty ? null : req.banner,
      lud16: req.lud16.isEmpty ? null : req.lud16,
    );
    final signedEventJson =
        await signUnsignedEvent(acct, prepared.unsignedEventJson);
    final dbPath = await _databasePath();
    final outcome = await publishSignedEventViaOutbox(
      databasePath: dbPath,
      signedEventJson: signedEventJson,
      relayUrls: relayUrls,
    );
    cacheProfile(
      ProfileMetadataDto(
        pubkey: acct.pubkey,
        name: req.name.isEmpty ? null : req.name,
        displayName: req.displayName.isEmpty ? null : req.displayName,
        about: req.about.isEmpty ? null : req.about,
        picture: req.picture.isEmpty ? null : req.picture,
        nip05: req.nip05.isEmpty ? null : req.nip05,
        website: req.website.isEmpty ? null : req.website,
        banner: req.banner.isEmpty ? null : req.banner,
        lud16: req.lud16.isEmpty ? null : req.lud16,
      ),
    );
    return outcome;
  }

  Future<void> refreshCashuWalletState({bool isHeadlessTest = false}) async {
    if (isHeadlessTest) return;
    if (!nip60WalletEnabled) {
      cashuWalletState = null;
      walletListenable.notifyListeners();
      notifyListeners();
      return;
    }
    final acct = account;
    if (acct == null) {
      cashuWalletState = null;
      walletListenable.notifyListeners();
      notifyListeners();
      return;
    }
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final masterKey = await ensureSettingsMasterKey();
      final loaded = await loadCashuWalletState(
        databasePath: dbPath,
        pubkeyHex: acct.pubkey,
        masterKeyB64: masterKey,
      );
      cashuWalletState = loaded;
      walletListenable.notifyListeners();
      notifyListeners();
    } catch (_) {}
  }

  Future<T> runCashuOp<T>(
    Future<T> Function(String dbPath, String pubkeyHex, String? masterKey) op, {
    VoidCallback? onSessionActivated,
  }) async {
    cashuBusy = true;
    walletListenable.notifyListeners();
    try {
      await RustBridge.ensureInitialized();
      final acct = await ensureAccount(onSessionActivated: onSessionActivated);
      final dbPath = await _databasePath();
      final masterKey = await ensureSettingsMasterKey();
      return await op(dbPath, acct.pubkey, masterKey);
    } finally {
      cashuBusy = false;
      walletListenable.notifyListeners();
    }
  }

  void updateCashuWalletState(CashuWalletStateDto next) {
    cashuWalletState = next;
    walletListenable.notifyListeners();
    notifyListeners();
  }

  /// Syncs NIP-60 wallet state for the active account across local nsec,
  /// NIP-46 Bunker, or Android Amber NIP-55 signers.
  Future<void> syncNip60WalletForActiveAccount(
    List<String> relayUrls, {
    bool isHeadlessTest = false,
  }) async {
    if (isHeadlessTest || !nip60WalletEnabled) return;
    final acct = account;
    if (acct == null) return;
    if (activeSavedSession?.kind == 'readonly') {
      throw StateError(
        'Active account is a read-only watch session. Switch to a signing session in Account.',
      );
    }

    final synced = await runCashuOp<CashuWalletStateDto>(
      (dbPath, pubkeyHex, masterKey) async {
        final nsec = localNsec?.trim();
        if (nsec != null && nsec.isNotEmpty) {
          return syncNip60Wallet(
            databasePath: dbPath,
            nsecOrHex: nsec,
            relays: relayUrls,
            masterKeyB64: masterKey,
          );
        }

        final bunker = bunkerUri?.trim();
        final clientNsec = bunkerClientNsec?.trim();
        if (bunker != null &&
            bunker.isNotEmpty &&
            clientNsec != null &&
            clientNsec.isNotEmpty) {
          return syncNip60WalletWithBunker(
            databasePath: dbPath,
            bunkerUri: bunker,
            clientNsec: clientNsec,
            pubkeyHex: pubkeyHex,
            relays: relayUrls,
            masterKeyB64: masterKey,
          );
        }

        if (!Platform.isAndroid) {
          throw StateError(
            'Active session cannot decrypt NIP-44 payloads. Sign in with nsec, NIP-46 bunker, or Android Amber.',
          );
        }

        final discovery = await fetchNip60WalletDiscovery(
          pubkeyHex: pubkeyHex,
          relays: relayUrls,
        );
        String? decryptedWalletJson;
        List<String> walletRelays = const <String>[];
        final walletContent = discovery.walletEvent?.content;
        if (walletContent != null && walletContent.isNotEmpty) {
          decryptedWalletJson = await Nip55Signer.nip44Decrypt(
            ciphertext: walletContent,
            pubkey: pubkeyHex,
            currentUser: acct.pubkey,
            signerPackage: acct.signerPackage,
          );
          walletRelays = await parseNip60WalletRelaysFromJson(
            decryptedWalletJson: decryptedWalletJson,
          );
        }

        final mergedRelays = <String>{
          ...relayUrls,
          ...discovery.discoveredRelays,
          ...discovery.nutzapRelays,
          ...walletRelays,
        }.where((r) => r.trim().isNotEmpty).toList(growable: false);

        final data = await fetchNip60DataEvents(
          pubkeyHex: pubkeyHex,
          relays: mergedRelays,
        );
        final deletedIds = data.deletedEventIds.toSet();

        final decryptedTokenEvents = <DecryptedNip60EventDto>[];
        for (final ev in data.tokenEvents) {
          if (deletedIds.contains(ev.eventId) || ev.content.isEmpty) continue;
          try {
            final plain = await Nip55Signer.nip44Decrypt(
              ciphertext: ev.content,
              pubkey: pubkeyHex,
              currentUser: acct.pubkey,
              signerPackage: acct.signerPackage,
            );
            decryptedTokenEvents.add(
              DecryptedNip60EventDto(
                eventId: ev.eventId,
                createdAt: ev.createdAt,
                decryptedJson: plain,
              ),
            );
          } catch (_) {}
        }

        final decryptedHistoryEvents = <DecryptedNip60EventDto>[];
        for (final ev in data.historyEvents) {
          if (deletedIds.contains(ev.eventId) || ev.content.isEmpty) continue;
          try {
            final plain = await Nip55Signer.nip44Decrypt(
              ciphertext: ev.content,
              pubkey: pubkeyHex,
              currentUser: acct.pubkey,
              signerPackage: acct.signerPackage,
            );
            decryptedHistoryEvents.add(
              DecryptedNip60EventDto(
                eventId: ev.eventId,
                createdAt: ev.createdAt,
                decryptedJson: plain,
              ),
            );
          } catch (_) {}
        }

        return applyDecryptedNip60Sync(
          databasePath: dbPath,
          pubkeyHex: pubkeyHex,
          relays: mergedRelays,
          decryptedWalletJson: decryptedWalletJson,
          decryptedTokenEvents: decryptedTokenEvents,
          decryptedHistoryEvents: decryptedHistoryEvents,
          deletedEventIds: data.deletedEventIds,
          masterKeyB64: masterKey,
        );
      },
    );
    updateCashuWalletState(synced);
  }

  String requireCashuNsec() {
    final nsec = localNsec?.trim();
    if (nsec == null || nsec.isEmpty) {
      throw StateError(
        'NIP-60 / NIP-61 Nostr operations require a local nsec keypair in Account.',
      );
    }
    return nsec;
  }

  Future<NwcPaymentResultDto> payInvoiceViaNwcUri(String bolt11) async {
    await RustBridge.ensureInitialized();
    return payInvoiceViaNwc(nwcUri: nwcUri!, bolt11: bolt11);
  }

  Future<String> payBolt11WithCashu({
    required String bolt11,
    VoidCallback? onSessionActivated,
  }) async {
    final res = await runCashuOp(
      (dbPath, pubkeyHex, masterKey) => payBolt11ViaCashu(
        databasePath: dbPath,
        pubkeyHex: pubkeyHex,
        bolt11: bolt11,
        masterKeyB64: masterKey,
      ),
      onSessionActivated: onSessionActivated,
    );
    updateCashuWalletState(res.walletState);
    return res.preimage != null && res.preimage!.isNotEmpty
        ? 'Paid via Cashu ⚡ (${res.preimage!.substring(0, res.preimage!.length.clamp(0, 10))}…)'
        : 'Paid ${res.amountSats} sats via Cashu ⚡';
  }

  Future<String> sendNutzapWithCashu({
    required String recipientPubkey,
    required int amountSats,
    required String comment,
    required String? targetEventId,
    required List<String> relayUrls,
    VoidCallback? onSessionActivated,
  }) async {
    final res = await runCashuOp(
      (dbPath, _, masterKey) => sendNip61Nutzap(
        databasePath: dbPath,
        nsecOrHex: requireCashuNsec(),
        recipientPubkeyHex: recipientPubkey,
        amountSats: BigInt.from(amountSats),
        comment: comment.isEmpty ? null : comment,
        targetEventId: targetEventId,
        relays: relayUrls,
        masterKeyB64: masterKey,
      ),
      onSessionActivated: onSessionActivated,
    );
    updateCashuWalletState(res.walletState);
    return 'Sent ${res.amountSats} sats via NIP-61 Nutzap ✓';
  }

  @override
  void dispose() {
    accountListenable.dispose();
    walletListenable.dispose();
    profilesListenable.dispose();
    super.dispose();
  }
}
