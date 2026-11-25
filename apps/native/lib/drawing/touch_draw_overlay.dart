import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';
import 'package:maplibre/maplibre.dart';

import '../theme/earthly_theme.dart';
import 'drawing_model.dart';
import 'loupe_magnifier.dart';

/// Frame-locked vector geometry overlay rendered inside [MapLibreMap.children].
///
/// Subscribes to [CameraPosition.of] so committed features, active drafts, and
/// vertex handles stay locked to the exact GPU texture frame on screen during
/// pan, pinch-zoom, and rotation.
class MapGeometryLayer extends StatelessWidget {
  const MapGeometryLayer({
    required this.features,
    required this.draftVertices,
    required this.mode,
    this.previewScreen,
    this.snapped = false,
    this.loupeActive = false,
    super.key,
  });

  final List<DrawnFeature> features;
  final List<Geographic> draftVertices;
  final DrawToolMode mode;
  final Offset? previewScreen;
  final bool snapped;
  final bool loupeActive;

  @override
  Widget build(BuildContext context) {
    // Subscribe to the frame-locked camera on screen.
    CameraPosition.maybeOf(context);
    final controller = MapController.maybeOf(context);
    if (controller == null) return const SizedBox.shrink();
    final accent = Theme.of(context).colorScheme.primary;

    return IgnorePointer(
      child: CustomPaint(
        size: Size.infinite,
        painter: _GeometryOverlayPainter(
          controller: controller,
          features: features,
          draftVertices: draftVertices,
          mode: mode,
          accent: accent,
          previewScreen: previewScreen,
          snapped: snapped,
          loupeActive: loupeActive,
        ),
      ),
    );
  }
}

/// Interactive native touch-drawing & GPU loupe overlay.
///
/// - In [TouchPlacementStyle.drawDrag]: 1 finger places/drags with a -48dp
///   thumb-clearance offset + live GPU loupe + magnetic haptic snapping, while
///   2 fingers pass directly to MapLibre for pan/zoom/rotate (no flashing pan lock).
/// - In [TouchPlacementStyle.crosshair]: MapLibre owns 1-finger panning under a
///   centered precision reticle; tapping "Drop point" commits the center coord.
class TouchDrawOverlay extends StatefulWidget {
  const TouchDrawOverlay({
    required this.controller,
    required this.mode,
    required this.placementStyle,
    required this.loupeEnabled,
    required this.features,
    required this.draftVertices,
    required this.onCommitVertex,
    required this.onUpdateDraftVertex,
    required this.onInsertDraftVertex,
    required this.onTwoFingerUndo,
    required this.onPreviewChanged,
    this.externalSnapShapes = const <List<Geographic>>[],
    super.key,
  });

  final MapController? controller;
  final DrawToolMode mode;
  final TouchPlacementStyle placementStyle;
  final bool loupeEnabled;
  final List<DrawnFeature> features;
  final List<Geographic> draftVertices;
  final List<List<Geographic>> externalSnapShapes;
  final ValueChanged<Geographic> onCommitVertex;
  final void Function(int index, Geographic position) onUpdateDraftVertex;
  final void Function(int insertIndex, Geographic position) onInsertDraftVertex;
  final VoidCallback onTwoFingerUndo;
  final void Function(Offset? previewScreen, bool snapped, bool loupeActive)
      onPreviewChanged;

  @override
  State<TouchDrawOverlay> createState() => _TouchDrawOverlayState();
}

class _TouchDrawOverlayState extends State<TouchDrawOverlay> {
  static const double _thumbClearanceY = -48.0;
  static const double _vertexHitRadius = 22.0;

  final Set<int> _activePointers = <int>{};
  int? _primaryPointer;
  DateTime? _twoFingerDownAt;

  Offset? _fingerScreen;
  Offset? _targetScreen;
  Geographic? _previewCoord;
  SnapMatch? _activeSnap;
  int? _draggingDraftVertexIndex;
  bool _multiTouchAborted = false;

