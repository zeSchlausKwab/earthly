import 'dart:convert';
import 'dart:math' as math;

import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'story_presentation.dart';

@immutable
class InspectedFeature {
  const InspectedFeature({
    required this.sourceLabel,
    required this.isDraft,
    required this.geometryType,
    required this.properties,
    this.featureId,
    this.draftFeatureId,
    this.title,
    this.lengthMeters,
    this.areaSquareMeters,
    this.imageUrl,
    this.callouts = const [],
    this.datasetAddress,
    this.datasetPubkey,
    this.datasetTitle,
    this.datasetEventId,
    this.datasetGeojson,
  });

  final String sourceLabel;
  final bool isDraft;
  final String geometryType;
  final Map<String, Object?> properties;
  final String? featureId;
  final String? draftFeatureId;
  final String? title;
  final double? lengthMeters;
  final double? areaSquareMeters;
  final String? imageUrl;
  final List<MapCalloutItem> callouts;
  final String? datasetAddress;
  final String? datasetPubkey;
  final String? datasetTitle;
  final String? datasetEventId;
  final String? datasetGeojson;
}

/// Authored contextual card attached to a Feature (`Feature.properties["earthly:callouts"]`).
/// See `SPEC.md` §1.8.
@immutable
class MapCalloutItem {
  const MapCalloutItem({
    required this.key,
    required this.id,
    required this.text,
    required this.anchor,
    required this.datasetTitle,
    this.featureId,
    this.featureLabel,
    this.title,
    this.mediaUrls = const [],
    this.preferredSide = 'auto',
    this.offset = Offset.zero,
    this.showLeader = true,
    this.accentColorHex,
    this.inspectedFeature,
  });

  final String key;
  final String id;
  final String text;
  final Geographic anchor;
  final String datasetTitle;
  final String? featureId;
  final String? featureLabel;
  final String? title;
  final List<String> mediaUrls;
  final String preferredSide;
  final Offset offset;
  final bool showLeader;
  final String? accentColorHex;
  final InspectedFeature? inspectedFeature;
}

/// Temporary `geo:lat,lon` pin activated from a Story or comment (`SPEC.md` §2.4).
@immutable
class GeoPinOverlayItem {
  const GeoPinOverlayItem({
    required this.id,
    required this.position,
    required this.label,
  });

  final String id;
  final Geographic position;
  final String label;
}

/// Frame-locked `displayIcon` (`lucide:*`) Point marker rendered cleanly over
/// its colored backing disc (`SPEC.md` §1.7).
@immutable
class MapIconPinItem {
  const MapIconPinItem({
    required this.key,
    required this.position,
    required this.iconName,
    required this.fillColor,
    required this.ringColor,
    required this.inspectedFeature,
  });

  final String key;
  final Geographic position;
  final String iconName;
  final Color fillColor;
  final Color ringColor;
  final InspectedFeature inspectedFeature;
}

/// Frame-locked directional arrowhead rendered at the start/end of LineStrings
/// with `arrowStart` / `arrowEnd` properties (`SPEC.md` §1.7).
@immutable
class MapArrowheadItem {
  const MapArrowheadItem({
    required this.key,
    required this.tip,
    required this.from,
    required this.color,
    this.strokeWidth = 3.0,
  });

  final String key;
  final Geographic tip;
  final Geographic from;
  final Color color;
  final double strokeWidth;
}

/// Searchable catalog of cartographic `lucide:*` icons supported natively.
const List<(String id, String label, IconData icon)> earthlyCartographicIcons = [
  ('lucide:mountain', 'Mountain / Peak', Icons.terrain),
  ('lucide:tent', 'Camp / Tent', Icons.park),
  ('lucide:trees', 'Forest / Trees', Icons.forest),
  ('lucide:anchor', 'Harbor / Anchor', Icons.anchor),
  ('lucide:flag', 'Flag / Waypoint', Icons.flag),
  ('lucide:compass', 'Compass', Icons.explore),
  ('lucide:camera', 'Viewpoint / Photo', Icons.photo_camera),
  ('lucide:binoculars', 'Lookout', Icons.visibility),
  ('lucide:footprints', 'Hiking Trail', Icons.hiking),
  ('lucide:bike', 'Cycling', Icons.directions_bike),
  ('lucide:coffee', 'Cafe / Coffee', Icons.local_cafe),
  ('lucide:utensils', 'Food / Restaurant', Icons.restaurant),
  ('lucide:home', 'Hut / Shelter', Icons.home),
  ('lucide:landmark', 'Landmark / Castle', Icons.account_balance),
  ('lucide:train', 'Train / Rail', Icons.train),
  ('lucide:bus', 'Bus Stop', Icons.directions_bus),
  ('lucide:plane', 'Airport / Airstrip', Icons.flight),
  ('lucide:car', 'Parking / Road', Icons.directions_car),
  ('lucide:droplet', 'Water / Spring', Icons.water_drop),
  ('lucide:flame', 'Campfire / Hazard', Icons.local_fire_department),
  ('lucide:alert-triangle', 'Warning / Caution', Icons.warning_amber),
  ('lucide:hospital', 'Medical / Aid', Icons.local_hospital),
  ('lucide:bridge', 'Bridge / Crossing', Icons.route),
  ('lucide:star', 'Highlight / Star', Icons.star),
  ('lucide:heart', 'Favorite', Icons.favorite),
  ('lucide:info', 'Information', Icons.info_outline),
  ('lucide:sun', 'Sun / Solar', Icons.wb_sunny_outlined),
  ('lucide:music', 'Venue / Culture', Icons.music_note),
  ('lucide:shopping-bag', 'Market / Shop', Icons.shopping_bag_outlined),
  ('lucide:book', 'Library / Archive', Icons.menu_book_outlined),
];

/// Curated Lucide -> Material icon mapping covering Earthly's cartographic vocabulary.
IconData resolveLucideIcon(String rawIcon) {
  final name = rawIcon
      .trim()
      .toLowerCase()
      .replaceFirst('lucide:', '');
  return switch (name) {
    'mountain' || 'mountain-snow' || 'peak' => Icons.terrain,
    'tent' || 'campground' => Icons.park,
    'trees' || 'tree-pine' || 'tree-deciduous' => Icons.forest,
    'anchor' || 'ship' || 'sailboat' || 'waves' => Icons.anchor,
    'coffee' || 'cup-soda' => Icons.local_cafe,
    'utensils' || 'fork-knife' || 'restaurant' => Icons.restaurant,
    'camera' || 'image' => Icons.photo_camera,
    'flag' || 'milestone' => Icons.flag,
    'compass' || 'navigation' => Icons.explore,
    'bike' || 'bicycle' => Icons.directions_bike,
    'footprints' || 'hiking' => Icons.hiking,
    'home' || 'house' || 'hut' || 'building' => Icons.home,
    'landmark' || 'castle' || 'church' => Icons.account_balance,
    'train' || 'train-front' || 'tram-front' => Icons.train,
    'bus' => Icons.directions_bus,
    'plane' => Icons.flight,
    'car' => Icons.directions_car,
    'droplet' || 'droplets' || 'water' => Icons.water_drop,
    'flame' || 'fire' => Icons.local_fire_department,
    'alert-triangle' || 'triangle-alert' || 'shield-alert' => Icons.warning_amber,
    'star' || 'sparkles' => Icons.star,
    'heart' => Icons.favorite,
    'info' => Icons.info_outline,
    'binoculars' || 'eye' => Icons.visibility,
    'hospital' || 'cross' || 'heart-pulse' => Icons.local_hospital,
    'bridge' || 'route' => Icons.route,
    'sun' => Icons.wb_sunny_outlined,
    'music' => Icons.music_note,
    'shopping-bag' || 'store' => Icons.shopping_bag_outlined,
    'book' || 'library' => Icons.menu_book_outlined,
    _ => Icons.place,
  };
}

/// Collects all visible LineString arrowheads (`arrowStart` / `arrowEnd`)
/// across Shelf maps, Active Story datasets, and the working draft.
List<MapArrowheadItem> collectVisibleArrowheads({
  required List<ShelfMapEntry> shelfMaps,
  required Color draftAccentColor,
  List<DrawnFeature> draftFeatures = const [],
  ActiveStoryRenderContext? activeStory,
}) {
  final out = <MapArrowheadItem>[];

  void emitLineArrows({
    required String keyPrefix,
    required List<Geographic> coords,
    required bool arrowStart,
    required bool arrowEnd,
    required Color color,
    required double strokeWidth,
  }) {
    if (coords.length < 2) return;
    if (arrowStart) {
      out.add(MapArrowheadItem(
        key: '$keyPrefix::start',
        tip: coords.first,
        from: coords[1],
        color: color,
        strokeWidth: strokeWidth,
      ));
    }
    if (arrowEnd) {
      out.add(MapArrowheadItem(
        key: '$keyPrefix::end',
        tip: coords.last,
        from: coords[coords.length - 2],
        color: color,
        strokeWidth: strokeWidth,
      ));
    }
  }

  void addShapes(
    ShelfMapEntry entry, {
    Set<String>? allowedFeatureIds,
  }) {
    for (var i = 0; i < entry.shapes.length; i++) {
      final shape = entry.shapes[i];
      if (shape.kind != ShelfShapeKind.line || shape.coords.length < 2) {
        continue;
      }
      if (allowedFeatureIds != null &&
          (shape.featureId == null ||
              !allowedFeatureIds.contains(shape.featureId))) {
        continue;
      }
      final aStart = shape.properties['arrowStart'] == true;
      final aEnd = shape.properties['arrowEnd'] == true;
      if (!aStart && !aEnd) continue;
      final color = _parseDartColor(
        shape.strokeColorHex ?? shape.colorHex,
        EarthlyColors.commentGreen,
      );
      emitLineArrows(
        keyPrefix: '${entry.summary.address}::${shape.featureId ?? i}',
        coords: shape.coords,
        arrowStart: aStart,
        arrowEnd: aEnd,
        color: color,
        strokeWidth: shape.strokeWidth ?? 3.0,
      );
    }
  }

  final storyManaged = activeStory != null
      ? activeStory.datasetsByAddress.keys.toSet()
      : const <String>{};
  for (final entry in shelfMaps) {
    if (!entry.visible || storyManaged.contains(entry.summary.address)) continue;
    addShapes(entry);
  }
  if (activeStory != null) {
    if (activeStory.presentationLayers.isNotEmpty) {
      for (final layer in activeStory.presentationLayers) {
        if (!layer.visible) continue;
        final ds = activeStory.datasetsByAddress[layer.sourceAddress];
        if (ds != null) addShapes(ds, allowedFeatureIds: layer.featureIds);
      }
    } else {
      for (final ds in activeStory.datasetsByAddress.values) {
        addShapes(ds);
      }
    }
  }
  for (final f in draftFeatures) {
    if (f.kind != DrawToolMode.line || f.vertices.length < 2) continue;
    if (!f.arrowStart && !f.arrowEnd) continue;
    final color = _parseDartColor(
      f.strokeColorHex ?? f.colorHex,
      draftAccentColor,
    );
    emitLineArrows(
      keyPrefix: 'draft::${f.id}',
      coords: f.vertices,
      arrowStart: f.arrowStart,
      arrowEnd: f.arrowEnd,
      color: color,
      strokeWidth: f.strokeWidth ?? 3.0,
    );
  }
  return out;
}

