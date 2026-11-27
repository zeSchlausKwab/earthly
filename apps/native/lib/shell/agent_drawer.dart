import 'dart:async';
import 'dart:convert';

import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/agent.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'map_drawer.dart';

@immutable
class CopilotMessage {
  const CopilotMessage({
    required this.role,
    required this.content,
    this.toolCalls = const [],
    this.isError = false,
    this.promptTokens,
    this.completionTokens,
    this.totalTokens,
    this.cashuSpentSats,
    this.cashuRefundedSats,
    this.cashuRefundToken,
  });

  final String role; // 'user' | 'assistant'
  final String content;
  final List<AgentToolRecordDto> toolCalls;
  final bool isError;
  final int? promptTokens;
  final int? completionTokens;
  final int? totalTokens;
  final int? cashuSpentSats;
  final int? cashuRefundedSats;
  final String? cashuRefundToken;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'role': role,
        'content': content,
        'isError': isError,
        if (promptTokens != null) 'promptTokens': promptTokens,
        if (completionTokens != null) 'completionTokens': completionTokens,
        if (totalTokens != null) 'totalTokens': totalTokens,
        if (cashuSpentSats != null) 'cashuSpentSats': cashuSpentSats,
        if (cashuRefundedSats != null) 'cashuRefundedSats': cashuRefundedSats,
        if (cashuRefundToken != null) 'cashuRefundToken': cashuRefundToken,
        if (toolCalls.isNotEmpty)
          'toolCalls': [
            for (final t in toolCalls)
              <String, dynamic>{
                'name': t.name,
                'ok': t.ok,
                'summary': t.summary,
              },
          ],
      };

  static CopilotMessage? fromJson(Map<String, dynamic> m) {
    final role = m['role'] as String?;
    final content = m['content'] as String?;
    if (role == null || content == null) return null;
    final rawTools = m['toolCalls'] as List?;
    final tools = <AgentToolRecordDto>[
      if (rawTools != null)
        for (final item in rawTools)
          if (item is Map && item['name'] is String && item['summary'] is String)
            AgentToolRecordDto(
              name: item['name'] as String,
              ok: (item['ok'] as bool?) ?? true,
              summary: item['summary'] as String,
            ),
    ];
    return CopilotMessage(
      role: role,
      content: content,
      toolCalls: tools,
      isError: (m['isError'] as bool?) ?? false,
      promptTokens: (m['promptTokens'] as num?)?.toInt(),
      completionTokens: (m['completionTokens'] as num?)?.toInt(),
      totalTokens: (m['totalTokens'] as num?)?.toInt(),
      cashuSpentSats: (m['cashuSpentSats'] as num?)?.toInt(),
      cashuRefundedSats: (m['cashuRefundedSats'] as num?)?.toInt(),
      cashuRefundToken: m['cashuRefundToken'] as String?,
    );
  }
}

@immutable
class CopilotThread {
  const CopilotThread({
    required this.id,
    required this.title,
    required this.updatedAtMs,
    this.messages = const [],
  });

  final String id;
  final String title;
  final int updatedAtMs;
  final List<CopilotMessage> messages;

  CopilotThread copyWith({
    String? title,
    int? updatedAtMs,
    List<CopilotMessage>? messages,
  }) =>
      CopilotThread(
        id: id,
        title: title ?? this.title,
        updatedAtMs: updatedAtMs ?? this.updatedAtMs,
        messages: messages ?? this.messages,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'title': title,
        'updatedAtMs': updatedAtMs,
        'messages': [
          for (final m in messages.skip(messages.length > 40 ? messages.length - 40 : 0))
            m.toJson(),
        ],
      };

  static CopilotThread? fromJson(Map<String, dynamic> m) {
    final id = m['id'] as String?;
    final title = m['title'] as String?;
    if (id == null || id.isEmpty || title == null) return null;
    final rawMsgs = m['messages'] as List?;
    final msgs = <CopilotMessage>[
      if (rawMsgs != null)
        for (final item in rawMsgs)
          if (item is Map)
            ?CopilotMessage.fromJson(Map<String, dynamic>.from(item)),
    ];
    return CopilotThread(
      id: id,
      title: title,
      updatedAtMs: (m['updatedAtMs'] as num?)?.toInt() ?? 0,
      messages: msgs,
    );
  }

