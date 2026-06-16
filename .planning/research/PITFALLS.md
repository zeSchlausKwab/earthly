# Pitfalls Research

**Domain:** Browser code-interpreter sandbox + AI-driven destructive map authoring + file ingest/multimodal + geometry optimization, layered onto a mature React 19 / MapLibre / applesauce-Nostr app (Earthly v1.1)
**Researched:** 2026-06-16
**Confidence:** HIGH (codebase-grounded for integration/encryption/tool-dispatch; HIGH for sandbox + geometry from established web-security and turf/mapshaper behavior)

> Scope note: this is a SUBSEQUENT milestone on a working app. Most pitfalls below are about *adding* the v1.1 surface (sandbox, ingest, safe-edit, optimization, encrypted settings) without breaking the existing chat, editor, publish, and wallet/signer code. Generic web-security advice is omitted; everything here is specific to these features and to the code already in `src/features/chat/` and `src/features/geo-editor/`.

---

## Critical Pitfalls

### Pitfall 1: "Sandbox" that isn't — iframe `sandbox` attr or blob-URL Worker treated as a security boundary while same-origin / host objects leak in

**What goes wrong:**
The code interpreter is built as a Web Worker created from a `Blob`/`new Function`, or an `<iframe sandbox>`, and the host passes the *real* toolbar/drawing API object, the Zustand store, the NDK/applesauce signer, or `window` references into it. Generated JS then reads `signer`, `localStorage`, `EventStore`, or the Cashu wallet directly. A blob-URL Worker inherits the page's origin, so it can `fetch()` same-origin endpoints and read same-origin storage; `<iframe sandbox>` without `allow-same-origin` is better but is routinely defeated by re-adding `allow-same-origin allow-scripts` (which together void the sandbox) or by `Function('return this')()` escapes when the host messages structured-clonable-but-live references in.

**Why it happens:**
The fastest way to give generated code "map access" is to hand it the existing API object. The team already has a clean toolbar API mandated by PROJECT.md ("designed as if a future package export"), so it's tempting to expose it by reference. Worker/iframe isolation is assumed to be a security boundary when it's really only a *thread/DOM* boundary unless origin + CSP + message-only contract are all enforced.

**How to avoid:**
- Treat the sandbox as **message-passing only**. The only thing crossing the boundary is structured-clone JSON (postMessage). No live object, no function, no signer, no store reference ever enters the sandbox.
- Expose the toolbar/drawing API as an **async RPC proxy**: inside the sandbox, `map.addFeature(...)` serializes `{op, args}` and posts to the host; the host validates against an allow-list and executes against the real toolbar API. This reuses the clean API boundary PROJECT.md already demands.
- Use a **cross-origin iframe** (separate origin / `srcdoc` with `sandbox="allow-scripts"` and NO `allow-same-origin`) OR a dedicated Worker with a strict `default-src 'none'; connect-src` CSP. Cross-origin iframe is the stronger primitive for this case because it denies same-origin storage access by construction.
- The host RPC layer is the *real* security boundary — every op is allow-listed, argument-validated, and rate/time-bounded there, not inside the sandbox.

**Warning signs:**
- Any `postMessage` payload, Comlink `expose()`, or Worker constructor that carries a function, the store, the signer, or `window`.
- `allow-same-origin` together with `allow-scripts` on the iframe.
- Generated code can call `fetch`, `import()`, or reach `localStorage` at all.

**Phase to address:** The sandbox phase — this is the load-bearing decision. Get the boundary contract right before any tool is exposed; retrofitting isolation after the API surface is wired is a rewrite.

---

### Pitfall 2: AI clobbers the wrong dataset — silent binding + no diff + bulk irreversible writes

**What goes wrong:**
Chat is bound to a target dataset via the existing `bindActiveWorkspaceChat()` which (per PROJECT.md) "binds silently." The AI runs a batch transform ("translate all names", "recolor by attribute") against whatever the editor currently holds, overwrites features in place, and the user discovers afterward that it edited the wrong context, dropped properties on features it didn't recognize, or replaced a 400-feature dataset with the 12 it could "see." Because writes go straight through `write_geojson_to_editor` / `add_feature_to_editor` (existing tools in `execute.ts`), there is no diff and the only undo is the editor's geometry-level history, which does not capture property/style mutations or dataset-binding mistakes.

