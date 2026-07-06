# Phase 10: Story / Article (~37520) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-26
**Phase:** 10-story-article-37520
**Areas discussed:** Story navigation / where it lives

---

## Story navigation / where it lives

### Browse surface — where users discover Stories
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated "Stories" rail tab | New Stories destination in the left rail alongside Datasets/Contexts; avoids the Phase-9 "no Groups tab" gap | ✓ |
| Fold into an existing panel | Surface Stories inside the Contexts/Library panel as a filter/sub-section | |
| Map-first (pins) | Stories appear as map markers and are opened from there | |

**User's choice:** Dedicated "Stories" rail tab.

### Create entry point — authoring a new Story
| Option | Description | Selected |
|--------|-------------|----------|
| "New Story" in the Stories panel | Button at top of the Stories rail panel (mirrors Datasets/Groups creation) | ✓ |
| Global compose action | Top-level compose/"+" affordance in the toolbar | |
| From the map / current view | Start a Story seeded from the current map view or selection | |

**User's choice:** "New Story" in the Stories panel.

### Open layout — how an opened Story presents relative to the map
| Option | Description | Selected |
|--------|-------------|----------|
| In the info panel, map stays canvas | Narrative scrolls in the right info panel; inline eye-toggle/fly-to drive the main map; map lane = main map filtered to the Story's refs | ✓ |
| Wide reading takeover | Dedicated wider reading view (narrative + own map lane side-by-side) | |
| You decide | Leave to planner/UI-spec | |

**User's choice:** In the info panel, map stays canvas.

### Shareability — deep-link + social preview
| Option | Description | Selected |
|--------|-------------|----------|
| Route + OG card | `/story/:naddr` deep-link route AND open-graph social card (consistent with /geoevent, /mapcontext) | ✓ |
| Route only, OG later | Deep-link route now, defer OG social-card generation | |
| You decide | Leave to planner | |

**User's choice:** Route + OG card.

---

## Claude's Discretion

The user deliberately limited discussion to navigation. Left to research + planner defaults
(must reuse existing machinery, stay consistent with the navigation decisions):
- Body editor type (TipTap WYSIWYG vs Markdown-source + preview; stored content must be Markdown)
- Geo-ref insertion UX (default: reuse the `@`-mention picker)
- Reader layout details (narrative/map-lane composition; refs shown/hidden on load)
- Draft storage (local-first preferred vs NIP-23 kind-30024 draft event)
- Propose-edit (STORY-06) shape — content-type extension vs spec discriminator — and the
  author accept/reject preview (diff) UX

## Deferred Ideas

- Wide/takeover reading view for long-form Stories — deferred in favor of info-panel consistency.
- Groups-tab cleanup (Phase-9 follow-up) — tracked separately, not part of Phase 10.
