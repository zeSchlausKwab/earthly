import 'package:earthly_native/controllers/draft_workbench_controller.dart';
import 'package:earthly_native/drawing/drawing_model.dart';
import 'package:earthly_native/main.dart';
import 'package:earthly_native/nostr/callout_overlay.dart';
import 'package:earthly_native/nostr/shelf_renderer.dart';
import 'package:earthly_native/shell/desk_sheet.dart';
import 'package:earthly_native/shell/feature_inspector_sheet.dart';
import 'package:earthly_native/shell/mobile_drawing_bar.dart';
import 'package:earthly_native/shell/mobile_drawing_tools_sheet.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

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
  CameraPosition? get camera => const CameraPosition(
        center: Geographic(lon: 16.37, lat: 48.21),
        zoom: 14,
        bearing: 0,
        pitch: 0,
      );

  @override
  Offset toScreenLocation(Geographic lngLat) => projectFn(lngLat);

  @override
  Geographic toLngLat(Offset screenLocation) => unprojectFn(screenLocation);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _MapHarness extends StatefulWidget {
  const _MapHarness({required this.onMapCreated});

  final ValueChanged<MapController> onMapCreated;

  @override
  State<_MapHarness> createState() => _MapHarnessState();
}

class _MapHarnessState extends State<_MapHarness> {
  final _controller = _FakeMapController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onMapCreated(_controller);
    });
  }

  @override
  Widget build(BuildContext context) => const ColoredBox(color: Color(0xFFEDF0EA));
}

Widget _buildHome({
  required DraftWorkbenchController draftController,
}) {
  return MaterialApp(
    home: EarthlySpikeHome(
      draftController: draftController,
      mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
          _MapHarness(onMapCreated: onMapCreated),
    ),
  );
}

