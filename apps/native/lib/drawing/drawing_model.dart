import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';
import 'package:maplibre/maplibre.dart';

enum DrawToolMode {
  browse,
  point,
  line,
  polygon,
  measure,
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
    this.offsetX = 0.0,
    this.offsetY = 0.0,
    this.mediaUrls = const <String>[],
  });

  final String id;
  final String text;
  final String? title;
  final String side;
  final double offsetX;
  final double offsetY;
  final List<String> mediaUrls;

  DraftCallout copyWith({
    String? id,
    String? text,
    String? title,
    String? side,
    double? offsetX,
    double? offsetY,
    List<String>? mediaUrls,
  }) =>
      DraftCallout(
        id: id ?? this.id,
        text: text ?? this.text,
        title: title ?? this.title,
        side: side ?? this.side,
        offsetX: offsetX ?? this.offsetX,
        offsetY: offsetY ?? this.offsetY,
        mediaUrls: mediaUrls ?? this.mediaUrls,
      );
}

@immutable
class DrawnFeature {
  const DrawnFeature({
    required this.id,
    required this.kind,
    required this.vertices,
    this.name,
    this.description,
    this.colorHex,
    this.fillColorHex,
    this.strokeColorHex,
    this.strokeWidth,
    this.fillOpacity,
    this.radius,
    this.lineDash,
    this.arrowStart = false,
    this.arrowEnd = false,
    this.displayIcon,
    this.callouts = const [],
    this.customProperties = const <String, String>{},
    this.extraParts = const <List<Geographic>>[],
  });

  final String id;
  final DrawToolMode kind;
  final List<Geographic> vertices;
  final List<List<Geographic>> extraParts;
  final String? name;
  final String? description;
  final String? colorHex;
  final String? fillColorHex;
  final String? strokeColorHex;
  final double? strokeWidth;
  final double? fillOpacity;
  final double? radius;
  final String? lineDash; // 'solid' | 'dashed' | 'dotted'
  final bool arrowStart;
  final bool arrowEnd;
  final String? displayIcon; // e.g. 'lucide:mountain'
  final List<DraftCallout> callouts;
  final Map<String, String> customProperties;

  bool get isMultipart => extraParts.isNotEmpty;
  List<List<Geographic>> get allParts => <List<Geographic>>[vertices, ...extraParts];

