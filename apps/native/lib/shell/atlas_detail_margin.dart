import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

/// Non-blocking Atlas Detail Margin drawer displaying an Atlas (`kind 37518`):
/// cover photo, governance badge, Markdown description, pinned + context-linked
/// Maps & Stories, "Enter Atlas Lens" scoping toggle, and "Show All on Map".
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
    this.isOwned = false,
    this.onEditAtlas,
    this.onDeleteAtlas,
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
  final VoidCallback onClose;
  final bool isOwned;
  final VoidCallback? onEditAtlas;
  final Future<void> Function()? onDeleteAtlas;
  final ValueChanged<String>? onOpenPerson;

  @override
  State<AtlasDetailMargin> createState() => _AtlasDetailMarginState();
}

class _AtlasDetailMarginState extends State<AtlasDetailMargin> {
  final Map<String, MapSummaryDto> _fetchedMaps = <String, MapSummaryDto>{};
  bool _loadingMissing = false;

  @override
  void initState() {
    super.initState();
    _loadMissingPinnedMaps();
  }

  @override
  void didUpdateWidget(covariant AtlasDetailMargin oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.atlas.address != widget.atlas.address) {
      _fetchedMaps.clear();
      _loadMissingPinnedMaps();
    }
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

  List<MapSummaryDto> _resolveMaps() {
    final byAddr = <String, MapSummaryDto>{};
    final pinnedSet = widget.atlas.pinnedAddresses.toSet();
    for (final m in [...widget.catalogMaps, ..._fetchedMaps.values]) {
      if (pinnedSet.contains(m.address) ||
          m.contextRefs.contains(widget.atlas.address)) {
        byAddr[m.address] = m;
      }
    }
    return byAddr.values.toList(growable: false);
  }

  List<StorySummaryDto> _resolveStories() {
    final pinnedSet = widget.atlas.pinnedAddresses.toSet();
    return widget.catalogStories
        .where(
          (s) =>
              pinnedSet.contains(s.address) ||
              s.referencedAddresses.contains(widget.atlas.address),
        )
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final atlas = widget.atlas;
    final maps = _resolveMaps();
    final stories = _resolveStories();
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
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            const EarthlyBadge(
              label: 'ATLAS',
              color: EarthlyColors.commentGreen,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                atlas.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            IconButton(
              tooltip: 'Atlas Comments',
              visualDensity: VisualDensity.compact,
              onPressed: widget.onOpenDiscussion,
              icon: const Icon(Icons.forum_outlined, size: 18),
            ),
            IconButton(
              tooltip: 'Copy Atlas link',
              visualDensity: VisualDensity.compact,
              onPressed: _copyLink,
              icon: const Icon(Icons.link, size: 18),
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
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: widget.onToggleLens,
                icon: Icon(
                  widget.isActiveLens ? Icons.close : Icons.filter_tilt_shift,
                  size: 16,
                ),
                label: Text(
                  widget.isActiveLens
                      ? 'Leave Atlas Lens'
                      : 'Enter Atlas Lens',
                ),
              ),
              OutlinedButton.icon(
                onPressed: maps.isEmpty ? null : widget.onShowAllOnMap,
                icon: const Icon(Icons.layers, size: 16),
                label: Text('Show All (${maps.length})'),
              ),
              if (widget.isOwned && widget.onEditAtlas != null)
                OutlinedButton.icon(
                  onPressed: widget.onEditAtlas,
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: const Text('Edit Atlas'),
                ),
              if (widget.isOwned && widget.onDeleteAtlas != null)
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: EarthlyColors.destructive,
                    side: const BorderSide(color: EarthlyColors.destructive),
                  ),
                  onPressed: () async {
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
                  },
                  icon: const Icon(Icons.delete_outline, size: 16),
                  label: const Text('Delete'),
                ),
            ],
          ),
          if (atlas.description != null &&
              atlas.description!.trim().isNotEmpty) ...[
            const Divider(height: 22),
            _AtlasMarkdownDescription(markdown: atlas.description!.trim()),
          ],
          const Divider(height: 22),
          Row(
            children: [
              Text(
                'MAPS IN THIS ATLAS (${maps.length})',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
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
          if (maps.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                atlas.governance == 'open'
                    ? 'No maps linked yet. Enter the Atlas Lens to publish a new map directly into this Atlas.'
                    : 'No linked maps found on the connected relay yet.',
                style: theme.textTheme.bodySmall,
              ),
            )
          else
            for (final map in maps)
              EarthlyEntityListRow(
                leading: EarthlyGeometryThumb(
                  cacheKey: map.eventId,
                  geojson: map.geojson,
                  width: 56,
                  height: 44,
                ),
                title: map.title,
                meta:
                    '${_authorLabel(map.pubkey)} · ${map.featureCount} feat${map.sizeBytes > 0 ? ' · ${formatByteSize(map.sizeBytes)}' : ''}',
                selected: widget.shelfAddresses.contains(map.address),
                onTap: () {
                  if (!widget.shelfAddresses.contains(map.address)) {
                    widget.onToggleMapOnShelf(map);
                  } else {
                    widget.onFocusMap(map);
                  }
                },
                primaryAction: IconButton(
                  tooltip: widget.shelfAddresses.contains(map.address)
                      ? 'Remove from map'
                      : 'Show on map',
                  visualDensity: VisualDensity.compact,
                  onPressed: () => widget.onToggleMapOnShelf(map),
                  icon: Icon(
                    widget.shelfAddresses.contains(map.address)
                        ? Icons.layers
                        : Icons.layers_outlined,
                    size: 19,
                    color: widget.shelfAddresses.contains(map.address)
                        ? EarthlyColors.commentGreen
                        : null,
                  ),
                ),
              ),
          if (stories.isNotEmpty) ...[
            const Divider(height: 22),
            Text(
              'STORIES IN THIS ATLAS (${stories.length})',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            for (final story in stories)
              EarthlyEntityListRow(
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
                primaryAction: const Icon(Icons.chevron_right, size: 19),
              ),
          ],
        ],
      ),
    );
  }
}

