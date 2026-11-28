import 'package:flutter/foundation.dart';

/// All shell drawers/sheets mountable inside Earthly's non-blocking map shell.
enum EarthlyDrawer {
  none,
  explore,
  desk,
  spaces,
  circles,
  inbox,
  outbox,
  person,
  account,
  cashuWallet,
  mcpBridge,
  search,
  agent,
  storyReader,
  storyComposer,
  atlasComposer,
  atlasDetail,
  datasetDetail,
  inspector,
  discussion,
  locationInspector,
  osmImport,
  routing,
  shoutbox,
  help,
  settings;

  /// Whether this drawer docks to the right Studio Pane on wide desktop screens
  /// (`width >= 1100`). On narrow/mobile screens all drawers use the single
  /// active mobile slot.
  bool get isRightStudioDrawer => switch (this) {
        EarthlyDrawer.agent ||
        EarthlyDrawer.inspector ||
        EarthlyDrawer.discussion ||
        EarthlyDrawer.datasetDetail ||
        EarthlyDrawer.storyReader ||
        EarthlyDrawer.storyComposer ||
        EarthlyDrawer.atlasComposer ||
        EarthlyDrawer.atlasDetail ||
        EarthlyDrawer.person ||
        EarthlyDrawer.account ||
        EarthlyDrawer.cashuWallet ||
        EarthlyDrawer.mcpBridge ||
        EarthlyDrawer.search ||
        EarthlyDrawer.locationInspector ||
        EarthlyDrawer.osmImport ||
        EarthlyDrawer.routing ||
        EarthlyDrawer.help ||
        EarthlyDrawer.settings =>
          true,
        _ => false,
      };
}

/// Outcome of a single back-navigation step handled by
/// [DrawerNavigationController].
enum DrawerBackAction {
  /// Popped to a previous drawer in the history stack (e.g., Outbox -> Desk).
  poppedToPreviousDrawer,

  /// Closed the last open root drawer, revealing the full map canvas.
  closedRootDrawer,

  /// At root map for the first time: arm double-back-to-exit and show toast.
  armExitToast,

  /// Second Back at root map within the exit window: exit the app cleanly.
  exitApp,
}

@immutable
class DrawerBackResult {
  const DrawerBackResult({
    required this.action,
    this.leavingDrawer = EarthlyDrawer.none,
    this.restoredDrawer = EarthlyDrawer.none,
  });

  final DrawerBackAction action;
  final EarthlyDrawer leavingDrawer;
  final EarthlyDrawer restoredDrawer;
}

/// Manages active drawer routing and per-pane navigation history stacks for
/// both mobile bottom drawers and Wide Studio (`>=1100px`) dual-margin layout.
///
/// Opening a sub-drawer from an active parent drawer (e.g., `Desk -> Outbox`,
/// `Spaces -> Circles`, `Explore -> Dataset Detail`, `Search -> Entity`,
/// `Account -> Wallet`) pushes the parent onto the history stack so Back
/// (hardware Back, Android predictive left-edge swipe, or a header `<-` icon)
/// restores the parent instead of dropping the user back to the map or closing
/// the app.
class DrawerNavigationController extends ChangeNotifier {
  DrawerNavigationController({
    DateTime Function()? clock,
    this.exitConfirmWindow = const Duration(milliseconds: 2500),
    this.maxHistoryDepth = 24,
  }) : _clock = clock ?? DateTime.now;

  final DateTime Function() _clock;
  final Duration exitConfirmWindow;
  final int maxHistoryDepth;

  EarthlyDrawer _left = EarthlyDrawer.none;
  EarthlyDrawer _right = EarthlyDrawer.none;
  final List<EarthlyDrawer> _leftHistory = <EarthlyDrawer>[];
  final List<EarthlyDrawer> _rightHistory = <EarthlyDrawer>[];
  bool _lastInteractedRight = false;
  DateTime? _lastRootBackAt;

  EarthlyDrawer get left => _left;
  EarthlyDrawer get right => _right;
  List<EarthlyDrawer> get leftHistory =>
      List<EarthlyDrawer>.unmodifiable(_leftHistory);
  List<EarthlyDrawer> get rightHistory =>
      List<EarthlyDrawer>.unmodifiable(_rightHistory);

  bool isOpen(EarthlyDrawer target) => _left == target || _right == target;

  /// Whether [drawer] is still either currently open or retained on a history
  /// stack (used to decide whether drawer-scoped state like active Story
  /// overlays should be cleaned up when leaving).
  bool isRetained(EarthlyDrawer drawer) =>
      drawer != EarthlyDrawer.none &&
      (_left == drawer ||
          _right == drawer ||
          _leftHistory.contains(drawer) ||
          _rightHistory.contains(drawer));

  bool get hasAnyOpenDrawer =>
      _left != EarthlyDrawer.none || _right != EarthlyDrawer.none;

  bool get canGoBack => _leftHistory.isNotEmpty || _rightHistory.isNotEmpty;

