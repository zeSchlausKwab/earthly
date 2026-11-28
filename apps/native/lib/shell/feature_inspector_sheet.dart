import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../nostr/shelf_renderer.dart';
import '../src/rust/api/blossom.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'earthly_toast.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

const List<String> _draftColorSwatches = <String>[
  '#1F5F8B',
  '#0284C7',
  '#0F766E',
  '#15803D',
  '#65A30D',
  '#D97706',
  '#EA580C',
  '#B91C1C',
  '#DB2777',
  '#7C3AED',
  '#4F46E5',
  '#334155',
  '#111827',
  '#FFFFFF',
];

const Set<String> _inspectorMetaPropKeys = <String>{
  'id',
  'vertices',
  'lat',
  'lon',
  'description',
  'color',
  'fillColor',
  'strokeColor',
  'strokeWidth',
  'fillOpacity',
  'radius',
  'lineDash',
  'arrowStart',
  'arrowEnd',
  'displayIcon',
  'earthly:callouts',
};

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
    this.onDuplicateDraftFeature,
    this.onDeleteDraftFeature,
    this.onAddDraftCallout,
    this.onRemoveDraftCallout,
    this.onResetDraftCalloutOffset,
    this.onUploadBlossomImage,
    this.onTransformDraftFeature,
    this.onOpenDiscussion,
    this.onCloneDatasetToDraft,
    this.onShareFeature,
    this.onBack,
    super.key,
  });

  final InspectedFeature feature;
  final VoidCallback? onBack;
  final VoidCallback onClose;
  final void Function(String featureId, String newName)? onRenameDraftFeature;
  final void Function(String featureId, String colorHex)? onRecolorDraftFeature;
  final void Function(
    String featureId, {
    String? fillColorHex,
    bool clearFillColor,
    String? strokeColorHex,
    bool clearStrokeColor,
    double? strokeWidth,
    double? fillOpacity,
    double? radius,
    String? lineDash,
    bool? arrowStart,
    bool? arrowEnd,
    String? displayIcon,
    bool clearDisplayIcon,
    String? description,
    Map<String, String>? customProperties,
  })? onUpdateDraftStyle;
  final ValueChanged<String>? onEditDraftGeometry;
  final ValueChanged<String>? onDuplicateDraftFeature;
  final ValueChanged<String>? onDeleteDraftFeature;
  final void Function(String featureId, DraftCallout callout)? onAddDraftCallout;
  final void Function(String featureId, String calloutId)? onRemoveDraftCallout;
  final void Function(String featureId, String calloutId)?
      onResetDraftCalloutOffset;
  final Future<BlossomUploadDto?> Function(String purpose)?
      onUploadBlossomImage;
  final Future<void> Function(
    String featureId, {
    double translateEastM,
    double translateNorthM,
    double rotateDeg,
    double scale,
  })? onTransformDraftFeature;
  final VoidCallback? onOpenDiscussion;
  final VoidCallback? onCloneDatasetToDraft;
  final VoidCallback? onShareFeature;

  @override
  State<FeatureInspectorSheet> createState() => _FeatureInspectorSheetState();
}

class _FeatureInspectorSheetState extends State<FeatureInspectorSheet> {
  late final TextEditingController _nameController;
  late final TextEditingController _descController;
  final _hexController = TextEditingController();
  final _iconSearchController = TextEditingController();
  final _propKeyController = TextEditingController();
  final _propValueController = TextEditingController();
  final _calloutTitleController = TextEditingController();
  final _calloutTextController = TextEditingController();
  final _calloutPhotoController = TextEditingController();

