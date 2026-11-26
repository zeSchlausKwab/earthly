import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';
import 'drawing_model.dart';
import 'loupe_magnifier.dart';

/// Frame-locked vector geometry overlay rendered inside [MapLibreMap.children].
///
/// Subscribes to [CameraPosition.of] so active drafts, in-place vertex editing
/// handles, ghost midpoints, and centroid Move handles stay locked to the exact
/// GPU texture frame on screen during pan, pinch-zoom, and rotation.
class MapGeometryLayer extends StatelessWidget {
  const MapGeometryLayer({
    required this.features,
    required this.draftVertices,
    required this.mode,
    this.previewScreen,
    this.snapped = false,
    this.loupeActive = false,
    this.editingFeature,
    this.selectedVertexIndex,
    this.selectedFeatureIds = const <String>{},
    this.activePrimitiveShape = PrimitiveShapeKind.circle,
    super.key,
  });

  final List<DrawnFeature> features;
  final List<Geographic> draftVertices;
  final DrawToolMode mode;
  final Offset? previewScreen;
  final bool snapped;
  final bool loupeActive;
  final DrawnFeature? editingFeature;
  final int? selectedVertexIndex;
  final Set<String> selectedFeatureIds;
  final PrimitiveShapeKind activePrimitiveShape;

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
          editingFeature: editingFeature,
          selectedVertexIndex: selectedVertexIndex,
          selectedFeatureIds: selectedFeatureIds,
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
/// - Supports `boxSelect`, `freehand`, `shape`, `annotation`, `editVertices`,
///   `select`, `arrow`, and `splitByLine` in addition to `point`/`line`/`polygon`/`measure`.
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
    this.activePrimitiveShape = PrimitiveShapeKind.circle,
    this.snappingEnabled = true,
    this.snapToEdgesEnabled = true,
    this.editingFeature,
    this.selectedVertexIndex,
    this.selectedFeatureIds = const <String>{},
    this.onTapFeatureInSelectMode,
    this.onBoxSelect,
    this.onCommitFreehand,
    this.onCommitShape,
    this.onRequestAnnotationAt,
    this.onSelectEditingFeature,
    this.onSelectEditingVertex,
    this.onUpdateEditingVertex,
    this.onInsertEditingVertex,
    this.onTranslateFeature,
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

  final PrimitiveShapeKind activePrimitiveShape;
  final bool snappingEnabled;
  final bool snapToEdgesEnabled;
  final DrawnFeature? editingFeature;
  final int? selectedVertexIndex;
  final Set<String> selectedFeatureIds;
  final ValueChanged<String>? onTapFeatureInSelectMode;
  final ValueChanged<Rect>? onBoxSelect;
  final ValueChanged<List<Geographic>>? onCommitFreehand;
  final void Function(
    PrimitiveShapeKind shape,
    List<Geographic> ring,
    double? radiusMeters,
  )? onCommitShape;
  final ValueChanged<Geographic>? onRequestAnnotationAt;
  final ValueChanged<String>? onSelectEditingFeature;
  final ValueChanged<int?>? onSelectEditingVertex;
  final void Function(int index, Geographic pos, {bool pushUndoBefore})?
      onUpdateEditingVertex;
  final void Function(int insertIndex, Geographic pos)? onInsertEditingVertex;
  final void Function(
    String featureId,
    Offset deltaScreen, {
    bool pushUndoBefore,
  })? onTranslateFeature;

  @override
  State<TouchDrawOverlay> createState() => _TouchDrawOverlayState();
}

class _TouchDrawOverlayState extends State<TouchDrawOverlay> {
  static const double _thumbClearanceY = -48.0;
  static const double _vertexHitRadius = 22.0;
  static const double _moveHandleHitRadius = 24.0;

  final Set<int> _activePointers = <int>{};
  int? _primaryPointer;
  DateTime? _twoFingerDownAt;
  bool _multiTouchAborted = false;

  // Standard vertex placement / edit preview state
  Offset? _fingerScreen;
  Offset? _targetScreen;
  Geographic? _previewCoord;
  SnapMatch? _activeSnap;
  int? _draggingDraftVertexIndex;
  Offset? _tapDownScreen;

  // In-place editing & canvas move state
  int? _draggingEditingVertexIndex;
  bool _hasPushedDragUndo = false;
  String? _draggingMoveFeatureId;
  Offset? _lastMoveScreen;
  Geographic? _moveStartGeo;
  Geographic? _currentMoveGeo;

  // Box-select marquee state
  Offset? _boxStartScreen;
  Offset? _boxCurrentScreen;
  int _boxMatchCount = 0;

  // Freehand sketch state
  final List<Offset> _freehandScreenPts = <Offset>[];
  final List<Geographic> _freehandGeoPts = <Geographic>[];

  // Primitive shape drag / 2-tap state
  Offset? _shapeAnchorScreen;
  Offset? _shapeCurrentScreen;
  Geographic? _shapeAnchorGeo;
  List<Offset> _shapePreviewRingScreen = const <Offset>[];
  Geographic? _shapeTwoTapAnchorGeo;

  bool get _isDrawingMode => widget.mode != DrawToolMode.browse;

