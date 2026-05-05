# Earthly UX Rewrite

Status: design locked, implementation in phases.
Companion to `SPEC.md` (data model) and `CLAUDE.md` (codebase guide).

## 1. Why

The app today has three overlapping mode systems (`mode`, `viewMode`, `sidebarViewMode`), plus `editIsolationEnabled`, `activeContextScope`, `splitWithEditor`, and `activeEntity`/`entityIntent`. Modes auto-promote on dataset load, route changes, and proposal acceptance. The result is a state graph the user cannot navigate, with bugs concentrated at the implicit transitions.

The rewrite makes the user's intent **explicit and singular**, decouples "what's in the sidebar" from "what's on the map," and treats URLs as the canonical state for everything shareable.

## 2. Stances

The user is always in exactly one of three stances. Transitions are explicit, never implicit.

| Stance | Purpose | Default surface |
|---|---|---|
| **Browse** | Discovery, no commitment, anonymous-friendly. The map is a feed. | Sidebar lists, empty shelf, landing prompt |
| **Focus** | One or more pinned datasets/contexts. Inspecting, reading comments, presenting. | Shelf populated, map fitted, sidebar in nav role |
| **Author** | Drawing or editing one specific dataset. Private working state. | Toolbar visible, draft active, shelf carries references |

A persistent stance indicator is shown above the map. Clicking it opens the transition options.

## 3. Map Shelf

The shelf is a **top strip above the map** listing every dataset or context currently rendered. It is the working set; the sidebar is the navigator.

Shelf chip actions, per item:
- **Toggle visibility** (eye icon)
- **Isolate** (only this item visible; mutually exclusive across shelf)
- **Inspect** (opens detail in sidebar)
- **Share** (single-item URL; see §9)
- **Remove** (drops from shelf)

Shelf-level actions:
- **Clear**
- **Save as workspace** (see §5)

The shelf carries through into Author stance so the user can author against references. On mobile, the shelf collapses to one chip with a count and opens as a sheet.

## 4. Sidebar

Pure navigator. No split. No dual-intent (no inspect/edit on the same row). Items get one consistent action set:

- **Open** — adds to shelf, enters Focus if in Browse
- **Pin** — sticky in the sidebar list, separate from shelf
- **Inspect** — replaces the list view with detail in-place (with a back affordance), same panel; no layout mutation
- Author verbs where applicable: **New**, **Fork**, **Propose Edit**, **Curate**

Lists are organized: **Pinned → Recent → Search/Discover**. Pagination is unbounded (the 20-item ceiling is removed). Pinning is the user's commitment; recency is ephemeral.

## 5. Workspaces (persistence)

A workspace is a named, resumable bundle of:
- pinned shelf set
- active draft (if Author stance was used)
- chat session

Existing `draftSlice` and `workspaceSlice` stay. The change is surfacing workspaces explicitly: a "Resume" entry in the Browse landing prompt, and a "Save as workspace" action on the shelf. No more hidden persistence.

## 6. AI chat

Detachable floating panel (or docked, user choice). Always renders an explicit **binding chip** at the top showing what the chat is about:

- Browse / Focus default: the current shelf
- Author default: the active draft
- User can override to a single shelf item, a selection, or "no binding"

Implicit binding via `activeContextScope` is removed. The chat panel is otherwise unchanged.

## 7. Verbs

These are the explicit verbs. Each is one button, one transition, one outcome.

| Verb | Where | Outcome |
|---|---|---|
| **Open** | Sidebar list row | Add to shelf, enter Focus if in Browse |
| **Pin** | Sidebar list row | Add to user's pinned set |
| **Inspect** | Sidebar list row, shelf chip | Replace list with detail in-place |
| **New dataset** | Toolbar / Browse landing | Enter Author with blank draft |
| **Fork** | Inspect view of someone else's dataset | Enter Author with their content as a new draft (your pubkey, new d-tag) |
| **Propose Edit** | Inspect view of someone else's dataset | Enter a proposal flow producing a kind 37519 event |
| **Curate** | Inspect view of a context | Open context editor in curation mode |
| **Share** | Shelf chip, shelf header, inspect view | Copy a URL (see §9) |
| **Save as workspace** | Shelf header | Persist current shelf + draft + chat as a named workspace |

## 8. State model

Collapse:
- `viewMode` + `editIsolationEnabled` + `splitWithEditor` + `activeEntity`/`entityIntent` → single **`stance`** enum: `'browse' | 'focus' | 'author'`
- `activeContextScopeNaddr` / `activeContextScopeCoordinate` → derived from the shelf set; "isolation" is the per-item `isolated` flag (at most one true)

Keep:
- `editorCoreSlice.mode` (drawing tools — only meaningful in Author stance)
- `sidebarViewMode` for navigation between sidebar panels (datasets / contexts / chat / settings / wallet / etc.)
- `draftSlice`, `workspaceSlice` (persistence)

New slice: **`shelfSlice`**
- `items: ShelfItem[]` where `ShelfItem = { coordinate, naddr, kind, visible, isolated }`
- Actions: `addToShelf`, `removeFromShelf`, `toggleVisible`, `toggleIsolated`, `clearShelf`

### Implicit transitions to delete

