import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:maplibre/maplibre.dart';
import 'package:path_provider/path_provider.dart';

import '../drawing/drawing_model.dart';
import '../nostr/shelf_renderer.dart';
import '../runtime/device_bridge.dart';
import '../runtime/rust_bridge.dart';
import '../shell/desk_sheet.dart';
import '../src/rust/api/geo.dart';
import '../src/rust/api/publish.dart';

/// Snapshot of the interactive finger-drag preview state rendered by
/// [MapGeometryLayer] without rebuilding heavy GPU map layers.
@immutable
class DraftPreviewState {
  const DraftPreviewState({
    this.screen,
    this.snapped = false,
    this.loupeActive = false,
  });

  final Offset? screen;
  final bool snapped;
  final bool loupeActive;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DraftPreviewState &&
          other.screen == screen &&
          other.snapped == snapped &&
          other.loupeActive == loupeActive;

  @override
  int get hashCode => Object.hash(screen, snapped, loupeActive);
}

/// Manages the working map draft, drawing tools, vertex undo/redo, spatial
/// GeoActions, import/export, measure ruler telemetry, and GPS track recording.
class DraftWorkbenchController extends ChangeNotifier {
  final ChangeNotifier geometryListenable = ChangeNotifier();
  final ChangeNotifier modeListenable = ChangeNotifier();
  final ChangeNotifier placementListenable = ChangeNotifier();
  final ChangeNotifier undoRedoListenable = ChangeNotifier();
  final ChangeNotifier gpsTrackListenable = ChangeNotifier();
  final ChangeNotifier measureListenable = ChangeNotifier();
  final ValueNotifier<DraftPreviewState> previewNotifier =
      ValueNotifier<DraftPreviewState>(const DraftPreviewState());

  DrawToolMode mode = DrawToolMode.browse;
  PrimitiveShapeKind activePrimitiveShape = PrimitiveShapeKind.circle;
  TouchPlacementStyle placementStyle = TouchPlacementStyle.drawDrag;
  bool loupeEnabled = true;
  bool snappingEnabled = true;
  bool snapToEdgesEnabled = true;

  double measureDistanceMeters = 0.0;
  double measureAreaM2 = 0.0;

  String activeDraftId = 'active-working-map';
  List<LocalDraftDto> savedDrafts = <LocalDraftDto>[];
  String draftDTag = 'field-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
  String draftTitle = 'Field Map';
  DraftAudienceChoice draftAudience = DraftAudienceChoice.publicRelay;

  final List<DrawnFeature> features = <DrawnFeature>[];
  final Set<String> selectedDraftFeatureIds = <String>{};
  final List<List<DrawnFeature>> undoStack = <List<DrawnFeature>>[];
  final List<List<DrawnFeature>> redoStack = <List<DrawnFeature>>[];
  final List<Geographic> draftVertices = <Geographic>[];
  DrawnFeature? editingDraftFeature;
  String? editingFeatureId;
  int? selectedVertexIndex;
  int featureCounter = 0;

  int draftRevision = 0;
  int selectionRevision = 0;
  int gpsTrackRevision = 0;

  bool gpsTrackRecording = false;
  bool gpsTrackPaused = false;
  final List<Geographic> gpsTrackPoints = <Geographic>[];
  double gpsTrackDistanceMeters = 0.0;

  DrawnFeature? get activeEditingFeature {
    final id = editingFeatureId;
    if (id == null) return null;
    for (final f in features) {
      if (f.id == id) return f;
    }
    return null;
  }

  bool get isDrawingMode => mode != DrawToolMode.browse;
  bool get isMeasureMode => mode == DrawToolMode.measure;
  bool get canFinishDraft => switch (mode) {
        DrawToolMode.line => draftVertices.length >= 2,
        DrawToolMode.polygon => draftVertices.length >= 3,
        DrawToolMode.arrow => draftVertices.length >= 2,
        DrawToolMode.splitByLine => draftVertices.length >= 2,
        _ => false,
      };

  MapGestures get activeMapGestures {
    final forcesSingleFingerCanvas = mode == DrawToolMode.boxSelect ||
        mode == DrawToolMode.freehand ||
        mode == DrawToolMode.editVertices ||
        mode == DrawToolMode.select;
    if (isDrawingMode &&
        (placementStyle == TouchPlacementStyle.drawDrag ||
            forcesSingleFingerCanvas)) {
      return const MapGestures(
        drag: false,
        fling: false,
        pinch: true,
        scrollWheel: true,
        doubleTap: false,
        doubleTapDrag: false,
        twoFingerDrag: true,
      );
    }
    return const MapGestures();
  }

  void _notifyGeometry({bool selectionChanged = false}) {
    draftRevision += 1;
    if (selectionChanged) selectionRevision += 1;
    geometryListenable.notifyListeners();
    notifyListeners();
  }

  void _notifySelection() {
    selectionRevision += 1;
    geometryListenable.notifyListeners();
    notifyListeners();
  }

  void updatePreview(Offset? screen, bool snapped, bool loupeActive) {
    final next = DraftPreviewState(
      screen: screen,
      snapped: snapped,
      loupeActive: loupeActive,
    );
    if (previewNotifier.value == next) return;
    previewNotifier.value = next;
  }

  void setPlacementStyle(TouchPlacementStyle next) {
    if (placementStyle == next) return;
    placementStyle = next;
    placementListenable.notifyListeners();
    notifyListeners();
  }

  void togglePlacementStyle() {
    setPlacementStyle(
      placementStyle == TouchPlacementStyle.drawDrag
          ? TouchPlacementStyle.crosshair
          : TouchPlacementStyle.drawDrag,
    );
  }

  void toggleLoupeEnabled() {
    loupeEnabled = !loupeEnabled;
    placementListenable.notifyListeners();
    notifyListeners();
  }

  void setActivePrimitiveShape(PrimitiveShapeKind shape) {
    if (activePrimitiveShape == shape) return;
    activePrimitiveShape = shape;
    modeListenable.notifyListeners();
    placementListenable.notifyListeners();
    notifyListeners();
  }

  void setSnappingEnabled(bool enabled) {
    if (snappingEnabled == enabled) return;
    snappingEnabled = enabled;
    placementListenable.notifyListeners();
    notifyListeners();
  }

  void toggleSnapping() => setSnappingEnabled(!snappingEnabled);

  void setSnapToEdgesEnabled(bool enabled) {
    if (snapToEdgesEnabled == enabled) return;
    snapToEdgesEnabled = enabled;
    placementListenable.notifyListeners();
    notifyListeners();
  }

  void toggleSnapToEdges() => setSnapToEdgesEnabled(!snapToEdgesEnabled);

  void setDraftTitle(String title, {VoidCallback? onPersist}) {
    draftTitle = title;
    notifyListeners();
    onPersist?.call();
  }

  void setDraftAudience(
    DraftAudienceChoice audience, {
    VoidCallback? onPersist,
  }) {
    draftAudience = audience;
    notifyListeners();
    onPersist?.call();
  }

  void pushUndo() {
    undoStack.add(List<DrawnFeature>.from(features));
    if (undoStack.length > 40) {
      undoStack.removeAt(0);
    }
    redoStack.clear();
    undoRedoListenable.notifyListeners();
  }

  void undoDraftEdit({
    void Function(String featureId)? onRefreshInspectedFeature,
    VoidCallback? onPersist,
  }) {
    if (undoStack.isEmpty) return;
    HapticFeedback.selectionClick();
    redoStack.add(List<DrawnFeature>.from(features));
    final prev = undoStack.removeLast();
    features
      ..clear()
      ..addAll(prev);
    _pruneSelectionInternal();
    undoRedoListenable.notifyListeners();
    _notifyGeometry(selectionChanged: true);
    onRefreshInspectedFeature?.call('');
    onPersist?.call();
  }

  void redoDraftEdit({
    void Function(String featureId)? onRefreshInspectedFeature,
    VoidCallback? onPersist,
  }) {
    if (redoStack.isEmpty) return;
    HapticFeedback.selectionClick();
    undoStack.add(List<DrawnFeature>.from(features));
    final next = redoStack.removeLast();
    features
      ..clear()
      ..addAll(next);
    _pruneSelectionInternal();
    undoRedoListenable.notifyListeners();
    _notifyGeometry(selectionChanged: true);
    onRefreshInspectedFeature?.call('');
    onPersist?.call();
  }

  void _pruneSelectionInternal() {
    final validIds = features.map((f) => f.id).toSet();
    selectedDraftFeatureIds.removeWhere((id) => !validIds.contains(id));
    if (editingFeatureId != null && !validIds.contains(editingFeatureId)) {
      editingFeatureId = null;
      selectedVertexIndex = null;
    } else if (selectedVertexIndex != null) {
      final active = activeEditingFeature;
      if (active == null ||
          selectedVertexIndex! < 0 ||
          selectedVertexIndex! >= active.vertices.length) {
        selectedVertexIndex = null;
      }
    }
  }

  void toggleSelectFeature(String id) {
    if (!selectedDraftFeatureIds.remove(id)) {
      selectedDraftFeatureIds.add(id);
    }
    _notifySelection();
  }

