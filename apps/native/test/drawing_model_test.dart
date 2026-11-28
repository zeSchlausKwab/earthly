import 'package:earthly_native/controllers/draft_workbench_controller.dart';
import 'package:earthly_native/drawing/drawing_model.dart';
import 'package:earthly_native/drawing/loupe_magnifier.dart';
import 'package:earthly_native/drawing/touch_draw_overlay.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

class _FakeMapController implements MapController {
  static Offset projectFn(Geographic g) => Offset(
        (g.lon - 16.35) * 10000,
        (48.22 - g.lat) * 10000,
      );

  static Geographic unprojectFn(Offset p) => Geographic(
        lon: 16.35 + p.dx / 10000,
        lat: 48.22 - p.dy / 10000,
      );

  @override
  Offset toScreenLocation(Geographic lngLat) => projectFn(lngLat);

  @override
  Geographic toLngLat(Offset screenLocation) => unprojectFn(screenLocation);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  Offset project(Geographic g) => _FakeMapController.projectFn(g);
  Geographic unproject(Offset p) => _FakeMapController.unprojectFn(p);

  group('DrawingMath', () {
    test('computes realistic distance and bearing in Vienna', () {
      const stephansdom = Geographic(lon: 16.3738, lat: 48.2082);
      const rathaus = Geographic(lon: 16.3574, lat: 48.2108);

      final meters = DrawingMath.distanceMeters(stephansdom, rathaus);
      expect(meters, greaterThan(1100));
      expect(meters, lessThan(1400));

      final bearing = DrawingMath.bearingDegrees(stephansdom, rathaus);
      expect(bearing, greaterThan(270));
      expect(bearing, lessThan(300));
      expect(DrawingMath.formatTelemetry(stephansdom, rathaus), contains('km ·'));
    });

    test('snaps magnetically to nearest vertex within pixel threshold', () {
      const origin = Geographic(lon: 16.37, lat: 48.21);
      const existing = DrawnFeature(
        id: 'pt-1',
        kind: DrawToolMode.point,
        vertices: <Geographic>[origin],
      );

      final near = project(origin) + const Offset(8, -6);
      final snap = DrawingMath.findVertexSnap(
        targetScreen: near,
        features: const [existing],
        draftVertices: const [],
        project: project,
      );
      expect(snap, isNotNull);
      expect(snap!.point, origin);
      expect(snap.label, 'vertex');

      final far = project(origin) + const Offset(40, 40);
      final noSnap = DrawingMath.findVertexSnap(
        targetScreen: far,
        features: const [existing],
        draftVertices: const [],
        project: project,
      );
      expect(noSnap, isNull);
    });

    test('snaps to draft edges and external Shelf vertices/edges with vertex priority', () {
      const a = Geographic(lon: 16.36, lat: 48.21);
      const b = Geographic(lon: 16.38, lat: 48.21);
      const draftLine = DrawnFeature(
        id: 'line-1',
        kind: DrawToolMode.line,
        vertices: <Geographic>[a, b],
      );
      const shelfA = Geographic(lon: 16.36, lat: 48.20);
      const shelfB = Geographic(lon: 16.38, lat: 48.20);

      // 1. Midpoint along draft edge -> snaps to edge
      final nearMidEdge =
          project(const Geographic(lon: 16.37, lat: 48.21)) + const Offset(0, 6);
      final edgeSnap = DrawingMath.findVertexSnap(
        targetScreen: nearMidEdge,
        features: const [draftLine],
        draftVertices: const [],
        project: project,
      );
      expect(edgeSnap, isNotNull);
      expect(edgeSnap!.label, 'edge');
      expect(edgeSnap.point.lon, closeTo(16.37, 1e-5));
      expect(edgeSnap.point.lat, closeTo(48.21, 1e-5));

      // 2. Near endpoint of draft line -> vertex takes priority over edge
      final nearEndpoint = project(a) + const Offset(5, 4);
      final vertexSnap = DrawingMath.findVertexSnap(
        targetScreen: nearEndpoint,
        features: const [draftLine],
        draftVertices: const [],
        project: project,
      );
      expect(vertexSnap, isNotNull);
      expect(vertexSnap!.label, 'vertex');
      expect(vertexSnap.point, a);

      // 3. External Shelf vertex & Shelf edge snapping
      final nearShelfVertex = project(shelfA) + const Offset(4, -4);
      final shelfVertexSnap = DrawingMath.findVertexSnap(
        targetScreen: nearShelfVertex,
        features: const [],
        draftVertices: const [],
        externalSnapShapes: const [
          [shelfA, shelfB],
        ],
        project: project,
      );
      expect(shelfVertexSnap, isNotNull);
      expect(shelfVertexSnap!.label, 'shelf vertex');
      expect(shelfVertexSnap.point, shelfA);

      final nearShelfEdge =
          project(const Geographic(lon: 16.37, lat: 48.20)) + const Offset(0, -5);
      final shelfEdgeSnap = DrawingMath.findVertexSnap(
        targetScreen: nearShelfEdge,
        features: const [],
        draftVertices: const [],
        externalSnapShapes: const [
          [shelfA, shelfB],
        ],
        project: project,
      );
      expect(shelfEdgeSnap, isNotNull);
      expect(shelfEdgeSnap!.label, 'shelf edge');
      expect(shelfEdgeSnap.point.lon, closeTo(16.37, 1e-5));
    });

    test('simplifyPolyline reduces collinear jitter while preserving corners', () {
      const raw = <Geographic>[
        Geographic(lon: 16.36000, lat: 48.21000),
        Geographic(lon: 16.36200, lat: 48.21001), // ~1m off straight line
        Geographic(lon: 16.36400, lat: 48.21000),
        Geographic(lon: 16.36600, lat: 48.21001),
        Geographic(lon: 16.36800, lat: 48.21000), // corner
        Geographic(lon: 16.36800, lat: 48.21500), // ~555m north
      ];

      final simplified = DrawingMath.simplifyPolyline(raw, toleranceMeters: 4.0);
      expect(simplified.length, 3);
      expect(simplified.first, raw.first);
      expect(simplified[1], raw[4]);
      expect(simplified.last, raw.last);
    });

    test('computeShapeRingFromScreenDrag generates expected vertex counts and telemetry', () {
      const anchor = Offset(200, 200);
      const edge = Offset(260, 240);

      expect(
        DrawingMath.computeShapeRingFromScreenDrag(
          shape: PrimitiveShapeKind.circle,
          anchorScreen: anchor,
          currentScreen: edge,
          unproject: unproject,
          circleSteps: 24,
        ).length,
        24,
      );
      expect(
        DrawingMath.computeShapeRingFromScreenDrag(
          shape: PrimitiveShapeKind.square,
          anchorScreen: anchor,
          currentScreen: edge,
          unproject: unproject,
        ).length,
        4,
      );
      expect(
        DrawingMath.computeShapeRingFromScreenDrag(
          shape: PrimitiveShapeKind.rectangle,
          anchorScreen: anchor,
          currentScreen: edge,
          unproject: unproject,
        ).length,
        4,
      );
      expect(
        DrawingMath.computeShapeRingFromScreenDrag(
          shape: PrimitiveShapeKind.triangle,
          anchorScreen: anchor,
          currentScreen: edge,
          unproject: unproject,
        ).length,
        3,
      );
      expect(
        DrawingMath.computeShapeRingFromScreenDrag(
          shape: PrimitiveShapeKind.diamond,
          anchorScreen: anchor,
          currentScreen: edge,
          unproject: unproject,
        ).length,
        4,
      );
      expect(
        DrawingMath.computeShapeRingFromScreenDrag(
          shape: PrimitiveShapeKind.hexagon,
          anchorScreen: anchor,
          currentScreen: edge,
          unproject: unproject,
        ).length,
        6,
      );

      final circleTelemetry = DrawingMath.formatShapeTelemetry(
        shape: PrimitiveShapeKind.circle,
        anchorGeo: unproject(anchor),
        currentGeo: unproject(edge),
        anchorScreen: anchor,
        currentScreen: edge,
      );
      expect(circleTelemetry, startsWith('CIRCLE · r '));

      final rectTelemetry = DrawingMath.formatShapeTelemetry(
        shape: PrimitiveShapeKind.rectangle,
        anchorGeo: unproject(anchor),
        currentGeo: unproject(edge),
        anchorScreen: anchor,
        currentScreen: edge,
      );
      expect(rectTelemetry, startsWith('RECTANGLE · '));
      expect(rectTelemetry, contains('×'));
    });

    test('hitTestDraftFeature, selectFeaturesInScreenRect, translateFeatureVertices, and featureCentroid work accurately', () {
      final pt = DrawnFeature(
        id: 'pt-1',
        kind: DrawToolMode.point,
        vertices: <Geographic>[unproject(const Offset(100, 100))],
      );
      final line = DrawnFeature(
        id: 'line-1',
        kind: DrawToolMode.line,
        vertices: <Geographic>[
          unproject(const Offset(200, 100)),
          unproject(const Offset(300, 100)),
        ],
      );
      final poly = DrawnFeature(
        id: 'poly-1',
        kind: DrawToolMode.polygon,
        vertices: <Geographic>[
          unproject(const Offset(150, 200)),
          unproject(const Offset(250, 200)),
          unproject(const Offset(250, 300)),
          unproject(const Offset(150, 300)),
        ],
      );
      final all = <DrawnFeature>[pt, line, poly];

      expect(
        DrawingMath.hitTestDraftFeature(
          tapScreen: const Offset(105, 104),
          features: all,
          project: project,
        )?.id,
        'pt-1',
      );
      expect(
        DrawingMath.hitTestDraftFeature(
          tapScreen: const Offset(250, 108),
          features: all,
          project: project,
        )?.id,
        'line-1',
      );
      expect(
        DrawingMath.hitTestDraftFeature(
          tapScreen: const Offset(200, 250), // interior of poly
          features: all,
          project: project,
        )?.id,
        'poly-1',
      );

      final boxMatches = DrawingMath.selectFeaturesInScreenRect(
        rect: const Rect.fromLTRB(90, 90, 220, 130),
        features: all,
        project: project,
      );
      expect(boxMatches.map((f) => f.id).toSet(), {'pt-1', 'line-1'});

      final centroid = DrawingMath.featureCentroid(poly)!;
      expect(project(centroid).dx, closeTo(200, 1e-4));
      expect(project(centroid).dy, closeTo(250, 1e-4));

      final shifted = DrawingMath.translateFeatureVertices(
        feature: poly,
        deltaScreen: const Offset(40, -20),
        project: project,
        unproject: unproject,
      );
      final shiftedCentroid = DrawingMath.featureCentroid(shifted)!;
      expect(project(shiftedCentroid).dx, closeTo(240, 1e-4));
      expect(project(shiftedCentroid).dy, closeTo(230, 1e-4));
    });

    test('splitLineByLine and splitPolygonByLine bisect target geometry cleanly', () {
      final line = <Geographic>[
        unproject(const Offset(100, 200)),
        unproject(const Offset(300, 200)),
      ];
      final cutter = <Geographic>[
        unproject(const Offset(200, 150)),
        unproject(const Offset(200, 250)),
      ];
      final lineParts = DrawingMath.splitLineByLine(line, cutter);
      expect(lineParts.length, 2);
      expect(project(lineParts[0].last).dx, closeTo(200, 0.5));
      expect(project(lineParts[1].first).dx, closeTo(200, 0.5));

      final square = <Geographic>[
        unproject(const Offset(100, 100)),
        unproject(const Offset(300, 100)),
        unproject(const Offset(300, 300)),
        unproject(const Offset(100, 300)),
      ];
      final polyCutter = <Geographic>[
        unproject(const Offset(200, 80)),
        unproject(const Offset(200, 320)),
      ];
      final polyParts = DrawingMath.splitPolygonByLine(square, polyCutter);
      expect(polyParts.length, 2);
      expect(polyParts[0].length, greaterThanOrEqualTo(4));
      expect(polyParts[1].length, greaterThanOrEqualTo(4));
    });

    test('computeFeatureScreenBounds and rotateAndScaleFeatureVertices support Point, Line, Polygon, Multipart, and clamp scale 0.2..5.0', () {
      final point = DrawnFeature(
        id: 'pt-x',
        kind: DrawToolMode.point,
        vertices: <Geographic>[unproject(const Offset(120, 140))],
      );
      final ptBounds = DrawingMath.computeFeatureScreenBounds(
        feature: point,
        project: project,
      )!;
      expect(ptBounds.left, closeTo(120, 1e-6));
      expect(ptBounds.top, closeTo(140, 1e-6));
      expect(ptBounds.right, closeTo(120, 1e-6));
      expect(ptBounds.bottom, closeTo(140, 1e-6));
      final samePt = DrawingMath.rotateAndScaleFeatureVertices(
        feature: point,
        rotateDeg: 45,
        scale: 2.0,
        project: project,
        unproject: unproject,
      );
      expect(samePt.vertices.single, point.vertices.single);

      final line = DrawnFeature(
        id: 'line-x',
        kind: DrawToolMode.line,
        vertices: <Geographic>[
          unproject(const Offset(100, 200)),
          unproject(const Offset(200, 200)),
        ],
      );
      final rotatedLine = DrawingMath.rotateAndScaleFeatureVertices(
        feature: line,
        rotateDeg: 90,
        scale: 1.5,
        project: project,
        unproject: unproject,
      );
      // Centroid is (150, 200). Left vertex (-50, 0) * 1.5 rotated +90deg -> (0, -75) -> (150, 125).
      expect(project(rotatedLine.vertices[0]).dx, closeTo(150, 0.05));
      expect(project(rotatedLine.vertices[0]).dy, closeTo(125, 0.05));
      expect(project(rotatedLine.vertices[1]).dx, closeTo(150, 0.05));
      expect(project(rotatedLine.vertices[1]).dy, closeTo(275, 0.05));

      final multiPoly = DrawnFeature(
        id: 'multi-x',
        kind: DrawToolMode.polygon,
        vertices: <Geographic>[
          unproject(const Offset(100, 100)),
          unproject(const Offset(140, 100)),
          unproject(const Offset(140, 140)),
          unproject(const Offset(100, 140)),
        ],
        extraParts: <List<Geographic>>[
          <Geographic>[
            unproject(const Offset(160, 160)),
            unproject(const Offset(200, 160)),
            unproject(const Offset(200, 200)),
            unproject(const Offset(160, 200)),
          ],
        ],
      );
      final multiBounds = DrawingMath.computeFeatureScreenBounds(
        feature: multiPoly,
        project: project,
      )!;
      expect(multiBounds.left, closeTo(100, 1e-6));
      expect(multiBounds.top, closeTo(100, 1e-6));
      expect(multiBounds.right, closeTo(200, 1e-6));
      expect(multiBounds.bottom, closeTo(200, 1e-6));

      // Scale clamping: 0.05 -> 0.2, 12.0 -> 5.0
      final clampedMin = DrawingMath.rotateAndScaleFeatureVertices(
        feature: line,
        rotateDeg: 0,
        scale: 0.05,
        project: project,
        unproject: unproject,
      );
      expect(
        (project(clampedMin.vertices[1]) - project(clampedMin.vertices[0]))
            .distance,
        closeTo(100 * 0.2, 0.05),
      );
      final clampedMax = DrawingMath.rotateAndScaleFeatureVertices(
        feature: line,
        rotateDeg: 0,
        scale: 12.0,
        project: project,
        unproject: unproject,
      );
      expect(
        (project(clampedMax.vertices[1]) - project(clampedMax.vertices[0]))
            .distance,
        closeTo(100 * 5.0, 0.05),
      );

      final scaledMulti = DrawingMath.rotateAndScaleFeatureVertices(
        feature: multiPoly,
        rotateDeg: 0,
        scale: 2.0,
        project: project,
        unproject: unproject,
      );
      expect(scaledMulti.extraParts.length, 1);
      // Centroid of multiPoly is (150, 150); (200, 200) at 2.0x becomes (250, 250).
      expect(project(scaledMulti.extraParts.first[2]).dx, closeTo(250, 0.05));
      expect(project(scaledMulti.extraParts.first[2]).dy, closeTo(250, 0.05));
    });
  });

