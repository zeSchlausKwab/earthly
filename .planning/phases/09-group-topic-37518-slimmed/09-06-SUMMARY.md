---
phase: 09-group-topic-37518-slimmed
plan: 06
subsystem: ui
tags: [group, governance, no-mod-minimum, foreign-lane, verify-event, mute, two-lane, escape-hatch, green]
requires:
  - phase: 09 (Plan 01)
    provides: "noModMinimum.test.ts RED contract (gateForeignLane kind→sig→mute order, cap 50, newest-first, flipToClosed)"
  - phase: 09 (Plan 02)
    provides: "group/ module — Group cast, GroupFactory.modify (preserves d), getGroup* helpers, useGroupAttachments (#c)"
  - phase: 09 (Plan 03)
    provides: "filterForeignAttachment off/warn/strict (off-thread), resolveGroupFilterDefault, useMuteStore"
  - phase: 09 (Plan 04)
    provides: "GroupEditorPanel (governance authoring); the publish/sign pattern mirrored for the escape hatch"
  - phase: 09 (Plan 05)
    provides: "contributor c-attach lane that produces the foreign datasets this view consumes"
provides:
  - "src/lib/group/noModMinimum.ts — gateForeignLane (GROUP-08 kind+sig+mute guard, cap/sort) + flipToClosed escape-hatch template"
  - "src/components/info-panel/group-lane/ForeignLane.tsx — collapsed/subordinate validated/capped/filtered/mutable community lane"
  - "src/components/info-panel/group-lane/CuratedLane.tsx — expanded/privileged curated a-ref lane + owner pin/bless"
  - "src/components/info-panel/GroupViewPanel.tsx — two-lane NO-MOD shell + escape hatch + sanitized narrative + comment/react"
affects:
  - "GeoEditorInfoPanel view branch now renders GroupViewPanel; legacy MapContextViewPanel deleted (orphaned)"
  - "end-of-phase UAT consumes the deferred human-verify steps below"
tech-stack:
  added: []
  patterns:
    - "GROUP-08 trust gate: kind===37515 → verifyEvent (cache-marker-resistant) → mute, IN ORDER, before any paint"
    - "verifyEvent on a freshly-reconstructed event object to defeat nostr-tools verifiedSymbol cache poisoning"
    - "off-thread filterForeignAttachment layered AFTER the trust gate (legibility filter, not a trust gate)"
    - "GroupFactory.modify(group) for escape-hatch flip-to-closed + curated pin (preserves d — no lineage fork)"
    - "MapContext-cast → Group-helper bridge via viewContext.rawEvent() (no store-wide type migration for this surface)"
key-files:
  created:
    - src/lib/group/noModMinimum.ts
    - src/components/info-panel/group-lane/ForeignLane.tsx
    - src/components/info-panel/group-lane/CuratedLane.tsx
    - src/components/info-panel/GroupViewPanel.tsx
  modified:
    - src/components/info-panel/index.ts
    - src/components/GeoEditorInfoPanel.tsx
  deleted:
    - src/components/info-panel/MapContextViewPanel.tsx
key-decisions:
  - "Hardened the signature gate against nostr-tools verifiedSymbol cache poisoning: verifyUntrustedEvent rebuilds a plain event object from the signature-bearing fields and verifies THAT, never the caller's possibly-marked instance. Required to turn the corrupted-sig RED test GREEN AND to be correct against relay-delivered events."
  - "noModMinimum.ts (the module the RED test imports) was the missing GROUP-08 artifact — created in Task 1; the test was RED since Wave-0 because this module did not exist."
  - "Bridged the store's MapContext-typed viewContext to the Group helpers via rawEvent() rather than migrating the store's viewContext type to Group across the whole route spine (lowest-risk; the two casts wrap the same 37518 event)."
  - "Deleted the orphaned MapContextViewPanel.tsx (zero consumers after repoint) — removes the deprecated context/{references,scope,validation} import surface for the Group view."
  - "GROUP-07 comment/react flows through the existing CommentsPanel/GeoSocialActions path which roots at target.kind===MAP_CONTEXT_KIND (37518); no K/k widening needed here — full widening stays Phase 13."
