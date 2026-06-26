# Phase 10: Story / Article (~37520) - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the **authoring + reading UX layer** for Stories (kind ~37520 / NIP-23-style
articles). The data layer already exists from Phase 8 (`ArticleFactory` / cast / helpers
in `src/lib/nostr/article/` with `title`/`summary`/`image`/`content` + `modelVersion`).
This phase builds:

- Create a Story with title, summary, cover image, and a Markdown body (STORY-01).
- Embed inline references to datasets/features (and images/videos) that render in place
  with eye-toggle (show/hide on map) + fly-to (STORY-02).
- Mirror inline `nostr:naddr…` geo refs in the body to queryable `a` tags on publish —
  single source of truth = the Markdown body; `a` tags re-derived every publish (STORY-03).
- Save as draft before publishing; edit a published Story in place (parameterized-
  replaceable, same `d`-tag lineage) (STORY-04).
- Comment on + react to a Story (reuse kind 37517 + kind 7) (STORY-05).
- Propose an edit to a Story's narrative (kind 37519 extended to a Markdown-content
  target); author previews + accepts/rejects (STORY-06).

**Out of scope (own phases):** Temporal Sighting (Phase 11), Live Beacon (Phase 12),
cross-cutting moderation/routing (Phase 13).
</domain>

<decisions>
## Implementation Decisions

### Story navigation / where it lives  *(discussed)*
- **D-01 — Browse surface:** Add a **dedicated "Stories" rail destination** in
  `AppSidebar` alongside Datasets/Contexts (a Stories panel listing the user's + others'
  Stories), following the existing `RAIL_DESTINATIONS` + `GeoDatasetsPanelContent`
  browse pattern. Explicitly avoids the Phase-9 "no Groups tab" discoverability gap.
- **D-02 — Create entry point:** A **"New Story" button at the top of the Stories rail
  panel** (mirrors how the Datasets/Groups panels offer creation). Create + browse stay
  co-located.
- **D-03 — Open layout:** An opened Story **renders in the right info panel** (via the
  `GeoEditorInfoPanel` view multiplexing, like Groups/datasets); the **main map stays the
  canvas**. Inline eye-toggle/fly-to drive the main map. The "map lane derived from the
  body" = the main map filtered to the Story's referenced features. (No wide/takeover
  reading view this phase.)
- **D-04 — Shareability:** Stories get a **deep-link route** (`/story/:naddr` or
  `/article/:naddr`, consistent with `/geoevent/:naddr` + `/mapcontext/:naddr`) **AND an
  open-graph social card** (reuse the `src/lib/og/` crawler/template/renderImage path).

### Claude's Discretion
The user deliberately scoped discussion to navigation. The following are LEFT TO
research + planner defaults — but must **reuse existing machinery** and stay consistent
with the locked navigation decisions above:

- **Body editor type** — WYSIWYG via the existing TipTap `GeoRichTextEditor` vs raw
  Markdown-source + preview. Whichever is chosen, the stored `content` MUST be Markdown
  (NIP-23). Prefer reusing the TipTap stack if Markdown serialization is clean; otherwise
  a Markdown-source editor is acceptable. Planner to decide based on serialization cost.
- **Geo-ref insertion UX** — `@`-mention search picker (reuse `GeoMentionExtension`) vs
  toolbar button vs drag-from-panel. Default: reuse the existing `@`-mention picker.
- **Reader layout details** — exact narrative/map-lane composition within the info panel;
  whether inline refs default shown or hidden on load.
- **Draft storage** — local-only until publish (mirror the editor's
  `writePersistedGeoCollectionDraftState` draft pattern) vs a NIP-23 draft event
  (kind 30024). Planner/research to pick; local-first preferred for simplicity.
- **Propose-edit (STORY-06) shape + UX** — confirm whether the kind-37519 generalization
  to a Markdown-content target is a **pure content-type extension** or needs a **spec
  discriminator** (open roadmap question), and the author's accept/reject preview UX
  (diff view). Reuse `src/lib/nostr/geo-proposal/*` + `src/features/social/proposals/`.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Entity spec + requirements
- `SPEC.md` — the Nostr event spec; defines kind ~37520 Story/Article (NIP-23 metadata),
  tag contracts, and the `a`/naddr conventions. **Authoritative.**
- `.planning/ROADMAP.md` §"Phase 10: Story / Article (~37520)" — goal, 4 success criteria,
  the flagged open question on the 37519 propose-edit content-type extension.