  bool get _isDrawingMode => widget.mode != DrawToolMode.browse;
  bool get _interceptSingleFinger =>
      _isDrawingMode && widget.placementStyle == TouchPlacementStyle.drawDrag;

  void _handlePointerDown(PointerDownEvent event, Size size) {
    _activePointers.add(event.pointer);
    if (_activePointers.length == 2) {
      _twoFingerDownAt = DateTime.now();
      _cancelActiveTouch();
      _multiTouchAborted = true;
      return;
    }
    if (_activePointers.length > 2 || !_interceptSingleFinger) return;
    final controller = widget.controller;
    if (controller == null) return;

    _multiTouchAborted = false;
    _primaryPointer = event.pointer;

    // Check if the user grabbed an existing draft vertex or ghost midpoint first.
    final hitVertex = _hitTestDraftVertex(event.localPosition, controller);
    if (hitVertex != null) {
      _draggingDraftVertexIndex = hitVertex;
      _updateDragTarget(event.localPosition, size, applyThumbOffset: false);
      HapticFeedback.lightImpact();
      return;
    }

    final hitMidpoint = _hitTestGhostMidpoint(event.localPosition, controller);
    if (hitMidpoint != null) {
      final coord = controller.toLngLat(event.localPosition);
      widget.onInsertDraftVertex(hitMidpoint, coord);
      _draggingDraftVertexIndex = hitMidpoint;
      _updateDragTarget(event.localPosition, size, applyThumbOffset: false);
      HapticFeedback.selectionClick();
      return;
    }

    _draggingDraftVertexIndex = null;
    _updateDragTarget(event.localPosition, size, applyThumbOffset: true);
  }

  void _handlePointerMove(PointerMoveEvent event, Size size) {
    if (_multiTouchAborted || event.pointer != _primaryPointer) return;
    if (!_interceptSingleFinger || widget.controller == null) return;
    _updateDragTarget(
      event.localPosition,
      size,
      applyThumbOffset: _draggingDraftVertexIndex == null,
    );
  }

  void _handlePointerUp(PointerUpEvent event) {
    final wasTwoFingerTap = _activePointers.length == 2 &&
        _twoFingerDownAt != null &&
        DateTime.now().difference(_twoFingerDownAt!).inMilliseconds < 240;

    _activePointers.remove(event.pointer);

    if (wasTwoFingerTap && _isDrawingMode && widget.draftVertices.isNotEmpty) {
      HapticFeedback.lightImpact();
      widget.onTwoFingerUndo();
    }

    if (event.pointer == _primaryPointer) {
      if (!_multiTouchAborted &&
          _interceptSingleFinger &&
          _previewCoord != null &&
          _draggingDraftVertexIndex == null) {
        HapticFeedback.mediumImpact();
        widget.onCommitVertex(_previewCoord!);
      }
      _cancelActiveTouch();
    }

    if (_activePointers.isEmpty) {
      _multiTouchAborted = false;
      _twoFingerDownAt = null;
    }
  }

  void _handlePointerCancel(PointerCancelEvent event) {
    _activePointers.remove(event.pointer);
    if (event.pointer == _primaryPointer) {
      _cancelActiveTouch();
    }
    if (_activePointers.isEmpty) {
      _multiTouchAborted = false;
      _twoFingerDownAt = null;
    }
  }

  void _cancelActiveTouch() {
    setState(() {
      _primaryPointer = null;
      _fingerScreen = null;
      _targetScreen = null;
      _previewCoord = null;
      _activeSnap = null;
      _draggingDraftVertexIndex = null;
    });
    widget.onPreviewChanged(null, false, false);
  }