  void selectAllFeatures() {
    selectedDraftFeatureIds
      ..clear()
      ..addAll(features.map((f) => f.id));
    _notifySelection();
  }

  void clearSelection() {
    if (selectedDraftFeatureIds.isEmpty) return;
    selectedDraftFeatureIds.clear();
    _notifySelection();
  }

  void selectMode(
    DrawToolMode next, {
    VoidCallback? onCloseDrawers,
  }) {
    if (mode == next) {
      mode = DrawToolMode.browse;
      editingFeatureId = null;
      selectedVertexIndex = null;
    } else {
      draftVertices.clear();
      onCloseDrawers?.call();
      mode = next;
      if (next == DrawToolMode.editVertices) {
        if (editingFeatureId == null ||
            !features.any((f) => f.id == editingFeatureId)) {
          String? pick;
          for (final id in selectedDraftFeatureIds) {
            if (features.any((f) => f.id == id)) {
              pick = id;
              break;
            }
          }
          editingFeatureId = pick ?? (features.isNotEmpty ? features.last.id : null);
        }
        selectedVertexIndex = null;
      } else {
        editingFeatureId = null;
        selectedVertexIndex = null;
      }
    }
    modeListenable.notifyListeners();
    placementListenable.notifyListeners();
    geometryListenable.notifyListeners();
    notifyListeners();
  }

  void toggleMeasureMode({VoidCallback? onCloseDrawers}) {
    if (mode == DrawToolMode.measure) {
      mode = DrawToolMode.browse;
      draftVertices.clear();
      measureDistanceMeters = 0.0;
      measureAreaM2 = 0.0;
    } else {
      draftVertices.clear();
      measureDistanceMeters = 0.0;
      measureAreaM2 = 0.0;
      onCloseDrawers?.call();
      mode = DrawToolMode.measure;
    }
    modeListenable.notifyListeners();
    placementListenable.notifyListeners();
    measureListenable.notifyListeners();
    geometryListenable.notifyListeners();
    notifyListeners();
  }

  void clearMeasureVertices() {
    draftVertices.clear();
    measureDistanceMeters = 0.0;
    measureAreaM2 = 0.0;
    measureListenable.notifyListeners();
    geometryListenable.notifyListeners();
    notifyListeners();
  }

  Future<void> recomputeMeasureTelemetry() async {
    if (mode != DrawToolMode.measure) return;
    if (draftVertices.length < 2) {
      measureDistanceMeters = 0.0;
      measureAreaM2 = 0.0;
      measureListenable.notifyListeners();
      return;
    }
    try {
      await RustBridge.ensureInitialized();
      final pts = draftVertices
          .map((p) => LonLatPoint(lon: p.lon, lat: p.lat))
          .toList(growable: false);
      final dist = await geoMeasureLineMeters(points: pts);
      final area = draftVertices.length >= 3
          ? await geoMeasurePolygonAreaM2(ring: pts)
          : 0.0;
      if (mode != DrawToolMode.measure) return;
      measureDistanceMeters = dist;
      measureAreaM2 = area;
      measureListenable.notifyListeners();
    } catch (_) {}
  }

  void updateDraftVertex(int index, Geographic pos) {
    if (index < 0 || index >= draftVertices.length) return;
    draftVertices[index] = pos;
    geometryListenable.notifyListeners();
    if (mode == DrawToolMode.measure) {
      unawaited(recomputeMeasureTelemetry());
    }
  }

  void insertDraftVertex(int insertIndex, Geographic pos) {
    draftVertices.insert(insertIndex, pos);
    geometryListenable.notifyListeners();
    if (mode == DrawToolMode.measure) {
      unawaited(recomputeMeasureTelemetry());
    }
  }

  void commitVertex(Geographic point, {VoidCallback? onPersist}) {
    if (mode == DrawToolMode.point) {
      pushUndo();
      if (editingDraftFeature != null) {
        features.add(
          editingDraftFeature!.copyWith(vertices: <Geographic>[point]),
        );
        editingDraftFeature = null;
        draftVertices.clear();
        mode = DrawToolMode.browse;
        modeListenable.notifyListeners();
        placementListenable.notifyListeners();
      } else {
        featureCounter += 1;
        features.add(
          DrawnFeature(
            id: 'pt-$featureCounter',
            kind: DrawToolMode.point,
            vertices: <Geographic>[point],
          ),
        );
      }
      _notifyGeometry();
      onPersist?.call();
      return;
    }
    if (mode == DrawToolMode.line ||
        mode == DrawToolMode.polygon ||
        mode == DrawToolMode.arrow ||
        mode == DrawToolMode.splitByLine ||
        mode == DrawToolMode.measure) {
      draftVertices.add(point);
      geometryListenable.notifyListeners();
      notifyListeners();
      if (mode == DrawToolMode.measure) {
        unawaited(recomputeMeasureTelemetry());
      }
    }
  }

  void dropCrosshairPoint(
    Geographic? center, {
    VoidCallback? onPersist,
  }) {
    if (center == null) return;
    HapticFeedback.mediumImpact();
    commitVertex(center, onPersist: onPersist);
  }

  void finishDraft({VoidCallback? onPersist}) {
    if (!canFinishDraft) return;
    if (mode == DrawToolMode.splitByLine) {
      unawaited(finishSplitByLine(onPersist: onPersist));
      return;
    }
    pushUndo();
    HapticFeedback.mediumImpact();
    if (editingDraftFeature != null) {
      features.add(
        editingDraftFeature!.copyWith(
          vertices: List<Geographic>.unmodifiable(draftVertices),
        ),
      );
      editingDraftFeature = null;
      draftVertices.clear();
      mode = DrawToolMode.browse;
      modeListenable.notifyListeners();
      placementListenable.notifyListeners();
    } else if (mode == DrawToolMode.arrow) {
      featureCounter += 1;
      features.add(
        DrawnFeature(
          id: 'arrow-$featureCounter',
          kind: DrawToolMode.line,
          arrowEnd: true,
          name: 'Arrow #$featureCounter',
          vertices: List<Geographic>.unmodifiable(draftVertices),
        ),
      );
      draftVertices.clear();
    } else {
      featureCounter += 1;
      features.add(
        DrawnFeature(
          id: 'feat-$featureCounter',
          kind: mode,
          vertices: List<Geographic>.unmodifiable(draftVertices),
        ),
      );
      draftVertices.clear();
    }
    _notifyGeometry();
    onPersist?.call();
  }

  void selectEditingTargetFeature(String featureId, {bool enterMode = true}) {
    final idx = features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return;
    editingFeatureId = featureId;
    selectedVertexIndex = null;
    selectedDraftFeatureIds
      ..clear()
      ..add(featureId);
    if (enterMode && mode != DrawToolMode.editVertices) {
      draftVertices.clear();
      mode = DrawToolMode.editVertices;
      modeListenable.notifyListeners();
      placementListenable.notifyListeners();
    }
    _notifyGeometry(selectionChanged: true);
  }

  void selectVertexIndex(int? index) {
    final active = activeEditingFeature;
    if (index == null ||
        active == null ||
        index < 0 ||
        index >= active.vertices.length) {
      if (selectedVertexIndex == null) return;
      selectedVertexIndex = null;
      _notifySelection();
      return;
    }
    if (selectedVertexIndex == index) return;
    selectedVertexIndex = index;
    _notifySelection();
  }

  void updateEditingFeatureVertex(
    int index,
    Geographic pos, {
    bool pushUndoBefore = false,
    VoidCallback? onPersist,
  }) {
    final id = editingFeatureId;
    if (id == null) return;
    final idx = features.indexWhere((f) => f.id == id);
    if (idx < 0) return;
    final verts = features[idx].vertices;
    if (index < 0 || index >= verts.length) return;
    if (pushUndoBefore) {
      pushUndo();
    }
    final nextVerts = List<Geographic>.from(verts);
    nextVerts[index] = pos;
    features[idx] = features[idx].copyWith(
      vertices: List<Geographic>.unmodifiable(nextVerts),
    );
    _notifyGeometry();
    onPersist?.call();
  }

  void insertEditingFeatureVertex(
    int insertIndex,
    Geographic pos, {
    VoidCallback? onPersist,
  }) {
    final id = editingFeatureId;
    if (id == null) return;
    final idx = features.indexWhere((f) => f.id == id);
    if (idx < 0) return;
    pushUndo();
    final nextVerts = List<Geographic>.from(features[idx].vertices);
    final clamped = insertIndex.clamp(0, nextVerts.length);
    nextVerts.insert(clamped, pos);
    features[idx] = features[idx].copyWith(
      vertices: List<Geographic>.unmodifiable(nextVerts),
    );
    selectedVertexIndex = clamped;
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
  }

