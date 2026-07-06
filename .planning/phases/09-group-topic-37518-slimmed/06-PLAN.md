---
phase: 09-group-topic-37518-slimmed
plan: 06
type: execute
wave: 5
depends_on: ["09-02", "09-03", "09-04", "09-05"]
files_modified:
  - src/components/info-panel/GroupViewPanel.tsx
  - src/components/info-panel/group-lane/ForeignLane.tsx
  - src/components/info-panel/group-lane/CuratedLane.tsx
autonomous: false
requirements: [GROUP-05, GROUP-06, GROUP-07, GROUP-08]
user_setup: []
must_haves:
  truths:
    - "A viewer sees curated/pinned references FIRST (expanded, privileged) and community contributions SECOND (collapsed, subordinate) — never co-equal (D-08)"
    - "Every foreign c coordinate is kind-validated (37515) AND signature-validated AND mute-filtered BEFORE it is rendered — invalid items never paint (GROUP-08)"
    - "The foreign lane is capped at 50, newest-first, with Load more; a schema Group filters off/warn/strict (default strict) with a legible reason on every hidden/flagged item (GROUP-05/D-09)"
    - "A viewer can locally mute a contributor (device-local, app-global) from a per-attachment menu (D-10/D-11/D-12)"
    - "The owner can flip the Group to closed in one click from the view panel (D-02), and pin/bless curated refs (D-03)"
    - "A Group owner can add Markdown narrative (sanitized render) and any user can comment + react on the Group (GROUP-06/GROUP-07)"
  artifacts:
    - path: "src/components/info-panel/GroupViewPanel.tsx"
      provides: "two-lane Group view shell + escape hatch + narrative + comments/react"
      min_lines: 150
      contains: "GroupFactory"
    - path: "src/components/info-panel/group-lane/ForeignLane.tsx"
      provides: "collapsed, capped, validated, mutable community-contributions lane"
      contains: "verifyEvent"
    - path: "src/components/info-panel/group-lane/CuratedLane.tsx"
      provides: "expanded privileged curated a-ref lane + owner bless/pin"
  key_links:
    - from: "src/components/info-panel/group-lane/ForeignLane.tsx"
      to: "nostr-tools verifyEvent"
      via: "per-coordinate signature validation before render"
      pattern: "verifyEvent\\("
    - from: "src/components/info-panel/group-lane/ForeignLane.tsx"
      to: "src/lib/group/filterModes.ts"
      via: "off/warn/strict filter with reason"
      pattern: "filterForeignAttachment|GroupFilterMode"
    - from: "src/components/info-panel/group-lane/ForeignLane.tsx"
      to: "src/lib/mute/useMuteStore.ts"
      via: "local mute drop + per-attachment Mute action"
      pattern: "useMuteStore"
    - from: "src/components/info-panel/GroupViewPanel.tsx"
      to: "src/lib/nostr/group"
      via: "GroupFactory.modify(governance:'closed') escape hatch + referencedAddresses pin"
      pattern: "governance.*closed"
---

<objective>
Build the NO-MOD MINIMUM two-lane Group view — the phase's second security-critical guard — by refactoring `MapContextViewPanel` into `GroupViewPanel`: render the curated `a`-ref lane FIRST (expanded, privileged) and the foreign `c`-lane SECOND (collapsed "Community contributions (N)", subordinate) per D-08; gate EVERY foreign coordinate through kind-validation (37515) + signature-validation (`verifyEvent`) + local-mute BEFORE render (GROUP-08); cap the lane at 50 newest-first with Load more and apply the off/warn/strict filter with legible reasons (GROUP-05/D-09); add the owner-only one-click "Lock down → Closed" escape hatch (D-02) and curated pin/bless (D-03); render the optional Markdown narrative through the sanitized renderer (GROUP-06); and wire comment/react on the Group coordinate (GROUP-07). This is the integration that makes an open Group usable and trustworthy with no moderator.