void main() {
  testWidgets(
      'Expanded Mobile Authoring Dock exposes all 12 tools, Snap toggle, and Cut completion',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(390, 844));
    final draft = DraftWorkbenchController();
    addTearDown(draft.dispose);

    // Seed a line to test Cut (splitByLine) completion from the dock.
    draft.features.add(
      const DrawnFeature(
        id: 'line-target',
        kind: DrawToolMode.line,
        name: 'Main Trail',
        vertices: [
          Geographic(lon: 16.36, lat: 48.21),
          Geographic(lon: 16.38, lat: 48.21),
        ],
      ),
    );

    await tester.pumpWidget(_buildHome(draftController: draft));
    await tester.pump();

    // Enter drawing mode
    await tester.tap(find.text('Draw'));
    await tester.pump();

    expect(draft.mode, DrawToolMode.line);
    expect(find.byKey(const Key('mobile-drawing-more-tools')), findsOneWidget);
    expect(find.byTooltip('Draw-Drag'), findsOneWidget);
    expect(find.byTooltip('Loupe'), findsOneWidget);
    expect(find.byTooltip('Snap'), findsOneWidget);
    expect(find.text('Done'), findsOneWidget);

    // Verify Snap toggle in right thumb rail
    expect(draft.snappingEnabled, isTrue);
    await tester.tap(find.byTooltip('Snap'));
    await tester.pump();
    expect(draft.snappingEnabled, isFalse);

    // Verify all 12 tool labels exist inside the scrollable dock
    const expectedToolModes = [
      (DrawToolMode.select, 'Select'),
      (DrawToolMode.editVertices, 'Edit'),
      (DrawToolMode.boxSelect, 'Box'),
      (DrawToolMode.point, 'Point'),
      (DrawToolMode.line, 'Line'),
      (DrawToolMode.freehand, 'Sketch'),
      (DrawToolMode.polygon, 'Area'),
      (DrawToolMode.arrow, 'Arrow'),
      (DrawToolMode.shape, 'Shape'),
      (DrawToolMode.annotation, 'Label'),
      (DrawToolMode.splitByLine, 'Cut'),
      (DrawToolMode.measure, 'Measure'),
    ];
    for (final entry in expectedToolModes) {
      final toolFinder = find.byKey(Key('mobile-draw-tool-${entry.$1.name}'));
      await tester.ensureVisible(toolFinder);
      expect(
        find.descendant(of: toolFinder, matching: find.text(entry.$2)),
        findsOneWidget,
      );
    }

    // Switch to Cut tool & draw 2 cutter points crossing line-target
    await tester.tap(find.byKey(const Key('mobile-draw-tool-splitByLine')));
    await tester.pump();
    expect(draft.mode, DrawToolMode.splitByLine);

    draft.commitVertex(const Geographic(lon: 16.37, lat: 48.205));
    draft.commitVertex(const Geographic(lon: 16.37, lat: 48.215));
    await tester.pump();

    // Mid-stroke pinned cluster shows Cut · 2, Undo pt, Cancel
    expect(find.text('Cut · 2'), findsOneWidget);
    expect(find.text('Undo pt'), findsOneWidget);
    expect(find.text('Cancel'), findsOneWidget);

    await tester.tap(find.text('Cut · 2'));
    await tester.pumpAndSettle();

    expect(draft.features.length, 2);
    expect(find.text('Split into 2 parts'), findsOneWidget);
  });

  testWidgets(
      'Shape Selector Chips appear in DrawToolMode.shape and switch active primitive shape',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(412, 915));
    final draft = DraftWorkbenchController();
    addTearDown(draft.dispose);

    await tester.pumpWidget(_buildHome(draftController: draft));
    await tester.pump();

    draft.selectMode(DrawToolMode.shape);
    await tester.pump();

    expect(find.byKey(const Key('mobile-drawing-shape-bar')), findsOneWidget);
    for (final shape in PrimitiveShapeKind.values) {
      expect(
        find.byKey(Key('mobile-shape-chip-${shape.name}')),
        findsOneWidget,
      );
    }
    expect(find.text('Drop at Center'), findsOneWidget);

    final hexChip = find.byKey(const Key('mobile-shape-chip-hexagon'));
    await tester.ensureVisible(hexChip);
    await tester.pumpAndSettle();
    await tester.tap(hexChip);
    await tester.pump();
    expect(draft.activePrimitiveShape, PrimitiveShapeKind.hexagon);
  });

  testWidgets(
      'Contextual Selection Action Bar and Delete Vertex pill work cleanly in authoring mode',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(412, 915));
    final draft = DraftWorkbenchController();
    addTearDown(draft.dispose);

    draft.features.add(
      const DrawnFeature(
        id: 'poly-1',
        kind: DrawToolMode.polygon,
        name: 'Meadow',
        vertices: [
          Geographic(lon: 16.36, lat: 48.20),
          Geographic(lon: 16.38, lat: 48.20),
          Geographic(lon: 16.38, lat: 48.22),
          Geographic(lon: 16.36, lat: 48.22),
        ],
      ),
    );
    draft.selectMode(DrawToolMode.select);
    draft.toggleSelectFeature('poly-1');

    await tester.pumpWidget(_buildHome(draftController: draft));
    await tester.pump();

    final selBar = find.byKey(const Key('mobile-drawing-selection-bar'));
    expect(selBar, findsOneWidget);
    expect(find.text('1 selected'), findsOneWidget);
    expect(find.text('Vertices'), findsOneWidget);
    expect(find.text('Style'), findsOneWidget);
    expect(find.text('Rotate +15°'), findsOneWidget);
    expect(find.text('Duplicate'), findsOneWidget);
    expect(find.text('Ops'), findsOneWidget);
    expect(find.text('Delete'), findsOneWidget);

    // Tapping Style opens FeatureInspectorSheet in authoring mode
    await tester.tap(find.text('Style'));
    await tester.pumpAndSettle();
    expect(find.byType(FeatureInspectorSheet), findsOneWidget);
    expect(find.text('Meadow'), findsOneWidget);

    // Close inspector
    await tester.tap(
      find.descendant(
        of: find.byType(FeatureInspectorSheet),
        matching: find.byIcon(Icons.close),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(FeatureInspectorSheet), findsNothing);

    // Tapping Duplicate duplicates the selected polygon
    final dupBtn = find.text('Duplicate');
    await tester.ensureVisible(dupBtn);
    await tester.tap(dupBtn);
    await tester.pumpAndSettle();
    expect(draft.features.length, 2);
    expect(draft.selectedDraftFeatureIds.length, 1);

    // Tapping Vertices enters editVertices on the selected feature
    final verticesBtn = find.text('Vertices');
    await tester.ensureVisible(verticesBtn);
    await tester.tap(verticesBtn);
    await tester.pump();
    expect(draft.mode, DrawToolMode.editVertices);
    expect(draft.activeEditingFeature, isNotNull);

    // Selecting a vertex displays the Delete Vertex pill
    draft.selectVertexIndex(1);
    await tester.pump();
    expect(find.text('Pt 2'), findsOneWidget);
    expect(find.text('Delete Vertex'), findsOneWidget);

    await tester.tap(find.text('Delete Vertex'));
    await tester.pump();
    expect(draft.activeEditingFeature!.vertices.length, 3);

    // Clear selection hides Selection Action Bar
    final clearSelBtn = find.byTooltip('Clear selection');
    await tester.ensureVisible(clearSelBtn);
    await tester.tap(clearSelBtn);
    await tester.pump();
    expect(selBar, findsNothing);

    // Re-select and Delete removes feature
    draft.toggleSelectFeature(draft.features.last.id);
    await tester.pump();
    expect(selBar, findsOneWidget);
    final deleteBtn = find.text('Delete');
    await tester.ensureVisible(deleteBtn);
    await tester.tap(deleteBtn);
    await tester.pump();
    expect(draft.features.length, 1);
    expect(draft.selectedDraftFeatureIds, isEmpty);
  });

  testWidgets(
      'Label mode opens Drop Map Label dialog on canvas tap and commits annotation feature',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(412, 915));
    final draft = DraftWorkbenchController();
    addTearDown(draft.dispose);

    await tester.pumpWidget(_buildHome(draftController: draft));
    await tester.pump();

    draft.selectMode(DrawToolMode.annotation);
    await tester.pump();

    await tester.tapAt(const Offset(200, 300));
    await tester.pumpAndSettle();

    expect(find.text('Drop Map Label'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('drop-map-label-field')),
      'Water Spring',
    );
    await tester.tap(find.byKey(const Key('drop-map-label-confirm')));
    await tester.pumpAndSettle();

    expect(draft.features.length, 1);
    expect(draft.features.first.name, 'Water Spring');
    expect(draft.features.first.customProperties['annotation'], 'true');
  });

  testWidgets(
      'More button opens focused Canvas Options sheet (no catch-all tools/workbench dump)',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(412, 915));
    final draft = DraftWorkbenchController();
    addTearDown(draft.dispose);

    await tester.pumpWidget(_buildHome(draftController: draft));
    await tester.pump();

    await tester.tap(find.text('Draw'));
    await tester.pump();

    await tester.tap(find.byKey(const Key('mobile-drawing-more-tools')));
    await tester.pumpAndSettle();

    expect(find.byType(MobileDrawingOptionsSheet), findsOneWidget);
    expect(find.text('CANVAS OPTIONS'), findsOneWidget);
    expect(find.text('AUTHORING TOOLS & WORKBENCH'), findsNothing);
    expect(find.text('GEOMETRY WORKBENCH'), findsNothing);
    expect(find.text('DATA & PUBLISH'), findsNothing);
    expect(
      find.byKey(const Key('mobile-options-snapping-toggle')),
      findsOneWidget,
    );

    // Toggle Magnetic Snap from focused options sheet
    await tester.tap(find.byKey(const Key('mobile-options-snapping-toggle')));
    await tester.pump();
    expect(draft.snappingEnabled, isFalse);

    // Close sheet cleanly
    await tester.tap(find.byKey(const Key('mobile-options-close')));
    await tester.pumpAndSettle();
    expect(find.byType(MobileDrawingOptionsSheet), findsNothing);
  });

  testWidgets(
      'Tapping draft feature on canvas in select and editVertices modes selects and targets feature',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(412, 915));
    final draft = DraftWorkbenchController();
    addTearDown(draft.dispose);

    draft.features.add(
      DrawnFeature(
        id: 'line-canvas',
        kind: DrawToolMode.line,
        name: 'Canvas Trail',
        vertices: [
          _FakeMapController.unprojectFn(const Offset(120, 260)),
          _FakeMapController.unprojectFn(const Offset(260, 260)),
        ],
      ),
    );

    await tester.pumpWidget(_buildHome(draftController: draft));
    await tester.pump();

    // 1. In select mode, tapping feature selects it and opens Selection Action Bar
    draft.selectMode(DrawToolMode.select);
    await tester.pump();
    await tester.tapAt(const Offset(190, 260));
    await tester.pump();
    expect(draft.selectedDraftFeatureIds, contains('line-canvas'));
    expect(find.byKey(const Key('mobile-drawing-selection-bar')), findsOneWidget);

    // 2. Switch to editVertices -> targets feature on canvas and supports vertex tap
    draft.selectMode(DrawToolMode.editVertices);
    await tester.pump();
    expect(draft.activeEditingFeature?.id, 'line-canvas');
  });

  testWidgets(
      'MobileDrawingOptionsSheet exposes ONLY canvas settings and Undo/Redo without overflow at 360dp',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(360, 780));

    var toggledSnap = false;
    var toggledEdgeSnap = false;
    var toggledPlacement = false;
    var toggledLoupe = false;
    var cycledCallouts = false;
    var undid = false;
    var redid = false;

    await tester.pumpWidget(
      wrapInScaffold(
        MobileDrawingOptionsSheet(
          placementStyle: TouchPlacementStyle.drawDrag,
          loupeEnabled: true,
          snappingEnabled: true,
          snapToEdgesEnabled: true,
          calloutMode: CalloutDisplayMode.full,
          canUndo: true,
          canRedo: true,
          onToggleSnapping: () => toggledSnap = true,
          onToggleSnapToEdges: () => toggledEdgeSnap = true,
          onTogglePlacementStyle: () => toggledPlacement = true,
          onToggleLoupe: () => toggledLoupe = true,
          onCycleCalloutMode: () => cycledCallouts = true,
          onUndo: () => undid = true,
          onRedo: () => redid = true,
          onClose: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('CANVAS OPTIONS'), findsOneWidget);
    expect(find.text('Magnetic Snap'), findsOneWidget);
    expect(find.text('Snap to Edges'), findsOneWidget);
    expect(find.text('Touch Placement'), findsOneWidget);
    expect(find.text('Magnifier Loupe'), findsOneWidget);
    expect(find.text('Callouts'), findsOneWidget);
    expect(find.text('Undo'), findsOneWidget);
    expect(find.text('Redo'), findsOneWidget);
    // Zero mixed tools/shapes/workbench sections
    expect(find.text('DRAW & EDIT TOOLS'), findsNothing);
    expect(find.text('GEOMETRY WORKBENCH'), findsNothing);
    expect(find.text('DATA & PUBLISH'), findsNothing);

    await tester.tap(find.byKey(const Key('mobile-options-undo')));
    await tester.tap(find.byKey(const Key('mobile-options-redo')));
    await tester.tap(find.byKey(const Key('mobile-options-snapping-toggle')));
    await tester.tap(find.byKey(const Key('mobile-options-edge-snap-toggle')));
    await tester.tap(find.byKey(const Key('mobile-options-placement-toggle')));
    await tester.tap(find.byKey(const Key('mobile-options-loupe-toggle')));
    await tester.tap(find.byKey(const Key('mobile-options-callouts-cycle')));
    await tester.pump();

    expect(undid, isTrue);
    expect(redid, isTrue);
    expect(toggledSnap, isTrue);
    expect(toggledEdgeSnap, isTrue);
    expect(toggledPlacement, isTrue);
    expect(toggledLoupe, isTrue);
    expect(cycledCallouts, isTrue);
  });

  testWidgets(
      'MobileDrawingBar grouped menus (Select, Draw, Shapes & Spatial), Desk badge, Options sheet, and Done work cleanly at 360dp and 412dp',
      (WidgetTester tester) async {
    for (final viewport in const [Size(360, 780), Size(412, 915)]) {
      setTestViewport(tester, viewport);

      var mode = DrawToolMode.line;
      var shape = PrimitiveShapeKind.circle;
      var placement = TouchPlacementStyle.drawDrag;
      var snapping = true;
      var edgeSnap = true;
      var loupe = true;
      var callouts = CalloutDisplayMode.full;
      var deskOpen = false;
      var exited = false;
      var undid = false;
      (PrimitiveShapeKind, double)? droppedCenter;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) => Stack(
                fit: StackFit.expand,
                children: [
                  const ColoredBox(color: Color(0xFFEDF0EA)),
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: MobileDrawingBar(
                      activeMode: mode,
                      activePrimitiveShape: shape,
                      placementStyle: placement,
                      loupeEnabled: loupe,
                      snappingEnabled: snapping,
                      snapToEdgesEnabled: edgeSnap,
                      calloutMode: callouts,
                      draftFeatureCount: 4,
                      isDeskOpen: deskOpen,
                      canUndo: true,
                      canRedo: false,
                      onSelectTool: (next) => setState(() => mode = next),
                      onSelectPrimitiveShape: (next) => setState(() {
                        shape = next;
                        mode = DrawToolMode.shape;
                      }),
                      onDropPrimitiveAtCenter: (s, r) async {
                        droppedCenter = (s, r);
                      },
                      onToggleDesk: () => setState(() => deskOpen = !deskOpen),
                      onToggleSnapping: () =>
                          setState(() => snapping = !snapping),
                      onToggleSnapToEdges: () =>
                          setState(() => edgeSnap = !edgeSnap),
                      onTogglePlacementStyle: () => setState(
                        () => placement =
                            placement == TouchPlacementStyle.drawDrag
                                ? TouchPlacementStyle.crosshair
                                : TouchPlacementStyle.drawDrag,
                      ),
                      onToggleLoupe: () => setState(() => loupe = !loupe),
                      onCycleCalloutMode: () => setState(
                        () => callouts = nextCalloutDisplayMode(callouts),
                      ),
                      onUndo: () => undid = true,
                      onRedo: () {},
                      onExitDrawingMode: () => exited = true,
                      onDropCrosshairPoint: () {},
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester.takeException(),
        isNull,
        reason: 'Zero overflow expected at $viewport',
      );

      // All 6 primary controls visible with Desk feature badge
      expect(find.byKey(const Key('mobile-draw-menu-select')), findsOneWidget);
      expect(find.byKey(const Key('mobile-draw-menu-draw')), findsOneWidget);
      expect(find.byKey(const Key('mobile-draw-menu-shapes')), findsOneWidget);
      expect(find.byKey(const Key('mobile-draw-desk-toggle')), findsOneWidget);
      expect(find.byKey(const Key('mobile-draw-desk-badge')), findsOneWidget);
      expect(find.text('4'), findsOneWidget);
      expect(find.byKey(const Key('mobile-draw-options-btn')), findsOneWidget);
      expect(find.byKey(const Key('mobile-draw-done-btn')), findsOneWidget);

      // 1. Select menu -> Edit Vertices
      await tester.tap(find.byKey(const Key('mobile-draw-menu-select')));
      await tester.pumpAndSettle();
      expect(find.text('Edit Vertices'), findsOneWidget);
      expect(find.text('Box Select'), findsOneWidget);
      await tester.tap(find.byKey(const Key('mobile-draw-item-editVertices')));
      await tester.pumpAndSettle();
      expect(mode, DrawToolMode.editVertices);
      expect(find.text('Edit'), findsOneWidget);

      // 2. Draw menu -> Area (Polygon)
      await tester.tap(find.byKey(const Key('mobile-draw-menu-draw')));
      await tester.pumpAndSettle();
      expect(find.text('Point'), findsOneWidget);
      expect(find.text('Area (Polygon)'), findsOneWidget);
      expect(find.text('Sketch (Freehand)'), findsOneWidget);
      expect(find.text('Arrow'), findsOneWidget);
      expect(find.text('Label'), findsOneWidget);
      await tester.tap(find.byKey(const Key('mobile-draw-item-polygon')));
      await tester.pumpAndSettle();
      expect(mode, DrawToolMode.polygon);
      expect(find.text('Area'), findsOneWidget);

      // 3. Shapes & Spatial menu -> cleanly sectioned "SHAPES" & "CUT & MEASURE"
      await tester.tap(find.byKey(const Key('mobile-draw-menu-shapes')));
      await tester.pumpAndSettle();
      expect(find.text('SHAPES'), findsOneWidget);
      expect(find.text('CUT & MEASURE'), findsOneWidget);
      expect(find.text('Drop 100m Circle at Center'), findsOneWidget);
      await tester.tap(find.byKey(const Key('mobile-draw-drop-shape-center')));
      await tester.pumpAndSettle();
      expect(droppedCenter, (PrimitiveShapeKind.circle, 100.0));

      // Re-open Shapes & Spatial menu -> pick Hexagon
      await tester.tap(find.byKey(const Key('mobile-draw-menu-shapes')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('mobile-draw-shape-hexagon')));
      await tester.pumpAndSettle();
      expect(mode, DrawToolMode.shape);
      expect(shape, PrimitiveShapeKind.hexagon);
      expect(find.text('Hexagon'), findsOneWidget);

      // Re-open Shapes & Spatial menu -> pick Cut
      await tester.tap(find.byKey(const Key('mobile-draw-menu-shapes')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('mobile-draw-item-splitByLine')));
      await tester.pumpAndSettle();
      expect(mode, DrawToolMode.splitByLine);
      expect(find.text('Cut'), findsOneWidget);

      // 4. Desk toggle
      await tester.tap(find.byKey(const Key('mobile-draw-desk-toggle')));
      await tester.pump();
      expect(deskOpen, isTrue);

      // 5. Options button opens focused MobileDrawingOptionsSheet & syncs live
      await tester.tap(find.byKey(const Key('mobile-draw-options-btn')));
      await tester.pumpAndSettle();
      expect(find.byType(MobileDrawingOptionsSheet), findsOneWidget);
      await tester.tap(find.byKey(const Key('mobile-options-snapping-toggle')));
      await tester.pumpAndSettle();
      expect(snapping, isFalse);
      await tester.tap(find.byKey(const Key('mobile-options-undo')));
      await tester.pump();
      expect(undid, isTrue);
      await tester.tap(find.byKey(const Key('mobile-options-placement-toggle')));
      await tester.pumpAndSettle();
      expect(placement, TouchPlacementStyle.crosshair);
      await tester.tap(find.byKey(const Key('mobile-options-close')));
      await tester.pumpAndSettle();

      // Crosshair Drop strip appears without overflowing the 6-button bar
      expect(find.byKey(const Key('mobile-draw-crosshair-drop')), findsOneWidget);
      expect(tester.takeException(), isNull);

      // 6. Done exits drawing mode
      await tester.tap(find.byKey(const Key('mobile-draw-done-btn')));
      await tester.pump();
      expect(exited, isTrue);
    }
  });

  testWidgets(
      'MobileDrawingBar active multi-point stroke bar renders Finish/Cut/Save/Measure without overflow on 360dp and 412dp',
      (WidgetTester tester) async {
    for (final viewport in const [Size(360, 780), Size(412, 915)]) {
      setTestViewport(tester, viewport);
      var finished = false;
      var undonePt = false;
      var cancelled = false;
      var toggledDesk = false;

      Widget buildBar({
        required DrawToolMode mode,
        required int vertices,
        bool canFinish = true,
        bool editing = false,
      }) =>
          MaterialApp(
            home: Scaffold(
              body: Align(
                alignment: Alignment.bottomCenter,
                child: MobileDrawingBar(
                  activeMode: mode,
                  activePrimitiveShape: PrimitiveShapeKind.circle,
                  placementStyle: TouchPlacementStyle.drawDrag,
                  loupeEnabled: true,
                  snappingEnabled: true,
                  snapToEdgesEnabled: true,
                  calloutMode: CalloutDisplayMode.full,
                  draftFeatureCount: 2,
                  isDeskOpen: false,
                  canUndo: true,
                  canRedo: false,
                  hasActiveStroke: true,
                  draftVertexCount: vertices,
                  canFinishStroke: canFinish,
                  isEditingExistingFeature: editing,
                  onSelectTool: (_) {},
                  onSelectPrimitiveShape: (_) {},
                  onDropPrimitiveAtCenter: (_, _) async {},
                  onToggleDesk: () => toggledDesk = true,
                  onToggleSnapping: () {},
                  onToggleSnapToEdges: () {},
                  onTogglePlacementStyle: () {},
                  onToggleLoupe: () {},
                  onCycleCalloutMode: () {},
                  onUndo: () {},
                  onRedo: () {},
                  onFinishStroke: () => finished = true,
                  onUndoPoint: () => undonePt = true,
                  onCancelStroke: () => cancelled = true,
                  onExitDrawingMode: () {},
                ),
              ),
            ),
          );

      // 1. Standard Polygon Finish · 3
      await tester.pumpWidget(
        buildBar(mode: DrawToolMode.polygon, vertices: 3),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('mobile-drawing-stroke-bar')), findsOneWidget);
      expect(find.text('Finish · 3'), findsOneWidget);
      expect(find.text('Undo pt'), findsOneWidget);
      expect(find.text('Cancel'), findsOneWidget);

      await tester.tap(find.byKey(const Key('mobile-draw-finish-stroke')));
      await tester.tap(find.byKey(const Key('mobile-draw-undo-pt')));
      await tester.tap(find.byKey(const Key('mobile-draw-cancel-stroke')));
      await tester.tap(find.byKey(const Key('mobile-draw-desk-toggle')));
      await tester.pump();
      expect(finished, isTrue);
      expect(undonePt, isTrue);
      expect(cancelled, isTrue);
      expect(toggledDesk, isTrue);

      // 2. Cut · 2
      await tester.pumpWidget(
        buildBar(mode: DrawToolMode.splitByLine, vertices: 2),
      );
      await tester.pump();
      expect(find.text('Cut · 2'), findsOneWidget);
      expect(tester.takeException(), isNull);

      // 3. Save · 4 (editing existing feature)
      await tester.pumpWidget(
        buildBar(mode: DrawToolMode.line, vertices: 4, editing: true),
      );
      await tester.pump();
      expect(find.text('Save · 4'), findsOneWidget);
      expect(tester.takeException(), isNull);

      // 4. Measure · 2
      await tester.pumpWidget(
        buildBar(mode: DrawToolMode.measure, vertices: 2, canFinish: false),
      );
      await tester.pump();
      expect(find.text('Measure · 2'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets(
      'DeskSheet docks cleanly directly under MobileDrawingBar while staying in Drawing Mode on mobile and desktop',
      (WidgetTester tester) async {
    const sampleFeatures = <DrawnFeature>[
      DrawnFeature(
        id: 'line-1',
        kind: DrawToolMode.line,
        name: 'Ridge Trail',
        vertices: [
          Geographic(lon: 16.36, lat: 48.20),
          Geographic(lon: 16.38, lat: 48.21),
        ],
      ),
      DrawnFeature(
        id: 'poly-1',
        kind: DrawToolMode.polygon,
        name: 'Camp Zone',
        vertices: [
          Geographic(lon: 16.36, lat: 48.20),
          Geographic(lon: 16.37, lat: 48.20),
          Geographic(lon: 16.37, lat: 48.21),
        ],
      ),
    ];

    // Mobile docked stack: Map visible on top -> MobileDrawingBar -> DeskSheet below
    for (final viewport in const [Size(360, 780), Size(412, 915)]) {
      setTestViewport(tester, viewport);

      var mode = DrawToolMode.line;
      var deskOpen = false;
      String? inspectedId;
      String? toggledShelfAddr;
      RustGeoAction? ranAction;

      Widget buildDockedHarness() => MaterialApp(
            home: Scaffold(
              body: StatefulBuilder(
                builder: (context, setState) {
                  Widget buildBar({required bool docked}) => MobileDrawingBar(
                        activeMode: mode,
                        activePrimitiveShape: PrimitiveShapeKind.circle,
                        placementStyle: TouchPlacementStyle.drawDrag,
                        loupeEnabled: true,
                        snappingEnabled: true,
                        snapToEdgesEnabled: true,
                        calloutMode: CalloutDisplayMode.full,
                        draftFeatureCount: sampleFeatures.length,
                        isDeskOpen: deskOpen,
                        canUndo: true,
                        canRedo: false,
                        isDockedAboveDesk: docked,
                        onSelectTool: (next) => setState(() => mode = next),
                        onSelectPrimitiveShape: (_) =>
                            setState(() => mode = DrawToolMode.shape),
                        onDropPrimitiveAtCenter: (_, _) async {},
                        onToggleDesk: () =>
                            setState(() => deskOpen = !deskOpen),
                        onToggleSnapping: () {},
                        onToggleSnapToEdges: () {},
                        onTogglePlacementStyle: () {},
                        onToggleLoupe: () {},
                        onCycleCalloutMode: () {},
                        onUndo: () {},
                        onRedo: () {},
                        onExitDrawingMode: () =>
                            setState(() => mode = DrawToolMode.browse),
                      );

                  return Stack(
                    fit: StackFit.expand,
                    children: [
                      const ColoredBox(
                        key: Key('live-map-canvas'),
                        color: Color(0xFFEDF0EA),
                      ),
                      if (deskOpen)
                        DeskSheet(
                          activeDraftId: 'draft-draw',
                          savedDrafts: const [],
                          relayUrls: const ['wss://relay.earthly.city'],
                          draftTitle: 'Field Sketch',
                          audience: DraftAudienceChoice.publicRelay,
                          account: null,
                          shelfMaps: [
                            ShelfMapEntry(
                              summary: makeTestMap(
                                address: '37515:aaa:ref-layer',
                                title: 'Reference Topo',
                              ),
                              shapes: const [],
                              visible: true,
                            ),
                          ],
                          deskStories: const [],
                          deskAtlases: const [],
                          drawnFeatures: sampleFeatures,
                          isDockedUnderDrawingBar: true,
                          drawingBar: buildBar(docked: true),
                          onSelectDraft: (_) {},
                          onCreateNewDraft: () {},
                          onDeleteDraft: (_) {},
                          onDraftTitleChanged: (_) {},
                          onAudienceChanged: (_) {},
                          onToggleShelfVisibility: (addr) =>
                              toggledShelfAddr = addr,
                          onRemoveShelfMap: (_) {},
                          onInspectShelfMap: (_) {},
                          onFlyToShelfMap: (_) {},
                          onCloneShelfMapToDraft: (_) {},
                          onOpenShelfDiscussion: (_) {},
                          onOpenDeskStory: (_) {},
                          onRemoveDeskStory: (_) {},
                          onOpenDeskAtlas: (_) {},
                          onRemoveDeskAtlas: (_) {},
                          onInspectDraftFeature: (f) => inspectedId = f.id,
                          onRunGeoAction: (a) => ranAction = a,
                          onRunParameterizedGeoAction: (
                            a, {
                            meters,
                            angleDeg,
                            scale,
                          }) =>
                              ranAction = a,
                          onPublishDraft: (_, _) async => testPublishOutcome(),
                          onComposeStory: () {},
                          onCreateAtlas: () {},
                          onImportGeoJson: () {},
                          onExportGeoJsonFile: () {},
                          onCopyGeoJson: () {},
                          onClearDraftFeatures: () {},
                          onClose: () => setState(() => deskOpen = false),
                        ),
                      if (!deskOpen)
                        Positioned(
                          left: 0,
                          right: 0,
                          bottom: 0,
                          child: buildBar(docked: false),
                        ),
                    ],
                  );
                },
              ),
            ),
          );

      await tester.pumpWidget(buildDockedHarness());
      await tester.pumpAndSettle();

      // Open Desk from Drawing Toolbar -> stays in Drawing Mode!
      await tester.tap(find.byKey(const Key('mobile-draw-desk-toggle')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(deskOpen, isTrue);
      expect(mode, DrawToolMode.line);
      expect(find.byKey(const Key('desk-docked-drawing-stack')), findsOneWidget);
      expect(find.byKey(const Key('desk-drawing-mode-badge')), findsOneWidget);

      // Verify cohesive top-to-bottom stack: Map on top -> DrawingBar -> Desk tabs below
      final barRect = tester.getRect(find.byKey(const Key('mobile-drawing-bar')));
      final deskTabRect = tester.getRect(find.byKey(const Key('desk-tab-draft')));
      expect(
        barRect.top,
        greaterThan(160),
        reason: 'Map canvas should stay generously visible above docked toolbar at $viewport',
      );
      expect(
        barRect.bottom,
        lessThanOrEqualTo(deskTabRect.top + 8),
        reason: 'Drawing toolbar must dock cleanly directly ABOVE Desk at $viewport',
      );

      // Inspect a feature in Desk while staying in Drawing Mode
      final inspectIcons = find.byTooltip('Style & inspect feature');
      await tester.ensureVisible(inspectIcons.first);
      await tester.pumpAndSettle();
      await tester.tap(inspectIcons.first);
      await tester.pump();
      expect(inspectedId, 'line-1');
      expect(mode, DrawToolMode.line);

      // Run a spatial tool from Desk while staying in Drawing Mode
      final spatialTile = find.byKey(const Key('desk-spatial-tools-tile'));
      await scrollAndTap(tester, spatialTile, delta: 180);
      await scrollAndTap(
        tester,
        find.byKey(const Key('workbench-rotate-selected')),
        delta: 180,
      );
      expect(ranAction, RustGeoAction.rotateSelected);
      expect(mode, DrawToolMode.line);

      // Switch to Shelf tab & toggle reference layer visibility
      await tester.tap(find.byKey(const Key('desk-tab-shelf')));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Hide'));
      await tester.pump();
      expect(toggledShelfAddr, '37515:aaa:ref-layer');
      expect(mode, DrawToolMode.line);

      // Switch drawing tool right from the docked Drawing Toolbar -> stays in draw mode & Desk stays docked!
      await tester.tap(find.byKey(const Key('mobile-draw-menu-draw')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('mobile-draw-item-point')));
      await tester.pumpAndSettle();
      expect(mode, DrawToolMode.point);
      expect(deskOpen, isTrue);

      // Toggle Desk closed via toolbar Desk button -> STILL in Drawing Mode!
      await tester.tap(find.byKey(const Key('mobile-draw-desk-toggle')));
      await tester.pumpAndSettle();
      expect(deskOpen, isFalse);
      expect(mode, DrawToolMode.point);
    }

    // Desktop docked presentation: side panel leaves bottom clearance for drawing bar
    setTestViewport(tester, const Size(1280, 800));
    await tester.pumpWidget(
      wrapSheetInStack(
        DeskSheet(
          activeDraftId: 'draft-desktop',
          savedDrafts: const [],
          relayUrls: const ['wss://relay.earthly.city'],
          draftTitle: 'Desktop Sketch',
          audience: DraftAudienceChoice.publicRelay,
          account: null,
          shelfMaps: const [],
          deskStories: const [],
          deskAtlases: const [],
          drawnFeatures: sampleFeatures,
          isDockedUnderDrawingBar: true,
          onSelectDraft: (_) {},
          onCreateNewDraft: () {},
          onDeleteDraft: (_) {},
          onDraftTitleChanged: (_) {},
          onAudienceChanged: (_) {},
          onToggleShelfVisibility: (_) {},
          onRemoveShelfMap: (_) {},
          onInspectShelfMap: (_) {},
          onFlyToShelfMap: (_) {},
          onCloneShelfMapToDraft: (_) {},
          onOpenShelfDiscussion: (_) {},
          onOpenDeskStory: (_) {},
          onRemoveDeskStory: (_) {},
          onOpenDeskAtlas: (_) {},
          onRemoveDeskAtlas: (_) {},
          onRunGeoAction: (_) {},
          onPublishDraft: (_, _) async => testPublishOutcome(),
          onComposeStory: () {},
          onCreateAtlas: () {},
          onImportGeoJson: () {},
          onExportGeoJsonFile: () {},
          onCopyGeoJson: () {},
          onClearDraftFeatures: () {},
          onClose: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final desktopStackRect =
        tester.getRect(find.byKey(const Key('desk-docked-drawing-stack')));
    expect(desktopStackRect.bottom, lessThanOrEqualTo(800 - 80));
  });
}
