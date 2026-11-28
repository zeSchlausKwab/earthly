import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';
import 'earthly_toast.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

/// Immutable record of a recent MCP tool invocation handled by the local bridge.
@immutable
class McpBridgeCallEntry {
  const McpBridgeCallEntry({
    required this.timestampMs,
    required this.toolName,
    required this.ok,
    required this.summary,
  });

  final int timestampMs;
  final String toolName;
  final bool ok;
  final String summary;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is McpBridgeCallEntry &&
          runtimeType == other.runtimeType &&
          timestampMs == other.timestampMs &&
          toolName == other.toolName &&
          ok == other.ok &&
          summary == other.summary;

  @override
  int get hashCode => Object.hash(timestampMs, toolName, ok, summary);
}

/// Immutable view state for the Local MCP Desktop Bridge drawer.
@immutable
class McpBridgeViewState {
  const McpBridgeViewState({
    required this.running,
    this.endpointUrl,
    this.authToken,
    this.port = 47832,
    this.toolCount = 0,
    this.totalCalls = 0,
    this.recentCalls = const <McpBridgeCallEntry>[],
  });

  final bool running;
  final String? endpointUrl;
  final String? authToken;
  final int port;
  final int toolCount;
  final int totalCalls;
  final List<McpBridgeCallEntry> recentCalls;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is McpBridgeViewState &&
          runtimeType == other.runtimeType &&
          running == other.running &&
          endpointUrl == other.endpointUrl &&
          authToken == other.authToken &&
          port == other.port &&
          toolCount == other.toolCount &&
          totalCalls == other.totalCalls &&
          _listEquals(recentCalls, other.recentCalls);

  @override
  int get hashCode => Object.hash(
        running,
        endpointUrl,
        authToken,
        port,
        toolCount,
        totalCalls,
        Object.hashAll(recentCalls),
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

/// Non-blocking frosted-glass drawer for controlling the loopback-only
/// Local MCP Desktop Bridge (`EarthlyMapDrawer` shell).
class McpBridgeSheet extends StatefulWidget {
  const McpBridgeSheet({
    required this.state,
    required this.onStart,
    required this.onStop,
    required this.onClose,
    this.busy = false,
    super.key,
  });

  static const int defaultPort = 47832;

  final McpBridgeViewState state;
  final FutureOr<void> Function(int port) onStart;
  final FutureOr<void> Function() onStop;
  final VoidCallback onClose;
  final bool busy;

  /// Generates ready-to-paste Claude Desktop / Cursor MCP client JSON config.
  static String buildClientConfigJson(String endpointUrl, String authToken) {
    return const JsonEncoder.withIndent('  ').convert(<String, dynamic>{
      'mcpServers': <String, dynamic>{
        'earthly': <String, dynamic>{
          'url': endpointUrl,
          'headers': <String, dynamic>{
            'Authorization': 'Bearer $authToken',
          },
        },
      },
    });
  }

  @override
  State<McpBridgeSheet> createState() => _McpBridgeSheetState();
}

class _McpBridgeSheetState extends State<McpBridgeSheet> {
  late final TextEditingController _portController = TextEditingController(
    text:
        '${widget.state.port > 0 ? widget.state.port : McpBridgeSheet.defaultPort}',
  );

  bool _revealToken = false;
  bool _localBusy = false;
  String? _error;

  bool get _isBusy => widget.busy || _localBusy;

  @override
  void didUpdateWidget(covariant McpBridgeSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.state.running && oldWidget.state.port != widget.state.port) {
      final port =
          widget.state.port > 0 ? widget.state.port : McpBridgeSheet.defaultPort;
      _portController.text = '$port';
    }
  }

  @override
  void dispose() {
    _portController.dispose();
    super.dispose();
  }

  Future<void> _handleToggle() async {
    if (_isBusy) return;
    if (widget.state.running) {
      await _runGuarded(() => widget.onStop());
      return;
    }

    final parsedPort = int.tryParse(_portController.text.trim());
    if (parsedPort == null || parsedPort < 1 || parsedPort > 65535) {
      setState(() {
        _error = 'Enter a valid TCP port between 1 and 65535.';
      });
      return;
    }

    await _runGuarded(() => widget.onStart(parsedPort));
  }

  Future<void> _runGuarded(FutureOr<void> Function() task) async {
    setState(() {
      _localBusy = true;
      _error = null;
    });
    try {
      await task();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) {
        setState(() => _localBusy = false);
      }
    }
  }

