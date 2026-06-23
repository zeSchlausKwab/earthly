# Pitfalls Research

**Domain:** Adding role-specific geo entity kinds (Story/Article ~37520, slimmed Group/Topic 37518, Live Beacon ~37521, Temporal Sighting) to a mature decentralized Nostr/applesauce + MapLibre app (Earthly v1.2 Geo Entity Model Split)
**Researched:** 2026-06-23
**Confidence:** HIGH for replaceable-event/NIP-40/NIP-32 semantics (verified against NIP-01/32/40 and ajv security docs) · HIGH for schema-DoS · MEDIUM-HIGH for live-location privacy and the "no-moderation" minimum (design-judgement grounded in decentralized-app norms)

> **Milestone framing that shapes every pitfall below:** NIP-72 human moderation/approval + role lists are **DEFERRED**. Spam/abuse mitigation is officially "web-of-trust + muting" — but those are also out of scope this milestone. So for v1.2 the open-attach Group ships with **no human moderator and no WoT filter**. Several pitfalls below are about what the *minimum client-side defenses* must be so the open Group is still usable on day one. Those are flagged **[NO-MOD MINIMUM]**.

> **Phase note:** No v1.2 roadmap exists yet. Phase assignments below use the natural decomposition implied by PROJECT.md — a **Taxonomy & Clean-Break Foundation** phase, then one phase per entity kind (**Story/Article**, **Group/Topic + schema governance**, **Live Beacon**, **Temporal Sighting**), plus a cross-cutting **Reference-integrity / Authoring-UI** concern. Re-map if the roadmap groups differently.

---

## Critical Pitfalls

### Pitfall 1: Live Beacon replaceable-event overwrite race (last-write-wins, clock skew, propagation lag)

**What goes wrong:**
The Beacon (~37521) is a parameterized-replaceable event keyed by `kind:pubkey:d`. Every position update reuses the same `d` and the relay keeps only the newest by `created_at`. Three failure modes stack:
1. **Clock skew makes a stale fix "win."** If the user's device clock is ahead, an *older* physical position can carry a *future* `created_at` and permanently shadow newer-but-lower-timestamped updates until the clock-ahead event itself is superseded. Verified relay rule (NIP-01): on equal `created_at`, the relay keeps the **lowest lexical event id** and discards the rest — so two updates emitted in the same second resolve by id, not by which is newer in reality.
2. **Propagation lag across relays.** A beacon published to relays A+B may have update N on A and update N+1 on B; a reader unioning relays sees fl/flicker between positions. Replaceable-event de-dup is *per relay*, so the reader must de-dup again client-side by `created_at`.
3. **Multi-device / multi-tab self-collision.** Same pubkey + same `d` from two tabs = two writers racing the same address; positions thrash.

**Why it happens:**
Developers treat a replaceable event like a mutable variable with strong consistency. It is eventually-consistent, per-relay, with a non-obvious tie-break and no server clock. Beacons make the race visible because updates are frequent (seconds), unlike datasets (rarely).

**How to avoid:**
- **Never trust `created_at` as truth-of-recency for display.** Carry an explicit monotonic `seq` tag and/or a position-fix timestamp *inside content*, and render the highest `seq` you've seen, not the latest relay copy.
- **Clamp `created_at`** to `min(deviceNow, lastSeq+ε)`; refuse to publish if device clock is wildly off (sanity-check against relay `created_at` of an echoed event).
- **De-dup across relays client-side** by `(pubkey,d)` keeping max `seq`; tolerate out-of-order arrival.
- **Single-writer guard:** a leader-election lock (BroadcastChannel/localStorage) so only one tab publishes a given beacon `d`.
- **Throttle** publish rate (e.g. ≥ N seconds) to bound relay churn and the size of the flicker window.

**Warning signs:**
Position visibly jumps backward; "last seen" timestamp goes down; two relays disagree; beacon appears to teleport when a second tab is open; updates stop landing after a clock change.

**Phase to address:** **Live Beacon phase** (lifecycle/visibility model is explicitly open for phase research per PROJECT.md — resolve replaceable-vs-ephemeral *and* the seq/clock model together).

---

### Pitfall 2: JSON-Schema validation as a client-side DoS vector (untrusted Group-owner schema)

