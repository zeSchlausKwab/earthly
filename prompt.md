NDKGeoEvent.ts NDKMapContextEvent.ts NDKGeoCollectionEvent.ts @SPEC.md 

We want to extend our spec  and give users the ability propose edits to our entities. Look at the nostr skill to get some inspiration on how to do this. As of now users have only the possibility to load a copy and republish the geometry resulting in a 'fork'. It would be nice if other users could publish an edit proposal that the original author could verify and check and convenietly republish it. This flow is for now only seen in the wild for text notes. Lets come up with a sound concept

----

Geo Edit Proposal Feature (kind 37519)
Context
Users currently can only fork someone else's dataset (load + republish as new). We want a collaborative edit proposal flow: user B proposes changes to user A's dataset, A reviews on the map, and accepts/rejects. Accepting auto-republishes A's dataset with the proposed content.

Design decisions already locked in:

One new kind 37519 (parameterized replaceable) for all entity types
Full replacement content (no operation-based diffs) — client computes visual diff at review time
NIP-34 status kinds (1630-1633) as lightweight helpers, not a full NDK class
"Propose Edit" button in editor toolbar alongside "Fork as new dataset"
Expandable proposal cards in ViewModePanel for the dataset owner
Auto-republish on accept
Implementation Plan
Phase 1: Foundation
1. src/lib/ndk/kinds.ts — Add constants


GEO_EDIT_PROPOSAL_KIND = 37519
PROPOSAL_STATUS_OPEN_KIND = 1630
PROPOSAL_STATUS_APPLIED_KIND = 1631
PROPOSAL_STATUS_CLOSED_KIND = 1632
PROPOSAL_STATUS_DRAFT_KIND = 1633
2. src/lib/ndk/NDKGeoEditProposalEvent.ts — New event class

Follow exact pattern from NDKGeoEvent.ts (static kinds, static from(), registerEventClass).

Key accessors:

featureCollection get/set — same JSON parse pattern as NDKGeoEvent
proposalId get/set — wraps dTag
targetAddress get/set — a tag with format 37515:<owner>:<d-tag>
targetPubkey, targetDatasetId — parsed from targetAddress
ownerPubkey get/set — p tag
baseVersion get/set — base-version tag (event ID)
description get/set — description tag
boundingBox, geohash, hashtags — same as NDKGeoEvent
ensureProposalId() — uses generateShortDTag()
updateDerivedMetadata() — computes bbox/geohash from featureCollection
publishProposal(signer?) — prepareForPublish + publish
Static deleteProposal() — kind 5 deletion event
Reuse encodeGeohash — extract it from NDKGeoEvent to a shared utility or duplicate inline.

3. src/lib/ndk/proposalStatus.ts — Lightweight status helpers

Three functions:

createProposalStatusEvent(ndk, proposal, status, reason?, signer?) — creates+publishes status event with a tag pointing to proposal address and e tag for event ID
getLatestProposalStatus(statusEvents, proposalAddress) — returns { status, event, reason } from most recent by created_at
buildStatusFilter(proposalAddresses) — builds Nostr filter for kinds 1630-1633 with #a filter
Types: ProposalStatus = 'open' | 'applied' | 'closed' | 'draft'

4. SPEC.md — Add section 10 "Geo Edit Proposal Event (kind 37519)" before current section 10 (renumber). Document event structure, tags, status tracking, accept flow, example.

Phase 2: Data Layer
5. src/features/social/hooks/useGeoProposals.ts — Subscription hook

Follow useGeoComments.ts pattern:

Two-stage subscription: first proposals by { kinds: [37519], '#a': [targetAddress] }, then status events by { kinds: [1630-1633], '#a': [proposalAddresses] }
Map events to NDKGeoEditProposalEvent.from(e)
Merge with latest status per proposal
Return proposals: ProposalWithStatus[], isLoading, acceptProposal, rejectProposal
acceptProposal flow:

Create new NDKGeoEvent with proposal's featureCollection
Call publishUpdate(target) — preserves d-tag lineage, increments version
Carry forward target's hashtags, collectionReferences, contextReferences, relayHints
Publish status 1631 (applied)
rejectProposal flow:

Publish status 1632 (closed) with optional reason
Phase 3: UI Components
6. src/features/social/proposals/ProposalCard.tsx — Expandable card

Uses Collapsible from @/components/ui/collapsible. Structure:

Header (always visible): ChevronDown/Right + author avatar/name + relative timestamp + status badge (Open/Applied/Rejected/Draft with colored pill)
Expanded content: description text, feature count, action row
Action row: Eye/EyeOff "Preview" toggle (blue when active) + Accept (green, Check icon) / Reject (red outline, X icon) buttons — only for owner on open proposals
Props: proposalWithStatus, isOwner, isExpanded, isOverlayVisible, onToggleExpanded, onToggleOverlay, onAccept, onReject

7. src/features/social/proposals/ProposalsPanel.tsx — Panel container

Follow CommentsPanel.tsx layout. Structure:

Header with GitPullRequest icon + "Edit Proposals" title + open count
Scrollable list split: open proposals first, then "Resolved" section with border separator
Empty state when no proposals
Loading state with spinner
Manages visibleProposalIds: Set<string> and expandedIds: Set<string> state.

Props: target: NDKGeoEvent | null, currentUserPubkey, onToggleProposalOverlay, onProposalAccepted

8. src/features/social/proposals/index.ts — Barrel export

Phase 4: Integration
9. src/features/geo-editor/hooks/usePublishing.ts — Add propose flow

Add alongside existing handlePublishCopy (~line 519):

canProposeEdit — same condition as canPublishCopy: !!activeDataset && currentUserPubkey !== activeDataset?.pubkey && features.length > 0
handleProposeEdit(description: string) callback:
buildCollectionFromEditor()
Create NDKGeoEditProposalEvent(ndk)
Set targetAddress = ${GEO_EVENT_KIND}:${activeDataset.pubkey}:${activeDataset.datasetId}
Set ownerPubkey, baseVersion = activeDataset.id, description, hashtags
Call publishProposal()
Return canProposeEdit and handleProposeEdit from the hook
10. src/features/geo-editor/components/toolbar/PublishDropdown.tsx — Add dropdown item

Add to PublishDropdownProps: canProposeEdit?: boolean, onProposeEdit?: () => void

Add after the "Fork as new dataset" item in DropdownMenuContent:


{canProposeEdit && (
  <>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={onProposeEdit}>
      <GitPullRequest /> Propose edit to owner
    </DropdownMenuItem>
  </>
)}
Update showDropdown condition to include canProposeEdit.

11. src/components/info-panel/ViewModePanel.tsx — Add Proposals tab

Extend ViewTab = 'details' | 'comments' | 'proposals'
Add props: onToggleProposalOverlay, onProposalAccepted
Add third tab button (GitPullRequest icon, "Proposals") — show for ALL users viewing a dataset (owner sees accept/reject, others see status)
Add tab content rendering ProposalsPanel when activeTab === 'proposals'
12. src/features/geo-editor/GeoEditorView.tsx — Wire everything

Add proposal description dialog state (proposeEditDialogOpen, proposalDescription)
When "Propose Edit" clicked in toolbar: open dialog for description input
On dialog confirm: call handleProposeEdit(description)
Pass onToggleProposalOverlay to ViewModePanel — manages MapLibre source/layers for proposal preview (blue dashed lines, blue fill at 0.25 opacity to distinguish from main data and comment overlays)
Thread canProposeEdit/onProposeEdit through Toolbar to PublishDropdown
Map overlay approach: Follow existing pattern from comment geometry handling in GeoEditorView — add/remove MapLibre sources+layers keyed by proposal ID. Use blue color scheme (#3b82f6) with dashed lines.

Phase 5: Seed Data
13. scripts/seed.ts — Add proposals

Add publishProposal() helper (uses raw NDKEvent, same pattern as publishDataset).

Three seed proposals:

mobility -> planner's state boundary (Sachsen): Adjust polygon coordinates slightly, description "Refined southeastern border alignment"
heritage -> mobility's rail corridors: Add a third corridor feature, description "Added planned RE7 corridor extension"
planner -> heritage's heritage hotspots: Modify a feature's properties, description "Updated significance classification for Leipzig passage"
Files Summary
Action	File
Create	src/lib/ndk/NDKGeoEditProposalEvent.ts
Create	src/lib/ndk/proposalStatus.ts
Create	src/features/social/hooks/useGeoProposals.ts
Create	src/features/social/proposals/ProposalsPanel.tsx
Create	src/features/social/proposals/ProposalCard.tsx
Create	src/features/social/proposals/index.ts
Modify	src/lib/ndk/kinds.ts
Modify	src/features/geo-editor/hooks/usePublishing.ts
Modify	src/features/geo-editor/components/toolbar/PublishDropdown.tsx
Modify	src/components/info-panel/ViewModePanel.tsx
Modify	src/features/geo-editor/GeoEditorView.tsx
Modify	scripts/seed.ts
Modify	SPEC.md
Verification
bun run lint — no errors
bun relay:reset && bun relay — start fresh relay
bun run seed — seed data including proposals
bun dev — start app
Manual test: log in as planner, view Sachsen dataset -> Proposals tab shows mobility's proposal -> preview on map (blue overlay) -> accept -> dataset updates
Manual test: log in as mobility, load planner's dataset, make edits, click "Propose Edit" in dropdown -> enter description -> proposal published
Manual test: verify rejected proposals show "Rejected" badge and no accept/reject buttons
User approved the plan
Update Todos

Add kind constants to kinds.ts

Create NDKGeoEditProposalEvent class

Create proposalStatus.ts helpers

Update SPEC.md with kind 37519 documentation

Create useGeoProposals hook

Create ProposalCard component

Create ProposalsPanel component

Add handleProposeEdit to usePublishing hook

Update PublishDropdown with Propose Edit option

Add Proposals tab to ViewModePanel

Wire proposal overlay and dialog in GeoEditorView

Add proposal seed data to seed.ts

Run lint to verify