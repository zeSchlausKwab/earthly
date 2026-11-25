import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'entity_list_row.dart';
import 'map_drawer.dart';

/// Canonical Earthly City developer public key (matches
/// `npub182jczunncwe0jn6frpqwq3e0qjws7yqqnc3auccqv9nte2dnd63scjm4rf`).
const String kEarthlyDeveloperPubkeyHex =
    '3aa5817273c3b2f94f491840e0472f049d0f10009e23de63006166bca9b36ea3';

const List<({String id, String label, String hint})> _shoutboxCategories = [
  (
    id: 'announcements',
    label: 'Announcements',
    hint: 'Official updates from the Earthly team',
  ),
  (
    id: 'features',
    label: 'Features',
    hint: 'Share ideas for new mapping & Nostr capabilities',
  ),
  (
    id: 'greetings',
    label: 'Greetings',
    hint: 'Say hello to the Earthly field cartography community',
  ),
  (
    id: 'bugs',
    label: 'Bugs',
    hint: 'Report issues or quirks you encountered',
  ),
];

/// Community Shoutbox Drawer (`kind 1` tagged `#earthlycity` + category tag).
class ShoutboxSheet extends StatefulWidget {
  const ShoutboxSheet({
    required this.relayUrls,
    required this.profilesByPubkey,
    required this.currentUserPubkey,
    required this.onClose,
    this.mutedPubkeys = const <String>{},
    this.onOpenPerson,
    this.initialPostsByCategory,
    this.onFetchCategory,
    this.onPublishPost,
    super.key,
  });

  final List<String> relayUrls;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final String? currentUserPubkey;
  final Set<String> mutedPubkeys;
  final ValueChanged<String>? onOpenPerson;
  final Map<String, List<ShoutboxPostDto>>? initialPostsByCategory;
  final Future<List<ShoutboxPostDto>> Function(String category)? onFetchCategory;
  final Future<PublishOutcomeDto> Function(String category, String content)?
      onPublishPost;
  final VoidCallback onClose;

  @override
  State<ShoutboxSheet> createState() => _ShoutboxSheetState();
}