  bool _editingName = false;
  bool _addingCallout = false;
  bool _uploadingCalloutPhoto = false;
  bool _editingStrokeTarget = false;
  String _calloutSide = 'right';
  String _iconQuery = '';

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.feature.title ?? '');
    _descController = TextEditingController(
      text: widget.feature.properties['description']?.toString() ?? '',
    );
    _editingStrokeTarget = widget.feature.geometryType == 'LineString';
  }

  @override
  void didUpdateWidget(covariant FeatureInspectorSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.feature.draftFeatureId != widget.feature.draftFeatureId ||
        oldWidget.feature.title != widget.feature.title) {
      _nameController.text = widget.feature.title ?? '';
    }
    if (oldWidget.feature.draftFeatureId != widget.feature.draftFeatureId) {
      _descController.text =
          widget.feature.properties['description']?.toString() ?? '';
      _editingStrokeTarget = widget.feature.geometryType == 'LineString';
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descController.dispose();
    _hexController.dispose();
    _iconSearchController.dispose();
    _propKeyController.dispose();
    _propValueController.dispose();
    _calloutTitleController.dispose();
    _calloutTextController.dispose();
    _calloutPhotoController.dispose();
    super.dispose();
  }

  Map<String, String> _currentCustomProps() {
    final out = <String, String>{};
    for (final e in widget.feature.properties.entries) {
      if (_inspectorMetaPropKeys.contains(e.key)) continue;
      if (e.value == null) continue;
      out[e.key] = e.value.toString();
    }
    return out;
  }

  void _applyColorHex(String hex) {
    final f = widget.feature;
    final id = f.draftFeatureId;
    if (id == null) return;
    final clean = hex.trim().toUpperCase();
    final normalized = clean.startsWith('#') ? clean : '#$clean';
    if (!RegExp(r'^#[0-9A-F]{6}$').hasMatch(normalized)) {
      EarthlyToast.warning(
        context,
        'Enter a 6-digit hex color like #1F5F8B',
      );
      return;
    }
    if (widget.onUpdateDraftStyle != null) {
      if (_editingStrokeTarget) {
        widget.onUpdateDraftStyle!(id, strokeColorHex: normalized);
      } else {
        widget.onUpdateDraftStyle!(id, fillColorHex: normalized);
        widget.onRecolorDraftFeature?.call(id, normalized);
      }
    } else {
      widget.onRecolorDraftFeature?.call(id, normalized);
    }
  }

  Future<void> _uploadCalloutPhoto() async {
    if (_uploadingCalloutPhoto || widget.onUploadBlossomImage == null) return;
    setState(() => _uploadingCalloutPhoto = true);
    try {
      final uploaded = await widget.onUploadBlossomImage!('Map callout photo');
      if (!mounted || uploaded == null) return;
      setState(() => _calloutPhotoController.text = uploaded.url);
    } catch (err) {
      if (!mounted) return;
      EarthlyToast.error(context, 'Photo upload failed: $err');
    } finally {
      if (mounted) setState(() => _uploadingCalloutPhoto = false);
    }
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
        .take(16)
        .toList();
    final customProps = _currentCustomProps();
    final fillColor =
        (f.properties['fillColor'] ?? f.properties['color']) as String?;
    final strokeColor =
        (f.properties['strokeColor'] ?? f.properties['color']) as String?;
    final activeHex = (_editingStrokeTarget ? strokeColor : fillColor)
        ?.toUpperCase();
    final arrowStart = f.properties['arrowStart'] == true;
    final arrowEnd = f.properties['arrowEnd'] == true;

    final filteredIcons = earthlyCartographicIcons.where((item) {
      final q = _iconQuery.trim().toLowerCase();
      if (q.isEmpty) return true;
      return item.$1.toLowerCase().contains(q) ||
          item.$2.toLowerCase().contains(q);
    }).toList(growable: false);

    return EarthlyMapDrawer(
      initialFraction: 0.50,
      onClose: widget.onClose,
      header: Padding(
        padding: EdgeInsets.fromLTRB(
          widget.onBack != null ? 6 : 14,
          0,
          8,
          6,
        ),
        child: Row(
          children: [
            if (widget.onBack != null) ...[
              EarthlyDrawerBackButton(
                key: const Key('inspector-back-btn'),
                onBack: widget.onBack!,
              ),
              const SizedBox(width: 2),
            ],
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
            const SizedBox(height: 12),
            Row(
              children: [
                const Text(
                  'COLOR',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 8),
                if (f.geometryType != 'LineString') ...[
                  ChoiceChip(
                    key: const Key('inspector-color-fill-tab'),
                    label: const Text('Fill', style: TextStyle(fontSize: 11)),
                    selected: !_editingStrokeTarget,
                    onSelected: (_) =>
                        setState(() => _editingStrokeTarget = false),
                  ),
                  const SizedBox(width: 6),
                  ChoiceChip(
                    key: const Key('inspector-color-stroke-tab'),
                    label: Text(
                      f.geometryType == 'Point' ? 'Ring' : 'Stroke',
                      style: const TextStyle(fontSize: 11),
                    ),
                    selected: _editingStrokeTarget,
                    onSelected: (_) =>
                        setState(() => _editingStrokeTarget = true),
                  ),
                ] else
                  const EarthlyBadge(
                    label: 'STROKE',
                    color: EarthlyColors.infoCyan,
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                for (final hex in _draftColorSwatches)
                  GestureDetector(
                    onTap: () => _applyColorHex(hex),
                    child: Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        color: Color(
                          0xFF000000 | int.parse(hex.substring(1), radix: 16),
                        ),
                        borderRadius: BorderRadius.circular(5),
                        border: Border.all(
                          color: activeHex == hex
                              ? theme.colorScheme.onSurface
                              : theme.dividerColor,
                          width: activeHex == hex ? 2.5 : 1.0,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('inspector-custom-hex-field'),
                    controller: _hexController,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                    decoration: InputDecoration(
                      isDense: true,
                      hintText: activeHex ?? '#1F5F8B',
                      labelText: 'Custom hex (#RRGGBB)',
                    ),
                    onSubmitted: _applyColorHex,
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  key: const Key('inspector-custom-hex-apply'),
                  onPressed: () => _applyColorHex(_hexController.text),
                  child: const Text('Apply'),
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
                  runSpacing: 6,
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
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    const Text(
                      'ARROWS:',
                      style: TextStyle(fontFamily: 'monospace', fontSize: 10),
                    ),
                    FilterChip(
                      key: const Key('inspector-arrow-start'),
                      label: const Text('Start ◀'),
                      selected: arrowStart,
                      onSelected: (v) => widget.onUpdateDraftStyle!(
                        f.draftFeatureId!,
                        arrowStart: v,
                      ),
                    ),
                    FilterChip(
                      key: const Key('inspector-arrow-end'),
                      label: const Text('End ▶'),
                      selected: arrowEnd,
                      onSelected: (v) => widget.onUpdateDraftStyle!(
                        f.draftFeatureId!,
                        arrowEnd: v,
                      ),
                    ),
                  ],
                ),
              ],
              if (f.geometryType == 'Point') ...[
                const SizedBox(height: 8),
                TextField(
                  key: const Key('inspector-icon-search'),
                  controller: _iconSearchController,
                  onChanged: (v) => setState(() => _iconQuery = v),
                  decoration: InputDecoration(
                    isDense: true,
                    prefixIcon: const Icon(Icons.search, size: 15),
                    hintText: 'Search ${earthlyCartographicIcons.length} point icons…',
                    suffixIcon: _iconQuery.isNotEmpty
                        ? IconButton(
                            visualDensity: VisualDensity.compact,
                            onPressed: () {
                              _iconSearchController.clear();
                              setState(() => _iconQuery = '');
                            },
                            icon: const Icon(Icons.clear, size: 14),
                          )
                        : null,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 5,
                  runSpacing: 5,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    ChoiceChip(
                      label: const Text('Dot'),
                      selected: f.properties['displayIcon'] == null,
                      onSelected: (_) => widget.onUpdateDraftStyle!(
                        f.draftFeatureId!,
                        clearDisplayIcon: true,
                      ),
                    ),
                    for (final entry in filteredIcons)
                      Tooltip(
                        message: entry.$2,
                        child: ChoiceChip(
                          key: Key('icon-chip-${entry.$1}'),
                          label: Icon(entry.$3, size: 15),
                          selected: f.properties['displayIcon'] == entry.$1,
                          onSelected: (_) => widget.onUpdateDraftStyle!(
                            f.draftFeatureId!,
                            displayIcon: entry.$1,
                          ),
                        ),
                      ),
                  ],
                ),
              ],
              const Divider(height: 20),
              Text(
                'DESCRIPTION (MARKDOWN / NOSTR LINKS)',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              TextField(
                key: const Key('inspector-description-field'),
                controller: _descController,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  hintText: 'Add field notes, links, or nostr:naddr1… references',
                ),
              ),
              const SizedBox(height: 6),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  key: const Key('inspector-save-description'),
                  onPressed: () => widget.onUpdateDraftStyle!(
                    f.draftFeatureId!,
                    description: _descController.text.trim(),
                  ),
                  icon: const Icon(Icons.check, size: 15),
                  label: const Text('Save Description'),
                ),
              ),
              const Divider(height: 20),
              Text(
                'CUSTOM PROPERTIES (${customProps.length})',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              if (customProps.isNotEmpty)
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final entry in customProps.entries)
                      InputChip(
                        label: Text(
                          '${entry.key}: ${entry.value}',
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 11,
                          ),
                        ),
                        onDeleted: () {
                          final next = Map<String, String>.from(customProps)
                            ..remove(entry.key);
                          widget.onUpdateDraftStyle!(
                            f.draftFeatureId!,
                            customProperties: next,
                          );
                        },
                      ),
                  ],
                ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('inspector-prop-key'),
                      controller: _propKeyController,
                      decoration: const InputDecoration(
                        isDense: true,
                        hintText: 'key (e.g. elevation)',
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: TextField(
                      key: const Key('inspector-prop-value'),
                      controller: _propValueController,
                      decoration: const InputDecoration(
                        isDense: true,
                        hintText: 'value (e.g. 484m)',
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  IconButton.filledTonal(
                    key: const Key('inspector-prop-add'),
                    tooltip: 'Add property',
                    visualDensity: VisualDensity.compact,
                    onPressed: () {
                      final k = _propKeyController.text.trim();
                      final v = _propValueController.text.trim();
                      if (k.isEmpty || v.isEmpty) return;
                      final next = Map<String, String>.from(customProps)
                        ..[k] = v;
                      _propKeyController.clear();
                      _propValueController.clear();
                      widget.onUpdateDraftStyle!(
                        f.draftFeatureId!,
                        customProperties: next,
                      );
                    },
                    icon: const Icon(Icons.add, size: 17),
                  ),
                ],
              ),
              if (widget.onTransformDraftFeature != null) ...[
                const Divider(height: 20),
                Text(
                  'TRANSFORM GEOMETRY',
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
                    if (f.geometryType != 'Point') ...[
                      OutlinedButton(
                        onPressed: () => widget.onTransformDraftFeature!(
                          f.draftFeatureId!,
                          rotateDeg: -15,
                        ),
                        child: const Text('↺ −15°'),
                      ),
                      OutlinedButton(
                        onPressed: () => widget.onTransformDraftFeature!(
                          f.draftFeatureId!,
                          rotateDeg: 15,
                        ),
                        child: const Text('↻ +15°'),
                      ),
                      OutlinedButton(
                        onPressed: () => widget.onTransformDraftFeature!(
                          f.draftFeatureId!,
                          scale: 0.85,
                        ),
                        child: const Text('×0.85'),
                      ),
                      OutlinedButton(
                        onPressed: () => widget.onTransformDraftFeature!(
                          f.draftFeatureId!,
                          scale: 1.15,
                        ),
                        child: const Text('×1.15'),
                      ),
                    ],
                    OutlinedButton(
                      onPressed: () => widget.onTransformDraftFeature!(
                        f.draftFeatureId!,
                        translateNorthM: 25,
                      ),
                      child: const Text('↑ 25m'),
                    ),
                    OutlinedButton(
                      onPressed: () => widget.onTransformDraftFeature!(
                        f.draftFeatureId!,
                        translateEastM: 25,
                      ),
                      child: const Text('→ 25m'),
                    ),
                    OutlinedButton(
                      onPressed: () => widget.onTransformDraftFeature!(
                        f.draftFeatureId!,
                        translateNorthM: -25,
                      ),
                      child: const Text('↓ 25m'),
                    ),
                    OutlinedButton(
                      onPressed: () => widget.onTransformDraftFeature!(
                        f.draftFeatureId!,
                        translateEastM: -25,
                      ),
                      child: const Text('← 25m'),
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
                        if (f.isDraft &&
                            f.draftFeatureId != null &&
                            callout.offset != Offset.zero &&
                            widget.onResetDraftCalloutOffset != null)
                          IconButton(
                            tooltip: 'Reset dragged offset',
                            visualDensity: VisualDensity.compact,
                            onPressed: () => widget.onResetDraftCalloutOffset!(
                              f.draftFeatureId!,
                              callout.id,
                            ),
                            icon: const Icon(
                              Icons.center_focus_weak,
                              size: 15,
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
          if (visibleProps.isNotEmpty && !f.isDraft) ...[
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
                  labelText: 'Callout card text (draggable on map!)',
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _calloutPhotoController,
                      decoration: const InputDecoration(
                        isDense: true,
                        labelText: 'Photo URL (optional)',
                        hintText: 'https://blossom.earthly.city/…',
                      ),
                    ),
                  ),
                  if (widget.onUploadBlossomImage != null) ...[
                    const SizedBox(width: 8),
                    OutlinedButton.icon(
                      key: const Key('callout-upload-photo-btn'),
                      onPressed:
                          _uploadingCalloutPhoto ? null : _uploadCalloutPhoto,
                      icon: _uploadingCalloutPhoto
                          ? const SizedBox(
                              width: 13,
                              height: 13,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.add_a_photo_outlined, size: 15),
                      label: const Text('Photo'),
                    ),
                  ],
                ],
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
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  FilledButton(
                    onPressed: () {
                      final text = _calloutTextController.text.trim();
                      if (text.isEmpty) return;
                      final photoUrl = _calloutPhotoController.text.trim();
                      widget.onAddDraftCallout?.call(
                        f.draftFeatureId!,
                        DraftCallout(
                          id: 'c-${DateTime.now().millisecondsSinceEpoch}',
                          title: _calloutTitleController.text.trim().isEmpty
                              ? null
                              : _calloutTitleController.text.trim(),
                          text: text,
                          side: _calloutSide,
                          mediaUrls: photoUrl.isNotEmpty
                              ? <String>[photoUrl]
                              : const <String>[],
                        ),
                      );
                      _calloutTitleController.clear();
                      _calloutTextController.clear();
                      _calloutPhotoController.clear();
                      setState(() => _addingCallout = false);
                    },
                    child: const Text('Attach Callout'),
                  ),
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
                  if (widget.onDuplicateDraftFeature != null)
                    OutlinedButton.icon(
                      key: const Key('inspector-duplicate-btn'),
                      onPressed: () =>
                          widget.onDuplicateDraftFeature!(f.draftFeatureId!),
                      icon: const Icon(Icons.control_point_duplicate, size: 16),
                      label: const Text('Duplicate'),
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