Color _parseDartColor(String? raw, Color fallback) {
  if (raw == null) return fallback;
  final trimmed = raw.trim();
  if (RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(trimmed)) {
    return Color(0xFF000000 | int.parse(trimmed.substring(1), radix: 16));
  }
  if (RegExp(r'^#[0-9a-fA-F]{3}$').hasMatch(trimmed)) {
    final r = trimmed[1];
    final g = trimmed[2];
    final b = trimmed[3];
    return Color(0xFF000000 | int.parse('$r$r$g$g$b$b', radix: 16));
  }
  return fallback;
}

/// Collects all visible Point features that specify `displayIcon` (`lucide:*`)
/// across Shelf maps, Active Story datasets, and the working draft.
List<MapIconPinItem> collectVisibleIconPins({
  required List<ShelfMapEntry> shelfMaps,
  required Color draftAccentColor,
  List<DrawnFeature> draftFeatures = const [],
  ActiveStoryRenderContext? activeStory,
}) {
  final out = <MapIconPinItem>[];
  final seen = <String>{};

  void addShapes(
    ShelfMapEntry entry,
    String sourcePrefix, {
    Set<String>? allowedFeatureIds,
  }) {
    for (final shape in entry.shapes) {
      if (shape.kind != ShelfShapeKind.point ||
          shape.coords.isEmpty ||
          shape.displayIcon == null ||
          shape.displayIcon!.trim().isEmpty) {
        continue;
      }
      if (allowedFeatureIds != null &&
          (shape.featureId == null ||
              !allowedFeatureIds.contains(shape.featureId))) {
        continue;
      }
      final key = '${entry.summary.address}::${shape.featureId ?? shape.coords.first}';
      if (!seen.add(key)) continue;
      final fill = _parseDartColor(
        shape.fillColorHex ?? shape.colorHex,
        EarthlyColors.commentGreen,
      );
      final ring = _parseDartColor(
        shape.properties['strokeColor'] as String?,
        Colors.white,
      );
      out.add(
        MapIconPinItem(
          key: key,
          position: shape.coords.first,
          iconName: shape.displayIcon!,
          fillColor: fill,
          ringColor: ring,
          inspectedFeature: InspectedFeature(
            sourceLabel: '$sourcePrefix · ${entry.summary.title}',
            isDraft: false,
            geometryType: 'Point',
            featureId: shape.featureId,
            title: shape.label ?? entry.summary.title,
            properties: shape.properties,
            callouts: shape.callouts,
            datasetAddress: entry.summary.address,
            datasetPubkey: entry.summary.pubkey,
            datasetTitle: entry.summary.title,
            datasetEventId: entry.summary.eventId,
            datasetGeojson: entry.summary.geojson,
          ),
        ),
      );
    }
  }

  final storyManaged = activeStory != null
      ? activeStory.datasetsByAddress.keys.toSet()
      : const <String>{};
  for (final entry in shelfMaps) {
    if (!entry.visible || storyManaged.contains(entry.summary.address)) continue;
    addShapes(entry, 'Published');
  }
  if (activeStory != null) {
    if (activeStory.presentationLayers.isNotEmpty) {
      for (final layer in activeStory.presentationLayers) {
        if (!layer.visible) continue;
        final ds = activeStory.datasetsByAddress[layer.sourceAddress];
        if (ds != null) {
          addShapes(ds, 'Story', allowedFeatureIds: layer.featureIds);
        }
      }
    } else {
      for (final ds in activeStory.datasetsByAddress.values) {
        addShapes(ds, 'Story');
      }
    }
  }
  for (final f in draftFeatures) {
    if (f.kind != DrawToolMode.point ||
        f.vertices.isEmpty ||
        f.displayIcon == null ||
        f.displayIcon!.trim().isEmpty) {
      continue;
    }
    final fill = _parseDartColor(f.colorHex, draftAccentColor);
    out.add(
      MapIconPinItem(
        key: 'draft::${f.id}',
        position: f.vertices.first,
        iconName: f.displayIcon!,
        fillColor: fill,
        ringColor: Colors.white,
        inspectedFeature: InspectedFeature(
          sourceLabel: 'Working draft',
          isDraft: true,
          draftFeatureId: f.id,
          geometryType: 'Point',
          title: f.name ?? 'Draft Point',
          properties: {
            'id': f.id,
            'displayIcon': f.displayIcon!,
            if (f.colorHex != null) 'color': f.colorHex!,
            if (f.radius != null) 'radius': f.radius!,
          },
        ),
      ),
    );
  }
  return out;
}

/// Active Story map presentation state applied over loaded datasets.
@immutable
class ActiveStoryRenderContext {
  const ActiveStoryRenderContext({
    required this.story,
    required this.datasetsByAddress,
    this.presentationLayers = const [],
    this.focusedDatasetAddress,
    this.focusedFeatureId,
    this.geoPins = const [],
  });

  final StorySummaryDto story;
  final Map<String, ShelfMapEntry> datasetsByAddress;
  final List<StoryPresentationLayer> presentationLayers;
  final String? focusedDatasetAddress;
  final String? focusedFeatureId;
  final List<GeoPinOverlayItem> geoPins;
}

@immutable
class ShelfMapEntry {
  const ShelfMapEntry({
    required this.summary,
    required this.visible,
    required this.shapes,
  });

  final MapSummaryDto summary;
  final bool visible;
  final List<ShelfShape> shapes;

  ShelfMapEntry copyWith({bool? visible}) => ShelfMapEntry(
        summary: summary,
        visible: visible ?? this.visible,
        shapes: shapes,
      );
}

enum ShelfShapeKind { point, line, polygon }

@immutable
class ShelfShape {
  const ShelfShape({
    required this.kind,
    required this.coords,
    required this.anchor,
    this.featureId,
    this.colorHex,
    this.fillColorHex,
    this.strokeColorHex,
    this.strokeWidth,
    this.fillOpacity,
    this.radius,
    this.label,
    this.displayIcon,
    this.callouts = const [],
    this.properties = const {},
  });

  final ShelfShapeKind kind;
  final List<Geographic> coords;
  final Geographic anchor;
  final String? featureId;
  final String? colorHex;
  final String? fillColorHex;
  final String? strokeColorHex;
  final double? strokeWidth;
  final double? fillOpacity;
  final double? radius;
  final String? label;
  final String? displayIcon;
  final List<MapCalloutItem> callouts;
  final Map<String, Object?> properties;
}

/// Parses a GeoJSON FeatureCollection string into renderable shapes, labels,
/// style properties, and authored `earthly:callouts` (`SPEC.md` §1.7–§1.8).
List<ShelfShape> parseGeoJsonShapes(
  String geojsonText, {
  String datasetTitle = 'Map',
  String datasetAddress = '',
}) {
  try {
    final decoded = jsonDecode(geojsonText);
    if (decoded is! Map<String, dynamic>) return const [];
    final features = decoded['features'];
    if (features is! List) return const [];
    final out = <ShelfShape>[];
    var idx = 0;
    for (final item in features) {
      if (item is! Map<String, dynamic>) continue;
      idx += 1;
      final featureId = item['id']?.toString();
      final props = (item['properties'] as Map<String, dynamic>?) ?? const {};
      final colorHex = _sanitizeCssColor(props['color'] as String?);
      final fillColorHex =
          _sanitizeCssColor((props['fillColor'] ?? props['color']) as String?);
      final rawStrokeHex = _sanitizeCssColor(props['strokeColor'] as String?);
      final strokeColorHex = rawStrokeHex ?? colorHex;
      final pointFillHex = colorHex ?? fillColorHex;
      final strokeWidth = (props['strokeWidth'] is num)
          ? (props['strokeWidth'] as num).toDouble().clamp(0.5, 16.0)
          : null;
      final fillOpacity = (props['fillOpacity'] is num)
          ? (props['fillOpacity'] as num).toDouble().clamp(0.0, 1.0)
          : null;
      final radius = (props['radius'] is num)
          ? (props['radius'] as num).toDouble().clamp(3.0, 24.0)
          : null;
      final rawLabel =
          (props['label'] ?? props['name'] ?? props['title']) as String?;
      final label =
          (rawLabel != null && rawLabel.trim().isNotEmpty) ? rawLabel.trim() : null;
      final displayIcon = props['displayIcon'] as String?;
      final geom = item['geometry'] as Map<String, dynamic>?;
      if (geom == null) continue;
      _extractGeometry(
        geom: geom,
        featureId: featureId ?? 'f-$idx',
        datasetTitle: datasetTitle,
        datasetAddress: datasetAddress,
        colorHex: pointFillHex ?? strokeColorHex,
        fillColorHex: fillColorHex,
        strokeColorHex: strokeColorHex,
        strokeWidth: strokeWidth,
        fillOpacity: fillOpacity,
        radius: radius,
        label: label,
        displayIcon: displayIcon,
        props: props,
        out: out,
      );
    }
    return out;
  } catch (_) {
    return const [];
  }
}

const Set<String> _reservedFeaturePropKeys = <String>{
  'name',
  'label',
  'title',
  'description',
  'color',
  'fillColor',
  'strokeColor',
  'strokeWidth',
  'fillOpacity',
  'radius',
  'lineDash',
  'arrowStart',
  'arrowEnd',
  'displayIcon',
  'earthly:callouts',
  'id',
  'vertices',
  'lat',
  'lon',
};

