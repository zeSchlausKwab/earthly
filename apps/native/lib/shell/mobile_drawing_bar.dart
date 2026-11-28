import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/scheduler.dart';
import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../nostr/callout_overlay.dart';
import '../theme/earthly_theme.dart';
import 'mobile_drawing_tools_sheet.dart';

enum _ShapesSpatialActionKind { shape, dropCenter, tool }

class _ShapesSpatialChoice {
  const _ShapesSpatialChoice.shape(this.shape)
      : kind = _ShapesSpatialActionKind.shape,
        tool = null;

  const _ShapesSpatialChoice.dropCenter()
      : kind = _ShapesSpatialActionKind.dropCenter,
        shape = null,
        tool = null;

  const _ShapesSpatialChoice.tool(this.tool)
      : kind = _ShapesSpatialActionKind.tool,
        shape = null;

  final _ShapesSpatialActionKind kind;
  final PrimitiveShapeKind? shape;
  final DrawToolMode? tool;
}

/// Contextual, non-wrapping Drawing Toolbar with grouped button menus:
/// - **Select** menu (`Select`, `Edit Vertices`, `Box Select`)
/// - **Draw** menu (`Point`, `Line`, `Area (Polygon)`, `Sketch (Freehand)`, `Arrow`, `Label`)
/// - **Shapes & Spatial** menu (sectioned into `"Shapes"` + `"Cut & Measure"`)
/// - **Desk** toggle button (with draft feature count badge + active state while Desk is open)
/// - **Options** button (focused canvas settings + Undo/Redo sheet)
/// - **Done** button (exits Drawing Mode)
///
/// When an active multi-point stroke is in progress (`hasActiveStroke`), swaps
/// smoothly into a compact contextual stroke bar (`Finish · N` / `Cut · N` /
/// `Save · N`, `Undo pt`, `Cancel`, plus Desk & Options) with zero wrapping or
/// overflow on `360dp`–`412dp` phones.
///
/// Set [isDockedAboveDesk] to `true` when mounting directly on top of
/// [DeskSheet] (staying inside Drawing Mode while inspecting geometry).
class MobileDrawingBar extends StatefulWidget {
  const MobileDrawingBar({
    required this.activeMode,
    required this.activePrimitiveShape,
    required this.placementStyle,
    required this.loupeEnabled,
    required this.snappingEnabled,
    required this.snapToEdgesEnabled,
    required this.calloutMode,
    required this.draftFeatureCount,
    required this.isDeskOpen,
    required this.canUndo,
    required this.canRedo,
    required this.onSelectTool,
    required this.onSelectPrimitiveShape,
    required this.onDropPrimitiveAtCenter,
    required this.onToggleDesk,
    required this.onToggleSnapping,
    required this.onToggleSnapToEdges,
    required this.onTogglePlacementStyle,
    required this.onToggleLoupe,
    required this.onCycleCalloutMode,
    required this.onUndo,
    required this.onRedo,
    required this.onExitDrawingMode,
    this.hasActiveStroke = false,
    this.draftVertexCount = 0,
    this.canFinishStroke = false,
    this.isEditingExistingFeature = false,
    this.onFinishStroke,
    this.onUndoPoint,
    this.onCancelStroke,
    this.onDropCrosshairPoint,
    this.isDockedAboveDesk = false,
    this.optionsListenable,
    this.onOpenOptions,
    super.key,
  });

  final DrawToolMode activeMode;
  final PrimitiveShapeKind activePrimitiveShape;
  final TouchPlacementStyle placementStyle;
  final bool loupeEnabled;
  final bool snappingEnabled;
  final bool snapToEdgesEnabled;
  final CalloutDisplayMode calloutMode;
  final int draftFeatureCount;
  final bool isDeskOpen;
  final bool canUndo;
  final bool canRedo;

