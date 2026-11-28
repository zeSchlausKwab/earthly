import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';

/// Visual severity for an [EarthlyToastMessage].
enum EarthlyToastSeverity {
  info,
  success,
  warning,
  error,
}

/// Immutable payload for a single auto-decaying toast notification.
@immutable
class EarthlyToastMessage {
  const EarthlyToastMessage({
    required this.id,
    required this.message,
    this.severity = EarthlyToastSeverity.info,
    required this.duration,
    this.actionLabel,
    this.onAction,
    this.copyText,
    required this.showCopyButton,
  });

  final int id;
  final String message;
  final EarthlyToastSeverity severity;
  final Duration duration;
  final String? actionLabel;
  final VoidCallback? onAction;
  final String? copyText;
  final bool showCopyButton;

  /// Full text copied when the user taps the Copy action on an error toast.
  String get effectiveCopyText =>
      (copyText != null && copyText!.isNotEmpty) ? copyText! : message;

  static Duration defaultDurationFor(EarthlyToastSeverity severity) =>
      switch (severity) {
        EarthlyToastSeverity.info => const Duration(seconds: 4),
        EarthlyToastSeverity.success => const Duration(seconds: 4),
        EarthlyToastSeverity.warning => const Duration(seconds: 6),
        EarthlyToastSeverity.error => const Duration(seconds: 6),
      };
}

/// Manages the currently visible auto-decaying toast notification.
///
/// Showing a new toast immediately replaces any previous toast so notifications
/// never queue up or linger indefinitely — even when an action button (such as
/// `Reopen` or `Undo`) is attached.
class EarthlyToastController extends ChangeNotifier {
  int _nextId = 1;
  EarthlyToastMessage? _current;

  EarthlyToastMessage? get current => _current;

  EarthlyToastMessage show(
    String message, {
    EarthlyToastSeverity severity = EarthlyToastSeverity.info,
    Duration? duration,
    String? actionLabel,
    VoidCallback? onAction,
    String? copyText,
    bool? showCopyButton,
  }) {
    final resolvedDuration =
        duration ?? EarthlyToastMessage.defaultDurationFor(severity);
    final toast = EarthlyToastMessage(
      id: _nextId++,
      message: message,
      severity: severity,
      duration: resolvedDuration,
      actionLabel: actionLabel,
      onAction: onAction,
      copyText: copyText,
      showCopyButton: showCopyButton ?? severity == EarthlyToastSeverity.error,
    );
    _current = toast;
    notifyListeners();
    return toast;
  }

  EarthlyToastMessage showInfo(
    String message, {
    Duration? duration,
    String? actionLabel,
    VoidCallback? onAction,
  }) =>
      show(
        message,
        severity: EarthlyToastSeverity.info,
        duration: duration,
        actionLabel: actionLabel,
        onAction: onAction,
      );

  EarthlyToastMessage showSuccess(
    String message, {
    Duration? duration,
    String? actionLabel,
    VoidCallback? onAction,
  }) =>
      show(
        message,
        severity: EarthlyToastSeverity.success,
        duration: duration,
        actionLabel: actionLabel,
        onAction: onAction,
      );

  EarthlyToastMessage showWarning(
    String message, {
    Duration? duration,
    String? actionLabel,
    VoidCallback? onAction,
  }) =>
      show(
        message,
        severity: EarthlyToastSeverity.warning,
        duration: duration,
        actionLabel: actionLabel,
        onAction: onAction,
      );

  EarthlyToastMessage showError(
    String message, {
    Duration? duration,
    String? actionLabel,
    VoidCallback? onAction,
    String? copyText,
  }) =>
      show(
        message,
        severity: EarthlyToastSeverity.error,
        duration: duration,
        actionLabel: actionLabel,
        onAction: onAction,
        copyText: copyText,
        showCopyButton: true,
      );

  /// Dismisses the current toast. If [toastId] is supplied, only dismisses if
  /// that exact toast is still active (protecting newer replacement toasts).
  void dismiss([int? toastId]) {
    if (_current == null) return;
    if (toastId != null && _current!.id != toastId) return;
    _current = null;
    notifyListeners();
  }
}

/// Provides an [EarthlyToastController] down the widget tree.
class EarthlyToastScope extends InheritedNotifier<EarthlyToastController> {
  const EarthlyToastScope({
    required EarthlyToastController controller,
    required super.child,
    super.key,
  }) : super(notifier: controller);

  static EarthlyToastController? maybeOf(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<EarthlyToastScope>()
        ?.notifier;
  }