/// Serializes local working draft features into an RFC 7946 FeatureCollection JSON.
String draftFeaturesToGeoJson({
  required String title,
  required List<DrawnFeature> features,
}) {
  final jsonFeatures = <Map<String, Object?>>[];
  for (final f in features) {
    if (f.vertices.isEmpty) continue;
    Map<String, Object?>? geometry;
    switch (f.kind) {
      case DrawToolMode.point:
        if (f.isMultipart) {
          final pts = [
            for (final part in f.allParts)
              if (part.isNotEmpty) [part.first.lon, part.first.lat],
          ];
          if (pts.isEmpty) continue;
          geometry = {'type': 'MultiPoint', 'coordinates': pts};
        } else {
          geometry = {
            'type': 'Point',
            'coordinates': [f.vertices.first.lon, f.vertices.first.lat],
          };
        }
      case DrawToolMode.line:
        if (f.isMultipart) {
          final lines = [
            for (final part in f.allParts)
              if (part.length >= 2) part.map((v) => [v.lon, v.lat]).toList(),
          ];
          if (lines.isEmpty) continue;
          geometry = {'type': 'MultiLineString', 'coordinates': lines};
        } else {
          if (f.vertices.length < 2) continue;
          geometry = {
            'type': 'LineString',
            'coordinates': f.vertices.map((v) => [v.lon, v.lat]).toList(),
          };
        }
      case DrawToolMode.polygon:
        List<List<double>> closeRing(List<Geographic> verts) {
          final ring = verts.map((v) => [v.lon, v.lat]).toList();
          final first = ring.first;
          final last = ring.last;
          if (first[0] != last[0] || first[1] != last[1]) {
            ring.add([first[0], first[1]]);
          }
          return ring;
        }
        if (f.isMultipart) {
          final polys = [
            for (final part in f.allParts)
              if (part.length >= 3) [closeRing(part)],
          ];
          if (polys.isEmpty) continue;
          geometry = {'type': 'MultiPolygon', 'coordinates': polys};
        } else {
          if (f.vertices.length < 3) continue;
          geometry = {
            'type': 'Polygon',
            'coordinates': [closeRing(f.vertices)],
          };
        }
      default:
        continue;
    }
    final props = <String, Object?>{
      for (final entry in f.customProperties.entries)
        if (!_reservedFeaturePropKeys.contains(entry.key) &&
            entry.key.trim().isNotEmpty)
          entry.key.trim(): entry.value,
      'name': ?f.name,
      'description': ?f.description,
      'color': ?f.colorHex,
      'fillColor': ?f.fillColorHex,
      'strokeColor': ?f.strokeColorHex,
      'strokeWidth': ?f.strokeWidth,
      'fillOpacity': ?f.fillOpacity,
      'radius': ?f.radius,
      'lineDash': ?f.lineDash,
      if (f.arrowStart) 'arrowStart': true,
      if (f.arrowEnd) 'arrowEnd': true,
      'displayIcon': ?f.displayIcon,
      if (f.callouts.isNotEmpty)
        'earthly:callouts': [
          for (final c in f.callouts)
            {
              'id': c.id,
              'title': ?c.title,
              'text': c.text,
              if (c.mediaUrls.isNotEmpty)
                'media': [
                  for (final url in c.mediaUrls) {'type': 'image', 'url': url},
                ],
              'placement': {
                'side': c.side,
                if (c.offsetX != 0.0 || c.offsetY != 0.0)
                  'offset': [c.offsetX, c.offsetY],
                'leader': 'line',
              },
            },
        ],
    };
    jsonFeatures.add({
      'type': 'Feature',
      'id': f.id,
      'geometry': geometry,
      'properties': props,
    });
  }
  return jsonEncode({
    'type': 'FeatureCollection',
    'name': title,
    'features': jsonFeatures,
  });
}

/// Restores working draft features from a persisted SQLite GeoJSON string.
List<DrawnFeature> parseDraftFeaturesFromGeoJson(String geojsonText) {
  try {
    final decoded = jsonDecode(geojsonText);
    if (decoded is! Map<String, dynamic>) return const [];
    final features = decoded['features'];
    if (features is! List) return const [];
    final out = <DrawnFeature>[];
    var idx = 0;
    for (final item in features) {
      if (item is! Map<String, dynamic>) continue;
      idx += 1;
      final id = (item['id']?.toString().isNotEmpty ?? false)
          ? item['id'].toString()
          : 'draft-$idx';
      final props = (item['properties'] as Map<String, dynamic>?) ?? const {};
      final name = (props['name'] ?? props['label']) as String?;
      final description = props['description'] as String?;
      final colorHex = _sanitizeCssColor(props['color'] as String?);
      final fillColorHex = _sanitizeCssColor(props['fillColor'] as String?);
      final strokeColorHex = _sanitizeCssColor(props['strokeColor'] as String?);
      final strokeWidth = (props['strokeWidth'] is num)
          ? (props['strokeWidth'] as num).toDouble().clamp(1.0, 12.0)
          : null;
      final fillOpacity = (props['fillOpacity'] is num)
          ? (props['fillOpacity'] as num).toDouble().clamp(0.05, 1.0)
          : null;
      final radius = (props['radius'] is num)
          ? (props['radius'] as num).toDouble().clamp(3.0, 20.0)
          : null;
      final rawDash = props['lineDash'] as String?;
      final lineDash = (rawDash == 'dashed' || rawDash == 'dotted' || rawDash == 'solid')
          ? rawDash
          : null;
      final arrowStart = props['arrowStart'] == true;
      final arrowEnd = props['arrowEnd'] == true;
      final displayIcon = (props['displayIcon'] as String?)?.trim();
      final draftCallouts = _parseDraftCallouts(props);
      final customProperties = <String, String>{};
      for (final e in props.entries) {
        if (_reservedFeaturePropKeys.contains(e.key)) continue;
        final v = e.value;
        if (v is String || v is num || v is bool) {
          customProperties[e.key] = v.toString();
        }
      }
      final geom = item['geometry'] as Map<String, dynamic>?;
      if (geom == null) continue;
      final type = geom['type'] as String?;
      final coords = geom['coordinates'];
      if (type == 'Point') {
        final pt = _parseCoord(coords);
        if (pt != null) {
          out.add(DrawnFeature(
            id: id,
            kind: DrawToolMode.point,
            vertices: [pt],
            name: name,
            description: description,
            colorHex: colorHex,
            fillColorHex: fillColorHex,
            strokeColorHex: strokeColorHex,
            radius: radius,
            displayIcon: (displayIcon != null && displayIcon.isNotEmpty)
                ? displayIcon
                : null,
            callouts: draftCallouts,
            customProperties: customProperties,
          ));
        }
      } else if (type == 'MultiPoint' && coords is List) {
        final parts = <List<Geographic>>[
          for (final item in coords)
            if (_parseCoord(item) case final pt?) [pt],
        ];
        if (parts.isNotEmpty) {
          out.add(DrawnFeature(
            id: id,
            kind: DrawToolMode.point,
            vertices: parts.first,
            extraParts: parts.skip(1).toList(),
            name: name,
            description: description,
            colorHex: colorHex,
            fillColorHex: fillColorHex,
            strokeColorHex: strokeColorHex,
            radius: radius,
            displayIcon: (displayIcon != null && displayIcon.isNotEmpty)
                ? displayIcon
                : null,
            callouts: draftCallouts,
            customProperties: customProperties,
          ));
        }
      } else if (type == 'LineString') {
        final pts = _parseCoordList(coords);
        if (pts.length >= 2) {
          out.add(DrawnFeature(
            id: id,
            kind: DrawToolMode.line,
            vertices: pts,
            name: name,
            description: description,
            colorHex: colorHex,
            strokeColorHex: strokeColorHex,
            strokeWidth: strokeWidth,
            lineDash: lineDash,
            arrowStart: arrowStart,
            arrowEnd: arrowEnd,
            callouts: draftCallouts,
            customProperties: customProperties,
          ));
        }
      } else if (type == 'MultiLineString' && coords is List) {
        final parts = <List<Geographic>>[
          for (final item in coords)
            if (_parseCoordList(item) case final pts when pts.length >= 2) pts,
        ];
        if (parts.isNotEmpty) {
          out.add(DrawnFeature(
            id: id,
            kind: DrawToolMode.line,
            vertices: parts.first,
            extraParts: parts.skip(1).toList(),
            name: name,
            description: description,
            colorHex: colorHex,
            strokeColorHex: strokeColorHex,
            strokeWidth: strokeWidth,
            lineDash: lineDash,
            arrowStart: arrowStart,
            arrowEnd: arrowEnd,
            callouts: draftCallouts,
            customProperties: customProperties,
          ));
        }
      } else if (type == 'Polygon' && coords is List && coords.isNotEmpty) {
        final ring = _parseCoordList(coords.first);
        if (ring.length >= 3) {
          final trimmed = (ring.length > 3 &&
                  ring.first.lon == ring.last.lon &&
                  ring.first.lat == ring.last.lat)
              ? ring.sublist(0, ring.length - 1)
              : ring;
          out.add(DrawnFeature(
            id: id,
            kind: DrawToolMode.polygon,
            vertices: trimmed,
            name: name,
            description: description,
            colorHex: colorHex,
            fillColorHex: fillColorHex,
            strokeColorHex: strokeColorHex,
            strokeWidth: strokeWidth,
            fillOpacity: fillOpacity,
            callouts: draftCallouts,
            customProperties: customProperties,
          ));
        }
      } else if (type == 'MultiPolygon' && coords is List) {
        final parts = <List<Geographic>>[];
        for (final poly in coords) {
          if (poly is List && poly.isNotEmpty) {
            final ring = _parseCoordList(poly.first);
            if (ring.length >= 3) {
              final trimmed = (ring.length > 3 &&
                      ring.first.lon == ring.last.lon &&
                      ring.first.lat == ring.last.lat)
                  ? ring.sublist(0, ring.length - 1)
                  : ring;
              parts.add(trimmed);
            }
          }
        }
        if (parts.isNotEmpty) {
          out.add(DrawnFeature(
            id: id,
            kind: DrawToolMode.polygon,
            vertices: parts.first,
            extraParts: parts.skip(1).toList(),
            name: name,
            description: description,
            colorHex: colorHex,
            fillColorHex: fillColorHex,
            strokeColorHex: strokeColorHex,
            strokeWidth: strokeWidth,
            fillOpacity: fillOpacity,
            callouts: draftCallouts,
            customProperties: customProperties,
          ));
        }
      }
    }
    return out;
  } catch (_) {
    return const [];
  }
}

