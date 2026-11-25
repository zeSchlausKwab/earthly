import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';

/// Quick Omnibox drawer: live-filters cached/NIP-50 Maps, Stories, Atlases &
/// People alongside Photon (OSM) place search, decimal coordinates, `geo:` URIs,
/// and `nostr:naddr1...` deep links.
class PlaceSearchSheet extends StatefulWidget {
  const PlaceSearchSheet({
    required this.onJumpToPlace,
    required this.onJumpToNaddr,
    required this.onClose,
    this.catalogMaps = const <MapSummaryDto>[],
    this.catalogStories = const <StorySummaryDto>[],
    this.catalogAtlases = const <AtlasSummaryDto>[],
    this.profilesByPubkey = const <String, ProfileMetadataDto>{},
    this.relayUrls = const <String>['wss://relay.earthly.city'],
    this.onSelectMap,
    this.onSelectStory,
    this.onSelectAtlas,
    this.onSelectPerson,
    this.searchPlacesOverride,
    this.searchNip50Override,
    super.key,
  });

  final ValueChanged<PlaceSearchResultDto> onJumpToPlace;
  final Future<void> Function(String naddrUri) onJumpToNaddr;
  final List<MapSummaryDto> catalogMaps;
  final List<StorySummaryDto> catalogStories;
  final List<AtlasSummaryDto> catalogAtlases;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final List<String> relayUrls;
  final ValueChanged<MapSummaryDto>? onSelectMap;
  final ValueChanged<StorySummaryDto>? onSelectStory;
  final ValueChanged<AtlasSummaryDto>? onSelectAtlas;
  final ValueChanged<String>? onSelectPerson;
  final Future<List<PlaceSearchResultDto>> Function(String query)?
      searchPlacesOverride;
  final Future<EarthlyCatalogSnapshot> Function(
    List<String> relayUrls,
    String query,
  )? searchNip50Override;
  final VoidCallback onClose;

  @override
  State<PlaceSearchSheet> createState() => _PlaceSearchSheetState();
}

