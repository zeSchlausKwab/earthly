# Architecture Research — Chat ↔ Toolbar ↔ Map Orchestration on an Existing App

**Domain:** Imperative MapLibre editor + Zustand store + chat-with-tools, evolving toward (a) single stance enum, (b) Map Shelf working set, (c) shared drawing API for UI and chat, (d) classical-utility paths that never engage AI/Nostr
**Researched:** 2026-05-26
**Confidence:** HIGH for tldraw/Felt-style patterns and React refactoring playbooks; MEDIUM for the specific "feature-flagged Zustand slice swap" migration tactic (synthesized from feature-flag-for-DB-migration prior art applied to a single client).

---

## TL;DR — The Four Architectural Bets

1. **One owner per concern.** `stance` enum owned by `editorCoreSlice`. Map Shelf owned by a new `shelfSlice`. Chat binding owned by chat store. **Delete** all derived/shadow state (AppSidebar's local mode mirror, ChatPanel's implicit `activeContextScope` binding, `useViewMode` graph).
2. **A Drawing API layer** sits between callers (Toolbar buttons, chat tool executors, keyboard shortcuts) and `GeoEditor`. Single function signature per verb. Zod-validated input. Returns a typed Result. **Both UI and chat call the same functions** — no separate "AI path."
3. **AI output goes through a Proposal stage on the Shelf, not directly into the dataset.** Chat-produced geometry lands as a `shelfItem` with `source: 'ai-proposal'` and `pending: true`. Explicit user verb (Accept / Reject / Refine) promotes it. The Shelf is already the working-set abstraction the UX rewrite is introducing — AI output is just another kind of item on it.
4. **"Visible but ignorable" is a state-scoping discipline, not a UI toggle.** Every AI/Nostr surface reads state but does not *gate* a flow. Anonymous users have full read+filter access; classical flows compute from local + cached state; chat panel renders next to the map, never on top of it.

These four bets translate directly into the build-order recommendation in §10.

---

## Existing Architecture (recap, do not re-derive)

Already documented in `.planning/codebase/ARCHITECTURE.md`. Key facts the new architecture has to honor:

