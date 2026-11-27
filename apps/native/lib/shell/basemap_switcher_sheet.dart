import 'dart:async';
import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import '../nostr/basemap_config.dart';
import '../nostr/callout_overlay.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/settings.dart';
import '../src/rust/api/spike.dart';
import '../theme/earthly_theme.dart';

export '../nostr/basemap_config.dart'
    show BasemapKind, MapBackgroundMode, basemapStyleLabel;

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
    this.mountedAtlasWorkspaces = const <MountedAtlasWorkspaceDto>[],
    this.onMountAtlasWorkspace,
    this.onUnmountAtlasWorkspace,
    this.themeMode = ThemeMode.system,
    this.onThemeModeChanged,
    this.backgroundMode = MapBackgroundMode.osm,
    this.satelliteOpacity = 0.75,
    this.onBackgroundModeChanged,
    this.onSatelliteOpacityChanged,
    this.onExportMapPosterPng,
    this.pointClusteringEnabled = true,
    this.onTogglePointClustering,
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
  final List<MountedAtlasWorkspaceDto> mountedAtlasWorkspaces;
  final Future<void> Function(AtlasBundleInspectionDto bundle)?
      onMountAtlasWorkspace;
  final ValueChanged<String>? onUnmountAtlasWorkspace;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode>? onThemeModeChanged;
  final MapBackgroundMode backgroundMode;
  final double satelliteOpacity;
  final ValueChanged<MapBackgroundMode>? onBackgroundModeChanged;
  final ValueChanged<double>? onSatelliteOpacityChanged;
  final VoidCallback? onExportMapPosterPng;
  final bool pointClusteringEnabled;
  final ValueChanged<bool>? onTogglePointClustering;

  @override
  State<BasemapSwitcherSheet> createState() => _BasemapSwitcherSheetState();
}

class _BasemapSwitcherSheetState extends State<BasemapSwitcherSheet> {
  final _atlasPathController = TextEditingController();
  bool _loadingPmtiles = false;
  bool _scanningAtlas = false;
  List<AtlasBundleInspectionDto> _discoveredAtlases = const [];
  String? _error;
  late BasemapKind _activeBasemap = widget.activeBasemap;
  late bool _showLabels = widget.showLabels;
  late CalloutDisplayMode _calloutMode = widget.calloutMode;
  late ThemeMode _themeMode = widget.themeMode;
  late MapBackgroundMode _backgroundMode = widget.backgroundMode;
  late double _satelliteOpacity = widget.satelliteOpacity;
  late bool _pointClusteringEnabled = widget.pointClusteringEnabled;

  @override
  void dispose() {
    _atlasPathController.dispose();
    super.dispose();
  }

  Future<void> _scanAtlasDirectories() async {
    setState(() {
      _scanningAtlas = true;
      _error = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final support = await getApplicationSupportDirectory();
      final docs = await getApplicationDocumentsDirectory();
      final candidates = <String>[
        support.path,
        '${support.path}/atlases',
        docs.path,
        '${docs.path}/Earthly',
      ];
      final found = await discoverLocalAtlasBundles(searchDirs: candidates);
      if (!mounted) return;
      setState(() {
        _discoveredAtlases = found;
        if (found.isEmpty) {
          _error =
              'No .atlas bundles found in app folders yet. Paste a local .atlas folder or archive path below.';
        }
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _scanningAtlas = false);
    }
  }

  Future<void> _mountAtlasFromPath(String rawPath) async {
    final trimmed = rawPath.trim();
    if (trimmed.isEmpty) return;
    setState(() {
      _scanningAtlas = true;
      _error = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final bundle = await inspectAtlasWorkspacePath(path: trimmed);
      await widget.onMountAtlasWorkspace?.call(bundle);
      _atlasPathController.clear();
      if (mounted) Navigator.of(context).pop();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _scanningAtlas = false);
    }
  }

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
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'MAP STYLE, THEME & OVERLAYS',
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontFamily: 'monospace',
                      letterSpacing: 0.7,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
            if (widget.onThemeModeChanged != null) ...[
              const SizedBox(height: 6),
              Text(
                'APPEARANCE',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  letterSpacing: 0.6,
                ),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  for (final entry in const [
                    (ThemeMode.system, 'System', Icons.brightness_auto_outlined),
                    (ThemeMode.light, 'Light', Icons.light_mode_outlined),
                    (ThemeMode.dark, 'Dark', Icons.dark_mode_outlined),
                  ])
                    ChoiceChip(
                      key: Key('theme-mode-${entry.$1.name}'),
                      avatar: Icon(entry.$3, size: 15),
                      label: Text(entry.$2),
                      selected: _themeMode == entry.$1,
                      onSelected: (_) {
                        setState(() => _themeMode = entry.$1);
                        widget.onThemeModeChanged!(entry.$1);
                      },
                    ),
                ],
              ),
              const SizedBox(height: 12),
            ] else
              const SizedBox(height: 8),

