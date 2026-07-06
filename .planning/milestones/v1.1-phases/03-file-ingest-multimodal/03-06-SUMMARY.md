---
phase: 03-file-ingest-multimodal
plan: 06
subsystem: ui
tags: [chat-ui, file-ingest, multimodal, vision-gate, file-chip, d-08, d-09, d-10, d-11, uat]

# Dependency graph
requires:
  - phase: 03-file-ingest-multimodal (Plan 02)
    provides: parseFileInWorker — off-thread CSV/xlsx/json/text parse client (no UI freeze)
  - phase: 03-file-ingest-multimodal (Plan 03)
    provides: ingestStore (putDataset/getDataset/toModelSummary), deriveIngestSummary, detectCoordinateColumns, assertFileWithinCaps (D-11 handle-keyed seam + DoS caps)
  - phase: 03-file-ingest-multimodal (Plan 04)
    provides: detectVisionSupport(provider,modelId)→'vision'|'no-vision'|'uncertain' (the D-07/D-09 single capability source the gate consumes)
  - phase: 03-file-ingest-multimodal (Plan 05)
    provides: place_dataset_features + batch_geocode tools (the AI-callable place-on-map path the UAT exercises)
  - phase: 02 (Tool Registry & Authoring API)
    provides: ChatGeometryAttachment controlled {value,onChange} idiom + ChatPanel send loop the new strip mounts beside
provides:
  - FileChipStrip — D-10 NEW chip strip (Attach-file button + native drag-drop + one FileChip per file) mounted ALONGSIDE ChatGeometryAttachment
  - FileChip — per-file chip: type icon + filename + compact stat line + remove (X) + Collapsible/Popover expand (no always-on data grid, D-03)
  - fileAttachHandler.handleAttachedFile(file, deps) — pure, dependency-injected attach orchestration (assertFileWithinCaps → parseFileInWorker → putDataset, order pinned)
  - VisionGateControl — D-08 three-tier image-send affordance (enabled / hard-disabled+tooltip / uncertain+Send-anyway) driven by detectVisionSupport, governing BOTH attached images and capture_map_snapshot (D-09)
  - composeOutboundContent(args) — exported pure send-composer; dataset attaches as {handleId, summary} (NEVER fullRows, D-11), image_url included only when the gate permits
affects:
  - "Phase 4 sandbox: the file chip's handle is the same getDataset(handleId) seam sandboxed code reads ingested data through"
  - "Phase 5 safe editing: the place-on-map action surfaced here is the user-facing entry to the full-dataset write path that the binding chip will gate"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dependency-injected pure attach orchestration: handleAttachedFile(file, { assertFileWithinCaps, parseFileInWorker, putDataset, deriveIngestSummary, readImageDataUrl }) is unit-tested below the UAT by mocking deps and asserting the assertFileWithinCaps → parseFileInWorker → putDataset CALL ORDER + over-cap short-circuit (WARNING-5)."
    - "Send-path D-11 invariant tested at the COMPOSITION layer (not only the store): composeOutboundContent is exported so ingestSendPath.test.ts deep-scans the serialized payload for any non-sampled row — handle+summary present, fullRows absent (BLOCKER-3)."
    - "Three-tier gate as a single source for two image paths: VisionGateControl + composeOutboundContent both read the one detectVisionSupport result; 'no-vision' blocks image_url, 'uncertain' requires sendAnyway, 'vision' enabled — the same gate capture_map_snapshot obeys (D-09)."
    - "New strip mounted ALONGSIDE ChatGeometryAttachment (not folded in), mirroring its controlled {files,onChange} contract — geometry-attach and file-attach stay independent surfaces in the same flex-wrap row."

key-files:
  created:
    - src/features/chat/components/FileChipStrip.tsx
    - src/features/chat/components/FileChip.tsx
    - src/features/chat/components/fileAttachHandler.ts
    - src/features/chat/components/fileAttachHandler.test.ts
    - src/features/chat/components/VisionGateControl.tsx
    - src/features/chat/composeOutboundContent.ts
    - src/features/chat/ingestSendPath.test.ts
  modified:
    - src/features/chat/ChatPanel.tsx
    - src/features/chat/store.ts