  void _updateDragTarget(
    Offset finger,
    Size size, {
    required bool applyThumbOffset,
  }) {
    final controller = widget.controller;
    if (controller == null) return;

    final rawTarget = Offset(
      finger.dx.clamp(0.0, size.width),
      (finger.dy + (applyThumbOffset ? _thumbClearanceY : 0.0))
          .clamp(0.0, size.height),
    );

    final snap = DrawingMath.findVertexSnap(
      targetScreen: rawTarget,
      features: widget.features,
      draftVertices: widget.draftVertices,
      project: controller.toScreenLocation,
      ignoreDraftIndex: _draggingDraftVertexIndex,
      externalSnapShapes: widget.externalSnapShapes,
    );

    if (snap != null && _activeSnap?.screenOffset != snap.screenOffset) {
      HapticFeedback.selectionClick();
    }

    final resolvedScreen = snap?.screenOffset ?? rawTarget;
    final resolvedCoord = snap?.point ?? controller.toLngLat(resolvedScreen);

    if (_draggingDraftVertexIndex != null) {
      widget.onUpdateDraftVertex(_draggingDraftVertexIndex!, resolvedCoord);
    }

    setState(() {
      _fingerScreen = finger;
      _targetScreen = resolvedScreen;
      _previewCoord = resolvedCoord;
      _activeSnap = snap;
    });
    widget.onPreviewChanged(resolvedScreen, snap != null, widget.loupeEnabled);
  }

  int? _hitTestDraftVertex(Offset finger, MapController controller) {
    for (var i = 0; i < widget.draftVertices.length; i++) {
      final projected = controller.toScreenLocation(widget.draftVertices[i]);
      if ((projected - finger).distance <= _vertexHitRadius) {
        return i;
      }
    }
    return null;
  }

  int? _hitTestGhostMidpoint(Offset finger, MapController controller) {
    final verts = widget.draftVertices;
    if (verts.length < 2) return null;
    for (var i = 0; i < verts.length - 1; i++) {
      final mid = DrawingMath.midpoint(verts[i], verts[i + 1]);
      final projected = controller.toScreenLocation(mid);
      if ((projected - finger).distance <= _vertexHitRadius * 0.85) {
        return i + 1;
      }
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;

    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest;
        final anchor = widget.draftVertices.isNotEmpty
            ? widget.draftVertices.last
            : null;
        final telemetry = _previewCoord != null
            ? DrawingMath.formatTelemetry(anchor, _previewCoord!)
            : '';

        return Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (e) => _handlePointerDown(e, size),
          onPointerMove: (e) => _handlePointerMove(e, size),
          onPointerUp: _handlePointerUp,
          onPointerCancel: _handlePointerCancel,
          child: Stack(
            fit: StackFit.expand,
            children: [
              // Crosshair mode: fixed center reticle for 1-handed map-under-pin drawing.
              if (_isDrawingMode &&
                  widget.placementStyle == TouchPlacementStyle.crosshair)
                IgnorePointer(
                  child: Center(
                    child: Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: accent, width: 2),
                        color: accent.withValues(alpha: 0.12),
                      ),
                      child: Center(
                        child: Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: accent,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),

              // Zero-cost GPU Magnifier Loupe (active while dragging a point/vertex).
              if (widget.loupeEnabled &&
                  _fingerScreen != null &&
                  _targetScreen != null)
                DrawingLoupe(
                  viewportSize: size,
                  fingerPosition: _fingerScreen!,
                  targetPosition: _targetScreen!,
                  telemetry: telemetry,
                  snapped: _activeSnap != null,
                ),
            ],
          ),
        );
      },
    );
  }
}

class _GeometryOverlayPainter extends CustomPainter {
  const _GeometryOverlayPainter({
    required this.controller,
    required this.features,
    required this.draftVertices,
    required this.mode,
    required this.accent,
    required this.previewScreen,
    required this.snapped,
    required this.loupeActive,
  });

  final MapController controller;
  final List<DrawnFeature> features;
  final List<Geographic> draftVertices;
  final DrawToolMode mode;
  final Color accent;
  final Offset? previewScreen;
  final bool snapped;
  final bool loupeActive;

