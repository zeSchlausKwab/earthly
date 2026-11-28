import 'dart:ui';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';

enum EarthlyDrawerSide { left, right }

/// Optional inherited placement overriding `EarthlyMapDrawer.desktopSide` so
/// Desktop Studio (`width >= 1100`) can render a simultaneous left Margin and
/// right Studio Pane around the live GPU map canvas with zero per-sheet boilerplate.
class EarthlyDrawerPlacement extends InheritedWidget {
  const EarthlyDrawerPlacement({
    required this.side,
    required super.child,
    super.key,
  });

  final EarthlyDrawerSide side;

  static EarthlyDrawerSide? maybeOf(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<EarthlyDrawerPlacement>()
      ?.side;

  @override
  bool updateShouldNotify(EarthlyDrawerPlacement oldWidget) =>
      side != oldWidget.side;
}

/// Google-Maps-style non-blocking frosted-glass map drawer that adapts across
/// Mobile & Desktop:
///
/// - **Mobile (`width < 880`)**: Top-rounded bottom drawer (`22px` radius) with
///   an **always-visible sticky drag handle + header** at the top. Dragging the
///   handle bar snaps smoothly between Peek (18%), 50/50 Split (50%), and Full
///   (88%), and **sliding past the bottom threshold or flicking down dismisses
///   the drawer implicitly**! The scrollable [body] below scrolls **100%
///   independently** of the drawer height.
/// - **Desktop (`width >= 880`, macOS/Linux/Windows)**: Docks as a floating
///   frosted-glass 416px left or right Margin panel beside the full-height GPU
///   map canvas (enabling simultaneous `Left Margin | Canvas | Right Studio Pane`
///   multi-column layout at `width >= 1100`!).
class EarthlyMapDrawer extends StatefulWidget {
  const EarthlyMapDrawer({
    required this.header,
    required this.body,
    required this.onClose,
    this.initialFraction = 0.50,
    this.minFraction = 0.18,
    this.maxFraction = 0.88,
    this.accentTopBorder = false,
    this.desktopSide = EarthlyDrawerSide.left,
    this.onHeightFractionChanged,
    super.key,
  });

  /// Always-visible header placed inside the draggable handle zone.
  final Widget header;

  /// Independently scrollable drawer body (does NOT hijack drawer dragging).
  final Widget body;

  final VoidCallback onClose;
  final double initialFraction;
  final double minFraction;
  final double maxFraction;
  final bool accentTopBorder;
  final EarthlyDrawerSide desktopSide;
  final ValueChanged<double>? onHeightFractionChanged;

  @override
  State<EarthlyMapDrawer> createState() => _EarthlyMapDrawerState();
}

class _EarthlyMapDrawerState extends State<EarthlyMapDrawer> {
  static const List<double> _snapPoints = <double>[0.18, 0.50, 0.88];
  static const double _dismissThreshold = 0.13;

  late double _fraction = widget.initialFraction;
  bool _dragging = false;

  void _setFraction(double next) {
    // Allow sliding smoothly all the way down toward 0.0 for implicit swipe-to-close!
    final clamped = next.clamp(0.0, widget.maxFraction);
    if ((clamped - _fraction).abs() < 0.0005) return;
    setState(() => _fraction = clamped);
    widget.onHeightFractionChanged?.call(clamped);
  }

  void _snapWithVelocity(double velocityPxPerSec) {
    // Implicit swipe-down-to-close: dragged past threshold OR brisk downward flick.
    final shouldClose = _fraction < _dismissThreshold ||
        (velocityPxPerSec > 750 && _fraction < 0.46) ||
        (velocityPxPerSec > 350 && _fraction <= 0.22);
    if (shouldClose) {
      setState(() => _dragging = false);
      HapticFeedback.selectionClick();
      widget.onClose();
      return;
    }

    double target;
    if (velocityPxPerSec < -350) {
      target = _snapPoints.firstWhere(
        (s) => s > _fraction + 0.04,
        orElse: () => _snapPoints.last,
      );
    } else if (velocityPxPerSec > 350) {
      target = _snapPoints.lastWhere(
        (s) => s < _fraction - 0.04,
        orElse: () => _snapPoints.first,
      );
    } else {
      target = _snapPoints.reduce(
        (a, b) => (a - _fraction).abs() <= (b - _fraction).abs() ? a : b,
      );
    }
    setState(() {
      _dragging = false;
      _fraction = target.clamp(widget.minFraction, widget.maxFraction);
    });
    widget.onHeightFractionChanged?.call(_fraction);
  }