- `.planning/REQUIREMENTS.md` — STORY-01 … STORY-06.

### naddr → `a` mirroring (STORY-03)
- `src/lib/nostr/references.ts` — `extractNostrAddressReferences`,
  `dedupeNostrAddressReferences`, `naddrToCoordinate`, `NADDR_REFERENCE_PATTERN`.
- `src/lib/nostr/tags.ts` — `setReferencedAddresses` (`a` tag writer) used by the factories.

### Reusable entity/UI machinery
- `src/lib/nostr/article/` (`factory.ts`, `cast.ts`, `helpers.ts`) — the kind-37520
  ArticleFactory + `ArticleContent`; extend, do not re-create.
- `src/components/editor/` — `GeoRichTextEditor`, `GeoMentionExtension`,
  `RichContentRenderer`, `MediaExtensions`, `contentParser` (inline geo-ref render +
  eye-toggle/fly-to already implemented for comments).
- `src/lib/nostr/geo-proposal/` + `src/features/social/proposals/` — kind 37519 proposal
  factory/cast/helpers + UI, for STORY-06.
- `src/features/social/comments/` (`CommentsPanel`, `GeoSocialActions`) — comment/react,
  already mounted on Groups in Phase 9.

### Navigation + share surfaces
- `src/components/AppSidebar.tsx` — `RAIL_DESTINATIONS`, `GeoEditorInfoPanelContent`
  multiplexing (D-01/D-03 integration points).
- `src/components/GeoDatasetsPanel.tsx` (`GeoDatasetsPanelContent`) — browse-panel pattern.
- `src/features/geo-editor/hooks/useRouting.ts` — deep-link route handling
  (`/geoevent/:naddr`, `/mapcontext/:naddr`) to extend for D-04.
- `src/lib/og/` (`crawler.ts`, `fetchEvent.ts`, `template.ts`, `renderImage.ts`) —
  open-graph card generation for the share route (D-04).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **ArticleFactory (kind 37520)** already exists — Phase 10 wraps it with UI; the
  `modelVersion: 'earthly/2'` discriminator and `a`-tag writers are in place.
- **TipTap editor stack** already renders inline geo-mentions with eye-toggle + fly-to
  (in comments) — the render half of STORY-02 is largely solved by reuse.
- **CommentsPanel / GeoSocialActions** wired for comment+react on an entity coordinate
  (proven on Groups, Phase 9) — STORY-05 is a mount, not new infrastructure.
- **geo-proposal (37519)** factory/cast + social/proposals UI — STORY-06 generalizes the
  target to a Markdown-content event.

### Established Patterns
- Left-rail browse destinations → panel → open-in-info-panel (D-01/D-02/D-03 follow this).
- Deep-link routes per entity via `useRouting` + OG crawler (D-04 follows this).
- Parameterized-replaceable in-place edit preserving the `d`-tag (`GroupFactory.modify`
  pattern) — apply the same to Story edit (STORY-04).
- Single-source-of-truth re-derivation: Group re-derives `a`/`c` tags on publish; Story
  re-derives `a` tags from the body's naddr refs on every publish (STORY-03).

### Integration Points
- New `StoriesPanel` + a `stories` rail destination in `AppSidebar`.
- New `StoryViewPanel` + `StoryEditorPanel` slotted into `GeoEditorInfoPanel` multiplexing.
- A `/story/:naddr` (or `/article/:naddr`) route in `useRouting` + OG crawler match.
</code_context>

<specifics>
## Specific Ideas

- Discoverability is a first-class concern this phase — the Phase-9 retrospective (Groups
  table built but never wired into the rail → "No Group selected" dead-ends) is the
  explicit reason a dedicated, wired Stories rail tab was chosen over folding into an
  existing panel.
- The "map lane derived from the body" is realized as the **main map canvas filtered to
  the Story's referenced features**, not a separate map widget (consistent with D-03).
</specifics>

<deferred>
## Deferred Ideas

- **Wide/takeover reading view** for long-form Stories — considered for D-03, deferred in
  favor of the consistent info-panel presentation; revisit if reading UX proves cramped.
- **Groups-tab cleanup** (wire `createGroupColumns` into a rail tab + filter discovery to
  `isGroup`) — a Phase-9 follow-up surfaced here because the Stories rail tab (D-01)
  establishes the pattern; tracked separately, not part of Phase 10.

None of the above expand Phase 10 scope.

</deferred>

---

*Phase: 10-story-article-37520*
*Context gathered: 2026-06-26*