  bool removeSelectedEditingVertex({VoidCallback? onPersist}) {
    final id = editingFeatureId;
    final vIdx = selectedVertexIndex;
    if (id == null || vIdx == null) return false;
    final idx = features.indexWhere((f) => f.id == id);
    if (idx < 0) return false;
    final feat = features[idx];
    if (vIdx < 0 || vIdx >= feat.vertices.length) return false;
    final minVertices = switch (feat.kind) {
      DrawToolMode.polygon => 3,
      DrawToolMode.line => 2,
      _ => 1,
    };
    if (feat.vertices.length <= minVertices) return false;

    pushUndo();
    final nextVerts = List<Geographic>.from(feat.vertices)..removeAt(vIdx);
    features[idx] = feat.copyWith(
      vertices: List<Geographic>.unmodifiable(nextVerts),
    );
    selectedVertexIndex =
        nextVerts.isEmpty ? null : vIdx.clamp(0, nextVerts.length - 1);
    HapticFeedback.selectionClick();
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
    return true;
  }

  void translateFeatureOnCanvas(
    String featureId,
    Offset deltaScreen,
    Offset Function(Geographic) project,
    Geographic Function(Offset) unproject, {
    bool pushUndoBefore = false,
    VoidCallback? onPersist,
  }) {
    if (deltaScreen == Offset.zero) return;
    final idx = features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return;
    if (pushUndoBefore) {
      pushUndo();
    }
    features[idx] = DrawingMath.translateFeatureVertices(
      feature: features[idx],
      deltaScreen: deltaScreen,
      project: project,
      unproject: unproject,
    );
    _notifyGeometry();
    onPersist?.call();
  }

  DrawnFeature? commitFreehandStroke(
    List<Geographic> rawPoints, {
    VoidCallback? onPersist,
  }) {
    if (rawPoints.isEmpty) return null;
    final simplified = DrawingMath.simplifyPolyline(
      rawPoints,
      toleranceMeters: 4.0,
    );
    if (simplified.length < 2) return null;

    var west = simplified.first.lon;
    var east = simplified.first.lon;
    var south = simplified.first.lat;
    var north = simplified.first.lat;
    for (final p in simplified) {
      west = math.min(west, p.lon);
      east = math.max(east, p.lon);
      south = math.min(south, p.lat);
      north = math.max(north, p.lat);
    }
    final diagMeters = DrawingMath.distanceMeters(
      Geographic(lon: west, lat: south),
      Geographic(lon: east, lat: north),
    );
    final perimeter = DrawingMath.polylineLengthMeters(simplified);
    final endGap = DrawingMath.distanceMeters(simplified.first, simplified.last);
    final isClosedLoop = simplified.length >= 5 &&
        diagMeters > 5.0 &&
        endGap <= math.max(10.0, perimeter * 0.12) &&
        endGap < diagMeters * 0.28;

    pushUndo();
    featureCounter += 1;
    final vertices = isClosedLoop && endGap < 2.0 && simplified.length >= 4
        ? simplified.sublist(0, simplified.length - 1)
        : simplified;
    final created = DrawnFeature(
      id: 'sketch-$featureCounter',
      kind: isClosedLoop ? DrawToolMode.polygon : DrawToolMode.line,
      name: 'Sketch #$featureCounter',
      vertices: List<Geographic>.unmodifiable(vertices),
    );
    features.add(created);
    HapticFeedback.mediumImpact();
    _notifyGeometry();
    onPersist?.call();
    return created;
  }

  DrawnFeature? commitPrimitiveRing(
    PrimitiveShapeKind shape,
    List<Geographic> ring, {
    double? radiusMeters,
    VoidCallback? onPersist,
  }) {
    if (ring.length < 3) return null;
    final label =
        '${shape.name[0].toUpperCase()}${shape.name.substring(1)}';
    final name = radiusMeters != null
        ? '$label (${radiusMeters.round()}m)'
        : label;
    pushUndo();
    featureCounter += 1;
    final created = DrawnFeature(
      id: 'prim-$featureCounter',
      kind: DrawToolMode.polygon,
      vertices: List<Geographic>.unmodifiable(ring),
      name: name,
    );
    features.add(created);
    selectedDraftFeatureIds
      ..clear()
      ..add(created.id);
    HapticFeedback.mediumImpact();
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
    return created;
  }

  DrawnFeature commitAnnotationAt(
    Geographic point,
    String label, {
    VoidCallback? onPersist,
  }) {
    final trimmed = label.trim();
    pushUndo();
    featureCounter += 1;
    final finalLabel = trimmed.isEmpty ? 'Label #$featureCounter' : trimmed;
    final created = DrawnFeature(
      id: 'note-$featureCounter',
      kind: DrawToolMode.point,
      vertices: <Geographic>[point],
      name: finalLabel,
      colorHex: '#0E7490',
      displayIcon: 'lucide:message-square',
      customProperties: const <String, String>{'annotation': 'true'},
    );
    features.add(created);
    HapticFeedback.mediumImpact();
    _notifyGeometry();
    onPersist?.call();
    return created;
  }

  int commitBoxSelect(
    Rect screenRect,
    Offset Function(Geographic) project, {
    bool additive = false,
  }) {
    final matched = DrawingMath.selectFeaturesInScreenRect(
      rect: screenRect,
      features: features,
      project: project,
    );
    if (!additive) {
      selectedDraftFeatureIds.clear();
    }
    for (final f in matched) {
      selectedDraftFeatureIds.add(f.id);
    }
    _notifySelection();
    return matched.length;
  }

  Future<({bool ok, String message})> finishSplitByLine({
    VoidCallback? onPersist,
  }) async {
    if (draftVertices.length < 2) {
      return (
        ok: false,
        message: 'Draw at least 2 points for the cutting line.',
      );
    }

    int? targetIdx;
    final candidateIds = <String>[
      ?editingFeatureId,
      ...selectedDraftFeatureIds,
    ];
    for (final id in candidateIds.reversed) {
      final idx = features.indexWhere((f) => f.id == id);
      if (idx >= 0 &&
          (features[idx].kind == DrawToolMode.polygon ||
              features[idx].kind == DrawToolMode.line)) {
        targetIdx = idx;
        break;
      }
    }

    if (targetIdx == null) {
      // Prefer any feature that actually intersects the cutting line.
      for (var i = features.length - 1; i >= 0; i--) {
        final f = features[i];
        if (f.kind == DrawToolMode.line &&
            DrawingMath.splitLineByLine(f.vertices, draftVertices).length >= 2) {
          targetIdx = i;
          break;
        }
        if (f.kind == DrawToolMode.polygon &&
            DrawingMath.splitPolygonByLine(f.vertices, draftVertices).length >=
                2) {
          targetIdx = i;
          break;
        }
      }
    }

    targetIdx ??= features.lastIndexWhere(
      (f) => f.kind == DrawToolMode.polygon || f.kind == DrawToolMode.line,
    );

    if (targetIdx < 0) {
      return (ok: false, message: 'No line or polygon feature to split.');
    }

    final target = features[targetIdx];
    final cutter = List<Geographic>.unmodifiable(draftVertices);
    List<List<Geographic>> pieces = const <List<Geographic>>[];

    final isPolygon = target.kind == DrawToolMode.polygon;
    if (isPolygon || target.kind == DrawToolMode.line) {
      List<LonLatPoint> toLonLat(List<Geographic> pts) => [
            for (final v in pts) LonLatPoint(lon: v.lon, lat: v.lat),
          ];
      try {
        await RustBridge.ensureInitialized();
        final targetPts = toLonLat(target.vertices);
        final cutterPts = toLonLat(cutter);
        final out = isPolygon
            ? await geoSplitPolygonByLine(ring: targetPts, splitter: cutterPts)
            : await geoSplitLineByLine(points: targetPts, splitter: cutterPts);
        pieces = [
          for (final part in out)
            part.map((p) => Geographic(lon: p.lon, lat: p.lat)).toList(),
        ];
      } catch (_) {
        // Fall back to pure-Dart splitter when Rust FFI dylib is unavailable.
      }
      if (pieces.length < 2) {
        pieces = isPolygon
            ? DrawingMath.splitPolygonByLine(target.vertices, cutter)
            : DrawingMath.splitLineByLine(target.vertices, cutter);
      }
    }

    if (pieces.length < 2) {
      return (
        ok: false,
        message: 'Cutting line did not bisect the target feature.',
      );
    }

    final freshIdx = features.indexWhere((f) => f.id == target.id);
    if (freshIdx < 0) {
      return (ok: false, message: 'Target feature is no longer present.');
    }

    pushUndo();
    final baseName = (target.name?.trim().isNotEmpty ?? false)
        ? target.name!.trim()
        : (target.kind == DrawToolMode.polygon ? 'Polygon' : 'Line');
    features.removeAt(freshIdx);
    selectedDraftFeatureIds.remove(target.id);
    if (editingFeatureId == target.id) {
      editingFeatureId = null;
      selectedVertexIndex = null;
    }

    final createdIds = <String>[];
    for (var i = 0; i < pieces.length; i++) {
      featureCounter += 1;
      final id = 'split-$featureCounter';
      createdIds.add(id);
      features.insert(
        freshIdx + i,
        target.copyWith(
          id: id,
          vertices: List<Geographic>.unmodifiable(pieces[i]),
          extraParts: const <List<Geographic>>[],
          name: '$baseName (Part ${i + 1})',
        ),
      );
    }
    selectedDraftFeatureIds
      ..clear()
      ..addAll(createdIds);
    draftVertices.clear();
    HapticFeedback.mediumImpact();
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
    return (ok: true, message: 'Split into ${pieces.length} parts');
  }

