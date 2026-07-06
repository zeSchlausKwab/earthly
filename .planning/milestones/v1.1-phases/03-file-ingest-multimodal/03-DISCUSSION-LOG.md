# Phase 3: File Ingest & Multimodal - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 3-File Ingest & Multimodal
**Areas discussed:** Parse summary & model handoff, Tabular→map placement & geolocation, Vision gate UX, Attachment & ingested-data lifecycle

---

## Parse summary & model handoff (INGEST-05)

### Q: What should the COMPACT summary the model receives contain?

| Option | Description | Selected |
|--------|-------------|----------|
| Schema + sample rows | Column names/types + first ~5-10 rows | ✓ |
| Schema + column stats | Names/types + ranges/cardinality/nulls, no raw rows | |
| Both: stats + few samples | Stats AND a handful of sample rows | |

**User's choice:** Schema + sample rows

### Q: What does the USER see in the parse summary?

| Option | Description | Selected |
|--------|-------------|----------|
| Rich preview + data grid | rows×cols, detected cols, per-col type, scrollable grid | |
| Compact stat line | rows×cols + detected coord/geometry cols + status, expandable | ✓ |
| Mirror the model summary | Show exactly what the model gets | |

**User's choice:** Compact stat line

### Q: How should sample rows be bounded for big/wide tables?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed small cap | ~8 rows, cap columns | |
| Adaptive to token budget | Scale to remaining prompt budget | |
| Head + tail + random | First few, last few, a few random | ✓ |

**User's choice:** Head + tail + random

### Q: Should non-tabular files get a typed summary shape, or Claude's discretion?

| Option | Description | Selected |
|--------|-------------|----------|
| You decide (discretion) | Planner picks obvious per-type summaries | ✓ |
| Unified summary object | Lock one typed summary interface for all parsers | |

**User's choice:** You decide (discretion)
**Notes:** Per-type summaries (text→line/char+head; GeoJSON→feature count+geom types+bbox; image→filename/dims) treated as unambiguous discretion.

---

## Tabular→map placement & geolocation (INGEST-06)

### Q: Who decides which columns are coordinates/geometry?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-detect + AI override | Heuristic detects, AI confirms/overrides at call time | ✓ |
| AI-driven only | AI names coord columns from the summary | |
| User-confirmed in chip | User picks columns in the UI before placement | |

**User's choice:** Auto-detect + AI override

### Q: How do rows WITHOUT coordinates get located?

| Option | Description | Selected |
|--------|-------------|----------|
| AI calls existing search_location | Per-observation geocode via existing Nominatim tool | |
| Batch ingest-geocode tool | New bounded tool geocodes a whole column | |
| Both / AI chooses | Expose both, AI picks by row count | ✓ |

**User's choice:** Both / AI chooses

### Q: Should placement apply host-side over the FULL parsed rows, or only the model's rows?

| Option | Description | Selected |
|--------|-------------|----------|
| Host-side over full data | Column-mapping rule applied to ALL rows by reference | ✓ |
| Only the model's rows | Features only for sampled rows | |

**User's choice:** Host-side over full data
**Notes:** Aligns with SAFE-05 forward-coupling; avoids silently dropping rows.

### Q: How should batch geocoding handle scale limits and unresolved rows?

| Option | Description | Selected |
|--------|-------------|----------|
| Cap + serialize + skip-report | Row cap, ~1 req/s throttle, skip + report failures | |
| Cap + place-with-flag | Same caps, unresolved rows added with needs_geocode flag | |
| You decide | Planner picks against existing search_location behavior | ✓ |

**User's choice:** You decide

---

## Vision gate UX (INGEST-07)

### Q: When vision support is UNCONFIRMED, what should the image-send affordance do?

| Option | Description | Selected |
|--------|-------------|----------|
| Marked uncertain + opt-in | Warning badge; explicit "send anyway?" confirm | ✓ |
| Disabled by default | Image attach disabled unless vision proven | |
| You decide | Planner picks per provider | |

**User's choice:** Marked uncertain + opt-in
**Notes:** Confirmed-vision = enabled; confirmed-no-vision = hard-disabled either way.

### Q: Should the gate also govern the existing capture_map_snapshot vision flow?

| Option | Description | Selected |
|--------|-------------|----------|
| Unify both paths | Layered detection gates user images AND capture_map_snapshot; replaces name-only heuristic | ✓ |
| Attached images only | New gate covers only user uploads | |

**User's choice:** Unify both paths

---

## Attachment & ingested-data lifecycle (INGEST-01/05)

### Q: How should file attachments appear relative to the existing geometry attachment?

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated file chip strip | New component alongside ChatGeometryAttachment | ✓ |
| Unified attachment system | Extend ChatGeometryAttachment to handle both | |
| You decide | Planner picks against current structure | |

**User's choice:** Dedicated file chip strip

### Q: Where does PARSED data live so tools/sandbox read full rows while the model gets only the summary?

| Option | Description | Selected |
|--------|-------------|----------|
| Host-side ingest store + handle id | Keyed store; model gets summary+handle, tools/sandbox read full rows | ✓ |
| On the chat message object | Parsed data hangs off the message attachment | |
| You decide | Planner designs the seam | |

**User's choice:** Host-side ingest store + handle id

### Q: Should parsed ingest data persist across reloads, or stay session-only?

| Option | Description | Selected |
|--------|-------------|----------|
| Session-only (in-memory) | Not persisted; re-attach after reload | ✓ |
| Persist handles across reload | IndexedDB + eviction | |
| You decide | Planner picks by file size/patterns | |

**User's choice:** Session-only (in-memory)

---

## Claude's Discretion

- Off-thread mechanism (Web Worker vs main-thread chunked/yielding).
- Parse-library choices (CSV / Excel readers; native JSON; turf for GeoJSON), honoring lean-deps ethos.
- Per-type summary shapes for text / GeoJSON / image; optional unified summary interface.
- Sample/column counts; geocode caps + failure handling (skip-report vs place-with-flag); ingest-store eviction/size caps; image base64 encoding; registry file layout; max file-size guardrails.

## Deferred Ideas

- Persisted ingest cache across reloads (IndexedDB + eviction) — deferred for session-only in-memory.
- Unified attachment manager (geometry + files in one component) — deferred for separate file-chip strip.
- Richer always-on data-grid preview — deferred for compact expandable stat line.
- Self-hosted / higher-throughput geocoder to escape Nominatim public rate limits — out of scope.
