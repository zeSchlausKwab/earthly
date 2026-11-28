import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/atlas_schema.dart';
import '../nostr/earthly_share.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';
import 'raw_event_inspector_dialog.dart';
import 'social_actions_bar.dart';

/// Non-blocking Atlas Detail Margin drawer displaying an Atlas (`kind 37518`):
/// cover photo, governance badge, NIP-25 reactions, Markdown description,
/// strict two-lane Curated (Canon) vs. Community Contributions governance,
/// owner Bless ("Add to Curated") & "Lock Down" controls, contributor Mute,
/// "Enter Atlas Lens" scoping toggle, and "Show All on Map".
class AtlasDetailMargin extends StatefulWidget {
  const AtlasDetailMargin({
    required this.atlas,
    required this.relayUrls,
    required this.catalogMaps,
    required this.catalogStories,
    required this.shelfAddresses,
    required this.profilesByPubkey,
    required this.isActiveLens,
    required this.onToggleLens,
    required this.onShowAllOnMap,
    required this.onToggleMapOnShelf,
    required this.onFocusMap,
    required this.onOpenStory,
    required this.onOpenDiscussion,
    required this.onClose,
    this.onBack,
    this.isOwned = false,
    this.currentUserPubkey,
    this.mutedPubkeys = const <String>{},
    this.initialSocialCounts,
    this.onToggleReaction,
    this.onZap,
    this.onEditAtlas,
    this.onDeleteAtlas,
    this.onBlessContribution,
    this.onLockDownAtlas,
    this.onMuteAuthor,
    this.onOpenPerson,
    super.key,
  });

  final AtlasSummaryDto atlas;
  final List<String> relayUrls;
  final List<MapSummaryDto> catalogMaps;
  final List<StorySummaryDto> catalogStories;
  final Set<String> shelfAddresses;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final bool isActiveLens;
  final VoidCallback onToggleLens;
  final VoidCallback onShowAllOnMap;
  final ValueChanged<MapSummaryDto> onToggleMapOnShelf;
  final ValueChanged<MapSummaryDto> onFocusMap;
  final ValueChanged<StorySummaryDto> onOpenStory;
  final VoidCallback onOpenDiscussion;
  final VoidCallback? onBack;
  final VoidCallback onClose;
  final bool isOwned;
  final String? currentUserPubkey;
  final Set<String> mutedPubkeys;
  final EntitySocialCountsDto? initialSocialCounts;
  final Future<EntitySocialCountsDto?> Function(EntitySocialCountsDto? current)?
      onToggleReaction;
  final VoidCallback? onZap;
  final VoidCallback? onEditAtlas;
  final Future<void> Function()? onDeleteAtlas;
  final Future<void> Function(String entityAddress)? onBlessContribution;
  final Future<void> Function()? onLockDownAtlas;
  final ValueChanged<String>? onMuteAuthor;
  final ValueChanged<String>? onOpenPerson;

  @override
  State<AtlasDetailMargin> createState() => _AtlasDetailMarginState();
}

class _AtlasDetailMarginState extends State<AtlasDetailMargin> {
  final Map<String, MapSummaryDto> _fetchedMaps = <String, MapSummaryDto>{};
  bool _loadingMissing = false;
  String? _blessingAddress;
  bool _lockingDown = false;
  late AtlasSchemaFilterMode _schemaFilter;
  bool _schemaHashVerified = true;

  @override
  void initState() {
    super.initState();
    _schemaFilter = widget.atlas.governance == 'schema'
        ? AtlasSchemaFilterMode.strict
        : AtlasSchemaFilterMode.off;
    _loadMissingPinnedMaps();
    _verifySchemaIntegrity();
  }

