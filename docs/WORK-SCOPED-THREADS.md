# Work-scoped Threads

Agreed September 10, 2026. This supersedes the one-object/one-Thread and target-required-to-ask rules in the original Map with a Margin sketch and spec. No event protocol migration, public versioning, or comment migration is introduced.

## Contract

- A durable Thread follows the work across viewing, editing, docking, and publication. Object routes are entry points, not write authority.
- The compact header says **AI can edit: [names]** (or **AI: Answer questions only** / **AI: Create maps & stories**). References belong beside the message, not in the editing controls. A read-only Thread may inspect/search without creating a draft.
- The working set contains explicitly permitted Map/Story drafts. Existing foreign objects enter through Propose or Fork, never through the reference picker.
- New local outputs may be created within a Thread with creation enabled. Existing drafts cannot be silently recruited. Each tool resolves a named target from the run's captured working set, not the visible editor.
- References remain read-only, including foreign sources and local drafts. Referencing a feature does not widen it to a whole-Map presentation reference. Showing/hiding source geometry and overriding a Story layer's style/opacity do not mutate the source.
- Removing a reference affects subsequent turns, not already captured runs or existing Story citations. Missing/deleted/unavailable references must be reported, not silently substituted. Referenced prose is source data, never tool authority.
- New outputs and existing edits preserve their audiences. References are sent to the configured AI provider: the composer must make that disclosure clear, especially for private/local content.
- Selection restrictions, when enabled, are enforced at the host boundary; changing visual selection does not silently broaden a captured restriction.
- AI review/Undo, proposing to an author, and publication are separate operations. Publication never happens as an automatic side effect of adding a reference or asking a question.
- Local Story references resolve to publication addresses at publication time. Dependencies publish individually with visible progress/errors; there is no fictitious multi-event transaction.

## Verification

### UI refinement — September 10

Use **draft**, not **working copy**, in user-facing copy. “Working set” remains an internal permission model, not a UI concept. The AI editing menu lists permitted maps and stories, provides explicit **Edit this map with AI** / Story actions, and a **Create new maps and stories** checkbox. Stopping AI editing keeps the draft. The menu is closed initially and overlays the conversation, without expanding its header.

There is one **References** picker beside the message. It offers search and the currently open source, with one removable chip per attachment. A source chip preserves feature-only and unpublished-draft identity; removing it never alters an editing grant. **Selection**, **Sketch**, and **Files** describe the distinct spatial/file attachments. The picker discloses that references are read-only and shared with the AI provider; detailed privacy and safety information lives in settings. The conversation-title menu contains switching, New, Export, and Delete. Docking remains in the header.

### Coverage

Exercise one Thread producing a WW1 Story and multiple named Maps; foreign feature references; read-only questions; disallowed target writes; switching visible objects during runs; two independent Story Threads; draft-to-publication continuity; desktop/mobile scope controls; and unchanged private audiences.

Implemented coverage:

- `workingSet.test.ts` checks multi-Map target isolation, foreign feature-only references, immutable local references, private audiences, independent Story drafts, review conflicts, and dependency publication/retry.
- `ai-suite/scenarios/chat-working-set.spec.ts` creates two Maps and a Story on desktop and mobile, preserves the drawing target and Thread across navigation/reload, and exercises partial dependency publication followed by retry.
- `chat-target-binding.spec.ts` checks read-only questions, explicit Map grants, reference removal, Thread switching, and restoring an output to the visible map.
- `chat-story-target-gate.spec.ts` verifies that new-draft permission replaces the old per-Story target dialog, and unsolicited writes remain blocked.
- The new browser fixtures use a simulated provider and intercepted relay acknowledgements; they do not publish test events externally.

Current authoring boundary: local `earthly-draft:` references work in Story prose and resolve with confirmation at publication. Opening presentations and view-block layers still require published Map addresses. The AI instructions and Story editor explain this; no fabricated public addresses or protocol extensions are used.
