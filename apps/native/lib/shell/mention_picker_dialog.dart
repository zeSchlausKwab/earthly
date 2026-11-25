import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';

enum MentionPickerMode { entity, person }

/// Opens a searchable picker for `$ Map / Atlas` (`[Title](nostr:naddr1…)`) or
/// `@ Author` (`nostr:npub1…`) references to insert at the cursor.
Future<String?> showEarthlyMentionPickerDialog(
  BuildContext context, {
  required MentionPickerMode mode,
  required List<MapSummaryDto> maps,
  required List<AtlasSummaryDto> atlases,
  required Map<String, ProfileMetadataDto> profilesByPubkey,
  required List<String> relayUrls,
  Future<String> Function({
    required int kind,
    required String pubkeyHex,
    required String dTag,
    required List<String> relays,
  })? onEncodeNaddr,
  Future<String> Function(String pubkeyHex)? onEncodeNpub,
}) {
  return showDialog<String>(
    context: context,
    builder: (_) => _EarthlyMentionPickerDialog(
      mode: mode,
      maps: maps,
      atlases: atlases,
      profilesByPubkey: profilesByPubkey,
      relayUrls: relayUrls,
      onEncodeNaddr: onEncodeNaddr,
      onEncodeNpub: onEncodeNpub,
    ),
  );
}

class _EarthlyMentionPickerDialog extends StatefulWidget {
  const _EarthlyMentionPickerDialog({
    required this.mode,
    required this.maps,
    required this.atlases,
    required this.profilesByPubkey,
    required this.relayUrls,
    this.onEncodeNaddr,
    this.onEncodeNpub,
  });

  final MentionPickerMode mode;
  final List<MapSummaryDto> maps;
  final List<AtlasSummaryDto> atlases;
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
  State<_EarthlyMentionPickerDialog> createState() =>
      _EarthlyMentionPickerDialogState();
}

class _EarthlyMentionPickerDialogState
    extends State<_EarthlyMentionPickerDialog> {
  final _searchController = TextEditingController();
  String _query = '';
  bool _encoding = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _pickEntity({
    required int kind,
    required String pubkeyHex,
    required String dTag,
    required String title,
  }) async {
    if (_encoding) return;
    setState(() => _encoding = true);
    try {
      String uri;
      if (widget.onEncodeNaddr != null) {
        uri = await widget.onEncodeNaddr!(
          kind: kind,
          pubkeyHex: pubkeyHex,
          dTag: dTag,
          relays: widget.relayUrls,
        );
      } else {
        await RustBridge.ensureInitialized();
        uri = await encodeNaddrCoordinate(
          kind: kind,
          pubkeyHex: pubkeyHex,
          dTag: dTag,
          relays: widget.relayUrls,
        );
      }
      if (!mounted) return;
      final cleanTitle = title.replaceAll('[', '(').replaceAll(']', ')');
      Navigator.of(context).pop('[$cleanTitle]($uri)');
    } catch (_) {
      if (mounted) setState(() => _encoding = false);
    }
  }

  Future<void> _pickPerson(String pubkeyHex) async {
    if (_encoding) return;
    setState(() => _encoding = true);
    try {
      String npub;
      if (widget.onEncodeNpub != null) {
        npub = await widget.onEncodeNpub!(pubkeyHex);
      } else {
        await RustBridge.ensureInitialized();
        npub = await encodeHexToNpub(pubkeyHex: pubkeyHex);
      }
      if (!mounted) return;
      final token = npub.startsWith('nostr:') ? npub : 'nostr:$npub';
      Navigator.of(context).pop(token);
    } catch (_) {
      if (mounted) setState(() => _encoding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _query.trim().toLowerCase();

    final entityItems = <({
      int kind,
      String badge,
      String title,
      String pubkey,
      String dTag,
    })>[
      for (final m in widget.maps)
        (
          kind: 37515,
          badge: 'MAP',
          title: m.title,
          pubkey: m.pubkey,
          dTag: m.dTag,
        ),
      for (final a in widget.atlases)
        (
          kind: 37518,
          badge: 'ATLAS',
          title: a.name,
          pubkey: a.pubkey,
          dTag: a.dTag,
        ),
    ].where((e) {
      if (q.isEmpty) return true;
      return e.title.toLowerCase().contains(q) ||
          e.dTag.toLowerCase().contains(q);
    }).toList(growable: false);

    final personPubkeys = <String>{
      ...widget.profilesByPubkey.keys,
      for (final m in widget.maps) m.pubkey,
      for (final a in widget.atlases) a.pubkey,
    }.where((pk) {
      if (pk.isEmpty) return false;
      if (q.isEmpty) return true;
      final p = widget.profilesByPubkey[pk];
      final label = '${p?.displayName ?? ''} ${p?.name ?? ''} $pk'.toLowerCase();
      return label.contains(q);
    }).toList(growable: false);

    return AlertDialog(
      title: Text(
        widget.mode == MentionPickerMode.entity
            ? 'Reference Map or Atlas (\$)'
            : 'Mention Author (@)',
      ),
      content: SizedBox(
        width: 340,
        height: 320,
        child: Column(
          children: [
            TextField(
              key: const Key('mention-picker-search'),
              controller: _searchController,
              onChanged: (v) => setState(() => _query = v),
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search, size: 18),
                hintText: widget.mode == MentionPickerMode.entity
                    ? 'Filter maps or atlases…'
                    : 'Filter authors by name or pubkey…',
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: widget.mode == MentionPickerMode.entity
                  ? (entityItems.isEmpty
                      ? const Center(child: Text('No matching maps or atlases.'))
                      : Material(
                          type: MaterialType.transparency,
                          child: ListView.builder(
                            itemCount: entityItems.length,
                            itemBuilder: (_, idx) {
                              final item = entityItems[idx];
                              return ListTile(
                                key: Key('mention-entity-${item.dTag}'),
                                dense: true,
                                leading: Text(
                                  item.badge,
                                  style: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                    color: EarthlyColors.infoCyan,
                                  ),
                                ),
                                title: Text(
                                  item.title,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                subtitle: Text(
                                  item.dTag,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 10,
                                  ),
                                ),
                                onTap: () => _pickEntity(
                                  kind: item.kind,
                                  pubkeyHex: item.pubkey,
                                  dTag: item.dTag,
                                  title: item.title,
                                ),
                              );
                            },
                          ),
                        ))
                  : (personPubkeys.isEmpty
                      ? const Center(child: Text('No matching authors found.'))
                      : Material(
                          type: MaterialType.transparency,
                          child: ListView.builder(
                            itemCount: personPubkeys.length,
                            itemBuilder: (_, idx) {
                              final pk = personPubkeys[idx];
                              final prof = widget.profilesByPubkey[pk];
                              final label = prof?.displayName ??
                                  prof?.name ??
                                  '${pk.substring(0, pk.length.clamp(0, 12))}…';
                              return ListTile(
                                key: Key('mention-person-$pk'),
                                dense: true,
                                leading: const Icon(Icons.person_outline, size: 18),
                                title: Text(
                                  label,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                subtitle: Text(
                                  '${pk.substring(0, pk.length.clamp(0, 14))}…',
                                  style: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 10,
                                  ),
                                ),
                                onTap: () => _pickPerson(pk),
                              );
                            },
                          ),
                        )),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}
