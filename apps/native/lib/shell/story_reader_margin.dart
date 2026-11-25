import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/earthly_share.dart';
import '../nostr/shelf_renderer.dart';
import '../nostr/story_presentation.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';
import 'raw_event_inspector_dialog.dart';
import 'social_actions_bar.dart';

/// Non-blocking draggable Margin sheet that sits over the live MapLibre canvas
/// while reading a Story (`kind 37520`), with Scrollytelling ("Follow text")
/// scroll-linked camera transitions and inline `display: "figure"` / `"both"`
/// cartographic mini-maps.
class StoryReaderMargin extends StatefulWidget {
  const StoryReaderMargin({
    required this.story,
    required this.relayUrls,
    required this.parsed,
    required this.datasetsByAddress,
    required this.decodedRefsByToken,
    required this.loadingLinkedMaps,
    required this.activeViewIndex,
    required this.calloutCount,
    required this.onSelectViewIndex,
    required this.onFocusDataset,
    required this.onActivateNaddrRef,
    required this.onActivateGeoRef,
    required this.onFitAllGeometry,
    required this.onOpenDiscussion,
    required this.onKeepOnShelf,
    required this.onClose,
    this.isOwned = false,
    this.onEditStory,
    this.onDeleteStory,
    this.authorLabel,
    this.onOpenPerson,
    this.currentUserPubkey,
    this.initialSocialCounts,
    this.onToggleReaction,
    this.onZap,
    super.key,
  });

  final StorySummaryDto story;
  final List<String> relayUrls;
  final ParsedStoryDocument parsed;
  final Map<String, ShelfMapEntry> datasetsByAddress;
  final Map<String, DecodedNaddrDto> decodedRefsByToken;
  final bool loadingLinkedMaps;
  final int? activeViewIndex;
  final int calloutCount;
  final ValueChanged<int?> onSelectViewIndex;
  final ValueChanged<ShelfMapEntry> onFocusDataset;
  final ValueChanged<DecodedNaddrDto> onActivateNaddrRef;
  final void Function(double lat, double lon, String label) onActivateGeoRef;
  final VoidCallback onFitAllGeometry;
  final VoidCallback onOpenDiscussion;
  final VoidCallback onKeepOnShelf;
  final VoidCallback onClose;
  final bool isOwned;
  final VoidCallback? onEditStory;
  final Future<void> Function()? onDeleteStory;
  final String? authorLabel;
  final ValueChanged<String>? onOpenPerson;
  final String? currentUserPubkey;
  final EntitySocialCountsDto? initialSocialCounts;
  final Future<EntitySocialCountsDto?> Function(EntitySocialCountsDto? current)?
      onToggleReaction;
  final VoidCallback? onZap;

  @override
  State<StoryReaderMargin> createState() => _StoryReaderMarginState();
}

class _StoryReaderMarginState extends State<StoryReaderMargin> {
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _drawerKey = GlobalKey();
  final Map<int, GlobalKey> _cardKeys = <int, GlobalKey>{};
  bool _followText = true;
  DateTime _ignoreScrollUntil = DateTime.fromMillisecondsSinceEpoch(0);