  final ValueChanged<DrawToolMode> onSelectTool;
  final ValueChanged<PrimitiveShapeKind> onSelectPrimitiveShape;
  final Future<void> Function(PrimitiveShapeKind shape, double radiusMeters)
      onDropPrimitiveAtCenter;
  final VoidCallback onToggleDesk;
  final VoidCallback onToggleSnapping;
  final VoidCallback onToggleSnapToEdges;
  final VoidCallback onTogglePlacementStyle;
  final VoidCallback onToggleLoupe;
  final VoidCallback onCycleCalloutMode;
  final VoidCallback onUndo;
  final VoidCallback onRedo;
  final VoidCallback onExitDrawingMode;

  /// Whether a multi-point stroke (line/polygon/arrow/cut/measure) or vertex
  /// re-draft is actively in progress.
  final bool hasActiveStroke;
  final int draftVertexCount;
  final bool canFinishStroke;
  final bool isEditingExistingFeature;
  final VoidCallback? onFinishStroke;
  final VoidCallback? onUndoPoint;
  final VoidCallback? onCancelStroke;
  final VoidCallback? onDropCrosshairPoint;

  /// When `true`, omits bottom [SafeArea] padding and outer frosted bottom-dock
  /// chrome because the bar sits docked flush above [DeskSheet].
  final bool isDockedAboveDesk;

  /// Optional external [Listenable] merged into the default Canvas Options
  /// modal sheet so toggles repaint on the exact same frame when mutated.
  final Listenable? optionsListenable;

  /// Optional override for opening Canvas Options; defaults to presenting
  /// [MobileDrawingOptionsSheet].
  final VoidCallback? onOpenOptions;

  @override
  State<MobileDrawingBar> createState() => _MobileDrawingBarState();
}

class _MobileDrawingBarState extends State<MobileDrawingBar> {
  final ValueNotifier<int> _optionsSheetRevision = ValueNotifier<int>(0);
  DrawToolMode _lastSelectMode = DrawToolMode.select;
  DrawToolMode _lastDrawMode = DrawToolMode.line;

  bool get _hasActiveStroke =>
      widget.hasActiveStroke ||
      widget.draftVertexCount > 0 ||
      widget.isEditingExistingFeature;

  bool get _showCrosshairDrop =>
      widget.placementStyle == TouchPlacementStyle.crosshair &&
      widget.activeMode.supportsCrosshairDrop &&
      widget.onDropCrosshairPoint != null;

  @override
  void initState() {
    super.initState();
    _recordActiveMode(widget.activeMode);
  }

