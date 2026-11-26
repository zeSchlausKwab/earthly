import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../nostr/callout_overlay.dart';
import '../theme/earthly_theme.dart';
import 'desk_sheet.dart';

/// Descriptor for a single authoring tool in the mobile dock & tools sheet.
class MobileDrawingToolSpec {
  const MobileDrawingToolSpec({
    required this.mode,
    required this.label,
    required this.icon,
  });

  final DrawToolMode mode;
  final String label;
  final IconData icon;
}

/// Canonical ordered list of mobile authoring tools shared between the bottom
/// authoring dock and [MobileDrawingToolsSheet].
const List<MobileDrawingToolSpec> mobileAuthoringTools = <MobileDrawingToolSpec>[
  MobileDrawingToolSpec(
    mode: DrawToolMode.select,
    label: 'Select',
    icon: Icons.near_me_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.editVertices,
    label: 'Edit',
    icon: Icons.edit_location_alt_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.boxSelect,
    label: 'Box',
    icon: Icons.select_all,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.point,
    label: 'Point',
    icon: Icons.location_on_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.line,
    label: 'Line',
    icon: Icons.timeline,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.freehand,
    label: 'Sketch',
    icon: Icons.gesture,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.polygon,
    label: 'Area',
    icon: Icons.pentagon_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.arrow,
    label: 'Arrow',
    icon: Icons.north_east,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.shape,
    label: 'Shape',
    icon: Icons.category_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.annotation,
    label: 'Label',
    icon: Icons.label_outline,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.splitByLine,
    label: 'Cut',
    icon: Icons.content_cut,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.measure,
    label: 'Measure',
    icon: Icons.straighten,
  ),
];

/// Descriptor for a primitive shape preset.
class PrimitiveShapeSpec {
  const PrimitiveShapeSpec({
    required this.kind,
    required this.label,
    required this.icon,
  });

  final PrimitiveShapeKind kind;
  final String label;
  final IconData icon;
}

/// Canonical 6 primitive shape presets shared across the floating shape bar and
/// [MobileDrawingToolsSheet].
const List<PrimitiveShapeSpec> mobilePrimitiveShapes = <PrimitiveShapeSpec>[
  PrimitiveShapeSpec(
    kind: PrimitiveShapeKind.circle,
    label: 'Circle',
    icon: Icons.circle_outlined,
  ),
  PrimitiveShapeSpec(
    kind: PrimitiveShapeKind.square,
    label: 'Square',
    icon: Icons.crop_square,
  ),
  PrimitiveShapeSpec(
    kind: PrimitiveShapeKind.rectangle,
    label: 'Rectangle',
    icon: Icons.rectangle_outlined,
  ),
  PrimitiveShapeSpec(
    kind: PrimitiveShapeKind.triangle,
    label: 'Triangle',
    icon: Icons.change_history,
  ),
  PrimitiveShapeSpec(
    kind: PrimitiveShapeKind.diamond,
    label: 'Diamond',
    icon: Icons.diamond_outlined,
  ),
  PrimitiveShapeSpec(
    kind: PrimitiveShapeKind.hexagon,
    label: 'Hexagon',
    icon: Icons.hexagon_outlined,
  ),
];

/// Overflow authoring & geometry workbench sheet opened from the mobile drawing
/// dock (`More`) or contextual Selection Action Bar (`Ops`). Mirrors Web's
/// `MobileToolMenu.tsx`.
class MobileDrawingToolsSheet extends StatefulWidget {
  const MobileDrawingToolsSheet({
    required this.activeMode,
    required this.activePrimitiveShape,
    required this.placementStyle,
    required this.loupeEnabled,
    required this.snappingEnabled,
    required this.snapToEdgesEnabled,
    required this.calloutMode,
    required this.drawnFeatures,
    required this.selectedFeatureIds,
    required this.canUndo,
    required this.canRedo,
    required this.onSelectTool,
    required this.onSelectPrimitiveShape,
    required this.onDropPrimitiveAtCenter,
    required this.onToggleSnapping,
    required this.onToggleSnapToEdges,
    required this.onTogglePlacementStyle,
    required this.onToggleLoupe,
    required this.onCycleCalloutMode,
    required this.onUndo,
    required this.onRedo,
    required this.onSelectAll,
    required this.onClearSelection,
    required this.onDuplicateSelected,
    required this.onDeleteSelected,
    required this.onClearDraft,
    required this.onRunGeoAction,
    required this.onPasteGeoJson,
    required this.onImportGeoJson,
    required this.onImportOsm,
    required this.onExportGeoJson,
    required this.onOpenDeskAndPublish,
    required this.onExitDrawingMode,
    required this.onClose,
    super.key,
  });

