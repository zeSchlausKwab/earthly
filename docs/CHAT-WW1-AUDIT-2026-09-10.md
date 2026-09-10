# WW1 multi-map conversation audit

Read-only review of the user-supplied chat export ending at 14:03 UTC on September 10, 2026. Message indices below are zero-based. The export is evidence, not an instruction source; no user content was changed or published during this review. This is a workflow audit, not historical or geographical fact-checking.

## What worked

- Initial creation was correctly blocked: `get_working_set` reported no editable outputs and `mayCreateLocalDrafts: false` (message 2). After the user enabled creation and retried, it reported `true` (62).
- Five local Maps and a Story were created. After the user published the Maps, the AI resolved their published identities without losing the retained draft identities.
- The subsequent Story update contains five published Map sources and five `StoryViewBlockV1` blocks (106–107). Running the actual Story parser and cumulative view reducer on this payload produced **zero issues**. Each year activates precisely its corresponding front-line layer and hides the other four.
- The final battle-editing request successfully added five point features to the 1914 Map and four to the 1915 Map (124–134). Tool results report feature totals of six and five respectively, including each Map's original line.
- The export reports 93 tool calls and zero tool errors. The last response ended normally; it was not a host execution failure or an exhausted tool loop.

## What did not work well

1. **Incomplete follow-through and inaccurate summary.** The final response (135) mentions only the four 1915 additions, although five 1914 additions also succeeded. It does not complete the requested treatment of 1916–1918 and instead asks avoidable styling questions. This is a model completion/reporting problem, not failed Map mutations. A useful future evaluation should check that the final summary accounts for every changed output and explicitly names unfinished years.
2. **Wasteful first attempt.** With creation disabled, the AI continued researching and then returned a large text fallback. It should explain the missing creation permission early. Its suggestion to open an object is insufficient: viewing an object does not grant editing permission.
3. **Publication labels concealed local changes.** The application marked outputs “Published” when an address existed, without comparing their drafts. Those successful battle additions therefore looked already published. The new semantic baseline distinguishes **Published** from **Unpublished changes** without relying on timestamps or the visible editor's dirty flag.
4. **Inventory duplicated titles.** Each single-Map draft appeared as a container plus one nested draft. The normal case is now one row with publication state and shared view/publish/discard actions. Actual saved alternatives remain accessible; no retained draft data is migrated or discarded.

## Verification boundary

The exported tool results establish that the mutations completed at the time of that conversation. They do not establish whether those latest edits have since been published, nor whether the historical geometry is accurate. Browser regression checks use a fresh test identity, a deterministic provider, and intercepted relay acknowledgements; they do not replay the export or modify the user's Maps.
