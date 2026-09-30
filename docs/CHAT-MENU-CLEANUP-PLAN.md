# Chat menu cleanup

Implemented · 2026-09-30

## Recommended structure

Keep the conversation as the default view. Replace expanding configuration stacks with one
details view inside the same chat panel. The details view has three peer destinations:
**AI can edit**, **Sources**, and **Settings**. Returning to chat restores its scroll position
and unsent message. Opening details never cancels a running response.

The compact chat header contains the conversation title/switcher, one actions menu, and Close.
Below it, show **AI can edit N**, **Sources N**, and the current permission mode. Each opens
the corresponding details destination directly. These are summaries, not accordion triggers.

An alternative is an always-visible **Chat / Editable / Sources / Settings** tab bar. It makes
navigation more discoverable but spends more permanent space on configuration. Prefer the
on-demand version for the narrow map sidebar and mobile.

## Control placement

| Current control | Proposed home | Behavior |
| --- | --- | --- |
| Title dropdown containing a second select | Conversation switcher | One direct list; New conversation at the bottom. |
| Move left/right, export, delete | Header actions menu | One level; deleting a conversation keeps maps and requires confirmation. |
| Editable objects + references accordion | Separate AI can edit / Sources destinations | One list and one scroll owner per view. |
| Map row's eye, publish, delete, unlink buttons | Open + one row menu | Menu: Show on map, Remove editing access. Publishing and deleting drafts remain in the map editor. |
| All drafts | Existing app draft navigation | Do not duplicate the draft manager inside chat. |
| Create new maps and stories | AI can edit destination | Conversation-scoped toggle beside editing access; preserve audience rules. |
| Reference search and suggestions | Sources destination | Read-only label; an explicit Add source action. Do not suggest an object already in the editable set. |
| Let AI edit a reference | Source row action | Explicitly grant access; retain ownership, proposal, and feature-scope checks. |
| Safety indicator + second settings button | Visible permission summary | Opens Settings directly at Edit permissions. No duplicate trigger for the same accordion. |
| Connection/model | Compact composer label → Settings | Select existing saved connection and model; Manage connections opens account Chat settings. Credentials stay there. |
| Screenshots and global chat preferences | Settings destination | Flat labeled controls; distinguish global preferences from conversation-scoped access. |
| Nested usage details | Usage & diagnostics view | Reachable from the status strip and actions menu. Wallet balance/spend shown only for wallet-backed connections. |
| Attach to message accordion | Composer + menu | File/image, current selection, draw geometry. Added attachments remain visible as removable chips. |
| Working / waiting / finished | Persistent status strip | Visible in conversation and details. Keep Stop available while running and a direct return to pending approval. |
| Completed tool records | One action-history disclosure per response | Preserve technical drill-downs here; remove configuration accordions, not useful diagnostic detail. |

## Layout and interaction rules

- One configuration destination at a time. Opening a menu closes any other transient menu.
- No nested scrolling inside object lists. The current main view owns scrolling; header and
  run status remain fixed within the chat panel.
- Prefer flat rows and separators over bordered sections inside bordered sections.
- Keep essential states visible: editing count, source count, permission mode, selected model,
  attachments, run status, pending approvals, and actionable connection/payment errors.
- Sources never grant editing access. Removing editing access never deletes a draft.
- Permission-sensitive controls stay locked while a run is active, as they are today.
- On mobile, use the same full-panel details view with Back to chat, not a sheet inside a sheet.
  Support 320px width, 44px touch targets, keyboard navigation, Escape, and focus restoration.
- Keep empty states short: one explanation and one action. Move extended privacy and permission
  help next to the relevant control instead of repeating it in multiple header sections.
- Read-only conversations show Read-only explicitly and omit unavailable authoring controls.

## Implementation sequence

1. Extract header, composer, settings, and usage presentation from `ChatPanel.tsx`. Introduce
   a single `ChatPanelView` state instead of independent `connectionDetailsOpen`, working-set,
   and diagnostics accordions. Leave chat execution and permission stores unchanged.
2. Split `WorkingSetControls.tsx` into compact scope summaries and flat editable/source lists.
   Reuse current target, reference, drag/drop, publication-state, and access actions.
3. Simplify object and conversation menus. Replace the attachment accordion with the composer
   menu and persistent chips. Route model/connection controls to the same Settings destination.
4. Preserve run feedback, scroll, focus, and composer state across view changes. Keep approvals
   reachable and errors visible even when details are open.
5. Update existing AI-suite chat tasks centrally, then verify desktop/mobile flows: switch
   conversation, inspect/edit scope, add/remove a source, attach geometry/file, change provider,
   start/stop/approve a response, inspect usage, and return to an unsent message. Check empty,
   read-only, long-name, many-object, and payment-error states. Use isolated relays and providers.

## Acceptance criteria

The initial chat view shows no expanded settings or reference sections. Header controls fit at
320px without overlapping. Every common control is one click away; uncommon actions take at
most two. Opening details does not shrink the conversation into a second scroll area, lose a
draft message, alter permissions, or stop a run. The sidebar remains usable with ten editable
objects or references, and with a long-running model response.

The accompanying interactive sketch is illustrative: it demonstrates navigation and grouping,
not a live provider, a publication action, or a change to stored maps.


## Delivered

- `ChatPanelNavigation` owns the active view, transient menu, and return focus. Header,
  settings, and usage are separate components. The composer and transcript stay mounted.
- Conversation switching is a direct list. Header actions contain placement, export, and
  confirmed conversation deletion. Removing a conversation retains its maps and stories.
- Editable objects and read-only sources have separate flat lists. Object menus expose
  access actions; the regular editors and global Drafts retain publication and deletion.
- The composer has a single attachment menu, persistent removable chips, and a model shortcut.
  Drawing an attachment temporarily enables map interaction, then restores the prior state.
- Status, Usage, connection recovery, Stop, and Review changes remain accessible in details.
  Returning through Review changes scrolls to the pending proposal.
- AI-suite navigation tasks now select views. Browser regression coverage includes desktop,
  320/390px mobile layouts, focus and Escape, file/drawing attachments, unsent drafts, scroll,
  conversation switching/deletion, drag/drop, editing grants, read-only sources, active runs,
  pending approvals, Story publication and discard, and retained map targets.

The implementation uses the existing chat and draft stores; this UI change adds no new
persistence format, provider contract, or permission model.

## Verification

- `bun run typecheck`: no new diagnostics; the existing baseline contains 326 diagnostics.
- `bun run ai:typecheck`: passes.
- Chat panel, composer, attachment UI, working-set, and entity-context unit tests: 40 pass.
- Chat context, surface, working-set, target-binding, reliability, and navigation browser
  scenarios: 21 pass across desktop/mobile, with 3 intentional viewport skips.
- Embedded mobile Thread controls at 320/390px and active-run desktop docking also pass.
- Biome lint on the changed chat components and `git diff --check`: pass.
