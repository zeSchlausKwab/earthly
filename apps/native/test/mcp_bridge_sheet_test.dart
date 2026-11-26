import 'dart:convert';

import 'package:earthly_native/shell/mcp_bridge_sheet.dart';
import 'package:earthly_native/theme/earthly_theme.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  Finder verticalScrollable() => find
      .descendant(
        of: find.byType(ListView),
        matching: find.byType(Scrollable),
      )
      .first;

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

  group('McpBridgeSheet', () {
    testWidgets('stopped state validates port and invokes onStart with entered port',
        (WidgetTester tester) async {
      int? startedPort;
      var closed = false;

      await tester.pumpWidget(
        wrapSheet(
          McpBridgeSheet(
            state: const McpBridgeViewState(
              running: false,
              port: 47832,
              toolCount: 23,
              totalCalls: 0,
            ),
            onStart: (port) async => startedPort = port,
            onStop: () async {},
            onClose: () => closed = true,
          ),
        ),
      );

      expect(find.text('LOCAL MCP BRIDGE'), findsOneWidget);
      expect(find.text('STOPPED'), findsOneWidget);
      expect(find.text('127.0.0.1 · BEARER AUTH'), findsOneWidget);
      expect(find.text('23 tools'), findsOneWidget);
      expect(find.text('Start MCP Bridge'), findsOneWidget);

      // Invalid port should show error and not start
      await tester.enterText(find.byKey(const Key('mcp-port-input')), '99999');
      await tester.tap(find.byKey(const Key('mcp-toggle-btn')));
      await tester.pump();
      expect(startedPort, isNull);
      expect(
        find.text('Enter a valid TCP port between 1 and 65535.'),
        findsOneWidget,
      );

      // Valid port starts the bridge
      await tester.enterText(find.byKey(const Key('mcp-port-input')), '48123');
      await tester.tap(find.byKey(const Key('mcp-toggle-btn')));
      await tester.pumpAndSettle();
      expect(startedPort, 48123);

      await tester.tap(find.byTooltip('Close MCP Bridge'));
      await tester.pump();
      expect(closed, isTrue);
    });

    testWidgets(
        'running state shows endpoint URL, revealable Bearer token, copy MCP JSON, call log, and stop',
        (WidgetTester tester) async {
      var stopCalls = 0;
      String? copiedText;

      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (MethodCall call) async {
          if (call.method == 'Clipboard.setData') {
            copiedText = (call.arguments as Map)['text'] as String?;
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );

      final nowMs = DateTime.now().millisecondsSinceEpoch;
      await tester.pumpWidget(
        wrapSheet(
          McpBridgeSheet(
            state: McpBridgeViewState(
              running: true,
              endpointUrl: 'http://127.0.0.1:47832/mcp',
              authToken: 'earthly_mcp_secret_token_9876',
              port: 47832,
              toolCount: 23,
              totalCalls: 4,
              recentCalls: [
                McpBridgeCallEntry(
                  timestampMs: nowMs - 30000,
                  toolName: 'capture_map_snapshot',
                  ok: true,
                  summary: 'Captured 1280x720 viewport PNG',
                ),
                McpBridgeCallEntry(
                  timestampMs: nowMs - 90000,
                  toolName: 'search_places',
                  ok: false,
                  summary: 'Empty query string',
                ),
              ],
            ),
            onStart: (_) async {},
            onStop: () async => stopCalls++,
            onClose: () {},
          ),
          brightness: Brightness.dark,
        ),
      );

      expect(find.text('RUNNING'), findsOneWidget);
      expect(find.text('http://127.0.0.1:47832/mcp'), findsOneWidget);
      expect(find.text('4 calls'), findsOneWidget);

      // Token is masked by default
      final tokenValueFinder = find.byKey(const Key('mcp-token-value'));
      await tester.scrollUntilVisible(
        tokenValueFinder,
        120,
        scrollable: verticalScrollable(),
      );
      await tester.ensureVisible(tokenValueFinder);
      await tester.pumpAndSettle();
      expect(find.text('earthly_mcp_secret_token_9876'), findsNothing);
      final tokenWidget = tester.widget<SelectableText>(tokenValueFinder);
      expect(tokenWidget.data, contains('•'));

      // Reveal token
      final revealBtn = find.byKey(const Key('mcp-reveal-token-btn'));
      await tester.ensureVisible(revealBtn);
      await tester.pumpAndSettle();
      await tester.tap(revealBtn);
      await tester.pump();
      expect(find.text('earthly_mcp_secret_token_9876'), findsOneWidget);

      // Copy MCP Client JSON
      final copyConfigBtn = find.byKey(const Key('mcp-copy-config-btn'));
      await tester.scrollUntilVisible(
        copyConfigBtn,
        120,
        scrollable: verticalScrollable(),
      );
      await tester.ensureVisible(copyConfigBtn);
      await tester.pumpAndSettle();
      await tester.tap(copyConfigBtn);
      await tester.pump();
      expect(copiedText, isNotNull);
      final parsed = jsonDecode(copiedText!) as Map<String, dynamic>;
      final earthlyServer = (parsed['mcpServers']
          as Map<String, dynamic>)['earthly'] as Map<String, dynamic>;
      expect(earthlyServer['url'], 'http://127.0.0.1:47832/mcp');
      expect(
        (earthlyServer['headers'] as Map<String, dynamic>)['Authorization'],
        'Bearer earthly_mcp_secret_token_9876',
      );

      // Recent call log entries
      final logFinder = find.text('capture_map_snapshot');
      await tester.scrollUntilVisible(
        logFinder,
        120,
        scrollable: verticalScrollable(),
      );
      expect(find.text('capture_map_snapshot'), findsOneWidget);
      expect(find.text('Captured 1280x720 viewport PNG'), findsOneWidget);
      expect(find.text('OK'), findsOneWidget);
      expect(find.text('search_places'), findsOneWidget);
      expect(find.text('Empty query string'), findsOneWidget);
      expect(find.text('ERR'), findsOneWidget);

      // Stop bridge
      final toggleFinder = find.byKey(const Key('mcp-toggle-btn'));
      await tester.scrollUntilVisible(
        toggleFinder,
        -120,
        scrollable: verticalScrollable(),
      );
      await tester.ensureVisible(toggleFinder);
      await tester.pumpAndSettle();
      await tester.tap(toggleFinder);
      await tester.pumpAndSettle();
      expect(stopCalls, 1);
    });
  });
}
