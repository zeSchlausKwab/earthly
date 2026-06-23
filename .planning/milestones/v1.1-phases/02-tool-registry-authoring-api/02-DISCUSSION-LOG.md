# Phase 2: Tool Registry & Authoring API - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 2-Tool Registry & Authoring API
**Areas discussed:** Migration boundary, API forward-design, Primitives behavior, Unknown-tool error

---

## Migration boundary

### Migration scope

| Option | Description | Selected |
|--------|-------------|----------|
| All ~30 tools now | Sweep every tool into the typed registry, re-point all editor writes onto the Authoring API. | ✓ |
| All tools registered, write-refactor narrow | Register all tools but only re-point editor-write tools. | |
| Editor tools now, externals follow | Only editor reads/writes migrate now; externals in a follow-up. | |

**User's choice:** All ~30 tools now.

### Registry unification (two dispatch paths today)

| Option | Description | Selected |
|--------|-------------|----------|
| One unified registry | Fold editor_* commands into the single typed registry. | ✓ |
| One registry, editor commands as namespaced module | Editor module self-registers into central registry. | (partial — see notes) |
| Keep editor commands separate, bridge them | Central registry delegates to existing command registry. | |

**User's choice:** One unified registry — *conditioned* on two requirements.
**Notes:** User accepted unification provided (a) the chat stays aware of each tool's *nature* (remote MCP vs quick local editor tool) and (b) the registry is dynamic — a new MCP tool loaded at runtime (server updated, via the client) must appear and the chat must stay aware and contextualize. User flagged that nostr-scrolls (later milestone) will register tools ad hoc the same way. Drove the kind/origin metadata + dynamic-registry decisions.

### Tool-kind classification richness

| Option | Description | Selected |
|--------|-------------|----------|
| Category enum + origin metadata | kind enum (editor/host-builtin/remote-mcp/authoring-primitive/nostr-scroll) + optional origin. | ✓ |
| Minimal: local vs remote flag | Just local/instant vs remote/networked. | |
| Full descriptor (kind, origin, trust, cost) | Add trust + cost now. | |

**User's choice:** Category enum + origin metadata.

### Dynamic scope this phase

| Option | Description | Selected |
|--------|-------------|----------|
| Build dynamic API, defer live wiring | register/unregister + reactive tool list, tested with a fake dynamic tool; real MCP/scrolls later. | |
| Also wire live MCP hot-reload now | Connect ContextVM/MCP client so real remote tools register dynamically this phase. | ✓ |
| Static now, refactor to dynamic later | Ship static, add dynamic machinery later. | |

**User's choice:** Also wire live MCP hot-reload now.
**Notes:** Flagged as a genuine scope expansion (today's MCP tools are hardcoded, not discovered). Captured as in-scope, own wave, with a feasibility check on ContextVM tool-discovery.

---

## API forward-design

### Gate seam shaping

| Option | Description | Selected |
|--------|-------------|----------|
| Pass-through interceptor hook now | Single pipeline with a no-op interceptor slot. | |
| Minimal clean API, gate added in Phase 5 | Smallest API now; Phase 5 refactors to add gate. | |
| Full gate scaffolding now | Build interceptor + intent-classification structure now. | ✓ |

**User's choice:** Full gate scaffolding now.
**Notes:** Scoped to *structural* scaffolding only (interceptor pipeline + add/modify/delete intent types) — not Phase 5's diff/preview UI, safety-level persistence, or undo.

### Method return values

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — return feature id(s)/result objects | Structured result from every mutation. | ✓ |
| Void now, add returns when needed | Add returns when a consumer forces it. | |
| Return full operation receipts | Rich before/after receipts from day one. | |

**User's choice:** Yes — return feature id(s)/result objects.

### Direct-UI write paths through the API

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — UI routes through the API too | Refactor draw-mode/toolbar writes onto the API now. | ✓ |
| Chat + sandbox-ready now, UI in a tail wave | Sequence UI refactor into a final wave. | |
| Chat only now, UI deferred | UI stays direct; criterion #3 unmet. | |

**User's choice:** Yes — but raised the standalone-editor-lib concern (could the editor toolbar ship standalone, without AI, later?).
**Notes:** Resolved via strict AI-agnostic layering — see layering lock below.

### API shape

| Option | Description | Selected |
|--------|-------------|----------|
| Single facade instance (authoring.*) | One cohesive object, holds editor ref, hosts interceptor. | ✓ |
| Free functions taking an editor handle | Tree-shakeable but leaks editor handle everywhere. | |
| You decide | Planner picks. | |

**User's choice:** Single facade instance.

### Layering lock (standalone-lib concern)

| Option | Description | Selected |
|--------|-------------|----------|
| Lock it as described | Strict one-way layers; API stays AI-free + standalone-shippable; UI routes through it. | ✓ |
| Lock layering, but UI in a tail wave | Same end state, staged risk. | |
| Let me adjust | User tweaks layering. | |

**User's choice:** Lock it as described.
**Notes:** Authoring API = pure AI-agnostic geometry facade (no chat/registry/Nostr imports), holds primitives + result objects + interceptor/gate pipeline; registry/AI is a separable consumer layer. This becomes a hard architectural constraint in CONTEXT.md (D-07).

---

## Primitives behavior

### Units / defaults

| Option | Description | Selected |
|--------|-------------|----------|
| Meters canonical, accept km/mi via param | Numeric distance + units param (default meters); no magic default radius. | ✓ |
| Kilometers default, optional unit | km default. | |
| You decide | Planner picks. | |

**User's choice:** Meters canonical, accept km/mi via param.

### Buffer targeting

| Option | Description | Selected |
|--------|-------------|----------|
| By feature id (+ allow raw geometry) | buffer(featureId, distance); also accept raw GeoJSON for sandbox. | ✓ |
| Selected feature(s) only | Operates on current selection. | |
| Both id and selection, no raw geometry | id or selection, no raw geometry. | |

**User's choice:** By feature id (+ allow raw geometry).

---

## Unknown-tool error

### Error destination

| Option | Description | Selected |
|--------|-------------|----------|
| Both: model-loop feedback + user-visible | Structured result back to AI to self-correct + visible chat error. | ✓ |
| Model-loop feedback only | AI self-corrects, no UI clutter. | |
| User-visible hard error only | Visible throw, no self-correction. | |

**User's choice:** Both: model-loop feedback + user-visible.

### Error scope (unknown-name vs handler failure)

| Option | Description | Selected |
|--------|-------------|----------|
| Unified error result for both | One structured tool-error shape covers unknown-name AND handler-threw. | ✓ |
| Unknown-tool only this phase | Handle only the unknown-name case now. | |
| You decide | Planner designs the contract. | |

**User's choice:** Unified error result for both.

---

## Claude's Discretion

- Exact registry file/module layout.
- Circle/buffer segment/steps count (turf defaults fine).
- Behavior-preservation verification strategy (criterion #2 is binding regardless).
- Precise interceptor/middleware signature (within D-12's scaffolding intent).

## Deferred Ideas

- **Tool-definition compression library** — compresses advertised tool definitions to cut token cost; locate later, likely wrap the registry. Design accommodation locked (decoupled definition serialization, D-06).
- **Nostr-scrolls (NIP-5C) ad-hoc tools** — later milestone; dynamic registry anticipates them.
- **Trust/cost per-tool metadata** — deferred in favor of the leaner kind + origin descriptor.