- `GeoEditor` is a ~1,800-line **imperative** class wrapping MapLibre with 10 managers + 2 draw modes. It is created once, lives in the Zustand store via `setEditor()`, and **must not** be re-instantiated on re-render.
- `useEditorStore` (Zustand, 11 slices) is the **bridge** between the imperative editor and React. It is the single source of truth.
- Three overlapping mode systems (`mode`, `viewMode`, `sidebarViewMode`) plus shadows (`editIsolationEnabled`, `splitWithEditor`, `activeContextScope*`, AppSidebar's local `activeEntity/entityIntent`) — explicitly targeted for collapse by `UX_REWRITE.md §8`.
- `GeoEditorView.tsx` (2,088 lines) has 19 useEffects, 25+ memos, 15 useState. Two pieces of dead state (`isDrawingMode`, `_setMapError`). Identified for stance-specific layout split.
- `AppSidebar.tsx` (863 lines) has a secondary mode system that shadows `sidebarViewMode`. Identified for navigator-only collapse.
- `ChatPanel.tsx` (1,845 lines) + `chat/store.ts` (1,603 lines) + `tools/helpers.ts` (1,322 lines). Monolithic, no tests.
- Chat tools already exist (`src/features/chat/tools/definitions.ts`, 796 lines) — 20+ OpenAI-format tools including `write_geojson_to_editor`, `add_feature_to_editor`, query tools. **The drawing API problem is partially solved already** — chat already writes to the editor; the architecture question is "how do we make this clean and equivalent to the UI's drawing path."
- Factory + Cast pattern for all Nostr events. Applesauce singletons in `src/lib/nostr/index.ts`.

The new architecture **amends** these, it does not replace them.

---

## Target Architecture

### System Overview

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                            React 19 SPA (Bun)                            │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              GeoEditorView (orchestrator shell — thin)          │   │
│  │   stance-aware layout: <BrowseLayout> | <FocusLayout> | <AuthorLayout> │
│  └──────┬────────────┬─────────────┬─────────────┬────────────────┘   │
│         │            │             │             │                       │
│   ┌─────▼────┐ ┌─────▼─────┐ ┌────▼──────┐ ┌────▼──────┐                │
│   │AppSidebar│ │ MapShelf  │ │  Toolbar  │ │ ChatPanel │                │
│   │ (nav)    │ │ (working  │ │  (author  │ │(detachable│                │
│   │          │ │  set)     │ │   only)   │ │ + binding)│                │
│   └─────┬────┘ └─────┬─────┘ └────┬──────┘ └────┬──────┘                │
│         │            │            │             │                       │
│         │   ┌────────┴────────┐   │             │                       │
│         │   │   <MapCanvas>   │   │             │                       │
│         │   │   (MapLibre)    │   │             │                       │
│         │   └────────┬────────┘   │             │                       │
│         │            │            │             │                       │
│         │            │   ┌────────▼─────────┐   │                       │
│         │            │   │  Drawing API     │◄──┘  (chat tool exec      │
│         │            │   │  (verb layer)    │       calls same functions)│
│         │            │   └────────┬─────────┘                           │
│         │            │            │                                     │
│         │            │   ┌────────▼─────────┐                           │
│         │            │   │   GeoEditor      │                           │
│         │            │   │   (imperative)   │                           │
│         │            │   │   + 10 managers  │                           │
│         │            │   └──────────────────┘                           │
│         │            │                                                  │
│  ┌──────▼────────────▼──────────────────────────────────────────┐      │
│  │           useEditorStore (Zustand, 12 slices)                │      │
│  │  ┌────────────────┐  ┌─────────────────┐  ┌──────────────┐  │      │
│  │  │ editorCoreSlice│  │   shelfSlice    │  │ workspaceSlice│ │      │
│  │  │  + stance enum │  │  (NEW — working │  │  + draftSlice │  │      │
│  │  │                │  │   set ownership)│  │               │  │      │
│  │  └────────────────┘  └─────────────────┘  └──────────────┘  │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                  │                                      │
│                       ┌──────────▼──────────┐                          │
│                       │   chat/store.ts     │                          │
│                       │  (separate store —  │                          │
│                       │   binding + tools)  │                          │
│                       └──────────┬──────────┘                          │
│                                  │                                     │
└──────────────────────────────────┼─────────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
   ┌────▼────┐               ┌─────▼─────┐             ┌──────▼─────┐
   │ Applesauce │             │  Routstr  │             │  ContextVM  │
   │ EventStore │             │  (chat    │             │  MCP server │
   │ + RelayPool│             │ streaming)│             │ (geo tools) │
   └────────────┘             └───────────┘             └─────────────┘
```

### Component Responsibilities

| Component | Responsibility | File / Location |
|-----------|----------------|-----------------|
| **GeoEditorView** | Stance-aware layout shell only. Picks which sub-layout to render. No business logic. | `src/features/geo-editor/GeoEditorView.tsx` (amend in place — extract layouts; do not delete file) |
| **`<BrowseLayout>` / `<FocusLayout>` / `<AuthorLayout>`** | Stance-specific layout composition. Sidebar + Shelf + Map + (Toolbar in Author only) + Chat (always optional). | `src/features/geo-editor/layouts/` (NEW) |
| **MapShelf** | Top strip listing every dataset/context/AI-proposal currently in the working set. Chip actions per UX_REWRITE §3. | `src/features/geo-editor/components/MapShelf.tsx` (NEW) |
| **StanceIndicator** | Persistent label + transition affordance above the map. | `src/features/geo-editor/components/StanceIndicator.tsx` (NEW) |
| **AppSidebar** | Pure navigator. Pinned → Recent → Search/Discover. Inspect replaces list in-place. **Delete** local mode mirror. | `src/components/AppSidebar.tsx` (amend) |
| **Toolbar** | Drawing controls + author-only verbs. Render only when `stance === 'author'`. | `src/features/geo-editor/components/Toolbar.tsx` (amend) |
| **ChatPanel** | Detachable shell + binding chip + message stream. No more implicit context scope. | `src/features/chat/ChatPanel.tsx` (amend — extract hooks before structural changes) |
| **Drawing API (verbs)** | Function-per-verb layer between callers and `GeoEditor`. Single signature. Zod-validated input. Returns typed Result. | `src/features/geo-editor/api/` (NEW — see §5) |
| **GeoEditor** | Imperative MapLibre engine. **Unchanged.** Drawing API calls into existing managers. | `src/features/geo-editor/core/GeoEditor.ts` |
| **useEditorStore** | 12-slice Zustand store. `editorCoreSlice` gains `stance`; new `shelfSlice`. | `src/features/geo-editor/store/` |
| **chat store** | Separate Zustand store. Handles binding chip state, message stream, tool execution queue. | `src/features/chat/store.ts` (amend — split slices) |
| **`useRouting`** | One-way URL → state derivation only. State writes URL via separate write path. | `src/features/geo-editor/hooks/useRouting.ts` (rewrite per UX_REWRITE §9) |

### Data Flow — The Five Critical Paths

#### A. UI button → drawing API → editor → store → UI feedback

```
User clicks Toolbar "Draw Polygon"
  ↓
Toolbar handler calls drawingApi.startMode({ mode: 'polygon' })
  ↓
drawingApi validates input (Zod), calls editor.setMode('polygon')
  ↓
GeoEditor sets internal mode, LayerManager updates cursor source
  ↓
GeoEditor fires modeChange event → editorCoreSlice.setMode()
  ↓
React re-renders Toolbar with active polygon button
```

#### B. Chat tool call → drawing API → editor → shelf → user verb → commit

```
LLM emits tool_call: { name: 'write_geojson_to_editor', args: { fc: {...} } }
  ↓
chat/store toolExecutor receives streamed args
  ↓
toolExecutor validates with Zod (same schema the UI uses), calls
   drawingApi.proposeFeatures({ features, source: 'chat:<message-id>' })
  ↓
drawingApi: (1) validates GeoJSON with @yaga/geojson-schema + AJV
            (2) creates a ShelfItem with { kind: 'ai-proposal', pending: true,
                features, sourceMessageId }
            (3) calls shelfSlice.addItem(shelfItem)
            (4) calls editor.renderPreviewLayer(shelfItem.id, features)
  ↓
MapShelf renders a new chip with "Accept | Reject | Refine"
  ↓
User clicks "Accept" → drawingApi.commitProposal(shelfItem.id)
  ↓
drawingApi: (1) moves features into the active draft via editor.setFeatures
            (2) removes preview layer
            (3) marks shelfItem.pending = false
            (4) optionally enters Author stance if user was in Focus
              (only if user chose "Accept and Edit" verb)
```

The shelf-as-staging-area pattern is the **central insight**. AI output never bypasses user intent. The same shelf chip pattern already exists for datasets and contexts; AI proposals are just another `kind`.

#### C. URL → stance + shelf (one-way, atomic)

Per UX_REWRITE §8 implicit-transition #6:

```
URL change (path-based: /, /c/<naddr>, /d/<naddr>, /author/<workspace-id>)
  ↓
useRouting parses URL → produces { stance, shelf: ShelfItem[], view }
  ↓
applyRouteAtomically(derived):
    editorCoreSlice.setStance(derived.stance)
    shelfSlice.replace(derived.shelf)
    // Note: never the other direction. Pushing to URL is a separate write path.
  ↓
React re-renders
```

State writes to URL happen via `router.push()` calls in explicit user verbs (Share, Open, etc.), **never** by reading state in a useEffect and pushing.

#### D. Classical (no-AI, no-Nostr) path

```
Anonymous user lands on /
  ↓
useRouting derives { stance: 'browse', shelf: [], view: default }
  ↓
BrowseLayout renders: AppSidebar (no auth gate) + empty MapShelf + Map +
    landing prompt overlay ("Browse popular | Search a city | Resume workspace")
  ↓
User opens a dataset → drawingApi.openOnShelf({ naddr })
  ↓
shelfSlice.addItem({ kind: 'dataset', naddr, visible: true, ... })
  ↓
useMapLayers (still works because input is now just `shelf`) renders dataset
  ↓
User filters, inspects, reads comments — all from local + cached state
```

The chat panel and Nostr identity surfaces stay rendered, but **nothing requires interaction with them**. This is the "visible but ignorable" contract.

#### E. Stance transition (always explicit)

```
User clicks StanceIndicator → "Switch to Author" verb in popover
  ↓
explicitVerbs.enterAuthor({ from: 'focus', sourceItem? }):
    editorCoreSlice.setStance('author')
    if (sourceItem) draftSlice.startDraftFrom(sourceItem)
    else draftSlice.startBlankDraft()
  ↓
React re-renders → AuthorLayout mounts → Toolbar visible
```

No auto-promotion. The six implicit transitions listed in UX_REWRITE §8 are all deleted in Phase 1; their previous callers become explicit verb invocations.

---

## Key Architectural Patterns

### Pattern 1: The Drawing API Layer (the most important new boundary)

**What:** A typed, Zod-validated, side-effect-explicit set of functions that mediate **every** mutation to the editor. UI buttons call them. Chat tool executors call them. Keyboard shortcuts call them. They are the only callers of `GeoEditor` mutating methods outside of the engine itself.

**File:** `src/features/geo-editor/api/index.ts` (NEW)

**Shape:**

```typescript
// src/features/geo-editor/api/schemas.ts
import { z } from 'zod';
import type { Feature, FeatureCollection } from 'geojson';

export const StartModeSchema = z.object({
  mode: z.enum(['point', 'linestring', 'polygon', 'select']),
});

export const ProposeFeaturesSchema = z.object({
  features: z.custom<Feature[]>(),  // validated against RFC 7946 separately
  source: z.string(),               // e.g. 'chat:<msgId>' or 'ui:toolbar'
  label: z.string().optional(),
});

export const CommitProposalSchema = z.object({
  shelfItemId: z.string(),
  intent: z.enum(['accept', 'accept-and-edit', 'reject']),
});

export const OpenOnShelfSchema = z.object({
  naddr: z.string(),
  kind: z.enum(['dataset', 'context']),
});
```

```typescript
// src/features/geo-editor/api/drawingApi.ts
import { z } from 'zod';
import { useEditorStore } from '../store';
import * as schemas from './schemas';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const drawingApi = {
  startMode(input: z.infer<typeof schemas.StartModeSchema>): Result<void> {
    const parsed = schemas.StartModeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const editor = useEditorStore.getState().editor;
    if (!editor) return { ok: false, error: 'editor not initialized' };
    if (useEditorStore.getState().stance !== 'author') {
      return { ok: false, error: 'drawing requires Author stance' };
    }
    editor.setMode(parsed.data.mode);
    return { ok: true, value: undefined };
  },

  proposeFeatures(input: z.infer<typeof schemas.ProposeFeaturesSchema>): Result<string> {
    // ... validates geometry, adds to shelf with kind='ai-proposal' or 'manual-draft',
    //     renders a preview layer, returns shelfItemId
  },

  commitProposal(input: z.infer<typeof schemas.CommitProposalSchema>): Result<void> {
    // ... promotes features into the active draft (Author entry if needed)
  },

  openOnShelf(input: z.infer<typeof schemas.OpenOnShelfSchema>): Result<void> { /* ... */ },

  // and the rest of the verbs from UX_REWRITE §7: pin, inspect, fork, proposeEdit,
  // curate, share, saveAsWorkspace, removeFromShelf, toggleVisibility, toggleIsolated
};

export type DrawingApi = typeof drawingApi;
```

**The chat-tools adaptor:**

```typescript
// src/features/chat/tools/registry.ts
import { drawingApi } from '@/features/geo-editor/api/drawingApi';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as schemas from '@/features/geo-editor/api/schemas';

// One canonical place to map LLM tool names → drawingApi calls.
// Tools shipped to the LLM are derived from the same Zod schemas the UI uses.
export const editorTools = [
  {
    name: 'propose_features',
    description: 'Draw features as a proposal on the Map Shelf. The user reviews and accepts.',
    inputSchema: zodToJsonSchema(schemas.ProposeFeaturesSchema),
    execute: (args) => drawingApi.proposeFeatures(args),
  },
  // ... other editor tools
];
```

**Why this pattern is right for Earthly specifically:**

- The chat already has tools that call into the editor (`write_geojson_to_editor`, `add_feature_to_editor`). The architectural ambition is not "wire chat to editor" — it's "make every chat tool a thin adapter over the same function the UI button calls." Today there are two slightly different paths; we want one.
- Zod-derived schemas remove the dual-spec problem (tool definitions in one place, runtime validation in another). This is the same pattern tldraw's agent starter kit uses with Zod-defined action schemas, and the same pattern the Vercel AI SDK recommends.
- Returning typed `Result<T>` instead of throwing means tool executors can feed errors back to the LLM as a tool result (repair loop) — no exception-as-control-flow.

**Trade-offs:**

- One more layer of indirection for UI buttons that previously called `editor.setMode()` directly. Acceptable: the layer's whole purpose is making the boundary explicit.
- Some verbs (e.g. `pin`) don't touch the editor at all; they're store-only operations. Putting them in the same API is still correct — the user's mental model is "verbs are verbs," and the API is the verb registry.

**Sources:**
- [tldraw Agent Starter Kit](https://tldraw.dev/starter-kits/agent) — actions defined as Zod schemas; each action has a util class with `applyAction()`, `sanitizeAction()`, `getInfo()`
- [Vercel AI SDK — Foundations: Tools](https://ai-sdk.dev/docs/foundations/tools) — Zod inputSchema + execute function; provider-agnostic
- [MCP Tool Schema reference](https://www.merge.dev/blog/mcp-tool-schema) — `inputSchema` JSON Schema is the contract; `_meta.ui.visibility` indicates whether tool is model-callable, UI-callable, or both

### Pattern 2: Stance as a Discriminated Union (not just an Enum)

**What:** Replace `viewMode` + `editIsolationEnabled` + `splitWithEditor` + `activeEntity`/`entityIntent` with a single discriminated union. Not a plain string enum — a tagged union so stance-specific data lives on the stance object itself, making impossible states impossible.

```typescript
// src/features/geo-editor/store/types.ts
export type Stance =
  | { kind: 'browse' }
  | { kind: 'focus'; focusedItemId?: string /* shelf item id under inspection */ }
  | { kind: 'author'; draftId: string; sourceItemId?: string /* fork/edit source */ };
```

**Why discriminated union over plain enum:**

- Author stance always has a `draftId`. Today's bug is "viewMode is 'edit' but there's no draft" — impossible to represent with the discriminated union.
- Focus stance optionally has a focused (inspected) item. Today this lives in three places.
- TypeScript exhaustive checks catch missing handling in switch statements. The compiler enforces the state graph.

**Trade-offs:**
- Slightly more verbose access (`stance.kind === 'author' && stance.draftId` instead of `viewMode === 'edit'`). Worth it.
- Refactor cost: every read of `viewMode` becomes a read of `stance.kind`. ~80 call sites estimated (grep `viewMode` in the codebase). Manageable with codemods.

**Sources:**
- [Taming Complex React State with Union Types](https://www.joefiorini.com/taming-complex-state-union-types)
- [Discriminated Unions | React with TypeScript](https://stevekinney.com/courses/react-typescript/typescript-discriminated-unions)
- [Opinionated React — Use Status Enums Instead of Booleans](https://dev.to/farazamiruddin/opinionated-react-use-status-enums-instead-of-booleans-3ha5)

### Pattern 3: Shelf-as-Working-Set (with AI proposals as a kind)

**What:** A single `shelfSlice` owns the working set. Items have a `kind` discriminator that includes `'ai-proposal'` as a peer of `'dataset'` and `'context'`. The shelf is not just a UI concept — it's the **input** to `useMapLayers`, replacing today's derived-from-scope-and-selection logic.

```typescript
// src/features/geo-editor/store/shelfSlice.ts
export type ShelfItem =
  | { id: string; kind: 'dataset'; naddr: string; visible: boolean; isolated: boolean }
  | { id: string; kind: 'context'; naddr: string; visible: boolean; isolated: boolean }
  | {
      id: string;
      kind: 'ai-proposal';
      visible: boolean;
      isolated: boolean;
      pending: true;                    // chip shows Accept/Reject/Refine
      sourceMessageId: string;          // links back to chat for context
      features: Feature[];              // not yet committed
      previewLayerId: string;           // MapLibre source id for the preview
    }
  | { id: string; kind: 'manual-draft'; visible: boolean; isolated: boolean /* etc */ };

export interface ShelfSlice {
  items: ShelfItem[];
  addItem(item: ShelfItem): void;
  removeItem(id: string): void;
  toggleVisible(id: string): void;
  toggleIsolated(id: string): void;     // mutually exclusive across shelf
  replace(items: ShelfItem[]): void;    // for URL-driven hydration
  clear(): void;
}
```

**Critical interaction:** `useMapLayers` (`src/features/geo-editor/hooks/useMapLayers.ts`, 786 lines) currently derives its layer set from `mapStackSlice` + `activeContextScope*` + sidebar selection. After the rewrite, its input is `shelfSlice.items`. The hook's internal logic — translating logical layers to MapLibre sources — stays. Its **input contract** changes.

**Sources:**
- UX_REWRITE.md §3, §8
- [tldraw Agent Starter Kit's "preview shapes" pattern](https://tldraw.dev/starter-kits/agent) — generated content lands in a preview layer before commit
- [Tiptap AI Changes](https://tiptap.dev/docs/content-ai/capabilities/changes/overview) — same "track, review, accept/reject" pattern for text

### Pattern 4: Detached Chat with Explicit Binding Chip

**What:** Per UX_REWRITE §6 — ChatPanel becomes a detachable shell. The implicit `activeContextScope` linkage is replaced by an explicit `binding` field in the chat store, surfaced as a chip at the top of the panel.

```typescript
// src/features/chat/store.ts (new slice within the chat store)
export type ChatBinding =
  | { kind: 'shelf' }                      // default in Browse/Focus
  | { kind: 'draft'; draftId: string }     // default in Author
  | { kind: 'item'; shelfItemId: string }  // user override
  | { kind: 'selection'; featureIds: string[] }
  | { kind: 'none' };

interface ChatBindingSlice {
  binding: ChatBinding;
  setBinding(b: ChatBinding): void;
  // derived: what context gets injected into the next prompt
}
```

The **system prompt injector** (today in `src/features/chat/tools/context.ts`, `getMapContextSnapshot()`) reads `binding` and the shelf to decide what context to inject. Today it reads `activeContextScope*` and viewport; tomorrow it reads `binding` (explicit) and viewport (implicit).

**Detachable shell:** Wrap ChatPanel in a `<DraggablePanel>` that supports docked/floating modes. The chat content is unchanged; the chrome is new. (`GeoEditorView.tsx` recent commits already moved chat to a floating overlay — this is the cleanup, not the introduction.)

### Pattern 5: One-Way Routing (URL → State, never State → URL via effect)

**What:** Per UX_REWRITE §8 implicit-transition #6. Routes parse atomically; state writes URLs via explicit verb invocations (`router.push('/d/<naddr>')` inside `drawingApi.openOnShelf`).

**File:** `src/features/geo-editor/hooks/useRouting.ts` (rewrite)

The current 457-line `useRouting.ts` has bidirectional sync via effects. The rewrite splits it:

- **`useRouteHydration()`** — Mounts once. Watches `location.pathname`. On change, parses and dispatches `applyRouteAtomically({ stance, shelf, view })` to the store. **One direction only.**
- **`router` write helpers** — `router.toBrowse()`, `router.toFocusedDataset(naddr)`, `router.toAuthor(draftId)`. Called by explicit verbs.
- **Hash redirect shim** — Mount-time one-shot: detect old hash routes, transform to path, `replaceState` once, never look again.

**Trade-off:** Two-way sync was "convenient" because changing state and changing URL felt symmetric. It was the source of half the implicit-transition bugs. Explicit asymmetry is the fix.

### Pattern 6: Hook-Extraction for the Two Monoliths

#### GeoEditorView.tsx (2,088 lines → ~400 lines orchestrator + N stance layouts + extracted hooks)

The orchestration pattern from [Maxim Logunov's "Mastering the Orchestration Pattern in React"](https://dev.to/maximlogunov/mastering-the-orchestration-pattern-in-react-taming-complex-component-logic-5c9i) and [React's "Reusing Logic with Custom Hooks"](https://react.dev/learn/reusing-logic-with-custom-hooks) gives the playbook: **effects should not orchestrate data flow** — extract them.

Proposed extraction targets (preserving existing `hooks/` directory):

| Current location in GeoEditorView | Extract to | Notes |
|---|---|---|
| 6 effects related to right-dock state (`desktopRightDockMode`) | `useDesktopRightDock` (NEW) | Currently a single state for chat/inspect — split into two booleans (CONCERNS.md flags this) |
| 4 effects related to map viewport + bbox fitting | `useMapViewportSync` (NEW) | Driven by shelf changes after rewrite |
| 3 effects related to mode-related cursor + pan-lock | `useModeCursor` (NEW) | Remove dead `isDrawingMode` |
| Modal / dialog state (Blossom upload, OSM import, etc.) | `useEditorDialogs` (NEW) | Pure state, no editor coupling |
| All `useState` for stance-specific layout (mobile panel, sidebar collapsed, etc.) | Per-layout component local state | Stops leaking layout state into orchestrator |

After extraction, `GeoEditorView.tsx` becomes:

```typescript
export function GeoEditorView() {
  useRouteHydration();          // existing logic, rewritten one-way
  const stance = useStance();   // selector
  useMapEditorBootstrap();      // creates GeoEditor on mount, destroys on unmount
  useDesktopRightDock();
  useMapViewportSync();
  useModeCursor();
  useEditorDialogs();

  return (
    <EditorShell>
      {stance.kind === 'browse' && <BrowseLayout />}
      {stance.kind === 'focus' && <FocusLayout />}
      {stance.kind === 'author' && <AuthorLayout />}
      <DetachableChatPanel />    {/* always rendered, "visible but ignorable" */}
      <DialogPortals />          {/* modals */}
    </EditorShell>
  );
}
```

#### ChatPanel.tsx (1,845 lines) + chat store (1,603 lines)

Per CONCERNS.md: extract streaming, tool execution, wallet, payment, settings, message-list rendering. Each becomes a hook (`useChatStream`, `useToolExecution`, etc.) and a sub-component.

Extraction order (least-risky first):
1. **`useChatSettings`** — already partially exists in `useChatSettingsSync.ts`. Consolidate.
2. **`useChatBinding`** — new, owns the binding chip state. Independent of streaming.
3. **`useToolExecution`** — extracts the tool-call dispatch + result-feedback loop. Calls into `drawingApi`.
4. **`useChatStream`** — Routstr streaming + token assembly. The riskiest extraction; do last.
5. **Sub-components** — `<ChatBindingChip>`, `<ChatMessageList>`, `<ChatComposer>`, `<ChatPaymentBanner>`.

The chat store splits along the same lines: separate slices for `messagesSlice`, `bindingSlice`, `toolExecSlice`, `paymentSlice`, `settingsSlice`.

**Sources:**
- [Mastering the Orchestration Pattern in React](https://dev.to/maximlogunov/mastering-the-orchestration-pattern-in-react-taming-complex-component-logic-5c9i)
- [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)
- [Refactoring components in React with custom hooks](https://codescene.com/blog/refactoring-components-in-react-with-custom-hooks)

---

## State Migration Strategy: How to Collapse Three Mode Systems Without Breaking the App

**Honest assessment of options:**

| Option | Description | Verdict |
|---|---|---|
| **A. Atomic swap** | One PR replaces `viewMode + editIsolationEnabled + splitWithEditor + activeEntity/entityIntent` with `stance`. All ~80 call sites migrated. Merge or revert. | **Recommended.** This is a solo-maintainer + AI-agent project. Long-lived branches accumulate conflicts; gradual rollout coordination cost > swap cost. The maintainer cannot dogfood today anyway, so "broken for a few days during migration" is the baseline. |
| **B. Parallel slices, derive new from old** | Add `stance` as a *derived* selector from existing state. Migrate consumers to read `stance`. Once all read `stance`, flip the source of truth. | Tempting but doubles the slice surface during migration. Risk of permanent partial state. |
| **C. Feature-flagged store** | Two stores, switch via env var. | Way too much code duplication for a single client. Reject. |

**Atomic-swap execution playbook (Phase 1 of the rollout):**

1. **Write the new types first.** `Stance` discriminated union, `ShelfItem` union, `ShelfSlice` shape — all in `store/types.ts`. TypeScript will mark every existing call site as broken. Use this as the worklist.
2. **Codemod the cheap cases.** A jscodeshift / ast-grep pass on `viewMode === 'edit'` → `stance.kind === 'author'`, etc. Most are mechanical.
3. **Manually rewrite the six implicit transitions.** Each one becomes an explicit verb call. UX_REWRITE.md §8 lists them with file:line.
4. **Drop the old slices.** Delete `viewModeSlice.ts`, drop `editIsolationEnabled` from `uiSlice`, drop `activeContextScope*` from wherever they live (likely a hook). Drop AppSidebar's local mode mirror.
5. **Validate against the dead-state list from CONCERNS.md.** `isDrawingMode`, `_setMapError`, the AppSidebar shadow state — verify they're gone.

Codemods + the TypeScript compiler do most of the work because the **new types make all the old call sites compile errors.** This is the right tool — not feature flags, not gradual rollouts. The discriminated union *forces* every site to handle every stance, which is exactly what was missing.

**Sources:**
- [Avoiding Booleans in React Components with a State Enum](https://guiferreira.me/archive/2020/10/avoiding-booleans-in-react-components-with-a-state-enum/)
- [Avoid impossible UI states with React, TypeScript and xState](https://whereisthemouse.com/avoid-impossible-ui-states-with-react-typescript-and-xstate)
- Synthesis: the standard "feature flag for DB migration" pattern from [DevCycle](https://devcycle.com/blog/using-feature-flags-for-database-migrations-without-disrupting-your-end-user) applies to multi-tenant systems where you can't break clients. A solo-maintainer client app doesn't have that constraint.

---

## Suggested Build Order (with Reasoning)

Mostly aligned with `UX_REWRITE.md §11`, with refinements based on the architectural dependencies surfaced above.

**Phase 1 — Stance enum + delete implicit transitions** *(must come first)*
- Reason: Nothing else can be built cleanly while three mode systems are alive. The shelf depends on stance being canonical; the chat binding chip depends on it; the drawing API's `stance === 'author'` guards depend on it.
- Files: `store/types.ts`, `store/editorCoreSlice.ts`, delete `store/viewModeSlice.ts`, codemod ~80 call sites, manually rewrite the six transitions per UX_REWRITE §8.
- Surface change: zero (the goal). Pure refactor under the existing UI.
- Risk: highest — touches everything. But the typed-union worklist makes it tractable.

**Phase 2 — Drawing API layer + Shelf slice skeleton** *(unblocks everything else)*
- Reason: The shelf is the new input to `useMapLayers`. The drawing API is the boundary every later phase will plug into.
- Files: `src/features/geo-editor/api/` (NEW), `store/shelfSlice.ts` (NEW). Initially the API just wraps existing editor methods — most verbs are pass-throughs.
- Surface change: still none.
- Risk: medium. New abstractions but no UI rewrites yet.

**Phase 3 — Path-based routing rewrite** *(prerequisite for Share)*
- Reason: Per UX_REWRITE §9. Decouples URL from state, fixes the "URL changes don't atomically apply" bugs.
- Files: `hooks/useRouting.ts`, redirect shim in `src/index.ts` / `App.tsx`.
- Risk: medium — share links must keep working. One-shot hash redirect covers it.

**Phase 4 — Map Shelf UI + sidebar Open verb** *(first user-visible change)*
- Reason: Shelf slice from Phase 2 finally gets its UI. `useMapLayers` is repointed at `shelfSlice.items`. Sidebar list rows get `Open` (adds to shelf).
- Files: `components/MapShelf.tsx` (NEW), `components/StanceIndicator.tsx` (NEW), `AppSidebar.tsx` (delete shadow state + add Open verb), `hooks/useMapLayers.ts` (input change).
- Risk: medium — first visible UX change. Worth a maintainer dogfood checkpoint.

**Phase 5 — GeoEditorView orchestrator split + stance layouts** *(unblocks Author entry)*
- Reason: Browse / Focus / Author layouts are now meaningfully different (shelf only in Focus/Author, Toolbar only in Author). Extract per Pattern 6 above.
- Files: `GeoEditorView.tsx` (shrink), `layouts/BrowseLayout.tsx` + `FocusLayout.tsx` + `AuthorLayout.tsx` (NEW), 5–10 new hooks.
- Risk: medium-high — large file shuffling. Mitigation: each layout is a thin compose-existing-components shell.

**Phase 6 — Sidebar rework (Pinned/Recent/Search + in-place Inspect)**
- Reason: Per UX_REWRITE §4. Independent of chat work. Should come before chat detach so navigator behavior is stable.
- Files: `AppSidebar.tsx` and its panels.
- Risk: low — leaf-level component work.

**Phase 7 — Chat detach + binding chip + chat-store split**
- Reason: With stance + shelf + drawing API in place, the chat panel can be safely refactored without "where does context come from?" ambiguity. The binding chip becomes meaningful because there's an explicit shelf to bind to.
- Files: `chat/ChatPanel.tsx`, `chat/store.ts` (split slices), new hooks `useChatBinding`, `useToolExecution`, `useChatStream`.
- Risk: high without the prior phases. Low after them.

**Phase 8 — AI proposal verbs on the Shelf (the demo unlock)**
- Reason: With drawing API + shelf + chat detach in place, the AI proposal flow is the last lap.
- Files: `api/drawingApi.ts` (`proposeFeatures`, `commitProposal`), `chat/tools/registry.ts` (Zod-derived tools), proposal chip UI in `MapShelf.tsx`, preview layer in a new manager or extension to `LayerManager.ts`.
- Risk: medium — the demo target. Lots of UX polish work here, but the architectural plumbing is done.

**Phase 9 — Polish** *(per UX_REWRITE §11)*
- Browse landing prompt, share dialog with optional viewport, workspace surfacing, mobile shelf sheet, classical-utility audit (anonymous flow walkthrough).

### Critical ordering invariants

- **Stance enum must precede everything.** Trying to build the Shelf or the drawing API on top of the three-mode system means the new code has to know about both. Don't.
- **Drawing API must precede AI proposal verbs.** The whole point of the drawing API is that AI proposals call the same path as UI verbs.
- **Sidebar rework can be moved earlier or later** — it's loosely coupled. Recommendation: after the visible Shelf lands, so users get a coherent navigator/working-set distinction at the same time.
- **Chat detach can be deferred almost arbitrarily.** If Phase 1–6 ship cleanly, Earthly is already in a much better state. The demo (Phase 8) needs Phase 7, but Phase 7 is decoupled from everything else.

---

## "Visible but Ignorable" as a State-Scoping Discipline

This is more architectural than UX, despite the framing. The discipline:

1. **Anonymous read paths must work without `accounts.active`.** Every component that reads from Nostr must handle the no-account case. The existing `useTimeline` already does this (subscriptions don't require signing). Audit during Phase 9.
2. **Chat surface is always rendered, never gating.** No "click to enable chat" overlay. No `if (!chat) return <ChatPrompt />` upstream of map content. Render the panel collapsed if the user has never used it.
3. **Nostr lingo is *transformed*, not *hidden*.** Per PROJECT.md constraint. Plain-language relabeling at the leaf level (a panel that says "Connect to publish" instead of "Login with NIP-07"). The state model doesn't change; the rendered text does. This is a leaf-component concern, not an orchestration concern — defer to phase-specific work.
4. **Identity surface state lives in `accounts` (applesauce), never gates other state.** Today `accounts.active` is read by maybe 30 sites. Audit that none of them gate flows that don't actually require an account.

The orchestrator (post-Phase 5) is a good audit point: stance + shelf + drawing API don't *read* `accounts.active` at all. They might read it from inside specific verbs (e.g. `share` needs to know if you can sign anything), but the architecture doesn't pivot on it.

**Sources:**
- [Progressive Disclosure — Nielsen Norman Group](https://www.nngroup.com/articles/progressive-disclosure/)
- [Responsive Enabling and Progressive Disclosure Patterns](https://medium.com/design-bootcamp/enhancing-ux-with-responsive-enabling-and-progressive-disclosure-patterns-92c07029a46a) — "all options visible from the start, only relevant ones enabled" is closer to Earthly's contract than classic progressive disclosure (which hides)

---

## Anti-Patterns

### Anti-Pattern 1: Separate "AI Path" and "UI Path" to the Editor

**What people do:** When wiring up an AI/chat to a canvas editor, treat the AI as a special caller — its own code path into the engine, its own state for tracking in-flight AI operations, its own "AI mode" the editor toggles into.

**Why it's wrong:** Two paths means two failure modes, two state graphs, two sets of edge cases. The AI's output is *just* user output that came from a different input method. (Cursor's history of "AI edits applying without diff/approval UI" regressions, per [their forum thread](https://forum.cursor.com/t/regression-ai-edits-applying-automatically-without-diff-approval-ui/154887), are a cautionary tale: the UI was right when AI edits went through the same review UI as manual edits. Bypassing it created the bug.)

**Do this instead:** **One** drawing API, called identically. The fact that the call came from a chat tool executor vs. a Toolbar button is information for telemetry, not for routing. Tag the operation's source on the resulting shelf item (`source: 'chat:<msgId>' | 'ui:toolbar'`) so the UI can render "AI proposed" vs "you drew this," but the *code path* is the same.

### Anti-Pattern 2: useEffect-Driven State Sync (Bidirectional)

**What people do:** When two pieces of state should agree (URL ↔ store, AppSidebar local state ↔ store), wire up effects in both directions.

**Why it's wrong:** Race conditions. The current Earthly has this exact bug ("dataset load auto-promotes view mode"). Effects fire in undefined order; whichever wins corrupts the other.

**Do this instead:** Pick a single source of truth. Other consumers derive. Writes go through explicit actions, not through effects watching other state. Per UX_REWRITE §8 transition #6.

### Anti-Pattern 3: Shadow State (Component-Local Mirror of Store State)

**What people do:** A component (`AppSidebar` is the current example) keeps its own `useState` for things that also live in the store, with effects to sync. "For convenience."

**Why it's wrong:** Two sources of truth. Bugs concentrate at the sync points.

**Do this instead:** Read from the store. If a derived view is needed, use a selector. If "local-only ephemeral state" is genuinely needed (e.g. an open/closed dropdown), use local state but **don't mirror store data**.

### Anti-Pattern 4: AI-Generated Geometry Committed Directly to the Dataset

**What people do:** LLM emits a `write_geojson` tool call → tool executor calls `editor.setFeatures([...])` → user has to undo to reject.

**Why it's wrong:** Undo isn't a review affordance. Users don't trust AI output enough to default-accept. (Tiptap's AI Toolkit and Cursor's diff-approval UI exist for this reason.)

**Do this instead:** AI output lands on the shelf as `kind: 'ai-proposal'` with `pending: true`. Renders as a preview layer (visually distinct — dashed outlines, ghost fill). Shelf chip has Accept / Reject / Refine verbs. Only Accept calls into the dataset.

### Anti-Pattern 5: Hardcoded Chat-to-Editor Coupling (`activeContextScope`)

**What people do:** Chat reads "what dataset is currently being viewed" from a globally-shared piece of state. Convenient. But the moment the user wants the chat to be about something *else* (last week's map, a comparison set, nothing in particular), the implicit binding fights them.

**Why it's wrong:** No way to override. No way to scope. The binding is invisible — users can't tell what the chat thinks it knows about.

**Do this instead:** Explicit `binding` field in chat store. Visible chip. User-controllable. Default to the shelf (Focus) or the draft (Author) — *defaults*, not lock-ins. Per UX_REWRITE §6.

---

## Integration Points

### External Services

| Service | Integration Pattern | Architectural Touch Point |
|---------|---------------------|---------------------------|
| **ContextVM MCP** | Existing MCP-over-Nostr client (`src/ctxcn/EarthlyGeoServerClient.ts`). Tool execution boundary. | Chat `useToolExecution` hook calls into MCP client. Remote tools and local editor tools should share the same dispatch shape: a tool name, validated args, a Result. |
| **Routstr (chat streaming)** | Existing in `src/features/chat/routstr.ts`. | Owned by `useChatStream` after the chat split. No change to transport. |
| **Applesauce (Nostr)** | Existing singletons in `src/lib/nostr/index.ts`. | Read by Nostr-aware hooks (`useGeoDatasets`, etc). Stance/shelf are agnostic to Nostr identity — anonymous browse works. |
| **Mapnolia (PMTiles)** | External binary. Layer announcements via kind 34444. | Map layer ingestion stays in `useMapLayers`. Out of scope for this milestone. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| **Toolbar ↔ Drawing API** | Function call (direct import) | Toolbar buttons call `drawingApi.*` |
| **Chat tools ↔ Drawing API** | Function call (via tool registry adapter) | Tool registry maps LLM tool names → drawingApi calls |
| **Drawing API ↔ Store** | Direct store mutation via `useEditorStore.getState()` | API is the only writer for verbs |
| **Drawing API ↔ GeoEditor** | Function call (via store.editor reference) | API never touches MapLibre directly |
| **Store ↔ React UI** | Zustand selectors | Standard pattern |
| **useRouting ↔ Store** | One-way: URL → atomic dispatch | Per UX_REWRITE §9 |
| **Explicit verbs (router writes) ↔ URL** | One-way: verb → `router.push()` | The other half of the routing asymmetry |
| **Chat store ↔ Editor store** | Read-only via selectors; writes via drawingApi | The two stores stay independent. They communicate via the verb layer, not by importing each other. |

The last row is critical: **the chat store does not import the editor store and vice versa.** They are two separate Zustand stores that converge at the drawing API. This is the architectural payoff for designing the API as if it were a package boundary (per PROJECT.md constraint).

---

## Scaling Considerations (architectural, not user-count)

| Concern | At MVP | At "real use" | At "this is my main app" |
|---------|--------|---------------|--------------------------|
| Shelf size | <10 items typical | LRU at 50 items | Virtualized list, eviction policy |
| AI proposals concurrent | 1 typical | Several pending | Queue + cancellation per messageId |
| Drawing API verb count | ~12 (one per UX verb) | ~20 with refinements | Code-generate from schema registry |
| MapLibre layer count from shelf | <20 | <100 | Layer pooling (LayerManager already supports) |

The first column is what Phase 8 ships. The others are deferral targets — none are blockers.

---

## Sources

**Editor-with-chat architectures (closest analogs):**
- [tldraw Agent Starter Kit](https://tldraw.dev/starter-kits/agent) — Zod-defined action schemas, util classes with `applyAction`/`sanitizeAction`/`getInfo`, modular registration
- [tldraw AI Integration overview](https://tldraw.dev/docs/ai) — canvas as output / visual workflows / AI agents pattern
- [tldraw/ai package architecture (DeepWiki)](https://deepwiki.com/tldraw/ai/1-overview) — "fundamental unit is the change," streaming vs generate modes
- [Exploring AI interaction design and multiplayer with tldraw — PartyKit blog](https://blog.partykit.io/posts/ai-interactions-with-tldraw/)
- [Felt AI Extensions](https://help.felt.com/felt-ai/ai-extensions) — JS SDK as the AI's surface area
- [Felt MCP integration via Composio](https://composio.dev/toolkits/felt) — same MCP-over-network pattern Earthly uses with ContextVM

**State machine + discriminated unions:**
- [Avoid impossible UI states with React, TypeScript and xState](https://whereisthemouse.com/avoid-impossible-ui-states-with-react-typescript-and-xstate)
- [Taming Complex React State with Union Types](https://www.joefiorini.com/taming-complex-state-union-types)
- [Discriminated Unions | React with TypeScript — Steve Kinney](https://stevekinney.com/courses/react-typescript/typescript-discriminated-unions)
- [Avoiding Booleans in React Components with a State Enum](https://guiferreira.me/archive/2020/10/avoiding-booleans-in-react-components-with-a-state-enum/)
- [Put the TypeScript enums and Booleans away — LogRocket](https://blog.logrocket.com/put-the-typescript-enums-and-booleans-away/)
- [Simplify Your React Component's State With a State Machine](https://betterprogramming.pub/simplify-your-react-components-state-with-a-state-machine-8e9c9a4ee1f6)

**Hook extraction + orchestrator splitting:**
- [Mastering the Orchestration Pattern in React — DEV](https://dev.to/maximlogunov/mastering-the-orchestration-pattern-in-react-taming-complex-component-logic-5c9i)
- [Reusing Logic with Custom Hooks — React docs](https://react.dev/learn/reusing-logic-with-custom-hooks)
- [Refactoring components in React with custom hooks — CodeScene](https://codescene.com/blog/refactoring-components-in-react-with-custom-hooks)
- [Extract React Hook Refactoring — Rado's Blog](https://blog.rstankov.com/extract-react-hook-refactoring/)
- [How to refactor large React components — LogRocket](https://blog.logrocket.com/refactor-react-components-hooks/)

**AI tool calling + shared UI/AI interfaces:**
- [Vercel AI SDK — Foundations: Tools](https://ai-sdk.dev/docs/foundations/tools) — Zod inputSchema + execute function
- [AI SDK 5 release notes](https://vercel.com/blog/ai-sdk-5)
- [The tool-call render pattern — Stackademic](https://stackademic.com/blog/the-tool-call-render-pattern-turning-your-ai-from-a-chatty-bot-into-a-doer)
- [MCP Tool Schema — Merge.dev](https://www.merge.dev/blog/mcp-tool-schema)
- [MCP Tools spec — modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [Build an MCP server — OpenAI Apps SDK](https://developers.openai.com/apps-sdk/build/mcp-server) — `_meta.ui.visibility` for model-callable vs UI-callable

**Accept/reject diff UI for AI output:**
- [Tiptap AI Changes](https://tiptap.dev/docs/content-ai/capabilities/changes/overview) — accept/reject per change in editor
- [Tiptap AI Toolkit Review Changes](https://tiptap.dev/docs/content-ai/capabilities/ai-toolkit/agents/review-changes)
- [Cursor Composer diff workflow](https://cursor.gr.com/composer.html)
- [Cursor regression — AI edits applying without diff approval](https://forum.cursor.com/t/regression-ai-edits-applying-automatically-without-diff-approval-ui/154887) — instructive failure mode
- [VS Code Copilot — review code edits](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)

**Visible-but-ignorable UX architecture:**
- [Progressive Disclosure — NN/G](https://www.nngroup.com/articles/progressive-disclosure/)
- [Responsive Enabling and Progressive Disclosure Patterns — Medium](https://medium.com/design-bootcamp/enhancing-ux-with-responsive-enabling-and-progressive-disclosure-patterns-92c07029a46a)
- [Designing for Progressive Disclosure — UXmatters](https://www.uxmatters.com/mt/archives/2020/05/designing-for-progressive-disclosure.php)

**MapLibre integration patterns:**
- [MapLibre GL JS docs](https://maplibre.org/maplibre-gl-js/docs/API/)
- [maplibre-gl-draw](https://github.com/birkskyum/maplibre-gl-draw) — reference for the imperative drawing pattern (the existing `GeoEditor` is a custom implementation in the same spirit)
- [maplibre-gl-geo-editor](https://github.com/opengeos/maplibre-gl-geo-editor) — Union/Split/Scale/Difference/Simplify; informs what verbs the drawing API should eventually cover

**Internal references:**
- `.planning/PROJECT.md` — Core Value, pillars, constraints (amend, don't replace)
- `.planning/codebase/ARCHITECTURE.md` — existing architecture (refreshed 2026-05-24)
- `.planning/codebase/STRUCTURE.md` — file layout
- `.planning/codebase/CONCERNS.md` — orchestration debt (Legacy UX State Model, AppSidebar shadow modes, GeoEditorView complexity, ChatPanel monolith)
- `UX_REWRITE.md` §§2, 3, 6, 8, 9, 10, 11 — locked design spec for the orchestration cleanup
- `.planning/research/STACK.md` — chat/tools stack (Routstr, MCP, Zod, AJV/Turf for validation)

---

*Architecture research for: Earthly v1 orchestration cleanup + AI authoring*
*Researched: 2026-05-26*
