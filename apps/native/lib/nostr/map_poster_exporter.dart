import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../src/rust/api/nostr_client.dart';
import 'shelf_renderer.dart';

/// Renders a high-resolution cartographic PNG poster summarizing visible Shelf
/// maps, Working Draft features, arrowheads, Sightings, coordinate graticule,
/// scale bar, and compass rose.
Future<Uint8List> renderEarthlyMapPosterPng({
  required String title,
  required List<ShelfMapEntry> shelfMaps,
  required List<DrawnFeature> draftFeatures,
  List<SightingSummaryDto> sightings = const <SightingSummaryDto>[],
  bool isDark = false,
  GeoBox? bounds,
  int width = 1600,
  int height = 1200,
}) async {
  final effectiveBounds = _resolvePosterBounds(
    explicit: bounds,
    shelfMaps: shelfMaps,
    draftFeatures: draftFeatures,
    sightings: sightings,
  );

  final recorder = ui.PictureRecorder();
  final canvas = Canvas(
    recorder,
    Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
  );

  final bgColor = isDark ? const Color(0xFF131A22) : const Color(0xFFF6F3EC);
  final frameColor = isDark ? const Color(0xFF1B2430) : const Color(0xFFFFFFFF);
  final inkColor = isDark ? const Color(0xFFE7ECF2) : const Color(0xFF1B232B);
  final mutedColor =
      isDark ? const Color(0xFF9AA7B4) : const Color(0xFF5A6572);
  final gridColor = isDark
      ? const Color(0xFF9AA7B4).withValues(alpha: 0.16)
      : const Color(0xFF1B232B).withValues(alpha: 0.12);
  final borderColor = isDark
      ? const Color(0xFFE7ECF2).withValues(alpha: 0.24)
      : const Color(0xFF1B232B).withValues(alpha: 0.24);

  canvas.drawRect(
    Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
    Paint()..color = bgColor,
  );

  const margin = 48.0;
  final mapRect = Rect.fromLTWH(
    margin,
    margin,
    width - margin * 2,
    height - margin * 2 - 72,
  );
  canvas.drawRect(mapRect, Paint()..color = frameColor);

  canvas.save();
  canvas.clipRect(mapRect);

  final project = _MercatorProjector(effectiveBounds, mapRect);
  _drawGraticule(canvas, effectiveBounds, mapRect, project, gridColor, mutedColor);

  for (final entry in shelfMaps) {
    if (!entry.visible) continue;
    for (final shape in entry.shapes) {
      _drawPosterShape(
        canvas: canvas,
        project: project,
        kind: switch (shape.kind) {
          ShelfShapeKind.point => _PosterGeomKind.point,
          ShelfShapeKind.line => _PosterGeomKind.line,
          ShelfShapeKind.polygon => _PosterGeomKind.polygon,
        },
        coords: shape.coords,
        fillColor: _parsePosterColor(
          shape.fillColorHex ?? shape.colorHex,
          const Color(0xFF1F5F8B),
        ),
        strokeColor: _parsePosterColor(
          shape.strokeColorHex ?? shape.colorHex,
          const Color(0xFF1F5F8B),
        ),
        fillOpacity: shape.fillOpacity ?? 0.22,
        strokeWidth: (shape.strokeWidth ?? 2.8) * 1.35,
        arrowStart: shape.properties['arrowStart'] == true,
        arrowEnd: shape.properties['arrowEnd'] == true,
        label: shape.label,
        textColor: inkColor,
      );
    }
  }

  for (final feat in draftFeatures) {
    _drawPosterShape(
      canvas: canvas,
      project: project,
      kind: switch (feat.kind) {
        DrawToolMode.polygon => _PosterGeomKind.polygon,
        DrawToolMode.line => _PosterGeomKind.line,
        _ => _PosterGeomKind.point,
      },
      coords: feat.vertices,
      fillColor: _parsePosterColor(
        feat.fillColorHex ?? feat.colorHex,
        const Color(0xFFD97706),
      ),
      strokeColor: _parsePosterColor(
        feat.strokeColorHex ?? feat.colorHex,
        const Color(0xFFD97706),
      ),
      fillOpacity: feat.fillOpacity ?? 0.28,
      strokeWidth: (feat.strokeWidth ?? 3.0) * 1.4,
      arrowStart: feat.arrowStart,
      arrowEnd: feat.arrowEnd,
      label: feat.name,
      textColor: inkColor,
    );
  }

  for (final s in sightings) {
    final pt = project.toOffset(Geographic(lon: s.lon, lat: s.lat));
    canvas.drawCircle(pt, 9, Paint()..color = const Color(0xFFFFFFFF));
    canvas.drawCircle(pt, 7, Paint()..color = const Color(0xFFB45309));
  }

  _drawCompassRose(canvas, Offset(mapRect.right - 52, mapRect.top + 54), inkColor);
  _drawScaleBar(canvas, effectiveBounds, mapRect, inkColor, bgColor);

  canvas.restore();
  canvas.drawRect(
    mapRect,
    Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0
      ..color = borderColor,
  );

  // Title block below the map neatline.
  final titleStr = title.trim().isEmpty ? 'Earthly Field Map' : title.trim();
  _paintPosterText(
    canvas,
    titleStr,
    Offset(margin, mapRect.bottom + 18),
    TextStyle(
      color: inkColor,
      fontSize: 28,
      fontWeight: FontWeight.w800,
    ),
    maxWidth: width - margin * 2 - 280,
  );
  final visibleLayerCount = shelfMaps.where((e) => e.visible).length;
  final metaText =
      '$visibleLayerCount layer${visibleLayerCount == 1 ? '' : 's'} · ${draftFeatures.length} draft · ${effectiveBounds.south.toStringAsFixed(3)}°–${effectiveBounds.north.toStringAsFixed(3)}°N, ${effectiveBounds.west.toStringAsFixed(3)}°–${effectiveBounds.east.toStringAsFixed(3)}°E';
  _paintPosterText(
    canvas,
    metaText,
    Offset(margin, mapRect.bottom + 54),
    TextStyle(
      color: mutedColor,
      fontFamily: 'monospace',
      fontSize: 14,
      fontWeight: FontWeight.w600,
    ),
    maxWidth: width - margin * 2 - 280,
  );
  _paintPosterText(
    canvas,
    'EARTHLY · SOVEREIGN CARTOGRAPHY',
    Offset(width - margin - 265, mapRect.bottom + 36),
    TextStyle(
      color: mutedColor,
      fontFamily: 'monospace',
      fontSize: 13,
      fontWeight: FontWeight.w700,
      letterSpacing: 1.0,
    ),
    maxWidth: 265,
  );

  final picture = recorder.endRecording();
  final image = await picture.toImage(width, height);
  picture.dispose();
  try {
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    if (data == null) {
      throw StateError('Failed to encode map poster PNG');
    }
    return data.buffer.asUint8List();
  } finally {
    image.dispose();
  }
}

