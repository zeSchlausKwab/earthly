# Earthly Design System

**Earthly** is a Nostr-native map where people read, add to, and curate spatial data — from a cartographer modeling complex relationships, to someone sharing a live location, to a walker posting "I saw a squirrel here" with a photo. This design system captures the **"dense instrument"** visual language: an edgier, denser evolution of Earthly's original `radix-mira` (shadcn) base toward the economy of professional tools like Blender and 3ds Max.

> **Sources.** Grounded in the Earthly codebase (`earthly/styles/globals.css` — the real `radix-mira` tokens: amber `oklch(0.8535 0.1744 88.7734)` primary, cyan secondary, `--radius: 0.2rem`, Poppins/Playfair/JetBrains Mono, dark-first tool theme). The system was explored and pressure-tested across a companion canvas doc (`Earthly UX Audit & Redesign.dc.html`) — audit, mobile concept, desktop 25/50/25 layout, map chrome, and the Map-Stack editor. This DS formalizes that exploration.

---

## The one-line philosophy
**Sharp corners, hairline borders instead of shadows, a tight grid, small-but-legible type.** A tool that is mostly cool graphite so the one amber highlight (selection / active tool) is unmissable. Not a clone of Blender — its *discipline*, in Earthly's palette.

---

## CONTENT FUNDAMENTALS
- **Voice:** plain, spatial, second-person implied. Labels are nouns/verbs, not sentences: "Publish", "New sighting", "Let others attach?", "Fades in 7 days". Group headers are terse uppercase mono ("ON THE MAP", "GEOMETRIES (4)").
- **Casing:** Title case for panel titles and buttons; UPPERCASE (mono, 9px, tracked) only for group labels and status chips (LIVE, STALE). Never all-caps for body.
- **Numbers are first-class:** coordinates, counts, vertices, latencies, sats, "fades 6d" — always JetBrains Mono, so they read as data.
- **Emoji:** allowed **only** as user content (a sighting caption: "A heron 🐦") — never in chrome, labels, or icons.
- **Tone:** matter-of-fact and dense. No marketing gloss inside the tool. Editorial voice (Playfair display, warmer sentences) appears only in onboarding / doc surfaces, never in the working UI.

## VISUAL FOUNDATIONS
- **Color:** dark-first. Cool graphite neutrals (`#151517`→`#f0f0f2`). Accents are scarce and single-purpose — **amber** = active/selection/primary, **cyan** = info/reference, **green** = ok/live/valid, **red** = danger/expiring, **violet** = edit/draft mode. Light theme (`.earthly-light`) is warm paper for light contexts.
- **Type:** IBM Plex Sans (UI), JetBrains Mono (values), Playfair Display (editorial display only). 11px floor. Dense ramp: 11/12/13/15/19.
- **Spacing:** 2·4·6·8·12·24. Panel padding is 6px; row gaps 2px. Controls are 22/26/30px tall.
- **Corners:** near-square — **2px** controls, **3px** panels, 0px on full-bleed edges. `full` radius is reserved for status dots and avatars only. **Never pill.**
- **Borders > shadows:** docked panels/rails use a 1px hairline border and *no* shadow. Only floating things (over-map panels, menus, command palette) get a shadow (`--shadow-panel`, `--shadow-pop`).
- **Selection & mode:** a 2px accent **left-border** + translucent tint marks the selected row and the active mode block (amber for selection, violet for the editing/draft block).
- **Density ≠ tap density:** rows read at 24–28px but keep a 44px hit-band on touch.
- **Motion:** minimal. Toggles slide (120ms); drawers snap to detents. No bounces, no decorative animation.
- **Hover/press:** hover lifts a row to `--surface-raised`; active/selected uses the amber fill or tint. Contrast carries hierarchy, since rounding no longer does.

## ICONOGRAPHY
- **Line icons, ~2px stroke, 12–16px** — a Lucide-style set (the canvas/UI mock uses inline Lucide-shaped SVGs). If you need a runtime icon set, use **Lucide** (CDN or `lucide-react`) — it matches the stroke weight and rounding. Substitution flagged: the DS does not ship an icon font; **Lucide is the recommended match.**
- Icons are monochrome, inheriting text color; the **active tool** icon flips to `--accent-ink` on the amber fill.
- The brand **mark** is the globe favicon (`assets/earthly-mark.png`, from `base-assets/favicon_io`). No standalone wordmark logo was provided — the wordmark is set in Playfair Display next to the mark. Do not redraw the mark.
- Emoji only in user content.

---

## Index / manifest
- **`styles.css`** — root entry; `@import`s all tokens. Consumers link this.
- **`tokens/`** — `colors.css` (palette + semantic aliases, dark default + `.earthly-light`), `typography.css`, `spacing.css` (spacing/radius/controls), `elevation.css` (the two shadows), `fonts.css` (CDN webfonts).
- **`guidelines/`** — foundation specimen cards (Colors, Type, Spacing, Brand).
- **`components/`** — reusable primitives:
  - `buttons/` — **Button**, **IconButton** (+ IconButtonGroup tool rail)
  - `forms/` — **Input**, **Toggle**
  - `controls/` — **SegmentedControl** (stance + sub-tabs)
  - `data/` — **Badge** (status/type chips), **ListRow** (the workhorse row)
  - `surfaces/` — **Panel** (framed side/map panel)
  - `overlays/` — **Menu** (+ MenuItem/MenuGroup/MenuSeparator — dropdowns, context menus, panel switcher, ⌘K palette)
- **`ui_kits/`** — `desktop/` (Studio shell — 25/50/25) and `mobile/` (map home + bottom drawer), both Starting Points.
- **`assets/`** — `earthly-mark.png`, `favicon-32.png`.
- **`SKILL.md`** — Agent-Skills entry point.

## Built on shadcn (radix-mira)
Earthly standardizes on **shadcn** and stays on it — this DS is a *re-token*, not a replacement.
- **`tokens/shadcn.css`** declares the canonical shadcn variables (`--background`, `--card`, `--primary`, `--border`, `--input`, `--ring`, `--radius`, `--font-sans`…) in the dense dark theme. Drop-in shadcn components (`<Button>`, `<Input>`, `<Select>`, `<Switch>`, `<Badge>`…) inherit the Earthly look with no per-component work.
- The dense evolution vs. stock shadcn: `--radius` **0.2rem → 0.125rem** (2px), Poppins → **IBM Plex Sans**, shadows mostly traded for hairline borders, control heights tightened to 22/26/30.
- The primitives in `components/` are **simplified stand-ins that mirror the shadcn API** (same prop shapes: `variant`, `size`, `checked`, etc.) so the specimens render standalone. **In product code, use the real shadcn components** with these tokens — don't hand-roll from the DS `.jsx`. The `.jsx` exist so the Design System tab and Starting Points have live references.

## Intentional additions
- **IconButtonGroup** — the segmented tool-rail pattern (toolbar / Build strip) is core to Earthly, so it ships alongside IconButton. Maps to a shadcn `ToggleGroup`.

## Caveats / TODO (help wanted)
- **Fonts are CDN-linked** (Google Fonts — all open-source: IBM Plex Sans, JetBrains Mono, Playfair Display are OFL). Self-host WOFF2 for production if desired.
- **Component cards are static-HTML previews** (not live-mounted from `_ds_bundle.js`) — faithful to the states, but the `.jsx`/`.d.ts` are the API source of truth.
- **UI kits** (`ui_kits/desktop`, `ui_kits/mobile`) are static high-fidelity recreations, not JSX-composed from the bundle — the fastest path to a truthful preview; deeper interactive kits can follow.
