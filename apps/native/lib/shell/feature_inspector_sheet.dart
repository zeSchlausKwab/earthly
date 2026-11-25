import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../nostr/shelf_renderer.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

const List<String> _draftColorSwatches = <String>[
  '#1F5F8B',
  '#15803D',
  '#D97706',
  '#B91C1C',
  '#7C3AED',
  '#0F766E',
];

/// Non-blocking Object Margin drawer displayed when tapping any GPU-rendered
/// feature (Published Shelf map, Story feature, Sighting, or Working Draft).
class FeatureInspectorSheet extends StatefulWidget {
  const FeatureInspectorSheet({
    required this.feature,
    required this.onClose,
    this.onRenameDraftFeature,
    this.onRecolorDraftFeature,
    this.onUpdateDraftStyle,
    this.onEditDraftGeometry,
    this.onDeleteDraftFeature,
    this.onAddDraftCallout,
    this.onRemoveDraftCallout,
    this.onOpenDiscussion,
    this.onCloneDatasetToDraft,
    this.onShareFeature,
    super.key,
  });

  final InspectedFeature feature;
  final VoidCallback onClose;
  final void Function(String featureId, String newName)? onRenameDraftFeature;
  final void Function(String featureId, String colorHex)? onRecolorDraftFeature;
  final void Function(
    String featureId, {
    double? strokeWidth,
    double? fillOpacity,
    double? radius,
    String? lineDash,
    String? displayIcon,
    bool clearDisplayIcon,
    String? description,
  })? onUpdateDraftStyle;
  final ValueChanged<String>? onEditDraftGeometry;
  final ValueChanged<String>? onDeleteDraftFeature;
  final void Function(String featureId, DraftCallout callout)? onAddDraftCallout;
  final void Function(String featureId, String calloutId)? onRemoveDraftCallout;
  final VoidCallback? onOpenDiscussion;
  final VoidCallback? onCloneDatasetToDraft;
  final VoidCallback? onShareFeature;

  @override
  State<FeatureInspectorSheet> createState() => _FeatureInspectorSheetState();
}