key-decisions:
  - "composeOutboundContent extracted to its OWN module (src/features/chat/composeOutboundContent.ts) rather than inlined in ChatPanel.tsx — the plan's <artifacts_this_phase_produces> named it a ChatPanel helper, but a separate pure module lets ingestSendPath.test.ts import it without rendering ChatPanel (mirrors the fileAttachHandler extraction). ChatPanel imports it for the live send path."
  - "VisionGateControl exposes the opt-in as a controlled { sendAnyway, onSendAnywayChange } pair (not an internal toggle) so ChatPanel owns the send-anyway state that composeOutboundContent reads — the gate UI and the send composition share one source of truth."
  - "fileAttachHandler kept DOM-free (readImageDataUrl injected) so the WARNING-5 attach-order + over-cap test runs headless under bun:test with mocked deps — no Worker, no FileReader, no component render."

patterns-established:
  - "Pattern: extract the send-composition into an exported pure function so the D-11 no-fullRows-leak invariant is asserted at the literal send boundary, not only at the store mirror."
  - "Pattern: controlled three-tier gate — the affordance component takes the capability result + a controlled opt-in pair, and the same result feeds the headless composer, so UI state and outbound payload can never diverge."

requirements-completed: [INGEST-01, INGEST-04, INGEST-05, INGEST-07]

# Metrics
duration: continuation
completed: 2026-06-17
---

# Phase 3 Plan 06: File-Chip Strip, Image Attach & Three-Tier Vision Gate (INGEST-01/04/05/07) Summary

**The visible surface of the phase: a dedicated file-chip strip (D-10) with a button AND native drag-and-drop attach path (one `FileChip` per file — type icon, truncated name, compact parse stat line, expandable via Collapsible/Popover, no always-on grid), the user-attached-image path (FileReader → `image_url`, INGEST-04), and the three-tier `VisionGateControl` (D-08 enabled / hard-disabled+tooltip / uncertain+Send-anyway) driven by the Plan-04 vision ladder and governing both image paths (D-09) — all mounted in `ChatPanel` beside `ChatGeometryAttachment`. The send path composes each dataset as `{handleId, summary}` and NEVER `fullRows` (D-11), proven by `ingestSendPath.test.ts` at the composition layer. UAT (6 checks) approved.**

## Performance
- **Tasks:** 3 (Tasks 1 & 2 TDD-autonomous, Task 3 UAT human-verify)
- **Files:** 7 created, 2 modified
- **Execution:** Tasks 1 & 2 executed by a prior executor; this continuation agent finalized after UAT approval.

