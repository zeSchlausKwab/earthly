import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

/// Explore drawer: live Nostr relay catalog (Maps · Stories · Atlases · Sightings · Live)
/// replicating Earthly Web's `ListRow` grammar (geometry vector thumbnails for Maps,
/// cover images for Stories/Atlases/Sightings, green presence disc for Beacons,
/// single primary toggle + More overflow menu).
class ExploreSheet extends StatefulWidget {
  const ExploreSheet({
    required this.initialCatalog,
    required this.catalogLoading,
    required this.relayUrls,
    required this.shelfAddresses,
    required this.profilesByPubkey,
    required this.onCatalogLoaded,
    required this.onToggleMapOnShelf,
    required this.onFocusMap,
    required this.onCloneMapToDraft,
    required this.onOpenMapDiscussion,
    required this.onOpenStory,
    required this.onOpenStoryDiscussion,
    required this.onOpenAtlas,
    required this.onFocusSighting,
    required this.onFocusBeacon,
    required this.onCreateSighting,
    required this.onComposeStory,
    required this.onCreateAtlas,
    required this.onOpenBeaconBroadcaster,
    required this.onClose,
    super.key,
  });

  final EarthlyCatalogSnapshot? initialCatalog;
  final bool catalogLoading;
  final List<String> relayUrls;
  final Set<String> shelfAddresses;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final ValueChanged<EarthlyCatalogSnapshot> onCatalogLoaded;
  final ValueChanged<MapSummaryDto> onToggleMapOnShelf;
  final ValueChanged<MapSummaryDto> onFocusMap;
  final ValueChanged<MapSummaryDto> onCloneMapToDraft;
  final ValueChanged<MapSummaryDto> onOpenMapDiscussion;
  final ValueChanged<StorySummaryDto> onOpenStory;
  final ValueChanged<StorySummaryDto> onOpenStoryDiscussion;
  final ValueChanged<AtlasSummaryDto> onOpenAtlas;
  final ValueChanged<SightingSummaryDto> onFocusSighting;
  final ValueChanged<LiveBeaconDto> onFocusBeacon;
  final VoidCallback onCreateSighting;
  final VoidCallback onComposeStory;
  final VoidCallback onCreateAtlas;
  final VoidCallback onOpenBeaconBroadcaster;
  final VoidCallback onClose;

  @override
  State<ExploreSheet> createState() => _ExploreSheetState();
}