/// Collects all visible authored `earthly:callouts` across active Shelf maps,
/// active Story datasets, and local working-draft features.
List<MapCalloutItem> collectVisibleCallouts({
  required List<ShelfMapEntry> shelfMaps,
  List<DrawnFeature> draftFeatures = const [],
  ActiveStoryRenderContext? activeStory,
}) {
  final out = <MapCalloutItem>[];
  final seenKeys = <String>{};

  void addShapes(
    String sourceLabel,
    List<ShelfShape> shapes, {
    Set<String>? allowedFeatureIds,
  }) {
    for (final shape in shapes) {
      if (allowedFeatureIds != null &&
          (shape.featureId == null ||
              !allowedFeatureIds.contains(shape.featureId))) {
        continue;
      }
      for (final callout in shape.callouts) {
        if (!seenKeys.add(callout.key)) continue;
        out.add(
          MapCalloutItem(
            key: callout.key,
            id: callout.id,
            text: callout.text,
            anchor: callout.anchor,
            datasetTitle: callout.datasetTitle,
            featureId: callout.featureId,
            featureLabel: callout.featureLabel,
            title: callout.title,
            mediaUrls: callout.mediaUrls,
            preferredSide: callout.preferredSide,
            offset: callout.offset,
            showLeader: callout.showLeader,
            accentColorHex: callout.accentColorHex,
            inspectedFeature: InspectedFeature(
              sourceLabel: sourceLabel,
              isDraft: false,
              geometryType: switch (shape.kind) {
                ShelfShapeKind.point => 'Point',
                ShelfShapeKind.line => 'LineString',
                ShelfShapeKind.polygon => 'Polygon',
              },
              featureId: shape.featureId,
              title: shape.label ?? callout.title ?? callout.datasetTitle,
              properties: shape.properties,
              callouts: shape.callouts,
            ),
          ),
        );
      }
    }
  }

  for (final entry in shelfMaps) {
    if (!entry.visible) continue;
    addShapes('Published · ${entry.summary.title}', entry.shapes);
  }

  if (activeStory != null) {
    if (activeStory.presentationLayers.isNotEmpty) {
      for (final layer in activeStory.presentationLayers) {
        if (!layer.visible) continue;
        final dataset = activeStory.datasetsByAddress[layer.sourceAddress];
        if (dataset == null) continue;
        addShapes(
          'Story · ${dataset.summary.title}',
          dataset.shapes,
          allowedFeatureIds: layer.featureIds,
        );
      }
    } else {
      for (final dataset in activeStory.datasetsByAddress.values) {
        addShapes('Story · ${dataset.summary.title}', dataset.shapes);
      }
    }
  }

  for (final f in draftFeatures) {
    if (f.callouts.isEmpty || f.vertices.isEmpty) continue;
    final anchor = _representativeAnchor(
      switch (f.kind) {
        DrawToolMode.point => ShelfShapeKind.point,
        DrawToolMode.line => ShelfShapeKind.line,
        DrawToolMode.polygon => ShelfShapeKind.polygon,
        _ => ShelfShapeKind.point,
      },
      f.vertices,
    );
    final calloutItems = [
      for (final c in f.callouts)
        MapCalloutItem(
          key: 'draft::${f.id}::${c.id}',
          id: c.id,
          text: c.text,
          anchor: anchor,
          datasetTitle: 'Working draft',
          featureId: f.id,
          featureLabel: f.name ?? 'Draft feature',
          title: c.title,
          mediaUrls: c.mediaUrls,
          preferredSide: c.side,
          offset: Offset(c.offsetX, c.offsetY),
          showLeader: true,
          accentColorHex: f.strokeColorHex ?? f.colorHex,
        ),
    ];
    final inspected = InspectedFeature(
      sourceLabel: 'Working draft',
      isDraft: true,
      draftFeatureId: f.id,
      geometryType: switch (f.kind) {
        DrawToolMode.point => 'Point',
        DrawToolMode.line => 'LineString',
        DrawToolMode.polygon => 'Polygon',
        _ => 'Point',
      },
      title: f.name ?? 'Draft Feature',
      properties: {
        ...f.customProperties,
        'id': f.id,
        'vertices': f.vertices.length,
        if (f.description != null && f.description!.isNotEmpty)
          'description': f.description!,
        if (f.colorHex != null) 'color': f.colorHex!,
        if (f.fillColorHex != null) 'fillColor': f.fillColorHex!,
        if (f.strokeColorHex != null) 'strokeColor': f.strokeColorHex!,
        if (f.strokeWidth != null) 'strokeWidth': f.strokeWidth!,
        if (f.fillOpacity != null) 'fillOpacity': f.fillOpacity!,
        if (f.radius != null) 'radius': f.radius!,
        if (f.lineDash != null) 'lineDash': f.lineDash!,
        if (f.arrowStart) 'arrowStart': true,
        if (f.arrowEnd) 'arrowEnd': true,
        if (f.displayIcon != null) 'displayIcon': f.displayIcon!,
      },
      callouts: calloutItems,
    );
    for (final c in calloutItems) {
      if (!seenKeys.add(c.key)) continue;
      out.add(
        MapCalloutItem(
          key: c.key,
          id: c.id,
          text: c.text,
          anchor: c.anchor,
          datasetTitle: c.datasetTitle,
          featureId: c.featureId,
          featureLabel: c.featureLabel,
          title: c.title,
          mediaUrls: c.mediaUrls,
          preferredSide: c.preferredSide,
          offset: c.offset,
          showLeader: true,
          accentColorHex: c.accentColorHex,
          inspectedFeature: inspected,
        ),
      );
    }
  }

  return out;
}

/// Computes the combined geographic bounds of a set of Shelf maps (e.g. all
/// datasets linked to a Story or Atlas).
GeoBox? computeCombinedBounds(Iterable<ShelfMapEntry> entries) {
  double? west;
  double? south;
  double? east;
  double? north;

  void include(double lon, double lat) {
    west = west == null ? lon : math.min(west!, lon);
    south = south == null ? lat : math.min(south!, lat);
    east = east == null ? lon : math.max(east!, lon);
    north = north == null ? lat : math.max(north!, lat);
  }

  for (final entry in entries) {
    final s = entry.summary;
    if (s.west != null && s.south != null && s.east != null && s.north != null) {
      include(s.west!, s.south!);
      include(s.east!, s.north!);
      continue;
    }
    for (final shape in entry.shapes) {
      for (final c in shape.coords) {
        include(c.lon, c.lat);
      }
    }
  }
  if (west == null || south == null || east == null || north == null) {
    return null;
  }
  // Avoid degenerate zero-area bounds on single-point maps.
  const pad = 0.002;
  if ((east! - west!).abs() < 1e-6 && (north! - south!).abs() < 1e-6) {
    return GeoBox(
      west: (west! - pad).clamp(-180.0, 180.0),
      south: (south! - pad).clamp(-85.0, 85.0),
      east: (east! + pad).clamp(-180.0, 180.0),
      north: (north! + pad).clamp(-85.0, 85.0),
    );
  }
  return GeoBox(west: west!, south: south!, east: east!, north: north!);
}

/// Computes the bounding box of a single specific feature (for Story inline
/// `nostr:naddr1...#featureId` focus & fly-to).
GeoBox? computeFeatureBounds(ShelfShape shape) {
  if (shape.coords.isEmpty) return null;
  double west = shape.coords.first.lon;
  double south = shape.coords.first.lat;
  double east = shape.coords.first.lon;
  double north = shape.coords.first.lat;
  for (final c in shape.coords) {
    west = math.min(west, c.lon);
    south = math.min(south, c.lat);
    east = math.max(east, c.lon);
    north = math.max(north, c.lat);
  }
  const pad = 0.0012;
  if ((east - west).abs() < 1e-6 && (north - south).abs() < 1e-6) {
    return GeoBox(
      west: (west - pad).clamp(-180.0, 180.0),
      south: (south - pad).clamp(-85.0, 85.0),
      east: (east + pad).clamp(-180.0, 180.0),
      north: (north + pad).clamp(-85.0, 85.0),
    );
  }
  return GeoBox(west: west, south: south, east: east, north: north);
}

Expression<num> _safeNumberProp(String property, double fallback) =>
    Expression.coalesce<Object?>([
      Expression.get(property),
      Expression.literal(fallback),
    ]).convertToNumber([Expression.literal(fallback)]);

Expression<Color> _safeColorProp(String property, Color fallback) =>
    Expression.coalesce<Object?>([
      Expression.get(property),
      Expression.literal(fallback),
    ]).convertToColor([Expression.literal(fallback)]);

