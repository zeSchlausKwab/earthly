# Earthly workflow UI/UX retest

Date: 2026-07-11  
Target: `http://localhost:3000`  
Primary viewport: desktop 1440×900  
Scope: post-refactor comparison; geometry, Context, Story, comments, annotations, and edit proposals

Font sizes and contrast are deliberately excluded from this retest. They remain deferred work.

## Verdict

The refactor materially improved the product shell. The tour, Dataset creation route, canonical mobile
routes, and signed-out calls to action no longer reproduce their previous failures. The main creation
and collaboration paths are functional, including a complete Dataset proposal lifecycle.

The app is not ready to call these workflows polished yet. A non-owner cannot currently propose a
Story edit because typing in the editor crashes the page's editor path. Creation vocabulary also
regressed into a visible Context/Group split, and geometry creation starts at a world scale that makes
accidental continent-sized data easy to publish.

## Change since the previous audit

| Previous issue class | Retest result |
|---|---|
| Tour targets and contradictory tour copy | Fixed in the existing regression scenarios |
| Create Dataset routing to Beacons | Fixed |
| Mobile panels not reflected in canonical routes | Fixed |
| Signed-out Profile and Wallet dead ends | Fixed |
| Accessible names | Still reproducible |
| Semantic panel headings | Still reproducible |
| Mobile map markers before primary navigation in tab order | Still reproducible |
| Settings usable width at desktop breakpoints | Still reproducible |
| Announcements promises an unavailable “Be first to post” action | Still reproducible |
| Emoji-only mobile post categories | Still reproducible |

The known-issue run completed without unexpected results: nine expected-failure
project/scenario combinations and three intentional skips, representing six remaining issue classes.

## New findings

### P0 — Story edit proposals crash while typing

A contributor can open **Propose an edit**, but entering the replacement Story body raises:

`RangeError: Can not convert ... to a Fragment (looks like multiple versions of prosemirror-model were loaded)`

Bun's runtime error overlay then intercepts the dialog, so **Propose an edit** cannot be submitted.
The failure occurs with real keyboard input as well as programmatic form filling. This blocks the
primary non-owner Story collaboration path, not just automation.

Recommendation: deduplicate the ProseMirror dependency graph used by the Story proposal editor and
add a regression that types, submits, and receives the proposal in a second owner session. Keep the
current expected-failure scenario until that end-to-end check becomes an unexpected pass.

### P1 — Context creation changes its noun to Group mid-flow

The navigation says **Contexts**, the action says **New context**, and the form immediately changes
to **Create Group**. The successful object is also presented as a Group. A user cannot know whether a
Group is a renamed Context, a parent of one, or a different object.

Recommendation: choose one public noun and use it across navigation, actions, headings, help, event
summaries, and validation copy. If Context is the protocol term, explain it secondarily instead of
switching nouns during creation.

### P1 — New geometry begins at an unsafe world scale

A new Dataset opens near zoom level 2. Ordinary clicks in the visible map produced a roughly
2,684 km line and a roughly 1,027,635 km² polygon. The app accepts these shapes without a scale warning
or an explicit confirmation of their extent.

Recommendation: start creation at a useful local extent when location or a selected Context is
available. Otherwise ask the user to choose an area before enabling drawing. Warn before accepting a
geometry whose span is implausibly large for the current task.

### P1 — Publishing loses the just-created object as the user's destination

Publishing both a Story and a Dataset returns to their catalog. The published object exists and can
be reopened, but there is no stable completion destination where the author can immediately verify,
share, comment on, or continue editing it. The AI suite has to recover the new address and explicitly
open the object before it can verify the result.

Recommendation: after publish, navigate to the canonical reader/overview URL for the new entity and
show a persistent success state there. “View published item” should not require finding the item again
in a long catalog.

### P2 — Label creation behaves differently inside and outside comments

In a Dataset, **Draw label** creates a row named only **Annotation** and does not open the text editor.
The user must discover and expand that row before entering the label. In the comment composer, placing
a label immediately opens and focuses **Type label text...**, which is much easier to understand.