  static EarthlyToastController? readMaybeOf(BuildContext context) {
    final element =
        context.getElementForInheritedWidgetOfExactType<EarthlyToastScope>();
    final widget = element?.widget;
    if (widget is EarthlyToastScope) return widget.notifier;
    return null;
  }
}

/// Imperative entry point for showing auto-decaying Earthly toasts from any
/// sheet or widget. Uses the nearest [EarthlyToastScope] when mounted inside
/// `EarthlySpikeHome`, and falls back cleanly to the nearest [Overlay] in
/// standalone sheets/tests.
abstract final class EarthlyToast {
  static int _fallbackId = 1000000;
  static final Expando<OverlayEntry> _activeOverlayEntries =
      Expando<OverlayEntry>('earthly_toast_overlay');

  static EarthlyToastController? maybeOf(BuildContext context) =>
      EarthlyToastScope.readMaybeOf(context);

  static void show(
    BuildContext context,
    String message, {
    EarthlyToastSeverity severity = EarthlyToastSeverity.info,
    Duration? duration,
    String? actionLabel,
    VoidCallback? onAction,
    String? copyText,
    bool? showCopyButton,
  }) {
    final scoped = EarthlyToastScope.readMaybeOf(context);
    if (scoped != null) {
      scoped.show(
        message,
        severity: severity,
        duration: duration,
        actionLabel: actionLabel,
        onAction: onAction,
        copyText: copyText,
        showCopyButton: showCopyButton,
      );
      return;
    }

    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) return;

    final previous = _activeOverlayEntries[overlay];
    if (previous != null && previous.mounted) {
      previous.remove();
    }

    final toast = EarthlyToastMessage(
      id: _fallbackId++,
      message: message,
      severity: severity,
      duration: duration ?? EarthlyToastMessage.defaultDurationFor(severity),
      actionLabel: actionLabel,
      onAction: onAction,
      copyText: copyText,
      showCopyButton: showCopyButton ?? severity == EarthlyToastSeverity.error,
    );

    late final OverlayEntry entry;
    void removeEntry() {
      if (_activeOverlayEntries[overlay] == entry) {
        _activeOverlayEntries[overlay] = null;
      }
      if (entry.mounted) {
        entry.remove();
      }
    }

    entry = OverlayEntry(
      builder: (overlayContext) {
        final topInset = MediaQuery.paddingOf(overlayContext).top;
        return Positioned(
          top: topInset + 58,
          left: 12,
          right: 12,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Material(
                type: MaterialType.transparency,
                child: EarthlyToastCard(
                  key: ValueKey<int>(toast.id),
                  toast: toast,
                  onDismiss: removeEntry,
                ),
              ),
            ),
          ),
        );
      },
    );

    _activeOverlayEntries[overlay] = entry;
    overlay.insert(entry);
  }

  static void info(
    BuildContext context,
    String message, {
    Duration? duration,
    String? actionLabel,
    VoidCallback? onAction,
  }) =>
      show(
        context,
        message,
        severity: EarthlyToastSeverity.info,
        duration: duration,
        actionLabel: actionLabel,
        onAction: onAction,
      );

  static void success(
    BuildContext context,
    String message, {
    Duration? duration,
    String? actionLabel,
    VoidCallback? onAction,
  }) =>
      show(
        context,
        message,
        severity: EarthlyToastSeverity.success,
        duration: duration,
        actionLabel: actionLabel,
        onAction: onAction,
      );

  static void warning(
    BuildContext context,
    String message, {
    Duration? duration,
    String? actionLabel,
    VoidCallback? onAction,
  }) =>
      show(
        context,
        message,
        severity: EarthlyToastSeverity.warning,
        duration: duration,
        actionLabel: actionLabel,
        onAction: onAction,
      );

  static void error(
    BuildContext context,
    String message, {
    Duration? duration,
    String? actionLabel,
    VoidCallback? onAction,
    String? copyText,
  }) =>
      show(
        context,
        message,
        severity: EarthlyToastSeverity.error,
        duration: duration,
        actionLabel: actionLabel,
        onAction: onAction,
        copyText: copyText,
        showCopyButton: true,
      );
}

/// Overlay slot mounted at the top of the app [Stack] that listens to
/// [controller] and renders the active [EarthlyToastCard] above drawers & HUDs.
class EarthlyToastOverlay extends StatelessWidget {
  const EarthlyToastOverlay({
    required this.controller,
    this.topOffset = 58.0,
    super.key,
  });

  final EarthlyToastController controller;
  final double topOffset;

