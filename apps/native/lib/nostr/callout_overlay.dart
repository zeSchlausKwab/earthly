import 'dart:math' as math;

import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import '../shell/earthly_rich_text.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'shelf_renderer.dart';

/// User-controlled callout density mode (`src/features/geo-editor/callouts/layout.ts`).
enum CalloutDisplayMode { full, compact, pins, hidden }

CalloutDisplayMode nextCalloutDisplayMode(CalloutDisplayMode current) =>
    switch (current) {
      CalloutDisplayMode.full => CalloutDisplayMode.compact,
      CalloutDisplayMode.compact => CalloutDisplayMode.pins,
      CalloutDisplayMode.pins => CalloutDisplayMode.hidden,
      CalloutDisplayMode.hidden => CalloutDisplayMode.full,
    };

String calloutModeShortLabel(CalloutDisplayMode mode) => switch (mode) {
      CalloutDisplayMode.full => 'Callouts',
      CalloutDisplayMode.compact => 'Compact',
      CalloutDisplayMode.pins => 'Pins',
      CalloutDisplayMode.hidden => 'Hidden',
    };

@immutable
class MapCommentPinItem {
  const MapCommentPinItem({
    required this.eventId,
    required this.authorName,
    required this.text,
    required this.anchor,
    required this.comment,
  });

  final String eventId;
  final String authorName;
  final String text;
  final Geographic anchor;
  final GeoCommentDto comment;
}

/// Frame-locked MapLibre child overlay rendering:
/// 1. Authored `earthly:callouts` with leader lines & collision-aware layout (`SPEC.md` §1.8)
/// 2. Sighting photo thumbnail pin bubbles (`SPEC.md` §6.1)
class EarthlyCalloutOverlay extends StatefulWidget {
  const EarthlyCalloutOverlay({
    required this.callouts,
    required this.sightings,
    required this.displayMode,
    required this.onInspectFeature,
    required this.onInspectSighting,
    this.iconPins = const <MapIconPinItem>[],
    this.arrowheads = const <MapArrowheadItem>[],
    this.commentPins = const <MapCommentPinItem>[],
    this.onInspectComment,
    this.screenProjector,
    this.onRepositionDraftCallout,
    this.bottomInset = 110,
    super.key,
  });

  final List<MapCalloutItem> callouts;
  final List<SightingSummaryDto> sightings;
  final List<MapIconPinItem> iconPins;
  final List<MapArrowheadItem> arrowheads;
  final List<MapCommentPinItem> commentPins;
  final ValueChanged<GeoCommentDto>? onInspectComment;
  @visibleForTesting
  final Offset Function(Geographic)? screenProjector;
  final void Function(String featureId, String calloutId, Offset newOffset)?
      onRepositionDraftCallout;
  final CalloutDisplayMode displayMode;
  final ValueChanged<InspectedFeature> onInspectFeature;
  final ValueChanged<SightingSummaryDto> onInspectSighting;
  final double bottomInset;

  @override
  State<EarthlyCalloutOverlay> createState() => _EarthlyCalloutOverlayState();
}

class _EarthlyCalloutOverlayState extends State<EarthlyCalloutOverlay> {
  String? _expandedKey;
  String? _expandedCommentId;
  String? _draggingKey;
  Offset _dragDelta = Offset.zero;