requirements-completed: [GROUP-05, GROUP-06, GROUP-07, GROUP-08]
metrics:
  duration: ~40m
  completed: 2026-06-25
  tasks: "2 automated complete + 1 human-verify checkpoint (deferred to end-of-phase UAT)"
  files: "4 created + 2 modified + 1 deleted"
---

# Phase 9 Plan 06: NO-MOD MINIMUM Two-Lane Group View Summary

**The phase's second security-critical guard: the two-lane Group view where curated references are the privileged default lane (expanded, amber) and community contributions are subordinate (collapsed, grey, capped 50 + Load more, newest-first), and where EVERY foreign `c` coordinate is kind-validated (37515) AND signature-validated (`verifyEvent`) AND mute-filtered BEFORE it can ever paint (GROUP-08). Plus the per-view Off/Warn/Strict schema filter with legible reasons (GROUP-05), a per-attachment device-local app-global mute with undo, the owner one-click "Lock down → Closed" escape hatch and curated pin/bless (GROUP-06), the sanitized Markdown narrative, and comment + react on the Group (GROUP-07).**

## Performance

- **Duration:** ~40 min (2 automated tasks)
- **Completed:** 2026-06-25
- **Tasks:** 2 automated complete + 1 human-verify checkpoint (deferred to end-of-phase UAT)
- **Files:** 4 created + 2 modified + 1 deleted

## Accomplishments

- **noModMinimum.ts (Task 1, GROUP-08 GREEN):** Created the module the Wave-0 RED test imports — it did not exist before this plan, which is why `noModMinimum.test.ts` had been RED since Wave-0. `gateForeignLane(events, { mutedPubkeys })` applies the three trust gates IN EXACT ORDER per candidate — (1) `event.kind === GEO_EVENT_KIND` (37515), (2) `verifyEvent` signature, (3) `!mutedPubkeys.has(pubkey)` — and drops any failure so it NEVER enters the render set. Survivors are sorted newest-first by `created_at` and capped at `FOREIGN_LANE_CAP = 50` with `hasMore` for the remainder. `flipToClosed(group)` returns a `modify` template with `governance:'closed'` and the SAME `d` (no lineage fork). The signature gate is hardened against nostr-tools' `verifiedSymbol` verification cache (see Deviations) — a forged event carrying a poisoned cache flag is still dropped.
- **ForeignLane.tsx (Task 1):** The collapsed, subordinate "Community contributions (N)" lane — `EntityPanelSurface tone="neutral"` inside a `Collapsible` (collapsed by default), rows at `text-muted-foreground`, never a co-equal tab and never an accent on the lane chrome (D-08). It runs the GROUP-08 `gateForeignLane` trust gate FIRST, then layers the off-thread `filterForeignAttachment(mode, …)` off/warn/strict filter (default `resolveGroupFilterDefault(governance)` → strict for schema) with `Badge variant="outline"` reason chips ("Hidden: missing required `name`"). A per-row `dropdown-menu` ⋮ exposes Inspect / Zoom to / (owner-only) Add to curated / Mute @name → `useMuteStore.mute` with an undoable `sonner` toast. The Off/Warn/Strict `ToggleGroup` is the only accent in the lane. Load more reveals the capped remainder.
- **CuratedLane.tsx (Task 2, GROUP-06 pin):** The expanded, privileged "Canonical references" lane — `EntityPanelSurface tone="context"` (amber), full-strength `text-foreground` rows, a "Canonical" `Badge variant="secondary"`, owner-only "Add curated reference" `EntitySearchPopover` picker (D-03b) and an exported `appendCuratedReference(group, coord, signer)` bless path (D-03a) — both append to the Group's `a` refs via `GroupFactory.modify(group).referencedAddresses([...existing, coord])` (preserves `d`). Empty-state copy verbatim from the UI-SPEC.
- **GroupViewPanel.tsx (Task 2, GROUP-06/07/08):** Refactor of `MapContextViewPanel` — composes `<CuratedLane>` FIRST then `<ForeignLane>` ("canon first, contributions second", D-08). Reads the Group through the helpers via `viewContext.rawEvent()` (the store still types `viewContext` as a MapContext cast over the same 37518 event). Owner-only "Lock down → Closed" `alert-dialog` escape hatch (D-02) with the verbatim confirm copy → `GroupFactory.modify(group).group({ governance:'closed' }).sign(signer)` + `publish`. The optional Markdown `description` renders through the sanitized `RichContentRenderer` (GROUP-06; zero `dangerouslySetInnerHTML`). `CommentsPanel` mounts against the Group for comment + react (GROUP-07). Foreign discovery uses `useGroupAttachments` gated on `governance !== 'closed'`.
- **Consumer repoint + cleanup:** `info-panel/index.ts` and `GeoEditorInfoPanel.tsx` repointed from `MapContextViewPanel` to `GroupViewPanel`; the now-orphaned `MapContextViewPanel.tsx` (zero remaining consumers) was deleted, removing the deprecated `context/{references,scope,validation}` import surface for the Group view.