class _ExploreSheetState extends State<ExploreSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _searchController = TextEditingController();
  EarthlyCatalogSnapshot? _catalog;
  String _query = '';
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 5, vsync: this);
    _catalog = widget.initialCatalog;
    if (_catalog == null && !widget.catalogLoading) {
      _refresh();
    }
  }

  @override
  void didUpdateWidget(covariant ExploreSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialCatalog != null &&
        widget.initialCatalog != oldWidget.initialCatalog) {
      _catalog = widget.initialCatalog;
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    _searchController.dispose();
    super.dispose();
  }

  String _authorLabel(String pubkey) {
    final p = widget.profilesByPubkey[pubkey];
    final name = p?.displayName ?? p?.name;
    if (name != null && name.isNotEmpty) return name;
    return pubkey.length > 10 ? '${pubkey.substring(0, 8)}…' : pubkey;
  }

  bool _matchesQuery(Iterable<String?> fields) {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return true;
    final clean = q.startsWith('#') ? q.substring(1) : q;
    return fields.any(
      (f) => f != null && f.toLowerCase().contains(clean),
    );
  }

  Future<void> _copyNaddr({
    required int kind,
    required String pubkey,
    required String dTag,
  }) async {
    try {
      await RustBridge.ensureInitialized();
      final uri = await encodeNaddrCoordinate(
        kind: kind,
        pubkeyHex: pubkey,
        dTag: dTag,
        relays: widget.relayUrls,
      );
      await Clipboard.setData(ClipboardData(text: uri));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Copied nostr:naddr1… link')),
      );
    } catch (_) {}
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final catalog = await fetchEarthlyCatalog(
        relayUrls: widget.relayUrls,
        limitPerKind: 250,
      );
      if (!mounted) return;
      setState(() => _catalog = catalog);
      widget.onCatalogLoaded(catalog);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final catalog = _catalog;
    final isLoading = _loading || (catalog == null && widget.catalogLoading);

    return EarthlyMapDrawer(
      initialFraction: 0.56,
      onClose: widget.onClose,
      header: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 8, 2),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.relayUrls.length > 1
                        ? 'EXPLORE · RELAY + NEARBY PEER'
                        : 'EXPLORE · RELAY.EARTHLY.CITY',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontFamily: 'monospace',
                      letterSpacing: 0.7,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh',
                  visualDensity: VisualDensity.compact,
                  onPressed: isLoading ? null : _refresh,
                  icon: isLoading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh, size: 18),
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
            controller: _tabs,
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              Tab(text: 'Maps (${catalog?.maps.length ?? 0})'),
              Tab(text: 'Stories (${catalog?.stories.length ?? 0})'),
              Tab(text: 'Atlases (${catalog?.atlases.length ?? 0})'),
              Tab(text: 'Sightings (${catalog?.sightings.length ?? 0})'),
              Tab(text: 'Live (${catalog?.beacons.length ?? 0})'),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
            child: TextField(
              controller: _searchController,
              onChanged: (val) => setState(() => _query = val),
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search, size: 17),
                hintText: 'Filter by title, #tag, or author…',
                suffixIcon: _query.isNotEmpty
                    ? IconButton(
                        visualDensity: VisualDensity.compact,
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _query = '');
                        },
                        icon: const Icon(Icons.clear, size: 16),
                      )
                    : null,
              ),
            ),
          ),
          if (_error != null)
            Container(
              width: double.infinity,
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
          Expanded(
            child: catalog == null && isLoading
                ? const Center(child: CircularProgressIndicator())
                : TabBarView(
                    controller: _tabs,
                    children: [
                      _buildMapsList(catalog?.maps ?? const []),
                      _buildStoriesList(catalog?.stories ?? const []),
                      _buildAtlasesList(catalog?.atlases ?? const []),
                      _buildSightingsList(catalog?.sightings ?? const []),
                      _buildBeaconsList(catalog?.beacons ?? const []),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildMapsList(List<MapSummaryDto> maps) {
    final filtered = maps
        .where(
          (m) => _matchesQuery([
            m.title,
            m.description,
            _authorLabel(m.pubkey),
            ...m.hashtags,
            ...m.labels,
          ]),
        )
        .toList(growable: false);
    if (filtered.isEmpty) {
      return Center(
        child: Text(
          _query.isEmpty
              ? 'Listening for maps…'
              : 'No maps match "$_query".',
        ),
      );
    }
    return ListView.builder(
      itemCount: filtered.length,
      itemBuilder: (context, index) {
        final map = filtered[index];
        final onShelf = widget.shelfAddresses.contains(map.address);
        final dateStr = formatRelativeUnixDate(map.createdAt.toInt());
        final sizeStr = formatByteSize(map.sizeBytes);
        final tagsStr = map.hashtags.isNotEmpty
            ? map.hashtags.take(2).map((t) => '#$t').join(' ')
            : '';
        final metaParts = <String>[
          _authorLabel(map.pubkey),
          if (dateStr.isNotEmpty) dateStr,
          '${map.featureCount} feat',
          if (sizeStr.isNotEmpty) sizeStr,
          if (tagsStr.isNotEmpty) tagsStr,
        ];

        return EarthlyEntityListRow(
          leading: EarthlyGeometryThumb(
            cacheKey: map.eventId,
            geojson: map.geojson,
          ),
          title: map.title,
          meta: metaParts.join(' · '),
          selected: onShelf,
          onTap: () {
            if (!onShelf) {
              widget.onToggleMapOnShelf(map);
            } else {
              widget.onFocusMap(map);
            }
          },
          primaryAction: IconButton(
            tooltip: onShelf ? 'Remove from map' : 'Show on map',
            visualDensity: VisualDensity.compact,
            onPressed: () => widget.onToggleMapOnShelf(map),
            icon: Icon(
              onShelf ? Icons.layers : Icons.layers_outlined,
              size: 20,
              color: onShelf ? EarthlyColors.commentGreen : null,
            ),
          ),
          menuActions: [
            EntityRowMenuAction(
              label: onShelf ? 'Remove from map' : 'Show on map',
              icon: onShelf ? Icons.layers_clear_outlined : Icons.layers,
              onSelected: () => widget.onToggleMapOnShelf(map),
            ),
            EntityRowMenuAction(
              label: 'Zoom to map',
              icon: Icons.center_focus_strong,
              onSelected: () {
                if (!onShelf) widget.onToggleMapOnShelf(map);
                widget.onFocusMap(map);
              },
            ),
            EntityRowMenuAction(
              label: 'Comments & Proposals',
              icon: Icons.forum_outlined,
              onSelected: () => widget.onOpenMapDiscussion(map),
            ),
            EntityRowMenuAction(
              label: 'Clone / Fork to Draft',
              icon: Icons.copy_all_outlined,
              onSelected: () => widget.onCloneMapToDraft(map),
            ),
            EntityRowMenuAction(
              label: 'Copy nostr:naddr1… link',
              icon: Icons.link,
              onSelected: () => _copyNaddr(
                kind: 37515,
                pubkey: map.pubkey,
                dTag: map.dTag,
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildStoriesList(List<StorySummaryDto> stories) {
    final filtered = stories
        .where(
          (s) => _matchesQuery([s.title, s.summary, _authorLabel(s.pubkey)]),
        )
        .toList(growable: false);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: widget.onComposeStory,
              icon: const Icon(Icons.edit_note, size: 17),
              label: const Text('New Story'),
            ),
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: filtered.isEmpty
              ? Center(
                  child: Text(
                    _query.isEmpty
                        ? 'Listening for stories…'
                        : 'No stories match "$_query".',
                  ),
                )
              : ListView.builder(
                  itemCount: filtered.length,
                  itemBuilder: (context, index) {
                    final story = filtered[index];
                    final linkedCount = story.referencedAddresses.length;
                    final dateStr =
                        formatRelativeUnixDate(story.publishedAt.toInt());
                    final metaParts = <String>[
                      _authorLabel(story.pubkey),
                      if (dateStr.isNotEmpty) dateStr,
                      if (linkedCount > 0)
                        '$linkedCount map${linkedCount == 1 ? '' : 's'}',
                    ];

                    return EarthlyEntityListRow(
                      leading: EarthlyCoverThumb(
                        imageUrl: story.image,
                        fallbackIcon: Icons.auto_stories_outlined,
                      ),
                      title: story.title,
                      subtitle: story.summary,
                      meta: metaParts.join(' · '),
                      badges: [
                        if (story.presentationJson != null)
                          const EarthlyBadge(
                            label: 'INTERACTIVE VIEWS',
                            color: EarthlyColors.infoCyan,
                          ),
                      ],
                      onTap: () => widget.onOpenStory(story),
                      primaryAction: IconButton(
                        tooltip: 'Open Story',
                        visualDensity: VisualDensity.compact,
                        onPressed: () => widget.onOpenStory(story),
                        icon: const Icon(Icons.chevron_right, size: 20),
                      ),
                      menuActions: [
                        EntityRowMenuAction(
                          label: 'Read story',
                          icon: Icons.auto_stories_outlined,
                          onSelected: () => widget.onOpenStory(story),
                        ),
                        EntityRowMenuAction(
                          label: 'Story comments',
                          icon: Icons.forum_outlined,
                          onSelected: () => widget.onOpenStoryDiscussion(story),
                        ),
                        EntityRowMenuAction(
                          label: 'Copy nostr:naddr1… link',
                          icon: Icons.link,
                          onSelected: () => _copyNaddr(
                            kind: 37520,
                            pubkey: story.pubkey,
                            dTag: story.dTag,
                          ),
                        ),
                      ],
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildAtlasesList(List<AtlasSummaryDto> atlases) {
    final filtered = atlases
        .where(
          (a) => _matchesQuery([
            a.name,
            a.description,
            a.governance,
            _authorLabel(a.pubkey),
          ]),
        )
        .toList(growable: false);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: widget.onCreateAtlas,
              icon: const Icon(
                Icons.public,
                size: 16,
                color: EarthlyColors.commentGreen,
              ),
              label: const Text('New Atlas'),
            ),
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: filtered.isEmpty
              ? Center(
                  child: Text(
                    _query.isEmpty
                        ? 'Listening for atlases…'
                        : 'No atlases match "$_query".',
                  ),
                )
              : ListView.builder(
                  itemCount: filtered.length,
                  itemBuilder: (context, index) {
                    final atlas = filtered[index];
                    final govLabel = switch (atlas.governance) {
                      'closed' => 'AUTHOR PICKS',
                      'schema' => 'SCHEMA',
                      _ => 'OPEN TO CONTRIBUTIONS',
                    };
                    final govColor = atlas.governance == 'open'
                        ? EarthlyColors.commentGreen
                        : EarthlyColors.published;

                    return EarthlyEntityListRow(
                      leading: EarthlyCoverThumb(
                        imageUrl: atlas.image,
                        fallbackIcon: Icons.public,
                      ),
                      title: atlas.name,
                      subtitle: atlas.description,
                      meta:
                          '${_authorLabel(atlas.pubkey)} · ${atlas.pinnedAddresses.length} pinned',
                      badges: [
                        EarthlyBadge(label: govLabel, color: govColor),
                      ],
                      onTap: () => widget.onOpenAtlas(atlas),
                      primaryAction: IconButton(
                        tooltip: 'Show Atlas maps',
                        visualDensity: VisualDensity.compact,
                        onPressed: atlas.pinnedAddresses.isEmpty
                            ? null
                            : () => widget.onOpenAtlas(atlas),
                        icon: const Icon(Icons.layers_outlined, size: 20),
                      ),
                      menuActions: [
                        if (atlas.pinnedAddresses.isNotEmpty)
                          EntityRowMenuAction(
                            label: 'Show all on map',
                            icon: Icons.layers,
                            onSelected: () => widget.onOpenAtlas(atlas),
                          ),
                        EntityRowMenuAction(
                          label: 'Copy nostr:naddr1… link',
                          icon: Icons.link,
                          onSelected: () => _copyNaddr(
                            kind: 37518,
                            pubkey: atlas.pubkey,
                            dTag: atlas.dTag,
                          ),
                        ),
                      ],
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildSightingsList(List<SightingSummaryDto> sightings) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: widget.onCreateSighting,
              icon: const Icon(Icons.add_a_photo_outlined, size: 16),
              label: const Text('Drop Field Sighting (GPS + Photo)'),
            ),
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: sightings.isEmpty
              ? const Center(child: Text('No active sightings right now.'))
              : ListView.builder(
                  itemCount: sightings.length,
                  itemBuilder: (context, index) {
                    final s = sightings[index];
                    final title =
                        s.title ?? (s.note.isNotEmpty ? s.note : 'Sighting');
                    final dateStr = formatRelativeUnixDate(s.start.toInt());
                    return EarthlyEntityListRow(
                      leading: GestureDetector(
                        onTap: (s.imageUrl != null && s.imageUrl!.isNotEmpty)
                            ? () => showEarthlyPhotoLightbox(
                                  context,
                                  url: s.imageUrl!,
                                  caption: title,
                                )
                            : null,
                        child: EarthlyCoverThumb(
                          imageUrl: s.imageUrl,
                          fallbackIcon: Icons.visibility,
                          fallbackColor: EarthlyColors.proposedAmber,
                        ),
                      ),
                      title: title,
                      subtitle: s.title != null && s.note.isNotEmpty
                          ? s.note
                          : null,
                      meta:
                          '${_authorLabel(s.pubkey)}${dateStr.isNotEmpty ? ' · $dateStr' : ''} · ${s.lat.toStringAsFixed(3)}, ${s.lon.toStringAsFixed(3)}',
                      badges: const [
                        EarthlyBadge(
                          label: 'LIVE',
                          color: EarthlyColors.proposedAmber,
                          filled: true,
                        ),
                      ],
                      onTap: () => widget.onFocusSighting(s),
                      primaryAction: IconButton(
                        tooltip: 'Locate on map',
                        visualDensity: VisualDensity.compact,
                        onPressed: () => widget.onFocusSighting(s),
                        icon: const Icon(Icons.my_location, size: 18),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildBeaconsList(List<LiveBeaconDto> beacons) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: widget.onOpenBeaconBroadcaster,
              icon: const Icon(
                Icons.sensors,
                size: 16,
                color: EarthlyColors.commentGreen,
              ),
              label: const Text('Broadcast Live Beacon'),
            ),
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: beacons.isEmpty
              ? const Center(child: Text('No active live beacons right now.'))
              : ListView.builder(
                  itemCount: beacons.length,
                  itemBuilder: (context, index) {
                    final b = beacons[index];
                    final seen = formatRelativeUnixDate(b.createdAt.toInt());
                    return EarthlyEntityListRow(
                      leading: SizedBox(
                        width: 68,
                        height: 54,
                        child: Center(
                          child: Stack(
                            children: [
                              Container(
                                width: 42,
                                height: 42,
                                decoration: BoxDecoration(
                                  color: EarthlyColors.commentGreen
                                      .withValues(alpha: 0.18),
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(
                                  Icons.sensors,
                                  size: 20,
                                  color: EarthlyColors.commentGreen,
                                ),
                              ),
                              Positioned(
                                right: 0,
                                bottom: 0,
                                child: Container(
                                  width: 11,
                                  height: 11,
                                  decoration: BoxDecoration(
                                    color: EarthlyColors.commentGreen,
                                    shape: BoxShape.circle,
                                    border: Border.all(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .surface,
                                      width: 2,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      title: (b.status != null && b.status!.trim().isNotEmpty)
                          ? b.status!
                          : _authorLabel(b.pubkey),
                      meta:
                          '${_authorLabel(b.pubkey)}${seen.isNotEmpty ? ' · last seen $seen' : ''}',
                      badges: const [
                        EarthlyBadge(
                          label: 'LIVE',
                          color: EarthlyColors.commentGreen,
                          filled: true,
                        ),
                      ],
                      selected: true,
                      selectedColor: EarthlyColors.commentGreen,
                      onTap: () => widget.onFocusBeacon(b),
                      primaryAction: IconButton(
                        tooltip: 'Watch on map',
                        visualDensity: VisualDensity.compact,
                        onPressed: () => widget.onFocusBeacon(b),
                        icon: const Icon(Icons.my_location, size: 19),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
