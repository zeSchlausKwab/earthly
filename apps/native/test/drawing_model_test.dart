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
  });
}
