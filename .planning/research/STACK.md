# Stack Research

**Domain:** AI chat data-ingest + sandboxed code interpreter + geometry optimization for a Bun/React 19/MapLibre browser app (Earthly v1.1)
**Researched:** 2026-06-16
**Confidence:** HIGH (versions verified against npm registry + official docs; capability-detection and signer constraints verified against Ollama API docs and NIP specs)

> Scope note: the existing stack (Bun, React 19, TS strict, MapLibre GL v5, Tailwind v4, Radix, applesauce-core, Zustand, the OpenAI-compatible chat client) is **fixed** and not re-evaluated. Everything below is **additive** for the six v1.1 capabilities. Two items below are **already partially present** in the repo — flagged inline so the roadmap amends rather than rebuilds.

---

## Recommended Stack

### Core Technologies (new dependencies to add)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **papaparse** | `5.5.3` (MIT) | CSV / plain-delimited text parsing in browser | De-facto standard, zero-dep, streaming + worker support, robust type/delimiter/header inference. ~258 KB unpacked, ~20 KB min+gz. Handles the "ugly CSV" story (US-1) including quoted fields, BOM, and ragged rows. |
| **xlsx (SheetJS CE)** | `0.20.3` via **SheetJS CDN tarball**, NOT npm | Excel `.xlsx`/`.xls`/`.ods` parsing | Only viable full-featured spreadsheet reader for browser. **The npm `xlsx` is stale at `0.18.5` (2022) and carries a known prototype-pollution advisory** — install the current `0.20.3` from `https://cdn.sheetjs.com` via a package.json dependency pin (see Installation). Use `read` + `sheet_to_json`. |
| **quickjs-emscripten** | `0.32.0` (MIT) | Client-side JS sandbox for the code interpreter | WASM-compiled QuickJS (vendored bellard/quickjs 2025-09 build). True isolation: no DOM, no `fetch`, no prototype-chain escape into host realm. Host exposes a *curated* API by explicitly injecting functions — exactly the toolbar/drawing-API requirement. Memory + interrupt (cycle) limits prevent runaway generated code. |
| **MapLibre GL JS** | `5.24.0` (already installed) | Data-driven styling | No new dep. Use style-spec **expressions** (`get`/`match`/`interpolate`/`step`/`case`) in paint properties. Fully supported in v5. |
| **@turf/turf** | `7.3.5` (already installed) | Geometry simplify / merge / clean | Already a dependency. `simplify` (Douglas-Peucker, with `highQuality` Visvalingam-ish option), `combine` (LineString→MultiLineString), `cleanCoords`, `truncate`. Covers the 12 MB→900 KB story. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@turf/simplify** (scoped) | from turf `7.x` | Tree-shakeable simplify only | Already present transitively in `node_modules/@turf/`. Import the scoped package (`@turf/simplify`) in worker/sandbox code instead of `@turf/turf` to avoid pulling the whole 600+ KB turf barrel into a bundle. |
| **simplify-js** | `1.2.4` (BSD-2) | Pure point-array Douglas-Peucker | Optional micro-dependency (~1 KB). Only if you need to simplify raw `[x,y]` arrays *outside* GeoJSON without turf overhead. Turf's `simplify` is preferred for consistency; do not add unless profiling shows turf is too heavy in the worker. |
| **topojson-server / topojson-client** | `3.x` (already installed) | Topology-preserving simplification + shared-edge dedup | **Already in `node_modules`.** This is the right tool for the microgap-stitch / merge problem when polylines share endpoints: `topology()` → `presimplify()`/`simplify()` → `merge()` collapses shared arcs and removes near-duplicate vertices far better than per-feature Douglas-Peucker. Recommend topojson for the merge-to-multi + microgap step, turf `simplify` for per-line vertex reduction. |
| **applesauce-signers `ISigner`** | `^6 / next` (already installed) | NIP-44 encrypt-to-self for settings at rest | **Already used** in `src/features/chat/settingsStorage.ts`. No new dep. `signer.nip44.encrypt(ownPubkey, plaintext)` works for NIP-07 *and* NIP-46 remote signers without exposing the raw nsec. |
| **nostr-tools/nip49** | `2.23.5` (Unlicense) | `ncryptsec` password-encrypted key (fallback only) | Optional. Only relevant for the narrow case of encrypting a *locally-held* nsec with a user password (scrypt + XChaCha20-Poly1305). NOT the primary path — see "What NOT to Use". |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Web Worker (Bun/browser native) | Host the QuickJS sandbox off the main thread | No library needed. Run `quickjs-emscripten` inside a `Worker`; the worker is the trust boundary's outer shell, QuickJS is the inner one. Use `structuredClone`-able messages only. |
| Bun bundler `define` (existing `build.ts`) | Inject the SheetJS/quickjs WASM asset paths | quickjs ships a `.wasm` variant — ensure the bundler copies/serves it; quickjs-emscripten resolves variants via dynamic import. |
| Biome (existing) | Lint the new code | No config change. |