These are the auto-mode triggers driving today's bugs. Each one becomes a deliberate user action.

1. `useDatasetManagement.ts:225` — dataset load → `setViewMode('edit')`. **Delete.** Loading a dataset adds it to the shelf in Focus. Author entry only via explicit Fork / New / Edit Draft.
2. `useViewMode.ts:87` — inspect → `setViewMode('view')` + sidebar mutation. **Delete.** Inspect replaces the sidebar list with a detail view, no stance change.
3. `GeoEditorView.tsx:1093–1099` — proposal acceptance → `setViewMode('view')` + `setViewDataset`. **Delete.** Acceptance shows a confirmation; the user stays where they are.
4. `AppSidebar.tsx:286–291` — context editor open → layout mutation. **Delete.** Curate is an explicit verb that swaps the sidebar's current panel, never the layout.
5. `AppSidebar.tsx:313–317` — meta mode leaves work mode. **Soften.** Meta panels (settings, wallet) preserve the previous work-panel state and restore on close.
6. `useRouting.ts:243–256` — route sync triggers `setFocused` + `setSidebarViewMode` + scope. **Rewrite.** One direction only: parse URL → derive `{ stance, shelf, view }` → apply atomically. State changes write to URL, never read from it.

## 9. Routes & sharing

URLs are canonical for shareable state. Author is local-only.

| URL | State |
|---|---|
| `/` | Browse, empty shelf, default map view |
| `/c/<naddr>` | Focus, shelf = [context], map fitted to context bbox |
| `/d/<naddr>` | Focus, shelf = [dataset], map fitted to dataset bbox |
| `/author/<workspace-id>` | Author, local-only |

**Path-based routing** (switch from current hash). Hash routes redirect once for backwards compat.

**Share dialog**:
- Default copies the bare URL (recipient gets bbox-fit on landing).
- Optional checkbox: "include current view" appends `?v=<lng>,<lat>,<zoom>`.
- Default off — recipients usually want bbox-fit, not your zoom.

A landed share URL **replaces** the shelf rather than merging.

### Out of scope for v1

- Multi-item shelf URLs (`/shelf?i=…`) — defer until single-chip sharing proves needed.
- OG previews for shared links — needs server-side rendering, separate effort.
- Comments side-rail / shelf badge — comments stay in the existing inspector location for this rewrite.

## 10. Reuse map

The rewrite is mostly amendment, not new components.

| Existing | Action |
|---|---|
| `AppSidebar.tsx`, `GeoDatasetsPanelContent`, context panels | Keep. Remove split branch (`splitWithEditor`, `activeEntity/entityIntent`). Add Pin / Open in shelf / Inspect (in-place) row actions. |
| `Toolbar.tsx` | Keep. Render only when `stance === 'author'`. Remove implicit `inspect` mode promotion (Toolbar.tsx:131–133). |
| `viewModeSlice`, split flags, isolation flag, entity/intent | Collapse into `stance` + `shelfSlice`. |
| `useMapLayers.ts` | Keep. Input becomes `shelf` instead of derived from scope + sidebar selection. |
| `useViewMode.ts` | Mostly delete. Remaining callers become explicit stance transitions. |
| `useRouting.ts` | Rewrite for one-way path-based routing. |
| `ChatPanel.tsx` | Keep. Wrap in detachable shell, add binding chip. Remove implicit `activeContextScope` binding. |
| `draftSlice`, `workspaceSlice` | Keep. Surface "Resume workspace" + "Save as workspace" UI. |
| `CommentsPanel`, `GeoComment*` | Keep, untouched (option B). |
| Context editor panel | Keep. Reachable only via explicit Curate verb. |
| Kind 37519 machinery | Keep. Surface via Propose Edit verb on inspected datasets. |

### Net new components

Small set:
- **Shelf** (top strip + chip)
- **Stance indicator** (above map)
- **Chat binding chip** (top of ChatPanel)
- **Browse landing prompt** (empty-shelf overlay: pick city / open last workspace / browse popular)

## 11. Phased rollout

Each phase ships independently.

1. **State collapse + delete implicit transitions.** No visible UI change; the riskiest refactor goes first while the surface is unchanged. Stance enum, shelf slice (initially empty), kill the auto-`setViewMode` calls.
2. **Path-based routing rewrite.** One-way URL → state. Hash redirect shim. Foundation for sharing.
3. **Map Shelf.** Top strip, chips, visibility/isolation. Sidebar list rows get `Open`. Split panel removed.
4. **Sidebar rework.** Pinned / Recent / Search. Inline inspect (back affordance). Verbs consolidated.
5. **AI chat detach + binding chip.** Default bindings, manual override.
6. **Polish.** Browse landing prompt, share dialog, workspace surfacing, mobile shelf sheet.

## 12. Open questions

- Should the stance indicator be a label only, or also the transition UI? Probably both — clicking it surfaces transition options inline.
- Browse landing prompt content: pick city / browse popular / resume last workspace — which is primary?
- Pin set size — bounded (e.g. top 50) or unbounded with virtualization?
- Author stance entry from Browse: is "New dataset" reachable from the toolbar in Browse, or only via the landing prompt?

These can be resolved during their phase.