  void undoLastPoint({VoidCallback? onPersist}) {
    if (draftVertices.isNotEmpty) {
      draftVertices.removeLast();
      geometryListenable.notifyListeners();
      notifyListeners();
      if (mode == DrawToolMode.measure) {
        unawaited(recomputeMeasureTelemetry());
      }
    } else if (mode != DrawToolMode.measure && features.isNotEmpty) {
      features.removeLast();
      _notifyGeometry();
      onPersist?.call();
    }
  }

  void startEditingDraftFeature(
    String featureId, {
    VoidCallback? onCloseDrawers,
  }) {
    final idx = features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return;
    final target = features[idx];
    editingDraftFeature = target;
    features.removeAt(idx);
    draftVertices
      ..clear()
      ..addAll(target.vertices);
    mode = target.kind;
    onCloseDrawers?.call();
    modeListenable.notifyListeners();
    placementListenable.notifyListeners();
    _notifyGeometry();
  }

  void cancelEditingDraftFeature() {
    if (editingDraftFeature != null) {
      features.add(editingDraftFeature!);
      editingDraftFeature = null;
      _notifyGeometry();
    }
    draftVertices.clear();
    mode = DrawToolMode.browse;
    modeListenable.notifyListeners();
    placementListenable.notifyListeners();
    geometryListenable.notifyListeners();
    notifyListeners();
  }

  void applyAiFeatures(List<DrawnFeature> parsed, {VoidCallback? onPersist}) {
    pushUndo();
    features
      ..clear()
      ..addAll(parsed);
    featureCounter = features.length;
    _pruneSelectionInternal();
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
  }

  DrawnFeature dropDraftPointAt(Geographic pt, {VoidCallback? onPersist}) {
    pushUndo();
    featureCounter += 1;
    final feat = DrawnFeature(
      id: 'pt-$featureCounter',
      kind: DrawToolMode.point,
      name: 'Point #$featureCounter',
      vertices: [pt],
    );
    features.add(feat);
    _notifyGeometry();
    onPersist?.call();
    return feat;
  }

  void clearDraftFeatures({VoidCallback? onPersist}) {
    pushUndo();
    features.clear();
    selectedDraftFeatureIds.clear();
    editingFeatureId = null;
    selectedVertexIndex = null;
    draftVertices.clear();
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
  }

  bool renameDraftFeature(
    String featureId,
    String newName, {
    VoidCallback? onPersist,
  }) {
    final idx = features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return false;
    pushUndo();
    features[idx] = features[idx].copyWith(name: newName);
    _notifyGeometry();
    onPersist?.call();
    return true;
  }

  bool recolorDraftFeature(
    String featureId,
    String colorHex, {
    VoidCallback? onPersist,
  }) {
    final idx = features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return false;
    pushUndo();
    features[idx] = features[idx].copyWith(colorHex: colorHex);
    _notifyGeometry();
    onPersist?.call();
    return true;
  }

  bool updateDraftFeatureStyle(
    String featureId, {
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
    String? description,
    Map<String, String>? customProperties,
    VoidCallback? onPersist,
  }) {
    final idx = features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return false;
    pushUndo();
    features[idx] = features[idx].copyWith(
      fillColorHex: fillColorHex,
      clearFillColor: clearFillColor,
      strokeColorHex: strokeColorHex,
      clearStrokeColor: clearStrokeColor,
      strokeWidth: strokeWidth,
      fillOpacity: fillOpacity,
      radius: radius,
      lineDash: lineDash,
      arrowStart: arrowStart,
      arrowEnd: arrowEnd,
      displayIcon: displayIcon,
      clearDisplayIcon: clearDisplayIcon,
      description: description,
      customProperties: customProperties,
    );
    _notifyGeometry();
    onPersist?.call();
    return true;
  }

  bool deleteDraftFeature(String featureId, {VoidCallback? onPersist}) {
    pushUndo();
    features.removeWhere((f) => f.id == featureId);
    selectedDraftFeatureIds.remove(featureId);
    _pruneSelectionInternal();
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
    return true;
  }

  bool addDraftCallout(
    String featureId,
    DraftCallout callout, {
    VoidCallback? onPersist,
  }) {
    final idx = features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return false;
    pushUndo();
    features[idx] = features[idx].copyWith(
      callouts: [...features[idx].callouts, callout],
    );
    _notifyGeometry();
    onPersist?.call();
    return true;
  }

  bool removeDraftCallout(
    String featureId,
    String calloutId, {
    VoidCallback? onPersist,
  }) {
    final idx = features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return false;
    pushUndo();
    features[idx] = features[idx].copyWith(
      callouts: features[idx]
          .callouts
          .where((c) => c.id != calloutId)
          .toList(growable: false),
    );
    _notifyGeometry();
    onPersist?.call();
    return true;
  }

  bool repositionDraftCallout(
    String featureId,
    String calloutId,
    Offset newOffset, {
    VoidCallback? onPersist,
  }) {
    final idx = features.indexWhere((f) => f.id == featureId);
    if (idx < 0) return false;
    pushUndo();
    features[idx] = features[idx].copyWith(
      callouts: [
        for (final c in features[idx].callouts)
          c.id == calloutId
              ? c.copyWith(offsetX: newOffset.dx, offsetY: newOffset.dy)
              : c,
      ],
    );
    _notifyGeometry();
    onPersist?.call();
    return true;
  }

  Set<String> deleteSelectedFeatures({VoidCallback? onPersist}) {
    if (selectedDraftFeatureIds.isEmpty) return const <String>{};
    final deleted = Set<String>.from(selectedDraftFeatureIds);
    pushUndo();
    features.removeWhere((f) => deleted.contains(f.id));
    selectedDraftFeatureIds.clear();
    _pruneSelectionInternal();
    HapticFeedback.mediumImpact();
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
    return deleted;
  }

  Future<int> duplicateDraftFeatures(
    Iterable<String> ids, {
    VoidCallback? onPersist,
  }) async {
    final targetIdSet = ids.toSet();
    final targets = features
        .where((f) => targetIdSet.contains(f.id))
        .toList(growable: false);
    if (targets.isEmpty) return 0;

    final copies = <DrawnFeature>[];
    for (final feat in targets) {
      var nudged = feat.vertices;
      if (feat.vertices.isNotEmpty) {
        try {
          await RustBridge.ensureInitialized();
          final shifted = await geoTransformPoints(
            points: feat.vertices
                .map((v) => LonLatPoint(lon: v.lon, lat: v.lat))
                .toList(),
            translateEastM: 25.0,
            translateNorthM: 0.0,
            rotateDeg: 0.0,
            scale: 1.0,
          );
          nudged = shifted
              .map((p) => Geographic(lon: p.lon, lat: p.lat))
              .toList(growable: false);
        } catch (_) {
          nudged = feat.vertices
              .map((v) => Geographic(lon: v.lon + 0.00025, lat: v.lat))
              .toList(growable: false);
        }
      }
      featureCounter += 1;
      final defaultKindName = switch (feat.kind) {
        DrawToolMode.polygon => 'Polygon',
        DrawToolMode.line => 'Line',
        _ => 'Point',
      };
      final baseName = (feat.name?.trim().isNotEmpty ?? false)
          ? feat.name!.trim()
          : defaultKindName;
      copies.add(
        feat.copyWith(
          id: 'dup-$featureCounter',
          name: '$baseName (Copy)',
          vertices: nudged,
          callouts: [
            for (var i = 0; i < feat.callouts.length; i++)
              feat.callouts[i].copyWith(
                id: 'callout-${DateTime.now().millisecondsSinceEpoch}-$featureCounter-$i',
              ),
          ],
        ),
      );
    }

    pushUndo();
    features.addAll(copies);
    selectedDraftFeatureIds
      ..clear()
      ..addAll(copies.map((c) => c.id));
    HapticFeedback.selectionClick();
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
    return copies.length;
  }

  Future<String?> addPrimitiveShape(
    String shape,
    double radiusMeters, {
    required Geographic center,
    VoidCallback? onPersist,
  }) async {
    await RustBridge.ensureInitialized();
    final ring = await geoCreatePrimitiveShape(
      center: LonLatPoint(lon: center.lon, lat: center.lat),
      shape: shape,
      radiusMeters: radiusMeters,
    );
    if (ring.length < 3) return null;
    final label = shape.isEmpty
        ? 'Shape'
        : '${shape[0].toUpperCase()}${shape.substring(1)}';
    pushUndo();
    featureCounter += 1;
    final created = DrawnFeature(
      id: 'prim-$featureCounter',
      kind: DrawToolMode.polygon,
      vertices: ring
          .map((p) => Geographic(lon: p.lon, lat: p.lat))
          .toList(growable: false),
      name: '$label (${radiusMeters.round()}m)',
    );
    features.add(created);
    selectedDraftFeatureIds
      ..clear()
      ..add(created.id);
    HapticFeedback.mediumImpact();
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
    return '$label (${radiusMeters.round()}m)';
  }