/// Builds MapLibre Native GPU layers for all Shelf maps, active Story datasets
/// (with presentation overrides + focused feature highlight), Sightings,
/// committed working draft features, and collision-free GPU feature labels.
List<Layer> buildEarthlyGpuLayers({
  required List<ShelfMapEntry> shelfMaps,
  required List<SightingSummaryDto> sightings,
  required List<DrawnFeature> draftFeatures,
  required Color accentColor,
  required bool isDarkMap,
  required bool showLabels,
  required ValueChanged<InspectedFeature> onInspectFeature,
  List<LiveBeaconDto> beacons = const [],
  List<Geographic> measurePoints = const [],
  List<Geographic> gpsTrackPoints = const [],
  ActiveStoryRenderContext? activeStory,
  List<ShelfShape> commentOverlayShapes = const [],
  List<ShelfShape> proposalOverlayShapes = const [],
  Set<String> selectedDraftFeatureIds = const <String>{},
}) {
  final shelfPolygons = <Feature<Polygon>>[];
  final shelfLines = <Feature<LineString>>[];
  final shelfDashedLines = <Feature<LineString>>[];
  final shelfDottedLines = <Feature<LineString>>[];
  final shelfPoints = <Feature<Point>>[];
  final labelPoints = <Feature<Point>>[];

  final shelfPolyMeta = <InspectedFeature>[];
  final shelfLineMeta = <InspectedFeature>[];
  final shelfDashedLineMeta = <InspectedFeature>[];
  final shelfDottedLineMeta = <InspectedFeature>[];
  final shelfPointMeta = <InspectedFeature>[];

  final focusedPolygons = <Feature<Polygon>>[];
  final focusedLines = <Feature<LineString>>[];
  final focusedPoints = <Feature<Point>>[];

  void emitDataset({
    required ShelfMapEntry entry,
    required String sourcePrefix,
    Set<String>? allowedFeatureIds,
    StoryLayerStyleOverride? styleOverride,
    bool checkFocus = false,
  }) {
    final isFocusedDataset = checkFocus &&
        activeStory?.focusedDatasetAddress == entry.summary.address;
    final focusedFeatureId = activeStory?.focusedFeatureId;

    for (final shape in entry.shapes) {
      if (allowedFeatureIds != null &&
          (shape.featureId == null ||
              !allowedFeatureIds.contains(shape.featureId))) {
        continue;
      }

      final fillHex = _sanitizeCssColor(
            styleOverride?.fillColor ?? styleOverride?.color,
          ) ??
          shape.fillColorHex ??
          shape.colorHex;
      final strokeHex = _sanitizeCssColor(
            styleOverride?.strokeColor ?? styleOverride?.color,
          ) ??
          shape.strokeColorHex ??
          shape.colorHex;
      // On Points, `color` / `fillColor` is the backing disc fill and
      // `strokeColor` is the outer ring (defaulting to crisp white).
      final explicitPointRingHex = _sanitizeCssColor(styleOverride?.strokeColor) ??
          _sanitizeCssColor(shape.properties['strokeColor'] as String?);

      final props = <String, Object?>{
        'fillColor': ?fillHex,
        'color': ?strokeHex,
        'pointStroke': ?explicitPointRingHex,
        'strokeWidth': ?shape.strokeWidth,
        'fillOpacity': ?shape.fillOpacity,
        'radius': ?shape.radius,
        'title': ?shape.label,
      };

      final isFocusedShape = isFocusedDataset &&
          (focusedFeatureId == null || focusedFeatureId == shape.featureId);

      if (showLabels && shape.label != null && shape.label!.isNotEmpty) {
        labelPoints.add(
          Feature(
            geometry: Point(shape.anchor),
            properties: {'label': shape.label!},
          ),
        );
      }

      switch (shape.kind) {
        case ShelfShapeKind.polygon:
          final ring = _ensureClosedRing(shape.coords);
          if (ring.length < 4) continue;
          final polyFeature =
              Feature(geometry: Polygon.from([ring]), properties: props);
          shelfPolygons.add(polyFeature);
          if (isFocusedShape) focusedPolygons.add(polyFeature);
          shelfPolyMeta.add(InspectedFeature(
            sourceLabel: '$sourcePrefix · ${entry.summary.title}',
            isDraft: false,
            geometryType: 'Polygon',
            featureId: shape.featureId,
            title: shape.label ?? entry.summary.title,
            properties: shape.properties,
            callouts: shape.callouts,
            datasetAddress: entry.summary.address,
            datasetPubkey: entry.summary.pubkey,
            datasetTitle: entry.summary.title,
            datasetEventId: entry.summary.eventId,
            datasetGeojson: entry.summary.geojson,
          ));
        case ShelfShapeKind.line:
          if (shape.coords.length < 2) continue;
          final lineFeature =
              Feature(geometry: LineString.from(shape.coords), properties: props);
          final lineMeta = InspectedFeature(
            sourceLabel: '$sourcePrefix · ${entry.summary.title}',
            isDraft: false,
            geometryType: 'LineString',
            featureId: shape.featureId,
            title: shape.label ?? entry.summary.title,
            properties: shape.properties,
            lengthMeters: _polylineLengthMeters(shape.coords),
            callouts: shape.callouts,
            datasetAddress: entry.summary.address,
            datasetPubkey: entry.summary.pubkey,
            datasetTitle: entry.summary.title,
            datasetEventId: entry.summary.eventId,
            datasetGeojson: entry.summary.geojson,
          );
          final dash = shape.properties['lineDash'] as String?;
          if (dash == 'dashed') {
            shelfDashedLines.add(lineFeature);
            shelfDashedLineMeta.add(lineMeta);
          } else if (dash == 'dotted') {
            shelfDottedLines.add(lineFeature);
            shelfDottedLineMeta.add(lineMeta);
          } else {
            shelfLines.add(lineFeature);
            shelfLineMeta.add(lineMeta);
          }
          if (isFocusedShape) focusedLines.add(lineFeature);
        case ShelfShapeKind.point:
          if (shape.coords.isEmpty) continue;
          final ptFeature =
              Feature(geometry: Point(shape.coords.first), properties: props);
          shelfPoints.add(ptFeature);
          if (isFocusedShape) focusedPoints.add(ptFeature);
          shelfPointMeta.add(InspectedFeature(
            sourceLabel: '$sourcePrefix · ${entry.summary.title}',
            isDraft: false,
            geometryType: 'Point',
            featureId: shape.featureId,
            title: shape.label ?? entry.summary.title,
            properties: shape.properties,
            callouts: shape.callouts,
            datasetAddress: entry.summary.address,
            datasetPubkey: entry.summary.pubkey,
            datasetTitle: entry.summary.title,
            datasetEventId: entry.summary.eventId,
            datasetGeojson: entry.summary.geojson,
          ));
      }
    }
  }

  // 1. Emit Shelf datasets (skipping duplicates that are actively managed by Story presentation)
  final storyManagedAddresses = activeStory != null
      ? activeStory.datasetsByAddress.keys.toSet()
      : const <String>{};
  for (final entry in shelfMaps) {
    if (!entry.visible) continue;
    if (storyManagedAddresses.contains(entry.summary.address)) continue;
    emitDataset(entry: entry, sourcePrefix: 'Published');
  }

  // 2. Emit Active Story datasets (honoring presentation layer order, visibility, featureIds & style overrides)
  if (activeStory != null) {
    if (activeStory.presentationLayers.isNotEmpty) {
      final emitted = <String>{};
      for (final layer in activeStory.presentationLayers) {
        emitted.add(layer.sourceAddress);
        if (!layer.visible) continue;
        final dataset = activeStory.datasetsByAddress[layer.sourceAddress];
        if (dataset == null) continue;
        emitDataset(
          entry: dataset,
          sourcePrefix: 'Story',
          allowedFeatureIds: layer.featureIds,
          styleOverride: layer.style,
          checkFocus: true,
        );
      }
      // Also render any inline-referenced datasets not listed in presentation.layers.
      for (final entry in activeStory.datasetsByAddress.entries) {
        if (emitted.contains(entry.key)) continue;
        emitDataset(
          entry: entry.value,
          sourcePrefix: 'Story',
          checkFocus: true,
        );
      }
    } else {
      for (final dataset in activeStory.datasetsByAddress.values) {
        emitDataset(
          entry: dataset,
          sourcePrefix: 'Story',
          checkFocus: true,
        );
      }
    }
  }

  // 3. Working Draft features
  final draftPolygons = <Feature<Polygon>>[];
  final draftLines = <Feature<LineString>>[];
  final draftDashedLines = <Feature<LineString>>[];
  final draftDottedLines = <Feature<LineString>>[];
  final draftPoints = <Feature<Point>>[];

  final selectedDraftPolygons = <Feature<Polygon>>[];
  final selectedDraftLines = <Feature<LineString>>[];
  final selectedDraftPoints = <Feature<Point>>[];

  final draftPolyMeta = <InspectedFeature>[];
  final draftLineMeta = <InspectedFeature>[];
  final draftDashedLineMeta = <InspectedFeature>[];
  final draftDottedLineMeta = <InspectedFeature>[];
  final draftPointMeta = <InspectedFeature>[];

  for (final f in draftFeatures) {
    final isSelected = selectedDraftFeatureIds.contains(f.id);
    final anchor = f.vertices.isEmpty
        ? const Geographic(lon: 0, lat: 0)
        : _representativeAnchor(
            switch (f.kind) {
              DrawToolMode.point => ShelfShapeKind.point,
              DrawToolMode.line => ShelfShapeKind.line,
              DrawToolMode.polygon => ShelfShapeKind.polygon,
              _ => ShelfShapeKind.point,
            },
            f.vertices,
          );
    final draftCalloutItems = [
      for (final c in f.callouts)
        MapCalloutItem(
          key: 'draft::${f.id}::${c.id}',
          id: c.id,
          text: c.text,
          anchor: anchor,
          datasetTitle: 'Working draft',
          featureId: f.id,
          featureLabel: f.name,
          title: c.title,
          mediaUrls: c.mediaUrls,
          preferredSide: c.side,
          offset: Offset(c.offsetX, c.offsetY),
          accentColorHex: f.strokeColorHex ?? f.colorHex,
        ),
    ];

    if (showLabels && f.name != null && f.name!.trim().isNotEmpty && f.vertices.isNotEmpty) {
      labelPoints.add(
        Feature(
          geometry: Point(anchor),
          properties: {'label': f.name!.trim()},
        ),
      );
    }

    final effectiveFillHex = f.fillColorHex ?? f.colorHex;
    final effectiveStrokeHex = f.strokeColorHex ?? f.colorHex;
    final draftProps = <String, Object?>{
      'fillColor': ?effectiveFillHex,
      'color': ?effectiveStrokeHex,
      'pointStroke': ?f.strokeColorHex,
      'strokeWidth': ?f.strokeWidth,
      'fillOpacity': ?f.fillOpacity,
      'radius': ?f.radius,
    };
    switch (f.kind) {
      case DrawToolMode.polygon:
        double totalPerim = 0;
        var addedAnyPoly = false;
        for (var pIdx = 0; pIdx < f.allParts.length; pIdx++) {
          final ring = _ensureClosedRing(f.allParts[pIdx]);
          if (ring.length < 4) continue;
          addedAnyPoly = true;
          totalPerim += _polylineLengthMeters(ring);
          final polyFeat = Feature(
            id: f.id,
            geometry: Polygon.from([ring]),
            properties: draftProps,
          );
          draftPolygons.add(polyFeat);
          if (isSelected) selectedDraftPolygons.add(polyFeat);
        }
        if (!addedAnyPoly) continue;
        draftPolyMeta.add(InspectedFeature(
          sourceLabel: 'Working draft',
          isDraft: true,
          draftFeatureId: f.id,
          geometryType: f.isMultipart ? 'MultiPolygon' : 'Polygon',
          title: f.name ?? 'Draft Polygon',
          properties: {
            ...f.customProperties,
            'id': f.id,
            'vertices': f.allParts.fold<int>(0, (s, p) => s + p.length),
            if (f.isMultipart) 'parts': f.allParts.length,
            if (f.description != null && f.description!.isNotEmpty)
              'description': f.description!,
            if (f.colorHex != null) 'color': f.colorHex!,
            if (f.fillColorHex != null) 'fillColor': f.fillColorHex!,
            if (f.strokeColorHex != null) 'strokeColor': f.strokeColorHex!,
            if (f.strokeWidth != null) 'strokeWidth': f.strokeWidth!,
            if (f.fillOpacity != null) 'fillOpacity': f.fillOpacity!,
          },
          lengthMeters: totalPerim,
          callouts: draftCalloutItems,
        ));
      case DrawToolMode.line:
        double totalLen = 0;
        var addedAnyLine = false;
        for (final part in f.allParts) {
          if (part.length < 2) continue;
          addedAnyLine = true;
          totalLen += _polylineLengthMeters(part);
          final lineFeat = Feature(
            id: f.id,
            geometry: LineString.from(part),
            properties: draftProps,
          );
          if (isSelected) selectedDraftLines.add(lineFeat);
          if (f.lineDash == 'dashed') {
            draftDashedLines.add(lineFeat);
          } else if (f.lineDash == 'dotted') {
            draftDottedLines.add(lineFeat);
          } else {
            draftLines.add(lineFeat);
          }
        }
        if (!addedAnyLine) continue;
        final lineMeta = InspectedFeature(
          sourceLabel: 'Working draft',
          isDraft: true,
          draftFeatureId: f.id,
          geometryType: f.isMultipart ? 'MultiLineString' : 'LineString',
          title: f.name ?? 'Draft Line',
          properties: {
            ...f.customProperties,
            'id': f.id,
            'vertices': f.allParts.fold<int>(0, (s, p) => s + p.length),
            if (f.isMultipart) 'parts': f.allParts.length,
            if (f.description != null && f.description!.isNotEmpty)
              'description': f.description!,
            if (f.colorHex != null) 'color': f.colorHex!,
            if (f.strokeColorHex != null) 'strokeColor': f.strokeColorHex!,
            if (f.strokeWidth != null) 'strokeWidth': f.strokeWidth!,
            if (f.lineDash != null) 'lineDash': f.lineDash!,
            if (f.arrowStart) 'arrowStart': true,
            if (f.arrowEnd) 'arrowEnd': true,
          },
          lengthMeters: totalLen,
          callouts: draftCalloutItems,
        );
        if (f.lineDash == 'dashed') {
          draftDashedLineMeta.add(lineMeta);
        } else if (f.lineDash == 'dotted') {
          draftDottedLineMeta.add(lineMeta);
        } else {
          draftLineMeta.add(lineMeta);
        }
      case DrawToolMode.point:
        var addedAnyPt = false;
        for (final part in f.allParts) {
          if (part.isEmpty) continue;
          addedAnyPt = true;
          final ptFeat = Feature(
            id: f.id,
            geometry: Point(part.first),
            properties: draftProps,
          );
          draftPoints.add(ptFeat);
          if (isSelected) selectedDraftPoints.add(ptFeat);
        }
        if (!addedAnyPt) continue;
        draftPointMeta.add(InspectedFeature(
          sourceLabel: 'Working draft',
          isDraft: true,
          draftFeatureId: f.id,
          geometryType: f.isMultipart ? 'MultiPoint' : 'Point',
          title: f.name ?? 'Draft Point',
          properties: {
            ...f.customProperties,
            'id': f.id,
            'lat': f.vertices.first.lat.toStringAsFixed(6),
            'lon': f.vertices.first.lon.toStringAsFixed(6),
            if (f.isMultipart) 'parts': f.allParts.length,
            if (f.description != null && f.description!.isNotEmpty)
              'description': f.description!,
            if (f.colorHex != null) 'color': f.colorHex!,
            if (f.fillColorHex != null) 'fillColor': f.fillColorHex!,
            if (f.strokeColorHex != null) 'strokeColor': f.strokeColorHex!,
            if (f.radius != null) 'radius': f.radius!,
            if (f.displayIcon != null) 'displayIcon': f.displayIcon!,
          },
          callouts: draftCalloutItems,
        ));
      default:
        continue;
    }
  }

  // 4. Temporal Sightings
  final sightingPoints = <Feature<Point>>[];
  final sightingMeta = <InspectedFeature>[];
  for (final s in sightings) {
    final pos = Geographic(lon: s.lon, lat: s.lat);
    sightingPoints.add(Feature(geometry: Point(pos)));
    final label = (s.title != null && s.title!.trim().isNotEmpty)
        ? s.title!.trim()
        : null;
    if (showLabels && label != null) {
      labelPoints.add(
        Feature(geometry: Point(pos), properties: {'label': label}),
      );
    }
    sightingMeta.add(InspectedFeature(
      sourceLabel: 'Sighting (37522)',
      isDraft: false,
      geometryType: 'Point',
      title: s.title ?? 'Temporal Sighting',
      imageUrl: s.imageUrl,
      properties: {
        'note': s.note,
        'lat': s.lat.toStringAsFixed(5),
        'lon': s.lon.toStringAsFixed(5),
        if (s.imageUrl != null) 'image': s.imageUrl!,
      },
    ));
  }

  // 4b. Live Beacons (kind 37521)
  final beaconPoints = <Feature<Point>>[];
  final beaconMeta = <InspectedFeature>[];
  for (final b in beacons) {
    final pos = Geographic(lon: b.lon, lat: b.lat);
    beaconPoints.add(Feature(geometry: Point(pos)));
    final label = (b.status != null && b.status!.trim().isNotEmpty)
        ? b.status!.trim()
        : 'Live Beacon';
    if (showLabels) {
      labelPoints.add(
        Feature(geometry: Point(pos), properties: {'label': label}),
      );
    }
    beaconMeta.add(InspectedFeature(
      sourceLabel: 'Live Beacon (37521)',
      isDraft: false,
      geometryType: 'Point',
      title: label,
      imageUrl: b.imageUrl,
      properties: {
        'pubkey': b.pubkey.length > 14 ? '${b.pubkey.substring(0, 14)}…' : b.pubkey,
        if (b.status != null && b.status!.isNotEmpty) 'status': b.status!,
        'lat': b.lat.toStringAsFixed(5),
        'lon': b.lon.toStringAsFixed(5),
        if (b.expiresAt != null) 'expiresAt': b.expiresAt.toString(),
      },
    ));
  }

  // 5. Story inline `geo:` pins
  final geoPinPoints = <Feature<Point>>[];
  if (activeStory != null) {
    for (final pin in activeStory.geoPins) {
      geoPinPoints.add(
        Feature(
          id: pin.id,
          geometry: Point(pin.position),
          properties: {'label': pin.label},
        ),
      );
      if (showLabels) {
        labelPoints.add(
          Feature(
            geometry: Point(pin.position),
            properties: {'label': pin.label},
          ),
        );
      }
    }
  }

  final shelfFillExpr = _safeColorProp('fillColor', EarthlyColors.commentGreen);
  final shelfStrokeExpr = _safeColorProp('color', EarthlyColors.commentGreen);
  final shelfPointStrokeExpr = _safeColorProp('pointStroke', Colors.white);
  final highlightColor = const Color(0xFFF59E0B);

  return <Layer>[
    if (shelfPolygons.isNotEmpty)
      PolygonLayer(
        id: 'earthly-shelf-polygons',
        polygons: shelfPolygons,
        color: shelfFillExpr,
        opacity: _safeNumberProp('fillOpacity', 0.24),
        outlineColor: shelfStrokeExpr,
        onClick: (event) {
          if (event.index < shelfPolyMeta.length) {
            onInspectFeature(shelfPolyMeta[event.index]);
          }
        },
      ),
    if (shelfPolygons.isNotEmpty)
      PolylineLayer(
        id: 'earthly-shelf-polygon-outlines',
        polylines: [
          for (final p in shelfPolygons)
            if (p.geometry?.exterior case final exterior?)
              Feature(
                geometry: LineString.from(
                  exterior.positions.map(
                    (pos) => Geographic(lon: pos.x, lat: pos.y),
                  ),
                ),
                properties: p.properties,
              ),
        ],
        color: shelfStrokeExpr,
        width: _safeNumberProp('strokeWidth', 2.0),
      ),
    if (shelfLines.isNotEmpty)
      PolylineLayer(
        id: 'earthly-shelf-lines',
        polylines: shelfLines,
        color: shelfStrokeExpr,
        width: _safeNumberProp('strokeWidth', 3.0),
        onClick: (event) {
          if (event.index < shelfLineMeta.length) {
            onInspectFeature(shelfLineMeta[event.index]);
          }
        },
      ),
    if (shelfDashedLines.isNotEmpty)
      PolylineLayer(
        id: 'earthly-shelf-lines-dashed',
        polylines: shelfDashedLines,
        color: shelfStrokeExpr,
        width: _safeNumberProp('strokeWidth', 3.0),
        dashArray: const Expression.literal([4, 2]),
        onClick: (event) {
          if (event.index < shelfDashedLineMeta.length) {
            onInspectFeature(shelfDashedLineMeta[event.index]);
          }
        },
      ),
    if (shelfDottedLines.isNotEmpty)
      PolylineLayer(
        id: 'earthly-shelf-lines-dotted',
        polylines: shelfDottedLines,
        color: shelfStrokeExpr,
        width: _safeNumberProp('strokeWidth', 3.0),
        dashArray: const Expression.literal([1, 2]),
        onClick: (event) {
          if (event.index < shelfDottedLineMeta.length) {
            onInspectFeature(shelfDottedLineMeta[event.index]);
          }
        },
      ),
    if (shelfPoints.isNotEmpty)
      CircleLayer(
        id: 'earthly-shelf-points',
        points: shelfPoints,
        color: shelfFillExpr,
        radius: _safeNumberProp('radius', 6.5),
        strokeColor: shelfPointStrokeExpr,
        strokeWidth: const Expression.literal(2.0),
        onClick: (event) {
          if (event.index < shelfPointMeta.length) {
            onInspectFeature(shelfPointMeta[event.index]);
          }
        },
      ),

    // Focused Story reference highlight halo
    if (focusedPolygons.isNotEmpty)
      PolylineLayer(
        id: 'earthly-focus-polygon-halo',
        polylines: [
          for (final p in focusedPolygons)
            if (p.geometry?.exterior case final exterior?)
              Feature(
                geometry: LineString.from(
                  exterior.positions.map(
                    (pos) => Geographic(lon: pos.x, lat: pos.y),
                  ),
                ),
              ),
        ],
        color: Expression.literal(highlightColor),
        width: const Expression.literal(4.5),
      ),
    if (focusedLines.isNotEmpty)
      PolylineLayer(
        id: 'earthly-focus-line-halo',
        polylines: focusedLines,
        color: Expression.literal(highlightColor),
        width: const Expression.literal(5.5),
      ),
    if (focusedPoints.isNotEmpty)
      CircleLayer(
        id: 'earthly-focus-point-halo',
        points: focusedPoints,
        color: Expression.literal(highlightColor),
        radius: const Expression.literal(10.5),
        strokeColor: const Expression.literal(Colors.white),
        strokeWidth: const Expression.literal(2.5),
      ),

    // Temporal Sightings
    if (sightingPoints.isNotEmpty)
      CircleLayer(
        id: 'earthly-sightings',
        points: sightingPoints,
        color: const Expression.literal(Color(0xFFD97706)),
        radius: const Expression.literal(7.5),
        strokeColor: const Expression.literal(Colors.white),
        strokeWidth: const Expression.literal(2.2),
        onClick: (event) {
          if (event.index < sightingMeta.length) {
            onInspectFeature(sightingMeta[event.index]);
          }
        },
      ),

    // Live Beacons (kind 37521) — cyan halo + crisp live dot
    if (beaconPoints.isNotEmpty) ...[
      CircleLayer(
        id: 'earthly-live-beacons-halo',
        points: beaconPoints,
        color: const Expression.literal(Color(0x400891B2)),
        radius: const Expression.literal(14.0),
      ),
      CircleLayer(
        id: 'earthly-live-beacons',
        points: beaconPoints,
        color: const Expression.literal(Color(0xFF0891B2)),
        radius: const Expression.literal(7.5),
        strokeColor: const Expression.literal(Colors.white),
        strokeWidth: const Expression.literal(2.4),
        onClick: (event) {
          if (event.index < beaconMeta.length) {
            onInspectFeature(beaconMeta[event.index]);
          }
        },
      ),
    ],

    // Story `geo:` pins
    if (geoPinPoints.isNotEmpty)
      CircleLayer(
        id: 'earthly-geo-pins',
        points: geoPinPoints,
        color: const Expression.literal(Color(0xFFDC2626)),
        radius: const Expression.literal(8.0),
        strokeColor: const Expression.literal(Colors.white),
        strokeWidth: const Expression.literal(2.5),
      ),

    // Working Draft Polygons (separate fillColor + strokeColor, opacity, and strokeWidth expressions)
    if (draftPolygons.isNotEmpty) ...[
      PolygonLayer(
        id: 'earthly-draft-polygons',
        polygons: draftPolygons,
        color: _safeColorProp('fillColor', accentColor),
        opacity: _safeNumberProp('fillOpacity', 0.24),
        outlineColor: _safeColorProp('color', accentColor),
        onClick: (event) {
          if (event.index < draftPolyMeta.length) {
            onInspectFeature(draftPolyMeta[event.index]);
          }
        },
      ),
      PolylineLayer(
        id: 'earthly-draft-polygon-outlines',
        polylines: [
          for (final p in draftPolygons)
            if (p.geometry?.exterior case final exterior?)
              Feature(
                id: p.id,
                geometry: LineString.from(
                  exterior.positions.map(
                    (pos) => Geographic(lon: pos.x, lat: pos.y),
                  ),
                ),
                properties: p.properties,
              ),
        ],
        color: _safeColorProp('color', accentColor),
        width: _safeNumberProp('strokeWidth', 2.6),
      ),
    ],

    // Working Draft Lines (solid, dashed, dotted)
    if (draftLines.isNotEmpty)
      PolylineLayer(
        id: 'earthly-draft-lines',
        polylines: draftLines,
        color: _safeColorProp('color', accentColor),
        width: _safeNumberProp('strokeWidth', 3.0),
        onClick: (event) {
          if (event.index < draftLineMeta.length) {
            onInspectFeature(draftLineMeta[event.index]);
          }
        },
      ),
    if (draftDashedLines.isNotEmpty)
      PolylineLayer(
        id: 'earthly-draft-lines-dashed',
        polylines: draftDashedLines,
        color: _safeColorProp('color', accentColor),
        width: _safeNumberProp('strokeWidth', 3.0),
        dashArray: const Expression.literal([4, 2]),
        onClick: (event) {
          if (event.index < draftDashedLineMeta.length) {
            onInspectFeature(draftDashedLineMeta[event.index]);
          }
        },
      ),
    if (draftDottedLines.isNotEmpty)
      PolylineLayer(
        id: 'earthly-draft-lines-dotted',
        polylines: draftDottedLines,
        color: _safeColorProp('color', accentColor),
        width: _safeNumberProp('strokeWidth', 3.0),
        dashArray: const Expression.literal([1, 2]),
        onClick: (event) {
          if (event.index < draftDottedLineMeta.length) {
            onInspectFeature(draftDottedLineMeta[event.index]);
          }
        },
      ),

    // Working Draft Points
    if (draftPoints.isNotEmpty)
      CircleLayer(
        id: 'earthly-draft-points',
        points: draftPoints,
        color: _safeColorProp('fillColor', accentColor),
        radius: _safeNumberProp('radius', 7.0),
        strokeColor: _safeColorProp('pointStroke', Colors.white),
        strokeWidth: const Expression.literal(2.2),
        onClick: (event) {
          if (event.index < draftPointMeta.length) {
            onInspectFeature(draftPointMeta[event.index]);
          }
        },
      ),

    // Multi-selected Working Draft feature highlight halos
    if (selectedDraftPolygons.isNotEmpty)
      PolylineLayer(
        id: 'earthly-selected-draft-polygons',
        polylines: [
          for (final p in selectedDraftPolygons)
            if (p.geometry?.exterior case final exterior?)
              Feature(
                geometry: LineString.from(
                  exterior.positions.map(
                    (pos) => Geographic(lon: pos.x, lat: pos.y),
                  ),
                ),
              ),
        ],
        color: const Expression.literal(EarthlyColors.amber),
        width: const Expression.literal(4.6),
      ),
    if (selectedDraftLines.isNotEmpty)
      PolylineLayer(
        id: 'earthly-selected-draft-lines',
        polylines: selectedDraftLines,
        color: const Expression.literal(EarthlyColors.amber),
        width: const Expression.literal(5.4),
      ),
    if (selectedDraftPoints.isNotEmpty)
      CircleLayer(
        id: 'earthly-selected-draft-points',
        points: selectedDraftPoints,
        color: const Expression.literal(Color(0x38F59E0B)),
        radius: const Expression.literal(12.0),
        strokeColor: const Expression.literal(EarthlyColors.amber),
        strokeWidth: const Expression.literal(2.4),
      ),

    // Geo Comment Annotation Overlay (Comment Green #15803D)
    ..._buildOverlayShapeLayers(
      prefix: 'earthly-comment-overlay',
      shapes: commentOverlayShapes,
      color: EarthlyColors.commentGreen,
    ),

    // Geo Edit Proposal & AI safeEditing Ghost Preview Overlay (Proposed Amber #D97706, dashed)
    ..._buildOverlayShapeLayers(
      prefix: 'earthly-proposal-overlay',
      shapes: proposalOverlayShapes,
      color: EarthlyColors.proposedAmber,
      dashed: true,
    ),

    // Live Background GPS Track Recording Overlay (Rose/Red #E11D48 + pulsing head dot)
    if (gpsTrackPoints.length >= 2)
      PolylineLayer(
        id: 'earthly-live-gps-track-line',
        polylines: [Feature(geometry: LineString.from(gpsTrackPoints))],
        color: const Expression.literal(Color(0xFFE11D48)),
        width: const Expression.literal(4.2),
      ),
    if (gpsTrackPoints.isNotEmpty) ...[
      CircleLayer(
        id: 'earthly-live-gps-track-halo',
        points: [Feature(geometry: Point(gpsTrackPoints.last))],
        color: const Expression.literal(Color(0x45E11D48)),
        radius: const Expression.literal(13.0),
      ),
      CircleLayer(
        id: 'earthly-live-gps-track-head',
        points: [Feature(geometry: Point(gpsTrackPoints.last))],
        color: const Expression.literal(Color(0xFFE11D48)),
        radius: const Expression.literal(6.5),
        strokeColor: const Expression.literal(Colors.white),
        strokeWidth: const Expression.literal(2.2),
      ),
    ],

    // Standalone Measure Ruler overlay (violet/indigo measurement line & vertices)
    if (measurePoints.length >= 3)
      PolygonLayer(
        id: 'earthly-measure-polygon',
        polygons: [
          Feature(geometry: Polygon.from([_ensureClosedRing(measurePoints)])),
        ],
        color: const Expression.literal(Color(0xFF7C3AED)),
        opacity: const Expression.literal(0.16),
      ),
    if (measurePoints.length >= 2)
      PolylineLayer(
        id: 'earthly-measure-line',
        polylines: [Feature(geometry: LineString.from(measurePoints))],
        color: const Expression.literal(Color(0xFF7C3AED)),
        width: const Expression.literal(3.0),
      ),
    if (measurePoints.isNotEmpty)
      CircleLayer(
        id: 'earthly-measure-points',
        points: [for (final p in measurePoints) Feature(geometry: Point(p))],
        color: const Expression.literal(Color(0xFF7C3AED)),
        radius: const Expression.literal(5.5),
        strokeColor: const Expression.literal(Colors.white),
        strokeWidth: const Expression.literal(2.0),
      ),

    // Collision-free native GPU Feature Labels (rendered via MapLibre symbol shader)
    if (showLabels && labelPoints.isNotEmpty)
      MarkerLayer(
        id: 'earthly-feature-labels',
        points: labelPoints,
        textField: Expression.get('label').convertToString(),
        textFont: const Expression.literal(['Noto Sans Regular']),
        textSize: const Expression.literal(12.5),
        textMaxWidth: const Expression.literal(11),
        textOffset: const Expression.literal(Offset(0, 1.35)),
        textColor: Expression.literal(
          isDarkMap ? const Color(0xFFF3F4F6) : const Color(0xFF111827),
        ),
        textHaloColor: Expression.literal(
          isDarkMap ? const Color(0xFF111827) : const Color(0xFFFFFFFF),
        ),
        textHaloWidth: const Expression.literal(1.6),
        textAllowOverlap: const Expression.literal(false),
      ),
  ];
}

