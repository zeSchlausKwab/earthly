---
name: earthly-design
description: Use this skill to generate well-branded interfaces and assets for Earthly (the Nostr-native map/geo-data tool), either for production or throwaway prototypes/mocks. Contains the "dense instrument" design language — dark-first colors, dense spacing, cornered radii, IBM Plex Sans / JetBrains Mono type, and reusable UI components.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files (`styles.css`, `tokens/`, `components/`, `guidelines/`).

Earthly's language is **dense and cornered**: sharp 2px corners, hairline borders instead of shadows, a tight 2·4·6·8·12 grid, small-but-legible type (11px floor), dark-first cool-graphite neutrals, and scarce single-purpose accents (amber=active/selection, cyan=info, green=ok/live, red=danger, violet=edit). Controls are 22/26/30px. Numbers are always JetBrains Mono.

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out and create static HTML files that link `styles.css` and use the token variables. If working on production code, copy assets and read the rules here to design as an expert in this brand.

If invoked without other guidance, ask what to build, ask a few questions, then act as an expert designer who outputs HTML artifacts _or_ production React (composing the components in `components/`), depending on the need.
