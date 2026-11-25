import 'package:material_ui/material_ui.dart';

import '../drawing/drawing_model.dart';
import '../nostr/shelf_renderer.dart';
import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'earthly_rich_text.dart';
import 'map_drawer.dart';
import 'mention_picker_dialog.dart';

/// Target entity for the NIP-22 Thread (`37517`) & Edit Proposals (`37519`) Margin.
@immutable
class DiscussionTarget {
  const DiscussionTarget({
    required this.address,
    required this.kind,
    required this.pubkey,
    required this.title,
    this.eventId,
    this.baseGeojson,
    this.baseMarkdown,
  });

  final String address;
  final int kind;
  final String pubkey;
  final String title;
  final String? eventId;
  final String? baseGeojson;
  final String? baseMarkdown;
}

class _CommentThreadNode {
  const _CommentThreadNode({required this.comment, required this.depth});

  final GeoCommentDto comment;
  final int depth;
}

class _DiffLine {
  const _DiffLine(this.prefix, this.text);

  /// `'+'`, `'-'`, or `' '`
  final String prefix;
  final String text;
}

/// Interactive Margin sheet for NIP-22 Threaded Geo Comments (`37517`) and
/// Map/Story Edit Proposals (`37519`), with live Comment Green / Proposed Amber
/// map previews, line-by-line Story Markdown diff previews, contributor Mute,
/// and multi-signer outbox publishing.
class DiscussionMarginSheet extends StatefulWidget {
  const DiscussionMarginSheet({
    required this.target,
    required this.relayUrls,
    required this.hasDraftGeometry,
    required this.activeCommentGeojsonId,
    required this.activeProposalId,
    required this.profilesByPubkey,
    required this.currentUserPubkey,
    required this.onToggleCommentOverlay,
    required this.onToggleProposalOverlay,
    required this.onPostComment,
    required this.onSubmitProposal,
    required this.onLoadProposalToDraft,
    required this.onApplyProposal,
    required this.onCloseProposal,
    required this.onClose,
    this.initialSnapshot,
    this.mutedPubkeys = const <String>{},
    this.onMuteAuthor,
    this.onOpenPerson,
    this.onSubmitStoryProposal,
    this.onUploadBlossomImage,
    this.onRequestChangesProposal,
    this.catalogMaps = const <MapSummaryDto>[],
    this.catalogAtlases = const <AtlasSummaryDto>[],
    this.onEncodeNaddr,
    this.onEncodeNpub,
    super.key,
  });

  final DiscussionTarget target;
  final List<String> relayUrls;
  final bool hasDraftGeometry;
  final String? activeCommentGeojsonId;
  final String? activeProposalId;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final String? currentUserPubkey;
  final EntityDiscussionSnapshot? initialSnapshot;
  final Set<String> mutedPubkeys;
  final ValueChanged<String>? onMuteAuthor;
  final ValueChanged<String>? onOpenPerson;
  final List<MapSummaryDto> catalogMaps;
  final List<AtlasSummaryDto> catalogAtlases;
  final Future<String> Function({
    required int kind,
    required String pubkeyHex,
    required String dTag,
    required List<String> relays,
  })? onEncodeNaddr;
  final Future<String> Function(String pubkeyHex)? onEncodeNpub;
  final void Function(GeoCommentDto comment) onToggleCommentOverlay;
  final void Function(GeoProposalDto proposal) onToggleProposalOverlay;
  final Future<PublishOutcomeDto> Function(
    String text,
    bool attachDraftGeometry, {
    GeoCommentDto? replyTo,
  }) onPostComment;
  final Future<PublishOutcomeDto> Function(String description) onSubmitProposal;
  final Future<PublishOutcomeDto> Function(
    String description,
    String proposedMarkdown,
  )? onSubmitStoryProposal;
  final Future<String> Function()? onUploadBlossomImage;
  final Future<PublishOutcomeDto> Function(
    GeoProposalDto proposal,
    String note,
  )? onRequestChangesProposal;
  final ValueChanged<GeoProposalDto> onLoadProposalToDraft;
  final Future<PublishOutcomeDto> Function(GeoProposalDto proposal)
      onApplyProposal;
  final Future<PublishOutcomeDto> Function(GeoProposalDto proposal)
      onCloseProposal;
  final VoidCallback onClose;

  @override
  State<DiscussionMarginSheet> createState() => _DiscussionMarginSheetState();
}