  group('DraftWorkbenchController Phase D authoring', () {
    test('supports in-place vertex insert/move/delete, canvas translate, undo/redo', () {
      final ctrl = DraftWorkbenchController();
      addTearDown(ctrl.dispose);

      ctrl.selectMode(DrawToolMode.polygon);
      ctrl.commitVertex(unproject(const Offset(100, 100)));
      ctrl.commitVertex(unproject(const Offset(200, 100)));
      ctrl.commitVertex(unproject(const Offset(200, 200)));
      expect(ctrl.canFinishDraft, isTrue);
      ctrl.finishDraft();
      expect(ctrl.features.length, 1);

      final featId = ctrl.features.first.id;
      ctrl.selectEditingTargetFeature(featId);
      expect(ctrl.mode, DrawToolMode.editVertices);
      expect(ctrl.activeEditingFeature?.id, featId);

      // Insert vertex
      ctrl.insertEditingFeatureVertex(2, unproject(const Offset(240, 150)));
      expect(ctrl.activeEditingFeature!.vertices.length, 4);
      expect(ctrl.selectedVertexIndex, 2);

      // Move vertex with undo checkpoint
      ctrl.updateEditingFeatureVertex(
        2,
        unproject(const Offset(260, 160)),
        pushUndoBefore: true,
      );
      expect(
        project(ctrl.activeEditingFeature!.vertices[2]).dx,
        closeTo(260, 0.1),
      );

      // Delete selected vertex
      final removed = ctrl.removeSelectedEditingVertex();
      expect(removed, isTrue);
      expect(ctrl.activeEditingFeature!.vertices.length, 3);

      // Guard: cannot delete polygon below 3 vertices
      expect(ctrl.removeSelectedEditingVertex(), isFalse);
      expect(ctrl.activeEditingFeature!.vertices.length, 3);

      // Canvas translate
      ctrl.translateFeatureOnCanvas(
        featId,
        const Offset(30, 15),
        project,
        unproject,
        pushUndoBefore: true,
      );
      expect(
        project(ctrl.activeEditingFeature!.vertices.first).dx,
        closeTo(130, 0.1),
      );

      // Undo restores pre-translate position
      ctrl.undoDraftEdit();
      expect(
        project(ctrl.activeEditingFeature!.vertices.first).dx,
        closeTo(100, 0.1),
      );
    });

    test('commits freehand stroke, primitive shape, arrow, annotation, box select, and split', () async {
      final ctrl = DraftWorkbenchController();
      addTearDown(ctrl.dispose);

      // 1. Freehand open stroke
      final sketch = ctrl.commitFreehandStroke(<Geographic>[
        const Geographic(lon: 16.360, lat: 48.210),
        const Geographic(lon: 16.362, lat: 48.21001),
        const Geographic(lon: 16.364, lat: 48.210),
        const Geographic(lon: 16.364, lat: 48.214),
      ]);
      expect(sketch, isNotNull);
      expect(sketch!.kind, DrawToolMode.line);
      expect(sketch.vertices.length, 3);

      // 2. Primitive shape ring
      ctrl.setActivePrimitiveShape(PrimitiveShapeKind.hexagon);
      final hexRing = DrawingMath.computeShapeRingFromScreenDrag(
        shape: PrimitiveShapeKind.hexagon,
        anchorScreen: const Offset(200, 200),
        currentScreen: const Offset(260, 200),
        unproject: unproject,
      );
      final hex = ctrl.commitPrimitiveRing(
        PrimitiveShapeKind.hexagon,
        hexRing,
        radiusMeters: 120,
      );
      expect(hex, isNotNull);
      expect(hex!.kind, DrawToolMode.polygon);
      expect(hex.name, 'Hexagon (120m)');

      // 3. Arrow draft
      ctrl.selectMode(DrawToolMode.arrow);
      ctrl.commitVertex(unproject(const Offset(50, 50)));
      ctrl.commitVertex(unproject(const Offset(120, 80)));
      expect(ctrl.canFinishDraft, isTrue);
      ctrl.finishDraft();
      final arrowFeat = ctrl.features.last;
      expect(arrowFeat.kind, DrawToolMode.line);
      expect(arrowFeat.arrowEnd, isTrue);

      // 4. Annotation label
      final note = ctrl.commitAnnotationAt(
        unproject(const Offset(80, 300)),
        'Check gate',
      );
      expect(note.kind, DrawToolMode.point);
      expect(note.name, 'Check gate');
      expect(note.customProperties['annotation'], 'true');

      // 5. Box select (only covers arrowFeat, not sketch at (100, 100))
      final count = ctrl.commitBoxSelect(
        const Rect.fromLTRB(40, 40, 95, 95),
        project,
      );
      expect(count, 1);
      expect(ctrl.selectedDraftFeatureIds, contains(arrowFeat.id));

      // 6. Split line by line
      ctrl.selectMode(DrawToolMode.splitByLine);
      ctrl.commitVertex(unproject(const Offset(85, 30)));
      ctrl.commitVertex(unproject(const Offset(85, 110)));
      expect(ctrl.canFinishDraft, isTrue);
      final lineSplit = await ctrl.finishSplitByLine();
      expect(lineSplit.ok, isTrue);
      expect(ctrl.features.where((f) => f.id.startsWith('split-')).length, 2);

      // 7. Split polygon by line (pure-Dart fallback when FFI uninitialized)
      ctrl.selectEditingTargetFeature(hex.id, enterMode: false);
      if (ctrl.mode != DrawToolMode.splitByLine) {
        ctrl.selectMode(DrawToolMode.splitByLine);
      }
      ctrl.commitVertex(unproject(const Offset(200, 120)));
      ctrl.commitVertex(unproject(const Offset(200, 280)));
      final polySplit = await ctrl.finishSplitByLine();
      expect(polySplit.ok, isTrue, reason: polySplit.message);
      expect(ctrl.features.any((f) => f.id == hex.id), isFalse);
    });

    test('snapping toggles and listenables fire cleanly', () {
      final ctrl = DraftWorkbenchController();
      addTearDown(ctrl.dispose);

      var placementCalls = 0;
      ctrl.placementListenable.addListener(() => placementCalls += 1);
      expect(ctrl.snappingEnabled, isTrue);
      expect(ctrl.snapToEdgesEnabled, isTrue);

      ctrl.toggleSnapping();
      ctrl.toggleSnapToEdges();
      expect(ctrl.snappingEnabled, isFalse);
      expect(ctrl.snapToEdgesEnabled, isFalse);
      expect(placementCalls, 2);
    });
  });