  DrawnFeature copyWith({
    String? id,
    List<Geographic>? vertices,
    List<List<Geographic>>? extraParts,
    String? name,
    String? description,
    String? colorHex,
    String? fillColorHex,
    bool clearFillColor = false,
    String? strokeColorHex,
    bool clearStrokeColor = false,
    double? strokeWidth,
    double? fillOpacity,
    double? radius,
    String? lineDash,
    bool? arrowStart,
    bool? arrowEnd,
    String? displayIcon,
    bool clearDisplayIcon = false,
    List<DraftCallout>? callouts,
    Map<String, String>? customProperties,
  }) =>
      DrawnFeature(
        id: id ?? this.id,
        kind: kind,
        vertices: vertices ?? this.vertices,
        extraParts: extraParts ?? this.extraParts,
        name: name ?? this.name,
        description: description ?? this.description,
        colorHex: colorHex ?? this.colorHex,
        fillColorHex:
            clearFillColor ? null : (fillColorHex ?? this.fillColorHex),
        strokeColorHex:
            clearStrokeColor ? null : (strokeColorHex ?? this.strokeColorHex),
        strokeWidth: strokeWidth ?? this.strokeWidth,
        fillOpacity: fillOpacity ?? this.fillOpacity,
        radius: radius ?? this.radius,
        lineDash: lineDash ?? this.lineDash,
        arrowStart: arrowStart ?? this.arrowStart,
        arrowEnd: arrowEnd ?? this.arrowEnd,
        displayIcon:
            clearDisplayIcon ? null : (displayIcon ?? this.displayIcon),
        callouts: callouts ?? this.callouts,
        customProperties: customProperties ?? this.customProperties,
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

/// Pure geometry & snapping helpers for touch drawing, vertex/edge snapping,
/// and external Shelf dataset snapping.
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

  /// Finds the nearest snap target in screen space:
  /// 1. Vertex snap (draft features, active draft vertices, and visible Shelf maps)
  /// 2. Edge/segment snap (closest projected point along any draft or Shelf edge)
  static SnapMatch? findVertexSnap({
    required Offset targetScreen,
    required List<DrawnFeature> features,
    required List<Geographic> draftVertices,
    required Offset Function(Geographic) project,
    int? ignoreDraftIndex,
    List<List<Geographic>> externalSnapShapes = const <List<Geographic>>[],
    bool snapToEdges = true,
  }) {
    SnapMatch? bestVertex;
    double bestVertexDist = snapRadiusPx;

    void considerVertex(Geographic candidate, String label) {
      final projected = project(candidate);
      if (!projected.dx.isFinite || !projected.dy.isFinite) return;
      final dist = (projected - targetScreen).distance;
      if (dist <= bestVertexDist) {
        bestVertexDist = dist;
        bestVertex = SnapMatch(
          point: candidate,
          screenOffset: projected,
          label: label,
        );
      }
    }

    for (final feature in features) {
      for (final vertex in feature.vertices) {
        considerVertex(vertex, 'vertex');
      }
    }
    for (var i = 0; i < draftVertices.length; i++) {
      if (i == ignoreDraftIndex) continue;
      considerVertex(draftVertices[i], i == 0 ? 'close loop' : 'vertex');
    }
    for (final ring in externalSnapShapes) {
      for (final vertex in ring) {
        considerVertex(vertex, 'shelf vertex');
      }
    }
    if (bestVertex != null) return bestVertex;
    if (!snapToEdges) return null;

    // Priority 2: Closest point on any line or polygon segment (edge snap)
    SnapMatch? bestEdge;
    double bestEdgeDist = snapRadiusPx * 0.85;

    void considerSegment(Geographic a, Geographic b, String label) {
      final pa = project(a);
      final pb = project(b);
      if (!pa.dx.isFinite ||
          !pa.dy.isFinite ||
          !pb.dx.isFinite ||
          !pb.dy.isFinite) {
        return;
      }
      final dx = pb.dx - pa.dx;
      final dy = pb.dy - pa.dy;
      final lenSq = dx * dx + dy * dy;
      if (lenSq < 4.0) return;
      final t =
          (((targetScreen.dx - pa.dx) * dx + (targetScreen.dy - pa.dy) * dy) /
                  lenSq)
              .clamp(0.0, 1.0);
      final projPt = Offset(pa.dx + t * dx, pa.dy + t * dy);
      final dist = (projPt - targetScreen).distance;
      if (dist <= bestEdgeDist) {
        bestEdgeDist = dist;
        bestEdge = SnapMatch(
          point: Geographic(
            lon: a.lon + (b.lon - a.lon) * t,
            lat: a.lat + (b.lat - a.lat) * t,
          ),
          screenOffset: projPt,
          label: label,
        );
      }
    }

    for (final feature in features) {
      final verts = feature.vertices;
      if (verts.length < 2) continue;
      for (var i = 0; i < verts.length - 1; i++) {
        considerSegment(verts[i], verts[i + 1], 'edge');
      }
      if (feature.kind == DrawToolMode.polygon && verts.length >= 3) {
        considerSegment(verts.last, verts.first, 'edge');
      }
    }
    if (draftVertices.length >= 2) {
      for (var i = 0; i < draftVertices.length - 1; i++) {
        if (i == ignoreDraftIndex || i + 1 == ignoreDraftIndex) continue;
        considerSegment(draftVertices[i], draftVertices[i + 1], 'edge');
      }
    }
    for (final ring in externalSnapShapes) {
      if (ring.length < 2) continue;
      for (var i = 0; i < ring.length - 1; i++) {
        considerSegment(ring[i], ring[i + 1], 'shelf edge');
      }
    }
    return bestEdge;
  }

  static Geographic midpoint(Geographic a, Geographic b) => Geographic(
        lon: (a.lon + b.lon) / 2,
        lat: (a.lat + b.lat) / 2,
      );

  static double _rad(double degrees) => degrees * math.pi / 180.0;
}
