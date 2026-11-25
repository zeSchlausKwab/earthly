import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';

/// Tap-to-inspect Location Inspector margin drawer: reverse-geocodes a
/// long-pressed coordinate via Photon (OSM), surfaces nearby Maps & Sightings
/// within 5 km, and offers 1-tap `Drop Point`, `Sighting Here`, `Import OSM`,
/// and `Copy geo:` actions.
class LocationInspectorSheet extends StatefulWidget {
  const LocationInspectorSheet({
    required this.lat,
    required this.lon,
    required this.onClose,
    this.catalogMaps = const <MapSummaryDto>[],
    this.catalogSightings = const <SightingSummaryDto>[],
    this.initialReverseGeocode,
    this.onInspectMap,
    this.onFocusSighting,
    this.onDropPointHere,
    this.onCreateSightingHere,
    this.onImportOsmHere,
    super.key,
  });

  final double lat;
  final double lon;
  final List<MapSummaryDto> catalogMaps;
  final List<SightingSummaryDto> catalogSightings;
  final ReverseGeocodeDto? initialReverseGeocode;
  final ValueChanged<MapSummaryDto>? onInspectMap;
  final ValueChanged<SightingSummaryDto>? onFocusSighting;
  final VoidCallback? onDropPointHere;
  final VoidCallback? onCreateSightingHere;
  final VoidCallback? onImportOsmHere;
  final VoidCallback onClose;

  @override
  State<LocationInspectorSheet> createState() => _LocationInspectorSheetState();
}