List<Layer> _buildOverlayShapeLayers({
  required String prefix,
  required List<ShelfShape> shapes,
  required Color color,
  bool dashed = false,
}) {
  if (shapes.isEmpty) return const [];
  final polys = <Feature<Polygon>>[];
  final lines = <Feature<LineString>>[];
  final pts = <Feature<Point>>[];
  for (final s in shapes) {
    switch (s.kind) {
      case ShelfShapeKind.polygon:
        final ring = _ensureClosedRing(s.coords);
        if (ring.length >= 4) polys.add(Feature(geometry: Polygon.from([ring])));
      case ShelfShapeKind.line:
        if (s.coords.length >= 2) lines.add(Feature(geometry: LineString.from(s.coords)));
      case ShelfShapeKind.point:
        if (s.coords.isNotEmpty) pts.add(Feature(geometry: Point(s.coords.first)));
    }
  }
  return <Layer>[
    if (polys.isNotEmpty)
      PolygonLayer(
        id: '$prefix-polygons',
        polygons: polys,
        color: Expression.literal(color),
        opacity: const Expression.literal(0.28),
        outlineColor: Expression.literal(color),
      ),
    if (dashed && polys.isNotEmpty)
      PolylineLayer(
        id: '$prefix-polygon-dashes',
        polylines: [
          for (final p in polys)
            if (p.geometry?.exterior case final exterior?)
              Feature(
                geometry: LineString.from(
                  exterior.positions.map(
                    (pos) => Geographic(lon: pos.x, lat: pos.y),
                  ),
                ),
              ),
        ],
        color: Expression.literal(color),
        width: const Expression.literal(3.0),
        dashArray: const Expression.literal([4, 2]),
      ),
    if (lines.isNotEmpty)
      PolylineLayer(
        id: '$prefix-lines',
        polylines: lines,
        color: Expression.literal(color),
        width: const Expression.literal(3.6),
        dashArray: dashed ? const Expression.literal([4, 2]) : null,
      ),
    if (pts.isNotEmpty)
      CircleLayer(
        id: '$prefix-points',
        points: pts,
        color: Expression.literal(color),
        radius: const Expression.literal(7.5),
        strokeColor: const Expression.literal(Colors.white),
        strokeWidth: const Expression.literal(2.2),
      ),
  ];
}

