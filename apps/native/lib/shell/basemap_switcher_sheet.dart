import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import '../nostr/callout_overlay.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/settings.dart';
import '../src/rust/api/spike.dart';
import '../theme/earthly_theme.dart';

enum BasemapKind { openFreeMapLiberty, openFreeMapDark, offlinePmtiles }

@immutable
class OfflinePmtilesBasemap {
  const OfflinePmtilesBasemap({
    required this.snapshot,
    required this.styleJson,
  });

  final IngestedPmtilesSnapshot snapshot;
  final String styleJson;
}

/// Builds a self-contained MapLibre Style JSON pointing directly to a local
/// `.pmtiles` archive hosted by our embedded Rust Blossom server.
String buildPmtilesStyleJson(IngestedPmtilesSnapshot ingested) {
  final h = ingested.header;
  final isRaster = h.format == 'png' ||
      h.format == 'jpeg' ||
      h.format == 'webp' ||
      h.format == 'avif';
  final pmtilesUrl = 'pmtiles://${ingested.blobUrl}';

  if (isRaster) {
    return jsonEncode({
      'version': 8,
      'name': ingested.label,
      'sources': {
        'local-pmtiles': {
          'type': 'raster',
          'url': pmtilesUrl,
          'tileSize': 256,
          'minzoom': h.minZoom,
          'maxzoom': h.maxZoom,
          'bounds': [h.west, h.south, h.east, h.north],
        },
      },
      'layers': [
        {
          'id': 'background',
          'type': 'background',
          'paint': {'background-color': '#ebe8e0'},
        },
        {
          'id': 'local-pmtiles-raster',
          'type': 'raster',
          'source': 'local-pmtiles',
        },
      ],
    });
  }

  // Vector MVT fallback style covering common OpenMapTiles / Protomaps layers.
  return jsonEncode({
    'version': 8,
    'name': ingested.label,
    'sources': {
      'local-pmtiles': {
        'type': 'vector',
        'url': pmtilesUrl,
        'minzoom': h.minZoom,
        'maxzoom': h.maxZoom,
        'bounds': [h.west, h.south, h.east, h.north],
      },
    },
    'layers': [
      {
        'id': 'background',
        'type': 'background',
        'paint': {'background-color': '#f5f2eb'},
      },
      {
        'id': 'water',
        'type': 'fill',
        'source': 'local-pmtiles',
        'source-layer': 'water',
        'paint': {'fill-color': '#bfd9e8'},
      },
      {
        'id': 'landuse',
        'type': 'fill',
        'source': 'local-pmtiles',
        'source-layer': 'landuse',
        'paint': {'fill-color': '#dfead7', 'fill-opacity': 0.7},
      },
      {
        'id': 'buildings',
        'type': 'fill',
        'source': 'local-pmtiles',
        'source-layer': 'buildings',
        'paint': {'fill-color': '#ddd8ce', 'fill-outline-color': '#c7c1b6'},
      },
      {
        'id': 'roads',
        'type': 'line',
        'source': 'local-pmtiles',
        'source-layer': 'roads',
        'paint': {'line-color': '#ffffff', 'line-width': 1.5},
      },
      {
        'id': 'transportation',
        'type': 'line',
        'source': 'local-pmtiles',
        'source-layer': 'transportation',
        'paint': {'line-color': '#d8d2c7', 'line-width': 1.4},
      },
    ],
  });
}

/// Map Display, Offline PMTiles Pack Manager & Atlas Coverage Switcher sheet.
class BasemapSwitcherSheet extends StatefulWidget {
  const BasemapSwitcherSheet({
    required this.activeBasemap,
    required this.offlineBasemap,
    required this.showLabels,
    required this.calloutMode,
    required this.onSelectBasemap,
    required this.onLoadedOfflinePmtiles,
    required this.onToggleLabels,
    required this.onChangeCalloutMode,
    this.savedOfflinePacks = const <SavedOfflinePackDto>[],
    this.onMountSavedPack,
    this.onRemoveSavedPack,
    super.key,
  });

  final BasemapKind activeBasemap;
  final OfflinePmtilesBasemap? offlineBasemap;
  final bool showLabels;
  final CalloutDisplayMode calloutMode;
  final ValueChanged<BasemapKind> onSelectBasemap;
  final ValueChanged<OfflinePmtilesBasemap> onLoadedOfflinePmtiles;
  final ValueChanged<bool> onToggleLabels;
  final ValueChanged<CalloutDisplayMode> onChangeCalloutMode;
  final List<SavedOfflinePackDto> savedOfflinePacks;
  final Future<void> Function(SavedOfflinePackDto pack)? onMountSavedPack;
  final ValueChanged<String>? onRemoveSavedPack;

  @override
  State<BasemapSwitcherSheet> createState() => _BasemapSwitcherSheetState();
}

class _BasemapSwitcherSheetState extends State<BasemapSwitcherSheet> {
  bool _loadingPmtiles = false;
  String? _error;
  late BasemapKind _activeBasemap = widget.activeBasemap;
  late bool _showLabels = widget.showLabels;
  late CalloutDisplayMode _calloutMode = widget.calloutMode;