class _ShoutboxSheetState extends State<ShoutboxSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs =
      TabController(length: _shoutboxCategories.length, vsync: this);
  final _composerController = TextEditingController();
  final Map<String, List<ShoutboxPostDto>> _postsByCategory =
      <String, List<ShoutboxPostDto>>{};
  bool _loading = false;
  bool _posting = false;
  String? _error;
  String? _statusNote;

  @override
  void initState() {
    super.initState();
    if (widget.initialPostsByCategory != null) {
      _postsByCategory.addAll(widget.initialPostsByCategory!);
    }
    _tabs.addListener(_handleTabChanged);
    final initialCat = _shoutboxCategories[_tabs.index].id;
    if (!_postsByCategory.containsKey(initialCat)) {
      unawaited(_loadCategory(initialCat));
    }
  }

  @override
  void dispose() {
    _tabs.removeListener(_handleTabChanged);
    _tabs.dispose();
    _composerController.dispose();
    super.dispose();
  }

  String get _currentCategory => _shoutboxCategories[_tabs.index].id;

  void _handleTabChanged() {
    if (!mounted) return;
    setState(() {
      _error = null;
      _statusNote = null;
    });
    final cat = _currentCategory;
    if (!_postsByCategory.containsKey(cat)) {
      unawaited(_loadCategory(cat));
    }
  }

  Future<void> _loadCategory(String category, {bool force = false}) async {
    if (!force &&
        widget.initialPostsByCategory != null &&
        widget.initialPostsByCategory!.containsKey(category) &&
        widget.onFetchCategory == null) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final fetched = widget.onFetchCategory != null
          ? await widget.onFetchCategory!(category)
          : await (() async {
              await RustBridge.ensureInitialized();
              return fetchShoutboxPosts(
                relayUrls: widget.relayUrls,
                category: category,
                limit: 50,
              );
            })();
      if (!mounted) return;
      setState(() => _postsByCategory[category] = fetched);
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submitPost() async {
    final content = _composerController.text.trim();
    if (content.isEmpty || widget.onPublishPost == null || _posting) return;
    final cat = _currentCategory;
    setState(() {
      _posting = true;
      _error = null;
      _statusNote = null;
    });
    try {
      final outcome = await widget.onPublishPost!(cat, content);
      if (!mounted) return;
      _composerController.clear();
      final optimistic = ShoutboxPostDto(
        eventId: outcome.eventId,
        pubkey: widget.currentUserPubkey ?? '',
        content: content,
        category: cat,
        createdAt: BigInt.from(DateTime.now().millisecondsSinceEpoch ~/ 1000),
        hashtags: <String>['earthlycity', cat],
      );
      setState(() {
        _postsByCategory[cat] = <ShoutboxPostDto>[
          optimistic,
          ...?_postsByCategory[cat],
        ];
        _statusNote = 'Posted (${outcome.outboxState})';
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  String _authorLabel(String pubkey) {
    if (pubkey.isEmpty) return '@you';
    final p = widget.profilesByPubkey[pubkey];
    final name = p?.displayName ?? p?.name;
    if (name != null && name.trim().isNotEmpty) return '@${name.trim()}';
    return '${pubkey.substring(0, pubkey.length.clamp(0, 10))}…';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cat = _shoutboxCategories[_tabs.index];
    final posts = (_postsByCategory[cat.id] ?? const <ShoutboxPostDto>[])
        .where((p) => !widget.mutedPubkeys.contains(p.pubkey))
        .toList(growable: false);
    final isReadOnlyAnnouncements = cat.id == 'announcements' &&
        widget.currentUserPubkey != kEarthlyDeveloperPubkeyHex;

    return EarthlyMapDrawer(
      initialFraction: 0.56,
      accentTopBorder: true,
      onClose: widget.onClose,
      header: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 8, 2),
            child: Row(
              children: [
                const Icon(
                  Icons.campaign_outlined,
                  size: 18,
                  color: EarthlyColors.infoCyan,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'COMMUNITY SHOUTBOX',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontFamily: 'monospace',
                      letterSpacing: 0.7,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh posts',
                  visualDensity: VisualDensity.compact,
                  onPressed: _loading
                      ? null
                      : () => unawaited(_loadCategory(cat.id, force: true)),
                  icon: const Icon(Icons.refresh, size: 18),
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
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            labelStyle: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
            tabs: [
              for (final c in _shoutboxCategories) Tab(text: c.label),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            decoration: BoxDecoration(
              color: theme.colorScheme.primary.withValues(alpha: 0.05),
              border: Border(bottom: BorderSide(color: theme.dividerColor)),
            ),
            child: Text(
              cat.hint,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: _loading && posts.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : posts.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(
                            'No ${cat.label.toLowerCase()} yet on ${widget.relayUrls.isEmpty ? 'configured relays' : widget.relayUrls.first}.',
                            textAlign: TextAlign.center,
                          ),
                        ),
                      )
                    : Material(
                        type: MaterialType.transparency,
                        child: RefreshIndicator(
                          onRefresh: () => _loadCategory(cat.id, force: true),
                          child: ListView.separated(
                            padding: const EdgeInsets.all(14),
                            itemCount: posts.length,
                            separatorBuilder: (_, _) =>
                                const Divider(height: 16),
                            itemBuilder: (_, index) {
                              final p = posts[index];
                              return Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: InkWell(
                                          onTap: widget.onOpenPerson == null ||
                                                  p.pubkey.isEmpty
                                              ? null
                                              : () => widget
                                                  .onOpenPerson!(p.pubkey),
                                          child: Text(
                                            _authorLabel(p.pubkey),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                              fontFamily: 'monospace',
                                              fontSize: 11,
                                              fontWeight: FontWeight.w700,
                                              color: widget.onOpenPerson != null
                                                  ? EarthlyColors.infoCyan
                                                  : theme.colorScheme.onSurface,
                                            ),
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Text(
                                        formatRelativeUnixDate(
                                          p.createdAt.toInt(),
                                        ),
                                        style: TextStyle(
                                          fontFamily: 'monospace',
                                          fontSize: 10,
                                          color: theme
                                              .colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 5),
                                  EarthlyRichText(
                                    text: p.content,
                                    compact: true,
                                  ),
                                ],
                              );
                            },
                          ),
                        ),
                      ),
          ),
          if (_error != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
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
          if (_statusNote != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              color: EarthlyColors.commentGreen.withValues(alpha: 0.12),
              child: Text(
                _statusNote!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: EarthlyColors.commentGreen,
                ),
              ),
            ),
          Container(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: theme.dividerColor)),
            ),
            child: isReadOnlyAnnouncements
                ? Container(
                    key: const Key('shoutbox-dev-only-banner'),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.verified_outlined, size: 15),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Announcements are published by the Earthly developer account. Switch to Features, Greetings, or Bugs to post.',
                            style: TextStyle(fontSize: 11.5),
                          ),
                        ),
                      ],
                    ),
                  )
                : Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('shoutbox-composer-input'),
                          controller: _composerController,
                          minLines: 1,
                          maxLines: 3,
                          decoration: InputDecoration(
                            hintText: 'Post to ${cat.label}…',
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        key: const Key('shoutbox-send-btn'),
                        onPressed:
                            (_posting || widget.onPublishPost == null)
                                ? null
                                : _submitPost,
                        child: Text(_posting ? '…' : 'Post'),
                      ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}