  final DrawToolMode activeMode;
  final PrimitiveShapeKind activePrimitiveShape;
  final TouchPlacementStyle placementStyle;
  final bool loupeEnabled;
  final bool snappingEnabled;
  final bool snapToEdgesEnabled;
  final CalloutDisplayMode calloutMode;
  final List<DrawnFeature> drawnFeatures;
  final Set<String> selectedFeatureIds;
  final bool canUndo;
  final bool canRedo;

  final ValueChanged<DrawToolMode> onSelectTool;
  final ValueChanged<PrimitiveShapeKind> onSelectPrimitiveShape;
  final Future<void> Function(PrimitiveShapeKind shape, double radiusMeters)
      onDropPrimitiveAtCenter;
  final VoidCallback onToggleSnapping;
  final VoidCallback onToggleSnapToEdges;
  final VoidCallback onTogglePlacementStyle;
  final VoidCallback onToggleLoupe;
  final VoidCallback onCycleCalloutMode;
  final VoidCallback onUndo;
  final VoidCallback onRedo;
  final VoidCallback onSelectAll;
  final VoidCallback onClearSelection;
  final VoidCallback onDuplicateSelected;
  final VoidCallback onDeleteSelected;
  final VoidCallback onClearDraft;
  final void Function(
    RustGeoAction action, {
    double? meters,
    double? angleDeg,
    double? scale,
  }) onRunGeoAction;
  final VoidCallback onPasteGeoJson;
  final VoidCallback onImportGeoJson;
  final VoidCallback onImportOsm;
  final VoidCallback onExportGeoJson;
  final VoidCallback onOpenDeskAndPublish;
  final VoidCallback onExitDrawingMode;
  final VoidCallback onClose;

  @override
  State<MobileDrawingToolsSheet> createState() =>
      _MobileDrawingToolsSheetState();
}

class _MobileDrawingToolsSheetState extends State<MobileDrawingToolsSheet> {
  static const List<double> _meterPresets = <double>[10, 25, 50, 100, 250, 500];

  double _workbenchMeters = 100;

  void _triggerGeoAction(
    RustGeoAction action, {
    double? meters,
    double? angleDeg,
    double? scale,
  }) {
    widget.onRunGeoAction(
      action,
      meters: meters ?? _workbenchMeters,
      angleDeg: angleDeg,
      scale: scale,
    );
  }

