import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../nostr/nip55_signer.dart';
import '../nostr/shelf_renderer.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/private_groups.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

enum RustGeoAction {
  simplifyLastLine,
  corridorLastLine,
  arrowLastLine,
  offsetLastLine,
  splitLastLineAtMidpoint,
  offsetLastPolygon,
  unionAllPolygons,
  differenceLastTwoPolygons,
  splitLastPolygonByLine,
}

enum DraftAudienceChoice {
  publicRelay,
  nearbyLocalNode,
  privateCircle,
}

/// Desk sheet: active Shelf layers + Local Draft (persisted in SQLite) +
/// Rust `earthly-geo` workbench + Amber NIP-55 Publish via SQLite Outbox.
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
    required this.onPublishDraft,
    required this.onComposeStory,
    required this.onCreateAtlas,
    required this.onImportGeoJson,
    required this.onExportGeoJsonFile,
    this.onExportGpxFile,
    this.onExportKmlFile,
    required this.onCopyGeoJson,
    required this.onClearDraftFeatures,
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
  final Future<PublishOutcomeDto> Function(
    String title,
    DraftAudienceChoice audience,
  ) onPublishDraft;
  final VoidCallback onComposeStory;
  final VoidCallback onCreateAtlas;
  final VoidCallback onImportGeoJson;
  final VoidCallback onExportGeoJsonFile;
  final VoidCallback? onExportGpxFile;
  final VoidCallback? onExportKmlFile;
  final VoidCallback onCopyGeoJson;
  final VoidCallback onClearDraftFeatures;
  final VoidCallback onClose;

  @override
  State<DeskSheet> createState() => _DeskSheetState();
}

class _DeskSheetState extends State<DeskSheet> {
  late final TextEditingController _titleController;
  late DraftAudienceChoice _audience;
  bool _publishing = false;
  String? _publishError;
  PublishOutcomeDto? _publishOutcome;

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
  }

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final shelfMaps = widget.shelfMaps;
    final hasLine =
        widget.drawnFeatures.any((f) => f.kind == DrawToolMode.line);
    final polyCount =
        widget.drawnFeatures.where((f) => f.kind == DrawToolMode.polygon).length;

    return EarthlyMapDrawer(
      initialFraction: 0.52,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            Text(
              'DESK · SHELF, DRAFT & PUBLISH',
              style: theme.textTheme.labelLarge?.copyWith(
                fontFamily: 'monospace',
                letterSpacing: 0.7,
              ),
            ),
            const Spacer(),
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
              Text(
                'SHELF MAPS (${shelfMaps.length})',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: widget.onComposeStory,
                icon: const Icon(Icons.auto_stories_outlined, size: 15),
                label: const Text('Story'),
              ),
              TextButton.icon(
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
          Row(
            children: [
              Text(
                'LOCAL DRAFT · ${widget.drawnFeatures.length} FEATURES',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: widget.onCreateNewDraft,
                icon: const Icon(Icons.add, size: 15),
                label: const Text('New Draft'),
              ),
              if (widget.drawnFeatures.isNotEmpty)
                TextButton(
                  onPressed: widget.onClearDraftFeatures,
                  child: const Text('Clear'),
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
                    label: const Text('Import GeoJSON / GPX / KML'),
                  ),
                  PopupMenuButton<String>(
                    enabled: widget.drawnFeatures.isNotEmpty,
                    tooltip: 'Export working draft',
                    onSelected: (choice) {
                      switch (choice) {
                        case 'geojson':
                          widget.onExportGeoJsonFile();
                        case 'gpx':
                          widget.onExportGpxFile?.call();
                        case 'kml':
                          widget.onExportKmlFile?.call();
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
                      const PopupMenuItem(
                        value: 'copy',
                        child: Text('Copy GeoJSON to Clipboard'),
                      ),
                    ],
                    child: IgnorePointer(
                      child: OutlinedButton.icon(
                        onPressed: widget.drawnFeatures.isEmpty ? null : () {},
                        icon: const Icon(Icons.file_download_outlined, size: 15),
                        label: const Text('Export ▾'),
                      ),
                    ),
                  ),
                ],
              ),
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

              const Divider(height: 22),

              // Rust Geometry Workbench
              Text(
                'RUST GEOMETRY WORKBENCH',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton(
                    onPressed: hasLine
                        ? () =>
                            widget.onRunGeoAction(RustGeoAction.simplifyLastLine)
                        : null,
                    child: const Text('Simplify line (25m)'),
                  ),
                  OutlinedButton(
                    onPressed: hasLine
                        ? () =>
                            widget.onRunGeoAction(RustGeoAction.corridorLastLine)
                        : null,
                    child: const Text('Corridor (120m)'),
                  ),
                  OutlinedButton(
                    onPressed: hasLine
                        ? () =>
                            widget.onRunGeoAction(RustGeoAction.arrowLastLine)
                        : null,
                    child: const Text('Flow Arrow'),
                  ),
                  OutlinedButton(
                    onPressed: hasLine
                        ? () =>
                            widget.onRunGeoAction(RustGeoAction.offsetLastLine)
                        : null,
                    child: const Text('Parallel (+80m)'),
                  ),
                  OutlinedButton(
                    onPressed: hasLine
                        ? () => widget.onRunGeoAction(
                              RustGeoAction.splitLastLineAtMidpoint,
                            )
                        : null,
                    child: const Text('Split Line (50%)'),
                  ),
                  OutlinedButton(
                    onPressed: polyCount >= 1
                        ? () => widget
                            .onRunGeoAction(RustGeoAction.offsetLastPolygon)
                        : null,
                    child: const Text('Offset Area (+100m)'),
                  ),
                  OutlinedButton(
                    onPressed: polyCount >= 2
                        ? () => widget
                            .onRunGeoAction(RustGeoAction.unionAllPolygons)
                        : null,
                    child: Text('Union Areas ($polyCount)'),
                  ),
                  OutlinedButton(
                    onPressed: polyCount >= 2
                        ? () => widget.onRunGeoAction(
                              RustGeoAction.differenceLastTwoPolygons,
                            )
                        : null,
                    child: const Text('Difference (A − B)'),
                  ),
                  OutlinedButton(
                    onPressed: (polyCount >= 1 && hasLine)
                        ? () => widget.onRunGeoAction(
                              RustGeoAction.splitLastPolygonByLine,
                            )
                        : null,
                    child: const Text('Split Area by Line'),
                  ),
                ],
              ),
        ],
      ),
    );
  }
}
