import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/earthly_share.dart';
import '../nostr/shelf_renderer.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';
import 'social_actions_bar.dart';

enum _FeatureKindFilter { all, point, line, polygon }

/// Web-parity Dataset Detail Margin replicating `DatasetMetadataSection` +
/// `DatasetFeaturesList`: inspect metadata, browse/filter/jump to every
/// feature inside a published Map (`kind 37515`), edit owned Maps in-place
/// (preserving `d` tag), fork others, open discussion, or delete via NIP-09 (`kind 5`).
class DatasetDetailMargin extends StatefulWidget {
  const DatasetDetailMargin({
    required this.map,
    required this.relayUrls,
    required this.onShelf,
    required this.isOwned,
    required this.authorProfile,
    required this.onToggleOnShelf,
    required this.onZoomToMap,
    required this.onJumpToFeature,
    required this.onEditOrForkMap,
    required this.onOpenDiscussion,
    required this.onDeleteMap,
    required this.onClose,
    this.onOpenPerson,
    this.currentUserPubkey,
    this.initialSocialCounts,
    this.onToggleReaction,
    this.resolvingBlobs = false,
    super.key,
  });

  final MapSummaryDto map;
  final List<String> relayUrls;
  final bool onShelf;
  final bool isOwned;
  final ProfileMetadataDto? authorProfile;
  final VoidCallback onToggleOnShelf;
  final VoidCallback onZoomToMap;
  final void Function(ShelfShape shape) onJumpToFeature;
  final VoidCallback onEditOrForkMap;
  final VoidCallback onOpenDiscussion;
  final Future<PublishOutcomeDto> Function(MapSummaryDto map) onDeleteMap;
  final ValueChanged<String>? onOpenPerson;
  final String? currentUserPubkey;
  final EntitySocialCountsDto? initialSocialCounts;
  final Future<EntitySocialCountsDto?> Function(EntitySocialCountsDto? current)?
      onToggleReaction;
  final bool resolvingBlobs;
  final VoidCallback onClose;

  @override
  State<DatasetDetailMargin> createState() => _DatasetDetailMarginState();
}

class _DatasetDetailMarginState extends State<DatasetDetailMargin> {
  final _searchController = TextEditingController();
  late List<ShelfShape> _shapes;
  _FeatureKindFilter _filter = _FeatureKindFilter.all;
  String _query = '';
  bool _deleting = false;

  @override
  void initState() {
    super.initState();
    _shapes = parseGeoJsonShapes(
      widget.map.geojson,
      datasetTitle: widget.map.title,
      datasetAddress: widget.map.address,
    );
  }

  @override
  void didUpdateWidget(covariant DatasetDetailMargin oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.map.eventId != widget.map.eventId ||
        oldWidget.map.address != widget.map.address ||
        oldWidget.map.geojson != widget.map.geojson) {
      _shapes = parseGeoJsonShapes(
        widget.map.geojson,
        datasetTitle: widget.map.title,
        datasetAddress: widget.map.address,
      );
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String get _authorLabel {
    final name = widget.authorProfile?.displayName ?? widget.authorProfile?.name;
    if (name != null && name.isNotEmpty) return name;
    final pk = widget.map.pubkey;
    return pk.length > 10 ? '${pk.substring(0, 8)}…' : pk;
  }

  Future<void> _copyLink() async {
    try {
      await RustBridge.ensureInitialized();
      final uri = await encodeNaddrCoordinate(
        kind: 37515,
        pubkeyHex: widget.map.pubkey,
        dTag: widget.map.dTag,
        relays: widget.relayUrls,
      );
      await Clipboard.setData(ClipboardData(text: uri));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Copied nostr:naddr1… link')),
      );
    } catch (_) {}
  }

  Future<void> _confirmAndDelete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Map?'),
        content: Text(
          'Publish a NIP-09 deletion request (kind 5) for "${widget.map.title}"?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: EarthlyColors.destructive,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _deleting = true);
    try {
      await widget.onDeleteMap(widget.map);
      if (mounted) widget.onClose();
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Delete failed: $err')),
      );
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }

  Color _parseColor(String? hex, Color fallback) {
    if (hex == null || !hex.startsWith('#') || hex.length != 7) return fallback;
    final v = int.tryParse(hex.substring(1), radix: 16);
    return v != null ? Color(0xFF000000 | v) : fallback;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDesktop = MediaQuery.sizeOf(context).width >= 880;
    final map = widget.map;

    final pointCount =
        _shapes.where((s) => s.kind == ShelfShapeKind.point).length;
    final lineCount =
        _shapes.where((s) => s.kind == ShelfShapeKind.line).length;
    final polyCount =
        _shapes.where((s) => s.kind == ShelfShapeKind.polygon).length;

    final q = _query.trim().toLowerCase();
    final filtered = _shapes.where((s) {
      if (_filter == _FeatureKindFilter.point &&
          s.kind != ShelfShapeKind.point) {
        return false;
      }
      if (_filter == _FeatureKindFilter.line && s.kind != ShelfShapeKind.line) {
        return false;
      }
      if (_filter == _FeatureKindFilter.polygon &&
          s.kind != ShelfShapeKind.polygon) {
        return false;
      }
      if (q.isEmpty) return true;
      return (s.label?.toLowerCase().contains(q) ?? false) ||
          (s.featureId?.toLowerCase().contains(q) ?? false) ||
          s.properties.values.any(
            (v) => v != null && v.toString().toLowerCase().contains(q),
          );
    }).toList(growable: false);

    return EarthlyMapDrawer(
      initialFraction: 0.56,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            const EarthlyBadge(label: 'MAP', color: EarthlyColors.infoCyan),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                map.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            IconButton(
              tooltip: 'Comments & Proposals',
              visualDensity: VisualDensity.compact,
              onPressed: widget.onOpenDiscussion,
              icon: const Icon(Icons.forum_outlined, size: 18),
            ),
            IconButton(
              tooltip: 'Copy nostr:naddr1… link',
              visualDensity: VisualDensity.compact,
              onPressed: _copyLink,
              icon: const Icon(Icons.link, size: 18),
            ),
            IconButton(
              tooltip: 'Share earthly.city URL',
              visualDensity: VisualDensity.compact,
              onPressed: () => unawaited(
                shareEarthlyEntity(
                  context: context,
                  kind: 37515,
                  pubkeyHex: map.pubkey,
                  dTag: map.dTag,
                  relayUrls: widget.relayUrls,
                  title: map.title,
                ),
              ),
              icon: const Icon(Icons.ios_share, size: 18),
            ),
            if (isDesktop)
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
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              EarthlyGeometryThumb(
                cacheKey: map.eventId,
                geojson: map.geojson,
                width: 82,
                height: 64,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      map.title,
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 3),
                    Wrap(
                      spacing: 4,
                      runSpacing: 2,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        InkWell(
                          onTap: widget.onOpenPerson == null
                              ? null
                              : () => widget.onOpenPerson!(map.pubkey),
                          child: Text(
                            _authorLabel,
                            style: TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: widget.onOpenPerson != null
                                  ? EarthlyColors.infoCyan
                                  : theme.colorScheme.onSurfaceVariant,
                              decoration: widget.onOpenPerson != null
                                  ? TextDecoration.underline
                                  : null,
                            ),
                          ),
                        ),
                        Text(
                          '· ${formatRelativeUnixDate(map.createdAt.toInt())} · ${map.featureCount} features${map.sizeBytes > 0 ? ' · ${formatByteSize(map.sizeBytes)}' : ''}',
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10.5,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                    if (map.hashtags.isNotEmpty || map.blobRefs.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 5,
                        runSpacing: 4,
                        children: [
                          if (map.blobRefs.isNotEmpty)
                            EarthlyBadge(
                              label: map.blobRefs.length == 1
                                  ? 'BLOSSOM BLOB'
                                  : 'BLOSSOM (${map.blobRefs.length})',
                              color: EarthlyColors.commentGreen,
                            ),
                          for (final t in map.hashtags.take(5))
                            EarthlyBadge(
                              label: '#$t',
                              color: EarthlyColors.infoCyan,
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          if (widget.resolvingBlobs) ...[
            const SizedBox(height: 8),
            const Row(
              children: [
                SizedBox(
                  width: 13,
                  height: 13,
                  child: CircularProgressIndicator(strokeWidth: 1.8),
                ),
                SizedBox(width: 8),
                Text(
                  'Resolving external Blossom GeoJSON…',
                  style: TextStyle(fontFamily: 'monospace', fontSize: 11),
                ),
              ],
            ),
          ],
          if (widget.onToggleReaction != null ||
              widget.initialSocialCounts != null) ...[
            const SizedBox(height: 10),
            EntityReactionBar(
              targetAddress: map.address,
              targetEventId: map.eventId,
              targetPubkey: map.pubkey,
              targetKind: 37515,
              relayUrls: widget.relayUrls,
              currentUserPubkey: widget.currentUserPubkey,
              initialCounts: widget.initialSocialCounts,
              onToggleReaction: widget.onToggleReaction,
            ),
          ],
          if (map.description != null && map.description!.trim().isNotEmpty) ...[
            const SizedBox(height: 10),
            EarthlyRichText(text: map.description!.trim()),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: widget.onToggleOnShelf,
                icon: Icon(
                  widget.onShelf ? Icons.layers_clear_outlined : Icons.layers,
                  size: 16,
                ),
                label: Text(widget.onShelf ? 'Remove from Map' : 'Show on Map'),
              ),
              OutlinedButton.icon(
                onPressed: widget.onZoomToMap,
                icon: const Icon(Icons.center_focus_strong, size: 16),
                label: const Text('Zoom'),
              ),
              OutlinedButton.icon(
                onPressed: widget.onEditOrForkMap,
                icon: Icon(
                  widget.isOwned ? Icons.edit_outlined : Icons.copy_all_outlined,
                  size: 16,
                ),
                label: Text(widget.isOwned ? 'Edit in Draft' : 'Fork to Draft'),
              ),
              if (widget.isOwned)
                OutlinedButton.icon(
                  onPressed: _deleting ? null : _confirmAndDelete,
                  icon: const Icon(
                    Icons.delete_outline,
                    size: 16,
                    color: EarthlyColors.destructive,
                  ),
                  label: Text(
                    _deleting ? 'Deleting…' : 'Delete',
                    style: const TextStyle(color: EarthlyColors.destructive),
                  ),
                ),
            ],
          ),
          const Divider(height: 22),
          Text(
            'FEATURES (${filtered.length} / ${_shapes.length})',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _searchController,
            onChanged: (v) => setState(() => _query = v),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search, size: 16),
              hintText: 'Filter features by name or property…',
              suffixIcon: _query.isNotEmpty
                  ? IconButton(
                      visualDensity: VisualDensity.compact,
                      onPressed: () {
                        _searchController.clear();
                        setState(() => _query = '');
                      },
                      icon: const Icon(Icons.clear, size: 15),
                    )
                  : null,
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final item in [
                  (_FeatureKindFilter.all, 'All (${_shapes.length})'),
                  if (pointCount > 0)
                    (_FeatureKindFilter.point, 'Points ($pointCount)'),
                  if (lineCount > 0)
                    (_FeatureKindFilter.line, 'Lines ($lineCount)'),
                  if (polyCount > 0)
                    (_FeatureKindFilter.polygon, 'Areas ($polyCount)'),
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(item.$2),
                      selected: _filter == item.$1,
                      onSelected: (_) => setState(() => _filter = item.$1),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          if (filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Center(
                child: Text(
                  'No matching features.',
                  style: theme.textTheme.bodySmall,
                ),
              ),
            )
          else
            for (var i = 0; i < filtered.length; i++)
              _buildFeatureRow(context, filtered[i], i),
        ],
      ),
    );
  }

  Widget _buildFeatureRow(BuildContext context, ShelfShape shape, int index) {
    final theme = Theme.of(context);
    final kindIcon = switch (shape.kind) {
      ShelfShapeKind.point => Icons.place_outlined,
      ShelfShapeKind.line => Icons.timeline,
      ShelfShapeKind.polygon => Icons.pentagon_outlined,
    };
    final swatch = _parseColor(
      shape.fillColorHex ?? shape.colorHex,
      theme.colorScheme.primary,
    );
    final title = shape.label?.trim().isNotEmpty == true
        ? shape.label!.trim()
        : (shape.featureId ?? 'Feature #${index + 1}');

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () => widget.onJumpToFeature(shape),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: theme.dividerColor)),
          ),
          child: Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: swatch.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: swatch.withValues(alpha: 0.5)),
                ),
                child: Icon(kindIcon, size: 15, color: swatch),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (shape.callouts.isNotEmpty)
                      Text(
                        '${shape.callouts.length} callout${shape.callouts.length == 1 ? '' : 's'}',
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10,
                          color: EarthlyColors.commentGreen,
                        ),
                      ),
                  ],
                ),
              ),
              Icon(
                Icons.my_location,
                size: 16,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
