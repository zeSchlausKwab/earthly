import 'dart:ui';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'earthly_toast.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

enum _CatalogScopeTab { all, favorites, recent }

enum _CatalogSortOrder { newest, titleAsc, featuresDesc, sizeDesc }

/// Explore drawer: live Nostr relay catalog (Maps · Stories · Atlases · Sightings · Live)
/// replicating Earthly Web's `GeoDatasetsPanel` + `ListRow` grammar:
/// - `All | Favorites | Recent` persisted filter strip
/// - Sort order (`Newest`, `A–Z`, `Features`, `Size`)
/// - Bulk "Show filtered on map" button
/// - Active Atlas Lens scoping
/// - Vector geometry thumbnails for Maps, cover images for Stories/Atlases/Sightings
class ExploreSheet extends StatefulWidget {
  const ExploreSheet({
    required this.initialCatalog,
    required this.catalogLoading,
    required this.relayUrls,
    required this.shelfAddresses,
    required this.profilesByPubkey,
    required this.pinnedEntityIds,
    required this.recentEntityIds,
    required this.activeAtlasLens,
    required this.onCatalogLoaded,
    required this.onToggleFavorite,
    required this.onToggleMapOnShelf,
    required this.onAddMapsBulk,
    required this.onInspectMap,
    required this.onFocusMap,
    required this.onCloneMapToDraft,
    required this.onOpenMapDiscussion,
    required this.onOpenStory,
    required this.onOpenStoryDiscussion,
    required this.onInspectAtlas,
    required this.onOpenAtlas,
    required this.onEnterAtlasLens,
    required this.onLeaveAtlasLens,
    required this.onFocusSighting,
    required this.onFocusBeacon,
    required this.onCreateSighting,
    required this.onComposeStory,
    required this.onCreateAtlas,
    required this.onOpenBeaconBroadcaster,
    this.onOpenPerson,
    this.galleryMode = false,
    this.galleryPreviewLoading = false,
    this.onGalleryModeChanged,
    this.onPreviewGalleryMap,
    this.onPreviewGalleryStory,
    this.onPreviewGalleryAtlas,
    this.onClearGalleryPreview,
    this.onBack,
    required this.onClose,
    super.key,
  });

  final EarthlyCatalogSnapshot? initialCatalog;
  final bool catalogLoading;
  final List<String> relayUrls;
  final Set<String> shelfAddresses;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final Set<String> pinnedEntityIds;
  final List<String> recentEntityIds;
  final AtlasSummaryDto? activeAtlasLens;
  final ValueChanged<EarthlyCatalogSnapshot> onCatalogLoaded;
  final ValueChanged<String> onToggleFavorite;
  final ValueChanged<MapSummaryDto> onToggleMapOnShelf;
  final ValueChanged<List<MapSummaryDto>> onAddMapsBulk;
  final ValueChanged<MapSummaryDto> onInspectMap;
  final ValueChanged<MapSummaryDto> onFocusMap;
  final ValueChanged<MapSummaryDto> onCloneMapToDraft;
  final ValueChanged<MapSummaryDto> onOpenMapDiscussion;
  final ValueChanged<StorySummaryDto> onOpenStory;
  final ValueChanged<StorySummaryDto> onOpenStoryDiscussion;
  final ValueChanged<AtlasSummaryDto> onInspectAtlas;
  final ValueChanged<AtlasSummaryDto> onOpenAtlas;
  final ValueChanged<AtlasSummaryDto> onEnterAtlasLens;
  final VoidCallback onLeaveAtlasLens;
  final ValueChanged<SightingSummaryDto> onFocusSighting;
  final ValueChanged<LiveBeaconDto> onFocusBeacon;
  final VoidCallback onCreateSighting;
  final VoidCallback onComposeStory;
  final VoidCallback onCreateAtlas;
  final VoidCallback onOpenBeaconBroadcaster;
  final ValueChanged<String>? onOpenPerson;
  final bool galleryMode;
  final bool galleryPreviewLoading;
  final ValueChanged<bool>? onGalleryModeChanged;
  final ValueChanged<MapSummaryDto>? onPreviewGalleryMap;
  final ValueChanged<StorySummaryDto>? onPreviewGalleryStory;
  final ValueChanged<AtlasSummaryDto>? onPreviewGalleryAtlas;
  final VoidCallback? onClearGalleryPreview;
  final VoidCallback? onBack;
  final VoidCallback onClose;

  @override
  State<ExploreSheet> createState() => _ExploreSheetState();
}