  /// Whether a specific mounted [drawer] currently has a parent drawer to
  /// return to via a header `<-` Back button.
  bool canGoBackFrom(EarthlyDrawer drawer, {required bool isWideStudio}) {
    if (drawer == EarthlyDrawer.none) return false;
    if (isWideStudio && drawer.isRightStudioDrawer) {
      return _right == drawer && _rightHistory.isNotEmpty;
    }
    return _left == drawer && _leftHistory.isNotEmpty;
  }

  /// Clears any armed double-back-to-exit window (e.g., when a drawer opens or
  /// the user enters drawing mode).
  void resetExitConfirmation() {
    _lastRootBackAt = null;
  }

  /// Opens [target]. When [pushHistory] is `true` (default) and another drawer
  /// is already open on the same slot, that parent drawer is pushed onto the
  /// history stack instead of discarded.
  void open(
    EarthlyDrawer target, {
    required bool isWideStudio,
    bool pushHistory = true,
  }) {
    if (target == EarthlyDrawer.none) {
      closeAll();
      return;
    }
    _lastRootBackAt = null;

    if (isWideStudio && target.isRightStudioDrawer) {
      if (_right == target) return;
      if (pushHistory && _right != EarthlyDrawer.none) {
        _pushUnique(_rightHistory, _right);
      } else if (!pushHistory) {
        _rightHistory.clear();
      }
      _right = target;
      _lastInteractedRight = true;
      notifyListeners();
      return;
    }

    if (!isWideStudio && _right != EarthlyDrawer.none) {
      // Collapse any stale right slot back into mobile single-slot state.
      if (_left == EarthlyDrawer.none) {
        _left = _right;
      }
      _right = EarthlyDrawer.none;
      _rightHistory.clear();
    }

    if (_left == target) return;
    if (pushHistory && _left != EarthlyDrawer.none) {
      _pushUnique(_leftHistory, _left);
    } else if (!pushHistory) {
      _leftHistory.clear();
    }
    _left = target;
    _lastInteractedRight = false;
    notifyListeners();
  }

  /// Toggles a top-level root drawer (bottom dock or desktop top bar),
  /// clearing sub-drawer history for that slot.
  List<EarthlyDrawer> toggleRoot(
    EarthlyDrawer target, {
    required bool isWideStudio,
  }) {
    _lastRootBackAt = null;
    final removed = <EarthlyDrawer>[];

    if (isWideStudio && target.isRightStudioDrawer) {
      if (_right == target) {
        removed
          ..add(_right)
          ..addAll(_rightHistory);
        _right = EarthlyDrawer.none;
        _rightHistory.clear();
      } else {
        if (_right != EarthlyDrawer.none) removed.add(_right);
        removed.addAll(_rightHistory);
        _rightHistory.clear();
        _right = target;
        _lastInteractedRight = true;
      }
      notifyListeners();
      return removed.where((d) => !isRetained(d)).toSet().toList();
    }

    if (!isWideStudio && _right != EarthlyDrawer.none) {
      removed.add(_right);
      removed.addAll(_rightHistory);
      _right = EarthlyDrawer.none;
      _rightHistory.clear();
    }

    if (_left == target) {
      removed
        ..add(_left)
        ..addAll(_leftHistory);
      _left = EarthlyDrawer.none;
      _leftHistory.clear();
    } else {
      if (_left != EarthlyDrawer.none) removed.add(_left);
      removed.addAll(_leftHistory);
      _leftHistory.clear();
      _left = target;
      _lastInteractedRight = false;
    }
    notifyListeners();
    return removed.where((d) => !isRetained(d)).toSet().toList();
  }

  /// Explicitly closes [target] (e.g., via its `×` button or swipe-down),
  /// dismissing that slot and clearing its history stack to reveal the map.
  /// Returns drawers that are no longer retained anywhere.
  List<EarthlyDrawer> closeDrawer(EarthlyDrawer target) {
    if (target == EarthlyDrawer.none) return const <EarthlyDrawer>[];
    final removed = <EarthlyDrawer>[];
    var changed = false;

    if (_left == target) {
      removed
        ..add(_left)
        ..addAll(_leftHistory);
      _left = EarthlyDrawer.none;
      _leftHistory.clear();
      changed = true;
    }
    if (_right == target) {
      removed
        ..add(_right)
        ..addAll(_rightHistory);
      _right = EarthlyDrawer.none;
      _rightHistory.clear();
      changed = true;
    }
    if (!changed) return const <EarthlyDrawer>[];
    _lastRootBackAt = null;
    notifyListeners();
    return removed.where((d) => !isRetained(d)).toSet().toList();
  }

  /// Closes all open drawers and clears all history stacks.
  List<EarthlyDrawer> closeAll() {
    if (_left == EarthlyDrawer.none &&
        _right == EarthlyDrawer.none &&
        _leftHistory.isEmpty &&
        _rightHistory.isEmpty) {
      return const <EarthlyDrawer>[];
    }
    final removed = <EarthlyDrawer>{
      if (_left != EarthlyDrawer.none) _left,
      if (_right != EarthlyDrawer.none) _right,
      ..._leftHistory,
      ..._rightHistory,
    };
    _left = EarthlyDrawer.none;
    _right = EarthlyDrawer.none;
    _leftHistory.clear();
    _rightHistory.clear();
    _lastRootBackAt = null;
    notifyListeners();
    return removed.toList(growable: false);
  }

