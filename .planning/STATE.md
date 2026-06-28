---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Geo Entity Model Split
status: verifying
stopped_at: Phase 11 UI-SPEC approved
last_updated: "2026-06-28T07:24:57.866Z"
last_activity: 2026-06-28 -- Plan 11-02 (Temporal Sighting data layer) complete — SIGHT-01/02/03 seams GREEN
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 19
  completed_plans: 19
  percent: 67
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-23 after v1.1 milestone)

**Core value:** The maintainer (and any user) can open the app for fun, not duty.
**Current focus:** Phase 11 — temporal-sighting

## Current Position

Phase: 11 (temporal-sighting) — EXECUTING
Plan: 4 of 4
Status: Phase complete — ready for verification
Last activity: 2026-06-28 -- Plan 11-02 (Temporal Sighting data layer) complete — SIGHT-01/02/03 seams GREEN

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
| 10 | 4 | - | - |
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
| Phase 10 P01 | ~14m | 2 tasks | 5 files |
| Phase 10 P02 | ~30m | 2 tasks | 2 files |
| Phase 10 P03 | ~70m | 2 tasks | 20 files |
| Phase 10 P04 | ~28m | 2 tasks | 9 files |
| Phase 11 P01 | 18min | 2 tasks | 4 files |
| Phase 11 P02 | ~30m | 2 tasks | 8 files |
| Phase 11 P03 | 55min | 3 tasks | 11 files |
| Phase 11 P04 | 50min | 2 tasks | 18 files |

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

