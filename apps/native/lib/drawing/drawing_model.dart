import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';
import 'package:maplibre/maplibre.dart';

enum DrawToolMode {
  browse,
  select,
  boxSelect,
  editVertices,
  point,
  line,
  polygon,
  arrow,
  freehand,
  shape,
  annotation,
  splitByLine,
  measure,
}

/// Top-level contextual toolbar group for a [DrawToolMode].
enum DrawToolGroup {
  select,
  draw,
  shapesSpatial,
}

extension DrawToolModeMeta on DrawToolMode {
  /// Returns the contextual toolbar group for this mode, or `null` for [browse].
  DrawToolGroup? get toolGroup => switch (this) {
        DrawToolMode.browse => null,
        DrawToolMode.select ||
        DrawToolMode.editVertices ||
        DrawToolMode.boxSelect =>
          DrawToolGroup.select,
        DrawToolMode.point ||
        DrawToolMode.line ||
        DrawToolMode.polygon ||
        DrawToolMode.freehand ||
        DrawToolMode.arrow ||
        DrawToolMode.annotation =>
          DrawToolGroup.draw,
        DrawToolMode.shape ||
        DrawToolMode.splitByLine ||
        DrawToolMode.measure =>
          DrawToolGroup.shapesSpatial,
      };

  /// Whether this tool accepts center-reticle vertex drops in Crosshair mode.
  bool get supportsCrosshairDrop => switch (this) {
        DrawToolMode.point ||
        DrawToolMode.line ||
        DrawToolMode.polygon ||
        DrawToolMode.arrow ||
        DrawToolMode.annotation ||
        DrawToolMode.splitByLine ||
        DrawToolMode.measure =>
          true,
        DrawToolMode.browse ||
        DrawToolMode.select ||
        DrawToolMode.editVertices ||
        DrawToolMode.boxSelect ||
        DrawToolMode.freehand ||
        DrawToolMode.shape =>
          false,
      };

  /// Whether this tool accumulates multiple draft vertices in a stroke.
  bool get isMultiPointStrokeTool => switch (this) {
        DrawToolMode.line ||
        DrawToolMode.polygon ||
        DrawToolMode.arrow ||
        DrawToolMode.splitByLine ||
        DrawToolMode.measure =>
          true,
        _ => false,
      };
}

enum PrimitiveShapeKind {
  circle,
  square,
  rectangle,
  triangle,
  diamond,
  hexagon,
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

  static double polylineLengthMeters(List<Geographic> pts) {
    if (pts.length < 2) return 0.0;
    var total = 0.0;
    for (var i = 1; i < pts.length; i++) {
      total += distanceMeters(pts[i - 1], pts[i]);
    }
    return total;
  }

  /// Pure-Dart Douglas-Peucker polyline simplification in metric tangent space.
  static List<Geographic> simplifyPolyline(
    List<Geographic> pts, {
    double toleranceMeters = 4.0,
  }) {
    if (pts.length <= 2 || toleranceMeters <= 0) {
      return List<Geographic>.from(pts);
    }
    final refLat = pts.first.lat;
    final refLon = pts.first.lon;
    const metersPerDegLat = 111320.0;
    final metersPerDegLon =
        metersPerDegLat * math.cos(_rad(refLat)).clamp(0.05, 1.0);

    Offset toMeters(Geographic g) => Offset(
          (g.lon - refLon) * metersPerDegLon,
          (g.lat - refLat) * metersPerDegLat,
        );

    final projected = pts.map(toMeters).toList(growable: false);
    final keep = List<bool>.filled(pts.length, false);
    keep[0] = true;
    keep[pts.length - 1] = true;

    void dp(int start, int end) {
      if (end <= start + 1) return;
      final a = projected[start];
      final b = projected[end];
      final dx = b.dx - a.dx;
      final dy = b.dy - a.dy;
      final lenSq = dx * dx + dy * dy;

      var maxDist = -1.0;
      var maxIdx = -1;
      for (var i = start + 1; i < end; i++) {
        final p = projected[i];
        final double dist;
        if (lenSq < 1e-9) {
          dist = (p - a).distance;
        } else {
          final t = (((p.dx - a.dx) * dx + (p.dy - a.dy) * dy) / lenSq)
              .clamp(0.0, 1.0);
          final proj = Offset(a.dx + t * dx, a.dy + t * dy);
          dist = (p - proj).distance;
        }
        if (dist > maxDist) {
          maxDist = dist;
          maxIdx = i;
        }
      }

      if (maxDist > toleranceMeters && maxIdx > start && maxIdx < end) {
        keep[maxIdx] = true;
        dp(start, maxIdx);
        dp(maxIdx, end);
      }
    }

    dp(0, pts.length - 1);
    return <Geographic>[
      for (var i = 0; i < pts.length; i++)
        if (keep[i]) pts[i],
    ];
  }

