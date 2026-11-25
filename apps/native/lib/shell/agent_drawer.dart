import 'package:material_ui/material_ui.dart';

import '../src/rust/api/agent.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';

@immutable
class CopilotMessage {
  const CopilotMessage({
    required this.role,
    required this.content,
    this.toolCalls = const [],
    this.isError = false,
  });

  final String role; // 'user' | 'assistant'
  final String content;
  final List<AgentToolRecordDto> toolCalls;
  final bool isError;
}

@immutable
class CopilotProviderSettings {
  const CopilotProviderSettings({
    required this.presetName,
    required this.baseUrl,
    required this.model,
    this.apiKey = '',
  });

  final String presetName;
  final String baseUrl;
  final String model;
  final String apiKey;

  static const offline = CopilotProviderSettings(
    presetName: 'Offline Rust Spatial',
    baseUrl: '',
    model: 'offline-spatial',
  );

  static const localOllama = CopilotProviderSettings(
    presetName: 'Local Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
  );

  static const openRouter = CopilotProviderSettings(
    presetName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.5-sonnet',
  );
}

/// Native AI Cartography Copilot backed by `crates/earthly-agent` + `earthly-geo`
/// running inside the Google-Maps-style independent `EarthlyMapDrawer`.
class AgentDrawer extends StatefulWidget {
  const AgentDrawer({
    required this.messages,
    required this.settings,
    required this.busy,
    required this.onSettingsChanged,
    required this.onSendPrompt,
    required this.onClearChat,
    required this.onClose,
    super.key,
  });

  final List<CopilotMessage> messages;
  final CopilotProviderSettings settings;
  final bool busy;
  final ValueChanged<CopilotProviderSettings> onSettingsChanged;
  final ValueChanged<String> onSendPrompt;
  final VoidCallback onClearChat;
  final VoidCallback onClose;

  @override
  State<AgentDrawer> createState() => _AgentDrawerState();
}

class _AgentDrawerState extends State<AgentDrawer> {
  final _promptController = TextEditingController();
  late final TextEditingController _baseUrlController =
      TextEditingController(text: widget.settings.baseUrl);
  late final TextEditingController _modelController =
      TextEditingController(text: widget.settings.model);
  late final TextEditingController _apiKeyController =
      TextEditingController(text: widget.settings.apiKey);
  bool _showSettings = false;