  @override
  Widget build(BuildContext context) {
    final controller = MapController.maybeOf(context);
    final camera = CameraPosition.maybeOf(context);
    final projector = widget.screenProjector ?? controller?.toScreenLocation;
    if (projector == null || (controller != null && camera == null)) {
      return const SizedBox.shrink();
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final viewport = constraints.biggest;
        if (viewport.isEmpty) return const SizedBox.shrink();

        final effectiveCallouts = _draggingKey == null
            ? widget.callouts
            : [
                for (final c in widget.callouts)
                  c.key == _draggingKey
                      ? MapCalloutItem(
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
                          offset: c.offset + _dragDelta,
                          showLeader: c.showLeader,
                          accentColorHex: c.accentColorHex,
                          inspectedFeature: c.inspectedFeature,
                        )
                      : c,
              ];

        final placedCallouts =
            (controller == null || widget.displayMode == CalloutDisplayMode.hidden)
                ? const <_PlacedCallout>[]
                : _resolveCalloutLayout(
                    controller: controller,
                    viewport: viewport,
                    callouts: effectiveCallouts,
                    displayMode: widget.displayMode,
                    expandedKey: _expandedKey,
                    bottomInset: widget.bottomInset,
                  );

        final sightingBubbles = <_PlacedSightingBubble>[];
        for (final s in widget.sightings) {
          if (s.imageUrl == null || s.imageUrl!.isEmpty) continue;
          final pt = projector(
            Geographic(lon: s.lon, lat: s.lat),
          );
          if (!_isWithinViewport(pt, viewport, margin: 24)) continue;
          sightingBubbles.add(_PlacedSightingBubble(sighting: s, anchor: pt));
        }

        final placedIcons = <({MapIconPinItem pin, Offset pos})>[];
        for (final pin in widget.iconPins) {
          final pt = projector(pin.position);
          if (!_isWithinViewport(pt, viewport, margin: 20)) continue;
          placedIcons.add((pin: pin, pos: pt));
        }

        final placedArrows =
            <({Offset tip, Offset from, Color color, double strokeWidth})>[];
        for (final arrow in widget.arrowheads) {
          final tip = projector(arrow.tip);
          final from = projector(arrow.from);
          if (!_isWithinViewport(tip, viewport, margin: 24)) continue;
          if (!from.dx.isFinite || !from.dy.isFinite) continue;
          if ((tip - from).distance < 1.5) continue;
          placedArrows.add((
            tip: tip,
            from: from,
            color: arrow.color,
            strokeWidth: arrow.strokeWidth,
          ));
        }

        final placedComments = <({MapCommentPinItem pin, Offset pos})>[];
        for (final pin in widget.commentPins) {
          final pt = projector(pin.anchor);
          if (!_isWithinViewport(pt, viewport, margin: 24)) continue;
          placedComments.add((pin: pin, pos: pt));
        }

        if (placedCallouts.isEmpty &&
            sightingBubbles.isEmpty &&
            placedIcons.isEmpty &&
            placedArrows.isEmpty &&
            placedComments.isEmpty) {
          return const SizedBox.shrink();
        }

        return Stack(
          clipBehavior: Clip.none,
          children: [
            // Frame-locked LineString vector arrowheads (`arrowStart` / `arrowEnd`)
            if (placedArrows.isNotEmpty)
              Positioned.fill(
                child: IgnorePointer(
                  child: CustomPaint(
                    painter: _ArrowheadPainter(arrows: placedArrows),
                  ),
                ),
              ),
            // `displayIcon` (`lucide:*`) Point badges with auto-contrasting glyph
            for (final item in placedIcons)
              Positioned(
                left: item.pos.dx - 13,
                top: item.pos.dy - 13,
                child: GestureDetector(
                  onTap: () =>
                      widget.onInspectFeature(item.pin.inspectedFeature),
                  child: Container(
                    width: 26,
                    height: 26,
                    decoration: BoxDecoration(
                      color: item.pin.fillColor,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: item.pin.ringColor,
                        width: 2.0,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.28),
                          blurRadius: 4,
                          offset: const Offset(0, 1),
                        ),
                      ],
                    ),
                    child: Icon(
                      resolveLucideIcon(item.pin.iconName),
                      size: 14,
                      color: item.pin.fillColor.computeLuminance() > 0.55
                          ? const Color(0xFF111827)
                          : Colors.white,
                    ),
                  ),
                ),
              ),

            // Leader lines + anchor dots (non-interactive)
            if (placedCallouts.isNotEmpty)
              Positioned.fill(
                child: IgnorePointer(
                  child: CustomPaint(
                    painter: _CalloutLeaderPainter(
                      placed: placedCallouts,
                      lineColor: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                ),
              ),

            // Sighting photo pin bubbles (SPEC §6.1)
            for (final bubble in sightingBubbles)
              Positioned(
                left: bubble.anchor.dx - 18,
                top: bubble.anchor.dy - 48,
                child: GestureDetector(
                  onTap: () => widget.onInspectSighting(bubble.sighting),
                  child: _SightingPhotoPin(imageUrl: bubble.sighting.imageUrl!),
                ),
              ),

            // Callout cards / compact badges / collapsed pins (draft callouts are draggable!)
            for (final p in placedCallouts)
              Positioned(
                left: p.rect.left,
                top: p.rect.top,
                width: p.rect.width,
                child: Builder(
                  builder: (_) {
                    final isDraftCallout = p.item.key.startsWith('draft::') &&
                        p.item.featureId != null &&
                        widget.onRepositionDraftCallout != null &&
                        p.resolvedMode != CalloutDisplayMode.pins;
                    final card = _CalloutCardWidget(
                      item: p.item,
                      mode: p.resolvedMode,
                      isExpanded: _expandedKey == p.item.key,
                      draggable: isDraftCallout,
                      onTap: () {
                        if (p.resolvedMode == CalloutDisplayMode.full) {
                          if (p.item.inspectedFeature != null) {
                            widget.onInspectFeature(p.item.inspectedFeature!);
                          }
                        } else {
                          setState(() {
                            _expandedKey =
                                _expandedKey == p.item.key ? null : p.item.key;
                          });
                        }
                      },
                      onInspect: p.item.inspectedFeature != null
                          ? () =>
                              widget.onInspectFeature(p.item.inspectedFeature!)
                          : null,
                      onCollapse: _expandedKey == p.item.key
                          ? () => setState(() => _expandedKey = null)
                          : null,
                    );
                    if (!isDraftCallout) return card;
                    final origItem = widget.callouts
                            .where((c) => c.key == p.item.key)
                            .firstOrNull ??
                        p.item;
                    return GestureDetector(
                      onPanStart: (_) => setState(() {
                        _draggingKey = p.item.key;
                        _dragDelta = Offset.zero;
                      }),
                      onPanUpdate: (details) => setState(() {
                        _dragDelta += details.delta;
                      }),
                      onPanEnd: (_) {
                        final committed = origItem.offset + _dragDelta;
                        setState(() {
                          _draggingKey = null;
                          _dragDelta = Offset.zero;
                        });
                        widget.onRepositionDraftCallout!(
                          p.item.featureId!,
                          p.item.id,
                          committed,
                        );
                      },
                      onPanCancel: () => setState(() {
                        _draggingKey = null;
                        _dragDelta = Offset.zero;
                      }),
                      child: card,
                    );
                  },
                ),
              ),

            // Map-pinned comment pins + interactive popover cards (NIP-22 37517)
            for (final cp in placedComments)
              Positioned(
                left: (cp.pos.dx - 16).clamp(8.0, math.max(8.0, viewport.width - 180)),
                top: (cp.pos.dy - 14).clamp(8.0, math.max(8.0, viewport.height - 44)),
                child: GestureDetector(
                  key: Key('map-comment-pin-${cp.pin.eventId}'),
                  onTap: () => setState(() {
                    _expandedCommentId =
                        _expandedCommentId == cp.pin.eventId ? null : cp.pin.eventId;
                  }),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: EarthlyColors.commentGreen,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: Colors.white, width: 1.5),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.25),
                          blurRadius: 4,
                          offset: const Offset(0, 1),
                        ),
                      ],
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.chat_bubble, size: 12, color: Colors.white),
                        const SizedBox(width: 4),
                        ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 120),
                          child: Text(
                            cp.pin.authorName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            for (final cp in placedComments)
              if (_expandedCommentId == cp.pin.eventId)
                Positioned(
                  left: (cp.pos.dx - 110)
                      .clamp(10.0, math.max(10.0, viewport.width - 236)),
                  top: (cp.pos.dy - 148)
                      .clamp(10.0, math.max(10.0, viewport.height - 170)),
                  width: 226,
                  child: Material(
                    key: Key('map-comment-popup-${cp.pin.eventId}'),
                    elevation: 6,
                    color: Theme.of(context).colorScheme.surface,
                    shape: RoundedRectangleBorder(
                      side: BorderSide(
                        color: EarthlyColors.commentGreen,
                        width: 1.5,
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(9),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Row(
                            children: [
                              const Icon(
                                Icons.chat_bubble_outline,
                                size: 13,
                                color: EarthlyColors.commentGreen,
                              ),
                              const SizedBox(width: 5),
                              Expanded(
                                child: Text(
                                  cp.pin.authorName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context)
                                      .textTheme
                                      .labelSmall
                                      ?.copyWith(fontWeight: FontWeight.w800),
                                ),
                              ),
                              GestureDetector(
                                onTap: () =>
                                    setState(() => _expandedCommentId = null),
                                child: const Icon(Icons.close, size: 14),
                              ),
                            ],
                          ),
                          const SizedBox(height: 5),
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxHeight: 90),
                            child: SingleChildScrollView(
                              child: EarthlyRichText(
                                text: cp.pin.text,
                                compact: true,
                              ),
                            ),
                          ),
                          if (widget.onInspectComment != null) ...[
                            const SizedBox(height: 6),
                            Align(
                              alignment: Alignment.centerRight,
                              child: OutlinedButton(
                                key: Key(
                                  'map-comment-open-thread-${cp.pin.eventId}',
                                ),
                                style: OutlinedButton.styleFrom(
                                  visualDensity: VisualDensity.compact,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 4,
                                  ),
                                ),
                                onPressed: () =>
                                    widget.onInspectComment!(cp.pin.comment),
                                child: const Text(
                                  'Open Thread',
                                  style: TextStyle(fontSize: 11),
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
          ],
        );
      },
    );
  }
}

