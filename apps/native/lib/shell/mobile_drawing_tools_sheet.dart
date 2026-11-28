import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../nostr/callout_overlay.dart';
import '../theme/earthly_theme.dart';
import 'desk_sheet.dart';

/// Descriptor for a single authoring tool in [MobileDrawingBar] menus.
class MobileDrawingToolSpec {
  const MobileDrawingToolSpec({
    required this.mode,
    required this.label,
    required this.icon,
    this.menuLabel,
    this.subtitle,
  });

  final DrawToolMode mode;

  /// Concise 1-word label displayed on the compact drawing toolbar button.
  final String label;

  /// Descriptive label shown inside dropdown menus (defaults to [label]).
  final String? menuLabel;

  /// Optional concise hint shown in dropdown menus.
  final String? subtitle;

  final IconData icon;

  String get effectiveMenuLabel => menuLabel ?? label;
}

/// Select & edit tool group shown in the Select button menu.
const List<MobileDrawingToolSpec> mobileSelectTools = <MobileDrawingToolSpec>[
  MobileDrawingToolSpec(
    mode: DrawToolMode.select,
    label: 'Select',
    menuLabel: 'Select',
    subtitle: 'Tap & drag features',
    icon: Icons.near_me_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.editVertices,
    label: 'Edit',
    menuLabel: 'Edit Vertices',
    subtitle: 'Move, add & delete points',
    icon: Icons.edit_location_alt_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.boxSelect,
    label: 'Box',
    menuLabel: 'Box Select',
    subtitle: 'Drag marquee over features',
    icon: Icons.select_all,
  ),
];

/// Primary geometry drawing tools shown in the Draw button menu.
const List<MobileDrawingToolSpec> mobileDrawTools = <MobileDrawingToolSpec>[
  MobileDrawingToolSpec(
    mode: DrawToolMode.point,
    label: 'Point',
    menuLabel: 'Point',
    subtitle: 'Drop single marker',
    icon: Icons.location_on_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.line,
    label: 'Line',
    menuLabel: 'Line',
    subtitle: 'Multi-point path or route',
    icon: Icons.timeline,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.polygon,
    label: 'Area',
    menuLabel: 'Area (Polygon)',
    subtitle: 'Closed region boundary',
    icon: Icons.pentagon_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.freehand,
    label: 'Sketch',
    menuLabel: 'Sketch (Freehand)',
    subtitle: 'Smooth continuous stroke',
    icon: Icons.gesture,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.arrow,
    label: 'Arrow',
    menuLabel: 'Arrow',
    subtitle: 'Directional route vector',
    icon: Icons.north_east,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.annotation,
    label: 'Label',
    menuLabel: 'Label',
    subtitle: 'Pinned map callout note',
    icon: Icons.label_outline,
  ),
];

/// Spatial utility tools shown under "Cut & Measure" in the Shapes & Spatial menu.
const List<MobileDrawingToolSpec> mobileSpatialTools = <MobileDrawingToolSpec>[
  MobileDrawingToolSpec(
    mode: DrawToolMode.splitByLine,
    label: 'Cut',
    menuLabel: 'Cut',
    subtitle: 'Split line or area with cutter',
    icon: Icons.content_cut,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.measure,
    label: 'Measure',
    menuLabel: 'Measure',
    subtitle: 'Distance & area ruler',
    icon: Icons.straighten,
  ),
];