  /// Generates a polygon ring of geographic vertices from a center-to-edge
  /// screen drag for the given [PrimitiveShapeKind].
  static List<Geographic> computeShapeRingFromScreenDrag({
    required PrimitiveShapeKind shape,
    required Offset anchorScreen,
    required Offset currentScreen,
    required Geographic Function(Offset) unproject,
    int circleSteps = 36,
  }) {
    final dx = currentScreen.dx - anchorScreen.dx;
    final dy = currentScreen.dy - anchorScreen.dy;
    final r = math.sqrt(dx * dx + dy * dy);
    if (r < 2.0) return const <Geographic>[];

    final screenRing = <Offset>[];
    switch (shape) {
      case PrimitiveShapeKind.circle:
        final steps = math.max(8, circleSteps);
        for (var i = 0; i < steps; i++) {
          final theta = (2 * math.pi * i) / steps;
          screenRing.add(
            Offset(
              anchorScreen.dx + r * math.cos(theta),
              anchorScreen.dy + r * math.sin(theta),
            ),
          );
        }
      case PrimitiveShapeKind.square:
        final h = math.max(dx.abs(), dy.abs());
        screenRing.addAll(<Offset>[
          Offset(anchorScreen.dx - h, anchorScreen.dy - h),
          Offset(anchorScreen.dx + h, anchorScreen.dy - h),
          Offset(anchorScreen.dx + h, anchorScreen.dy + h),
          Offset(anchorScreen.dx - h, anchorScreen.dy + h),
        ]);
      case PrimitiveShapeKind.rectangle:
        final hw = dx.abs() < 2.0 ? 2.0 : dx.abs();
        final hh = dy.abs() < 2.0 ? 2.0 : dy.abs();
        screenRing.addAll(<Offset>[
          Offset(anchorScreen.dx - hw, anchorScreen.dy - hh),
          Offset(anchorScreen.dx + hw, anchorScreen.dy - hh),
          Offset(anchorScreen.dx + hw, anchorScreen.dy + hh),
          Offset(anchorScreen.dx - hw, anchorScreen.dy + hh),
        ]);
      case PrimitiveShapeKind.triangle:
        for (var i = 0; i < 3; i++) {
          final theta = -math.pi / 2 + (2 * math.pi * i) / 3;
          screenRing.add(
            Offset(
              anchorScreen.dx + r * math.cos(theta),
              anchorScreen.dy + r * math.sin(theta),
            ),
          );
        }
      case PrimitiveShapeKind.diamond:
        screenRing.addAll(<Offset>[
          Offset(anchorScreen.dx, anchorScreen.dy - r),
          Offset(anchorScreen.dx + r, anchorScreen.dy),
          Offset(anchorScreen.dx, anchorScreen.dy + r),
          Offset(anchorScreen.dx - r, anchorScreen.dy),
        ]);
      case PrimitiveShapeKind.hexagon:
        for (var i = 0; i < 6; i++) {
          final theta = -math.pi / 2 + (2 * math.pi * i) / 6;
          screenRing.add(
            Offset(
              anchorScreen.dx + r * math.cos(theta),
              anchorScreen.dy + r * math.sin(theta),
            ),
          );
        }
    }

    return screenRing.map(unproject).toList(growable: false);
  }