  static List<CopilotThread> decodePersistedJson(String raw) {
    final parsed = jsonDecode(raw);
    if (parsed is Map) {
      final rawThreads = parsed['threads'] as List?;
      if (rawThreads != null) {
        return [
          for (final t in rawThreads)
            if (t is Map)
              ?CopilotThread.fromJson(Map<String, dynamic>.from(t)),
        ];
      }
    }
    if (parsed is List) {
      final legacyMsgs = <CopilotMessage>[
        for (final item in parsed)
          if (item is Map)
            ?CopilotMessage.fromJson(Map<String, dynamic>.from(item)),
      ];
      if (legacyMsgs.isNotEmpty) {
        return [
          CopilotThread(
            id: 'thread-default',
            title: legacyMsgs.first.content.length > 26
                ? '${legacyMsgs.first.content.substring(0, 26)}…'
                : legacyMsgs.first.content,
            updatedAtMs: DateTime.now().millisecondsSinceEpoch,
            messages: legacyMsgs,
          ),
        ];
      }
    }
    return const [];
  }
}

/// Staged AI geometry proposal shown as an amber dashed ghost overlay on the
/// live MapLibre canvas until the user accepts or discards (`safeEditing`).
@immutable
class AgentAttachment {
  const AgentAttachment({
    required this.fileName,
    required this.formatLabel,
    required this.featureCount,
    required this.summaryText,
    this.importedGeojson,
  });

  final String fileName;
  final String formatLabel;
  final int featureCount;
  final String summaryText;
  final String? importedGeojson;
}

@immutable
class PendingAiEdit {
  const PendingAiEdit({
    required this.proposedGeojson,
    required this.diffAdded,
    required this.diffModified,
    required this.diffRemoved,
    required this.summary,
  });

  final String proposedGeojson;
  final int diffAdded;
  final int diffModified;
  final int diffRemoved;
  final String summary;
}

@immutable
class CopilotProviderSettings {
  const CopilotProviderSettings({
    required this.presetName,
    required this.baseUrl,
    required this.model,
    this.apiKey = '',
    this.providerType,
    this.autoPayCashu = false,
    this.cashuMaxSats = 25,
    this.cashuToken = '',
  });

  final String presetName;
  final String baseUrl;
  final String model;
  final String apiKey;
  final String? providerType;
  final bool autoPayCashu;
  final int cashuMaxSats;
  final String cashuToken;

  bool get isRoutstr =>
      providerType?.toLowerCase() == 'routstr' ||
      baseUrl.toLowerCase().contains('routstr.com') ||
      presetName.toLowerCase().contains('routstr');

  String get effectiveProviderType => isRoutstr ? 'routstr' : (providerType ?? '');

  CopilotProviderSettings copyWith({
    String? presetName,
    String? baseUrl,
    String? model,
    String? apiKey,
    String? providerType,
    bool? autoPayCashu,
    int? cashuMaxSats,
    String? cashuToken,
  }) =>
      CopilotProviderSettings(
        presetName: presetName ?? this.presetName,
        baseUrl: baseUrl ?? this.baseUrl,
        model: model ?? this.model,
        apiKey: apiKey ?? this.apiKey,
        providerType: providerType ?? this.providerType,
        autoPayCashu: autoPayCashu ?? this.autoPayCashu,
        cashuMaxSats: cashuMaxSats ?? this.cashuMaxSats,
        cashuToken: cashuToken ?? this.cashuToken,
      );

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

  static const routstr = CopilotProviderSettings(
    presetName: 'Routstr (Cashu)',
    baseUrl: 'https://api.routstr.com/v1',
    model: 'openai/gpt-4o-mini',
    providerType: 'routstr',
    autoPayCashu: true,
    cashuMaxSats: 25,
  );
}

/// Native AI Cartography Copilot + CORS-free Research / Source Pane backed by
/// `crates/earthly-agent` + `earthly-geo` with Web-parity `safeEditing` amber
/// ghost diff previews ("Accept to Draft" / "Discard").
class AgentDrawer extends StatefulWidget {
  const AgentDrawer({
    required this.messages,
    required this.settings,
    required this.busy,
    required this.onSettingsChanged,
    required this.onSendPrompt,
    required this.onClearChat,
    required this.onClose,
    this.safeEditing = true,
    this.onSafeEditingChanged,
    this.pendingEdit,
    this.onAcceptPendingEdit,
    this.onDiscardPendingEdit,
    this.initialResearchSource,
    this.onExtractSourceToMap,
    this.onFocusCoord,
    this.onCiteSourceInStory,
    this.onDiscoverModels,
    this.threads = const <CopilotThread>[],
    this.activeThreadId,
    this.onCreateThread,
    this.onSelectThread,
    this.onDeleteThread,
    this.streamingText = '',
    this.activeToolStatus,
    this.liveToolCalls = const <AgentToolRecordDto>[],
    this.shelfMaps = const <({String address, String title})>[],
    this.workingSetAddresses = const <String>{},
    this.onToggleWorkingSet,
    this.pendingAttachment,
    this.onPickAttachment,
    this.onClearAttachment,
    this.visionSupport = 'no-vision',
    this.attachMapView = false,
    this.onAttachMapViewChanged,
    super.key,
  });