  void _copy(String text, String toast) {
    Clipboard.setData(ClipboardData(text: text));
    EarthlyToast.success(context, toast);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final state = widget.state;
    final endpoint = (state.endpointUrl ?? '').trim().isNotEmpty
        ? state.endpointUrl!.trim()
        : 'http://127.0.0.1:${state.port}/mcp';
    final token = (state.authToken ?? '').trim();

    return EarthlyMapDrawer(
      initialFraction: 0.64,
      accentTopBorder: true,
      desktopSide: EarthlyDrawerSide.right,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 8),
        child: Row(
          children: [
            const Icon(
              Icons.hub_outlined,
              size: 18,
              color: EarthlyColors.amber,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Row(
                children: [
                  Flexible(
                    child: Text(
                      'Local MCP Bridge',
                      maxLines: 1,
                      softWrap: false,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  EarthlyBadge(
                    label: state.running ? 'RUNNING' : 'STOPPED',
                    color: state.running
                        ? EarthlyColors.commentGreen
                        : EarthlyColors.published,
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Close MCP Bridge',
              visualDensity: VisualDensity.compact,
              onPressed: widget.onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
        children: [
          _buildSecurityOverviewCard(theme, isDark, state),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: EarthlyColors.destructive.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: EarthlyColors.destructive.withValues(alpha: 0.45),
                ),
              ),
              child: Text(
                _error!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11.5,
                  color: EarthlyColors.destructive,
                ),
              ),
            ),
          ],
          const SizedBox(height: 12),
          _buildControlCard(isDark, state),
          if (state.running) ...[
            const SizedBox(height: 12),
            _buildConnectionCard(theme, isDark, endpoint, token),
          ],
          const SizedBox(height: 12),
          _buildCallLogCard(theme, isDark, state),
        ],
      ),
    );
  }

  Widget _buildSecurityOverviewCard(
    ThemeData theme,
    bool isDark,
    McpBridgeViewState state,
  ) {
    return _McpCard(
      isDark: isDark,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              const EarthlyBadge(
                label: '127.0.0.1 · BEARER AUTH',
                color: EarthlyColors.commentGreen,
              ),
              EarthlyBadge(
                label: '${state.toolCount} tools',
                color: isDark
                    ? EarthlyColors.infoCyanBright
                    : EarthlyColors.infoCyan,
              ),
              EarthlyBadge(
                label: '${state.totalCalls} calls',
                color: EarthlyColors.amber,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Exposes Earthly spatial & Nostr tools over HTTP JSON-RPC to local desktop MCP clients (Claude Desktop, Cursor) bound strictly to loopback with a per-session Bearer secret.',
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _buildControlCard(bool isDark, McpBridgeViewState state) {
    return _McpCard(
      isDark: isDark,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('mcp-port-input'),
            controller: _portController,
            enabled: !state.running && !_isBusy,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Loopback Port (127.0.0.1)',
              hintText: '47832',
            ),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            key: const Key('mcp-toggle-btn'),
            style: state.running
                ? FilledButton.styleFrom(
                    backgroundColor: EarthlyColors.destructive,
                    foregroundColor: Colors.white,
                  )
                : null,
            onPressed: _isBusy ? null : _handleToggle,
            icon: _isBusy
                ? const SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(
                    state.running
                        ? Icons.stop_circle_outlined
                        : Icons.play_arrow,
                    size: 17,
                  ),
            label: Text(
              state.running ? 'Stop MCP Bridge' : 'Start MCP Bridge',
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConnectionCard(
    ThemeData theme,
    bool isDark,
    String endpoint,
    String token,
  ) {
    final maskedToken = token.isEmpty
        ? '—'
        : (_revealToken ? token : '•' * token.length.clamp(12, 24));
    final clientConfigJson = McpBridgeSheet.buildClientConfigJson(
      endpoint,
      token,
    );

    return _McpCard(
      isDark: isDark,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'CLIENT CONNECTION',
            style: theme.textTheme.labelLarge?.copyWith(
              fontFamily: 'monospace',
              letterSpacing: 0.7,
            ),
          ),
          const SizedBox(height: 8),
          Text('Endpoint URL', style: theme.textTheme.labelSmall),
          const SizedBox(height: 4),
          _McpValueBox(
            value: endpoint,
            actions: [
              IconButton(
                key: const Key('mcp-copy-url-btn'),
                tooltip: 'Copy endpoint URL',
                visualDensity: VisualDensity.compact,
                onPressed: () => _copy(endpoint, 'Copied MCP endpoint URL'),
                icon: const Icon(Icons.copy, size: 15),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text('Bearer Auth Token', style: theme.textTheme.labelSmall),
          const SizedBox(height: 4),
          _McpValueBox(
            value: maskedToken,
            valueKey: const Key('mcp-token-value'),
            actions: [
              IconButton(
                key: const Key('mcp-reveal-token-btn'),
                tooltip: _revealToken
                    ? 'Hide Bearer token'
                    : 'Reveal Bearer token',
                visualDensity: VisualDensity.compact,
                onPressed: () => setState(() => _revealToken = !_revealToken),
                icon: Icon(
                  _revealToken
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                  size: 16,
                ),
              ),
              IconButton(
                key: const Key('mcp-copy-token-btn'),
                tooltip: 'Copy Bearer token',
                visualDensity: VisualDensity.compact,
                onPressed: token.isEmpty
                    ? null
                    : () => _copy(token, 'Copied MCP Bearer token'),
                icon: const Icon(Icons.copy, size: 15),
              ),
            ],
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const Key('mcp-copy-config-btn'),
            onPressed: () => _copy(
              clientConfigJson,
              'Copied Claude/Cursor MCP client JSON',
            ),
            icon: const Icon(Icons.data_object, size: 16),
            label: const Text('Copy MCP Client JSON'),
          ),
        ],
      ),
    );
  }

  Widget _buildCallLogCard(
    ThemeData theme,
    bool isDark,
    McpBridgeViewState state,
  ) {
    return _McpCard(
      isDark: isDark,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Flexible(
                child: Text(
                  'RECENT TOOL CALLS',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelLarge?.copyWith(
                    fontFamily: 'monospace',
                    letterSpacing: 0.7,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              EarthlyBadge(
                label: '${state.recentCalls.length}',
                color: EarthlyColors.published,
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (state.recentCalls.isEmpty)
            Text(
              'Incoming MCP initialize, tools/list, and tools/call requests will be logged here.',
              style: theme.textTheme.bodySmall,
            )
          else
            for (var i = 0; i < state.recentCalls.length; i++) ...[
              _CallLogRow(entry: state.recentCalls[i]),
              if (i < state.recentCalls.length - 1) const Divider(height: 12),
            ],
        ],
      ),
    );
  }
}

class _McpCard extends StatelessWidget {
  const _McpCard({
    required this.isDark,
    required this.child,
  });

  final bool isDark;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest
            .withValues(alpha: isDark ? 0.72 : 0.90),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.dividerColor),
      ),
      child: child,
    );
  }
}

class _McpValueBox extends StatelessWidget {
  const _McpValueBox({
    required this.value,
    required this.actions,
    this.valueKey,
  });

  final String value;
  final List<Widget> actions;
  final Key? valueKey;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.dividerColor),
      ),
      child: Row(
        children: [
          Expanded(
            child: SelectableText(
              value,
              key: valueKey,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 11.5,
              ),
            ),
          ),
          ...actions,
        ],
      ),
    );
  }
}

class _CallLogRow extends StatelessWidget {
  const _CallLogRow({required this.entry});

  final McpBridgeCallEntry entry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final statusColor =
        entry.ok ? EarthlyColors.commentGreen : EarthlyColors.destructive;
    final timeStr = formatRelativeUnixDate(entry.timestampMs ~/ 1000);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            EarthlyBadge(
              label: entry.ok ? 'OK' : 'ERR',
              color: statusColor,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                entry.toolName,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            if (timeStr.isNotEmpty) ...[
              const SizedBox(width: 8),
              Text(
                timeStr,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10.5,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
        if (entry.summary.trim().isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(
            entry.summary.trim(),
            style: theme.textTheme.bodySmall?.copyWith(fontSize: 12),
          ),
        ],
      ],
    );
  }
}
