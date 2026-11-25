import 'dart:async';
import 'dart:convert';

import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/shelf_renderer.dart';
import '../nostr/story_presentation.dart';
import '../src/rust/api/blossom.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'desk_sheet.dart';
import 'earthly_rich_text.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';
import 'mention_picker_dialog.dart';

class StoryPublishRequest {
  const StoryPublishRequest({
    required this.title,
    required this.summary,
    required this.markdown,
    required this.linkedMapAddresses,
    required this.presentationJson,
    required this.audience,
    this.image,
    this.existingDTag,
  });

  final String title;
  final String summary;
  final String markdown;
  final List<String> linkedMapAddresses;
  final String? presentationJson;
  final DraftAudienceChoice audience;
  final String? image;
  final String? existingDTag;
}

/// Interactive Story Composer (`kind 37520`) hosted in the non-blocking
/// `EarthlyMapDrawer` so authors can pan the live map above to insert `geo:`
/// coordinates and snapshot `earthly-view` camera blocks directly into prose.
class StoryComposerDrawer extends StatefulWidget {
  const StoryComposerDrawer({
    required this.shelfMaps,
    required this.getCameraSnapshot,
    required this.onPublishStory,
    required this.onClose,
    this.editingStory,
    this.onUploadBlossomImage,
    this.initialDraft,
    this.onDraftChanged,
    this.onDiscardDraft,
    this.catalogMaps = const <MapSummaryDto>[],
    this.catalogAtlases = const <AtlasSummaryDto>[],
    this.profilesByPubkey = const <String, ProfileMetadataDto>{},
    this.relayUrls = const <String>[],
    this.onEncodeNaddr,
    this.onEncodeNpub,
    super.key,
  });

  final List<ShelfMapEntry> shelfMaps;
  final CameraPosition? Function() getCameraSnapshot;
  final Future<PublishOutcomeDto> Function(StoryPublishRequest req)
      onPublishStory;
  final Future<BlossomUploadDto?> Function(String purpose)?
      onUploadBlossomImage;
  final VoidCallback onClose;
  final StorySummaryDto? editingStory;
  final Map<String, dynamic>? initialDraft;
  final ValueChanged<Map<String, dynamic>?>? onDraftChanged;
  final VoidCallback? onDiscardDraft;
  final List<MapSummaryDto> catalogMaps;
  final List<AtlasSummaryDto> catalogAtlases;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final List<String> relayUrls;
  final Future<String> Function({
    required int kind,
    required String pubkeyHex,
    required String dTag,
    required List<String> relays,
  })? onEncodeNaddr;
  final Future<String> Function(String pubkeyHex)? onEncodeNpub;

  @override
  State<StoryComposerDrawer> createState() => _StoryComposerDrawerState();
}

class _StoryComposerDrawerState extends State<StoryComposerDrawer> {
  late final TextEditingController _titleController;
  late final TextEditingController _summaryController;
  late final TextEditingController _imageController;
  late final TextEditingController _bodyController;

  late final Set<String> _selectedMapAddresses;
  DraftAudienceChoice _audience = DraftAudienceChoice.publicRelay;
  int _viewCounter = 0;
  bool _publishing = false;
  bool _uploadingMedia = false;
  bool _previewMode = false;
  bool _restoredFromDraft = false;
  Timer? _draftDebounce;
  String? _error;
  PublishOutcomeDto? _outcome;