  bool get _forcesSingleFingerCanvas =>
      widget.mode == DrawToolMode.boxSelect ||
      widget.mode == DrawToolMode.freehand ||
      widget.mode == DrawToolMode.editVertices ||
      widget.mode == DrawToolMode.select;

  bool get _interceptSingleFinger =>
      _isDrawingMode &&
      (widget.placementStyle == TouchPlacementStyle.drawDrag ||
          _forcesSingleFingerCanvas);

  @override
  void didUpdateWidget(TouchDrawOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.mode != widget.mode ||
        oldWidget.activePrimitiveShape != widget.activePrimitiveShape) {
      _shapeTwoTapAnchorGeo = null;
    }
  }

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
    _tapDownScreen = event.localPosition;

    switch (widget.mode) {
      case DrawToolMode.boxSelect:
        setState(() {
          _boxStartScreen = event.localPosition;
          _boxCurrentScreen = event.localPosition;
          _boxMatchCount = 0;
        });
        return;

      case DrawToolMode.freehand:
        final geo = controller.toLngLat(event.localPosition);
        setState(() {
          _freehandScreenPts
            ..clear()
            ..add(event.localPosition);
          _freehandGeoPts
            ..clear()
            ..add(geo);
          _fingerScreen = event.localPosition;
          _targetScreen = event.localPosition;
          _previewCoord = geo;
          _activeSnap = null;
        });
        widget.onPreviewChanged(
          event.localPosition,
          false,
          widget.loupeEnabled,
        );
        return;

      case DrawToolMode.shape:
        if (_shapeTwoTapAnchorGeo != null) {
          final anchorScreen = controller.toScreenLocation(_shapeTwoTapAnchorGeo!);
          _updateShapeDrag(
            anchorScreen: anchorScreen,
            anchorGeo: _shapeTwoTapAnchorGeo!,
            currentFinger: event.localPosition,
            size: size,
            controller: controller,
          );
          return;
        }
        final snap = widget.snappingEnabled
            ? DrawingMath.findVertexSnap(
                targetScreen: event.localPosition,
                features: widget.features,
                draftVertices: widget.draftVertices,
                project: controller.toScreenLocation,
                externalSnapShapes: widget.externalSnapShapes,
                snapToEdges: widget.snapToEdgesEnabled,
              )
            : null;
        final anchorScreen = snap?.screenOffset ?? event.localPosition;
        final anchorGeo = snap?.point ?? controller.toLngLat(anchorScreen);
        setState(() {
          _shapeAnchorScreen = anchorScreen;
          _shapeCurrentScreen = anchorScreen;
          _shapeAnchorGeo = anchorGeo;
          _shapePreviewRingScreen = const <Offset>[];
          _fingerScreen = event.localPosition;
          _targetScreen = anchorScreen;
          _previewCoord = anchorGeo;
          _activeSnap = snap;
        });
        widget.onPreviewChanged(
          anchorScreen,
          snap != null,
          widget.loupeEnabled,
        );
        return;

      case DrawToolMode.editVertices:
        _handleEditVerticesDown(event.localPosition, size, controller);
        return;

      case DrawToolMode.select:
        _handleSelectModeDown(event.localPosition, controller);
        return;

      case DrawToolMode.browse:
      case DrawToolMode.point:
      case DrawToolMode.line:
      case DrawToolMode.polygon:
      case DrawToolMode.arrow:
      case DrawToolMode.annotation:
      case DrawToolMode.splitByLine:
      case DrawToolMode.measure:
        break;
    }

    // Standard draft vertex / midpoint drag or -48dp placement
    if (widget.mode != DrawToolMode.annotation) {
      final hitVertex = _hitTestDraftVertex(event.localPosition, controller);
      if (hitVertex != null) {
        _draggingDraftVertexIndex = hitVertex;
        _updateDragTarget(event.localPosition, size, applyThumbOffset: false);
        HapticFeedback.lightImpact();
        return;
      }

      final hitMidpoint = _hitTestGhostMidpoint(
        event.localPosition,
        controller,
        widget.draftVertices,
        closedRing: widget.mode == DrawToolMode.polygon,
      );
      if (hitMidpoint != null) {
        final coord = controller.toLngLat(event.localPosition);
        widget.onInsertDraftVertex(hitMidpoint, coord);
        _draggingDraftVertexIndex = hitMidpoint;
        _updateDragTarget(event.localPosition, size, applyThumbOffset: false);
        HapticFeedback.selectionClick();
        return;
      }
    }

    _draggingDraftVertexIndex = null;
    _updateDragTarget(event.localPosition, size, applyThumbOffset: true);
  }

  void _handleEditVerticesDown(
    Offset pos,
    Size size,
    MapController controller,
  ) {
    final editing = widget.editingFeature;
    if (editing != null) {
      // 1. Vertex handle hit test
      for (var i = 0; i < editing.vertices.length; i++) {
        final projected = controller.toScreenLocation(editing.vertices[i]);
        if ((projected - pos).distance <= _vertexHitRadius) {
          _draggingEditingVertexIndex = i;
          _hasPushedDragUndo = false;
          widget.onSelectEditingVertex?.call(i);
          _updateEditingVertexDrag(pos, size, controller);
          HapticFeedback.lightImpact();
          return;
        }
      }

      // 2. Ghost midpoint hit test (inserts vertex and starts dragging it)
      final hitMid = _hitTestGhostMidpoint(
        pos,
        controller,
        editing.vertices,
        closedRing: editing.kind == DrawToolMode.polygon,
      );
      if (hitMid != null) {
        final coord = controller.toLngLat(pos);
        widget.onInsertEditingVertex?.call(hitMid, coord);
        _draggingEditingVertexIndex = hitMid;
        _hasPushedDragUndo = true;
        _updateEditingVertexDrag(pos, size, controller);
        HapticFeedback.selectionClick();
        return;
      }

      // 3. Centroid Move handle hit test
      final centroid = DrawingMath.featureCentroid(editing);
      if (centroid != null) {
        final centroidScreen = controller.toScreenLocation(centroid);
        if ((centroidScreen - pos).distance <= _moveHandleHitRadius) {
          _startMoveHandleDrag(editing.id, centroid, pos);
          return;
        }
      }
    }
  }

  void _handleSelectModeDown(Offset pos, MapController controller) {
    final moveTarget = _primarySelectedMoveFeature();
    if (moveTarget != null) {
      final centroid = DrawingMath.featureCentroid(moveTarget);
      if (centroid != null) {
        final centroidScreen = controller.toScreenLocation(centroid);
        if ((centroidScreen - pos).distance <= _moveHandleHitRadius) {
          _startMoveHandleDrag(moveTarget.id, centroid, pos);
          return;
        }
      }
    }
  }

  DrawnFeature? _primarySelectedMoveFeature() {
    if (widget.selectedFeatureIds.isEmpty) return null;
    for (var i = widget.features.length - 1; i >= 0; i--) {
      final f = widget.features[i];
      if (widget.selectedFeatureIds.contains(f.id)) return f;
    }
    return null;
  }

  void _startMoveHandleDrag(String featureId, Geographic centroid, Offset pos) {
    HapticFeedback.lightImpact();
    setState(() {
      _draggingMoveFeatureId = featureId;
      _lastMoveScreen = pos;
      _hasPushedDragUndo = false;
      _moveStartGeo = centroid;
      _currentMoveGeo = centroid;
      _fingerScreen = pos;
      _targetScreen = pos;
      _previewCoord = centroid;
      _activeSnap = null;
    });
    widget.onPreviewChanged(pos, false, widget.loupeEnabled);
  }

  void _handlePointerMove(PointerMoveEvent event, Size size) {
    if (_multiTouchAborted || event.pointer != _primaryPointer) return;
    final controller = widget.controller;
    if (!_interceptSingleFinger || controller == null) return;

    if (widget.mode == DrawToolMode.boxSelect && _boxStartScreen != null) {
      final rect = Rect.fromPoints(_boxStartScreen!, event.localPosition);
      final matches = DrawingMath.selectFeaturesInScreenRect(
        rect: rect,
        features: widget.features,
        project: controller.toScreenLocation,
      );
      setState(() {
        _boxCurrentScreen = event.localPosition;
        _boxMatchCount = matches.length;
      });
      return;
    }

    if (widget.mode == DrawToolMode.freehand) {
      if (_freehandScreenPts.isEmpty ||
          (event.localPosition - _freehandScreenPts.last).distance >= 3.0) {
        final geo = controller.toLngLat(event.localPosition);
        setState(() {
          _freehandScreenPts.add(event.localPosition);
          _freehandGeoPts.add(geo);
          _fingerScreen = event.localPosition;
          _targetScreen = event.localPosition;
          _previewCoord = geo;
        });
        widget.onPreviewChanged(
          event.localPosition,
          false,
          widget.loupeEnabled,
        );
      }
      return;
    }

    if (widget.mode == DrawToolMode.shape &&
        _shapeAnchorScreen != null &&
        _shapeAnchorGeo != null) {
      _updateShapeDrag(
        anchorScreen: _shapeAnchorScreen!,
        anchorGeo: _shapeAnchorGeo!,
        currentFinger: event.localPosition,
        size: size,
        controller: controller,
      );
      return;
    }

    if (_draggingMoveFeatureId != null && _lastMoveScreen != null) {
      final delta = event.localPosition - _lastMoveScreen!;
      if (delta != Offset.zero) {
        widget.onTranslateFeature?.call(
          _draggingMoveFeatureId!,
          delta,
          pushUndoBefore: !_hasPushedDragUndo,
        );
        _hasPushedDragUndo = true;
        final nextGeo = controller.toLngLat(event.localPosition);
        setState(() {
          _lastMoveScreen = event.localPosition;
          _fingerScreen = event.localPosition;
          _targetScreen = event.localPosition;
          _currentMoveGeo = nextGeo;
          _previewCoord = nextGeo;
        });
        widget.onPreviewChanged(
          event.localPosition,
          false,
          widget.loupeEnabled,
        );
      }
      return;
    }

    if (widget.mode == DrawToolMode.editVertices &&
        _draggingEditingVertexIndex != null) {
      _updateEditingVertexDrag(event.localPosition, size, controller);
      return;
    }

    if (widget.mode == DrawToolMode.select ||
        widget.mode == DrawToolMode.editVertices) {
      return;
    }

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
      final controller = widget.controller;
      if (!_multiTouchAborted && _interceptSingleFinger && controller != null) {
        switch (widget.mode) {
          case DrawToolMode.boxSelect:
            if (_boxStartScreen != null) {
              final end = _boxCurrentScreen ?? event.localPosition;
              if ((end - _boxStartScreen!).distance >= 6.0) {
                HapticFeedback.mediumImpact();
                widget.onBoxSelect?.call(
                  Rect.fromPoints(_boxStartScreen!, end),
                );
              } else {
                final hit = DrawingMath.hitTestDraftFeature(
                  tapScreen: event.localPosition,
                  features: widget.features,
                  project: controller.toScreenLocation,
                );
                if (hit != null) {
                  HapticFeedback.selectionClick();
                  widget.onTapFeatureInSelectMode?.call(hit.id);
                }
              }
            }
          case DrawToolMode.freehand:
            if (_freehandGeoPts.length >= 2) {
              HapticFeedback.mediumImpact();
              widget.onCommitFreehand?.call(
                List<Geographic>.unmodifiable(_freehandGeoPts),
              );
            }
          case DrawToolMode.shape:
            _finishShapePointerUp(event.localPosition, controller);
          case DrawToolMode.annotation:
            if (_previewCoord != null) {
              HapticFeedback.mediumImpact();
              widget.onRequestAnnotationAt?.call(_previewCoord!);
            }
          case DrawToolMode.editVertices:
            if (_draggingEditingVertexIndex == null &&
                _draggingMoveFeatureId == null &&
                _tapDownScreen != null &&
                (event.localPosition - _tapDownScreen!).distance < 10.0) {
              final hit = DrawingMath.hitTestDraftFeature(
                tapScreen: event.localPosition,
                features: widget.features,
                project: controller.toScreenLocation,
              );
              if (hit != null) {
                HapticFeedback.selectionClick();
                widget.onSelectEditingFeature?.call(hit.id);
              } else if (widget.selectedVertexIndex != null) {
                widget.onSelectEditingVertex?.call(null);
              }
            }
          case DrawToolMode.select:
            if (_tapDownScreen != null &&
                (event.localPosition - _tapDownScreen!).distance < 10.0 &&
                !_hasPushedDragUndo) {
              if (_draggingMoveFeatureId != null) {
                HapticFeedback.selectionClick();
                widget.onTapFeatureInSelectMode?.call(_draggingMoveFeatureId!);
              } else {
                final hit = DrawingMath.hitTestDraftFeature(
                  tapScreen: event.localPosition,
                  features: widget.features,
                  project: controller.toScreenLocation,
                );
                if (hit != null) {
                  HapticFeedback.selectionClick();
                  widget.onTapFeatureInSelectMode?.call(hit.id);
                }
              }
            }
          case DrawToolMode.browse:
            break;
          case DrawToolMode.point:
          case DrawToolMode.line:
          case DrawToolMode.polygon:
          case DrawToolMode.arrow:
          case DrawToolMode.splitByLine:
          case DrawToolMode.measure:
            if (_previewCoord != null && _draggingDraftVertexIndex == null) {
              HapticFeedback.mediumImpact();
              widget.onCommitVertex(_previewCoord!);
            }
        }
      }
      _cancelActiveTouch();
    }

    if (_activePointers.isEmpty) {
      _multiTouchAborted = false;
      _twoFingerDownAt = null;
    }
  }

  void _finishShapePointerUp(Offset upPos, MapController controller) {
    final anchorScreen = _shapeAnchorScreen;
    final anchorGeo = _shapeAnchorGeo;
    if (anchorScreen == null || anchorGeo == null) return;

    final currentScreen = _shapeCurrentScreen ?? upPos;
    final dragDist = (currentScreen - anchorScreen).distance;

    if (dragDist >= 8.0) {
      final ring = DrawingMath.computeShapeRingFromScreenDrag(
        shape: widget.activePrimitiveShape,
        anchorScreen: anchorScreen,
        currentScreen: currentScreen,
        unproject: controller.toLngLat,
      );
      if (ring.length >= 3) {
        final radiusMeters = DrawingMath.distanceMeters(
          anchorGeo,
          controller.toLngLat(currentScreen),
        );
        HapticFeedback.mediumImpact();
        widget.onCommitShape?.call(
          widget.activePrimitiveShape,
          ring,
          radiusMeters,
        );
      }
      _shapeTwoTapAnchorGeo = null;
    } else if (_shapeTwoTapAnchorGeo == null) {
      // First tap sets center anchor for 2-tap anchor -> edge workflow.
      HapticFeedback.selectionClick();
      _shapeTwoTapAnchorGeo = anchorGeo;
    } else {
      _shapeTwoTapAnchorGeo = null;
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
      _draggingEditingVertexIndex = null;
      _draggingMoveFeatureId = null;
      _lastMoveScreen = null;
      _moveStartGeo = null;
      _currentMoveGeo = null;
      _hasPushedDragUndo = false;
      _tapDownScreen = null;
      _boxStartScreen = null;
      _boxCurrentScreen = null;
      _boxMatchCount = 0;
      _freehandScreenPts.clear();
      _freehandGeoPts.clear();
      _shapeAnchorScreen = null;
      _shapeCurrentScreen = null;
      _shapeAnchorGeo = null;
      _shapePreviewRingScreen = const <Offset>[];
    });
    widget.onPreviewChanged(null, false, false);
  }

  SnapMatch? _findSnap(
    Offset targetScreen,
    MapController controller, {
    int? ignoreDraftIndex,
  }) {
    if (!widget.snappingEnabled) return null;
    return DrawingMath.findVertexSnap(
      targetScreen: targetScreen,
      features: widget.features,
      draftVertices: widget.draftVertices,
      project: controller.toScreenLocation,
      ignoreDraftIndex: ignoreDraftIndex,
      externalSnapShapes: widget.externalSnapShapes,
      snapToEdges: widget.snapToEdgesEnabled,
    );
  }

  void _updateShapeDrag({
    required Offset anchorScreen,
    required Geographic anchorGeo,
    required Offset currentFinger,
    required Size size,
    required MapController controller,
  }) {
    final clamped = Offset(
      currentFinger.dx.clamp(0.0, size.width),
      currentFinger.dy.clamp(0.0, size.height),
    );
    final snap = _findSnap(clamped, controller);
    if (snap != null && _activeSnap?.screenOffset != snap.screenOffset) {
      HapticFeedback.selectionClick();
    }
    final resolvedScreen = snap?.screenOffset ?? clamped;
    final resolvedCoord = snap?.point ?? controller.toLngLat(resolvedScreen);
    final geoRing = DrawingMath.computeShapeRingFromScreenDrag(
      shape: widget.activePrimitiveShape,
      anchorScreen: anchorScreen,
      currentScreen: resolvedScreen,
      unproject: controller.toLngLat,
    );
    final screenRing = geoRing
        .map(controller.toScreenLocation)
        .where((p) => p.dx.isFinite && p.dy.isFinite)
        .toList(growable: false);

    setState(() {
      _shapeAnchorScreen = anchorScreen;
      _shapeAnchorGeo = anchorGeo;
      _shapeCurrentScreen = resolvedScreen;
      _shapePreviewRingScreen = screenRing;
      _fingerScreen = currentFinger;
      _targetScreen = resolvedScreen;
      _previewCoord = resolvedCoord;
      _activeSnap = snap;
    });
    widget.onPreviewChanged(
      resolvedScreen,
      snap != null,
      widget.loupeEnabled,
    );
  }

  void _updateEditingVertexDrag(
    Offset finger,
    Size size,
    MapController controller,
  ) {
    final rawTarget = Offset(
      finger.dx.clamp(0.0, size.width),
      finger.dy.clamp(0.0, size.height),
    );
    final snap = _findSnap(rawTarget, controller);
    if (snap != null && _activeSnap?.screenOffset != snap.screenOffset) {
      HapticFeedback.selectionClick();
    }
    final resolvedScreen = snap?.screenOffset ?? rawTarget;
    final resolvedCoord = snap?.point ?? controller.toLngLat(resolvedScreen);

    if (_draggingEditingVertexIndex != null) {
      widget.onUpdateEditingVertex?.call(
        _draggingEditingVertexIndex!,
        resolvedCoord,
        pushUndoBefore: !_hasPushedDragUndo,
      );
      _hasPushedDragUndo = true;
    }

    setState(() {
      _fingerScreen = finger;
      _targetScreen = resolvedScreen;
      _previewCoord = resolvedCoord;
      _activeSnap = snap;
    });
    widget.onPreviewChanged(
      resolvedScreen,
      snap != null,
      widget.loupeEnabled,
    );
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

    final snap = _findSnap(
      rawTarget,
      controller,
      ignoreDraftIndex: _draggingDraftVertexIndex,
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

  int? _hitTestGhostMidpoint(
    Offset finger,
    MapController controller,
    List<Geographic> verts, {
    bool closedRing = false,
  }) {
    if (verts.length < 2) return null;
    for (var i = 0; i < verts.length - 1; i++) {
      final mid = DrawingMath.midpoint(verts[i], verts[i + 1]);
      final projected = controller.toScreenLocation(mid);
      if ((projected - finger).distance <= _vertexHitRadius * 0.85) {
        return i + 1;
      }
    }
    if (closedRing && verts.length >= 3) {
      final mid = DrawingMath.midpoint(verts.last, verts.first);
      final projected = controller.toScreenLocation(mid);
      if ((projected - finger).distance <= _vertexHitRadius * 0.85) {
        return verts.length;
      }
    }
    return null;
  }

  String _computeLoupeTelemetry() {
    if (widget.mode == DrawToolMode.freehand) {
      return 'FREEHAND · ${_freehandGeoPts.length} pts';
    }
    if (_draggingMoveFeatureId != null &&
        _moveStartGeo != null &&
        _currentMoveGeo != null) {
      final moved = DrawingMath.distanceMeters(_moveStartGeo!, _currentMoveGeo!);
      return 'MOVE · ${DrawingMath.formatDistance(moved)}';
    }
    if (widget.mode == DrawToolMode.shape &&
        _shapeAnchorGeo != null &&
        _previewCoord != null &&
        _shapeAnchorScreen != null &&
        _shapeCurrentScreen != null) {
      return DrawingMath.formatShapeTelemetry(
        shape: widget.activePrimitiveShape,
        anchorGeo: _shapeAnchorGeo!,
        currentGeo: _previewCoord!,
        anchorScreen: _shapeAnchorScreen!,
        currentScreen: _shapeCurrentScreen!,
      );
    }
    if (widget.mode == DrawToolMode.annotation && _previewCoord != null) {
      return 'LABEL · ${DrawingMath.formatTelemetry(null, _previewCoord!)}';
    }
    final anchor = widget.draftVertices.isNotEmpty
        ? widget.draftVertices.last
        : null;
    return _previewCoord != null
        ? DrawingMath.formatTelemetry(anchor, _previewCoord!)
        : '';
  }

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    final twoTapAnchorScreen = _shapeTwoTapAnchorGeo != null &&
            widget.controller != null
        ? widget.controller!.toScreenLocation(_shapeTwoTapAnchorGeo!)
        : null;

    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest;
        final telemetry = _computeLoupeTelemetry();
        final boxRect = (_boxStartScreen != null && _boxCurrentScreen != null)
            ? Rect.fromPoints(_boxStartScreen!, _boxCurrentScreen!)
            : null;

        return Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (e) => _handlePointerDown(e, size),
          onPointerMove: (e) => _handlePointerMove(e, size),
          onPointerUp: _handlePointerUp,
          onPointerCancel: _handlePointerCancel,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (boxRect != null ||
                  _freehandScreenPts.isNotEmpty ||
                  _shapePreviewRingScreen.isNotEmpty ||
                  _shapeAnchorScreen != null ||
                  twoTapAnchorScreen != null)
                IgnorePointer(
                  child: CustomPaint(
                    size: Size.infinite,
                    painter: _InteractiveGesturePainter(
                      boxRect: boxRect,
                      freehandPts: _freehandScreenPts,
                      shapeRing: _shapePreviewRingScreen,
                      shapeAnchor: _shapeAnchorScreen ?? twoTapAnchorScreen,
                      shapeCurrent: _shapeCurrentScreen,
                      accent: accent,
                    ),
                  ),
                ),

              // Box-select live count badge
              if (boxRect != null)
                Positioned(
                  left: (boxRect.right - 76).clamp(8.0, math.max(8.0, size.width - 110)),
                  top: (boxRect.top - 28).clamp(8.0, math.max(8.0, size.height - 32)),
                  child: IgnorePointer(
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: EarthlyColors.darkSurface.withValues(alpha: 0.92),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: EarthlyColors.amber),
                      ),
                      child: Text(
                        '$_boxMatchCount selected',
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: EarthlyColors.amber,
                        ),
                      ),
                    ),
                  ),
                ),

              // Crosshair mode: fixed center reticle for 1-handed map-under-pin drawing.
              if (_isDrawingMode &&
                  !_forcesSingleFingerCanvas &&
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

              // Zero-cost GPU Magnifier Loupe (active while dragging a point/vertex/shape/freehand/move).
              if (widget.loupeEnabled &&
                  _fingerScreen != null &&
                  _targetScreen != null &&
                  widget.mode != DrawToolMode.boxSelect)
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

class _InteractiveGesturePainter extends CustomPainter {
  const _InteractiveGesturePainter({
    required this.boxRect,
    required this.freehandPts,
    required this.shapeRing,
    required this.shapeAnchor,
    required this.shapeCurrent,
    required this.accent,
  });

  final Rect? boxRect;
  final List<Offset> freehandPts;
  final List<Offset> shapeRing;
  final Offset? shapeAnchor;
  final Offset? shapeCurrent;
  final Color accent;

  @override
  void paint(Canvas canvas, Size size) {
    if (boxRect != null) {
      canvas.drawRect(
        boxRect!,
        Paint()
          ..color = EarthlyColors.amber.withValues(alpha: 0.14)
          ..style = PaintingStyle.fill,
      );
      _drawDashedRect(
        canvas,
        boxRect!,
        Paint()
          ..color = EarthlyColors.amber
          ..strokeWidth = 2.0
          ..style = PaintingStyle.stroke,
      );
    }

    if (freehandPts.length >= 2) {
      final path = Path()..moveTo(freehandPts.first.dx, freehandPts.first.dy);
      for (var i = 1; i < freehandPts.length; i++) {
        path.lineTo(freehandPts[i].dx, freehandPts[i].dy);
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = EarthlyColors.proposedAmber
          ..strokeWidth = 3.0
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..style = PaintingStyle.stroke,
      );
    }

    if (shapeRing.length >= 3) {
      final path = Path()..moveTo(shapeRing.first.dx, shapeRing.first.dy);
      for (var i = 1; i < shapeRing.length; i++) {
        path.lineTo(shapeRing[i].dx, shapeRing[i].dy);
      }
      path.close();
      canvas
        ..drawPath(
          path,
          Paint()
            ..color = EarthlyColors.proposedAmber.withValues(alpha: 0.18)
            ..style = PaintingStyle.fill,
        )
        ..drawPath(
          path,
          Paint()
            ..color = EarthlyColors.proposedAmber
            ..strokeWidth = 2.4
            ..style = PaintingStyle.stroke,
        );
    }

    if (shapeAnchor != null) {
      if (shapeCurrent != null) {
        _drawDashedLine(
          canvas,
          shapeAnchor!,
          shapeCurrent!,
          Paint()
            ..color = accent.withValues(alpha: 0.85)
            ..strokeWidth = 1.6
            ..style = PaintingStyle.stroke,
        );
      }
      final crossPaint = Paint()
        ..color = EarthlyColors.amber
        ..strokeWidth = 1.8;
      canvas
        ..drawLine(
          Offset(shapeAnchor!.dx - 8, shapeAnchor!.dy),
          Offset(shapeAnchor!.dx + 8, shapeAnchor!.dy),
          crossPaint,
        )
        ..drawLine(
          Offset(shapeAnchor!.dx, shapeAnchor!.dy - 8),
          Offset(shapeAnchor!.dx, shapeAnchor!.dy + 8),
          crossPaint,
        )
        ..drawCircle(
          shapeAnchor!,
          4.0,
          Paint()..color = Colors.white,
        )
        ..drawCircle(
          shapeAnchor!,
          4.0,
          Paint()
            ..color = EarthlyColors.amber
            ..strokeWidth = 1.8
            ..style = PaintingStyle.stroke,
        );
    }
  }

  void _drawDashedRect(Canvas canvas, Rect rect, Paint paint) {
    _drawDashedLine(canvas, rect.topLeft, rect.topRight, paint);
    _drawDashedLine(canvas, rect.topRight, rect.bottomRight, paint);
    _drawDashedLine(canvas, rect.bottomRight, rect.bottomLeft, paint);
    _drawDashedLine(canvas, rect.bottomLeft, rect.topLeft, paint);
  }

  void _drawDashedLine(Canvas canvas, Offset a, Offset b, Paint paint) {
    final total = (b - a).distance;
    if (total < 1.0) return;
    final dir = (b - a) / total;
    const dash = 7.0;
    const gap = 5.0;
    var d = 0.0;
    while (d < total) {
      final end = math.min(total, d + dash);
      canvas.drawLine(a + dir * d, a + dir * end, paint);
      d += dash + gap;
    }
  }

  @override
  bool shouldRepaint(_InteractiveGesturePainter oldDelegate) => true;
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
    required this.editingFeature,
    required this.selectedVertexIndex,
    required this.selectedFeatureIds,
  });

  final MapController controller;
  final List<DrawnFeature> features;
  final List<Geographic> draftVertices;
  final DrawToolMode mode;
  final Color accent;
  final Offset? previewScreen;
  final bool snapped;
  final bool loupeActive;
  final DrawnFeature? editingFeature;
  final int? selectedVertexIndex;
  final Set<String> selectedFeatureIds;

  @override
  void paint(Canvas canvas, Size size) {
    final maxCoord = size.longestSide * 4.0;
    bool isSafe(Offset pt) =>
        pt.dx.isFinite &&
        pt.dy.isFinite &&
        pt.dx.abs() < maxCoord &&
        pt.dy.abs() < maxCoord;

    // 1. Active in-progress draft stroke / arrow / polygon / measure / splitByLine
    final draftPts = draftVertices
        .map(controller.toScreenLocation)
        .where(isSafe)
        .toList();
    if (draftPts.isNotEmpty) {
      final strokeColor = switch (mode) {
        DrawToolMode.measure => EarthlyColors.measureViolet,
        DrawToolMode.splitByLine => EarthlyColors.destructive,
        _ => EarthlyColors.proposedAmber,
      };
      final draftPath = Path()..moveTo(draftPts.first.dx, draftPts.first.dy);
      for (var i = 1; i < draftPts.length; i++) {
        draftPath.lineTo(draftPts[i].dx, draftPts[i].dy);
      }
      if (previewScreen != null &&
          isSafe(previewScreen!) &&
          mode != DrawToolMode.point &&
          mode != DrawToolMode.annotation) {
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
          ..strokeWidth = mode == DrawToolMode.splitByLine ? 2.8 : 2.6
          ..style = PaintingStyle.stroke,
      );

      if (mode == DrawToolMode.arrow) {
        final tip = (previewScreen != null && isSafe(previewScreen!))
            ? previewScreen!
            : draftPts.last;
        final prev = (previewScreen != null && isSafe(previewScreen!))
            ? draftPts.last
            : (draftPts.length >= 2 ? draftPts[draftPts.length - 2] : null);
        if (prev != null && (tip - prev).distance > 4.0) {
          _drawArrowHead(canvas, prev, tip, strokeColor);
        }
      }

      // Ghost midpoints (draggable to insert a vertex)
      _drawGhostMidpoints(
        canvas,
        draftPts,
        strokeColor,
        closedRing: mode == DrawToolMode.polygon,
      );

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

    // 2. In-place vertex editing handles & centroid Move handle
    if (mode == DrawToolMode.editVertices && editingFeature != null) {
      final verts = editingFeature!.vertices
          .map(controller.toScreenLocation)
          .where(isSafe)
          .toList();
      if (verts.isNotEmpty) {
        final editColor = EarthlyColors.amber;
        if (verts.length >= 2) {
          final path = Path()..moveTo(verts.first.dx, verts.first.dy);
          for (var i = 1; i < verts.length; i++) {
            path.lineTo(verts[i].dx, verts[i].dy);
          }
          if (editingFeature!.kind == DrawToolMode.polygon &&
              verts.length >= 3) {
            path.close();
          }
          canvas.drawPath(
            path,
            Paint()
              ..color = editColor
              ..strokeWidth = 2.4
              ..style = PaintingStyle.stroke,
          );
        }

        _drawGhostMidpoints(
          canvas,
          verts,
          editColor,
          closedRing: editingFeature!.kind == DrawToolMode.polygon,
        );

        for (var i = 0; i < verts.length; i++) {
          final pt = verts[i];
          final isSel = selectedVertexIndex == i;
          if (isSel) {
            canvas.drawCircle(
              pt,
              14.0,
              Paint()
                ..color = EarthlyColors.infoCyanBright.withValues(alpha: 0.25),
            );
          }
          canvas.drawCircle(
            pt,
            isSel ? 9.0 : 7.5,
            Paint()..color = isSel ? EarthlyColors.amber : Colors.white,
          );
          canvas.drawCircle(
            pt,
            isSel ? 9.0 : 7.5,
            Paint()
              ..color = isSel ? EarthlyColors.infoCyanBright : editColor
              ..strokeWidth = isSel ? 2.8 : 2.3
              ..style = PaintingStyle.stroke,
          );
        }

        final centroid = DrawingMath.featureCentroid(editingFeature!);
        if (centroid != null) {
          final cPt = controller.toScreenLocation(centroid);
          if (isSafe(cPt)) {
            _drawCentroidMoveHandle(canvas, cPt);
          }
        }
      }
    }

    // 3. Centroid Move handle in Select mode for selected draft feature
    if (mode == DrawToolMode.select && selectedFeatureIds.isNotEmpty) {
      DrawnFeature? primary;
      for (var i = features.length - 1; i >= 0; i--) {
        if (selectedFeatureIds.contains(features[i].id)) {
          primary = features[i];
          break;
        }
      }
      if (primary != null) {
        final centroid = DrawingMath.featureCentroid(primary);
        if (centroid != null) {
          final cPt = controller.toScreenLocation(centroid);
          if (isSafe(cPt)) {
            _drawCentroidMoveHandle(canvas, cPt);
          }
        }
      }
    }

    // 4. Active target point & magnetic snap halo.
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

  void _drawGhostMidpoints(
    Canvas canvas,
    List<Offset> pts,
    Color strokeColor, {
    required bool closedRing,
  }) {
    if (pts.length < 2) return;
    final count = closedRing && pts.length >= 3 ? pts.length : pts.length - 1;
    for (var i = 0; i < count; i++) {
      final a = pts[i];
      final b = pts[(i + 1) % pts.length];
      final mid = Offset((a.dx + b.dx) / 2, (a.dy + b.dy) / 2);
      canvas.drawCircle(
        mid,
        5.5,
        Paint()..color = Colors.white.withValues(alpha: 0.9),
      );
      canvas.drawCircle(
        mid,
        5.5,
        Paint()
          ..color = strokeColor
          ..strokeWidth = 1.5
          ..style = PaintingStyle.stroke,
      );
      final plusPaint = Paint()
        ..color = strokeColor
        ..strokeWidth = 1.3;
      canvas
        ..drawLine(
          Offset(mid.dx - 2.6, mid.dy),
          Offset(mid.dx + 2.6, mid.dy),
          plusPaint,
        )
        ..drawLine(
          Offset(mid.dx, mid.dy - 2.6),
          Offset(mid.dx, mid.dy + 2.6),
          plusPaint,
        );
    }
  }

  void _drawCentroidMoveHandle(Canvas canvas, Offset center) {
    canvas.drawCircle(
      center,
      16.0,
      Paint()..color = EarthlyColors.infoCyanBright.withValues(alpha: 0.22),
    );
    canvas.drawCircle(
      center,
      12.0,
      Paint()..color = EarthlyColors.darkSurface.withValues(alpha: 0.92),
    );
    canvas.drawCircle(
      center,
      12.0,
      Paint()
        ..color = EarthlyColors.infoCyanBright
        ..strokeWidth = 2.0
        ..style = PaintingStyle.stroke,
    );
    final arrowPaint = Paint()
      ..color = Colors.white
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round;
    canvas
      ..drawLine(
        Offset(center.dx - 5.5, center.dy),
        Offset(center.dx + 5.5, center.dy),
        arrowPaint,
      )
      ..drawLine(
        Offset(center.dx, center.dy - 5.5),
        Offset(center.dx, center.dy + 5.5),
        arrowPaint,
      );
  }

  void _drawArrowHead(Canvas canvas, Offset from, Offset tip, Color color) {
    final angle = math.atan2(tip.dy - from.dy, tip.dx - from.dx);
    const len = 14.0;
    const spread = 0.45;
    final p1 = Offset(
      tip.dx - len * math.cos(angle - spread),
      tip.dy - len * math.sin(angle - spread),
    );
    final p2 = Offset(
      tip.dx - len * math.cos(angle + spread),
      tip.dy - len * math.sin(angle + spread),
    );
    final path = Path()
      ..moveTo(tip.dx, tip.dy)
      ..lineTo(p1.dx, p1.dy)
      ..lineTo(p2.dx, p2.dy)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_GeometryOverlayPainter oldDelegate) => true;
}
