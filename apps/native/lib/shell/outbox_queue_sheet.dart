import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

/// Per-relay delivery status for an item in the offline publish outbox.
@immutable
class OutboxRelayEntry {
  const OutboxRelayEntry({
    required this.relayUrl,
    required this.state,
    this.lastError,
  });

  final String relayUrl;
  final String state;
  final String? lastError;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is OutboxRelayEntry &&
          runtimeType == other.runtimeType &&
          relayUrl == other.relayUrl &&
          state == other.state &&
          lastError == other.lastError;

  @override
  int get hashCode => Object.hash(relayUrl, state, lastError);
}

/// Immutable view model for a queued, retrying, partial, rejected, or
/// delivered Nostr event in the SQLite publish outbox.
@immutable
class OutboxQueueEntry {
  const OutboxQueueEntry({
    required this.id,
    required this.eventId,
    required this.kind,
    required this.state,
    required this.attemptCount,
    this.nextRetryAt,
    required this.createdAt,
    required this.relays,
  });

  final String id;
  final String eventId;
  final int kind;
  final String state;
  final int attemptCount;
  final int? nextRetryAt;
  final int createdAt;
  final List<OutboxRelayEntry> relays;

  bool get isPending => state != 'delivered' && state != 'discarded';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is OutboxQueueEntry &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          eventId == other.eventId &&
          kind == other.kind &&
          state == other.state &&
          attemptCount == other.attemptCount &&
          nextRetryAt == other.nextRetryAt &&
          createdAt == other.createdAt &&
          _listEquals(relays, other.relays);

  @override
  int get hashCode => Object.hash(
        id,
        eventId,
        kind,
        state,
        attemptCount,
        nextRetryAt,
        createdAt,
        Object.hashAll(relays),
      );

  static bool _listEquals<T>(List<T> a, List<T> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

/// Non-blocking frosted-glass drawer inspecting and managing the offline
/// SQLite publish outbox queue (`EarthlyMapDrawer` shell).
class OutboxQueueSheet extends StatelessWidget {
  const OutboxQueueSheet({
    required this.items,
    this.flushing = false,
    required this.onFlushAll,
    required this.onRetryItem,
    required this.onDiscardItem,
    required this.onClose,
    super.key,
  });

  final List<OutboxQueueEntry> items;
  final bool flushing;
  final VoidCallback onFlushAll;
  final ValueChanged<String> onRetryItem;
  final ValueChanged<String> onDiscardItem;
  final VoidCallback onClose;

  static String kindLabel(int kind) => switch (kind) {
        37515 => 'Map 37515',
        37518 => 'Atlas 37518',
        37520 => 'Story 37520',
        37517 => 'Comment 37517',
        37519 => 'Proposal 37519',
        37521 => 'Beacon 37521',
        37522 => 'Sighting 37522',
        1631 => 'Accepted 1631',
        1632 => 'Declined 1632',
        10002 => 'Relay List 10002',
        0 => 'Profile 0',
        1 => 'Note 1',
        3 => 'Contacts 3',
        7 => 'Reaction 7',
        _ => 'Kind $kind',
      };

  static String shortEventId(String eventId) {
    final trimmed = eventId.trim();
    if (trimmed.isEmpty) return '—';
    if (trimmed.length <= 14) return trimmed;
    return '${trimmed.substring(0, 8)}…${trimmed.substring(trimmed.length - 4)}';
  }

  static ({String label, Color color}) _statusBadgeSpec(
    String state,
    bool isDark,
  ) =>
      switch (state) {
        'queued' => (
            label: 'QUEUED',
            color: isDark ? EarthlyColors.infoCyanBright : EarthlyColors.infoCyan,
          ),
        'delivering' => (label: 'SENDING', color: EarthlyColors.amber),
        'retry_wait' => (
            label: 'RETRY WAIT',
            color: EarthlyColors.proposedAmber,
          ),
        'partial' => (label: 'PARTIAL', color: EarthlyColors.proposedAmber),
        'rejected' => (label: 'REJECTED', color: EarthlyColors.destructive),
        'delivered' => (label: 'DELIVERED', color: EarthlyColors.commentGreen),
        'discarded' => (label: 'DISCARDED', color: EarthlyColors.published),
        _ => (label: state.toUpperCase(), color: EarthlyColors.published),
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final pendingCount = items.where((item) => item.isPending).length;

    return EarthlyMapDrawer(
      initialFraction: 0.60,
      accentTopBorder: true,
      onClose: onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 8),
        child: Row(
          children: [
            const Icon(
              Icons.outbox_outlined,
              size: 18,
              color: EarthlyColors.amber,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 8,
                runSpacing: 4,
                children: [
                  Text(
                    'PUBLISH OUTBOX',
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.7,
                    ),
                  ),
                  EarthlyBadge(
                    label: '$pendingCount pending',
                    color: pendingCount > 0
                        ? EarthlyColors.amber
                        : EarthlyColors.commentGreen,
                  ),
                ],
              ),
            ),
            TextButton.icon(
              key: const Key('outbox-flush-all-btn'),
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              ),
              onPressed: (flushing || pendingCount == 0) ? null : onFlushAll,
              icon: flushing
                  ? const SizedBox(
                      width: 13,
                      height: 13,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.sync, size: 15),
              label: Text(flushing ? 'Retrying…' : 'Retry All'),
            ),
            IconButton(
              tooltip: 'Close Outbox',
              visualDensity: VisualDensity.compact,
              onPressed: onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: items.isEmpty
          ? Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        color: EarthlyColors.commentGreen
                            .withValues(alpha: isDark ? 0.16 : 0.12),
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: EarthlyColors.commentGreen
                              .withValues(alpha: 0.35),
                        ),
                      ),
                      child: const Icon(
                        Icons.cloud_done_outlined,
                        size: 26,
                        color: EarthlyColors.commentGreen,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'All publishes delivered',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Signed Nostr events saved while offline or awaiting relay acknowledgment will appear here.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 28),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, index) => _OutboxItemCard(
                entry: items[index],
                flushing: flushing,
                statusBadge: _statusBadgeSpec(items[index].state, isDark),
                onRetry: () => onRetryItem(items[index].id),
                onDiscard: () => onDiscardItem(items[index].id),
              ),
            ),
    );
  }
}