/// Canonical ordered list of all 12 mobile authoring tools.
const List<MobileDrawingToolSpec> mobileAuthoringTools = <MobileDrawingToolSpec>[
  MobileDrawingToolSpec(
    mode: DrawToolMode.select,
    label: 'Select',
    menuLabel: 'Select',
    icon: Icons.near_me_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.editVertices,
    label: 'Edit',
    menuLabel: 'Edit Vertices',
    icon: Icons.edit_location_alt_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.boxSelect,
    label: 'Box',
    menuLabel: 'Box Select',
    icon: Icons.select_all,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.point,
    label: 'Point',
    menuLabel: 'Point',
    icon: Icons.location_on_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.line,
    label: 'Line',
    menuLabel: 'Line',
    icon: Icons.timeline,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.freehand,
    label: 'Sketch',
    menuLabel: 'Sketch (Freehand)',
    icon: Icons.gesture,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.polygon,
    label: 'Area',
    menuLabel: 'Area (Polygon)',
    icon: Icons.pentagon_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.arrow,
    label: 'Arrow',
    menuLabel: 'Arrow',
    icon: Icons.north_east,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.shape,
    label: 'Shape',
    menuLabel: 'Shape',
    icon: Icons.category_outlined,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.annotation,
    label: 'Label',
    menuLabel: 'Label',
    icon: Icons.label_outline,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.splitByLine,
    label: 'Cut',
    menuLabel: 'Cut',
    icon: Icons.content_cut,
  ),
  MobileDrawingToolSpec(
    mode: DrawToolMode.measure,
    label: 'Measure',
    menuLabel: 'Measure',
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

/// Canonical 6 primitive shape presets shared across [MobileDrawingBar] and
/// the floating shape bar.
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

/// Looks up the [MobileDrawingToolSpec] for [mode], or `null` for [DrawToolMode.browse].
MobileDrawingToolSpec? drawingToolSpecForMode(DrawToolMode mode) {
  for (final spec in mobileSelectTools) {
    if (spec.mode == mode) return spec;
  }
  for (final spec in mobileDrawTools) {
    if (spec.mode == mode) return spec;
  }
  for (final spec in mobileSpatialTools) {
    if (spec.mode == mode) return spec;
  }
  for (final spec in mobileAuthoringTools) {
    if (spec.mode == mode) return spec;
  }
  return null;
}

/// Looks up the [PrimitiveShapeSpec] for [kind].
PrimitiveShapeSpec primitiveShapeSpecForKind(PrimitiveShapeKind kind) {
  for (final spec in mobilePrimitiveShapes) {
    if (spec.kind == kind) return spec;
  }
  return mobilePrimitiveShapes.first;
}

/// Compact, focused Canvas Options bottom sheet opened from the Options (`tune`)
/// button on [MobileDrawingBar].
///
/// Contains ONLY canvas settings (Magnetic Snap, Snap to Edges, Draw-Drag offset,
/// Magnifier Loupe, Callouts mode) and History (Undo / Redo) — never mixing
/// drawing tools, primitive shapes, workbench spatial ops, or data actions.
class MobileDrawingOptionsSheet extends StatelessWidget {
  const MobileDrawingOptionsSheet({
    required this.placementStyle,
    required this.loupeEnabled,
    required this.snappingEnabled,
    required this.snapToEdgesEnabled,
    required this.calloutMode,
    required this.canUndo,
    required this.canRedo,
    required this.onToggleSnapping,
    required this.onToggleSnapToEdges,
    required this.onTogglePlacementStyle,
    required this.onToggleLoupe,
    required this.onCycleCalloutMode,
    required this.onUndo,
    required this.onRedo,
    required this.onClose,
    super.key,
  });

  final TouchPlacementStyle placementStyle;
  final bool loupeEnabled;
  final bool snappingEnabled;
  final bool snapToEdgesEnabled;
  final CalloutDisplayMode calloutMode;
  final bool canUndo;
  final bool canRedo;

  final VoidCallback onToggleSnapping;
  final VoidCallback onToggleSnapToEdges;
  final VoidCallback onTogglePlacementStyle;
  final VoidCallback onToggleLoupe;
  final VoidCallback onCycleCalloutMode;
  final VoidCallback onUndo;
  final VoidCallback onRedo;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDrawDrag = placementStyle == TouchPlacementStyle.drawDrag;
    final cardBg =
        theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.72);

    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 8),
          Container(
            width: 36,
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
                  Icons.tune,
                  size: 18,
                  color: EarthlyColors.amber,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'CANVAS OPTIONS',
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontFamily: 'monospace',
                      letterSpacing: 0.7,
                    ),
                  ),
                ),
                IconButton(
                  key: const Key('mobile-options-close'),
                  tooltip: 'Close canvas options',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(
                    minWidth: 34,
                    minHeight: 34,
                  ),
                  padding: EdgeInsets.zero,
                  onPressed: onClose,
                  icon: const Icon(Icons.close, size: 19),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // 1. History: unified single-row 2-segment Undo | Redo bar
                  Text(
                    'HISTORY',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Material(
                    color: cardBg,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: BorderSide(color: theme.dividerColor),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(
                            child: _HistorySegmentButton(
                              key: const Key('mobile-options-undo'),
                              icon: Icons.undo,
                              label: 'Undo',
                              onTap: canUndo ? onUndo : null,
                            ),
                          ),
                          VerticalDivider(width: 1, color: theme.dividerColor),
                          Expanded(
                            child: _HistorySegmentButton(
                              key: const Key('mobile-options-redo'),
                              icon: Icons.redo,
                              label: 'Redo',
                              onTap: canRedo ? onRedo : null,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),

                  // 2. Canvas & Snapping toggles in one crisp bordered card
                  Text(
                    'CANVAS & SNAPPING',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Material(
                    color: cardBg,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: BorderSide(color: theme.dividerColor),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _OptionsSwitchRow(
                          key: const Key('mobile-options-snapping-toggle'),
                          icon: Icons.filter_center_focus,
                          title: 'Magnetic Snap',
                          subtitle: 'Snap to draft & shelf vertices',
                          value: snappingEnabled,
                          onChanged: (_) => onToggleSnapping(),
                        ),
                        Divider(height: 1, color: theme.dividerColor),
                        _OptionsSwitchRow(
                          key: const Key('mobile-options-edge-snap-toggle'),
                          icon: Icons.linear_scale,
                          title: 'Snap to Edges',
                          subtitle: 'Snap along lines & polygon borders',
                          value: snapToEdgesEnabled,
                          enabled: snappingEnabled,
                          onChanged:
                              snappingEnabled ? (_) => onToggleSnapToEdges() : null,
                        ),
                        Divider(height: 1, color: theme.dividerColor),
                        _OptionsActionRow(
                          key: const Key('mobile-options-placement-toggle'),
                          icon: isDrawDrag ? Icons.touch_app : Icons.gps_fixed,
                          title: 'Touch Placement',
                          subtitle: isDrawDrag
                              ? 'Draw-Drag (-48dp thumb offset)'
                              : 'Crosshair center reticle',
                          badgeLabel: isDrawDrag ? 'Draw-Drag' : 'Crosshair',
                          highlighted: true,
                          onTap: onTogglePlacementStyle,
                        ),
                        Divider(height: 1, color: theme.dividerColor),
                        _OptionsSwitchRow(
                          key: const Key('mobile-options-loupe-toggle'),
                          icon: Icons.zoom_in,
                          title: 'Magnifier Loupe',
                          subtitle: '2.2× lens above thumb while dragging',
                          value: loupeEnabled,
                          onChanged: (_) => onToggleLoupe(),
                        ),
                        Divider(height: 1, color: theme.dividerColor),
                        _OptionsActionRow(
                          key: const Key('mobile-options-callouts-cycle'),
                          icon: Icons.chat_bubble_outline,
                          title: 'Callouts',
                          subtitle: 'Tap to cycle map label density',
                          badgeLabel: switch (calloutMode) {
                            CalloutDisplayMode.full => 'Full',
                            CalloutDisplayMode.compact => 'Compact',
                            CalloutDisplayMode.pins => 'Pins',
                            CalloutDisplayMode.hidden => 'Hidden',
                          },
                          highlighted: calloutMode != CalloutDisplayMode.hidden,
                          onTap: onCycleCalloutMode,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _HistorySegmentButton extends StatelessWidget {
  const _HistorySegmentButton({
    required this.icon,
    required this.label,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final enabled = onTap != null;
    final fg = enabled
        ? theme.colorScheme.onSurface
        : theme.colorScheme.onSurface.withValues(alpha: 0.36);

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 17, color: fg),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: fg,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OptionsSwitchRow extends StatelessWidget {
  const _OptionsSwitchRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
    this.enabled = true,
    super.key,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final bool enabled;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fg = enabled
        ? theme.colorScheme.onSurface
        : theme.colorScheme.onSurface.withValues(alpha: 0.38);

    return InkWell(
      onTap: enabled && onChanged != null ? () => onChanged!(!value) : null,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
        child: Row(
          children: [
            Icon(
              icon,
              size: 18,
              color: enabled && value ? EarthlyColors.amber : fg,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: fg,
                    ),
                  ),
                  Text(
                    subtitle,
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 11,
                      color: enabled
                          ? theme.colorScheme.onSurfaceVariant
                          : theme.colorScheme.onSurface.withValues(alpha: 0.32),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Switch(
              value: value,
              onChanged: enabled ? onChanged : null,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ],
        ),
      ),
    );
  }
}

class _OptionsActionRow extends StatelessWidget {
  const _OptionsActionRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.badgeLabel,
    required this.highlighted,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String badgeLabel;
  final bool highlighted;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final accentFg = isDark ? EarthlyColors.amber : EarthlyColors.lightAccent;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
        child: Row(
          children: [
            Icon(
              icon,
              size: 18,
              color: highlighted ? EarthlyColors.amber : theme.colorScheme.onSurface,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    subtitle,
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(fontSize: 11),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
              decoration: BoxDecoration(
                color: highlighted
                    ? EarthlyColors.amber.withValues(alpha: isDark ? 0.18 : 0.16)
                    : theme.colorScheme.surface,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: highlighted ? EarthlyColors.amber : theme.dividerColor,
                ),
              ),
              child: Text(
                badgeLabel,
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  color: highlighted ? accentFg : theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Focused canvas options sheet kept API-compatible with legacy callers while
/// removing the old catch-all drawer of tools, shapes, workbench ops, and data
/// actions. New code should mount [MobileDrawingBar] and
/// [MobileDrawingOptionsSheet] directly.
class MobileDrawingToolsSheet extends StatelessWidget {
  const MobileDrawingToolsSheet({
    required this.placementStyle,
    required this.loupeEnabled,
    required this.snappingEnabled,
    required this.snapToEdgesEnabled,
    required this.calloutMode,
    required this.canUndo,
    required this.canRedo,
    required this.onToggleSnapping,
    required this.onToggleSnapToEdges,
    required this.onTogglePlacementStyle,
    required this.onToggleLoupe,
    required this.onCycleCalloutMode,
    required this.onUndo,
    required this.onRedo,
    required this.onClose,
    this.activeMode = DrawToolMode.line,
    this.activePrimitiveShape = PrimitiveShapeKind.circle,
    this.drawnFeatures = const <DrawnFeature>[],
    this.selectedFeatureIds = const <String>{},
    this.onSelectTool,
    this.onSelectPrimitiveShape,
    this.onDropPrimitiveAtCenter,
    this.onSelectAll,
    this.onClearSelection,
    this.onDuplicateSelected,
    this.onDeleteSelected,
    this.onClearDraft,
    this.onRunGeoAction,
    this.onPasteGeoJson,
    this.onImportGeoJson,
    this.onImportOsm,
    this.onExportGeoJson,
    this.onOpenDeskAndPublish,
    this.onExitDrawingMode,
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

  final ValueChanged<DrawToolMode>? onSelectTool;
  final ValueChanged<PrimitiveShapeKind>? onSelectPrimitiveShape;
  final Future<void> Function(PrimitiveShapeKind shape, double radiusMeters)?
      onDropPrimitiveAtCenter;
  final VoidCallback onToggleSnapping;
  final VoidCallback onToggleSnapToEdges;
  final VoidCallback onTogglePlacementStyle;
  final VoidCallback onToggleLoupe;
  final VoidCallback onCycleCalloutMode;
  final VoidCallback onUndo;
  final VoidCallback onRedo;
  final VoidCallback? onSelectAll;
  final VoidCallback? onClearSelection;
  final VoidCallback? onDuplicateSelected;
  final VoidCallback? onDeleteSelected;
  final VoidCallback? onClearDraft;
  final void Function(
    RustGeoAction action, {
    double? meters,
    double? angleDeg,
    double? scale,
  })? onRunGeoAction;
  final VoidCallback? onPasteGeoJson;
  final VoidCallback? onImportGeoJson;
  final VoidCallback? onImportOsm;
  final VoidCallback? onExportGeoJson;
  final VoidCallback? onOpenDeskAndPublish;
  final VoidCallback? onExitDrawingMode;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return MobileDrawingOptionsSheet(
      placementStyle: placementStyle,
      loupeEnabled: loupeEnabled,
      snappingEnabled: snappingEnabled,
      snapToEdgesEnabled: snapToEdgesEnabled,
      calloutMode: calloutMode,
      canUndo: canUndo,
      canRedo: canRedo,
      onToggleSnapping: onToggleSnapping,
      onToggleSnapToEdges: onToggleSnapToEdges,
      onTogglePlacementStyle: onTogglePlacementStyle,
      onToggleLoupe: onToggleLoupe,
      onCycleCalloutMode: onCycleCalloutMode,
      onUndo: onUndo,
      onRedo: onRedo,
      onClose: onClose,
    );
  }
}