  @override
  void didUpdateWidget(covariant AtlasDetailMargin oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.atlas.address != widget.atlas.address ||
        oldWidget.atlas.schemaHash != widget.atlas.schemaHash ||
        oldWidget.atlas.schemaJson != widget.atlas.schemaJson) {
      _fetchedMaps.clear();
      _schemaFilter = widget.atlas.governance == 'schema'
          ? AtlasSchemaFilterMode.strict
          : AtlasSchemaFilterMode.off;
      _schemaHashVerified = true;
      _loadMissingPinnedMaps();
      _verifySchemaIntegrity();
    }
  }

  Future<void> _verifySchemaIntegrity() async {
    final hash = widget.atlas.schemaHash;
    final schema = widget.atlas.schemaJson;
    if (hash == null || hash.trim().isEmpty || schema == null || schema.trim().isEmpty) {
      return;
    }
    try {
      await RustBridge.ensureInitialized();
      final check = await validateMapAgainstAtlasSchema(
        geojson: '{"type":"FeatureCollection","features":[]}',
        schemaJson: schema,
        publishedSchemaHash: hash,
      );
      if (mounted) setState(() => _schemaHashVerified = check.hashVerified);
    } catch (_) {}
  }

  Future<void> _loadMissingPinnedMaps() async {
    final known = {for (final m in widget.catalogMaps) m.address};
    final missing = widget.atlas.pinnedAddresses
        .where((a) => a.startsWith('37515:') && !known.contains(a))
        .toList(growable: false);
    if (missing.isEmpty) return;
    setState(() => _loadingMissing = true);
    try {
      await RustBridge.ensureInitialized();
      final fetched = await fetchMapsByAddresses(
        relayUrls: widget.relayUrls,
        addresses: missing,
      );
      if (!mounted) return;
      setState(() {
        for (final m in fetched) {
          _fetchedMaps[m.address] = m;
        }
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loadingMissing = false);
    }
  }

  String _authorLabel(String pubkey) {
    final p = widget.profilesByPubkey[pubkey];
    final name = p?.displayName ?? p?.name;
    if (name != null && name.isNotEmpty) return name;
    return pubkey.length > 10 ? '${pubkey.substring(0, 8)}…' : pubkey;
  }

  Future<void> _copyLink() async {
    try {
      await RustBridge.ensureInitialized();
      final uri = await encodeNaddrCoordinate(
        kind: 37518,
        pubkeyHex: widget.atlas.pubkey,
        dTag: widget.atlas.dTag,
        relays: widget.relayUrls,
      );
      await Clipboard.setData(ClipboardData(text: uri));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Copied Atlas nostr:naddr1… link')),
      );
    } catch (_) {}
  }

  Future<void> _handleBless(String entityAddress) async {
    if (_blessingAddress != null || widget.onBlessContribution == null) return;
    setState(() => _blessingAddress = entityAddress);
    try {
      await widget.onBlessContribution!(entityAddress);
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not curate item: $err')),
      );
    } finally {
      if (mounted) setState(() => _blessingAddress = null);
    }
  }

  Future<void> _handleLockDown() async {
    if (_lockingDown || widget.onLockDownAtlas == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Lock Down Atlas?'),
        content: const Text(
          'Switch this Atlas to Closed (Author Picks only) governance. Uncurated community arrivals will be hidden until you explicitly curate them.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Lock Down'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _lockingDown = true);
    try {
      await widget.onLockDownAtlas!();
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not lock down Atlas: $err')),
      );
    } finally {
      if (mounted) setState(() => _lockingDown = false);
    }
  }

  ({List<MapSummaryDto> curated, List<MapSummaryDto> community})
      _partitionMaps() {
    final allByAddr = <String, MapSummaryDto>{};
    for (final m in [...widget.catalogMaps, ..._fetchedMaps.values]) {
      allByAddr[m.address] = m;
    }
    final pinnedSet = widget.atlas.pinnedAddresses.toSet();
    final curated = <MapSummaryDto>[];
    for (final addr in widget.atlas.pinnedAddresses) {
      final found = allByAddr[addr];
      if (found != null) curated.add(found);
    }
    final community = <MapSummaryDto>[];
    if (widget.atlas.governance != 'closed') {
      for (final m in allByAddr.values) {
        if (pinnedSet.contains(m.address)) continue;
        if (!m.contextRefs.contains(widget.atlas.address)) continue;
        if (widget.mutedPubkeys.contains(m.pubkey)) continue;
        community.add(m);
      }
      community.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    }
    return (curated: curated, community: community);
  }

  ({List<StorySummaryDto> curated, List<StorySummaryDto> community})
      _partitionStories() {
    final pinnedSet = widget.atlas.pinnedAddresses.toSet();
    final byAddr = {for (final s in widget.catalogStories) s.address: s};
    final curated = <StorySummaryDto>[];
    for (final addr in widget.atlas.pinnedAddresses) {
      final found = byAddr[addr];
      if (found != null) curated.add(found);
    }
    final community = <StorySummaryDto>[];
    if (widget.atlas.governance != 'closed') {
      for (final s in widget.catalogStories) {
        if (pinnedSet.contains(s.address)) continue;
        if (!s.referencedAddresses.contains(widget.atlas.address)) continue;
        if (widget.mutedPubkeys.contains(s.pubkey)) continue;
        community.add(s);
      }
      community.sort((a, b) => b.publishedAt.compareTo(a.publishedAt));
    }
    return (curated: curated, community: community);
  }

  Widget _buildMapRow(
    MapSummaryDto map, {
    required bool isCommunity,
    String? schemaWarning,
  }) {
    final onShelf = widget.shelfAddresses.contains(map.address);
    final canBless =
        isCommunity && widget.isOwned && widget.onBlessContribution != null;
    final canMute = isCommunity &&
        widget.onMuteAuthor != null &&
        map.pubkey != widget.currentUserPubkey;
    final blessing = _blessingAddress == map.address;

    return EarthlyEntityListRow(
      leading: EarthlyGeometryThumb(
        cacheKey: map.eventId,
        geojson: map.geojson,
        width: 56,
        height: 44,
      ),
      title: map.title,
      subtitle: schemaWarning != null ? '⚠ Schema: $schemaWarning' : null,
      meta:
          '${_authorLabel(map.pubkey)} · ${map.featureCount} feat${map.sizeBytes > 0 ? ' · ${formatByteSize(map.sizeBytes)}' : ''}',
      selected: onShelf,
      onTap: () {
        if (!onShelf) {
          widget.onToggleMapOnShelf(map);
        } else {
          widget.onFocusMap(map);
        }
      },
      primaryAction: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (canBless)
            IconButton(
              key: Key('bless-${map.address}'),
              tooltip: 'Add to Curated',
              visualDensity: VisualDensity.compact,
              onPressed: blessing ? null : () => _handleBless(map.address),
              icon: blessing
                  ? const SizedBox(
                      width: 15,
                      height: 15,
                      child: CircularProgressIndicator(strokeWidth: 1.8),
                    )
                  : const Icon(
                      Icons.verified_outlined,
                      size: 19,
                      color: EarthlyColors.commentGreen,
                    ),
            ),
          IconButton(
            tooltip: onShelf ? 'Remove from map' : 'Show on map',
            visualDensity: VisualDensity.compact,
            onPressed: () => widget.onToggleMapOnShelf(map),
            icon: Icon(
              onShelf ? Icons.layers : Icons.layers_outlined,
              size: 19,
              color: onShelf ? EarthlyColors.commentGreen : null,
            ),
          ),
        ],
      ),
      menuActions: [
        if (canBless)
          EntityRowMenuAction(
            label: 'Add to Curated',
            icon: Icons.verified_outlined,
            onSelected: () => _handleBless(map.address),
          ),
        if (widget.onOpenPerson != null)
          EntityRowMenuAction(
            label: 'View author',
            icon: Icons.person_outline,
            onSelected: () => widget.onOpenPerson!(map.pubkey),
          ),
        if (canMute)
          EntityRowMenuAction(
            label: 'Mute author',
            icon: Icons.volume_off_outlined,
            destructive: true,
            onSelected: () => widget.onMuteAuthor!(map.pubkey),
          ),
      ],
    );
  }

  Widget _buildStoryRow(StorySummaryDto story, {required bool isCommunity}) {
    final canBless =
        isCommunity && widget.isOwned && widget.onBlessContribution != null;
    final canMute = isCommunity &&
        widget.onMuteAuthor != null &&
        story.pubkey != widget.currentUserPubkey;
    final blessing = _blessingAddress == story.address;

    return EarthlyEntityListRow(
      leading: EarthlyCoverThumb(
        imageUrl: story.image,
        fallbackIcon: Icons.auto_stories_outlined,
        width: 56,
        height: 44,
      ),
      title: story.title,
      subtitle: story.summary,
      meta: _authorLabel(story.pubkey),
      onTap: () => widget.onOpenStory(story),
      primaryAction: canBless
          ? IconButton(
              key: Key('bless-${story.address}'),
              tooltip: 'Add to Curated',
              visualDensity: VisualDensity.compact,
              onPressed: blessing ? null : () => _handleBless(story.address),
              icon: blessing
                  ? const SizedBox(
                      width: 15,
                      height: 15,
                      child: CircularProgressIndicator(strokeWidth: 1.8),
                    )
                  : const Icon(
                      Icons.verified_outlined,
                      size: 19,
                      color: EarthlyColors.commentGreen,
                    ),
            )
          : const Icon(Icons.chevron_right, size: 19),
      menuActions: [
        if (canBless)
          EntityRowMenuAction(
            label: 'Add to Curated',
            icon: Icons.verified_outlined,
            onSelected: () => _handleBless(story.address),
          ),
        if (canMute)
          EntityRowMenuAction(
            label: 'Mute author',
            icon: Icons.volume_off_outlined,
            destructive: true,
            onSelected: () => widget.onMuteAuthor!(story.pubkey),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final atlas = widget.atlas;
    final mapLanes = _partitionMaps();
    final storyLanes = _partitionStories();
    final totalVisibleMaps =
        mapLanes.curated.length + mapLanes.community.length;
    final totalCurated = mapLanes.curated.length + storyLanes.curated.length;

    final govLabel = switch (atlas.governance) {
      'closed' => 'AUTHOR PICKS',
      'schema' => 'SCHEMA GOVERNANCE',
      _ => 'OPEN TO CONTRIBUTIONS',
    };
    final govColor = atlas.governance == 'open'
        ? EarthlyColors.commentGreen
        : EarthlyColors.published;

    return EarthlyMapDrawer(
      initialFraction: 0.56,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Padding(
        padding: EdgeInsets.fromLTRB(widget.onBack != null ? 6 : 14, 0, 6, 6),
        child: Row(
          children: [
            if (widget.onBack != null) ...[
              EarthlyDrawerBackButton(onBack: widget.onBack!),
              const SizedBox(width: 2),
            ],
            const EarthlyBadge(
              label: 'ATLAS',
              color: EarthlyColors.commentGreen,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                atlas.name,
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            IconButton(
              tooltip: 'Atlas Comments',
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              onPressed: widget.onOpenDiscussion,
              icon: const Icon(Icons.forum_outlined, size: 18),
            ),
            PopupMenuButton<String>(
              key: const Key('atlas-header-more-btn'),
              tooltip: 'More atlas actions',
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              icon: const Icon(Icons.more_horiz, size: 18),
              onSelected: (action) {
                switch (action) {
                  case 'copy':
                    unawaited(_copyLink());
                  case 'share':
                    unawaited(
                      shareEarthlyEntity(
                        context: context,
                        kind: 37518,
                        pubkeyHex: atlas.pubkey,
                        dTag: atlas.dTag,
                        relayUrls: widget.relayUrls,
                        title: atlas.name,
                      ),
                    );
                  case 'raw':
                    unawaited(
                      showRawEventInspectorDialog(
                        context,
                        kind: 37518,
                        title: atlas.name,
                        eventId: atlas.eventId,
                        pubkey: atlas.pubkey,
                        address: atlas.address,
                        dTag: atlas.dTag,
                        payloadLabel: 'Atlas Governance & Schema',
                        payloadContent:
                            atlas.schemaJson ?? atlas.description ?? '{}',
                        extraFields: {
                          'governance': atlas.governance,
                          if (atlas.schemaHash != null)
                            'schemaHash': atlas.schemaHash!,
                        },
                      ),
                    );
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(
                  value: 'copy',
                  child: Row(
                    children: [
                      Icon(Icons.link, size: 17),
                      SizedBox(width: 10),
                      Text('Copy Atlas link'),
                    ],
                  ),
                ),
                PopupMenuItem(
                  value: 'share',
                  child: Row(
                    children: [
                      Icon(Icons.ios_share, size: 17),
                      SizedBox(width: 10),
                      Text('Share earthly.city URL'),
                    ],
                  ),
                ),
                PopupMenuItem(
                  key: Key('atlas-raw-inspect-btn'),
                  value: 'raw',
                  child: Row(
                    children: [
                      Icon(Icons.data_object, size: 17),
                      SizedBox(width: 10),
                      Text('Inspect raw JSON (37518)'),
                    ],
                  ),
                ),
              ],
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              onPressed: widget.onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          if (atlas.image != null && atlas.image!.trim().isNotEmpty) ...[
            GestureDetector(
              onTap: () => showEarthlyPhotoLightbox(
                context,
                url: atlas.image!.trim(),
                caption: atlas.name,
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: SizedBox(
                  height: 170,
                  width: double.infinity,
                  child: EarthlyNetworkImage(
                    url: atlas.image!.trim(),
                    fit: BoxFit.cover,
                    fallback: const SizedBox.shrink(),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              EarthlyBadge(label: govLabel, color: govColor),
              InkWell(
                onTap: widget.onOpenPerson == null
                    ? null
                    : () => widget.onOpenPerson!(atlas.pubkey),
                child: Text(
                  'by ${_authorLabel(atlas.pubkey)}',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: widget.onOpenPerson != null
                        ? EarthlyColors.infoCyan
                        : theme.colorScheme.onSurfaceVariant,
                    decoration: widget.onOpenPerson != null
                        ? TextDecoration.underline
                        : null,
                  ),
                ),
              ),
              for (final tag in atlas.hashtags.take(4))
                EarthlyBadge(
                  label: '#$tag',
                  color: EarthlyColors.infoCyan,
                ),
            ],
          ),
          if (widget.onToggleReaction != null ||
              widget.onZap != null ||
              widget.initialSocialCounts != null) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: EntityReactionBar(
                targetAddress: atlas.address,
                targetEventId: atlas.eventId,
                targetPubkey: atlas.pubkey,
                targetKind: 37518,
                relayUrls: widget.relayUrls,
                currentUserPubkey: widget.currentUserPubkey,
                initialCounts: widget.initialSocialCounts,
                onToggleReaction: widget.onToggleReaction,
                onZap: widget.onZap,
              ),
            ),
          ],
          const SizedBox(height: 12),
          () {
            final canLockDown = widget.isOwned &&
                atlas.governance != 'closed' &&
                widget.onLockDownAtlas != null;
            final canEdit = widget.isOwned && widget.onEditAtlas != null;
            final canDelete = widget.isOwned && widget.onDeleteAtlas != null;
            final showEditInline = canEdit && !canLockDown;

            Future<void> confirmDeleteAtlas() async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: Text('Delete "${atlas.name}"?'),
                  content: const Text(
                    'Publishes a NIP-09 deletion request (kind 5) to your configured Nostr relays.',
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
                      child: const Text('Delete'),
                    ),
                  ],
                ),
              );
              if (ok == true) await widget.onDeleteAtlas!();
            }

            return EarthlyActionBar(
              key: const Key('atlas-detail-action-bar'),
              overflowMenuKey: const Key('atlas-detail-overflow-btn'),
              items: [
                EarthlyActionBarItem(
                  key: const Key('atlas-lens-btn'),
                  icon: widget.isActiveLens
                      ? Icons.close
                      : Icons.filter_tilt_shift,
                  label: widget.isActiveLens
                      ? 'Leave Atlas Lens'
                      : 'Enter Atlas Lens',
                  emphasized: true,
                  flex: 2,
                  onTap: widget.onToggleLens,
                ),
                EarthlyActionBarItem(
                  key: const Key('atlas-show-all-btn'),
                  icon: Icons.layers,
                  label: 'Show All ($totalVisibleMaps)',
                  onTap: totalVisibleMaps == 0 ? null : widget.onShowAllOnMap,
                ),
                if (canLockDown)
                  EarthlyActionBarItem(
                    key: const Key('atlas-lockdown-btn'),
                    icon: Icons.lock_outline,
                    label: _lockingDown ? 'Locking…' : 'Lock Down',
                    loading: _lockingDown,
                    onTap: _lockingDown ? null : _handleLockDown,
                  )
                else if (showEditInline)
                  EarthlyActionBarItem(
                    icon: Icons.edit_outlined,
                    label: 'Edit Atlas',
                    onTap: widget.onEditAtlas,
                  ),
              ],
              overflowActions: [
                if (canEdit && !showEditInline)
                  EarthlyOverflowAction(
                    label: 'Edit Atlas',
                    icon: Icons.edit_outlined,
                    onSelected: widget.onEditAtlas,
                  ),
                if (canDelete)
                  EarthlyOverflowAction(
                    label: 'Delete Atlas',
                    icon: Icons.delete_outline,
                    destructive: true,
                    onSelected: () => unawaited(confirmDeleteAtlas()),
                  ),
              ],
            );
          }(),
          if (atlas.description != null &&
              atlas.description!.trim().isNotEmpty) ...[
            const Divider(height: 22),
            EarthlyRichText(text: atlas.description!.trim()),
          ],

          // LANE 1: CURATED (CANON — explicitly `a`-tagged by the Atlas owner)
          const Divider(height: 22),
          Row(
            children: [
              const Icon(
                Icons.verified_outlined,
                size: 14,
                color: EarthlyColors.commentGreen,
              ),
              const SizedBox(width: 6),
              Text(
                'CURATED ($totalCurated)',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w800,
                ),
              ),
              if (_loadingMissing) ...[
                const SizedBox(width: 8),
                const SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(strokeWidth: 1.8),
                ),
              ],
            ],
          ),
          const SizedBox(height: 6),
          if (totalCurated == 0)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text(
                atlas.governance == 'closed'
                    ? 'Closed Atlas — no author-curated picks pinned yet.'
                    : 'No curated picks pinned yet.',
                style: theme.textTheme.bodySmall,
              ),
            )
          else ...[
            for (final map in mapLanes.curated)
              _buildMapRow(map, isCommunity: false),
            for (final story in storyLanes.curated)
              _buildStoryRow(story, isCommunity: false),
          ],

          // LANE 2: COMMUNITY CONTRIBUTIONS (hidden on `closed` Atlases!)
          if (atlas.governance != 'closed') ...[
            const Divider(height: 22),
            () {
              final hasSchema = atlas.governance == 'schema' ||
                  (atlas.schemaJson != null && atlas.schemaJson!.isNotEmpty);
              final evaluatedMaps = <({MapSummaryDto map, String? reason})>[];
              var hiddenBySchema = 0;
              for (final map in mapLanes.community) {
                final verdict = evaluateMapAgainstSchema(
                  mode: _schemaFilter,
                  map: map,
                  schemaJson: atlas.schemaJson,
                  publishedHash: atlas.schemaHash,
                  hashVerified: _schemaHashVerified,
                );
                if (!verdict.show) {
                  hiddenBySchema += 1;
                } else {
                  evaluatedMaps.add((map: map, reason: verdict.reason));
                }
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.groups_outlined,
                        size: 14,
                        color: EarthlyColors.infoCyan,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'COMMUNITY CONTRIBUTIONS (${evaluatedMaps.length + storyLanes.community.length})',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.labelSmall?.copyWith(
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      if (hasSchema && atlas.schemaHash != null) ...[
                        const SizedBox(width: 6),
                        EarthlyBadge(
                          label: _schemaHashVerified
                              ? 'SCHEMA HASH OK'
                              : 'SCHEMA UNVERIFIED',
                          color: _schemaHashVerified
                              ? EarthlyColors.commentGreen
                              : EarthlyColors.proposedAmber,
                        ),
                      ],
                    ],
                  ),
                  if (hasSchema) ...[
                    const SizedBox(height: 8),
                    EarthlySegmentBar<AtlasSchemaFilterMode>.single(
                      key: const Key('atlas-schema-filter-bar'),
                      compact: true,
                      value: _schemaFilter,
                      options: [
                        for (final mode in AtlasSchemaFilterMode.values)
                          EarthlySegmentOption(
                            key: Key('atlas-schema-filter-${mode.name}'),
                            value: mode,
                            label: mode.name[0].toUpperCase() +
                                mode.name.substring(1),
                          ),
                      ],
                      onChanged: (mode) => setState(() => _schemaFilter = mode),
                    ),
                  ],
                  const SizedBox(height: 6),
                  if (hiddenBySchema > 0)
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: EarthlyColors.proposedAmber.withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: EarthlyColors.proposedAmber.withValues(alpha: 0.5),
                        ),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              '$hiddenBySchema map(s) hidden by Strict schema filter',
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          TextButton(
                            key: const Key('atlas-switch-to-warn-btn'),
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                            ),
                            onPressed: () => setState(
                              () => _schemaFilter = AtlasSchemaFilterMode.warn,
                            ),
                            child: const Text('Show warnings'),
                          ),
                        ],
                      ),
                    ),
                  if (evaluatedMaps.isEmpty && storyLanes.community.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Text(
                        hiddenBySchema > 0
                            ? 'All uncurated community arrivals failed Strict schema checks. Switch to Warn or Off to inspect.'
                            : 'No uncurated community arrivals yet. Enter the Atlas Lens to publish a Map directly into this Atlas.',
                        style: theme.textTheme.bodySmall,
                      ),
                    )
                  else ...[
                    for (final item in evaluatedMaps)
                      _buildMapRow(
                        item.map,
                        isCommunity: true,
                        schemaWarning: item.reason,
                      ),
                    for (final story in storyLanes.community)
                      _buildStoryRow(story, isCommunity: true),
                  ],
                ],
              );
            }(),
          ] else ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: theme.dividerColor),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.lock_outline,
                    size: 15,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Closed Atlas — only author-curated picks are shown.',
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
