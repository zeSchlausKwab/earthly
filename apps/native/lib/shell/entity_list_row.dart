import 'dart:convert';
import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';

/// Standard HTTP headers so Wikimedia Commons & Blossom servers serve images
/// reliably on Android & macOS without blocking Dart's default User-Agent.
const Map<String, String> earthlyImageHeaders = <String, String>{
  'User-Agent': 'EarthlyNative/1.0 (+https://earthly.city)',
};

/// Network image with Earthly User-Agent headers, subtle loading state, and
/// clean error fallback.
class EarthlyNetworkImage extends StatelessWidget {
  const EarthlyNetworkImage({
    required this.url,
    required this.fallback,
    this.fit = BoxFit.cover,
    this.width,
    this.height,
    super.key,
  });

  final String url;
  final Widget fallback;
  final BoxFit fit;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Image.network(
      url,
      headers: earthlyImageHeaders,
      width: width,
      height: height,
      fit: fit,
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return Container(
          width: width,
          height: height,
          color: theme.colorScheme.surfaceContainerHighest,
          child: Center(
            child: SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 1.8,
                value: progress.expectedTotalBytes != null
                    ? progress.cumulativeBytesLoaded /
                        progress.expectedTotalBytes!
                    : null,
              ),
            ),
          ),
        );
      },
      errorBuilder: (_, _, _) => fallback,
    );
  }
}

