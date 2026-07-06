---
phase: 10-story-article-37520
plan: 04
subsystem: story-narrative-proposals
tags: [story, article, kind-37520, kind-37519, proposal, edit-proposal, content-type-extension]
requires:
  - "src/lib/nostr/geo-proposal/{factory,helpers,status,cast}.ts (kind-37519 dataset proposal machinery — to generalize)"
  - "src/lib/nostr/story/lifecycle.ts editStory (Plan 01 — in-place republish, re-derives a-tags / preserves d-tag)"
  - "src/components/info-panel/StoryViewPanel.tsx (Plan 03 — the mount point)"
  - "src/components/editor/{RichContentRenderer,GeoRichTextEditor} (sanitized render + reader edit affordance)"
  - "src/features/social/proposals/{ProposalsPanel,ProposalCard} (the dataset analog UI)"
provides:
  - "GeoProposalFactory.createForStory — Markdown-content kind-37519 proposal (a-tag = 37520 coordinate)"
  - "getProposalTargetKind / getProposalMarkdownContent helpers (coordinate disambiguation, raw content read)"
  - "useStoryProposals + acceptStoryProposalImpl — subscribe + accept(via editStory)/reject"
  - "StoryProposalsPanel (author Proposed-edits + diff) + StoryProposeEditDialog (reader Propose-an-edit)"
  - "the no-discriminator decision (pure content-type extension) — answers the ROADMAP/CONTEXT open question"
affects:
  - "Closes STORY-06 — the last STORY requirement of Phase 10"
tech-stack:
  added: []
  patterns:
    - "Content-type extension of an existing event kind WITHOUT a discriminator tag: target kind read off the `a` coordinate alone (SPEC.md §17)"
    - "Accept routes through the Plan-01 editStory path (not a re-inlined factory) so the body's a-tags re-derive and the d-tag lineage is preserved"
    - "Pure accept impl (acceptStoryProposalImpl) factored into its own React-free module so it is unit-testable without the live event store"
    - "Author panel self-gates on ownership (returns null for non-owners); reader gets a Propose-an-edit dialog instead"
    - "Proposed body previews ONLY through the sanitized RichContentRenderer — the accept preview is exactly as XSS-safe as the live narrative"
key-files:
  created:
    - "src/lib/nostr/geo-proposal/storyProposal.test.ts"
    - "src/features/social/hooks/useStoryProposals.ts"
    - "src/features/social/hooks/acceptStoryProposal.ts"
    - "src/features/social/proposals/StoryProposalsPanel.tsx"
    - "src/features/social/proposals/StoryProposeEditDialog.tsx"
  modified:
    - "src/lib/nostr/geo-proposal/factory.ts"
    - "src/lib/nostr/geo-proposal/helpers.ts"
    - "src/features/social/proposals/index.ts"
    - "src/components/info-panel/StoryViewPanel.tsx"
decisions:
  - "Spec-discriminator open question RESOLVED: kind-37519 generalizes to a Markdown-content (Story) target as a PURE content-type extension — NO discriminator tag. The target kind is read off the `a` coordinate (37520 ⇒ Markdown, 37515 ⇒ FeatureCollection) per SPEC.md §11.1 (content is a free-form string) + §17 (the coordinate is the canonical reference target). The dataset path (create/useGeoProposals) is untouched (amend, don't replace)."
  - "Factored the pure accept logic into acceptStoryProposal.ts (React-free) so behavior 4 (accept-via-editStory) is unit-testable by mocking @/lib/nostr/story + the geo-proposal barrel, without dragging in the live eventStore/hooks that the React hook needs"
  - "createProposalStatusEvent is reused verbatim for the Story accept (applied, 1631) + reject (closed, 1632) status events — no new status path"
  - "StoryProposalsPanel self-gates on isOwner (returns null for non-owners) rather than relying on the caller to gate — defensive; the reader sees the Propose-an-edit dialog mounted separately in StoryViewPanel"
metrics:
  duration: ~28m
  completed: 2026-06-27
---

# Phase 10 Plan 04: Story Narrative Edit-Proposals Summary