## Accomplishments
- **Two attach paths (INGEST-01):** `FileChipStrip` provides an `Attach file` trigger (`Paperclip`, hidden `<input type="file" multiple>`) AND native `onDragOver`/`onDrop` with the `Drop files to attach` dashed affordance, mounted ALONGSIDE `ChatGeometryAttachment` (not folded in). One `FileChip` renders per attached file.
- **Pure attach orchestration:** `handleAttachedFile(file, deps)` (`fileAttachHandler.ts`) runs `assertFileWithinCaps` FIRST, then (non-image) `parseFileInWorker` → `putDataset` → `deriveIngestSummary`, or (image) `readImageDataUrl` → `image_url` part. The strict order + over-cap short-circuit is pinned by `fileAttachHandler.test.ts` (WARNING-5: a rejected file NEVER reaches `parseFileInWorker`/`putDataset`; an image NEVER reaches the parse path).
- **Per-file parse summary, no grid (INGEST-05/D-03):** each `FileChip` shows the compact `deriveIngestSummary` stat line (rows × cols, detected coordinate columns), expandable via Collapsible/Popover for the fuller per-type summary — no always-on data grid. Status visuals (parsing/parsed/failed/image-uncertain/image-unsupported) per the UI-SPEC Color table.
- **User image attach (INGEST-04):** image files encode to a data URL into the existing `image_url` content part, gated by the vision ladder; over-cap files surface the "too large" copy via `assertFileWithinCaps`.
- **Three-tier vision gate (INGEST-07/D-08):** `VisionGateControl` renders `'vision'` → enabled; `'no-vision'` → hard-disabled with a `Tooltip` reason (`{model} doesn't support images…`); `'uncertain'` → amber badge + explicit `Send anyway` opt-in. The same gate governs attached images AND `capture_map_snapshot` (D-09, wired in Plan 04).
- **D-11 send-path invariant (BLOCKER-3 / success criterion #2):** `composeOutboundContent` includes each dataset as `{handleId, summary}` (from `toModelSummary`) and NEVER the raw `fullRows`; `image_url` parts are included ONLY when `support === 'vision'` or (`'uncertain'` AND `sendAnyway`), never on `'no-vision'`. `ingestSendPath.test.ts` deep-scans the serialized payload — handle+summary present, no non-sampled row leaks.

## Task Commits
1. **Task 1 (RED):** `c5ea740` (test) — `fileAttachHandler.test.ts`: attach-order + over-cap short-circuit + image-branch.
2. **Task 1 (GREEN):** `f66d9b9` (feat) — `FileChipStrip` + `FileChip` + extracted `fileAttachHandler`.
3. **Task 2 (RED):** `6940fe8` (test) — `ingestSendPath.test.ts`: `composeOutboundContent` D-11 invariant + three-tier image gate.
4. **Task 2 (GREEN):** `6ba8311` (feat) — `VisionGateControl` + `ChatPanel` mount/wiring + `composeOutboundContent` (D-11) + `store.ts` send wiring.
5. **Task 3 (UAT):** human-verify checkpoint — **APPROVED** (no code changes).

**Plan metadata:** see final docs commit.

## Component Contracts (for downstream)

```ts
// FileChipStrip — controlled, mirrors ChatGeometryAttachment {value,onChange}
FileChipStrip({ files: AttachedFileView[], onChange: (files: AttachedFileView[]) => void, ... })

// FileChip — one chip
FileChip({ file, summary, status, onRemove })

// fileAttachHandler — pure, dependency-injected (testable below UAT)
handleAttachedFile(file, {
  assertFileWithinCaps, parseFileInWorker, putDataset, deriveIngestSummary, readImageDataUrl
}): Promise<AttachResult>  // image → {kind:'image_url',...}; tabular → {handleId, summary, status}; over-cap → {ok:false, reason}

// VisionGateControl — three-tier, controlled opt-in
VisionGateControl({ support: VisionSupport, modelName, sendAnyway, onSendAnywayChange, disabled? })

// composeOutboundContent — exported pure send-composer (D-11)
composeOutboundContent({ text, attachedFiles, visionSupport, sendAnyway }): ChatMessageContent
//   dataset attach → {handleId, summary} (NEVER fullRows); image_url only when gate permits
```

## Decisions Made
- **`composeOutboundContent` extracted to its own module** (`src/features/chat/composeOutboundContent.ts`) rather than inlined in `ChatPanel.tsx` — lets `ingestSendPath.test.ts` import and exercise the D-11 invariant headlessly without rendering `ChatPanel`. `ChatPanel` imports it for the live send path. (The plan named it a ChatPanel helper; extraction is the established `fileAttachHandler` pattern applied to the composer.)
- **Controlled `{ sendAnyway, onSendAnywayChange }` opt-in** — `VisionGateControl` does not own the toggle internally; `ChatPanel` owns the state that `composeOutboundContent` reads, so the gate UI and the outbound payload share one source of truth and cannot diverge.
- **`fileAttachHandler` kept DOM-free** (`readImageDataUrl` injected) — the WARNING-5 order/short-circuit test runs headless with mocked deps (no Worker, no FileReader, no render).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Structure] `composeOutboundContent` placed in its own module, not inlined in `ChatPanel.tsx`**
- **Found during:** Task 2 (D-11 send-path RED).
- **Issue:** The plan's `<artifacts_this_phase_produces>` describes `composeOutboundContent(...)` as a "ChatPanel helper … exported for `ingestSendPath.test.ts`". Inlining it in `ChatPanel.tsx` and exporting from there would force the test to import the full ChatPanel module (pulling in the chat send loop, NDK, store wiring) just to call one pure function.
- **Fix:** Extracted to `src/features/chat/composeOutboundContent.ts` as a standalone pure module (same extraction idiom as `fileAttachHandler.ts`). `ChatPanel.tsx` imports it for the live send; `ingestSendPath.test.ts` imports it directly.
- **Files modified:** `src/features/chat/composeOutboundContent.ts` (created); `src/features/chat/ChatPanel.tsx` (imports it).
- **Verification:** `bun test src/features/chat/ingestSendPath.test.ts` green; D-11 invariant + three-tier image gate asserted at the composition boundary.
- **Committed in:** `6940fe8` (RED) / `6ba8311` (GREEN).