class _LocationInspectorSheetState extends State<LocationInspectorSheet> {
  ReverseGeocodeDto? _reverse;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _reverse = widget.initialReverseGeocode;
    if (_reverse == null) {
      _lookupReverse();
    }
  }

  @override
  void didUpdateWidget(covariant LocationInspectorSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.lat != widget.lat || oldWidget.lon != widget.lon) {
      _reverse = widget.initialReverseGeocode;
      if (_reverse == null) {
        _lookupReverse();
      }
    }
  }

  Future<void> _lookupReverse() async {
    setState(() => _loading = true);
    try {
      await RustBridge.ensureInitialized();
      final res = await reverseGeocodeLocation(
        lat: widget.lat,
        lon: widget.lon,
      );
      if (mounted) setState(() => _reverse = res);
    } catch (_) {
      // Fallback display uses raw coordinates when offline/sandboxed.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  static double _haversineKm(
    double lat1,
    double lon1,
    double lat2,
    double lon2,
  ) {
    const r = 6371.0;
    final dLat = (lat2 - lat1) * math.pi / 180.0;
    final dLon = (lon2 - lon1) * math.pi / 180.0;
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(lat1 * math.pi / 180.0) *
            math.cos(lat2 * math.pi / 180.0) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return r * c;
  }

  String _formatDistance(double km) {
    if (km < 1.0) return '${(km * 1000).round()} m';
    return '${km.toStringAsFixed(1)} km';
  }

  List<({MapSummaryDto map, double km})> _nearbyMaps() {
    final hits = <({MapSummaryDto map, double km})>[];
    for (final m in widget.catalogMaps) {
      final w = m.west;
      final s = m.south;
      final e = m.east;
      final n = m.north;
      if (w == null || s == null || e == null || n == null) continue;
      final inside = widget.lon >= w &&
          widget.lon <= e &&
          widget.lat >= s &&
          widget.lat <= n;
      final cLat = (s + n) / 2;
      final cLon = (w + e) / 2;
      final km = _haversineKm(widget.lat, widget.lon, cLat, cLon);
      if (inside || km <= 5.0) {
        hits.add((map: m, km: inside ? 0.0 : km));
      }
    }
    hits.sort((a, b) => a.km.compareTo(b.km));
    return hits.take(12).toList(growable: false);
  }

  List<({SightingSummaryDto sighting, double km})> _nearbySightings() {
    final hits = <({SightingSummaryDto sighting, double km})>[];
    for (final s in widget.catalogSightings) {
      final km = _haversineKm(widget.lat, widget.lon, s.lat, s.lon);
      if (km <= 5.0) {
        hits.add((sighting: s, km: km));
      }
    }
    hits.sort((a, b) => a.km.compareTo(b.km));
    return hits.take(12).toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final geoUri =
        'geo:${widget.lat.toStringAsFixed(5)},${widget.lon.toStringAsFixed(5)}';
    final maps = _nearbyMaps();
    final sightings = _nearbySightings();
    final placeTitle = _reverse?.displayName ??
        '${widget.lat.toStringAsFixed(5)}, ${widget.lon.toStringAsFixed(5)}';
    final placeSubtitle = _reverse?.subtitle ?? 'WGS-84 Coordinate';

    return EarthlyMapDrawer(
      initialFraction: 0.48,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            const Icon(
              Icons.pin_drop_outlined,
              size: 18,
              color: EarthlyColors.infoCyan,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'LOCATION INSPECTOR',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelLarge?.copyWith(
                  fontFamily: 'monospace',
                  letterSpacing: 0.6,
                ),
              ),
            ),
            IconButton(
              tooltip: 'Copy geo URI',
              key: const Key('location-copy-geo-btn'),
              visualDensity: VisualDensity.compact,
              onPressed: () {
                Clipboard.setData(ClipboardData(text: geoUri));
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Copied $geoUri')),
                );
              },
              icon: const Icon(Icons.copy, size: 16),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: widget.onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: Material(
        type: MaterialType.transparency,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 24),
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: theme.dividerColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        placeTitle,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    if (_loading)
                      const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                  ],
                ),
                if (placeSubtitle.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    placeSubtitle,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
                const SizedBox(height: 6),
                Text(
                  geoUri,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: EarthlyColors.infoCyan,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (widget.onDropPointHere != null)
                FilledButton.icon(
                  key: const Key('location-drop-point-btn'),
                  onPressed: () {
                    widget.onDropPointHere!();
                    widget.onClose();
                  },
                  icon: const Icon(Icons.add_location_alt_outlined, size: 16),
                  label: const Text('Drop Point'),
                ),
              if (widget.onCreateSightingHere != null)
                OutlinedButton.icon(
                  key: const Key('location-sighting-here-btn'),
                  onPressed: widget.onCreateSightingHere,
                  icon: const Icon(Icons.visibility_outlined, size: 16),
                  label: const Text('Sighting Here'),
                ),
              if (widget.onImportOsmHere != null)
                OutlinedButton.icon(
                  key: const Key('location-import-osm-btn'),
                  onPressed: widget.onImportOsmHere,
                  icon: const Icon(Icons.download_for_offline_outlined, size: 16),
                  label: const Text('Import OSM'),
                ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'NEARBY MAPS (${maps.length})',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          if (maps.isEmpty)
            Text(
              'No cached Maps within 5 km of this point.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            )
          else
            for (final hit in maps)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: const Icon(
                  Icons.layers_outlined,
                  size: 18,
                  color: EarthlyColors.lightAccent,
                ),
                title: Text(
                  hit.map.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text(
                  hit.km == 0.0
                      ? 'Covers this location · ${hit.map.featureCount} features'
                      : '${_formatDistance(hit.km)} away · ${hit.map.featureCount} features',
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5),
                ),
                onTap: widget.onInspectMap == null
                    ? null
                    : () => widget.onInspectMap!(hit.map),
              ),
          const SizedBox(height: 14),
          Text(
            'NEARBY SIGHTINGS (${sightings.length})',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          if (sightings.isEmpty)
            Text(
              'No active Sightings within 5 km of this point.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            )
          else
            for (final hit in sightings)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: const Icon(
                  Icons.bolt,
                  size: 18,
                  color: EarthlyColors.amber,
                ),
                title: Text(
                  hit.sighting.title?.isNotEmpty == true
                      ? hit.sighting.title!
                      : hit.sighting.note,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text(
                  '${_formatDistance(hit.km)} away · ${hit.sighting.note}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5),
                ),
                onTap: widget.onFocusSighting == null
                    ? null
                    : () => widget.onFocusSighting!(hit.sighting),
              ),
        ],
        ),
      ),
    );
  }
}