  @override
  void paint(Canvas canvas, Size size) {
    // Committed Shelf maps and finished working draft features now render
    // directly inside MapLibre Native GPU layers (zero wrap/clipping artifacts).
    // This lightweight overlay paints only the active in-progress stroke,
    // vertex handles, ghost midpoints, and loupe ring.
    final maxCoord = size.longestSide * 4.0;
    bool isSafe(Offset pt) =>
        pt.dx.isFinite &&
        pt.dy.isFinite &&
        pt.dx.abs() < maxCoord &&
        pt.dy.abs() < maxCoord;

    final draftPts = draftVertices
        .map(controller.toScreenLocation)
        .where(isSafe)
        .toList();
    if (draftPts.isNotEmpty) {
      final strokeColor = mode == DrawToolMode.measure
          ? const Color(0xFF7C3AED)
          : EarthlyColors.proposedAmber;
      final draftPath = Path()..moveTo(draftPts.first.dx, draftPts.first.dy);
      for (var i = 1; i < draftPts.length; i++) {
        draftPath.lineTo(draftPts[i].dx, draftPts[i].dy);
      }
      if (previewScreen != null &&
          isSafe(previewScreen!) &&
          mode != DrawToolMode.point) {
        draftPath.lineTo(previewScreen!.dx, previewScreen!.dy);
      }
      if ((mode == DrawToolMode.polygon || mode == DrawToolMode.measure) &&
          (draftPts.length + (previewScreen != null ? 1 : 0)) >= 3) {
        final fillPath = Path.from(draftPath)..close();
        canvas.drawPath(
          fillPath,
          Paint()
            ..color = strokeColor.withValues(alpha: 0.16)
            ..style = PaintingStyle.fill,
        );
      }
      canvas.drawPath(
        draftPath,
        Paint()
          ..color = strokeColor
          ..strokeWidth = 2.6
          ..style = PaintingStyle.stroke,
      );

      // Ghost midpoints (draggable to insert a vertex)
      for (var i = 0; i < draftPts.length - 1; i++) {
        final mid = Offset(
          (draftPts[i].dx + draftPts[i + 1].dx) / 2,
          (draftPts[i].dy + draftPts[i + 1].dy) / 2,
        );
        canvas.drawCircle(
          mid,
          5.0,
          Paint()..color = Colors.white.withValues(alpha: 0.85),
        );
        canvas.drawCircle(
          mid,
          5.0,
          Paint()
            ..color = strokeColor
            ..strokeWidth = 1.5
            ..style = PaintingStyle.stroke,
        );
      }

      // Active vertices
      for (final pt in draftPts) {
        canvas.drawCircle(pt, 7.0, Paint()..color = Colors.white);
        canvas.drawCircle(
          pt,
          7.0,
          Paint()
            ..color = strokeColor
            ..strokeWidth = 2.4
            ..style = PaintingStyle.stroke,
        );
      }
    }

    // Active target point & magnetic snap halo.
    if (previewScreen != null && isSafe(previewScreen!)) {
      final targetColor = snapped ? EarthlyColors.proposedAmber : accent;
      if (snapped) {
        canvas.drawCircle(
          previewScreen!,
          14.0,
          Paint()
            ..color = EarthlyColors.proposedAmber.withValues(alpha: 0.24)
            ..style = PaintingStyle.fill,
        );
      }
      if (loupeActive) {
        canvas.drawCircle(
          previewScreen!,
          7.0,
          Paint()
            ..color = targetColor
            ..strokeWidth = 1.6
            ..style = PaintingStyle.stroke,
        );
      } else {
        canvas.drawCircle(previewScreen!, 6.0, Paint()..color = targetColor);
        canvas.drawCircle(
          previewScreen!,
          6.0,
          Paint()
            ..color = Colors.white
            ..strokeWidth = 2
            ..style = PaintingStyle.stroke,
        );
      }
    }
  }

  @override
  bool shouldRepaint(_GeometryOverlayPainter oldDelegate) => true;
}