Purpose: GROUP-08's NO-MOD MINIMUM and the per-coordinate validation guard MUST ship in this phase. This is the largest integration; it consumes the module (02), validation pipeline (03), editor (04), and attach (05).
Output: `GroupViewPanel.tsx` + the two lane sub-components. autonomous:false — ends with a human-verify checkpoint for the full NO-MOD trust posture.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/09-group-topic-37518-slimmed/09-PATTERNS.md
@.planning/phases/09-group-topic-37518-slimmed/09-UI-SPEC.md
@.planning/phases/09-group-topic-37518-slimmed/09-CONTEXT.md
@src/components/info-panel/MapContextViewPanel.tsx
@src/lib/group/filterModes.ts
@src/lib/group/attach.ts
@src/lib/mute/useMuteStore.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: ForeignLane — kind+signature+mute gate, cap/sort, off/warn/strict, mute menu</name>
  <files>src/components/info-panel/group-lane/ForeignLane.tsx</files>
  <read_first>
    - src/components/info-panel/MapContextViewPanel.tsx (the foreign-lane render + Select filter the legacy panel had; EntityActionBar / EntityPanelSurface usage; the deprecated imports lines 6-13 to replace)
    - src/lib/group/filterModes.ts (filterForeignAttachment off/warn/strict + resolveGroupFilterDefault; GroupFilterMode)
    - src/lib/group/attach.ts (attach-discovery filter { '#c':[coord], kinds:[37515] })
    - src/lib/mute/useMuteStore.ts (mute/unmute/isMuted)
    - src/lib/hooks/useGroups.ts (the #c attach subscription pattern — useTimelineWithEose with null-to-skip)
    - src/lib/nostr/kinds.ts (GEO_EVENT_KIND=37515)
    - src/lib/group/noModMinimum.test.ts (Plan 01 RED contract: kind→sig→mute order, cap 50, newest-first)
    - .planning/phases/09-group-topic-37518-slimmed/09-UI-SPEC.md (Interaction Contract 4+5: collapsed Collapsible "Community contributions (N)"; tone="neutral" subordinate; Off/Warn/Strict segmented control default Strict; per-attachment ⋮ dropdown "Mute @{name}"; Load more; reason chips Badge variant="outline"; sig/kind failure = dropped before render no chip)
    - node_modules/nostr-tools (verifyEvent)
  </read_first>
  <behavior>
    - gate order per foreign event: kind!==37515 → drop; !verifyEvent → drop; muted pubkey → drop; (these never paint, no chip).
    - surviving events: cap 50 newest-first; remainder behind Load more.
    - schema Group: apply filterForeignAttachment(mode) — strict hides non-conforming with reason chip; warn shows with amber badge+reason; off shows all.
    - per-attachment ⋮ menu → useMuteStore.mute(pubkey); muted author drops from the lane app-wide.
  </behavior>
  <action>
    Create `src/components/info-panel/group-lane/ForeignLane.tsx`. Subscribe `{ kinds:[GEO_EVENT_KIND], '#c':[groupCoordinate] }` via the `useTimelineWithEose` null-to-skip pattern (only when the Group's governance !== 'closed'). Build the render list with the GROUP-08 gate applied BEFORE render, in this exact order (mirror RESEARCH "Per-coordinate signature + kind validation"): drop `event.kind !== GEO_EVENT_KIND`; drop `!verifyEvent(event)` (nostr-tools — never hand-roll schnorr); drop `useMuteStore.getState().isMuted(event.pubkey)`. Invalid items NEVER enter the list (no chip, no flash). Sort survivors newest-first by `created_at`; cap at 50 with a "Load more" button for the remainder (D-07; trust-sort is recency-only this phase per RESEARCH O-01/A1 — leave a code comment noting follows-boost is the documented follow-up). For a `schema` Group, run `filterForeignAttachment(group, properties, mode)` (off-thread) per surviving item and apply the per-view `mode`: strict → hide + `Badge variant="outline"` reason chip (e.g. "Hidden: missing required `name`"); warn → show + amber badge + reason; off → show all. Default `mode = resolveGroupFilterDefault(governance)` (strict for schema). Render the lane as a COLLAPSED `Collapsible` titled "Community contributions (N)" with `tone="neutral"`, rows at `text-muted-foreground` — visually subordinate to the curated lane (D-08; never a co-equal tab, never an accent). Each row: `EntityActionBar` (Inspect/Zoom) + a `dropdown-menu` ⋮ with "Inspect", "Zoom to", separator, "Mute @{name}" → `useMuteStore.mute(pubkey)` + an undoable `sonner` toast "Muted @{name} everywhere. Undo". Expose the Off/Warn/Strict segmented control (toggle-group/tabs) attached to the lane; the active segment is the only accent here (UI-SPEC). The owner-only "Add to curated" (bless) button on each row is wired in Task 2 via a callback prop.
  </action>
  <verify>
    <automated>bun test src/lib/group/noModMinimum.test.ts && bun run build 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `bun test src/lib/group/noModMinimum.test.ts` GREEN (the gate order, cap, sort the lane implements).
    - `grep -n "verifyEvent" src/components/info-panel/group-lane/ForeignLane.tsx` present; the kind check (`!== GEO_EVENT_KIND`) precedes it (source assertion).
    - `grep -n "useMuteStore" src/components/info-panel/group-lane/ForeignLane.tsx` present — muted authors drop and the ⋮ menu mutes.
    - The lane is a `Collapsible` (collapsed default) with `tone="neutral"` (source assertions); no accent color on the lane chrome and no co-equal tab.
    - The cap is 50 with a Load more remainder (source assertion); sort is newest-first by `created_at`.
    - `grep -c "context/validation" src/components/info-panel/group-lane/ForeignLane.tsx` is 0 — filtering routes through `filterForeignAttachment` (off-thread).
    - `bun run build` green; `biome check src/components/info-panel/group-lane/ForeignLane.tsx` clean.
  </acceptance_criteria>
  <done>The foreign lane validates every coordinate before render, caps/sorts/filters with legible reasons, and supports local mute; NO-MOD test + build green.</done>
</task>

<task type="auto">
  <name>Task 2: GroupViewPanel + CuratedLane — escape hatch, pin/bless, narrative, comment/react</name>
  <files>src/components/info-panel/GroupViewPanel.tsx, src/components/info-panel/group-lane/CuratedLane.tsx</files>
  <read_first>
    - src/components/info-panel/MapContextViewPanel.tsx (the panel being refactored — shell imports lines 1-25; resolveContextReferences/resolveContextMapScope; CommentsPanel; RichContentRenderer; EntityActionBar/ConfirmDeleteAction; the deprecated context/validation + context/scope imports to repoint)
    - src/lib/nostr/group/factory.ts (GroupFactory.modify + group({governance:'closed'}) + referencedAddresses pin; deleteGroup)
    - src/lib/group/attach.ts (curated a-ref lane resolution rewritten from references.ts/scope.ts)
    - src/components/info-panel/group-lane/ForeignLane.tsx (Task 1 — embed it; pass the owner-bless callback)
    - src/features/social/comments (CommentsPanel — GROUP-07 reuse)
    - src/lib/nostr/geo-comment/factory.ts (GeoCommentFactory.root({content},{kind:MAP_CONTEXT_KIND,address,authorPubkey}) — the existing path accepts an arbitrary root kind, so 37518 needs NO K/k widening; full widening stays Phase 13)
    - .planning/phases/09-group-topic-37518-slimmed/09-UI-SPEC.md (Interaction Contract 4+5: curated lane tone="context" expanded privileged "Canonical references" + "Canonical" Badge variant="secondary"; owner "Lock down → Closed" destructive button + alert-dialog confirm copy; "Add curated reference"/"Add to curated" copy; sanitized RichContentRenderer narrative)
    - src/components/ui/alert-dialog.tsx, src/components/ui/collapsible.tsx, src/components/entity-search (EntitySearchPopover for D-03b)
  </read_first>
  <action>
    Create `src/components/info-panel/group-lane/CuratedLane.tsx`: resolve the Group's `a`-refs through the rewritten lane resolver (`@/lib/group/attach`, formerly `references.ts`/`scope.ts`) and render them FIRST as the privileged lane — `EntityPanelSurface tone="context"` (amber), `EntityPanelSectionHeader` "Canonical references", full-strength `text-foreground` rows, each an `EntityActionBar` (Inspect/Zoom) with a "Canonical" `Badge variant="secondary"`, expanded by default. Empty-state copy: "No canonical references yet" / "The owner hasn't pinned any references. Conforming community contributions appear below." For the owner: an "Add curated reference" search picker (reuse `EntitySearchPopover`, D-03b) that appends a coordinate to the Group's `a` refs via `GroupFactory.modify(group).referencedAddresses([...existing, coord]).sign().publish` — and accept a `blessFromForeign(coord)` callback (D-03a, "Add to curated") that does the same append from a foreign-lane row.

    Refactor `MapContextViewPanel` → `src/components/info-panel/GroupViewPanel.tsx`. Replace the deprecated imports (`MapContextViewPanel.tsx:6-13`: `resolveContextReferences`/`resolveContextMapScope`/`getEffectiveContextUse`/`getEffectiveContextValidationMode`/`validateDatasetForContext`) with `@/lib/group/attach` + `@/lib/group/filterModes`, and `MapContext` → `Group`. Compose: `<CuratedLane>` first, then `<ForeignLane>` (Task 1), in that visual order ("canon first, contributions second" — D-08). Render the optional Markdown `description` narrative through the existing sanitized `RichContentRenderer` (GROUP-06 — no raw HTML, XSS posture). Owner-only "Lock down → Closed" button (D-02) in the panel header area, destructive-toned, opening an `alert-dialog` with the exact UI-SPEC confirm copy ("Lock this Group down?" … confirm "Lock down" / cancel "Keep open"); on confirm `GroupFactory.modify(group).group({ governance:'closed' }).sign(account)` → `publish`. Keep `ConfirmDeleteAction` (delete Group via `deleteGroup`). Mount `CommentsPanel` for GROUP-07 against the Group coordinate; wire react (kind 7) through the existing geo-reactions path — the comment factory's `root({content},{kind: MAP_CONTEXT_KIND, address: groupCoordinate, authorPubkey: group.pubkey})` accepts kind 37518 directly (Open Question 3 resolved: existing path takes an arbitrary root kind; full K/k widening across all kinds stays Phase 13 — note this in the SUMMARY). Repoint any remaining `@/lib/nostr/map-context` import sites that referenced this panel to `@/lib/nostr/group`.

    After all consumers (this plan + 04 + 05) are repointed, the legacy `map-context/` module and its `context/{scope,references,validation,displayOrdering}.ts` consumers are superseded — confirm no runtime import path still resolves to them for the Group surface (grep), and either delete the now-orphaned `map-context/` files or record them as a documented cleanup in the SUMMARY if any non-Group caller remains.
  </action>
  <verify>
    <automated>bun run build 2>&1 | tail -5 && bun test src/lib/nostr/group src/lib/group</automated>
  </verify>
  <acceptance_criteria>
    - `bun run build` succeeds; `GroupViewPanel.tsx` renders CuratedLane THEN ForeignLane (source assertion: CuratedLane appears before ForeignLane in JSX order).
    - `grep -n "governance.*'closed'\\|governance: 'closed'" src/components/info-panel/GroupViewPanel.tsx` present in the escape-hatch handler; it uses `GroupFactory.modify` (preserves d) — source assertion.
    - The curated lane uses `tone="context"` + `Badge variant="secondary"` "Canonical"; the foreign lane (Task 1) is `tone="neutral"` collapsed — the two-lane hierarchy is encoded (source assertions).
    - `grep -c "validateDatasetForContext\\|getEffectiveContextValidationMode\\|resolveContextMapScope" src/components/info-panel/GroupViewPanel.tsx` is 0 — deprecated imports repointed.
    - The narrative renders via `RichContentRenderer` (sanitized — no `dangerouslySetInnerHTML`): `grep -c "dangerouslySetInnerHTML" src/components/info-panel/GroupViewPanel.tsx` is 0.
    - `CommentsPanel` is mounted for the Group (GROUP-07); the comment root passes `kind: MAP_CONTEXT_KIND` (source assertion).
    - `bun test src/lib/nostr/group src/lib/group` GREEN; `biome check src/components/info-panel/GroupViewPanel.tsx src/components/info-panel/group-lane` clean.
  </acceptance_criteria>
  <done>The view renders curated-first/foreign-second with the escape hatch, pin/bless, sanitized narrative, and comment/react; build + group suite green; deprecated context imports repointed.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>The full NO-MOD MINIMUM Group view: curated references shown first (expanded, amber, privileged) and community contributions second (collapsed, grey, capped 50 + Load more, newest-first); every foreign attachment kind+signature+mute validated before it ever paints; a per-view Off/Warn/Strict filter (default Strict) with legible reason chips; a per-attachment ⋮ "Mute @name" (device-local, app-global) with undo toast; an owner-only one-click "Lock down → Closed" escape hatch with confirm; owner pin/bless of curated refs; a sanitized Markdown narrative; and comment + react on the Group.</what-built>
  <how-to-verify>
    1. `bun dev` + `bun relay`. Open a Schema Group that has at least one curated ref and several `c`-attached datasets (use Plan 05's attach flow + a second key to attach datasets you do NOT own).
    2. Confirm layout: "Canonical references" is at the top, expanded, amber-toned; "Community contributions (N)" is below, collapsed, grey. They are NOT co-equal tabs.
    3. Expand the foreign lane. Confirm only valid 37515 datasets appear; the count and Load more behave with >50 attachments (seed enough or trust the cap). Confirm newest-first order.
    4. Toggle the filter Off/Warn/Strict: Strict hides non-conforming (with a reason chip when you switch to Warn); Warn shows them with an amber badge + reason; Off shows everything. Confirm "Nothing matches the rules" empty-state copy when Strict hides all.
    5. On a foreign row, open ⋮ → "Mute @name". Confirm the row disappears immediately, the undo toast shows, and the same author is muted elsewhere in the app (app-global). Undo restores.
    6. As the owner: click "Lock down → Closed", confirm the alert-dialog copy, confirm → the foreign lane disappears and only curated refs remain. Reopen by editing.
    7. As the owner: "Add to curated" on a foreign row (bless) and "Add curated reference" via search — both land in the curated lane.
    8. Confirm the Markdown narrative renders (no raw HTML), and that you can comment on and react to the Group.
  </how-to-verify>
  <resume-signal>Type "approved" or describe what looked wrong (lane hierarchy, any unvalidated/forged coordinate that painted, filter/reason behavior, mute scope, escape hatch, bless/pin, narrative, comment/react).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| relay → viewer (foreign c coordinate) | Each `c`-attached event is untrusted: wrong-kind, forged-signature, or spam — gated before render |
| relay → viewer (untrusted schema) | The Group schema validating foreign attachments is stranger-authored — off-thread only |
| owner action → published event | Escape-hatch flip-to-closed + curated pins republish the signed 37518 |
| Markdown narrative → DOM | Owner/relay-authored Markdown rendered into the viewer's DOM |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-06-FORGED-COORD | Spoofing | ForeignLane render gate | mitigate | Every `c` coordinate is kind-validated (37515) AND `verifyEvent`-validated BEFORE render; a forged/unsigned or kind-confused event is dropped and never paints (GROUP-08, HIGH-severity phase guard) |
| T-09-06-DOS-SCHEMA | Denial of Service | ForeignLane schema filter | mitigate | Read-side filtering routes through the off-thread `filterForeignAttachment`/`validateSchema` (timeout-kill/caps/fail-closed); a malicious Group schema cannot freeze the viewer's tab (HIGH-severity phase guard) |
| T-09-06-SPAM-FLOOD | Denial of Service (UX) | NO-MOD lane | mitigate | Curated-default privileged lane; foreign lane collapsed/opt-in/capped(50)/newest-first; local mute drops a contributor app-wide; owner one-click flip-to-closed — an open Group stays usable without a moderator (GROUP-08) |
| T-09-06-HASH-DIVERGE | Tampering | schema-hash verify in filter | mitigate | `verifySchemaHash` (Plan 03) runs before validating; mismatch → "Schema could not be verified" warn, never silent divergent strict-hide (Pitfall 3) |
| T-09-06-XSS-NARRATIVE | Tampering/Elevation | Markdown narrative | mitigate | Rendered through the existing sanitized `RichContentRenderer`; no `dangerouslySetInnerHTML`, no raw HTML (grep-asserted) |
| T-09-06-LINEAGE | Tampering | escape hatch / pin republish | mitigate | `GroupFactory.modify` preserves `d` so flip-to-closed and curated pins don't fork the entity (comments/reactions stay attached) |
| T-09-SC | Tampering | shadcn block installs | mitigate | UI-SPEC Registry Safety: official shadcn blocks only (collapsible/alert-dialog/dropdown-menu/badge already present); zero `@mapcn`; no new install |
</threat_model>

<verification>
- `bun test src/lib/nostr/group src/lib/group src/lib/mute` GREEN (full Group suite, including noModMinimum); `bun run build` green; `biome check src/components/info-panel/GroupViewPanel.tsx src/components/info-panel/group-lane` clean.
- `bun test` full suite green (no regression; the Phase-8 615-pass baseline plus all new Group tests).
- Human-verify checkpoint: the full NO-MOD trust posture (curated-first, pre-render validation, filter/reason, mute scope, escape hatch, pin/bless, narrative, comment/react) confirmed.
</verification>

<success_criteria>
- GROUP-08 NO-MOD MINIMUM ships: curated-default privileged lane, validated/capped/sorted/collapsed foreign lane, local app-global mute, one-click owner flip-to-closed.
- GROUP-05 filter-on-fetch off/warn/strict (default strict) with legible reasons; GROUP-06 narrative + curated pin/bless; GROUP-07 comment/react on the Group.
- Every foreign coordinate is signature+kind validated before render; read-side schema validation is off-thread; the entity never forks on owner edits.
</success_criteria>

<output>
Create `.planning/phases/09-group-topic-37518-slimmed/09-06-SUMMARY.md` when done.
</output>
