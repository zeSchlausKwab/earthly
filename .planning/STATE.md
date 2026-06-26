---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Geo Entity Model Split
status: planning
stopped_at: Phase 10 context gathered
last_updated: "2026-06-26T16:02:35.379Z"
last_activity: "2026-06-26 — Phase 9 complete: UAT 3/3 pass, security SECURED (threats_open:0), worker-guard hardening merged"
progress:
  total_phases: 6
  completed_phases: 2
  total_plans: 11
  completed_plans: 11
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-23 after v1.1 milestone)

**Core value:** The maintainer (and any user) can open the app for fun, not duty.
**Current focus:** Phase 10 — Story / Article (~37520)

## Current Position

Phase: 10
Plan: Not started
Status: Ready to plan Phase 10 (Story / Article). Phase 9 complete — UAT 3/3 + SECURED.
Last activity: 2026-06-26 — Phase 9 complete: UAT 3/3 pass, security SECURED (threats_open:0), worker-guard hardening merged

Progress: [███░░░░░░░] 33% (v1.2 — 2/6 phases)

## Roadmap (v1.2 — Phases 8–13)

Phase numbering continues from v1.1 (ended at Phase 07). Dependency spine: Foundation blocks everything → Group first → Story / Sighting / Beacon → Cross-cutting.

| Phase | Name | Requirements | Research |
|-------|------|--------------|----------|
| 8 | Spec v2 + Foundation | SPEC-01..05, TAX-01 | SKIP |
| 9 | Group / Topic (37518 slimmed) | GROUP-01..08 | NEEDS (governance shape, schema UI, lane cap, NO-MOD UX) |
| 10 | Story / Article (~37520) | STORY-01..06 | SKIP |
| 11 | Temporal Sighting | SIGHT-01..04 | NEEDS (dedicated kind vs 37515+property — LEFT OPEN) |
| 12 | Live Beacon (~37521) | BEACON-01..04 | NEEDS (replaceable+NIP-40 vs ephemeral lifecycle — LEFT OPEN) |
| 13 | Cross-Cutting | XCUT-01, XCUT-02 | SKIP |

## Performance Metrics

**Velocity (v1.1 — shipped):**

- Total plans completed (v1.1): 33
- v1.2 plans completed: 0

**By Phase (v1.2):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 8 | TBD | - | - |
| 9 | 6 | - | - |
| 10 | TBD | - | - |
| 11 | TBD | - | - |
| 12 | TBD | - | - |
| 13 | TBD | - | - |
| 08 | 5 | - | - |