  Future<void> _pickAndLoadPmtiles() async {
    setState(() {
      _loadingPmtiles = true;
      _error = null;
    });
    try {
      final picked = await DeviceBridge.pickPmtilesFile();
      await RustBridge.ensureInitialized();
      final dir = await getApplicationSupportDirectory();
      await startLocalNode(dataDir: '${dir.path}/local-node');
      final ingested = await ingestLocalPmtiles(
        bytes: picked.bytes,
        label: picked.name,
      );
      final styleJson = buildPmtilesStyleJson(ingested);
      final offline = OfflinePmtilesBasemap(
        snapshot: ingested,
        styleJson: styleJson,
      );
      widget.onLoadedOfflinePmtiles(offline);
      if (mounted) Navigator.of(context).pop();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _loadingPmtiles = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final offline = widget.offlineBasemap;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(
                  'MAP STYLE & OVERLAYS',
                  style: theme.textTheme.labelLarge?.copyWith(
                    fontFamily: 'monospace',
                    letterSpacing: 0.7,
                  ),
                ),
                const Spacer(),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
            const SizedBox(height: 8),

            // Basemap tiles
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  label: const Text('OpenFreeMap Liberty'),
                  selected: _activeBasemap == BasemapKind.openFreeMapLiberty,
                  onSelected: (_) {
                    setState(
                      () => _activeBasemap = BasemapKind.openFreeMapLiberty,
                    );
                    widget.onSelectBasemap(BasemapKind.openFreeMapLiberty);
                    Navigator.of(context).pop();
                  },
                ),
                ChoiceChip(
                  label: const Text('OpenFreeMap Dark'),
                  selected: _activeBasemap == BasemapKind.openFreeMapDark,
                  onSelected: (_) {
                    setState(
                      () => _activeBasemap = BasemapKind.openFreeMapDark,
                    );
                    widget.onSelectBasemap(BasemapKind.openFreeMapDark);
                    Navigator.of(context).pop();
                  },
                ),
                if (offline != null)
                  ChoiceChip(
                    label: Text('Offline: ${offline.snapshot.label}'),
                    selected: _activeBasemap == BasemapKind.offlinePmtiles,
                    onSelected: (_) {
                      setState(
                        () => _activeBasemap = BasemapKind.offlinePmtiles,
                      );
                      widget.onSelectBasemap(BasemapKind.offlinePmtiles);
                      Navigator.of(context).pop();
                    },
                  ),
              ],
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _loadingPmtiles ? null : _pickAndLoadPmtiles,
              icon: _loadingPmtiles
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.folder_open_outlined, size: 16),
              label: Text(
                offline == null
                    ? 'Load Offline .pmtiles Archive (Local Blossom)'
                    : 'Switch Offline .pmtiles Archive',
              ),
            ),
            if (offline != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'PMTiles v3 · ${offline.snapshot.header.format.toUpperCase()} · z${offline.snapshot.header.minZoom}–${offline.snapshot.header.maxZoom} · ${(offline.snapshot.sizeBytes.toInt() / 1024).toStringAsFixed(0)} KB',
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
                ),
              ),
            if (widget.savedOfflinePacks.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                'SAVED OFFLINE PACKS (${widget.savedOfflinePacks.length})',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              for (final pack in widget.savedOfflinePacks)
                Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: offline?.snapshot.sha256 == pack.sha256
                          ? theme.colorScheme.primary
                          : theme.dividerColor,
                    ),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              pack.label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 12,
                              ),
                            ),
                            Text(
                              '${pack.format.toUpperCase()} · z${pack.minZoom}–${pack.maxZoom} · ${(pack.sizeBytes.toInt() / 1024).toStringAsFixed(0)} KB',
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (widget.onMountSavedPack != null)
                        TextButton(
                          onPressed: _loadingPmtiles
                              ? null
                              : () async {
                                  final nav = Navigator.of(context);
                                  await widget.onMountSavedPack!(pack);
                                  if (mounted) nav.pop();
                                },
                          child: const Text('Mount'),
                        ),
                      if (widget.onRemoveSavedPack != null)
                        IconButton(
                          tooltip: 'Forget pack',
                          visualDensity: VisualDensity.compact,
                          onPressed: () =>
                              widget.onRemoveSavedPack!(pack.sha256),
                          icon: const Icon(Icons.close, size: 15),
                        ),
                    ],
                  ),
                ),
            ],
            const SizedBox(height: 6),
            Text(
              _activeBasemap == BasemapKind.offlinePmtiles
                  ? 'Atlas coverage: COMPLETE (local Blossom PMTiles active)'
                  : 'Atlas coverage: PARTIAL (online OpenFreeMap · mount .pmtiles/.atlas for full offline)',
              style: const TextStyle(fontFamily: 'monospace', fontSize: 10),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  _error!,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: EarthlyColors.destructive,
                  ),
                ),
              ),

            const Divider(height: 20),

            // Labels & Callouts presentation toggles
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Feature Labels on Map'),
              subtitle: const Text(
                'Native GPU collision-free feature names',
                style: TextStyle(fontSize: 12),
              ),
              value: _showLabels,
              onChanged: (val) {
                setState(() => _showLabels = val);
                widget.onToggleLabels(val);
              },
            ),
            const SizedBox(height: 4),
            Text(
              'CALLOUT DISPLAY MODE',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                letterSpacing: 0.6,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              children: [
                for (final mode in CalloutDisplayMode.values)
                  ChoiceChip(
                    label: Text(calloutModeShortLabel(mode)),
                    selected: _calloutMode == mode,
                    onSelected: (_) {
                      setState(() => _calloutMode = mode);
                      widget.onChangeCalloutMode(mode);
                    },
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
