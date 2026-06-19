---
title: Ingest + Attachment UX Rethink
status: draft-spec
created: 2026-06-19
source: Phase 4 UAT findings (transcript blob rendering + silent messy-CSV failure)
relates_to: Phase 3 (ingest), Phase 4 (code interpreter), chat UX
---

# Ingest + Attachment UX Rethink

## Why this exists

Two findings during the Phase 4 (code interpreter) UAT, both pointing at the same architectural seam:

1. **Raw file content is rendered as "part of the message."** When a dataset is attached, the transcript shows the parsed `{ingestHandle, ingestSummary:{schema, sampleRows, …}}` JSON as a wall of text in the conversation.
2. **We assume clean input; messy files fail silently.** A CSV with a junk leading row parsed into `""`/`_1`…`_6` columns, no detected coordinates, and the model received that garbage with no warning — contradicting the product premise that *the AI does the dirty work*.

Phase 4's actual deliverable (the sandbox `run_code`) is verified independently (confinement, timeout/caps, self-correction, styling, both headline scripts). These two issues are **Phase 3 (ingest) + chat-UX** concerns surfaced by the Phase 4 test, and deserve a deliberate design rather than point patches.

## Root cause (one seam, two symptoms)

`src/features/chat/composeOutboundContent.ts` flattens an attached dataset into a single `{type:'text', text: JSON.stringify({ingestHandle, ingestSummary})}` content part on the outbound user message. That **same string is both (a) the model's payload and (b) what `MessageBubble` renders.** And `parseCsv` (`src/features/chat/ingest/parse.ts`) bakes a "clean-or-garbage" summary on the host with no uncertainty signal.

So: representation and model-payload are fused (→ symptom 1), and the host owns cleaning while being brittle and silent (→ symptom 2).

## Goals

- **G1.** Attachments render in the transcript as compact, type-specific **cards**, not raw parsed content. Heavy detail is collapsed/on-demand.
- **G2.** Hard-separate **user-facing representation** from **model-facing payload** (so we can render richly without bloating model context, and vice versa).
- **G3.** The AI **handles messy files itself** — inspect → clean → re-check — instead of the host pre-cleaning or the user being required to supply clean data.
- **G4.** Parse **uncertainty is always surfaced** (on the card + to the model) — no silent garbage.
- **G5.** Preserve existing invariants: D-11 (model context never receives non-sampled `fullRows`), D-01 (sandbox read snapshot), the isolation boundary.

## Non-goals

- Re-opening Phase 4's sandbox/isolation design (proven).
- Full data-wrangling UI (spreadsheet editor, column-mapper GUI) — out of scope for this pass; the AI does cleaning via code.
- Image-attachment vision pipeline changes (D-08/D-09) — unaffected.

## Peer patterns adopted (research synthesis)

Sources: ChatGPT Advanced Data Analysis, Claude.ai uploads, **LM Studio `js-code-sandbox`** (closest analog), Cursor, Gemini.

- **Card, not blob.** ChatGPT explicitly evolved "just a file icon" → an interactive, expandable table card; Claude shows type-badged file cards. Raw content is never dumped into the transcript. → G1.
- **Chrome vs. payload separation (LM Studio).** Its tool API gives `status()`/`warn()` that are *user-visible only* and "don't get shown to the model unless you explicitly return them." This is precisely the separation we lack. → G2/G4.
- **Inspect-by-printing loop.** ChatGPT runs `df.head()/info()/describe()` first; the js-code-sandbox model inspects via `console.log` over stdout. The model's "view" of data is what it prints — so it can detect and fix a bad parse. → G3.
- **Profile-first convention.** Assistant always inspects (sniff delimiter, skip junk rows, infer header, report dtypes/anomalies) before using the data. → G3.
- **Collapsible work + status chips.** Cleaning code shown inline-but-folded with ⚙️/✅/❌ status (we already have `CodeRunDisclosure` — reuse the language). → G1.
- **Uncertainty pinned to the artifact.** A yellow badge on the card ("skipped 3 junk header rows; col 4 mixed types") rather than buried prose. → G4.
- **Before/after cleaning summary.** rows in→out, columns renamed/dropped, types coerced. → G3/G4.
- **Type-specific previews.** CSV/XLSX → scrollable table; JSON → tree; image → thumbnail+lightbox.