---

## Installation

```bash
# CSV
bun add papaparse@5.5.3
bun add -D @types/papaparse

# Sandbox
bun add quickjs-emscripten@0.32.0

# Geometry: @turf/turf 7.3.5 + topojson-* already present — no install needed.
# If isolating in worker, optionally add scoped turf to make intent explicit:
# bun add @turf/simplify @turf/combine @turf/clean-coords

# Excel — DO NOT `bun add xlsx` (gets stale 0.18.5). Pin the CDN tarball:
```

`package.json` for SheetJS (current `0.20.3`, Apache-2.0):

```jsonc
{
  "dependencies": {
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  }
}
```

Then `bun install`. (Bun supports remote-tarball deps. Verify the integrity hash from `https://cdn.sheetjs.com/` after install.)

---

## Capability detection (multimodal gating) — design, not a library

There is **no standard field** for vision in an OpenAI-compatible `/v1/models` response (verified — OpenAI's own endpoint returns only `id/object/created/owned_by`). Detection must be layered, best-source-first:

1. **Ollama (and Ollama-compatible):** call `POST /api/show` with `{ "model": "<id>" }`. The response includes a **`capabilities` array** containing strings such as `"completion"`, `"vision"`, `"tools"`, `"insert"`, `"embedding"`, `"thinking"`. Presence of `"vision"` is authoritative. (Confirmed against Ollama API docs: example shows `capabilities: ["completion", "vision"]`.) This is Ollama's native API, *not* the `/v1` OpenAI shim — call it directly when the provider is Ollama.
2. **LM Studio:** its `/v1/models` is OpenAI-shaped and does **not** advertise vision; LM Studio's native `/api/v0/models` (REST) is richer but not guaranteed. Treat LM Studio like "custom" → fall to heuristics.
3. **Routstr / OpenRouter-style aggregators:** some expose `architecture.input_modalities` / `modalities` containing `"image"`. Probe for it; trust it when present.
4. **Heuristic fallback (name match):** lowercase model id contains any of: `vl`, `vision`, `-v`, `llava`, `bakllava`, `gpt-4o`, `gpt-4.1`, `gpt-5`, `gemini`, `claude-3`/`claude-4`, `qwen*-vl`, `llama*vision`/`mllama`, `pixtral`, `moondream`, `internvl`, `minicpm-v`, `gemma*` (3+). Conservative: unknown → assume **no** vision, disable the image affordance (fail safe).
5. **Optional active probe:** for "custom" endpoints, a tiny image + `image_url` message; if the server 400s with an image-unsupported error, mark no-vision and cache per `(baseUrl, model)`.

Cache the resolved verdict keyed by `(provider, baseUrl, modelId)` in the chat store. Gate the image-upload button on it.

---

## Code-interpreter sandbox — isolation vs host-API exposure (the load-bearing decision)

**Recommendation: QuickJS-WASM (`quickjs-emscripten`) running inside a Web Worker.** This is the same family of approach as LM Studio's `js-code-sandbox` (which also runs untrusted model-authored JS in an isolated VM rather than the page realm).

Why not the alternatives:

| Approach | Isolation | Host-API exposure | Verdict |
|----------|-----------|-------------------|---------|
| **Web Worker alone** (run code via `eval`/Function in the worker) | Weak — code runs in the *worker's own realm*: it can access `fetch`, `WebSocket`, `importScripts`, timers, and any global the worker has. Untrusted model code escapes trivially. | Easy (just call functions) but unsafe | ❌ as the sandbox itself |
| **`<iframe sandbox>`** (sandbox + no `allow-same-origin`) | Good origin isolation, but JS still runs in a *full browser realm* (has `fetch`, DOM of the iframe, `postMessage`, can spin its own workers). Curated-API calls require async `postMessage` round-trips for *every* host call. | Awkward: all host calls are async message round-trips | △ heavier, more attack surface |
| **QuickJS-WASM in a Worker** | Strong — the VM has **no host globals at all** (no `fetch`, `DOM`, `setTimeout`, prototype-chain into host). You start from an empty realm and add only what you inject. Memory limit + interrupt handler kill runaway/`while(true)` code. | **Best for this use case** — host functions injected explicitly become the *entire* surface the model can touch. | ✅ recommended |

**Host-API exposure pattern (QuickJS):**
- The Worker holds the QuickJS `context`. It builds a frozen `earthly` global object and injects curated functions with `context.newFunction("drawCircle", (args) => …)`. Each injected function validates/whitelists its arguments, then forwards the *intent* to the main thread via `worker.postMessage` (because the actual toolbar/drawing API and MapLibre live on the main thread).
- Round trip: sandbox JS calls `earthly.drawCircle(...)` → worker host-fn serializes a command → main thread executes against the **clean toolbar drawing API** (the package-boundary API the project is already designing) → result/handle posted back. Synchronous-looking calls can use QuickJS's async/`Asyncify` variant, or expose only fire-and-forget + a `commit()` barrier to keep it simple.
- This gives the exact property the milestone needs: **the model can drive the map only through the same explicit verbs the UI uses, and through nothing else.** No DOM, no network, no Nostr keys reachable from sandboxed code.
- `quickjs-emscripten-sync` (a wrapper) can auto-marshal host objects into the VM if you want richer object exposure; start without it (explicit `newFunction` injection is more auditable) and adopt only if marshalling tabular data structures becomes tedious.

Feeding ingested data to the sandbox + the LLM:
- Parsed CSV/Excel → a normalized `{ columns, rows }` JSON structure. Inject into the VM as a frozen global (or via a `getData()` host fn). Give the **same** structure to the LLM as a compact text/markdown table preview (truncate to N rows + schema) so the model can reason about it and write code against it.

---

## MapLibre data-driven styling (no new dependency)

Apply attribute-driven paint via style-spec expressions (verified working in v5):

```jsonc
// categorical color (ports vs airports vs waterways) — US-4
"circle-color": ["match", ["get", "category"],
  "port", "#1f77b4", "airport", "#d62728", "waterway", "#2ca02c",
  /* default */ "#888888"]

// numeric width ramp
"line-width": ["interpolate", ["linear"], ["get", "importance"], 0, 1, 100, 6]

// stroke by boolean/condition
"line-color": ["case", ["==", ["get", "verified"], true], "#0a0", "#aaa"]
```
The AI tool layer should emit these expression arrays as data and hand them to `LayerManager.setPaintProperty`. No runtime styling library is needed or wanted.

---

## Encrypted settings at rest (already shipped — extend, don't rebuild)

`src/features/chat/settingsStorage.ts` **already implements** the correct pattern: encrypt the settings JSON with `signer.nip44.encrypt(ownPubkey, …)` (encrypt-to-self), fall back to `nip04`, store the ciphertext envelope in `localStorage` keyed by pubkey.

This is the right design and resolves the NIP-07/NIP-46 constraint cleanly:
- **NIP-07** (`window.nostr`) and **NIP-46** (remote bunker) expose `nip44.encrypt`/`nip44.decrypt` (and `signEvent`/`getPublicKey`) but **never the raw nsec**. Because we encrypt *to our own pubkey*, we never need the private key in the page — the signer does the ECDH internally. Works identically for extension and bunker signers.
- v1.1 work = **broaden the payload** to include provider config / API keys / LM Studio + Ollama addresses, and harden envelope versioning. No new crypto dependency.

**Do not** add a NIP-49/`ncryptsec` password flow as the primary mechanism — it requires a raw nsec to encrypt and a user-typed password, neither of which is available/desirable when the user signs via NIP-07/NIP-46. Keep nip49 only as an optional escape hatch for users who explicitly hold a local nsec and want a portable password-encrypted backup.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| papaparse | `csv-parse`, `d3-dsv` | `d3-dsv` is lighter (~5 KB) if you only need clean, well-formed CSV and no worker/streaming. papaparse wins for messy real-world files and large-file streaming. |
| SheetJS `xlsx` 0.20.3 (CDN) | `exceljs` 4.4.0, `read-excel-file` 9.2.0 | `read-excel-file` is smaller and fine if you *only* read simple `.xlsx`. `exceljs` if you also need to **write** styled workbooks. SheetJS wins on format breadth (xls/ods/csv/numbers) and read robustness. |
| quickjs-emscripten | `<iframe sandbox>` + postMessage; ShadowRealm | ShadowRealm (TC39) is not yet shipping cross-browser — revisit later. iframe-sandbox is acceptable if you never need fine-grained host-fn injection and prefer a pure message protocol. |
| turf `simplify` + topojson `merge` | `@mapbox/geojson-vt`, `mapshaper` (CLI) | mapshaper gives superior topology-aware simplification but is a CLI/heavy lib — not for in-browser per-ingest use. Use turf+topojson in-browser; if quality is insufficient at extreme scale, consider a server-side mapshaper pass (out of scope for v1.1). |
| Ollama `/api/show` capabilities | name heuristics only | Heuristics are the *fallback* for non-Ollama/custom endpoints; prefer real metadata when the provider gives it. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`npm/bun add xlsx` (0.18.5)** | Stale 2022 build; carries a prototype-pollution advisory; missing 2 years of fixes. SheetJS stopped publishing to npm. | Pin `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` in package.json. |
| **Running model-authored JS in the Web Worker realm directly (`eval`/`new Function`)** | The worker has `fetch`, `WebSocket`, timers, `importScripts` — untrusted code escapes the intended sandbox immediately. | QuickJS-WASM VM *inside* the worker; inject only curated host fns. |
| **`vm2`** | Deprecated/abandoned with known sandbox-escape CVEs; Node-only anyway. | quickjs-emscripten. |
| **NIP-49 `ncryptsec` as the primary settings-encryption path** | Needs the raw private key (unavailable under NIP-07/NIP-46) and a user password. | `signer.nip44.encrypt(ownPubkey, …)` (already implemented). |
| **NIP-04 as the new default scheme** | Legacy, weaker (no key-commitment/AAD), deprecated in favor of NIP-44. | nip44 with nip04 only as a compat fallback (as current code already does). |
| **Importing the full `@turf/turf` barrel inside the sandbox worker** | Pulls 600+ KB and dozens of unused fns into the worker bundle. | Import scoped `@turf/simplify`, `@turf/combine`, `@turf/clean-coords`. |
| **A client-side LLM "guess" to detect vision** | Wastes a round trip and is unreliable. | `/api/show` capabilities → modalities field → name heuristic → optional probe. |

---

## Stack Patterns by Variant

**If the provider is Ollama:**
- Use native `POST /api/show` for authoritative `capabilities` (vision/tools/thinking). Best signal available.

**If the provider is LM Studio / custom / Routstr:**
- Try `modalities`/`input_modalities` on the models response; else name-heuristic; else optional image probe. Default to no-vision (fail safe).

**If the ingested GeoJSON is "many short lines with microgaps" (US-5):**
- topojson `topology()` → `presimplify()` → `simplify(weightThreshold)` → `merge()`/`mergeArcs` to stitch shared edges and collapse near-duplicate vertices, then convert back. Apply turf `cleanCoords` + `simplify` per-feature only for residual vertex bloat.

**If the ingested GeoJSON is "one huge polygon with too many vertices":**
- turf `simplify({ tolerance, highQuality: true })` is sufficient; topojson adds little for single features.

**If sandboxed code needs synchronous host calls:**
- Use the QuickJS **Asyncify** variant (lets injected host fns return promises that suspend the VM) — slightly larger WASM but enables `await earthly.route(...)` ergonomics. Otherwise expose fire-and-forget verbs + a final `commit()`.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `papaparse@5.5.3` | Bun + React 19 | Pure JS, no native deps; Bun runs it directly. Use the worker option in-browser only. |
| `xlsx@0.20.3` (CDN) | Bun | Pure JS; the `.tgz` install works under `bun install`. Avoid the npm `0.18.5`. |
| `quickjs-emscripten@0.32.0` | Bun + browser Worker | Ships multiple WASM variants (sync, asyncify, debug); ensure the chosen variant's `.wasm` is served. ~2.4 MB unpacked total, but only the selected variant `.wasm` (a few hundred KB) loads at runtime. |
| `@turf/turf@7.3.5` | already in tree | Scoped `@turf/*` 7.x packages present transitively — safe to import directly. |
| `maplibre-gl@5.24.0` | already in tree | Expressions stable since pre-v1; no concerns. |
| `applesauce-signers` (current) | already in tree | `ISigner.nip44` present on extension + remote signers; encrypt-to-self needs no raw key. |

---

## Sources

- npm registry `latest` dist-tags (queried 2026-06-16): papaparse 5.5.3 (MIT), xlsx 0.18.5 *(stale)*, quickjs-emscripten 0.32.0 (MIT), simplify-js 1.2.4, topojson-client 3.1.0, @turf/turf 7.3.5, nostr-tools 2.23.5 — HIGH
- SheetJS CDN + issue tracker (git.sheetjs.com #3225/#3111/#3098) — npm is out of date at 0.18.5; current is 0.20.3 via CDN tarball — HIGH
- Ollama API docs (`github.com/ollama/ollama/blob/main/docs/api.md`) — `/api/show` returns `capabilities: ["completion","vision", …]` — HIGH
- OpenAI API reference + community thread "Expose Model Capabilities in /v1/models" — confirms NO standard vision field in `/v1/models`, heuristics required — HIGH
- justjake/quickjs-emscripten README (quickjs-emscripten-core, variants, host fn injection) + Simon Willison TIL — sandbox isolation + host fn exposure model — HIGH
- MapLibre style-spec expressions docs (`maplibre.org/maplibre-style-spec/expressions/`) — get/match/interpolate/step/case, v5 supported — HIGH
- NIP-49 (`github.com/nostr-protocol/nips/blob/master/49.md`) + NIP-46/NIP-07 docs — ncryptsec needs raw key; remote/extension signers expose nip44.encrypt but not nsec — HIGH
- Repo: `src/features/chat/settingsStorage.ts` — encrypt-to-self via `signer.nip44` already shipped; `node_modules/@turf/*` + `topojson-*` already present — HIGH (direct code read)

---
*Stack research for: Earthly v1.1 AI Chat — Data Ingest, Transform & Safe Authoring*
*Researched: 2026-06-16*