**What goes wrong:**
A Group/Topic owner authors `schema` (and `geometryConstraints`) in the 37518 content. Every *other* client that opens that Group fetches and runs that schema against attached datasets on the fetch path. An owner (or impersonator) can ship a schema that hangs or OOMs the validator:
- **ReDoS `pattern`:** a `pattern` like `^(a+)+$` against a long string is exponential. Confirmed live class of bug: ajv < 8.18.0 ReDoS (CVE-2025-69873) — a 31-char payload ≈ 44s CPU, doubling per char. Even without that CVE, *any* `pattern` keyword is attacker-controlled regex run on attacker-or-victim data.
- **Recursive `$ref` / huge schema:** deep/mutually-recursive `$ref` blows the resolver; a multi-megabyte schema or deeply nested `allOf`/`anyOf` explodes compile/validate time. (SPEC already says "no external $ref in v1" — but internal `$ref` and sheer size still bite.)
- **Schema compiled per render** turns one bad schema into a per-frame hang.

**Why it happens:**
JSON-Schema "just validates"; the schema is treated as data, not as **untrusted executable code authored by a stranger**. In a centralized app the schema author is you; here it is any pubkey.

**How to avoid:**
- **Treat the schema as hostile input.** Run validation **off the main thread** (Web Worker) with a **hard timeout** (e.g. 50–100 ms) and **kill** the worker on overrun — fail closed to "could not validate" rather than freezing the tab. (Earthly already has the QuickJS-in-Worker + timeout/circuit-breaker pattern from v1.1 — reuse that harness shape.)
- **Constrain the dialect to a safe subset:** disallow `pattern` entirely *or* run patterns through a linear-time RE engine / RE2-style guard; reject schemas containing `$ref` (matches the "no external $ref" intent — extend to internal), cap schema byte size, cap nesting depth, cap total keyword count before compiling.
- **Compile once, cache by schema-hash**, never per render.
- **Sandbox the validator from secrets** (same trust-boundary discipline as the code interpreter).

**Warning signs:**
Opening a specific Group freezes the UI; CPU pegs on fetch; a schema with `pattern`/deeply nested `allOf`; validate time grows with dataset size superlinearly.

**Phase to address:** **Group/Topic + schema governance phase.** This is the single highest-severity new attack surface in the milestone — it must be threat-modeled there, not bolted on.

---

### Pitfall 3: Open Group is unusable without *any* moderation — the [NO-MOD MINIMUM] gap

**What goes wrong:**
With `allowForeignAttachments=true` and **no human moderation, no approval, no role list, no WoT this milestone**, *anyone* can `c`-attach *anything* to a popular open Group. Day-one outcomes: a "Best surfing beaches" Group floods with spam datasets, off-topic geometry, or hostile content; the curated narrative drowns; the Group becomes worthless. Foreign-`c` attachment is also **spoofable** — the attaching dataset asserts the `c` link unilaterally; the Group owner did not consent, and there is no approval event to gate it.

**Why it happens:**
The clean entity split removes the *governance* discriminator from 37518's content but the team may assume "governance ladder = open|schema|closed" covers safety. It does not: `schema` constrains *shape*, not *spam*; `closed` disables foreign attach entirely; `open` has nothing between "anyone, unfiltered" and "off." With moderation deferred, `open` defaults to a free-for-all.

