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

### Draft navigation and shared actions — September 10

These surfaces are projections, not separate copies of the same draft:

- **Drafts** is the saved-work inventory, including Map draft groups and new Story drafts. Older Map drafts, grouping and renaming remain here.
- **AI can edit** is the current conversation's explicitly permitted subset. **All drafts** links back to the inventory; appearing on the map is neither necessary nor sufficient for AI permission.
- **On the map** describes the current visual composition. A Story or an off-map draft can still be part of the conversation's work.

Opening a Map or Story draft preserves the selected conversation. On desktop, a left-docked conversation moves right to make room for the editor. A closed chat is not opened implicitly. On mobile, opening a draft shows its editor in the single sheet; returning to chat preserves the conversation and grants.

Draft row actions reuse the same editor and lifecycle handlers: **View on map** restores and fits a Map draft; **Preview Story** opens its Preview tab; **Review & publish** reveals the existing publish/proposal controls without submitting. Publication still uses the normal audience, ownership and dependency checks. **Discard draft** confirms removal of the local draft and revokes its editing grants across conversations; published events and read-only references are not deleted. References to discarded local content remain explicit unresolved references, never silently substituted. Discard is blocked during an AI run. The separate unlink icon only stops AI editing and keeps the draft.

The global Map group deletion remains distinct: it removes that saved-work group and all its local drafts. The chat row's discard action removes only the selected draft, not sibling drafts in that group.

### Conversation placement and publication status — September 10

Desktop chat has a visible **Move right** / **Move left** action in its header, including when opened through **Ask**. Moving only changes placement: the same conversation, composer and active run remain mounted. Ask starts in the left margin; opening Drafts, an editor or a published object reveals that destination on the left and keeps the conversation on the right. Normal navigation and successful publication are not close commands. Explicitly closing chat keeps it closed until requested again. Mobile retains its single-sheet navigation without desktop docking controls.

The **AI can edit** menu marks each permitted output as **Unpublished**, **Proposal draft**, **Copy draft**, or **Published**. Maps with local content differing from their last publication show amber **Unpublished changes**, both here and in Drafts. Their link still opens the published version; publishing uses the existing review action. A local semantic fingerprint survives reloads and inactive editor states, ignores selection bookkeeping, and advances only on successful publication. Older inline Map drafts can be compared with their exact loaded source revision. An unavailable legacy source is not assumed clean; the publication tooltip states that its changes have not been compared. Story labels currently indicate publication existence, not content equality.

The normal Drafts inventory has one row per Map, using the draft's actual title. It no longer renders a duplicate inner row or “1 draft” count. Actual saved alternatives are disclosed only when present; creating another alternative is an advanced menu action. Renaming edits the Map's draft title. Shared view, review/publish and discard actions operate on the same retained drafts as chat. There is no storage migration or loss of saved alternatives.

### Coverage

Exercise one Thread producing a WW1 Story and multiple named Maps; foreign feature references; read-only questions; disallowed target writes; switching visible objects during runs; two independent Story Threads; draft-to-publication continuity; desktop/mobile scope controls; and unchanged private audiences.

Implemented coverage:

- `workingSet.test.ts` checks multi-Map target isolation, foreign feature-only references, immutable local references, private audiences, independent Story drafts, review conflicts, and dependency publication/retry.
- `ai-suite/scenarios/chat-working-set.spec.ts` creates two Maps and a Story on desktop and mobile, preserves the drawing target and Thread across navigation/reload, and exercises partial dependency publication followed by retry.
- `chat-target-binding.spec.ts` checks read-only questions, explicit Map grants, reference removal, Thread switching, and restoring an output to the visible map.
- Draft action regressions additionally cover retained desktop chat/docking, review without publishing, permission removal versus discard, shared Story inventory/preview, and no discarded-Story resurrection after reload.
- `chat-placement.spec.ts` checks Ask docking, explicit close/reopen, desktop-to-mobile navigation, Drafts navigation and Map publication without losing chat or its composer. The multi-output Story scenario also checks publication markers after dependency publication/retry; `workPublication.test.ts` covers unpublished, published, proposal and copy labels.
- `chat-story-target-gate.spec.ts` verifies that new-draft permission replaces the old per-Story target dialog, and unsolicited writes remain blocked.
- The new browser fixtures use a simulated provider and intercepted relay acknowledgements; they do not publish test events externally.

Current authoring boundary: local `earthly-draft:` references work in Story prose and resolve with confirmation at publication. Opening presentations and view-block layers still require published Map addresses. The AI instructions and Story editor explain this; no fabricated public addresses or protocol extensions are used.
