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

## Recommended follow-ups

1. **Shared polygon Boolean operations.** The manual editor has Boolean operations, but there is no
   general native polygon intersection/difference tool. Add a shared authoring primitive with exact
   feature IDs, explicit output/replacement semantics, property preservation, one review and one Undo.
   Expose it through both chat and WebMCP rather than adding browser-only GIS logic.
2. **Road-routing limits and batching.** The current Valhalla schema advertises up to 25 waypoints,
   while the remote handler forwards the request to its configured backend. Verify the deployed
   backend limit, expose it accurately, and support ordered batches sharing a boundary waypoint.
   Report partial failures and avoid presenting independent segments as one verified complete route.
3. **Publication receipt reconciliation.** Current publication distinguishes acknowledged delivery
   from uncertainty and returns signed event IDs. Repeating a finished preview reuses its receipt
   rather than signing again. Add a read-only check for the exact signed IDs on configured relays
   so agents can recover from a lost acknowledgement inside Earthly. A timeout alone must never
   trigger a fresh fork or claim that the event was not published.
4. **Explicit document rebasing.** Forking is correct for an independent edition. Updating a stale
   original needs an explicit conflict/rebase workflow that shows local changes against the latest
   public revision; never silently replace its base just to make publication succeed.

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