class _DiscussionMarginSheetState extends State<DiscussionMarginSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _commentController = TextEditingController();
  final _proposalDescController = TextEditingController();
  late final TextEditingController _storyProposalBodyController;

  EntityDiscussionSnapshot? _snapshot;
  bool _loading = true;
  bool _submitting = false;
  bool _attachDraft = false;
  bool _showStoryProposalComposer = false;
  GeoCommentDto? _replyingTo;
  final Set<String> _expandedStoryDiffIds = <String>{};
  final Set<String> _expandedMapDiffIds = <String>{};
  bool _uploadingPhoto = false;
  String? _error;
  String? _statusNote;
  late String? _activeCommentId = widget.activeCommentGeojsonId;
  late String? _activeProposalId = widget.activeProposalId;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _storyProposalBodyController =
        TextEditingController(text: widget.target.baseMarkdown ?? '');
    if (widget.initialSnapshot != null) {
      _snapshot = widget.initialSnapshot;
      _loading = false;
    } else {
      _refresh();
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    _commentController.dispose();
    _proposalDescController.dispose();
    _storyProposalBodyController.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await RustBridge.ensureInitialized();
      final snap = await fetchEntityDiscussion(
        relayUrls: widget.relayUrls,
        rootAddress: widget.target.address,
        baseGeojson: widget.target.baseGeojson,
        baseMarkdown: widget.target.baseMarkdown,
      );
      if (!mounted) return;
      setState(() => _snapshot = snap);
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _handlePostComment() async {
    final text = _commentController.text.trim();
    if (text.isEmpty) return;
    final replyTarget = _replyingTo;
    setState(() {
      _submitting = true;
      _error = null;
      _statusNote = null;
    });
    try {
      final outcome = await widget.onPostComment(
        text,
        _attachDraft,
        replyTo: replyTarget,
      );
      if (!mounted) return;
      _commentController.clear();
      final shortId = outcome.eventId.length > 10
          ? '${outcome.eventId.substring(0, 10)}…'
          : outcome.eventId;
      setState(() {
        _attachDraft = false;
        _replyingTo = null;
        _statusNote = replyTarget != null
            ? 'Reply published (${outcome.outboxState}) · $shortId'
            : 'Comment published (${outcome.outboxState}) · $shortId';
      });
      if (widget.initialSnapshot == null) {
        await _refresh();
      }
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _authorLabel(String pubkey) {
    final p = widget.profilesByPubkey[pubkey];
    final name = p?.displayName ?? p?.name;
    if (name != null && name.isNotEmpty) return '@$name';
    return '${pubkey.substring(0, pubkey.length.clamp(0, 10))}…';
  }

  Future<void> _handleProposalStatus(
    GeoProposalDto proposal, {
    required bool apply,
  }) async {
    setState(() {
      _submitting = true;
      _error = null;
      _statusNote = null;
    });
    try {
      final outcome = apply
          ? await widget.onApplyProposal(proposal)
          : await widget.onCloseProposal(proposal);
      if (!mounted) return;
      setState(() {
        _statusNote = apply
            ? (proposal.isStoryProposal
                ? 'Proposal applied & Story republished (${outcome.outboxState})!'
                : 'Proposal applied & map republished (${outcome.outboxState})!')
            : 'Proposal closed (${outcome.outboxState}).';
      });
      if (widget.initialSnapshot == null) {
        await _refresh();
      }
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _uploadCommentPhoto() async {
    if (widget.onUploadBlossomImage == null) return;
    setState(() {
      _uploadingPhoto = true;
      _error = null;
    });
    try {
      final url = await widget.onUploadBlossomImage!();
      if (!mounted || url.trim().isEmpty) return;
      final cur = _commentController.text;
      final sep = cur.isEmpty || cur.endsWith('\n') ? '' : '\n';
      _commentController.text = '$cur$sep![photo]($url)\n';
      _commentController.selection = TextSelection.collapsed(
        offset: _commentController.text.length,
      );
      setState(() => _statusNote = 'Uploaded photo to Blossom & inserted Markdown.');
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
    }
  }

  Future<void> _handleRequestChanges(GeoProposalDto proposal) async {
    if (widget.onRequestChangesProposal == null) return;
    final submitted = await showDialog<String>(
      context: context,
      builder: (_) => const _RequestChangesDialog(),
    );
    if (submitted == null || !mounted) return;
    setState(() {
      _submitting = true;
      _error = null;
      _statusNote = null;
    });
    try {
      final outcome =
          await widget.onRequestChangesProposal!(proposal, submitted);
      if (!mounted) return;
      setState(() {
        _statusNote =
            'Requested changes (${outcome.outboxState}) · "$submitted"';
      });
      if (widget.initialSnapshot == null) {
        await _refresh();
      }
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  List<({String prefix, String summary})> _computeMapFeatureDiff(
    String? baseGeojson,
    String proposedGeojson,
  ) {
    final base = baseGeojson != null && baseGeojson.trim().isNotEmpty
        ? parseDraftFeaturesFromGeoJson(baseGeojson)
        : const <DrawnFeature>[];
    final next = parseDraftFeaturesFromGeoJson(proposedGeojson);
    final baseById = <String, DrawnFeature>{for (final f in base) f.id: f};
    final nextById = <String, DrawnFeature>{for (final f in next) f.id: f};
    final lines = <({String prefix, String summary})>[];

    for (final f in next) {
      final prev = baseById[f.id];
      final label = f.name?.isNotEmpty == true ? f.name! : f.id;
      if (prev == null) {
        lines.add((
          prefix: '+',
          summary: '$label (${f.kind.name}, ${f.vertices.length} pts)',
        ));
      } else if (prev.kind != f.kind ||
          prev.name != f.name ||
          prev.vertices.length != f.vertices.length) {
        lines.add((
          prefix: '~',
          summary:
              '$label (${prev.vertices.length} → ${f.vertices.length} pts)',
        ));
      }
    }
    for (final f in base) {
      if (!nextById.containsKey(f.id)) {
        final label = f.name?.isNotEmpty == true ? f.name! : f.id;
        lines.add((prefix: '-', summary: '$label (${f.kind.name})'));
      }
    }
    return lines;
  }

  Future<void> _handleSubmitProposal() async {
    final desc = _proposalDescController.text.trim();
    setState(() {
      _submitting = true;
      _error = null;
      _statusNote = null;
    });
    try {
      final outcome = await widget.onSubmitProposal(
        desc.isEmpty ? 'Proposed field update' : desc,
      );
      if (!mounted) return;
      _proposalDescController.clear();
      final shortId = outcome.eventId.length > 10
          ? '${outcome.eventId.substring(0, 10)}…'
          : outcome.eventId;
      setState(() {
        _statusNote = 'Proposal published (${outcome.outboxState}) · $shortId';
      });
      if (widget.initialSnapshot == null) {
        await _refresh();
      }
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _handleSubmitStoryProposal() async {
    if (widget.onSubmitStoryProposal == null) return;
    final body = _storyProposalBodyController.text;
    if (body.trim().isEmpty) {
      setState(() => _error = 'Proposed Story markdown cannot be empty.');
      return;
    }
    final desc = _proposalDescController.text.trim();
    setState(() {
      _submitting = true;
      _error = null;
      _statusNote = null;
    });
    try {
      final outcome = await widget.onSubmitStoryProposal!(
        desc.isEmpty ? 'Suggested Story edit' : desc,
        body,
      );
      if (!mounted) return;
      _proposalDescController.clear();
      final shortId = outcome.eventId.length > 10
          ? '${outcome.eventId.substring(0, 10)}…'
          : outcome.eventId;
      setState(() {
        _showStoryProposalComposer = false;
        _statusNote =
            'Story proposal published (${outcome.outboxState}) · $shortId';
      });
      if (widget.initialSnapshot == null) {
        await _refresh();
      }
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  List<_CommentThreadNode> _buildCommentTree(List<GeoCommentDto> rawComments) {
    final visible = rawComments
        .where((c) => !widget.mutedPubkeys.contains(c.pubkey))
        .toList(growable: false);
    final byEventId = <String, GeoCommentDto>{
      for (final c in visible) c.eventId: c,
    };
    final byAddress = <String, GeoCommentDto>{
      for (final c in visible) c.address: c,
    };

    final childrenByParent = <String, List<GeoCommentDto>>{};
    final roots = <GeoCommentDto>[];

    for (final c in visible) {
      GeoCommentDto? parent;
      if (c.parentEventId != null && c.parentEventId!.isNotEmpty) {
        parent = byEventId[c.parentEventId!];
      }
      if (parent == null &&
          c.parentAddress != null &&
          c.parentAddress!.isNotEmpty &&
          c.parentAddress != widget.target.address) {
        parent = byAddress[c.parentAddress!];
      }
      if (parent != null && parent.eventId != c.eventId) {
        childrenByParent
            .putIfAbsent(parent.eventId, () => <GeoCommentDto>[])
            .add(c);
      } else {
        roots.add(c);
      }
    }

    final result = <_CommentThreadNode>[];
    final visited = <String>{};
    void visit(GeoCommentDto node, int depth) {
      if (!visited.add(node.eventId)) return;
      result.add(_CommentThreadNode(comment: node, depth: depth.clamp(0, 4)));
      final kids = childrenByParent[node.eventId];
      if (kids != null) {
        for (final child in kids) {
          visit(child, depth + 1);
        }
      }
    }

    for (final r in roots) {
      visit(r, 0);
    }
    // Include any orphaned cyclic entries defensively
    for (final c in visible) {
      if (!visited.contains(c.eventId)) {
        visit(c, 0);
      }
    }
    return result;
  }

  List<_DiffLine> _computeStoryDiffLines(String base, String proposed) {
    final baseLines = base.split('\n');
    final propLines = proposed.split('\n');
    final baseSet = baseLines.map((l) => l.trim()).toSet();
    final propSet = propLines.map((l) => l.trim()).toSet();

    final out = <_DiffLine>[];
    for (final line in baseLines) {
      final t = line.trim();
      if (t.isNotEmpty && !propSet.contains(t)) {
        out.add(_DiffLine('-', line));
      }
    }
    for (final line in propLines) {
      final t = line.trim();
      if (t.isEmpty) continue;
      if (!baseSet.contains(t)) {
        out.add(_DiffLine('+', line));
      } else {
        out.add(_DiffLine(' ', line));
      }
    }
    return out.take(80).toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rawComments = _snapshot?.comments ?? const <GeoCommentDto>[];
    final threadNodes = _buildCommentTree(rawComments);
    final proposals = (_snapshot?.proposals ?? const <GeoProposalDto>[])
        .where((p) => !widget.mutedPubkeys.contains(p.pubkey))
        .toList(growable: false);

    return EarthlyMapDrawer(
      initialFraction: 0.56,
      onClose: widget.onClose,
      header: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 8, 2),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'THREAD & PROPOSALS',
                        style: theme.textTheme.labelSmall?.copyWith(
                          fontFamily: 'monospace',
                          letterSpacing: 0.7,
                        ),
                      ),
                      Text(
                        widget.target.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh',
                  visualDensity: VisualDensity.compact,
                  onPressed: _loading ? null : _refresh,
                  icon: _loading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh, size: 18),
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
            tabs: [
              Tab(text: 'Comments (${threadNodes.length})'),
              Tab(text: 'Proposals (${proposals.length})'),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          if (_error != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
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
              padding: const EdgeInsets.all(8),
              color: EarthlyColors.commentGreen.withValues(alpha: 0.12),
              child: Text(
                _statusNote!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: EarthlyColors.commentGreen,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                _buildCommentsTab(threadNodes),
                _buildProposalsTab(proposals),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCommentsTab(List<_CommentThreadNode> nodes) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Expanded(
          child: _loading && _snapshot == null
              ? const Center(child: CircularProgressIndicator())
              : nodes.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'No comments on this entity yet. Start the discussion below.',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(14),
                      itemCount: nodes.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        final node = nodes[index];
                        final c = node.comment;
                        final hasGeo =
                            c.geojson != null && c.geojson!.isNotEmpty;
                        final showing = _activeCommentId == c.eventId;
                        final canMute = widget.onMuteAuthor != null &&
                            c.pubkey != widget.currentUserPubkey;

                        Widget content = Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                InkWell(
                                  onTap: widget.onOpenPerson == null
                                      ? null
                                      : () => widget.onOpenPerson!(c.pubkey),
                                  borderRadius: BorderRadius.circular(999),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      CircleAvatar(
                                        radius: 10,
                                        backgroundColor: theme
                                            .colorScheme.primary
                                            .withValues(alpha: 0.14),
                                        backgroundImage: (widget
                                                    .profilesByPubkey[c.pubkey]
                                                    ?.picture
                                                    ?.startsWith('http') ??
                                                false)
                                            ? NetworkImage(
                                                widget
                                                    .profilesByPubkey[
                                                        c.pubkey]!
                                                    .picture!,
                                              )
                                            : null,
                                        child: (widget
                                                    .profilesByPubkey[c.pubkey]
                                                    ?.picture
                                                    ?.startsWith('http') ??
                                                false)
                                            ? null
                                            : const Icon(Icons.person,
                                                size: 12),
                                      ),
                                      const SizedBox(width: 6),
                                      Text(
                                        _authorLabel(c.pubkey),
                                        style: TextStyle(
                                          fontFamily: 'monospace',
                                          fontSize: 11,
                                          fontWeight: FontWeight.w700,
                                          color: widget.onOpenPerson != null
                                              ? EarthlyColors.infoCyan
                                              : null,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const Spacer(),
                                TextButton.icon(
                                  key: Key('reply-btn-${c.eventId}'),
                                  style: TextButton.styleFrom(
                                    visualDensity: VisualDensity.compact,
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                    ),
                                    minimumSize: const Size(0, 26),
                                  ),
                                  onPressed: () =>
                                      setState(() => _replyingTo = c),
                                  icon: const Icon(Icons.reply, size: 13),
                                  label: const Text(
                                    'Reply',
                                    style: TextStyle(fontSize: 11),
                                  ),
                                ),
                                if (canMute)
                                  IconButton(
                                    tooltip: 'Mute author',
                                    visualDensity: VisualDensity.compact,
                                    padding: EdgeInsets.zero,
                                    constraints: const BoxConstraints(
                                      minWidth: 26,
                                      minHeight: 26,
                                    ),
                                    onPressed: () =>
                                        widget.onMuteAuthor!(c.pubkey),
                                    icon: Icon(
                                      Icons.volume_off_outlined,
                                      size: 14,
                                      color:
                                          theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                if (hasGeo)
                                  OutlinedButton.icon(
                                    onPressed: () {
                                      setState(() {
                                        _activeCommentId =
                                            showing ? null : c.eventId;
                                      });
                                      widget.onToggleCommentOverlay(c);
                                    },
                                    icon: Icon(
                                      showing
                                          ? Icons.visibility
                                          : Icons.map_outlined,
                                      size: 14,
                                      color: EarthlyColors.commentGreen,
                                    ),
                                    label: Text(
                                      showing ? 'Showing' : 'Show geometry',
                                      style: const TextStyle(fontSize: 11),
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            EarthlyRichText(text: c.text, compact: true),
                          ],
                        );

                        if (node.depth > 0) {
                          content = Padding(
                            key: Key('thread-indent-${c.eventId}'),
                            padding: EdgeInsets.only(left: node.depth * 16.0),
                            child: Container(
                              padding: const EdgeInsets.only(left: 10),
                              decoration: BoxDecoration(
                                border: Border(
                                  left: BorderSide(
                                    color: EarthlyColors.infoCyan
                                        .withValues(alpha: 0.45),
                                    width: 2,
                                  ),
                                ),
                              ),
                              child: content,
                            ),
                          );
                        }
                        return content;
                      },
                    ),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_replyingTo != null)
                Container(
                  key: const Key('reply-target-banner'),
                  margin: const EdgeInsets.only(bottom: 8),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: EarthlyColors.infoCyan.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: EarthlyColors.infoCyan.withValues(alpha: 0.45),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.reply,
                        size: 14,
                        color: EarthlyColors.infoCyan,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'Replying to ${_authorLabel(_replyingTo!.pubkey)}: ${_replyingTo!.text}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 11,
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Cancel reply',
                        visualDensity: VisualDensity.compact,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 24,
                          minHeight: 24,
                        ),
                        onPressed: () => setState(() => _replyingTo = null),
                        icon: const Icon(Icons.close, size: 14),
                      ),
                    ],
                  ),
                ),
              if (widget.hasDraftGeometry)
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: _attachDraft,
                  onChanged: (v) => setState(() => _attachDraft = v ?? false),
                  title: const Text(
                    'Attach current draft geometry annotation (Comment Green)',
                    style: TextStyle(fontSize: 12),
                  ),
                ),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _commentController,
                      decoration: InputDecoration(
                        hintText: _replyingTo != null
                            ? 'Write a reply to ${_authorLabel(_replyingTo!.pubkey)}…'
                            : 'Write a geo comment (kind 37517)…',
                      ),
                    ),
                  ),
                  IconButton(
                    key: const Key('discussion-insert-map-ref-btn'),
                    tooltip: 'Mention Map/Atlas (\$)',
                    visualDensity: VisualDensity.compact,
                    onPressed: () async {
                      final token = await showEarthlyMentionPickerDialog(
                        context,
                        mode: MentionPickerMode.entity,
                        maps: widget.catalogMaps,
                        atlases: widget.catalogAtlases,
                        profilesByPubkey: widget.profilesByPubkey,
                        relayUrls: widget.relayUrls,
                        onEncodeNaddr: widget.onEncodeNaddr,
                        onEncodeNpub: widget.onEncodeNpub,
                      );
                      if (!mounted || token == null) return;
                      final existing = _commentController.text;
                      final prefix =
                          existing.isEmpty || existing.endsWith(' ') ? '' : ' ';
                      _commentController.text = '$existing$prefix$token ';
                    },
                    icon: const Icon(Icons.link, size: 18),
                  ),
                  IconButton(
                    key: const Key('discussion-insert-person-ref-btn'),
                    tooltip: 'Mention Author (@)',
                    visualDensity: VisualDensity.compact,
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
                      if (!mounted || token == null) return;
                      final existing = _commentController.text;
                      final prefix =
                          existing.isEmpty || existing.endsWith(' ') ? '' : ' ';
                      _commentController.text = '$existing$prefix$token ';
                    },
                    icon: const Icon(Icons.alternate_email, size: 18),
                  ),
                  if (widget.onUploadBlossomImage != null) ...[
                    IconButton(
                      key: const Key('comment-upload-photo-btn'),
                      tooltip: 'Upload photo via Blossom',
                      visualDensity: VisualDensity.compact,
                      onPressed: _uploadingPhoto ? null : _uploadCommentPhoto,
                      icon: _uploadingPhoto
                          ? const SizedBox(
                              width: 15,
                              height: 15,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.add_a_photo_outlined, size: 19),
                    ),
                  ],
                  const SizedBox(width: 4),
                  FilledButton(
                    onPressed: _submitting ? null : _handlePostComment,
                    child: Text(
                      _submitting
                          ? '…'
                          : (_replyingTo != null ? 'Reply' : 'Post'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildProposalsTab(List<GeoProposalDto> proposals) {
    final theme = Theme.of(context);
    final isStory = widget.target.kind == 37520;

    return Column(
      children: [
        Expanded(
          child: _loading && _snapshot == null
              ? const Center(child: CircularProgressIndicator())
              : proposals.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          isStory
                              ? 'No Story edit proposals (kind 37519) yet.'
                              : 'No edit proposals (kind 37519) for this map yet.',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(14),
                      itemCount: proposals.length,
                      separatorBuilder: (_, _) => const Divider(height: 16),
                      itemBuilder: (context, index) {
                        final p = proposals[index];
                        final showing = _activeProposalId == p.eventId;
                        final showingDiff =
                            _expandedStoryDiffIds.contains(p.eventId);
                        final badgeColor = switch (p.status) {
                          'applied' => EarthlyColors.commentGreen,
                          'closed' => EarthlyColors.destructive,
                          'draft' => EarthlyColors.published,
                          _ => EarthlyColors.proposedAmber,
                        };
                        final isOwner =
                            widget.currentUserPubkey == widget.target.pubkey;
                        return Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            border: Border(
                              left: BorderSide(color: badgeColor, width: 3),
                              top: BorderSide(color: theme.dividerColor),
                              right: BorderSide(color: theme.dividerColor),
                              bottom: BorderSide(color: theme.dividerColor),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                      vertical: 2,
                                    ),
                                    color: badgeColor.withValues(alpha: 0.16),
                                    child: Text(
                                      p.status.toUpperCase(),
                                      style: TextStyle(
                                        fontFamily: 'monospace',
                                        fontSize: 10,
                                        fontWeight: FontWeight.w800,
                                        color: badgeColor,
                                      ),
                                    ),
                                  ),
                                  Text(
                                    p.isStoryProposal
                                        ? '+${p.addedCount}  -${p.removedCount} lines'
                                        : '+${p.addedCount}  ~${p.modifiedCount}  -${p.removedCount}',
                                    style: const TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  if (p.isStoryProposal)
                                    OutlinedButton(
                                      key: Key('story-diff-btn-${p.eventId}'),
                                      onPressed: () {
                                        setState(() {
                                          if (!_expandedStoryDiffIds
                                              .add(p.eventId)) {
                                            _expandedStoryDiffIds
                                                .remove(p.eventId);
                                          }
                                        });
                                      },
                                      child: Text(
                                        showingDiff ? 'Hide diff' : 'View diff',
                                      ),
                                    )
                                  else ...[
                                    OutlinedButton(
                                      key: Key(
                                          'proposal-feature-diff-btn-${p.eventId}'),
                                      onPressed: () {
                                        setState(() {
                                          if (!_expandedMapDiffIds
                                              .add(p.eventId)) {
                                            _expandedMapDiffIds
                                                .remove(p.eventId);
                                          }
                                        });
                                      },
                                      child: Text(
                                        _expandedMapDiffIds.contains(p.eventId)
                                            ? 'Hide diff'
                                            : 'Diff',
                                      ),
                                    ),
                                    OutlinedButton(
                                      onPressed: () {
                                        setState(() {
                                          _activeProposalId =
                                              showing ? null : p.eventId;
                                        });
                                        widget.onToggleProposalOverlay(p);
                                      },
                                      child: Text(
                                        showing ? 'Hide preview' : 'Preview',
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                               const SizedBox(height: 6),
                               EarthlyRichText(
                                 text:
                                     '**${_authorLabel(p.pubkey)}** · ${p.description ?? 'Proposed edit (${p.dTag})'}',
                                 compact: true,
                               ),
                               if (!p.isStoryProposal &&
                                   _expandedMapDiffIds.contains(p.eventId)) ...[
                                 const SizedBox(height: 8),
                                 Container(
                                   key: Key('proposal-feature-diff-view-${p.eventId}'),
                                   width: double.infinity,
                                   padding: const EdgeInsets.all(8),
                                   decoration: BoxDecoration(
                                     color: theme
                                         .colorScheme.surfaceContainerHighest,
                                     borderRadius: BorderRadius.circular(8),
                                     border:
                                         Border.all(color: theme.dividerColor),
                                   ),
                                   child: Column(
                                     crossAxisAlignment:
                                         CrossAxisAlignment.stretch,
                                     children: [
                                       for (final fd in _computeMapFeatureDiff(
                                         widget.target.baseGeojson,
                                         p.geojson,
                                       ))
                                         Padding(
                                           padding: const EdgeInsets.symmetric(
                                             vertical: 1.5,
                                           ),
                                           child: Text(
                                             '${fd.prefix} ${fd.summary}',
                                             style: TextStyle(
                                               fontFamily: 'monospace',
                                               fontSize: 10.5,
                                               color: fd.prefix == '+'
                                                   ? EarthlyColors.commentGreen
                                                   : fd.prefix == '-'
                                                       ? EarthlyColors
                                                           .destructive
                                                       : EarthlyColors
                                                           .proposedAmber,
                                             ),
                                           ),
                                         ),
                                     ],
                                   ),
                                 ),
                               ],
                              if (p.isStoryProposal && showingDiff) ...[
                                const SizedBox(height: 8),
                                Container(
                                  key: Key('story-diff-view-${p.eventId}'),
                                  width: double.infinity,
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: theme
                                        .colorScheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(8),
                                    border:
                                        Border.all(color: theme.dividerColor),
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      for (final line in _computeStoryDiffLines(
                                        widget.target.baseMarkdown ?? '',
                                        p.proposedMarkdown ?? '',
                                      ))
                                        Container(
                                          color: line.prefix == '+'
                                              ? EarthlyColors.commentGreen
                                                  .withValues(alpha: 0.14)
                                              : line.prefix == '-'
                                                  ? EarthlyColors.destructive
                                                      .withValues(alpha: 0.14)
                                                  : null,
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 4,
                                            vertical: 1,
                                          ),
                                          child: Text(
                                            '${line.prefix} ${line.text}',
                                            style: TextStyle(
                                              fontFamily: 'monospace',
                                              fontSize: 10.5,
                                              color: line.prefix == '+'
                                                  ? EarthlyColors.commentGreen
                                                  : line.prefix == '-'
                                                      ? EarthlyColors
                                                          .destructive
                                                      : theme.colorScheme
                                                          .onSurfaceVariant,
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                              ],
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: [
                                  if (!p.isStoryProposal)
                                    OutlinedButton.icon(
                                      onPressed: () =>
                                          widget.onLoadProposalToDraft(p),
                                      icon: const Icon(
                                        Icons.copy_all_outlined,
                                        size: 14,
                                      ),
                                      label: const Text(
                                        'Load to Draft',
                                        style: TextStyle(fontSize: 11),
                                      ),
                                    ),
                                  if (p.status == 'open' && isOwner) ...[
                                    FilledButton.icon(
                                      onPressed: _submitting
                                          ? null
                                          : () => _handleProposalStatus(
                                                p,
                                                apply: true,
                                              ),
                                      icon: const Icon(Icons.check, size: 14),
                                      label: Text(
                                        p.isStoryProposal
                                            ? 'Accept & Update Story'
                                            : 'Accept & Apply',
                                        style: const TextStyle(fontSize: 11),
                                      ),
                                    ),
                                    if (widget.onRequestChangesProposal != null)
                                      OutlinedButton(
                                        key: Key(
                                          'proposal-request-changes-btn-${p.eventId}',
                                        ),
                                        onPressed: _submitting
                                            ? null
                                            : () => _handleRequestChanges(p),
                                        child: const Text(
                                          'Request Changes',
                                          style: TextStyle(fontSize: 11),
                                        ),
                                      ),
                                    OutlinedButton(
                                      onPressed: _submitting
                                          ? null
                                          : () => _handleProposalStatus(
                                                p,
                                                apply: false,
                                              ),
                                      child: const Text(
                                        'Close',
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: EarthlyColors.destructive,
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ],
                          ),
                        );
                      },
                    ),
        ),
        if (widget.target.kind == 37515 && widget.hasDraftGeometry) ...[
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _proposalDescController,
                  decoration: const InputDecoration(
                    hintText: 'Summary of your edit proposal…',
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton.icon(
                  onPressed: _submitting ? null : _handleSubmitProposal,
                  icon: const Icon(Icons.call_merge, size: 16),
                  label: Text(
                    _submitting
                        ? 'Signing & publishing…'
                        : 'Propose Local Draft as Edit (37519)',
                  ),
                ),
              ],
            ),
          ),
        ],
        if (isStory && widget.onSubmitStoryProposal != null) ...[
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (!_showStoryProposalComposer)
                  OutlinedButton.icon(
                    key: const Key('open-story-proposal-composer'),
                    onPressed: () =>
                        setState(() => _showStoryProposalComposer = true),
                    icon: const Icon(Icons.edit_note, size: 17),
                    label: const Text('Propose Story Edit (37519)'),
                  )
                else ...[
                  TextField(
                    controller: _proposalDescController,
                    decoration: const InputDecoration(
                      hintText: 'Summary of your suggested Story edit…',
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _storyProposalBodyController,
                    minLines: 4,
                    maxLines: 8,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11.5),
                    decoration: const InputDecoration(
                      labelText: 'Proposed Story Markdown',
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      TextButton(
                        onPressed: _submitting
                            ? null
                            : () => setState(
                                () => _showStoryProposalComposer = false),
                        child: const Text('Cancel'),
                      ),
                      const Spacer(),
                      FilledButton.icon(
                        onPressed:
                            _submitting ? null : _handleSubmitStoryProposal,
                        icon: const Icon(Icons.call_merge, size: 16),
                        label: Text(
                          _submitting
                              ? 'Publishing…'
                              : 'Submit Story Proposal',
                        ),
                      ),
                    ],
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

class _RequestChangesDialog extends StatefulWidget {
  const _RequestChangesDialog();

  @override
  State<_RequestChangesDialog> createState() => _RequestChangesDialogState();
}

class _RequestChangesDialogState extends State<_RequestChangesDialog> {
  final _noteCtrl = TextEditingController();

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Request Changes'),
      content: TextField(
        key: const Key('request-changes-note-field'),
        controller: _noteCtrl,
        maxLines: 3,
        decoration: const InputDecoration(
          hintText: 'Describe requested changes for the contributor…',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('request-changes-confirm-btn'),
          onPressed: () => Navigator.of(context).pop(
            _noteCtrl.text.trim().isEmpty
                ? 'Changes requested'
                : _noteCtrl.text.trim(),
          ),
          child: const Text('Send Feedback'),
        ),
      ],
    );
  }
}