  @override
  void didUpdateWidget(covariant MobileDrawingBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    _recordActiveMode(widget.activeMode);
    if (oldWidget.placementStyle != widget.placementStyle ||
        oldWidget.loupeEnabled != widget.loupeEnabled ||
        oldWidget.snappingEnabled != widget.snappingEnabled ||
        oldWidget.snapToEdgesEnabled != widget.snapToEdgesEnabled ||
        oldWidget.calloutMode != widget.calloutMode ||
        oldWidget.canUndo != widget.canUndo ||
        oldWidget.canRedo != widget.canRedo) {
      SchedulerBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _optionsSheetRevision.value += 1;
        }
      });
    }
  }

  @override
  void dispose() {
    _optionsSheetRevision.dispose();
    super.dispose();
  }

  void _recordActiveMode(DrawToolMode mode) {
    switch (mode.toolGroup) {
      case DrawToolGroup.select:
        _lastSelectMode = mode;
      case DrawToolGroup.draw:
        _lastDrawMode = mode;
      case DrawToolGroup.shapesSpatial:
      case null:
        break;
    }
  }

  void _handleSelectToolFromMenu(DrawToolMode mode) {
    _recordActiveMode(mode);
    if (mode != widget.activeMode) {
      widget.onSelectTool(mode);
    }
  }

  void _openOptionsSheet() {
    if (widget.onOpenOptions != null) {
      widget.onOpenOptions!();
      return;
    }
    final merged = widget.optionsListenable != null
        ? Listenable.merge([_optionsSheetRevision, widget.optionsListenable!])
        : _optionsSheetRevision;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetCtx) => ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(sheetCtx).height * 0.72,
        ),
        child: ListenableBuilder(
          listenable: merged,
          builder: (ctx, _) => MobileDrawingOptionsSheet(
            placementStyle: widget.placementStyle,
            loupeEnabled: widget.loupeEnabled,
            snappingEnabled: widget.snappingEnabled,
            snapToEdgesEnabled: widget.snapToEdgesEnabled,
            calloutMode: widget.calloutMode,
            canUndo: widget.canUndo,
            canRedo: widget.canRedo,
            onToggleSnapping: widget.onToggleSnapping,
            onToggleSnapToEdges: widget.onToggleSnapToEdges,
            onTogglePlacementStyle: widget.onTogglePlacementStyle,
            onToggleLoupe: widget.onToggleLoupe,
            onCycleCalloutMode: widget.onCycleCalloutMode,
            onUndo: widget.onUndo,
            onRedo: widget.onRedo,
            onClose: () => Navigator.of(sheetCtx).pop(),
          ),
        ),
      ),
    );
  }

  String _finishStrokeLabel() {
    final count = widget.draftVertexCount;
    if (widget.activeMode == DrawToolMode.splitByLine) {
      return 'Cut · $count';
    }
    if (widget.isEditingExistingFeature) {
      return 'Save · $count';
    }
    return 'Finish · $count';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    final content = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_showCrosshairDrop) _buildCrosshairStrip(theme, isDark),
        Padding(
          padding: EdgeInsets.fromLTRB(
            6,
            widget.isDockedAboveDesk ? 5 : 6,
            6,
            widget.isDockedAboveDesk ? 5 : 6,
          ),
          child: _hasActiveStroke
              ? _buildStrokeBar(theme, isDark)
              : _buildGroupedToolbar(theme, isDark),
        ),
      ],
    );

    if (widget.isDockedAboveDesk) {
      return Material(
        key: const Key('mobile-drawing-bar-surface'),
        type: MaterialType.transparency,
        child: content,
      );
    }

    return ClipRect(
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: Material(
          key: const Key('mobile-drawing-bar-surface'),
          color: theme.colorScheme.surface.withValues(
            alpha: isDark ? 0.92 : 0.95,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(
                  color: isDark
                      ? Colors.white.withValues(alpha: 0.12)
                      : Colors.black.withValues(alpha: 0.08),
                ),
              ),
            ),
            child: SafeArea(
              top: false,
              child: content,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCrosshairStrip(ThemeData theme, bool isDark) {
    return Container(
      key: const Key('mobile-draw-crosshair-strip'),
      padding: const EdgeInsets.fromLTRB(10, 5, 8, 5),
      decoration: BoxDecoration(
        color: EarthlyColors.amber.withValues(alpha: isDark ? 0.12 : 0.10),
        border: Border(
          bottom: BorderSide(
            color: EarthlyColors.amber.withValues(alpha: 0.30),
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.gps_fixed,
            size: 14,
            color: isDark ? EarthlyColors.amber : EarthlyColors.lightAccent,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Crosshair reticle active',
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                color: isDark ? EarthlyColors.amber : EarthlyColors.lightAccent,
              ),
            ),
          ),
          const SizedBox(width: 6),
          FilledButton.icon(
            key: const Key('mobile-draw-crosshair-drop'),
            style: FilledButton.styleFrom(
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              minimumSize: const Size(0, 30),
              textStyle: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            onPressed: widget.onDropCrosshairPoint,
            icon: const Icon(Icons.add_location_alt, size: 14),
            label: const Text(
              'Drop',
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildGroupedToolbar(ThemeData theme, bool isDark) {
    final activeGroup = widget.activeMode.toolGroup;
    final selectSpec = drawingToolSpecForMode(
          activeGroup == DrawToolGroup.select
              ? widget.activeMode
              : _lastSelectMode,
        ) ??
        mobileSelectTools.first;
    final drawSpec = drawingToolSpecForMode(
          activeGroup == DrawToolGroup.draw ? widget.activeMode : _lastDrawMode,
        ) ??
        mobileDrawTools[1];
    final activeShapeSpec =
        primitiveShapeSpecForKind(widget.activePrimitiveShape);

    final (IconData spatialIcon, String spatialLabel, Color? spatialAccent) =
        switch (widget.activeMode) {
      DrawToolMode.splitByLine => (Icons.content_cut, 'Cut', null),
      DrawToolMode.measure => (
          Icons.straighten,
          'Measure',
          EarthlyColors.measureViolet,
        ),
      DrawToolMode.shape => (activeShapeSpec.icon, activeShapeSpec.label, null),
      _ => (Icons.category_outlined, 'Shapes', null),
    };

    return Row(
      key: const Key('mobile-drawing-bar'),
      children: [
        // 1. Select Menu Button
        Expanded(
          flex: 10,
          child: PopupMenuButton<DrawToolMode>(
            key: const Key('mobile-draw-menu-select'),
            tooltip: 'Select & Edit tools',
            position: PopupMenuPosition.over,
            onSelected: _handleSelectToolFromMenu,
            itemBuilder: (ctx) => <PopupMenuEntry<DrawToolMode>>[
              const _MenuSectionHeader(title: 'SELECT & EDIT'),
              for (final spec in mobileSelectTools)
                _buildToolMenuItem(
                  ctx,
                  key: Key('mobile-draw-item-${spec.mode.name}'),
                  value: spec.mode,
                  icon: spec.icon,
                  label: spec.effectiveMenuLabel,
                  subtitle: spec.subtitle,
                  selected: widget.activeMode == spec.mode,
                ),
            ],
            child: _ToolbarMenuFace(
              icon: selectSpec.icon,
              label: selectSpec.label,
              active: activeGroup == DrawToolGroup.select,
              showCaret: true,
              isDark: isDark,
            ),
          ),
        ),
        const SizedBox(width: 3),

        // 2. Draw Menu Button
        Expanded(
          flex: 10,
          child: PopupMenuButton<DrawToolMode>(
            key: const Key('mobile-draw-menu-draw'),
            tooltip: 'Drawing tools',
            position: PopupMenuPosition.over,
            onSelected: _handleSelectToolFromMenu,
            itemBuilder: (ctx) => <PopupMenuEntry<DrawToolMode>>[
              const _MenuSectionHeader(title: 'DRAW'),
              for (final spec in mobileDrawTools)
                _buildToolMenuItem(
                  ctx,
                  key: Key('mobile-draw-item-${spec.mode.name}'),
                  value: spec.mode,
                  icon: spec.icon,
                  label: spec.effectiveMenuLabel,
                  subtitle: spec.subtitle,
                  selected: widget.activeMode == spec.mode,
                ),
            ],
            child: _ToolbarMenuFace(
              icon: drawSpec.icon,
              label: drawSpec.label,
              active: activeGroup == DrawToolGroup.draw,
              showCaret: true,
              isDark: isDark,
            ),
          ),
        ),
        const SizedBox(width: 3),

        // 3. Shapes & Spatial Menu Button (sectioned into "Shapes" & "Cut & Measure")
        Expanded(
          flex: 11,
          child: PopupMenuButton<_ShapesSpatialChoice>(
            key: const Key('mobile-draw-menu-shapes'),
            tooltip: 'Shapes, Cut & Measure',
            position: PopupMenuPosition.over,
            onSelected: (choice) {
              switch (choice.kind) {
                case _ShapesSpatialActionKind.shape:
                  widget.onSelectPrimitiveShape(choice.shape!);
                case _ShapesSpatialActionKind.dropCenter:
                  unawaited(
                    widget.onDropPrimitiveAtCenter(
                      widget.activePrimitiveShape,
                      100.0,
                    ),
                  );
                case _ShapesSpatialActionKind.tool:
                  _handleSelectToolFromMenu(choice.tool!);
              }
            },
            itemBuilder: (ctx) => <PopupMenuEntry<_ShapesSpatialChoice>>[
              const _MenuSectionHeader(title: 'Shapes'),
              for (final shape in mobilePrimitiveShapes)
                _buildToolMenuItem(
                  ctx,
                  key: Key('mobile-draw-shape-${shape.kind.name}'),
                  value: _ShapesSpatialChoice.shape(shape.kind),
                  icon: shape.icon,
                  label: shape.label,
                  selected: widget.activeMode == DrawToolMode.shape &&
                      widget.activePrimitiveShape == shape.kind,
                ),
              _buildToolMenuItem(
                ctx,
                key: const Key('mobile-draw-drop-shape-center'),
                value: const _ShapesSpatialChoice.dropCenter(),
                icon: Icons.add_circle_outline,
                label: 'Drop 100m ${activeShapeSpec.label} at Center',
                selected: false,
                accentColor:
                    isDark ? EarthlyColors.amber : EarthlyColors.lightAccent,
              ),
              const PopupMenuDivider(height: 8),
              const _MenuSectionHeader(title: 'Cut & Measure'),
              for (final spec in mobileSpatialTools)
                _buildToolMenuItem(
                  ctx,
                  key: Key('mobile-draw-item-${spec.mode.name}'),
                  value: _ShapesSpatialChoice.tool(spec.mode),
                  icon: spec.icon,
                  label: spec.effectiveMenuLabel,
                  subtitle: spec.subtitle,
                  selected: widget.activeMode == spec.mode,
                ),
            ],
            child: _ToolbarMenuFace(
              icon: spatialIcon,
              label: spatialLabel,
              active: activeGroup == DrawToolGroup.shapesSpatial,
              activeAccent: spatialAccent,
              showCaret: true,
              isDark: isDark,
            ),
          ),
        ),
        const SizedBox(width: 3),

        // 4. Desk Toggle Button (with compact draft feature count badge)
        Expanded(
          flex: 10,
          child: _ToolbarActionButton(
            key: const Key('mobile-draw-desk-toggle'),
            tooltip: widget.isDeskOpen ? 'Hide Desk' : 'Inspect draft in Desk',
            onTap: widget.onToggleDesk,
            child: _ToolbarMenuFace(
              icon: widget.isDeskOpen ? Icons.layers : Icons.layers_outlined,
              label: 'Desk',
              active: widget.isDeskOpen,
              badgeCount: widget.draftFeatureCount,
              showCaret: false,
              isDark: isDark,
            ),
          ),
        ),
        const SizedBox(width: 3),

        // 5. Canvas Options Button (tune/sliders icon)
        Expanded(
          flex: 10,
          child: _ToolbarActionButton(
            key: const Key('mobile-draw-options-btn'),
            tooltip: 'Canvas Options & Undo/Redo',
            onTap: _openOptionsSheet,
            child: _ToolbarMenuFace(
              icon: Icons.tune,
              label: 'Options',
              active: false,
              showCaret: false,
              isDark: isDark,
            ),
          ),
        ),
        const SizedBox(width: 4),

        // 6. Done Button (exit Drawing Mode)
        OutlinedButton(
          key: const Key('mobile-draw-done-btn'),
          style: OutlinedButton.styleFrom(
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
            minimumSize: const Size(48, 42),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(11),
            ),
            textStyle: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          onPressed: widget.onExitDrawingMode,
          child: const Text(
            'Done',
            maxLines: 1,
            softWrap: false,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  Widget _buildStrokeBar(ThemeData theme, bool isDark) {
    final isMeasure = widget.activeMode == DrawToolMode.measure;

    return Row(
      key: const Key('mobile-drawing-stroke-bar'),
      children: [
        if (isMeasure)
          Flexible(
            flex: 3,
            child: Container(
              key: const Key('mobile-draw-measure-status'),
              height: 38,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(
                color: EarthlyColors.measureViolet.withValues(alpha: 0.16),
                borderRadius: BorderRadius.circular(11),
                border: Border.all(
                  color: EarthlyColors.measureViolet.withValues(alpha: 0.55),
                ),
              ),
              alignment: Alignment.center,
              child: Text(
                'Measure · ${widget.draftVertexCount}',
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                  color: EarthlyColors.measureViolet,
                ),
              ),
            ),
          )
        else
          Expanded(
            flex: 12,
            child: FilledButton(
              key: const Key('mobile-draw-finish-stroke'),
              style: FilledButton.styleFrom(
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
                minimumSize: const Size(0, 38),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(11),
                ),
                textStyle: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              onPressed: widget.canFinishStroke ? widget.onFinishStroke : null,
              child: Text(
                _finishStrokeLabel(),
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
        const SizedBox(width: 5),
        Expanded(
          flex: 10,
          child: OutlinedButton.icon(
            key: const Key('mobile-draw-undo-pt'),
            style: OutlinedButton.styleFrom(
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 0),
              minimumSize: const Size(0, 38),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(11),
              ),
              textStyle: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            onPressed: widget.onUndoPoint ?? widget.onUndo,
            icon: const Icon(Icons.undo, size: 14),
            label: const Text(
              'Undo pt',
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
        const SizedBox(width: 5),
        Expanded(
          flex: 8,
          child: OutlinedButton(
            key: const Key('mobile-draw-cancel-stroke'),
            style: OutlinedButton.styleFrom(
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 0),
              minimumSize: const Size(0, 38),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(11),
              ),
              textStyle: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            onPressed: widget.onCancelStroke ?? widget.onExitDrawingMode,
            child: const Text(
              'Cancel',
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
        const SizedBox(width: 5),
        _CompactStrokeIconButton(
          key: const Key('mobile-draw-desk-toggle'),
          tooltip: widget.isDeskOpen ? 'Hide Desk' : 'Inspect draft in Desk',
          icon: widget.isDeskOpen ? Icons.layers : Icons.layers_outlined,
          active: widget.isDeskOpen,
          badgeCount: widget.draftFeatureCount,
          isDark: isDark,
          onTap: widget.onToggleDesk,
        ),
        const SizedBox(width: 4),
        _CompactStrokeIconButton(
          key: const Key('mobile-draw-options-btn'),
          tooltip: 'Canvas Options & Undo/Redo',
          icon: Icons.tune,
          active: false,
          isDark: isDark,
          onTap: _openOptionsSheet,
        ),
      ],
    );
  }

  PopupMenuItem<T> _buildToolMenuItem<T>(
    BuildContext context, {
    required Key key,
    required T value,
    required IconData icon,
    required String label,
    required bool selected,
    String? subtitle,
    Color? accentColor,
  }) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final activeFg =
        accentColor ?? (isDark ? EarthlyColors.amber : EarthlyColors.lightAccent);
    final fg = selected || accentColor != null
        ? activeFg
        : theme.colorScheme.onSurface;

    return PopupMenuItem<T>(
      key: key,
      value: value,
      height: subtitle != null ? 42 : 36,
      child: Row(
        children: [
          Icon(icon, size: 18, color: fg),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  softWrap: false,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                    color: fg,
                  ),
                ),
                if (subtitle != null)
                  Text(
                    subtitle,
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5),
                  ),
              ],
            ),
          ),
          if (selected) ...[
            const SizedBox(width: 8),
            Icon(Icons.check, size: 16, color: activeFg),
          ],
        ],
      ),
    );
  }
}

class _MenuSectionHeader<T> extends PopupMenuEntry<T> {
  const _MenuSectionHeader({required this.title});

  final String title;

  @override
  double get height => 26;

  @override
  bool represents(T? value) => false;

  @override
  State<_MenuSectionHeader<T>> createState() => _MenuSectionHeaderState<T>();
}

class _MenuSectionHeaderState<T> extends State<_MenuSectionHeader<T>> {
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 6, 14, 2),
      child: Text(
        widget.title.toUpperCase(),
        maxLines: 1,
        softWrap: false,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.labelSmall?.copyWith(
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.8,
        ),
      ),
    );
  }
}

class _ToolbarActionButton extends StatelessWidget {
  const _ToolbarActionButton({
    required this.tooltip,
    required this.onTap,
    required this.child,
    super.key,
  });

  final String tooltip;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(11),
          onTap: onTap,
          child: child,
        ),
      ),
    );
  }
}

class _ToolbarMenuFace extends StatelessWidget {
  const _ToolbarMenuFace({
    required this.icon,
    required this.label,
    required this.active,
    required this.showCaret,
    required this.isDark,
    this.activeAccent,
    this.badgeCount = 0,
  });

  final IconData icon;
  final String label;
  final bool active;
  final bool showCaret;
  final bool isDark;
  final Color? activeAccent;
  final int badgeCount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accent = activeAccent ?? EarthlyColors.amber;
    final activeFg = activeAccent ??
        (isDark ? EarthlyColors.amber : EarthlyColors.lightAccent);
    final fg = active ? activeFg : theme.colorScheme.onSurface;

    return Container(
      height: 42,
      padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 3),
      decoration: BoxDecoration(
        color: active
            ? accent.withValues(alpha: isDark ? 0.20 : 0.16)
            : theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(11),
        border: Border.all(
          color: active ? accent : theme.dividerColor,
          width: active ? 1.3 : 1.0,
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 17, color: fg),
                  if (showCaret)
                    Icon(
                      Icons.arrow_drop_down,
                      size: 13,
                      color: fg.withValues(alpha: 0.85),
                    ),
                ],
              ),
              if (badgeCount > 0)
                Positioned(
                  top: -4,
                  right: -10,
                  child: _CountBadge(
                    key: const Key('mobile-draw-desk-badge'),
                    count: badgeCount,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 1),
          Text(
            label,
            maxLines: 1,
            softWrap: false,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 9.5,
              height: 1.05,
              fontWeight: active ? FontWeight.w800 : FontWeight.w600,
              color: fg,
            ),
          ),
        ],
      ),
    );
  }
}