- [10-04]: Story narrative edit-proposals shipped — STORY-06 closed (the last STORY req). The kind-37519 proposal machinery is generalized from a FeatureCollection (dataset) target to a Markdown-content (Story) target as a PURE CONTENT-TYPE EXTENSION — NO discriminator tag (the resolved open ROADMAP/CONTEXT question): target kind is read off the `a` coordinate alone (37520⇒Markdown, 37515⇒FeatureCollection) per SPEC.md §11.1 (content is free-form) + §17 (coordinate is canonical reference target); dataset path (create/useGeoProposals) UNTOUCHED (amend, don't replace). GeoProposalFactory.createForStory(target, markdownBody) puts the raw Markdown STRING in content (not FC JSON), a=37520 coord, p=owner. helpers: getProposalMarkdownContent (raw content, never throws — T-10-14) + getProposalTargetKind (parses kind off `a`, undefined for malformed — T-10-13). useStoryProposals mirrors useGeoProposals (two-stage #a subscribe + status); the pure accept impl is factored into src/features/social/hooks/acceptStoryProposal.ts (acceptStoryProposalImpl, React-free so it's unit-testable) — accept routes through the Plan-01 editStory path (re-derives a-tags STORY-03, preserves d-tag STORY-04 — T-10-12, no phantom a / no fork), then a 1631 applied status; reject = 1632 closed via createProposalStatusEvent (reused verbatim). UI: StoryProposeEditDialog (reader Propose-an-edit: GeoRichTextEditor pre-filled → createForStory().sign→publish) + StoryProposalsPanel (author amber Alert variant=default pending banner + Review-edit two-column diff proposed-vs-current rendered ONLY through sanitized RichContentRenderer T-10-11 + accent bg-primary Accept edit / destructive-toned Reject; self-gates on isOwner). Both mounted in StoryViewPanel (author panel for isOwner, reader dialog+button for non-owner). storyProposal.test.ts 6/0 (4 behaviors + 2 edge cases); FULL SUITE 693/0 (687+6, no regression, dataset path regression-clean); build green; 9 files biome-clean; zero dangerouslySetInnerHTML. Commits cbe9917, 1888f7d. NOTE: gsd-tools not on PATH — STATE/ROADMAP updated manually.
- [10-03]: Story reading + navigation spine shipped — src/components/info-panel/StoryViewPanel.tsx + src/features/geo-editor/hooks/useStoryEditor.ts + nav/comment/OG wiring across 18 files (bf1112e, 769414c). StoryViewPanel is the GroupViewPanel reading analog with the CuratedLane/ForeignLane two-lane machinery STRIPPED (a Story is closed/curated): EntityPanelShell + tone=context surface (Story eyebrow + date meta + 16:9 cover w/ neutral placeholder) renders the Markdown body ONLY through the sanitized RichContentRenderer — inline geo-refs render in place with eye-toggle (show/hide on main map) + fly-to, DEFAULT HIDDEN (renderer chip starts hidden, emits a toggle only on reader opt-in → no auto-load of attacker-controlled targets, T-10-07/T-10-08; zero dangerouslySetInnerHTML). Owner Edit/ConfirmDeleteAction; tone=discussion CommentsPanel on the 37520 coord (STORY-05). XCUT-01 MINIMAL slice: widened CommentsPanel/useGeoComments target unions + react() param to accept Article + getEntitySharePath ARTICLE_KIND→'story' (did NOT widen NIP-22 K/k root-kind enum — runtime rooting already kind-generic, full widening stays Phase 13). Nav spine: AppSidebar Stories rail destination (BookOpen) + New Story create + StoriesPanelContent case (D-01/D-02), story is a 3rd EntityWorkspace; GeoEditorInfoPanel StoryEditorPanel create/edit + StoryViewPanel view branches gated on storyEditorMode/viewStory (D-03); store viewStory slot + setViewStory + applyRouteState story clause; SidebarViewMode+focusType+RouteSnapshot widened to 'story'/'stories'; useRouting /story parse + buildRoutePath; useStoryEditor hook (mirrors useContextEditor) + GeoEditorView /stories/story/:naddr focus-route resolve via useStories + handleDeleteStory; OG (D-04) handleStoryRoute + /story/:naddr routes + OG-image story case + fetchStoryOGData (NIP-23 title/summary/image) + generateStoryOGHtml (reuses audited generateOGHtml escaping, T-10-09) + 'story' OGCacheType; deleteStory NIP-09 helper added (Rule 2 — onDeleteStory was a dead stub). Full suite 687/0 (no regression); build green (client+server+5 workers); tsc NET-REDUCED 454→450 (touched-file errors 12→8, remainder pre-existing); biome clean on new files (2 pre-existing GeoEditorInfoPanel noLabelWithoutControl out-of-scope). NOTE: gsd-tools not on PATH — STATE/ROADMAP/REQUIREMENTS updated manually.
- [10-02]: Story authoring surface shipped — src/components/info-panel/StoryEditorPanel.tsx + src/components/StoriesPanel.tsx (188b8a5, 245f50c). StoryEditorPanel is a structural copy of GroupEditorPanel (Article for Group): Title/Summary/Cover(16:9 AspectRatio + BlossomUploaderButton) metadata block + GeoRichTextEditor Markdown body (built-in @-mention picker = STORY-02 insert half) wrapped in a Write/Preview Tabs pair where Preview renders ONLY through the sanitized RichContentRenderer (T-10-04, zero dangerouslySetInnerHTML). It calls the Plan-01 publishStory/editStory service (NOT a re-inlined ArticleFactory) so STORY-03 a-derive + STORY-04 d-lineage live in one tested module; Save draft/Discard-draft (alert-dialog) via writeStoryDraft/clearStoryDraft; pre-fill from getArticleContent (edit) or readStoryDraft (create); reserved-accent submit (Publish Story / Save changes). StoriesPanelContent copies GeoDatasetsPanelContent browse (useStories + useFilterState + useSortedFilteredItems + EntitySearchToolbar) but renders Card list-rows per UI-SPEC §1 (cover thumb img-src + title + summary + author/date + Draft/Published Badge + ⋮ DropdownMenu) instead of the analog's DataTable; accent New Story button at top (D-02); skeleton on load + UI-SPEC empty states ("No stories yet"/"No stories match"). Draft chip via readStoryDraft(dTag); copy-link copies the 37520:pubkey:d coordinate as a pre-routing fallback (canonical /story/:naddr + OG card is Plan 03). Rail destination wiring (AppSidebar/GeoEditorInfoPanel mounts) deferred to Plan 03 — this plan delivers only the panel-body components + their props contracts. Full suite 687/0 (identical to Plan-01 baseline, no regression); build green; both files biome-clean. NOTE: gsd-tools not on PATH — STATE/ROADMAP/REQUIREMENTS updated manually.
- [10-01]: Story data-layer service shipped — src/lib/nostr/story/{lifecycle,draft,index}.ts + src/lib/hooks/useStories.ts. publishStory()/editStory() wrap the Phase-8 ArticleFactory and, on EVERY publish, destructively re-derive the `a` tags from the Markdown body's inline nostr:naddr refs via extractReferencedCoordinates → modifyPublicTags(setAddressReferenceTags) (STORY-03; body is the single source of truth — extracts the GroupEditorPanel.handleSave inline analog into one tested module Plans 02/04 share). editStory uses ArticleFactory.modify (preserves d, STORY-04 lineage, no fork). Malformed naddr inherited-excluded via naddrToCoordinate→null (no throw, T-10-01). Service does NOT cast (caller casts via castEvent). draft.ts: readStoryDraft/writeStoryDraft/clearStoryDraft keyed by d-tag over the existing readScopedStorage/writeScopedStorage primitives at base key 'earthly:story:drafts:v1' (NEW_STORY_DRAFT_KEY='new-story' sentinel); defensive map read → {} on malformed value, never throws (T-10-03 accept). useStories() copies useGroups exactly — isArticle filter BEFORE castEvent in the useMemo so a malformed/legacy/forged 37520 can't crash the timeline (T-10-02). 5-behavior lifecycle.test.ts GREEN (publish mocked via mock.module, no live publish); full suite 687/0; build green; new files biome-clean. NOTE: gsd-tools not on PATH — STATE/ROADMAP/REQUIREMENTS updated manually.
- [Phase ?]: [11-01]: Nyquist Wave-0 RED baseline for kind 37522 — 4 test files pin the net-new geometry-on-content + bbox/g turf-derivation (SIGHT-01), the publishSighting lifecycle round-trip, and the classifyObservationState live/upcoming/past classifier (D-06) as RED; plus GREEN pins for c-emit/modify-d (SIGHT-02), per-read-path dropExpired over 37522 at a fixed UTC clock with epoch-seconds units guard (SIGHT-03, T-11-01-DOC), and GeoCommentFactory.root K/k=37522 (SIGHT-04, no allowlist). Baseline 16 pass/3 fail+1 error — failures isolated to missing publishSighting + classifyObservationState. sightingComment signs via a real EventSigner mock (EventFactory needs getPublicKey+signEvent). build green; 4 files biome-clean.
- [Phase ?]: [11-02]: Temporal Sighting data layer shipped — content.geometry (Point|Line|Polygon, D-02) with bbox/g re-derived from geometry via turf every publish; publishSighting/editSighting/deleteSighting lifecycle (editSighting preserves d; expiry independent of observation end); classifyObservationState live/upcoming/past (D-06); local-first sighting draft; useSightings filter-before-cast + dropExpired at the subscription (SIGHT-03). eventStore extracted to src/lib/nostr/store.ts so the lifecycle stamps the parent-store ref for store-free castEvent (Plan-01 round-trip mocked the barrel). Plan-01 RED→GREEN; Temporal Sighting set 23/0; suite 717/0; build+biome green.
- [Phase ?]: 11-03: viewSighting held hook-local (not store/route) — /sighting/:naddr route + viewModeSlice promotion deferred to Plan 04 (D-08)
- [Phase ?]: 11-03: Sighting map marker rides useMapLayers source/layer pair with its own dropExpired-before-source-build; obsState paint, live → --primary accent
- [Phase ?]: Phase 11 Plan 04: SightingViewPanel gates expiry at the detail read path independently (5th SIGHT-03 read path); SIGHT-04 = pure mount + type-union widening only (NIP-22 K/k enum stays Phase 13); /sighting/:naddr is a thin per-kind clone (Phase 13 owns XCUT-02)

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

Last session: 2026-06-28T07:24:42.511Z
Stopped at: Phase 11 UI-SPEC approved
Resume file: .planning/phases/11-temporal-sighting/11-UI-SPEC.md

## Operator Next Steps

- Phase 10 (Story / Article ~37520) — ALL 4 plans (10-01..10-04) executed; the full Story surface (data layer → authoring → reading + nav spine → narrative edit-proposals) is in place. STORY-01..06 all GREEN. Full test suite 693/0; build green; biome clean.
- The kind-37519 spec-discriminator open question is RESOLVED (pure content-type extension, no discriminator — SPEC.md §11.1/§17) and recorded in 10-04-SUMMARY + decisions above.
- One deferred end-of-phase human-verify for Phase 10: a reader proposes an edit, the author reviews the diff and accepts → the Story updates in place (steps in 10-04-SUMMARY verification block). Plus the Plan 02/03 authoring/reading flows if not yet UAT'd.
- Next: run the consolidated Phase-10 end-of-phase UAT, then /gsd-verify-phase 10 + /gsd-secure-phase 10. NOTE: Phase 9 still has its own pending UAT + /gsd-verify-work 9 + /gsd-secure-phase 9 (see Phase 9 memory).

</content>
