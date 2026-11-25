import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../nostr/shelf_renderer.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/geo.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';

/// Pure-Rust OpenStreetMap / Overpass BBox import drawer: select an OSM preset
/// or custom tag, query Overpass for the active viewport (max 0.5° × 0.5°),
/// preview converted GeoJSON features, and import directly into Working Draft.
class OsmImportSheet extends StatefulWidget {
  const OsmImportSheet({
    required this.west,
    required this.south,
    required this.east,
    required this.north,
    required this.onImportFeatures,
    required this.onClose,
    this.queryOverride,
    super.key,
  });

  final double west;
  final double south;
  final double east;
  final double north;
  final ValueChanged<OsmImportResultDto> onImportFeatures;
  final VoidCallback onClose;
  final Future<OsmImportResultDto> Function({
    required double west,
    required double south,
    required double east,
    required double north,
    required String preset,
    String? customTag,
    int? limit,
  })? queryOverride;

  @override
  State<OsmImportSheet> createState() => _OsmImportSheetState();
}

class _OsmImportSheetState extends State<OsmImportSheet> {
  static const _presets = <String>[
    'highway',
    'waterway',
    'building',
    'natural',
    'amenity',
    'leisure',
    'railway',
    'peaks',
    'water',
    'all',
  ];

  final _customTagController = TextEditingController();
  String _selectedPreset = 'highway';
  bool _querying = false;
  String? _error;
  OsmImportResultDto? _previewResult;
  List<DrawnFeature> _previewFeatures = const <DrawnFeature>[];

  @override
  void dispose() {
    _customTagController.dispose();
    super.dispose();
  }

  bool get _bboxTooLarge {
    final dLon = (widget.east - widget.west).abs();
    final dLat = (widget.north - widget.south).abs();
    return dLon > 0.5 || dLat > 0.5;
  }

  Future<void> _runQuery() async {
    setState(() {
      _querying = true;
      _error = null;
    });
    try {
      final custom = _customTagController.text.trim();
      final OsmImportResultDto res;
      if (widget.queryOverride != null) {
        res = await widget.queryOverride!(
          west: widget.west,
          south: widget.south,
          east: widget.east,
          north: widget.north,
          preset: _selectedPreset,
          customTag: custom.isEmpty ? null : custom,
          limit: 120,
        );
      } else {
        await RustBridge.ensureInitialized();
        res = await geoQueryOverpassBbox(
          west: widget.west,
          south: widget.south,
          east: widget.east,
          north: widget.north,
          preset: _selectedPreset,
          customTag: custom.isEmpty ? null : custom,
          limit: 120,
        );
      }
      if (!mounted) return;
      final parsed = parseDraftFeaturesFromGeoJson(res.geojson);
      setState(() {
        _previewResult = res;
        _previewFeatures = parsed;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _querying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final result = _previewResult;

    return EarthlyMapDrawer(
      initialFraction: 0.58,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            const Icon(
              Icons.public_outlined,
              size: 18,
              color: EarthlyColors.commentGreen,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'IMPORT OSM FEATURES',
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
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 24),
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: _bboxTooLarge
                  ? EarthlyColors.proposedAmber.withValues(alpha: 0.14)
                  : theme.colorScheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: _bboxTooLarge
                    ? EarthlyColors.proposedAmber
                    : theme.dividerColor,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'BBOX: ${widget.south.toStringAsFixed(4)}, ${widget.west.toStringAsFixed(4)} → ${widget.north.toStringAsFixed(4)}, ${widget.east.toStringAsFixed(4)}',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (_bboxTooLarge) ...[
                  const SizedBox(height: 4),
                  const Text(
                    'Viewport spans > 0.5°. Zoom in closer on the map before querying Overpass.',
                    style: TextStyle(
                      fontSize: 11,
                      color: EarthlyColors.proposedAmber,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'OVERPASS PRESET',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final preset in _presets)
                ChoiceChip(
                  key: Key('osm-preset-$preset'),
                  label: Text(preset),
                  selected: _selectedPreset == preset,
                  onSelected: (_) => setState(() => _selectedPreset = preset),
                ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            key: const Key('osm-custom-tag-field'),
            controller: _customTagController,
            decoration: const InputDecoration(
              labelText: 'Custom Overpass tag (optional)',
              hintText: 'e.g. tourism=alpine_hut or amenity=drinking_water',
            ),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            key: const Key('osm-query-btn'),
            onPressed: _querying ? null : _runQuery,
            icon: _querying
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.cloud_download_outlined, size: 17),
            label: Text(_querying ? 'Querying Overpass…' : 'Query Overpass'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: EarthlyColors.destructive.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: EarthlyColors.destructive),
              ),
              child: Text(
                _error!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: EarthlyColors.destructive,
                ),
              ),
            ),
          ],
          if (result != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: EarthlyColors.commentGreen.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: EarthlyColors.commentGreen),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    result.querySummary,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (_previewFeatures.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    for (final feat in _previewFeatures.take(8))
                      Text(
                        '• ${feat.name ?? feat.kind.name} (${feat.kind.name}, ${feat.vertices.length} pts)',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                        ),
                      ),
                    if (_previewFeatures.length > 8)
                      Text(
                        '…and ${_previewFeatures.length - 8} more features',
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                        ),
                      ),
                  ],
                  const SizedBox(height: 10),
                  FilledButton.icon(
                    key: const Key('osm-import-btn'),
                    onPressed: result.featureCount == 0
                        ? null
                        : () {
                            widget.onImportFeatures(result);
                            widget.onClose();
                          },
                    icon: const Icon(Icons.add_box_outlined, size: 17),
                    label: Text(
                      'Import ${result.featureCount} Feature${result.featureCount == 1 ? '' : 's'} to Draft',
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
