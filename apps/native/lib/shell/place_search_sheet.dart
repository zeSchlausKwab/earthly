import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';

/// Quick spatial jump drawer: search places via Photon (OSM), jump to decimal
/// coordinates (`48.2082, 16.3738`), `geo:` URIs, or open `nostr:naddr1...` links.
class PlaceSearchSheet extends StatefulWidget {
  const PlaceSearchSheet({
    required this.onJumpToPlace,
    required this.onJumpToNaddr,
    required this.onClose,
    super.key,
  });

  final ValueChanged<PlaceSearchResultDto> onJumpToPlace;
  final Future<void> Function(String naddrUri) onJumpToNaddr;
  final VoidCallback onClose;

  @override
  State<PlaceSearchSheet> createState() => _PlaceSearchSheetState();
}

class _PlaceSearchSheetState extends State<PlaceSearchSheet> {
  final _controller = TextEditingController();
  List<PlaceSearchResultDto> _results = const [];
  bool _searching = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
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
      await RustBridge.ensureInitialized();
      final places = await searchPlaces(query: raw);
      if (!mounted) return;
      setState(() => _results = places);
      if (places.isEmpty) {
        setState(() => _error = 'No places found for "$raw"');
      }
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return EarthlyMapDrawer(
      initialFraction: 0.44,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            const Icon(Icons.search, size: 18),
            const SizedBox(width: 8),
            Text(
              'JUMP TO PLACE, COORDS OR NADDR',
              style: theme.textTheme.labelLarge?.copyWith(
                fontFamily: 'monospace',
                letterSpacing: 0.6,
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
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    autofocus: true,
                    onSubmitted: (_) => _submit(),
                    decoration: const InputDecoration(
                      hintText: 'Vienna, 48.2082, 16.3738, or nostr:naddr1…',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
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
            child: _results.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Text(
                        'Search any place via OSM Photon, enter lat, lon / geo: coordinates, or paste a nostr:naddr1… map link.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                  )
                : ListView.separated(
                    itemCount: _results.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final p = _results[index];
                      return ListTile(
                        leading: const Icon(
                          Icons.location_on_outlined,
                          color: EarthlyColors.lightAccent,
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
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
