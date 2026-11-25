import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';

/// Explore drawer: live Nostr relay catalog (Maps · Stories · Atlases · Sightings)
/// rendered inside the Google-Maps-style independent `EarthlyMapDrawer`.
class ExploreSheet extends StatefulWidget {
  const ExploreSheet({
    required this.initialCatalog,
    required this.relayUrls,
    required this.shelfAddresses,
    required this.onCatalogLoaded,
    required this.onToggleMapOnShelf,
    required this.onOpenStory,
    required this.onOpenAtlas,
    required this.onFocusSighting,
    required this.onFocusBeacon,
    required this.onCreateSighting,
    required this.onComposeStory,
    required this.onOpenBeaconBroadcaster,
    required this.onClose,
    super.key,
  });

  final EarthlyCatalogSnapshot? initialCatalog;
  final List<String> relayUrls;
  final Set<String> shelfAddresses;
  final ValueChanged<EarthlyCatalogSnapshot> onCatalogLoaded;
  final ValueChanged<MapSummaryDto> onToggleMapOnShelf;
  final ValueChanged<StorySummaryDto> onOpenStory;
  final ValueChanged<AtlasSummaryDto> onOpenAtlas;
  final ValueChanged<SightingSummaryDto> onFocusSighting;
  final ValueChanged<LiveBeaconDto> onFocusBeacon;
  final VoidCallback onCreateSighting;
  final VoidCallback onComposeStory;
  final VoidCallback onOpenBeaconBroadcaster;
  final VoidCallback onClose;

  @override
  State<ExploreSheet> createState() => _ExploreSheetState();
}

class _ExploreSheetState extends State<ExploreSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  EarthlyCatalogSnapshot? _catalog;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 5, vsync: this);
    _catalog = widget.initialCatalog;
    if (_catalog == null) {
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
    super.dispose();
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
        limitPerKind: 25,
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

    return EarthlyMapDrawer(
      initialFraction: 0.52,
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
                  onPressed: _loading ? null : _refresh,
                  icon: _loading
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
            child: catalog == null && _loading
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
    if (maps.isEmpty) {
      return const Center(child: Text('No published maps loaded yet.'));
    }
    return ListView.separated(
      itemCount: maps.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final map = maps[index];
        final onShelf = widget.shelfAddresses.contains(map.address);
        return ListTile(
          title: Text(
            map.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          subtitle: Text(
            '${map.featureCount} features${map.hashtags.isNotEmpty ? ' · #${map.hashtags.take(3).join(' #')}' : ''}',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
          ),
          trailing: OutlinedButton(
            onPressed: () => widget.onToggleMapOnShelf(map),
            child: Text(onShelf ? 'Remove' : 'Show'),
          ),
        );
      },
    );
  }

  Widget _buildStoriesList(List<StorySummaryDto> stories) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 6),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: widget.onComposeStory,
              icon: const Icon(Icons.edit_note, size: 17),
              label: const Text('Compose Story (37520)'),
            ),
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: stories.isEmpty
              ? const Center(child: Text('No v2 stories found on relay.'))
              : ListView.separated(
                  itemCount: stories.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final story = stories[index];
                    final linkedCount = story.referencedAddresses.length;
                    return ListTile(
                      leading: const Icon(
                        Icons.auto_stories_outlined,
                        color: EarthlyColors.lightAccent,
                      ),
                      title: Text(
                        story.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (story.summary != null &&
                              story.summary!.isNotEmpty)
                            Text(
                              story.summary!,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          Text(
                            '${linkedCount > 0 ? '$linkedCount linked map${linkedCount == 1 ? '' : 's'}' : 'Geo narrative'}${story.presentationJson != null ? ' · interactive views' : ''}',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                      trailing: const Icon(Icons.chevron_right, size: 18),
                      onTap: () => widget.onOpenStory(story),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildAtlasesList(List<AtlasSummaryDto> atlases) {
    if (atlases.isEmpty) {
      return const Center(child: Text('No v2 atlases found on relay.'));
    }
    return ListView.separated(
      itemCount: atlases.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final atlas = atlases[index];
        return ListTile(
          leading: const Icon(
            Icons.collections_bookmark_outlined,
            color: EarthlyColors.commentGreen,
          ),
          title: Text(
            atlas.name,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          subtitle: Text(
            '${atlas.governance} · ${atlas.pinnedAddresses.length} pinned map${atlas.pinnedAddresses.length == 1 ? '' : 's'}',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
          ),
          trailing: OutlinedButton(
            onPressed: atlas.pinnedAddresses.isEmpty
                ? null
                : () => widget.onOpenAtlas(atlas),
            child: const Text('Load'),
          ),
        );
      },
    );
  }

  Widget _buildSightingsList(List<SightingSummaryDto> sightings) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 6),
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
              : ListView.separated(
                  itemCount: sightings.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final s = sightings[index];
                    return ListTile(
                      leading: s.imageUrl != null && s.imageUrl!.isNotEmpty
                          ? SizedBox(
                              width: 36,
                              height: 36,
                              child: Image.network(
                                s.imageUrl!,
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) => const Icon(
                                  Icons.visibility,
                                  color: Color(0xFFD97706),
                                ),
                              ),
                            )
                          : const Icon(
                              Icons.visibility,
                              color: Color(0xFFD97706),
                            ),
                      title: Text(
                        s.title ?? (s.note.isNotEmpty ? s.note : 'Sighting'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        '${s.lat.toStringAsFixed(4)}, ${s.lon.toStringAsFixed(4)}',
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                        ),
                      ),
                      onTap: () => widget.onFocusSighting(s),
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
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 6),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: widget.onOpenBeaconBroadcaster,
              icon: const Icon(
                Icons.sensors,
                size: 16,
                color: Color(0xFF0891B2),
              ),
              label: const Text('Broadcast Live Beacon (37521)'),
            ),
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: beacons.isEmpty
              ? const Center(child: Text('No active live beacons right now.'))
              : ListView.separated(
                  itemCount: beacons.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final b = beacons[index];
                    final shortKey = b.pubkey.length > 10
                        ? '${b.pubkey.substring(0, 10)}…'
                        : b.pubkey;
                    return ListTile(
                      leading: const Icon(
                        Icons.sensors,
                        color: Color(0xFF0891B2),
                      ),
                      title: Text(
                        (b.status != null && b.status!.trim().isNotEmpty)
                            ? b.status!
                            : 'Live Beacon · $shortKey',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      subtitle: Text(
                        '${b.lat.toStringAsFixed(4)}, ${b.lon.toStringAsFixed(4)} · $shortKey',
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                        ),
                      ),
                      trailing: const Icon(Icons.my_location, size: 17),
                      onTap: () => widget.onFocusBeacon(b),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