*Updated after each plan completion*
| Phase 08 P01 | 9min | 2 tasks | 7 files |
| Phase 08 P02 | 11min | 2 tasks | 7 files |
| Phase 08 P03 | 18min | 2 tasks | 3 files |
| Phase 08 P04 | 7min | 2 tasks | 14 files |
| Phase 09 P01 | 12m | 2 tasks | 9 files |
| Phase 09 P02 | 9m | 2 tasks | 7 files |
| Phase 09 P03 | ~22m | 2 tasks | 7 files |
| Phase 09 P04 | ~20m | 2 tasks (+1 deferred checkpoint) | 4 files |
| Phase 09 P05 | ~35m | 2 tasks (+1 deferred checkpoint) | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap v1.2]: Foundation (Phase 8) is built first and blocks every entity phase — kind constants, shared `tags.ts`, the off-thread schema-validation worker, the in-content version discriminator + legacy-37518 defensive skip, the shared NIP-40 expiry filter, and the NIP-32 `L`/`l` helper. No per-kind phase ships with copy-paste or an unguarded validator.
- [Roadmap v1.2]: TAX-01 lives in Foundation (Phase 8) — the NIP-32 `L`/`l` paired-emit helper is the canonical home; Phase 9 (Group) consumes it for schema-enforced allowed-`l`-value sets.
- [Roadmap v1.2]: Group (Phase 9) is the first entity — ~90% rename of `map-context/`, exercises every shared seam and the two highest-severity pitfalls. NO-MOD MINIMUM (GROUP-08) + off-thread schema validation (SPEC-04, consumed) MUST ship in the same phase as foreign `c`-attach, never after.
- [Roadmap v1.2]: Story / Sighting / Beacon are independent once Foundation lands; sequenced after Group. Beacon is last among kinds (only net-new live-map-render + most privacy surface).
- [Roadmap v1.2]: Two phase-level decisions LEFT OPEN as research flags — Beacon lifecycle (parameterized-replaceable + NIP-40 vs ephemeral) in Phase 12; Sighting representation (dedicated kind vs 37515 + property + NIP-40) in Phase 11. Do NOT pre-decide; resolve in phase planning/research.
- [Roadmap v1.2]: Amend, don't replace — `group/` refactors `map-context/`; dataset (37515) and proposal (37519) stay untouched; 37519 gets only a small Markdown-target extension for STORY-06. Clean break on legacy 37518 data (SPEC-03 = defensive skip, not migration).
- [Phase ?]: [08-01]: Nyquist Wave-0 RED baseline pins exact foundation-seam symbol names (tags/modelVersion/expiry/schemaWorker + 3 per-kind barrels) before Plans 02-04 implement them
- [08-02]: Shared tags.ts seam (bbox/g/t/c/a read+write) extracted; geo-event + map-context read getters now delegate (copy-paste removed). MODEL_VERSION='earthly/2' chosen. setLabels throws on t/l overlap (TAX-01); setHashtags strips l-governed values. Write setters live in tags.ts as pure transformers but shipped factories left on their inline setters (tight diff) — new kinds in Plan 04 consume the transformers.
- [08-03]: Off-thread schema-validation worker (SPEC-04) shipped — rejectUnsafeSchema gate ($ref/$dynamicRef + 64KB/depth-12/4096-keyword caps) runs BEFORE ajv.compile; Ajv2020 with $data OFF; compile-once-per-schemaHash cache; fail-closed on every throw; host watchdog (100ms+500ms) terminate-on-overrun; sync pure-engine fallback. Fallback discriminator widened to hasSpawnableWorker() (Worker + http(s) origin) because bun test defines a Worker global it can't serve — typeof-Worker alone left the GREEN unreachable. Registered in workerAssets.ts; bun run build emits dist/workers/schema.worker.js (anti-fail-open). NO Group wiring (Phase 9 consumes validateSchema()).
- [08-04]: Article (37520), Live Beacon (37521), Temporal Sighting (37522) Factory+Cast scaffolds landed (SPEC-02/03). Each is<Entity>() guard = kind + d + hasCurrentModelVersion (no-throw); create() injects MODEL_VERSION + generates d only if absent; modify() preserves d. Tag reads/writes delegate to tags.ts (no copy-paste). Introduced shared EntityFactory base (src/lib/nostr/entityFactory.ts) so create/modify d-lineage + a sign() that accepts a bare sign-function (the Wave-0 test contract, since applesauce sign() needs an EventSigner) are written once. LiveBeacon AND TemporalSighting casts expose NIP-40 expiresAt. Three barrels wired into src/lib/nostr/index.ts. Full Wave-0 baseline now GREEN: 607 pass / 0 fail.
- [08-05]: SPEC.md rewritten IN PLACE to v2 (SPEC-01) — split entity model with final kind block (37515 Dataset / 37517 Comment / 37518 slimmed Group / 37519 Proposal / 37520 Story / 37521 Live Beacon / 37522 Temporal Sighting / 34444 Map Layer); modelVersion='earthly/2' clean break (absence/mismatch => legacy/inert/skipped); three-way disjoint L/l·t·c taxonomy split + flat earthly namespace (with reverse-DNS tradeoff note) + FEATURE_CATEGORY_VOCAB; schema governance dialect (draft-2020-12, no $data, no external $ref, 64KB/depth-12/4096 caps); NIP-40 advisory client-always-filters. spec.doc.test.ts pins those strings against the doc on disk (RED on v1, GREEN on v2, mitigates doc-drift T-08-01-DOC). Suite 615 pass / 0 fail; build green; biome clean. Phase 08 COMPLETE (5/5). NOTE: gsd-tools not on PATH — STATE/ROADMAP updated manually.
- [Phase ?]: D-06 pinned to EXTEND-worker (option a): off-thread verdict carries structured errors[] (schemaErrors.test.ts is the contract)
- [09-04]: Group authoring panel shipped — MapContextEditorPanel refactored in place into src/features/groups/GroupEditorPanel.tsx (D-01): the contextUse/validationMode/allowForeignAttachments triad replaced by a single-column RadioGroup of 3 governance Cards (open/schema/closed) with verbatim UI-SPEC copy + accent-reserved selected ring. schemaBuilder.ts extracted as a pure (React-free) compileBuilderSchema(rows, geometry)→draft-2020-12 module shared by the visual Builder tab and the Advanced raw-JSON tab — both feed the SAME Phase-8 off-thread validateSchema worker (no in-thread compile). Schema section governance-gated (governance==='schema'); leaving schema strips geometryConstraints/schema (O-02). Write path: compile→computeSchemaHash→GroupFactory.create/modify (d-tag preserved on edit). Legacy unlabeled-checkbox a11y bug fixed (shadcn Checkbox + Label htmlFor). groups-columns renamed/repointed to useGroups; GeoEditorInfoPanel edit-branch repointed to GroupEditorPanel (a deferred map-context consumer migration). schemaBuilder.test.ts GREEN (GROUP-03); build green; biome clean. Task-3 human-verify (authoring flow) DEFERRED to end-of-phase UAT per human_verify_mode:end-of-phase — user approved finalize; steps preserved in 09-04-SUMMARY. gsd-tools not on PATH — STATE/ROADMAP/REQUIREMENTS updated manually.
- [09-02]: src/lib/nostr/group/ shipped — the per-kind Factory+Cast+helpers foundation Plans 03–06 import. GroupContent collapses the contextUse/validationMode/allowForeignAttachments triad to a single governance:'open'|'schema'|'closed' enum (clean break, fields absent not migrated). isGroup adds the SPEC-03 hasCurrentModelVersion gate (legacy 37518 silently drops). GroupFactory extends EntityFactory (bare-sign base); create strips+re-asserts modelVersion, modify preserves d. All tag I/O delegates to tags.ts; added setSchemaHash transformer there (resolved the flagged inline-vs-tags.ts decision toward delegation). useGroups + useGroupAttachments(#c) hooks added; group/ wired into the nostr barrel (map-context/ retained, importable from its own path, ~34 consumers migrate in Plans 03–06). group.test.ts GREEN (GROUP-01); 20 pass / build green. gsd-tools not on PATH — STATE/ROADMAP/REQUIREMENTS updated manually.
- [09-05]: Contributor `c`-attach lane shipped (GROUP-02/04). usePublishing rewritten: dropped the legacy `validateDatasetForContext` import + the `validateRequiredContextAttachments` blocking gate and its 4 call sites entirely (slimmed governance has NO validationMode:'required' — GROUP-04 hard invariant); the `.contextReferences` `c`-tag write SURVIVES at all 4 publish entrypoints (GROUP-02); option repointed `mapContexts: MapContext[]` → `groups: Group[]`. New GroupAttachField.tsx: command+popover picker over useGroups; per-feature off-thread `filterForeignAttachment('warn',…)` → dismissible amber `Alert variant="default"` (NOT destructive) + "Checking…" spinner + worker-fail "shown unfiltered" copy; "Publish anyway" always enabled, `disabled` = `!canPublish||isPublishing` ONLY (never the verdict). Mounted in desktop GeoEditorInfoPanel attach section; onPublishNew/canPublishNew threaded through AppSidebar. build green / warnNotBlock 3/0 / own files biome-clean. 2 pre-existing legacy noLabelWithoutControl errors in GeoEditorInfoPanel left out-of-scope (logged to deferred-items). human-verify deferred to end-of-phase UAT. gsd-tools not on PATH — tracking md updated manually.
- [09-06]: NO-MOD MINIMUM two-lane GroupViewPanel shipped (GROUP-05/06/07/08) — the phase's second security-critical guard. New src/lib/group/noModMinimum.ts (the module the Wave-0 RED test imports; absent until now): gateForeignLane applies kind===37515 → verifyEvent signature → device-local mute IN ORDER before any event paints, then newest-first sort + cap 50 + hasMore; flipToClosed returns a modify template with governance:'closed' preserving d. SIG GATE HARDENED against nostr-tools verifiedSymbol cache poisoning (verifyUntrustedEvent rebuilds a plain event object from the sig-bearing fields and verifies THAT) — required to turn the corrupted-sig RED test GREEN and correct against relay events. ForeignLane.tsx: collapsed tone=neutral subordinate "Community contributions (N)" lane; off-thread filterForeignAttachment off/warn/strict (default strict) reason chips; ⋮ Mute @name (useMuteStore) + undo toast; Load more. CuratedLane.tsx: privileged tone=context "Canonical references" + Canonical Badge variant=secondary; owner Add-curated-reference picker + appendCuratedReference bless, both via GroupFactory.modify(group).referencedAddresses (preserves d). GroupViewPanel.tsx: CuratedLane FIRST then ForeignLane (D-08); owner Lock-down→Closed alert-dialog escape hatch (GroupFactory.modify.group({governance:'closed'})); sanitized RichContentRenderer narrative (0 dangerouslySetInnerHTML); CommentsPanel on the 37518 coord (GROUP-07, roots at target.kind===MAP_CONTEXT_KIND, no K/k widening — full widening stays Phase 13). Bridged store's MapContext-typed viewContext via rawEvent() (no store-wide type migration). Repointed info-panel barrel + GeoEditorInfoPanel; DELETED orphaned MapContextViewPanel.tsx. noModMinimum 6/0 · group+validation+mute 41/0 · FULL SUITE 663/0 · build green · biome clean. Task-3 human-verify (full NO-MOD trust posture) DEFERRED to end-of-phase UAT per human_verify_mode:end-of-phase — user approved finalize; steps preserved in 09-06-SUMMARY. gsd-tools not on PATH — STATE/ROADMAP/REQUIREMENTS updated manually.

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 9 (Group)]: NEEDS deeper research at planning time — `governance` enum backward-compat shape with legacy content fields; non-developer schema-authoring UI; exact foreign-lane cap (suggested start: 50 visible, paginate, sort by recency); NO-MOD MINIMUM UX contract.
- [Phase 11 (Sighting)]: OPEN decision — dedicated lightweight kind vs 37515 + property + NIP-40; confirm a new kind number needs no relay-side Khatru filter changes beyond existing `pool.req`.
- [Phase 12 (Beacon)]: OPEN decision — replaceable + NIP-40 vs ephemeral lifecycle; confirm with a relay echo test (Khatru NIP-40 GC); `seq`-tag schema for clock-skew de-dup; staleness grey-out threshold; visibility/privacy model.
- [v1.1 carry-forward]: Three live in-browser human-verify items remain bookkeeping-open (see Deferred Items) — not work-open, regression-tested.
- [09-04]: Group authoring-flow human-verify DEFERRED to consolidated end-of-phase UAT (human_verify_mode:end-of-phase) — automated gates green (schemaBuilder.test GREEN, build, biome); verification steps preserved in 09-04-SUMMARY. Bookkeeping-open, not work-open.

