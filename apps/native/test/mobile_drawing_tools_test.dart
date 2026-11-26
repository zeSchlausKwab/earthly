import 'package:earthly_native/controllers/draft_workbench_controller.dart';
import 'package:earthly_native/drawing/drawing_model.dart';
import 'package:earthly_native/main.dart';
import 'package:earthly_native/nostr/callout_overlay.dart';
import 'package:earthly_native/shell/desk_sheet.dart';
import 'package:earthly_native/shell/feature_inspector_sheet.dart';
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
      'More button opens MobileDrawingToolsSheet with tools, shapes, toggles, workbench ops, and actions',
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

    expect(find.byType(MobileDrawingToolsSheet), findsOneWidget);
    expect(find.text('AUTHORING TOOLS & WORKBENCH'), findsOneWidget);
    expect(find.byKey(const Key('mobile-tools-snapping-toggle')), findsOneWidget);

    final sheetScrollable = find.descendant(
      of: find.byType(MobileDrawingToolsSheet),
      matching: find.byType(Scrollable),
    ).first;

    // Toggle snapping from sheet (already visible near top of sheet)
    await tester.ensureVisible(
      find.byKey(const Key('mobile-tools-snapping-toggle')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('mobile-tools-snapping-toggle')));
    await tester.pump();
    expect(draft.snappingEnabled, isFalse);

    // Scroll down to verify bottom Data & Publish section
    await tester.scrollUntilVisible(
      find.byKey(const Key('mobile-tools-open-desk')),
      180,
      scrollable: sheetScrollable,
    );
    expect(find.byKey(const Key('mobile-tools-open-desk')), findsOneWidget);

    // Scroll back up to Area tool from sheet grid -> switches mode & closes sheet
    await tester.scrollUntilVisible(
      find.byKey(const Key('mobile-tools-mode-polygon')),
      -120,
      scrollable: sheetScrollable,
    );
    await tester.ensureVisible(find.byKey(const Key('mobile-tools-mode-polygon')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('mobile-tools-mode-polygon')));
    await tester.pumpAndSettle();
    expect(find.byType(MobileDrawingToolsSheet), findsNothing);
    expect(draft.mode, DrawToolMode.polygon);
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
      'MobileDrawingToolsSheet executes meter presets, workbench ops, selection, and data callbacks',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 920));

    DrawToolMode? pickedTool;
    PrimitiveShapeKind? pickedShape;
    (PrimitiveShapeKind, double)? droppedShape;
    (RustGeoAction, double?, double?)? lastOp;
    var pasted = false;
    var importedOsm = false;
    var openedDesk = false;
    var toggledSnap = false;
    var toggledCallouts = false;
    var selectedAll = false;

    await tester.pumpWidget(
      wrapInScaffold(
        MobileDrawingToolsSheet(
          activeMode: DrawToolMode.line,
          activePrimitiveShape: PrimitiveShapeKind.circle,
          placementStyle: TouchPlacementStyle.drawDrag,
          loupeEnabled: true,
          snappingEnabled: true,
          snapToEdgesEnabled: true,
          calloutMode: CalloutDisplayMode.full,
          drawnFeatures: const [
            DrawnFeature(
              id: 'l-1',
              kind: DrawToolMode.line,
              vertices: [
                Geographic(lon: 16.36, lat: 48.20),
                Geographic(lon: 16.38, lat: 48.20),
              ],
            ),
          ],
          selectedFeatureIds: const {'l-1'},
          canUndo: true,
          canRedo: false,
          onSelectTool: (m) => pickedTool = m,
          onSelectPrimitiveShape: (s) => pickedShape = s,
          onDropPrimitiveAtCenter: (s, r) async {
            droppedShape = (s, r);
          },
          onToggleSnapping: () => toggledSnap = true,
          onToggleSnapToEdges: () {},
          onTogglePlacementStyle: () {},
          onToggleLoupe: () {},
          onCycleCalloutMode: () => toggledCallouts = true,
          onUndo: () {},
          onRedo: () {},
          onSelectAll: () => selectedAll = true,
          onClearSelection: () {},
          onDuplicateSelected: () {},
          onDeleteSelected: () {},
          onClearDraft: () {},
          onRunGeoAction: (a, {meters, angleDeg, scale}) {
            lastOp = (a, meters, angleDeg);
          },
          onPasteGeoJson: () => pasted = true,
          onImportGeoJson: () {},
          onImportOsm: () => importedOsm = true,
          onExportGeoJson: () {},
          onOpenDeskAndPublish: () => openedDesk = true,
          onExitDrawingMode: () {},
          onClose: () {},
        ),
      ),
    );

    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-meters-250')),
    );
    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-drop-shape-center')),
    );
    expect(droppedShape, (PrimitiveShapeKind.circle, 250.0));

    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-op-corridor')),
    );
    expect(lastOp, (RustGeoAction.corridorLastLine, 250.0, null));

    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-snapping-toggle')),
    );
    expect(toggledSnap, isTrue);

    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-callouts-cycle')),
    );
    expect(toggledCallouts, isTrue);

    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-select-all')),
    );
    expect(selectedAll, isTrue);

    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-paste-geojson')),
    );
    expect(pasted, isTrue);

    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-import-osm')),
    );
    expect(importedOsm, isTrue);

    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-open-desk')),
    );
    expect(openedDesk, isTrue);

    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-shape-diamond')),
    );
    expect(pickedShape, PrimitiveShapeKind.diamond);

    await scrollAndTap(
      tester,
      find.byKey(const Key('mobile-tools-mode-freehand')),
    );
    expect(pickedTool, DrawToolMode.freehand);
  });
}