            Text(
              'OPENFREEMAP & OFFLINE BASEMAP',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                letterSpacing: 0.6,
              ),
            ),
            const SizedBox(height: 6),
            // Basemap tiles
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final kind in const [
                  BasemapKind.auto,
                  BasemapKind.openFreeMapPositron,
                  BasemapKind.openFreeMapBright,
                  BasemapKind.openFreeMapLiberty,
                  BasemapKind.openFreeMapDark,
                  BasemapKind.openFreeMapFiord,
                ])
                  ChoiceChip(
                    key: Key('basemap-${kind.name}'),
                    label: Text(basemapStyleLabel(kind)),
                    selected: _activeBasemap == kind,
                    onSelected: (_) {
                      setState(() => _activeBasemap = kind);
                      widget.onSelectBasemap(kind);
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
            if (widget.onBackgroundModeChanged != null &&
                _activeBasemap != BasemapKind.offlinePmtiles) ...[
              const SizedBox(height: 12),
              Text(
                'SATELLITE IMAGERY (EOXCLOUDLESS)',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  letterSpacing: 0.6,
                ),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  for (final item in const [
                    (MapBackgroundMode.osm, 'Vector'),
                    (MapBackgroundMode.combined, 'Combined'),
                    (MapBackgroundMode.satellite, 'Satellite'),
                  ])
                    ChoiceChip(
                      key: Key('bg-mode-${item.$1.name}'),
                      label: Text(item.$2),
                      selected: _backgroundMode == item.$1,
                      onSelected: (_) {
                        setState(() => _backgroundMode = item.$1);
                        widget.onBackgroundModeChanged!(item.$1);
                      },
                    ),
                ],
              ),
              if (_backgroundMode == MapBackgroundMode.combined &&
                  widget.onSatelliteOpacityChanged != null)
                Row(
                  children: [
                    const Text(
                      'IMAGERY OPACITY',
                      style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                    ),
                    Expanded(
                      child: Slider(
                        key: const Key('satellite-opacity-slider'),
                        min: 0.1,
                        max: 1.0,
                        divisions: 9,
                        value: _satelliteOpacity.clamp(0.1, 1.0),
                        onChanged: (v) {
                          setState(() => _satelliteOpacity = v);
                          widget.onSatelliteOpacityChanged!(v);
                        },
                      ),
                    ),
                    Text(
                      '${(_satelliteOpacity * 100).round()}%',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                      ),
                    ),
                  ],
                ),
            ],
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
              _activeBasemap == BasemapKind.offlinePmtiles ||
                      widget.mountedAtlasWorkspaces.isNotEmpty
                  ? 'Atlas coverage: COMPLETE (${widget.mountedAtlasWorkspaces.length} .atlas bundle${widget.mountedAtlasWorkspaces.length == 1 ? '' : 's'} · ${widget.savedOfflinePacks.length} PMTiles pack${widget.savedOfflinePacks.length == 1 ? '' : 's'})'
                  : 'Atlas coverage: PARTIAL (online OpenFreeMap · mount .pmtiles/.atlas for full offline)',
              style: const TextStyle(fontFamily: 'monospace', fontSize: 10),
            ),

            // Offline .atlas Workspace Discovery & Mounting
            const Divider(height: 20),
            Row(
              children: [
                Text(
                  'OFFLINE .ATLAS WORKSPACES (${widget.mountedAtlasWorkspaces.length})',
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: _scanningAtlas ? null : _scanAtlasDirectories,
                  icon: _scanningAtlas
                      ? const SizedBox(
                          width: 12,
                          height: 12,
                          child: CircularProgressIndicator(strokeWidth: 1.8),
                        )
                      : const Icon(Icons.search, size: 15),
                  label: const Text('Scan'),
                ),
              ],
            ),
            if (widget.mountedAtlasWorkspaces.isNotEmpty) ...[
              const SizedBox(height: 4),
              for (final ws in widget.mountedAtlasWorkspaces)
                Container(
                  margin: const EdgeInsets.only(bottom: 5),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: EarthlyColors.commentGreen.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: EarthlyColors.commentGreen.withValues(alpha: 0.45),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.sd_storage_outlined,
                        size: 16,
                        color: EarthlyColors.commentGreen,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              ws.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 12,
                              ),
                            ),
                            Text(
                              ws.coverageSummary,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (widget.onUnmountAtlasWorkspace != null)
                        IconButton(
                          tooltip: 'Unmount .atlas',
                          visualDensity: VisualDensity.compact,
                          onPressed: () =>
                              widget.onUnmountAtlasWorkspace!(ws.path),
                          icon: const Icon(Icons.close, size: 16),
                        ),
                    ],
                  ),
                ),
            ],
            if (_discoveredAtlases.isNotEmpty) ...[
              const SizedBox(height: 6),
              for (final found in _discoveredAtlases)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(found.name),
                  subtitle: Text(
                    found.coverageSummary,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 10),
                  ),
                  trailing: FilledButton(
                    onPressed: _scanningAtlas
                        ? null
                        : () => unawaited(_mountAtlasFromPath(found.path)),
                    child: const Text('Mount'),
                  ),
                ),
            ],
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _atlasPathController,
                    onSubmitted: (v) => unawaited(_mountAtlasFromPath(v)),
                    decoration: const InputDecoration(
                      hintText: 'Mount local .atlas folder or archive path…',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: _scanningAtlas
                      ? null
                      : () => unawaited(
                            _mountAtlasFromPath(_atlasPathController.text),
                          ),
                  child: const Text('Mount'),
                ),
              ],
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

            // Labels, Clustering & Callouts presentation toggles
            if (widget.onTogglePointClustering != null)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Point Clustering'),
                subtitle: const Text(
                  'Group nearby points into clusters while zoomed out',
                  style: TextStyle(fontSize: 12),
                ),
                value: _pointClusteringEnabled,
                onChanged: (val) {
                  setState(() => _pointClusteringEnabled = val);
                  widget.onTogglePointClustering!(val);
                },
              ),
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
            if (widget.onExportMapPosterPng != null) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const Key('basemap-export-poster-btn'),
                onPressed: () {
                  Navigator.of(context).pop();
                  widget.onExportMapPosterPng!();
                },
                icon: const Icon(Icons.image_outlined, size: 16),
                label: const Text('Export High-Res Map Poster (PNG)'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