enum _PosterGeomKind { point, line, polygon }

GeoBox _resolvePosterBounds({
  required GeoBox? explicit,
  required List<ShelfMapEntry> shelfMaps,
  required List<DrawnFeature> draftFeatures,
  required List<SightingSummaryDto> sightings,
}) {
  if (explicit != null &&
      (explicit.east - explicit.west).abs() > 1e-6 &&
      (explicit.north - explicit.south).abs() > 1e-6) {
    return explicit;
  }

  double? w, s, e, n;
  void include(double lon, double lat) {
    w = w == null ? lon : math.min(w!, lon);
    s = s == null ? lat : math.min(s!, lat);
    e = e == null ? lon : math.max(e!, lon);
    n = n == null ? lat : math.max(n!, lat);
  }

  for (final entry in shelfMaps) {
    if (!entry.visible) continue;
    for (final shape in entry.shapes) {
      for (final c in shape.coords) {
        include(c.lon, c.lat);
      }
    }
  }
  for (final f in draftFeatures) {
    for (final v in f.vertices) {
      include(v.lon, v.lat);
    }
  }
  for (final pt in sightings) {
    include(pt.lon, pt.lat);
  }

  if (w == null || s == null || e == null || n == null) {
    return const GeoBox(west: 16.34, south: 48.19, east: 16.41, north: 48.23);
  }
  final dLon = math.max((e! - w!) * 0.14, 0.004);
  final dLat = math.max((n! - s!) * 0.14, 0.003);
  return GeoBox(
    west: (w! - dLon).clamp(-180.0, 180.0),
    south: (s! - dLat).clamp(-84.0, 84.0),
    east: (e! + dLon).clamp(-180.0, 180.0),
    north: (n! + dLat).clamp(-84.0, 84.0),
  );
}

class _MercatorProjector {
  _MercatorProjector(GeoBox bounds, this.rect) {
    final minX = _mercX(bounds.west);
    final maxX = _mercX(bounds.east);
    final minY = _mercY(bounds.north);
    final maxY = _mercY(bounds.south);
    final spanX = math.max(maxX - minX, 1e-9);
    final spanY = math.max(maxY - minY, 1e-9);
    final scale = math.min(rect.width / spanX, rect.height / spanY);
    _scale = scale;
    _originX = rect.left + (rect.width - spanX * scale) / 2 - minX * scale;
    _originY = rect.top + (rect.height - spanY * scale) / 2 - minY * scale;
  }

