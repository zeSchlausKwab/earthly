import 'dart:ui';

import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';

/// Google-Maps-style non-blocking frosted-glass map drawer that adapts across
/// Mobile & Desktop:
///
/// - **Mobile (`width < 880`)**: Top-rounded bottom drawer (`22px` radius) with
///   an **always-visible sticky drag handle + header** at the top. Dragging the
///   handle bar snaps smoothly between Peek (18%), 50/50 Split (50%), and Full
///   (88%), while the scrollable [body] below scrolls **100% independently** of
///   the drawer height! The map above stays live and interactive at all times.
/// - **Desktop (`width >= 880`, macOS/Linux/Windows)**: Docks as a floating
///   frosted-glass 416px left Margin panel beside the full-height GPU map canvas.
class EarthlyMapDrawer extends StatefulWidget {
  const EarthlyMapDrawer({
    required this.header,
    required this.body,
    required this.onClose,
    this.initialFraction = 0.50,
    this.minFraction = 0.16,
    this.maxFraction = 0.88,
    this.accentTopBorder = false,
    this.onHeightFractionChanged,
    super.key,
  });

  /// Always-visible header placed inside the draggable handle zone.
  final Widget header;

  /// Independently scrollable drawer body (does NOT hijack drawer dragging).
  final Widget body;

  final VoidCallback onClose;
  final double initialFraction;
  final double minFraction;
  final double maxFraction;
  final bool accentTopBorder;
  final ValueChanged<double>? onHeightFractionChanged;

  @override
  State<EarthlyMapDrawer> createState() => _EarthlyMapDrawerState();
}

class _EarthlyMapDrawerState extends State<EarthlyMapDrawer> {
  static const List<double> _snapPoints = <double>[0.18, 0.50, 0.88];

  late double _fraction = widget.initialFraction;
  bool _dragging = false;

  void _setFraction(double next) {
    final clamped = next.clamp(widget.minFraction, widget.maxFraction);
    if ((clamped - _fraction).abs() < 0.0005) return;
    setState(() => _fraction = clamped);
    widget.onHeightFractionChanged?.call(clamped);
  }

  void _snapWithVelocity(double velocityPxPerSec) {
    double target;
    if (velocityPxPerSec < -350) {
      target = _snapPoints.firstWhere(
        (s) => s > _fraction + 0.04,
        orElse: () => _snapPoints.last,
      );
    } else if (velocityPxPerSec > 350) {
      target = _snapPoints.lastWhere(
        (s) => s < _fraction - 0.04,
        orElse: () => _snapPoints.first,
      );
    } else {
      target = _snapPoints.reduce(
        (a, b) => (a - _fraction).abs() <= (b - _fraction).abs() ? a : b,
      );
    }
    setState(() {
      _dragging = false;
      _fraction = target.clamp(widget.minFraction, widget.maxFraction);
    });
    widget.onHeightFractionChanged?.call(_fraction);
  }

  void _cycleSnap() {
    final next = _fraction < 0.35
        ? 0.50
        : _fraction < 0.72
            ? 0.88
            : 0.50;
    setState(() => _fraction = next);
    widget.onHeightFractionChanged?.call(_fraction);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final size = MediaQuery.sizeOf(context);
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    final isDesktop = size.width >= 880;
    final borderColor = widget.accentTopBorder
        ? EarthlyColors.amber.withValues(alpha: isDark ? 0.72 : 0.85)
        : (isDark
            ? Colors.white.withValues(alpha: 0.12)
            : Colors.black.withValues(alpha: 0.09));

    if (isDesktop) {
      // Desktop Studio: floating frosted-glass left Margin card beside the map.
      return Positioned(
        top: 64,
        left: 12,
        bottom: 12,
        width: 416,
        child: EarthlyGlassSurface(
          borderRadius: BorderRadius.circular(18),
          blurSigma: 18,
          color: theme.colorScheme.surface.withValues(alpha: isDark ? 0.90 : 0.93),
          borderColor: borderColor,
          borderWidth: widget.accentTopBorder ? 1.5 : 1.0,
          shadows: [
            BoxShadow(
              color: Colors.black.withValues(alpha: isDark ? 0.45 : 0.16),
              blurRadius: 28,
              offset: const Offset(0, 10),
            ),
          ],
          child: Material(
            type: MaterialType.transparency,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 8),
                widget.header,
                const Divider(height: 1),
                Expanded(child: widget.body),
              ],
            ),
          ),
        ),
      );
    }

    // Mobile: Google-Maps-style independent frosted-glass rounded bottom drawer.
    final availableHeight =
        (size.height - keyboardInset).clamp(240.0, size.height);
    final drawerHeight = (availableHeight * _fraction)
        .clamp(116.0, availableHeight * widget.maxFraction);
    const radius = BorderRadius.vertical(top: Radius.circular(22));

    return Positioned(
      left: 0,
      right: 0,
      bottom: keyboardInset,
      child: AnimatedContainer(
        duration: _dragging ? Duration.zero : const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
        height: drawerHeight,
        decoration: BoxDecoration(
          borderRadius: radius,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: isDark ? 0.48 : 0.20),
              blurRadius: 24,
              offset: const Offset(0, -6),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: radius,
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
            child: Container(
              decoration: BoxDecoration(
                color: theme.colorScheme.surface
                    .withValues(alpha: isDark ? 0.92 : 0.95),
                borderRadius: radius,
                border: Border(
                  top: BorderSide(
                    color: borderColor,
                    width: widget.accentTopBorder ? 2.0 : 1.0,
                  ),
                ),
              ),
              child: SafeArea(
                top: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Sticky drag handle + header bar — ONLY this region resizes the drawer!
                    GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: _cycleSnap,
                      onVerticalDragStart: (_) =>
                          setState(() => _dragging = true),
                      onVerticalDragUpdate: (details) {
                        final deltaFraction =
                            -details.delta.dy / availableHeight;
                        _setFraction(_fraction + deltaFraction);
                      },
                      onVerticalDragEnd: (details) {
                        _snapWithVelocity(details.primaryVelocity ?? 0);
                      },
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(top: 10, bottom: 6),
                            child: Center(
                              child: Container(
                                width: 40,
                                height: 4.5,
                                decoration: BoxDecoration(
                                  color: widget.accentTopBorder
                                      ? EarthlyColors.amber
                                          .withValues(alpha: 0.75)
                                      : theme.colorScheme.onSurface
                                          .withValues(alpha: 0.26),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                              ),
                            ),
                          ),
                          widget.header,
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    Expanded(child: widget.body),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
