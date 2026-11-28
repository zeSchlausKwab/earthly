import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';

/// Compact NIP-25 Reaction (`kind 7`) & NIP-57 Zap (`kind 9735`) bar displayed
/// on Map (`37515`), Story (`37520`), and Atlas (`37518`) detail drawers.
class EntityReactionBar extends StatefulWidget {
  const EntityReactionBar({
    required this.targetAddress,
    required this.targetPubkey,
    required this.targetKind,
    required this.relayUrls,
    this.targetEventId,
    this.currentUserPubkey,
    this.initialCounts,
    this.onToggleReaction,
    this.onZap,
    super.key,
  });

  final String targetAddress;
  final String? targetEventId;
  final String targetPubkey;
  final int targetKind;
  final List<String> relayUrls;
  final String? currentUserPubkey;
  final EntitySocialCountsDto? initialCounts;
  final Future<EntitySocialCountsDto?> Function(EntitySocialCountsDto? current)?
      onToggleReaction;
  final VoidCallback? onZap;

  @override
  State<EntityReactionBar> createState() => _EntityReactionBarState();
}

class _EntityReactionBarState extends State<EntityReactionBar> {
  EntitySocialCountsDto? _counts;
  bool _toggling = false;

  @override
  void initState() {
    super.initState();
    _counts = widget.initialCounts;
    if (_counts == null && widget.relayUrls.isNotEmpty) {
      unawaited(_loadCounts());
    }
  }

  @override
  void didUpdateWidget(covariant EntityReactionBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialCounts != widget.initialCounts &&
        widget.initialCounts != null) {
      _counts = widget.initialCounts;
    } else if (oldWidget.targetAddress != widget.targetAddress ||
        oldWidget.currentUserPubkey != widget.currentUserPubkey) {
      _counts = widget.initialCounts;
      if (_counts == null && widget.relayUrls.isNotEmpty) {
        unawaited(_loadCounts());
      }
    }
  }

  Future<void> _loadCounts() async {
    try {
      await RustBridge.ensureInitialized();
      final fetched = await fetchEntitySocialCounts(
        relayUrls: widget.relayUrls,
        targetAddress: widget.targetAddress,
        targetEventId: widget.targetEventId,
        currentUserPubkey: widget.currentUserPubkey,
      );
      if (!mounted) return;
      setState(() => _counts = fetched);
    } catch (_) {}
  }

  Future<void> _handleToggle() async {
    if (_toggling || widget.onToggleReaction == null) return;
    final previous = _counts;
    final wasLiked = previous?.userHasReacted ?? false;
    final prevCount = previous?.reactionCount ?? 0;

    setState(() {
      _toggling = true;
      _counts = EntitySocialCountsDto(
        address: widget.targetAddress,
        reactionCount:
            wasLiked ? (prevCount > 0 ? prevCount - 1 : 0) : prevCount + 1,
        userHasReacted: !wasLiked,
        userReactionEventId: wasLiked ? null : previous?.userReactionEventId,
        zapCount: previous?.zapCount ?? 0,
        zapSats: previous?.zapSats ?? BigInt.zero,
      );
    });

    try {
      final updated = await widget.onToggleReaction!(previous);
      if (!mounted) return;
      if (updated != null) {
        setState(() => _counts = updated);
      }
    } catch (err) {
      if (!mounted) return;
      setState(() => _counts = previous);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Reaction failed: $err')),
      );
    } finally {
      if (mounted) setState(() => _toggling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final counts = _counts;
    final liked = counts?.userHasReacted ?? false;
    final reactionCount = counts?.reactionCount ?? 0;
    final zapSats = counts?.zapSats ?? BigInt.zero;
    const heartRose = Color(0xFFE11D48);

    return Material(
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.72),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: theme.dividerColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: IntrinsicHeight(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Material(
              color: liked
                  ? heartRose.withValues(alpha: 0.14)
                  : Colors.transparent,
              child: InkWell(
                key: const Key('entity-reaction-btn'),
                onTap: (_toggling || widget.onToggleReaction == null)
                    ? null
                    : _handleToggle,
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (_toggling)
                        const SizedBox(
                          width: 13,
                          height: 13,
                          child: CircularProgressIndicator(strokeWidth: 1.8),
                        )
                      else
                        Icon(
                          liked ? Icons.favorite : Icons.favorite_border,
                          size: 14,
                          color: liked
                              ? heartRose
                              : theme.colorScheme.onSurfaceVariant,
                        ),
                      const SizedBox(width: 5),
                      Text(
                        reactionCount > 0 ? '$reactionCount' : 'Like',
                        maxLines: 1,
                        softWrap: false,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: liked ? heartRose : theme.colorScheme.onSurface,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (widget.onZap != null || zapSats > BigInt.zero) ...[
              VerticalDivider(width: 1, thickness: 1, color: theme.dividerColor),
              Material(
                color: EarthlyColors.amber.withValues(alpha: 0.14),
                child: InkWell(
                  key: const Key('entity-zap-badge'),
                  onTap: widget.onZap,
                  child: Padding(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.bolt,
                          size: 13,
                          color: EarthlyColors.amber,
                        ),
                        const SizedBox(width: 3),
                        Text(
                          zapSats > BigInt.zero ? '$zapSats sats' : 'Zap',
                          maxLines: 1,
                          softWrap: false,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: EarthlyColors.amber,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