class _PlacedSightingBubble {
  const _PlacedSightingBubble({required this.sighting, required this.anchor});
  final SightingSummaryDto sighting;
  final Offset anchor;
}

class _PlacedCallout {
  const _PlacedCallout({
    required this.item,
    required this.anchor,
    required this.rect,
    required this.connector,
    required this.resolvedMode,
  });

  final MapCalloutItem item;
  final Offset anchor;
  final Rect rect;
  final Offset connector;
  final CalloutDisplayMode resolvedMode;
}

bool _isWithinViewport(Offset pt, Size viewport, {double margin = 0}) {
  if (!pt.dx.isFinite || !pt.dy.isFinite) return false;
  return pt.dx >= -margin &&
      pt.dy >= -margin &&
      pt.dx <= viewport.width + margin &&
      pt.dy <= viewport.height + margin;
}

List<_PlacedCallout> _resolveCalloutLayout({
  required MapController controller,
  required Size viewport,
  required List<MapCalloutItem> callouts,
  required CalloutDisplayMode displayMode,
  required String? expandedKey,
  required double bottomInset,
}) {
  const pad = 12.0;
  const topSafe = 64.0;
  final safeBottom = math.max(topSafe + 60, viewport.height - bottomInset);
  const gap = 14.0;

  final visible = <(MapCalloutItem, Offset)>[];
  for (final c in callouts) {
    final pt = controller.toScreenLocation(c.anchor);
    if (!_isWithinViewport(pt, viewport, margin: 12)) continue;
    visible.add((c, pt));
  }
  if (visible.isEmpty) return const [];

  // Put explicitly expanded callout first so it wins full layout space.
  visible.sort((a, b) {
    final pa = a.$1.key == expandedKey ? 1 : 0;
    final pb = b.$1.key == expandedKey ? 1 : 0;
    return pb.compareTo(pa);
  });

  final placed = <_PlacedCallout>[];

  for (final (item, anchor) in visible) {
    final isPriority = item.key == expandedKey;
    final fullHeight = item.mediaUrls.isNotEmpty ? 128.0 : 82.0;
    final fullSize = Size(
      math.min(220.0, viewport.width - pad * 2),
      fullHeight,
    );
    const compactSize = Size(154.0, 42.0);
    const pinSize = Size(28.0, 28.0);

    final modes = isPriority
        ? const [CalloutDisplayMode.full]
        : switch (displayMode) {
            CalloutDisplayMode.full => const [
                CalloutDisplayMode.full,
                CalloutDisplayMode.compact,
                CalloutDisplayMode.pins,
              ],
            CalloutDisplayMode.compact => const [
                CalloutDisplayMode.compact,
                CalloutDisplayMode.pins,
              ],
            CalloutDisplayMode.pins => const [CalloutDisplayMode.pins],
            CalloutDisplayMode.hidden => const <CalloutDisplayMode>[],
          };

    final sides = _sideOrder(item.preferredSide);
    _PlacedCallout? chosen;

    for (final mode in modes) {
      final size = switch (mode) {
        CalloutDisplayMode.full => fullSize,
        CalloutDisplayMode.compact => compactSize,
        CalloutDisplayMode.pins => pinSize,
        CalloutDisplayMode.hidden => pinSize,
      };
      for (final side in sides) {
        final rawTopLeft = _positionForSide(
          anchor: anchor,
          size: size,
          side: side,
          offset: mode == CalloutDisplayMode.pins ? Offset.zero : item.offset,
          gap: mode == CalloutDisplayMode.pins ? 0 : gap,
        );
        final clampedLeft = rawTopLeft.dx
            .clamp(pad, math.max(pad, viewport.width - pad - size.width))
            .toDouble();
        final clampedTop = rawTopLeft.dy
            .clamp(topSafe, math.max(topSafe, safeBottom - size.height))
            .toDouble();
        final candidateRect = Rect.fromLTWH(
          clampedLeft,
          clampedTop,
          size.width,
          size.height,
        );
        final collides = placed.any(
          (other) => other.rect.inflate(4).overlaps(candidateRect),
        );
        if (!collides || isPriority || mode == CalloutDisplayMode.pins) {
          chosen = _PlacedCallout(
            item: item,
            anchor: anchor,
            rect: candidateRect,
            connector: Offset(
              anchor.dx.clamp(candidateRect.left, candidateRect.right),
              anchor.dy.clamp(candidateRect.top, candidateRect.bottom),
            ),
            resolvedMode: mode,
          );
          break;
        }
      }
      if (chosen != null) break;
    }

    if (chosen != null) {
      placed.add(chosen);
    }
  }
  return placed;
}