  @override
  void initState() {
    super.initState();
    final draft = widget.editingStory == null ? widget.initialDraft : null;
    _restoredFromDraft = draft != null &&
        ((draft['title'] as String? ?? '').isNotEmpty ||
            (draft['markdown'] as String? ?? '').isNotEmpty ||
            (draft['summary'] as String? ?? '').isNotEmpty);
    _titleController = TextEditingController(
      text: widget.editingStory?.title ?? (draft?['title'] as String? ?? ''),
    );
    _summaryController = TextEditingController(
      text:
          widget.editingStory?.summary ?? (draft?['summary'] as String? ?? ''),
    );
    _imageController = TextEditingController(
      text: widget.editingStory?.image ?? (draft?['image'] as String? ?? ''),
    );
    _bodyController = TextEditingController(
      text:
          widget.editingStory?.content ?? (draft?['markdown'] as String? ?? ''),
    );
    _selectedMapAddresses = {
      ...widget.shelfMaps.map((m) => m.summary.address),
      ...(widget.editingStory?.referencedAddresses ?? const <String>[]),
      if (draft != null && draft['linkedMaps'] is List)
        ...(draft['linkedMaps'] as List).whereType<String>(),
    };
    if (draft?['audience'] == 'nearby') {
      _audience = DraftAudienceChoice.nearbyLocalNode;
    }
    _titleController.addListener(_scheduleDraftSave);
    _summaryController.addListener(_scheduleDraftSave);
    _imageController.addListener(_scheduleDraftSave);
    _bodyController.addListener(_scheduleDraftSave);
  }

  void _scheduleDraftSave() {
    if (widget.editingStory != null || widget.onDraftChanged == null) return;
    _draftDebounce?.cancel();
    _draftDebounce = Timer(const Duration(milliseconds: 350), _emitDraftNow);
  }

  void _emitDraftNow() {
    if (widget.editingStory != null || widget.onDraftChanged == null) return;
    final title = _titleController.text;
    final summary = _summaryController.text;
    final image = _imageController.text;
    final body = _bodyController.text;
    if (title.trim().isEmpty &&
        summary.trim().isEmpty &&
        image.trim().isEmpty &&
        body.trim().isEmpty) {
      widget.onDraftChanged!(null);
      return;
    }
    widget.onDraftChanged!({
      'title': title,
      'summary': summary,
      'image': image,
      'markdown': body,
      'linkedMaps': _selectedMapAddresses.toList(growable: false),
      'audience':
          _audience == DraftAudienceChoice.nearbyLocalNode ? 'nearby' : 'public',
    });
  }

  void _discardSavedDraft() {
    _draftDebounce?.cancel();
    setState(() {
      _titleController.clear();
      _summaryController.clear();
      _imageController.clear();
      _bodyController.clear();
      _restoredFromDraft = false;
    });
    widget.onDraftChanged?.call(null);
    widget.onDiscardDraft?.call();
  }

  @override
  void dispose() {
    _draftDebounce?.cancel();
    _titleController.dispose();
    _summaryController.dispose();
    _imageController.dispose();
    _bodyController.dispose();
    super.dispose();
  }

