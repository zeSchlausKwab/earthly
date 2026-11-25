import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../nostr/nip55_signer.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';

enum _InboxCategoryFilter { all, proposals, replies, activity }

String _relativeTime(int unixSecs) {
  final dt = DateTime.fromMillisecondsSinceEpoch(unixSecs * 1000);
  final diff = DateTime.now().difference(dt);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inHours < 1) return '${diff.inMinutes}m';
  if (diff.inDays < 1) return '${diff.inHours}h';
  if (diff.inDays < 7) return '${diff.inDays}d';
  return '${dt.month}/${dt.day}';
}

/// Account-scoped Inbox & Activity Feed matching Earthly Web's `InboxPanel`:
/// incoming Edit Proposals (`37519`), Proposal decisions (`1631`/`1632`),
/// Comments/Replies/Mentions (`37517`), Atlas arrivals (`37515` `#c`),
/// Follows (`3`), Reactions (`7`), and Zaps (`9735`), plus shortcuts to
/// pending Circle welcomes and Nearby peer claims.
class InboxSheet extends StatefulWidget {
  const InboxSheet({
    required this.account,
    required this.items,
    required this.loading,
    required this.readAllBeforeSecs,
    required this.readIds,
    required this.profilesByPubkey,
    required this.pendingCircleJoinsCount,
    required this.pendingNearbyClaimsCount,
    required this.onRefresh,
    required this.onMarkItemRead,
    required this.onMarkAllRead,
    required this.onOpenItem,
    required this.onOpenPerson,
    required this.onOpenCircles,
    required this.onOpenSpaces,
    required this.onOpenAccount,
    required this.onClose,
    super.key,
  });

  final Nip55Account? account;
  final List<InboxItemDto> items;
  final bool loading;
  final int readAllBeforeSecs;
  final Set<String> readIds;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final int pendingCircleJoinsCount;
  final int pendingNearbyClaimsCount;
  final Future<void> Function() onRefresh;
  final ValueChanged<String> onMarkItemRead;
  final VoidCallback onMarkAllRead;
  final ValueChanged<InboxItemDto> onOpenItem;
  final ValueChanged<String> onOpenPerson;
  final VoidCallback onOpenCircles;
  final VoidCallback onOpenSpaces;
  final VoidCallback onOpenAccount;
  final VoidCallback onClose;

  static bool isItemRead(
    InboxItemDto item, {
    required int readAllBeforeSecs,
    required Set<String> readIds,
  }) {
    if (readIds.contains(item.id)) return true;
    return item.createdAt.toInt() <= readAllBeforeSecs && readAllBeforeSecs > 0;
  }

  @override
  State<InboxSheet> createState() => _InboxSheetState();
}

class _InboxSheetState extends State<InboxSheet> {
  _InboxCategoryFilter _filter = _InboxCategoryFilter.all;

  String _actorLabel(String pubkey) {
    final p = widget.profilesByPubkey[pubkey];
    final name = p?.displayName ?? p?.name;
    if (name != null && name.isNotEmpty) return name;
    return pubkey.length > 10 ? '${pubkey.substring(0, 8)}…' : pubkey;
  }

  IconData _iconForKind(String kind) => switch (kind) {
        'proposal' => Icons.compare_arrows,
        'accepted' => Icons.check_circle_outline,
        'declined' => Icons.cancel_outlined,
        'reply' || 'mention' => Icons.chat_bubble_outline,
        'atlas_arrival' => Icons.collections_bookmark_outlined,
        'follow' => Icons.person_add_alt_1_outlined,
        'zap' => Icons.bolt,
        'reaction' => Icons.favorite_border,
        _ => Icons.notifications_none,
      };