  @override
  Widget build(BuildContext context) {
    final topInset = MediaQuery.paddingOf(context).top;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final toast = controller.current;
        if (toast == null) return const SizedBox.shrink();
        return Positioned(
          top: topInset + topOffset,
          left: 12,
          right: 12,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: EarthlyToastCard(
                key: ValueKey<int>(toast.id),
                toast: toast,
                onDismiss: () => controller.dismiss(toast.id),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// High-contrast floating toast card driven by a finite [AnimationController]
/// countdown that renders a smooth decaying progress bar along the bottom edge,
/// supports horizontal swipe-to-dismiss and a compact close `×` button, and
/// includes a one-tap `Copy` button with brief "Copied" feedback on errors.
class EarthlyToastCard extends StatefulWidget {
  const EarthlyToastCard({
    required this.toast,
    required this.onDismiss,
    super.key,
  });

  final EarthlyToastMessage toast;
  final VoidCallback onDismiss;

  @override
  State<EarthlyToastCard> createState() => _EarthlyToastCardState();
}

class _EarthlyToastCardState extends State<EarthlyToastCard>
    with TickerProviderStateMixin {
  /// Brief reading grace period after mount before the bottom countdown bar
  /// starts draining. Keeps total lifetime equal to [EarthlyToastMessage.duration]
  /// (for durations > 900ms) while letting entrance animations and button
  /// ripples settle cleanly before decay ticks begin.
  static const Duration _initialHoldDuration = Duration(milliseconds: 750);

  late final AnimationController _entryController;
  late final AnimationController _decayController;
  late final Duration _decayDuration;
  bool _dismissed = false;
  bool _copied = false;
  Timer? _startDecayTimer;
  Timer? _autoDismissTimer;
  Timer? _copiedResetTimer;

  @override
  void initState() {
    super.initState();
    _entryController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 160),
    )..forward();

    final totalDuration = widget.toast.duration;
    final useHold = totalDuration > const Duration(milliseconds: 900);
    _decayDuration =
        useHold ? totalDuration - _initialHoldDuration : totalDuration;

    _decayController = AnimationController(
      vsync: this,
      duration: _decayDuration,
      value: 1.0,
    );
    _decayController.addStatusListener(_onDecayStatusChanged);

    if (useHold) {
      _startDecayTimer = Timer(_initialHoldDuration, _beginDecay);
    } else {
      _beginDecay();
    }
  }

  void _beginDecay() {
    if (!mounted || _dismissed) return;
    if (_decayController.status == AnimationStatus.dismissed) return;
    if (!_decayController.isAnimating) {
      _decayController.reverse(from: _decayController.value);
    }
    _autoDismissTimer?.cancel();
    _autoDismissTimer = Timer(_decayDuration, _triggerDismiss);
  }

  void _onDecayStatusChanged(AnimationStatus status) {
    if (status == AnimationStatus.dismissed) {
      _triggerDismiss();
    }
  }

  void _triggerDismiss() {
    if (_dismissed || !mounted) return;
    _dismissed = true;
    _startDecayTimer?.cancel();
    _autoDismissTimer?.cancel();
    widget.onDismiss();
  }

  Future<void> _copyErrorToClipboard() async {
    await Clipboard.setData(
      ClipboardData(text: widget.toast.effectiveCopyText),
    );
    if (!mounted || _dismissed) return;
    setState(() => _copied = true);

    // Ensure the user has a brief moment to see the "Copied" confirmation if
    // the toast was almost finished decaying, while staying strictly bounded.
    final decayMs = _decayDuration.inMilliseconds;
    if (decayMs > 0 && _decayController.isAnimating) {
      final remainingMs = (_decayController.value * decayMs).round();
      if (remainingMs < 1100) {
        final targetFraction = (1100 / decayMs).clamp(0.0, 1.0);
        _decayController.reverse(from: targetFraction);
        _autoDismissTimer?.cancel();
        _autoDismissTimer = Timer(
          const Duration(milliseconds: 1100),
          _triggerDismiss,
        );
      }
    }

    _copiedResetTimer?.cancel();
    _copiedResetTimer = Timer(const Duration(milliseconds: 1400), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  void dispose() {
    _startDecayTimer?.cancel();
    _autoDismissTimer?.cancel();
    _copiedResetTimer?.cancel();
    _decayController.removeStatusListener(_onDecayStatusChanged);
    _decayController.dispose();
    _entryController.dispose();
    super.dispose();
  }

  Color _accentColor() => switch (widget.toast.severity) {
        EarthlyToastSeverity.info => EarthlyColors.infoCyanBright,
        EarthlyToastSeverity.success => EarthlyColors.commentGreen,
        EarthlyToastSeverity.warning => EarthlyColors.amber,
        EarthlyToastSeverity.error => EarthlyColors.destructive,
      };

  IconData _icon() => switch (widget.toast.severity) {
        EarthlyToastSeverity.info => Icons.info_outline_rounded,
        EarthlyToastSeverity.success => Icons.check_circle_outline_rounded,
        EarthlyToastSeverity.warning => Icons.warning_amber_rounded,
        EarthlyToastSeverity.error => Icons.error_outline_rounded,
      };

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = _accentColor();
    final bgColor =
        isDark ? const Color(0xF5222329) : const Color(0xF51F1E1B);
    final toast = widget.toast;
    final hasAction =
        toast.actionLabel != null && toast.actionLabel!.isNotEmpty;

    return FadeTransition(
      opacity: CurvedAnimation(
        parent: _entryController,
        curve: Curves.easeOut,
      ),
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, -0.18),
          end: Offset.zero,
        ).animate(
          CurvedAnimation(
            parent: _entryController,
            curve: Curves.easeOutCubic,
          ),
        ),
        child: Dismissible(
          key: ValueKey<String>('earthly-toast-dismiss-${toast.id}'),
          direction: DismissDirection.horizontal,
          onDismissed: (_) => _triggerDismiss(),
          child: Semantics(
            liveRegion: true,
            label: toast.message,
            child: Container(
              key: const Key('earthly-toast-card'),
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: accent.withValues(alpha: 0.45),
                  width: 1.1,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.34),
                    blurRadius: 20,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(13),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 9, 6, 9),
                      child: Row(
                        children: [
                          Icon(_icon(), size: 18, color: accent),
                          const SizedBox(width: 9),
                          Expanded(
                            child: Text(
                              toast.message,
                              key: const Key('earthly-toast-message'),
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFFF5F5F7),
                                fontSize: 12.5,
                                fontWeight: FontWeight.w500,
                                height: 1.32,
                              ),
                            ),
                          ),
                          if (toast.showCopyButton) ...[
                            const SizedBox(width: 6),
                            _ToastActionPill(
                              key: const Key('earthly-toast-copy-btn'),
                              icon: _copied
                                  ? Icons.check_rounded
                                  : Icons.copy_rounded,
                              label: _copied ? 'Copied' : 'Copy',
                              color: _copied
                                  ? EarthlyColors.commentGreen
                                  : const Color(0xFFF5F5F7),
                              borderColor: (_copied
                                      ? EarthlyColors.commentGreen
                                      : Colors.white)
                                  .withValues(alpha: 0.28),
                              onTap: () => unawaited(_copyErrorToClipboard()),
                            ),
                          ],
                          if (hasAction) ...[
                            const SizedBox(width: 6),
                            _ToastActionPill(
                              key: const Key('earthly-toast-action-btn'),
                              label: toast.actionLabel!,
                              color: EarthlyColors.amber,
                              borderColor:
                                  EarthlyColors.amber.withValues(alpha: 0.45),
                              onTap: () {
                                toast.onAction?.call();
                                _triggerDismiss();
                              },
                            ),
                          ],
                          const SizedBox(width: 2),
                          IconButton(
                            key: const Key('earthly-toast-close-btn'),
                            tooltip: 'Dismiss',
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(
                              minWidth: 28,
                              minHeight: 28,
                            ),
                            onPressed: _triggerDismiss,
                            icon: Icon(
                              Icons.close_rounded,
                              size: 16,
                              color: Colors.white.withValues(alpha: 0.72),
                            ),
                          ),
                        ],
                      ),
                    ),
                    // Smooth visible countdown time bar along the bottom edge.
                    SizedBox(
                      key: const Key('earthly-toast-progress-bar'),
                      height: 3.5,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: accent.withValues(alpha: 0.16),
                        ),
                        child: AnimatedBuilder(
                          animation: _decayController,
                          builder: (context, _) => Align(
                            alignment: Alignment.centerLeft,
                            child: FractionallySizedBox(
                              widthFactor:
                                  _decayController.value.clamp(0.0, 1.0),
                              heightFactor: 1.0,
                              child: ColoredBox(color: accent),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ToastActionPill extends StatelessWidget {
  const _ToastActionPill({
    required this.label,
    required this.color,
    required this.borderColor,
    required this.onTap,
    this.icon,
    super.key,
  });

  final String label;
  final Color color;
  final Color borderColor;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: borderColor),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 13, color: color),
                const SizedBox(width: 4),
              ],
              Text(
                label,
                maxLines: 1,
                softWrap: false,
                style: TextStyle(
                  color: color,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
