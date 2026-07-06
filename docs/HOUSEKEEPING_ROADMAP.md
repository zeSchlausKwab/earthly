# Housekeeping Refactor Roadmap (feature/house-keeping-refactor)

**Created:** 2026-07-06 · **Status:** Phase 1 in progress
**Goal:** Pre-merge/pre-deploy housekeeping — kill cross-cutting pain points (stage leaks, wallet
reliability, seeding sprawl, relay management, spec drift), ship the last feature (sighting
images), and bump core libs. Based on a 7-track parallel architecture analysis of this branch.

**Gates for every phase:** `bun test` · `bun run build` · `bun run lint` (tsc has ~305
pre-existing errors and is NOT a gate).

---

## Phase ordering & rationale

| # | Phase | Why this position |
|---|-------|--------------------|
| 1 | Dependency bumps | Everything else builds on applesauce 6.2.x APIs (esp. wallet). |
| 2 | Stage/relay isolation | Safety net: all later dev/testing must not leak to public relays. |
| 3 | SPEC & blob-reference fixes | Small, high-stakes ("last chance before users blast events publicly"); defines the imeta grammar Phases 6–7 depend on. |
| 4 | NIP-60 wallet reliability | Depends on wallet 6.2.0 stable APIs from Phase 1. |
| 5 | Relay management, outbox & reactivity | Correctness polish on the now-stable relay layer. |
| 6 | Unified seeding | Depends on relay guard (2), spec fixes (3), and produces imeta-rich data (3/7). |
| 7 | Sighting images (FEATURE) | The last feature before deploy; needs 3 (spec) + benefits from 6 (seeds). |
| 8 | Geo-editor refactor (nice-to-have) | Explicitly lowest risk-tolerance; do only what's mechanical. |

---

## Phase 1 — Core library bumps

**Finding:** applesauce stable **6.2.0 (published 2026-06-26)** contains the NIP-60 wallet work
the `0.0.0-next-20260610164519` pins were for (`NutWallet`, `MintTokens`, `CleanupDeletedTokens`,
`getCashuWallet` provider, NIP-09 delete controls). Pins can be lifted. Lockstep required:
`applesauce-wallet@6.2.0` deps on actions/common/core/loaders `^6.2.0`.

**Steps (each its own commit):**
1. **Applesauce group:** un-pin actions/common/signers/wallet → `^6.2.x` stable
   (signers 6.2.2, relay 6.2.1 — fixes `_ready$` reconnect bug), bump accounts/core/loaders →
   `^6.2.0`; keep applesauce-react `^6.0.0` (no 6.2 exists). cashu-ts → `^4.6.1`
   (NOT v5 RC — wallet hard-deps `^4.5.1`).
   ⚠ Risk: wallet 6.2.0 makes proof amounts `Amount` value objects and `getDecodedToken`
   requires keyset IDs — grep `src/lib/wallet/` for raw proof-amount arithmetic.
2. **Dead weight removal:** delete `coco-cashu-core`, `coco-cashu-indexeddb`, `coco-cashu-react`
   (zero imports in src/ — verified), and `@types/maplibre-gl` (deprecated stub; maplibre v5
   ships its own types).
