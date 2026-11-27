import 'dart:convert';

import 'package:earthly_native/controllers/draft_workbench_controller.dart';
import 'package:earthly_native/drawing/drawing_model.dart';
import 'package:earthly_native/main.dart';
import 'package:earthly_native/nostr/shelf_renderer.dart';
import 'package:earthly_native/shell/desk_sheet.dart';
import 'package:earthly_native/shell/feature_inspector_sheet.dart';
import 'package:earthly_native/shell/help_shortcuts_sheet.dart';
import 'package:earthly_native/shell/raw_event_inspector_dialog.dart';
import 'package:earthly_native/src/rust/api/blossom.dart';
import 'package:earthly_native/src/rust/api/geo.dart';
import 'package:earthly_native/src/rust/api/private_groups.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import 'test_helpers.dart';

void main() {
  test('parseGeoJsonShapes extracts labels, callouts, and round-trips drafts',
      () {
    const sample = '''
    {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "id": "gate-north",
          "geometry": { "type": "Point", "coordinates": [16.37, 48.20] },
          "properties": {
            "color": "#1F5F8B",
            "name": "North Entrance",
            "earthly:callouts": [
              {
                "id": "access",
                "title": "Access",
                "text": "Open 06:00-22:00",
                "placement": { "side": "right", "offset": [10, -4], "leader": "line" }
              }
            ]
          }
        },
        { "type": "Feature", "id": "trail-1", "geometry": { "type": "LineString", "coordinates": [[16.36, 48.20], [16.38, 48.21]] }, "properties": { "label": "Danube Path" } },
        { "type": "Feature", "id": "park-1", "geometry": { "type": "Polygon", "coordinates": [[[16.3, 48.2], [16.4, 48.2], [16.4, 48.3], [16.3, 48.2]]] }, "properties": {} }
      ]
    }
    ''';
    final shapes = parseGeoJsonShapes(
      sample,
      datasetTitle: 'Vienna Parks',
      datasetAddress: '37515:abc:vienna-parks',
    );
    expect(shapes.length, 3);
    expect(shapes[0].kind, ShelfShapeKind.point);
    expect(shapes[0].featureId, 'gate-north');
    expect(shapes[0].label, 'North Entrance');
    expect(shapes[0].callouts.length, 1);
    expect(shapes[0].callouts.first.title, 'Access');
    expect(shapes[0].callouts.first.preferredSide, 'right');
    expect(shapes[1].label, 'Danube Path');

    final draftFeatures = parseDraftFeaturesFromGeoJson(sample);
    expect(draftFeatures.length, 3);
    final roundTripped = draftFeaturesToGeoJson(
      title: 'Round Trip',
      features: draftFeatures,
    );
    expect(parseDraftFeaturesFromGeoJson(roundTripped).length, 3);
  });

  test('Point features with white strokeColor retain their backing fill color',
      () {
    const bushbySample = '''
    {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "id": "waypoint-1",
          "geometry": { "type": "Point", "coordinates": [-77.0, 8.5] },
          "properties": {
            "name": "Darien Gap Crossing",
            "color": "#D97706",
            "strokeColor": "#FFFFFF"
          }
        }
      ]
    }
    ''';
    final shapes = parseGeoJsonShapes(
      bushbySample,
      datasetTitle: 'Karl Bushby Expedition',
      datasetAddress: '37515:abc:bushby',
    );
    expect(shapes.length, 1);
    expect(shapes.first.colorHex, '#D97706');
    expect(shapes.first.fillColorHex, '#D97706');
    expect(shapes.first.strokeColorHex, '#FFFFFF');
  });

  testWidgets(
      'DeskSheet exposes Undo/Redo controls and phone right-thumb rail stays strictly uniform icon-only',
      (WidgetTester tester) async {
    var undoTapped = false;
    var redoTapped = false;
    await tester.pumpWidget(
      wrapSheetInStack(
        DeskSheet(
          activeDraftId: 'draft-1',
          savedDrafts: const [],
          relayUrls: const ['wss://relay.earthly.city'],
          draftTitle: 'Undo Test',
          audience: DraftAudienceChoice.publicRelay,
          account: null,
          shelfMaps: const [],
          deskStories: const [],
          deskAtlases: const [],
          drawnFeatures: const [],
          canUndo: true,
          canRedo: true,
          onUndo: () => undoTapped = true,
          onRedo: () => redoTapped = true,
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
          onPublishDraft: (_, _) async =>
              testPublishOutcome('0123456789abcdef0123456789abcdef'),
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
    await tester.scrollUntilVisible(
      find.byTooltip('Undo draft change (Cmd+Z)'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byTooltip('Undo draft change (Cmd+Z)'));
    await tester.tap(find.byTooltip('Redo draft change (Cmd+Shift+Z)'));
    await tester.pump();
    expect(undoTapped, isTrue);
    expect(redoTapped, isTrue);

    // Verify phone right-thumb rail includes GPS Track & stays 100% uniform icon-only (zero Text!)
    setTestViewport(tester, const Size(390, 844));

    await tester.pumpWidget(
      EarthlyNativeApp(
        mapBuilder: (context, gestures, onMapCreated, onCameraMove) =>
            const ColoredBox(color: Color(0xFFEDF0EA)),
      ),
    );
    await tester.pump();

    final rail = find.byKey(const Key('earthly-right-thumb-rail'));
    expect(rail, findsOneWidget);
    expect(
      find.descendant(of: rail, matching: find.byType(Text)),
      findsNothing,
    );
    expect(
      find.descendant(of: rail, matching: find.byTooltip('Record GPS Track')),
      findsOneWidget,
    );
  });

  test(
      'Draft GeoJSON round-trips fillColor, strokeColor, arrowheads, custom properties, callout offset/media, and collects arrowheads',
      () {
    const polyFeature = DrawnFeature(
      id: 'zone-1',
      kind: DrawToolMode.polygon,
      vertices: [
        Geographic(lon: 16.36, lat: 48.20),
        Geographic(lon: 16.38, lat: 48.20),
        Geographic(lon: 16.38, lat: 48.22),
      ],
      name: 'Alpine Meadow',
      fillColorHex: '#15803D',
      strokeColorHex: '#0F766E',
      fillOpacity: 0.4,
    );
    const lineFeature = DrawnFeature(
      id: 'route-1',
      kind: DrawToolMode.line,
      vertices: [
        Geographic(lon: 16.36, lat: 48.20),
        Geographic(lon: 16.38, lat: 48.22),
      ],
      name: 'Danube Ridge',
      description: 'Scenic **ridge** climb.',
      strokeColorHex: '#EA580C',
      strokeWidth: 4.5,
      lineDash: 'dashed',
      arrowStart: true,
      arrowEnd: true,
      customProperties: {'difficulty': 'T3', 'surface': 'gravel'},
      callouts: [
        DraftCallout(
          id: 'c-1',
          title: 'Trailhead',
          text: 'Water fountain here',
          side: 'right',
          offsetX: 28.5,
          offsetY: -16.0,
          mediaUrls: ['https://blossom.earthly.city/fountain.jpg'],
        ),
      ],
    );

    final geojson = draftFeaturesToGeoJson(
      title: 'Workbench Roundtrip',
      features: const [polyFeature, lineFeature],
    );
    final parsed = parseDraftFeaturesFromGeoJson(geojson);
    expect(parsed, hasLength(2));
    final p = parsed[0];
    expect(p.fillColorHex, '#15803D');
    expect(p.strokeColorHex, '#0F766E');

    final f = parsed[1];
    expect(f.name, 'Danube Ridge');
    expect(f.description, 'Scenic **ridge** climb.');
    expect(f.strokeColorHex, '#EA580C');
    expect(f.arrowStart, isTrue);
    expect(f.arrowEnd, isTrue);
    expect(f.customProperties['difficulty'], 'T3');
    expect(f.customProperties['surface'], 'gravel');
    expect(f.callouts, hasLength(1));
    expect(f.callouts.first.offsetX, closeTo(28.5, 1e-4));
    expect(f.callouts.first.offsetY, closeTo(-16.0, 1e-4));
    expect(
      f.callouts.first.mediaUrls,
      const ['https://blossom.earthly.city/fountain.jpg'],
    );

    final arrows = collectVisibleArrowheads(
      shelfMaps: const [],
      draftAccentColor: const Color(0xFF1F5F8B),
      draftFeatures: parsed,
    );
    expect(arrows, hasLength(2));
    expect(
      arrows.map((a) => a.key),
      containsAll([
        'draft::route-1::start',
        'draft::route-1::end',
      ]),
    );
  });

  testWidgets(
      'FeatureInspectorSheet edits Fill/Stroke custom hex, arrowheads, searchable icons, description, custom properties, callout photo, and duplicate',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(900, 1100));

    String? updatedFill;
    String? updatedStroke;
    bool? updatedArrowEnd;
    String? updatedIcon;
    String? updatedDescription;
    Map<String, String>? updatedCustomProps;
    String? duplicatedId;
    DraftCallout? addedCallout;

    const inspectedLine = InspectedFeature(
      sourceLabel: 'Working draft',
      isDraft: true,
      draftFeatureId: 'line-42',
      geometryType: 'LineString',
      title: 'Alpine Traverse',
      properties: {
        'id': 'line-42',
        'vertices': 3,
        'strokeColor': '#1F5F8B',
        'elevation': '1850m',
      },
    );

    await tester.pumpWidget(
      wrapSheetInStack(
        FeatureInspectorSheet(
          feature: inspectedLine,
          onClose: () {},
          onUpdateDraftStyle: (
            _, {
            fillColorHex,
            clearFillColor = false,
            strokeColorHex,
            clearStrokeColor = false,
            strokeWidth,
            fillOpacity,
            radius,
            lineDash,
            arrowStart,
            arrowEnd,
            displayIcon,
            clearDisplayIcon = false,
            description,
            customProperties,
          }) {
            if (fillColorHex != null) updatedFill = fillColorHex;
            if (strokeColorHex != null) updatedStroke = strokeColorHex;
            if (arrowEnd != null) updatedArrowEnd = arrowEnd;
            if (displayIcon != null) updatedIcon = displayIcon;
            if (description != null) updatedDescription = description;
            if (customProperties != null) {
              updatedCustomProps = customProperties;
            }
          },
          onDuplicateDraftFeature: (id) => duplicatedId = id,
          onAddDraftCallout: (_, c) => addedCallout = c,
          onUploadBlossomImage: (_) async => BlossomUploadDto(
            url: 'https://blossom.earthly.city/callout-photo.jpg',
            sha256: 'b' * 64,
            sizeBytes: BigInt.from(4096),
            mimeType: 'image/jpeg',
          ),
        ),
      ),
    );

    // 1. Custom Stroke hex on LineString
    await tester.enterText(
      find.byKey(const Key('inspector-custom-hex-field')),
      '#FF5500',
    );
    await tester.tap(find.byKey(const Key('inspector-custom-hex-apply')));
    await tester.pump();
    expect(updatedStroke, '#FF5500');

    // 2. Line arrowhead toggle
    final arrowEndBtn = find.byKey(const Key('inspector-arrow-end'));
    await tester.ensureVisible(arrowEndBtn);
    await tester.tap(arrowEndBtn);
    await tester.pump();
    expect(updatedArrowEnd, isTrue);

    // 3. Description save
    final descField = find.byKey(const Key('inspector-description-field'));
    await tester.ensureVisible(descField);
    await tester.enterText(descField, 'Updated **ridge** notes.');
    final saveDesc = find.byKey(const Key('inspector-save-description'));
    await tester.ensureVisible(saveDesc);
    await tester.tap(saveDesc);
    await tester.pump();
    expect(updatedDescription, 'Updated **ridge** notes.');

    // 4. Custom properties add
    final propKey = find.byKey(const Key('inspector-prop-key'));
    await tester.ensureVisible(propKey);
    await tester.enterText(propKey, 'grade');
    await tester.enterText(find.byKey(const Key('inspector-prop-value')), 'A+');
    await tester.tap(find.byKey(const Key('inspector-prop-add')));
    await tester.pump();
    expect(updatedCustomProps?['grade'], 'A+');
    expect(updatedCustomProps?['elevation'], '1850m');

    // 5. Add callout with Blossom photo upload
    final addCalloutChip = find.text('Add Callout');
    await tester.ensureVisible(addCalloutChip);
    await tester.tap(addCalloutChip);
    await tester.pumpAndSettle();
    final uploadBtn = find.byKey(const Key('callout-upload-photo-btn'));
    await tester.ensureVisible(uploadBtn);
    await tester.tap(uploadBtn);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Callout card text (draggable on map!)'),
      'Summit view',
    );
    final saveCalloutBtn = find.widgetWithText(FilledButton, 'Attach Callout');
    await tester.ensureVisible(saveCalloutBtn);
    await tester.tap(saveCalloutBtn);
    await tester.pump();
    expect(addedCallout?.text, 'Summit view');
    expect(
      addedCallout?.mediaUrls,
      const ['https://blossom.earthly.city/callout-photo.jpg'],
    );

    // 6. Duplicate feature
    final dupBtn = find.byKey(const Key('inspector-duplicate-btn'));
    await tester.ensureVisible(dupBtn);
    await tester.tap(dupBtn);
    await tester.pump();
    expect(duplicatedId, 'line-42');

    // 7. Fill/Stroke tabs + searchable 30-icon picker on Point feature
    await tester.pumpWidget(
      wrapSheetInStack(
        FeatureInspectorSheet(
          feature: const InspectedFeature(
            sourceLabel: 'Working draft',
            isDraft: true,
            draftFeatureId: 'pt-9',
            geometryType: 'Point',
            title: 'Summit',
            properties: {},
          ),
          onClose: () {},
          onUpdateDraftStyle: (
            _, {
            fillColorHex,
            clearFillColor = false,
            strokeColorHex,
            clearStrokeColor = false,
            strokeWidth,
            fillOpacity,
            radius,
            lineDash,
            arrowStart,
            arrowEnd,
            displayIcon,
            clearDisplayIcon = false,
            description,
            customProperties,
          }) {
            if (fillColorHex != null) updatedFill = fillColorHex;
            if (displayIcon != null) updatedIcon = displayIcon;
          },
        ),
      ),
    );
    await tester.tap(find.byKey(const Key('inspector-color-fill-tab')));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('inspector-custom-hex-field')),
      '#22AA44',
    );
    await tester.tap(find.byKey(const Key('inspector-custom-hex-apply')));
    await tester.pump();
    expect(updatedFill, '#22AA44');

    final iconSearch = find.byKey(const Key('inspector-icon-search'));
    await tester.ensureVisible(iconSearch);
    await tester.enterText(iconSearch, 'mountain');
    await tester.pump();
    final mountainChip = find.byKey(const Key('icon-chip-lucide:mountain'));
    expect(mountainChip, findsOneWidget);
    await tester.tap(mountainChip);
    await tester.pump();
    expect(updatedIcon, 'lucide:mountain');
  });

  testWidgets(
      'DeskSheet supports multi-selection, primitive shapes, paste/validate GeoJSON, and parameterized Rust workbench ops',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(900, 1100));

    String? toggledFeatureId;
    var duplicatedSelected = false;
    var deletedSelected = false;
    var pastedClipboard = false;
    (RustGeoAction, double?, double?)? lastWorkbenchOp;

    const draftFeatures = [
      DrawnFeature(
        id: 'l-1',
        kind: DrawToolMode.line,
        name: 'East Path',
        vertices: [
          Geographic(lon: 16.36, lat: 48.20),
          Geographic(lon: 16.37, lat: 48.20),
        ],
      ),
      DrawnFeature(
        id: 'l-2',
        kind: DrawToolMode.line,
        name: 'West Path',
        vertices: [
          Geographic(lon: 16.37, lat: 48.20),
          Geographic(lon: 16.38, lat: 48.20),
        ],
      ),
      DrawnFeature(
        id: 'p-1',
        kind: DrawToolMode.polygon,
        name: 'Park',
        vertices: [
          Geographic(lon: 16.36, lat: 48.20),
          Geographic(lon: 16.37, lat: 48.20),
          Geographic(lon: 16.37, lat: 48.21),
        ],
      ),
    ];

    await tester.pumpWidget(
      wrapSheetInStack(
        DeskSheet(
          activeDraftId: 'draft-wb',
          savedDrafts: const [],
          relayUrls: const ['wss://relay.earthly.city'],
          draftTitle: 'Workbench Draft',
          audience: DraftAudienceChoice.publicRelay,
          account: null,
          shelfMaps: const [],
          deskStories: const [],
          deskAtlases: const [],
          drawnFeatures: draftFeatures,
          selectedDraftFeatureIds: const {'l-1', 'l-2', 'p-1'},
          onToggleSelectDraftFeature: (id) => toggledFeatureId = id,
          onSelectAllDraftFeatures: () {},
          onClearDraftSelection: () {},
          onInspectDraftFeature: (_) {},
          onDuplicateSelectedFeatures: () => duplicatedSelected = true,
          onDeleteSelectedFeatures: () => deletedSelected = true,
          onPasteGeoJsonFromClipboard: () => pastedClipboard = true,
          onValidateDraft: () async => const DraftValidationDto(
            valid: true,
            featureCount: 3,
            message: 'Valid RFC 7946 GeoJSON (3 features)',
          ),
          onAddPrimitiveShape: (shape, r) async {},
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
          onRunParameterizedGeoAction: (
            action, {
            meters,
            angleDeg,
            scale,
          }) {
            lastWorkbenchOp = (action, meters, angleDeg);
          },
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

    // 1. Paste GeoJSON & Validate RFC 7946
    await scrollAndTap(tester, find.byKey(const Key('desk-paste-geojson-btn')));
    expect(pastedClipboard, isTrue);

    await scrollAndTap(tester, find.byKey(const Key('desk-validate-draft-btn')));
    expect(
      find.textContaining('Valid RFC 7946 GeoJSON (3 features)'),
      findsOneWidget,
    );

    // 2. Multi-selection row toggle + Duplicate / Delete selected
    await scrollAndTap(
      tester,
      find.byKey(const Key('desk-duplicate-selected-btn')),
    );
    await scrollAndTap(
      tester,
      find.byKey(const Key('desk-delete-selected-btn')),
    );
    await scrollAndTap(tester, find.byKey(const Key('draft-feature-row-p-1')));
    expect(duplicatedSelected, isTrue);
    expect(deletedSelected, isTrue);
    expect(toggledFeatureId, 'p-1');

    // 3. Demo primitive chips removed + collapsed Spatial Tools accordion with meter preset (250m) & geo actions
    expect(find.byKey(const Key('primitive-circle')), findsNothing);
    expect(find.textContaining('PRIMITIVE SHAPES'), findsNothing);
    expect(find.byKey(const Key('workbench-meters-250')), findsNothing);

    await scrollAndTap(
      tester,
      find.byKey(const Key('desk-spatial-tools-tile')),
    );
    await scrollAndTap(tester, find.byKey(const Key('workbench-meters-250')));

    await scrollAndTap(tester, find.byKey(const Key('workbench-connect-lines')));
    expect(lastWorkbenchOp, (RustGeoAction.connectLines, 250.0, null));

    await scrollAndTap(tester, find.byKey(const Key('workbench-dissolve-lines')));
    expect(lastWorkbenchOp, (RustGeoAction.dissolveLines, 250.0, null));

    await scrollAndTap(tester, find.byKey(const Key('workbench-inset-polygon')));
    expect(lastWorkbenchOp, (RustGeoAction.insetPolygon, 250.0, null));

    await scrollAndTap(
      tester,
      find.byKey(const Key('workbench-rotate-selected')),
    );
    expect(lastWorkbenchOp, (RustGeoAction.rotateSelected, 250.0, 15.0));
  });

  testWidgets(
      'RawEventInspectorDialog and HelpShortcutsSheet render cleanly without overflows',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(420, 900));

    await tester.pumpWidget(
      wrapInScaffold(
        Builder(
          builder: (ctx) => Stack(
            children: [
              HelpShortcutsSheet(onClose: () {}),
              Positioned(
                top: 8,
                left: 8,
                child: TextButton(
                  key: const Key('open-raw-inspector-test-btn'),
                  onPressed: () => showRawEventInspectorDialog(
                    ctx,
                    kind: 37515,
                    title: 'Raw Test Map',
                    eventId: 'ev123',
                    pubkey: 'pk123',
                    address: '37515:pk123:test',
                    dTag: 'test',
                    payloadLabel: 'GeoJSON Content',
                    payloadContent: '{"type":"FeatureCollection","features":[]}',
                  ),
                  child: const Text('Inspect'),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('Help & Shortcuts'), findsOneWidget);
    expect(find.text('Cmd / Ctrl + Z'), findsOneWidget);

    await tester.tap(find.byKey(const Key('open-raw-inspector-test-btn')));
    await tester.pumpAndSettle();
    expect(find.text('RAW EVENT INSPECTOR (KIND 37515)'), findsOneWidget);
    expect(find.byKey(const Key('raw-inspector-copy-btn')), findsOneWidget);
  });

  testWidgets(
      'DeskSheet exposes Shapefile .zip export action in Export menu',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    var exportedShp = false;

    await tester.pumpWidget(
      wrapSheetInStack(
        DeskSheet(
          activeDraftId: 'd-shp',
          savedDrafts: const [],
          relayUrls: const ['wss://relay.earthly.city'],
          draftTitle: 'Shapefile Test',
          audience: DraftAudienceChoice.publicRelay,
          account: null,
          shelfMaps: const [],
          deskStories: const [],
          deskAtlases: const [],
          drawnFeatures: const [
            DrawnFeature(
              id: 'p1',
              kind: DrawToolMode.point,
              name: 'Hub',
              vertices: [Geographic(lon: 16.37, lat: 48.20)],
            ),
          ],
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
          onExportShapefileZip: () => exportedShp = true,
          onCopyGeoJson: () {},
          onClearDraftFeatures: () {},
          onClose: () {},
        ),
      ),
    );

    final exportBtn = find.text('Export ▾');
    await tester.ensureVisible(exportBtn);
    await tester.pumpAndSettle();
    await tester.tap(exportBtn);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('desk-export-shapefile-zip')));
    await tester.pumpAndSettle();
    expect(exportedShp, isTrue);
  });

  testWidgets(
      'HelpShortcutsSheet launches 5-step GuidedTourDialog and steps through to Finish',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    await tester.pumpWidget(
      wrapSheetInStack(
        HelpShortcutsSheet(onClose: () {}),
      ),
    );

    await tester.tap(find.byKey(const Key('help-start-tour-btn')));
    await tester.pumpAndSettle();

    expect(find.text('STEP 1 OF 5'), findsOneWidget);
    for (var step = 2; step <= 5; step++) {
      await tester.tap(find.byKey(const Key('tour-next-btn')));
      await tester.pumpAndSettle();
      expect(find.text('STEP $step OF 5'), findsOneWidget);
    }

    await tester.tap(find.byKey(const Key('tour-finish-btn')));
    await tester.pumpAndSettle();
    expect(find.text('STEP 5 OF 5'), findsNothing);
  });

  test(
      'draftFeaturesToGeoJson & parseDraftFeaturesFromGeoJson round-trip MultiPoint, MultiLineString, and MultiPolygon',
      () {
    const inputFeatures = [
      DrawnFeature(
        id: 'mp-1',
        kind: DrawToolMode.point,
        vertices: [Geographic(lon: 16.37, lat: 48.20)],
        extraParts: [
          [Geographic(lon: 16.39, lat: 48.22)],
        ],
        name: 'Twin Well',
      ),
      DrawnFeature(
        id: 'ml-1',
        kind: DrawToolMode.line,
        vertices: [
          Geographic(lon: 16.36, lat: 48.20),
          Geographic(lon: 16.37, lat: 48.21),
        ],
        extraParts: [
          [
            Geographic(lon: 16.38, lat: 48.22),
            Geographic(lon: 16.39, lat: 48.23),
          ],
        ],
        name: 'Split Path',
      ),
      DrawnFeature(
        id: 'mpoly-1',
        kind: DrawToolMode.polygon,
        vertices: [
          Geographic(lon: 16.30, lat: 48.20),
          Geographic(lon: 16.31, lat: 48.20),
          Geographic(lon: 16.31, lat: 48.21),
        ],
        extraParts: [
          [
            Geographic(lon: 16.34, lat: 48.22),
            Geographic(lon: 16.35, lat: 48.22),
            Geographic(lon: 16.35, lat: 48.23),
          ],
        ],
        name: 'Archipelago',
      ),
    ];

    final encoded =
        draftFeaturesToGeoJson(title: 'Multipart Draft', features: inputFeatures);
    final decodedJson = jsonDecode(encoded) as Map<String, dynamic>;
    final jsonFeats = decodedJson['features'] as List<dynamic>;
    expect(jsonFeats[0]['geometry']['type'], 'MultiPoint');
    expect(jsonFeats[1]['geometry']['type'], 'MultiLineString');
    expect(jsonFeats[2]['geometry']['type'], 'MultiPolygon');

    final reparsed = parseDraftFeaturesFromGeoJson(encoded);
    expect(reparsed.length, 3);
    expect(reparsed.every((f) => f.isMultipart), isTrue);
    expect(reparsed[0].allParts.length, 2);
    expect(reparsed[1].allParts.length, 2);
    expect(reparsed[2].allParts.length, 2);
    expect(reparsed[2].name, 'Archipelago');
  });

  testWidgets(
      'DeskSheet triggers Merge Multipart and Explode Multipart workbench controls',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    final triggered = <RustGeoAction>[];

    await tester.pumpWidget(
      wrapSheetInStack(
        DeskSheet(
          activeDraftId: 'd-multi',
          savedDrafts: const [],
          relayUrls: const ['wss://relay.earthly.city'],
          draftTitle: 'Multipart Draft',
          audience: DraftAudienceChoice.publicRelay,
          account: null,
          shelfMaps: const [],
          deskStories: const [],
          deskAtlases: const [],
          drawnFeatures: const [
            DrawnFeature(
              id: 'p1',
              kind: DrawToolMode.point,
              name: 'Pt A',
              vertices: [Geographic(lon: 16.37, lat: 48.20)],
            ),
            DrawnFeature(
              id: 'mp2',
              kind: DrawToolMode.point,
              name: 'Pt Multi',
              vertices: [Geographic(lon: 16.38, lat: 48.21)],
              extraParts: [
                [Geographic(lon: 16.39, lat: 48.22)],
              ],
            ),
          ],
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
          onRunParameterizedGeoAction: (action, {meters, angleDeg, scale}) =>
              triggered.add(action),
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

    await scrollAndTap(
      tester,
      find.byKey(const Key('desk-spatial-tools-tile')),
      delta: 200,
    );

    await scrollAndTap(
      tester,
      find.byKey(const Key('workbench-merge-multipart')),
      delta: 200,
    );
    expect(triggered, contains(RustGeoAction.mergeMultipart));

    await scrollAndTap(
      tester,
      find.byKey(const Key('workbench-explode-multipart')),
      delta: 120,
    );
    expect(triggered, contains(RustGeoAction.explodeMultipart));
  });

  testWidgets(
      'DeskSheet 2-tab layout, title reset, 3-way publish (with & without MLS groups), and group picker',
      (WidgetTester tester) async {
    setTestViewport(tester, const Size(440, 900));

    final circles = [
      CircleWorkspaceDto(
        workspaceId: 'ws-alpha',
        groupId: 'grp-alpha',
        name: 'Alpine Crew',
        description: 'Mountain crew',
        recommendedBasemap: 'OpenFreeMap Liberty',
        role: 'admin',
        status: 'active',
        cursor: BigInt.from(1),
        epoch: BigInt.from(1),
        coordinatorPubkey: 'c' * 64,
        relays: const ['wss://relay.earthly.city'],
        members: const ['a', 'b'],
        administrators: const ['a'],
        datasets: const [],
        messages: const [],
        createdAtMs: BigInt.from(1791000000000),
        syncHealth: 'healthy',
        consecutiveDecryptErrors: 0,
        autoApproveJoins: false,
        cordnGroupRef: 'cordn1testalpha',
      ),
      CircleWorkspaceDto(
        workspaceId: 'ws-beta',
        groupId: 'grp-beta',
        name: 'River Watch',
        description: 'Danube crew',
        recommendedBasemap: 'OpenFreeMap Liberty',
        role: 'member',
        status: 'active',
        cursor: BigInt.from(2),
        epoch: BigInt.from(1),
        coordinatorPubkey: 'c' * 64,
        relays: const ['wss://relay.earthly.city'],
        members: const ['a'],
        administrators: const ['a'],
        datasets: const [],
        messages: const [],
        createdAtMs: BigInt.from(1791000000000),
        syncHealth: 'healthy',
        consecutiveDecryptErrors: 0,
        autoApproveJoins: false,
        cordnGroupRef: 'cordn1testbeta',
      ),
    ];

    const sampleFeature = DrawnFeature(
      id: 'pt-1',
      kind: DrawToolMode.point,
      name: 'Marker',
      vertices: [Geographic(lon: 16.37, lat: 48.20)],
    );

    var openedCircles = false;
    String? selectedCircleId;
    var audience = DraftAudienceChoice.publicRelay;
    var draftId = 'draft-1';
    var draftTitle = 'Old Frozen Name';
    (String, DraftAudienceChoice)? published;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setModalState) => Stack(
              children: [
                DeskSheet(
                  activeDraftId: draftId,
                  savedDrafts: const [],
                  relayUrls: const ['wss://relay.earthly.city'],
                  draftTitle: draftTitle,
                  audience: audience,
                  account: null,
                  shelfMaps: [
                    ShelfMapEntry(
                      summary: makeTestMap(
                        address: '37515:aaa:shelf-1',
                        title: 'Shelf Trail',
                      ),
                      shapes: const [],
                      visible: true,
                    ),
                  ],
                  deskStories: const [],
                  deskAtlases: const [],
                  drawnFeatures: const [sampleFeature],
                  circles: const [],
                  selectedCircleId: selectedCircleId,
                  onSelectedCircleChanged: (id) =>
                      setModalState(() => selectedCircleId = id),
                  onOpenCircles: () => openedCircles = true,
                  onSelectDraft: (_) {},
                  onCreateNewDraft: () => setModalState(() {
                    draftId = 'draft-2';
                    draftTitle = '';
                    audience = DraftAudienceChoice.publicRelay;
                  }),
                  onDeleteDraft: (_) {},
                  onDraftTitleChanged: (t) =>
                      setModalState(() => draftTitle = t),
                  onAudienceChanged: (a) => setModalState(() => audience = a),
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
                  onPublishDraft: (t, a) async {
                    published = (t, a);
                    return testPublishOutcome();
                  },
                  onComposeStory: () {},
                  onCreateAtlas: () {},
                  onImportGeoJson: () {},
                  onExportGeoJsonFile: () {},
                  onCopyGeoJson: () {},
                  onClearDraftFeatures: () =>
                      setModalState(() => draftTitle = ''),
                  onClose: () {},
                ),
              ],
            ),
          ),
        ),
      ),
    );

    // Header uses clean 2-tab bar without old banner
    expect(find.text('DESK · SHELF, DRAFT & PUBLISH'), findsNothing);
    expect(find.byKey(const Key('desk-tab-draft')), findsOneWidget);
    expect(find.byKey(const Key('desk-tab-shelf')), findsOneWidget);

    // Title updates cleanly when cleared / reset via didUpdateWidget
    expect(find.text('Old Frozen Name'), findsOneWidget);
    await tester.tap(find.byKey(const Key('desk-clear-title-btn')));
    await tester.pump();
    expect(draftTitle, '');
    expect(find.text('Old Frozen Name'), findsNothing);

    // 3-way SegmentedButton always shows Public, Nearby, MLS Group even with 0 groups
    expect(find.text('Public'), findsOneWidget);
    expect(find.text('Nearby'), findsOneWidget);
    expect(find.text('MLS Group'), findsOneWidget);

    final verticalScrollable = find
        .byWidgetPredicate(
          (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
        )
        .first;

    await tester.scrollUntilVisible(
      find.text('MLS Group'),
      160,
      scrollable: verticalScrollable,
    );
    await tester.ensureVisible(find.text('MLS Group'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('MLS Group'));
    await tester.pumpAndSettle();
    expect(find.text('No MLS groups yet'), findsOneWidget);

    final publishBtnFinder = find.byKey(const Key('desk-publish-btn'));
    await tester.scrollUntilVisible(
      publishBtnFinder,
      160,
      scrollable: verticalScrollable,
    );
    final publishWhenEmpty = tester.widget<FilledButton>(publishBtnFinder);
    expect(publishWhenEmpty.onPressed, isNull);

    final createJoinBtn = find.byKey(const Key('desk-create-join-mls-btn'));
    await tester.scrollUntilVisible(
      createJoinBtn,
      -160,
      scrollable: verticalScrollable,
    );
    await tester.ensureVisible(createJoinBtn);
    await tester.pumpAndSettle();
    await tester.tap(createJoinBtn);
    await tester.pumpAndSettle();
    expect(openedCircles, isTrue);

    // Switch to Shelf tab and verify shelf map is displayed
    await tester.tap(find.byKey(const Key('desk-tab-shelf')));
    await tester.pumpAndSettle();
    expect(find.text('Shelf Trail'), findsOneWidget);

    // Now render with 2 MLS groups, verify auto-select & group switching
    audience = DraftAudienceChoice.publicRelay;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setModalState) => Stack(
              children: [
                DeskSheet(
                  key: const ValueKey('desk-groups-test'),
                  activeDraftId: 'draft-groups',
                  savedDrafts: const [],
                  relayUrls: const ['wss://relay.earthly.city'],
                  draftTitle: '',
                  audience: audience,
                  account: null,
                  shelfMaps: const [],
                  deskStories: const [],
                  deskAtlases: const [],
                  drawnFeatures: const [sampleFeature],
                  circles: circles,
                  selectedCircleId: selectedCircleId,
                  onSelectedCircleChanged: (id) =>
                      setModalState(() => selectedCircleId = id),
                  onOpenCircles: () {},
                  onSelectDraft: (_) {},
                  onCreateNewDraft: () {},
                  onDeleteDraft: (_) {},
                  onDraftTitleChanged: (_) {},
                  onAudienceChanged: (a) => setModalState(() => audience = a),
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
                  onPublishDraft: (t, a) async {
                    published = (t, a);
                    return testPublishOutcome();
                  },
                  onComposeStory: () {},
                  onCreateAtlas: () {},
                  onImportGeoJson: () {},
                  onExportGeoJsonFile: () {},
                  onCopyGeoJson: () {},
                  onClearDraftFeatures: () {},
                  onClose: () {},
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final verticalScrollable2 = find
        .byWidgetPredicate(
          (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
        )
        .first;
    final mlsSegment = find.text('MLS Group');
    await tester.scrollUntilVisible(
      mlsSegment,
      160,
      scrollable: verticalScrollable2,
    );
    await tester.ensureVisible(mlsSegment);
    await tester.pumpAndSettle();
    await tester.tap(mlsSegment);
    await tester.pumpAndSettle();

    final publishGroupBtn = find.byKey(const Key('desk-publish-btn'));
    await tester.scrollUntilVisible(
      publishGroupBtn,
      160,
      scrollable: verticalScrollable2,
    );
    expect(find.text('Publish to "Alpine Crew"'), findsOneWidget);

    final betaGroupBtn = find.byKey(const Key('desk-mls-group-ws-beta'));
    await tester.scrollUntilVisible(
      betaGroupBtn,
      -160,
      scrollable: verticalScrollable2,
    );
    await tester.ensureVisible(betaGroupBtn);
    await tester.pumpAndSettle();
    await tester.tap(betaGroupBtn);
    await tester.pumpAndSettle();
    expect(selectedCircleId, 'ws-beta');

    await tester.scrollUntilVisible(
      publishGroupBtn,
      160,
      scrollable: verticalScrollable2,
    );
    expect(find.text('Publish to "River Watch"'), findsOneWidget);
    await tester.ensureVisible(publishGroupBtn);
    await tester.pumpAndSettle();
    await tester.tap(publishGroupBtn);
    await tester.pumpAndSettle();
    expect(published, ('Untitled Map', DraftAudienceChoice.privateCircle));
  });

  test(
      'DraftWorkbenchController resets draftTitle, mints fresh IDs on clear/new/clone, and round-trips 3 audiences',
      () {
    final controller = DraftWorkbenchController();
    addTearDown(controller.dispose);

    expect(controller.draftTitle, '');
    expect(controller.effectiveDraftTitle, 'Untitled Map');

    controller.setDraftTitle('Survey Alpha');
    controller.setDraftAudience(DraftAudienceChoice.privateCircle);
    controller.dropDraftPointAt(const Geographic(lon: 16.37, lat: 48.20));
    final firstDTag = controller.draftDTag;

    controller.clearDraftFeatures();
    expect(controller.features, isEmpty);
    expect(controller.draftTitle, '');
    expect(controller.draftDTag, isNot(firstDTag));

    controller.setDraftTitle('Survey Beta');
    controller.setDraftAudience(DraftAudienceChoice.nearbyLocalNode);
    final prevDraftId = controller.activeDraftId;
    final prevDTag = controller.draftDTag;

    controller.createNewDraft();
    expect(controller.draftTitle, '');
    expect(controller.draftAudience, DraftAudienceChoice.publicRelay);
    expect(controller.activeDraftId, isNot(prevDraftId));
    expect(controller.draftDTag, isNot(prevDTag));

    const sampleGeo =
        '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[16.37,48.20]},"properties":{"name":"Camp"}}]}';
    final draftIdBeforeClone = controller.activeDraftId;
    final dTagBeforeClone = controller.draftDTag;
    final clonedCount = controller.cloneGeoJsonToDraft('Danube Route', sampleGeo);
    expect(clonedCount, 1);
    expect(controller.activeDraftId, isNot(draftIdBeforeClone));
    expect(controller.draftDTag, isNot(dTagBeforeClone));
    expect(controller.draftTitle, 'Danube Route (Draft)');

    expect(
      DraftWorkbenchController.audienceFromChannel('nearby'),
      DraftAudienceChoice.nearbyLocalNode,
    );
    expect(
      DraftWorkbenchController.audienceFromChannel('circle'),
      DraftAudienceChoice.privateCircle,
    );
    expect(
      DraftWorkbenchController.audienceFromChannel('mls'),
      DraftAudienceChoice.privateCircle,
    );
    expect(
      DraftWorkbenchController.audienceFromChannel('public'),
      DraftAudienceChoice.publicRelay,
    );
    expect(
      DraftWorkbenchController.audienceToChannel(
        DraftAudienceChoice.privateCircle,
      ),
      'circle',
    );
  });
}