class _OutboxItemCard extends StatelessWidget {
  const _OutboxItemCard({
    required this.entry,
    required this.flushing,
    required this.statusBadge,
    required this.onRetry,
    required this.onDiscard,
  });

  final OutboxQueueEntry entry;
  final bool flushing;
  final ({String label, Color color}) statusBadge;
  final VoidCallback onRetry;
  final VoidCallback onDiscard;

  Color _kindColor(int kind, bool isDark) => switch (kind) {
        37515 => isDark ? EarthlyColors.amber : EarthlyColors.lightAccent,
        37518 => EarthlyColors.commentGreen,
        37520 => isDark ? EarthlyColors.infoCyanBright : EarthlyColors.infoCyan,
        37517 => EarthlyColors.infoCyan,
        37519 => EarthlyColors.proposedAmber,
        37522 => EarthlyColors.measureViolet,
        _ => EarthlyColors.published,
      };

  String _formatRetryAt(int? nextRetryAt) {
    if (nextRetryAt == null || nextRetryAt <= 0) return '';
    final target = DateTime.fromMillisecondsSinceEpoch(
      nextRetryAt * 1000,
      isUtc: true,
    );
    final diff = target.difference(DateTime.now().toUtc());
    if (diff.inSeconds <= 0) return 'ready now';
    if (diff.inMinutes < 1) return 'in ${diff.inSeconds}s';
    if (diff.inHours < 1) return 'in ${diff.inMinutes}m';
    return 'in ${diff.inHours}h';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final kindColor = _kindColor(entry.kind, isDark);
    final createdLabel = formatRelativeUnixDate(entry.createdAt);
    final retryLabel = _formatRetryAt(entry.nextRetryAt);
    final canRetry = !flushing && entry.isPending;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest
            .withValues(alpha: isDark ? 0.72 : 0.90),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: entry.state == 'rejected'
              ? EarthlyColors.destructive.withValues(alpha: 0.45)
              : theme.dividerColor,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              EarthlyBadge(
                label: OutboxQueueSheet.kindLabel(entry.kind),
                color: kindColor,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  OutboxQueueSheet.shortEventId(entry.eventId),
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              EarthlyBadge(
                label: statusBadge.label,
                color: statusBadge.color,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 10,
            runSpacing: 4,
            children: [
              Text(
                '${entry.attemptCount} ${entry.attemptCount == 1 ? 'attempt' : 'attempts'}',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              if (createdLabel.isNotEmpty)
                Text(
                  'queued $createdLabel',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              if (retryLabel.isNotEmpty && entry.isPending)
                Text(
                  'next retry $retryLabel',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: EarthlyColors.proposedAmber,
                  ),
                ),
            ],
          ),
          if (entry.relays.isNotEmpty) ...[
            const SizedBox(height: 8),
            const Divider(height: 1),
            const SizedBox(height: 8),
            for (var i = 0; i < entry.relays.length; i++) ...[
              _RelayDeliveryRow(relay: entry.relays[i]),
              if (i < entry.relays.length - 1) const SizedBox(height: 6),
            ],
          ],
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              OutlinedButton.icon(
                key: Key('outbox-discard-${entry.id}'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: EarthlyColors.destructive,
                  side: BorderSide(
                    color: EarthlyColors.destructive.withValues(alpha: 0.4),
                  ),
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                ),
                onPressed: flushing ? null : onDiscard,
                icon: const Icon(Icons.delete_outline, size: 15),
                label: const Text('Discard'),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                key: Key('outbox-retry-${entry.id}'),
                style: OutlinedButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                ),
                onPressed: canRetry ? onRetry : null,
                icon: const Icon(Icons.refresh, size: 15),
                label: const Text('Retry'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RelayDeliveryRow extends StatelessWidget {
  const _RelayDeliveryRow({required this.relay});

  final OutboxRelayEntry relay;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final (IconData icon, Color color, String label) = switch (relay.state) {
      'acknowledged' => (
          Icons.check_circle_outline,
          EarthlyColors.commentGreen,
          'ACK',
        ),
      'rejected' => (
          Icons.error_outline,
          EarthlyColors.destructive,
          'REJECTED',
        ),
      _ => (
          Icons.schedule,
          isDark ? EarthlyColors.infoCyanBright : EarthlyColors.infoCyan,
          relay.state.toUpperCase(),
        ),
    };

    final hasError =
        relay.lastError != null && relay.lastError!.trim().isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                relay.relayUrl,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11.5,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 9.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.5,
                color: color,
              ),
            ),
          ],
        ),
        if (hasError)
          Padding(
            padding: const EdgeInsets.only(left: 20, top: 2),
            child: Text(
              relay.lastError!.trim(),
              style: const TextStyle(
                fontSize: 11,
                color: EarthlyColors.destructive,
                height: 1.3,
              ),
            ),
          ),
      ],
    );
  }
}
