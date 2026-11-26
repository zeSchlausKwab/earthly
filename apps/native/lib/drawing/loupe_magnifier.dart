import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';

/// Zero-cost GPU magnifier loupe built on Flutter's [RawMagnifier].
///
/// Unlike the legacy Web/Tauri magnifier (which spun up a second MapLibre WebGL
/// map instance and resized it on every touch move), this samples the live
/// Impeller compositor framebuffer at 2.2x with zero extra tile fetches or lag.
class DrawingLoupe extends StatelessWidget {
  const DrawingLoupe({
    required this.viewportSize,
    required this.fingerPosition,
    required this.targetPosition,
    required this.telemetry,
    required this.snapped,
    this.toolBadge,
    this.snapLabel = 'SNAP',
    this.size = 136,
    this.magnificationScale = 2.2,
    super.key,
  });

  final Size viewportSize;
  final Offset fingerPosition;
  final Offset targetPosition;
  final String telemetry;
  final bool snapped;
  final String? toolBadge;
  final String snapLabel;
  final double size;
  final double magnificationScale;

  String get _formattedTelemetry {
    final parts = <String>[
      if (toolBadge != null && toolBadge!.trim().isNotEmpty) toolBadge!.trim(),
      if (telemetry.trim().isNotEmpty) telemetry.trim(),
      if (snapped && !telemetry.contains(snapLabel)) snapLabel,
    ];
    return parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final radius = size / 2;
    const edgeMargin = 14.0;
    const horizontalOffset = 88.0;
    const verticalOffset = 104.0;

    // Smart edge-flip: sit above-left of the thumb by default, or flip to
    // above-right when nearing the left edge so the loupe is never clipped.
    final preferLeft = fingerPosition.dx > size + edgeMargin + 24;
    final desiredCenterX = preferLeft
        ? fingerPosition.dx - horizontalOffset
        : fingerPosition.dx + horizontalOffset;
    final desiredCenterY = fingerPosition.dy - verticalOffset;

    final centerX = desiredCenterX.clamp(
      radius + edgeMargin,
      (viewportSize.width - radius - edgeMargin).clamp(radius + edgeMargin, viewportSize.width),
    );
    final centerY = desiredCenterY.clamp(
      radius + edgeMargin + 44,
      (viewportSize.height - radius - edgeMargin).clamp(radius + edgeMargin + 44, viewportSize.height),
    );

    final loupeCenter = Offset(centerX, centerY);
    final focalDelta = targetPosition - loupeCenter;
    final reticleColor = snapped
        ? EarthlyColors.proposedAmber
        : Theme.of(context).colorScheme.primary;

    return Positioned(
      left: centerX - radius,
      top: centerY - radius,
      child: IgnorePointer(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            RawMagnifier(
              decoration: MagnifierDecoration(
                shape: CircleBorder(
                  side: BorderSide(
                    color: reticleColor,
                    width: snapped ? 2.5 : 1.75,
                  ),
                ),
                shadows: const [
                  BoxShadow(
                    color: Color(0x40000000),
                    blurRadius: 14,
                    offset: Offset(0, 6),
                  ),
                ],
              ),
              size: Size.square(size),
              magnificationScale: magnificationScale,
              focalPointOffset: focalDelta,
              child: CustomPaint(
                size: Size.square(size),
                painter: _LoupeReticlePainter(
                  color: reticleColor,
                  snapped: snapped,
                ),
              ),
            ),
            if (_formattedTelemetry.isNotEmpty) ...[
              const SizedBox(height: 6),
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxWidth: math.max(120.0, viewportSize.width - 28),
                ),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: EarthlyColors.darkSurface.withValues(alpha: 0.92),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: snapped
                          ? EarthlyColors.proposedAmber
                          : EarthlyColors.darkInk.withValues(alpha: 0.25),
                    ),
                  ),
                  child: Text(
                    _formattedTelemetry,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: snapped
                          ? EarthlyColors.proposedAmber
                          : EarthlyColors.darkInk,
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _LoupeReticlePainter extends CustomPainter {
  const _LoupeReticlePainter({
    required this.color,
    required this.snapped,
  });

  final Color color;
  final bool snapped;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final paint = Paint()
      ..color = color
      ..strokeWidth = snapped ? 2.0 : 1.4
      ..style = PaintingStyle.stroke;

    const gap = 5.0;
    const arm = 16.0;
    canvas
      ..drawLine(Offset(center.dx - arm, center.dy), Offset(center.dx - gap, center.dy), paint)
      ..drawLine(Offset(center.dx + gap, center.dy), Offset(center.dx + arm, center.dy), paint)
      ..drawLine(Offset(center.dx, center.dy - arm), Offset(center.dx, center.dy - gap), paint)
      ..drawLine(Offset(center.dx, center.dy + gap), Offset(center.dx, center.dy + arm), paint);

    if (snapped) {
      canvas.drawCircle(center, 9.0, paint);
    }
    canvas.drawCircle(
      center,
      2.2,
      Paint()..color = color,
    );
  }

  @override
  bool shouldRepaint(_LoupeReticlePainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.snapped != snapped;
}
