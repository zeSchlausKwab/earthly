# Phase 13: Cross-Cutting - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 13-cross-cutting
**Areas discussed:** Map Stack fold-in, Beacon comments, Router shape, Verification scope

**Framing:** A codebase scout established up front that most nominal XCUT work
(comment widening for Group/Story/Sighting, all five deep-link routes, naddr
encode/decode) already shipped incrementally during Phases 9–12. This reframed the
discussion around the remaining gaps + whether to fold in the spec'd Map Stack
unification.

---

## Area selection (multiSelect)

User selected all four presented gray areas: Map Stack fold-in, Beacon comments,
Router shape, Verification scope.

---

## Map Stack fold-in

| Option | Description | Selected |
|--------|-------------|----------|
| Fold into Phase 13 | Phase 13 does the unification (beacons/sightings as stack entries, delete 66a155e hack) alongside the XCUT gaps | ✓ |
| Keep Phase 13 minimal | Only close XCUT gaps; unification ships as its own later slice | |
| You decide | Weigh against PROJECT.md priorities | |

**User's choice:** Fold into Phase 13.
**Notes:** Makes the "on the stack = visible" invariant true for every entity and
deletes the `66a155e` hack this milestone introduced. Design SPEC already written.

### Map Stack open questions (SPEC's four)

**Pin expiry:**

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-remove (dropExpired parity) | Stack entry vanishes on NIP-40 expiry, matching the layer filter | ✓ |
| Leave 'ended' tombstone entry | Greyed 'ended' row the user must dismiss | |
| You decide | | |

**User's choice:** Auto-remove.

**Clear solo/isolation:**

| Option | Description | Selected |
|--------|-------------|----------|
| Demote to normal entry, restore prior layers | Isolated entity becomes a normal visible entry; suppressed layers return | ✓ |
| Remove the entry, restore prior layers | Clearing solo drops the deep-linked entity entirely | |
| You decide | | |

**User's choice:** Demote + restore.

**Remaining two SPEC open questions** (no distinct marker for double-membership;
aggregate layers pin to top) taken as SPEC defaults / Claude discretion — confirmed
implicitly.

---

## Beacon comments

| Option | Description | Selected |
|--------|-------------|----------|
| Wire like the others (full parity) | Add LiveBeacon to union + mount CommentsPanel in BeaconViewPanel | ✓ |
| Exclude beacons from commenting | Keep beacons comment-free (ephemeral/throwaway mismatch) | |
| You decide | | |

**User's choice:** Full parity.
**Notes:** Throwaway-keyed beacons mint a fresh pubkey per session, so the comment
`A` address is unique per session even with a reused `d` — misattach risk only
exists for the own-pubkey opt-in case, recorded as a known edge (not a blocker).

---

## Router shape

| Option | Description | Selected |
|--------|-------------|----------|
| Leave bespoke, close known gaps only | Just thread route.commentId through handleInspectBeacon | |
| Generalize into one entity dispatcher | Unify 5 parsers/handlers into one naddr→kind dispatch + single comment-deep-link path | ✓ |
| You decide | | |

**User's choice:** Generalize.

### URL shapes (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve URL shapes exactly | Refactor internals behind stable per-kind prefixes + legacy fallback | ✓ (Claude) |
| Redesign to a unified /e/:naddr shape | Collapse prefixes; breaks shared links + OG cards | |
| You decide | | ✓ (user) |

**User's choice:** "You decide" → Claude recommended **preserve URL shapes exactly**.
**Notes:** naddr already encodes the kind, so the generalization value is achievable
behind stable prefixes (prefix→kind lookup). A redesign would break already-shared
beacon/story links + OG cards for zero functional gain; the deferred
`/context/:naddr/…` scoped shape must be preserved regardless.

---

## Verification scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full 4-kind matrix UAT | comment × route × share per kind + the new map-stack behaviors | ✓ |
| Gap-closure + spot check | Tests on widened seams; UAT on changed surfaces only | |
| You decide | | |

**User's choice:** Full 4-kind matrix UAT.
**Notes:** The phase's whole point is behaviors that only become checkable once all
four kinds coexist — so the matrix is the honest done-bar.

---

## Claude's Discretion

- Selector shape for stack-derived sighting/beacon sets
  (`visibleSightingsFromStack` / `visibleBeaconsFromStack`).
- Internal structure of the unified route dispatcher (lookup vs. registry), as long
  as URL shapes + the single comment-deep-link path hold.
- Rail/panel affordance placement for "Add to map stack" + aggregate-layer toggles.
- Marker/entry styling within the confirmed behavior.
- Test granularity for the 4-kind matrix.
- URL-shape follow-up (user deferred → preserve exactly).

## Deferred Ideas

- `/e/:naddr` unified URL redesign (rejected in favor of stable URLs).
- Comment scoping/de-dup for reused own-pubkey beacon `d` (the D-07 known edge).
- Cryptographic entity privacy (cordn / BEACON-07) — future milestone.
- Compound / multi-context routing — deferred PROJECT.md concern.