  static String formatShapeTelemetry({
    required PrimitiveShapeKind shape,
    required Geographic anchorGeo,
    required Geographic currentGeo,
    required Offset anchorScreen,
    required Offset currentScreen,
  }) {
    final label = shape.name.toUpperCase();
    if (shape == PrimitiveShapeKind.rectangle) {
      final widthM = distanceMeters(
            anchorGeo,
            Geographic(lon: currentGeo.lon, lat: anchorGeo.lat),
          ) *
          2;
      final heightM = distanceMeters(
            anchorGeo,
            Geographic(lon: anchorGeo.lon, lat: currentGeo.lat),
          ) *
          2;
      return '$label · ${formatDistance(widthM)} × ${formatDistance(heightM)}';
    }
    final radiusM = distanceMeters(anchorGeo, currentGeo);
    return '$label · r ${formatDistance(radiusM)}';
  }

  static DrawnFeature? hitTestDraftFeature({
    required Offset tapScreen,
    required List<DrawnFeature> features,
    required Offset Function(Geographic) project,
    double hitRadiusPx = 22.0,
  }) {
    DrawnFeature? bestFeature;
    var bestScore = double.infinity;

    for (var fi = features.length - 1; fi >= 0; fi--) {
      final feature = features[fi];
      var featureDist = double.infinity;

      for (final part in feature.allParts) {
        if (part.isEmpty) continue;
        if (feature.kind == DrawToolMode.point || part.length == 1) {
          final p = project(part.first);
          if (p.dx.isFinite && p.dy.isFinite) {
            featureDist = math.min(featureDist, (p - tapScreen).distance);
          }
          continue;
        }

        final projected = <Offset>[];
        for (final v in part) {
          final p = project(v);
          if (p.dx.isFinite && p.dy.isFinite) {
            projected.add(p);
          }
        }
        if (projected.isEmpty) continue;

        for (var i = 0; i < projected.length - 1; i++) {
          featureDist = math.min(
            featureDist,
            _pointToSegmentDistance(tapScreen, projected[i], projected[i + 1]),
          );
        }
        if (feature.kind == DrawToolMode.polygon && projected.length >= 3) {
          featureDist = math.min(
            featureDist,
            _pointToSegmentDistance(tapScreen, projected.last, projected.first),
          );
          if (_isPointInScreenPolygon(tapScreen, projected)) {
            // Prefer edge-close points/lines over polygon interiors when both match,
            // while still hitting large polygon interiors reliably.
            featureDist = math.min(featureDist, hitRadiusPx * 0.65);
          }
        }
      }

      if (featureDist <= hitRadiusPx && featureDist < bestScore) {
        bestScore = featureDist;
        bestFeature = feature;
      }
    }
    return bestFeature;
  }

  static List<DrawnFeature> selectFeaturesInScreenRect({
    required Rect rect,
    required List<DrawnFeature> features,
    required Offset Function(Geographic) project,
  }) {
    final normRect = Rect.fromLTRB(
      math.min(rect.left, rect.right),
      math.min(rect.top, rect.bottom),
      math.max(rect.left, rect.right),
      math.max(rect.top, rect.bottom),
    );
    final selected = <DrawnFeature>[];
    for (final feature in features) {
      var matched = false;
      for (final part in feature.allParts) {
        if (part.isEmpty) continue;
        final projected = <Offset>[];
        for (final v in part) {
          final p = project(v);
          if (!p.dx.isFinite || !p.dy.isFinite) continue;
          projected.add(p);
          if (normRect.contains(p)) {
            matched = true;
            break;
          }
        }
        if (matched) break;

        for (var i = 0; i < projected.length - 1; i++) {
          if (_segmentIntersectsRect(projected[i], projected[i + 1], normRect)) {
            matched = true;
            break;
          }
        }
        if (matched) break;

        if (feature.kind == DrawToolMode.polygon && projected.length >= 3) {
          if (_segmentIntersectsRect(projected.last, projected.first, normRect) ||
              _isPointInScreenPolygon(normRect.center, projected)) {
            matched = true;
            break;
          }
        }
      }
      if (matched) {
        selected.add(feature);
      }
    }
    return selected;
  }

