import 'package:material_ui/material_ui.dart';

import '../nostr/atlas_schema.dart';
import '../nostr/shelf_renderer.dart';
import '../src/rust/api/blossom.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'desk_sheet.dart';
import 'entity_list_row.dart';
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
    this.image,
    this.schemaJson,
    this.existingDTag,
  });

  final String name;
  final String description;
  final String governance; // 'open' | 'schema' | 'closed'
  final List<String> pinnedAddresses;
  final List<String> hashtags;
  final DraftAudienceChoice audience;
  final String? image;
  final String? schemaJson;
  final String? existingDTag;
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
    this.editingAtlas,
    this.onUploadBlossomImage,
    super.key,
  });

  final List<ShelfMapEntry> shelfMaps;
  final List<MapSummaryDto> catalogMaps;
  final List<StorySummaryDto> catalogStories;
  final Future<PublishOutcomeDto> Function(AtlasPublishRequest req)
      onPublishAtlas;
  final Future<BlossomUploadDto?> Function(String purpose)?
      onUploadBlossomImage;
  final VoidCallback onClose;
  final AtlasSummaryDto? editingAtlas;

  @override
  State<AtlasComposerSheet> createState() => _AtlasComposerSheetState();
}

class _AtlasComposerSheetState extends State<AtlasComposerSheet> {
  late final TextEditingController _nameController =
      TextEditingController(text: widget.editingAtlas?.name ?? '');
  late final TextEditingController _descriptionController =
      TextEditingController(text: widget.editingAtlas?.description ?? '');
  late final TextEditingController _imageController =
      TextEditingController(text: widget.editingAtlas?.image ?? '');
  late final TextEditingController _hashtagsController = TextEditingController(
    text: widget.editingAtlas?.hashtags.join(' ') ?? '',
  );
  late final Set<String> _pinnedAddresses = {
    if (widget.editingAtlas != null)
      ...widget.editingAtlas!.pinnedAddresses
    else
      for (final s in widget.shelfMaps) s.summary.address,
  };
  late String _governance = widget.editingAtlas?.governance ?? 'open';
  final List<_SchemaRowControllers> _schemaRows = <_SchemaRowControllers>[];
  final Set<String> _allowedGeometries = <String>{};
  DraftAudienceChoice _audience = DraftAudienceChoice.publicRelay;
  bool _publishing = false;
  bool _uploadingCover = false;
  String? _error;
  PublishOutcomeDto? _outcome;

  @override
  void initState() {
    super.initState();
    final initialSchema = widget.editingAtlas?.schemaJson;
    for (final row in decodeAtlasSchemaRows(initialSchema)) {
      _schemaRows.add(_SchemaRowControllers.fromRow(row));
    }
    _allowedGeometries.addAll(decodeAtlasAllowedGeometries(initialSchema));
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _imageController.dispose();
    _hashtagsController.dispose();
    for (final row in _schemaRows) {
      row.dispose();
    }
    super.dispose();
  }

