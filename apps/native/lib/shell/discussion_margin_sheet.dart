import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';

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
  });

  final String address;
  final int kind;
  final String pubkey;
  final String title;
  final String? eventId;
  final String? baseGeojson;
}

/// Interactive Margin sheet for NIP-22 Geo Comments (`37517`) and Geo Edit
/// Proposals (`37519`), with live Comment Green / Proposed Amber map previews
/// and Amber NIP-55 signing via SQLite Outbox.
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
    super.key,
  });

  final DiscussionTarget target;
  final List<String> relayUrls;
  final bool hasDraftGeometry;
  final String? activeCommentGeojsonId;
  final String? activeProposalId;
  final Map<String, ProfileMetadataDto> profilesByPubkey;
  final String? currentUserPubkey;
  final void Function(GeoCommentDto comment) onToggleCommentOverlay;
  final void Function(GeoProposalDto proposal) onToggleProposalOverlay;
  final Future<PublishOutcomeDto> Function(
    String text,
    bool attachDraftGeometry,
  ) onPostComment;
  final Future<PublishOutcomeDto> Function(String description) onSubmitProposal;
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

  EntityDiscussionSnapshot? _snapshot;
  bool _loading = true;
  bool _submitting = false;
  bool _attachDraft = false;
  String? _error;
  String? _statusNote;
  late String? _activeCommentId = widget.activeCommentGeojsonId;
  late String? _activeProposalId = widget.activeProposalId;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _refresh();
  }

  @override
  void dispose() {
    _tabs.dispose();
    _commentController.dispose();
    _proposalDescController.dispose();
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
    setState(() {
      _submitting = true;
      _error = null;
      _statusNote = null;
    });
    try {
      final outcome = await widget.onPostComment(text, _attachDraft);
      if (!mounted) return;
      _commentController.clear();
      setState(() {
        _attachDraft = false;
        _statusNote =
            'Comment published (${outcome.outboxState}) · ${outcome.eventId.substring(0, 10)}…';
      });
      await _refresh();
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
            ? 'Proposal applied & map republished (${outcome.outboxState})!'
            : 'Proposal closed (${outcome.outboxState}).';
      });
      await _refresh();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
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
      setState(() {
        _statusNote =
            'Proposal published (${outcome.outboxState}) · ${outcome.eventId.substring(0, 10)}…';
      });
      await _refresh();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final comments = _snapshot?.comments ?? const <GeoCommentDto>[];
    final proposals = _snapshot?.proposals ?? const <GeoProposalDto>[];

    return EarthlyMapDrawer(
      initialFraction: 0.50,
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
              Tab(text: 'Comments (${comments.length})'),
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
                _buildCommentsTab(comments),
                _buildProposalsTab(proposals),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCommentsTab(List<GeoCommentDto> comments) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Expanded(
          child: _loading && _snapshot == null
              ? const Center(child: CircularProgressIndicator())
              : comments.isEmpty
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
                      itemCount: comments.length,
                      separatorBuilder: (_, _) => const Divider(height: 16),
                      itemBuilder: (context, index) {
                        final c = comments[index];
                        final hasGeo =
                            c.geojson != null && c.geojson!.isNotEmpty;
                        final showing = _activeCommentId == c.eventId;
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                CircleAvatar(
                                  radius: 10,
                                  backgroundColor: theme.colorScheme.primary
                                      .withValues(alpha: 0.14),
                                  backgroundImage: (widget
                                              .profilesByPubkey[c.pubkey]
                                              ?.picture
                                              ?.startsWith('http') ??
                                          false)
                                      ? NetworkImage(
                                          widget.profilesByPubkey[c.pubkey]!
                                              .picture!,
                                        )
                                      : null,
                                  child: (widget.profilesByPubkey[c.pubkey]
                                              ?.picture
                                              ?.startsWith('http') ??
                                          false)
                                      ? null
                                      : const Icon(Icons.person, size: 12),
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  _authorLabel(c.pubkey),
                                  style: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const Spacer(),
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
                            Text(c.text, style: theme.textTheme.bodyMedium),
                          ],
                        );
                      },
                    ),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
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
                      decoration: const InputDecoration(
                        isDense: true,
                        border:
                            OutlineInputBorder(borderRadius: BorderRadius.zero),
                        hintText: 'Write a geo comment (kind 37517)…',
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: _submitting ? null : _handlePostComment,
                    child: Text(_submitting ? '…' : 'Post'),
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
    return Column(
      children: [
        Expanded(
          child: _loading && _snapshot == null
              ? const Center(child: CircularProgressIndicator())
              : proposals.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'No edit proposals (kind 37519) for this map yet.',
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
                        final badgeColor = switch (p.status) {
                          'applied' => EarthlyColors.commentGreen,
                          'closed' => EarthlyColors.destructive,
                          'draft' => EarthlyColors.published,
                          _ => EarthlyColors.proposedAmber,
                        };
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
                              Row(
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
                                  const SizedBox(width: 8),
                                  Text(
                                    '+${p.addedCount}  ~${p.modifiedCount}  -${p.removedCount}',
                                    style: const TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const Spacer(),
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
                              ),
                              const SizedBox(height: 6),
                              Text(
                                '${_authorLabel(p.pubkey)} · ${p.description ?? 'Proposed edit (${p.dTag})'}',
                                style: theme.textTheme.bodyMedium,
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: [
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
                                  if (p.status == 'open' &&
                                      widget.currentUserPubkey ==
                                          widget.target.pubkey) ...[
                                    FilledButton.icon(
                                      onPressed: _submitting
                                          ? null
                                          : () => _handleProposalStatus(
                                                p,
                                                apply: true,
                                              ),
                                      icon: const Icon(Icons.check, size: 14),
                                      label: const Text(
                                        'Accept & Apply',
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
                    isDense: true,
                    border: OutlineInputBorder(borderRadius: BorderRadius.zero),
                    hintText: 'Summary of your edit proposal…',
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton.icon(
                  onPressed: _submitting ? null : _handleSubmitProposal,
                  icon: const Icon(Icons.call_merge, size: 16),
                  label: Text(
                    _submitting
                        ? 'Signing with Amber…'
                        : 'Propose Local Draft as Edit (37519)',
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