  static const double minTransformScale = 0.2;
  static const double maxTransformScale = 5.0;

  static Rect? computeFeatureScreenBounds({
    required DrawnFeature feature,
    required Offset Function(Geographic) project,
  }) {
    var minX = double.infinity;
    var minY = double.infinity;
    var maxX = double.negativeInfinity;
    var maxY = double.negativeInfinity;
    var count = 0;

    for (final part in feature.allParts) {
      for (final v in part) {
        final p = project(v);
        if (!p.dx.isFinite || !p.dy.isFinite) continue;
        if (p.dx < minX) minX = p.dx;
        if (p.dy < minY) minY = p.dy;
        if (p.dx > maxX) maxX = p.dx;
        if (p.dy > maxY) maxY = p.dy;
        count += 1;
      }
    }
    if (count == 0) return null;
    return Rect.fromLTRB(minX, minY, maxX, maxY);
  }

  static DrawnFeature translateFeatureVertices({
    required DrawnFeature feature,
    required Offset deltaScreen,
    required Offset Function(Geographic) project,
    required Geographic Function(Offset) unproject,
  }) {
    List<Geographic> shiftPart(List<Geographic> part) => [
          for (final v in part) unproject(project(v) + deltaScreen),
        ];

    return feature.copyWith(
      vertices: List<Geographic>.unmodifiable(shiftPart(feature.vertices)),
      extraParts: feature.extraParts.isEmpty
          ? const <List<Geographic>>[]
          : [
              for (final part in feature.extraParts)
                List<Geographic>.unmodifiable(shiftPart(part)),
            ],
    );
  }

  /// Rotates and scales all vertices (including multipart [extraParts]) in
  /// screen space around [pivotScreen] (defaults to projected [featureCentroid]).
  /// Scale is clamped to `[minTransformScale, maxTransformScale]` (`0.2..5.0`).
  static DrawnFeature rotateAndScaleFeatureVertices({
    required DrawnFeature feature,
    required double rotateDeg,
    required double scale,
    required Offset Function(Geographic) project,
    required Geographic Function(Offset) unproject,
    Offset? pivotScreen,
  }) {
    final safeScale =
        scale.isFinite ? scale.clamp(minTransformScale, maxTransformScale) : 1.0;
    final safeRotateDeg = rotateDeg.isFinite ? rotateDeg : 0.0;
    if (safeRotateDeg == 0.0 && safeScale == 1.0) return feature;

    Offset? pivot = pivotScreen;
    if (pivot == null) {
      final centroid = featureCentroid(feature);
      if (centroid == null) return feature;
      final projectedCentroid = project(centroid);
      if (!projectedCentroid.dx.isFinite || !projectedCentroid.dy.isFinite) {
        return feature;
      }
      pivot = projectedCentroid;
    } else if (!pivot.dx.isFinite || !pivot.dy.isFinite) {
      return feature;
    }

    if (pivotScreen == null &&
        feature.vertices.length <= 1 &&
        !feature.isMultipart) {
      return feature;
    }

    final rad = _rad(safeRotateDeg);
    final cosA = math.cos(rad);
    final sinA = math.sin(rad);

    Offset transformPoint(Offset p) {
      final dx = (p.dx - pivot!.dx) * safeScale;
      final dy = (p.dy - pivot.dy) * safeScale;
      return Offset(
        pivot.dx + dx * cosA - dy * sinA,
        pivot.dy + dx * sinA + dy * cosA,
      );
    }

    List<Geographic> transformPart(List<Geographic> part) => [
          for (final v in part)
            () {
              final projected = project(v);
              if (!projected.dx.isFinite || !projected.dy.isFinite) return v;
              return unproject(transformPoint(projected));
            }(),
        ];

    return feature.copyWith(
      vertices: List<Geographic>.unmodifiable(transformPart(feature.vertices)),
      extraParts: feature.extraParts.isEmpty
          ? const <List<Geographic>>[]
          : [
              for (final part in feature.extraParts)
                List<Geographic>.unmodifiable(transformPart(part)),
            ],
    );
  }