Anti-patterns to avoid: dumping parsed JSON into the transcript (our current state); trusting a single silent parse (Gemini's documented CSV misreads); showing cleaning code expanded by default; feeding the model the *pretty* representation instead of inspectable raw data.

## Proposed design

### Move 1 — Decouple display from payload; render attachment cards

- Carry **structured attachment metadata on the message** (e.g. `message.attachments: [{ handleId, filename, kind, rows, cols, sampleColumns, warnings[], status }]`) so the UI can render without parsing the content string.
- The model-facing dataset part stays `{ingestHandle, ingestSummary}` (D-11) but is flagged **non-display** (the renderer never prints it as text).
- `MessageBubble` renders each attachment as a **collapsed file card** (filename · kind badge · rows×cols · a few column names · ⚠ badge if uncertain), with raw schema/sample behind an expand — reusing the `CodeRunDisclosure` collapse pattern. One card component, branch by `kind` (tabular/json/image).
- The composer already has `FileChip`/`FileChipStrip`; this is essentially **persisting that chip representation into the sent message** instead of stringifying it away.

Touchpoints: `composeOutboundContent.ts`, `ChatPanel.tsx`/`MessageBubble`, `components/FileChip*`, the message type, `store.ts` (message shape + the prompt-path compaction already at `store.ts:292+`).

### Move 2 — AI does the cleaning (lenient parse + raw access + profile-first + honest uncertainty)

- **Lenient, honest parse.** `parseCsv` still best-effort, but computes a **confidence/warnings signal** (degenerate schema = all-empty/generic columns; field-mismatch rows; no header detected). It does *not* try to be clever about cleaning.
- **Raw access for the AI.** The sandbox/handle exposes the **raw file text/bytes** (not just the host's possibly-mangled parsed rows) so `run_code` can re-parse from scratch — find the real header, drop junk rows, coerce types, re-derive coordinates. This is safe re: D-11 because the sandbox is isolated execution, not model context. (Check: does `readSnapshot.ts` expose raw, or only parsed rows? Likely needs a raw-text channel via `getDataset(handle)`.)
- **Uncertainty to the model.** The model-facing `ingestSummary` carries the warnings so the model knows to inspect/clean first (turns silent failure into an AI task).
- **Profile-first prompt.** Extend the `run_code` system prompt (`runCode.ts`) so the model, on a freshly attached/uncertain dataset, inspects (head/tail, dtypes, header detection) before mapping to GeoJSON.
- **Cleaning summary as artifact.** When the AI cleans, surface a short before/after on the card (rows in→out, columns fixed, N dropped).

Touchpoints: `ingest/parse.ts`, `ingest.worker.ts`, `ingestClient.ts`, `ingestStore`/`deriveIngestSummary`/`toModelSummary`, `sandbox/readSnapshot.ts` (raw channel), `sandbox/runCode.ts` (prompt + raw exposure), `FileChip` (warning badge + cleaning summary).

## Open questions / decisions needed

1. **Raw exposure shape.** Expose raw file text to the sandbox via the handle, or add an explicit `inspect_dataset`/`reparse` capability? (Leaning: raw text on the handle — least new surface, maximal model freedom.)
2. **Where do warnings live canonically** — on the ingest result, threaded to both the card metadata and the model summary? (Yes — single source, two consumers, per LM Studio.)
3. **Auto-clean vs. AI-clean default.** Do we keep *any* host-side leniency (e.g. skip obviously-blank leading lines) as a convenience, or push all cleaning to the AI? (Leaning: minimal host leniency for the trivial case + AI for everything real, always with a surfaced warning.)
4. **Card interactivity** — adopt ChatGPT's clickable columns ("use this as latitude")? (Powerful for geo; likely a follow-up, not v1.)
5. **Placement in the roadmap** — own phase vs. fold into Phase 5/6 planning (this precedes the bulk-transform/styling phases that lean on ingest).

## Suggested phasing

Two plan-sized slices, sequenceable independently:

- **Slice A — Attachment cards (Move 1).** Display/payload decouple + card rendering. Pure chat-UX; high-visibility, low-risk, no ingest behavior change.
- **Slice B — AI-cleans ingest (Move 2).** Lenient+honest parse, raw sandbox access, profile-first prompt, uncertainty surfacing, cleaning summary.

Slice A can ship first (immediate UX win); Slice B is the deeper capability. Both respect D-01/D-11.

## Progress

- **Slice A — Attachment cards (Move 1): SHIPPED** (2026-06-19, commit `d477533`).
  Display/payload decoupled: attached datasets now render in the transcript as
  compact, collapsible `AttachmentCard`s (filename · kind badge · rows×cols ·
  empty-safe ⚠ warning affordance; schema + sample table behind expand) instead
  of the raw `{ingestHandle, ingestSummary}` JSON blob. The model payload
  (`composeOutboundContent`) is **unchanged** — D-11 invariant test
  (`ingestSendPath.test.ts`) still green. New `AttachmentCard` +
  `parseIngestHandlePart`; reuses `FileChip` visual helpers and the
  `CodeRunDisclosure` collapse idiom. No ingest-parsing behavior changed. Gates:
  `bun test` 340/0, dev + prod builds, biome (changed files) clean.
- **Slice B — AI-cleans ingest (Move 2): NOT started.** The ⚠ warning affordance
  is wired empty-safe on the card now; Slice B populates `IngestSummary.warnings`
  (lenient+honest parse, raw sandbox access, profile-first prompt, uncertainty
  surfacing, cleaning summary).

## Risks

- **Model-context bloat** if warnings/preview leak into the payload — enforce the chrome/payload split (test like `ingestSendPath.test.ts`).
- **Raw-text exposure size** — large files; cap/stream what the sandbox can pull, keep D-11 (no full rows into model *context*).
- **Prompt regressions** — profile-first instructions must not make the model chatty on already-clean files; gate on the uncertainty signal.