  /// Pops one step from the drawer stack for [drawer] (used by header `<-`
  /// Back icon buttons). If [drawer] has no history on its slot, closes it.
  DrawerBackResult popBackFor(
    EarthlyDrawer drawer, {
    required bool isWideStudio,
  }) {
    _lastRootBackAt = null;
    if (isWideStudio && drawer.isRightStudioDrawer) {
      if (_right != drawer) {
        return const DrawerBackResult(action: DrawerBackAction.closedRootDrawer);
      }
      return _popRightSlot();
    }
    if (_left != drawer && _right == drawer) {
      return _popRightSlot();
    }
    if (_left != drawer) {
      return const DrawerBackResult(action: DrawerBackAction.closedRootDrawer);
    }
    return _popLeftSlot();
  }

  /// Handles hardware Back / Android predictive left-edge swipe across the
  /// drawer stack and root-map double-back exit confirmation.
  ///
  /// Callers should check Navigator modals and active drawing mode BEFORE
  /// delegating to this method.
  DrawerBackResult handleBack({
    required bool isWideStudio,
    bool allowExitPrompt = true,
  }) {
    // 1. Prefer popping any non-empty drawer history stack first.
    if (isWideStudio) {
      if (_lastInteractedRight && _rightHistory.isNotEmpty) {
        _lastRootBackAt = null;
        return _popRightSlot();
      }
      if (_leftHistory.isNotEmpty) {
        _lastRootBackAt = null;
        return _popLeftSlot();
      }
      if (_rightHistory.isNotEmpty) {
        _lastRootBackAt = null;
        return _popRightSlot();
      }
      // 2. Otherwise close an open root drawer (most recently interacted / right first).
      if (_lastInteractedRight && _right != EarthlyDrawer.none) {
        _lastRootBackAt = null;
        return _popRightSlot();
      }
      if (_right != EarthlyDrawer.none) {
        _lastRootBackAt = null;
        return _popRightSlot();
      }
      if (_left != EarthlyDrawer.none) {
        _lastRootBackAt = null;
        return _popLeftSlot();
      }
    } else {
      if (_leftHistory.isNotEmpty) {
        _lastRootBackAt = null;
        return _popLeftSlot();
      }
      if (_left != EarthlyDrawer.none) {
        _lastRootBackAt = null;
        return _popLeftSlot();
      }
      if (_rightHistory.isNotEmpty || _right != EarthlyDrawer.none) {
        _lastRootBackAt = null;
        return _popRightSlot();
      }
    }

    // 3. At root map: double-back within exitConfirmWindow (2.5s) exits cleanly.
    if (!allowExitPrompt) {
      return const DrawerBackResult(action: DrawerBackAction.armExitToast);
    }
    final now = _clock();
    final prev = _lastRootBackAt;
    if (prev != null && now.difference(prev) <= exitConfirmWindow) {
      _lastRootBackAt = null;
      return const DrawerBackResult(action: DrawerBackAction.exitApp);
    }
    _lastRootBackAt = now;
    return const DrawerBackResult(action: DrawerBackAction.armExitToast);
  }

  DrawerBackResult _popLeftSlot() {
    final leaving = _left;
    if (_leftHistory.isNotEmpty) {
      final restored = _leftHistory.removeLast();
      _left = restored;
      notifyListeners();
      return DrawerBackResult(
        action: DrawerBackAction.poppedToPreviousDrawer,
        leavingDrawer: leaving,
        restoredDrawer: restored,
      );
    }
    _left = EarthlyDrawer.none;
    notifyListeners();
    return DrawerBackResult(
      action: DrawerBackAction.closedRootDrawer,
      leavingDrawer: leaving,
    );
  }

  DrawerBackResult _popRightSlot() {
    final leaving = _right;
    if (_rightHistory.isNotEmpty) {
      final restored = _rightHistory.removeLast();
      _right = restored;
      notifyListeners();
      return DrawerBackResult(
        action: DrawerBackAction.poppedToPreviousDrawer,
        leavingDrawer: leaving,
        restoredDrawer: restored,
      );
    }
    _right = EarthlyDrawer.none;
    notifyListeners();
    return DrawerBackResult(
      action: DrawerBackAction.closedRootDrawer,
      leavingDrawer: leaving,
    );
  }

  void _pushUnique(List<EarthlyDrawer> stack, EarthlyDrawer drawer) {
    if (drawer == EarthlyDrawer.none) return;
    if (stack.isNotEmpty && stack.last == drawer) return;
    stack.add(drawer);
    if (stack.length > maxHistoryDepth) {
      stack.removeAt(0);
    }
  }
}