  static Geographic? featureCentroid(DrawnFeature feature) {
    final pts = <Geographic>[];
    for (final part in feature.allParts) {
      if (part.isEmpty) continue;
      final limit = (feature.kind == DrawToolMode.polygon &&
              part.length > 3 &&
              part.first.lon == part.last.lon &&
              part.first.lat == part.last.lat)
          ? part.length - 1
          : part.length;
      for (var i = 0; i < limit; i++) {
        pts.add(part[i]);
      }
    }
    if (pts.isEmpty) return null;
    var sumLon = 0.0;
    var sumLat = 0.0;
    for (final p in pts) {
      sumLon += p.lon;
      sumLat += p.lat;
    }
    return Geographic(lon: sumLon / pts.length, lat: sumLat / pts.length);
  }

  /// Pure-Dart line-by-line splitter: splits [line] into 2+ sub-polylines
  /// at every intersection with [cutter]. Returns empty if no interior cross.
  static List<List<Geographic>> splitLineByLine(
    List<Geographic> line,
    List<Geographic> cutter,
  ) {
    if (line.length < 2 || cutter.length < 2) return const <List<Geographic>>[];
    final refLat = line.first.lat;
    final refLon = line.first.lon;
    const metersPerDegLat = 111320.0;
    final metersPerDegLon =
        metersPerDegLat * math.cos(_rad(refLat)).clamp(0.05, 1.0);

    Offset toM(Geographic g) => Offset(
          (g.lon - refLon) * metersPerDegLon,
          (g.lat - refLat) * metersPerDegLat,
        );

    final hits = <({int seg, double t, Geographic pt})>[];
    for (var i = 0; i < line.length - 1; i++) {
      final a = toM(line[i]);
      final b = toM(line[i + 1]);
      for (var j = 0; j < cutter.length - 1; j++) {
        final c = toM(cutter[j]);
        final d = toM(cutter[j + 1]);
        final hit = _segmentIntersectionParams(a, b, c, d);
        if (hit == null) continue;
        final t = hit.t;
        if (i == 0 && t < 1e-4) continue;
        if (i == line.length - 2 && t > 1.0 - 1e-4) continue;
        final pt = Geographic(
          lon: line[i].lon + (line[i + 1].lon - line[i].lon) * t,
          lat: line[i].lat + (line[i + 1].lat - line[i].lat) * t,
        );
        hits.add((seg: i, t: t, pt: pt));
      }
    }
    if (hits.isEmpty) return const <List<Geographic>>[];
    hits.sort((a, b) {
      final sc = a.seg.compareTo(b.seg);
      return sc != 0 ? sc : a.t.compareTo(b.t);
    });

    final dedupHits = <({int seg, double t, Geographic pt})>[];
    for (final h in hits) {
      if (dedupHits.isEmpty ||
          distanceMeters(dedupHits.last.pt, h.pt) > 0.05) {
        dedupHits.add(h);
      }
    }
    if (dedupHits.isEmpty) return const <List<Geographic>>[];

    final parts = <List<Geographic>>[];
    var current = <Geographic>[line.first];
    var hitIdx = 0;
    for (var i = 0; i < line.length - 1; i++) {
      while (hitIdx < dedupHits.length && dedupHits[hitIdx].seg == i) {
        final h = dedupHits[hitIdx];
        if (current.isEmpty || distanceMeters(current.last, h.pt) > 1e-3) {
          current.add(h.pt);
        }
        if (current.length >= 2) {
          parts.add(List<Geographic>.unmodifiable(current));
        }
        current = <Geographic>[h.pt];
        hitIdx += 1;
      }
      final nextPt = line[i + 1];
      if (current.isEmpty || distanceMeters(current.last, nextPt) > 1e-3) {
        current.add(nextPt);
      }
    }
    if (current.length >= 2) {
      parts.add(List<Geographic>.unmodifiable(current));
    }
    return parts.length >= 2 ? parts : const <List<Geographic>>[];
  }