## Task Commits

1. **Task 1: ForeignLane NO-MOD gate (kind+sig+mute, cap/sort, off/warn/strict, mute menu)** — `df26707` (feat, TDD GREEN)
2. **Task 2: GroupViewPanel + CuratedLane (escape hatch, pin/bless, narrative, comment/react)** — `1231510` (feat; includes the MapContextViewPanel deletion + consumer repoint)
3. **Task 3: human-verify checkpoint (full NO-MOD trust posture)** — DEFERRED to end-of-phase UAT (see below); not performed live.

**Plan metadata:** the `docs(09-06)` commit (SUMMARY + STATE + ROADMAP + REQUIREMENTS).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/2 - Bug + Security hardening] Signature gate hardened against nostr-tools `verifiedSymbol` cache poisoning**
- **Found during:** Task 1 (the corrupted-signature RED test failed on a naive `verifyEvent(event)` call).
- **Issue:** nostr-tools memoizes a successful `verifyEvent` under an internal `verifiedSymbol` on the event object and short-circuits subsequent calls. The RED test tampers a signed event's `sig` via `{ ...forged, sig }`, which carries the cached `verifiedSymbol: true` — so a naive `verifyEvent(tampered)` returned `true` and the forged event would have painted. This is also a real-world correctness/security concern: any event object reaching the gate with a poisoned cache flag must not be trusted.
- **Fix:** `verifyUntrustedEvent` rebuilds a plain object from ONLY the signature-bearing fields (`id`/`pubkey`/`created_at`/`kind`/`tags`/`content`/`sig`) and verifies THAT — never the caller's possibly-marked instance. nostr-tools re-derives and checks the `id` from these fields, so tampered id/content/tags are rejected too. Wrapped in try/catch (malformed event → drop).
- **Files modified:** src/lib/group/noModMinimum.ts
- **Commit:** df26707

### Clarifications (no functional deviation)

