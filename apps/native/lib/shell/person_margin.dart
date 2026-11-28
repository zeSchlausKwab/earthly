import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

String _shortPubkey(String pk) =>
    pk.length > 14 ? '${pk.substring(0, 8)}…${pk.substring(pk.length - 6)}' : pk;

/// Non-blocking Author / Person Margin drawer (`UserProfilePanel` parity):
/// resolves the author's `kind 0` profile + NIP-05 + canonical `npub1…` and
/// lists all Maps (`37515`), Stories (`37520`), and Atlases (`37518`) they have
/// published, merged live from relays with the current catalog.
class PersonMarginSheet extends StatefulWidget {
  const PersonMarginSheet({
    required this.pubkey,
    required this.relayUrls,
    required this.isCurrentUser,
    required this.initialProfile,
    required this.catalogMaps,
    required this.catalogStories,
    required this.catalogAtlases,
    required this.shelfAddresses,
    required this.onToggleMapOnShelf,
    required this.onInspectMap,
    required this.onFocusMap,
    required this.onOpenStory,
    required this.onInspectAtlas,
    required this.onEnterAtlasLens,
    required this.onClose,
    this.onBack,
    this.initialPortfolio,
    this.onProfileResolved,
    this.isMuted = false,
    this.onToggleMute,
    super.key,
  });

  final String pubkey;
  final List<String> relayUrls;
  final bool isCurrentUser;
  final ProfileMetadataDto? initialProfile;
  final List<MapSummaryDto> catalogMaps;
  final List<StorySummaryDto> catalogStories;
  final List<AtlasSummaryDto> catalogAtlases;
  final Set<String> shelfAddresses;
  final ValueChanged<MapSummaryDto> onToggleMapOnShelf;
  final ValueChanged<MapSummaryDto> onInspectMap;
  final ValueChanged<MapSummaryDto> onFocusMap;
  final ValueChanged<StorySummaryDto> onOpenStory;
  final ValueChanged<AtlasSummaryDto> onInspectAtlas;
  final ValueChanged<AtlasSummaryDto> onEnterAtlasLens;
  final VoidCallback? onBack;
  final VoidCallback onClose;
  final AuthorPortfolioDto? initialPortfolio;
  final ValueChanged<ProfileMetadataDto>? onProfileResolved;
  final bool isMuted;
  final VoidCallback? onToggleMute;

  @override
  State<PersonMarginSheet> createState() => _PersonMarginSheetState();
}