final RegExp _atlasImgRe = RegExp(
  r'!\[([^\]]*)\]\((https?://[^\s)]+)(?:\s+"([^"]*)")?\)',
);

class _AtlasMarkdownDescription extends StatelessWidget {
  const _AtlasMarkdownDescription({required this.markdown});

  final String markdown;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final lines = markdown.split('\n');
    final widgets = <Widget>[];
    for (final raw in lines) {
      final line = raw.trim();
      if (line.isEmpty) {
        widgets.add(const SizedBox(height: 6));
        continue;
      }
      if (line.startsWith('### ')) {
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 6, bottom: 3),
          child: Text(
            line.substring(4),
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
        ));
        continue;
      }
      if (line.startsWith('## ')) {
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 4),
          child: Text(
            line.substring(3),
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
        ));
        continue;
      }
      if (line.startsWith('# ')) {
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 4, bottom: 6),
          child: Text(
            line.substring(2),
            style: theme.textTheme.titleMedium?.copyWith(
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
        ));
        continue;
      }
      final imgs = _atlasImgRe.allMatches(line).toList();
      if (imgs.isNotEmpty) {
        for (final m in imgs) {
          final url = (m.group(2) ?? '').trim();
          final caption = ((m.group(3) ?? '').trim().isNotEmpty
                  ? m.group(3)!
                  : (m.group(1) ?? ''))
              .trim();
          if (url.isEmpty) continue;
          widgets.add(Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: GestureDetector(
              onTap: () => showEarthlyPhotoLightbox(
                context,
                url: url,
                caption: caption,
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 200),
                  child: EarthlyNetworkImage(
                    url: url,
                    fit: BoxFit.cover,
                    fallback: const SizedBox.shrink(),
                  ),
                ),
              ),
            ),
          ));
        }
        final rest = line.replaceAll(_atlasImgRe, '').trim();
        if (rest.isEmpty) continue;
      }
      widgets.add(Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Text(
          line.startsWith('- ') ? '• ${line.substring(2)}' : line,
          style: theme.textTheme.bodyMedium?.copyWith(height: 1.45),
        ),
      ));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: widgets,
    );
  }
}
