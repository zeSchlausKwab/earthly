# Feature Research

**Domain:** Role-specific geo entity types (curated article, community group, live beacon, temporal sighting) on a Nostr-backed collaborative mapping app — Earthly milestone v1.2
**Researched:** 2026-06-23
**Confidence:** HIGH (Nostr NIP prior art verified against spec sources; comparable-product behavior verified against vendor docs)

## Scope Note

This research covers ONLY the NEW behavior introduced by the v1.2 Geo Entity Model Split. The four entity types are:

1. **Story / Article** (new, ~37520) — pull/curate, closed Markdown narrative
2. **Group / Topic** (37518, slimmed) — push/attach, governance ladder
3. **Live Beacon** (new, ~37521) — real-time updating position
4. **Temporal Sighting** (new) — time-bound observation

The reusable substrate (kind 37515 datasets, 37517 comments, 37519 edit proposals, kind-7 reactions, MapLibre editor, Blossom blobs, AI chat) is treated as a **dependency**, not re-researched. Each entity-type section below marks complexity, table-stakes vs differentiator vs anti-feature, and which existing substrate it leans on.

The **central organizing axis** (from PROJECT.md) is *reference direction*: entity→datasets (curate-pull, author owns the list) vs datasets→entity (attach-push, contributors add themselves via `c`). This single axis drives the create flow and the default UI for every entity below.

---

## Cross-Cutting Findings

### Reference direction is the UI-defining property

