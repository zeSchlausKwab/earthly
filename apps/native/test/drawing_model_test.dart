import 'package:earthly_native/drawing/drawing_model.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';

void main() {
  group('DrawingMath', () {
    test('computes realistic distance and bearing in Vienna', () {
      const stephansdom = Geographic(lon: 16.3738, lat: 48.2082);
      const rathaus = Geographic(lon: 16.3574, lat: 48.2108);

      final meters = DrawingMath.distanceMeters(stephansdom, rathaus);
      expect(meters, greaterThan(1100));
      expect(meters, lessThan(1400));

      final bearing = DrawingMath.bearingDegrees(stephansdom, rathaus);
      expect(bearing, greaterThan(270));
      expect(bearing, lessThan(300));
      expect(DrawingMath.formatTelemetry(stephansdom, rathaus), contains('km ·'));
    });

    test('snaps magnetically to nearest vertex within pixel threshold', () {
      const origin = Geographic(lon: 16.37, lat: 48.21);
      const existing = DrawnFeature(
        id: 'pt-1',
        kind: DrawToolMode.point,
        vertices: <Geographic>[origin],
      );

      Offset project(Geographic g) => Offset(
            (g.lon - 16.36) * 10000,
            (48.22 - g.lat) * 10000,
          );

      final near = project(origin) + const Offset(8, -6);
      final snap = DrawingMath.findVertexSnap(
        targetScreen: near,
        features: const [existing],
        draftVertices: const [],
        project: project,
      );
      expect(snap, isNotNull);
      expect(snap!.point, origin);
      expect(snap.label, 'vertex');

      final far = project(origin) + const Offset(40, 40);
      final noSnap = DrawingMath.findVertexSnap(
        targetScreen: far,
        features: const [existing],
        draftVertices: const [],
        project: project,
      );
      expect(noSnap, isNull);
    });

    test('snaps to draft edges and external Shelf vertices/edges with vertex priority', () {
      const a = Geographic(lon: 16.36, lat: 48.21);
      const b = Geographic(lon: 16.38, lat: 48.21);
      const draftLine = DrawnFeature(
        id: 'line-1',
        kind: DrawToolMode.line,
        vertices: <Geographic>[a, b],
      );
      const shelfA = Geographic(lon: 16.36, lat: 48.20);
      const shelfB = Geographic(lon: 16.38, lat: 48.20);

      Offset project(Geographic g) => Offset(
            (g.lon - 16.35) * 10000,
            (48.22 - g.lat) * 10000,
          );

      // 1. Midpoint along draft edge -> snaps to edge
      final nearMidEdge =
          project(const Geographic(lon: 16.37, lat: 48.21)) + const Offset(0, 6);
      final edgeSnap = DrawingMath.findVertexSnap(
        targetScreen: nearMidEdge,
        features: const [draftLine],
        draftVertices: const [],
        project: project,
      );
      expect(edgeSnap, isNotNull);
      expect(edgeSnap!.label, 'edge');
      expect(edgeSnap.point.lon, closeTo(16.37, 1e-5));
      expect(edgeSnap.point.lat, closeTo(48.21, 1e-5));

      // 2. Near endpoint of draft line -> vertex takes priority over edge
      final nearEndpoint = project(a) + const Offset(5, 4);
      final vertexSnap = DrawingMath.findVertexSnap(
        targetScreen: nearEndpoint,
        features: const [draftLine],
        draftVertices: const [],
        project: project,
      );
      expect(vertexSnap, isNotNull);
      expect(vertexSnap!.label, 'vertex');
      expect(vertexSnap.point, a);

      // 3. External Shelf vertex & Shelf edge snapping
      final nearShelfVertex = project(shelfA) + const Offset(4, -4);
      final shelfVertexSnap = DrawingMath.findVertexSnap(
        targetScreen: nearShelfVertex,
        features: const [],
        draftVertices: const [],
        externalSnapShapes: const [
          [shelfA, shelfB],
        ],
        project: project,
      );
      expect(shelfVertexSnap, isNotNull);
      expect(shelfVertexSnap!.label, 'shelf vertex');
      expect(shelfVertexSnap.point, shelfA);

      final nearShelfEdge =
          project(const Geographic(lon: 16.37, lat: 48.20)) + const Offset(0, -5);
      final shelfEdgeSnap = DrawingMath.findVertexSnap(
        targetScreen: nearShelfEdge,
        features: const [],
        draftVertices: const [],
        externalSnapShapes: const [
          [shelfA, shelfB],
        ],
        project: project,
      );
      expect(shelfEdgeSnap, isNotNull);
      expect(shelfEdgeSnap!.label, 'shelf edge');
      expect(shelfEdgeSnap.point.lon, closeTo(16.37, 1e-5));
    });
  });
}