class _CompactStrokeIconButton extends StatelessWidget {
  const _CompactStrokeIconButton({
    required this.tooltip,
    required this.icon,
    required this.active,
    required this.isDark,
    required this.onTap,
    this.badgeCount = 0,
    super.key,
  });

  final String tooltip;
  final IconData icon;
  final bool active;
  final bool isDark;
  final VoidCallback onTap;
  final int badgeCount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fg = active
        ? (isDark ? EarthlyColors.amber : EarthlyColors.lightAccent)
        : theme.colorScheme.onSurface;

    return Tooltip(
      message: tooltip,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Container(
            width: 36,
            height: 38,
            decoration: BoxDecoration(
              color: active
                  ? EarthlyColors.amber.withValues(alpha: isDark ? 0.20 : 0.16)
                  : theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.55),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: active ? EarthlyColors.amber : theme.dividerColor,
                width: active ? 1.3 : 1.0,
              ),
            ),
            child: Stack(
              alignment: Alignment.center,
              clipBehavior: Clip.none,
              children: [
                Icon(icon, size: 17, color: fg),
                if (badgeCount > 0)
                  Positioned(
                    top: 1,
                    right: 1,
                    child: _CountBadge(
                      key: const Key('mobile-draw-desk-badge'),
                      count: badgeCount,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CountBadge extends StatelessWidget {
  const _CountBadge({required this.count, super.key});

  final int count;

  @override
  Widget build(BuildContext context) {
    final text = count > 99 ? '99+' : '$count';
    return Container(
      constraints: const BoxConstraints(minWidth: 15, minHeight: 14),
      padding: const EdgeInsets.symmetric(horizontal: 3.5, vertical: 0.5),
      decoration: BoxDecoration(
        color: EarthlyColors.amber,
        borderRadius: BorderRadius.circular(999),
      ),
      alignment: Alignment.center,
      child: Text(
        text,
        maxLines: 1,
        softWrap: false,
        style: const TextStyle(
          fontFamily: 'monospace',
          fontSize: 8.5,
          height: 1.1,
          fontWeight: FontWeight.w900,
          color: EarthlyColors.amberInk,
        ),
      ),
    );
  }
}
