# Work-scoped Threads

Agreed September 10, 2026. This supersedes the one-object/one-Thread and target-required-to-ask rules in the original Map with a Margin sketch and spec. No event protocol migration, public versioning, or comment migration is introduced.

## Contract

- A durable Thread follows the work across viewing, editing, docking, and publication. Object routes are entry points, not write authority.
- The compact header names **Working on** separately from **References**. A read-only Thread may inspect/search without creating a draft.
- The working set contains explicitly permitted Map/Story drafts. Existing foreign objects enter through Propose or Fork, never through the reference picker.
- New local outputs may be created within a Thread with creation enabled. Existing drafts cannot be silently recruited. Each tool resolves a named target from the run's captured working set, not the visible editor.
- References remain read-only, including foreign sources and local drafts. Referencing a feature does not widen it to a whole-Map presentation reference. Showing/hiding source geometry and overriding a Story layer's style/opacity do not mutate the source.
- Removing a reference affects subsequent turns, not already captured runs or existing Story citations. Missing/deleted/unavailable references must be reported, not silently substituted. Referenced prose is source data, never tool authority.
- New outputs and existing edits preserve their audiences. References are sent to the configured AI provider: the composer must make that disclosure clear, especially for private/local content.
- Selection restrictions, when enabled, are enforced at the host boundary; changing visual selection does not silently broaden a captured restriction.
- AI review/Undo, proposing to an author, and publication are separate operations. Publication never happens as an automatic side effect of adding a reference or asking a question.
- Local Story references resolve to publication addresses at publication time. Dependencies publish individually with visible progress/errors; there is no fictitious multi-event transaction.

## Verification

Exercise one Thread producing a WW1 Story and multiple named Maps; foreign feature references; read-only questions; disallowed target writes; switching visible objects during runs; two independent Story Threads; draft-to-publication continuity; desktop/mobile scope controls; and unchanged private audiences.
