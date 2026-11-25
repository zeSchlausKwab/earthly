import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/shelf_renderer.dart';
import '../nostr/story_presentation.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';
import 'social_actions_bar.dart';

/// Non-blocking draggable Margin sheet that sits over the live MapLibre canvas
/// while reading a Story (`kind 37520`).
///
/// The map above stays fully live — showing all associated datasets, GPU labels,
/// authored `earthly:callouts`, and highlighted references as you read.
class StoryReaderMargin extends StatelessWidget {
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final datasets = datasetsByAddress.values.toList(growable: false);
    final totalFeatures =
        datasets.fold<int>(0, (sum, d) => sum + d.shapes.length);
    final snapshots = parsed.viewSnapshots;

    return EarthlyMapDrawer(
      initialFraction: 0.50,
      accentTopBorder: true,
      onClose: onClose,
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
                  onPressed: onOpenDiscussion,
                  icon: const Icon(Icons.forum_outlined, size: 18),
                ),
                if (isOwned && onEditStory != null)
                  IconButton(
                    tooltip: 'Edit Story (in-place)',
                    visualDensity: VisualDensity.compact,
                    onPressed: onEditStory,
                    icon: const Icon(Icons.edit_outlined, size: 18),
                  ),
                if (isOwned && onDeleteStory != null)
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
                      if (ok == true) await onDeleteStory!();
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
                  onPressed: onFitAllGeometry,
                  icon: const Icon(Icons.fit_screen, size: 18),
                ),
                IconButton(
                  tooltip: 'Copy story link',
                  visualDensity: VisualDensity.compact,
                  onPressed: () async {
                    try {
                      await RustBridge.ensureInitialized();
                      final uri = await encodeNaddrCoordinate(
                        kind: 37520,
                        pubkeyHex: story.pubkey,
                        dTag: story.dTag,
                        relays: relayUrls,
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
                  tooltip: 'Close Story',
                  visualDensity: VisualDensity.compact,
                  onPressed: onClose,
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
          ),

          // Story View stepper stays sticky inside the header if views exist
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
                    onPressed: activeViewIndex == null
                        ? null
                        : () => onSelectViewIndex(
                              activeViewIndex == 0
                                  ? null
                                  : activeViewIndex! - 1,
                            ),
                    icon: const Icon(Icons.chevron_left, size: 18),
                  ),
                  Expanded(
                    child: Text(
                      activeViewIndex == null
                          ? 'Overview (${snapshots.length} map views)'
                          : 'View ${activeViewIndex! + 1}/${snapshots.length}: ${snapshots[activeViewIndex!].step?.title ?? ''}',
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
                    onPressed: (activeViewIndex ?? -1) >= snapshots.length - 1
                        ? null
                        : () => onSelectViewIndex(
                              activeViewIndex == null
                                  ? 0
                                  : activeViewIndex! + 1,
                            ),
                    icon: const Icon(Icons.chevron_right, size: 18),
                  ),
                ],
              ),
            ),
        ],
      ),
      // 100% independent scroll body — scrolling prose never slides the drawer!
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
        children: [
          // Linked geometry / callouts strip
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (onOpenPerson != null)
                InkWell(
                  onTap: () => onOpenPerson!(story.pubkey),
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
                          authorLabel ??
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
              if (loadingLinkedMaps)
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
                      '${datasets.length} map${datasets.length == 1 ? '' : 's'} · $totalFeatures geom${calloutCount > 0 ? ' · $calloutCount callout${calloutCount == 1 ? '' : 's'}' : ''}',
                ),
              for (final d in datasets)
                InkWell(
                  onTap: () => onFocusDataset(d),
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
                  onTap: onKeepOnShelf,
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
              if (onToggleReaction != null || initialSocialCounts != null)
                EntityReactionBar(
                  targetAddress: story.address,
                  targetEventId: story.eventId,
                  targetPubkey: story.pubkey,
                  targetKind: 37520,
                  relayUrls: relayUrls,
                  currentUserPubkey: currentUserPubkey,
                  initialCounts: initialSocialCounts,
                  onToggleReaction: onToggleReaction,
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
              preDecodedRefs: decodedRefsByToken,
              onActivateDecodedNaddr: onActivateNaddrRef,
              onActivateGeo: onActivateGeoRef,
            ),
            const SizedBox(height: 12),
          ],
          for (final seg in parsed.segments)
            switch (seg) {
              StoryViewCardSegment(:final viewIndex, :final step) =>
                _StoryViewCueCard(
                  index: viewIndex,
                  step: step,
                  active: activeViewIndex == viewIndex,
                  onTap: () => onSelectViewIndex(viewIndex),
                ),
              StoryMarkdownTextSegment(:final text) => EarthlyRichText(
                  text: text,
                  preDecodedRefs: decodedRefsByToken,
                  onActivateDecodedNaddr: onActivateNaddrRef,
                  onActivateGeo: onActivateGeoRef,
                  titleResolver: (decoded) {
                    final ds = datasetsByAddress[decoded.address];
                    if (ds == null) return null;
                    if (decoded.featureId != null) {
                      final matching = ds.shapes
                          .where((s) => s.featureId == decoded.featureId);
                      if (matching.isNotEmpty && matching.first.label != null) {
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
    required this.index,
    required this.step,
    required this.active,
    required this.onTap,
  });

  final int index;
  final StoryViewStep step;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
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
        child: Row(
          children: [
            Icon(
              Icons.map_outlined,
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
      ),
    );
  }
}