  group('TouchDrawOverlay & DrawingLoupe widget tests', () {
    testWidgets('DrawingLoupe formats tool telemetry cleanly without duplicating SNAP', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Stack(
              children: [
                DrawingLoupe(
                  viewportSize: Size(400, 800),
                  fingerPosition: Offset(200, 400),
                  targetPosition: Offset(200, 352),
                  telemetry: 'CIRCLE · r 120 m',
                  snapped: true,
                ),
              ],
            ),
          ),
        ),
      );

      expect(find.text('CIRCLE · r 120 m · SNAP'), findsOneWidget);
    });

    testWidgets('TouchDrawOverlay handles boxSelect, freehand, shape, annotation, select, and editVertices gestures', (tester) async {
      final mapController = _FakeMapController();
      final ctrl = DraftWorkbenchController();
      addTearDown(ctrl.dispose);

      // Seed one line feature for select / editVertices tests.
      final seedLine = DrawnFeature(
        id: 'line-seed',
        kind: DrawToolMode.line,
        vertices: <Geographic>[
          unproject(const Offset(100, 200)),
          unproject(const Offset(220, 200)),
        ],
      );
      ctrl.features.add(seedLine);

      Geographic? requestedAnnotation;

      Widget buildHarness() => MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 400,
                height: 400,
                child: ListenableBuilder(
                  listenable: Listenable.merge([
                    ctrl.modeListenable,
                    ctrl.geometryListenable,
                    ctrl.placementListenable,
                  ]),
                  builder: (context, _) => TouchDrawOverlay(
                    controller: mapController,
                    mode: ctrl.mode,
                    placementStyle: ctrl.placementStyle,
                    loupeEnabled: ctrl.loupeEnabled,
                    features: ctrl.features,
                    draftVertices: ctrl.draftVertices,
                    activePrimitiveShape: ctrl.activePrimitiveShape,
                    snappingEnabled: ctrl.snappingEnabled,
                    snapToEdgesEnabled: ctrl.snapToEdgesEnabled,
                    editingFeature: ctrl.activeEditingFeature,
                    selectedVertexIndex: ctrl.selectedVertexIndex,
                    selectedFeatureIds: ctrl.selectedDraftFeatureIds,
                    onCommitVertex: ctrl.commitVertex,
                    onUpdateDraftVertex: ctrl.updateDraftVertex,
                    onInsertDraftVertex: ctrl.insertDraftVertex,
                    onTwoFingerUndo: ctrl.undoLastPoint,
                    onPreviewChanged: ctrl.updatePreview,
                    onTapFeatureInSelectMode: ctrl.toggleSelectFeature,
                    onBoxSelect: (rect) => ctrl.commitBoxSelect(rect, project),
                    onCommitFreehand: ctrl.commitFreehandStroke,
                    onCommitShape: (shape, ring, r) =>
                        ctrl.commitPrimitiveRing(shape, ring, radiusMeters: r),
                    onRequestAnnotationAt: (pt) => requestedAnnotation = pt,
                    onSelectEditingFeature: ctrl.selectEditingTargetFeature,
                    onSelectEditingVertex: ctrl.selectVertexIndex,
                    onUpdateEditingVertex: ctrl.updateEditingFeatureVertex,
                    onInsertEditingVertex: ctrl.insertEditingFeatureVertex,
                    onTranslateFeature: (id, delta, {bool pushUndoBefore = false}) =>
                        ctrl.translateFeatureOnCanvas(
                      id,
                      delta,
                      project,
                      unproject,
                      pushUndoBefore: pushUndoBefore,
                    ),
                    onRotateScaleFeature: (
                      id,
                      rotateDeg,
                      scale, {
                      baseFeature,
                      pivotScreen,
                      bool pushUndoBefore = false,
                      bool persist = true,
                    }) =>
                        ctrl.transformFeatureInScreenSpace(
                      id,
                      rotateDeg: rotateDeg,
                      scale: scale,
                      project: project,
                      unproject: unproject,
                      baseFeature: baseFeature,
                      pivotScreen: pivotScreen,
                      pushUndoBefore: pushUndoBefore,
                    ),
                  ),
                ),
              ),
            ),
          );

      await tester.pumpWidget(buildHarness());

      // 1. Box select drag selects seedLine
      ctrl.selectMode(DrawToolMode.boxSelect);
      await tester.pump();
      final boxGesture = await tester.startGesture(const Offset(80, 180));
      await boxGesture.moveTo(const Offset(240, 220));
      await tester.pump();
      expect(find.text('1 selected'), findsOneWidget);
      await boxGesture.up();
      await tester.pump();
      expect(ctrl.selectedDraftFeatureIds, contains('line-seed'));

      // 2. Select mode: tap toggles off, tap again toggles on, drag centroid Move handle translates
      ctrl.selectMode(DrawToolMode.select);
      await tester.pump();
      await tester.tapAt(const Offset(160, 200)); // centroid of seedLine
      await tester.pump();
      expect(ctrl.selectedDraftFeatureIds, isEmpty);
      await tester.tapAt(const Offset(160, 200));
      await tester.pump();
      expect(ctrl.selectedDraftFeatureIds, contains('line-seed'));

      final moveGesture = await tester.startGesture(const Offset(160, 200));
      await moveGesture.moveTo(const Offset(180, 220));
      await tester.pump();
      await moveGesture.up();
      await tester.pump();
      expect(project(ctrl.features.first.vertices.first).dx, closeTo(120, 0.5));
      expect(project(ctrl.features.first.vertices.first).dy, closeTo(220, 0.5));

      // 3. Edit vertices: drag first vertex (120, 220) to (120, 260)
      ctrl.selectEditingTargetFeature('line-seed');
      await tester.pump();
      final vDrag = await tester.startGesture(const Offset(120, 220));
      await vDrag.moveTo(const Offset(120, 260));
      await tester.pump();
      await vDrag.up();
      await tester.pump();
      expect(project(ctrl.features.first.vertices.first).dy, closeTo(260, 0.5));

      // 4. Freehand drag commits simplified line
      ctrl.selectMode(DrawToolMode.freehand);
      await tester.pump();
      final fh = await tester.startGesture(const Offset(40, 40));
      await fh.moveTo(const Offset(90, 40));
      await fh.moveTo(const Offset(140, 90));
      await tester.pump();
      await fh.up();
      await tester.pump();
      expect(ctrl.features.length, 2);
      expect(ctrl.features.last.id, startsWith('sketch-'));

      // 5. Shape drag commits polygon
      ctrl.selectMode(DrawToolMode.shape);
      ctrl.setActivePrimitiveShape(PrimitiveShapeKind.triangle);
      await tester.pump();
      final sh = await tester.startGesture(const Offset(300, 300));
      await sh.moveTo(const Offset(340, 300));
      await tester.pump();
      await sh.up();
      await tester.pump();
      expect(ctrl.features.length, 3);
      expect(ctrl.features.last.kind, DrawToolMode.polygon);
      expect(ctrl.features.last.vertices.length, 3);

      // 6. Annotation tap fires onRequestAnnotationAt
      ctrl.selectMode(DrawToolMode.annotation);
      await tester.pump();
      await tester.tapAt(const Offset(200, 320));
      await tester.pump();
      expect(requestedAnnotation, isNotNull);

      // 7. Disabling snapping prevents magnetic snap in TouchDrawOverlay
      ctrl.selectMode(DrawToolMode.point);
      ctrl.setSnappingEnabled(false);
      await tester.pump();
      final nearExisting = project(ctrl.features.first.vertices.first) +
          const Offset(4, 48 + 4); // offset by -48dp thumb clearance
      final ptTap = await tester.startGesture(nearExisting);
      await ptTap.up();
      await tester.pump();
      expect(
        ctrl.features.last.vertices.first.lon,
        isNot(equals(ctrl.features.first.vertices.first.lon)),
      );
    });

    testWidgets('TouchDrawOverlay Rotate and Scale handle drags transform geometry with loupe telemetry and single-step undo', (tester) async {
      final mapController = _FakeMapController();
      final ctrl = DraftWorkbenchController();
      addTearDown(ctrl.dispose);

      // 100x100 square centered at (200, 200): screen bounds [150..250, 150..250].
      final seedPoly = DrawnFeature(
        id: 'poly-transform',
        kind: DrawToolMode.polygon,
        vertices: <Geographic>[
          unproject(const Offset(150, 150)),
          unproject(const Offset(250, 150)),
          unproject(const Offset(250, 250)),
          unproject(const Offset(150, 250)),
        ],
      );
      ctrl.features.add(seedPoly);
      var persistCount = 0;

      Widget buildHarness() => MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 400,
                height: 400,
                child: ListenableBuilder(
                  listenable: Listenable.merge([
                    ctrl.modeListenable,
                    ctrl.geometryListenable,
                    ctrl.placementListenable,
                  ]),
                  builder: (context, _) => Stack(
                    fit: StackFit.expand,
                    children: [
                      MapGeometryLayer(
                        controller: mapController,
                        features: ctrl.features,
                        draftVertices: ctrl.draftVertices,
                        mode: ctrl.mode,
                        editingFeature: ctrl.activeEditingFeature,
                        selectedVertexIndex: ctrl.selectedVertexIndex,
                        selectedFeatureIds: ctrl.selectedDraftFeatureIds,
                      ),
                      TouchDrawOverlay(
                        controller: mapController,
                        mode: ctrl.mode,
                        placementStyle: ctrl.placementStyle,
                        loupeEnabled: ctrl.loupeEnabled,
                        features: ctrl.features,
                        draftVertices: ctrl.draftVertices,
                        activePrimitiveShape: ctrl.activePrimitiveShape,
                        snappingEnabled: ctrl.snappingEnabled,
                        snapToEdgesEnabled: ctrl.snapToEdgesEnabled,
                        editingFeature: ctrl.activeEditingFeature,
                        selectedVertexIndex: ctrl.selectedVertexIndex,
                        selectedFeatureIds: ctrl.selectedDraftFeatureIds,
                        onCommitVertex: ctrl.commitVertex,
                        onUpdateDraftVertex: ctrl.updateDraftVertex,
                        onInsertDraftVertex: ctrl.insertDraftVertex,
                        onTwoFingerUndo: ctrl.undoLastPoint,
                        onPreviewChanged: ctrl.updatePreview,
                        onTapFeatureInSelectMode: ctrl.toggleSelectFeature,
                        onBoxSelect: (rect) => ctrl.commitBoxSelect(rect, project),
                        onSelectEditingFeature: ctrl.selectEditingTargetFeature,
                        onSelectEditingVertex: ctrl.selectVertexIndex,
                        onUpdateEditingVertex: ctrl.updateEditingFeatureVertex,
                        onInsertEditingVertex: ctrl.insertEditingFeatureVertex,
                        onTranslateFeature: (id, delta, {bool pushUndoBefore = false}) =>
                            ctrl.translateFeatureOnCanvas(
                          id,
                          delta,
                          project,
                          unproject,
                          pushUndoBefore: pushUndoBefore,
                          onPersist: () => persistCount += 1,
                        ),
                        onRotateScaleFeature: (
                          id,
                          rotateDeg,
                          scale, {
                          baseFeature,
                          pivotScreen,
                          bool pushUndoBefore = false,
                          bool persist = true,
                        }) =>
                            ctrl.transformFeatureInScreenSpace(
                          id,
                          rotateDeg: rotateDeg,
                          scale: scale,
                          project: project,
                          unproject: unproject,
                          baseFeature: baseFeature,
                          pivotScreen: pivotScreen,
                          pushUndoBefore: pushUndoBefore,
                          onPersist: persist ? () => persistCount += 1 : null,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );

      await tester.pumpWidget(buildHarness());
      ctrl.selectMode(DrawToolMode.select);
      ctrl.toggleSelectFeature('poly-transform');
      await tester.pump();

      final rawBounds = DrawingMath.computeFeatureScreenBounds(
        feature: ctrl.features.first,
        project: project,
      )!;
      final bbox = TouchDrawOverlay.computeTransformBounds(rawBounds);
      final rotateHandlePos =
          bbox.topCenter - const Offset(0, TouchDrawOverlay.rotateHandleStemPx);
      // Centroid is (200, 200); rotateHandlePos is directly above at (200, 100).
      // Dragging to (300, 200) in two moves produces +90 deg clockwise rotation.
      final undoBeforeRotate = ctrl.undoStack.length;
      final rotGesture = await tester.startGesture(rotateHandlePos);
      await rotGesture.moveTo(const Offset(270.71, 129.29)); // +45 deg
      await tester.pump();
      expect(find.text('ROTATE · +45°'), findsOneWidget);

      await rotGesture.moveTo(const Offset(300, 200)); // +90 deg
      await tester.pump();
      expect(find.text('ROTATE · +90°'), findsOneWidget);
      await rotGesture.up();
      await tester.pump();

      // Single undo step pushed for the entire multi-move rotate drag + persisted on lift.
      expect(ctrl.undoStack.length, undoBeforeRotate + 1);
      expect(persistCount, 1);
      // Top-left (150, 150) rotated +90 deg around (200, 200) -> (250, 150).
      expect(project(ctrl.features.first.vertices[0]).dx, closeTo(250, 0.5));
      expect(project(ctrl.features.first.vertices[0]).dy, closeTo(150, 0.5));

      // Single undo rolls back the entire rotation cleanly.
      ctrl.undoDraftEdit();
      await tester.pump();
      expect(project(ctrl.features.first.vertices[0]).dx, closeTo(150, 0.5));
      expect(project(ctrl.features.first.vertices[0]).dy, closeTo(150, 0.5));

      // Switch to editVertices mode and test Scale handle drag at bbox.bottomRight.
      ctrl.selectEditingTargetFeature('poly-transform');
      await tester.pump();
      final editBounds = TouchDrawOverlay.computeTransformBounds(
        DrawingMath.computeFeatureScreenBounds(
          feature: ctrl.features.first,
          project: project,
        )!,
      );
      final scaleHandlePos = editBounds.bottomRight; // (268, 268), dist from (200,200) = 68*sqrt(2)
      final startDelta = scaleHandlePos - const Offset(200, 200);

      final undoBeforeScale = ctrl.undoStack.length;
      final scaleGesture = await tester.startGesture(scaleHandlePos);
      await scaleGesture.moveTo(const Offset(200, 200) + startDelta * 1.35);
      await tester.pump();
      expect(find.text('SCALE · ×1.35'), findsOneWidget);

      await scaleGesture.moveTo(const Offset(200, 200) + startDelta * 1.5);
      await tester.pump();
      expect(find.text('SCALE · ×1.50'), findsOneWidget);
      await scaleGesture.up();
      await tester.pump();

      expect(ctrl.undoStack.length, undoBeforeScale + 1);
      expect(persistCount, 2);
      // Vertex (150, 150) scaled 1.5x around (200, 200) -> (125, 125).
      expect(project(ctrl.features.first.vertices[0]).dx, closeTo(125, 0.5));
      expect(project(ctrl.features.first.vertices[0]).dy, closeTo(125, 0.5));

      // Single undo restores pre-scale vertices.
      ctrl.undoDraftEdit();
      await tester.pump();
      expect(project(ctrl.features.first.vertices[0]).dx, closeTo(150, 0.5));
      expect(project(ctrl.features.first.vertices[0]).dy, closeTo(150, 0.5));
    });
  });

  group('DrawToolModeMeta contextual grouping', () {
    test('maps every DrawToolMode to its expected toolbar group and flags', () {
      expect(DrawToolMode.browse.toolGroup, isNull);
      expect(DrawToolMode.browse.supportsCrosshairDrop, isFalse);
      expect(DrawToolMode.browse.isMultiPointStrokeTool, isFalse);

      for (final mode in const [
        DrawToolMode.select,
        DrawToolMode.editVertices,
        DrawToolMode.boxSelect,
      ]) {
        expect(mode.toolGroup, DrawToolGroup.select);
        expect(mode.supportsCrosshairDrop, isFalse);
        expect(mode.isMultiPointStrokeTool, isFalse);
      }

      for (final mode in const [
        DrawToolMode.point,
        DrawToolMode.line,
        DrawToolMode.polygon,
        DrawToolMode.freehand,
        DrawToolMode.arrow,
        DrawToolMode.annotation,
      ]) {
        expect(mode.toolGroup, DrawToolGroup.draw);
      }

      expect(DrawToolMode.freehand.supportsCrosshairDrop, isFalse);
      expect(DrawToolMode.point.supportsCrosshairDrop, isTrue);
      expect(DrawToolMode.line.supportsCrosshairDrop, isTrue);
      expect(DrawToolMode.polygon.supportsCrosshairDrop, isTrue);
      expect(DrawToolMode.arrow.supportsCrosshairDrop, isTrue);
      expect(DrawToolMode.annotation.supportsCrosshairDrop, isTrue);

      for (final mode in const [
        DrawToolMode.shape,
        DrawToolMode.splitByLine,
        DrawToolMode.measure,
      ]) {
        expect(mode.toolGroup, DrawToolGroup.shapesSpatial);
      }
      expect(DrawToolMode.shape.supportsCrosshairDrop, isFalse);
      expect(DrawToolMode.splitByLine.supportsCrosshairDrop, isTrue);
      expect(DrawToolMode.measure.supportsCrosshairDrop, isTrue);

      for (final mode in const [
        DrawToolMode.line,
        DrawToolMode.polygon,
        DrawToolMode.arrow,
        DrawToolMode.splitByLine,
        DrawToolMode.measure,
      ]) {
        expect(mode.isMultiPointStrokeTool, isTrue);
      }
      expect(DrawToolMode.point.isMultiPointStrokeTool, isFalse);
      expect(DrawToolMode.annotation.isMultiPointStrokeTool, isFalse);
      expect(DrawToolMode.shape.isMultiPointStrokeTool, isFalse);
    });
  });
}