class _PersonMarginSheetState extends State<PersonMarginSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  AuthorPortfolioDto? _portfolio;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _portfolio = widget.initialPortfolio;
    if (_portfolio == null) {
      unawaited(_loadPortfolio());
    }
  }

  @override
  void didUpdateWidget(covariant PersonMarginSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.pubkey != widget.pubkey) {
      _portfolio = widget.initialPortfolio;
      _error = null;
      if (_portfolio == null) {
        unawaited(_loadPortfolio());
      }
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _loadPortfolio() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final fetched = await fetchAuthorPortfolio(
        relayUrls: widget.relayUrls,
        pubkeyOrNpub: widget.pubkey,
      );
      if (!mounted) return;
      setState(() => _portfolio = fetched);
      if (fetched.profile != null) {
        widget.onProfileResolved?.call(fetched.profile!);
      }
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<MapSummaryDto> get _mergedMaps {
    final byAddr = <String, MapSummaryDto>{
      for (final m in widget.catalogMaps)
        if (m.pubkey == widget.pubkey) m.address: m,
      for (final m in _portfolio?.maps ?? const <MapSummaryDto>[]) m.address: m,
    };
    final list = byAddr.values.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return list;
  }

  List<StorySummaryDto> get _mergedStories {
    final byAddr = <String, StorySummaryDto>{
      for (final s in widget.catalogStories)
        if (s.pubkey == widget.pubkey) s.address: s,
      for (final s in _portfolio?.stories ?? const <StorySummaryDto>[])
        s.address: s,
    };
    final list = byAddr.values.toList()
      ..sort((a, b) => b.publishedAt.compareTo(a.publishedAt));
    return list;
  }

  List<AtlasSummaryDto> get _mergedAtlases {
    final byAddr = <String, AtlasSummaryDto>{
      for (final a in widget.catalogAtlases)
        if (a.pubkey == widget.pubkey) a.address: a,
      for (final a in _portfolio?.atlases ?? const <AtlasSummaryDto>[])
        a.address: a,
    };
    final list = byAddr.values.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final profile = _portfolio?.profile ?? widget.initialProfile;
    final displayName =
        profile?.displayName ?? profile?.name ?? _shortPubkey(widget.pubkey);
    final npub = _portfolio?.npub ?? widget.pubkey;
    final maps = _mergedMaps;
    final stories = _mergedStories;
    final atlases = _mergedAtlases;

    return EarthlyMapDrawer(
      initialFraction: 0.62,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(
              widget.onBack != null ? 6 : 14,
              0,
              6,
              8,
            ),
            child: Row(
              children: [
                if (widget.onBack != null) ...[
                  EarthlyDrawerBackButton(onBack: widget.onBack!),
                  const SizedBox(width: 4),
                ],
                _PersonAvatar(
                  pictureUrl: profile?.picture,
                  name: displayName,
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
                              displayName,
                              maxLines: 1,
                              softWrap: false,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          if (widget.isCurrentUser) ...[
                            const SizedBox(width: 6),
                            const EarthlyBadge(
                              label: 'YOU',
                              color: EarthlyColors.amber,
                            ),
                          ] else if (widget.isMuted) ...[
                            const SizedBox(width: 6),
                            const EarthlyBadge(
                              label: 'MUTED',
                              color: EarthlyColors.destructive,
                            ),
                          ],
                        ],
                      ),
                      if (profile?.nip05 != null &&
                          profile!.nip05!.isNotEmpty) ...[
                        Text(
                          profile.nip05!,
                          maxLines: 1,
                          softWrap: false,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10.5,
                            color: EarthlyColors.commentGreen,
                          ),
                        ),
                      ] else
                        Text(
                          _shortPubkey(npub),
                          maxLines: 1,
                          softWrap: false,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10.5,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh author portfolio',
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  constraints:
                      const BoxConstraints(minWidth: 32, minHeight: 32),
                  onPressed: _loading ? null : _loadPortfolio,
                  icon: _loading
                      ? const SizedBox(
                          width: 15,
                          height: 15,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh, size: 18),
                ),
                PopupMenuButton<String>(
                  key: const Key('person-header-more-btn'),
                  tooltip: 'More author actions',
                  padding: EdgeInsets.zero,
                  constraints:
                      const BoxConstraints(minWidth: 32, minHeight: 32),
                  icon: const Icon(Icons.more_horiz, size: 18),
                  onSelected: (action) {
                    switch (action) {
                      case 'copy':
                        Clipboard.setData(ClipboardData(text: npub));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Copied author npub')),
                        );
                      case 'mute':
                        widget.onToggleMute?.call();
                    }
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(
                      value: 'copy',
                      child: Row(
                        children: [
                          Icon(Icons.copy, size: 17),
                          SizedBox(width: 10),
                          Text('Copy npub'),
                        ],
                      ),
                    ),
                    if (!widget.isCurrentUser && widget.onToggleMute != null)
                      PopupMenuItem(
                        value: 'mute',
                        child: Row(
                          children: [
                            Icon(
                              widget.isMuted
                                  ? Icons.volume_up_outlined
                                  : Icons.volume_off_outlined,
                              size: 17,
                              color: widget.isMuted
                                  ? null
                                  : EarthlyColors.destructive,
                            ),
                            const SizedBox(width: 10),
                            Text(
                              widget.isMuted ? 'Unmute author' : 'Mute author',
                              style: TextStyle(
                                color: widget.isMuted
                                    ? null
                                    : EarthlyColors.destructive,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  constraints:
                      const BoxConstraints(minWidth: 32, minHeight: 32),
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
          ),
          if (profile?.about != null && profile!.about!.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 90),
                child: SingleChildScrollView(
                  child: EarthlyRichText(
                    text: profile.about!.trim(),
                    compact: true,
                  ),
                ),
              ),
            ),
          if (profile != null &&
              ((profile.website?.isNotEmpty ?? false) ||
                  (profile.lud16?.isNotEmpty ?? false)))
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (profile.website != null && profile.website!.isNotEmpty)
                    Text(
                      profile.website!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                        color: EarthlyColors.infoCyan,
                      ),
                    ),
                  if (profile.lud16 != null && profile.lud16!.isNotEmpty)
                    Text(
                      '⚡ ${profile.lud16!}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                        color: EarthlyColors.amber,
                      ),
                    ),
                ],
              ),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 6),
              child: Text(
                _error!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10.5,
                  color: EarthlyColors.destructive,
                ),
              ),
            ),
          TabBar(
            controller: _tabs,
            labelStyle: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
            tabs: [
              Tab(text: 'Maps (${maps.length})'),
              Tab(text: 'Stories (${stories.length})'),
              Tab(text: 'Atlases (${atlases.length})'),
            ],
          ),
        ],
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          _buildMapsTab(theme, maps),
          _buildStoriesTab(theme, stories),
          _buildAtlasesTab(theme, atlases),
        ],
      ),
    );
  }

  Widget _buildMapsTab(ThemeData theme, List<MapSummaryDto> maps) {
    if (maps.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _loading ? 'Loading Maps from relays…' : 'No published Maps yet.',
            style: theme.textTheme.bodySmall,
          ),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
      itemCount: maps.length,
      itemBuilder: (ctx, idx) {
        final m = maps[idx];
        final onShelf = widget.shelfAddresses.contains(m.address);
        return EarthlyEntityListRow(
          leading: EarthlyGeometryThumb(
            cacheKey: m.eventId,
            geojson: m.geojson,
            width: 56,
            height: 44,
          ),
          title: m.title,
          meta:
              '${m.featureCount} feat · ${(m.sizeBytes / 1024).toStringAsFixed(1)} KB',
          selected: onShelf,
          onTap: () => widget.onInspectMap(m),
          primaryAction: IconButton(
            tooltip: onShelf ? 'Remove from Shelf' : 'Show on Map',
            visualDensity: VisualDensity.compact,
            onPressed: () => widget.onToggleMapOnShelf(m),
            icon: Icon(
              onShelf ? Icons.layers : Icons.layers_outlined,
              size: 19,
              color: onShelf ? EarthlyColors.amber : null,
            ),
          ),
          menuActions: [
            EntityRowMenuAction(
              label: 'Zoom to Map',
              icon: Icons.center_focus_strong,
              onSelected: () => widget.onFocusMap(m),
            ),
            EntityRowMenuAction(
              label: 'Inspect Details',
              icon: Icons.info_outline,
              onSelected: () => widget.onInspectMap(m),
            ),
          ],
        );
      },
    );
  }

  Widget _buildStoriesTab(ThemeData theme, List<StorySummaryDto> stories) {
    if (stories.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _loading
                ? 'Loading Stories from relays…'
                : 'No published Stories yet.',
            style: theme.textTheme.bodySmall,
          ),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
      itemCount: stories.length,
      itemBuilder: (ctx, idx) {
        final st = stories[idx];
        return EarthlyEntityListRow(
          leading: EarthlyCoverThumb(
            imageUrl: st.image,
            fallbackIcon: Icons.auto_stories_outlined,
            fallbackColor: EarthlyColors.infoCyan,
            width: 56,
            height: 44,
          ),
          title: st.title,
          meta: st.summary?.isNotEmpty == true
              ? st.summary!
              : '${st.referencedAddresses.length} linked map${st.referencedAddresses.length == 1 ? '' : 's'}',
          onTap: () => widget.onOpenStory(st),
          primaryAction: IconButton(
            tooltip: 'Read Story',
            visualDensity: VisualDensity.compact,
            onPressed: () => widget.onOpenStory(st),
            icon: const Icon(Icons.menu_book_outlined, size: 19),
          ),
        );
      },
    );
  }

  Widget _buildAtlasesTab(ThemeData theme, List<AtlasSummaryDto> atlases) {
    if (atlases.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _loading
                ? 'Loading Atlases from relays…'
                : 'No published Atlases yet.',
            style: theme.textTheme.bodySmall,
          ),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
      itemCount: atlases.length,
      itemBuilder: (ctx, idx) {
        final atlas = atlases[idx];
        return EarthlyEntityListRow(
          leading: EarthlyCoverThumb(
            imageUrl: atlas.image,
            fallbackIcon: Icons.collections_bookmark_outlined,
            fallbackColor: EarthlyColors.commentGreen,
            width: 56,
            height: 44,
          ),
          title: atlas.name,
          meta:
              '${atlas.pinnedAddresses.length} pinned · ${atlas.governance} governance',
          onTap: () => widget.onInspectAtlas(atlas),
          primaryAction: IconButton(
            tooltip: 'Enter Atlas Lens',
            visualDensity: VisualDensity.compact,
            onPressed: () => widget.onEnterAtlasLens(atlas),
            icon: const Icon(Icons.public, size: 19),
          ),
        );
      },
    );
  }
}

class _PersonAvatar extends StatelessWidget {
  const _PersonAvatar({required this.pictureUrl, required this.name});

  final String? pictureUrl;
  final String name;

  @override
  Widget build(BuildContext context) {
    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';
    if (pictureUrl != null && pictureUrl!.startsWith('http')) {
      return ClipOval(
        child: Image.network(
          pictureUrl!,
          width: 40,
          height: 40,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _fallback(initial),
        ),
      );
    }
    return _fallback(initial);
  }

  Widget _fallback(String initial) {
    return Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: EarthlyColors.amber.withValues(alpha: 0.2),
        shape: BoxShape.circle,
        border: Border.all(color: EarthlyColors.amber.withValues(alpha: 0.5)),
      ),
      child: Text(
        initial,
        style: const TextStyle(
          fontWeight: FontWeight.w800,
          color: EarthlyColors.amber,
          fontSize: 16,
        ),
      ),
    );
  }
}