  void _cycleSnap() {
    final next = _fraction < 0.35
        ? 0.50
        : _fraction < 0.72
            ? 0.88
            : 0.50;
    setState(() => _fraction = next);
    widget.onHeightFractionChanged?.call(_fraction);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final size = MediaQuery.sizeOf(context);
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    final isDesktop = size.width >= 880;
    final borderColor = widget.accentTopBorder
        ? EarthlyColors.amber.withValues(alpha: isDark ? 0.72 : 0.85)
        : (isDark
            ? Colors.white.withValues(alpha: 0.12)
            : Colors.black.withValues(alpha: 0.09));

    if (isDesktop) {
      final effectiveSide =
          EarthlyDrawerPlacement.maybeOf(context) ?? widget.desktopSide;
      final isRight = effectiveSide == EarthlyDrawerSide.right;
      final panelWidth = size.width >= 1240 ? 416.0 : 372.0;
      return Positioned(
        top: 64,
        left: isRight ? null : 12,
        right: isRight ? 12 : null,
        bottom: 12,
        width: panelWidth,
        child: EarthlyGlassSurface(
          borderRadius: BorderRadius.circular(18),
          blurSigma: 18,
          color:
              theme.colorScheme.surface.withValues(alpha: isDark ? 0.90 : 0.93),
          borderColor: borderColor,
          borderWidth: widget.accentTopBorder ? 1.5 : 1.0,
          shadows: [
            BoxShadow(
              color: Colors.black.withValues(alpha: isDark ? 0.45 : 0.16),
              blurRadius: 28,
              offset: const Offset(0, 10),
            ),
          ],
          child: Material(
            type: MaterialType.transparency,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 6),
                widget.header,
                const Divider(height: 1),
                Expanded(
                  child: MediaQuery.removePadding(
                    context: context,
                    removeTop: true,
                    child: widget.body,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    // Mobile: independent frosted-glass bottom drawer with implicit swipe-down-to-close!
    final availableHeight =
        (size.height - keyboardInset).clamp(240.0, size.height);
    final drawerHeight = (availableHeight * _fraction)
        .clamp(48.0, availableHeight * widget.maxFraction);
    final dismissOpacity = _fraction < 0.18
        ? (_fraction / 0.18).clamp(0.35, 1.0)
        : 1.0;
    const radius = BorderRadius.vertical(top: Radius.circular(22));

    return Positioned(
      left: 0,
      right: 0,
      bottom: keyboardInset,
      child: Opacity(
        opacity: dismissOpacity,
        child: AnimatedContainer(
          duration: _dragging ? Duration.zero : const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          height: drawerHeight,
          decoration: BoxDecoration(
            borderRadius: radius,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDark ? 0.48 : 0.20),
                blurRadius: 24,
                offset: const Offset(0, -6),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: radius,
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
              child: Container(
                decoration: BoxDecoration(
                  color: theme.colorScheme.surface
                      .withValues(alpha: isDark ? 0.92 : 0.95),
                  borderRadius: radius,
                  border: Border(
                    top: BorderSide(
                      color: borderColor,
                      width: widget.accentTopBorder ? 2.0 : 1.0,
                    ),
                  ),
                ),
                child: Material(
                  type: MaterialType.transparency,
                  child: SafeArea(
                    top: false,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // Sticky drag handle + header bar — swipe down past threshold to dismiss!
                        GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: _cycleSnap,
                          onVerticalDragStart: (_) =>
                              setState(() => _dragging = true),
                          onVerticalDragUpdate: (details) {
                            final deltaFraction =
                                -details.delta.dy / availableHeight;
                            _setFraction(_fraction + deltaFraction);
                          },
                          onVerticalDragEnd: (details) {
                            _snapWithVelocity(details.primaryVelocity ?? 0);
                          },
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Padding(
                                padding: const EdgeInsets.only(top: 10, bottom: 4),
                                child: Center(
                                  child: Container(
                                    width: 40,
                                    height: 4.5,
                                    decoration: BoxDecoration(
                                      color: _fraction < _dismissThreshold
                                          ? EarthlyColors.destructive
                                              .withValues(alpha: 0.75)
                                          : widget.accentTopBorder
                                              ? EarthlyColors.amber
                                                  .withValues(alpha: 0.8)
                                              : theme.colorScheme.onSurface
                                                  .withValues(alpha: 0.26),
                                      borderRadius: BorderRadius.circular(999),
                                    ),
                                  ),
                                ),
                              ),
                              widget.header,
                            ],
                          ),
                        ),
                        const Divider(height: 1),
                        Expanded(
                          child: MediaQuery.removePadding(
                            context: context,
                            removeTop: true,
                            child: widget.body,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Compact header Back button shown when a drawer was pushed from a parent
/// drawer (e.g. Search/Explore -> Dataset/Story/Atlas/Person detail).
class EarthlyDrawerBackButton extends StatelessWidget {
  const EarthlyDrawerBackButton({
    required this.onBack,
    super.key,
  });

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      key: const Key('drawer-back-btn'),
      tooltip: 'Back',
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
      onPressed: onBack,
      icon: const Icon(Icons.arrow_back, size: 18),
    );
  }
}

/// Primary segment item inside an [EarthlyActionBar] or [EarthlyActionGrid].
@immutable
class EarthlyActionBarItem {
  const EarthlyActionBarItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.key,
    this.emphasized = false,
    this.active = false,
    this.destructive = false,
    this.loading = false,
    this.accentColor,
    this.tooltip,
    this.flex = 1,
  });

  final Key? key;
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool emphasized;
  final bool active;
  final bool destructive;
  final bool loading;
  final Color? accentColor;
  final String? tooltip;
  final int flex;
}

/// Overflow menu action inside an [EarthlyActionBar]'s trailing `...` menu.
@immutable
class EarthlyOverflowAction {
  const EarthlyOverflowAction({
    required this.label,
    required this.icon,
    required this.onSelected,
    this.key,
    this.destructive = false,
    this.enabled = true,
  });

  final Key? key;
  final String label;
  final IconData icon;
  final VoidCallback? onSelected;
  final bool destructive;
  final bool enabled;
}

/// Single-row, non-wrapping unified action bar modeled after Earthly's Desk
/// segmented toolbar. Every primary action renders inside an [Expanded] cell
/// with `maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis`, and
/// optional secondary actions tuck into a flush trailing `...` menu button.
class EarthlyActionBar extends StatelessWidget {
  const EarthlyActionBar({
    required this.items,
    this.overflowActions = const <EarthlyOverflowAction>[],
    this.overflowMenuKey,
    this.overflowTooltip = 'More actions',
    this.stacked = true,
    this.borderRadius = 11,
    super.key,
  });

  final List<EarthlyActionBarItem> items;
  final List<EarthlyOverflowAction> overflowActions;
  final Key? overflowMenuKey;
  final String overflowTooltip;
  final bool stacked;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty && overflowActions.isEmpty) {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);
    final children = <Widget>[];

    for (var i = 0; i < items.length; i++) {
      if (i > 0) {
        children.add(VerticalDivider(width: 1, thickness: 1, color: theme.dividerColor));
      }
      children.add(
        Expanded(
          flex: items[i].flex,
          child: _EarthlyActionBarCell(
            item: items[i],
            stacked: stacked,
          ),
        ),
      );
    }

    if (overflowActions.isNotEmpty) {
      if (children.isNotEmpty) {
        children.add(VerticalDivider(width: 1, thickness: 1, color: theme.dividerColor));
      }
      children.add(
        SizedBox(
          width: 40,
          child: PopupMenuButton<int>(
            key: overflowMenuKey,
            tooltip: overflowTooltip,
            padding: EdgeInsets.zero,
            icon: Icon(
              Icons.more_horiz,
              size: 18,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            onSelected: (idx) {
              final action = overflowActions[idx];
              if (action.enabled) action.onSelected?.call();
            },
            itemBuilder: (_) => [
              for (var i = 0; i < overflowActions.length; i++)
                PopupMenuItem<int>(
                  key: overflowActions[i].key,
                  value: i,
                  enabled: overflowActions[i].enabled &&
                      overflowActions[i].onSelected != null,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        overflowActions[i].icon,
                        size: 17,
                        color: overflowActions[i].destructive
                            ? EarthlyColors.destructive
                            : null,
                      ),
                      const SizedBox(width: 10),
                      Flexible(
                        child: Text(
                          overflowActions[i].label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13,
                            color: overflowActions[i].destructive
                                ? EarthlyColors.destructive
                                : null,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      );
    }

    return Material(
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.72),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(borderRadius),
        side: BorderSide(color: theme.dividerColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: children,
        ),
      ),
    );
  }
}

class _EarthlyActionBarCell extends StatelessWidget {
  const _EarthlyActionBarCell({
    required this.item,
    required this.stacked,
  });

  final EarthlyActionBarItem item;
  final bool stacked;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final enabled = item.onTap != null && !item.loading;
    final Color? bg;
    final Color fg;

    if (item.emphasized && enabled) {
      bg = item.accentColor ?? EarthlyColors.amber;
      fg = item.accentColor != null ? Colors.white : EarthlyColors.amberInk;
    } else if (item.active) {
      final accent = item.accentColor ?? theme.colorScheme.primary;
      bg = accent.withValues(alpha: 0.16);
      fg = accent;
    } else {
      bg = null;
      if (!enabled) {
        fg = theme.colorScheme.onSurface.withValues(alpha: 0.36);
      } else if (item.destructive) {
        fg = EarthlyColors.destructive;
      } else {
        fg = item.accentColor ?? theme.colorScheme.onSurface;
      }
    }

    final iconWidget = item.loading
        ? SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 1.8, color: fg),
          )
        : Icon(item.icon, size: stacked ? 16 : 15, color: fg);

    final labelWidget = Text(
      item.label,
      maxLines: 1,
      softWrap: false,
      overflow: TextOverflow.ellipsis,
      textAlign: TextAlign.center,
      style: TextStyle(
        fontSize: stacked ? 11 : 12,
        fontWeight: (item.emphasized || item.active)
            ? FontWeight.w700
            : FontWeight.w600,
        color: fg,
      ),
    );

    Widget child = Material(
      color: bg ?? Colors.transparent,
      child: InkWell(
        key: item.key,
        onTap: enabled ? item.onTap : null,
        child: Padding(
          padding: stacked
              ? const EdgeInsets.symmetric(horizontal: 4, vertical: 7)
              : const EdgeInsets.symmetric(horizontal: 8, vertical: 9),
          child: stacked
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    iconWidget,
                    const SizedBox(height: 2),
                    labelWidget,
                  ],
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    iconWidget,
                    const SizedBox(width: 5),
                    Flexible(child: labelWidget),
                  ],
                ),
        ),
      ),
    );

    if (item.tooltip != null) {
      child = Tooltip(message: item.tooltip!, child: child);
    }
    return child;
  }
}

/// Structured equal-column bordered grid of action items (e.g. 2×2 or 3×2) so
/// groups of 4–6 actions never degenerate into jagged multi-row pill clouds.
class EarthlyActionGrid extends StatelessWidget {
  const EarthlyActionGrid({
    required this.items,
    this.columns = 2,
    this.stacked = true,
    this.borderRadius = 11,
    super.key,
  });

  final List<EarthlyActionBarItem> items;
  final int columns;
  final bool stacked;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final rows = <Widget>[];
    final rowCount = (items.length + columns - 1) ~/ columns;

    for (var r = 0; r < rowCount; r++) {
      if (r > 0) {
        rows.add(Divider(height: 1, thickness: 1, color: theme.dividerColor));
      }
      final start = r * columns;
      final end = (start + columns).clamp(0, items.length);
      final rowItems = items.sublist(start, end);
      final rowCells = <Widget>[];
      for (var c = 0; c < rowItems.length; c++) {
        if (c > 0) {
          rowCells.add(
            VerticalDivider(width: 1, thickness: 1, color: theme.dividerColor),
          );
        }
        rowCells.add(
          Expanded(
            child: _EarthlyActionBarCell(
              item: rowItems[c],
              stacked: stacked,
            ),
          ),
        );
      }
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: rowCells,
          ),
        ),
      );
    }

    return Material(
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.72),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(borderRadius),
        side: BorderSide(color: theme.dividerColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: rows,
      ),
    );
  }
}

