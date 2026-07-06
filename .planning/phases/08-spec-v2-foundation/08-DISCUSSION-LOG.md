# Phase 8: Spec v2 + Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 8-spec-v2-foundation
**Areas discussed:** Sighting kind number, Legacy 37518 UX, Taxonomy scope

---

## Area selection

Presented four candidate forward-commitments; user selected three to discuss (Sighting kind number, Legacy 37518 UX, Taxonomy scope) and deferred **SPEC.md v2 form** to a Claude-resolved default (in-place clean-break rewrite).

---

## Sighting kind number

| Option | Description | Selected |
|--------|-------------|----------|
| Assign 37522 now | Pre-assign `TEMPORAL_SIGHTING_KIND = 37522` in kinds.ts + SPEC v2; contiguous 37520/37521/37522 block. Phase 11 may pivot representation; number reserved. | ✓ |
| Document as TBD | SPEC v2 lists Sighting as dedicated-kind-number-TBD; no constant yet; Foundation seams can't reference it. | |
| Reserve range, pick later | Reserve 37520–37529 entity block; soft-commit Sighting number. | |

**User's choice:** Assign 37522 now
**Notes:** Keeps the entity kind block contiguous and lets Foundation seams (tags.ts, version discriminator) reference the Sighting kind immediately. Phase 11 still owns the representation decision.

---

## Legacy 37518 UX

| Option | Description | Selected |
|--------|-------------|----------|
| Silent drop | Defensive parse classifies legacy/unknown-`modelVersion` 37518 as inert; never enters render set; no chip, no log. | ✓ |
| Muted placeholder | Render a greyed "legacy/unsupported entity" chip. | |
| Silent drop + dev console warn | Drop from UI but emit a console.debug/warn for developers. | |

**User's choice:** Silent drop
**Notes:** Clean-break stance — legacy events should "just disappear" from the UX. Detection via the in-content `modelVersion` discriminator (absence/mismatch ⇒ skip). The dev-console-warn variant was offered and not chosen.

---

## Taxonomy scope (NIP-32)

| Option | Description | Selected |
|--------|-------------|----------|
| Helper-only | Ship just the `L`/`l` paired-emit helper + namespace constant; defer vocab. | |
| Helper + starter vocab | Also seed a small controlled vocabulary to test the enforce path. | ✓ |

**User's choice:** Helper + starter vocab

### Follow-up — namespace

| Option | Description | Selected |
|--------|-------------|----------|
| org.earthly.category | Reverse-DNS, per-axis. | |
| earthly | Flat single namespace. | ✓ |
| org.earthly | Reverse-DNS, single bucket. | |

### Follow-up — vocab axis

| Option | Description | Selected |
|--------|-------------|----------|
| Feature category | natural / infrastructure / amenity / route / boundary. | ✓ |
| Entity type | story/group/beacon/sighting (double-encodes the kind). | |
| Minimal placeholder | One or two example labels only. | |

**User's choice:** Flat `earthly` namespace + feature-category starter vocab
**Notes:** Concrete enough to exercise schema-Group enforcement in Phase 9 without guessing a full taxonomy. Freeform `t` remains and must not double-encode `L`/`l`.

---

## Claude's Discretion

- **SPEC.md v2 form** — in-place clean-break rewrite of the existing 421-line SPEC.md (v1 stays in git history); not discussed, user deferred.
- **`tags.ts` migration blast radius** — extract shared helpers AND migrate `geo-event` + `map-context` to consume them (research mandates extraction from both).
- **Schema worker hardening params** — research defaults (≤100ms timeout-kill, compile-once per schema-hash, reject `$ref`, cap size/depth, `$data` off, draft-2020-12 pinned).
- **`modelVersion` field shape/placement** — planner/research detail, constrained by the silent-drop contract.
- **NIP-40 `isExpired` wrapper** — single shared read-path filter over applesauce-core expiration helper.

## Deferred Ideas

- Dev-visible legacy logging (console.debug on skip) — offered, not chosen.
- SPEC.md versioned/parallel form — rejected for in-place rewrite.
- Per-axis / reverse-DNS taxonomy namespaces — flat `earthly` chosen; revisit when a second controlled axis appears.
- Group governance ladder / NO-MOD MINIMUM / schema-authoring UI → Phase 9.
- Sighting representation final call (dedicated kind vs 37515+property) → Phase 11.
- Beacon lifecycle (replaceable+NIP-40 vs ephemeral) → Phase 12.