  Color _colorForKind(String kind) => switch (kind) {
        'proposal' => EarthlyColors.proposedAmber,
        'accepted' => EarthlyColors.commentGreen,
        'declined' => EarthlyColors.destructive,
        'reply' || 'mention' => EarthlyColors.infoCyan,
        'atlas_arrival' => EarthlyColors.amber,
        'zap' => EarthlyColors.amber,
        _ => EarthlyColors.measureViolet,
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final unreadCount = widget.items
        .where(
          (i) => !InboxSheet.isItemRead(
            i,
            readAllBeforeSecs: widget.readAllBeforeSecs,
            readIds: widget.readIds,
          ),
        )
        .length;

    final filtered = widget.items.where((item) {
      return switch (_filter) {
        _InboxCategoryFilter.all => true,
        _InboxCategoryFilter.proposals => item.category == 'proposals',
        _InboxCategoryFilter.replies => item.category == 'replies',
        _InboxCategoryFilter.activity => item.category == 'activity',
      };
    }).toList(growable: false);

    return EarthlyMapDrawer(
      initialFraction: 0.60,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
            child: Row(
              children: [
                const Icon(
                  Icons.inbox_outlined,
                  size: 18,
                  color: EarthlyColors.amber,
                ),
                const SizedBox(width: 8),
                Text(
                  'INBOX',
                  style: theme.textTheme.labelLarge?.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.7,
                  ),
                ),
                if (unreadCount > 0) ...[
                  const SizedBox(width: 8),
                  EarthlyBadge(
                    label: '$unreadCount unread',
                    color: EarthlyColors.amber,
                  ),
                ],
                const Spacer(),
                if (unreadCount > 0)
                  TextButton(
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                    ),
                    onPressed: widget.onMarkAllRead,
                    child: const Text('Mark all read'),
                  ),
                IconButton(
                  tooltip: 'Refresh Inbox',
                  visualDensity: VisualDensity.compact,
                  onPressed:
                      widget.loading ? null : () => unawaited(widget.onRefresh()),
                  icon: widget.loading
                      ? const SizedBox(
                          width: 15,
                          height: 15,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh, size: 18),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
          ),
          if (widget.account != null)
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
              child: Row(
                children: [
                  for (final entry in const [
                    (_InboxCategoryFilter.all, 'All'),
                    (_InboxCategoryFilter.proposals, 'Proposals'),
                    (_InboxCategoryFilter.replies, 'Replies'),
                    (_InboxCategoryFilter.activity, 'Activity'),
                  ]) ...[
                    ChoiceChip(
                      label: Text(entry.$2),
                      selected: _filter == entry.$1,
                      onSelected: (_) => setState(() => _filter = entry.$1),
                    ),
                    const SizedBox(width: 6),
                  ],
                ],
              ),
            ),
        ],
      ),
      body: widget.account == null
          ? ListView(
              padding: const EdgeInsets.all(24),
              children: [
                const Icon(
                  Icons.notifications_paused_outlined,
                  size: 40,
                  color: EarthlyColors.amber,
                ),
                const SizedBox(height: 12),
                Text(
                  'Sign in to view your Inbox',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Track replies to your Maps, Stories & Atlases, incoming Edit Proposals, Atlas arrivals, and mentions across Nostr.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall,
                ),
                const SizedBox(height: 14),
                FilledButton.icon(
                  onPressed: widget.onOpenAccount,
                  icon: const Icon(Icons.account_circle_outlined, size: 18),
                  label: const Text('Open Account & Sign In'),
                ),
              ],
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 28),
              children: [
                if (widget.pendingCircleJoinsCount > 0)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: widget.onOpenCircles,
                      child: Container(
                        padding: const EdgeInsets.all(11),
                        decoration: BoxDecoration(
                          color: EarthlyColors.measureViolet
                              .withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: EarthlyColors.measureViolet
                                .withValues(alpha: 0.45),
                          ),
                        ),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.lock_clock_outlined,
                              size: 18,
                              color: EarthlyColors.measureViolet,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                '${widget.pendingCircleJoinsCount} pending MLS Circle join request${widget.pendingCircleJoinsCount == 1 ? '' : 's'} — tap to check Welcomes',
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const Icon(Icons.chevron_right, size: 18),
                          ],
                        ),
                      ),
                    ),
                  ),
                if (widget.pendingNearbyClaimsCount > 0)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: widget.onOpenSpaces,
                      child: Container(
                        padding: const EdgeInsets.all(11),
                        decoration: BoxDecoration(
                          color: EarthlyColors.amber.withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: EarthlyColors.amber.withValues(alpha: 0.5),
                          ),
                        ),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.wifi_tethering,
                              size: 18,
                              color: EarthlyColors.amber,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                '${widget.pendingNearbyClaimsCount} Nearby peer claim${widget.pendingNearbyClaimsCount == 1 ? '' : 's'} waiting for approval',
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const Icon(Icons.chevron_right, size: 18),
                          ],
                        ),
                      ),
                    ),
                  ),
                if (widget.loading && filtered.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 32),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (filtered.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 32),
                    child: Text(
                      'All caught up! No notifications in this filter yet.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall,
                    ),
                  )
                else
                  for (final item in filtered) _buildInboxRow(theme, item),
              ],
            ),
    );
  }

  Widget _buildInboxRow(ThemeData theme, InboxItemDto item) {
    final isRead = InboxSheet.isItemRead(
      item,
      readAllBeforeSecs: widget.readAllBeforeSecs,
      readIds: widget.readIds,
    );
    final accent = _colorForKind(item.kind);
    final profile = widget.profilesByPubkey[item.actorPubkey];
    final actorName = _actorLabel(item.actorPubkey);

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: isRead
            ? Colors.transparent
            : accent.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () {
            widget.onMarkItemRead(item.id);
            widget.onOpenItem(item);
          },
          child: Container(
            padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isRead
                    ? theme.dividerColor.withValues(alpha: 0.6)
                    : accent.withValues(alpha: 0.45),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                GestureDetector(
                  onTap: () => widget.onOpenPerson(item.actorPubkey),
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      _ActorAvatar(
                        pictureUrl: profile?.picture,
                        label: actorName,
                        accent: accent,
                      ),
                      Positioned(
                        right: -3,
                        bottom: -3,
                        child: Container(
                          width: 17,
                          height: 17,
                          decoration: BoxDecoration(
                            color: accent,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: theme.colorScheme.surface,
                              width: 1.5,
                            ),
                          ),
                          child: Icon(
                            _iconForKind(item.kind),
                            size: 10,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: RichText(
                              text: TextSpan(
                                style: theme.textTheme.bodySmall?.copyWith(
                                  fontSize: 12.5,
                                  color: theme.colorScheme.onSurface,
                                ),
                                children: [
                                  TextSpan(
                                    text: actorName,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  TextSpan(text: ' ${item.action} '),
                                  TextSpan(
                                    text: item.thingLabel,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _relativeTime(item.createdAt.toInt()),
                            style: TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10,
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          if (!isRead) ...[
                            const SizedBox(width: 5),
                            Container(
                              width: 7,
                              height: 7,
                              decoration: BoxDecoration(
                                color: accent,
                                shape: BoxShape.circle,
                              ),
                            ),
                          ],
                        ],
                      ),
                      if (item.preview != null && item.preview!.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          item.preview!,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ActorAvatar extends StatelessWidget {
  const _ActorAvatar({
    required this.pictureUrl,
    required this.label,
    required this.accent,
  });

  final String? pictureUrl;
  final String label;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final initial = label.isNotEmpty ? label[0].toUpperCase() : '?';
    if (pictureUrl != null && pictureUrl!.startsWith('http')) {
      return ClipOval(
        child: Image.network(
          pictureUrl!,
          width: 34,
          height: 34,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _fallback(initial),
        ),
      );
    }
    return _fallback(initial);
  }

  Widget _fallback(String initial) {
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.18),
        shape: BoxShape.circle,
      ),
      child: Text(
        initial,
        style: TextStyle(
          fontWeight: FontWeight.w800,
          color: accent,
          fontSize: 13,
        ),
      ),
    );
  }
}