3. **Low-risk minors:** zustand 5.0.14, @tiptap/* 3.27.1 (all 8 together), tailwindcss 4.3.2,
   @types/bun 1.3.14.
4. **Biome 2.5.2** separately (may surface new lint findings).
5. **@contextvm/sdk 0.13.6** separately — 0.13.0 added CEP-8 payment gating;
   `withServerPayments` now defaults `paymentInteraction: 'optional'`. Check
   `src/ctxcn/EarthlyGeoServerClient.ts`; client-side usage likely unaffected.
6. No action: maplibre-gl, @modelcontextprotocol/sdk, blossom-client-sdk, nostr-idb (all latest).

---

## Phase 2 — Watertight stage/relay isolation

**Verified leak vectors (dev → public relays):**
1. **CRITICAL — loader relay hints:** `src/lib/nostr/index.ts:245` creates event loaders without
   `followRelayHints: false`; applesauce defaults to following relay hints in tags/pointers →
   implicit sockets to public relays. Amplified by `addRelayHintsToPointer()` in
   `geo-event/cast.ts:119`.
2. **CRITICAL — MCP client fallback:** `src/ctxcn/EarthlyGeoServerClient.ts:233` falls back to
   hard-coded `DEFAULT_RELAYS` (public) when config is missing; `getGeoClient()` in
   `src/features/chat/tools/helpers.ts:39` passes no relays.
3. **MEDIUM — zap requests:** `GeoSocialActions.tsx` (~line 900) hard-codes
   `relay.damus.io / nos.lol / relay.nostr.band`.
4. **Safe already:** `buildWriteRelays()` in `env.client.ts` hard-locks writes to
   `ws://localhost:3334` when `location.hostname === 'localhost'`; wallet publish falls back to
   writeRelays; publish() collapses ALL routing to writeRelays in dev (`index.ts:320-324`).

**Design: `src/lib/nostr/relay-router.ts` — single source of truth.**
- Buckets: `content` (37515-37522, comments, reactions, zaps → dev = local ONLY),
  `profile` (kind 0/3/10002 → public reads allowed), `wallet` (17375/7375/7376/7374 →
  public reads allowed, writes per wallet relays; encrypted anyway), `discovery` (MCP, search).
- Runtime dev flags: `allowPublicReads` (debugging), `allowPublicWrites` (authoring) —
  default false, toggleable via a dev-only settings panel.
- **Belt-and-suspenders:** pool-level connection allowlist guard in dev — reject socket opens to
  any relay not in the resolved route set (catches future applesauce implicit magic).

**Steps:**
1. Create relay-router module + wire config/env into it.
2. `followRelayHints: false` on all loaders (route discovery reads through router).
3. Fix GeoServerClient fallback → router `discovery` bucket.
4. Fix zap request relays → router `content` bucket.
5. Pool allowlist guard (dev only) + console warning on blocked attempts.
6. Dev settings toggles for the two flags.
7. **Docs:** `docs/RELAY_STAGES.md` — concise contract: which bucket, which relays, per stage.
8. Verify: DevTools network tab shows ONLY `ws://localhost:3334` in default dev; flag flips
   open exactly the expected extra sockets.

~6 files, ~200 LOC. Seeding guard itself lands in Phase 6 (structural localhost check).

---

## Phase 3 — SPEC conformance & blob-reference fixes

**Audit verdict:** kinds 37515–37522 + 34444 have no registry collisions; NIP-22/32/40/52
conformance is good. Issues found:

1. **HIGH — Article `publishedAt` missing:** SPEC §4 (line 236) promises NIP-23 metadata incl.
   `publishedAt`; `ArticleContent` in `src/lib/nostr/article/helpers.ts:29-36` doesn't have it.
   Unfixable retroactively once published publicly. → Add `publishedAt?: number` (epoch s) to
   interface + factory default (publish-time now).
2. **MEDIUM — blob sha256 never verified:** `resolveBlobReferences.ts` fetches blobs but ignores
   the `sha256=` param. → Verify via `crypto.subtle.digest` when present; warn/fail on mismatch.
3. **MEDIUM — no blob size cap:** hostile/buggy server can OOM the client. → 50 MB cap via
   Content-Length + streamed check; `NonRetryableHttpError` on excess.
4. **MEDIUM — feature-id scope grammar ambiguity:** `feature:<id>` breaks if id contains `:`.
   → SPEC amendment §1.5.2: feature ids MUST match `[a-zA-Z0-9_.-]+`; reject malformed refs.
5. **LOW — `size=` semantics:** clarify in SPEC = uncompressed UTF-8 byte length (matches
   `blossomUpload.ts:59` behavior), not HTTP Content-Length.
6. **SPEC additions for Phase 7:** new §5.1/§6.1/§7.3 — NIP-92 `imeta` media attachments for
   beacons + sightings (and optionally stories). Grammar:
   `["imeta", "url <url>", "m image/jpeg", "sha256 <hex>", "dim WxH"]`; **first imeta = primary
   image**; image fetch never gates entity rendering.
7. Document blob param parsing (silent drop of non-`key=value` entries) in SPEC §1.5.1.

Write-path ergonomics (`.autoBlob()` on GeoDatasetFactory to auto-split oversized features) is
optional stretch — the read path and spec clarity are the priority.

---

## Phase 4 — NIP-60 wallet reliability

**Root causes found (ranked):**
1. **`CompleteSpend` never called** after `TokensOperation` / melt — old token events are never
   deleted (no `del` tags, no kind 5) and **no kind 7376 history is written**. Spent proofs
   re-appear in balance after reload → next payment reuses them → mint rejects "already spent".
   This is THE routstr bug and the balance-drift bug in one.
2. **Refund handling not guaranteed:** chat store (`src/features/chat/store.ts:~1417`) sends
   token via X-Cashu; refund token processing isn't in a guaranteed-completion path.
3. Relay-lag staleness + no post-payment balance refresh (mitigated once 1 is fixed).
4. Couch recovery + consolidation exist (`recoverFromCouch()`, `consolidateTokens()`) but are
   never exposed/run.

**Steps (UI stays as-is per requirement):**
1. Wrap the spend lifecycle: after every send/melt run `CompleteSpend` (deletes/`del`-tags
   consumed token events, writes kind 7376 history). Same for receive/mint paths (verify
   applesauce 6.2 `ReceiveToken`/`MintTokens` already write history; fill gaps).
2. Chat payment path: process refund token in a `finally`-guaranteed step; tag refunds in
   history; on refund failure, surface the encoded token to the user instead of dropping it.
3. Add a payment mutex/queue around token sends from chat (prevent concurrent proof selection
   on manual retries).
4. Expose "Recover stranded tokens" + "Consolidate tokens" in WalletToolsSection; optionally
   auto-consolidate (debounced) after bursts.
5. Tests: `src/lib/wallet/__tests__/` — send-writes-history, reload-balance-correct,
   concurrent-send, couch recovery; chat payment flow with mocked routstr.

**Reference:** applesauce wallet admin example (`apps/examples/src/examples/wallet/admin.tsx`) —
`wallet.balance$`, `wallet.history$`, `wallet.busy$` (lock UI while ops in flight).

---

## Phase 5 — Relay management, outbox & reactivity polish

**Already healthy (verified):** NIP-65 UI (`UserRelayManager.tsx`) reads/writes kind 10002 with
dedup/normalization; publish() has configured/outbox/inbox routing with dev hardlock; optimistic
`eventStore.add()` before relay ack; nostr-idb cache fully wired with startup hydration.

**Fixes (priority order):**
1. **S — inbox routing:** comments & reactions publish with `routing: 'outbox'`
   (`useGeoComments.ts:139,177,204`) → should be `routing: 'inbox', target: <author pubkey>`
   per NIP-65 semantics so authors actually discover replies/reactions.
2. **M — NIP-42 AUTH:** UI shows auth-required badges but app never answers AUTH challenges →
   silent publish failures on auth relays. Implement via applesauce signer AUTH support.
3. **M — live relay-list application:** pool/loaders don't react to NIP-65 changes; subscribe to
   MailboxesModel and rebuild connections (respecting Phase-2 router!).
4. **S — `MapSettingsPanel.tsx:128`:** manual `.subscribe()` + useState copy of profile →
   `use$(() => eventStore.profile(pubkey))`.
5. **S — `hooks.ts:84`:** remove `map(events => [...events])` spread (breaks memoization).
6. **Backlog (post-branch):** outbox timeline loader (`createOutboxTimelineLoader`) +
   `selectOptimalRelays()` — valuable but L effort; not needed for this deploy.

---

## Phase 6 — Unified seeding

**Findings:** 5 scripts + 2 generator helpers; 3 verbatim copies of geohash impl; 4 divergent
relay-health helpers; 3 publish patterns; seed.ts/canonical/purge still on NDK compat while
seed-entities/seed-sightings are already applesauce-native. **Leak risk:** `seed_canonical_data.ts`
/ `purge_canonical_data.ts` accept any relay URL via argv + `APP_PRIVATE_KEY` env with no guard.

**Target design:** single `bun run seed <command>`:
- Commands: `minimal` | `full` | `sightings` | `canonical` | `purge`.
- Flags: `--relay <url>` (default localhost:3334), `--allow-remote` (structural guard: non-local
  URL without this flag = hard error), `--key`, `--dry-run`, `--verbose`.
- Shared layer `src/lib/seeder/`: config+guard, identities, geo/{hash,bbox} (ONE canonical
  geohash impl), relay/{health,publish-with-retry}, scenarios/, content/ templates.
- All scenarios publish via applesauce factories (finish NDK → applesauce migration for
  seed.ts/canonical; then delete `src/lib/seed-relay/` compat layer).
- Old scripts archived under `scripts/seed-legacy/` for one release, then deleted.

**Realism additions:** reactions (kind 7) + zaps (9735) on datasets/comments, comment threads
with geo annotations, proposal status events, rich-text content with images/videos via NIP-92
imeta (grammar from Phase 3), geo references in article/story bodies.

---

## Phase 7 — Sighting & beacon images (FEATURE)

Spec basis: Phase 3's §5.1/§6.1/§7.3 (NIP-92 imeta, first = primary).

1. **Entity layer:** imeta read/write in temporal-sighting + live-beacon casts/factories
   (multiple images, primary = first; reorder = set-primary).
2. **Upload UI:** reusable image-upload component → Blossom server of user's choosing, default
   `blossom.earthly.city`; client-side downscale to ≤1 MB (canvas re-encode) when targeting the
   default server; NIP-98 auth via existing blossom-client-sdk wiring.
3. **Map rendering:**
   - Sightings: primary image in a "pin bubble" above the point coordinates, clickable.
   - Beacons: profile avatar in the same bubble component; fallback chain image → name initials
     → first 2 chars of pubkey (reuse existing avatar component logic).
   - Click → inspect view in right sidebar (remember: new sidebar view needs BOTH the type AND
     the runtime SIDEBAR_VIEW_MODES array). Hover → popup box like datasets.
4. **Consistency:** apply the same imeta support to stories (cover image already in content
   JSON — mirror to imeta tag per Phase 3 ISSUE-5) where cheap.
5. Seed scenarios updated to include sighting images (ties into Phase 6 content templates).

---

## Phase 8 — Geo-editor refactor (nice-to-have; abort on any sign of risk)

**Current reality (measured):** GeoEditorView.tsx 3523 lines, GeoEditor.ts 1970, Toolbar 1516,
useMapLayers 1257, store slices 2203. **Good news:** GeoEditor.ts core is already store-free
(callback-injected metadata; only window timers + canvas usage) — near-extractable as a maplibre
plugin. Maps-over-blossom (pmtilesProtocols.ts + kind-34444 announcement handling) is extractable
with two seams.

**Do (in risk order):**
1. Extract pure selectors from GeoEditorView (lines ~160-247) → `utils/selectors.ts` (zero risk).
2. Extract announcement parsing → pure `core/nostr-map-announcements.ts`.
3. Invert `useNostrMapLayerAnnouncements` (timeline injected by caller, store writes via
   callback) — the prerequisite seam for the maps-over-blossom package.
4. Extract `pmtilesProtocols.ts` → `lib/geo/pmtiles-blossom-resolver.ts` (standalone; future
   `@earthly/pmtiles-blossom`).
5. Optional: focused per-slice store hooks to cut GeoEditorView's re-render surface.

**Do NOT touch:** manager geometry algorithms, GeoEditor event model, useMapLayers state machine,
store slice composition, mobile layout (freshly stabilized). Toolbar extraction as a library is
deferred entirely — only worthwhile as prop-based UI lib, not a maplibre plugin.

---

## Cross-cutting notes

- **Outbox in dev** stays collapsed to local relay (existing hardlock) — router formalizes this.
- **cordn encrypted-GeoJSON agenda** (key coordinator) is out of scope here; noted as successor
  work for beacon/entity privacy.
- After Phase 1, delete stale `// pre-release` comments about the applesauce pins.
- Deploy checklist at the end: re-verify VPS disk headroom (2026-06-08 crash-loop runbook),
  Bluge search replacement remains a separate agenda item.