**Why it happens:**
The current dispatcher (`src/features/chat/tools/execute.ts`) executes tools immediately with no add-vs-modify-vs-delete classification and no preview gate. Silent binding means the user never confirmed *which* dataset is the target. Bulk ops feel safe in testing on a small dataset and become destructive on a real one.

**How to avoid:**
- Make the **binding visible and explicit** first (the carried-over binding chip, now in v1.1). No edit tool fires unless a target is bound and shown. This is a prerequisite, not a nicety.
- Classify every mutating tool call as **add / modify / delete** before execution and route through the **safety-level config** (1 preview+confirm / 2 confirm-destructive default / 3 trust+undo). Level 2 (default) must hard-gate `modify`+`delete`; `add` can pass.
- Generate a **structured diff** (features added / properties changed / features removed) and render it *against the bound dataset* before applying — never apply-then-show.
- Make bulk ops **transactional and reversible at the dataset level**, not just the geometry level: snapshot the bound FeatureCollection before a batch, apply, allow one-shot revert. The editor's existing undo stack is insufficient for property/style/translation edits.
- **Match by stable feature id**, never by array index or by the subset currently visible to the model — a transform applied to "the features in context" silently drops everything outside the context window (see Pitfall 11).

**Warning signs:**
- A mutating tool runs with no `safetyLevel` check in the dispatcher.
- Diff is computed *after* `setFeatures`.
- "Translate/recolor/clean up" tools operate on `getSelectedAreaFeatures()` or the context snapshot rather than the full bound dataset.
- Undo can't revert a property/translation change.

**Phase to address:** The dataset-aware safe-editing phase — but the visible binding chip and the add/modify/delete classification gate must land *before* any new bulk/transform tool is exposed, or the new tools ship destructive.

---

### Pitfall 3: nsec-encrypted settings that a NIP-46 remote signer cannot decrypt-at-rest

**What goes wrong:**
`settingsStorage.ts` already encrypts chat settings with `signer.nip44`/`nip04` self-encryption (encrypt-to-self). For a local nsec this round-trips fine. For a **NIP-46 (bunker/remote) signer**, every decrypt is a network round-trip to the remote signer and requires it to be online and to permit nip44/nip04 decryption of arbitrary ciphertext — many bunkers gate or rate-limit this. On reload the app may hang, silently fail to load API keys (chat appears "logged out of its provider config"), or throw `Active signer does not support … decryption`. Key rotation or switching accounts orphans the localStorage envelope (keyed by pubkey) with no migration, so settings silently vanish.

**Why it happens:**
encrypt-to-self via the signer is the obvious applesauce-idiomatic path and works perfectly for the maintainer's local key during development. NIP-46's latency, availability, and permission model only bite real remote-signer users; rotation isn't exercised in a solo-dev loop.

**How to avoid:**
- Detect signer capability/latency up front. If the active signer is NIP-46, treat encrypted-settings load as **async, fallible, and possibly slow** — show a real loading/failed state, never block app boot on it, and don't silently drop provider config.
- Provide an **export/import** path for settings so a user can recover when the signer changes or the bunker is unreachable. Don't make the encrypted localStorage envelope the only copy.
- Handle the **rotation / account-switch** case explicitly: detect orphaned envelopes (pubkey mismatch) and prompt re-entry rather than appearing reset.
- Never log decrypted settings, never put API keys in Zustand state that gets persisted by the devtools/redux-devtools middleware, and scrub them from any error/telemetry payloads (Pitfall 12).

**Warning signs:**
- App boot awaits `loadEncryptedChatSettings` synchronously.
- No test with a NIP-46 signer (only local-key path tested).
- `catch` around decrypt swallows the error and returns `null` (looks like "no settings" → silent data loss).
- No code path for "signer changed since these settings were written."

**Phase to address:** The encrypted-settings-persistence phase. Add a NIP-46 path and an export/import escape hatch in the same phase, not later.

---

### Pitfall 4: Over-simplification destroys topology — Douglas-Peucker on shared boundaries creates gaps/overlaps and breaks the dataset

**What goes wrong:**
The 12MB-trail story uses `@turf/turf` `simplify` (already a dependency). Turf's `simplify` is **Douglas-Peucker, per-feature, NOT topology-aware**. Run it on a dataset with shared boundaries (adjacent polygons, a road network, the West-Pacific-Trail polylines) and adjacent features simplify independently → slivers, gaps, and overlaps appear along formerly-shared edges; high tolerance collapses thin polygons to self-intersecting or zero-area geometry; the "same visual quality" claim fails at the zoom levels the user cares about. `merge-to-multi` then unions features and **drops per-feature properties** (name/description/style), so the "preserved visual quality" dataset loses exactly the attributes Story 4's recolor-by-attribute depends on.

