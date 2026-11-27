import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../nostr/nip55_signer.dart';
import '../nostr/shelf_renderer.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/geo.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/private_groups.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
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
  final VoidCallback onClose;

  @override
  State<DeskSheet> createState() => _DeskSheetState();
}

class _DeskSheetState extends State<DeskSheet>
    with SingleTickerProviderStateMixin {
  static const List<double> _meterPresets = <double>[10, 25, 50, 100, 250, 500];

  late final TabController _tabs;
  late final TextEditingController _titleController;
  late DraftAudienceChoice _audience;
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
    _audience = widget.audience;
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
    if (oldWidget.audience != widget.audience) {
      _audience = widget.audience;
    }
    if (oldWidget.selectedCircleId != widget.selectedCircleId) {
      _localSelectedCircleId = widget.selectedCircleId;
    }
    if (oldWidget.drawnFeatures.length != widget.drawnFeatures.length) {
      _validationResult = null;
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    _titleController.dispose();
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Copied nostr:naddr1… link')),
      );
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
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.dividerColor),
      ),
      child: child,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return EarthlyMapDrawer(
      initialFraction: 0.56,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(8, 0, 4, 0),
        child: Row(
          children: [
            Expanded(
              child: TabBar(
                controller: _tabs,
                dividerHeight: 0,
                tabs: const [
                  Tab(key: Key('desk-tab-draft'), text: 'Draft'),
                  Tab(key: Key('desk-tab-shelf'), text: 'Shelf'),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Close',
              visualDensity: VisualDensity.compact,
              onPressed: widget.onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
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
          // Compact draft header bar: feature count + Undo/Redo/+ New/Clear
          Row(
            children: [
              Expanded(
                child: Text(
                  '${widget.drawnFeatures.length} feature${widget.drawnFeatures.length == 1 ? '' : 's'}',
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (widget.onUndo != null)
                IconButton(
                  tooltip: 'Undo draft change (Cmd+Z)',
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.canUndo ? widget.onUndo : null,
                  icon: const Icon(Icons.undo, size: 17),
                ),
              if (widget.onRedo != null)
                IconButton(
                  tooltip: 'Redo draft change (Cmd+Shift+Z)',
                  visualDensity: VisualDensity.compact,
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
                label: const Text('New'),
              ),
              if (hasTitleOrFeatures)
                TextButton(
                  key: const Key('desk-clear-draft-btn'),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                  ),
                  onPressed: widget.onClearDraftFeatures,
                  child: const Text('Clear'),
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

          // Compact Import / Export / Validate row
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              OutlinedButton.icon(
                key: const Key('desk-import-file-btn'),
                style: OutlinedButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                ),
                onPressed: widget.onImportGeoJson,
                icon: const Icon(Icons.file_upload_outlined, size: 15),
                label: const Text('Import'),
              ),
              if (widget.onImportOsm != null)
                OutlinedButton.icon(
                  key: const Key('desk-import-osm-btn'),
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  ),
                  onPressed: widget.onImportOsm,
                  icon: const Icon(Icons.public_outlined, size: 15),
                  label: const Text('OSM'),
                ),
              if (widget.onOpenRouting != null)
                OutlinedButton.icon(
                  key: const Key('desk-routing-btn'),
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  ),
                  onPressed: widget.onOpenRouting,
                  icon: const Icon(Icons.alt_route, size: 15),
                  label: const Text('Route'),
                ),
              if (widget.onPasteGeoJsonFromClipboard != null)
                OutlinedButton.icon(
                  key: const Key('desk-paste-geojson-btn'),
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  ),
                  onPressed: widget.onPasteGeoJsonFromClipboard,
                  icon: const Icon(Icons.content_paste, size: 15),
                  label: const Text('Paste'),
                ),
              PopupMenuButton<String>(
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
                child: IgnorePointer(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                    ),
                    onPressed: canExport ? () {} : null,
                    icon: const Icon(Icons.file_download_outlined, size: 15),
                    label: const Text('Export ▾'),
                  ),
                ),
              ),
              if (widget.onValidateDraft != null &&
                  widget.drawnFeatures.isNotEmpty)
                OutlinedButton.icon(
                  key: const Key('desk-validate-draft-btn'),
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  ),
                  onPressed: _validating ? null : _handleValidate,
                  icon: const Icon(Icons.verified_outlined, size: 15),
                  label: Text(_validating ? 'Checking…' : 'Validate'),
                ),
            ],
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
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 6),
                            ),
                            onPressed: widget.onSelectAllDraftFeatures,
                            child: const Text('Select All'),
                          ),
                        if (selectedIds.isNotEmpty &&
                            widget.onClearDraftSelection != null)
                          TextButton(
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 6),
                            ),
                            onPressed: widget.onClearDraftSelection,
                            child: const Text('Clear'),
                          ),
                      ],
                    ),
                  if (selectedIds.isNotEmpty &&
                      (widget.onDuplicateSelectedFeatures != null ||
                          widget.onDeleteSelectedFeatures != null)) ...[
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        if (widget.onDuplicateSelectedFeatures != null)
                          OutlinedButton.icon(
                            key: const Key('desk-duplicate-selected-btn'),
                            onPressed: widget.onDuplicateSelectedFeatures,
                            icon: const Icon(
                              Icons.control_point_duplicate,
                              size: 15,
                            ),
                            label: Text('Duplicate (${selectedIds.length})'),
                          ),
                        if (widget.onDeleteSelectedFeatures != null)
                          OutlinedButton.icon(
                            key: const Key('desk-delete-selected-btn'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: EarthlyColors.destructive,
                              side: const BorderSide(
                                color: EarthlyColors.destructive,
                              ),
                            ),
                            onPressed: widget.onDeleteSelectedFeatures,
                            icon: const Icon(Icons.delete_outline, size: 15),
                            label: Text('Delete (${selectedIds.length})'),
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
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (hasLine) ...[
                        OutlinedButton(
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.simplifyLastLine),
                          child: Text('Simplify Line ($mLabel)'),
                        ),
                        OutlinedButton(
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.corridorLastLine),
                          child: Text('Corridor ($mLabel)'),
                        ),
                        OutlinedButton(
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.extrudeBand),
                          child: Text('Tapered Band ($mLabel)'),
                        ),
                        OutlinedButton(
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.arrowLastLine),
                          child: Text('Flow Arrow ($mLabel)'),
                        ),
                        OutlinedButton(
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.offsetLastLine),
                          child: Text('Parallel (+$mLabel)'),
                        ),
                        OutlinedButton(
                          onPressed: () => _triggerGeoAction(
                            RustGeoAction.splitLastLineAtMidpoint,
                          ),
                          child: const Text('Split Line (50%)'),
                        ),
                        if (lineCount >= 2) ...[
                          OutlinedButton(
                            key: const Key('workbench-connect-lines'),
                            onPressed: () =>
                                _triggerGeoAction(RustGeoAction.connectLines),
                            child: Text('Connect Lines ($lineCount)'),
                          ),
                          OutlinedButton(
                            key: const Key('workbench-dissolve-lines'),
                            onPressed: () =>
                                _triggerGeoAction(RustGeoAction.dissolveLines),
                            child: Text('Dissolve Lines ($lineCount)'),
                          ),
                        ],
                      ],
                      if (polyCount >= 1) ...[
                        OutlinedButton(
                          key: const Key('workbench-simplify-polygon'),
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.simplifyPolygon),
                          child: Text('Simplify Area ($mLabel)'),
                        ),
                        OutlinedButton(
                          onPressed: () => _triggerGeoAction(
                            RustGeoAction.offsetLastPolygon,
                          ),
                          child: Text('Expand Area (+$mLabel)'),
                        ),
                        OutlinedButton(
                          key: const Key('workbench-inset-polygon'),
                          onPressed: () =>
                              _triggerGeoAction(RustGeoAction.insetPolygon),
                          child: Text('Inset Area (−$mLabel)'),
                        ),
                        if (polyCount >= 2) ...[
                          OutlinedButton(
                            onPressed: () => _triggerGeoAction(
                              RustGeoAction.unionAllPolygons,
                            ),
                            child: Text('Union Areas ($polyCount)'),
                          ),
                          OutlinedButton(
                            onPressed: () => _triggerGeoAction(
                              RustGeoAction.differenceLastTwoPolygons,
                            ),
                            child: const Text('Difference (A − B)'),
                          ),
                        ],
                        if (hasLine)
                          OutlinedButton(
                            onPressed: () => _triggerGeoAction(
                              RustGeoAction.splitLastPolygonByLine,
                            ),
                            child: const Text('Split Area by Line'),
                          ),
                      ],
                      if (hasAnyTarget) ...[
                        OutlinedButton(
                          key: const Key('workbench-rotate-selected'),
                          onPressed: () => _triggerGeoAction(
                            RustGeoAction.rotateSelected,
                            angleDeg: 15,
                          ),
                          child: const Text('Rotate +15°'),
                        ),
                        OutlinedButton(
                          key: const Key('workbench-scale-selected'),
                          onPressed: () => _triggerGeoAction(
                            RustGeoAction.scaleSelected,
                            scale: 1.2,
                          ),
                          child: const Text('Scale ×1.2'),
                        ),
                        if (canMergeMultipart)
                          OutlinedButton(
                            key: const Key('workbench-merge-multipart'),
                            onPressed: () =>
                                _triggerGeoAction(RustGeoAction.mergeMultipart),
                            child: const Text('Merge Multipart'),
                          ),
                        if (hasMultipart)
                          OutlinedButton(
                            key: const Key('workbench-explode-multipart'),
                            onPressed: () => _triggerGeoAction(
                              RustGeoAction.explodeMultipart,
                            ),
                            child: const Text('Explode Multipart'),
                          ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 12),

          // Always-visible 3-way Publish section (Public | Nearby | MLS Group)
          Text(
            'PUBLISH TARGET',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          SegmentedButton<DraftAudienceChoice>(
            segments: const [
              ButtonSegment(
                value: DraftAudienceChoice.publicRelay,
                label: Text('Public'),
                icon: Icon(Icons.public, size: 15),
              ),
              ButtonSegment(
                value: DraftAudienceChoice.nearbyLocalNode,
                label: Text('Nearby'),
                icon: Icon(Icons.wifi_tethering, size: 15),
              ),
              ButtonSegment(
                value: DraftAudienceChoice.privateCircle,
                label: Text('MLS Group'),
                icon: Icon(Icons.lock_outline, size: 15),
              ),
            ],
            selected: {_audience},
            onSelectionChanged: (selection) {
              final next = selection.first;
              setState(() => _audience = next);
              widget.onAudienceChanged(next);
              if (next == DraftAudienceChoice.privateCircle &&
                  widget.selectedCircleId == null &&
                  widget.circles.isNotEmpty) {
                final fallbackId = widget.circles.first.workspaceId;
                _localSelectedCircleId = fallbackId;
                widget.onSelectedCircleChanged?.call(fallbackId);
              }
            },
          ),

          if (_audience == DraftAudienceChoice.privateCircle) ...[
            const SizedBox(height: 8),
            if (widget.circles.isEmpty)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: EarthlyColors.measureViolet.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: EarthlyColors.measureViolet.withValues(alpha: 0.45),
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
                    color: EarthlyColors.measureViolet.withValues(alpha: 0.45),
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
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
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

          const SizedBox(height: 10),
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
                    _audience == DraftAudienceChoice.privateCircle
                        ? Icons.lock_outline
                        : Icons.publish,
                    size: 18,
                  ),
            label: Text(
              _audience == DraftAudienceChoice.privateCircle
                  ? (selectedCircle != null
                      ? 'Publish to "${selectedCircle.name}"'
                      : 'Select an MLS Group')
                  : widget.account == null
                      ? 'Sign & Publish Map'
                      : _audience == DraftAudienceChoice.publicRelay
                          ? 'Publish to relay.earthly.city'
                          : 'Publish to Nearby Local Node',
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
              ),
            ),
          ],
        ],
      ),
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
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                ),
                onPressed: widget.onComposeStory,
                icon: const Icon(Icons.auto_stories_outlined, size: 15),
                label: const Text('Story'),
              ),
              TextButton.icon(
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                ),
                onPressed: widget.onCreateAtlas,
                icon: const Icon(Icons.collections_bookmark_outlined, size: 15),
                label: const Text('Atlas'),
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
