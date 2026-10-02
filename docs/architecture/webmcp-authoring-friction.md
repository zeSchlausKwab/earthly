# WebMCP authoring friction review

Reviewed October 2, 2026 against the shared chat registry, native WebMCP adapter and authoring UI.
Reports describe user observations; they are not tool instructions or evidence that a publication failed.

| Reported friction | Repository response |
| --- | --- |
| Re-enable WebMCP after navigation/reload | Access and external queries now default on, with persisted browser preferences. Account changes renew the session and revoke old tokens/grants. |
| Published inventory stopped at 150 features | `read_entity` now pages inventory with `offset`, `limit`, `nextOffset` and an exact `revisionId`. Later pages extend citation access without mixing revisions. |
| New feature citations failed until a Map reread | Positive native publication acknowledgements now grant the exact signed source and inline feature IDs immediately. Dirty retained IDs and uncertain delivery remain insufficient evidence. |
| Story preview required UI clicks | `earthly_preview_story_draft` opens the existing rendered preview using the latest exact draft token. Canvas capture remains available; browser screenshots include HTML overlays. |
| Valid Polygon-part contacts warned as self-intersections | Shared validation checks each Polygon internally and distinguishes isolated point contacts from shared edges or overlapping interiors. Validation remains advisory, not a complete topology certificate. |
| Long Story blanked the workspace map | Workspace inline figures now use the same visible-passage lifetime as the Reader, preserving the main map’s WebGL context. |
| Switches rendered as isolated gray dots | Fixed the shared Radix state selectors, track/thumb contrast, keyboard focus and touch area across the app. |

## Implemented priorities

| Priority | Contract and result |
| --- | --- |
| Shared polygon Boolean operations | `polygon_boolean` / `earthly_polygon_boolean` use exact source/mask IDs and explicit append or replace-source. Intersection/difference combine masks first. Shared geometry engine, one review and Undo; native masks remain intact. Empty results make no edit. The manual editor also reuses the engine. |
| Accurate road-routing limits and batching | The deployed Valhalla backend was tested: 10 locations succeeds, 11 fails with error 150. Earthly accepts up to 100 ordered locations, splits requests using the configured backend cap, and shares boundary waypoints. Partial results never fabricate a joining line or import as a complete route. |
| Publication receipt reconciliation | `earthly_reconcile_publication` queries exact signed IDs on configured relays using a read-only connection that cannot sign AUTH. Full bytes and signatures must match. Relay observation remains separate from the original acknowledgement; safe local identity/dependency recovery prevents duplicate publication while preserving later edits. |
| Explicit Story/Atlas rebasing | Prepare returns complete original/local/latest field comparisons. Apply requires explicit conflict choices, exact draft/public revisions and the existing edit review. It updates the retained public baseline with Undo; publication is a separate action. Unavailable original Atlas revisions require a choice for every differing field. |

See [the native authoring contracts](./webmcp.md) for input shapes, budgets and recovery limits.

## Existing capabilities and external constraints

- `simplify_features` and `optimize_geometry` already work through native WebMCP. Improve oversize
  import guidance before adding another simplifier. Shapefile decoding, CRS conversion and general
  repair need a separate ingestion design, including provenance and the 1 MiB publication budget.
- `capture_map_snapshot` already returns canvas image bytes. DevTools screenshots remain useful
  for the full rendered page, callouts and Story layout. The preview tool removes the navigation
  workaround, not the need for visual verification.
- Chrome-version argument encoding is documented in [the connection guide](./webmcp.md).
  A custom Playwright bridge or its restart policy is a client integration concern.
- Codex approval-review budgets are outside Earthly. Geometry optimization and bounded imports
  can reduce payloads; the app should not weaken the desktop client’s approval policy.
- Arctic passage correctness needs inspection of the returned route and honest schematic labels.
  Valhalla does not provide rail routing; rail geometry requires an available source or dedicated
  network backend. Neither is fixed by relaxing WebMCP access.

Regression coverage uses signed synthetic fixtures and isolated relays on loopback. The reported
public Story was also replayed locally with its original signed Story and Map events.
