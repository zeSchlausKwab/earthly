import 'dart:ui';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../controllers/draft_workbench_controller.dart';
import '../drawing/drawing_model.dart';
import '../nostr/nip55_signer.dart';
import '../nostr/shelf_renderer.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/geo.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/private_groups.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'earthly_toast.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

enum RustGeoAction {
  simplifyLastLine,
  corridorLastLine,
  extrudeBand,
  arrowLastLine,
  offsetLastLine,
  splitLastLineAtMidpoint,
  connectLines,
  dissolveLines,
  simplifyPolygon,
  offsetLastPolygon,
  insetPolygon,
  unionAllPolygons,
  differenceLastTwoPolygons,
  splitLastPolygonByLine,
  rotateSelected,
  scaleSelected,
  shiftNorth,
  shiftEast,
  mergeMultipart,
  explodeMultipart,
}

enum DraftAudienceChoice {
  publicRelay,
  nearbyLocalNode,
  privateCircle,
}

/// Desk drawer: 2-tab (`Draft` | `Shelf`) workbench for local draft editing,
/// contextual Rust `earthly-geo` spatial tools, and 3-way publish
/// (Public Relay / Nearby Local Node / MLS Group).
class DeskSheet extends StatefulWidget {
  const DeskSheet({
    required this.activeDraftId,
    required this.savedDrafts,
    required this.relayUrls,
    required this.draftTitle,
    required this.audience,
    required this.account,
    required this.shelfMaps,
    required this.deskStories,
    required this.deskAtlases,
    required this.drawnFeatures,
    this.activeAtlasLensName,
    this.provenance = DraftProvenance.fresh,
    this.proposalSummary = '',
    this.onProposalSummaryChanged,
    this.onDetachAsNewCopy,
    this.circles = const <CircleWorkspaceDto>[],
    this.selectedCircleId,
    this.onSelectedCircleChanged,
    this.onOpenCircles,
    required this.onSelectDraft,
    required this.onCreateNewDraft,
    required this.onDeleteDraft,
    required this.onDraftTitleChanged,
    required this.onAudienceChanged,
    required this.onToggleShelfVisibility,
    required this.onRemoveShelfMap,
    required this.onInspectShelfMap,
    required this.onFlyToShelfMap,
    required this.onCloneShelfMapToDraft,
    required this.onOpenShelfDiscussion,
    required this.onOpenDeskStory,
    required this.onRemoveDeskStory,
    required this.onOpenDeskAtlas,
    required this.onRemoveDeskAtlas,
    required this.onRunGeoAction,
    this.onRunParameterizedGeoAction,
    required this.onPublishDraft,
    required this.onComposeStory,
    required this.onCreateAtlas,
    required this.onImportGeoJson,
    this.onImportOsm,
    this.onOpenRouting,
    required this.onExportGeoJsonFile,
    this.onExportGpxFile,
    this.onExportKmlFile,
    this.onExportShapefileZip,
    this.onExportPosterPng,
    required this.onCopyGeoJson,
    this.onPasteGeoJsonFromClipboard,
    this.onValidateDraft,
    this.selectedDraftFeatureIds = const <String>{},
    this.onToggleSelectDraftFeature,
    this.onSelectAllDraftFeatures,
    this.onClearDraftSelection,
    this.onInspectDraftFeature,
    this.onDuplicateSelectedFeatures,
    this.onDeleteSelectedFeatures,
    this.onAddPrimitiveShape,
    required this.onClearDraftFeatures,
    this.canUndo = false,
    this.canRedo = false,
    this.onUndo,
    this.onRedo,
    this.pendingOutboxCount = 0,
    this.onOpenOutbox,
    this.onBack,
    this.isDockedUnderDrawingBar = false,
    this.drawingBar,
    this.dockedInitialFraction = 0.44,
    this.onHeightFractionChanged,
    required this.onClose,
    super.key,
  });

  final String activeDraftId;
  final List<LocalDraftDto> savedDrafts;
  final List<String> relayUrls;
  final String draftTitle;
  final DraftAudienceChoice audience;
  final Nip55Account? account;
  final List<ShelfMapEntry> shelfMaps;
  final List<StorySummaryDto> deskStories;
  final List<AtlasSummaryDto> deskAtlases;
  final List<DrawnFeature> drawnFeatures;
  final String? activeAtlasLensName;
  final DraftProvenance provenance;
  final String proposalSummary;
  final ValueChanged<String>? onProposalSummaryChanged;
  final VoidCallback? onDetachAsNewCopy;
  final List<CircleWorkspaceDto> circles;
  final String? selectedCircleId;
  final ValueChanged<String?>? onSelectedCircleChanged;
  final VoidCallback? onOpenCircles;
  final ValueChanged<LocalDraftDto> onSelectDraft;
  final VoidCallback onCreateNewDraft;
  final ValueChanged<String> onDeleteDraft;
  final ValueChanged<String> onDraftTitleChanged;
  final ValueChanged<DraftAudienceChoice> onAudienceChanged;
  final ValueChanged<String> onToggleShelfVisibility;
  final ValueChanged<String> onRemoveShelfMap;
  final ValueChanged<MapSummaryDto> onInspectShelfMap;
  final ValueChanged<MapSummaryDto> onFlyToShelfMap;
  final ValueChanged<MapSummaryDto> onCloneShelfMapToDraft;
  final ValueChanged<MapSummaryDto> onOpenShelfDiscussion;
  final ValueChanged<StorySummaryDto> onOpenDeskStory;
  final ValueChanged<String> onRemoveDeskStory;
  final ValueChanged<AtlasSummaryDto> onOpenDeskAtlas;
  final ValueChanged<String> onRemoveDeskAtlas;
  final ValueChanged<RustGeoAction> onRunGeoAction;
  final void Function(
    RustGeoAction action, {
    double? meters,
    double? angleDeg,
    double? scale,
  })? onRunParameterizedGeoAction;
  final Future<PublishOutcomeDto> Function(
    String title,
    DraftAudienceChoice audience,
  ) onPublishDraft;
  final VoidCallback onComposeStory;
  final VoidCallback onCreateAtlas;
  final VoidCallback onImportGeoJson;
  final VoidCallback? onImportOsm;
  final VoidCallback? onOpenRouting;
  final VoidCallback onExportGeoJsonFile;
  final VoidCallback? onExportGpxFile;
  final VoidCallback? onExportKmlFile;
  final VoidCallback? onExportShapefileZip;
  final VoidCallback? onExportPosterPng;
  final VoidCallback onCopyGeoJson;
  final VoidCallback? onPasteGeoJsonFromClipboard;
  final Future<DraftValidationDto> Function()? onValidateDraft;
  final Set<String> selectedDraftFeatureIds;
  final ValueChanged<String>? onToggleSelectDraftFeature;
  final VoidCallback? onSelectAllDraftFeatures;
  final VoidCallback? onClearDraftSelection;
  final ValueChanged<DrawnFeature>? onInspectDraftFeature;
  final VoidCallback? onDuplicateSelectedFeatures;
  final VoidCallback? onDeleteSelectedFeatures;
  final Future<void> Function(String shape, double radiusMeters)?
      onAddPrimitiveShape;
  final VoidCallback onClearDraftFeatures;
  final bool canUndo;
  final bool canRedo;
  final VoidCallback? onUndo;
  final VoidCallback? onRedo;
  final int pendingOutboxCount;
  final VoidCallback? onOpenOutbox;
  final VoidCallback? onBack;

  /// When `true`, renders Desk in a compact draw-mode presentation so the user
  /// stays in Drawing Mode while inspecting features, styling, or running
  /// spatial ops. On phones (`width < 880`), docks cohesively directly below
  /// [drawingBar] (or flush beneath an externally positioned bar) with the live
  /// map canvas visible above; on desktop (`width >= 880`), leaves bottom
  /// clearance above the drawing toolbar.
  final bool isDockedUnderDrawingBar;

  /// Optional drawing toolbar widget (typically [MobileDrawingBar] with
  /// `isDockedAboveDesk: true`) mounted flush directly on top of Desk on mobile
  /// when [isDockedUnderDrawingBar] is `true`.
  final Widget? drawingBar;