  final List<CopilotMessage> messages;
  final CopilotProviderSettings settings;
  final bool busy;
  final bool safeEditing;
  final ValueChanged<bool>? onSafeEditingChanged;
  final PendingAiEdit? pendingEdit;
  final VoidCallback? onAcceptPendingEdit;
  final VoidCallback? onDiscardPendingEdit;
  final ResearchSourceDto? initialResearchSource;
  final ValueChanged<ResearchSourceDto>? onExtractSourceToMap;
  final void Function(double lat, double lon, String label)? onFocusCoord;
  final ValueChanged<ResearchSourceDto>? onCiteSourceInStory;
  final Future<List<String>> Function(String baseUrl, String apiKey)?
      onDiscoverModels;
  final List<CopilotThread> threads;
  final String? activeThreadId;
  final VoidCallback? onCreateThread;
  final ValueChanged<String>? onSelectThread;
  final ValueChanged<String>? onDeleteThread;
  final String streamingText;
  final String? activeToolStatus;
  final List<AgentToolRecordDto> liveToolCalls;
  final List<({String address, String title})> shelfMaps;
  final Set<String> workingSetAddresses;
  final ValueChanged<String>? onToggleWorkingSet;
  final AgentAttachment? pendingAttachment;
  final VoidCallback? onPickAttachment;
  final VoidCallback? onClearAttachment;
  final String visionSupport;
  final bool attachMapView;
  final ValueChanged<bool>? onAttachMapViewChanged;
  final ValueChanged<CopilotProviderSettings> onSettingsChanged;
  final ValueChanged<String> onSendPrompt;
  final VoidCallback onClearChat;
  final VoidCallback onClose;

  @override
  State<AgentDrawer> createState() => _AgentDrawerState();
}