  @override
  void dispose() {
    _promptController.dispose();
    _baseUrlController.dispose();
    _modelController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  void _applyPreset(CopilotProviderSettings preset) {
    _baseUrlController.text = preset.baseUrl;
    _modelController.text = preset.model;
    widget.onSettingsChanged(
      CopilotProviderSettings(
        presetName: preset.presetName,
        baseUrl: preset.baseUrl,
        model: preset.model,
        apiKey: _apiKeyController.text.trim(),
      ),
    );
  }

  void _saveCustomSettings() {
    widget.onSettingsChanged(
      CopilotProviderSettings(
        presetName: _baseUrlController.text.trim().isEmpty
            ? 'Offline Rust Spatial'
            : 'Custom LLM',
        baseUrl: _baseUrlController.text.trim(),
        model: _modelController.text.trim().isEmpty
            ? 'offline-spatial'
            : _modelController.text.trim(),
        apiKey: _apiKeyController.text.trim(),
      ),
    );
    setState(() => _showSettings = false);
  }

  void _submit([String? overridePrompt]) {
    final text = (overridePrompt ?? _promptController.text).trim();
    if (text.isEmpty || widget.busy) return;
    if (overridePrompt == null) _promptController.clear();
    widget.onSendPrompt(text);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return EarthlyMapDrawer(
      initialFraction: 0.54,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            Icon(
              Icons.auto_awesome,
              size: 16,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'RUST AGENT · EARTHLY-GEO',
                    style: theme.textTheme.labelMedium?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.6,
                    ),
                  ),
                  Text(
                    '${widget.settings.presetName} · ${widget.settings.model}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 10),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Provider settings',
              visualDensity: VisualDensity.compact,
              onPressed: () => setState(() => _showSettings = !_showSettings),
              icon: Icon(
                _showSettings ? Icons.tune : Icons.settings_outlined,
                size: 18,
              ),
            ),
            if (widget.messages.isNotEmpty)
              IconButton(
                tooltip: 'Clear conversation',
                visualDensity: VisualDensity.compact,
                onPressed: widget.onClearChat,
                icon: const Icon(Icons.delete_sweep_outlined, size: 18),
              ),
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: widget.onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          if (_showSettings)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.primary.withValues(alpha: 0.05),
                border: Border(bottom: BorderSide(color: theme.dividerColor)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      ChoiceChip(
                        label: const Text('Offline Rust'),
                        selected: widget.settings.baseUrl.isEmpty,
                        onSelected: (_) =>
                            _applyPreset(CopilotProviderSettings.offline),
                      ),
                      ChoiceChip(
                        label: const Text('Local Ollama'),
                        selected: widget.settings.baseUrl.contains('11434'),
                        onSelected: (_) =>
                            _applyPreset(CopilotProviderSettings.localOllama),
                      ),
                      ChoiceChip(
                        label: const Text('OpenRouter'),
                        selected:
                            widget.settings.baseUrl.contains('openrouter.ai'),
                        onSelected: (_) =>
                            _applyPreset(CopilotProviderSettings.openRouter),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _baseUrlController,
                    decoration: const InputDecoration(
                      isDense: true,
                      border:
                          OutlineInputBorder(borderRadius: BorderRadius.zero),
                      labelText: 'OpenAI-compatible Base URL (blank = offline)',
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _modelController,
                          decoration: const InputDecoration(
                            isDense: true,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.zero,
                            ),
                            labelText: 'Model',
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: TextField(
                          controller: _apiKeyController,
                          obscureText: true,
                          decoration: const InputDecoration(
                            isDense: true,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.zero,
                            ),
                            labelText: 'API Key (optional)',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton(
                      onPressed: _saveCustomSettings,
                      child: const Text('Apply Provider'),
                    ),
                  ),
                ],
              ),
            ),

          // Quick spatial prompts
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: Row(
              children: [
                for (final chip in const [
                  'Measure my draft',
                  'Create 120m corridor',
                  'Extrude flow arrow',
                  'Offset +80m',
                  'Union polygons',
                  'Add callout: Verified in field',
                  'Drop pin here',
                  'Atlas status',
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ActionChip(
                      label: Text(
                        chip,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                        ),
                      ),
                      onPressed: widget.busy ? null : () => _submit(chip),
                    ),
                  ),
              ],
            ),
          ),

          // Chat transcript (independent scrolling!)
          Expanded(
            child: widget.messages.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Text(
                        'Rust `earthly-agent` executes geometry, measurement, callout, and Atlas workspace tools directly on your live map.\n\nTap a quick action above or type a prompt below.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                    itemCount: widget.messages.length,
                    itemBuilder: (context, index) {
                      final m = widget.messages[index];
                      final isUser = m.role == 'user';
                      return Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: m.isError
                              ? EarthlyColors.destructive
                                  .withValues(alpha: 0.10)
                              : isUser
                                  ? theme.colorScheme.primary
                                      .withValues(alpha: 0.10)
                                  : theme.colorScheme.surface,
                          border: Border(
                            left: BorderSide(
                              color: m.isError
                                  ? EarthlyColors.destructive
                                  : isUser
                                      ? theme.colorScheme.primary
                                      : EarthlyColors.commentGreen,
                              width: 3,
                            ),
                            top: BorderSide(color: theme.dividerColor),
                            right: BorderSide(color: theme.dividerColor),
                            bottom: BorderSide(color: theme.dividerColor),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              isUser ? 'YOU' : 'EARTHLY AGENT',
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            if (m.toolCalls.isNotEmpty) ...[
                              const SizedBox(height: 6),
                              Wrap(
                                spacing: 6,
                                runSpacing: 4,
                                children: [
                                  for (final tc in m.toolCalls)
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                        vertical: 3,
                                      ),
                                      color: (tc.ok
                                              ? EarthlyColors.commentGreen
                                              : EarthlyColors.destructive)
                                          .withValues(alpha: 0.12),
                                      child: Text(
                                        '${tc.ok ? "✓" : "✗"} ${tc.name}: ${tc.summary}',
                                        style: TextStyle(
                                          fontFamily: 'monospace',
                                          fontSize: 10,
                                          color: tc.ok
                                              ? EarthlyColors.commentGreen
                                              : EarthlyColors.destructive,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ],
                            const SizedBox(height: 6),
                            Text(m.content, style: theme.textTheme.bodySmall),
                          ],
                        ),
                      );
                    },
                  ),
          ),

          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _promptController,
                    onSubmitted: (_) => _submit(),
                    decoration: const InputDecoration(
                      isDense: true,
                      border:
                          OutlineInputBorder(borderRadius: BorderRadius.zero),
                      hintText: 'Ask Earthly Agent to draw, buffer, measure…',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: widget.busy ? null : () => _submit(),
                  child: widget.busy
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Run'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