/// Full-screen interactive zoom lightbox for Story photos and Sighting images.
void showEarthlyPhotoLightbox(
  BuildContext context, {
  required String url,
  String? caption,
}) {
  showDialog<void>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.90),
    builder: (ctx) => Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(12),
      child: Stack(
        children: [
          Center(
            child: InteractiveViewer(
              minScale: 0.8,
              maxScale: 4.5,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: EarthlyNetworkImage(
                  url: url,
                  fit: BoxFit.contain,
                  fallback: const Padding(
                    padding: EdgeInsets.all(24),
                    child: Icon(
                      Icons.broken_image_outlined,
                      size: 48,
                      color: Colors.white54,
                    ),
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            top: 4,
            right: 4,
            child: IconButton.filled(
              style: IconButton.styleFrom(
                backgroundColor: Colors.black54,
                foregroundColor: Colors.white,
              ),
              onPressed: () => Navigator.of(ctx).pop(),
              icon: const Icon(Icons.close, size: 20),
            ),
          ),
          if (caption != null && caption.trim().isNotEmpty)
            Positioned(
              left: 12,
              right: 12,
              bottom: 12,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.72),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  caption.trim(),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

/// Formats a Unix timestamp (seconds) into concise relative or ISO date labels
/// matching Earthly Web's entity list metadata.
String formatRelativeUnixDate(int unixSeconds) {
  if (unixSeconds <= 0) return '';
  final dt = DateTime.fromMillisecondsSinceEpoch(unixSeconds * 1000, isUtc: true);
  final now = DateTime.now().toUtc();
  final diff = now.difference(dt);
  if (diff.inSeconds.abs() < 90) return 'just now';
  if (!diff.isNegative && diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (!diff.isNegative && diff.inHours < 24) return '${diff.inHours}h ago';
  if (!diff.isNegative && diff.inDays < 14) return '${diff.inDays}d ago';
  final m = dt.month.toString().padLeft(2, '0');
  final d = dt.day.toString().padLeft(2, '0');
  return '${dt.year}-$m-$d';
}

String formatByteSize(int bytes) {
  if (bytes <= 0) return '';
  if (bytes < 1024) return '1 KB';
  final kb = (bytes / 1024).round();
  if (kb < 1024) return '$kb KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

/// Tinted leading icon tile (fallback for CoverThumb & empty GeometryThumb).
class EarthlyGlyphTile extends StatelessWidget {
  const EarthlyGlyphTile({
    required this.icon,
    this.color,
    this.width = 68,
    this.height = 54,
    super.key,
  });

  final IconData icon;
  final Color? color;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final tint = color ??
        (isDark ? EarthlyColors.infoCyanBright : EarthlyColors.infoCyan);
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: tint.withValues(alpha: isDark ? 0.16 : 0.11),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: tint.withValues(alpha: 0.24)),
      ),
      child: Center(child: Icon(icon, size: 22, color: tint)),
    );
  }
}

/// Cover photo thumbnail (Stories, Atlases, Sightings) mirroring Web's
/// `CoverThumb`, with Wikimedia-safe headers and tinted glyph fallback.
class EarthlyCoverThumb extends StatelessWidget {
  const EarthlyCoverThumb({
    required this.fallbackIcon,
    this.imageUrl,
    this.fallbackColor,
    this.width = 68,
    this.height = 54,
    super.key,
  });

  final String? imageUrl;
  final IconData fallbackIcon;
  final Color? fallbackColor;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final url = imageUrl?.trim();
    final fallback = EarthlyGlyphTile(
      icon: fallbackIcon,
      color: fallbackColor,
      width: width,
      height: height,
    );
    if (url == null || url.isEmpty || !url.startsWith('http')) {
      return fallback;
    }
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.dividerColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: EarthlyNetworkImage(
        url: url,
        width: width,
        height: height,
        fit: BoxFit.cover,
        fallback: fallback,
      ),
    );
  }
}

class _ThumbShape {
  const _ThumbShape(this.points, this.closed);
  final List<Offset> points;
  final bool closed;
}

/// Memoized local-only vector preview of a GeoJSON FeatureCollection — exact
/// Flutter CustomPainter port of Web's `GeometryThumb` (`geometryThumbnail.ts`)!
class EarthlyGeometryThumb extends StatelessWidget {
  const EarthlyGeometryThumb({
    required this.cacheKey,
    required this.geojson,
    this.width = 68,
    this.height = 54,
    this.accentColor,
    super.key,
  });

  final String cacheKey;
  final String geojson;
  final double width;
  final double height;
  final Color? accentColor;

  static final Map<String, List<_ThumbShape>> _cache =
      <String, List<_ThumbShape>>{};

  static List<_ThumbShape> _extractShapes(String key, String raw) {
    final cached = _cache[key];
    if (cached != null) return cached;
    final shapes = _computeShapes(raw);
    if (_cache.length > 256) {
      _cache.remove(_cache.keys.first);
    }
    _cache[key] = shapes;
    return shapes;
  }

  static List<_ThumbShape> _computeShapes(String raw) {
    if (raw.isEmpty) return const [];
    final Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } catch (_) {
      return const [];
    }
    if (decoded is! Map<String, Object?>) return const [];
    final rawFeatures = decoded['features'];
    if (rawFeatures is! List) return const [];

    final rawShapes = <_ThumbShape>[];
    var remaining = 512;

    void addCoords(List<Object?> coords, {bool closed = false}) {
      if (remaining <= 0 || rawShapes.length >= 64 || coords.isEmpty) return;
      final count = math.min(coords.length, math.min(48, remaining));
      final pts = <Offset>[];
      for (var i = 0; i < count; i++) {
        final idx = count == 1
            ? 0
            : ((i * (coords.length - 1)) / (count - 1)).round();
        final pos = coords[idx];
        if (pos is List && pos.length >= 2) {
          final x = (pos[0] as num?)?.toDouble();
          final y = (pos[1] as num?)?.toDouble();
          if (x != null && y != null && x.isFinite && y.isFinite) {
            pts.add(Offset(x, -y));
          }
        }
      }
      remaining -= count;
      if (pts.isNotEmpty) {
        rawShapes.add(_ThumbShape(pts, closed));
      }
    }

    void visitGeometry(Object? geom, [int depth = 0]) {
      if (geom is! Map<String, Object?> ||
          remaining <= 0 ||
          rawShapes.length >= 64 ||
          depth > 8) {
        return;
      }
      final type = geom['type'];
      final coords = geom['coordinates'];
      switch (type) {
        case 'Point':
          if (coords is List) addCoords([coords]);
        case 'MultiPoint':
          if (coords is List) {
            for (final pt in coords.take(64)) {
              if (pt is List) addCoords([pt]);
            }
          }
        case 'LineString':
          if (coords is List) addCoords(coords);
        case 'MultiLineString':
          if (coords is List) {
            for (final line in coords.take(64)) {
              if (line is List) addCoords(line);
            }
          }
        case 'Polygon':
          if (coords is List) {
            for (final ring in coords.take(64)) {
              if (ring is List) addCoords(ring, closed: true);
            }
          }
        case 'MultiPolygon':
          if (coords is List) {
            for (final poly in coords.take(64)) {
              if (poly is List) {
                for (final ring in poly.take(64)) {
                  if (ring is List) addCoords(ring, closed: true);
                }
              }
            }
          }
        case 'GeometryCollection':
          final geoms = geom['geometries'];
          if (geoms is List) {
            for (final child in geoms.take(64)) {
              visitGeometry(child, depth + 1);
            }
          }
      }
    }

    for (final feat in rawFeatures.take(64)) {
      if (feat is Map<String, Object?>) {
        visitGeometry(feat['geometry']);
      }
    }
    if (rawShapes.isEmpty) return const [];

    double minX = double.infinity;
    double maxX = double.negativeInfinity;
    double minY = double.infinity;
    double maxY = double.negativeInfinity;
    for (final s in rawShapes) {
      for (final p in s.points) {
        if (p.dx < minX) minX = p.dx;
        if (p.dx > maxX) maxX = p.dx;
        if (p.dy < minY) minY = p.dy;
        if (p.dy > maxY) maxY = p.dy;
      }
    }
    final dx = (maxX - minX).abs();
    final dy = (maxY - minY).abs();
    final cx = (minX + maxX) / 2;
    final cy = (minY + maxY) / 2;

    // Normalize into [0..1] unit coordinates centered at (0.5, 0.5).
    final span = math.max(dx, dy);
    return rawShapes
        .map(
          (s) => _ThumbShape(
            s.points
                .map(
                  (p) => span < 1e-9
                      ? const Offset(0.5, 0.5)
                      : Offset(
                          0.5 + (p.dx - cx) / span,
                          0.5 + (p.dy - cy) / span,
                        ),
                )
                .toList(growable: false),
            s.closed,
          ),
        )
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final tint = accentColor ??
        (isDark ? EarthlyColors.infoCyanBright : EarthlyColors.infoCyan);
    final shapes = _extractShapes(cacheKey, geojson);
    if (shapes.isEmpty) {
      return EarthlyGlyphTile(
        icon: Icons.map_outlined,
        color: tint,
        width: width,
        height: height,
      );
    }

    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: tint.withValues(alpha: isDark ? 0.14 : 0.09),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: tint.withValues(alpha: 0.28)),
      ),
      clipBehavior: Clip.antiAlias,
      child: CustomPaint(
        painter: _GeometryThumbPainter(shapes: shapes, color: tint),
      ),
    );
  }
}