class _AgentDrawerState extends State<AgentDrawer>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);
  final _promptController = TextEditingController();
  final _urlController = TextEditingController();
  late final TextEditingController _baseUrlController =
      TextEditingController(text: widget.settings.baseUrl);
  late final TextEditingController _modelController =
      TextEditingController(text: widget.settings.model);
  late final TextEditingController _apiKeyController =
      TextEditingController(text: widget.settings.apiKey);
  late final TextEditingController _cashuTokenController =
      TextEditingController(text: widget.settings.cashuToken);
  late final TextEditingController _cashuMaxSatsController =
      TextEditingController(text: widget.settings.cashuMaxSats.toString());

  bool _showSettings = false;
  late bool _autoPayCashu = widget.settings.autoPayCashu;
  bool _fetchingSource = false;
  bool _discoveringModels = false;
  String? _sourceError;
  String? _discoverError;
  List<String> _discoveredModels = const <String>[];
  late ResearchSourceDto? _researchSource = widget.initialResearchSource;

  @override
  void didUpdateWidget(covariant AgentDrawer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.settings != widget.settings) {
      if (_baseUrlController.text != widget.settings.baseUrl) {
        _baseUrlController.text = widget.settings.baseUrl;
      }
      if (_modelController.text != widget.settings.model) {
        _modelController.text = widget.settings.model;
      }
      if (_apiKeyController.text != widget.settings.apiKey) {
        _apiKeyController.text = widget.settings.apiKey;
      }
      if (_cashuTokenController.text != widget.settings.cashuToken) {
        _cashuTokenController.text = widget.settings.cashuToken;
      }
      final maxStr = widget.settings.cashuMaxSats.toString();
      if (_cashuMaxSatsController.text != maxStr) {
        _cashuMaxSatsController.text = maxStr;
      }
      _autoPayCashu = widget.settings.autoPayCashu;
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    _promptController.dispose();
    _urlController.dispose();
    _baseUrlController.dispose();
    _modelController.dispose();
    _apiKeyController.dispose();
    _cashuTokenController.dispose();
    _cashuMaxSatsController.dispose();
    super.dispose();
  }

  Future<void> _fetchSourceUrl([String? overrideUrl]) async {
    final raw = (overrideUrl ?? _urlController.text).trim();
    if (raw.isEmpty || _fetchingSource) return;
    final url = (raw.startsWith('http://') || raw.startsWith('https://'))
        ? raw
        : 'https://$raw';
    _urlController.text = url;
    setState(() {
      _fetchingSource = true;
      _sourceError = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final fetched = await fetchResearchSource(url: url);
      if (!mounted) return;
      setState(() => _researchSource = fetched);
    } catch (err) {
      if (!mounted) return;
      setState(() => _sourceError = err.toString());
    } finally {
      if (mounted) setState(() => _fetchingSource = false);
    }
  }

  Future<void> _discoverProviderModels() async {
    final baseUrl = _baseUrlController.text.trim();
    if (baseUrl.isEmpty || _discoveringModels) {
      setState(
        () => _discoverError = 'Enter an OpenAI/Ollama Base URL first.',
      );
      return;
    }
    setState(() {
      _discoveringModels = true;
      _discoverError = null;
    });
    try {
      final apiKey = _apiKeyController.text.trim();
      final models = widget.onDiscoverModels != null
          ? await widget.onDiscoverModels!(baseUrl, apiKey)
          : await (() async {
              await RustBridge.ensureInitialized();
              return fetchAgentProviderModels(
                baseUrl: baseUrl,
                apiKey: apiKey.isEmpty ? null : apiKey,
              );
            })();
      if (!mounted) return;
      setState(() => _discoveredModels = models);
    } catch (err) {
      if (!mounted) return;
      setState(() => _discoverError = err.toString());
    } finally {
      if (mounted) setState(() => _discoveringModels = false);
    }
  }

  void _applyPreset(CopilotProviderSettings preset) {
    _baseUrlController.text = preset.baseUrl;
    _modelController.text = preset.model;
    _autoPayCashu = preset.autoPayCashu;
    _cashuMaxSatsController.text = preset.cashuMaxSats.toString();
    final parsedMax = int.tryParse(_cashuMaxSatsController.text.trim());
    widget.onSettingsChanged(
      CopilotProviderSettings(
        presetName: preset.presetName,
        baseUrl: preset.baseUrl,
        model: preset.model,
        apiKey: _apiKeyController.text.trim(),
        providerType: preset.providerType,
        autoPayCashu: preset.autoPayCashu,
        cashuMaxSats: (parsedMax != null && parsedMax > 0)
            ? parsedMax
            : preset.cashuMaxSats,
        cashuToken: _cashuTokenController.text.trim(),
      ),
    );
  }

  CopilotProviderSettings _buildSettingsFromControllers({bool? autoPayOverride}) {
    final baseUrl = _baseUrlController.text.trim();
    final isRoutstr = baseUrl.toLowerCase().contains('routstr.com') ||
        widget.settings.isRoutstr;
    final parsedMax = int.tryParse(_cashuMaxSatsController.text.trim());
    final autoPay = autoPayOverride ?? _autoPayCashu;
    return CopilotProviderSettings(
      presetName: baseUrl.isEmpty
          ? 'Offline Rust Spatial'
          : isRoutstr
              ? 'Routstr (Cashu)'
              : 'Custom LLM',
      baseUrl: baseUrl,
      model: _modelController.text.trim().isEmpty
          ? 'offline-spatial'
          : _modelController.text.trim(),
      apiKey: _apiKeyController.text.trim(),
      providerType: isRoutstr ? 'routstr' : null,
      autoPayCashu: autoPay,
      cashuMaxSats: (parsedMax != null && parsedMax > 0) ? parsedMax : 25,
      cashuToken: _cashuTokenController.text.trim(),
    );
  }

  void _saveCustomSettings() {
    widget.onSettingsChanged(_buildSettingsFromControllers());
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
    final pending = widget.pendingEdit;

    return EarthlyMapDrawer(
      initialFraction: 0.56,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 8, 2),
            child: Row(
              children: [
                Icon(
                  Icons.auto_awesome,
                  size: 16,
                  color: theme.colorScheme.primary,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: theme.dividerColor),
                      ),
                      child: Text(
                        '${widget.settings.presetName} · ${widget.settings.model}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                _buildVisionBadge(theme),
                const SizedBox(width: 4),
                if (widget.onSafeEditingChanged != null)
                  Tooltip(
                    message: widget.safeEditing
                        ? 'Safe Editing ON: AI edits preview as amber ghosts before applying'
                        : 'Safe Editing OFF: AI edits apply immediately',
                    child: InkWell(
                      onTap: () =>
                          widget.onSafeEditingChanged!(!widget.safeEditing),
                      borderRadius: BorderRadius.circular(999),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 7,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: (widget.safeEditing
                                  ? EarthlyColors.proposedAmber
                                  : theme.colorScheme.surfaceContainerHighest)
                              .withValues(alpha: 0.18),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: widget.safeEditing
                                ? EarthlyColors.proposedAmber
                                : theme.dividerColor,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              widget.safeEditing
                                  ? Icons.shield_outlined
                                  : Icons.flash_on_outlined,
                              size: 12,
                              color: widget.safeEditing
                                  ? EarthlyColors.proposedAmber
                                  : theme.colorScheme.onSurfaceVariant,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              widget.safeEditing ? 'SAFE' : 'DIRECT',
                              style: TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 9.5,
                                fontWeight: FontWeight.w800,
                                color: widget.safeEditing
                                    ? EarthlyColors.proposedAmber
                                    : theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                IconButton(
                  tooltip: 'Provider settings',
                  visualDensity: VisualDensity.compact,
                  onPressed: () =>
                      setState(() => _showSettings = !_showSettings),
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
          TabBar(
            controller: _tabs,
            dividerHeight: 0,
            tabs: [
              Tab(
                text: pending != null ? 'Chat (Ghost)' : 'Chat',
              ),
              Tab(
                text: _researchSource != null
                    ? 'Source (${_researchSource!.coordinates.length + _researchSource!.directFeatureCount})'
                    : 'Source',
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          if (_showSettings) _buildProviderSettings(theme),
          if (pending != null) _buildPendingGhostCard(theme, pending),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                _buildChatTab(theme),
                _buildResearchSourceTab(theme),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVisionBadge(ThemeData theme) {
    final normalized = widget.visionSupport.trim().toLowerCase();
    final (String label, Color color) = switch (normalized) {
      'vision' => ('Vision ✓', EarthlyColors.commentGreen),
      'uncertain' => ('Uncertain', EarthlyColors.proposedAmber),
      _ => ('Text-only', theme.colorScheme.onSurfaceVariant),
    };
    return Tooltip(
      message: switch (normalized) {
        'vision' => 'Model supports multimodal image input',
        'uncertain' =>
          'Model may support vision based on name heuristic (unverified)',
        _ => 'Text-only model — map image payloads will not be sent',
      },
      child: Container(
        key: const Key('agent-vision-badge'),
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.65)),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontFamily: 'monospace',
            fontSize: 9.5,
            fontWeight: FontWeight.w800,
            color: color,
          ),
        ),
      ),
    );
  }

  Widget _buildPendingGhostCard(ThemeData theme, PendingAiEdit pending) {
    return Container(
      key: const Key('agent-safe-editing-card'),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: EarthlyColors.proposedAmber.withValues(alpha: 0.14),
        border: Border(
          bottom: BorderSide(
            color: EarthlyColors.proposedAmber.withValues(alpha: 0.65),
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(
                Icons.auto_fix_high,
                size: 16,
                color: EarthlyColors.proposedAmber,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'AI AMBER GHOST · +${pending.diffAdded} ~${pending.diffModified} -${pending.diffRemoved}',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: EarthlyColors.proposedAmber,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            pending.summary,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: EarthlyColors.commentGreen,
                    foregroundColor: Colors.white,
                    visualDensity: VisualDensity.compact,
                  ),
                  onPressed: widget.onAcceptPendingEdit,
                  icon: const Icon(Icons.check, size: 15),
                  label: const Text('Accept to Draft'),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: EarthlyColors.destructive,
                  visualDensity: VisualDensity.compact,
                ),
                onPressed: widget.onDiscardPendingEdit,
                icon: const Icon(Icons.close, size: 15),
                label: const Text('Discard'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildProviderSettings(ThemeData theme) {
    final showCashuControls = widget.settings.isRoutstr ||
        _baseUrlController.text.trim().toLowerCase().contains('routstr.com') ||
        _autoPayCashu;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 215),
      child: ClipRect(
        child: SingleChildScrollView(
          child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: theme.colorScheme.primary.withValues(alpha: 0.05),
            border: Border(bottom: BorderSide(color: theme.dividerColor)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              ChoiceChip(
                label: const Text('Offline Rust'),
                selected: widget.settings.baseUrl.isEmpty,
                onSelected: (_) => _applyPreset(CopilotProviderSettings.offline),
              ),
              ChoiceChip(
                label: const Text('Local Ollama'),
                selected: widget.settings.baseUrl.contains('11434'),
                onSelected: (_) =>
                    _applyPreset(CopilotProviderSettings.localOllama),
              ),
              ChoiceChip(
                label: const Text('OpenRouter'),
                selected: widget.settings.baseUrl.contains('openrouter.ai'),
                onSelected: (_) =>
                    _applyPreset(CopilotProviderSettings.openRouter),
              ),
              ChoiceChip(
                key: const Key('agent-preset-routstr'),
                label: const Text('Routstr (Cashu)'),
                selected: widget.settings.isRoutstr,
                onSelected: (_) =>
                    _applyPreset(CopilotProviderSettings.routstr),
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _baseUrlController,
            decoration: const InputDecoration(
              labelText: 'OpenAI-compatible Base URL (blank = offline)',
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _modelController,
                  decoration: const InputDecoration(labelText: 'Model'),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: TextField(
                  controller: _apiKeyController,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'API Key (optional)',
                  ),
                ),
              ),
            ],
          ),
          if (showCashuControls) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Auto-pay with Cashu Wallet',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        'Attach X-Cashu ecash on requests & redeem change refunds',
                        style: TextStyle(fontSize: 10.5),
                      ),
                    ],
                  ),
                ),
                Switch.adaptive(
                  key: const Key('agent-routstr-autopay-switch'),
                  value: _autoPayCashu,
                  onChanged: (val) {
                    setState(() => _autoPayCashu = val);
                    widget.onSettingsChanged(
                      _buildSettingsFromControllers(autoPayOverride: val),
                    );
                  },
                ),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                SizedBox(
                  width: 112,
                  child: TextField(
                    key: const Key('agent-cashu-max-sats-field'),
                    controller: _cashuMaxSatsController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Max prepay (sat)',
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: TextField(
                    key: const Key('agent-cashu-token-field'),
                    controller: _cashuTokenController,
                    decoration: const InputDecoration(
                      labelText: 'Manual X-Cashu token (cashuA…)',
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              OutlinedButton.icon(
                key: const Key('agent-discover-models-btn'),
                onPressed: _discoveringModels ? null : _discoverProviderModels,
                icon: _discoveringModels
                    ? const SizedBox(
                        width: 13,
                        height: 13,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.manage_search, size: 15),
                label: Text(
                  _discoveringModels ? 'Checking /models…' : 'Discover Models',
                ),
              ),
              FilledButton(
                onPressed: _saveCustomSettings,
                child: const Text('Apply Provider'),
              ),
            ],
          ),
          if (_discoverError != null) ...[
            const SizedBox(height: 6),
            Text(
              _discoverError!,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 10.5,
                color: EarthlyColors.destructive,
              ),
            ),
          ],
          if (_discoveredModels.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'DISCOVERED MODELS (${_discoveredModels.length})',
              style: theme.textTheme.labelSmall?.copyWith(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (final m in _discoveredModels.take(16))
                  ActionChip(
                    key: Key('agent-discovered-model-$m'),
                    label: Text(
                      m,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                      ),
                    ),
                    onPressed: () {
                      setState(() => _modelController.text = m);
                      _saveCustomSettings();
                    },
                  ),
              ],
            ),
          ],
        ],
          ),
        ),
      ),
      ),
    );
  }

  Widget _buildChatTab(ThemeData theme) {
    return Column(
      children: [
        if (widget.onCreateThread != null || widget.threads.length > 1)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 2),
            child: Row(
              children: [
                if (widget.onCreateThread != null)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ActionChip(
                      key: const Key('agent-new-thread-btn'),
                      avatar: const Icon(Icons.add, size: 14),
                      label: const Text(
                        'New Thread',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      onPressed: widget.busy ? null : widget.onCreateThread,
                    ),
                  ),
                for (final t in widget.threads)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: InputChip(
                      key: Key('agent-thread-${t.id}'),
                      selected: t.id == widget.activeThreadId,
                      label: Text(
                        t.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                        ),
                      ),
                      onPressed: widget.onSelectThread == null
                          ? null
                          : () => widget.onSelectThread!(t.id),
                      onDeleted: widget.threads.length > 1 &&
                              widget.onDeleteThread != null
                          ? () => widget.onDeleteThread!(t.id)
                          : null,
                    ),
                  ),
              ],
            ),
          ),
        // Quick spatial prompts
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 2),
          child: Row(
            children: [
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ActionChip(
                  visualDensity: VisualDensity.compact,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  avatar: const Icon(Icons.travel_explore, size: 14),
                  label: const Text(
                    'Research Source',
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  onPressed: () => _tabs.animateTo(1),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: Tooltip(
                  message: widget.visionSupport == 'no-vision'
                      ? 'Switch to a vision-capable model to attach the map canvas'
                      : 'Attach a PNG snapshot of the current map viewport',
                  child: FilterChip(
                    key: const Key('agent-attach-map-view-toggle'),
                    visualDensity: VisualDensity.compact,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    avatar: Icon(
                      Icons.image_outlined,
                      size: 14,
                      color: widget.visionSupport == 'no-vision'
                          ? theme.disabledColor
                          : null,
                    ),
                    label: const Text(
                      'Attach Map View',
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    selected: widget.visionSupport != 'no-vision' &&
                        widget.attachMapView,
                    onSelected: (widget.visionSupport == 'no-vision' ||
                            widget.busy ||
                            widget.onAttachMapViewChanged == null)
                        ? null
                        : widget.onAttachMapViewChanged,
                  ),
                ),
              ),
              for (final chip in const [
                'Measure my draft',
                'Create 120m corridor',
                'Extrude flow arrow',
                'Offset +80m',
                'Union polygons',
                'Add callout: Verified in field',
                'Drop pin here',
                'Draft atlas manifest',
                'Atlas status',
              ])
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ActionChip(
                    visualDensity: VisualDensity.compact,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
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
        if (widget.shelfMaps.isNotEmpty && widget.onToggleWorkingSet != null)
          SingleChildScrollView(
            key: const Key('agent-working-set-bar'),
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(12, 2, 12, 2),
            child: Row(
              children: [
                Text(
                  'WORKING SET: ',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                for (final sm in widget.shelfMaps)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: FilterChip(
                      key: Key('agent-ws-${sm.address}'),
                      visualDensity: VisualDensity.compact,
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      selected: widget.workingSetAddresses.contains(sm.address),
                      label: Text(
                        sm.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10,
                        ),
                      ),
                      onSelected: widget.busy
                          ? null
                          : (_) => widget.onToggleWorkingSet!(sm.address),
                    ),
                  ),
              ],
            ),
          ),

        // Chat transcript (independent scrolling!)
        Expanded(
          child: widget.messages.isEmpty && !widget.busy
              ? LayoutBuilder(
                  builder: (context, constraints) => SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        minHeight: (constraints.maxHeight - 32).clamp(0.0, 400.0),
                      ),
                      child: Center(
                        child: Text(
                          'Rust `earthly-agent` executes geometry, measurement, callout, and Atlas workspace tools directly on your live map.\n\nSafe Editing previews geometry changes as amber dashed ghosts before touching your draft.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                    ),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                  itemCount: widget.messages.length + (widget.busy ? 1 : 0),
                  itemBuilder: (context, index) {
                    if (widget.busy && index == widget.messages.length) {
                      return Container(
                        key: const Key('agent-tool-progress-bar'),
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surface,
                          border: Border(
                            left: BorderSide(
                              color: EarthlyColors.amber,
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
                            Row(
                              children: [
                                const Text(
                                  'EARTHLY AGENT · LIVE',
                                  style: TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    widget.activeToolStatus ?? 'Thinking…',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 10,
                                      color: EarthlyColors.amber,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            const LinearProgressIndicator(minHeight: 2),
                            if (widget.liveToolCalls.isNotEmpty) ...[
                              const SizedBox(height: 6),
                              Wrap(
                                spacing: 6,
                                runSpacing: 4,
                                children: [
                                  for (final tc in widget.liveToolCalls)
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
                            if (widget.streamingText.isNotEmpty) ...[
                              const SizedBox(height: 6),
                              EarthlyRichText(
                                key: const Key('agent-streaming-reply'),
                                text: widget.streamingText,
                                compact: true,
                              ),
                            ],
                          ],
                        ),
                      );
                    }
                    final m = widget.messages[index];
                    final isUser = m.role == 'user';
                    return Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: m.isError
                            ? EarthlyColors.destructive.withValues(alpha: 0.10)
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
                          Row(
                            children: [
                              Text(
                                isUser ? 'YOU' : 'EARTHLY AGENT',
                                style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              if (!isUser &&
                                  (m.cashuSpentSats != null ||
                                      m.cashuRefundedSats != null)) ...[
                                const SizedBox(width: 8),
                                Container(
                                  key: const Key('agent-cashu-badge'),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 6,
                                    vertical: 2,
                                  ),
                                  decoration: BoxDecoration(
                                    color: EarthlyColors.proposedAmber
                                        .withValues(alpha: 0.16),
                                    borderRadius: BorderRadius.circular(999),
                                    border: Border.all(
                                      color: EarthlyColors.proposedAmber
                                          .withValues(alpha: 0.6),
                                    ),
                                  ),
                                  child: Text(
                                    (m.cashuRefundedSats != null &&
                                            m.cashuRefundedSats! > 0)
                                        ? '⚡ ${m.cashuSpentSats ?? 0} sat · ↩ ${m.cashuRefundedSats} sat'
                                        : '⚡ ${m.cashuSpentSats ?? 0} sat',
                                    style: const TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 9.5,
                                      fontWeight: FontWeight.w700,
                                      color: EarthlyColors.proposedAmber,
                                    ),
                                  ),
                                ),
                              ],
                              if (!isUser &&
                                  m.totalTokens != null &&
                                  m.totalTokens! > 0) ...[
                                const Spacer(),
                                Flexible(
                                  child: Text(
                                    '↑${m.promptTokens ?? 0} ↓${m.completionTokens ?? 0} · ${m.totalTokens} tok',
                                    key: const Key('agent-tokens-badge'),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 9.5,
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                              ],
                            ],
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
                          EarthlyRichText(text: m.content, compact: true),
                        ],
                      ),
                    );
                  },
                ),
        ),

        const Divider(height: 1),
        if (widget.pendingAttachment != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 6, 10, 0),
            child: Align(
              alignment: Alignment.centerLeft,
              child: InputChip(
                key: const Key('agent-attachment-chip'),
                avatar: const Icon(Icons.description_outlined, size: 14),
                label: Text(
                  '${widget.pendingAttachment!.fileName} (${widget.pendingAttachment!.formatLabel}'
                  '${widget.pendingAttachment!.featureCount > 0 ? ' · ${widget.pendingAttachment!.featureCount} feat' : ''})',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10.5,
                  ),
                ),
                onDeleted: widget.busy ? null : widget.onClearAttachment,
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
          child: Row(
            children: [
              if (widget.onPickAttachment != null)
                IconButton(
                  key: const Key('agent-attach-file-btn'),
                  tooltip: 'Attach CSV / XLSX / GeoJSON / GPX / KML / Text',
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.busy ? null : widget.onPickAttachment,
                  icon: const Icon(Icons.attach_file, size: 18),
                ),
              Expanded(
                child: TextField(
                  controller: _promptController,
                  onSubmitted: (_) => _submit(),
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'Ask Earthly Agent to draw, buffer, measure…',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                ),
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
    );
  }

  Widget _buildResearchSourceTab(ThemeData theme) {
    final src = _researchSource;
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 24),
      children: [
        Text(
          'Web Research & Source Extraction',
          style: theme.textTheme.labelMedium?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _urlController,
                onSubmitted: (_) => unawaited(_fetchSourceUrl()),
                decoration: const InputDecoration(
                  hintText: 'https://en.wikipedia.org/… or .geojson/.gpx/.kml',
                ),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton.icon(
              onPressed: _fetchingSource ? null : () => unawaited(_fetchSourceUrl()),
              icon: _fetchingSource
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.travel_explore, size: 15),
              label: const Text('Fetch'),
            ),
          ],
        ),
        if (_sourceError != null) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(10),
            color: EarthlyColors.destructive.withValues(alpha: 0.12),
            child: Text(
              _sourceError!,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 11,
                color: EarthlyColors.destructive,
              ),
            ),
          ),
        ],
        if (src == null) ...[
          const SizedBox(height: 18),
          Text(
            'Paste any trail report, Wikipedia article, GIS portal, or direct .geojson / .gpx / .kml URL. Earthly fetches it natively in Rust (zero CORS), extracts coordinates and spatial links, and lets you preview geometry as an amber ghost or cite it in a Story.',
            style: theme.textTheme.bodySmall,
          ),
        ] else ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: theme.dividerColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  src.title,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  src.url,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if ((src.directGeojson != null ||
                            src.coordinates.isNotEmpty) &&
                        widget.onExtractSourceToMap != null)
                      FilledButton.icon(
                        onPressed: () => widget.onExtractSourceToMap!(src),
                        icon: const Icon(Icons.add_location_alt_outlined,
                            size: 15),
                        label: Text(
                          src.directGeojson != null
                              ? 'Extract ${src.directFeatureCount} ${src.directFormat?.toUpperCase() ?? "Geo"} Features'
                              : 'Extract ${src.coordinates.length} Coord${src.coordinates.length == 1 ? '' : 's'} to Map',
                        ),
                      ),
                    if (widget.onCiteSourceInStory != null)
                      OutlinedButton.icon(
                        onPressed: () => widget.onCiteSourceInStory!(src),
                        icon: const Icon(Icons.auto_stories_outlined, size: 15),
                        label: const Text('Cite in Story'),
                      ),
                  ],
                ),
                if (src.coordinates.isNotEmpty) ...[
                  const Divider(height: 18),
                  Text(
                    'EXTRACTED COORDINATES (${src.coordinates.length})',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (var i = 0; i < src.coordinates.length && i < 12; i++)
                        ActionChip(
                          avatar: const Icon(Icons.place, size: 14),
                          label: Text(
                            '${src.coordinates[i].lat.toStringAsFixed(4)}, ${src.coordinates[i].lon.toStringAsFixed(4)}',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10.5,
                            ),
                          ),
                          onPressed: widget.onFocusCoord == null
                              ? null
                              : () => widget.onFocusCoord!(
                                    src.coordinates[i].lat,
                                    src.coordinates[i].lon,
                                    src.title,
                                  ),
                        ),
                    ],
                  ),
                ],
                if (src.spatialLinks.isNotEmpty) ...[
                  const Divider(height: 18),
                  Text(
                    'SPATIAL FILE LINKS FOUND (${src.spatialLinks.length})',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  for (final link in src.spatialLinks.take(6))
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.layers_outlined, size: 16),
                      title: Text(
                        link,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                        ),
                      ),
                      trailing: OutlinedButton(
                        onPressed: _fetchingSource
                            ? null
                            : () => unawaited(_fetchSourceUrl(link)),
                        child: const Text('Load'),
                      ),
                    ),
                ],
                if (src.excerpt.isNotEmpty) ...[
                  const Divider(height: 18),
                  Text(
                    'READABLE SOURCE EXCERPT',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  SelectableText(
                    src.excerpt,
                    style: theme.textTheme.bodySmall?.copyWith(height: 1.45),
                  ),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}