class _ExploreSheetState extends State<ExploreSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  late final PageController _galleryPageController;
  final _searchController = TextEditingController();
  EarthlyCatalogSnapshot? _catalog;
  String _query = '';
  _CatalogScopeTab _scopeTab = _CatalogScopeTab.all;
  _CatalogSortOrder _sortOrder = _CatalogSortOrder.newest;
  bool _loading = false;
  late bool _galleryMode = widget.galleryMode;
  int _galleryIndex = 0;
  String? _lastPreviewedEntityKey;
  bool _galleryPreviewScheduled = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 6, vsync: this);
    _tabs.addListener(_onTabChanged);
    _galleryPageController = PageController(viewportFraction: 0.88);
    _catalog = widget.initialCatalog;
    if (_catalog == null && !widget.catalogLoading) {
      _refresh();
    }
  }

  void _onTabChanged() {
    if (!mounted) return;
    if (_tabs.index > 2 && _galleryMode) {
      _galleryMode = false;
      _lastPreviewedEntityKey = null;
      widget.onGalleryModeChanged?.call(false);
      widget.onClearGalleryPreview?.call();
    } else if (_galleryMode && !_tabs.indexIsChanging) {
      _galleryIndex = 0;
      _lastPreviewedEntityKey = null;
      if (_galleryPageController.hasClients) {
        _galleryPageController.jumpToPage(0);
      }
      _scheduleActiveGalleryPreview();
    }
    setState(() {});
  }

  @override
  void didUpdateWidget(covariant ExploreSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialCatalog != null &&
        widget.initialCatalog != oldWidget.initialCatalog) {
      _catalog = widget.initialCatalog;
    }
    if (widget.galleryMode != oldWidget.galleryMode &&
        widget.galleryMode != _galleryMode) {
      _galleryMode = widget.galleryMode;
      if (!_galleryMode) {
        _lastPreviewedEntityKey = null;
      } else {
        _scheduleActiveGalleryPreview();
      }
    }
  }

  @override
  void dispose() {
    _tabs.removeListener(_onTabChanged);
    _tabs.dispose();
    _galleryPageController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _toggleGalleryMode(bool enabled) {
    if (_galleryMode == enabled) return;
    HapticFeedback.selectionClick();
    setState(() {
      _galleryMode = enabled;
      _galleryIndex = 0;
      _lastPreviewedEntityKey = null;
    });
    widget.onGalleryModeChanged?.call(enabled);
    if (!enabled) {
      widget.onClearGalleryPreview?.call();
      return;
    }
    if (_galleryPageController.hasClients) {
      _galleryPageController.jumpToPage(0);
    }
    _scheduleActiveGalleryPreview();
  }

  void _selectGalleryTab(int tabIndex) {
    if (tabIndex < 0 || tabIndex > 2) return;
    HapticFeedback.selectionClick();
    setState(() {
      _galleryIndex = 0;
      _lastPreviewedEntityKey = null;
      if (_tabs.index != tabIndex) {
        _tabs.index = tabIndex;
      }
    });
    if (_galleryPageController.hasClients) {
      _galleryPageController.jumpToPage(0);
    }
    _scheduleActiveGalleryPreview();
  }

  void _scheduleActiveGalleryPreview() {
    if (_galleryPreviewScheduled) return;
    _galleryPreviewScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _galleryPreviewScheduled = false;
      if (!mounted || !_galleryMode || _tabs.index > 2) return;
      final catalog = _catalog;
      final visibleMaps = _filteredMaps(catalog?.maps ?? const []);
      final visibleStories = _filteredStories(catalog?.stories ?? const []);
      final visibleAtlases = _filteredAtlases(catalog?.atlases ?? const []);
      _previewGalleryItemForIndex(
        _tabs.index,
        _galleryIndex,
        visibleMaps: visibleMaps,
        visibleStories: visibleStories,
        visibleAtlases: visibleAtlases,
      );
    });
  }

  void _previewGalleryItemForIndex(
    int tabIndex,
    int rawIndex, {
    required List<MapSummaryDto> visibleMaps,
    required List<StorySummaryDto> visibleStories,
    required List<AtlasSummaryDto> visibleAtlases,
  }) {
    if (!_galleryMode || tabIndex > 2) return;
    switch (tabIndex) {
      case 0:
        if (visibleMaps.isEmpty) {
          if (_lastPreviewedEntityKey != null) {
            _lastPreviewedEntityKey = null;
            widget.onClearGalleryPreview?.call();
          }
          return;
        }
        final idx = rawIndex.clamp(0, visibleMaps.length - 1);
        final map = visibleMaps[idx];
        final key = 'map:${map.address}';
        if (_lastPreviewedEntityKey == key) return;
        _lastPreviewedEntityKey = key;
        widget.onPreviewGalleryMap?.call(map);
      case 1:
        if (visibleStories.isEmpty) {
          if (_lastPreviewedEntityKey != null) {
            _lastPreviewedEntityKey = null;
            widget.onClearGalleryPreview?.call();
          }
          return;
        }
        final idx = rawIndex.clamp(0, visibleStories.length - 1);
        final story = visibleStories[idx];
        final key = 'story:${story.address}';
        if (_lastPreviewedEntityKey == key) return;
        _lastPreviewedEntityKey = key;
        widget.onPreviewGalleryStory?.call(story);
      case 2:
        if (visibleAtlases.isEmpty) {
          if (_lastPreviewedEntityKey != null) {
            _lastPreviewedEntityKey = null;
            widget.onClearGalleryPreview?.call();
          }
          return;
        }
        final idx = rawIndex.clamp(0, visibleAtlases.length - 1);
        final atlas = visibleAtlases[idx];
        final key = 'atlas:${atlas.address}';
        if (_lastPreviewedEntityKey == key) return;
        _lastPreviewedEntityKey = key;
        widget.onPreviewGalleryAtlas?.call(atlas);
    }
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

  int _recentRank(String entityKey) => widget.recentEntityIds.indexOf(entityKey);

  List<MapSummaryDto> _filteredMaps(List<MapSummaryDto> maps) {
    final lens = widget.activeAtlasLens;
    final lensPinned = lens?.pinnedAddresses.toSet();
    final list = maps.where((m) {
      if (lens != null &&
          !(lensPinned!.contains(m.address) ||
              m.contextRefs.contains(lens.address))) {
        return false;
      }
      final key = 'map:${m.address}';
      if (_scopeTab == _CatalogScopeTab.favorites &&
          !widget.pinnedEntityIds.contains(key)) {
        return false;
      }
      if (_scopeTab == _CatalogScopeTab.recent && _recentRank(key) < 0) {
        return false;
      }
      return _matchesQuery([
        m.title,
        m.description,
        _authorLabel(m.pubkey),
        ...m.hashtags,
        ...m.labels,
      ]);
    }).toList();

    if (_scopeTab == _CatalogScopeTab.recent) {
      list.sort(
        (a, b) =>
            _recentRank('map:${a.address}').compareTo(_recentRank('map:${b.address}')),
      );
      return list;
    }
    switch (_sortOrder) {
      case _CatalogSortOrder.newest:
        list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      case _CatalogSortOrder.titleAsc:
        list.sort(
          (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
        );
      case _CatalogSortOrder.featuresDesc:
        list.sort((a, b) => b.featureCount.compareTo(a.featureCount));
      case _CatalogSortOrder.sizeDesc:
        list.sort((a, b) => b.sizeBytes.compareTo(a.sizeBytes));
    }
    return list;
  }

  List<StorySummaryDto> _filteredStories(List<StorySummaryDto> stories) {
    final lens = widget.activeAtlasLens;
    final lensPinned = lens?.pinnedAddresses.toSet();
    final list = stories.where((s) {
      if (lens != null &&
          !(lensPinned!.contains(s.address) ||
              s.referencedAddresses.contains(lens.address))) {
        return false;
      }
      final key = 'story:${s.address}';
      if (_scopeTab == _CatalogScopeTab.favorites &&
          !widget.pinnedEntityIds.contains(key)) {
        return false;
      }
      if (_scopeTab == _CatalogScopeTab.recent && _recentRank(key) < 0) {
        return false;
      }
      return _matchesQuery([s.title, s.summary, _authorLabel(s.pubkey)]);
    }).toList();

    if (_scopeTab == _CatalogScopeTab.recent) {
      list.sort(
        (a, b) => _recentRank('story:${a.address}')
            .compareTo(_recentRank('story:${b.address}')),
      );
      return list;
    }
    if (_sortOrder == _CatalogSortOrder.titleAsc) {
      list.sort((a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()));
    } else {
      list.sort((a, b) => b.publishedAt.compareTo(a.publishedAt));
    }
    return list;
  }

  List<AtlasSummaryDto> _filteredAtlases(List<AtlasSummaryDto> atlases) {
    final list = atlases.where((a) {
      final key = 'atlas:${a.address}';
      if (_scopeTab == _CatalogScopeTab.favorites &&
          !widget.pinnedEntityIds.contains(key)) {
        return false;
      }
      if (_scopeTab == _CatalogScopeTab.recent && _recentRank(key) < 0) {
        return false;
      }
      return _matchesQuery([
        a.name,
        a.description,
        a.governance,
        _authorLabel(a.pubkey),
        ...a.hashtags,
      ]);
    }).toList();

    if (_scopeTab == _CatalogScopeTab.recent) {
      list.sort(
        (a, b) => _recentRank('atlas:${a.address}')
            .compareTo(_recentRank('atlas:${b.address}')),
      );
      return list;
    }
    if (_sortOrder == _CatalogSortOrder.titleAsc) {
      list.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    } else {
      list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    }
    return list;
  }

  List<SightingSummaryDto> _filteredSightings(
    List<SightingSummaryDto> sightings,
  ) {
    final list = sightings
        .where(
          (s) => _matchesQuery([s.title, s.note, s.dTag, _authorLabel(s.pubkey)]),
        )
        .toList();
    list.sort((a, b) => b.start.compareTo(a.start));
    return list;
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
      EarthlyToast.success(context, 'Copied nostr:naddr1… link');
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
    final visibleMaps = _filteredMaps(catalog?.maps ?? const []);
    final visibleStories = _filteredStories(catalog?.stories ?? const []);
    final visibleAtlases = _filteredAtlases(catalog?.atlases ?? const []);
    final visibleSightings =
        _filteredSightings(catalog?.sightings ?? const []);
    final visiblePeople = _filteredPeople(catalog);
    final unstackedMaps = visibleMaps
        .where((m) => !widget.shelfAddresses.contains(m.address))
        .toList(growable: false);

    final isDesktop = MediaQuery.sizeOf(context).width >= 880;
    if (!isDesktop && _galleryMode && _tabs.index <= 2) {
      return _buildMobileGalleryCarousel(
        context,
        visibleMaps: visibleMaps,
        visibleStories: visibleStories,
        visibleAtlases: visibleAtlases,
        isLoading: isLoading,
      );
    }

    return EarthlyMapDrawer(
      initialFraction: 0.56,
      accentTopBorder: widget.activeAtlasLens != null,
      onClose: widget.onClose,
      header: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              if (widget.onBack != null)
                IconButton(
                  key: const Key('explore-back-btn'),
                  tooltip: 'Back',
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.onBack,
                  icon: const Icon(Icons.arrow_back, size: 18),
                ),
              Expanded(
                child: TabBar(
                  controller: _tabs,
                  isScrollable: true,
                  tabAlignment: TabAlignment.start,
                  dividerHeight: 0,
                  tabs: [
                    Tab(text: 'Maps (${visibleMaps.length})'),
                    Tab(text: 'Stories (${visibleStories.length})'),
                    Tab(text: 'Atlases (${visibleAtlases.length})'),
                    Tab(text: 'Sightings (${visibleSightings.length})'),
                    Tab(text: 'Live (${catalog?.beacons.length ?? 0})'),
                    Tab(
                      key: const Key('explore-tab-people'),
                      text: 'People (${visiblePeople.length})',
                    ),
                  ],
                ),
              ),
              if (isDesktop) ...[
                IconButton(
                  tooltip: 'Refresh catalog',
                  visualDensity: VisualDensity.compact,
                  onPressed: isLoading ? null : _refresh,
                  icon: const Icon(Icons.refresh, size: 17),
                ),
                IconButton(
                  tooltip: 'Close',
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close, size: 17),
                ),
                const SizedBox(width: 4),
              ],
            ],
          ),
          if (isLoading)
            const LinearProgressIndicator(
              minHeight: 2,
              color: EarthlyColors.amber,
              backgroundColor: Colors.transparent,
            ),
        ],
      ),
      body: Column(
        children: [
          if (widget.activeAtlasLens != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
              decoration: BoxDecoration(
                color: EarthlyColors.amber.withValues(alpha: 0.14),
                border: Border(
                  bottom: BorderSide(
                    color: EarthlyColors.amber.withValues(alpha: 0.45),
                  ),
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.filter_tilt_shift,
                    size: 15,
                    color: EarthlyColors.lightAccent,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Scoped to Atlas: ${widget.activeAtlasLens!.name}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  TextButton(
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                    onPressed: widget.onLeaveAtlasLens,
                    child: const Text('Leave'),
                  ),
                ],
              ),
            ),

          // Search + inline square New Sighting / Live Beacon CTA when on tabs 3–4
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
            child: Row(
              children: [
                Expanded(
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
                if (_tabs.index == 3) ...[
                  const SizedBox(width: 8),
                  _ExploreSquareCreateButton(
                    tooltip: 'Drop Field Sighting (GPS + Photo)',
                    icon: Icons.add_a_photo_outlined,
                    onTap: widget.onCreateSighting,
                  ),
                ] else if (_tabs.index == 4) ...[
                  const SizedBox(width: 8),
                  _ExploreSquareCreateButton(
                    tooltip: 'Broadcast Live Beacon',
                    icon: Icons.sensors,
                    onTap: widget.onOpenBeaconBroadcaster,
                  ),
                ],
              ],
            ),
          ),

          if (_tabs.index <= 2)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 2, 12, 4),
              child: Row(
                children: [
                  // All | Favorites | Recent pill strip (matching Web GeoDatasetsPanel)
                  Flexible(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: theme.dividerColor),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            for (final entry in const [
                              (_CatalogScopeTab.all, 'All'),
                              (_CatalogScopeTab.favorites, 'Favorites'),
                              (_CatalogScopeTab.recent, 'Recent'),
                            ])
                              GestureDetector(
                                onTap: () => setState(() => _scopeTab = entry.$1),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 4,
                                  ),
                                  decoration: BoxDecoration(
                                    color: _scopeTab == entry.$1
                                        ? EarthlyColors.amber
                                        : Colors.transparent,
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text(
                                    entry.$2,
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      color: _scopeTab == entry.$1
                                          ? EarthlyColors.amberInk
                                          : theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  if (!isDesktop)
                    Tooltip(
                      message: 'Gallery Mode (swipe on map)',
                      child: IconButton(
                        key: const Key('explore-gallery-toggle'),
                        visualDensity: VisualDensity.compact,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 32,
                          minHeight: 32,
                        ),
                        onPressed: () => _toggleGalleryMode(true),
                        icon: const Icon(Icons.view_carousel_outlined, size: 19),
                      ),
                    ),
                  if (_tabs.index == 0 && unstackedMaps.isNotEmpty)
                    Tooltip(
                      message:
                          'Show ${unstackedMaps.length > 15 ? 15 : unstackedMaps.length} filtered maps on map',
                      child: IconButton(
                        visualDensity: VisualDensity.compact,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 32,
                          minHeight: 32,
                        ),
                        onPressed: () => widget.onAddMapsBulk(
                          unstackedMaps.take(15).toList(growable: false),
                        ),
                        icon: const Icon(Icons.library_add_outlined, size: 18),
                      ),
                    ),
                  PopupMenuButton<_CatalogSortOrder>(
                    tooltip: 'Sort order',
                    initialValue: _sortOrder,
                    onSelected: (v) => setState(() => _sortOrder = v),
                    icon: const Icon(Icons.sort, size: 18),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                    itemBuilder: (_) => const [
                      PopupMenuItem(
                        value: _CatalogSortOrder.newest,
                        child: Text('Newest first'),
                      ),
                      PopupMenuItem(
                        value: _CatalogSortOrder.titleAsc,
                        child: Text('Name (A–Z)'),
                      ),
                      PopupMenuItem(
                        value: _CatalogSortOrder.featuresDesc,
                        child: Text('Most features'),
                      ),
                      PopupMenuItem(
                        value: _CatalogSortOrder.sizeDesc,
                        child: Text('Largest size'),
                      ),
                    ],
                  ),
                  if (_tabs.index == 1) ...[
                    const SizedBox(width: 6),
                    _ExploreSquareCreateButton(
                      tooltip: 'New Story',
                      icon: Icons.add,
                      onTap: widget.onComposeStory,
                    ),
                  ] else if (_tabs.index == 2) ...[
                    const SizedBox(width: 6),
                    _ExploreSquareCreateButton(
                      tooltip: 'New Atlas',
                      icon: Icons.add,
                      onTap: widget.onCreateAtlas,
                    ),
                  ],
                ],
              ),
            ),

          if (_error != null)
            Container(
              width: double.infinity,
              constraints: const BoxConstraints(maxHeight: 96),
              padding: const EdgeInsets.all(10),
              color: EarthlyColors.destructive.withValues(alpha: 0.12),
              child: SingleChildScrollView(
                child: Text(
                  _error!,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11.5,
                    color: EarthlyColors.destructive,
                  ),
                ),
              ),
            ),
          Expanded(
            child: catalog == null && isLoading
                ? const Center(child: CircularProgressIndicator())
                : TabBarView(
                    controller: _tabs,
                    children: [
                      _buildMapsList(visibleMaps),
                      _buildStoriesList(visibleStories),
                      _buildAtlasesList(visibleAtlases),
                      _buildSightingsList(visibleSightings),
                      _buildBeaconsList(catalog?.beacons ?? const []),
                      _buildPeopleList(visiblePeople),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildMobileGalleryCarousel(
    BuildContext context, {
    required List<MapSummaryDto> visibleMaps,
    required List<StorySummaryDto> visibleStories,
    required List<AtlasSummaryDto> visibleAtlases,
    required bool isLoading,
  }) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final itemsCount = switch (_tabs.index) {
      0 => visibleMaps.length,
      1 => visibleStories.length,
      2 => visibleAtlases.length,
      _ => 0,
    };
    final activeIndex =
        itemsCount == 0 ? 0 : _galleryIndex.clamp(0, itemsCount - 1);
    final activeKey = itemsCount == 0
        ? null
        : switch (_tabs.index) {
            0 => 'map:${visibleMaps[activeIndex].address}',
            1 => 'story:${visibleStories[activeIndex].address}',
            _ => 'atlas:${visibleAtlases[activeIndex].address}',
          };

    if (itemsCount > 0 && _galleryIndex != activeIndex) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !_galleryMode) return;
        setState(() => _galleryIndex = activeIndex);
        if (_galleryPageController.hasClients) {
          _galleryPageController.jumpToPage(activeIndex);
        }
        _previewGalleryItemForIndex(
          _tabs.index,
          activeIndex,
          visibleMaps: visibleMaps,
          visibleStories: visibleStories,
          visibleAtlases: visibleAtlases,
        );
      });
    } else if (activeKey != _lastPreviewedEntityKey) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !_galleryMode) return;
        _previewGalleryItemForIndex(
          _tabs.index,
          activeIndex,
          visibleMaps: visibleMaps,
          visibleStories: visibleStories,
          visibleAtlases: visibleAtlases,
        );
      });
    }

    final borderColor = widget.activeAtlasLens != null
        ? EarthlyColors.amber.withValues(alpha: isDark ? 0.72 : 0.85)
        : (isDark
            ? Colors.white.withValues(alpha: 0.12)
            : Colors.black.withValues(alpha: 0.08));

    return Positioned(
      key: const Key('explore-gallery-carousel'),
      left: 0,
      right: 0,
      bottom: 0,
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
          child: Container(
            decoration: BoxDecoration(
              color: theme.colorScheme.surface
                  .withValues(alpha: isDark ? 0.88 : 0.92),
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(20)),
              border: Border(
                top: BorderSide(
                  color: borderColor,
                  width: widget.activeAtlasLens != null ? 2.0 : 1.0,
                ),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: isDark ? 0.44 : 0.16),
                  blurRadius: 20,
                  offset: const Offset(0, -4),
                ),
              ],
            ),
            child: SafeArea(
              top: false,
              child: Material(
                type: MaterialType.transparency,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Padding(
                      padding: EdgeInsets.fromLTRB(
                        widget.onBack != null ? 4 : 10,
                        8,
                        6,
                        4,
                      ),
                      child: Row(
                        children: [
                          if (widget.onBack != null)
                            IconButton(
                              key: const Key('explore-back-btn'),
                              tooltip: 'Back',
                              visualDensity: VisualDensity.compact,
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(
                                minWidth: 30,
                                minHeight: 30,
                              ),
                              onPressed: widget.onBack,
                              icon: const Icon(Icons.arrow_back, size: 17),
                            ),
                          Expanded(
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                for (final entry in [
                                  (0, 'Maps (${visibleMaps.length})'),
                                  (1, 'Stories (${visibleStories.length})'),
                                  (2, 'Atlases (${visibleAtlases.length})'),
                                ])
                                  Flexible(
                                    child: Padding(
                                      padding: const EdgeInsets.only(right: 4),
                                      child: FittedBox(
                                        fit: BoxFit.scaleDown,
                                        alignment: Alignment.centerLeft,
                                        child: GestureDetector(
                                          key: Key('gallery-tab-${entry.$1}'),
                                          onTap: () =>
                                              _selectGalleryTab(entry.$1),
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 9,
                                              vertical: 4,
                                            ),
                                            decoration: BoxDecoration(
                                              color: _tabs.index == entry.$1
                                                  ? EarthlyColors.amber
                                                  : theme.colorScheme
                                                      .surfaceContainerHighest,
                                              borderRadius:
                                                  BorderRadius.circular(999),
                                              border: Border.all(
                                                color: _tabs.index == entry.$1
                                                    ? EarthlyColors.amber
                                                    : theme.dividerColor,
                                              ),
                                            ),
                                            child: Text(
                                              entry.$2,
                                              style: TextStyle(
                                                fontSize: 11,
                                                fontWeight: FontWeight.w800,
                                                color: _tabs.index == entry.$1
                                                    ? EarthlyColors.amberInk
                                                    : theme.colorScheme
                                                        .onSurface,
                                              ),
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          if (widget.galleryPreviewLoading || isLoading)
                            const Padding(
                              padding: EdgeInsets.only(right: 4),
                              child: SizedBox(
                                width: 12,
                                height: 12,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: EarthlyColors.amber,
                                ),
                              ),
                            ),
                          if (itemsCount > 0)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color:
                                    theme.colorScheme.surfaceContainerHighest,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                '${activeIndex + 1}/$itemsCount',
                                style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          IconButton(
                            key: const Key('explore-gallery-toggle'),
                            tooltip: 'List Mode',
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(
                              minWidth: 30,
                              minHeight: 30,
                            ),
                            onPressed: () => _toggleGalleryMode(false),
                            icon:
                                const Icon(Icons.view_list_outlined, size: 18),
                          ),
                          IconButton(
                            tooltip: 'Close Gallery',
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(
                              minWidth: 30,
                              minHeight: 30,
                            ),
                            onPressed: widget.onClose,
                            icon: const Icon(Icons.close, size: 17),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(
                      height: 164,
                      child: itemsCount == 0
                          ? Center(
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    _emptyMessage(switch (_tabs.index) {
                                      0 => 'maps',
                                      1 => 'stories',
                                      _ => 'atlases',
                                    }),
                                    textAlign: TextAlign.center,
                                    style: theme.textTheme.bodySmall,
                                  ),
                                  const SizedBox(height: 8),
                                  OutlinedButton.icon(
                                    onPressed: () => _toggleGalleryMode(false),
                                    icon: const Icon(
                                      Icons.view_list_outlined,
                                      size: 16,
                                    ),
                                    label: const Text('Switch to List'),
                                  ),
                                ],
                              ),
                            )
                          : PageView.builder(
                              key: Key('explore-gallery-pageview-${_tabs.index}'),
                              controller: _galleryPageController,
                              itemCount: itemsCount,
                              onPageChanged: (index) {
                                HapticFeedback.selectionClick();
                                setState(() => _galleryIndex = index);
                                _previewGalleryItemForIndex(
                                  _tabs.index,
                                  index,
                                  visibleMaps: visibleMaps,
                                  visibleStories: visibleStories,
                                  visibleAtlases: visibleAtlases,
                                );
                              },
                              itemBuilder: (context, index) {
                                final isCurrent = index == activeIndex;
                                return switch (_tabs.index) {
                                  0 => _buildMapGalleryCard(
                                      context,
                                      visibleMaps[index],
                                      index: index,
                                      isCurrent: isCurrent,
                                    ),
                                  1 => _buildStoryGalleryCard(
                                      context,
                                      visibleStories[index],
                                      index: index,
                                      isCurrent: isCurrent,
                                    ),
                                  _ => _buildAtlasGalleryCard(
                                      context,
                                      visibleAtlases[index],
                                      index: index,
                                      isCurrent: isCurrent,
                                    ),
                                };
                              },
                            ),
                    ),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildGalleryCardFrame(
    BuildContext context, {
    required Key cardKey,
    required bool isCurrent,
    required Widget leading,
    required List<Widget> badges,
    required bool isStarred,
    required VoidCallback onToggleStar,
    required String title,
    required String? previewText,
    required String meta,
    required VoidCallback onCardTap,
    required List<Widget> actions,
  }) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 4),
      child: Material(
        key: cardKey,
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.94),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(
            color: isCurrent ? EarthlyColors.amber : theme.dividerColor,
            width: isCurrent ? 1.8 : 1.0,
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onCardTap,
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                leading,
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: Row(children: badges),
                            ),
                          ),
                          GestureDetector(
                            onTap: onToggleStar,
                            child: Padding(
                              padding: const EdgeInsets.only(left: 4),
                              child: Icon(
                                isStarred ? Icons.star : Icons.star_outline,
                                size: 17,
                                color: isStarred
                                    ? EarthlyColors.amber
                                    : theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (previewText != null && previewText.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          previewText,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 11.5,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                      const Spacer(),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              meta,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          ...actions,
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMapGalleryCard(
    BuildContext context,
    MapSummaryDto map, {
    required int index,
    required bool isCurrent,
  }) {
    final onShelf = widget.shelfAddresses.contains(map.address);
    final favKey = 'map:${map.address}';
    final isStarred = widget.pinnedEntityIds.contains(favKey);
    final dateStr = formatRelativeUnixDate(map.createdAt.toInt());
    final meta = [
      _authorLabel(map.pubkey),
      '${map.featureCount} feat',
      if (dateStr.isNotEmpty) dateStr,
    ].join(' · ');

    return _buildGalleryCardFrame(
      context,
      cardKey: Key('gallery-card-map-$index'),
      isCurrent: isCurrent,
      leading: EarthlyGeometryThumb(
        cacheKey: map.eventId,
        geojson: map.geojson,
        width: 82,
        height: 116,
      ),
      badges: [
        const EarthlyBadge(label: 'MAP', color: EarthlyColors.commentGreen),
        if (onShelf) ...[
          const SizedBox(width: 4),
          const EarthlyBadge(
            label: 'ON SHELF',
            color: EarthlyColors.commentGreen,
            filled: true,
          ),
        ],
      ],
      isStarred: isStarred,
      onToggleStar: () => widget.onToggleFavorite(favKey),
      title: map.title,
      previewText: map.description != null && map.description!.isNotEmpty
          ? stripEarthlyMarkdownPreview(map.description!)
          : map.hashtags.take(3).map((t) => '#$t').join(' '),
      meta: meta,
      onCardTap: () => widget.onInspectMap(map),
      actions: [
        IconButton(
          tooltip: 'Zoom to map',
          visualDensity: VisualDensity.compact,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          onPressed: () => widget.onPreviewGalleryMap != null
              ? widget.onPreviewGalleryMap!(map)
              : widget.onFocusMap(map),
          icon: const Icon(Icons.center_focus_strong, size: 17),
        ),
        IconButton(
          tooltip: onShelf ? 'Remove from shelf' : 'Pin to shelf',
          visualDensity: VisualDensity.compact,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          onPressed: () => widget.onToggleMapOnShelf(map),
          icon: Icon(
            onShelf ? Icons.layers : Icons.layers_outlined,
            size: 17,
            color: onShelf ? EarthlyColors.commentGreen : null,
          ),
        ),
        const SizedBox(width: 2),
        FilledButton(
          style: FilledButton.styleFrom(
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            minimumSize: const Size(0, 28),
          ),
          onPressed: () => widget.onInspectMap(map),
          child: const Text('Details', style: TextStyle(fontSize: 11)),
        ),
      ],
    );
  }

  Widget _buildStoryGalleryCard(
    BuildContext context,
    StorySummaryDto story, {
    required int index,
    required bool isCurrent,
  }) {
    final favKey = 'story:${story.address}';
    final isStarred = widget.pinnedEntityIds.contains(favKey);
    final linkedCount = story.referencedAddresses.length;
    final dateStr = formatRelativeUnixDate(story.publishedAt.toInt());
    final meta = [
      _authorLabel(story.pubkey),
      if (linkedCount > 0) '$linkedCount map${linkedCount == 1 ? '' : 's'}',
      if (dateStr.isNotEmpty) dateStr,
    ].join(' · ');

    return _buildGalleryCardFrame(
      context,
      cardKey: Key('gallery-card-story-$index'),
      isCurrent: isCurrent,
      leading: EarthlyCoverThumb(
        imageUrl: story.image,
        fallbackIcon: Icons.auto_stories_outlined,
        width: 82,
        height: 116,
      ),
      badges: [
        const EarthlyBadge(label: 'STORY', color: EarthlyColors.amber),
        if (story.presentationJson != null) ...[
          const SizedBox(width: 4),
          const EarthlyBadge(label: 'VIEWS', color: EarthlyColors.infoCyan),
        ],
      ],
      isStarred: isStarred,
      onToggleStar: () => widget.onToggleFavorite(favKey),
      title: story.title,
      previewText: story.summary != null
          ? stripEarthlyMarkdownPreview(story.summary!)
          : stripEarthlyMarkdownPreview(story.content),
      meta: meta,
      onCardTap: () => widget.onOpenStory(story),
      actions: [
        IconButton(
          tooltip: 'Story comments',
          visualDensity: VisualDensity.compact,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          onPressed: () => widget.onOpenStoryDiscussion(story),
          icon: const Icon(Icons.forum_outlined, size: 17),
        ),
        const SizedBox(width: 2),
        FilledButton(
          style: FilledButton.styleFrom(
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            minimumSize: const Size(0, 28),
          ),
          onPressed: () => widget.onOpenStory(story),
          child: const Text('Read', style: TextStyle(fontSize: 11)),
        ),
      ],
    );
  }

  Widget _buildAtlasGalleryCard(
    BuildContext context,
    AtlasSummaryDto atlas, {
    required int index,
    required bool isCurrent,
  }) {
    final favKey = 'atlas:${atlas.address}';
    final isStarred = widget.pinnedEntityIds.contains(favKey);
    final isLens = widget.activeAtlasLens?.address == atlas.address;
    final govLabel = switch (atlas.governance) {
      'closed' => 'AUTHOR PICKS',
      'schema' => 'SCHEMA',
      _ => 'OPEN',
    };
    final govColor = atlas.governance == 'open'
        ? EarthlyColors.commentGreen
        : EarthlyColors.published;

    return _buildGalleryCardFrame(
      context,
      cardKey: Key('gallery-card-atlas-$index'),
      isCurrent: isCurrent,
      leading: EarthlyCoverThumb(
        imageUrl: atlas.image,
        fallbackIcon: Icons.public,
        width: 82,
        height: 116,
      ),
      badges: [
        EarthlyBadge(label: govLabel, color: govColor),
        if (isLens) ...[
          const SizedBox(width: 4),
          const EarthlyBadge(
            label: 'LENS',
            color: EarthlyColors.amber,
            filled: true,
          ),
        ],
      ],
      isStarred: isStarred,
      onToggleStar: () => widget.onToggleFavorite(favKey),
      title: atlas.name,
      previewText: atlas.description != null
          ? stripEarthlyMarkdownPreview(atlas.description!)
          : null,
      meta: '${_authorLabel(atlas.pubkey)} · ${atlas.pinnedAddresses.length} pinned',
      onCardTap: () => widget.onInspectAtlas(atlas),
      actions: [
        IconButton(
          tooltip: isLens ? 'Leave Atlas Lens' : 'Enter Atlas Lens',
          visualDensity: VisualDensity.compact,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          onPressed: () =>
              isLens ? widget.onLeaveAtlasLens() : widget.onEnterAtlasLens(atlas),
          icon: Icon(
            Icons.filter_tilt_shift,
            size: 17,
            color: isLens ? EarthlyColors.amber : null,
          ),
        ),
        const SizedBox(width: 2),
        FilledButton(
          style: FilledButton.styleFrom(
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            minimumSize: const Size(0, 28),
          ),
          onPressed: () => widget.onInspectAtlas(atlas),
          child: const Text('Open', style: TextStyle(fontSize: 11)),
        ),
      ],
    );
  }

  String _emptyMessage(String noun) {
    if (_scopeTab == _CatalogScopeTab.favorites) {
      return 'No favorite $noun yet — open a row menu (⋮) to star one.';
    }
    if (_scopeTab == _CatalogScopeTab.recent) {
      return 'No recently viewed $noun yet.';
    }
    if (_query.isNotEmpty) return 'No $noun match "$_query".';
    if (widget.activeAtlasLens != null) {
      return 'No $noun in "${widget.activeAtlasLens!.name}" yet.';
    }
    return 'Listening for $noun…';
  }

  Widget _buildMapsList(List<MapSummaryDto> filtered) {
    if (filtered.isEmpty) {
      return RefreshIndicator(
        color: EarthlyColors.amber,
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            Padding(
              padding: const EdgeInsets.all(28),
              child: Text(_emptyMessage('maps'), textAlign: TextAlign.center),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      color: EarthlyColors.amber,
      onRefresh: _refresh,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(0, 4, 0, 24),
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: filtered.length,
        itemBuilder: (context, index) {
        final map = filtered[index];
        final onShelf = widget.shelfAddresses.contains(map.address);
        final favKey = 'map:${map.address}';
        final isStarred = widget.pinnedEntityIds.contains(favKey);
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
          starred: isStarred,
          onTap: () => widget.onInspectMap(map),
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
              label: 'Open Map details & features',
              icon: Icons.info_outline,
              onSelected: () => widget.onInspectMap(map),
            ),
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
              label: isStarred ? 'Remove from favorites' : 'Add to favorites',
              icon: isStarred ? Icons.star : Icons.star_outline,
              onSelected: () => widget.onToggleFavorite(favKey),
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
      ),
    );
  }

  Widget _buildStoriesList(List<StorySummaryDto> filtered) {
    return RefreshIndicator(
      color: EarthlyColors.amber,
      onRefresh: _refresh,
      child: filtered.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Padding(
                  padding: const EdgeInsets.all(28),
                  child: Text(
                    _emptyMessage('stories'),
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(0, 4, 0, 24),
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: filtered.length,
              itemBuilder: (context, index) {
                final story = filtered[index];
                final favKey = 'story:${story.address}';
                final isStarred = widget.pinnedEntityIds.contains(favKey);
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
                  subtitle: story.summary != null
                      ? stripEarthlyMarkdownPreview(story.summary!)
                      : null,
                  meta: metaParts.join(' · '),
                  starred: isStarred,
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
                      label: isStarred
                          ? 'Remove from favorites'
                          : 'Add to favorites',
                      icon: isStarred ? Icons.star : Icons.star_outline,
                      onSelected: () => widget.onToggleFavorite(favKey),
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
    );
  }

  Widget _buildAtlasesList(List<AtlasSummaryDto> filtered) {
    return RefreshIndicator(
      color: EarthlyColors.amber,
      onRefresh: _refresh,
      child: filtered.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Padding(
                  padding: const EdgeInsets.all(28),
                  child: Text(
                    _emptyMessage('atlases'),
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(0, 4, 0, 24),
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: filtered.length,
              itemBuilder: (context, index) {
                final atlas = filtered[index];
                final favKey = 'atlas:${atlas.address}';
                final isStarred = widget.pinnedEntityIds.contains(favKey);
                final isLens =
                    widget.activeAtlasLens?.address == atlas.address;
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
                  subtitle: atlas.description != null
                      ? stripEarthlyMarkdownPreview(atlas.description!)
                      : null,
                  meta:
                      '${_authorLabel(atlas.pubkey)} · ${atlas.pinnedAddresses.length} pinned',
                  selected: isLens,
                  starred: isStarred,
                  badges: [
                    EarthlyBadge(label: govLabel, color: govColor),
                    if (isLens)
                      const EarthlyBadge(
                        label: 'ACTIVE LENS',
                        color: EarthlyColors.amber,
                      ),
                  ],
                  onTap: () => widget.onInspectAtlas(atlas),
                  primaryAction: IconButton(
                    tooltip: isLens ? 'Leave Atlas Lens' : 'Enter Atlas Lens',
                    visualDensity: VisualDensity.compact,
                    onPressed: () => isLens
                        ? widget.onLeaveAtlasLens()
                        : widget.onEnterAtlasLens(atlas),
                    icon: Icon(
                      Icons.filter_tilt_shift,
                      size: 20,
                      color: isLens ? EarthlyColors.amber : null,
                    ),
                  ),
                  menuActions: [
                    EntityRowMenuAction(
                      label: 'Open Atlas details',
                      icon: Icons.info_outline,
                      onSelected: () => widget.onInspectAtlas(atlas),
                    ),
                    EntityRowMenuAction(
                      label: isLens ? 'Leave Atlas Lens' : 'Enter Atlas Lens',
                      icon: Icons.filter_tilt_shift,
                      onSelected: () => isLens
                          ? widget.onLeaveAtlasLens()
                          : widget.onEnterAtlasLens(atlas),
                    ),
                    if (atlas.pinnedAddresses.isNotEmpty)
                      EntityRowMenuAction(
                        label: 'Show all maps on map',
                        icon: Icons.layers,
                        onSelected: () => widget.onOpenAtlas(atlas),
                      ),
                    EntityRowMenuAction(
                      label: isStarred
                          ? 'Remove from favorites'
                          : 'Add to favorites',
                      icon: isStarred ? Icons.star : Icons.star_outline,
                      onSelected: () => widget.onToggleFavorite(favKey),
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
    );
  }

  Widget _buildSightingsList(List<SightingSummaryDto> sightings) {
    return RefreshIndicator(
      color: EarthlyColors.amber,
      onRefresh: _refresh,
      child: sightings.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                Padding(
                  padding: EdgeInsets.all(28),
                  child: Text(
                    'No active sightings right now.',
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(0, 4, 0, 24),
              physics: const AlwaysScrollableScrollPhysics(),
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
                      ? stripEarthlyMarkdownPreview(s.note)
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
    );
  }

  Widget _buildBeaconsList(List<LiveBeaconDto> beacons) {
    return RefreshIndicator(
      color: EarthlyColors.amber,
      onRefresh: _refresh,
      child: beacons.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                Padding(
                  padding: EdgeInsets.all(28),
                  child: Text(
                    'No active live beacons right now.',
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(0, 4, 0, 24),
              physics: const AlwaysScrollableScrollPhysics(),
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
                                  color: Theme.of(context).colorScheme.surface,
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
    );
  }

  List<({String pubkey, int maps, int stories, int atlases, int sightings})>
      _filteredPeople(EarthlyCatalogSnapshot? catalog) {
    final counts =
        <String, ({int maps, int stories, int atlases, int sightings})>{};
    void bump(String pk, {int m = 0, int s = 0, int a = 0, int sig = 0}) {
      if (pk.trim().isEmpty) return;
      final prev =
          counts[pk] ?? (maps: 0, stories: 0, atlases: 0, sightings: 0);
      counts[pk] = (
        maps: prev.maps + m,
        stories: prev.stories + s,
        atlases: prev.atlases + a,
        sightings: prev.sightings + sig,
      );
    }

    if (catalog != null) {
      for (final m in catalog.maps) {
        bump(m.pubkey, m: 1);
      }
      for (final s in catalog.stories) {
        bump(s.pubkey, s: 1);
      }
      for (final a in catalog.atlases) {
        bump(a.pubkey, a: 1);
      }
      for (final sig in catalog.sightings) {
        bump(sig.pubkey, sig: 1);
      }
      for (final b in catalog.beacons) {
        bump(b.pubkey);
      }
    }
    for (final pk in widget.profilesByPubkey.keys) {
      bump(pk);
    }

    final list = counts.entries
        .map(
          (e) => (
            pubkey: e.key,
            maps: e.value.maps,
            stories: e.value.stories,
            atlases: e.value.atlases,
            sightings: e.value.sightings,
          ),
        )
        .where((entry) {
      final p = widget.profilesByPubkey[entry.pubkey];
      return _matchesQuery([
        entry.pubkey,
        p?.name,
        p?.displayName,
        p?.nip05,
        p?.about,
      ]);
    }).toList();

    list.sort((a, b) {
      final totalA = a.maps + a.stories + a.atlases + a.sightings;
      final totalB = b.maps + b.stories + b.atlases + b.sightings;
      return totalB.compareTo(totalA);
    });
    return list;
  }

  Widget _buildPeopleList(
    List<({String pubkey, int maps, int stories, int atlases, int sightings})>
        people,
  ) {
    return RefreshIndicator(
      color: EarthlyColors.amber,
      onRefresh: _refresh,
      child: people.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Padding(
                  padding: const EdgeInsets.all(28),
                  child: Text(_emptyMessage('people'), textAlign: TextAlign.center),
                ),
              ],
            )
          : Material(
              type: MaterialType.transparency,
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(0, 4, 0, 24),
                physics: const AlwaysScrollableScrollPhysics(),
                itemCount: people.length,
                itemBuilder: (context, index) {
                  final entry = people[index];
                  final profile = widget.profilesByPubkey[entry.pubkey];
                  final title = profile?.displayName?.isNotEmpty == true
                      ? profile!.displayName!
                      : profile?.name?.isNotEmpty == true
                          ? profile!.name!
                          : '${entry.pubkey.substring(0, entry.pubkey.length.clamp(0, 12))}…';
                  final stats = [
                    if (entry.maps > 0) '${entry.maps} maps',
                    if (entry.stories > 0) '${entry.stories} stories',
                    if (entry.atlases > 0) '${entry.atlases} atlases',
                    if (entry.sightings > 0) '${entry.sightings} sightings',
                  ].join(' · ');
                  return ListTile(
                    key: Key('explore-person-${entry.pubkey}'),
                    dense: true,
                    leading: CircleAvatar(
                      radius: 18,
                      backgroundImage:
                          (profile?.picture?.startsWith('http') ?? false)
                              ? NetworkImage(profile!.picture!)
                              : null,
                      child: (profile?.picture?.startsWith('http') ?? false)
                          ? null
                          : const Icon(Icons.person_outline, size: 18),
                    ),
                    title: Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    subtitle: Text(
                      profile?.nip05?.isNotEmpty == true
                          ? '${profile!.nip05!}${stats.isNotEmpty ? ' · $stats' : ''}'
                          : (stats.isNotEmpty ? stats : entry.pubkey),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                      ),
                    ),
                    trailing: const Icon(Icons.chevron_right, size: 18),
                    onTap: widget.onOpenPerson == null
                        ? null
                        : () => widget.onOpenPerson!(entry.pubkey),
                  );
                },
              ),
            ),
    );
  }
}

/// Compact square create/action button sitting cleanly inline in the Explore
/// toolbar row to save an entire vertical row across Stories, Atlases,
/// Sightings, and Live Beacons.
class _ExploreSquareCreateButton extends StatelessWidget {
  const _ExploreSquareCreateButton({
    required this.tooltip,
    required this.icon,
    required this.onTap,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: SizedBox(
        key: const Key('explore-new-action-btn'),
        width: 34,
        height: 34,
        child: Material(
          color: EarthlyColors.amber,
          borderRadius: BorderRadius.circular(10),
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: onTap,
            child: Icon(
              icon,
              size: 18,
              color: EarthlyColors.amberInk,
            ),
          ),
        ),
      ),
    );
  }
}