class _FeatureInspectorSheetState extends State<FeatureInspectorSheet> {
  late final TextEditingController _nameController;
  final _calloutTitleController = TextEditingController();
  final _calloutTextController = TextEditingController();
  bool _editingName = false;
  bool _addingCallout = false;
  String _calloutSide = 'right';

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.feature.title ?? '');
  }

  @override
  void didUpdateWidget(covariant FeatureInspectorSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.feature.draftFeatureId != widget.feature.draftFeatureId ||
        oldWidget.feature.title != widget.feature.title) {
      _nameController.text = widget.feature.title ?? '';
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _calloutTitleController.dispose();
    _calloutTextController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final f = widget.feature;
    final visibleProps = f.properties.entries
        .where((e) =>
            e.value != null &&
            e.value.toString().isNotEmpty &&
            e.key != 'earthly:callouts')
        .take(12)
        .toList();
    final activeColor = f.properties['color'] as String?;

    return EarthlyMapDrawer(
      initialFraction: 0.46,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            EarthlyBadge(
              label: f.geometryType.toUpperCase(),
              color: f.isDraft
                  ? EarthlyColors.amber
                  : EarthlyColors.infoCyan,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                f.sourceLabel,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall,
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
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          if (_editingName && f.draftFeatureId != null)
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _nameController,
                    autofocus: true,
                    decoration: const InputDecoration(
                      isDense: true,
                      labelText: 'Feature name / map label',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: () {
                    widget.onRenameDraftFeature?.call(
                      f.draftFeatureId!,
                      _nameController.text.trim(),
                    );
                    setState(() => _editingName = false);
                  },
                  child: const Text('Save'),
                ),
              ],
            )
          else
            Text(
              f.title ?? 'Unnamed feature',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          if (f.imageUrl != null && f.imageUrl!.isNotEmpty) ...[
            const SizedBox(height: 10),
            GestureDetector(
              onTap: () => showEarthlyPhotoLightbox(
                context,
                url: f.imageUrl!,
                caption: f.title,
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(
                  height: 176,
                  width: double.infinity,
                  child: EarthlyNetworkImage(
                    url: f.imageUrl!,
                    fit: BoxFit.cover,
                    fallback: const SizedBox.shrink(),
                  ),
                ),
              ),
            ),
          ],
          if (f.isDraft && f.draftFeatureId != null) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                const Text(
                  'STYLE:',
                  style: TextStyle(fontFamily: 'monospace', fontSize: 11),
                ),
                for (final hex in _draftColorSwatches)
                  GestureDetector(
                    onTap: () =>
                        widget.onRecolorDraftFeature?.call(f.draftFeatureId!, hex),
                    child: Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        color: Color(
                          0xFF000000 | int.parse(hex.substring(1), radix: 16),
                        ),
                        border: Border.all(
                          color: activeColor == hex
                              ? theme.colorScheme.onSurface
                              : Colors.white,
                          width: activeColor == hex ? 2.5 : 1.2,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            if (widget.onUpdateDraftStyle != null) ...[
              const SizedBox(height: 8),
              if (f.geometryType == 'Point')
                Row(
                  children: [
                    const SizedBox(
                      width: 82,
                      child: Text(
                        'RADIUS',
                        style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                      ),
                    ),
                    Expanded(
                      child: Slider(
                        min: 4,
                        max: 16,
                        divisions: 12,
                        value: ((f.properties['radius'] as num?)?.toDouble() ?? 7.0)
                            .clamp(4.0, 16.0),
                        onChanged: (v) => widget.onUpdateDraftStyle!(
                          f.draftFeatureId!,
                          radius: v,
                        ),
                      ),
                    ),
                  ],
                )
              else
                Row(
                  children: [
                    const SizedBox(
                      width: 82,
                      child: Text(
                        'STROKE',
                        style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                      ),
                    ),
                    Expanded(
                      child: Slider(
                        min: 1,
                        max: 10,
                        divisions: 9,
                        value: ((f.properties['strokeWidth'] as num?)
                                    ?.toDouble() ??
                                3.0)
                            .clamp(1.0, 10.0),
                        onChanged: (v) => widget.onUpdateDraftStyle!(
                          f.draftFeatureId!,
                          strokeWidth: v,
                        ),
                      ),
                    ),
                  ],
                ),
              if (f.geometryType == 'Polygon')
                Row(
                  children: [
                    const SizedBox(
                      width: 82,
                      child: Text(
                        'OPACITY',
                        style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                      ),
                    ),
                    Expanded(
                      child: Slider(
                        min: 0.1,
                        max: 0.8,
                        divisions: 7,
                        value: ((f.properties['fillOpacity'] as num?)
                                    ?.toDouble() ??
                                0.24)
                            .clamp(0.1, 0.8),
                        onChanged: (v) => widget.onUpdateDraftStyle!(
                          f.draftFeatureId!,
                          fillOpacity: v,
                        ),
                      ),
                    ),
                  ],
                ),
              if (f.geometryType == 'LineString') ...[
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    const Text(
                      'LINE:',
                      style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                    ),
                    for (final dash in const ['solid', 'dashed', 'dotted'])
                      ChoiceChip(
                        label: Text(dash),
                        selected:
                            (f.properties['lineDash'] as String? ?? 'solid') ==
                                dash,
                        onSelected: (_) => widget.onUpdateDraftStyle!(
                          f.draftFeatureId!,
                          lineDash: dash,
                        ),
                      ),
                  ],
                ),
              ],
              if (f.geometryType == 'Point') ...[
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    const Text(
                      'ICON:',
                      style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                    ),
                    ChoiceChip(
                      label: const Text('Dot'),
                      selected: f.properties['displayIcon'] == null,
                      onSelected: (_) => widget.onUpdateDraftStyle!(
                        f.draftFeatureId!,
                        clearDisplayIcon: true,
                      ),
                    ),
                    for (final entry in const [
                      ('lucide:mountain', Icons.terrain),
                      ('lucide:tent', Icons.park),
                      ('lucide:anchor', Icons.anchor),
                      ('lucide:flag', Icons.flag),
                      ('lucide:camera', Icons.photo_camera),
                      ('lucide:coffee', Icons.local_cafe),
                      ('lucide:home', Icons.home),
                      ('lucide:star', Icons.star),
                      ('lucide:alert-triangle', Icons.warning_amber),
                    ])
                      ChoiceChip(
                        label: Icon(entry.$2, size: 15),
                        selected: f.properties['displayIcon'] == entry.$1,
                        onSelected: (_) => widget.onUpdateDraftStyle!(
                          f.draftFeatureId!,
                          displayIcon: entry.$1,
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ],
          if (f.callouts.isNotEmpty) ...[
            const SizedBox(height: 10),
            for (final callout in f.callouts)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  border: Border(
                    left: BorderSide(
                      color: theme.colorScheme.primary,
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
                        Expanded(
                          child: Text(
                            callout.title ?? 'Map Callout',
                            style: theme.textTheme.labelMedium?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        if (f.isDraft && f.draftFeatureId != null)
                          IconButton(
                            visualDensity: VisualDensity.compact,
                            onPressed: () {
                              widget.onRemoveDraftCallout?.call(
                                f.draftFeatureId!,
                                callout.id,
                              );
                            },
                            icon: const Icon(Icons.delete_outline, size: 16),
                          ),
                      ],
                    ),
                    EarthlyRichText(text: callout.text, compact: true),
                    if (callout.mediaUrls.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      GestureDetector(
                        onTap: () => showEarthlyPhotoLightbox(
                          context,
                          url: callout.mediaUrls.first,
                          caption: callout.title,
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: SizedBox(
                            height: 120,
                            width: double.infinity,
                            child: EarthlyNetworkImage(
                              url: callout.mediaUrls.first,
                              fit: BoxFit.cover,
                              fallback: const SizedBox.shrink(),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
          ],
          if (f.lengthMeters != null || f.areaSquareMeters != null) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                if (f.lengthMeters != null)
                  Chip(
                    label: Text(
                      'Length: ${DrawingMath.formatDistance(f.lengthMeters!)}',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                      ),
                    ),
                  ),
                if (f.areaSquareMeters != null)
                  Chip(
                    label: Text(
                      'Area: ${(f.areaSquareMeters! / 10000).toStringAsFixed(2)} ha',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                      ),
                    ),
                  ),
              ],
            ),
          ],
          if (visibleProps.isNotEmpty) ...[
            const Divider(height: 18),
            for (final entry in visibleProps)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 110,
                      child: Text(
                        entry.key,
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    Expanded(
                      child: (entry.key == 'description' ||
                              entry.key == 'note' ||
                              entry.value.toString().contains('nostr:') ||
                              entry.value.toString().contains('naddr1') ||
                              entry.value.toString().contains('geo:') ||
                              entry.value.toString().contains('http'))
                          ? EarthlyRichText(
                              text: entry.value.toString(),
                              compact: true,
                            )
                          : Text(
                              entry.value.toString(),
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 12,
                              ),
                            ),
                    ),
                  ],
                ),
              ),
          ],
          if ((widget.onOpenDiscussion != null ||
                  widget.onCloneDatasetToDraft != null ||
                  widget.onShareFeature != null) &&
              !f.isDraft) ...[
            const Divider(height: 20),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (widget.onShareFeature != null)
                  OutlinedButton.icon(
                    onPressed: widget.onShareFeature,
                    icon: const Icon(Icons.link, size: 16),
                    label: const Text('Copy Link'),
                  ),
                if (widget.onOpenDiscussion != null)
                  OutlinedButton.icon(
                    onPressed: widget.onOpenDiscussion,
                    icon: const Icon(Icons.forum_outlined, size: 16),
                    label: const Text('Comments & Proposals'),
                  ),
                if (widget.onCloneDatasetToDraft != null)
                  FilledButton.icon(
                    onPressed: widget.onCloneDatasetToDraft,
                    icon: const Icon(Icons.copy_all_outlined, size: 16),
                    label: const Text('Clone Map to Draft'),
                  ),
              ],
            ),
          ],
          if (f.isDraft && f.draftFeatureId != null) ...[
            const Divider(height: 20),
            if (_addingCallout) ...[
              TextField(
                controller: _calloutTitleController,
                decoration: const InputDecoration(
                  labelText: 'Callout title (optional)',
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _calloutTextController,
                minLines: 2,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Callout card text (shown on map)',
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                children: [
                  for (final side in const ['right', 'top', 'left', 'bottom'])
                    ChoiceChip(
                      label: Text(side),
                      selected: _calloutSide == side,
                      onSelected: (_) => setState(() => _calloutSide = side),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  FilledButton(
                    onPressed: () {
                      final text = _calloutTextController.text.trim();
                      if (text.isEmpty) return;
                      widget.onAddDraftCallout?.call(
                        f.draftFeatureId!,
                        DraftCallout(
                          id: 'c-${DateTime.now().millisecondsSinceEpoch}',
                          title: _calloutTitleController.text.trim().isEmpty
                              ? null
                              : _calloutTitleController.text.trim(),
                          text: text,
                          side: _calloutSide,
                        ),
                      );
                      _calloutTitleController.clear();
                      _calloutTextController.clear();
                      setState(() => _addingCallout = false);
                    },
                    child: const Text('Attach Callout'),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () => setState(() => _addingCallout = false),
                    child: const Text('Cancel'),
                  ),
                ],
              ),
            ] else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (widget.onEditDraftGeometry != null)
                    FilledButton.icon(
                      onPressed: () =>
                          widget.onEditDraftGeometry!(f.draftFeatureId!),
                      icon: const Icon(Icons.polyline, size: 16),
                      label: Text(
                        f.geometryType == 'Point'
                            ? 'Move Point'
                            : 'Edit Vertices',
                      ),
                    ),
                  OutlinedButton.icon(
                    onPressed: () => setState(() => _editingName = true),
                    icon: const Icon(Icons.edit, size: 16),
                    label: const Text('Rename'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => setState(() => _addingCallout = true),
                    icon: const Icon(Icons.add_comment_outlined, size: 16),
                    label: const Text('Add Callout'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () {
                      widget.onDeleteDraftFeature?.call(f.draftFeatureId!);
                      widget.onClose();
                    },
                    icon: const Icon(
                      Icons.delete_outline,
                      size: 16,
                      color: EarthlyColors.destructive,
                    ),
                    label: const Text(
                      'Delete',
                      style: TextStyle(color: EarthlyColors.destructive),
                    ),
                  ),
                ],
              ),
          ],
        ],
      ),
    );
  }
}