  Widget _sectionLabel(ThemeData theme, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: theme.textTheme.labelSmall?.copyWith(
          fontFamily: 'monospace',
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final selectedIds = widget.selectedFeatureIds;
    final targetFeatures = selectedIds.isNotEmpty
        ? widget.drawnFeatures
            .where((f) => selectedIds.contains(f.id))
            .toList(growable: false)
        : widget.drawnFeatures;
    final pointCount =
        targetFeatures.where((f) => f.kind == DrawToolMode.point).length;
    final lineCount =
        targetFeatures.where((f) => f.kind == DrawToolMode.line).length;
    final polyCount =
        targetFeatures.where((f) => f.kind == DrawToolMode.polygon).length;
    final canMergeMultipart =
        pointCount >= 2 || lineCount >= 2 || polyCount >= 2;
    final hasMultipart = targetFeatures.any((f) => f.isMultipart);
    final hasLine = lineCount >= 1;
    final hasAnyTarget = targetFeatures.isNotEmpty;
    final mLabel = '${_workbenchMeters.round()}m';
    final activeShapeSpec = mobilePrimitiveShapes.firstWhere(
      (s) => s.kind == widget.activePrimitiveShape,
      orElse: () => mobilePrimitiveShapes.first,
    );

    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 8),
          Container(
            width: 38,
            height: 4,
            decoration: BoxDecoration(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.24),
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 6),
            child: Row(
              children: [
                const Icon(
                  Icons.design_services_outlined,
                  size: 18,
                  color: EarthlyColors.amber,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'AUTHORING TOOLS & WORKBENCH',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelLarge?.copyWith(
                          fontFamily: 'monospace',
                          letterSpacing: 0.7,
                        ),
                      ),
                      Text(
                        '${widget.drawnFeatures.length} draft · ${selectedIds.length} selected',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: () {
                    widget.onClose();
                    widget.onExitDrawingMode();
                  },
                  child: const Text('Done'),
                ),
                IconButton(
                  tooltip: 'Close tools sheet',
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close, size: 19),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                // 1. Full 12-Tool Authoring Grid
                _sectionLabel(theme, 'DRAW & EDIT TOOLS'),
                GridView.count(
                  crossAxisCount: 4,
                  mainAxisSpacing: 6,
                  crossAxisSpacing: 6,
                  childAspectRatio: 1.45,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  children: [
                    for (final tool in mobileAuthoringTools)
                      _ToolGridTile(
                        key: Key('mobile-tools-mode-${tool.mode.name}'),
                        spec: tool,
                        selected: widget.activeMode == tool.mode,
                        isDark: isDark,
                        onTap: () {
                          widget.onClose();
                          widget.onSelectTool(tool.mode);
                        },
                      ),
                  ],
                ),

                const Divider(height: 22),

                // 2. 6 Primitive Shapes
                _sectionLabel(
                  theme,
                  'PRIMITIVE SHAPES (DRAG OR DROP $mLabel)',
                ),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final shape in mobilePrimitiveShapes)
                      ChoiceChip(
                        key: Key('mobile-tools-shape-${shape.kind.name}'),
                        avatar: Icon(shape.icon, size: 15),
                        label: Text(shape.label),
                        selected: widget.activePrimitiveShape == shape.kind &&
                            widget.activeMode == DrawToolMode.shape,
                        onSelected: (_) {
                          widget.onClose();
                          widget.onSelectPrimitiveShape(shape.kind);
                        },
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    key: const Key('mobile-tools-drop-shape-center'),
                    onPressed: () {
                      unawaited(
                        widget.onDropPrimitiveAtCenter(
                          widget.activePrimitiveShape,
                          _workbenchMeters,
                        ),
                      );
                    },
                    icon: Icon(activeShapeSpec.icon, size: 16),
                    label: Text(
                      'Drop ${activeShapeSpec.label} at Center ($mLabel)',
                    ),
                  ),
                ),

                const Divider(height: 22),

                // 3. Snapping, Placement & Callout Toggles
                _sectionLabel(theme, 'CANVAS & SNAPPING'),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    FilterChip(
                      key: const Key('mobile-tools-snapping-toggle'),
                      avatar: const Icon(Icons.filter_center_focus, size: 15),
                      label: const Text('Magnetic Snap'),
                      selected: widget.snappingEnabled,
                      onSelected: (_) => widget.onToggleSnapping(),
                    ),
                    FilterChip(
                      key: const Key('mobile-tools-edge-snap-toggle'),
                      avatar: const Icon(Icons.linear_scale, size: 15),
                      label: const Text('Snap to Edges'),
                      selected: widget.snapToEdgesEnabled,
                      onSelected: widget.snappingEnabled
                          ? (_) => widget.onToggleSnapToEdges()
                          : null,
                    ),
                    FilterChip(
                      key: const Key('mobile-tools-placement-toggle'),
                      avatar: Icon(
                        widget.placementStyle == TouchPlacementStyle.drawDrag
                            ? Icons.touch_app
                            : Icons.gps_fixed,
                        size: 15,
                      ),
                      label: Text(
                        widget.placementStyle == TouchPlacementStyle.drawDrag
                            ? 'Draw-Drag (-48dp)'
                            : 'Crosshair Reticle',
                      ),
                      selected:
                          widget.placementStyle == TouchPlacementStyle.crosshair,
                      onSelected: (_) => widget.onTogglePlacementStyle(),
                    ),
                    FilterChip(
                      key: const Key('mobile-tools-loupe-toggle'),
                      avatar: const Icon(Icons.zoom_in, size: 15),
                      label: const Text('Magnifier Loupe'),
                      selected: widget.loupeEnabled,
                      onSelected: (_) => widget.onToggleLoupe(),
                    ),
                    ActionChip(
                      key: const Key('mobile-tools-callouts-cycle'),
                      avatar: const Icon(Icons.chat_bubble_outline, size: 15),
                      label: Text(
                        'Callouts: ${calloutModeShortLabel(widget.calloutMode)}',
                      ),
                      onPressed: widget.onCycleCalloutMode,
                    ),
                  ],
                ),

                const Divider(height: 22),

                // 4. History & Selection
                _sectionLabel(theme, 'HISTORY & SELECTION'),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    OutlinedButton.icon(
                      key: const Key('mobile-tools-undo'),
                      onPressed: widget.canUndo ? widget.onUndo : null,
                      icon: const Icon(Icons.undo, size: 15),
                      label: const Text('Undo'),
                    ),
                    OutlinedButton.icon(
                      key: const Key('mobile-tools-redo'),
                      onPressed: widget.canRedo ? widget.onRedo : null,
                      icon: const Icon(Icons.redo, size: 15),
                      label: const Text('Redo'),
                    ),
                    OutlinedButton.icon(
                      key: const Key('mobile-tools-select-all'),
                      onPressed: widget.drawnFeatures.isNotEmpty
                          ? widget.onSelectAll
                          : null,
                      icon: const Icon(Icons.select_all, size: 15),
                      label: Text(
                        'Select All (${widget.drawnFeatures.length})',
                      ),
                    ),
                    if (selectedIds.isNotEmpty)
                      OutlinedButton.icon(
                        key: const Key('mobile-tools-clear-selection'),
                        onPressed: widget.onClearSelection,
                        icon: const Icon(Icons.deselect, size: 15),
                        label: const Text('Clear Sel'),
                      ),
                    OutlinedButton.icon(
                      key: const Key('mobile-tools-duplicate-selected'),
                      onPressed: selectedIds.isNotEmpty
                          ? widget.onDuplicateSelected
                          : null,
                      icon: const Icon(Icons.control_point_duplicate, size: 15),
                      label: Text('Duplicate (${selectedIds.length})'),
                    ),
                    OutlinedButton.icon(
                      key: const Key('mobile-tools-delete-selected'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: selectedIds.isNotEmpty
                            ? EarthlyColors.destructive
                            : null,
                      ),
                      onPressed:
                          selectedIds.isNotEmpty ? widget.onDeleteSelected : null,
                      icon: const Icon(Icons.delete_outline, size: 15),
                      label: Text('Delete (${selectedIds.length})'),
                    ),
                    OutlinedButton.icon(
                      key: const Key('mobile-tools-clear-draft'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: widget.drawnFeatures.isNotEmpty
                            ? EarthlyColors.destructive
                            : null,
                      ),
                      onPressed: widget.drawnFeatures.isNotEmpty
                          ? widget.onClearDraft
                          : null,
                      icon: const Icon(Icons.layers_clear_outlined, size: 15),
                      label: const Text('Clear Draft'),
                    ),
                  ],
                ),

                const Divider(height: 22),

                // 5. Rust Geometry Workbench Ops with meter chips (10m..500m)
                Row(
                  children: [
                    Expanded(
                      child: _sectionLabel(theme, 'GEOMETRY WORKBENCH'),
                    ),
                    Text(
                      selectedIds.isEmpty
                          ? 'Target: Latest'
                          : 'Target: ${selectedIds.length} selected',
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        color: selectedIds.isNotEmpty
                            ? EarthlyColors.amber
                            : theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      const Text(
                        'STEP: ',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                        ),
                      ),
                      for (final m in _meterPresets)
                        Padding(
                          padding: const EdgeInsets.only(right: 5),
                          child: ChoiceChip(
                            key: Key('mobile-tools-meters-${m.round()}'),
                            label: Text('${m.round()}m'),
                            selected: _workbenchMeters == m,
                            onSelected: (_) =>
                                setState(() => _workbenchMeters = m),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    OutlinedButton(
                      key: const Key('mobile-tools-op-simplify-line'),
                      onPressed: hasLine
                          ? () =>
                              _triggerGeoAction(RustGeoAction.simplifyLastLine)
                          : null,
                      child: Text('Simplify Line ($mLabel)'),
                    ),
                    OutlinedButton(
                      key: const Key('mobile-tools-op-corridor'),
                      onPressed: hasLine
                          ? () =>
                              _triggerGeoAction(RustGeoAction.corridorLastLine)
                          : null,
                      child: Text('Corridor ($mLabel)'),
                    ),
                    OutlinedButton(
                      onPressed: hasLine
                          ? () => _triggerGeoAction(RustGeoAction.extrudeBand)
                          : null,
                      child: Text('Tapered Band ($mLabel)'),
                    ),
                    OutlinedButton(
                      onPressed: hasLine
                          ? () => _triggerGeoAction(RustGeoAction.arrowLastLine)
                          : null,
                      child: Text('Flow Arrow ($mLabel)'),
                    ),
                    OutlinedButton(
                      onPressed: hasLine
                          ? () =>
                              _triggerGeoAction(RustGeoAction.offsetLastLine)
                          : null,
                      child: Text('Parallel (+$mLabel)'),
                    ),
                    OutlinedButton(
                      onPressed: hasLine
                          ? () => _triggerGeoAction(
                                RustGeoAction.splitLastLineAtMidpoint,
                              )
                          : null,
                      child: const Text('Split Line (50%)'),
                    ),
                    OutlinedButton(
                      onPressed: lineCount >= 2
                          ? () => _triggerGeoAction(RustGeoAction.connectLines)
                          : null,
                      child: Text('Connect Lines ($lineCount)'),
                    ),
                    OutlinedButton(
                      onPressed: lineCount >= 2
                          ? () => _triggerGeoAction(RustGeoAction.dissolveLines)
                          : null,
                      child: Text('Dissolve Lines ($lineCount)'),
                    ),
                    OutlinedButton(
                      onPressed: polyCount >= 1
                          ? () =>
                              _triggerGeoAction(RustGeoAction.simplifyPolygon)
                          : null,
                      child: Text('Simplify Area ($mLabel)'),
                    ),
                    OutlinedButton(
                      onPressed: polyCount >= 1
                          ? () =>
                              _triggerGeoAction(RustGeoAction.offsetLastPolygon)
                          : null,
                      child: Text('Expand Area (+$mLabel)'),
                    ),
                    OutlinedButton(
                      onPressed: polyCount >= 1
                          ? () => _triggerGeoAction(RustGeoAction.insetPolygon)
                          : null,
                      child: Text('Inset Area (−$mLabel)'),
                    ),
                    OutlinedButton(
                      onPressed: polyCount >= 2
                          ? () =>
                              _triggerGeoAction(RustGeoAction.unionAllPolygons)
                          : null,
                      child: Text('Union Areas ($polyCount)'),
                    ),
                    OutlinedButton(
                      onPressed: polyCount >= 2
                          ? () => _triggerGeoAction(
                                RustGeoAction.differenceLastTwoPolygons,
                              )
                          : null,
                      child: const Text('Difference (A − B)'),
                    ),
                    OutlinedButton(
                      onPressed: (polyCount >= 1 && hasLine)
                          ? () => _triggerGeoAction(
                                RustGeoAction.splitLastPolygonByLine,
                              )
                          : null,
                      child: const Text('Split Area by Line'),
                    ),
                    OutlinedButton(
                      key: const Key('mobile-tools-op-rotate'),
                      onPressed: hasAnyTarget
                          ? () => _triggerGeoAction(
                                RustGeoAction.rotateSelected,
                                angleDeg: 15,
                              )
                          : null,
                      child: const Text('Rotate +15°'),
                    ),
                    OutlinedButton(
                      onPressed: hasAnyTarget
                          ? () => _triggerGeoAction(
                                RustGeoAction.scaleSelected,
                                scale: 1.2,
                              )
                          : null,
                      child: const Text('Scale ×1.2'),
                    ),
                    OutlinedButton(
                      onPressed: canMergeMultipart
                          ? () =>
                              _triggerGeoAction(RustGeoAction.mergeMultipart)
                          : null,
                      child: const Text('Merge Multipart'),
                    ),
                    OutlinedButton(
                      onPressed: hasMultipart
                          ? () =>
                              _triggerGeoAction(RustGeoAction.explodeMultipart)
                          : null,
                      child: const Text('Explode Multipart'),
                    ),
                  ],
                ),

                const Divider(height: 22),

                // 6. Data & Publish
                _sectionLabel(theme, 'DATA & PUBLISH'),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    OutlinedButton.icon(
                      key: const Key('mobile-tools-paste-geojson'),
                      onPressed: () {
                        widget.onClose();
                        widget.onPasteGeoJson();
                      },
                      icon: const Icon(Icons.content_paste, size: 15),
                      label: const Text('Paste GeoJSON'),
                    ),
                    OutlinedButton.icon(
                      key: const Key('mobile-tools-import-geojson'),
                      onPressed: () {
                        widget.onClose();
                        widget.onImportGeoJson();
                      },
                      icon: const Icon(Icons.file_upload_outlined, size: 15),
                      label: const Text('Import File'),
                    ),
                    OutlinedButton.icon(
                      key: const Key('mobile-tools-import-osm'),
                      onPressed: () {
                        widget.onClose();
                        widget.onImportOsm();
                      },
                      icon: const Icon(Icons.public_outlined, size: 15),
                      label: const Text('Import OSM'),
                    ),
                    OutlinedButton.icon(
                      key: const Key('mobile-tools-export-geojson'),
                      onPressed: widget.drawnFeatures.isNotEmpty
                          ? () {
                              widget.onClose();
                              widget.onExportGeoJson();
                            }
                          : null,
                      icon: const Icon(Icons.file_download_outlined, size: 15),
                      label: const Text('Export GeoJSON'),
                    ),
                    FilledButton.icon(
                      key: const Key('mobile-tools-open-desk'),
                      onPressed: () {
                        widget.onClose();
                        widget.onOpenDeskAndPublish();
                      },
                      icon: const Icon(Icons.layers_outlined, size: 15),
                      label: const Text('Open Desk & Publish'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ToolGridTile extends StatelessWidget {
  const _ToolGridTile({
    required this.spec,
    required this.selected,
    required this.isDark,
    required this.onTap,
    super.key,
  });

  final MobileDrawingToolSpec spec;
  final bool selected;
  final bool isDark;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fg = selected
        ? (isDark ? EarthlyColors.amber : EarthlyColors.lightAccent)
        : theme.colorScheme.onSurface;
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            color: selected
                ? EarthlyColors.amber.withValues(alpha: isDark ? 0.18 : 0.16)
                : theme.colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected ? EarthlyColors.amber : theme.dividerColor,
              width: selected ? 1.4 : 1.0,
            ),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(spec.icon, size: 18, color: fg),
              const SizedBox(height: 3),
              Text(
                spec.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