List<String> _sideOrder(String preferred) {
  const defaults = ['right', 'top', 'left', 'bottom'];
  if (!defaults.contains(preferred)) return defaults;
  return [preferred, ...defaults.where((s) => s != preferred)];
}

Offset _positionForSide({
  required Offset anchor,
  required Size size,
  required String side,
  required Offset offset,
  required double gap,
}) {
  if (gap == 0) {
    return Offset(anchor.dx - size.width / 2, anchor.dy - size.height / 2);
  }
  return switch (side) {
    'top' => Offset(
        anchor.dx - size.width / 2 + offset.dx,
        anchor.dy - gap - size.height + offset.dy,
      ),
    'bottom' => Offset(
        anchor.dx - size.width / 2 + offset.dx,
        anchor.dy + gap + offset.dy,
      ),
    'left' => Offset(
        anchor.dx - gap - size.width + offset.dx,
        anchor.dy - size.height / 2 + offset.dy,
      ),
    _ => Offset(
        anchor.dx + gap + offset.dx,
        anchor.dy - size.height / 2 + offset.dy,
      ),
  };
}

class _CalloutLeaderPainter extends CustomPainter {
  const _CalloutLeaderPainter({
    required this.placed,
    required this.lineColor,
  });

  final List<_PlacedCallout> placed;
  final Color lineColor;

