import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

/// Basemap presets aligned 1:1 with Web `src/lib/basemap.ts` plus native
/// offline PMTiles archives.
enum BasemapKind {
  auto,
  openFreeMapPositron,
  openFreeMapBright,
  openFreeMapLiberty,
  openFreeMapDark,
  openFreeMapFiord,
  offlinePmtiles,
}

/// Map imagery background blend mode aligned with Web `src/lib/satellite.ts`.
enum MapBackgroundMode {
  osm,
  combined,
  satellite,
}

/// Public OpenFreeMap Liberty & Dark defaults + Positron, Bright, and Fiord.
const String _openFreeMapBase = 'https://tiles.openfreemap.org/styles';

/// EOxCloudless Sentinel-2 cloudless satellite mosaic (CC BY 4.0).
const String eoxSatelliteTileUrl =
    'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';

const String earthlySatelliteSourceId = 'earthly-satellite';
const String earthlySatelliteLayerId = 'earthly-satellite';

String basemapStyleLabel(BasemapKind kind) => switch (kind) {
      BasemapKind.auto => 'Auto',
      BasemapKind.openFreeMapPositron => 'Positron',
      BasemapKind.openFreeMapBright => 'Bright',
      BasemapKind.openFreeMapLiberty => 'Liberty',
      BasemapKind.openFreeMapDark => 'Dark',
      BasemapKind.openFreeMapFiord => 'Fiord',
      BasemapKind.offlinePmtiles => 'Offline PMTiles',
    };

String basemapKindToId(BasemapKind kind) => switch (kind) {
      BasemapKind.auto => 'auto',
      BasemapKind.openFreeMapPositron => 'positron',
      BasemapKind.openFreeMapBright => 'bright',
      BasemapKind.openFreeMapLiberty => 'liberty',
      BasemapKind.openFreeMapDark => 'dark',
      BasemapKind.openFreeMapFiord => 'fiord',
      BasemapKind.offlinePmtiles => 'offline',
    };

BasemapKind basemapKindFromId(String? raw) => switch (raw?.trim().toLowerCase()) {
      'positron' => BasemapKind.openFreeMapPositron,
      'bright' => BasemapKind.openFreeMapBright,
      'liberty' => BasemapKind.openFreeMapLiberty,
      'dark' => BasemapKind.openFreeMapDark,
      'fiord' => BasemapKind.openFreeMapFiord,
      'offline' => BasemapKind.offlinePmtiles,
      _ => BasemapKind.auto,
    };

String backgroundModeToId(MapBackgroundMode mode) => switch (mode) {
      MapBackgroundMode.osm => 'osm',
      MapBackgroundMode.combined => 'combined',
      MapBackgroundMode.satellite => 'satellite',
    };

MapBackgroundMode backgroundModeFromId(String? raw) =>
    switch (raw?.trim().toLowerCase()) {
      'combined' => MapBackgroundMode.combined,
      'satellite' => MapBackgroundMode.satellite,
      _ => MapBackgroundMode.osm,
    };

String themeModeToId(ThemeMode mode) => switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    };

ThemeMode themeModeFromId(String? raw) => switch (raw?.trim().toLowerCase()) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };

String openFreeMapStyleUrl(BasemapKind kind, {required bool systemIsDark}) {
  final effective = kind == BasemapKind.auto
      ? (systemIsDark
          ? BasemapKind.openFreeMapDark
          : BasemapKind.openFreeMapLiberty)
      : kind;
  final slug = switch (effective) {
    BasemapKind.openFreeMapPositron => 'positron',
    BasemapKind.openFreeMapBright => 'bright',
    BasemapKind.openFreeMapLiberty => 'liberty',
    BasemapKind.openFreeMapDark => 'dark',
    BasemapKind.openFreeMapFiord => 'fiord',
    BasemapKind.auto || BasemapKind.offlinePmtiles =>
      systemIsDark ? 'dark' : 'liberty',
  };
  return '$_openFreeMapBase/$slug';
}

bool isDarkBasemap(
  BasemapKind kind, {
  required bool systemIsDark,
  MapBackgroundMode backgroundMode = MapBackgroundMode.osm,
}) {
  if (backgroundMode == MapBackgroundMode.satellite) return true;
  return switch (kind) {
    BasemapKind.openFreeMapDark || BasemapKind.openFreeMapFiord => true,
    BasemapKind.auto => systemIsDark,
    _ => false,
  };
}

/// Synchronizes the EOxCloudless Sentinel-2 raster imagery layer on an active
/// MapLibre [StyleController], handling Vector (`osm`), blended `combined`
/// (below vector symbols), and opaque `satellite` modes cleanly.
Future<void> syncSatelliteOverlayLayer({
  required StyleController style,
  required MapBackgroundMode mode,
  required double opacity,
  required bool isOfflinePmtiles,
}) async {
  try {
    if (mode == MapBackgroundMode.osm || isOfflinePmtiles) {
      if (style.layers[earthlySatelliteLayerId] != null) {
        await style.layers.remove(earthlySatelliteLayerId);
      }
      if (style.sources[earthlySatelliteSourceId] != null) {
        await style.sources.remove(earthlySatelliteSourceId);
      }
      return;
    }

    if (style.sources[earthlySatelliteSourceId] == null) {
      await style.sources.add(
        const RasterSource.tiles(
          id: earthlySatelliteSourceId,
          tiles: <String>[eoxSatelliteTileUrl],
          tileSize: 256,
          maxZoom: 13,
          attribution:
              'EOxCloudless Sentinel-2 (EOX IT Services GmbH, CC BY 4.0)',
        ),
      );
    }

    String? belowLayerId;
    if (mode == MapBackgroundMode.combined) {
      for (final layer in style.layers) {
        if (layer is SymbolStyleLayer) {
          belowLayerId = layer.id;
          break;
        }
      }
    }
    if (belowLayerId == null) {
      for (final layer in style.layers) {
        if (layer.id.startsWith('earthly-') &&
            layer.id != earthlySatelliteLayerId) {
          belowLayerId = layer.id;
          break;
        }
      }
    }

    final effectiveOpacity =
        mode == MapBackgroundMode.satellite ? 1.0 : opacity.clamp(0.05, 1.0);
    if (style.layers[earthlySatelliteLayerId] != null) {
      await style.layers.remove(earthlySatelliteLayerId);
    }
    await style.layers.add(
      RasterStyleLayer(
        id: earthlySatelliteLayerId,
        sourceId: earthlySatelliteSourceId,
        opacity: Literal(effectiveOpacity),
        fadeDuration: const Literal(180),
      ),
      belowLayerId: belowLayerId,
    );
  } catch (_) {
    // Ignore detached StyleController errors during rapid basemap transitions.
  }
}
