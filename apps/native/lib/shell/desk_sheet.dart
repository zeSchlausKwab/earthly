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
}

enum DraftAudienceChoice {
  publicRelay,
  nearbyLocalNode,
  privateCircle,
}

/// Desk sheet: active Shelf layers + Local Draft (persisted in SQLite) +
/// Multi-Selection + Primitive Shapes + Parameterized Rust `earthly-geo`
/// Workbench + Multi-Audience Publish via SQLite Outbox.
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
  final VoidCallback onClose;

  @override
  State<DeskSheet> createState() => _DeskSheetState();
}

class _DeskSheetState extends State<DeskSheet> {
  static const List<double> _meterPresets = <double>[10, 25, 50, 100, 250, 500];

  late final TextEditingController _titleController;
  late DraftAudienceChoice _audience;
  double _workbenchMeters = 100;
  bool _publishing = false;
  bool _validating = false;
  String? _publishError;
  PublishOutcomeDto? _publishOutcome;
  DraftValidationDto? _validationResult;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.draftTitle);
    _audience = widget.audience;
  }

  @override
  void didUpdateWidget(covariant DeskSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.activeDraftId != widget.activeDraftId ||
        (oldWidget.draftTitle != widget.draftTitle &&
            _titleController.text != widget.draftTitle)) {
      _titleController.text = widget.draftTitle;
    }
    if (oldWidget.audience != widget.audience) {
      _audience = widget.audience;
    }
    if (oldWidget.drawnFeatures.length != widget.drawnFeatures.length) {
      _validationResult = null;
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
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
      final title = _titleController.text.trim().isEmpty
          ? 'Untitled Field Map'
          : _titleController.text.trim();
      widget.onDraftTitleChanged(title);
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final shelfMaps = widget.shelfMaps;
    final selectedIds = widget.selectedDraftFeatureIds;
    final targetFeatures = selectedIds.isNotEmpty
        ? widget.drawnFeatures
            .where((f) => selectedIds.contains(f.id))
            .toList(growable: false)
        : widget.drawnFeatures;
    final lineCount =
        targetFeatures.where((f) => f.kind == DrawToolMode.line).length;
    final polyCount =
        targetFeatures.where((f) => f.kind == DrawToolMode.polygon).length;
    final hasLine = lineCount >= 1;
    final hasAnyTarget = targetFeatures.isNotEmpty;
    final mLabel = '${_workbenchMeters.round()}m';

    return EarthlyMapDrawer(
      initialFraction: 0.56,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            Expanded(
              child: Text(
                'DESK · SHELF, DRAFT & PUBLISH',
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelLarge?.copyWith(
                  fontFamily: 'monospace',
                  letterSpacing: 0.7,
                ),
              ),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: widget.onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          // Active Shelf Maps
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
          const SizedBox(height: 4),
          if (shelfMaps.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
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

          // Active Stories on Desk
          if (widget.deskStories.isNotEmpty) ...[
            const Divider(height: 18),
            Text(
              'STORIES ON DESK (${widget.deskStories.length})',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 4),
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
                    onSelected: () => widget.onRemoveDeskStory(story.address),
                  ),
                ],
              ),
          ],

          // Active Atlases on Desk
          if (widget.deskAtlases.isNotEmpty) ...[
            const Divider(height: 18),
            Text(
              'ATLASES ON DESK (${widget.deskAtlases.length})',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 4),
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
                    onSelected: () => widget.onRemoveDeskAtlas(atlas.address),
                  ),
                ],
              ),
          ],

          const Divider(height: 20),

          // Multi-Draft Switcher + Working Draft + SQLite Auto-save + Publish
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 4,
            runSpacing: 2,
            children: [
              Text(
                'LOCAL DRAFT · ${widget.drawnFeatures.length} FEATURES',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                ),
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
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
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                    ),
                    onPressed: widget.onCreateNewDraft,
                    icon: const Icon(Icons.add, size: 15),
                    label: const Text('New Draft'),
                  ),
                  if (widget.drawnFeatures.isNotEmpty)
                    TextButton(
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                      ),
                      onPressed: widget.onClearDraftFeatures,
                      child: const Text('Clear'),
                    ),
                ],
              ),
            ],
          ),
          if (widget.savedDrafts.length > 1) ...[
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final d in widget.savedDrafts)
                    Padding(
                      padding: const EdgeInsets.only(right: 6, bottom: 6),
                      child: InputChip(
                        label: Text(
                          d.title,
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
            controller: _titleController,
            onChanged: widget.onDraftTitleChanged,
            decoration: const InputDecoration(
              labelText: 'Map title (auto-saved to SQLite)',
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              OutlinedButton.icon(
                onPressed: widget.onImportGeoJson,
                icon: const Icon(Icons.file_upload_outlined, size: 15),
                label: const Text('Import GeoJSON / GPX / KML / SHP'),
              ),
              if (widget.onImportOsm != null)
                OutlinedButton.icon(
                  key: const Key('desk-import-osm-btn'),
                  onPressed: widget.onImportOsm,
                  icon: const Icon(Icons.public_outlined, size: 15),
                  label: const Text('Import OSM'),
                ),
              if (widget.onOpenRouting != null)
                OutlinedButton.icon(
                  key: const Key('desk-routing-btn'),
                  onPressed: widget.onOpenRouting,
                  icon: const Icon(Icons.alt_route, size: 15),
                  label: const Text('Route / Isochrone'),
                ),
              if (widget.onPasteGeoJsonFromClipboard != null)
                OutlinedButton.icon(
                  key: const Key('desk-paste-geojson-btn'),
                  onPressed: widget.onPasteGeoJsonFromClipboard,
                  icon: const Icon(Icons.content_paste, size: 15),
                  label: const Text('Paste GeoJSON'),
                ),
              PopupMenuButton<String>(
                enabled: widget.drawnFeatures.isNotEmpty ||
                    widget.shelfMaps.any((m) => m.visible),
                tooltip: 'Export working draft',
                onSelected: (choice) {
                  switch (choice) {
                    case 'geojson':
                      widget.onExportGeoJsonFile();
                    case 'gpx':
                      widget.onExportGpxFile?.call();
                    case 'kml':
                      widget.onExportKmlFile?.call();
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
                    onPressed: (widget.drawnFeatures.isEmpty &&
                            !widget.shelfMaps.any((m) => m.visible))
                        ? null
                        : () {},
                    icon: const Icon(Icons.file_download_outlined, size: 15),
                    label: const Text('Export ▾'),
                  ),
                ),
              ),
              if (widget.onValidateDraft != null &&
                  widget.drawnFeatures.isNotEmpty)
                OutlinedButton.icon(
                  key: const Key('desk-validate-draft-btn'),
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

          // Multi-select Working Draft Features List
          if (widget.drawnFeatures.isNotEmpty &&
              widget.onToggleSelectDraftFeature != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    selectedIds.isEmpty
                        ? 'DRAFT FEATURES (TAP TO SELECT)'
                        : '${selectedIds.length} OF ${widget.drawnFeatures.length} SELECTED',
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w700,
                      color:
                          selectedIds.isNotEmpty ? EarthlyColors.amber : null,
                    ),
                  ),
                ),
                if (selectedIds.length < widget.drawnFeatures.length &&
                    widget.onSelectAllDraftFeatures != null)
                  TextButton(
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                    ),
                    onPressed: widget.onSelectAllDraftFeatures,
                    child: const Text('Select All'),
                  ),
                if (selectedIds.isNotEmpty &&
                    widget.onClearDraftSelection != null)
                  TextButton(
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                    ),
                    onPressed: widget.onClearDraftSelection,
                    child: const Text('Clear'),
                  ),
              ],
            ),
            if (selectedIds.isNotEmpty) ...[
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  if (widget.onDuplicateSelectedFeatures != null)
                    OutlinedButton.icon(
                      key: const Key('desk-duplicate-selected-btn'),
                      onPressed: widget.onDuplicateSelectedFeatures,
                      icon: const Icon(Icons.control_point_duplicate, size: 15),
                      label: Text('Duplicate (${selectedIds.length})'),
                    ),
                  if (widget.onDeleteSelectedFeatures != null)
                    OutlinedButton.icon(
                      key: const Key('desk-delete-selected-btn'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: EarthlyColors.destructive,
                        side: const BorderSide(color: EarthlyColors.destructive),
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
              Builder(
                builder: (_) {
                  final f = widget.drawnFeatures[i];
                  final selected = selectedIds.contains(f.id);
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
                          : theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: selected
                            ? EarthlyColors.amber
                            : theme.dividerColor,
                      ),
                    ),
                    child: Row(
                      children: [
                        Checkbox(
                          visualDensity: VisualDensity.compact,
                          value: selected,
                          onChanged: (_) =>
                              widget.onToggleSelectDraftFeature!(f.id),
                        ),
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
                            onTap: () =>
                                widget.onToggleSelectDraftFeature!(f.id),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 6),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    f.name?.isNotEmpty == true
                                        ? f.name!
                                        : '${f.kind.name[0].toUpperCase()}${f.kind.name.substring(1)} #${i + 1}',
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
                },
              ),
          ],

          const SizedBox(height: 10),

          // Per-working-copy Publish Audience (Public | Nearby | MLS Circle)
          SegmentedButton<DraftAudienceChoice>(
            segments: [
              const ButtonSegment(
                value: DraftAudienceChoice.publicRelay,
                label: Text('Public'),
                icon: Icon(Icons.public, size: 15),
              ),
              const ButtonSegment(
                value: DraftAudienceChoice.nearbyLocalNode,
                label: Text('Nearby'),
                icon: Icon(Icons.wifi_tethering, size: 15),
              ),
              if (widget.circles.isNotEmpty)
                const ButtonSegment(
                  value: DraftAudienceChoice.privateCircle,
                  label: Text('Circle'),
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
                widget.onSelectedCircleChanged
                    ?.call(widget.circles.first.workspaceId);
              }
            },
          ),
          if (_audience == DraftAudienceChoice.privateCircle &&
              widget.circles.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final circle in widget.circles)
                  ChoiceChip(
                    avatar: const Icon(Icons.lock, size: 14),
                    label: Text(circle.name),
                    selected: widget.selectedCircleId == circle.workspaceId,
                    onSelected: (_) => widget.onSelectedCircleChanged
                        ?.call(circle.workspaceId),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          if (_audience == DraftAudienceChoice.privateCircle) ...[
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 7,
              ),
              decoration: BoxDecoration(
                color: EarthlyColors.measureViolet.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: EarthlyColors.measureViolet.withValues(alpha: 0.5),
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
                      'MLS-encrypted · publishes ONLY to Circle "${widget.circles.where((c) => c.workspaceId == widget.selectedCircleId).firstOrNull?.name ?? widget.circles.firstOrNull?.name ?? "Circle"}" (never public Nostr)',
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
            const SizedBox(height: 8),
          ] else if (widget.activeAtlasLensName != null) ...[
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 7,
              ),
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
            const SizedBox(height: 8),
          ],
          FilledButton.icon(
            onPressed: (_publishing || widget.drawnFeatures.isEmpty)
                ? null
                : _handlePublish,
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
                  ? 'Encrypt & Publish to Circle'
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
              color: EarthlyColors.destructive.withValues(alpha: 0.12),
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
                border: Border.all(color: EarthlyColors.commentGreen),
              ),
              child: Text(
                'Outbox: ${_publishOutcome!.outboxState.toUpperCase()}\n'
                'Event: ${_publishOutcome!.eventId.substring(0, 16)}…\n'
                '${_publishOutcome!.relays.map((r) => '${r.ok ? "✓" : "✗"} ${r.relayUrl} (${r.message ?? ""})').join("\n")}',
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
            ),
          ],

          // Quick Primitive Shapes Generator (at Map Center)
          if (widget.onAddPrimitiveShape != null) ...[
            const Divider(height: 22),
            Text(
              'PRIMITIVE SHAPES AT CENTER ($mLabel RADIUS)',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final shape in const [
                  ('circle', 'Circle', Icons.circle_outlined),
                  ('square', 'Square', Icons.crop_square),
                  ('rectangle', 'Rectangle', Icons.rectangle_outlined),
                  ('triangle', 'Triangle', Icons.change_history),
                  ('diamond', 'Diamond', Icons.diamond_outlined),
                  ('hexagon', 'Hexagon', Icons.hexagon_outlined),
                ])
                  ActionChip(
                    key: Key('primitive-${shape.$1}'),
                    avatar: Icon(shape.$3, size: 15),
                    label: Text(shape.$2),
                    onPressed: () => widget.onAddPrimitiveShape!(
                      shape.$1,
                      _workbenchMeters,
                    ),
                  ),
              ],
            ),
          ],

          const Divider(height: 22),

          // Parameterized Rust Geometry Workbench
          Row(
            children: [
              Expanded(
                child: Text(
                  'RUST GEOMETRY WORKBENCH',
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                selectedIds.isEmpty
                    ? 'Latest'
                    : '${selectedIds.length} selected',
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
          const SizedBox(height: 6),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                const Text(
                  'STEP: ',
                  style: TextStyle(fontFamily: 'monospace', fontSize: 10.5),
                ),
                for (final m in _meterPresets)
                  Padding(
                    padding: const EdgeInsets.only(right: 5),
                    child: ChoiceChip(
                      key: Key('workbench-meters-${m.round()}'),
                      label: Text('${m.round()}m'),
                      selected: _workbenchMeters == m,
                      onSelected: (_) => setState(() => _workbenchMeters = m),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(
                onPressed: hasLine
                    ? () => _triggerGeoAction(RustGeoAction.simplifyLastLine)
                    : null,
                child: Text('Simplify Line ($mLabel)'),
              ),
              OutlinedButton(
                onPressed: hasLine
                    ? () => _triggerGeoAction(RustGeoAction.corridorLastLine)
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
                    ? () => _triggerGeoAction(RustGeoAction.offsetLastLine)
                    : null,
                child: Text('Parallel (+$mLabel)'),
              ),
              OutlinedButton(
                onPressed: hasLine
                    ? () =>
                        _triggerGeoAction(RustGeoAction.splitLastLineAtMidpoint)
                    : null,
                child: const Text('Split Line (50%)'),
              ),
              OutlinedButton(
                key: const Key('workbench-connect-lines'),
                onPressed: lineCount >= 2
                    ? () => _triggerGeoAction(RustGeoAction.connectLines)
                    : null,
                child: Text('Connect Lines ($lineCount)'),
              ),
              OutlinedButton(
                key: const Key('workbench-dissolve-lines'),
                onPressed: lineCount >= 2
                    ? () => _triggerGeoAction(RustGeoAction.dissolveLines)
                    : null,
                child: Text('Dissolve Lines ($lineCount)'),
              ),
              OutlinedButton(
                key: const Key('workbench-simplify-polygon'),
                onPressed: polyCount >= 1
                    ? () => _triggerGeoAction(RustGeoAction.simplifyPolygon)
                    : null,
                child: Text('Simplify Area ($mLabel)'),
              ),
              OutlinedButton(
                onPressed: polyCount >= 1
                    ? () => _triggerGeoAction(RustGeoAction.offsetLastPolygon)
                    : null,
                child: Text('Expand Area (+$mLabel)'),
              ),
              OutlinedButton(
                key: const Key('workbench-inset-polygon'),
                onPressed: polyCount >= 1
                    ? () => _triggerGeoAction(RustGeoAction.insetPolygon)
                    : null,
                child: Text('Inset Area (−$mLabel)'),
              ),
              OutlinedButton(
                onPressed: polyCount >= 2
                    ? () => _triggerGeoAction(RustGeoAction.unionAllPolygons)
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
                key: const Key('workbench-rotate-selected'),
                onPressed: hasAnyTarget
                    ? () => _triggerGeoAction(
                          RustGeoAction.rotateSelected,
                          angleDeg: 15,
                        )
                    : null,
                child: const Text('Rotate +15°'),
              ),
              OutlinedButton(
                key: const Key('workbench-scale-selected'),
                onPressed: hasAnyTarget
                    ? () => _triggerGeoAction(
                          RustGeoAction.scaleSelected,
                          scale: 1.2,
                        )
                    : null,
                child: const Text('Scale ×1.2'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