Recommendation: reuse the comment-composer behavior for Dataset labels: select the new annotation,
open its text field, focus it, and retain the map location while the user types.

### P2 — The comment composer shows two label tools

The comment form renders the shared **Draw label** control and a second adjacent Type icon titled
**Attach label annotation**. Both start the same drawing mode. The duplicate suggests two different
annotation concepts and makes an already dense toolbar harder to scan.

Recommendation: keep one labelled action. If the second action is intended to attach an existing
label rather than draw a new one, its behavior and copy must make that distinction real.

### P2 — Proposal decision models are inconsistent between entity types

Dataset proposals provide **Preview change**, **Accept**, **Request changes**, and **Reject**. Story
proposals provide a current/proposed comparison but only **Accept edit** and **Reject**. The missing
request-changes path may be intentional, but the UI gives no explanation and both objects use the
same “proposal” concept.

Recommendation: either give Stories the same review states or explicitly document the simpler Story
review model. Use the same verbs and status labels wherever the outcome is equivalent.

### P2 — Dataset publish is hidden under File in the audited desktop layout

With the catalog, Map Stack, and editor visible at 1440 px, the primary Dataset publish action is
inside **File → Publish new dataset** rather than visible beside the editing controls. Publishing is
the completion of the core workflow, but it is presented alongside import/export utilities.

Recommendation: keep a persistent primary **Publish** action in the Dataset editor header or footer;
leave update, fork, import, and export in the File menu.

## What worked well

- Point, line, polygon, and label geometries were created and retained in one Dataset draft.
- Context/Group creation and Story publishing completed against the local relay.
- A root Story comment, threaded reply, and map-label annotation all published successfully.
- Comment annotations appeared on the map and exposed an entity-level **Hide annotations** control.
- A real contributor successfully loaded a Dataset copy and submitted an edit proposal.
- The Dataset owner could preview proposed geometry, request changes with a reason, reject a proposal,
  accept another proposal, and observe the accepted one-feature Dataset version.
- Story owner acceptance and rejection work when valid proposal events reach the owner; only the
  contributor-side composer is currently blocking the full Story round trip.
- The workflow audit did not report unrelated page exceptions outside the known Story editor crash.

## Automation added during this audit

Reusable tasks now cover:

- point, line, polygon, and label creation;
- Dataset publishing and canonical reopening;
- Context/Group creation;
- Story draft creation and publishing;
- root comments, replies, and comment-attached map labels;
- Story proposal drafting, acceptance, and rejection;
- Dataset proposal submission, preview, request-changes, rejection, and acceptance;
- local-only proposal fixtures for isolating owner-side review from a broken contributor composer;
- separate visible browser sessions for owner/contributor workflows.

`bun run ai:audit:workflows` ran 12 project/scenario combinations: six intentional mobile skips and
six successful desktop expected outcomes. Five desktop workflows passed normally; the Story composer
scenario reproduced its declared expected failure. Publishing scenarios are localhost-only and are
excluded from the default smoke and verification commands.

## Recommended fixing order

1. Fix the Story proposal editor dependency/runtime crash.
2. Resolve Context versus Group terminology before more copy and documentation spreads the split.
3. Give new geometry a local starting extent and implausible-scale guardrails.
4. Route publish success directly to the canonical published entity.
5. Make Dataset label entry immediate and remove the duplicate comment label action.
6. Decide and document whether Story proposals should support Request changes.
7. Restore a persistent primary Dataset Publish action at ordinary desktop widths.
8. Continue with the six previously known non-type/non-contrast issue classes.

## Coverage limits

This pass used deterministic local NIP-07 development personas and the local relay. It did not test a
real third-party signing extension, remote signer, wallet transaction, public relay publishing, live
GPS permissions, or mobile authoring. Mobile workflow scenarios are present but intentionally skipped
until safe mobile identity/publishing coverage is introduced.