## Deferred Items

Items acknowledged and carried forward / out of scope.

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Feature | Nostr-scrolls / WASM (NIP-5C) | Deferred (builds on shipped code interpreter) | 2026-06-16 |
| Feature | Compound routing | Deferred to v2 | 2026-06-16 |
| Refactor | Reroute editor.updateFeature + deleteFeatures + dataset-load setFeatures through Authoring API (tighten A3 to all 4 verbs) | Deferred (facade-expansion follow-up) | 2026-06-16 (02-03) |
| Feature (v1.2) | NIP-72 human moderation/approval + role lists (MOD-01) | Deferred to next milestone | 2026-06-23 |
| Feature (v1.2) | Web-of-trust + mute lists for spam (MOD-02) | Deferred to next milestone | 2026-06-23 |
| Feature (v1.2) | Scroll-linked Story map camera (STORY-07) | Deferred to v2 | 2026-06-23 |
| Feature (v1.2) | External-source / sandbox-driven Beacon (BEACON-05), beacon trail (BEACON-06), encrypted beacons (BEACON-07) | Deferred to v2 | 2026-06-23 |
| Feature (v1.2) | AI paste→Sighting ingest (SIGHT-05), geoprivacy obscuring (SIGHT-06) | Deferred to v2 | 2026-06-23 |