List<DraftCallout> _parseDraftCallouts(Map<String, Object?> props) {
  final raw = props['earthly:callouts'];
  if (raw is! List) return const [];
  final out = <DraftCallout>[];
  var i = 0;
  for (final item in raw) {
    if (item is! Map) continue;
    i += 1;
    final text = (item['text'] as String?)?.trim();
    if (text == null || text.isEmpty) continue;
    final id = (item['id'] as String?)?.trim();
    final title = (item['title'] as String?)?.trim();
    final placement = item['placement'];
    final side = (placement is Map && placement['side'] is String)
        ? placement['side'] as String
        : 'auto';
    var offsetX = 0.0;
    var offsetY = 0.0;
    if (placement is Map &&
        placement['offset'] is List &&
        (placement['offset'] as List).length >= 2) {
      final ox = (placement['offset'] as List)[0];
      final oy = (placement['offset'] as List)[1];
      if (ox is num && oy is num) {
        offsetX = ox.toDouble();
        offsetY = oy.toDouble();
      }
    }
    final mediaUrls = <String>[];
    if (item['media'] is List) {
      for (final m in item['media'] as List) {
        if (m is Map && m['url'] is String && (m['url'] as String).isNotEmpty) {
          mediaUrls.add(m['url'] as String);
        }
      }
    }
    out.add(DraftCallout(
      id: (id != null && id.isNotEmpty) ? id : 'c-$i',
      text: text,
      title: (title != null && title.isNotEmpty) ? title : null,
      side: side,
      offsetX: offsetX,
      offsetY: offsetY,
      mediaUrls: mediaUrls,
    ));
  }
  return out;
}

