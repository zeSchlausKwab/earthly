import 'package:earthly_native/drawing/drawing_model.dart';
import 'package:earthly_native/nostr/shelf_renderer.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

void _expectCoalesceInsideConverter(
  Expression<Object?> expr, {
  required String converterOp,
  required String propertyName,
}) {
  final json = expr.toJson();
  expect(json, isA<List<Object?>>());
  final list = json! as List<Object?>;
  expect(list.first, converterOp, reason: 'Expected $converterOp in $json');
  expect(list.length, greaterThanOrEqualTo(3));

  final inner = list[1];
  expect(inner, isA<List<Object?>>(), reason: 'Expected coalesce list in $json');
  final coalesce = inner! as List<Object?>;
  expect(coalesce.first, 'coalesce', reason: 'Expected coalesce inside $converterOp: $json');
  expect(coalesce[1], ['get', propertyName]);
  expect(coalesce[2], isNotNull);
}

void main() {
  test('shelf & draft numeric and color expressions wrap coalesce inside to-number/to-color', () {
    final shelfEntry = ShelfMapEntry(
      summary: makeTestMap(
        address: '37515:aaa:shelf-test',
        title: 'Shelf Test',
      ),
      visible: true,
      shapes: const [
        ShelfShape(
          kind: ShelfShapeKind.polygon,
          coords: [
            Geographic(lon: 16.36, lat: 48.20),
            Geographic(lon: 16.38, lat: 48.20),
            Geographic(lon: 16.38, lat: 48.22),
          ],
          anchor: Geographic(lon: 16.37, lat: 48.21),
          featureId: 'shelf-poly-1',
        ),
        ShelfShape(
          kind: ShelfShapeKind.line,
          coords: [
            Geographic(lon: 16.36, lat: 48.20),
            Geographic(lon: 16.38, lat: 48.22),
          ],
          anchor: Geographic(lon: 16.37, lat: 48.21),
          featureId: 'shelf-line-solid',
        ),
        ShelfShape(
          kind: ShelfShapeKind.line,
          coords: [
            Geographic(lon: 16.36, lat: 48.21),
            Geographic(lon: 16.38, lat: 48.23),
          ],
          anchor: Geographic(lon: 16.37, lat: 48.22),
          featureId: 'shelf-line-dashed',
          properties: {'lineDash': 'dashed'},
        ),
        ShelfShape(
          kind: ShelfShapeKind.line,
          coords: [
            Geographic(lon: 16.36, lat: 48.22),
            Geographic(lon: 16.38, lat: 48.24),
          ],
          anchor: Geographic(lon: 16.37, lat: 48.23),
          featureId: 'shelf-line-dotted',
          properties: {'lineDash': 'dotted'},
        ),
        ShelfShape(
          kind: ShelfShapeKind.point,
          coords: [Geographic(lon: 16.37, lat: 48.21)],
          anchor: Geographic(lon: 16.37, lat: 48.21),
          featureId: 'shelf-pt-1',
        ),
      ],
    );

    final draftFeatures = <DrawnFeature>[
      const DrawnFeature(
        id: 'draft-pt-1',
        kind: DrawToolMode.point,
        vertices: [Geographic(lon: 16.3738, lat: 48.2082)],
        name: 'Draft Point',
      ),
      const DrawnFeature(
        id: 'draft-line-solid',
        kind: DrawToolMode.line,
        vertices: [
          Geographic(lon: 16.370, lat: 48.205),
          Geographic(lon: 16.380, lat: 48.215),
        ],
        name: 'Draft Line',
      ),
      const DrawnFeature(
        id: 'draft-line-dashed',
        kind: DrawToolMode.line,
        vertices: [
          Geographic(lon: 16.371, lat: 48.205),
          Geographic(lon: 16.381, lat: 48.215),
        ],
        lineDash: 'dashed',
      ),
      const DrawnFeature(
        id: 'draft-line-dotted',
        kind: DrawToolMode.line,
        vertices: [
          Geographic(lon: 16.372, lat: 48.205),
          Geographic(lon: 16.382, lat: 48.215),
        ],
        lineDash: 'dotted',
      ),
      const DrawnFeature(
        id: 'draft-poly-1',
        kind: DrawToolMode.polygon,
        vertices: [
          Geographic(lon: 16.365, lat: 48.200),
          Geographic(lon: 16.375, lat: 48.200),
          Geographic(lon: 16.375, lat: 48.210),
        ],
        name: 'Draft Polygon',
      ),
    ];

    final layers = buildEarthlyGpuLayers(
      shelfMaps: [shelfEntry],
      sightings: const [],
      draftFeatures: draftFeatures,
      accentColor: const Color(0xFFD97706),
      isDarkMap: false,
      showLabels: false,
      onInspectFeature: (_) {},
    );

    final byId = <String, Layer>{
      for (final layer in layers)
        if (layer.id != null) layer.id!: layer,
    };

    const expectedIds = <String>[
      'earthly-shelf-polygons',
      'earthly-shelf-polygon-outlines',
      'earthly-shelf-lines',
      'earthly-shelf-lines-dashed',
      'earthly-shelf-lines-dotted',
      'earthly-shelf-points',
      'earthly-draft-polygons',
      'earthly-draft-polygon-outlines',
      'earthly-draft-lines',
      'earthly-draft-lines-dashed',
      'earthly-draft-lines-dotted',
      'earthly-draft-points',
    ];

    for (final id in expectedIds) {
      final layer = byId[id];
      expect(layer, isNotNull, reason: 'Missing layer $id');
      expect(layer!.list, isNotEmpty, reason: 'Empty feature list on $id');
    }

    for (final polyId in const ['earthly-shelf-polygons', 'earthly-draft-polygons']) {
      final layer = byId[polyId]! as PolygonLayer;
      _expectCoalesceInsideConverter(
        layer.opacity,
        converterOp: 'to-number',
        propertyName: 'fillOpacity',
      );
      _expectCoalesceInsideConverter(
        layer.color,
        converterOp: 'to-color',
        propertyName: 'fillColor',
      );
      _expectCoalesceInsideConverter(
        layer.outlineColor,
        converterOp: 'to-color',
        propertyName: 'color',
      );
    }

    for (final lineId in const [
      'earthly-shelf-polygon-outlines',
      'earthly-shelf-lines',
      'earthly-shelf-lines-dashed',
      'earthly-shelf-lines-dotted',
      'earthly-draft-polygon-outlines',
      'earthly-draft-lines',
      'earthly-draft-lines-dashed',
      'earthly-draft-lines-dotted',
    ]) {
      final layer = byId[lineId]! as PolylineLayer;
      _expectCoalesceInsideConverter(
        layer.width,
        converterOp: 'to-number',
        propertyName: 'strokeWidth',
      );
      _expectCoalesceInsideConverter(
        layer.color,
        converterOp: 'to-color',
        propertyName: 'color',
      );
    }

    for (final ptId in const ['earthly-shelf-points', 'earthly-draft-points']) {
      final layer = byId[ptId]! as CircleLayer;
      _expectCoalesceInsideConverter(
        layer.radius,
        converterOp: 'to-number',
        propertyName: 'radius',
      );
      _expectCoalesceInsideConverter(
        layer.color,
        converterOp: 'to-color',
        propertyName: 'fillColor',
      );
      _expectCoalesceInsideConverter(
        layer.strokeColor,
        converterOp: 'to-color',
        propertyName: 'pointStroke',
      );
    }
  });
}