/// Option descriptor for [EarthlySegmentBar] and [EarthlySegmentGrid].
@immutable
class EarthlySegmentOption<T> {
  const EarthlySegmentOption({
    required this.value,
    required this.label,
    this.icon,
    this.key,
    this.enabled = true,
  });

  final T value;
  final String label;
  final IconData? icon;
  final Key? key;
  final bool enabled;
}

/// Crisp, single-row non-wrapping segmented selector replacing wrapping
/// `ChoiceChip` / `FilterChip` pill clouds on narrow phone screens.
class EarthlySegmentBar<T> extends StatelessWidget {
  const EarthlySegmentBar({
    required this.options,
    required this.selectedValues,
    required this.onSelected,
    this.compact = false,
    this.monospace = false,
    super.key,
  });

  factory EarthlySegmentBar.single({
    Key? key,
    required List<EarthlySegmentOption<T>> options,
    required T? value,
    required ValueChanged<T> onChanged,
    bool compact = false,
    bool monospace = false,
  }) =>
      EarthlySegmentBar<T>(
        key: key,
        options: options,
        selectedValues: value == null ? const {} : {value},
        onSelected: onChanged,
        compact: compact,
        monospace: monospace,
      );

  final List<EarthlySegmentOption<T>> options;
  final Set<T> selectedValues;
  final ValueChanged<T> onSelected;
  final bool compact;
  final bool monospace;

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final children = <Widget>[];
    for (var i = 0; i < options.length; i++) {
      if (i > 0) {
        children.add(
          VerticalDivider(width: 1, thickness: 1, color: theme.dividerColor),
        );
      }
      final opt = options[i];
      children.add(
        Expanded(
          child: _EarthlySegmentCell<T>(
            option: opt,
            selected: selectedValues.contains(opt.value),
            onTap: opt.enabled ? () => onSelected(opt.value) : null,
            compact: compact,
            monospace: monospace,
          ),
        ),
      );
    }

