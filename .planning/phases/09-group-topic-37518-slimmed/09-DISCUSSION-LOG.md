# Phase 9: Group / Topic (37518 slimmed) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 9-group-topic-37518-slimmed
**Areas discussed:** Create/edit + governance, Schema-authoring + attach, Foreign-lane presentation, Contributor mute UX

---

## Create/edit + governance

### Editor refactor strategy
| Option | Description | Selected |
|--------|-------------|----------|
| Refactor in place | Rename map-context→group, rewrite MapContextEditorPanel→GroupEditorPanel, slim old fields to governance enum | |
| Build fresh panel | New GroupEditorPanel from scratch, no legacy-field baggage | |
| You decide | Planner picks; default refactor-in-place | ✓ |

**User's choice:** You decide (default = refactor-in-place per research "~90% rename").

### Governance ladder presentation
| Option | Description | Selected |
|--------|-------------|----------|
| 3 radio cards w/ explanations | Three cards w/ plain-language meaning; schema UI appears only for 'schema' | ✓ |
| Simple dropdown/segmented | Compact control + tooltip helper text | |
| You decide | — | |

**User's choice:** 3 radio cards with explanations.

### Escape hatch (flip to closed)
| Option | Description | Selected |
|--------|-------------|----------|
| Button on the Group view | Visible owner-only "lock down → closed" action on the view panel | ✓ |
| Inside the editor only | Change governance via the edit form | |
| You decide | — | |

**User's choice:** Visible owner-only button on the Group view.

### Curated-ref pinning (GROUP-06)
| Option | Description | Selected |
|--------|-------------|----------|
| Promote from foreign lane + add by search | One-click promote a contribution AND add curated ref by search/naddr | ✓ |
| Add by search/naddr only | Curated refs added only by owner picking datasets | |
| You decide | — | |

**User's choice:** Promote from foreign lane + add by search.

---

## Schema-authoring + attach

### Schema-authoring model (GROUP-03)
| Option | Description | Selected |
|--------|-------------|----------|
| Visual field-rule builder | Property rows → compiled JSON Schema; no JSON shown | |
| Builder + raw-JSON escape hatch | Builder default + advanced raw-JSON tab; both feed hardened worker | ✓ |
| Geometry-only now, properties later | Ship only geometry-type constraint in Phase 9 | |
| You decide | — | |

**User's choice:** Builder + raw-JSON escape hatch.

### Attach flow + warning prominence (GROUP-02/04)
| Option | Description | Selected |
|--------|-------------|----------|
| Attach from dataset, warn inline pre-publish | Attach on dataset publish flow; inline warnings before publish; never blocks | ✓ |
| Attach from the Group view | Attach action on the Group; warnings in Group-side dialog | |
| You decide | — | |

**User's choice:** Attach from dataset, warn inline pre-publish.

### Validation-warning UX (GROUP-04)
| Option | Description | Selected |
|--------|-------------|----------|
| Specific, actionable, dismissible | Per-rule failures + prominent "Publish anyway" | ✓ |
| Single summary warning | One concise "doesn't match schema — publish anyway?" line | |
| You decide | — | |

**User's choice:** Specific, actionable, dismissible.

---

## Foreign-lane presentation

### Cap + sort
| Option | Description | Selected |
|--------|-------------|----------|
| 50 visible, paginate, newest-first | Recency-only sort | |
| 50 visible, sort by author-trust then recency | Lightweight trust signal first, then recency | ✓ |
| You decide | — | |

**User's choice:** 50 visible, author-trust then recency, paginate.
**Notes:** Trust signal left open — captured as research note O-01 (proposed: NIP-02 follows boost + locally-muted drop, then recency).

### Lane UI
| Option | Description | Selected |
|--------|-------------|----------|
| Collapsed section w/ count | Curated expanded; "Community contributions (N)" collapsed below | ✓ |
| Separate tab | Two co-equal tabs Curated / Contributions | |
| You decide | — | |

**User's choice:** Collapsed section with count.

### Viewer filter override (GROUP-05)
| Option | Description | Selected |
|--------|-------------|----------|
| Per-view control on the lane, default strict | off/warn/strict inline on lane; default strict; legible filter-reason | ✓ |
| In view settings/menu, default strict | Same modes tucked in a menu | |
| You decide | — | |

**User's choice:** Per-view control on the lane, default strict.

---

## Contributor mute UX

### Mute persistence
| Option | Description | Selected |
|--------|-------------|----------|
| NIP-51 encrypted mute list | kind 10000, syncs across devices, app-wide, requires sign-in | |
| Local-only (localStorage/IndexedDB) | Per-device, no publish, works without signing | ✓ |
| You decide | — | |

**User's choice:** Local-only (localStorage/IndexedDB).

### Mute scope
| Option | Description | Selected |
|--------|-------------|----------|
| Global (per contributor) | Hides contributor everywhere in app | ✓ |
| Per-Group | Mute only within this Group's foreign lane | |
| You decide | — | |

**User's choice:** Global per-contributor.

### Mute trigger
| Option | Description | Selected |
|--------|-------------|----------|
| Per-attachment overflow menu | ⋮ menu on each foreign-lane item → "Mute @contributor" | ✓ |
| From contributor profile/avatar | Mute on profile popover | |
| You decide | — | |

**User's choice:** Per-attachment overflow menu.

---

## Claude's Discretion

- **Editor refactor strategy** — user chose "you decide"; default to refactor `MapContextEditorPanel` in place into `GroupEditorPanel`, per the research "~90% rename" framing. Planner confirms based on field-mapping cleanliness.

## Deferred Ideas

- NIP-51 encrypted / cross-device mute sync — rejected for Phase 9 in favor of local-only; revisit if cross-device mute becomes a need.
- Richer author-trust / web-of-trust model beyond follows-minus-mute — next-milestone concern (WoT deferred with NIP-72).
- Sighting creation + its `c`-attach — Phase 11.
- Comment-root widening across all kinds + entity routing/addressing — Phase 13.
- Relay-side schema enforcement — out of scope by design.