**How to avoid — minimum client-side defenses that ship THIS milestone (no moderation required):**
- **Self-curation is the floor, not foreign-attach.** Make the owner's **inline-Markdown / pinned `a` refs the default ("canonical") lane**; render the foreign-`c` lane as a clearly-separate, collapsed-by-default, opt-in "Attached by others" section. The Group is usable from curated refs alone even if the foreign lane is pure noise. (SPEC's two-lane model already supports this — make curated the privileged default.)
- **Per-viewer mute is the deferred-WoT stand-in.** Even without protocol-level WoT, ship a **local mute/hide** (hide-this-pubkey, hide-this-attachment) that persists per viewer. This is the realistic minimum that keeps `open` survivable.
- **Cap + sort the foreign lane:** bound how many foreign attachments render, sort by something cheap and non-gameable-by-volume (recency, or attacher's account age if available), paginate; never render unbounded.
- **Verify the `c` coordinate resolves** to a real, signature-valid, on-topic-kind event before rendering; drop dangling/spoofed coordinates silently.
- **Owner opt-out is one click:** flipping `allowForeignAttachments=false` (the `closed` rung) must instantly collapse the Group to curated-only — the always-available escape hatch when an open Group gets brigaded.
- **Do NOT auto-promote foreign attachments into the map lane in strict-equivalent views** without the viewer asking.

**Warning signs:**
A Group's foreign lane dwarfs its curated lane; the same pubkey attaches to many Groups; attachments reference kinds that don't match; users report a Group is "full of junk."

**Phase to address:** **Group/Topic phase** (must land the curated-default + local-mute minimum *in the same phase* that enables foreign `c` — never ship open-attach without it).

---

### Pitfall 4: Live-location privacy & safety failure modes (accidental always-on, stale-as-current, leakage, no stop)

**What goes wrong:**
A public, continuously-updating position point is the most dangerous primitive in the app. Failure modes:
- **Accidental always-on sharing:** user starts a beacon for a hike, closes the tab; the worker/timer keeps publishing (or a "share" toggle silently survives a reload) — location leaks for hours/days. With NIP-40 unreliable (see Pitfall 6), a beacon can outlive the user's intent.
- **Stale position shown as current:** reader sees an old fix with no "as of" age; treats a 3-hour-old point as live → real-world safety risk (meetups, "they're here now").
- **Irreversible publication:** Nostr has no true delete; a "stop sharing" that only stops *future* publishes still leaves the last position public on relays forever. Users assume "stop" = "gone."
- **Coordinate-precision leakage:** publishing raw GPS (home, exact) when the user meant "near the trailhead."
- **Pubkey correlation:** a public beacon ties a real-time location trail to a long-lived identity → de-anonymization / stalking.

**Why it happens:**
Location is treated as just another point geometry. The decentralized substrate makes "undo" impossible, which inverts the usual privacy mental model (centralized apps can delete).

**How to avoid:**
- **Default OFF, explicit start, visible "LIVE" indicator, hard time-boxed sessions** (e.g. auto-expire after N minutes; require re-affirm to continue). Never a silent persistent toggle.
- **Stop = stop publishing + publish a terminal "ended" state + visibly mark the beacon stale**; and tell the user plainly that the last point remains public (no false promise of deletion).
- **Age-stamp every render:** "updated 2 min ago" with a staleness threshold past which the point greys out / is labeled "not live."
- **Coarsen by default:** offer reduced precision / geohash-truncation; warn before publishing full GPS.
- **Lifecycle decision:** prefer **ephemeral (NIP-16 20000-range) for live frames** so relays aren't obligated to persist the trail, with a separate explicit "share my current location" replaceable point only when persistence is intended. (This is the open lifecycle question in PROJECT.md — privacy should drive it toward ephemeral-by-default.)
- **Kill on unload / visibilitychange:** stop publishing when the tab is hidden/closed unless the user explicitly opted into background sharing.

**Warning signs:**
A beacon with `created_at` older than the staleness window still labeled live; sharing toggle survives reload; no "ended" state ever emitted; full-precision coordinates in content; users surprised their location is still visible.

**Phase to address:** **Live Beacon phase** — privacy/safety is a first-class success criterion, not a nice-to-have. Treat "no silent always-on" and "honest staleness" as acceptance gates.

---

### Pitfall 5: Inline `naddr` mentions in Article Markdown drift out of sync with mirrored `a` tags

**What goes wrong:**
Story/Article (~37520) puts dataset references as inline `nostr:naddr…` mentions in Markdown **and** mirrors them into queryable `a` tags. These two representations can diverge:
- User edits Markdown (removes/adds an naddr) but the `a` tags aren't re-derived → ghost `a` tags reference things no longer in the prose, or the map lane shows refs the article doesn't mention (and vice versa).
- Hand-edited or AI-generated Markdown contains a malformed/typo'd naddr that silently isn't mirrored → reference invisible to queries.
- Same naddr mentioned twice → duplicate `a` tags or double-rendered map features.
- An `naddr` that points to a *different kind* than expected (a Group instead of a Dataset) → wrong entity rendered in the map lane.

**Why it happens:**
Two sources of truth for the same fact (prose vs tags) with a manual mirroring step. Easy to update one and forget the other; easy for the parser and the renderer to disagree on what counts as a valid mention.

**How to avoid:**
- **Single source of truth + deterministic derivation:** treat the Markdown body as canonical and **re-derive all `a` tags from the parsed naddr set on every publish** — never hand-maintain `a` tags. Mirroring must be a pure function `markdown → a[]`, run at publish, idempotent.
- **Validate each naddr at derivation:** decode it, check kind is an allowed reference target, dedupe, drop malformed ones with a visible authoring warning ("3 of 4 references linked; 1 could not be parsed").
- **Round-trip test:** parse → derive → re-parse must be stable.
- **Render the map lane from the derived set**, so prose and map can't disagree.

**Warning signs:**
Map shows a feature the article never mentions (or omits one it does); duplicate refs; `a`-tag count ≠ distinct-naddr count in body; a reference that renders as the wrong entity type.

**Phase to address:** **Story/Article phase** (reference-direction "curate-pull" is this entity's defining behavior; the mirror must be airtight) — with a shared naddr-parse/validate utility usable by the **Authoring-UI / reference-integrity** cross-cut.

---

### Pitfall 6: NIP-40 expiration is not enforced by relays — Temporal Sightings linger

**What goes wrong:**
Temporal Sighting relies on NIP-40 `expiration` to auto-disappear (the "soccer star spotted at hotel" case should evaporate). But verified NIP-40 semantics: relays **SHOULD** drop/withhold expired events but **MAY persist them indefinitely**, and **clients SHOULD ignore expired events**. So:
- Some relays keep serving expired sightings; if the client doesn't filter, stale/expired observations show on the map indefinitely.
- A relay that doesn't support NIP-40 stores it forever and never honors the tag.
- Querying "current sightings" returns past ones unless the client checks `expiration` against *its own* clock.

**Why it happens:**
Developers assume "expiration tag = relay deletes it." It is advisory. Enforcement is the **client's** job, and clock comparison is local.

**How to avoid:**
- **Always client-filter on `expiration`** at read time: drop any event whose `expiration < now`, regardless of whether the relay returned it.
- **Don't rely on relays for cleanup.** Treat NIP-40 as a hint to compliant relays, not a guarantee.
- **Advertise/prefer NIP-40-supporting relays** for sightings, but still filter locally.
- **Decide representation deliberately** (open question in PROJECT.md): dedicated kind vs property+NIP-40. If a *dedicated replaceable* kind is used, expiry + replaceable interact — an expired-but-newest replaceable still shadows the address; prefer **regular (non-replaceable) ephemeral or expiring events** for one-shot sightings so they simply age out rather than occupying an address.
- **Handle timezone/clock for the `start`/`end` window** (NIP-52 flavor): store/compare in UTC epoch seconds only; never compare local-formatted times. Beware future-dated sightings (clock-ahead author) appearing "valid" prematurely.

**Warning signs:**
Expired sightings still on the map; a sighting visible only via one relay; "current" query returns yesterday's; off-by-hours window bugs around DST; future-dated sightings showing early.

**Phase to address:** **Temporal Sighting phase** (and a shared read-time expiry filter usable app-wide).

---

### Pitfall 7: Clean-break orphans — old kind-37518 events still live in relays and other clients

**What goes wrong:**
PROJECT.md mandates a **clean break**: redefine 37518 (now the slimmed Group/Topic), no migration. But Nostr has no global delete:
- Old-shape 37518 events (the overloaded discriminated-union form) persist on relays and in other clients' caches **forever**.
- The *same kind number* 37518 now means two different schemas depending on `created_at` — a reader can't tell "old context" from "new Group" by kind alone.
- Replaceable semantics partially help: a new 37518 with the same `pubkey:d` **overwrites** the old at the address — but only for addresses the owner re-publishes; abandoned old `d`s linger, and other relays may keep older copies.
- `c` tags / `a` tags authored under the old model may reference 37518 coordinates that now resolve to a differently-shaped event → renderer crashes or mis-renders.

**Why it happens:**
"Clean break" is a *client-policy* decision, but the data substrate is append-only and federated. You can stop *writing* the old shape; you can't stop the old shape from *existing*.

**How to avoid:**
- **Version-discriminate inside content**, not by kind. Add an explicit `modelVersion` (or rely on a required new field) so the client can detect old-shape 37518 and **defensively ignore or down-rank** it rather than mis-parsing.
- **Parse defensively:** every 37518 reader must tolerate the old shape without throwing — treat unrecognized/legacy as "skip" or "legacy, read-only," never crash.
- **Seed/test data only** for old 37518 (PROJECT.md already says existing data is seed/test) — but write the guard anyway because *foreign* relays/clients aren't under your control.
- **New `d`s where shape changes meaningfully** so you don't fight an old replaceable copy on a stale relay.
- **Coordinate-resolution guard:** when following a `c`/`a` to a 37518, validate it matches the new shape before rendering; drop legacy silently.

**Warning signs:**
A 37518 event renders with missing/extra fields; a `c` link points to a "context" that doesn't look like a Group; crashes parsing content from before the cutover; two clients show the same address differently.

**Phase to address:** **Taxonomy & Clean-Break Foundation phase** (define the version discriminator + defensive-parse contract *first*, so every later entity phase inherits it).

---

### Pitfall 8: NIP-32 `L`/`l` labeling mistakes — namespace collisions and unpaired marks

**What goes wrong:**
Cross-cutting taxonomy uses NIP-32 `L` (namespace) + `l` (label). Verified NIP-32 rules: every `l` **MUST** carry a mark matching an `L` namespace in the same event; absent any `L`, the `ugc` namespace is assumed; publishers SHOULD stay within a single namespace. Mistakes:
- **Unpaired `l`** (label with no matching `L`) → silently lands in `ugc`, polluting the freeform namespace and breaking controlled-vocabulary queries.
- **Namespace collision:** using a bare/ambiguous namespace (e.g. `place` instead of reverse-DNS `org.earthly.place`) collides with other apps' labels → query returns foreign-app data, controlled vocab is no longer controlled.
- **`L`/`l`/`t`/`c` overlap re-introduced:** the milestone's whole point is removing the `t`/taxonomy overlap; if `t` freeform tags and `L`/`l` controlled labels encode the *same* concept, you've recreated the bloat in a new shape.
- **Schema-enforced labels not actually enforced:** controlled `L`/`l` vocab that the Group schema claims to enforce but the client doesn't validate → uncontrolled values leak in.

**Why it happens:**
NIP-32's mark-pairing requirement is easy to miss; reverse-DNS namespacing feels like overkill until two apps collide; the conceptual boundary between `t` (discovery) and `L`/`l` (controlled) blurs under time pressure.

**How to avoid:**
- **Own a reverse-DNS namespace** (e.g. `org.earthly.*`) for all controlled labels; never publish a bare-namespace `L`.
- **Emit `L` and `l` as a validated pair** from one helper — reject/repair an `l` without its `L`; one namespace per labeling concern.
- **Keep the axes disjoint by construction:** `L`/`l` = controlled/schema-enforceable taxonomy; `t` = freeform discovery; `c` = entity-backed attach. Document and lint that the same concept isn't double-encoded. (Directly realizes PROJECT.md's "principled split removes the `t`/taxonomy overlap.")
- **Validate controlled vocab client-side** where a Group schema declares it (and apply the schema-DoS guards from Pitfall 2 to that path).

**Warning signs:**
Labels showing up under `ugc`; taxonomy queries returning other apps' events; the same category expressed as both a `t` and an `l`; controlled-vocab values outside the declared set.

**Phase to address:** **Taxonomy & Clean-Break Foundation phase** (define namespace + pairing helper once; all entity phases consume it).

---

### Pitfall 9: `d`-tag instability breaks lineage / forks the entity

**What goes wrong:**
All four new entity kinds (plus existing 37515/37518/37519) are parameterized-replaceable, keyed by `d`. If an edit re-generates the `d` instead of reusing it, the "edit" becomes a **new lineage** — a fork — and the original address keeps the old content forever. Comments/reactions/proposals (`a`-tagged to the old coordinate) detach. Conversely, **reusing a `d` across two genuinely different entities** silently overwrites one with the other.

**Why it happens:**
`d` generation is easy to wire into "create" and accidentally re-run on "edit"; or a refactor regenerates ids. The split multiplies the surface (four new create/edit flows), so the bug can recur per kind.

**How to avoid:**
- **One rule, enforced in the shared factory:** edit = reuse `d` (+ bump `v`/version); new = fresh `d`; intentional fork = fresh `d` + `["p", oldEventId]` predecessor link (per SPEC §5). Reuse Earthly's existing `publishUpdate`/`publishNew` lineage discipline (already proven for 37515/37519) for every new kind.
- **Test that edit preserves the address** for each kind; assert `a`-tagged children still resolve after an edit.
- **Guard against accidental `d` reuse** across distinct entities created in the same session.

**Warning signs:**
Editing a Story/Group creates a duplicate instead of updating; comments vanish after an edit; a "new" entity overwrites an existing one; version doesn't increment.

**Phase to address:** **Taxonomy & Clean-Break Foundation phase** (shared factory lineage contract), verified again in each entity phase's authoring UI.

---

### Pitfall 10: Schema-hash integrity ignored / divergent client interpretation

**What goes wrong:**
SPEC has an optional `schema-hash` tag. If clients don't verify `sha256(schema) == schema-hash`, a relay or MITM-ish actor could serve a *different* schema than the author signed-the-hash for (the schema lives in content, so it's signed — but if a client ever fetches schema out-of-band or caches loosely, integrity drifts). Worse: **divergent interpretation** — two clients validate the same dataset against the same schema and disagree (different JSON-Schema dialect defaults, different `format` handling, ajv vs another validator) → a dataset is "valid" in one client, "filtered" in another → inconsistent map lanes, user confusion about why their dataset vanished.

