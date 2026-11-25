import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../nostr/nip55_signer.dart';
import '../nostr/shelf_renderer.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';

enum RustGeoAction {
  simplifyLastLine,
  corridorLastLine,
  arrowLastLine,
  offsetLastLine,
  offsetLastPolygon,
  unionAllPolygons,
  differenceLastTwoPolygons,
  splitLastPolygonByLine,
}

enum DraftAudienceChoice {
  publicRelay,
  nearbyLocalNode,
}

/// Desk sheet: active Shelf layers + Local Draft (persisted in SQLite) +
/// Rust `earthly-geo` workbench + Amber NIP-55 Publish via SQLite Outbox.
class DeskSheet extends StatefulWidget {
  const DeskSheet({
    required this.draftTitle,
    required this.audience,
    required this.account,
    required this.shelfMaps,
    required this.drawnFeatures,
    required this.onDraftTitleChanged,
    required this.onAudienceChanged,
    required this.onToggleShelfVisibility,
    required this.onRemoveShelfMap,
    required this.onFlyToShelfMap,
    required this.onCloneShelfMapToDraft,
    required this.onOpenShelfDiscussion,
    required this.onRunGeoAction,
    required this.onPublishDraft,
    required this.onComposeStory,
    required this.onImportGeoJson,
    required this.onExportGeoJsonFile,
    required this.onCopyGeoJson,
    required this.onClearDraftFeatures,
    required this.onClose,
    super.key,
  });

  final String draftTitle;
  final DraftAudienceChoice audience;
  final Nip55Account? account;
  final List<ShelfMapEntry> shelfMaps;
  final List<DrawnFeature> drawnFeatures;
  final ValueChanged<String> onDraftTitleChanged;
  final ValueChanged<DraftAudienceChoice> onAudienceChanged;
  final ValueChanged<String> onToggleShelfVisibility;
  final ValueChanged<String> onRemoveShelfMap;
  final ValueChanged<MapSummaryDto> onFlyToShelfMap;
  final ValueChanged<MapSummaryDto> onCloneShelfMapToDraft;
  final ValueChanged<MapSummaryDto> onOpenShelfDiscussion;
  final ValueChanged<RustGeoAction> onRunGeoAction;
  final Future<PublishOutcomeDto> Function(
    String title,
    DraftAudienceChoice audience,
  ) onPublishDraft;
  final VoidCallback onComposeStory;
  final VoidCallback onImportGeoJson;
  final VoidCallback onExportGeoJsonFile;
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
  void dispose() {
    _titleController.dispose();
    super.dispose();
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
                'SHELF (${shelfMaps.length} ON MAP)',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: widget.onComposeStory,
                icon: const Icon(Icons.auto_stories_outlined, size: 15),
                label: const Text('Write Story'),
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
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(
                  entry.summary.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  '${entry.summary.featureCount} features',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                  ),
                ),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      tooltip: 'Clone into Working Draft',
                      onPressed: () =>
                          widget.onCloneShelfMapToDraft(entry.summary),
                      icon: const Icon(Icons.copy_all_outlined, size: 18),
                    ),
                    IconButton(
                      tooltip: 'Comments & Proposals',
                      onPressed: () =>
                          widget.onOpenShelfDiscussion(entry.summary),
                      icon: const Icon(Icons.forum_outlined, size: 18),
                    ),
                    IconButton(
                      tooltip: 'Frame',
                      onPressed: () => widget.onFlyToShelfMap(entry.summary),
                      icon: const Icon(Icons.center_focus_strong, size: 18),
                    ),
                    IconButton(
                      tooltip: entry.visible ? 'Hide' : 'Show',
                      onPressed: () =>
                          widget.onToggleShelfVisibility(entry.summary.address),
                      icon: Icon(
                        entry.visible ? Icons.visibility : Icons.visibility_off,
                        size: 18,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Remove from Shelf',
                      onPressed: () =>
                          widget.onRemoveShelfMap(entry.summary.address),
                      icon: const Icon(Icons.close, size: 18),
                    ),
                  ],
                ),
              ),

          const Divider(height: 20),

          // Working Draft + SQLite Auto-save + Publish
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
              if (widget.drawnFeatures.isNotEmpty)
                TextButton(
                  onPressed: widget.onClearDraftFeatures,
                  child: const Text('Clear'),
                ),
            ],
          ),
              const SizedBox(height: 6),
              TextField(
                controller: _titleController,
                onChanged: widget.onDraftTitleChanged,
                decoration: const InputDecoration(
                  isDense: true,
                  labelText: 'Map title (auto-saved to SQLite)',
                  border: OutlineInputBorder(borderRadius: BorderRadius.zero),
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
                    label: const Text('Import .geojson'),
                  ),
                  OutlinedButton.icon(
                    onPressed: widget.drawnFeatures.isEmpty
                        ? null
                        : widget.onExportGeoJsonFile,
                    icon: const Icon(Icons.file_download_outlined, size: 15),
                    label: const Text('Save .geojson'),
                  ),
                  OutlinedButton.icon(
                    onPressed: widget.drawnFeatures.isEmpty
                        ? null
                        : widget.onCopyGeoJson,
                    icon: const Icon(Icons.copy_outlined, size: 15),
                    label: const Text('Copy JSON'),
                  ),
                ],
              ),
              const SizedBox(height: 10),

              // Per-working-copy Publish Audience
              SegmentedButton<DraftAudienceChoice>(
                segments: const [
                  ButtonSegment(
                    value: DraftAudienceChoice.publicRelay,
                    label: Text('Public'),
                    icon: Icon(Icons.public, size: 16),
                  ),
                  ButtonSegment(
                    value: DraftAudienceChoice.nearbyLocalNode,
                    label: Text('Nearby'),
                    icon: Icon(Icons.wifi_tethering, size: 16),
                  ),
                ],
                selected: {_audience},
                onSelectionChanged: (selection) {
                  final next = selection.first;
                  setState(() => _audience = next);
                  widget.onAudienceChanged(next);
                },
              ),
              const SizedBox(height: 10),
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
                    : const Icon(Icons.publish, size: 18),
                label: Text(
                  widget.account == null
                      ? 'Sign with Amber & Publish Map'
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