class _GeometryThumbPainter extends CustomPainter {
  const _GeometryThumbPainter({required this.shapes, required this.color});

  final List<_ThumbShape> shapes;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final padX = size.width * 0.14;
    final padY = size.height * 0.16;
    final avail = math.min(size.width - padX * 2, size.height - padY * 2);
    final originX = size.width / 2;
    final originY = size.height / 2;

    Offset mapPoint(Offset unit) => Offset(
          originX + (unit.dx - 0.5) * avail,
          originY + (unit.dy - 0.5) * avail,
        );

    final strokePaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final fillPaint = Paint()
      ..color = color.withValues(alpha: 0.22)
      ..style = PaintingStyle.fill;

    final dotPaint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    for (final shape in shapes) {
      if (shape.points.length == 1) {
        canvas.drawCircle(mapPoint(shape.points.first), 2.5, dotPaint);
        continue;
      }
      final path = Path();
      final first = mapPoint(shape.points.first);
      path.moveTo(first.dx, first.dy);
      for (var i = 1; i < shape.points.length; i++) {
        final pt = mapPoint(shape.points[i]);
        path.lineTo(pt.dx, pt.dy);
      }
      if (shape.closed) {
        path.close();
        canvas.drawPath(path, fillPaint);
      }
      canvas.drawPath(path, strokePaint);
    }
  }

  @override
  bool shouldRepaint(covariant _GeometryThumbPainter oldDelegate) =>
      oldDelegate.shapes != shapes || oldDelegate.color != color;
}