  Future<bool> transformDraftFeature(
    String featureId, {
    double translateEastM = 0.0,
    double translateNorthM = 0.0,
    double rotateDeg = 0.0,
    double scale = 1.0,
    VoidCallback? onPersist,
  }) async {
    final idx = features.indexWhere((f) => f.id == featureId);
    if (idx < 0 || features[idx].vertices.isEmpty) return false;
    await RustBridge.ensureInitialized();
    final transformed = await geoTransformPoints(
      points: features[idx]
          .vertices
          .map((v) => LonLatPoint(lon: v.lon, lat: v.lat))
          .toList(),
      translateEastM: translateEastM,
      translateNorthM: translateNorthM,
      rotateDeg: rotateDeg,
      scale: scale,
    );
    final freshIdx = features.indexWhere((f) => f.id == featureId);
    if (freshIdx < 0) return false;
    pushUndo();
    features[freshIdx] = features[freshIdx].copyWith(
      vertices: transformed
          .map((p) => Geographic(lon: p.lon, lat: p.lat))
          .toList(growable: false),
    );
    HapticFeedback.selectionClick();
    _notifyGeometry();
    onPersist?.call();
    return true;
  }

  int cloneGeoJsonToDraft(
    String sourceTitle,
    String geojson, {
    VoidCallback? onPersist,
  }) {
    final cloned = parseDraftFeaturesFromGeoJson(geojson);
    if (cloned.isEmpty) return 0;
    features
      ..clear()
      ..addAll(cloned);
    selectedDraftFeatureIds.clear();
    draftVertices.clear();
    featureCounter = features.length;
    draftTitle = '$sourceTitle (Draft)';
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
    return cloned.length;
  }

  void loadForkOrOwnedMap({
    required List<DrawnFeature> cloned,
    required bool isOwned,
    required String dTag,
    required String title,
    VoidCallback? onPersist,
  }) {
    pushUndo();
    features
      ..clear()
      ..addAll(cloned);
    selectedDraftFeatureIds.clear();
    draftVertices.clear();
    featureCounter = features.length;
    if (isOwned) {
      draftDTag = dTag;
      draftTitle = title;
    } else {
      draftDTag = 'field-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
      draftTitle = '$title (Fork)';
    }
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
  }

  void loadCircleDataset({
    required String dTag,
    required String title,
    required List<DrawnFeature> parsed,
    VoidCallback? onPersist,
  }) {
    draftAudience = DraftAudienceChoice.privateCircle;
    draftDTag = dTag;
    draftTitle = title;
    features
      ..clear()
      ..addAll(parsed);
    draftVertices.clear();
    featureCounter = parsed.length;
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
  }

  void startNewCircleDraft({
    required String circleName,
    VoidCallback? onPersist,
  }) {
    final nowSec = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    draftAudience = DraftAudienceChoice.privateCircle;
    draftDTag = 'circle-map-$nowSec';
    draftTitle = '$circleName Map';
    features.clear();
    draftVertices.clear();
    featureCounter = 0;
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
  }

  ({List<DrawnFeature> imported, GeoBox? bounds}) importGeoJsonString(
    String geojson, {
    required String prefix,
    VoidCallback? onPersist,
  }) {
    final imported = parseDraftFeaturesFromGeoJson(geojson);
    if (imported.isEmpty) return (imported: imported, bounds: null);
    pushUndo();
    for (final feat in imported) {
      featureCounter += 1;
      features.add(feat.copyWith(id: '$prefix-$featureCounter'));
    }
    _notifyGeometry();
    onPersist?.call();
    return (imported: imported, bounds: _computeVertsBounds(imported));
  }

  Future<({List<DrawnFeature> imported, String format, GeoBox? bounds})>
      importSpatialPickedFile(
    PickedBinaryFile picked, {
    VoidCallback? onPersist,
  }) async {
    await RustBridge.ensureInitialized();
    final lowerName = picked.name.toLowerCase();
    final isZipOrShp = lowerName.endsWith('.zip') ||
        lowerName.endsWith('.shp') ||
        (picked.bytes.length >= 2 &&
            picked.bytes[0] == 0x50 &&
            picked.bytes[1] == 0x4B) ||
        (picked.bytes.length >= 4 &&
            picked.bytes[0] == 0x00 &&
            picked.bytes[1] == 0x00 &&
            picked.bytes[2] == 0x27 &&
            picked.bytes[3] == 0x0A);
    final converted = isZipOrShp
        ? await geoImportShapefileBytes(
            filename: picked.name,
            bytes: picked.bytes,
          )
        : await geoImportSpatialFile(
            filename: picked.name,
            content: utf8.decode(picked.bytes, allowMalformed: true),
          );
    final imported = parseDraftFeaturesFromGeoJson(converted.geojson);
    if (imported.isEmpty) {
      return (
        imported: imported,
        format: converted.format.toUpperCase(),
        bounds: null,
      );
    }
    pushUndo();
    for (final feat in imported) {
      featureCounter += 1;
      features.add(feat.copyWith(id: 'imp-$featureCounter'));
    }
    if (draftTitle == 'Field Map' && converted.title.isNotEmpty) {
      draftTitle = converted.title;
    }
    _notifyGeometry();
    onPersist?.call();
    return (
      imported: imported,
      format: converted.format.toUpperCase(),
      bounds: _computeVertsBounds(imported),
    );
  }

  Future<({int count, String formatLabel, GeoBox? bounds})?>
      pasteGeoJsonFromClipboard({VoidCallback? onPersist}) async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final raw = data?.text?.trim() ?? '';
    if (raw.isEmpty) return null;