---

**Total deviations:** 1 auto-fixed (Rule 3 structural — module placement). No contract, scope, file-name, prop, or copy-string change beyond moving one named helper into its own file.

## UAT Outcome — APPROVED
All 6 UAT checks confirmed working by the user:
1. **Attach button** — chip appears with rows × columns + detected coordinate column(s), expandable, no freeze.
2. **Drag-and-drop** — chip with feature count / bbox for a dropped GeoJSON.
3. **Over-cap file** — the "too large" copy surfaces (`assertFileWithinCaps`).
4. **Place-on-map full-dataset** — the AI calls `place_dataset_features` (Plan 05) and ALL rows appear (not just sampled); place-name-only rows geocode via `batch_geocode` (bounded/throttled).
5. **Three-tier vision** — enabled on a confirmed-vision model; hard-disabled + tooltip on a confirmed-no-vision model; amber badge + `Send anyway` opt-in on an uncertain model (image NOT sent unless opted in).
6. **D-09 snapshot gate** — `capture_map_snapshot` obeys the same gate.

## Known Stubs
None — every component is fully wired (attach paths → parse → store → send composition → gate). No placeholder data sources; the file chip's summary is the live `deriveIngestSummary` output and the send path carries the real `toModelSummary` handle.

## Threat Mitigations Applied
- **T-03-19 (huge file dropped, DoS):** `assertFileWithinCaps` enforced FIRST in `handleAttachedFile` before any parse (order pinned by `fileAttachHandler.test.ts` WARNING-5) + the "too large" copy; off-thread parse (Plan 02) keeps the UI responsive (UAT check 1 — no freeze).
- **T-03-20 (image silently sent to a non-vision model, Information Disclosure):** `VisionGateControl` hard-disables `'no-vision'` and requires `Send anyway` for `'uncertain'`; `composeOutboundContent` includes no `image_url` on `'no-vision'`; `ingestSendPath.test.ts` asserts this — never a silent send (acceptance criterion #4, UAT check 5).
- **T-03-21 (UI sending fullRows to the model, Information Disclosure):** the send composes `{handleId, summary}` only; `ingestSendPath.test.ts` (BLOCKER-3) deep-scans the serialized payload and asserts `fullRows`/non-sampled rows are absent (D-11 at the send boundary, not only the store).
- **T-03-22 (third-party UI registry block, Tampering):** no `@mapcn` block consumed — only vendored `src/components/ui/*` primitives used; the registry-vetting gate was never triggered.

## Self-Check: PASSED

- FOUND: src/features/chat/components/FileChipStrip.tsx
- FOUND: src/features/chat/components/FileChip.tsx
- FOUND: src/features/chat/components/fileAttachHandler.ts
- FOUND: src/features/chat/components/fileAttachHandler.test.ts
- FOUND: src/features/chat/components/VisionGateControl.tsx
- FOUND: src/features/chat/composeOutboundContent.ts
- FOUND: src/features/chat/ingestSendPath.test.ts
- FOUND (modified): src/features/chat/ChatPanel.tsx
- FOUND (modified): src/features/chat/store.ts
- FOUND commit: c5ea740 (test, Task 1 RED)
- FOUND commit: f66d9b9 (feat, Task 1 GREEN)
- FOUND commit: 6940fe8 (test, Task 2 RED)
- FOUND commit: 6ba8311 (feat, Task 2 GREEN)
- Gates: bun test (fileAttachHandler + ingestSendPath + store = 20 pass / 0 fail), bun run build (green, ingest worker chunk emits), biome clean — confirmed green by the prior executor and re-verified on finalize. UAT 6/6 APPROVED.

## TDD Gate Compliance
Both autonomous tasks followed RED → GREEN: Task 1 `c5ea740`(test) → `f66d9b9`(feat); Task 2 `6940fe8`(test) → `6ba8311`(feat). No REFACTOR commits needed.

---
*Phase: 03-file-ingest-multimodal*
*Completed: 2026-06-17 (UAT approved)*
