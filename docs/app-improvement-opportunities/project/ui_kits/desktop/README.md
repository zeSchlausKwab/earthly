# Desktop UI kit — Earthly Studio

Full-screen recreation of the desktop workspace in the "dense instrument" system.

- **`index.html`** — the whole shell: title bar (traffic lights · workspace · stance segmented · personal cluster), the **25 / 50 / 25** body (left active panel whose *header is the panel switcher*, center map with the on-map control cluster, right assistant chat), and the mono status bar. Also registered as a Starting Point.

Layout rule: **left = navigator + active panel, right = chat (always), center map keeps its width.** The panel switcher lives in the left panel's header (a dropdown) so it costs no column. Map panels (Map Stack, Basemap, Overlays) are transient overlays launched from the toolbar — not docked columns.