**Why it happens:**
Turf is already installed and `simplify` is a one-liner, so it's the path of least resistance. Topology-awareness (mapshaper/Visvalingam-style) is a different, heavier algorithm not in turf. The tolerance that hits the size target is chosen by file size, not by visual/topological validity.

**How to avoid:**
- For shared-boundary data, use a **topology-aware simplifier** (mapshaper's algorithm / TopoJSON arc quantization) rather than naive turf `simplify`. If staying within turf, at minimum **validate after**: run `@turf/kinks` / `unkink-polygon` and check for new self-intersections and area collapse, and reject/retry at lower tolerance.
- Choose tolerance by **visual error budget at target zoom**, then check the size constraint — not the reverse. Binary-search tolerance to hit size *subject to* a topology-validity gate.
- `merge-to-multi` must **carry a property-merge policy** (which props survive, how conflicts resolve) and must never be applied to features the user expects to remain individually styleable/selectable. Per-feature identity is required for Story 4's data-driven styling.
- "Microgap stitch" must only join endpoints within a tight, explicit tolerance and must **never bridge distinct features** — see Pitfall 5.

**Warning signs:**
- `turf.simplify` called with a tolerance derived solely from byte size.
- No post-simplify topology validation (`kinks`/area check).
- Merge step produces a single MultiX with one merged property bag.
- Visual diff only checked at the zoom the dev happened to be on.

**Phase to address:** The geometry-optimization phase. Bake the validate-after-simplify gate and the property-merge policy into the tool itself.

---

### Pitfall 5: Microgap-stitch joins things that shouldn't join

**What goes wrong:**
To clear microgaps in the messy trail, the optimizer snaps near-coincident endpoints together. Too-loose a tolerance welds two genuinely separate trails (or a trail and a road) into one MultiLineString; topology that *should* have a junction loses it, or two parallel features collapse. The result reads as "fixed" in the thumbnail but is wrong on inspection.

**Why it happens:**
A single global snap tolerance is tuned to close the visible gaps and inadvertently exceeds the spacing between distinct features. Stitching is run blindly over the whole collection.

**How to avoid:**
- Snap tolerance must be **conservative and explicit**, ideally derived from the data's own vertex spacing, and applied only to **endpoints flagged as gap candidates**, not all vertices.
- Only stitch features that share an attribute/identity signal (same name/route) where available; never merge across distinct named features by geometry proximity alone.
- Surface a **count of joins made** in the diff/preview (Pitfall 2) so the user can catch an over-eager stitch before publish.

**Warning signs:** one global tolerance; join count not reported; features with different names merged.

**Phase to address:** Geometry-optimization phase, same tool as Pitfall 4.

---

### Pitfall 6: 12MB GeoJSON parsed/simplified/serialized on the main thread → UI freeze

**What goes wrong:**
File ingest reads a 12MB GeoJSON, `JSON.parse`s it, runs turf simplify, and `JSON.stringify`s the result — all on the main thread. The map and chat lock up for seconds; React 19 batching can't help a synchronous CPU-bound block. Excel/CSV parsing of large files has the same failure. Memory also blows up: parsed object + simplified copy + serialized string + editor feature array can be several multiples of 12MB live at once.

**Why it happens:**
Parsing/transform code is written inline in a tool handler or hook because that's where the data is. The freeze is invisible on small seed datasets.

**How to avoid:**
- Run **all ingest parsing, geometry simplification, and (de)serialization off the main thread** — reuse the same Worker infrastructure as the code interpreter (you're building it anyway). Stream results back.
- Stream/iteratively parse large CSV/JSON where possible rather than holding three full copies; free intermediates.
- Set explicit **size/feature-count thresholds** that switch to a chunked path and surface progress; cap pathological inputs with a clear error rather than OOM.

**Warning signs:** `JSON.parse`/`turf.*`/`XLSX.read` on a user file in a React event handler or tool handler; no progress UI; tab memory spikes on real files.

**Phase to address:** File-ingest phase and geometry-optimization phase — share one off-main-thread worker pipeline.

---

### Pitfall 7: Silently sending images to a non-vision model (the exact frustration to avoid) — substring vision detection is wrong

**What goes wrong:**
The existing `modelMaySupportVision()` in `store.ts` is a **substring heuristic** over a hardcoded hint list (`vision`, `vl`, `llava`, `gpt-4o`, `claude-3`, …). This both false-negatives (a vision model whose id lacks a magic word → image affordance disabled, user frustrated) and false-positives (a non-vision model whose id happens to match → image silently sent, model errors or hallucinates, tokens burned, Cashu spent). New model ids and providers drift past the list constantly. Large images also blow up the token/cost budget even on a real vision model.

**Why it happens:**
There's no reliable cross-provider capability advertisement, so a name heuristic is the pragmatic stopgap — but it's exactly the thing PROJECT.md calls out ("auto-disable image send when the model lacks vision") and it's already shipped as a guess.

**How to avoid:**
- Prefer **provider-advertised capability** (model metadata from Routstr/LM Studio/OpenAI-compatible `/models`) over name matching; fall back to the heuristic only when metadata is absent, and **mark vision support as "uncertain"** in that case rather than silently enabling.
- When uncertain, the UI should let the user **explicitly opt in** to sending the image rather than auto-sending — converts a silent failure into a visible choice.
- **Downscale/recompress images before send** and show the estimated added token cost (this provider is Cashu-paid — see Pitfall 13); strip to a sane max dimension.
- On a model error that indicates "no image support," surface a clear "this model can't see images" message and disable the affordance — don't just show a generic failure.

**Warning signs:** image attached but capability decided purely by `modelId.includes(...)`; no per-model metadata lookup; full-resolution image bytes in the request; vision toggle has no "unknown" state.

**Phase to address:** The multimodal / file-ingest phase. Replace/augment the substring heuristic with metadata + explicit-opt-in-when-unknown.

---

### Pitfall 8: Untyped switch-case tool dispatcher rots under the larger tool count

**What goes wrong:**
`execute.ts` dispatches 19 tools today via a hand-written `switch (toolCall.function.name)` with per-case ad-hoc arg parsing (`parseToolCallArguments`, `toFiniteNumber`, etc.). v1.1 adds sandbox ops, parametric-shape tools, batch transforms, data-driven styling, and ingest tools — easily doubling the count. With no shared schema, the LLM hallucinates arg names/shapes, each new case re-implements validation slightly differently, and a missing `case`/typo silently no-ops (the model "thinks" it acted). Schema drift between the tool *definitions* (`definitions.ts`) and the *executor* (`execute.ts`) means the model is told one signature and the dispatcher expects another.

**Why it happens:**
The switch worked fine at 19 tools and grew organically. Adding the next 15 by the same pattern is the path of least resistance.

**How to avoid:**
- Introduce a **single typed tool registry**: one source of truth pairing the JSON schema (sent to the model) with a validated handler (Zod/valibot parse of args → typed handler). Definition and execution can no longer drift.
- **Validate args against the schema before dispatch**; on failure return a structured tool-error to the model so it can self-correct rather than crashing or no-opping.
- Make an unknown tool name a **hard, surfaced error**, never a silent fallthrough.
- Keep the registry the place where the **safety-level gate** (Pitfall 2) and the **sandbox-RPC allow-list** (Pitfall 1) are enforced — one choke point.

**Warning signs:** new tool added as another `case` with bespoke parsing; definitions.ts and execute.ts edited separately; tool name typo produces no error; model retries a tool with different arg names each time.

**Phase to address:** A tool-infrastructure phase that lands *before* the new tools — this is a prerequisite refactor, but it amends orchestration (PROJECT.md "amend, don't replace"), it doesn't rewrite the stable tool handlers.

---

### Pitfall 9: Runaway tool loops and cost blowups on the Cashu-paid provider

**What goes wrong:**
With more tools and a sandbox the model can run, a confused model enters a loop (call tool → tool errors / returns ambiguous → call again), or the sandbox runs an infinite loop / generates millions of features. On Routstr (Cashu-prepaid, per the existing `estimateMaxCost`/`promptBudgetTokens` flow) every round-trip spends sats; a loop silently drains the wallet. The sandbox itself can `while(true)` and peg a worker, or `addFeature` in an unbounded loop and OOM the map.

**Why it happens:**
The existing budget logic bounds a *single* prompt's prepayment, not the *number of tool iterations* in an agentic turn. The sandbox has no execution-time or output-size cap.

**How to avoid:**
- Cap **tool-call iterations per turn** and **total spend per turn/session**; halt and ask the user when exceeded. Reuse `estimateMaxCost` but accumulate across the loop.
- The sandbox needs a **wall-clock timeout** (terminate the Worker) and **output caps** (max features generated, max API ops, max bytes posted back). Worker termination is the only reliable way to kill an infinite loop — design for `worker.terminate()`.
- Detect **repeated identical tool calls** (same name+args) and break the loop with a message to the model.

**Warning signs:** no iteration cap in the chat turn loop; sandbox can't be force-killed; wallet balance drops during a single "stuck" interaction; map gains thousands of features from one prompt.

**Phase to address:** Sandbox phase (timeouts/caps) + chat-loop phase (iteration/spend caps).

---

### Pitfall 10: File parsing assumes clean input — coordinate-column ambiguity, encoding, EXIF orientation, untrusted content

**What goes wrong:**
- **Coordinate detection**: CSV with `lat`/`lon` swapped, or columns named `x`/`y`/`POINT_X`/`Latitude`/`緯度`, or coordinates as `45.1,15.2` in one cell → points land in the ocean or are silently dropped. Lon/lat order is the classic GeoJSON footgun (RFC 7946 is `[lon, lat]`; humans write "lat, lon").
- **Encoding**: non-UTF-8 CSV (Windows-1252 / UTF-16 from Excel) → mojibake in the Arabic/translated names Story 4 cares about.
- **Excel**: dates as serial numbers, numeric-looking ids stripped of leading zeros, formula cells, multiple sheets.
- **Images**: EXIF orientation ignored → rotated previews; EXIF GPS could be a *useful* coordinate source but is usually ignored; EXIF can also carry sensitive location/PII silently published.
- **Untrusted content**: a malicious/garbage cell value flowing into a tool arg, a feature name, or (worst) into the code interpreter or a `fetch` URL.

**Why it happens:**
Parsers are tested on the dev's own clean exports. Real "ugly CSVs" (Story 1) are the *point* of this milestone, so the messy path is the main path, not the edge case.

**How to avoid:**
- **Detect and confirm the coordinate columns + lon/lat order with the user** (or the AI proposes, user confirms) before importing; sanity-check that points fall within `[-180,180]/[-90,90]` and within a plausible bbox; flag swapped-looking data.
- Detect encoding (BOM / heuristic) and decode explicitly; default UTF-8 but handle Windows-1252/UTF-16.
- Use a real spreadsheet parser that preserves types; treat ids as strings; surface multi-sheet choice.
- Respect EXIF orientation for previews; optionally offer EXIF-GPS as a coordinate source *with consent*; **strip EXIF on any image that gets published** to avoid leaking the uploader's location/PII.
- Never let raw file content reach the sandbox, a `fetch` URL, or an unescaped tool arg without validation — file content is untrusted input.

**Warning signs:** import "just works" only on the dev's exports; no column-mapping confirmation step; points in the Atlantic at (0,0); garbled non-Latin names; published images carrying GPS EXIF.

**Phase to address:** File-ingest phase. The column-mapping/lon-lat confirmation UI is core to Story 1, not optional.

---

### Pitfall 11: AI edits/transforms only the features in its context window, silently dropping the rest

**What goes wrong:**
The bound dataset has 400 features; the context snapshot or `get_editor_state` returns a compacted subset (the codebase already has `compactToolResultAfterBake`, `getCompactMapContextForTool`, `[image omitted for context window]` logic). The AI "translate all names" / "recolor everything" transform operates on what it can see and writes back only those, effectively deleting the unseen features or leaving them inconsistent. The user asked for "all" and got a partial, lossy result.

**Why it happens:**
Context-window economy (and the Cashu cost incentive) compacts the data sent to the model. A transform tool that takes the model's view of the data as input inherits that truncation.

**How to avoid:**
- Bulk transforms must run **over the full bound dataset by id**, executed host-side, with the AI specifying the *rule* (e.g. "for every feature where category=port set color=blue") rather than emitting the transformed features themselves. The model authors the transform; the host applies it to all features.
- The code interpreter is the right vehicle here — generated code iterates the *full* collection inside the sandbox/host, not the model's truncated view.
- The diff/preview (Pitfall 2) shows N affected of M total so partial coverage is visible.

**Warning signs:** transform tool input is the context snapshot; affected-count < dataset-count for an "all" request; features outside context unchanged or missing after a "fix all" op.

**Phase to address:** Safe-editing + sandbox phases — transforms-as-rules over full data, not model-emitted feature lists.

---

### Pitfall 12: nsec / wallet / API-key leak into memory, devtools, logs, or persisted state

**What goes wrong:**
API keys and provider config live in the Zustand chat store; if the store uses `persist` or redux-devtools, secrets serialize to localStorage/devtools in plaintext (defeating the nsec encryption). The signer's private key or Cashu proofs end up in an error boundary's logged state, a Sentry-style payload, or a console.log left in. The sandbox, if mis-bounded (Pitfall 1), reads any of these.

**Why it happens:**
Zustand devtools/persist middleware is convenient and serializes everything by default. Error logging dumps state. The decrypted-settings object is the same shape as the encrypted one and easy to accidentally persist decrypted.

**How to avoid:**
- Keep decrypted secrets out of any persisted/devtools-serialized slice; store the **encrypted envelope** only, decrypt into a transient (non-persisted) field.
- Scrub secrets from error/telemetry payloads and never `console.log` provider config or proofs.
- Confirm the sandbox boundary (Pitfall 1) denies access to these by construction.

**Warning signs:** `persist`/`devtools` middleware wrapping the slice that holds API keys; secrets visible in Application→Local Storage as plaintext; provider config appearing in error logs.

**Phase to address:** Encrypted-settings phase + sandbox phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Pass live toolbar API / store into the sandbox | Instant "map access" for generated code | Sandbox escape; full access to signer/wallet; security rewrite | **Never** |
| Keep adding `case`s to the `execute.ts` switch | No refactor, ship the next tool fast | Schema drift, silent no-ops, hallucinated args at 30+ tools | Only for 1–2 trivial read-only tools; not for the v1.1 wave |
| `turf.simplify` tolerance chosen by byte size | Hits relay size limit in one call | Topology breakage, sliver gaps, property loss | Single-feature, non-shared-boundary data only |
| Substring vision detection (current `modelMaySupportVision`) | Works for known models today | Silent image-to-blind-model sends; model drift | As *fallback* under "uncertain" flag, not as the decision |
| Apply AI edit then show result | Simpler code path | Destructive, no recovery, edits wrong dataset | Only at safety level 3 (trust+undo) with a real dataset-level snapshot |
| Decrypt settings synchronously at boot | Simple load | Hangs/fails on NIP-46; silent provider-config loss | Local-nsec-only, never for remote signers |
| Parse/transform big files on main thread | Less plumbing | Multi-second freeze, OOM on real datasets | Files under a small, enforced threshold only |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| applesauce NIP-46 signer (encrypted settings) | Treat decrypt as instant/infallible like a local key | Async, fallible, possibly-offline; loading/error UI; export/import escape hatch |
| Routstr / Cashu provider | Bound only single-prompt prepayment | Cap iterations + cumulative spend per agentic turn; halt on overrun |
| `@turf/turf` simplify/union | Use as topology-aware optimizer | It's per-feature Douglas-Peucker + property-dropping union; add topology validation + property-merge policy, or use a topology-aware simplifier |
| MapLibre GeoEditor (`setFeatures`) | AI writes straight through with no diff | Diff against bound dataset, gate by safety level, dataset-level snapshot for undo |
| Existing tool dispatcher (`execute.ts`) | Add tools as more switch cases | Typed registry: schema↔handler single source, validate-before-dispatch |
| LM Studio / custom OpenAI-compatible providers | Assume vision/`reasoning_content` behavior uniform | Per-provider capability detection (code already special-cases LM Studio context + Kimi reasoning — extend, don't assume) |
| Web Worker / iframe sandbox | Assume isolation == security boundary | Cross-origin + CSP + message-only RPC; isolation is thread/DOM, not trust |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Main-thread parse/simplify/stringify | Multi-second UI freeze on import | Off-main-thread worker pipeline; stream; free intermediates | ~1–5MB+ real files |
| Triple-copy memory (parsed + simplified + serialized + editor array) | Tab memory spike, OOM tab | Stream, transfer, release intermediates | 10MB+ inputs (the 12MB story) |
| Unbounded sandbox generation | Map gains thousands of features, render stalls | Output caps (max features/ops), wall-clock timeout | Any `for`/`while` in generated code |
| Full-res images in chat requests | Token/cost blowup, slow turns, wallet drain | Downscale/recompress before send; show cost estimate | Any phone-photo upload (multi-MB) |
| Runaway tool loop | Wallet drains while "thinking"; turn never ends | Iteration + spend caps; detect repeated calls | Ambiguous tool results, confused model |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Live host objects (signer/wallet/store) reachable from sandbox | nsec / Cashu proof exfiltration, arbitrary publish | Message-only RPC; cross-origin iframe + CSP; allow-listed host ops |
| `<iframe sandbox>` with `allow-same-origin allow-scripts` | Sandbox voided; same-origin storage/network access | No `allow-same-origin`; separate origin |
| Blob-URL Worker assumed origin-isolated | Same-origin `fetch`/storage from generated code | CSP `default-src 'none'`; treat as untrusted; no secrets in scope |
| Prototype pollution / `Function('return this')` escape | Break out of naive freezing-based sandbox | Don't rely on freezing host globals; rely on origin+process isolation + message contract |
| Secrets in persisted/devtools Zustand slice | Plaintext API keys/proofs in localStorage/devtools | Persist encrypted envelope only; decrypt to transient field |
| EXIF GPS/PII in published images | Leak uploader location | Strip EXIF before publish; consent before using EXIF-GPS |
| Untrusted file content into tool args / fetch URL / sandbox | Injection, SSRF-ish fetch, poisoned features | Validate/escape all file-derived values; never pass raw into eval or URL |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent chat→dataset binding | AI edits a dataset the user didn't realize was the target | Always-visible binding chip; no edit tool fires without a shown target |
| Apply-then-reveal AI edits | User can't catch a wrong/lossy transform before damage | Diff/preview gated by safety level *before* apply |
| Auto-send image to unknown-vision model | Confusing model error, wasted sats, the exact frustration named in PROJECT.md | Explicit opt-in when vision support is uncertain |
| "Fix all" silently fixes only the visible subset | User trusts a partial/lossy result | Transform-as-rule over full dataset; show N-of-M affected |
| Optimizer reports success by file size only | "Optimized" dataset is visually/topologically broken | Show topology-validity + join count + before/after visual diff |
| Settings vanish after signer change | User re-enters all provider config, distrusts persistence | Detect orphaned envelope, prompt; export/import |

## "Looks Done But Isn't" Checklist

- [ ] **Sandbox:** runs generated JS and draws on the map — verify it CANNOT reach the signer, wallet, store, `localStorage`, or `fetch`; verify `worker.terminate()` kills an infinite loop; verify cross-origin/CSP, not just `sandbox` attr.
- [ ] **Safe edit:** diff shows before apply — verify it diffs against the *bound* dataset, classifies add/modify/delete, respects all three safety levels, and matches features by id; verify undo reverts property/style/translation edits, not just geometry.
- [ ] **Binding chip:** present — verify no mutating tool executes when nothing is bound, and the shown target is the one actually written to.
- [ ] **Vision gating:** image affordance toggles — verify it uses provider metadata, has an "unknown" state with explicit opt-in, and downscales images.
- [ ] **Geometry optimization:** hits the size target — verify post-simplify topology validity (no new kinks/zero-area), per-feature properties survive merge, microgap stitch reports join count, and it ran off-main-thread.
- [ ] **File ingest:** parses the happy-path CSV — verify lon/lat-order confirmation, encoding handling, Excel type preservation, EXIF orientation+GPS handling, and large-file off-thread + progress.
- [ ] **Tool registry:** new tools callable — verify schema↔handler single source, arg validation before dispatch, unknown-tool hard error (no silent no-op).
- [ ] **Encrypted settings:** persists across reload — verify NIP-46 signer path, async/fallible load, orphaned-envelope handling, export/import, and that secrets are NOT in any persisted/devtools slice.
- [ ] **Cost safety:** single prompt prepayment works — verify per-turn iteration cap and cumulative spend cap stop a runaway loop.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Sandbox passed live objects | HIGH | Rip out object passing; rebuild as message-only RPC + cross-origin; re-audit every exposed op |
| AI clobbered a dataset (no snapshot) | HIGH | If unpublished, only the editor geometry stack may help (props lost); if published, fork/restore from a prior kind-37515 revision if one exists |
| AI clobbered a dataset (with dataset snapshot) | LOW | One-shot revert from pre-batch snapshot |
| Topology broken by over-simplify | MEDIUM | Re-run from original at lower tolerance with topology gate; original must be retained until publish |
| Secrets leaked to localStorage/devtools | MEDIUM | Rotate API keys/wallet, purge persisted slice, move to transient field |
| Settings lost on signer change | LOW/MEDIUM | Import from export if available; else re-enter (argues for export/import up front) |
| Image sent to blind model | LOW | Surface error, disable affordance, refund-aware (Cashu unused balance refunds) |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 Sandbox escape | Sandbox phase (boundary contract first) | Generated code provably can't reach signer/wallet/store/fetch; terminate kills loops |
| 2 AI clobbers wrong dataset | Safe-editing phase (binding chip + classify + diff first) | No mutating tool without bound+shown target; diff before apply; dataset-level undo |
| 3 NIP-46 can't decrypt settings | Encrypted-settings phase | NIP-46 signer round-trips; orphaned-envelope handled; export/import exists |
| 4 Over-simplify topology | Geometry-optimization phase | Post-simplify kink/area gate; properties survive merge |
| 5 Microgap over-stitch | Geometry-optimization phase | Conservative tolerance; join count reported |
| 6 Main-thread freeze/OOM | File-ingest + optimization phases | Off-main-thread; progress UI; memory bounded on 12MB input |
| 7 Image to non-vision model | Multimodal phase | Metadata-based gating + unknown opt-in + downscale |
| 8 Untyped dispatcher rot | Tool-infra phase (prereq to new tools) | Typed registry; validate-before-dispatch; unknown-tool error |
| 9 Runaway loop / cost blowup | Sandbox + chat-loop phases | Iteration + spend caps; sandbox timeout/output caps |
| 10 Dirty file parsing | File-ingest phase | Lon/lat confirm; encoding; Excel types; EXIF; untrusted-input validation |
| 11 Transform drops out-of-context features | Safe-editing + sandbox phases | Transform-as-rule over full dataset by id; N-of-M shown |
| 12 Secret leak | Encrypted-settings + sandbox phases | No secrets in persisted/devtools slice or logs |

## Scope / Integration Coupling Note (PROJECT.md "amend, don't replace")

This milestone touches editor + rendering + publish dialog + wallet/signer simultaneously. Two coupling risks specific to Earthly:

- **The toolbar/drawing API is the seam everything routes through** (sandbox RPC, AI tools, direct UI). PROJECT.md mandates it be designed "as if a future package export, no internal store coupling." If the sandbox or new AI tools reach into the Zustand store directly (as `execute.ts` does today via `useEditorStore`), this constraint is violated at exactly the moment it matters most. Route new map mutations through the clean API, not the store.
- **Amend the dispatcher and store slices; don't reimplement the GeoEditor managers or stable panels.** The prior UX rewrite failed by reimplementing stable leaves. The typed-tool-registry refactor (Pitfall 8) and the safety/diff gate (Pitfall 2) are *orchestration* changes (the right target). Resist rewriting `LayerManager`/`RenderingManager`/publish dialog internals to accommodate AI — adapt at the orchestration boundary.

## Sources

- Codebase grounding: `src/features/chat/tools/execute.ts` (19-tool switch dispatcher), `src/features/chat/store.ts` (`modelMaySupportVision` substring heuristic, Routstr/Cashu prepayment, context compaction), `src/features/chat/settingsStorage.ts` (nip04/nip44 encrypt-to-self), `.planning/PROJECT.md` (v1.1 scope, decisions, "amend don't replace")
- [Running untrusted code safely in browsers — formsort](https://formsort.com/article/sandboxed-code-in-browsers/)
- [A Deep Dive into JavaScript Sandboxing — Leapcell](https://leapcell.medium.com/a-deep-dive-into-javascript-sandboxing-bbb0773a8633)
- [jailed — execute untrusted code with custom permissions](https://github.com/asvd/jailed)
- [Service Worker bypasses iframe[sandbox] — Chromium bug 486308](https://bugs.chromium.org/p/chromium/issues/detail?id=486308)
- [mapshaper Topology Issues wiki](https://github.com/mbloch/mapshaper/wiki/Topology-Issues)
- [Self Intersections — topojson/topojson #121](https://github.com/topojson/topojson/issues/121)
- [@turf/intersect MultiPolygon returns null — Turfjs/turf #2069](https://github.com/Turfjs/turf/issues/2069)
- RFC 7946 (GeoJSON) coordinate order `[lon, lat]` — known authoring footgun

---
*Pitfalls research for: browser code-interpreter + AI destructive-edit + file-ingest/multimodal + geometry-optimization on a mature MapLibre/Nostr app (Earthly v1.1)*
*Researched: 2026-06-16*