class _PlaceSearchSheetState extends State<PlaceSearchSheet> {
  final _controller = TextEditingController();
  String _query = '';
  List<PlaceSearchResultDto> _results = const [];
  List<MapSummaryDto> _nip50Maps = const [];
  List<StorySummaryDto> _nip50Stories = const [];
  List<AtlasSummaryDto> _nip50Atlases = const [];
  bool _searching = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onQueryChanged);
  }

  void _onQueryChanged() {
    final next = _controller.text.trim();
    if (next != _query && mounted) {
      setState(() => _query = next);
    }
  }

  @override
  void dispose() {
    _controller.removeListener(_onQueryChanged);
    _controller.dispose();
    super.dispose();
  }

  void _insertOperator(String token) {
    final cur = _controller.text;
    final next = cur.isEmpty || cur.endsWith(' ') ? '$cur$token' : '$cur $token';
    _controller.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: next.length),
    );
  }

  String _cleanTextQuery(String raw) {
    return raw
        .replaceAll(RegExp(r'\b(?:bbox|near|tag):[^\s]+', caseSensitive: false), '')
        .trim();
  }

  String? _extractTagFilter(String raw) {
    final m = RegExp(r'\btag:([^\s]+)', caseSensitive: false).firstMatch(raw);
    return m?.group(1)?.toLowerCase();
  }

  PlaceSearchResultDto? _tryParseDirectCoord(String raw) {
    final cleaned = raw.trim().replaceFirst(RegExp(r'^geo:', caseSensitive: false), '');
    final m = RegExp(r'^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$')
        .firstMatch(cleaned);
    if (m == null) return null;
    final lat = double.tryParse(m.group(1)!);
    final lon = double.tryParse(m.group(2)!);
    if (lat == null || lon == null) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return PlaceSearchResultDto(
      name: '${lat.toStringAsFixed(5)}, ${lon.toStringAsFixed(5)}',
      subtitle: 'Direct WGS-84 coordinate',
      lon: lon,
      lat: lat,
    );
  }

  Future<void> _submit() async {
    final raw = _controller.text.trim();
    if (raw.isEmpty) return;

    if (raw.toLowerCase().contains('naddr1')) {
      setState(() {
        _searching = true;
        _error = null;
      });
      try {
        await widget.onJumpToNaddr(raw);
        if (mounted) widget.onClose();
      } catch (err) {
        if (mounted) setState(() => _error = err.toString());
      } finally {
        if (mounted) setState(() => _searching = false);
      }
      return;
    }

    final direct = _tryParseDirectCoord(raw);
    if (direct != null) {
      widget.onJumpToPlace(direct);
      widget.onClose();
      return;
    }

    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final placeQuery = _cleanTextQuery(raw);
      List<PlaceSearchResultDto> places = const [];
      EarthlyCatalogSnapshot? nip50;

      if (widget.searchPlacesOverride == null || widget.searchNip50Override == null) {
        await RustBridge.ensureInitialized();
      }

      await Future.wait([
        if (placeQuery.isNotEmpty)
          () async {
            try {
              places = widget.searchPlacesOverride != null
                  ? await widget.searchPlacesOverride!(placeQuery)
                  : await searchPlaces(query: placeQuery);
            } catch (_) {}
          }(),
        () async {
          try {
            nip50 = widget.searchNip50Override != null
                ? await widget.searchNip50Override!(widget.relayUrls, raw)
                : await searchRelayCatalogNip50(
                    relayUrls: widget.relayUrls,
                    query: raw,
                  );
          } catch (_) {}
        }(),
      ]);

      if (!mounted) return;
      setState(() {
        _results = places;
        _nip50Maps = nip50?.maps ?? const [];
        _nip50Stories = nip50?.stories ?? const [];
        _nip50Atlases = nip50?.atlases ?? const [];
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  List<MapSummaryDto> _filteredMaps() {
    final combined = <String, MapSummaryDto>{
      for (final m in widget.catalogMaps) m.address: m,
      for (final m in _nip50Maps) m.address: m,
    };
    if (_query.isEmpty) return const [];
    final needle = _cleanTextQuery(_query).toLowerCase();
    final tagFilter = _extractTagFilter(_query);
    return combined.values.where((m) {
      if (tagFilter != null &&
          !m.hashtags.any((t) => t.toLowerCase().contains(tagFilter))) {
        return false;
      }
      if (needle.isEmpty) return true;
      return m.title.toLowerCase().contains(needle) ||
          (m.description?.toLowerCase().contains(needle) ?? false) ||
          m.dTag.toLowerCase().contains(needle) ||
          m.hashtags.any((t) => t.toLowerCase().contains(needle));
    }).take(10).toList(growable: false);
  }

  List<StorySummaryDto> _filteredStories() {
    final combined = <String, StorySummaryDto>{
      for (final s in widget.catalogStories) s.address: s,
      for (final s in _nip50Stories) s.address: s,
    };
    if (_query.isEmpty) return const [];
    final needle = _cleanTextQuery(_query).toLowerCase();
    if (needle.isEmpty) return const [];
    return combined.values.where((s) {
      return s.title.toLowerCase().contains(needle) ||
          (s.summary?.toLowerCase().contains(needle) ?? false) ||
          s.dTag.toLowerCase().contains(needle);
    }).take(8).toList(growable: false);
  }

  List<AtlasSummaryDto> _filteredAtlases() {
    final combined = <String, AtlasSummaryDto>{
      for (final a in widget.catalogAtlases) a.address: a,
      for (final a in _nip50Atlases) a.address: a,
    };
    if (_query.isEmpty) return const [];
    final needle = _cleanTextQuery(_query).toLowerCase();
    final tagFilter = _extractTagFilter(_query);
    return combined.values.where((a) {
      if (tagFilter != null &&
          !a.hashtags.any((t) => t.toLowerCase().contains(tagFilter))) {
        return false;
      }
      if (needle.isEmpty) return true;
      return a.name.toLowerCase().contains(needle) ||
          (a.description?.toLowerCase().contains(needle) ?? false) ||
          a.hashtags.any((t) => t.toLowerCase().contains(needle));
    }).take(6).toList(growable: false);
  }

  List<ProfileMetadataDto> _filteredPeople() {
    if (_query.isEmpty) return const [];
    final needle = _cleanTextQuery(_query).toLowerCase();
    if (needle.isEmpty) return const [];
    return widget.profilesByPubkey.values.where((p) {
      return (p.displayName?.toLowerCase().contains(needle) ?? false) ||
          (p.name?.toLowerCase().contains(needle) ?? false) ||
          (p.nip05?.toLowerCase().contains(needle) ?? false) ||
          p.pubkey.toLowerCase().startsWith(needle);
    }).take(6).toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final maps = _filteredMaps();
    final stories = _filteredStories();
    final atlases = _filteredAtlases();
    final people = _filteredPeople();
    final hasAnyHits = maps.isNotEmpty ||
        stories.isNotEmpty ||
        atlases.isNotEmpty ||
        people.isNotEmpty ||
        _results.isNotEmpty;

    return EarthlyMapDrawer(
      initialFraction: 0.52,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            const Icon(Icons.search, size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'OMNIBOX · PLACES, NOSTR & NADDR',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelLarge?.copyWith(
                  fontFamily: 'monospace',
                  letterSpacing: 0.6,
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
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('omnibox-search-field'),
                    controller: _controller,
                    autofocus: true,
                    onSubmitted: (_) => _submit(),
                    decoration: const InputDecoration(
                      hintText:
                          'Search maps, stories, people, Vienna, coords, or naddr1…',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('omnibox-go-btn'),
                  onPressed: _searching ? null : _submit,
                  child: _searching
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Go'),
                ),
              ],
            ),
          ),
          SizedBox(
            height: 34,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                ActionChip(
                  key: const Key('search-chip-tag'),
                  label: const Text('tag:'),
                  onPressed: () => _insertOperator('tag:'),
                ),
                const SizedBox(width: 6),
                ActionChip(
                  key: const Key('search-chip-near'),
                  label: const Text('near:'),
                  onPressed: () => _insertOperator('near:'),
                ),
                const SizedBox(width: 6),
                ActionChip(
                  key: const Key('search-chip-bbox'),
                  label: const Text('bbox:'),
                  onPressed: () => _insertOperator('bbox:'),
                ),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Text(
                _error!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: EarthlyColors.destructive,
                ),
              ),
            ),
          Expanded(
            child: !hasAnyHits
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Text(
                        'Type to filter Maps, Stories, Atlases & People immediately, or press Go for OSM Photon places + NIP-50 relay search.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                  )
                : Material(
                    type: MaterialType.transparency,
                    child: ListView(
                      padding: const EdgeInsets.only(bottom: 18),
                    children: [
                      if (maps.isNotEmpty) ...[
                        _sectionLabel(theme, 'MAPS (${maps.length})'),
                        for (final m in maps)
                          ListTile(
                            dense: true,
                            leading: const Icon(
                              Icons.layers_outlined,
                              color: EarthlyColors.lightAccent,
                            ),
                            title: Text(
                              m.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text(
                              '${m.featureCount} features${m.hashtags.isNotEmpty ? ' · #${m.hashtags.first}' : ''}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                              ),
                            ),
                            onTap: () {
                              widget.onSelectMap?.call(m);
                              widget.onClose();
                            },
                          ),
                      ],
                      if (stories.isNotEmpty) ...[
                        _sectionLabel(theme, 'STORIES (${stories.length})'),
                        for (final s in stories)
                          ListTile(
                            dense: true,
                            leading: const Icon(
                              Icons.menu_book_outlined,
                              color: EarthlyColors.infoCyan,
                            ),
                            title: Text(
                              s.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            subtitle: s.summary != null
                                ? Text(
                                    s.summary!,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  )
                                : null,
                            onTap: () {
                              widget.onSelectStory?.call(s);
                              widget.onClose();
                            },
                          ),
                      ],
                      if (atlases.isNotEmpty) ...[
                        _sectionLabel(theme, 'ATLASES (${atlases.length})'),
                        for (final a in atlases)
                          ListTile(
                            dense: true,
                            leading: const Icon(
                              Icons.collections_bookmark_outlined,
                              color: EarthlyColors.amber,
                            ),
                            title: Text(
                              a.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            onTap: () {
                              widget.onSelectAtlas?.call(a);
                              widget.onClose();
                            },
                          ),
                      ],
                      if (people.isNotEmpty) ...[
                        _sectionLabel(theme, 'PEOPLE (${people.length})'),
                        for (final p in people)
                          ListTile(
                            dense: true,
                            leading: const Icon(Icons.person_outline),
                            title: Text(
                              p.displayName ?? p.name ?? p.pubkey.substring(0, 12),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            subtitle: p.nip05 != null
                                ? Text(
                                    p.nip05!,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 11,
                                    ),
                                  )
                                : null,
                            onTap: () {
                              widget.onSelectPerson?.call(p.pubkey);
                              widget.onClose();
                            },
                          ),
                      ],
                      if (_results.isNotEmpty) ...[
                        _sectionLabel(theme, 'PLACES · OSM PHOTON (${_results.length})'),
                        for (final p in _results)
                          ListTile(
                            leading: const Icon(
                              Icons.location_on_outlined,
                              color: EarthlyColors.commentGreen,
                            ),
                            title: Text(
                              p.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text(
                              p.subtitle.isNotEmpty
                                  ? '${p.subtitle} · ${p.lat.toStringAsFixed(4)}, ${p.lon.toStringAsFixed(4)}'
                                  : '${p.lat.toStringAsFixed(4)}, ${p.lon.toStringAsFixed(4)}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                              ),
                            ),
                            onTap: () {
                              widget.onJumpToPlace(p);
                              widget.onClose();
                            },
                          ),
                      ],
                    ],
                  ),
                ),
          ),
        ],
      ),
    );
  }

  Widget _sectionLabel(ThemeData theme, String label) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 2),
      child: Text(
        label,
        style: theme.textTheme.labelSmall?.copyWith(
          fontFamily: 'monospace',
          fontWeight: FontWeight.w800,
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