| Direction | Who owns the list | Tag mechanics | UI shape | Nostr prior art |
|-----------|-------------------|---------------|----------|-----------------|
| **Curate-pull** (Story, Group's pinned refs) | The entity author | Inline `nostr:naddr…` in Markdown → mirrored to `a` tags on the entity | An ordered, authored reading list; refs render where the author placed them in the prose | NIP-23 long-form (`a`/`e`/`q` inline mentions) |
| **Attach-push** (Group's foreign lane, Sighting→Group) | Any contributor | Contributor's dataset/feature carries `["c", "<group-coord>"]`; group does NOT list them | A community wall/feed of inbound attachments; author cannot reorder, only governance-filter | NIP-72 (post tags community `a`); spec's existing `c` semantics |

This is already half-built in the current 37518 "two-lane" spec (SPEC.md §2.3) — the curated lane (inline `a`) and foreign lane (`c`). The v1.2 work is to **promote each lane to its own entity** so the create flow stops branching on a content discriminator. **Confidence: HIGH** (directly from SPEC.md + NIP-23/NIP-72 verified).

### Schema-enforced contribution: validate-on-create + filter-on-fetch

The spec's existing `geometryConstraints` + JSON Schema + `validationMode: none|optional|required` + viewer `filter mode off|warn|strict` (SPEC.md §2.3) is the right two-sided pattern and matches how comparable systems avoid frustrating contributors:

- **Validate-on-create (client-side, non-blocking by default):** show schema violations as inline warnings in the contribution form *before* publish, the way iNaturalist collection projects surface "this observation doesn't meet project requirements." The contributor still publishes a valid kind-37515 dataset — the group just won't surface it. This is the key anti-frustration move: **the contributor's data is never rejected at the protocol layer; only the group's view filters it.** A decentralized relay cannot reject a valid event anyway, so enforcement MUST be view-side.
- **Filter-on-fetch (viewer-side):** `required` groups default to `strict` (hide invalid), but the viewer can override to `warn` or `off`. This mirrors iNaturalist showing "needs ID" observations but letting you filter them out.

**Confidence: HIGH** (validate/filter split is in the spec; comparable-product framing verified against iNaturalist + AllTrails).

### Taxonomy: NIP-32 `L`/`l` vs `t` vs `c`

Verified three-way split (resolves the `t`/taxonomy overlap PROJECT.md calls out):
- `L`/`l` (NIP-32 namespace + label) — **controlled, schema-enforceable** vocabulary. Self-labeling by the author; the namespace (`L`) names the scheme, the label (`l`) is the value. Use for governed classification (e.g. `["L","earthly.surface"],["l","beach","earthly.surface"]`).
- `t` — **freeform discovery** hashtags (existing). Keep for search, not governance.
- `c` — **entity-backed attach** (existing). The only one that creates a reference edge to another entity.

**Confidence: HIGH** (NIP-32 self-labeling semantics verified).

---

## Entity 1 — Story / Article (curate-pull, closed)

The "Roman ruins in Austria" essay. Direct Nostr analog: **NIP-23 long-form (kind 30023)** plus inline geo references.

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Markdown body with title / summary / image / `published_at` | NIP-23 articles set this baseline; any "article" missing a title feels broken | LOW | Adopt NIP-23 metadata tags verbatim (`title`, `summary`, `image`, `published_at`); body in `content` |
| Inline geo references rendered in-place (`nostr:naddr…` → dataset/feature) | The whole point is prose interleaved with map objects; SPEC.md §8.5 already defines eye-toggle + zoom for inline refs in comments | MEDIUM | Reuse the existing inline-ref renderer (eye toggle / fly-to) from the comment system. Mirror inline refs to `a` tags for queryability (NIP-23 + existing 37518 pattern) |
| Draft state before publish | NIP-23 reserves kind 30024 for drafts; authors expect to not publish half-written essays | LOW–MEDIUM | Either NIP-23-style separate draft kind or a `draft` flag; reuse existing workspace/draft persistence |
| Comment + react on the article | Substrate exists (37517 comments, kind-7 reactions); readers expect to respond to an essay | LOW | Reuse 37517 + kind 7 with the new root kind in `K`/`A` |
| Edit history / replaceable update | Articles are "meant to be editable" (NIP-23); same `d`-tag lineage as existing 37515 | LOW | Parameterized-replaceable; reuse the existing replaceable-update plumbing |
| Propose-edit on the narrative | PROJECT.md explicitly says Story reuses kind 37519 proposals | MEDIUM | 37519 currently carries a *FeatureCollection* replacement; for a Story the proposal target is Markdown text, not GeoJSON — see Dependencies/anti-features |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Map "reading order" — refs fly the map as the reader scrolls the prose | This is Atlas Obscura / Google My Maps "story map" magic on a decentralized stack; no Nostr client does interleaved prose+geometry well | MEDIUM–HIGH | Scroll-linked map camera; refs already carry bbox/geohash for fly-to |
| Inline video / image refs alongside geometry | The "Roman ruins" essay wants photos of the ruins next to the polygon | MEDIUM | Reuse existing TipTap MediaExtensions + Blossom; treat media as just another inline ref type |
| AI-assisted authoring of the essay (chat drafts narrative around selected map objects) | Aligns with the app's "author by chat" core value; "write me an essay about these 5 ruins" | MEDIUM | Leans on shipped v1.1 chat workbench; out-of-band but natural |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-attach foreign datasets into a Story | "Shouldn't my Story collect related datasets?" | Breaks the closed/curated contract — the Story is the *author's* argument; foreign attach is the Group's job. PROJECT.md: Story "does NOT auto-attach foreign datasets" | If you want community contribution, create a Group, not a Story |
| Free-form WYSIWYG with arbitrary HTML | "Richer than Markdown" | NIP-23 is explicitly Markdown; HTML breaks interop + invites XSS | Markdown + a fixed set of inline ref/media extensions |
| Threaded approval workflow for the narrative | "Let co-authors approve sections" | This is NIP-72 moderation territory, deferred this milestone | Use 37519 propose-edit (single owner accepts/rejects) |

---

## Entity 2 — Group / Topic (attach-push, governance ladder)

Slimmed kind 37518. Absorbs "best surfing beaches" (open) and "hiking trails" (schema-enforced). Direct analogs: **NIP-72 moderated communities** (the `a`-tag attach pattern, NOT the approval machinery) + community POI collections (AllTrails curated / Wikiloc open / Surfline spots).

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Datasets attach via `c` and appear in a foreign lane | This is the core "community map" behavior; NIP-72 communities work exactly this way (event tags community, community lists nothing) | LOW–MEDIUM | Reuse existing `c`-tag attach + foreign-lane query from 37518 |
| Governance ladder `open · schema · closed` | PROJECT.md's defining Group property; "best surfing beaches" = open, "hiking trails" = schema | MEDIUM | Map to existing `allowForeignAttachments` + `validationMode` content fields; collapse to one explicit `governance` enum |
| Schema definition UI (geometry constraints + JSON Schema) | A "hiking trails" group needs to say "polylines with elevation" | MEDIUM–HIGH | Reuse existing `geometryConstraints` + self-contained JSON Schema (2020-12); needs an authoring UI for non-developers |
| Validate-on-create warnings in the contribution form | Don't silently drop a contributor's work; tell them why it won't show | MEDIUM | Run schema/geometry check client-side at attach time, show inline warnings, still allow publish |
| Filter-on-fetch with viewer override (`off/warn/strict`) | Viewers expect to see/hide non-conforming attachments | MEDIUM | Exists in spec; surface as a view toggle |
| Optional narrative + pinned "canonical" refs (curate-pull *within* the Group) | A Group can also be a mini-Story: "here are the 3 reference trails" | MEDIUM | Same inline-`a` mechanism as Story; Group carries BOTH lanes (this is intentional, per PROJECT.md) |
| Comment + react on the Group | Communities discuss; substrate exists | LOW | 37517 + kind 7 with Group as root |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Schema-as-contract without server moderation | AllTrails needs human moderators + days-to-months approval; a schema-gated open group gets "only conforming data shows" instantly, no moderator | MEDIUM | The decentralized win: validation replaces moderation for *structural* quality (not spam) |
| Live, query-time membership (no approval lag) | Wikiloc-style instant contribution but with AllTrails-style structure | LOW | Inherent to attach-push + filter-on-fetch |
| `L`/`l` controlled vocabulary enforced by schema | "surface=beach\|reef\|point-break" as a governed enum, discoverable + filterable | MEDIUM | NIP-32 namespace tied to the group's schema |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| NIP-72 human approval / moderator role lists (kind 4550, kind 34550 moderators, kind 30000 role lists) | "Reddit-style moderation feels safe" | **Explicitly deferred** (PROJECT.md): spam handled by web-of-trust + mute, not approval. Adds a kind, a UI, a notification surface | Schema validation for quality; WoT/mute for spam (next milestone) |
| Relay-side rejection of invalid attachments | "Just make the relay enforce the schema" | Relays are generic; can't enforce app schemas; a valid Nostr event can't be rejected | View-side filter-on-fetch is the only enforceable layer |
| Blocking the contributor's publish on schema fail | "Force them to fix it" | Frustrates contributors; their dataset is still a valid standalone 37515 | Warn-and-allow; the group just doesn't surface it until fixed |
| Per-group private membership / invites | "Closed group should be invite-only" | Encryption/membership is a separate hard problem; `closed` here means "no foreign attach," not "private" | `closed` = author-curated refs only (= a Group acting like a Story) |

---

## Entity 3 — Live Beacon (real-time updating position)

New (~37521). Direct analogs: **Glympse / Google Maps live location / Find My** (product) and Nostr **ephemeral events + geohash channels** + **NIP-40 expiration** (protocol). PROJECT.md flags lifecycle (replaceable vs ephemeral) + visibility model as **open for phase-level research** — this section frames the decision, doesn't pre-decide it.

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| A single point that updates as the sharer moves | The definition of a live beacon; Glympse/Find My baseline | MEDIUM | Replaceable event (same `d`, new position) OR ephemeral stream (kind 2xxxx); see lifecycle decision |
| Explicit start-sharing / stop-sharing | Every product (Glympse, Google Maps) makes "stop sharing" a first-class, always-available control | LOW–MEDIUM | Stop = publish a final "ended" state OR let it expire; never leave a beacon implicitly live |
| Time-boxed expiry (auto-stop) | Glympse: minutes to 4 hours, auto-expires; users expect sharing to NOT be forever | LOW | **NIP-40 `expiration` tag** (unix seconds) — verified standard for this; relays drop after expiry |
| Staleness indication ("last seen N min ago") | If updates stop (dead battery), viewers must see the position is stale, not current | LOW–MEDIUM | Compare `created_at` of latest update to now; show age; Glympse/Find My both surface this |
| Public toggle / shareable link | PROJECT.md: "shareable/public real-time position." Glympse shares via link, no account needed for viewers | LOW–MEDIUM | A naddr/nevent share link; "public" = discoverable vs link-only |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Beacon driven by "another data source" (not just the sharer's GPS) | PROJECT.md: "updates with the sharer's position OR another data source" — e.g. a vehicle/asset feed, an AIS ship, the AI sandbox pushing positions | MEDIUM | The Authoring API / code sandbox (v1.1) can publish beacon updates; differentiator vs consumer apps |
| Geohash-channel proximity discovery | Bitchat/Nymchat pattern: beacons discoverable by geohash region | MEDIUM | Reuse existing `g` geohash tag for proximity query |
| Beacon trail / breadcrumb (optional history) | "Where have they been" vs just "where now" | MEDIUM | Only if ephemeral-stream lifecycle chosen; replaceable loses history |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Always-on background tracking | "Track them continuously" | Privacy nightmare; relays accumulate position history; battery drain | Time-boxed (NIP-40), explicit-start, foreground-only by default |
| Persistent permanent position history on relays | "Keep the whole trail forever" | Replaceable+expiry is the privacy-safe default; permanent trails are a surveillance footgun | Ephemeral (kind 2xxxx, relays don't store) for live; opt-in saved trail as a separate dataset |
| Beacon as a comment/edit target | "Let people annotate the live position" | A moving point is a poor comment anchor; churns | Comment on a Sighting (snapshot) instead |
| Encrypted per-viewer location (NIP-17 gift-wrap) | "Only my friends see it" | Real but heavy; PROJECT.md frames this milestone around *public* beacons | Public toggle now; private/encrypted beacons a later milestone |

**Lifecycle decision frame (for phase research):**
- **Replaceable (kind 3xxxx, e.g. 37521):** one current position, queryable by address, simple, no history, survives until overwritten/expired. Best for "where is this asset now." Pair with NIP-40 expiry.
- **Ephemeral (kind 2xxxx):** relays don't persist; true real-time stream; gives a trail if clients buffer; vanishes naturally (privacy-good). Best for "follow me for the next hour."
- **Recommendation lean:** replaceable + NIP-40 expiration for the v1.2 table-stakes "public updating point"; ephemeral stream is a differentiator to defer. **Confidence: MEDIUM** (lifecycle is explicitly open per PROJECT.md; NIP-40 + ephemeral semantics are HIGH-confidence inputs).

---

## Entity 4 — Temporal Sighting (time-bound observation)

The "soccer star spotted at hotel XYZ in Lyon" case (also user story #2 — a news curator's Telegram-message geolocation). Direct analogs: **NIP-52 calendar events** (time-bound + location) + **iNaturalist observations** (a dated, placed, titled sighting) + incident maps. PROJECT.md flags representation (dedicated kind vs property + NIP-40 expiry) as **open for phase research**.

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Title + description + a single placed feature | A sighting is "what, where, said-by-whom" — user story #2 produces "a titled, described feature" | LOW | Reuse the editor's point-drop + a small metadata form |
| Start time (and optional end / window) | iNaturalist `observed_on`; NIP-52 `start`/`end`. A "spotted at 14:00" needs a timestamp distinct from `created_at` (when it was posted) | LOW–MEDIUM | **NIP-52 `start`/`end` tags** (ISO 8601 / unix) — verified standard for time-bound geo events. Distinguish observation-time from publish-time |
| Geohash + bbox for discovery | Existing geo discovery substrate; "what was sighted near Lyon" | LOW | Reuse `g`/`bbox` |
| Attach to a Group / Topic via `c` | User story #2: "adds a feature to the topic's context" — sightings feed a topic | LOW | Reuse `c` attach (attach-push) |
| Comment + react | Sightings invite "I saw that too" / "that's wrong" | LOW | 37517 + kind 7 |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Expiry / auto-fade for ephemeral relevance | "Spotted now" loses value in hours; incident maps fade old reports | LOW | **NIP-40 `expiration`** OR a soft client-side fade by `end`/age. A sighting that auto-expires keeps the map current |
| AI-geolocated ingest (paste a message → placed sighting) | This is user story #2 verbatim and a core-value demo moment | MEDIUM | Leans on shipped v1.1 chat + geocode tools; the Sighting is the *output type* of that flow |
| Confidence / source field | News/observation context: "unconfirmed," "via Telegram" | LOW | Optional property; mirrors iNaturalist's research-grade vs needs-ID |
| Geoprivacy obscuring (coarse location) | iNaturalist obscures sensitive locations to a ~0.2° cell | MEDIUM | Defer; relevant for sensitive sightings but adds complexity |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full NIP-52 calendar/RSVP machinery (participants, RSVP kind 31925, calendars kind 31924) | "It's a NIP-52 event, do all of it" | A sighting is an *observation*, not an *invitation*; RSVP/participants are noise | Borrow only NIP-52's `start`/`end`/location tags; skip RSVP/calendar grouping |
| Editable/replaceable sighting with version lineage | "Let me correct the sighting" | An observation is a point-in-time claim; mutating it rewrites history. Corrections should be new sightings or comments | Regular event + comment-to-correct; or a fresh sighting that supersedes |
| Permanent storage of every transient sighting | "Archive all sightings forever" | Stale "spotted" reports clutter the map and mislead | NIP-40 expiry default; opt-in promote a notable sighting into a dataset/Story |

**Representation decision frame (for phase research):**
- **Dedicated kind** (cleaner type, distinct query, own UI affordances) vs **kind-37515 feature + property + NIP-40 expiry** (reuses all dataset plumbing, less new code). PROJECT.md leaves this open. Lean: a dedicated lightweight kind borrowing NIP-52 `start`/`end` + NIP-40 `expiration`, because the *time-bound + auto-expire + single-feature* shape differs enough from a dataset that overloading 37515 reintroduces the discriminated-union problem this whole milestone is fixing. **Confidence: MEDIUM.**

---

## Feature Dependencies

```
Story/Article (37520)
    └──reuses──> Inline geo-ref renderer (eye-toggle/fly-to)  [from 37517 comments, SPEC §8.5]
    └──reuses──> 37517 comments + kind-7 reactions
    └──reuses──> 37519 edit proposals  [BUT: target is Markdown, not FeatureCollection — see note]
    └──reuses──> NIP-23 metadata tags (title/summary/image/published_at)
    └──reuses──> TipTap editor + Blossom media (v1.1)

Group/Topic (37518 slimmed)
    └──reuses──> `c` attach-push + foreign-lane query  [existing 37518]
    └──reuses──> geometryConstraints + JSON Schema validate/filter  [existing 37518]
    └──reuses──> inline-`a` curate-pull  [shared with Story]
    └──enables──> schema-enforced contribution (validate-on-create + filter-on-fetch)
    └──conflicts──> NIP-72 human approval  [deferred — do NOT combine]

Live Beacon (37521)
    └──requires──> NIP-40 expiration  [time-box / auto-stop]
    └──requires──> lifecycle decision (replaceable vs ephemeral)  [phase research]
    └──reuses──> `g` geohash proximity
    └──enhanced-by──> Authoring API / code sandbox (v1.1)  ["another data source"]

Temporal Sighting
    └──requires──> NIP-52 start/end tags  [observation-time vs publish-time]
    └──requires──> representation decision (dedicated kind vs 37515+property)  [phase research]
    └──reuses──> `c` attach-push (feeds a Group)
    └──reuses──> editor point-drop + 37517/kind-7
    └──enhanced-by──> v1.1 chat geocode ingest  [paste→sighting, user story #2]
    └──enhanced-by──> NIP-40 expiration  [auto-fade]

Cross-cutting:
NIP-32 L/l taxonomy ──enables──> schema-enforced controlled vocab in Group
NIP-32 L/l + t + c ──replaces──> overloaded `t`/taxonomy on old 37518
```

### Dependency Notes

- **Story propose-edit reuses 37519 but the payload differs:** existing 37519 carries a full *FeatureCollection* replacement (SPEC.md §10). A Story's editable body is Markdown. Either (a) generalize 37519's content to "full replacement of target content" regardless of type, or (b) accept that Story edit-proposals replace the Markdown `content`. Flag for requirements: this is a small but real extension, not pure reuse.
- **Group carries BOTH reference directions intentionally:** curate-pull (pinned canonical inline refs) AND attach-push (foreign lane). This is the one entity that is not single-direction; the create flow defaults to attach-push, with curate-pull as an optional narrative add-on. (Story is pure curate-pull; Sighting is pure attach-push.)
- **NIP-40 is shared infrastructure** across Beacon (auto-stop) and Sighting (auto-fade). Build the expiration handling once.
- **Validate-on-create depends on the schema-authoring UI** existing first — you can't validate against a schema a non-developer couldn't author.

---

## MVP Definition

Per PROJECT.md this is a **Full v2 / clean-break** milestone: spec + all event classes + full authoring UI for every kind, in one milestone. So "MVP" here = the minimum coherent surface per entity, not a subset of entities.

### Launch With (v1.2)

- [ ] **Story create/edit/read** — NIP-23 metadata + Markdown + inline geo refs (eye-toggle/fly-to) — the curate-pull flagship
- [ ] **Story comment/react/propose-edit** — reuse 37517 / kind-7 / 37519 (with Markdown-target extension)
- [ ] **Group create/edit** with explicit `governance: open|schema|closed` enum
- [ ] **Group attach-push** — datasets/sightings attach via `c`, foreign lane renders
- [ ] **Group schema authoring + validate-on-create warnings + filter-on-fetch toggle** — the no-moderator quality gate
- [ ] **Group optional narrative + pinned canonical refs** — curate-pull within the group
- [ ] **Live Beacon publish/update/stop** with NIP-40 expiry + staleness display + public/share toggle
- [ ] **Temporal Sighting create** — title/description/placed-feature + NIP-52 start/end + attach to Group + optional NIP-40 expiry
- [ ] **NIP-32 `L`/`l` taxonomy** wired into Group schema + freeform `t` retained for discovery

### Add After Validation (v1.x)

- [ ] **Scroll-linked map camera** for Story reading order — high-wow, can ship after the static version works
- [ ] **Beacon driven by external data source / sandbox** — once basic GPS beacon proves out
- [ ] **AI paste→Sighting ingest** as a polished flow — plumbing exists (v1.1); productize after the manual Sighting form works
- [ ] **Beacon trail/breadcrumb history** — only if ephemeral lifecycle is chosen

### Future Consideration (v2+)

- [ ] **NIP-72 human moderation / approval / role lists** — explicitly deferred this milestone
- [ ] **Web-of-trust + mute for spam** — the deferred companion to deferred moderation
- [ ] **Encrypted/private beacons (NIP-17 gift-wrap per-viewer)** — public-only this milestone
- [ ] **Geoprivacy location obscuring for sensitive Sightings** — iNaturalist-style
- [ ] **Promote Sighting → permanent dataset/Story** — lifecycle bridge

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Story Markdown + inline geo refs | HIGH | MEDIUM | P1 |
| Group governance ladder (open/schema/closed) | HIGH | MEDIUM | P1 |
| Group attach-push foreign lane | HIGH | LOW | P1 |
| Schema validate-on-create + filter-on-fetch | HIGH | MEDIUM | P1 |
| Live Beacon publish/stop + NIP-40 expiry + staleness | HIGH | MEDIUM | P1 |
| Temporal Sighting + NIP-52 start/end + attach | HIGH | LOW–MEDIUM | P1 |
| NIP-32 L/l taxonomy | MEDIUM | MEDIUM | P1 |
| Story comment/react/propose-edit reuse | MEDIUM | LOW | P1 |
| Scroll-linked Story map camera | HIGH | HIGH | P2 |
| Beacon external-data-source driver | MEDIUM | MEDIUM | P2 |
| AI paste→Sighting ingest | HIGH | MEDIUM | P2 |
| Beacon trail/history | LOW | MEDIUM | P3 |
| NIP-72 moderation / WoT / mute | MEDIUM | HIGH | P3 (deferred) |
| Encrypted private beacons | MEDIUM | HIGH | P3 (deferred) |

**Priority key:** P1 = must have for v1.2 launch · P2 = should have, add when possible · P3 = future / deferred

## Competitor Feature Analysis

| Feature | Comparable A | Comparable B | Our Approach |
|---------|--------------|--------------|--------------|
| Curated map article | Atlas Obscura (editorial places) | Google My Maps (story + pins) | Story 37520: Markdown + inline naddr geo refs, decentralized, propose-edit |
| Community POI collection | AllTrails (moderator-approved, days–months) | Wikiloc / Surfline (open, high volume) | Group: schema-gated open contribution — instant like Wikiloc, structured like AllTrails, no moderator |
| Schema-enforced contribution | iNaturalist collection-project requirements (warn, don't reject) | AllTrails submission criteria (human review) | Validate-on-create warnings + filter-on-fetch; never reject the contributor's event |
| Live location | Glympse (link, minutes–4h, auto-expire, 48h post-visibility) | Google Maps / Find My (duration, stop-sharing, staleness) | Beacon 37521: NIP-40 expiry, explicit stop, staleness age, public/share link |
| Time-bound observation | iNaturalist (observed_on, geoprivacy, research-grade) | Incident/crisis maps (fade old reports) | Sighting: NIP-52 start/end + NIP-40 auto-fade + AI geolocation ingest |
| Taxonomy / labeling | iNaturalist taxon + place hierarchy | OSM tags (free-form k=v) | NIP-32 L/l controlled vocab (governed) + t freeform (discovery) + c attach (edges) |

## Sources

- [NIP-23 Long-form Content (kind 30023/30024)](https://nips.nostr.com/23) — article metadata tags (title/summary/image/published_at), Markdown body, draft kind, replaceable editing — HIGH
- [NIP-72 Moderated Communities (kind 34550 / 4550)](https://nips.nostr.com/72) — attach-by-`a`-tag pattern; approval/moderator machinery (the part we defer) — HIGH
- [NIP-52 Calendar Events (kind 31922/31923)](https://nips.nostr.com/52) — `start`/`end` time tags, location + geohash, time-bound geo events — HIGH
- [NIP-52 spec source](https://github.com/nostr-protocol/nips/blob/master/52.md) — ISO 8601 start<end semantics — HIGH
- [Glympse FAQ — stop sharing](https://app.glympse.com/faq/how-can-i-stop-sharing-my-location-in-the-glympse-app/) — duration limits, auto-expire, manual stop, 48h post-expiry visibility — HIGH
- [iNaturalist — geoprivacy](https://help.inaturalist.org/en/support/solutions/articles/151000169938-what-is-geoprivacy-what-does-it-mean-for-an-observation-to-be-obscured-) — location obscuring model — HIGH
- [iNaturalist — collection project observation requirements](https://help.inaturalist.org/en/support/solutions/articles/151000176699-collection-project-observation-requirements-settings) — date/time-range requirements, validate-don't-reject framing — HIGH
- [AllTrails — trail submission/approval](https://support.alltrails.com/hc/en-us/articles/360053460631-How-long-does-it-take-to-approve-a-submitted-trail) — human moderation latency (days–months) we avoid via schema — HIGH
- [Bitchat geohash channel system](https://deepwiki.com/permissionlesstech/bitchat/6.1-geohash-channel-system) / [Nymchat](https://nymchat.app/) — Nostr ephemeral + geohash proximity prior art for beacons — MEDIUM
- Earthly SPEC.md (existing 37515/37517/37518/37519 + two-lane context + `c`/`a` + geometryConstraints/validationMode) — HIGH (canonical)
- Earthly .planning/PROJECT.md (v1.2 entity model, scope decisions, deferrals, open phase-research questions) — HIGH (canonical)

---
*Feature research for: v1.2 Geo Entity Model Split — role-specific geo entities*
*Researched: 2026-06-23*