    List<DrawnFeature> imported;
    var formatLabel = 'GeoJSON';
    try {
      await RustBridge.ensureInitialized();
      final converted = await geoImportSpatialFile(
        filename: raw.startsWith('<') ? 'clipboard.xml' : 'clipboard.geojson',
        content: raw,
      );
      formatLabel = converted.format.toUpperCase();
      imported = parseDraftFeaturesFromGeoJson(converted.geojson);
    } catch (_) {
      imported = parseDraftFeaturesFromGeoJson(raw);
    }
    if (imported.isEmpty) {
      return (count: 0, formatLabel: formatLabel, bounds: null);
    }
    pushUndo();
    final addedIds = <String>[];
    for (final feat in imported) {
      featureCounter += 1;
      final id = 'paste-$featureCounter';
      addedIds.add(id);
      features.add(feat.copyWith(id: id));
    }
    selectedDraftFeatureIds
      ..clear()
      ..addAll(addedIds);
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
    return (
      count: imported.length,
      formatLabel: formatLabel,
      bounds: _computeVertsBounds(imported),
    );
  }

  String _safeFileStem() {
    final safeName = draftTitle
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-|-$'), '');
    return safeName.isEmpty ? 'earthly-map' : safeName;
  }

  Future<String?> exportSpatialFile(String format) async {
    if (features.isEmpty) return null;
    await RustBridge.ensureInitialized();
    final geojson = draftFeaturesToGeoJson(
      title: draftTitle,
      features: features,
    );
    final stem = _safeFileStem();
    final String content;
    final String filename;
    final String mimeType;
    switch (format) {
      case 'gpx':
        content = await geoExportGpx(geojson: geojson, title: draftTitle);
        filename = '$stem.gpx';
        mimeType = 'application/gpx+xml';
      case 'kml':
        content = await geoExportKml(geojson: geojson, title: draftTitle);
        filename = '$stem.kml';
        mimeType = 'application/vnd.google-earth.kml+xml';
      default:
        content = geojson;
        filename = '$stem.geojson';
        mimeType = 'application/geo+json';
    }
    return DeviceBridge.saveGeoJsonFile(
      filename: filename,
      content: content,
      mimeType: mimeType,
    );
  }

  Future<String?> exportShapefileZip() async {
    if (features.isEmpty) return null;
    await RustBridge.ensureInitialized();
    final geojson = draftFeaturesToGeoJson(
      title: draftTitle,
      features: features,
    );
    final stem = _safeFileStem();
    final zipBytes = await geoExportShapefileZip(
      geojson: geojson,
      title: draftTitle,
    );
    return DeviceBridge.saveBinaryFile(
      filename: '$stem-shapefile.zip',
      bytes: Uint8List.fromList(zipBytes),
      mimeType: 'application/zip',
    );
  }

  int copyGeoJsonToClipboard() {
    if (features.isEmpty) return 0;
    final geojson = draftFeaturesToGeoJson(
      title: draftTitle,
      features: features,
    );
    Clipboard.setData(ClipboardData(text: geojson));
    return features.length;
  }

  Future<DraftValidationDto> validateCurrentDraft() async {
    await RustBridge.ensureInitialized();
    final geojson = draftFeaturesToGeoJson(
      title: draftTitle,
      features: features,
    );
    return geoValidateDraftGeojson(geojson: geojson);
  }

  Future<void> runGeoAction(
    RustGeoAction action, {
    double? meters,
    double? angleDeg,
    double? scale,
    VoidCallback? onPersist,
  }) async {
    await RustBridge.ensureInitialized();
    final step = meters ?? 100.0;
    List<LonLatPoint> toPoints(List<Geographic> verts) =>
        verts.map((v) => LonLatPoint(lon: v.lon, lat: v.lat)).toList();
    List<Geographic> fromPoints(List<LonLatPoint> pts) =>
        pts.map((p) => Geographic(lon: p.lon, lat: p.lat)).toList();

    final targetIndices = <int>[
      for (var i = 0; i < features.length; i++)
        if (selectedDraftFeatureIds.isEmpty ||
            selectedDraftFeatureIds.contains(features[i].id))
          i,
    ];
    int lastIndexOfKind(DrawToolMode kind) {
      for (var i = targetIndices.length - 1; i >= 0; i--) {
        final idx = targetIndices[i];
        if (features[idx].kind == kind) return idx;
      }
      return features.lastIndexWhere((f) => f.kind == kind);
    }

    List<int> indicesOfKind(DrawToolMode kind, {int minRequired = 1}) {
      final scoped = [
        for (final idx in targetIndices)
          if (features[idx].kind == kind) idx,
      ];
      if (scoped.length >= minRequired) return scoped;
      return [
        for (var i = 0; i < features.length; i++)
          if (features[i].kind == kind) i,
      ];
    }

    switch (action) {
      case RustGeoAction.simplifyLastLine:
        final idx = lastIndexOfKind(DrawToolMode.line);
        if (idx < 0) return;
        final tol = meters ?? 25.0;
        final out = await geoSimplifyLine(
          points: toPoints(features[idx].vertices),
          toleranceMeters: tol,
        );
        pushUndo();
        features[idx] = features[idx].copyWith(vertices: fromPoints(out));
      case RustGeoAction.corridorLastLine:
        final idx = lastIndexOfKind(DrawToolMode.line);
        if (idx < 0) return;
        final ring = await geoLineCorridor(
          points: toPoints(features[idx].vertices),
          totalWidthMeters: step,
        );
        pushUndo();
        featureCounter += 1;
        features.add(DrawnFeature(
          id: 'corridor-$featureCounter',
          kind: DrawToolMode.polygon,
          vertices: fromPoints(ring),
          name: 'Corridor (${step.round()}m)',
        ));
      case RustGeoAction.extrudeBand:
        final idx = lastIndexOfKind(DrawToolMode.line);
        if (idx < 0) return;
        final startW = (step * 0.5).clamp(2.0, 2000.0);
        final ring = await geoExtrudeBand(
          points: toPoints(features[idx].vertices),
          startWidthMeters: startW,
          endWidthMeters: step,
        );
        pushUndo();
        featureCounter += 1;
        features.add(DrawnFeature(
          id: 'band-$featureCounter',
          kind: DrawToolMode.polygon,
          vertices: fromPoints(ring),
          name: 'Band (${startW.round()}–${step.round()}m)',
        ));
      case RustGeoAction.arrowLastLine:
        final idx = lastIndexOfKind(DrawToolMode.line);
        if (idx < 0) return;
        final startW = (step * 0.5).clamp(2.0, 2000.0);
        final ring = await geoExtrudeArrow(
          points: toPoints(features[idx].vertices),
          startWidthMeters: startW,
          endWidthMeters: step,
        );
        pushUndo();
        featureCounter += 1;
        features.add(DrawnFeature(
          id: 'arrow-$featureCounter',
          kind: DrawToolMode.polygon,
          vertices: fromPoints(ring),
          name: 'Flow Arrow (${step.round()}m)',
        ));
      case RustGeoAction.offsetLastLine:
        final idx = lastIndexOfKind(DrawToolMode.line);
        if (idx < 0) return;
        final out = await geoOffsetLine(
          points: toPoints(features[idx].vertices),
          distanceMeters: step,
        );
        pushUndo();
        featureCounter += 1;
        features.add(DrawnFeature(
          id: 'offset-$featureCounter',
          kind: DrawToolMode.line,
          vertices: fromPoints(out),
          name: 'Parallel (+${step.round()}m)',
        ));
      case RustGeoAction.splitLastLineAtMidpoint:
        final idx = lastIndexOfKind(DrawToolMode.line);
        if (idx < 0) return;
        final verts = features[idx].vertices;
        if (verts.length < 2) return;
        final midIdx = verts.length ~/ 2;
        final splitPt = verts.length == 2
            ? DrawingMath.midpoint(verts[0], verts[1])
            : verts[midIdx];
        final parts = await geoSplitLineAtPoint(
          points: toPoints(verts),
          splitPoint: LonLatPoint(lon: splitPt.lon, lat: splitPt.lat),
        );
        if (parts.length < 2) return;
        pushUndo();
        final base = features[idx];
        final baseName = base.name ?? 'Line';
        features.removeAt(idx);
        for (var i = 0; i < parts.length; i++) {
          featureCounter += 1;
          features.add(base.copyWith(
            id: 'split-line-$featureCounter',
            vertices: fromPoints(parts[i]),
            name: '$baseName (Part ${i + 1})',
          ));
        }
      case RustGeoAction.connectLines:
        final lineIndices = indicesOfKind(DrawToolMode.line, minRequired: 2);
        if (lineIndices.length < 2) return;
        final connected = await geoConnectLines(
          lines: [
            for (final idx in lineIndices) toPoints(features[idx].vertices),
          ],
          toleranceMeters: step,
        );
        if (connected.isEmpty) return;
        pushUndo();
        final base = features[lineIndices.first];
        for (var i = lineIndices.length - 1; i >= 0; i--) {
          features.removeAt(lineIndices[i]);
        }
        for (var i = 0; i < connected.length; i++) {
          featureCounter += 1;
          features.add(base.copyWith(
            id: 'connected-$featureCounter',
            vertices: fromPoints(connected[i]),
            name: connected.length == 1
                ? 'Connected Line'
                : 'Connected Line ${i + 1}',
          ));
        }
      case RustGeoAction.dissolveLines:
        final lineIndices = indicesOfKind(DrawToolMode.line, minRequired: 2);
        if (lineIndices.length < 2) return;
        final dissolved = await geoDissolveLines(
          lines: [
            for (final idx in lineIndices) toPoints(features[idx].vertices),
          ],
          toleranceMeters: step,
        );
        if (dissolved.isEmpty) return;
        pushUndo();
        final base = features[lineIndices.first];
        for (var i = lineIndices.length - 1; i >= 0; i--) {
          features.removeAt(lineIndices[i]);
        }
        for (var i = 0; i < dissolved.length; i++) {
          featureCounter += 1;
          features.add(base.copyWith(
            id: 'dissolved-line-$featureCounter',
            vertices: fromPoints(dissolved[i]),
            name: dissolved.length == 1
                ? 'Dissolved Line'
                : 'Dissolved Line ${i + 1}',
          ));
        }
      case RustGeoAction.simplifyPolygon:
        final idx = lastIndexOfKind(DrawToolMode.polygon);
        if (idx < 0) return;
        final tol = meters ?? 25.0;
        final out = await geoSimplifyPolygon(
          ring: toPoints(features[idx].vertices),
          toleranceMeters: tol,
        );
        if (out.length < 3) return;
        pushUndo();
        features[idx] = features[idx].copyWith(vertices: fromPoints(out));
      case RustGeoAction.offsetLastPolygon:
        final idx = lastIndexOfKind(DrawToolMode.polygon);
        if (idx < 0) return;
        final out = await geoOffsetPolygon(
          ring: toPoints(features[idx].vertices),
          distanceMeters: step,
        );
        pushUndo();
        featureCounter += 1;
        features.add(DrawnFeature(
          id: 'poly-offset-$featureCounter',
          kind: DrawToolMode.polygon,
          vertices: fromPoints(out),
          name: 'Expand (+${step.round()}m)',
        ));
      case RustGeoAction.insetPolygon:
        final idx = lastIndexOfKind(DrawToolMode.polygon);
        if (idx < 0) return;
        final out = await geoOffsetPolygon(
          ring: toPoints(features[idx].vertices),
          distanceMeters: -step,
        );
        if (out.length < 3) return;
        pushUndo();
        featureCounter += 1;
        features.add(DrawnFeature(
          id: 'poly-inset-$featureCounter',
          kind: DrawToolMode.polygon,
          vertices: fromPoints(out),
          name: 'Inset (-${step.round()}m)',
        ));
      case RustGeoAction.unionAllPolygons:
        final polyIndices =
            indicesOfKind(DrawToolMode.polygon, minRequired: 2);
        if (polyIndices.length < 2) return;
        final merged = await geoUnionPolygons(
          rings: [
            for (final idx in polyIndices) toPoints(features[idx].vertices),
          ],
        );
        pushUndo();
        for (var i = polyIndices.length - 1; i >= 0; i--) {
          features.removeAt(polyIndices[i]);
        }
        for (final ring in merged) {
          featureCounter += 1;
          features.add(DrawnFeature(
            id: 'union-$featureCounter',
            kind: DrawToolMode.polygon,
            vertices: fromPoints(ring),
            name: 'Merged Area',
          ));
        }
      case RustGeoAction.differenceLastTwoPolygons:
        final polyIndices =
            indicesOfKind(DrawToolMode.polygon, minRequired: 2);
        if (polyIndices.length < 2) return;
        final subjectIdx = polyIndices[polyIndices.length - 2];
        final clipIdx = polyIndices[polyIndices.length - 1];
        final diffRings = await geoDifferencePolygons(
          subjectRing: toPoints(features[subjectIdx].vertices),
          clipRing: toPoints(features[clipIdx].vertices),
        );
        pushUndo();
        features.removeAt(clipIdx);
        features.removeAt(subjectIdx);
        for (final ring in diffRings) {
          featureCounter += 1;
          features.add(DrawnFeature(
            id: 'diff-$featureCounter',
            kind: DrawToolMode.polygon,
            vertices: fromPoints(ring),
            name: 'Difference Area',
          ));
        }
      case RustGeoAction.splitLastPolygonByLine:
        final polyIdx = lastIndexOfKind(DrawToolMode.polygon);
        final lineIdx = lastIndexOfKind(DrawToolMode.line);
        if (polyIdx < 0 || lineIdx < 0) return;
        final pieces = await geoSplitPolygonByLine(
          ring: toPoints(features[polyIdx].vertices),
          splitter: toPoints(features[lineIdx].vertices),
        );
        if (pieces.isEmpty) return;
        pushUndo();
        features.removeAt(polyIdx);
        for (var i = 0; i < pieces.length; i++) {
          featureCounter += 1;
          features.add(DrawnFeature(
            id: 'split-$featureCounter',
            kind: DrawToolMode.polygon,
            vertices: fromPoints(pieces[i]),
            name: 'Split Part ${i + 1}',
          ));
        }
      case RustGeoAction.rotateSelected:
      case RustGeoAction.scaleSelected:
      case RustGeoAction.shiftNorth:
      case RustGeoAction.shiftEast:
        if (targetIndices.isEmpty) return;
        final tx = action == RustGeoAction.shiftEast ? step : 0.0;
        final ty = action == RustGeoAction.shiftNorth ? step : 0.0;
        final rot =
            action == RustGeoAction.rotateSelected ? (angleDeg ?? 15.0) : 0.0;
        final sc =
            action == RustGeoAction.scaleSelected ? (scale ?? 1.15) : 1.0;
        final updated = <int, List<Geographic>>{};
        for (final idx in targetIndices) {
          if (features[idx].vertices.isEmpty) continue;
          final out = await geoTransformPoints(
            points: toPoints(features[idx].vertices),
            translateEastM: tx,
            translateNorthM: ty,
            rotateDeg: rot,
            scale: sc,
          );
          updated[idx] = fromPoints(out);
        }
        if (updated.isEmpty) return;
        pushUndo();
        for (final entry in updated.entries) {
          features[entry.key] =
              features[entry.key].copyWith(vertices: entry.value);
        }
      case RustGeoAction.mergeMultipart:
        String? serializeGeom(DrawnFeature f) {
          final fc =
              jsonDecode(draftFeaturesToGeoJson(title: 'tmp', features: [f]));
          if (fc is Map<String, dynamic>) {
            final feats = fc['features'] as List?;
            if (feats != null && feats.isNotEmpty && feats.first is Map) {
              final geom = (feats.first as Map)['geometry'];
              if (geom != null) return jsonEncode(geom);
            }
          }
          return null;
        }

        var pickIndices = const <int>[];
        for (final kind in const [
          DrawToolMode.polygon,
          DrawToolMode.line,
          DrawToolMode.point,
        ]) {
          final candidates = indicesOfKind(kind, minRequired: 2);
          if (candidates.length >= 2) {
            pickIndices = candidates;
            break;
          }
        }
        if (pickIndices.length < 2) return;
        final geomJsonList = <String>[
          for (final idx in pickIndices) ?serializeGeom(features[idx]),
        ];
        if (geomJsonList.length < 2) return;
        final mergedGeomJson =
            await geoMergeToMultipart(geojsonGeometries: geomJsonList);
        final parsed = parseDraftFeaturesFromGeoJson(
          jsonEncode({
            'type': 'FeatureCollection',
            'features': [
              {
                'type': 'Feature',
                'id': 'multipart-tmp',
                'geometry': jsonDecode(mergedGeomJson),
                'properties': <String, Object?>{},
              },
            ],
          }),
        );
        if (parsed.isEmpty) return;
        final base = features[pickIndices.first];
        pushUndo();
        for (var i = pickIndices.length - 1; i >= 0; i--) {
          features.removeAt(pickIndices[i]);
        }
        featureCounter += 1;
        features.add(
          base.copyWith(
            id: 'multi-$featureCounter',
            vertices: parsed.first.vertices,
            extraParts: parsed.first.extraParts,
            name: '${base.name ?? 'Feature'} (Multi)',
          ),
        );
      case RustGeoAction.explodeMultipart:
        var targetIdx = -1;
        for (var i = targetIndices.length - 1; i >= 0; i--) {
          final idx = targetIndices[i];
          if (features[idx].isMultipart) {
            targetIdx = idx;
            break;
          }
        }
        if (targetIdx < 0) {
          targetIdx = features.lastIndexWhere((f) => f.isMultipart);
        }
        if (targetIdx < 0) return;
        final base = features[targetIdx];
        final fc = jsonDecode(
          draftFeaturesToGeoJson(title: 'tmp', features: [base]),
        );
        final singleFeat = (fc is Map<String, dynamic> &&
                fc['features'] is List &&
                (fc['features'] as List).isNotEmpty)
            ? (fc['features'] as List).first as Map
            : null;
        final geom = singleFeat?['geometry'];
        if (geom == null) return;
        final explodedJsonList =
            await geoExplodeMultipart(geojsonGeometry: jsonEncode(geom));
        final replacementFeatures = <DrawnFeature>[];
        for (var i = 0; i < explodedJsonList.length; i++) {
          final parsed = parseDraftFeaturesFromGeoJson(
            jsonEncode({
              'type': 'FeatureCollection',
              'features': [
                {
                  'type': 'Feature',
                  'id': 'part-tmp-$i',
                  'geometry': jsonDecode(explodedJsonList[i]),
                  'properties': <String, Object?>{},
                },
              ],
            }),
          );
          if (parsed.isEmpty) continue;
          featureCounter += 1;
          replacementFeatures.add(
            base.copyWith(
              id: 'part-$featureCounter',
              vertices: parsed.first.vertices,
              extraParts: const <List<Geographic>>[],
              name: base.name != null
                  ? '${base.name} (${i + 1})'
                  : 'Part ${i + 1}',
            ),
          );
        }
        if (replacementFeatures.isEmpty) return;
        pushUndo();
        features.removeAt(targetIdx);
        features.insertAll(targetIdx, replacementFeatures);
    }
    _pruneSelectionInternal();
    HapticFeedback.selectionClick();
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
  }

  // --- GPS Track Recording ---

  double computePolylineMeters(List<Geographic> pts) {
    if (pts.length < 2) return 0.0;
    var total = 0.0;
    for (var i = 1; i < pts.length; i++) {
      total += DrawingMath.distanceMeters(pts[i - 1], pts[i]);
    }
    return total;
  }

  Future<void> syncActiveGpsTrackFromService() async {
    if (!Platform.isAndroid) return;
    final status = await DeviceBridge.getGpsTrackStatus();
    if (status == null || !status.recording) return;
    final pts =
        status.points.map((p) => Geographic(lon: p.lon, lat: p.lat)).toList();
    gpsTrackRecording = true;
    gpsTrackPaused = status.paused;
    gpsTrackPoints
      ..clear()
      ..addAll(pts);
    gpsTrackDistanceMeters = computePolylineMeters(pts);
    gpsTrackRevision += 1;
    gpsTrackListenable.notifyListeners();
    notifyListeners();
  }

  /// Appends a live GPS sample when recording is active and unpaused.
  /// Ignored completely when not recording so background GPS/compass ticks
  /// never bump [gpsTrackRevision] or rebuild map layers.
  void onGpsTrackPoint(GpsTrackSample sample) {
    if (!gpsTrackRecording || gpsTrackPaused) return;
    final nextPt = Geographic(lon: sample.lon, lat: sample.lat);
    if (gpsTrackPoints.isNotEmpty) {
      gpsTrackDistanceMeters +=
          DrawingMath.distanceMeters(gpsTrackPoints.last, nextPt);
    }
    gpsTrackPoints.add(nextPt);
    gpsTrackRevision += 1;
    gpsTrackListenable.notifyListeners();
  }

  Future<void> startGpsTrack({Geographic? fallbackCenter}) async {
    if (gpsTrackRecording) return;
    if (Platform.isAndroid) {
      await DeviceBridge.startGpsTrack();
    }
    final initialPts = <Geographic>[];
    if (!Platform.isAndroid && fallbackCenter != null) {
      initialPts.add(fallbackCenter);
    }
    HapticFeedback.mediumImpact();
    gpsTrackRecording = true;
    gpsTrackPaused = false;
    gpsTrackPoints
      ..clear()
      ..addAll(initialPts);
    gpsTrackDistanceMeters = 0.0;
    gpsTrackRevision += 1;
    gpsTrackListenable.notifyListeners();
    notifyListeners();
  }

  Future<void> togglePauseGpsTrack() async {
    if (!gpsTrackRecording) return;
    final nextPaused = !gpsTrackPaused;
    if (Platform.isAndroid) {
      if (nextPaused) {
        await DeviceBridge.pauseGpsTrack();
      } else {
        await DeviceBridge.resumeGpsTrack();
      }
    }
    gpsTrackPaused = nextPaused;
    gpsTrackListenable.notifyListeners();
    notifyListeners();
  }

  Future<void> addTrackWaypointNow({Geographic? fallbackCenter}) async {
    if (!gpsTrackRecording) return;
    var pt = fallbackCenter;
    if (Platform.isAndroid) {
      try {
        final fix = await DeviceBridge.getCurrentLocation();
        pt = Geographic(lon: fix.lon, lat: fix.lat);
      } catch (_) {}
    }
    if (pt == null) return;
    HapticFeedback.selectionClick();
    if (gpsTrackPoints.isNotEmpty) {
      gpsTrackDistanceMeters +=
          DrawingMath.distanceMeters(gpsTrackPoints.last, pt);
    }
    gpsTrackPoints.add(pt);
    gpsTrackRevision += 1;
    gpsTrackListenable.notifyListeners();
  }

  Future<({int pointCount, double distanceMeters})?> finishGpsTrackToDraft({
    VoidCallback? onPersist,
  }) async {
    if (!gpsTrackRecording) return null;
    var pts = List<Geographic>.from(gpsTrackPoints);
    if (Platform.isAndroid) {
      try {
        final servicePts = await DeviceBridge.stopGpsTrack();
        if (servicePts.length > pts.length) {
          pts = servicePts
              .map((s) => Geographic(lon: s.lon, lat: s.lat))
              .toList();
        }
      } catch (_) {}
    }
    if (pts.isEmpty) {
      gpsTrackRecording = false;
      gpsTrackPaused = false;
      gpsTrackRevision += 1;
      gpsTrackListenable.notifyListeners();
      notifyListeners();
      return null;
    }
    final dist = computePolylineMeters(pts);
    final now = DateTime.now();
    final hhmm =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    pushUndo();
    HapticFeedback.mediumImpact();
    featureCounter += 1;
    features.add(
      DrawnFeature(
        id: 'gps-track-$featureCounter',
        kind: pts.length >= 2 ? DrawToolMode.line : DrawToolMode.point,
        vertices: List<Geographic>.unmodifiable(pts),
        name: 'GPS Track ($hhmm)',
        description:
            'Recorded ${pts.length} GPS points · ${DrawingMath.formatDistance(dist)}',
        colorHex: '#E11D48',
        strokeWidth: 4.0,
      ),
    );
    gpsTrackRecording = false;
    gpsTrackPaused = false;
    gpsTrackPoints.clear();
    gpsTrackDistanceMeters = 0.0;
    gpsTrackRevision += 1;
    gpsTrackListenable.notifyListeners();
    _notifyGeometry();
    onPersist?.call();
    return (pointCount: pts.length, distanceMeters: dist);
  }

  Future<void> cancelGpsTrack() async {
    if (Platform.isAndroid) {
      try {
        await DeviceBridge.stopGpsTrack();
      } catch (_) {}
    }
    gpsTrackRecording = false;
    gpsTrackPaused = false;
    gpsTrackPoints.clear();
    gpsTrackDistanceMeters = 0.0;
    gpsTrackRevision += 1;
    gpsTrackListenable.notifyListeners();
    notifyListeners();
  }

  // --- SQLite Draft Persistence ---

  Future<String> _databasePath() async {
    final dir = await getApplicationSupportDirectory();
    return '${dir.path}/earthly.sqlite3';
  }

  Future<void> refreshSavedDrafts({bool isHeadlessTest = false}) async {
    if (isHeadlessTest) return;
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      savedDrafts = await listLocalDrafts(databasePath: dbPath);
      notifyListeners();
    } catch (_) {}
  }

  Future<void> restoreSavedDraft() async {
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final all = await listLocalDrafts(databasePath: dbPath);
      final saved = await loadLocalDraft(
        databasePath: dbPath,
        draftId: activeDraftId,
      );
      savedDrafts = all;
      final target = saved ?? (all.isNotEmpty ? all.first : null);
      if (target == null) {
        notifyListeners();
        return;
      }
      final restored = parseDraftFeaturesFromGeoJson(target.geojson);
      activeDraftId = target.draftId;
      draftDTag = target.dTag;
      draftTitle = target.title;
      draftAudience = target.audienceChannel == 'nearby'
          ? DraftAudienceChoice.nearbyLocalNode
          : DraftAudienceChoice.publicRelay;
      features
        ..clear()
        ..addAll(restored);
      featureCounter = restored.length;
      _notifyGeometry();
    } catch (_) {}
  }

  void selectSavedDraft(LocalDraftDto draft) {
    final restored = parseDraftFeaturesFromGeoJson(draft.geojson);
    activeDraftId = draft.draftId;
    draftDTag = draft.dTag;
    draftTitle = draft.title;
    draftAudience = draft.audienceChannel == 'nearby'
        ? DraftAudienceChoice.nearbyLocalNode
        : DraftAudienceChoice.publicRelay;
    features
      ..clear()
      ..addAll(restored);
    selectedDraftFeatureIds.clear();
    draftVertices.clear();
    editingDraftFeature = null;
    featureCounter = restored.length;
    _notifyGeometry(selectionChanged: true);
  }

  void createNewDraft({VoidCallback? onPersist}) {
    final nowSec = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    activeDraftId = 'draft-$nowSec';
    draftDTag = 'field-$nowSec';
    draftTitle = 'Field Map ${savedDrafts.length + 1}';
    features.clear();
    selectedDraftFeatureIds.clear();
    draftVertices.clear();
    editingDraftFeature = null;
    featureCounter = 0;
    _notifyGeometry(selectionChanged: true);
    onPersist?.call();
  }

  Future<void> deleteSavedDraft(
    String draftId, {
    VoidCallback? onPersist,
  }) async {
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      await deleteLocalDraft(databasePath: dbPath, draftId: draftId);
      final remaining = await listLocalDrafts(databasePath: dbPath);
      savedDrafts = remaining;
      if (activeDraftId == draftId) {
        if (remaining.isNotEmpty) {
          selectSavedDraft(remaining.first);
        } else {
          createNewDraft(onPersist: onPersist);
        }
      } else {
        notifyListeners();
      }
    } catch (_) {}
  }

  Future<void> persistWorkingDraft({
    bool isHeadlessTest = false,
    VoidCallback? onAfterPersist,
  }) async {
    if (isHeadlessTest) return;
    try {
      await RustBridge.ensureInitialized();
      final dbPath = await _databasePath();
      final geojson = draftFeaturesToGeoJson(
        title: draftTitle,
        features: features,
      );
      await saveLocalDraft(
        databasePath: dbPath,
        draftId: activeDraftId,
        dTag: draftDTag,
        title: draftTitle,
        audienceChannel: draftAudience == DraftAudienceChoice.nearbyLocalNode
            ? 'nearby'
            : 'public',
        geojson: geojson,
      );
      await refreshSavedDrafts(isHeadlessTest: isHeadlessTest);
      onAfterPersist?.call();
    } catch (_) {}
  }

  GeoBox? _computeVertsBounds(List<DrawnFeature> imported) {
    final allVerts = imported.expand((f) => f.vertices).toList();
    if (allVerts.isEmpty) return null;
    var west = allVerts.first.lon;
    var east = allVerts.first.lon;
    var south = allVerts.first.lat;
    var north = allVerts.first.lat;
    for (final v in allVerts) {
      if (v.lon < west) west = v.lon;
      if (v.lon > east) east = v.lon;
      if (v.lat < south) south = v.lat;
      if (v.lat > north) north = v.lat;
    }
    const pad = 0.002;
    return GeoBox(
      west: (west - pad).clamp(-180.0, 180.0),
      south: (south - pad).clamp(-85.0, 85.0),
      east: (east + pad).clamp(-180.0, 180.0),
      north: (north + pad).clamp(-85.0, 85.0),
    );
  }

  GeoBox? computeDraftBounds() => _computeVertsBounds(features);

  @override
  void dispose() {
    geometryListenable.dispose();
    modeListenable.dispose();
    placementListenable.dispose();
    undoRedoListenable.dispose();
    gpsTrackListenable.dispose();
    measureListenable.dispose();
    previewNotifier.dispose();
    super.dispose();
  }
}