  Future<void> _uploadCoverImage() async {
    if (widget.onUploadBlossomImage == null) return;
    setState(() {
      _uploadingMedia = true;
      _error = null;
    });
    try {
      final uploaded = await widget.onUploadBlossomImage!('Story cover image');
      if (!mounted || uploaded == null) return;
      setState(() => _imageController.text = uploaded.url);
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _uploadingMedia = false);
    }
  }

  Future<void> _uploadInlineImage() async {
    if (widget.onUploadBlossomImage == null) return;
    setState(() {
      _uploadingMedia = true;
      _error = null;
    });
    try {
      final uploaded = await widget.onUploadBlossomImage!('Story inline photo');
      if (!mounted || uploaded == null) return;
      _insertAtCursor('\n![Photo](${uploaded.url})\n');
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _uploadingMedia = false);
    }
  }

  void _insertAtCursor(String snippet) {
    final text = _bodyController.text;
    final sel = _bodyController.selection;
    final start = sel.isValid ? sel.start : text.length;
    final end = sel.isValid ? sel.end : text.length;
    final updated = text.replaceRange(start, end, snippet);
    _bodyController.value = TextEditingValue(
      text: updated,
      selection: TextSelection.collapsed(offset: start + snippet.length),
    );
  }

  void _insertGeoPin() {
    final cam = widget.getCameraSnapshot();
    final center = cam?.center ?? const Geographic(lon: 16.3738, lat: 48.2082);
    _insertAtCursor(
      'geo:${center.lat.toStringAsFixed(5)},${center.lon.toStringAsFixed(5)} ',
    );
  }

  Future<void> _insertCameraViewBlock() async {
    final cam = widget.getCameraSnapshot();
    final center = cam?.center ?? const Geographic(lon: 16.3738, lat: 48.2082);
    final zoom = (cam?.zoom ?? 13.5);
    _viewCounter += 1;
    final edited = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => _StoryViewBlockEditorDialog(
        defaultId: 'view-$_viewCounter',
        defaultTitle: 'Map View $_viewCounter',
        initialLat: center.lat,
        initialLon: center.lon,
        initialZoom: zoom,
        linkedMaps: widget.shelfMaps
            .where((m) => _selectedMapAddresses.contains(m.summary.address))
            .toList(growable: false),
      ),
    );
    if (!mounted || edited == null) return;
    final payload = const JsonEncoder.withIndent('  ').convert(edited);
    _insertAtCursor('\n\n```earthly-view\n$payload\n```\n\n');
  }

  String? _buildPresentationJson() {
    final cam = widget.getCameraSnapshot();
    final selected = widget.shelfMaps
        .where((m) => _selectedMapAddresses.contains(m.summary.address))
        .toList(growable: false);
    if (selected.isEmpty && cam == null) return null;
    return jsonEncode({
      'version': 1,
      if (cam != null)
        'initialView': {
          'center': [cam.center.lon, cam.center.lat],
          'zoom': cam.zoom,
          'bearing': cam.bearing,
          'pitch': cam.pitch,
        },
      'layers': [
        for (var i = 0; i < selected.length; i++)
          {
            'id': 'layer-${i + 1}',
            'source': selected[i].summary.address,
            'visible': selected[i].visible,
            'opacityMultiplier': 1.0,
          },
      ],
    });
  }

  Future<void> _handlePublish() async {
    setState(() {
      _publishing = true;
      _error = null;
      _outcome = null;
    });
    try {
      final outcome = await widget.onPublishStory(
        StoryPublishRequest(
          title: _titleController.text.trim(),
          summary: _summaryController.text.trim(),
          markdown: _bodyController.text.trim(),
          linkedMapAddresses: _selectedMapAddresses.toList(growable: false),
          presentationJson: _buildPresentationJson(),
          audience: _audience,
          image: _imageController.text.trim().isEmpty
              ? null
              : _imageController.text.trim(),
          existingDTag: widget.editingStory?.dTag,
        ),
      );
      if (!mounted) return;
      _draftDebounce?.cancel();
      widget.onDraftChanged?.call(null);
      setState(() {
        _outcome = outcome;
        _restoredFromDraft = false;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return EarthlyMapDrawer(
      initialFraction: 0.56,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            const Icon(Icons.auto_stories_outlined, size: 17),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                widget.editingStory != null
                    ? 'EDIT STORY (37520)'
                    : 'COMPOSE STORY (37520)',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelLarge?.copyWith(
                  fontFamily: 'monospace',
                  letterSpacing: 0.7,
                ),
              ),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: widget.onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              alignment: WrapAlignment.spaceBetween,
              children: [
                Wrap(
                  spacing: 6,
                  children: [
                    ChoiceChip(
                      key: const Key('story-composer-write-tab'),
                      label: const Text('Write'),
                      selected: !_previewMode,
                      onSelected: (_) => setState(() => _previewMode = false),
                    ),
                    ChoiceChip(
                      key: const Key('story-composer-preview-tab'),
                      label: const Text('Preview'),
                      selected: _previewMode,
                      onSelected: (_) => setState(() => _previewMode = true),
                    ),
                  ],
                ),
                if (_restoredFromDraft)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const EarthlyBadge(
                        label: 'DRAFT RESTORED',
                        color: EarthlyColors.amber,
                      ),
                      const SizedBox(width: 4),
                      TextButton(
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                        ),
                        onPressed: _discardSavedDraft,
                        child: const Text('Discard'),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 10),
            if (_previewMode) ...[
              if (_imageController.text.trim().startsWith('http')) ...[
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: SizedBox(
                    height: 150,
                    width: double.infinity,
                    child: EarthlyNetworkImage(
                      url: _imageController.text.trim(),
                      fit: BoxFit.cover,
                      fallback: const SizedBox.shrink(),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
              ],
              Text(
                _titleController.text.trim().isEmpty
                    ? 'Untitled Story'
                    : _titleController.text.trim(),
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              if (_summaryController.text.trim().isNotEmpty) ...[
                const SizedBox(height: 6),
                EarthlyRichText(
                  text: _summaryController.text.trim(),
                  baseStyle: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              const Divider(height: 18),
              ...() {
                final parsedPreview = parseStoryDocument(
                  markdown: _bodyController.text,
                  presentationJson: _buildPresentationJson(),
                );
                if (parsedPreview.segments.isEmpty) {
                  return <Widget>[
                    Text(
                      'Start writing Markdown in the Write tab to preview.',
                      style: theme.textTheme.bodySmall,
                    ),
                  ];
                }
                return <Widget>[
                  for (final seg in parsedPreview.segments)
                    switch (seg) {
                      StoryViewCardSegment(:final viewIndex, :final step) =>
                        Container(
                          margin: const EdgeInsets.symmetric(vertical: 6),
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primary
                                .withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: theme.dividerColor),
                          ),
                          child: Text(
                            'VIEW ${viewIndex + 1} · ${step.title}${step.caption != null ? ' — ${step.caption}' : ''}',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      StoryMarkdownTextSegment(:final text) =>
                        EarthlyRichText(text: text),
                    },
                ];
              }(),
              const SizedBox(height: 12),
            ] else ...[
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: 'Story title',
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _summaryController,
              decoration: const InputDecoration(
                labelText: 'Short summary (optional)',
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _imageController,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'Cover image URL (optional)',
                      hintText: 'https://blossom.earthly.city/…',
                    ),
                  ),
                ),
                if (widget.onUploadBlossomImage != null) ...[
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: _uploadingMedia ? null : _uploadCoverImage,
                    icon: _uploadingMedia
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.cloud_upload_outlined, size: 15),
                    label: const Text('Cover'),
                  ),
                ],
              ],
            ),
            if (_imageController.text.trim().startsWith('http')) ...[
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: SizedBox(
                  height: 100,
                  width: double.infinity,
                  child: EarthlyNetworkImage(
                    url: _imageController.text.trim(),
                    fit: BoxFit.cover,
                    fallback: const SizedBox.shrink(),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),

            // Spatial & Media insertion toolbar
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                OutlinedButton.icon(
                  onPressed: _insertGeoPin,
                  icon: const Icon(Icons.place, size: 14),
                  label: const Text('+ Map Center geo:'),
                ),
                OutlinedButton.icon(
                  key: const Key('story-insert-view-block-btn'),
                  onPressed: _insertCameraViewBlock,
                  icon: const Icon(Icons.camera_alt_outlined, size: 14),
                  label: const Text('+ Camera View Block'),
                ),
                OutlinedButton.icon(
                  key: const Key('story-insert-map-ref-btn'),
                  onPressed: () async {
                    final mapsForPicker = <MapSummaryDto>[
                      ...widget.catalogMaps,
                      for (final s in widget.shelfMaps)
                        if (!widget.catalogMaps
                            .any((m) => m.address == s.summary.address))
                          s.summary,
                    ];
                    final token = await showEarthlyMentionPickerDialog(
                      context,
                      mode: MentionPickerMode.entity,
                      maps: mapsForPicker,
                      atlases: widget.catalogAtlases,
                      profilesByPubkey: widget.profilesByPubkey,
                      relayUrls: widget.relayUrls,
                      onEncodeNaddr: widget.onEncodeNaddr,
                      onEncodeNpub: widget.onEncodeNpub,
                    );
                    if (mounted && token != null) {
                      _insertAtCursor(' $token ');
                    }
                  },
                  icon: const Icon(Icons.link, size: 14),
                  label: const Text('+ \$ Map'),
                ),
                OutlinedButton.icon(
                  key: const Key('story-insert-person-ref-btn'),
                  onPressed: () async {
                    final token = await showEarthlyMentionPickerDialog(
                      context,
                      mode: MentionPickerMode.person,
                      maps: widget.catalogMaps,
                      atlases: widget.catalogAtlases,
                      profilesByPubkey: widget.profilesByPubkey,
                      relayUrls: widget.relayUrls,
                      onEncodeNaddr: widget.onEncodeNaddr,
                      onEncodeNpub: widget.onEncodeNpub,
                    );
                    if (mounted && token != null) {
                      _insertAtCursor(' $token ');
                    }
                  },
                  icon: const Icon(Icons.alternate_email, size: 14),
                  label: const Text('+ @ Person'),
                ),
                if (widget.onUploadBlossomImage != null)
                  OutlinedButton.icon(
                    onPressed: _uploadingMedia ? null : _uploadInlineImage,
                    icon: const Icon(Icons.add_photo_alternate_outlined, size: 14),
                    label: const Text('+ Upload Photo'),
                  ),
              ],
            ),
            const SizedBox(height: 8),

            TextField(
              controller: _bodyController,
              minLines: 5,
              maxLines: 12,
              decoration: const InputDecoration(
                hintText:
                    'Write your geo narrative in Markdown… Pan the map above and tap "+ Camera View Block" or "+ Map Center geo:" to bind prose to places.',
              ),
            ),

            if (widget.shelfMaps.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                'LINKED SHELF MAPS (MIRRORED AS `a` TAGS + PRESENTATION)',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                ),
              ),
              const SizedBox(height: 4),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final m in widget.shelfMaps)
                    FilterChip(
                      label: Text(m.summary.title),
                      selected:
                          _selectedMapAddresses.contains(m.summary.address),
                      onSelected: (sel) {
                        setState(() {
                          if (sel) {
                            _selectedMapAddresses.add(m.summary.address);
                          } else {
                            _selectedMapAddresses.remove(m.summary.address);
                          }
                        });
                        _scheduleDraftSave();
                      },
                    ),
                ],
              ),
            ],

            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              children: [
                ChoiceChip(
                  label: const Text('Public Relay'),
                  selected: _audience == DraftAudienceChoice.publicRelay,
                  onSelected: (_) {
                    setState(() => _audience = DraftAudienceChoice.publicRelay);
                    _scheduleDraftSave();
                  },
                ),
                ChoiceChip(
                  label: const Text('Nearby Local Node'),
                  selected: _audience == DraftAudienceChoice.nearbyLocalNode,
                  onSelected: (_) {
                    setState(
                      () => _audience = DraftAudienceChoice.nearbyLocalNode,
                    );
                    _scheduleDraftSave();
                  },
                ),
              ],
            ),
            ],

            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: EarthlyColors.destructive,
                ),
              ),
            ],
            if (_outcome != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(8),
                color: EarthlyColors.commentGreen.withValues(alpha: 0.12),
                child: Text(
                  'Published Story (${_outcome!.outboxState}) · ${_outcome!.eventId.substring(0, 10)}…',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: EarthlyColors.commentGreen,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _publishing ? null : _handlePublish,
              icon: _publishing
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.publish, size: 16),
              label: Text(
                _publishing
                    ? 'Publishing…'
                    : widget.editingStory != null
                        ? 'Save & Update Story (37520)'
                        : 'Sign & Publish Story (37520)',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StoryViewBlockEditorDialog extends StatefulWidget {
  const _StoryViewBlockEditorDialog({
    required this.defaultId,
    required this.defaultTitle,
    required this.initialLat,
    required this.initialLon,
    required this.initialZoom,
    required this.linkedMaps,
  });

  final String defaultId;
  final String defaultTitle;
  final double initialLat;
  final double initialLon;
  final double initialZoom;
  final List<ShelfMapEntry> linkedMaps;

  @override
  State<_StoryViewBlockEditorDialog> createState() =>
      _StoryViewBlockEditorDialogState();
}

class _StoryViewBlockEditorDialogState
    extends State<_StoryViewBlockEditorDialog> {
  late final TextEditingController _titleCtrl =
      TextEditingController(text: widget.defaultTitle);
  late final TextEditingController _captionCtrl =
      TextEditingController(text: 'Focus on this area');
  late final TextEditingController _latCtrl =
      TextEditingController(text: widget.initialLat.toStringAsFixed(5));
  late final TextEditingController _lonCtrl =
      TextEditingController(text: widget.initialLon.toStringAsFixed(5));
  late final TextEditingController _zoomCtrl =
      TextEditingController(text: widget.initialZoom.toStringAsFixed(2));
  String _display = 'both';
  late final Map<String, bool> _layerVisibility = <String, bool>{
    for (final m in widget.linkedMaps) m.summary.address: m.visible,
  };

  @override
  void dispose() {
    _titleCtrl.dispose();
    _captionCtrl.dispose();
    _latCtrl.dispose();
    _lonCtrl.dispose();
    _zoomCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Insert Camera View Block'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                key: const Key('view-editor-title'),
                controller: _titleCtrl,
                decoration: const InputDecoration(labelText: 'View title'),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const Key('view-editor-caption'),
                controller: _captionCtrl,
                decoration: const InputDecoration(labelText: 'Caption'),
              ),
              const SizedBox(height: 10),
              const Text('Display mode', style: TextStyle(fontSize: 12)),
              const SizedBox(height: 4),
              Wrap(
                spacing: 6,
                children: [
                  for (final d in const ['both', 'figure', 'cue'])
                    ChoiceChip(
                      key: Key('view-editor-display-$d'),
                      label: Text(d),
                      selected: _display == d,
                      onSelected: (_) => setState(() => _display = d),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _latCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Lat'),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: TextField(
                      controller: _lonCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Lon'),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: TextField(
                      controller: _zoomCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Zoom'),
                    ),
                  ),
                ],
              ),
              if (widget.linkedMaps.isNotEmpty) ...[
                const SizedBox(height: 10),
                const Text(
                  'Layer visibility snapshot:',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
                for (final m in widget.linkedMaps)
                  CheckboxListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(m.summary.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                    value: _layerVisibility[m.summary.address] ?? true,
                    onChanged: (v) => setState(
                      () => _layerVisibility[m.summary.address] = v ?? true,
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('view-editor-insert-btn'),
          onPressed: () {
            final lat = double.tryParse(_latCtrl.text.trim()) ?? widget.initialLat;
            final lon = double.tryParse(_lonCtrl.text.trim()) ?? widget.initialLon;
            final zoom = double.tryParse(_zoomCtrl.text.trim()) ?? widget.initialZoom;
            final layers = <String, dynamic>{
              for (final entry in _layerVisibility.entries)
                entry.key: {'visible': entry.value},
            };
            Navigator.of(context).pop(<String, dynamic>{
              'version': 1,
              'type': 'view',
              'id': widget.defaultId,
              'title': _titleCtrl.text.trim().isEmpty
                  ? widget.defaultTitle
                  : _titleCtrl.text.trim(),
              if (_captionCtrl.text.trim().isNotEmpty)
                'caption': _captionCtrl.text.trim(),
              'display': _display,
              'camera': {
                'center': [
                  double.parse(lon.toStringAsFixed(5)),
                  double.parse(lat.toStringAsFixed(5)),
                ],
                'zoom': double.parse(zoom.toStringAsFixed(2)),
              },
              if (layers.isNotEmpty) 'layers': layers,
            });
          },
          child: const Text('Insert View Block'),
        ),
      ],
    );
  }
}