    return Material(
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.60),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: theme.dividerColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: children,
        ),
      ),
    );
  }
}

/// Uniform multi-row segmented matrix (e.g., 3×2 Zap amounts, 3×2 Basemaps,
/// 5×2 OSM presets) with crisp dividers and zero ragged pill wrapping.
class EarthlySegmentGrid<T> extends StatelessWidget {
  const EarthlySegmentGrid({
    required this.options,
    required this.selectedValues,
    required this.onSelected,
    this.columns = 3,
    this.compact = false,
    this.monospace = false,
    super.key,
  });

  final List<EarthlySegmentOption<T>> options;
  final Set<T> selectedValues;
  final ValueChanged<T> onSelected;
  final int columns;
  final bool compact;
  final bool monospace;

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final rows = <Widget>[];
    final rowCount = (options.length + columns - 1) ~/ columns;

    for (var r = 0; r < rowCount; r++) {
      if (r > 0) {
        rows.add(Divider(height: 1, thickness: 1, color: theme.dividerColor));
      }
      final start = r * columns;
      final end = (start + columns).clamp(0, options.length);
      final rowOpts = options.sublist(start, end);
      final cells = <Widget>[];
      for (var c = 0; c < rowOpts.length; c++) {
        if (c > 0) {
          cells.add(
            VerticalDivider(width: 1, thickness: 1, color: theme.dividerColor),
          );
        }
        final opt = rowOpts[c];
        cells.add(
          Expanded(
            child: _EarthlySegmentCell<T>(
              option: opt,
              selected: selectedValues.contains(opt.value),
              onTap: opt.enabled ? () => onSelected(opt.value) : null,
              compact: compact,
              monospace: monospace,
            ),
          ),
        );
      }
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: cells,
          ),
        ),
      );
    }

    return Material(
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.60),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: theme.dividerColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: rows,
      ),
    );
  }
}

class _EarthlySegmentCell<T> extends StatelessWidget {
  const _EarthlySegmentCell({
    required this.option,
    required this.selected,
    required this.onTap,
    required this.compact,
    required this.monospace,
  });

  final EarthlySegmentOption<T> option;
  final bool selected;
  final VoidCallback? onTap;
  final bool compact;
  final bool monospace;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final enabled = onTap != null;
    final bg = selected ? EarthlyColors.amber : Colors.transparent;
    final fg = selected
        ? EarthlyColors.amberInk
        : enabled
            ? theme.colorScheme.onSurface
            : theme.colorScheme.onSurface.withValues(alpha: 0.36);

    return Material(
      color: bg,
      child: InkWell(
        key: option.key,
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 4 : 6,
            vertical: compact ? 6 : 8,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (option.icon != null) ...[
                Icon(option.icon, size: compact ? 13 : 14, color: fg),
                const SizedBox(width: 4),
              ],
              Flexible(
                child: Text(
                  option.label,
                  maxLines: 1,
                  softWrap: false,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: monospace ? 'monospace' : null,
                    fontSize: compact ? 10.5 : 11.5,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                    color: fg,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