/// Secondary action inside an entity row's overflow (`More`) menu.
class EntityRowMenuAction {
  const EntityRowMenuAction({
    required this.label,
    required this.icon,
    required this.onSelected,
    this.destructive = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback onSelected;
  final bool destructive;
}

/// Shared mobile-friendly Entity List Row replicating Earthly Web's `ListRow`:
/// leading preview (`GeometryThumb` / `CoverThumb` / status disc) · title,
/// summary, mono metadata & state badges · single primary icon action + More menu.
class EarthlyEntityListRow extends StatelessWidget {
  const EarthlyEntityListRow({
    required this.leading,
    required this.title,
    required this.meta,
    required this.onTap,
    this.subtitle,
    this.badges = const <Widget>[],
    this.selected = false,
    this.selectedColor,
    this.starred = false,
    this.dimmed = false,
    this.primaryAction,
    this.menuActions = const <EntityRowMenuAction>[],
    super.key,
  });

  final Widget leading;
  final String title;
  final String? subtitle;
  final String meta;
  final List<Widget> badges;
  final bool selected;
  final Color? selectedColor;
  final bool starred;
  final bool dimmed;
  final VoidCallback onTap;
  final Widget? primaryAction;
  final List<EntityRowMenuAction> menuActions;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accent = selectedColor ?? EarthlyColors.amber;

    return Opacity(
      opacity: dimmed ? 0.56 : 1.0,
      child: Material(
        color: selected ? accent.withValues(alpha: 0.09) : Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 70),
            padding: const EdgeInsets.fromLTRB(12, 9, 6, 9),
            decoration: BoxDecoration(
              border: Border(
                left: BorderSide(
                  color: selected ? accent : Colors.transparent,
                  width: 3,
                ),
                bottom: BorderSide(color: theme.dividerColor),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                leading,
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (starred) ...[
                            const Padding(
                              padding: EdgeInsets.only(top: 2, right: 4),
                              child: Icon(
                                Icons.star,
                                size: 13,
                                color: EarthlyColors.amber,
                              ),
                            ),
                          ],
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontSize: 14,
                                height: 1.22,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ),
                      if (subtitle != null && subtitle!.trim().isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          subtitle!.trim(),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 11.5,
                            height: 1.3,
                          ),
                        ),
                      ],
                      const SizedBox(height: 3),
                      Text(
                        meta,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      if (badges.isNotEmpty) ...[
                        const SizedBox(height: 5),
                        Wrap(spacing: 5, runSpacing: 4, children: badges),
                      ],
                    ],
                  ),
                ),
                ?primaryAction,
                if (menuActions.isNotEmpty)
                  PopupMenuButton<int>(
                    tooltip: 'More actions',
                    icon: Icon(
                      Icons.more_vert,
                      size: 19,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 34, minHeight: 36),
                    onSelected: (idx) => menuActions[idx].onSelected(),
                    itemBuilder: (_) => [
                      for (var i = 0; i < menuActions.length; i++)
                        PopupMenuItem<int>(
                          value: i,
                          child: Row(
                            children: [
                              Icon(
                                menuActions[i].icon,
                                size: 17,
                                color: menuActions[i].destructive
                                    ? EarthlyColors.destructive
                                    : null,
                              ),
                              const SizedBox(width: 10),
                              Text(
                                menuActions[i].label,
                                style: TextStyle(
                                  fontSize: 13,
                                  color: menuActions[i].destructive
                                      ? EarthlyColors.destructive
                                      : null,
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
