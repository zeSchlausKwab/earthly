import 'package:earthly_native/shell/outbox_queue_sheet.dart';
import 'package:earthly_native/theme/earthly_theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  Widget wrapSheet(
    Widget sheet, {
    Brightness brightness = Brightness.light,
  }) {
    return MaterialApp(
      theme: buildEarthlyTheme(brightness),
      home: Scaffold(
        body: Stack(
          children: [sheet],
        ),
      ),
    );
  }

  group('OutboxQueueSheet', () {
    testWidgets('renders clean empty state and disables Retry All', (
      WidgetTester tester,
    ) async {
      var flushTapped = false;
      var closed = false;

      await tester.pumpWidget(
        wrapSheet(
          OutboxQueueSheet(
            items: const [],
            flushing: false,
            onFlushAll: () => flushTapped = true,
            onRetryItem: (_) {},
            onDiscardItem: (_) {},
            onClose: () => closed = true,
          ),
        ),
      );

      expect(find.text('Outbox'), findsOneWidget);
      expect(find.text('0 pending'), findsOneWidget);
      expect(find.text('All publishes delivered'), findsOneWidget);

      final flushButton = tester.widget<TextButton>(
        find.byKey(const Key('outbox-flush-all-btn')),
      );
      expect(flushButton.onPressed, isNull);

      await tester.tap(find.byKey(const Key('outbox-flush-all-btn')));
      await tester.pump();
      expect(flushTapped, isFalse);

      await tester.tap(find.byTooltip('Close Outbox'));
      await tester.pump();
      expect(closed, isTrue);
    });

    testWidgets(
        'renders queued, partial, and rejected items with kind labels, short IDs, attempts, and relay errors',
        (WidgetTester tester) async {
      final nowSecs = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      final items = <OutboxQueueEntry>[
        OutboxQueueEntry(
          id: 'item-queued',
          eventId: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          kind: 37515,
          state: 'queued',
          attemptCount: 0,
          createdAt: nowSecs - 60,
          relays: const [
            OutboxRelayEntry(
              relayUrl: 'wss://relay.earthly.city',
              state: 'pending',
            ),
          ],
        ),
        OutboxQueueEntry(
          id: 'item-partial',
          eventId: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          kind: 37518,
          state: 'partial',
          attemptCount: 2,
          nextRetryAt: nowSecs + 120,
          createdAt: nowSecs - 300,
          relays: const [
            OutboxRelayEntry(
              relayUrl: 'wss://relay.damus.io',
              state: 'acknowledged',
            ),
            OutboxRelayEntry(
              relayUrl: 'wss://nos.lol',
              state: 'rejected',
              lastError: 'connection timed out',
            ),
          ],
        ),
        OutboxQueueEntry(
          id: 'item-rejected',
          eventId: 'deadbeef0000111122223333444455556666777788889999aaaabbbbccccdddd',
          kind: 37522,
          state: 'rejected',
          attemptCount: 5,
          createdAt: nowSecs - 3600,
          relays: const [
            OutboxRelayEntry(
              relayUrl: 'wss://relay.primal.net',
              state: 'rejected',
              lastError: 'auth-required: restricted relay',
            ),
          ],
        ),
      ];

      await tester.pumpWidget(
        wrapSheet(
          OutboxQueueSheet(
            items: items,
            flushing: false,
            onFlushAll: () {},
            onRetryItem: (_) {},
            onDiscardItem: (_) {},
            onClose: () {},
          ),
          brightness: Brightness.dark,
        ),
      );

      expect(find.text('3 pending'), findsOneWidget);

      // Human-readable kind labels & short event IDs (first two cards visible)
      expect(find.text('Map 37515'), findsOneWidget);
      expect(find.text('abcdef12…7890'), findsOneWidget);
      expect(find.text('Atlas 37518'), findsOneWidget);
      expect(find.text('11112222…ffff'), findsOneWidget);

      // Status chips & attempts on visible cards
      expect(find.text('QUEUED'), findsOneWidget);
      expect(find.text('PARTIAL'), findsOneWidget);
      expect(find.text('0 attempts'), findsOneWidget);
      expect(find.text('2 attempts'), findsOneWidget);

      // Per-relay rows and error messages
      expect(find.text('wss://relay.earthly.city'), findsOneWidget);
      expect(find.text('wss://relay.damus.io'), findsOneWidget);
      expect(find.text('wss://nos.lol'), findsOneWidget);
      expect(find.text('connection timed out'), findsOneWidget);

      // Scroll down to reveal the third (rejected) card
      await tester.scrollUntilVisible(
        find.text('auth-required: restricted relay'),
        150,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Sighting 37522'), findsOneWidget);
      expect(find.text('deadbeef…dddd'), findsOneWidget);
      expect(find.text('5 attempts'), findsOneWidget);
      expect(find.text('REJECTED'), findsWidgets);
      expect(find.text('wss://relay.primal.net'), findsOneWidget);
      expect(find.text('auth-required: restricted relay'), findsOneWidget);
    });

    testWidgets('supports additional kind labels and delivered/retry_wait states',
        (WidgetTester tester) async {
      final nowSecs = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      final items = <OutboxQueueEntry>[
        OutboxQueueEntry(
          id: 'story-1',
          eventId: 'short-id-1',
          kind: 37520,
          state: 'retry_wait',
          attemptCount: 1,
          createdAt: nowSecs - 30,
          relays: const [],
        ),
        OutboxQueueEntry(
          id: 'comment-1',
          eventId: 'short-id-2',
          kind: 37517,
          state: 'delivered',
          attemptCount: 1,
          createdAt: nowSecs - 90,
          relays: const [],
        ),
        OutboxQueueEntry(
          id: 'proposal-1',
          eventId: 'short-id-3',
          kind: 37519,
          state: 'queued',
          attemptCount: 0,
          createdAt: nowSecs - 120,
          relays: const [],
        ),
      ];

      await tester.pumpWidget(
        wrapSheet(
          OutboxQueueSheet(
            items: items,
            flushing: false,
            onFlushAll: () {},
            onRetryItem: (_) {},
            onDiscardItem: (_) {},
            onClose: () {},
          ),
        ),
      );

      // Only 2 pending because delivered is excluded from pending count
      expect(find.text('2 pending'), findsOneWidget);
      expect(find.text('Story 37520'), findsOneWidget);
      expect(find.text('Comment 37517'), findsOneWidget);
      expect(find.text('Proposal 37519'), findsOneWidget);
      expect(find.text('RETRY WAIT'), findsOneWidget);
      expect(find.text('DELIVERED'), findsOneWidget);
      expect(find.text('1 attempt'), findsNWidgets(2));
    });

    testWidgets('triggers Retry All, per-item Retry, and per-item Discard callbacks',
        (WidgetTester tester) async {
      var flushAllCount = 0;
      final retriedIds = <String>[];
      final discardedIds = <String>[];
      final nowSecs = DateTime.now().millisecondsSinceEpoch ~/ 1000;

      final items = <OutboxQueueEntry>[
        OutboxQueueEntry(
          id: 'ob-1',
          eventId: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff66667777888899990000',
          kind: 37515,
          state: 'partial',
          attemptCount: 1,
          createdAt: nowSecs - 45,
          relays: const [
            OutboxRelayEntry(
              relayUrl: 'wss://relay.earthly.city',
              state: 'rejected',
              lastError: 'socket closed',
            ),
          ],
        ),
        OutboxQueueEntry(
          id: 'ob-2',
          eventId: 'bbbb1111cccc2222dddd3333eeee4444ffff5555aaaa66667777888899990000',
          kind: 37520,
          state: 'rejected',
          attemptCount: 3,
          createdAt: nowSecs - 200,
          relays: const [
            OutboxRelayEntry(
              relayUrl: 'wss://nos.lol',
              state: 'rejected',
              lastError: 'blocked: spam filter',
            ),
          ],
        ),
      ];

      await tester.pumpWidget(
        wrapSheet(
          OutboxQueueSheet(
            items: items,
            flushing: false,
            onFlushAll: () => flushAllCount++,
            onRetryItem: retriedIds.add,
            onDiscardItem: discardedIds.add,
            onClose: () {},
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('outbox-flush-all-btn')));
      await tester.pump();
      expect(flushAllCount, 1);

      await tester.tap(find.byKey(const Key('outbox-retry-ob-1')));
      await tester.pump();
      expect(retriedIds, ['ob-1']);

      await tester.scrollUntilVisible(
        find.byKey(const Key('outbox-discard-ob-2')),
        150,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.ensureVisible(find.byKey(const Key('outbox-discard-ob-2')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('outbox-discard-ob-2')));
      await tester.pump();
      expect(discardedIds, ['ob-2']);
    });

    testWidgets('disables action buttons while flushing', (
      WidgetTester tester,
    ) async {
      var flushCount = 0;
      var retryCount = 0;
      var discardCount = 0;
      final nowSecs = DateTime.now().millisecondsSinceEpoch ~/ 1000;

      await tester.pumpWidget(
        wrapSheet(
          OutboxQueueSheet(
            items: [
              OutboxQueueEntry(
                id: 'ob-busy',
                eventId: 'cccc1111dddd2222eeee3333ffff4444',
                kind: 37517,
                state: 'queued',
                attemptCount: 0,
                createdAt: nowSecs - 10,
                relays: const [],
              ),
            ],
            flushing: true,
            onFlushAll: () => flushCount++,
            onRetryItem: (_) => retryCount++,
            onDiscardItem: (_) => discardCount++,
            onClose: () {},
          ),
        ),
      );

      expect(find.text('Retrying…'), findsOneWidget);
      await tester.tap(find.byKey(const Key('outbox-flush-all-btn')));
      await tester.tap(find.byKey(const Key('outbox-retry-ob-busy')));
      await tester.tap(find.byKey(const Key('outbox-discard-ob-busy')));
      await tester.pump();

      expect(flushCount, 0);
      expect(retryCount, 0);
      expect(discardCount, 0);
    });
  });
}
