import 'dart:convert';

import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/shelf_renderer.dart';
import '../src/rust/api/blossom.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'desk_sheet.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

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

  @override
  State<StoryComposerDrawer> createState() => _StoryComposerDrawerState();
}

class _StoryComposerDrawerState extends State<StoryComposerDrawer> {
  late final TextEditingController _titleController =
      TextEditingController(text: widget.editingStory?.title ?? '');
  late final TextEditingController _summaryController =
      TextEditingController(text: widget.editingStory?.summary ?? '');
  late final TextEditingController _imageController =
      TextEditingController(text: widget.editingStory?.image ?? '');
  late final TextEditingController _bodyController =
      TextEditingController(text: widget.editingStory?.content ?? '');

  late final Set<String> _selectedMapAddresses = {
    ...widget.shelfMaps.map((m) => m.summary.address),
    ...(widget.editingStory?.referencedAddresses ?? const <String>[]),
  };
  DraftAudienceChoice _audience = DraftAudienceChoice.publicRelay;
  int _viewCounter = 0;
  bool _publishing = false;
  bool _uploadingMedia = false;
  String? _error;
  PublishOutcomeDto? _outcome;

  @override
  void dispose() {
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

  void _insertCameraViewBlock() {
    final cam = widget.getCameraSnapshot();
    final center = cam?.center ?? const Geographic(lon: 16.3738, lat: 48.2082);
    final zoom = (cam?.zoom ?? 13.5);
    _viewCounter += 1;
    final payload = const JsonEncoder.withIndent('  ').convert({
      'version': 1,
      'type': 'view',
      'id': 'view-$_viewCounter',
      'title': 'Map View $_viewCounter',
      'caption': 'Focus on this area',
      'display': 'both',
      'camera': {
        'center': [
          double.parse(center.lon.toStringAsFixed(5)),
          double.parse(center.lat.toStringAsFixed(5)),
        ],
        'zoom': double.parse(zoom.toStringAsFixed(2)),
      },
    });
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
      setState(() => _outcome = outcome);
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
            Text(
              widget.editingStory != null
                  ? 'EDIT STORY (37520)'
                  : 'COMPOSE STORY (37520)',
              style: theme.textTheme.labelLarge?.copyWith(
                fontFamily: 'monospace',
                letterSpacing: 0.7,
              ),
            ),
            const Spacer(),
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
                  onPressed: _insertCameraViewBlock,
                  icon: const Icon(Icons.camera_alt_outlined, size: 14),
                  label: const Text('+ Camera View Block'),
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
                      onSelected: (sel) => setState(() {
                        if (sel) {
                          _selectedMapAddresses.add(m.summary.address);
                        } else {
                          _selectedMapAddresses.remove(m.summary.address);
                        }
                      }),
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
                  onSelected: (_) =>
                      setState(() => _audience = DraftAudienceChoice.publicRelay),
                ),
                ChoiceChip(
                  label: const Text('Nearby Local Node'),
                  selected: _audience == DraftAudienceChoice.nearbyLocalNode,
                  onSelected: (_) => setState(
                    () => _audience = DraftAudienceChoice.nearbyLocalNode,
                  ),
                ),
              ],
            ),

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