List<Geographic> _ensureClosedRing(List<Geographic> pts) {
  if (pts.length < 3) return const [];
  final first = pts.first;
  final last = pts.last;
  if (first.lon == last.lon && first.lat == last.lat) return pts;
  return <Geographic>[...pts, first];
}

double _polylineLengthMeters(List<Geographic> pts) {
  double total = 0;
  for (var i = 1; i < pts.length; i++) {
    total += DrawingMath.distanceMeters(pts[i - 1], pts[i]);
  }
  return total;
}

String? _sanitizeCssColor(String? raw) {
  if (raw == null) return null;
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return null;
  if (RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(trimmed)) return trimmed;
  if (RegExp(r'^#[0-9a-fA-F]{8}$').hasMatch(trimmed)) return trimmed;
  if (RegExp(r'^#[0-9a-fA-F]{3}$').hasMatch(trimmed)) {
    final r = trimmed[1];
    final g = trimmed[2];
    final b = trimmed[3];
    return '#$r$r$g$g$b$b';
  }
  final lower = trimmed.toLowerCase();
  if (lower.startsWith('rgb(') ||
      lower.startsWith('rgba(') ||
      lower.startsWith('hsl(') ||
      lower.startsWith('hsla(')) {
    return trimmed;
  }
  if (RegExp(r'^[a-z]{3,20}$').hasMatch(lower) && lower != 'transparent') {
    return lower;
  }
  return null;
}

Geographic _representativeAnchor(
  ShelfShapeKind kind,
  List<Geographic> coords,
) {
  if (coords.isEmpty) return const Geographic(lon: 0, lat: 0);
  if (kind == ShelfShapeKind.point || coords.length == 1) {
    return coords.first;
  }
  if (kind == ShelfShapeKind.line) {
    return coords[coords.length ~/ 2];
  }
  // Polygon centroid average (skip closing duplicate if present).
  var count = coords.length;
  if (count > 3 &&
      coords.first.lon == coords.last.lon &&
      coords.first.lat == coords.last.lat) {
    count -= 1;
  }
  double sumLon = 0;
  double sumLat = 0;
  for (var i = 0; i < count; i++) {
    sumLon += coords[i].lon;
    sumLat += coords[i].lat;
  }
  return Geographic(lon: sumLon / count, lat: sumLat / count);
}

List<MapCalloutItem> _parseFeatureCallouts({
  required Map<String, Object?> props,
  required Geographic anchor,
  required String datasetTitle,
  required String datasetAddress,
  required String featureId,
  String? featureLabel,
  String? accentColorHex,
}) {
  final raw = props['earthly:callouts'];
  if (raw is! List || raw.isEmpty) return const [];
  final out = <MapCalloutItem>[];
  var idx = 0;
  for (final item in raw) {
    if (item is! Map) continue;
    idx += 1;
    final id = (item['id'] as String?)?.trim();
    final text = (item['text'] as String?)?.trim();
    if (text == null || text.isEmpty) continue;
    final title = (item['title'] as String?)?.trim();
    final mediaUrls = <String>[];
    if (item['media'] is List) {
      for (final m in item['media'] as List) {
        if (m is Map && m['url'] is String && (m['url'] as String).isNotEmpty) {
          mediaUrls.add(m['url'] as String);
        }
      }
    }
    var preferredSide = 'auto';
    var offset = Offset.zero;
    var showLeader = true;
    final placement = item['placement'];
    if (placement is Map) {
      if (placement['side'] is String) {
        preferredSide = placement['side'] as String;
      }
      if (placement['offset'] is List && (placement['offset'] as List).length >= 2) {
        final ox = (placement['offset'] as List)[0];
        final oy = (placement['offset'] as List)[1];
        if (ox is num && oy is num) {
          offset = Offset(ox.toDouble(), oy.toDouble());
        }
      }
      if (placement['leader'] == 'none') {
        showLeader = false;
      }
    }
    final calloutId = (id != null && id.isNotEmpty) ? id : 'c-$idx';
    out.add(
      MapCalloutItem(
        key: '$datasetAddress::$featureId::$calloutId',
        id: calloutId,
        text: text,
        anchor: anchor,
        datasetTitle: datasetTitle,
        featureId: featureId,
        featureLabel: featureLabel,
        title: (title != null && title.isNotEmpty) ? title : null,
        mediaUrls: mediaUrls,
        preferredSide: preferredSide,
        offset: offset,
        showLeader: showLeader,
        accentColorHex: accentColorHex,
      ),
    );
  }
  return out;
}

void _extractGeometry({
  required Map<String, dynamic> geom,
  required String featureId,
  required String datasetTitle,
  required String datasetAddress,
  required String? colorHex,
  required String? fillColorHex,
  required String? strokeColorHex,
  required double? strokeWidth,
  required double? fillOpacity,
  required double? radius,
  required String? label,
  required String? displayIcon,
  required Map<String, Object?> props,
  required List<ShelfShape> out,
}) {
  final type = geom['type'] as String?;
  final coords = geom['coordinates'];

  void pushShape(
    ShelfShapeKind kind,
    List<Geographic> pts, {
    required bool attachCallouts,
  }) {
    final anchor = _representativeAnchor(kind, pts);
    final callouts = attachCallouts
        ? _parseFeatureCallouts(
            props: props,
            anchor: anchor,
            datasetTitle: datasetTitle,
            datasetAddress: datasetAddress,
            featureId: featureId,
            featureLabel: label,
            accentColorHex: strokeColorHex ?? colorHex,
          )
        : const <MapCalloutItem>[];
    out.add(ShelfShape(
      kind: kind,
      coords: pts,
      anchor: anchor,
      featureId: featureId,
      colorHex: colorHex,
      fillColorHex: fillColorHex,
      strokeColorHex: strokeColorHex,
      strokeWidth: strokeWidth,
      fillOpacity: fillOpacity,
      radius: radius,
      label: attachCallouts ? label : null,
      displayIcon: displayIcon,
      callouts: callouts,
      properties: props,
    ));
  }

  switch (type) {
    case 'Point':
      final pt = _parseCoord(coords);
      if (pt != null) {
        pushShape(ShelfShapeKind.point, [pt], attachCallouts: true);
      }
    case 'MultiPoint':
      if (coords is List) {
        var first = true;
        for (final c in coords) {
          final pt = _parseCoord(c);
          if (pt != null) {
            pushShape(ShelfShapeKind.point, [pt], attachCallouts: first);
            first = false;
          }
        }
      }
    case 'LineString':
      final pts = _parseCoordList(coords);
      if (pts.length >= 2) {
        pushShape(ShelfShapeKind.line, pts, attachCallouts: true);
      }
    case 'MultiLineString':
      if (coords is List) {
        var first = true;
        for (final line in coords) {
          final pts = _parseCoordList(line);
          if (pts.length >= 2) {
            pushShape(ShelfShapeKind.line, pts, attachCallouts: first);
            first = false;
          }
        }
      }
    case 'Polygon':
      if (coords is List && coords.isNotEmpty) {
        final ring = _parseCoordList(coords.first);
        if (ring.length >= 3) {
          pushShape(ShelfShapeKind.polygon, ring, attachCallouts: true);
        }
      }
    case 'MultiPolygon':
      if (coords is List) {
        var first = true;
        for (final poly in coords) {
          if (poly is List && poly.isNotEmpty) {
            final ring = _parseCoordList(poly.first);
            if (ring.length >= 3) {
              pushShape(ShelfShapeKind.polygon, ring, attachCallouts: first);
              first = false;
            }
          }
        }
      }
    case 'GeometryCollection':
      final geometries = geom['geometries'];
      if (geometries is List) {
        for (final g in geometries) {
          if (g is Map<String, dynamic>) {
            _extractGeometry(
              geom: g,
              featureId: featureId,
              datasetTitle: datasetTitle,
              datasetAddress: datasetAddress,
              colorHex: colorHex,
              fillColorHex: fillColorHex,
              strokeColorHex: strokeColorHex,
              strokeWidth: strokeWidth,
              fillOpacity: fillOpacity,
              radius: radius,
              label: label,
              displayIcon: displayIcon,
              props: props,
              out: out,
            );
          }
        }
      }
  }
}

Geographic? _parseCoord(Object? raw) {
  if (raw is! List || raw.length < 2) return null;
  final lon = raw[0];
  final lat = raw[1];
  if (lon is! num || lat is! num) return null;
  if (!lon.isFinite || !lat.isFinite) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return Geographic(lon: lon.toDouble(), lat: lat.toDouble());
}

List<Geographic> _parseCoordList(Object? raw) {
  if (raw is! List) return const [];
  final out = <Geographic>[];
  for (final item in raw) {
    final pt = _parseCoord(item);
    if (pt != null) out.add(pt);
  }
  return out;
}
