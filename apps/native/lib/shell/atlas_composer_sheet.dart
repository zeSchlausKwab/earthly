import 'package:material_ui/material_ui.dart';

import '../nostr/shelf_renderer.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'desk_sheet.dart';
import 'map_drawer.dart';

@immutable
class AtlasPublishRequest {
  const AtlasPublishRequest({
    required this.name,
    required this.description,
    required this.governance,
    required this.pinnedAddresses,
    required this.hashtags,
    required this.audience,
  });

  final String name;
  final String description;
  final String governance; // 'open' | 'schema' | 'closed'
  final List<String> pinnedAddresses;
  final List<String> hashtags;
  final DraftAudienceChoice audience;
}

/// Authoring drawer for Earthly v2 Atlases / Groups (`kind 37518`) pinning
/// Maps (`37515`) and Stories (`37520`) with governance & tags.
class AtlasComposerSheet extends StatefulWidget {
  const AtlasComposerSheet({
    required this.shelfMaps,
    required this.catalogMaps,
    required this.catalogStories,
    required this.onPublishAtlas,
    required this.onClose,
    super.key,
  });

  final List<ShelfMapEntry> shelfMaps;
  final List<MapSummaryDto> catalogMaps;
  final List<StorySummaryDto> catalogStories;
  final Future<PublishOutcomeDto> Function(AtlasPublishRequest req)
      onPublishAtlas;
  final VoidCallback onClose;

  @override
  State<AtlasComposerSheet> createState() => _AtlasComposerSheetState();
}

class _AtlasComposerSheetState extends State<AtlasComposerSheet> {
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _hashtagsController = TextEditingController();
  late final Set<String> _pinnedAddresses = {
    for (final s in widget.shelfMaps) s.summary.address,
  };
  String _governance = 'open';
  DraftAudienceChoice _audience = DraftAudienceChoice.publicRelay;
  bool _publishing = false;
  String? _error;
  PublishOutcomeDto? _outcome;

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _hashtagsController.dispose();
    super.dispose();
  }

  Future<void> _publish() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter an Atlas name');
      return;
    }
    setState(() {
      _publishing = true;
      _error = null;
      _outcome = null;
    });
    try {
      final tags = _hashtagsController.text
          .split(RegExp(r'[,\s#]+'))
          .map((t) => t.trim().toLowerCase())
          .where((t) => t.isNotEmpty)
          .toList(growable: false);
      final outcome = await widget.onPublishAtlas(
        AtlasPublishRequest(
          name: name,
          description: _descriptionController.text.trim(),
          governance: _governance,
          pinnedAddresses: _pinnedAddresses.toList(growable: false),
          hashtags: tags,
          audience: _audience,
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
    final allMapsByAddr = <String, MapSummaryDto>{
      for (final s in widget.shelfMaps) s.summary.address: s.summary,
      for (final m in widget.catalogMaps) m.address: m,
    };
    final selectableMaps = allMapsByAddr.values.toList(growable: false);

    return EarthlyMapDrawer(
      initialFraction: 0.62,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            const Icon(
              Icons.collections_bookmark_outlined,
              size: 16,
              color: EarthlyColors.commentGreen,
            ),
            const SizedBox(width: 8),
            Text(
              'CREATE ATLAS (KIND 37518)',
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
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(
              isDense: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.zero),
              labelText: 'Atlas name',
              hintText: 'e.g. Vienna Danube Field Atlas',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _descriptionController,
            minLines: 2,
            maxLines: 3,
            decoration: const InputDecoration(
              isDense: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.zero),
              labelText: 'Description (optional)',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _hashtagsController,
            decoration: const InputDecoration(
              isDense: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.zero),
              labelText: 'Hashtags (space or comma separated)',
              hintText: 'vienna cycling rivers',
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'GOVERNANCE MODE',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: [
              for (final mode in const ['open', 'schema', 'closed'])
                ChoiceChip(
                  label: Text(mode),
                  selected: _governance == mode,
                  onSelected: (_) => setState(() => _governance = mode),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'PIN MAPS & STORIES (${_pinnedAddresses.length} SELECTED)',
            style: theme.textTheme.labelSmall?.copyWith(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          if (selectableMaps.isEmpty && widget.catalogStories.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Load maps from Explore or publish a draft first to pin them into this Atlas.',
                style: theme.textTheme.bodySmall,
              ),
            )
          else ...[
            for (final map in selectableMaps.take(20))
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: Text(
                  map.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  'Map · ${map.featureCount} features',
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 10),
                ),
                value: _pinnedAddresses.contains(map.address),
                onChanged: (v) {
                  setState(() {
                    if (v ?? false) {
                      _pinnedAddresses.add(map.address);
                    } else {
                      _pinnedAddresses.remove(map.address);
                    }
                  });
                },
              ),
            for (final story in widget.catalogStories.take(10))
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: Text(
                  story.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: const Text(
                  'Story (37520)',
                  style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                ),
                value: _pinnedAddresses.contains(story.address),
                onChanged: (v) {
                  setState(() {
                    if (v ?? false) {
                      _pinnedAddresses.add(story.address);
                    } else {
                      _pinnedAddresses.remove(story.address);
                    }
                  });
                },
              ),
          ],
          const SizedBox(height: 12),
          SegmentedButton<DraftAudienceChoice>(
            segments: const [
              ButtonSegment(
                value: DraftAudienceChoice.publicRelay,
                label: Text('Public'),
                icon: Icon(Icons.public, size: 16),
              ),
              ButtonSegment(
                value: DraftAudienceChoice.nearbyLocalNode,
                label: Text('Nearby'),
                icon: Icon(Icons.wifi_tethering, size: 16),
              ),
            ],
            selected: {_audience},
            onSelectionChanged: (s) => setState(() => _audience = s.first),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _publishing ? null : _publish,
            icon: _publishing
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.publish, size: 18),
            label: Text(
              _audience == DraftAudienceChoice.publicRelay
                  ? 'Publish Atlas (37518)'
                  : 'Publish Atlas to Nearby Peers',
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              color: EarthlyColors.destructive.withValues(alpha: 0.12),
              child: Text(
                _error!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: EarthlyColors.destructive,
                ),
              ),
            ),
          ],
          if (_outcome != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: EarthlyColors.commentGreen.withValues(alpha: 0.10),
                border: Border.all(color: EarthlyColors.commentGreen),
              ),
              child: Text(
                'Atlas published (${_outcome!.outboxState.toUpperCase()}) · ${_outcome!.eventId.substring(0, 14)}…',
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