  /// Initial viewport height fraction for Desk's body when docked in draw mode.
  final double dockedInitialFraction;

  /// Optional height fraction callback forwarded from the sheet container.
  final ValueChanged<double>? onHeightFractionChanged;

  final VoidCallback onClose;

  @override
  State<DeskSheet> createState() => _DeskSheetState();
}

class _DeskSheetState extends State<DeskSheet>
    with SingleTickerProviderStateMixin {
  static const List<double> _meterPresets = <double>[10, 25, 50, 100, 250, 500];
  static const List<double> _dockedSnapPoints = <double>[0.22, 0.44, 0.72];
  static const double _dockedMinFraction = 0.22;
  static const double _dockedMaxFraction = 0.74;
  static const double _dockedDismissThreshold = 0.14;

  late final TabController _tabs;
  late final TextEditingController _titleController;
  late final TextEditingController _proposalSummaryController;
  late DraftAudienceChoice _audience;
  late double _dockedFraction;
  bool _dockedDragging = false;
  String? _localSelectedCircleId;
  double _workbenchMeters = 100;
  bool _publishing = false;
  bool _validating = false;
  String? _publishError;
  PublishOutcomeDto? _publishOutcome;
  DraftValidationDto? _validationResult;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _titleController = TextEditingController(text: widget.draftTitle);
    _proposalSummaryController =
        TextEditingController(text: widget.proposalSummary);
    _audience = widget.audience;
    _dockedFraction = widget.dockedInitialFraction
        .clamp(_dockedMinFraction, _dockedMaxFraction);
    _localSelectedCircleId = widget.selectedCircleId;
  }

  @override
  void didUpdateWidget(covariant DeskSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.activeDraftId != widget.activeDraftId ||
        (oldWidget.draftTitle != widget.draftTitle &&
            _titleController.text != widget.draftTitle)) {
      _titleController.value = TextEditingValue(
        text: widget.draftTitle,
        selection: TextSelection.collapsed(offset: widget.draftTitle.length),
      );
    }
    if (oldWidget.activeDraftId != widget.activeDraftId ||
        (oldWidget.proposalSummary != widget.proposalSummary &&
            _proposalSummaryController.text != widget.proposalSummary)) {
      _proposalSummaryController.value = TextEditingValue(
        text: widget.proposalSummary,
        selection:
            TextSelection.collapsed(offset: widget.proposalSummary.length),
      );
    }
    if (oldWidget.activeDraftId != widget.activeDraftId) {
      _publishError = null;
      _publishOutcome = null;
    }
    if (oldWidget.audience != widget.audience) {
      _audience = widget.audience;
    }
    if (oldWidget.selectedCircleId != widget.selectedCircleId) {
      _localSelectedCircleId = widget.selectedCircleId;
    }
    if (oldWidget.drawnFeatures.length != widget.drawnFeatures.length) {
      _validationResult = null;
    }
    if (!oldWidget.isDockedUnderDrawingBar && widget.isDockedUnderDrawingBar) {
      _dockedFraction = widget.dockedInitialFraction
          .clamp(_dockedMinFraction, _dockedMaxFraction);
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    _titleController.dispose();
    _proposalSummaryController.dispose();
    super.dispose();
  }

  CircleWorkspaceDto? _resolveSelectedCircle() {
    if (widget.circles.isEmpty) return null;
    final preferredId = widget.selectedCircleId ?? _localSelectedCircleId;
    if (preferredId != null) {
      final matched = widget.circles
          .where((c) => c.workspaceId == preferredId)
          .firstOrNull;
      if (matched != null) return matched;
    }
    return widget.circles.first;
  }

  void _triggerGeoAction(
    RustGeoAction action, {
    double? meters,
    double? angleDeg,
    double? scale,
  }) {
    if (widget.onRunParameterizedGeoAction != null) {
      widget.onRunParameterizedGeoAction!(
        action,
        meters: meters ?? _workbenchMeters,
        angleDeg: angleDeg,
        scale: scale,
      );
    } else {
      widget.onRunGeoAction(action);
    }
  }

  Future<void> _handleValidate() async {
    if (_validating || widget.onValidateDraft == null) return;
    setState(() => _validating = true);
    try {
      final res = await widget.onValidateDraft!();
      if (mounted) setState(() => _validationResult = res);
    } catch (err) {
      if (mounted) {
        setState(
          () => _validationResult = DraftValidationDto(
            valid: false,
            featureCount: 0,
            message: err.toString(),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _validating = false);
    }
  }

  Future<void> _copyNaddr({
    required int kind,
    required String pubkey,
    required String dTag,
  }) async {
    try {
      await RustBridge.ensureInitialized();
      final uri = await encodeNaddrCoordinate(
        kind: kind,
        pubkeyHex: pubkey,
        dTag: dTag,
        relays: widget.relayUrls,
      );
      await Clipboard.setData(ClipboardData(text: uri));
      if (!mounted) return;
      EarthlyToast.success(context, 'Copied nostr:naddr1… link');
    } catch (_) {}
  }

  Future<void> _handlePublish() async {
    setState(() {
      _publishing = true;
      _publishError = null;
      _publishOutcome = null;
    });
    try {
      final trimmed = _titleController.text.trim();
      final title = trimmed.isEmpty ? 'Untitled Map' : trimmed;
      if (trimmed.isNotEmpty) {
        widget.onDraftTitleChanged(title);
      }
      final outcome = await widget.onPublishDraft(title, _audience);
      if (!mounted) return;
      setState(() => _publishOutcome = outcome);
    } catch (error) {
      if (!mounted) return;
      setState(() => _publishError = error.toString());
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  Color _parseColor(String? hex, Color fallback) {
    if (hex == null || !hex.startsWith('#') || hex.length != 7) return fallback;
    final parsed = int.tryParse(hex.substring(1), radix: 16);
    return parsed != null ? Color(0xFF000000 | parsed) : fallback;
  }

  Widget _buildSectionCard(
    ThemeData theme, {
    required Widget child,
  }) {
    return Material(
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.72),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: theme.dividerColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: child,
    );
  }

  Widget _buildToolbarCell({
    Key? key,
    required ThemeData theme,
    required IconData icon,
    required String label,
    required VoidCallback? onTap,
  }) {
    final enabled = onTap != null;
    final fg = enabled
        ? theme.colorScheme.onSurface
        : theme.colorScheme.onSurface.withValues(alpha: 0.36);
    return Expanded(
      child: InkWell(
        key: key,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 7),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 17, color: fg),
              const SizedBox(height: 2),
              Text(
                label,
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildProvenanceBanner(ThemeData theme) {
    final prov = widget.provenance;
    if (prov.isNew) return const SizedBox.shrink();

    final (
      Color accent,
      IconData icon,
      String heading,
      String detail,
      bool showDetach,
    ) = switch (prov.mode) {
      DraftPublishMode.updatingOwned => (
          EarthlyColors.commentGreen,
          Icons.edit_note,
          'Editing your map',
          prov.targetCircleName != null
              ? 'Updates "${prov.sourceTitle ?? 'map'}" in "${prov.targetCircleName}" in place'
              : 'Updates "${prov.sourceTitle ?? 'map'}" in place',
          true,
        ),
      DraftPublishMode.copyingOther => (
          theme.colorScheme.primary,
          Icons.copy_all_outlined,
          'Creating your own copy',
          'Based on "${prov.sourceTitle ?? 'map'}"'
              '${prov.sourceAuthorLabel != null ? ' by ${prov.sourceAuthorLabel}' : ''}'
              ' · original stays untouched',
          false,
        ),
      DraftPublishMode.proposingEdit => (
          EarthlyColors.proposedAmber,
          Icons.compare_arrows,
          'Proposing edit',
          'To "${prov.sourceTitle ?? 'map'}"'
              '${prov.sourceAuthorLabel != null ? ' by ${prov.sourceAuthorLabel}' : ''}'
              ' · owner can accept & apply',
          true,
        ),
      DraftPublishMode.newMap => (
          theme.colorScheme.primary,
          Icons.add,
          '',
          '',
          false,
        ),
    };

    return Container(
      key: const Key('desk-provenance-banner'),
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(10, 8, 8, 8),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.11),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: accent.withValues(alpha: 0.45)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 17, color: accent),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  heading,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: accent,
                  ),
                ),
                Text(
                  detail,
                  style: theme.textTheme.bodySmall?.copyWith(fontSize: 11),
                ),
              ],
            ),
          ),
          if (showDetach && widget.onDetachAsNewCopy != null)
            TextButton(
              key: const Key('desk-detach-copy-btn'),
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                minimumSize: const Size(0, 32),
                padding: const EdgeInsets.symmetric(horizontal: 6),
                textStyle: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
              onPressed: widget.onDetachAsNewCopy,
              child: const Text(
                'Save as Copy',
                maxLines: 1,
                softWrap: false,
              ),
            ),
        ],
      ),
    );
  }

  String _resolvePublishButtonLabel(CircleWorkspaceDto? selectedCircle) {
    final prov = widget.provenance;
    if (prov.isProposingEdit) {
      if (prov.targetCircleName != null && prov.targetCircleName!.isNotEmpty) {
        return 'Send Edit Proposal to "${prov.targetCircleName}"';
      }
      if (selectedCircle != null &&
          _audience == DraftAudienceChoice.privateCircle) {
        return 'Send Edit Proposal to "${selectedCircle.name}"';
      }
      return 'Send Edit Proposal (37519)';
    }
    if (prov.isUpdatingOwned) {
      if (_audience == DraftAudienceChoice.privateCircle) {
        return selectedCircle != null
            ? 'Update in "${selectedCircle.name}"'
            : 'Select an MLS Group';
      }
      if (widget.account == null) return 'Sign & Update Map';
      return _audience == DraftAudienceChoice.publicRelay
          ? 'Update on relay.earthly.city'
          : 'Update on Nearby Local Node';
    }
    if (prov.isCopyingOther) {
      if (_audience == DraftAudienceChoice.privateCircle) {
        return selectedCircle != null
            ? 'Publish Copy to "${selectedCircle.name}"'
            : 'Select an MLS Group';
      }
      if (widget.account == null) return 'Sign & Publish Copy';
      return _audience == DraftAudienceChoice.publicRelay
          ? 'Publish Copy to relay.earthly.city'
          : 'Publish Copy to Nearby Local Node';
    }
    if (_audience == DraftAudienceChoice.privateCircle) {
      return selectedCircle != null
          ? 'Publish to "${selectedCircle.name}"'
          : 'Select an MLS Group';
    }
    if (widget.account == null) return 'Sign & Publish Map';
    return _audience == DraftAudienceChoice.publicRelay
        ? 'Publish to relay.earthly.city'
        : 'Publish to Nearby Local Node';
  }

  void _setDockedFraction(double next) {
    final clamped = next.clamp(0.0, _dockedMaxFraction);
    if ((clamped - _dockedFraction).abs() < 0.0005) return;
    setState(() => _dockedFraction = clamped);
    widget.onHeightFractionChanged?.call(clamped);
  }

  void _snapDockedWithVelocity(double velocityPxPerSec) {
    final shouldClose = _dockedFraction < _dockedDismissThreshold ||
        (velocityPxPerSec > 750 && _dockedFraction < 0.42) ||
        (velocityPxPerSec > 350 && _dockedFraction <= 0.24);
    if (shouldClose) {
      setState(() => _dockedDragging = false);
      HapticFeedback.selectionClick();
      widget.onClose();
      return;
    }

    double target;
    if (velocityPxPerSec < -350) {
      target = _dockedSnapPoints.firstWhere(
        (s) => s > _dockedFraction + 0.04,
        orElse: () => _dockedSnapPoints.last,
      );
    } else if (velocityPxPerSec > 350) {
      target = _dockedSnapPoints.lastWhere(
        (s) => s < _dockedFraction - 0.04,
        orElse: () => _dockedSnapPoints.first,
      );
    } else {
      target = _dockedSnapPoints.reduce(
        (a, b) =>
            (a - _dockedFraction).abs() <= (b - _dockedFraction).abs() ? a : b,
      );
    }
    setState(() {
      _dockedDragging = false;
      _dockedFraction = target.clamp(_dockedMinFraction, _dockedMaxFraction);
    });
    widget.onHeightFractionChanged?.call(_dockedFraction);
  }

  void _cycleDockedSnap() {
    final next = _dockedFraction < 0.34
        ? 0.44
        : _dockedFraction < 0.62
            ? 0.72
            : 0.44;
    setState(() => _dockedFraction = next);
    widget.onHeightFractionChanged?.call(_dockedFraction);
  }

  Widget _buildHeader(ThemeData theme, {required bool compact}) {
    final isDark = theme.brightness == Brightness.dark;
    final row = Padding(
      padding: EdgeInsets.fromLTRB(widget.onBack != null ? 4 : 8, 0, 4, 0),
      child: Row(
        children: [
          if (widget.onBack != null)
            IconButton(
              key: const Key('desk-back-btn'),
              tooltip: 'Back',
              visualDensity: VisualDensity.compact,
              constraints: const BoxConstraints(
                minWidth: 34,
                minHeight: 34,
              ),
              padding: EdgeInsets.zero,
              onPressed: widget.onBack,
              icon: const Icon(Icons.arrow_back, size: 18),
            ),
          Expanded(
            child: TabBar(
              controller: _tabs,
              dividerHeight: 0,
              tabAlignment: TabAlignment.fill,
              tabs: const [
                Tab(key: Key('desk-tab-draft'), text: 'Draft'),
                Tab(key: Key('desk-tab-shelf'), text: 'Shelf'),
              ],
            ),
          ),
          if (compact) ...[
            const SizedBox(width: 4),
            Container(
              key: const Key('desk-drawing-mode-badge'),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: EarthlyColors.amber
                    .withValues(alpha: isDark ? 0.20 : 0.16),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: EarthlyColors.amber.withValues(alpha: 0.65),
                ),
              ),
              child: Text(
                'DRAW',
                maxLines: 1,
                softWrap: false,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 9,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.5,
                  color:
                      isDark ? EarthlyColors.amber : EarthlyColors.lightAccent,
                ),
              ),
            ),
            const SizedBox(width: 2),
          ],
          IconButton(
            key: const Key('desk-close-btn'),
            tooltip: compact ? 'Hide Desk' : 'Close',
            visualDensity: VisualDensity.compact,
            constraints: compact
                ? const BoxConstraints(minWidth: 34, minHeight: 34)
                : null,
            padding: compact ? EdgeInsets.zero : null,
            onPressed: widget.onClose,
            icon: const Icon(Icons.close, size: 18),
          ),
        ],
      ),
    );
    return compact ? SizedBox(height: 40, child: row) : row;
  }

  Widget _buildDockedInDrawingMode(BuildContext context, ThemeData theme) {
    final isDark = theme.brightness == Brightness.dark;
    final size = MediaQuery.sizeOf(context);
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    final isDesktop = size.width >= 880;
    final accentBorder =
        EarthlyColors.amber.withValues(alpha: isDark ? 0.72 : 0.85);
    final body = TabBarView(
      controller: _tabs,
      children: [
        _buildDraftTab(theme),
        _buildShelfTab(theme),
      ],
    );

    if (isDesktop) {
      final effectiveSide =
          EarthlyDrawerPlacement.maybeOf(context) ?? EarthlyDrawerSide.left;
      final isRight = effectiveSide == EarthlyDrawerSide.right;
      final panelWidth = size.width >= 1240 ? 416.0 : 372.0;
      return Positioned(
        key: const Key('desk-docked-drawing-stack'),
        top: 64,
        left: isRight ? null : 12,
        right: isRight ? 12 : null,
        bottom: 84,
        width: panelWidth,
        child: EarthlyGlassSurface(
          borderRadius: BorderRadius.circular(18),
          blurSigma: 18,
          color:
              theme.colorScheme.surface.withValues(alpha: isDark ? 0.90 : 0.93),
          borderColor: accentBorder,
          borderWidth: 1.5,
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
                const SizedBox(height: 4),
                _buildHeader(theme, compact: true),
                const Divider(height: 1),
                Expanded(
                  child: MediaQuery.removePadding(
                    context: context,
                    removeTop: true,
                    child: body,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    // Mobile cohesive bottom stack: Map visible on top -> Drawing Toolbar -> Desk below.
    final availableHeight =
        (size.height - keyboardInset).clamp(240.0, size.height);
    final maxBodyHeight =
        (availableHeight - 140.0).clamp(120.0, availableHeight * _dockedMaxFraction);
    final deskBodyHeight =
        (availableHeight * _dockedFraction).clamp(64.0, maxBodyHeight);
    final dismissOpacity = _dockedFraction < _dockedMinFraction
        ? (_dockedFraction / _dockedMinFraction).clamp(0.40, 1.0)
        : 1.0;
    final topRadius = widget.drawingBar != null
        ? const BorderRadius.vertical(top: Radius.circular(20))
        : BorderRadius.zero;

    Widget wrapDragHandle(Widget child, {Key? key}) {
      return GestureDetector(
        key: key,
        behavior: HitTestBehavior.opaque,
        onTap: _cycleDockedSnap,
        onVerticalDragStart: (_) => setState(() => _dockedDragging = true),
        onVerticalDragUpdate: (details) {
          final deltaFraction = -details.delta.dy / availableHeight;
          _setDockedFraction(_dockedFraction + deltaFraction);
        },
        onVerticalDragEnd: (details) {
          _snapDockedWithVelocity(details.primaryVelocity ?? 0);
        },
        child: child,
      );
    }

    return Positioned(
      key: const Key('desk-docked-drawing-stack'),
      left: 0,
      right: 0,
      bottom: keyboardInset,
      child: Opacity(
        opacity: dismissOpacity,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: topRadius,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDark ? 0.48 : 0.20),
                blurRadius: 24,
                offset: const Offset(0, -6),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: topRadius,
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
              child: Container(
                decoration: BoxDecoration(
                  color: theme.colorScheme.surface
                      .withValues(alpha: isDark ? 0.93 : 0.96),
                  borderRadius: topRadius,
                  border: Border(
                    top: BorderSide(color: accentBorder, width: 1.8),
                  ),
                ),
                child: Material(
                  type: MaterialType.transparency,
                  child: SafeArea(
                    top: false,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        wrapDragHandle(
                          Padding(
                            padding: const EdgeInsets.only(top: 7, bottom: 3),
                            child: Center(
                              child: Container(
                                width: 38,
                                height: 4,
                                decoration: BoxDecoration(
                                  color: _dockedFraction < _dockedDismissThreshold
                                      ? EarthlyColors.destructive
                                          .withValues(alpha: 0.78)
                                      : EarthlyColors.amber
                                          .withValues(alpha: 0.85),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                              ),
                            ),
                          ),
                          key: const Key('desk-docked-drag-handle'),
                        ),
                        if (widget.drawingBar != null) ...[
                          widget.drawingBar!,
                          const Divider(height: 1),
                        ],
                        AnimatedContainer(
                          duration: _dockedDragging
                              ? Duration.zero
                              : const Duration(milliseconds: 220),
                          curve: Curves.easeOutCubic,
                          height: deskBodyHeight,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              wrapDragHandle(_buildHeader(theme, compact: true)),
                              const Divider(height: 1),
                              Expanded(
                                child: MediaQuery.removePadding(
                                  context: context,
                                  removeTop: true,
                                  child: body,
                                ),
                              ),
                            ],
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (widget.isDockedUnderDrawingBar) {
      return _buildDockedInDrawingMode(context, theme);
    }
    return EarthlyMapDrawer(
      initialFraction: 0.56,
      onClose: widget.onClose,
      onHeightFractionChanged: widget.onHeightFractionChanged,
      header: _buildHeader(theme, compact: false),
      body: TabBarView(
        controller: _tabs,
        children: [
          _buildDraftTab(theme),
          _buildShelfTab(theme),
        ],
      ),
    );
  }

  Widget _buildDraftTab(ThemeData theme) {
    final selectedIds = widget.selectedDraftFeatureIds;
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
    final hasTitleOrFeatures = widget.drawnFeatures.isNotEmpty ||
        _titleController.text.trim().isNotEmpty;
    final selectedCircle = _resolveSelectedCircle();
    final canExport = widget.drawnFeatures.isNotEmpty ||
        widget.shelfMaps.any((m) => m.visible);
    final canPublish = !_publishing &&
        widget.drawnFeatures.isNotEmpty &&
        (_audience != DraftAudienceChoice.privateCircle ||
            selectedCircle != null);

    return MediaQuery.removePadding(
      context: context,
      removeTop: true,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 24),
        children: [
          // Compact draft header bar: feature count + Validate + Undo/Redo/+ New/Clear
          Row(
            children: [
              Text(
                '${widget.drawnFeatures.length} feature${widget.drawnFeatures.length == 1 ? '' : 's'}',
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Align(
                  alignment: Alignment.centerRight,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerRight,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (widget.onValidateDraft != null &&
                            widget.drawnFeatures.isNotEmpty)
                          TextButton.icon(
                            key: const Key('desk-validate-draft-btn'),
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 6),
                            ),
                            onPressed: _validating ? null : _handleValidate,
                            icon: const Icon(Icons.verified_outlined, size: 15),
                            label: Text(
                              _validating ? 'Checking…' : 'Check',
                              maxLines: 1,
                              softWrap: false,
                            ),
                          ),
                        if (widget.onUndo != null)
                          IconButton(
                            tooltip: 'Undo draft change (Cmd+Z)',
                            visualDensity: VisualDensity.compact,
                            constraints: const BoxConstraints(
                              minWidth: 34,
                              minHeight: 34,
                            ),
                            padding: EdgeInsets.zero,
                            onPressed: widget.canUndo ? widget.onUndo : null,
                            icon: const Icon(Icons.undo, size: 17),
                          ),
                        if (widget.onRedo != null)
                          IconButton(
                            tooltip: 'Redo draft change (Cmd+Shift+Z)',
                            visualDensity: VisualDensity.compact,
                            constraints: const BoxConstraints(
                              minWidth: 34,
                              minHeight: 34,
                            ),
                            padding: EdgeInsets.zero,
                            onPressed: widget.canRedo ? widget.onRedo : null,
                            icon: const Icon(Icons.redo, size: 17),
                          ),
                        TextButton.icon(
                          key: const Key('desk-new-draft-btn'),
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                            padding: const EdgeInsets.symmetric(horizontal: 6),
                          ),
                          onPressed: widget.onCreateNewDraft,
                          icon: const Icon(Icons.add, size: 15),
                          label: const Text(
                            'New',
                            maxLines: 1,
                            softWrap: false,
                          ),
                        ),
                        if (hasTitleOrFeatures)
                          TextButton(
                            key: const Key('desk-clear-draft-btn'),
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 6),
                            ),
                            onPressed: widget.onClearDraftFeatures,
                            child: const Text(
                              'Clear',
                              maxLines: 1,
                              softWrap: false,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),

          if (widget.savedDrafts.length > 1) ...[
            const SizedBox(height: 4),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final d in widget.savedDrafts)
                    Padding(
                      padding: const EdgeInsets.only(right: 6, bottom: 4),
                      child: InputChip(
                        label: Text(
                          d.title.trim().isEmpty
                              ? 'Untitled Map'
                              : d.title.trim(),
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 11,
                          ),
                        ),
                        selected: d.draftId == widget.activeDraftId,
                        onPressed: () => widget.onSelectDraft(d),
                        onDeleted: widget.savedDrafts.length > 1
                            ? () => widget.onDeleteDraft(d.draftId)
                            : null,
                      ),
                    ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 6),
          _buildProvenanceBanner(theme),
          TextField(
            key: const Key('desk-draft-title-field'),
            controller: _titleController,
            onChanged: (value) {
              setState(() {});
              widget.onDraftTitleChanged(value);
            },
            decoration: InputDecoration(
              hintText: 'Untitled map',
              suffixIcon: _titleController.text.isNotEmpty
                  ? IconButton(
                      key: const Key('desk-clear-title-btn'),
                      tooltip: 'Clear title',
                      visualDensity: VisualDensity.compact,
                      onPressed: () {
                        _titleController.clear();
                        widget.onDraftTitleChanged('');
                        setState(() {});
                      },
                      icon: const Icon(Icons.close, size: 16),
                    )
                  : null,
            ),
          ),
          const SizedBox(height: 8),

          // Single-row unified segmented toolbar (zero wrapping pills!)
          Material(
            key: const Key('desk-action-toolbar'),
            color: theme.colorScheme.surfaceContainerHighest
                .withValues(alpha: 0.7),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(11),
              side: BorderSide(color: theme.dividerColor),
            ),
            clipBehavior: Clip.antiAlias,
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildToolbarCell(
                    key: const Key('desk-import-file-btn'),
                    theme: theme,
                    icon: Icons.file_upload_outlined,
                    label: 'Import',
                    onTap: widget.onImportGeoJson,
                  ),
                  if (widget.onImportOsm != null) ...[
                    VerticalDivider(width: 1, color: theme.dividerColor),
                    _buildToolbarCell(
                      key: const Key('desk-import-osm-btn'),
                      theme: theme,
                      icon: Icons.public_outlined,
                      label: 'OSM',
                      onTap: widget.onImportOsm,
                    ),
                  ],
                  if (widget.onOpenRouting != null) ...[
                    VerticalDivider(width: 1, color: theme.dividerColor),
                    _buildToolbarCell(
                      key: const Key('desk-routing-btn'),
                      theme: theme,
                      icon: Icons.alt_route,
                      label: 'Route',
                      onTap: widget.onOpenRouting,
                    ),
                  ],
                  if (widget.onPasteGeoJsonFromClipboard != null) ...[
                    VerticalDivider(width: 1, color: theme.dividerColor),
                    _buildToolbarCell(
                      key: const Key('desk-paste-geojson-btn'),
                      theme: theme,
                      icon: Icons.content_paste,
                      label: 'Paste',
                      onTap: widget.onPasteGeoJsonFromClipboard,
                    ),
                  ],
                  VerticalDivider(width: 1, color: theme.dividerColor),
                  Expanded(
                    child: PopupMenuButton<String>(
                      key: const Key('desk-export-menu-btn'),
                      enabled: canExport,
                      tooltip: 'Export working draft',
                      onSelected: (choice) {
                        switch (choice) {
                          case 'geojson':
                            widget.onExportGeoJsonFile();
                          case 'gpx':
                            widget.onExportGpxFile?.call();
                          case 'kml':
                            widget.onExportKmlFile?.call();
                          case 'shp':
                            widget.onExportShapefileZip?.call();
                          case 'poster':
                            widget.onExportPosterPng?.call();
                          case 'copy':
                            widget.onCopyGeoJson();
                        }
                      },
                      itemBuilder: (_) => [
                        const PopupMenuItem(
                          value: 'geojson',
                          child: Text('Export GeoJSON (.geojson)'),
                        ),
                        if (widget.onExportGpxFile != null)
                          const PopupMenuItem(
                            value: 'gpx',
                            child: Text('Export GPX Track/Waypoints (.gpx)'),
                          ),
                        if (widget.onExportKmlFile != null)
                          const PopupMenuItem(
                            value: 'kml',
                            child: Text('Export Google Earth KML (.kml)'),
                          ),
                        if (widget.onExportShapefileZip != null)
                          const PopupMenuItem(
                            key: Key('desk-export-shapefile-zip'),
                            value: 'shp',
                            child: Text('Export Shapefile Bundle (.zip)'),
                          ),
                        if (widget.onExportPosterPng != null)
                          const PopupMenuItem(
                            key: Key('desk-export-poster-png'),
                            value: 'poster',
                            child: Text('Export Map Poster (.png)'),
                          ),
                        const PopupMenuItem(
                          value: 'copy',
                          child: Text('Copy GeoJSON to Clipboard'),
                        ),
                      ],
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 4,
                          vertical: 7,
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.file_download_outlined,
                              size: 17,
                              color: canExport
                                  ? theme.colorScheme.onSurface
                                  : theme.colorScheme.onSurface
                                      .withValues(alpha: 0.36),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Export ▾',
                              maxLines: 1,
                              softWrap: false,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: canExport
                                    ? theme.colorScheme.onSurface
                                    : theme.colorScheme.onSurface
                                        .withValues(alpha: 0.36),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          if (_validationResult != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
              decoration: BoxDecoration(
                color: (_validationResult!.valid
                        ? EarthlyColors.commentGreen
                        : EarthlyColors.destructive)
                    .withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: (_validationResult!.valid
                          ? EarthlyColors.commentGreen
                          : EarthlyColors.destructive)
                      .withValues(alpha: 0.5),
                ),
              ),
              child: Text(
                '${_validationResult!.valid ? '✓' : '✗'} ${_validationResult!.message}',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: _validationResult!.valid
                      ? EarthlyColors.commentGreen
                      : EarthlyColors.destructive,
                ),
              ),
            ),
          ],

          // Features collapsible section (expanded when 1..5 features, collapsed when >5, hidden when empty)
          if (widget.drawnFeatures.isNotEmpty) ...[
            const SizedBox(height: 10),
            _buildSectionCard(
              theme,
              child: ExpansionTile(
                key: ValueKey<String>(
                  'desk-features-${widget.activeDraftId}-${widget.drawnFeatures.length <= 5}',
                ),
                initiallyExpanded: widget.drawnFeatures.length <= 5,
                shape: const Border(),
                collapsedShape: const Border(),
                tilePadding: const EdgeInsets.symmetric(horizontal: 12),
                childrenPadding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
                title: Row(
                  children: [
                    Flexible(
                      child: Text(
                        'Features (${widget.drawnFeatures.length})',
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall,
                      ),
                    ),
                    if (selectedIds.isNotEmpty) ...[
                      const SizedBox(width: 8),
                      EarthlyBadge(
                        label: '${selectedIds.length} selected',
                        color: EarthlyColors.amber,
                      ),
                    ],
                  ],
                ),
                children: [
                  if (widget.onToggleSelectDraftFeature != null)
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            selectedIds.isEmpty
                                ? 'Tap row to select'
                                : '${selectedIds.length} of ${widget.drawnFeatures.length} selected',
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodySmall,
                          ),
                        ),
                        if (selectedIds.length < widget.drawnFeatures.length &&
                            widget.onSelectAllDraftFeatures != null)
                          TextButton(
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              minimumSize: const Size(0, 30),
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 6),
                            ),
                            onPressed: widget.onSelectAllDraftFeatures,
                            child: const Text(
                              'Select All',
                              maxLines: 1,
                              softWrap: false,
                            ),
                          ),
                        if (selectedIds.isNotEmpty &&
                            widget.onClearDraftSelection != null)
                          TextButton(
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              minimumSize: const Size(0, 30),
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 6),
                            ),
                            onPressed: widget.onClearDraftSelection,
                            child: const Text(
                              'Clear',
                              maxLines: 1,
                              softWrap: false,
                            ),
                          ),
                      ],
                    ),
                  if (selectedIds.isNotEmpty &&
                      (widget.onDuplicateSelectedFeatures != null ||
                          widget.onDeleteSelectedFeatures != null)) ...[
                    const SizedBox(height: 4),
                    Row(
                      key: const Key('desk-selection-actions-row'),
                      children: [
                        if (widget.onDuplicateSelectedFeatures != null)
                          Expanded(
                            child: OutlinedButton.icon(
                              key: const Key('desk-duplicate-selected-btn'),
                              style: OutlinedButton.styleFrom(
                                visualDensity: VisualDensity.compact,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                minimumSize: const Size(0, 34),
                                padding:
                                    const EdgeInsets.symmetric(horizontal: 8),
                              ),
                              onPressed: widget.onDuplicateSelectedFeatures,
                              icon: const Icon(
                                Icons.control_point_duplicate,
                                size: 15,
                              ),
                              label: Text(
                                'Duplicate (${selectedIds.length})',
                                maxLines: 1,
                                softWrap: false,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                        if (widget.onDuplicateSelectedFeatures != null &&
                            widget.onDeleteSelectedFeatures != null)
                          const SizedBox(width: 6),
                        if (widget.onDeleteSelectedFeatures != null)
                          Expanded(
                            child: OutlinedButton.icon(
                              key: const Key('desk-delete-selected-btn'),
                              style: OutlinedButton.styleFrom(
                                visualDensity: VisualDensity.compact,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                minimumSize: const Size(0, 34),
                                padding:
                                    const EdgeInsets.symmetric(horizontal: 8),
                                foregroundColor: EarthlyColors.destructive,
                                side: const BorderSide(
                                  color: EarthlyColors.destructive,
                                ),
                              ),
                              onPressed: widget.onDeleteSelectedFeatures,
                              icon: const Icon(Icons.delete_outline, size: 15),
                              label: Text(
                                'Delete (${selectedIds.length})',
                                maxLines: 1,
                                softWrap: false,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                  ],
                  for (var i = 0; i < widget.drawnFeatures.length; i++)
                    _buildFeatureRow(theme, widget.drawnFeatures[i], i),
                ],
              ),
            ),
          ],

          // Contextual Spatial Tools (collapsed by default, hidden when empty)
          if (widget.drawnFeatures.isNotEmpty) ...[
            const SizedBox(height: 8),
            _buildSectionCard(
              theme,
              child: ExpansionTile(
                key: const Key('desk-spatial-tools-tile'),
                initiallyExpanded: false,
                shape: const Border(),
                collapsedShape: const Border(),
                tilePadding: const EdgeInsets.symmetric(horizontal: 12),
                childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                title: Row(
                  children: [
                    const Icon(Icons.tune, size: 16),
                    const SizedBox(width: 8),
                    Text('Spatial Tools', style: theme.textTheme.titleSmall),
                  ],
                ),
                subtitle: Text(
                  selectedIds.isEmpty
                      ? 'Apply to latest or all matching'
                      : '${selectedIds.length} selected · $mLabel step',
                  style: theme.textTheme.bodySmall,
                ),
                children: [
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        const Text(
                          'STEP: ',
                          style:
                              TextStyle(fontFamily: 'monospace', fontSize: 10.5),
                        ),
                        for (final m in _meterPresets)
                          Padding(
                            padding: const EdgeInsets.only(right: 5),
                            child: ChoiceChip(
                              key: Key('workbench-meters-${m.round()}'),
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
                  _buildSpatialActionGrid(
                    <Widget>[
                      if (hasLine) ...[
                        _buildSpatialActionButton(
                          label: 'Simplify Line ($mLabel)',
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.simplifyLastLine),
                        ),
                        _buildSpatialActionButton(
                          label: 'Corridor ($mLabel)',
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.corridorLastLine),
                        ),
                        _buildSpatialActionButton(
                          label: 'Tapered Band ($mLabel)',
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.extrudeBand),
                        ),
                        _buildSpatialActionButton(
                          label: 'Flow Arrow ($mLabel)',
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.arrowLastLine),
                        ),
                        _buildSpatialActionButton(
                          label: 'Parallel (+$mLabel)',
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.offsetLastLine),
                        ),
                        _buildSpatialActionButton(
                          label: 'Split Line (50%)',
                          onPressed: () => _triggerGeoAction(
                            RustGeoAction.splitLastLineAtMidpoint,
                          ),
                        ),
                        if (lineCount >= 2) ...[
                          _buildSpatialActionButton(
                            key: const Key('workbench-connect-lines'),
                            label: 'Connect Lines ($lineCount)',
                            onPressed: () =>
                                _triggerGeoAction(RustGeoAction.connectLines),
                          ),
                          _buildSpatialActionButton(
                            key: const Key('workbench-dissolve-lines'),
                            label: 'Dissolve Lines ($lineCount)',
                            onPressed: () =>
                                _triggerGeoAction(RustGeoAction.dissolveLines),
                          ),
                        ],
                      ],
                      if (polyCount >= 1) ...[
                        _buildSpatialActionButton(
                          key: const Key('workbench-simplify-polygon'),
                          label: 'Simplify Area ($mLabel)',
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.simplifyPolygon),
                        ),
                        _buildSpatialActionButton(
                          label: 'Expand Area (+$mLabel)',
                          onPressed: () => _triggerGeoAction(
                            RustGeoAction.offsetLastPolygon,
                          ),
                        ),
                        _buildSpatialActionButton(
                          key: const Key('workbench-inset-polygon'),
                          label: 'Inset Area (−$mLabel)',
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.insetPolygon),
                        ),
                        if (polyCount >= 2) ...[
                          _buildSpatialActionButton(
                            label: 'Union Areas ($polyCount)',
                            onPressed: () => _triggerGeoAction(
                              RustGeoAction.unionAllPolygons,
                            ),
                          ),
                          _buildSpatialActionButton(
                            label: 'Difference (A − B)',
                            onPressed: () => _triggerGeoAction(
                              RustGeoAction.differenceLastTwoPolygons,
                            ),
                          ),
                        ],
                        if (hasLine)
                          _buildSpatialActionButton(
                            label: 'Split Area by Line',
                            onPressed: () => _triggerGeoAction(
                              RustGeoAction.splitLastPolygonByLine,
                            ),
                          ),
                      ],
                      if (hasAnyTarget) ...[
                        _buildSpatialActionButton(
                          key: const Key('workbench-rotate-selected'),
                          label: 'Rotate +15°',
                          onPressed: () => _triggerGeoAction(
                            RustGeoAction.rotateSelected,
                            angleDeg: 15,
                          ),
                        ),
                        _buildSpatialActionButton(
                          key: const Key('workbench-scale-selected'),
                          label: 'Scale ×1.2',
                          onPressed: () => _triggerGeoAction(
                            RustGeoAction.scaleSelected,
                            scale: 1.2,
                          ),
                        ),
                        if (canMergeMultipart)
                          _buildSpatialActionButton(
                            key: const Key('workbench-merge-multipart'),
                            label: 'Merge Multipart',
                            onPressed: () =>
                                _triggerGeoAction(RustGeoAction.mergeMultipart),
                          ),
                        if (hasMultipart)
                          _buildSpatialActionButton(
                            key: const Key('workbench-explode-multipart'),
                            label: 'Explode Multipart',
                            onPressed: () => _triggerGeoAction(
                              RustGeoAction.explodeMultipart,
                            ),
                          ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 14),

          if (widget.provenance.isProposingEdit) ...[
            Text(
              'EDIT PROPOSAL NOTE',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              key: const Key('desk-proposal-summary-field'),
              controller: _proposalSummaryController,
              maxLines: 2,
              minLines: 1,
              onChanged: (v) => widget.onProposalSummaryChanged?.call(v),
              decoration: const InputDecoration(
                hintText: 'Summarize your proposed edit (optional)…',
              ),
            ),
          ] else ...[
            // Always-visible 3-way Publish section (Public | Nearby | MLS Group)
            Text(
              'PUBLISH TARGET',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            _buildAudienceSegmentedControl(theme),

            if (_audience == DraftAudienceChoice.privateCircle) ...[
              const SizedBox(height: 8),
              if (widget.circles.isEmpty)
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: EarthlyColors.measureViolet.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color:
                          EarthlyColors.measureViolet.withValues(alpha: 0.45),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          const Icon(
                            Icons.lock_outline,
                            size: 16,
                            color: EarthlyColors.measureViolet,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'No MLS groups yet',
                              style: theme.textTheme.titleSmall,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Create or join an encrypted MLS group to publish private maps.',
                        style: theme.textTheme.bodySmall,
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        key: const Key('desk-create-join-mls-btn'),
                        onPressed: widget.onOpenCircles,
                        icon: const Icon(Icons.groups_outlined, size: 17),
                        label: const Text('Create or Join MLS Group'),
                      ),
                    ],
                  ),
                )
              else ...[
                for (final circle in widget.circles)
                  Builder(
                    builder: (_) {
                      final isSelected =
                          selectedCircle?.workspaceId == circle.workspaceId;
                      return InkWell(
                        key: Key('desk-mls-group-${circle.workspaceId}'),
                        onTap: () {
                          setState(
                            () => _localSelectedCircleId = circle.workspaceId,
                          );
                          widget.onSelectedCircleChanged
                              ?.call(circle.workspaceId);
                        },
                        borderRadius: BorderRadius.circular(10),
                        child: Container(
                          margin: const EdgeInsets.only(bottom: 6),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: isSelected
                                ? EarthlyColors.measureViolet
                                    .withValues(alpha: 0.14)
                                : theme.colorScheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: isSelected
                                  ? EarthlyColors.measureViolet
                                  : theme.dividerColor,
                              width: isSelected ? 1.5 : 1.0,
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                isSelected
                                    ? Icons.radio_button_checked
                                    : Icons.radio_button_off,
                                size: 16,
                                color: isSelected
                                    ? EarthlyColors.measureViolet
                                    : theme.colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  circle.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                              Text(
                                '${circle.members.length}p · ${circle.datasets.length}m',
                                style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 10.5,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                  decoration: BoxDecoration(
                    color: EarthlyColors.measureViolet.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color:
                          EarthlyColors.measureViolet.withValues(alpha: 0.45),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.lock,
                        size: 14,
                        color: EarthlyColors.measureViolet,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'MLS-encrypted · publishes only to "${selectedCircle!.name}" (never public Nostr)',
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ] else if (widget.activeAtlasLensName != null) ...[
              const SizedBox(height: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                decoration: BoxDecoration(
                  color: EarthlyColors.amber.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: EarthlyColors.amber.withValues(alpha: 0.55),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.filter_tilt_shift,
                      size: 14,
                      color: EarthlyColors.lightAccent,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Atlas Lens active · new map will attach to "${widget.activeAtlasLensName}"',
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],

          const SizedBox(height: 12),
          FilledButton.icon(
            key: const Key('desk-publish-btn'),
            onPressed: canPublish ? _handlePublish : null,
            icon: _publishing
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(
                    widget.provenance.isProposingEdit
                        ? Icons.compare_arrows
                        : widget.provenance.isUpdatingOwned
                            ? Icons.update
                            : _audience == DraftAudienceChoice.privateCircle
                                ? Icons.lock_outline
                                : Icons.publish,
                    size: 18,
                  ),
            label: Text(
              _resolvePublishButtonLabel(selectedCircle),
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.ellipsis,
            ),
          ),

          if (_publishError != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: EarthlyColors.destructive.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                _publishError!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: EarthlyColors.destructive,
                ),
              ),
            ),
          ],
          if (_publishOutcome != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: EarthlyColors.commentGreen.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: EarthlyColors.commentGreen),
              ),
              child: Text(
                'Outbox: ${_publishOutcome!.outboxState.toUpperCase()}\n'
                'Event: ${_publishOutcome!.eventId.substring(0, _publishOutcome!.eventId.length.clamp(0, 16))}…\n'
                '${_publishOutcome!.relays.map((r) => '${r.ok ? "✓" : "✗"} ${r.relayUrl} (${r.message ?? ""})').join("\n")}',
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
            ),
          ],

          if (widget.onOpenOutbox != null) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              key: const Key('desk-outbox-btn'),
              onPressed: widget.onOpenOutbox,
              icon: Icon(
                Icons.outbox_outlined,
                size: 16,
                color: widget.pendingOutboxCount > 0
                    ? EarthlyColors.amber
                    : null,
              ),
              label: Text(
                widget.pendingOutboxCount > 0
                    ? 'Outbox Queue (${widget.pendingOutboxCount} pending)'
                    : 'Outbox Queue',
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildAudienceSegmentedControl(ThemeData theme) {
    void select(DraftAudienceChoice next) {
      setState(() => _audience = next);
      widget.onAudienceChanged(next);
      if (next == DraftAudienceChoice.privateCircle &&
          widget.selectedCircleId == null &&
          widget.circles.isNotEmpty) {
        final fallbackId = widget.circles.first.workspaceId;
        _localSelectedCircleId = fallbackId;
        widget.onSelectedCircleChanged?.call(fallbackId);
      }
    }

    Widget cell({
      required Key key,
      required DraftAudienceChoice value,
      required IconData icon,
      required String label,
    }) {
      final selected = _audience == value;
      final fg = selected ? EarthlyColors.amberInk : theme.colorScheme.onSurface;
      return Expanded(
        child: Material(
          color: selected ? EarthlyColors.amber : Colors.transparent,
          child: InkWell(
            key: key,
            onTap: () => select(value),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 14),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 17, color: fg),
                  const SizedBox(height: 4),
                  Text(
                    label,
                    maxLines: 1,
                    softWrap: false,
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
        ),
      );
    }

    return Material(
      key: const Key('desk-audience-segmented'),
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.7),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(11),
        side: BorderSide(color: theme.dividerColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            cell(
              key: const Key('desk-audience-public'),
              value: DraftAudienceChoice.publicRelay,
              icon: Icons.public,
              label: 'Public',
            ),
            VerticalDivider(width: 1, color: theme.dividerColor),
            cell(
              key: const Key('desk-audience-nearby'),
              value: DraftAudienceChoice.nearbyLocalNode,
              icon: Icons.wifi_tethering,
              label: 'Nearby',
            ),
            VerticalDivider(width: 1, color: theme.dividerColor),
            cell(
              key: const Key('desk-audience-mls'),
              value: DraftAudienceChoice.privateCircle,
              icon: Icons.lock_outline,
              label: 'MLS Group',
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSpatialActionButton({
    Key? key,
    required String label,
    required VoidCallback onPressed,
  }) {
    return OutlinedButton(
      key: key,
      style: OutlinedButton.styleFrom(
        visualDensity: VisualDensity.compact,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        minimumSize: const Size(0, 34),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
        textStyle: const TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w600,
        ),
      ),
      onPressed: onPressed,
      child: Text(
        label,
        maxLines: 1,
        softWrap: false,
        overflow: TextOverflow.ellipsis,
      ),
    );
  }

  Widget _buildSpatialActionGrid(List<Widget> buttons) {
    if (buttons.isEmpty) return const SizedBox.shrink();
    final rows = <Widget>[];
    for (var i = 0; i < buttons.length; i += 2) {
      final hasRight = i + 1 < buttons.length;
      rows.add(
        Padding(
          padding: EdgeInsets.only(bottom: i + 2 < buttons.length ? 6 : 0),
          child: Row(
            children: [
              Expanded(child: buttons[i]),
              const SizedBox(width: 6),
              if (hasRight)
                Expanded(child: buttons[i + 1])
              else
                const Spacer(),
            ],
          ),
        ),
      );
    }
    return Column(
      key: const Key('desk-spatial-actions-grid'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: rows,
    );
  }

  Widget _buildFeatureRow(ThemeData theme, DrawnFeature f, int index) {
    final selected = widget.selectedDraftFeatureIds.contains(f.id);
    final swatch = _parseColor(
      f.fillColorHex ?? f.colorHex ?? f.strokeColorHex,
      theme.colorScheme.primary,
    );
    final icon = switch (f.kind) {
      DrawToolMode.point => Icons.place_outlined,
      DrawToolMode.line => Icons.timeline,
      DrawToolMode.polygon => Icons.pentagon_outlined,
      _ => Icons.category_outlined,
    };
    return Container(
      key: Key('draft-feature-row-${f.id}'),
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: selected
            ? EarthlyColors.amber.withValues(alpha: 0.14)
            : theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: selected ? EarthlyColors.amber : theme.dividerColor,
        ),
      ),
      child: Row(
        children: [
          if (widget.onToggleSelectDraftFeature != null)
            Checkbox(
              visualDensity: VisualDensity.compact,
              value: selected,
              onChanged: (_) => widget.onToggleSelectDraftFeature!(f.id),
            )
          else
            const SizedBox(width: 10),
          Container(
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              color: swatch.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: swatch),
            ),
            child: Icon(icon, size: 13, color: swatch),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: InkWell(
              onTap: widget.onToggleSelectDraftFeature != null
                  ? () => widget.onToggleSelectDraftFeature!(f.id)
                  : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      f.name?.isNotEmpty == true
                          ? f.name!
                          : '${f.kind.name[0].toUpperCase()}${f.kind.name.substring(1)} #${index + 1}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      '${f.vertices.length} pt${f.vertices.length == 1 ? '' : 's'}${f.arrowStart || f.arrowEnd ? ' · arrow' : ''}${f.callouts.isNotEmpty ? ' · ${f.callouts.length} callout' : ''}',
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (widget.onInspectDraftFeature != null)
            IconButton(
              tooltip: 'Style & inspect feature',
              visualDensity: VisualDensity.compact,
              onPressed: () => widget.onInspectDraftFeature!(f),
              icon: const Icon(Icons.tune, size: 16),
            ),
        ],
      ),
    );
  }

  Widget _buildShelfTab(ThemeData theme) {
    final shelfMaps = widget.shelfMaps;
    return MediaQuery.removePadding(
      context: context,
      removeTop: true,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 24),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'SHELF MAPS (${shelfMaps.length})',
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              TextButton.icon(
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  minimumSize: const Size(0, 32),
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                ),
                onPressed: widget.onComposeStory,
                icon: const Icon(Icons.auto_stories_outlined, size: 15),
                label: const Text(
                  'Story',
                  maxLines: 1,
                  softWrap: false,
                ),
              ),
              TextButton.icon(
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  minimumSize: const Size(0, 32),
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                ),
                onPressed: widget.onCreateAtlas,
                icon: const Icon(Icons.collections_bookmark_outlined, size: 15),
                label: const Text(
                  'Atlas',
                  maxLines: 1,
                  softWrap: false,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          if (shelfMaps.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'No published maps on the Shelf yet. Open Explore to load maps from relay.earthly.city.',
                style: theme.textTheme.bodySmall,
              ),
            )
          else
            for (final entry in shelfMaps)
              EarthlyEntityListRow(
                leading: EarthlyGeometryThumb(
                  cacheKey: entry.summary.eventId,
                  geojson: entry.summary.geojson,
                  width: 56,
                  height: 44,
                ),
                title: entry.summary.title,
                meta:
                    '${entry.summary.featureCount} features${entry.summary.sizeBytes > 0 ? ' · ${formatByteSize(entry.summary.sizeBytes)}' : ''}',
                dimmed: !entry.visible,
                selected: entry.visible,
                onTap: () => widget.onFlyToShelfMap(entry.summary),
                primaryAction: IconButton(
                  tooltip: entry.visible ? 'Hide' : 'Show',
                  visualDensity: VisualDensity.compact,
                  onPressed: () =>
                      widget.onToggleShelfVisibility(entry.summary.address),
                  icon: Icon(
                    entry.visible ? Icons.visibility : Icons.visibility_off,
                    size: 19,
                    color: entry.visible ? EarthlyColors.commentGreen : null,
                  ),
                ),
                menuActions: [
                  EntityRowMenuAction(
                    label: 'Open Map details & features',
                    icon: Icons.info_outline,
                    onSelected: () => widget.onInspectShelfMap(entry.summary),
                  ),
                  EntityRowMenuAction(
                    label: 'Zoom to map',
                    icon: Icons.center_focus_strong,
                    onSelected: () => widget.onFlyToShelfMap(entry.summary),
                  ),
                  EntityRowMenuAction(
                    label: 'Comments & Proposals',
                    icon: Icons.forum_outlined,
                    onSelected: () =>
                        widget.onOpenShelfDiscussion(entry.summary),
                  ),
                  EntityRowMenuAction(
                    label: 'Clone into Working Draft',
                    icon: Icons.copy_all_outlined,
                    onSelected: () =>
                        widget.onCloneShelfMapToDraft(entry.summary),
                  ),
                  EntityRowMenuAction(
                    label: 'Copy nostr:naddr1… link',
                    icon: Icons.link,
                    onSelected: () => _copyNaddr(
                      kind: 37515,
                      pubkey: entry.summary.pubkey,
                      dTag: entry.summary.dTag,
                    ),
                  ),
                  EntityRowMenuAction(
                    label: 'Remove from Shelf',
                    icon: Icons.close,
                    destructive: true,
                    onSelected: () =>
                        widget.onRemoveShelfMap(entry.summary.address),
                  ),
                ],
              ),

          if (widget.deskStories.isNotEmpty) ...[
            const SizedBox(height: 10),
            _buildSectionCard(
              theme,
              child: ExpansionTile(
                initiallyExpanded: true,
                shape: const Border(),
                collapsedShape: const Border(),
                tilePadding: const EdgeInsets.symmetric(horizontal: 12),
                childrenPadding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
                title: Text(
                  'Desk Stories (${widget.deskStories.length})',
                  style: theme.textTheme.titleSmall,
                ),
                children: [
                  for (final story in widget.deskStories)
                    EarthlyEntityListRow(
                      leading: EarthlyCoverThumb(
                        imageUrl: story.image,
                        fallbackIcon: Icons.auto_stories_outlined,
                        width: 56,
                        height: 44,
                      ),
                      title: story.title,
                      meta:
                          '${story.referencedAddresses.length} linked map${story.referencedAddresses.length == 1 ? '' : 's'}',
                      onTap: () => widget.onOpenDeskStory(story),
                      primaryAction: TextButton(
                        onPressed: () => widget.onOpenDeskStory(story),
                        child: const Text('Read'),
                      ),
                      menuActions: [
                        EntityRowMenuAction(
                          label: 'Copy nostr:naddr1… link',
                          icon: Icons.link,
                          onSelected: () => _copyNaddr(
                            kind: 37520,
                            pubkey: story.pubkey,
                            dTag: story.dTag,
                          ),
                        ),
                        EntityRowMenuAction(
                          label: 'Remove from Desk',
                          icon: Icons.close,
                          destructive: true,
                          onSelected: () =>
                              widget.onRemoveDeskStory(story.address),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ],

          if (widget.deskAtlases.isNotEmpty) ...[
            const SizedBox(height: 10),
            _buildSectionCard(
              theme,
              child: ExpansionTile(
                initiallyExpanded: true,
                shape: const Border(),
                collapsedShape: const Border(),
                tilePadding: const EdgeInsets.symmetric(horizontal: 12),
                childrenPadding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
                title: Text(
                  'Desk Atlases (${widget.deskAtlases.length})',
                  style: theme.textTheme.titleSmall,
                ),
                children: [
                  for (final atlas in widget.deskAtlases)
                    EarthlyEntityListRow(
                      leading: EarthlyCoverThumb(
                        imageUrl: atlas.image,
                        fallbackIcon: Icons.public,
                        width: 56,
                        height: 44,
                      ),
                      title: atlas.name,
                      meta:
                          '${atlas.governance} · ${atlas.pinnedAddresses.length} pinned',
                      onTap: () => widget.onOpenDeskAtlas(atlas),
                      primaryAction: TextButton(
                        onPressed: () => widget.onOpenDeskAtlas(atlas),
                        child: const Text('Frame'),
                      ),
                      menuActions: [
                        EntityRowMenuAction(
                          label: 'Copy nostr:naddr1… link',
                          icon: Icons.link,
                          onSelected: () => _copyNaddr(
                            kind: 37518,
                            pubkey: atlas.pubkey,
                            dTag: atlas.dTag,
                          ),
                        ),
                        EntityRowMenuAction(
                          label: 'Remove from Desk',
                          icon: Icons.close,
                          destructive: true,
                          onSelected: () =>
                              widget.onRemoveDeskAtlas(atlas.address),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