Closed **STORY-06** — the last STORY requirement — by generalizing the existing
kind-37519 edit-proposal machinery from a FeatureCollection (dataset) target to a
**Markdown-content (Story) target**, with **no spec discriminator tag**. A reader
proposes a narrative edit (a kind-37519 proposal carrying the proposed Markdown
body, `a`-tagged at the Story's `37520:owner:d` coordinate); the author sees an
amber **Proposed edits** banner, reviews a sanitized diff (proposed vs current),
and **Accept edit** republishes the Story in place via the Plan-01 `editStory`
path (re-deriving `a` tags, preserving the `d`-tag lineage) or **Reject** dismisses.
Zero new dependencies; the dataset proposal path is untouched.

## The no-discriminator decision (the open ROADMAP/CONTEXT question)

The kind-37519 generalization is a **PURE CONTENT-TYPE EXTENSION — no discriminator
tag is needed**, on three grounds cited from SPEC.md:

1. **§11.1** defines the 37519 `content` field as a free-form `JSON.stringify(...)`
   string with no content-type tag — the field is already untyped at the protocol
   level, so putting a raw Markdown string there is in-spec.
2. **§11.2 + §17** — the proposal's `a` tag already disambiguates the target kind:
   `37520:owner:d` for a Story vs `37515:owner:d` for a dataset. "Coordinates in the
   form `<kind>:<pubkey>:<d>` remain the canonical reference target." A consumer reads
   the target kind from the `a` coordinate (`getProposalTargetKind`) and parses
   `content` accordingly — Markdown for 37520, FeatureCollection for 37515 — with no
   on-event discriminator.
3. The existing dataset path (`GeoProposalFactory.create` + `useGeoProposals`) stays
   dataset-specific and untouched; the Story path is added in parallel (the roadmap's
   "amend, don't replace" rule).

## What Was Built

**Task 1 — content-type extension + hook (TDD, STORY-06)**
- `GeoProposalFactory.createForStory(target, markdownBody)` (factory.ts): identical to
  `create` except `tpl.content = markdownBody` (the raw Markdown STRING, not FC JSON),
  with `a` = the Story `37520:…` coordinate, `p` = owner, and a `d` tag. `create` is
  left intact (dataset path untouched).
- `getProposalMarkdownContent(event)` returns `event.content ?? ''` (never throws —
  T-10-14); `getProposalTargetKind(event)` parses the leading kind off the `a`
  coordinate (`split(':')[0]`), returning `undefined` for a missing/malformed
  coordinate (T-10-13). Both in helpers.ts (re-exported via the barrel).
- `useStoryProposals({ target })` (useStoryProposals.ts) mirrors `useGeoProposals`:
  two-stage subscribe (kind-37519 by `#a` = the Story coordinate, then status events),
  `acceptStoryProposal` / `rejectStoryProposal`. The pure accept impl is factored into
  `acceptStoryProposal.ts` (`acceptStoryProposalImpl`): it calls
  `editStory(storyEvent, { content: getProposalMarkdownContent(proposalEvent) }, signer)`
  then publishes a kind-1631 `applied` status event. Reject publishes a kind-1632
  `closed` status event via `createProposalStatusEvent` (reused verbatim).
- `storyProposal.test.ts` — the 4 plan behaviors GREEN (+2 edge cases): content is the
  raw Markdown (not JSON-wrapped) with correct a/p tags; target-kind disambiguation
  (37520 vs 37515, and undefined for malformed); raw markdown read; accept calls
  `editStory` with the proposal markdown and the SAME story event (d-tag lineage).

**Task 2 — reader dialog + author panel, mounted (STORY-06)**
- `StoryProposeEditDialog` — a Dialog opened by a non-owner reader's **Propose an edit**
  button; pre-fills a `GeoRichTextEditor` with the current Story body, captures the
  edited Markdown, and on submit calls `GeoProposalFactory.createForStory(...).sign(signer)`
  + `publish(signed, { routing: 'outbox' })`.
- `StoryProposalsPanel` — the author analog of `ProposalsPanel` over `useStoryProposals`:
  an amber `Alert variant="default"` banner when there are pending proposals (NOT
  destructive); a **Proposed edits** section; each row is **Review edit**, expanding a
  two-column diff preview (proposed vs current) rendered **only** through the sanitized
  `RichContentRenderer` (T-10-11); accent **Accept edit** (`bg-primary`) → toast "Edit
  applied — your story is updated."; destructive-toned **Reject**. Empty state:
  "No proposed edits". Self-gates on `isOwner`.
- `StoryViewPanel` mounts both: `<StoryProposalsPanel>` for the author (isOwner), and a
  **Propose an edit** button + `<StoryProposeEditDialog>` for a non-owner reader.

## Verification

- `bun test src/lib/nostr/geo-proposal/storyProposal.test.ts` → **6 pass / 0 fail**
  (4 plan behaviors + 2 edge cases).
- `bun run build` → exits 0 after each task.
- Full suite `bun test` → **693 pass / 0 fail** (baseline 687 + 6 new; no regressions;
  the dataset proposal path is regression-clean).
- `bunx biome check` on all 9 new/modified files → clean after autofix.
- Acceptance greps: `createForStory` in factory=1, `static create` in factory=2 (dataset
  untouched), helpers targetKind/markdown=2, `editStory` referenced in the hook+accept
  module, `dangerouslySetInnerHTML`=0 across all proposal files;
  `useStoryProposals` in panel=3, `createForStory` in dialog=2, `RichContentRenderer` in
  panel=5, `StoryProposalsPanel|StoryProposeEditDialog` in StoryViewPanel=4, `bg-primary`
  in panel=3, `Alert variant="default"`=2; all UI-SPEC copy strings present verbatim
  ("Propose an edit", "Review edit", "Accept edit", "Edit applied — your story is
  updated.", "No proposed edits").

Note: the project-wide `bun run lint` (biome over all files) reports the same
pre-existing unrelated errors logged out-of-scope at Phase-9/Plan-03 close; the 9 files
touched here are biome-clean when checked directly.

## Deviations from Plan

None affecting scope. Implementation notes:
- **Pure accept impl extracted to `acceptStoryProposal.ts`** (Rule 3 — blocking-issue
  fix for testability). The plan's behavior 4 asserts `acceptStoryProposal` calls
  `editStory` with the proposal markdown + same d-tag. Testing that through the React
  hook would drag in the live `eventStore`/`useTimelineWithEose`/`accounts`, which the
  bun test environment can't construct. Factoring the pure logic into a React-free
  module (`acceptStoryProposalImpl`) keeps it unit-testable by mocking only
  `@/lib/nostr/story` + the geo-proposal barrel. The hook re-exports it; behavior is
  identical.
- **`GEO_EDIT_PROPOSAL_KIND` imported from `@/lib/nostr/kinds`** in `acceptStoryProposal.ts`
  (not the geo-proposal barrel — the barrel does not re-export it). Caught by the build
  gate and fixed in Task 2.
- **`StoryProposalsPanel` self-gates on `isOwner`** (returns null for non-owners) rather
  than trusting the caller. StoryViewPanel still gates the mount on `isOwner` too —
  defense in depth; a reader can never see another user's proposal-management controls.

## Threat Model Outcomes

- **T-10-11 (XSS, accept-preview)** — mitigated. The proposed Markdown previews ONLY
  through the sanitized `RichContentRenderer` (the same path as the live narrative);
  zero `dangerouslySetInnerHTML` in both proposal files (grep gate = 0). The author
  never previews raw HTML before accepting.
- **T-10-12 (Tampering, accept → republish)** — mitigated. `acceptStoryProposalImpl`
  republishes via the Plan-01 `editStory` path, so the accepted body's `a` tags
  re-derive from the body (STORY-03) and the `d`-tag lineage is preserved (STORY-04).
  An accepted proposal cannot inject phantom `a` tags or fork the lineage; the published
  content is the previewed-and-sanitized Markdown.
- **T-10-13 (Spoofing / target confusion)** — mitigated. `getProposalTargetKind` parses
  the kind off the `a` coordinate and returns `undefined` for a missing/malformed
  coordinate, so a forged coordinate yields no actionable target — no cross-kind content
  confusion (the basis of the no-discriminator decision).
- **T-10-14 (DoS, useStoryProposals over relay proposals)** — mitigated. Proposals are
  subscribed by `#a` + kind 37519 and read defensively (`getProposalMarkdownContent`
  returns a string, never throws); a malformed proposal renders inertly.
- **T-10-SC (installs)** — mitigated. Zero new dependencies; the diff preview reuses
  `RichContentRenderer` + existing dialog/alert/badge primitives.

## Known Stubs

None. `createForStory` + helpers + `useStoryProposals` are wired to real factory/
status/timeline code; the panel renders real proposal content through the sanitized
renderer; accept republishes via the real `editStory`; reject publishes a real 1632
status event. The author panel + reader dialog are both mounted in StoryViewPanel.

## Commits

- `cbe9917` feat(10-04): Story-proposal content-type extension + useStoryProposals (STORY-06)
- `1888f7d` feat(10-04): reader Propose-edit dialog + author Proposed-edits panel, mounted in StoryViewPanel (STORY-06)

## Self-Check: PASSED

- FOUND: src/lib/nostr/geo-proposal/storyProposal.test.ts, useStoryProposals.ts, acceptStoryProposal.ts
- FOUND: src/features/social/proposals/StoryProposalsPanel.tsx, StoryProposeEditDialog.tsx
- FOUND commit cbe9917, FOUND commit 1888f7d