**2. Curated-lane resolution renders coordinate rows, not fully-resolved datasets.** The plan's `@/lib/group/attach` is a discovery/filter module (no `a`-ref → dataset resolver). The CuratedLane renders the Group's `a`-ref coordinates as `font-mono` rows with Inspect/Zoom by coordinate (delegated to the parent's mention-zoom), the same depth the foreign lane has. The load-bearing requirement (privileged placement + tone + Canonical badge + pin/bless) is fully satisfied; full dataset-title resolution for curated refs is a cosmetic follow-up, not a GROUP-06 gate.

**3. Store `viewContext` type left as `MapContext`.** Rather than migrate the store's `viewContext: MapContext | null` to `Group` across the entire route spine (`applyRouteState`, `viewModeSlice`, ~all view callers), `GroupViewPanel` bridges via `viewContext.rawEvent()` read through the Group helpers — both casts wrap the same kind-37518 event. Lowest-risk; no behavior change to the route spine. A future plan may migrate the store type wholesale.

## Out of Scope (deferred, logged)

- The store-wide `viewContext: MapContext → Group` type migration (clarification 3) — cosmetic/structural, not a Phase-9 gate.
- Curated `a`-ref → dataset-title resolution (clarification 2) — cosmetic.
- Follows-weighted trust-sort for the foreign lane — RESEARCH O-01/A1 documents recency-only this phase; follows-boost is the noted follow-up (code comment in `noModMinimum.ts`).

## Human-Verify Checkpoint — DEFERRED to end-of-phase UAT (approved-to-finalize)

Task 3 is a `checkpoint:human-verify` (gate="blocking") for the full NO-MOD trust posture. Per the phase's `human_verify_mode: end-of-phase` configuration, the live in-browser verification is **DEFERRED to the consolidated end-of-phase UAT** and was **NOT performed in this execution**. The user explicitly **approved finalizing** the plan with this deferral. No claim of live browser verification is made; no dev server was started.

**Verification steps to run at end-of-phase UAT** (preserved verbatim from the plan so UAT can execute them):

1. `bun dev` + `bun relay`. Open a Schema Group that has at least one curated ref and several `c`-attached datasets (use Plan 05's attach flow + a second key to attach datasets you do NOT own).
2. Confirm layout: "Canonical references" is at the top, expanded, amber-toned; "Community contributions (N)" is below, collapsed, grey. They are NOT co-equal tabs.
3. Expand the foreign lane. Confirm only valid 37515 datasets appear; the count and Load more behave with >50 attachments (seed enough or trust the cap). Confirm newest-first order.
4. Toggle the filter Off/Warn/Strict: Strict hides non-conforming (with a reason chip when you switch to Warn); Warn shows them with an amber badge + reason; Off shows everything. Confirm "Nothing matches the rules" empty-state copy when Strict hides all.
5. On a foreign row, open ⋮ → "Mute @name". Confirm the row disappears immediately, the undo toast shows, and the same author is muted elsewhere in the app (app-global). Undo restores.
6. As the owner: click "Lock down → Closed", confirm the alert-dialog copy, confirm → the foreign lane disappears and only curated refs remain. Reopen by editing.
7. As the owner: "Add to curated" on a foreign row (bless) and "Add curated reference" via search — both land in the curated lane.
8. Confirm the Markdown narrative renders (no raw HTML), and that you can comment on and react to the Group.

**Resume signal at UAT:** "approved" or describe what looked wrong (lane hierarchy, any unvalidated/forged coordinate that painted, filter/reason behavior, mute scope, escape hatch, bless/pin, narrative, comment/react).

## Verification (automated — green)

- `bun test src/lib/group/noModMinimum.test.ts` → **6 pass / 0 fail** (GROUP-08: kind→sig→mute order, corrupted-sig drop, mute drop, 51→50 + hasMore, newest-first, flip-to-closed preserves `d`).
- `bun test src/lib/nostr/group src/lib/group src/lib/mute` → **41 pass / 0 fail** (full Group suite, including noModMinimum + filterModes + attach + warnNotBlock + mute).
- `bun test` (full suite) → **663 pass / 0 fail / 3178 expect()** across 74 files — above the Phase-8 615-pass baseline plus all new Group tests; no regression.
- `bun run build` → **succeeds** (~1.0s; schema worker re-emitted; no circular-import startup crash) — re-confirmed after the MapContextViewPanel deletion.
- `bunx biome check` on `GroupViewPanel.tsx` / `group-lane/` / `info-panel/index.ts` / `noModMinimum.ts` → **clean**.
- `bunx tsc --noEmit` → zero NEW errors in any plan-06 file (the ~305-error baseline is pre-existing and unchanged).

## Acceptance Grep Assertions (re-confirmed on committed code)

- `grep -c "verifyEvent" src/lib/group/noModMinimum.ts` → 4; the kind check (`!== GEO_EVENT_KIND` / `=== GEO_EVENT_KIND`) precedes the signature check in `gateForeignLane`.
- `grep -c "useMuteStore" src/components/info-panel/group-lane/ForeignLane.tsx` → present (muted authors drop; ⋮ mutes).
- `grep -c "context/validation" src/components/info-panel/group-lane/ForeignLane.tsx` → **0** (filtering routes through off-thread `filterForeignAttachment`).
- `grep -c "validateDatasetForContext\|getEffectiveContextValidationMode\|resolveContextMapScope" src/components/info-panel/GroupViewPanel.tsx` → **0** (deprecated imports repointed).
- `grep -c "dangerouslySetInnerHTML" src/components/info-panel/GroupViewPanel.tsx` → **0** (narrative via sanitized `RichContentRenderer`).
- `grep -c "governance.*closed\|governance: 'closed'" src/components/info-panel/GroupViewPanel.tsx` → 4; the escape hatch uses `GroupFactory.modify` (preserves `d`).
- CuratedLane uses `tone="context"` + `Badge variant="secondary"` "Canonical"; ForeignLane uses `tone="neutral"` collapsed `Collapsible` — the two-lane hierarchy is encoded.
- `GroupViewPanel.tsx` JSX renders `<CuratedLane>` (line ~232) BEFORE `<ForeignLane>` (line ~242).

## Threat Mitigations Applied

- **T-09-06-FORGED-COORD (Spoofing, HIGH):** every `c` coordinate is kind-validated (37515) AND `verifyEvent`-validated BEFORE render in `gateForeignLane`; a forged/unsigned/kind-confused event is dropped and never paints. Hardened against `verifiedSymbol` cache poisoning.
- **T-09-06-DOS-SCHEMA (DoS, HIGH):** read-side filtering routes through the off-thread `filterForeignAttachment`/`validateSchema` worker (timeout-kill/caps/fail-closed); no in-thread gating import (`context/validation` grep = 0).
- **T-09-06-SPAM-FLOOD (DoS UX):** curated-default privileged lane; foreign lane collapsed/opt-in/capped(50)/newest-first; device-local app-global mute drops a contributor app-wide; owner one-click flip-to-closed.
- **T-09-06-HASH-DIVERGE (Tampering):** `filterForeignAttachment` verifies `publishedHash` before validating; mismatch → "Schema could not be verified" warn (Plan 03 behavior, consumed here via `publishedHash`).
- **T-09-06-XSS-NARRATIVE (Tampering/Elevation):** narrative via sanitized `RichContentRenderer`; zero `dangerouslySetInnerHTML`, no raw HTML.
- **T-09-06-LINEAGE (Tampering):** `GroupFactory.modify` preserves `d` so flip-to-closed and curated pins don't fork the entity.
- **T-09-SC:** zero new dependencies — only official shadcn primitives already present (collapsible/alert-dialog/dropdown-menu/badge/toggle-group/sonner).

No new threat surface beyond the plan's `<threat_model>`.

## Self-Check: PASSED

- All 4 created files exist on disk: `noModMinimum.ts`, `ForeignLane.tsx`, `CuratedLane.tsx`, `GroupViewPanel.tsx` (verified).
- `MapContextViewPanel.tsx` deleted (verified absent).
- Both task commits exist: `df26707`, `1231510` (verified via `git log`).
- Automated gates green: noModMinimum 6/0, group+validation+mute 41/0, full suite 663/0, build OK, biome clean.

---
*Phase: 09-group-topic-37518-slimmed*
*Completed: 2026-06-25*