**Why it happens:**
JSON-Schema portability is assumed but not real: dialect defaults, `format` assertion vs annotation, unknown-keyword handling all vary by validator. Integrity checks are "optional" so they get skipped.

**How to avoid:**
- **Pin the dialect explicitly** (SPEC recommends 2020-12) and **pin one validator + config** as the app's reference behavior; document it as the canonical interpretation.
- **Verify `schema-hash`** when present; treat mismatch as "do not validate / show warning," never silently use a different schema.
- **Make validation outcome legible:** when a dataset is filtered by a required-mode Group, tell the user *which rule* failed, so cross-client disagreement is debuggable rather than mysterious.
- **Treat `format` as annotation, not assertion** by default (ajv's safer mode) unless the dialect/strictness is explicitly opted in.

**Warning signs:**
A dataset valid in one client, filtered in another; schema-hash present but never checked; users asking "why did my dataset disappear from this Group?"

**Phase to address:** **Group/Topic + schema governance phase.**

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Validate Group schema on the main thread | Less plumbing than a worker | One hostile schema freezes/kills every viewer's tab (Pitfall 2) | **Never** — schema is untrusted-author code |
| Hand-maintain `a` tags alongside Markdown naddrs | Fast to ship the editor | Prose/tag/map drift, ghost refs (Pitfall 5) | Never — always derive from body |
| Trust relay `created_at` as recency-of-truth for beacons | No extra seq field | Stale fix shadows live one under clock skew (Pitfall 1) | Never for live position; OK for rarely-edited datasets |
| Persistent "share location" toggle that survives reload | One-tap re-share | Silent always-on location leak (Pitfall 4) | Never default-on; only behind explicit, re-affirmed, time-boxed opt-in |
| Rely on NIP-40 relays to delete expired sightings | No client filter code | Expired sightings linger via non-compliant relays (Pitfall 6) | Never — always client-filter too |
| Reuse kind 37518 number with no in-content version flag | Honors "clean break" simply | Old + new shapes indistinguishable; mis-parse/crash (Pitfall 7) | Never — add a version discriminator |
| Skip `schema-hash` verification (it's "optional") | Less work | Divergent/forged schema, silent filtering (Pitfall 10) | Only if schema is always inline + signed *and* dialect/validator pinned |
| Bare namespace for `L` labels | Shorter tags | Cross-app collision, uncontrolled vocab (Pitfall 8) | Never — use reverse-DNS |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| applesauce EventStore (replaceable de-dup) | Assuming the store gives one canonical beacon across relays | De-dup again by `(pubkey,d,max-seq)` in app code; per-relay replaceable de-dup is not global |
| Relays + NIP-40 | Treating `expiration` as a delete guarantee | Client-filter expired on read; prefer but don't depend on NIP-40 relays |
| JSON-Schema validator (ajv-class) | Running untrusted schema in-thread, `format` as assertion, `$data`/`pattern` enabled | Worker + timeout-kill; pin dialect; disable/guard `pattern`; reject `$ref`; cap size/depth; `format` as annotation |
| naddr / NIP-19 decoding | Assuming every inline mention is a valid same-kind reference | Decode + kind-check + dedupe every naddr before mirroring to `a` and before map render |
| NIP-32 labels | Emitting `l` without matching `L`; bare namespace | Paired `L`+`l` helper, single reverse-DNS namespace per concern |
| `c` attachment coordinates | Rendering any `c` target a stranger asserts | Resolve + signature-validate + kind-check; curated lane default, foreign lane opt-in/capped (Pitfall 3) |
| MapLibre rendering of live point | Re-adding/removing a source per beacon frame | Update an existing GeoJSON source's data in place; throttle to render budget |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Compile JSON-Schema per render | UI jank on every Group view | Compile once, cache by schema-hash | Any Group with a non-trivial schema, immediately |
| Validate every attached dataset on every fetch | Group open time grows with attachment count | Validate lazily/visible-set only; worker; memoize per (dataset-version, schema-hash) | Popular open Group, dozens+ of attachments |
| Unbounded foreign-`c` lane render | Slow Group, memory growth | Cap + paginate + sort (Pitfall 3) | A Group that gets brigaded/spammed |
| High-frequency beacon publish + render | Relay churn, map flicker, battery drain | Throttle publish; in-place source update; ephemeral frames | Active live session, esp. mobile |
| Re-deriving/re-parsing all naddrs on every keystroke | Editor lag in long articles | Derive `a` tags at publish, not per keystroke; debounce preview | Long Markdown articles with many refs |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Untrusted Group schema run in-thread | DoS — frozen/killed viewer tabs (ReDoS, recursive `$ref`, huge schema) | Worker + hard timeout-kill; subset dialect; reject `$ref`; cap size/depth (Pitfall 2) |
| Rendering spoofed foreign `c` attachments unfiltered | Spam/abuse floods open Group with no moderation | Curated-default + opt-in capped foreign lane + per-viewer local mute (Pitfall 3) |
| Public full-precision live location | Stalking / real-world harm / de-anon | Default-off, time-boxed, coarsen-by-default, honest staleness, ephemeral frames (Pitfall 4) |
| Believing "stop sharing" deletes the position | User exposed after they think they're private | No-delete on Nostr — publish "ended" + warn last point stays public (Pitfall 4) |
| Skipping schema-hash / dialect pinning | Forged or divergently-interpreted schema silently filters data | Verify hash; pin dialect+validator; legible filter reasons (Pitfall 10) |
| Mis-parsing legacy 37518 as new Group | Crash / wrong render from foreign-relay old data | Version discriminator + defensive parse (Pitfall 7) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Stale beacon shown identically to live | User acts on wrong "they're here now" info | Age stamp + grey-out past staleness threshold |
| No visible "LIVE / sharing" indicator | User forgets location is broadcasting | Persistent prominent LIVE chip + time-box countdown |
| Foreign-attach noise drowns curated content | Open Group feels broken/spammy | Curated lane is the default; foreign lane collapsed + opt-in |
| Dataset silently vanishes from a required-schema Group | "Where did my map go?" confusion | Show "filtered by rule X" with the failing constraint |
| naddr typo silently dropped from references | Author thinks a ref is linked; it isn't | "3 of 4 references linked; 1 unparseable" authoring warning |
| Old 37518 context appears half-broken | Confusing legacy artifacts | Label as legacy/read-only or hide; don't render half-parsed |

## "Looks Done But Isn't" Checklist

- [ ] **Live Beacon "stop sharing":** Often missing the **terminal "ended" state + "last point stays public" warning + kill-on-tab-close** — verify publishing actually halts on unload and the UI stops claiming "live."
- [ ] **Group schema validation:** Often missing the **off-thread timeout-kill + `pattern`/`$ref`/size guards** — verify a hostile schema (`^(a+)+$` pattern, deep `$ref`, 5 MB schema) cannot freeze the tab.
- [ ] **Article reference mirror:** Often missing **publish-time re-derivation + per-naddr kind validation** — verify editing the Markdown updates the `a` tags and the map lane in lockstep, malformed naddrs are surfaced.
- [ ] **Temporal Sighting expiry:** Often missing **client-side expired-filter** — verify an expired sighting served by a non-compliant relay does NOT render.
- [ ] **Open Group with no moderation:** Often missing the **[NO-MOD MINIMUM]**: curated-default lane + per-viewer local mute + foreign-lane cap — verify a spammed Group is still usable and the owner can collapse to curated in one click.
- [ ] **Clean break on 37518:** Often missing the **defensive legacy parse** — verify old-shape 37518 from a foreign relay neither crashes nor renders as a valid new Group.
- [ ] **NIP-32 labels:** Often missing **`L`/`l` pairing + reverse-DNS namespace** — verify no `l` lands in `ugc` and taxonomy queries don't return foreign-app events.
- [ ] **Beacon recency:** Often missing **seq/clock-skew handling** — verify a clock-ahead or out-of-order update doesn't shadow the truly-latest position.
- [ ] **d-tag lineage:** Often missing per new kind — verify edit preserves the address and keeps comments/reactions attached.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Hostile schema freezing tabs | MEDIUM | Ship worker+timeout guard; blocklist/down-rank the offending schema-hash; cap size/depth retroactively |
| Spammed open Group | LOW-MEDIUM | Owner sets `allowForeignAttachments=false` (collapse to curated); viewers local-mute attackers; tighten foreign-lane cap |
| Leaked live location | HIGH (irreversible) | Cannot delete from relays. Publish "ended"; rotate to a fresh pubkey for future sharing if correlation matters; warn user the past trail is permanent |
| naddr/`a` drift | LOW | Re-publish article (re-derives `a` from body); add round-trip test to prevent recurrence |
| Lingering expired sightings | LOW | Ship client-side expiry filter; back-fill the read path; they age out of the UI immediately |
| Beacon position thrash (clock/relay) | MEDIUM | Add seq tag + client de-dup + clock clamp; single-writer lock across tabs |
| Legacy 37518 mis-parse | LOW-MEDIUM | Add version discriminator + defensive parse; treat unknown shape as skip/legacy |
| Forked d-tag lineage | MEDIUM | New version under the *correct* (original) `d`; link the accidental fork with `p` predecessor; re-attach orphaned comments where feasible |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Beacon overwrite race / clock skew | Live Beacon | Clock-ahead + out-of-order + two-tab tests don't shadow latest position |
| 2. JSON-Schema DoS | Group/Topic + schema governance | Hostile schemas (ReDoS pattern, deep `$ref`, huge size) cannot freeze tab; worker timeout-kills |
| 3. Open Group unusable w/o moderation **[NO-MOD MINIMUM]** | Group/Topic | Curated-default + local-mute + foreign-cap ship in same phase as foreign `c`; spammed Group still usable |
| 4. Live-location privacy/safety | Live Beacon | Default-off, LIVE indicator, time-box, honest staleness, "ended" + permanence warning, kill-on-unload |
| 5. naddr ↔ `a`-tag drift | Story/Article (+ reference-integrity cross-cut) | Edit re-derives `a` + map lane; malformed naddr surfaced; round-trip stable |
| 6. NIP-40 not enforced | Temporal Sighting | Expired event from non-compliant relay does not render; UTC-only window compare |
| 7. Clean-break orphans (legacy 37518) | Taxonomy & Clean-Break Foundation | Legacy-shape 37518 neither crashes nor renders as valid Group |
| 8. NIP-32 `L`/`l` mistakes | Taxonomy & Clean-Break Foundation | No `l` in `ugc`; reverse-DNS namespace; no `t`/`l` double-encode |
| 9. d-tag instability / forks | Taxonomy & Clean-Break Foundation (+ each entity phase) | Edit preserves address per kind; children stay attached |
| 10. Schema-hash / divergent interpretation | Group/Topic + schema governance | Hash verified; dialect+validator pinned; filter reasons legible |

## Sources

- [NIP-01 — Basic protocol flow / addressable (replaceable) events, tie-break = lowest lexical event id on equal `created_at`](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-40 — Expiration Timestamp: relays SHOULD drop expired but MAY persist indefinitely; clients SHOULD ignore expired](https://nips.nostr.com/40)
- [NIP-32 — Labeling: `L` namespace + `l` label, mark-pairing requirement, `ugc` default, single-namespace + reverse-DNS guidance](https://github.com/nostr-protocol/nips/blob/master/32.md)
- [Ajv security considerations — untrusted schemas, ReDoS via `pattern`/`$data`, `format` assertion risk](https://ajv.js.org/security.html)
- [CVE-2025-69873 — ajv ReDoS via `$data` `pattern` (catastrophic backtracking, ~44s CPU from 31-char payload)](https://www.datacomm.com/feed-post/cve-2025-69873-ajv-another-json-schema-validator-before-8-18-0-is-vulnerable-to-regular-expression-denial-of-service-redos-when-the-data-option-is-enabled-the-pattern-keyword-accepts-runtime-dat/)
- Earthly SPEC.md (kind 37515/37518/37519 semantics, two-lane context model, `schema-hash`, blob refs, lineage rules §5) — repo
- Earthly .planning/PROJECT.md (v1.2 scope, clean-break, deferred moderation/WoT, open lifecycle questions) — repo
- Earthly v1.1 prior art: QuickJS-WASM-in-Worker sandbox + timeout/circuit-breaker harness (reusable for schema validation isolation) — repo MEMORY

---
*Pitfalls research for: adding role-specific geo entity kinds to a decentralized Nostr/applesauce + MapLibre app (Earthly v1.2)*
*Researched: 2026-06-23*