  /// Pure-Dart fallback polygon-by-line splitter for simple rings when native
  /// Rust FFI is unavailable (e.g. headless unit tests).
  static List<List<Geographic>> splitPolygonByLine(
    List<Geographic> ring,
    List<Geographic> cutter,
  ) {
    final verts = List<Geographic>.from(ring);
    if (verts.length > 3 &&
        verts.first.lon == verts.last.lon &&
        verts.first.lat == verts.last.lat) {
      verts.removeLast();
    }
    if (verts.length < 3 || cutter.length < 2) {
      return const <List<Geographic>>[];
    }
    final refLat = verts.first.lat;
    final refLon = verts.first.lon;
    const metersPerDegLat = 111320.0;
    final metersPerDegLon =
        metersPerDegLat * math.cos(_rad(refLat)).clamp(0.05, 1.0);
    Offset toM(Geographic g) => Offset(
          (g.lon - refLon) * metersPerDegLon,
          (g.lat - refLat) * metersPerDegLat,
        );

    final crossings = <({
      int edge,
      double edgeT,
      int cutterSeg,
      double cutterT,
      Geographic pt,
    })>[];
    final n = verts.length;
    for (var i = 0; i < n; i++) {
      final aGeo = verts[i];
      final bGeo = verts[(i + 1) % n];
      final a = toM(aGeo);
      final b = toM(bGeo);
      for (var j = 0; j < cutter.length - 1; j++) {
        final c = toM(cutter[j]);
        final d = toM(cutter[j + 1]);
        final hit = _segmentIntersectionParams(a, b, c, d);
        if (hit == null) continue;
        final pt = Geographic(
          lon: aGeo.lon + (bGeo.lon - aGeo.lon) * hit.t,
          lat: aGeo.lat + (bGeo.lat - aGeo.lat) * hit.t,
        );
        crossings.add((
          edge: i,
          edgeT: hit.t,
          cutterSeg: j,
          cutterT: hit.u,
          pt: pt,
        ));
      }
    }
    if (crossings.length < 2) return const <List<Geographic>>[];
    crossings.sort((a, b) {
      final sc = a.cutterSeg.compareTo(b.cutterSeg);
      return sc != 0 ? sc : a.cutterT.compareTo(b.cutterT);
    });

    final dedup = <({
      int edge,
      double edgeT,
      int cutterSeg,
      double cutterT,
      Geographic pt,
    })>[];
    for (final c in crossings) {
      if (dedup.isEmpty || distanceMeters(dedup.last.pt, c.pt) > 0.05) {
        dedup.add(c);
      }
    }
    if (dedup.length < 2) return const <List<Geographic>>[];

    final c0 = dedup.first;
    final c1 = dedup.last;
    final cutterInner = <Geographic>[];
    for (var k = c0.cutterSeg + 1; k <= c1.cutterSeg; k++) {
      if (k < cutter.length) cutterInner.add(cutter[k]);
    }

    List<Geographic> buildRing({
      required int startEdge,
      required double startT,
      required Geographic startPt,
      required int endEdge,
      required double endT,
      required Geographic endPt,
      required List<Geographic> bridgeFromEndToStart,
    }) {
      final out = <Geographic>[startPt];
      if (startEdge == endEdge && startT < endT) {
        out.add(endPt);
      } else {
        var idx = (startEdge + 1) % n;
        final stopIdx = (endEdge + 1) % n;
        var guard = 0;
        while (idx != stopIdx && guard <= n) {
          out.add(verts[idx]);
          idx = (idx + 1) % n;
          guard += 1;
        }
        if (startEdge == endEdge && startT >= endT) {
          for (var k = 0; k < n; k++) {
            out.add(verts[(startEdge + 1 + k) % n]);
          }
        }
        out.add(endPt);
      }
      out.addAll(bridgeFromEndToStart);
      return out;
    }

    final ringA = buildRing(
      startEdge: c0.edge,
      startT: c0.edgeT,
      startPt: c0.pt,
      endEdge: c1.edge,
      endT: c1.edgeT,
      endPt: c1.pt,
      bridgeFromEndToStart: cutterInner.reversed.toList(growable: false),
    );
    final ringB = buildRing(
      startEdge: c1.edge,
      startT: c1.edgeT,
      startPt: c1.pt,
      endEdge: c0.edge,
      endT: c0.edgeT,
      endPt: c0.pt,
      bridgeFromEndToStart: cutterInner,
    );
    if (ringA.length < 3 || ringB.length < 3) {
      return const <List<Geographic>>[];
    }
    return <List<Geographic>>[ringA, ringB];
  }