  @override
  void paint(Canvas canvas, Size size) {
    final haloPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.8)
      ..strokeWidth = 3.0
      ..style = PaintingStyle.stroke;
    final strokePaint = Paint()
      ..color = lineColor.withValues(alpha: 0.78)
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;
    final dotFill = Paint()..color = lineColor;
    final dotStroke = Paint()
      ..color = Colors.white
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    for (final p in placed) {
      if (!p.item.showLeader || p.resolvedMode == CalloutDisplayMode.pins) {
        continue;
      }
      if ((p.anchor - p.connector).distance < 6) continue;
      canvas.drawLine(p.anchor, p.connector, haloPaint);
      canvas.drawLine(p.anchor, p.connector, strokePaint);
      canvas.drawCircle(p.anchor, 3.2, dotFill);
      canvas.drawCircle(p.anchor, 3.2, dotStroke);
    }
  }

  @override
  bool shouldRepaint(covariant _CalloutLeaderPainter oldDelegate) => true;
}

class _ArrowheadPainter extends CustomPainter {
  const _ArrowheadPainter({required this.arrows});

  final List<({Offset tip, Offset from, Color color, double strokeWidth})> arrows;

  @override
  void paint(Canvas canvas, Size size) {
    for (final a in arrows) {
      final dx = a.tip.dx - a.from.dx;
      final dy = a.tip.dy - a.from.dy;
      final angle = math.atan2(dy, dx);
      final headLen = (9.5 + a.strokeWidth * 1.4).clamp(10.0, 20.0);
      const spread = 0.48; // ~27.5 deg each side
      final leftWing = Offset(
        a.tip.dx - headLen * math.cos(angle - spread),
        a.tip.dy - headLen * math.sin(angle - spread),
      );
      final rightWing = Offset(
        a.tip.dx - headLen * math.cos(angle + spread),
        a.tip.dy - headLen * math.sin(angle + spread),
      );
      final path = Path()
        ..moveTo(a.tip.dx, a.tip.dy)
        ..lineTo(leftWing.dx, leftWing.dy)
        ..lineTo(rightWing.dx, rightWing.dy)
        ..close();

      canvas.drawPath(
        path,
        Paint()
          ..color = Colors.white.withValues(alpha: 0.9)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.0
          ..strokeJoin = StrokeJoin.round,
      );
      canvas.drawPath(
        path,
        Paint()
          ..color = a.color
          ..style = PaintingStyle.fill,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _ArrowheadPainter oldDelegate) => true;
}

class _CalloutCardWidget extends StatelessWidget {
  const _CalloutCardWidget({
    required this.item,
    required this.mode,
    required this.isExpanded,
    required this.onTap,
    this.draggable = false,
    this.onInspect,
    this.onCollapse,
  });

  final MapCalloutItem item;
  final CalloutDisplayMode mode;
  final bool isExpanded;
  final bool draggable;
  final VoidCallback onTap;
  final VoidCallback? onInspect;
  final VoidCallback? onCollapse;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accent = _parseHex(item.accentColorHex) ?? theme.colorScheme.primary;

    if (mode == CalloutDisplayMode.pins) {
      return GestureDetector(
        onTap: onTap,
        child: Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: theme.colorScheme.surface.withValues(alpha: 0.96),
            border: Border.all(color: accent, width: 1.8),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.16),
                blurRadius: 4,
              ),
            ],
          ),
          child: Icon(Icons.chat_bubble_outline, size: 14, color: accent),
        ),
      );
    }

    if (mode == CalloutDisplayMode.compact) {
      return GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface.withValues(alpha: 0.95),
            border: Border(
              left: BorderSide(color: accent, width: 3),
              top: BorderSide(color: theme.dividerColor),
              right: BorderSide(color: theme.dividerColor),
              bottom: BorderSide(color: theme.dividerColor),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.14),
                blurRadius: 5,
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                item.title ?? item.featureLabel ?? item.text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (item.title != null)
                Text(
                  item.text,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(fontSize: 10),
                ),
            ],
          ),
        ),
      );
    }

    // Full callout card
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: theme.colorScheme.surface.withValues(alpha: 0.97),
          border: Border(
            left: BorderSide(color: accent, width: 3),
            top: BorderSide(color: theme.dividerColor),
            right: BorderSide(color: theme.dividerColor),
            bottom: BorderSide(color: theme.dividerColor),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.18),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (item.mediaUrls.isNotEmpty)
              SizedBox(
                height: 54,
                child: Image.network(
                  item.mediaUrls.first,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const SizedBox.shrink(),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      if (draggable) ...[
                        Icon(
                          Icons.drag_indicator,
                          size: 13,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 2),
                      ],
                      Expanded(
                        child: Text(
                          item.title ?? item.featureLabel ?? item.datasetTitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.labelSmall?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      if (onCollapse != null)
                        GestureDetector(
                          onTap: onCollapse,
                          child: const Icon(Icons.close, size: 13),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    stripEarthlyMarkdownPreview(item.text),
                    maxLines: isExpanded ? 5 : 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 11,
                      height: 1.25,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SightingPhotoPin extends StatelessWidget {
  const _SightingPhotoPin({required this.imageUrl});

  final String imageUrl;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: EarthlyColors.lightSurface,
        border: Border.all(color: const Color(0xFFD97706), width: 2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.28),
            blurRadius: 5,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Image.network(
        imageUrl,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => const Icon(
          Icons.visibility,
          size: 16,
          color: Color(0xFFD97706),
        ),
      ),
    );
  }
}

Color? _parseHex(String? hex) {
  if (hex == null || hex.length != 7 || !hex.startsWith('#')) return null;
  final val = int.tryParse(hex.substring(1), radix: 16);
  if (val == null) return null;
  return Color(0xFF000000 | val);
}