  @override
  void didUpdateWidget(covariant StoryReaderMargin oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.story.address != widget.story.address) {
      _cardKeys.clear();
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  GlobalKey _keyForCard(int idx) =>
      _cardKeys.putIfAbsent(idx, () => GlobalKey());

  void _manualSelectView(int? idx) {
    _ignoreScrollUntil = DateTime.now().add(const Duration(milliseconds: 500));
    widget.onSelectViewIndex(idx);
    if (idx != null) {
      final ctx = _cardKeys[idx]?.currentContext;
      if (ctx != null) {
        unawaited(
          Scrollable.ensureVisible(
            ctx,
            duration: const Duration(milliseconds: 220),
            alignment: 0.2,
          ),
        );
      }
    }
  }

  bool _handleScroll(ScrollNotification notification) {
    if (!_followText || widget.parsed.viewSnapshots.isEmpty) return false;
    if (DateTime.now().isBefore(_ignoreScrollUntil)) return false;
    final drawerBox =
        _drawerKey.currentContext?.findRenderObject() as RenderBox?;
    if (drawerBox == null || !drawerBox.hasSize) return false;

    final drawerTop = drawerBox.localToGlobal(Offset.zero).dy;
    final threshold = drawerTop + drawerBox.size.height * 0.42;

    int? bestIdx;
    for (var i = 0; i < widget.parsed.viewSnapshots.length; i++) {
      final box = _cardKeys[i]?.currentContext?.findRenderObject() as RenderBox?;
      if (box == null || !box.hasSize) continue;
      final topY = box.localToGlobal(Offset.zero).dy;
      if (topY <= threshold) {
        bestIdx = i;
      }
    }
    if (bestIdx != null && bestIdx != widget.activeViewIndex) {
      widget.onSelectViewIndex(bestIdx);
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final story = widget.story;
    final datasets = widget.datasetsByAddress.values.toList(growable: false);
    final totalFeatures =
        datasets.fold<int>(0, (sum, d) => sum + d.shapes.length);
    final snapshots = widget.parsed.viewSnapshots;

    return EarthlyMapDrawer(
      key: _drawerKey,
      initialFraction: 0.50,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Always-visible header row inside the sticky drag zone
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
            child: Row(
              children: [
                const EarthlyBadge(
                  label: 'STORY',
                  color: EarthlyColors.infoCyan,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    story.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Story Comments',
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.onOpenDiscussion,
                  icon: const Icon(Icons.forum_outlined, size: 18),
                ),
                IconButton(
                  tooltip: 'Inspect raw JSON (37520)',
                  key: const Key('story-raw-inspect-btn'),
                  visualDensity: VisualDensity.compact,
                  onPressed: () => showRawEventInspectorDialog(
                    context,
                    kind: 37520,
                    title: story.title,
                    eventId: story.eventId,
                    pubkey: story.pubkey,
                    address: story.address,
                    dTag: story.dTag,
                    payloadLabel: 'Markdown Content',
                    payloadContent: story.content,
                    extraFields: {
                      'referencedMaps': '${story.referencedAddresses.length}',
                    },
                  ),
                  icon: const Icon(Icons.data_object, size: 18),
                ),
                if (widget.isOwned && widget.onEditStory != null)
                  IconButton(
                    tooltip: 'Edit Story (in-place)',
                    visualDensity: VisualDensity.compact,
                    onPressed: widget.onEditStory,
                    icon: const Icon(Icons.edit_outlined, size: 18),
                  ),
                if (widget.isOwned && widget.onDeleteStory != null)
                  IconButton(
                    tooltip: 'Delete Story (NIP-09)',
                    visualDensity: VisualDensity.compact,
                    onPressed: () async {
                      final ok = await showDialog<bool>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: Text('Delete "${story.title}"?'),
                          content: const Text(
                            'Publishes a NIP-09 deletion request (kind 5) to your configured Nostr relays.',
                          ),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.of(ctx).pop(false),
                              child: const Text('Cancel'),
                            ),
                            FilledButton(
                              style: FilledButton.styleFrom(
                                backgroundColor: EarthlyColors.destructive,
                              ),
                              onPressed: () => Navigator.of(ctx).pop(true),
                              child: const Text('Delete'),
                            ),
                          ],
                        ),
                      );
                      if (ok == true) await widget.onDeleteStory!();
                    },
                    icon: const Icon(
                      Icons.delete_outline,
                      size: 18,
                      color: EarthlyColors.destructive,
                    ),
                  ),
                IconButton(
                  tooltip: 'Fit all story geometry',
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.onFitAllGeometry,
                  icon: const Icon(Icons.fit_screen, size: 18),
                ),
                IconButton(
                  tooltip: 'Copy story nostr:naddr1… link',
                  visualDensity: VisualDensity.compact,
                  onPressed: () async {
                    try {
                      await RustBridge.ensureInitialized();
                      final uri = await encodeNaddrCoordinate(
                        kind: 37520,
                        pubkeyHex: story.pubkey,
                        dTag: story.dTag,
                        relays: widget.relayUrls,
                      );
                      await Clipboard.setData(ClipboardData(text: uri));
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Copied nostr:naddr1… link'),
                          ),
                        );
                      }
                    } catch (_) {}
                  },
                  icon: const Icon(Icons.link, size: 18),
                ),
                IconButton(
                  tooltip: 'Share earthly.city Story URL',
                  visualDensity: VisualDensity.compact,
                  onPressed: () => unawaited(
                    shareEarthlyEntity(
                      context: context,
                      kind: 37520,
                      pubkeyHex: story.pubkey,
                      dTag: story.dTag,
                      relayUrls: widget.relayUrls,
                      title: story.title,
                    ),
                  ),
                  icon: const Icon(Icons.ios_share, size: 18),
                ),
                IconButton(
                  tooltip: 'Close Story',
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
          ),

          // Story View stepper + Follow Text scrollytelling toggle
          if (snapshots.isNotEmpty)
            Container(
              margin: const EdgeInsets.fromLTRB(14, 0, 14, 6),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                border: Border.all(color: theme.dividerColor),
                color: theme.colorScheme.primary.withValues(alpha: 0.05),
              ),
              child: Row(
                children: [
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: widget.activeViewIndex == null
                        ? null
                        : () => _manualSelectView(
                              widget.activeViewIndex == 0
                                  ? null
                                  : widget.activeViewIndex! - 1,
                            ),
                    icon: const Icon(Icons.chevron_left, size: 18),
                  ),
                  Expanded(
                    child: Text(
                      widget.activeViewIndex == null
                          ? 'Overview (${snapshots.length} map views)'
                          : 'View ${widget.activeViewIndex! + 1}/${snapshots.length}: ${snapshots[widget.activeViewIndex!].step?.title ?? ''}',
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed:
                        (widget.activeViewIndex ?? -1) >= snapshots.length - 1
                            ? null
                            : () => _manualSelectView(
                                  widget.activeViewIndex == null
                                      ? 0
                                      : widget.activeViewIndex! + 1,
                                ),
                    icon: const Icon(Icons.chevron_right, size: 18),
                  ),
                  InkWell(
                    key: const Key('story-follow-text-toggle'),
                    borderRadius: BorderRadius.circular(999),
                    onTap: () => setState(() => _followText = !_followText),
                    child: Container(
                      margin: const EdgeInsets.only(left: 4),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(999),
                        color: _followText
                            ? EarthlyColors.commentGreen.withValues(alpha: 0.16)
                            : Colors.transparent,
                        border: Border.all(
                          color: _followText
                              ? EarthlyColors.commentGreen
                              : theme.dividerColor,
                        ),
                      ),
                      child: Text(
                        _followText ? 'FOLLOW ON' : 'FOLLOW OFF',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 9.5,
                          fontWeight: FontWeight.w700,
                          color: _followText
                              ? EarthlyColors.commentGreen
                              : theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
      // 100% independent scroll body — scrolling prose drives Scrollytelling without sliding drawer!
      body: NotificationListener<ScrollNotification>(
        onNotification: _handleScroll,
        child: ListView(
          controller: _scrollController,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
          children: [
            // Linked geometry / callouts strip
            Wrap(
              spacing: 6,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (widget.onOpenPerson != null)
                  InkWell(
                    onTap: () => widget.onOpenPerson!(story.pubkey),
                    borderRadius: BorderRadius.circular(999),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: EarthlyColors.infoCyan.withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                          color: EarthlyColors.infoCyan.withValues(alpha: 0.45),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.person_outline,
                            size: 12,
                            color: EarthlyColors.infoCyan,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            widget.authorLabel ??
                                (story.pubkey.length > 10
                                    ? '${story.pubkey.substring(0, 8)}…'
                                    : story.pubkey),
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: EarthlyColors.infoCyan,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (widget.loadingLinkedMaps)
                  const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(strokeWidth: 1.8),
                      ),
                      SizedBox(width: 6),
                      Text(
                        'Loading linked maps...',
                        style: TextStyle(fontFamily: 'monospace', fontSize: 11),
                      ),
                    ],
                  )
                else
                  _StatChip(
                    icon: Icons.layers,
                    text:
                        '${datasets.length} map${datasets.length == 1 ? '' : 's'} · $totalFeatures geom${widget.calloutCount > 0 ? ' · ${widget.calloutCount} callout${widget.calloutCount == 1 ? '' : 's'}' : ''}',
                  ),
                for (final d in datasets)
                  InkWell(
                    onTap: () => widget.onFocusDataset(d),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        border: Border.all(
                          color:
                              EarthlyColors.commentGreen.withValues(alpha: 0.7),
                        ),
                        color:
                            EarthlyColors.commentGreen.withValues(alpha: 0.08),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.my_location,
                            size: 12,
                            color: EarthlyColors.commentGreen,
                          ),
                          const SizedBox(width: 4),
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 140),
                            child: Text(
                              d.summary.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (datasets.isNotEmpty)
                  InkWell(
                    onTap: widget.onKeepOnShelf,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        border: Border.all(color: theme.dividerColor),
                      ),
                      child: const Text(
                        '+ Pin to Shelf',
                        style: TextStyle(fontFamily: 'monospace', fontSize: 11),
                      ),
                    ),
                  ),
                if (widget.onToggleReaction != null ||
                    widget.onZap != null ||
                    widget.initialSocialCounts != null)
                  EntityReactionBar(
                    targetAddress: story.address,
                    targetEventId: story.eventId,
                    targetPubkey: story.pubkey,
                    targetKind: 37520,
                    relayUrls: widget.relayUrls,
                    currentUserPubkey: widget.currentUserPubkey,
                    initialCounts: widget.initialSocialCounts,
                    onToggleReaction: widget.onToggleReaction,
                    onZap: widget.onZap,
                  ),
              ],
            ),
            const SizedBox(height: 10),
            if (story.image != null && story.image!.trim().isNotEmpty) ...[
              GestureDetector(
                onTap: () => showEarthlyPhotoLightbox(
                  context,
                  url: story.image!.trim(),
                  caption: story.title,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: SizedBox(
                    height: 196,
                    width: double.infinity,
                    child: EarthlyNetworkImage(
                      url: story.image!.trim(),
                      fit: BoxFit.cover,
                      fallback: const SizedBox.shrink(),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (story.summary != null && story.summary!.trim().isNotEmpty) ...[
              EarthlyRichText(
                text: story.summary!.trim(),
                baseStyle: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                  height: 1.45,
                ),
                preDecodedRefs: widget.decodedRefsByToken,
                onActivateDecodedNaddr: widget.onActivateNaddrRef,
                onActivateGeo: widget.onActivateGeoRef,
              ),
              const SizedBox(height: 12),
            ],
            for (final seg in widget.parsed.segments)
              switch (seg) {
                StoryViewCardSegment(:final viewIndex, :final step) =>
                  _StoryViewCueCard(
                    key: _keyForCard(viewIndex),
                    index: viewIndex,
                    step: step,
                    active: widget.activeViewIndex == viewIndex,
                    datasets: datasets,
                    onTap: () => _manualSelectView(viewIndex),
                  ),
                StoryMarkdownTextSegment(:final text) => EarthlyRichText(
                    text: text,
                    preDecodedRefs: widget.decodedRefsByToken,
                    onActivateDecodedNaddr: widget.onActivateNaddrRef,
                    onActivateGeo: widget.onActivateGeoRef,
                    titleResolver: (decoded) {
                      final ds = widget.datasetsByAddress[decoded.address];
                      if (ds == null) return null;
                      if (decoded.featureId != null) {
                        final matching = ds.shapes
                            .where((s) => s.featureId == decoded.featureId);
                        if (matching.isNotEmpty &&
                            matching.first.label != null) {
                          return matching.first.label;
                        }
                        return '${ds.summary.title} #${decoded.featureId}';
                      }
                      return ds.summary.title;
                    },
                  ),
              },
          ],
        ),
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      decoration: BoxDecoration(
        border: Border.all(color: theme.dividerColor),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12),
          const SizedBox(width: 4),
          Text(
            text,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _StoryViewCueCard extends StatelessWidget {
  const _StoryViewCueCard({
    super.key,
    required this.index,
    required this.step,
    required this.active,
    required this.datasets,
    required this.onTap,
  });

  final int index;
  final StoryViewStep step;
  final bool active;
  final List<ShelfMapEntry> datasets;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final showFigure = step.display == 'figure' || step.display == 'both';
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 8),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: active
              ? theme.colorScheme.primary.withValues(alpha: 0.12)
              : theme.colorScheme.surface,
          border: Border(
            left: BorderSide(
              color: active ? theme.colorScheme.primary : theme.dividerColor,
              width: 3,
            ),
            top: BorderSide(color: theme.dividerColor),
            right: BorderSide(color: theme.dividerColor),
            bottom: BorderSide(color: theme.dividerColor),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  showFigure ? Icons.auto_awesome_mosaic : Icons.map_outlined,
                  size: 18,
                  color: active ? theme.colorScheme.primary : null,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'VIEW ${index + 1} · ${step.title}',
                        style: theme.textTheme.labelMedium?.copyWith(
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w800,
                          color: active ? theme.colorScheme.primary : null,
                        ),
                      ),
                      if (step.caption != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          step.caption!,
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ],
                  ),
                ),
                Text(
                  active ? 'ACTIVE' : 'FOCUS',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: theme.colorScheme.primary,
                  ),
                ),
              ],
            ),
            if (showFigure) ...[
              const SizedBox(height: 8),
              _StoryInlineMapFigure(
                key: Key('story-inline-figure-$index'),
                camera: step.camera,
                datasets: datasets,
                active: active,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Vector cartographic inset map rendered inline when an `earthly-view` block
/// specifies `display: "figure"` or `"both"`.
class _StoryInlineMapFigure extends StatelessWidget {
  const _StoryInlineMapFigure({
    super.key,
    required this.camera,
    required this.datasets,
    required this.active,
  });

  final StoryCameraTarget? camera;
  final List<ShelfMapEntry> datasets;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Container(
        height: 132,
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF16202B) : const Color(0xFFF3F0E7),
          border: Border.all(
            color: active ? theme.colorScheme.primary : theme.dividerColor,
          ),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            CustomPaint(
              painter: _StoryFigurePainter(
                camera: camera,
                datasets: datasets,
                accentColor: theme.colorScheme.primary,
                isDark: isDark,
              ),
            ),
            if (camera != null)
              Positioned(
                right: 8,
                bottom: 8,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surface.withValues(alpha: 0.88),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '${camera!.lat.toStringAsFixed(3)}, ${camera!.lon.toStringAsFixed(3)} · z${camera!.zoom.toStringAsFixed(1)}',
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 9.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _StoryFigurePainter extends CustomPainter {
  const _StoryFigurePainter({
    required this.camera,
    required this.datasets,
    required this.accentColor,
    required this.isDark,
  });

  final StoryCameraTarget? camera;
  final List<ShelfMapEntry> datasets;
  final Color accentColor;
  final bool isDark;

  @override
  void paint(Canvas canvas, Size size) {
    final bounds = _figureBounds();
    final minLon = bounds.west;
    final maxLon = bounds.east;
    final minLat = bounds.south;
    final maxLat = bounds.north;
    final lonSpan = math.max(maxLon - minLon, 1e-5);
    final latSpan = math.max(maxLat - minLat, 1e-5);

    Offset proj(Geographic g) => Offset(
          ((g.lon - minLon) / lonSpan) * (size.width - 20) + 10,
          (1 - (g.lat - minLat) / latSpan) * (size.height - 20) + 10,
        );

    final gridPaint = Paint()
      ..color = (isDark ? Colors.white : Colors.black).withValues(alpha: 0.08)
      ..strokeWidth = 1;
    for (var i = 1; i < 4; i++) {
      final x = size.width * (i / 4);
      final y = size.height * (i / 4);
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), gridPaint);
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    for (final entry in datasets) {
      for (final s in entry.shapes) {
        if (s.coords.isEmpty) continue;
        final pts = s.coords.map(proj).toList(growable: false);
        switch (s.kind) {
          case ShelfShapeKind.polygon:
            if (pts.length < 3) continue;
            final path = Path()..addPolygon(pts, true);
            canvas.drawPath(
              path,
              Paint()..color = accentColor.withValues(alpha: 0.24),
            );
            canvas.drawPath(
              path,
              Paint()
                ..color = accentColor
                ..style = PaintingStyle.stroke
                ..strokeWidth = 1.6,
            );
          case ShelfShapeKind.line:
            if (pts.length < 2) continue;
            canvas.drawPath(
              Path()..addPolygon(pts, false),
              Paint()
                ..color = accentColor
                ..style = PaintingStyle.stroke
                ..strokeWidth = 2.0
                ..strokeCap = StrokeCap.round,
            );
          case ShelfShapeKind.point:
            canvas.drawCircle(pts.first, 3.5, Paint()..color = accentColor);
        }
      }
    }

    if (camera != null) {
      final centerPt = proj(Geographic(lon: camera!.lon, lat: camera!.lat));
      canvas.drawCircle(
        centerPt,
        6,
        Paint()
          ..color = EarthlyColors.amber
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
      canvas.drawCircle(centerPt, 2.5, Paint()..color = EarthlyColors.amber);
    }
  }

  GeoBox _figureBounds() {
    if (camera != null) {
      final span = 0.06 / math.pow(1.6, (camera!.zoom - 10).clamp(-3.0, 7.0));
      return GeoBox(
        west: camera!.lon - span * 1.4,
        south: camera!.lat - span,
        east: camera!.lon + span * 1.4,
        north: camera!.lat + span,
      );
    }
    return computeCombinedBounds(datasets) ??
        const GeoBox(west: 16.34, south: 48.19, east: 16.41, north: 48.23);
  }

  @override
  bool shouldRepaint(covariant _StoryFigurePainter oldDelegate) =>
      oldDelegate.camera != camera ||
      oldDelegate.datasets != datasets ||
      oldDelegate.isDark != isDark;
}