### Acknowledged at v1.1 milestone close (2026-06-23)

Open artifact-audit items awaiting live in-browser human confirmation or design questions already resolved in code — bookkeeping-open, not work-open.

| Category | Item | Status |
|----------|------|--------|
| debug | sandbox-worker-file-url-dev | awaiting_human_verify (fix landed: dev `.wasm` served as application/wasm; regression-tested) |
| debug | sandbox-worker-oom-runaway | awaiting_human_verify (fix landed: warm-pooled worker + circuit breaker; regression-tested) |
| verification | Phase 06 — 06-VERIFICATION.md | human_needed (automated gates green 538/0; awaiting live UAT confirmation) |

## Session Continuity

Last session: 2026-06-26T16:02:35.375Z
Stopped at: Phase 10 context gathered
Resume file: .planning/phases/10-story-article-37520/10-CONTEXT.md

## Operator Next Steps

- Phase 09 (Group / Topic) — ALL 6 plans (09-01..09-06) executed; the full v1.2 Phase-9 surface (foundation → validation core → authoring → contributor attach → NO-MOD two-lane view) is in place. GROUP-01..08 all GREEN. Full test suite 663/0; build green; biome clean.
- Next: run the consolidated end-of-phase UAT — it includes the three deferred human-verifies (09-04 authoring flow, 09-05 attach flow, 09-06 full NO-MOD trust posture), steps preserved verbatim in 09-04-SUMMARY / 09-05-SUMMARY / 09-06-SUMMARY. After UAT sign-off, run /gsd-verify-phase (or the phase verification) and then advance to Phase 10/11/12 (Story / Sighting / Beacon).

</content>