  final Rect rect;
  late final double _scale;
  late final double _originX;
  late final double _originY;

  static double _mercX(double lon) => (lon + 180.0) / 360.0;

  static double _mercY(double lat) {
    final rad = lat.clamp(-85.0, 85.0) * math.pi / 180.0;
    return (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0;
  }

  Offset toOffset(Geographic g) => Offset(
        _originX + _mercX(g.lon) * _scale,
        _originY + _mercY(g.lat) * _scale,
      );
}

Color _parsePosterColor(String? raw, Color fallback) {
  if (raw == null || raw.isEmpty) return fallback;
  final s = raw.trim();
  if (s.startsWith('#') && s.length == 7) {
    final v = int.tryParse(s.substring(1), radix: 16);
    if (v != null) return Color(0xFF000000 | v);
  }
  return fallback;
}

void _drawGraticule(
  Canvas canvas,
  GeoBox bounds,
  Rect rect,
  _MercatorProjector project,
  Color gridColor,
  Color labelColor,
) {
  final linePaint = Paint()
    ..color = gridColor
    ..strokeWidth = 1.0;
  for (var i = 1; i <= 3; i++) {
    final f = i / 4.0;
    final lon = bounds.west + (bounds.east - bounds.west) * f;
    final x = project.toOffset(Geographic(lon: lon, lat: bounds.north)).dx;
    canvas.drawLine(Offset(x, rect.top), Offset(x, rect.bottom), linePaint);
    _paintPosterText(
      canvas,
      '${lon.toStringAsFixed(3)}°',
      Offset(x + 4, rect.top + 6),
      TextStyle(color: labelColor, fontFamily: 'monospace', fontSize: 10),
    );
    final lat = bounds.south + (bounds.north - bounds.south) * f;
    final y = project.toOffset(Geographic(lon: bounds.west, lat: lat)).dy;
    canvas.drawLine(Offset(rect.left, y), Offset(rect.right, y), linePaint);
    _paintPosterText(
      canvas,
      '${lat.toStringAsFixed(3)}°',
      Offset(rect.left + 6, y + 3),
      TextStyle(color: labelColor, fontFamily: 'monospace', fontSize: 10),
    );
  }
}

void _drawPosterShape({
  required Canvas canvas,
  required _MercatorProjector project,
  required _PosterGeomKind kind,
  required List<Geographic> coords,
  required Color fillColor,
  required Color strokeColor,
  required double fillOpacity,
  required double strokeWidth,
  required bool arrowStart,
  required bool arrowEnd,
  required String? label,
  required Color textColor,
}) {
  if (coords.isEmpty) return;
  final pts = coords.map(project.toOffset).toList(growable: false);
  switch (kind) {
    case _PosterGeomKind.polygon:
      if (pts.length < 3) return;
      final path = Path()..addPolygon(pts, true);
      canvas.drawPath(
        path,
        Paint()..color = fillColor.withValues(alpha: fillOpacity.clamp(0.08, 0.85)),
      );
      canvas.drawPath(
        path,
        Paint()
          ..color = strokeColor
          ..style = PaintingStyle.stroke
          ..strokeWidth = strokeWidth
          ..strokeJoin = StrokeJoin.round,
      );
      if (label != null && label.trim().isNotEmpty) {
        final cx = pts.fold<double>(0, (s, p) => s + p.dx) / pts.length;
        final cy = pts.fold<double>(0, (s, p) => s + p.dy) / pts.length;
        _paintPosterText(
          canvas,
          label.trim(),
          Offset(cx + 6, cy - 8),
          TextStyle(color: textColor, fontSize: 12, fontWeight: FontWeight.w700),
        );
      }
    case _PosterGeomKind.line:
      if (pts.length < 2) return;
      final path = Path()..addPolygon(pts, false);
      canvas.drawPath(
        path,
        Paint()
          ..color = strokeColor
          ..style = PaintingStyle.stroke
          ..strokeWidth = strokeWidth
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round,
      );
      if (arrowStart) _drawArrowhead(canvas, pts.first, pts[1], strokeColor, strokeWidth);
      if (arrowEnd) {
        _drawArrowhead(canvas, pts.last, pts[pts.length - 2], strokeColor, strokeWidth);
      }
      if (label != null && label.trim().isNotEmpty) {
        final mid = pts[pts.length ~/ 2];
        _paintPosterText(
          canvas,
          label.trim(),
          Offset(mid.dx + 6, mid.dy - 14),
          TextStyle(color: textColor, fontSize: 12, fontWeight: FontWeight.w700),
        );
      }
    case _PosterGeomKind.point:
      final pt = pts.first;
      canvas.drawCircle(pt, 9, Paint()..color = strokeColor);
      canvas.drawCircle(pt, 6.5, Paint()..color = fillColor);
      if (label != null && label.trim().isNotEmpty) {
        _paintPosterText(
          canvas,
          label.trim(),
          Offset(pt.dx + 12, pt.dy - 7),
          TextStyle(color: textColor, fontSize: 12, fontWeight: FontWeight.w700),
        );
      }
  }
}

void _drawArrowhead(
  Canvas canvas,
  Offset tip,
  Offset from,
  Color color,
  double strokeWidth,
) {
  final dir = tip - from;
  if (dir.distance < 1.0) return;
  final angle = math.atan2(dir.dy, dir.dx);
  final size = 12.0 + strokeWidth * 1.4;
  const spread = 0.45;
  final left = Offset(
    tip.dx - size * math.cos(angle - spread),
    tip.dy - size * math.sin(angle - spread),
  );
  final right = Offset(
    tip.dx - size * math.cos(angle + spread),
    tip.dy - size * math.sin(angle + spread),
  );
  final path = Path()
    ..moveTo(tip.dx, tip.dy)
    ..lineTo(left.dx, left.dy)
    ..lineTo(right.dx, right.dy)
    ..close();
  canvas.drawPath(path, Paint()..color = color);
}

void _drawCompassRose(Canvas canvas, Offset center, Color color) {
  canvas.drawCircle(
    center,
    24,
    Paint()
      ..color = color.withValues(alpha: 0.28)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6,
  );
  final north = Path()
    ..moveTo(center.dx, center.dy - 20)
    ..lineTo(center.dx - 6, center.dy)
    ..lineTo(center.dx + 6, center.dy)
    ..close();
  canvas.drawPath(north, Paint()..color = color);
  _paintPosterText(
    canvas,
    'N',
    Offset(center.dx - 5, center.dy + 4),
    TextStyle(
      color: color,
      fontFamily: 'monospace',
      fontSize: 12,
      fontWeight: FontWeight.w800,
    ),
  );
}

void _drawScaleBar(
  Canvas canvas,
  GeoBox bounds,
  Rect mapRect,
  Color inkColor,
  Color bgColor,
) {
  final midLat = (bounds.south + bounds.north) / 2.0;
  final metersAcross = DrawingMath.distanceMeters(
    Geographic(lon: bounds.west, lat: midLat),
    Geographic(lon: bounds.east, lat: midLat),
  );
  final targetMeters = metersAcross * 0.18;
  const niceSteps = <double>[
    50,
    100,
    250,
    500,
    1000,
    2000,
    5000,
    10000,
    25000,
    50000,
    100000,
  ];
  var chosen = niceSteps.first;
  for (final s in niceSteps) {
    if (s <= targetMeters) chosen = s;
  }
  final barWidth = ((chosen / math.max(metersAcross, 1.0)) * mapRect.width)
      .clamp(48.0, mapRect.width * 0.35);
  final origin = Offset(mapRect.right - barWidth - 26, mapRect.bottom - 26);
  canvas.drawRect(
    Rect.fromLTWH(origin.dx - 8, origin.dy - 22, barWidth + 16, 32),
    Paint()..color = bgColor.withValues(alpha: 0.86),
  );
  canvas.drawLine(
    origin,
    Offset(origin.dx + barWidth, origin.dy),
    Paint()
      ..color = inkColor
      ..strokeWidth = 3.0,
  );
  canvas.drawLine(
    Offset(origin.dx, origin.dy - 6),
    Offset(origin.dx, origin.dy + 2),
    Paint()
      ..color = inkColor
      ..strokeWidth = 2.5,
  );
  canvas.drawLine(
    Offset(origin.dx + barWidth, origin.dy - 6),
    Offset(origin.dx + barWidth, origin.dy + 2),
    Paint()
      ..color = inkColor
      ..strokeWidth = 2.5,
  );
  final label = chosen >= 1000
      ? '${(chosen / 1000).toStringAsFixed(chosen % 1000 == 0 ? 0 : 1)} km'
      : '${chosen.round()} m';
  _paintPosterText(
    canvas,
    label,
    Offset(origin.dx + 4, origin.dy - 19),
    TextStyle(
      color: inkColor,
      fontFamily: 'monospace',
      fontSize: 11,
      fontWeight: FontWeight.w700,
    ),
  );
}

void _paintPosterText(
  Canvas canvas,
  String text,
  Offset offset,
  TextStyle style, {
  double maxWidth = 420,
}) {
  final painter = TextPainter(
    text: TextSpan(text: text, style: style),
    textDirection: TextDirection.ltr,
    maxLines: 1,
    ellipsis: '…',
  )..layout(maxWidth: maxWidth);
  painter.paint(canvas, offset);
}
