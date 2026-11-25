import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';
import 'package:maplibre/maplibre.dart';

enum DrawToolMode {
  browse,
  point,
  line,
  polygon,
}

enum TouchPlacementStyle {
  /// 1-finger press & drag places with a -48dp thumb offset while 2 fingers pan/zoom.
  drawDrag,

  /// Pan the map freely with 1 thumb under a fixed center reticle and tap Drop Point.
  crosshair,
}

@immutable
class DraftCallout {
  const DraftCallout({
    required this.id,
    required this.text,
    this.title,
    this.side = 'auto',
  });

  final String id;
  final String text;
  final String? title;
  final String side;
}

@immutable
class DrawnFeature {
  const DrawnFeature({
    required this.id,
    required this.kind,
    required this.vertices,
    this.name,
    this.colorHex,
    this.callouts = const [],
  });

  final String id;
  final DrawToolMode kind;
  final List<Geographic> vertices;
  final String? name;
  final String? colorHex;
  final List<DraftCallout> callouts;

  DrawnFeature copyWith({
    List<Geographic>? vertices,
    String? name,
    String? colorHex,
    List<DraftCallout>? callouts,
  }) =>
      DrawnFeature(
        id: id,
        kind: kind,
        vertices: vertices ?? this.vertices,
        name: name ?? this.name,
        colorHex: colorHex ?? this.colorHex,
        callouts: callouts ?? this.callouts,
      );
}

@immutable
class SnapMatch {
  const SnapMatch({
    required this.point,
    required this.screenOffset,
    required this.label,
  });

  final Geographic point;
  final Offset screenOffset;
  final String label;
}

/// Pure geometry & snapping helpers for the Phase 0 mobile drawing spike.
/// (In Phase 1, heavy spatial operations migrate into `crates/earthly-geo`.)
abstract final class DrawingMath {
  static const double _earthRadiusMeters = 6371008.8;
  static const double snapRadiusPx = 18.0;

  static double distanceMeters(Geographic a, Geographic b) {
    final lat1 = _rad(a.lat);
    final lat2 = _rad(b.lat);
    final dLat = lat2 - lat1;
    final dLon = _rad(b.lon - a.lon);
    final sinLat = math.sin(dLat / 2);
    final sinLon = math.sin(dLon / 2);
    final h = sinLat * sinLat + math.cos(lat1) * math.cos(lat2) * sinLon * sinLon;
    return 2 * _earthRadiusMeters * math.asin(math.min(1.0, math.sqrt(h)));
  }

  static double bearingDegrees(Geographic from, Geographic to) {
    final lat1 = _rad(from.lat);
    final lat2 = _rad(to.lat);
    final dLon = _rad(to.lon - from.lon);
    final y = math.sin(dLon) * math.cos(lat2);
    final x = math.cos(lat1) * math.sin(lat2) -
        math.sin(lat1) * math.cos(lat2) * math.cos(dLon);
    final deg = math.atan2(y, x) * 180.0 / math.pi;
    return (deg + 360.0) % 360.0;
  }

  static String formatDistance(double meters) {
    if (meters >= 1000) {
      return '${(meters / 1000).toStringAsFixed(2)} km';
    }
    return '${meters.round()} m';
  }

  static String formatTelemetry(Geographic? anchor, Geographic target) {
    if (anchor == null) {
      return '${target.lat.toStringAsFixed(5)}, ${target.lon.toStringAsFixed(5)}';
    }
    final dist = distanceMeters(anchor, target);
    final bearing = bearingDegrees(anchor, target).round().toString().padLeft(3, '0');
    return '${formatDistance(dist)} · $bearing°';
  }

  /// Finds the nearest existing vertex within [snapRadiusPx] in screen space.
  static SnapMatch? findVertexSnap({
    required Offset targetScreen,
    required List<DrawnFeature> features,
    required List<Geographic> draftVertices,
    required Offset Function(Geographic) project,
    int? ignoreDraftIndex,
  }) {
    SnapMatch? best;
    double bestDist = snapRadiusPx;

    void consider(Geographic candidate, String label) {
      final projected = project(candidate);
      final dist = (projected - targetScreen).distance;
      if (dist <= bestDist) {
        bestDist = dist;
        best = SnapMatch(
          point: candidate,
          screenOffset: projected,
          label: label,
        );
      }
    }

    for (final feature in features) {
      for (final vertex in feature.vertices) {
        consider(vertex, 'vertex');
      }
    }
    for (var i = 0; i < draftVertices.length; i++) {
      if (i == ignoreDraftIndex) continue;
      consider(draftVertices[i], i == 0 ? 'close loop' : 'vertex');
    }
    return best;
  }

  static Geographic midpoint(Geographic a, Geographic b) => Geographic(
        lon: (a.lon + b.lon) / 2,
        lat: (a.lat + b.lat) / 2,
      );

  static double _rad(double degrees) => degrees * math.pi / 180.0;
}