  Future<void> _uploadCover() async {
    if (widget.onUploadBlossomImage == null) return;
    setState(() {
      _uploadingCover = true;
      _error = null;
    });
    try {
      final uploaded = await widget.onUploadBlossomImage!('Atlas cover image');
      if (!mounted || uploaded == null) return;
      setState(() => _imageController.text = uploaded.url);
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _uploadingCover = false);
    }
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
      final compiledSchema = _governance == 'schema'
          ? compileAtlasSchemaJson(
              _schemaRows.map((r) => r.toRow()).toList(growable: false),
              _allowedGeometries.toList(growable: false),
            )
          : null;
      final outcome = await widget.onPublishAtlas(
        AtlasPublishRequest(
          name: name,
          description: _descriptionController.text.trim(),
          governance: _governance,
          pinnedAddresses: _pinnedAddresses.toList(growable: false),
          hashtags: tags,
          audience: _audience,
          image: _imageController.text.trim().isEmpty
              ? null
              : _imageController.text.trim(),
          schemaJson: compiledSchema,
          existingDTag: widget.editingAtlas?.dTag,
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
            Expanded(
              child: Text(
                widget.editingAtlas != null ? 'Edit Atlas' : 'New Atlas',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
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
      body: Material(
        type: MaterialType.transparency,
        child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(
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
              labelText: 'Description (optional)',
            ),
          ),
          const SizedBox(height: 10),
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
                  onPressed: _uploadingCover ? null : _uploadCover,
                  icon: _uploadingCover
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
          const SizedBox(height: 10),
          TextField(
            controller: _hashtagsController,
            decoration: const InputDecoration(
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
          EarthlySegmentBar<String>.single(
            key: const Key('atlas-gov-bar'),
            value: _governance,
            options: const [
              EarthlySegmentOption(
                key: Key('atlas-gov-open'),
                value: 'open',
                label: 'Open',
              ),
              EarthlySegmentOption(
                key: Key('atlas-gov-schema'),
                value: 'schema',
                label: 'Schema',
              ),
              EarthlySegmentOption(
                key: Key('atlas-gov-closed'),
                value: 'closed',
                label: 'Closed',
              ),
            ],
            onChanged: (mode) => setState(() => _governance = mode),
          ),
          if (_governance == 'schema') ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: theme.dividerColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'CONTRIBUTION SCHEMA BUILDER (DRAFT-2020-12)',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Allowed geometry types (empty = any):',
                    style: TextStyle(fontSize: 11),
                  ),
                  const SizedBox(height: 4),
                  EarthlySegmentBar<String>(
                    key: const Key('schema-geom-bar'),
                    compact: true,
                    selectedValues: _allowedGeometries,
                    options: const [
                      EarthlySegmentOption(
                        key: Key('schema-geom-Point'),
                        value: 'Point',
                        label: 'Point',
                      ),
                      EarthlySegmentOption(
                        key: Key('schema-geom-LineString'),
                        value: 'LineString',
                        label: 'LineString',
                      ),
                      EarthlySegmentOption(
                        key: Key('schema-geom-Polygon'),
                        value: 'Polygon',
                        label: 'Polygon',
                      ),
                    ],
                    onSelected: (g) {
                      setState(() {
                        if (!_allowedGeometries.add(g)) {
                          _allowedGeometries.remove(g);
                        }
                      });
                    },
                  ),
                  const SizedBox(height: 8),
                  for (var i = 0; i < _schemaRows.length; i++)
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        border: Border.all(color: theme.dividerColor),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Column(
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  key: Key('schema-field-name-$i'),
                                  controller: _schemaRows[i].nameCtrl,
                                  decoration: const InputDecoration(
                                    labelText: 'Property key',
                                    isDense: true,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              DropdownButton<AtlasSchemaFieldType>(
                                key: Key('schema-field-type-$i'),
                                value: _schemaRows[i].type,
                                onChanged: (v) {
                                  if (v != null) {
                                    setState(() => _schemaRows[i].type = v);
                                  }
                                },
                                items: const [
                                  DropdownMenuItem(
                                    value: AtlasSchemaFieldType.text,
                                    child: Text('text'),
                                  ),
                                  DropdownMenuItem(
                                    value: AtlasSchemaFieldType.number,
                                    child: Text('number'),
                                  ),
                                  DropdownMenuItem(
                                    value: AtlasSchemaFieldType.integer,
                                    child: Text('integer'),
                                  ),
                                  DropdownMenuItem(
                                    value: AtlasSchemaFieldType.boolean,
                                    child: Text('boolean'),
                                  ),
                                  DropdownMenuItem(
                                    value: AtlasSchemaFieldType.enumType,
                                    child: Text('enum'),
                                  ),
                                ],
                              ),
                              IconButton(
                                visualDensity: VisualDensity.compact,
                                onPressed: () {
                                  setState(() {
                                    final removed = _schemaRows.removeAt(i);
                                    removed.dispose();
                                  });
                                },
                                icon: const Icon(Icons.delete_outline, size: 16),
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              Checkbox(
                                key: Key('schema-field-req-$i'),
                                value: _schemaRows[i].required,
                                onChanged: (v) => setState(
                                  () => _schemaRows[i].required = v ?? false,
                                ),
                              ),
                              const Text('Required', style: TextStyle(fontSize: 12)),
                            ],
                          ),
                          if (_schemaRows[i].type ==
                              AtlasSchemaFieldType.enumType)
                            TextField(
                              key: Key('schema-field-enum-$i'),
                              controller: _schemaRows[i].enumCtrl,
                              decoration: const InputDecoration(
                                labelText: 'Allowed values (comma separated)',
                                isDense: true,
                              ),
                            ),
                        ],
                      ),
                    ),
                  OutlinedButton.icon(
                    key: const Key('schema-add-field-btn'),
                    onPressed: () {
                      setState(() => _schemaRows.add(_SchemaRowControllers()));
                    },
                    icon: const Icon(Icons.add, size: 15),
                    label: const Text('Add Field Rule'),
                  ),
                ],
              ),
            ),
          ],
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
              widget.editingAtlas != null
                  ? 'Save & Update Atlas (37518)'
                  : _audience == DraftAudienceChoice.publicRelay
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
                'Atlas published (${_outcome!.outboxState.toUpperCase()}) · ${_outcome!.eventId.substring(0, _outcome!.eventId.length.clamp(0, 14))}…',
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
            ),
          ],
        ],
        ),
      ),
    );
  }
}

class _SchemaRowControllers {
  _SchemaRowControllers({
    String name = '',
    this.type = AtlasSchemaFieldType.text,
    this.required = false,
    String enumCsv = '',
  })  : nameCtrl = TextEditingController(text: name),
        enumCtrl = TextEditingController(text: enumCsv);

  factory _SchemaRowControllers.fromRow(AtlasSchemaRow row) =>
      _SchemaRowControllers(
        name: row.name,
        type: row.type,
        required: row.required,
        enumCsv: row.allowedValues.join(', '),
      );

  final TextEditingController nameCtrl;
  AtlasSchemaFieldType type;
  bool required;
  final TextEditingController enumCtrl;

  AtlasSchemaRow toRow() => AtlasSchemaRow(
        name: nameCtrl.text.trim(),
        type: type,
        required: required,
        allowedValues: enumCtrl.text
            .split(',')
            .map((e) => e.trim())
            .where((e) => e.isNotEmpty)
            .toList(growable: false),
      );

  void dispose() {
    nameCtrl.dispose();
    enumCtrl.dispose();
  }
}