  static ({double t, double u})? _segmentIntersectionParams(
    Offset a,
    Offset b,
    Offset c,
    Offset d,
  ) {
    final rdx = b.dx - a.dx;
    final rdy = b.dy - a.dy;
    final sdx = d.dx - c.dx;
    final sdy = d.dy - c.dy;
    final denom = rdx * sdy - rdy * sdx;
    if (denom.abs() < 1e-9) return null;
    final qpx = c.dx - a.dx;
    final qpy = c.dy - a.dy;
    final t = (qpx * sdy - qpy * sdx) / denom;
    final u = (qpx * rdy - qpy * rdx) / denom;
    if (t >= 0.0 && t <= 1.0 && u >= 0.0 && u <= 1.0) {
      return (t: t, u: u);
    }
    return null;
  }

  static double _pointToSegmentDistance(Offset p, Offset a, Offset b) {
    final dx = b.dx - a.dx;
    final dy = b.dy - a.dy;
    final lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return (p - a).distance;
    final t = (((p.dx - a.dx) * dx + (p.dy - a.dy) * dy) / lenSq).clamp(0.0, 1.0);
    return (p - Offset(a.dx + t * dx, a.dy + t * dy)).distance;
  }

  static bool _isPointInScreenPolygon(Offset p, List<Offset> ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      final xi = ring[i].dx;
      final yi = ring[i].dy;
      final xj = ring[j].dx;
      final yj = ring[j].dy;
      final intersects = ((yi > p.dy) != (yj > p.dy)) &&
          (p.dx < (xj - xi) * (p.dy - yi) / ((yj - yi) == 0 ? 1e-9 : (yj - yi)) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  static bool _segmentIntersectsRect(Offset a, Offset b, Rect rect) {
    if (rect.contains(a) || rect.contains(b)) return true;
    final tl = rect.topLeft;
    final tr = rect.topRight;
    final br = rect.bottomRight;
    final bl = rect.bottomLeft;
    return _segmentIntersectionParams(a, b, tl, tr) != null ||
        _segmentIntersectionParams(a, b, tr, br) != null ||
        _segmentIntersectionParams(a, b, br, bl) != null ||
        _segmentIntersectionParams(a, b, bl, tl) != null;
  }

  static double _rad(double degrees) => degrees * math.pi / 180.0;
}
