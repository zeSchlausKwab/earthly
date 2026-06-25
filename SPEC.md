# Earthly Nostr Event Specification (v2)

**Status:** v2 (split entity model). This document describes the entity model the code *became* in the v1.2 milestone. It is a **clean break** from v1: the overloaded kind-37518 "context" is gone, replaced by role-specific entities, each its own first-class kind. v1 of this spec remains in git history as the archive — there is no migration and no back-compat rendering. Legacy events are recognized and silently skipped (see §8).

**Goal** — Define a minimal, interoperable way to publish, catalogue and consume GeoJSON datasets over Nostr relays, together with the role-specific entities (Group, Story, Live Beacon, Temporal Sighting) that curate, narrate, and time-bound them.

**Kind block (v1.2, final assignments):**

| Kind | Entity | Replaceable | Status |
|------|--------|-------------|--------|
| 37515 | GeoJSON Data Event (Dataset) | parameterized | unchanged from v1 |
| 37516 | GeoJSON Collection | parameterized | removed from active model (see §1.6) |
| 37517 | Geo Comment | parameterized | unchanged; NIP-22 K/k widening planned Phase 13 |
| 37518 | Group / Topic (**SLIMMED**) | parameterized | re-scoped; legacy "context" shape is clean-broken |
| 37519 | Geo Edit Proposal | parameterized | unchanged from v1 |
| 37520 | Story / Article | parameterized | **NEW** (NIP-23-style long-form geo narrative) |
| 37521 | Live Beacon | parameterized | **NEW** (replaceable presence + NIP-40 expiration) |
| 37522 | Temporal Sighting | parameterized | **NEW** (NIP-52 time-bounded observation + NIP-40 expiry) |
| 34444 | Map Layer Set Announcement | parameterized | server-signed; unchanged |

The split block is deliberately contiguous — **37520 Story · 37521 Live Beacon · 37522 Temporal Sighting** — and is the authoritative source for `src/lib/nostr/kinds.ts:9-30`.

Every new-model event (37518 slimmed, 37520, 37521, 37522) carries the in-content `modelVersion` discriminator and routes its tags through the one shared `src/lib/nostr/tags.ts` seam. §7–§10 document the cross-cutting contracts (tag vocabulary, `modelVersion`, schema governance dialect, NIP-40 expiry) that all of these kinds share.

---

## 1 GeoJSON Data Event (kind 37515)

Unchanged semantics from v1. The Dataset is the substrate every other entity references.

| Field | Purpose |
|-------|---------|
| kind | 37515 identifies the event as a GeoJSON dataset. |
| content | `JSON.stringify(...)` of a valid RFC 7946 FeatureCollection (may include extra fields). Stored verbatim — no base64. |
| tags | Metadata and discovery (see below). |

Kind constant: `src/lib/nostr/kinds.ts:9` (`GEO_EVENT_KIND = 37515`).

### 1.1 Mandatory Tags

| Tag | Example | Notes |
|-----|---------|-------|
| d | `["d", "87a12b72"]` | Compact random identifier (base32 lowercase, default length 8). Stable per lineage for updates. |
| bbox | `["bbox", "16.1,48.1,16.7,48.4"]` | West-South-East-North (WGS-84) comma-separated. Read/written via `src/lib/nostr/tags.ts:32` (`getBbox`) / `:80` (`setBbox`). |

### 1.2 Recommended Tags

| Tag | Example | Purpose |
|-----|---------|---------|
| g | `["g", "u2yh7"]` | Geohash (5–7 chars) of dataset centroid for fast proximity search. `getGeohash` / `setGeohash` in `tags.ts:43` / `:89`. |
| crs | `["crs", "EPSG:4326"]` | Coordinate reference system. Default EPSG:4326. |
| checksum | `["checksum", "9b06e56ee3…"]` | SHA-256 of content for integrity. |
| size | `["size", "142359"]` | Uncompressed byte length of content. |
| v | `["v", "2"]` | Semantic version or monotonically increasing integer for this dataset. |
| r | `["r", "wss://geo.relay.org"]` | Relay where future updates will be published. |
| t | `["t", "parks"]` | Freeform thematic hashtags (see §7 for the `t` vs `L`/`l` boundary). Multiple allowed. |
| collection | `["collection", "37516:npub1…:city_parks_2025"]` | (Optional) Back-link to a parent collection event (legacy; see §1.6). |
| c | `["c", "37518:npub1…:hiking_trails"]` | (Optional) Attach dataset to a Group (§3). Multiple allowed. `getContextRefs`/`setContextRefs` in `tags.ts:57`/`:117`. |

### 1.3 Optional Tags

Free-form tags permitted for domain-specific metadata, e.g. `srid`, `license`, `source`, `lang`, `map_style`, etc.

### 1.4 Example Data Event

```json
{
  "id": "…",
  "pubkey": "npub1pubkeyexample…",
  "kind": 37515,
  "content": "{\"type\":\"FeatureCollection\",\"name\":\"Vienna Trailheads 2025\",…}",
  "tags": [
    ["d","87a12b72"],
    ["bbox","16.1,48.1,16.7,48.4"],
    ["g","u2yh7"],
    ["crs","EPSG:4326"],
    ["checksum","9b06e56ee3…"],
    ["t","trails"],
    ["v","1"],
    ["r","wss://geo.relay.org"]
  ]
}
```

> Note: the Dataset is **not** a new-model entity in the §8 sense — it predates the `modelVersion` discriminator and carries no `modelVersion`. It is referenced by the new entities via `c`/`a` coordinates, not gated by the discriminator.

### 1.5 External Geometry Blobs

Large FeatureCollections can exceed typical relay payload limits (~4 MB). Publishers may host the heavy GeoJSON in object storage (HTTPS, IPFS, Arweave, etc.) and reference it from a lightweight stub event using `blob` tags:

Tag format: `["blob","<scope>","<url>","sha256=<hex>","size=<bytes>","mime=<type>"]`

- `scope = "collection"` — the entire FeatureCollection lives at the URL.
- `scope = "feature:<feature-id>"` — a single feature with the given id must be fetched remotely.
- `url` points to the JSON blob (MUST be HTTPS/IPFS/…).
- `sha256` / `size` / `mime` parameters are optional but recommended.

Clients SHOULD keep `bbox`/`g`/`t` metadata inside the stub event for discovery, then lazily fetch the blob when needed. When using feature-scoped blobs, include a placeholder feature in the stub event with the matching id so clients know how to substitute the fetched geometry.

Hybrid datasets are fully supported: keep lightweight inline features (points, centroids, simplified boundaries) inside the event content and attach `blob` tags for heavyweight members. Clients SHOULD merge the two sources — inline features stay as-is, downloaded features are appended. Placeholders meant to be replaced SHOULD set geometry to `null` or use extremely simplified geometry so visual artefacts are avoided until the blob finishes loading.

Scope behaviors:
- `collection` — the remote FeatureCollection represents additional members for this dataset. Inline features inside the stub MAY remain (e.g. previews), but clients typically prefer the fetched geometry for editing/rendering.
- `feature:<id>` — the referenced blob replaces one logical feature. The stub MUST include a placeholder feature whose `Feature.id` matches `<id>` (geometry may be `null`). Once fetched, clients remove the placeholder and insert every feature contained in the blob payload.

```json
{
  "type": "FeatureCollection",
  "name": "Canada provinces",
  "features": [
    { "type": "Feature", "id": "canada_provinces_blob", "geometry": null,
      "properties": { "name": "Full-resolution provinces", "externalPlaceholder": true } },
    { "type": "Feature", "id": "overview-centroid",
      "geometry": { "type": "Point", "coordinates": [-95.358, 60.108] },
      "properties": { "name": "Dataset centroid preview" } }
  ]
}
```

Tags for this event would include `["blob","feature:canada_provinces_blob","https://example.org/canada.geojson","size=2800000","mime=application/geo+json"]`.

### 1.6 GeoJSON Collection Event (kind 37516) — removed from the active model

Collections are superseded by Groups (§3), which carry Markdown narrative, pin fixed geo references, and gate foreign attachments. Clients in the current app model SHOULD NOT surface kind 37516 as a first-class entity. The `collection` back-link tag in §1.2 is retained only for legacy datasets.

---

## 2 Geo Comment (kind 37517)

Comments allow users to discuss datasets and the other entities, optionally attaching GeoJSON annotations. Comments follow NIP-22 threading semantics for replies. Unchanged from v1 except as noted.

> **Phase 13 note (K/k widening):** the NIP-22 root/parent scope tags (`K`/`k`) currently enumerate Dataset/Collection/Comment. They will be widened in Phase 13 so a comment can root on any split entity (Group 37518, Story 37520, Live Beacon 37521, Temporal Sighting 37522). The widening is additive — existing 37515/37517 threads are unaffected.

Kind constant: `src/lib/nostr/kinds.ts:11` (`GEO_COMMENT_KIND = 37517`).

### 2.1 Event Structure

| Field | Purpose |
|-------|---------|
| kind | 37517 identifies a geo comment. |
| content | JSON `{ "text": "...", "geojson": {...} }`. The `geojson` field is optional. |
| tags | NIP-22 threading tags plus geo-specific tags. |

### 2.2 Threading Tags (NIP-22)

| Tag | Purpose |
|-----|---------|
| d | Unique identifier for addressability. |
| K | Root scope kind (e.g. "37515" for datasets). **Widened Phase 13** to include 37518/37520/37521/37522. |
| k | Parent item kind (same as K for top-level comments, "37517" for replies). |
| A | Root scope address: `<kind>:<pubkey>:<d-tag>`. |
| a | Parent address (same as A for top-level, or the parent comment's address). |
| E | Root event ID (if referencing by ID instead of address). |
| e | Parent event ID. |
| P | Root event author pubkey. |
| p | Parent event author pubkey. |

### 2.3 Geo-specific Tags

| Tag | Example | Purpose |
|-----|---------|---------|
| bbox | `["bbox", "16.1,48.1,16.7,48.4"]` | Bounding box of attached GeoJSON (if present). |
| g | `["g", "u2yh7"]` | Geohash of comment's GeoJSON centroid. |

### 2.4 Inline Geometry References

Comments may reference datasets or specific features inline using NIP-21 URIs: `nostr:naddr1...` for a dataset, `nostr:naddr1...#featureId` for a specific feature within a dataset. Clients SHOULD render these as interactive elements (show/hide on map, zoom-to-bounds).

### 2.5 Example Reply

```json
{
  "kind": 37517,
  "content": "{\"text\":\"I agree, here's my suggested correction.\"}",
  "tags": [
    ["d", "comment-uuid-2"],
    ["A", "37515:npub1pubkey...:dataset-uuid"],
    ["K", "37515"],
    ["a", "37517:npub1commenter...:comment-uuid-1"],
    ["k", "37517"],
    ["e", "parent-comment-event-id", "wss://relay.example"],
    ["P", "npub1pubkey..."],
    ["p", "npub1commenter..."]
  ]
}
```

---

## 3 Group / Topic (kind 37518, SLIMMED)

**Clean break from v1.** The v1 kind-37518 "Map Context" was an overloaded discriminated union — it carried taxonomy, schema validation, two reference directions, and a foreign-attachment policy in one shape. v2 re-scopes 37518 to a **Group**: a curated topic that pins a set of geo references and (optionally) governs what foreign content may attach. The validation/taxonomy/two-lane machinery is decomposed across the shared seams (§7 taxonomy, §9 schema governance) instead of living inside one content blob.

Kind constant: `src/lib/nostr/kinds.ts:15` (`MAP_CONTEXT_KIND = 37518`).

| Field | Purpose |
|-------|---------|
| kind | 37518 identifies a Group. |
| content | JSON carrying the `modelVersion` discriminator (§8) + `name`, optional `description` (Markdown), and the `governance` ladder (see below). |
| tags | Addressing (`d`), discovery (`bbox`/`g`/`t`/`L`/`l`), the curated pinned-`a` lane, and the foreign `c`-attach lane. |

### 3.1 modelVersion gate

A 37518 event is a **new-model Group** only when its content declares the current `modelVersion` (`src/lib/nostr/modelVersion.ts:19,25`). A 37518 event **without** the discriminator (or with an unrecognized value, or with unparseable content) is a **legacy "context"** — recognized and silently dropped per §8. There is no in-app migration; legacy 37518 is treated as if it no longer exists.

### 3.2 governance ladder (placeholder — defined Phase 9)

The slimmed Group reserves a `governance` field whose enum is `open | schema | closed`:

- `open` — any foreign `c`-attach is surfaced.
- `schema` — foreign attachments are validated against the Group's schema before surfacing (the validate-on-fetch pipeline runs off-thread via §9; wired in Phase 9).
- `closed` — only the curated pinned-`a` lane is surfaced; foreign `c`-attachments are ignored.

Phase 8 reserves the field name so the §8 discriminator can key off the slimmed shape; **Phase 9 defines the enum semantics, the NO-MOD MINIMUM, and the schema-authoring UI.**

### 3.3 Two-lane references

| Lane | Tag | Meaning |
|------|-----|---------|
| Curated (pinned) | `a` | `["a", "37515:<pubkey>:<d>"]` — datasets/entities the Group author pins. Mirrored from inline `nostr:naddr…` mentions in the Markdown body. `getReferencedAddresses`/`setReferencedAddresses` in `tags.ts:66`/`:125`. |
| Foreign (attach) | `c` | `["c", "37518:<pubkey>:<d>"]` — datasets or child Groups that attach themselves to this Group. Surfaced only per the `governance` ladder. `getContextRefs`/`setContextRefs` in `tags.ts:57`/`:117`. |

The `a` lane is author-controlled; the `c` lane is publisher-controlled and gated by `governance`. This is the two-lane model that replaces the v1 `allowForeignAttachments` boolean.

---

## 4 Story / Article (kind 37520)

A long-form geo narrative — a NIP-23-style article bound to map geometry. The Story is the "blog post about a place" entity: Markdown body, NIP-23 metadata, and inline references to the datasets/features it discusses.

Kind constant: `src/lib/nostr/kinds.ts:24` (`ARTICLE_KIND = 37520`). Scaffold: `src/lib/nostr/article/{helpers,cast,factory,index}.ts`.

| Field | Purpose |
|-------|---------|
| kind | 37520 identifies a Story / Article. |
| content | JSON carrying `modelVersion` (§8) + NIP-23 metadata (`title`, `summary`, `image`, `publishedAt`) and the Markdown body. |
| tags | `d` (lineage), `bbox`/`g`/`t`/`L`/`l` (discovery), and `a` for the inline-naddr mirror. |

### 4.1 Inline naddr → `a` mirror (Phase 10)

Inline `nostr:naddr…` mentions in the Markdown body SHOULD be mirrored into queryable `a` tags (`<kind>:<pubkey>:<d>`), exactly as the Group curated lane does (§3.3). This lets relays answer "which Stories reference this Dataset?" without parsing Markdown. **The authoring UI that performs the mirror is Phase 10**; Phase 8 ships the Factory+Cast scaffold and the shared `a` seam.

### 4.2 Guard

`isArticle(event)` returns `true` only for `kind === 37520` AND a `d` tag AND `hasCurrentModelVersion(event)`. A legacy or malformed event returns `false` without throwing.

---

## 5 Live Beacon (kind 37521)

A replaceable presence/position marker that expires. The Beacon is the "I am here, for now" entity: a parameterized-replaceable event whose freshness is bounded by a NIP-40 `expiration` tag.

Kind constant: `src/lib/nostr/kinds.ts:27` (`LIVE_BEACON_KIND = 37521`). Scaffold: `src/lib/nostr/live-beacon/{helpers,cast,factory,index}.ts`.

| Field | Purpose |
|-------|---------|
| kind | 37521 identifies a Live Beacon. |
| content | JSON carrying `modelVersion` (§8) + position/status payload. |
| tags | `d` (lineage), `bbox`/`g` (position), and `expiration` (NIP-40, §10). |

Because 37521 is parameterized-replaceable, a publisher refreshes their Beacon by re-publishing with the same `d` — the relay keeps only the latest. The `expiration` tag bounds how long a Beacon stays "live" even if no replacement arrives; clients always filter expired Beacons on read (§10). The cast exposes `expiresAt` via `getExpirationTimestamp`.

> **Phase 12 note:** the final Beacon lifecycle (replaceable + NIP-40 vs. ephemeral) is confirmed in Phase 12. Phase 8 ships the replaceable + NIP-40 representation and the scaffold.

---

## 6 Temporal Sighting (kind 37522)

A time-bounded observation — "X was seen here, between these times". The Sighting is the entity for ephemeral, time-stamped facts (an animal sighting, a road closure window, a market that runs Saturdays). It carries NIP-52 calendar-style `start`/`end` and a NIP-40 `expiration`.

Kind constant: `src/lib/nostr/kinds.ts:30` (`TEMPORAL_SIGHTING_KIND = 37522`). Scaffold: `src/lib/nostr/temporal-sighting/{helpers,cast,factory,index}.ts`.

| Field | Purpose |
|-------|---------|
| kind | 37522 identifies a Temporal Sighting. |
| content | JSON carrying `modelVersion` (§8) + the observation payload + NIP-52 `start` / optional `end`. |
| tags | `d` (lineage), `bbox`/`g` (location), and `expiration` (NIP-40, §10). |

> **D-02 representation note:** the kind **number 37522 is assigned and reserved now**, and v2 documents the Sighting as the assigned-and-recommended **dedicated kind**. Phase 11 confirms the final *representation* (dedicated kind vs. a 37515 dataset with a temporal property). The number is reserved regardless, so the Foundation seams (`tags.ts`, the `modelVersion` discriminator) can reference it today.

---

## 7 Tag Vocabulary — the three-way `L`/`l` · `t` · `c` split

v2 makes the discovery/attachment axes **disjoint** — each lane has one job and a value must not be double-encoded across lanes. All reads/writes route through the single shared seam `src/lib/nostr/tags.ts` so no kind drifts.

| Tag | Lane | Role | Disjointness |
|-----|------|------|--------------|
| `bbox` | spatial | Bounding box `[w,s,e,n]`. | — |
| `g` | spatial | Geohash (precision 5–7) of centroid. | — |
| `L` / `l` | **controlled vocabulary** | NIP-32 labels: enforceable, queryable categories. | — |
| `t` | **freeform discovery** | User hashtags. Open set, never enforced. | A value governed by an `l` label MUST NOT also appear as a `t`. |
| `c` | **entity attach** | Coordinate (`<kind>:<pubkey>:<d>`) attaching one entity to a Group. | — |
| `a` | curated reference | Coordinate pin (author-controlled, mirrored from inline naddr). | — |

**The three-way split is the heart of v2's taxonomy.** `L`/`l` (controlled, enforceable) · `t` (freeform, discovery) · `c` (entity-backed attach) are **disjoint axes** — they never overlap. This replaces v1's `t`-tag carrying both freeform hashtags and pseudo-taxonomy.

### 7.1 NIP-32 `L`/`l` controlled labels

Controlled labels are emitted as a paired set — exactly one `["L", "earthly"]` namespace marker plus one `["l", <value>, "earthly"]` per value (`setLabels` in `tags.ts:167`; `getLabels` in `tags.ts:188`). An `l` is never published without its matching `L`.

- **Namespace = flat `earthly`** (`EARTHLY_LABEL_NAMESPACE`, `tags.ts:137`). This is a **deliberate tradeoff** (D-06): a flat `earthly` namespace is simpler than a reverse-DNS scheme (`org.earthly.category`) at the cost of cross-app collision-resistance. Reverse-DNS namespacing was considered and explicitly rejected for v1.2 — the owner accepts the lower collision-resistance for the simpler scheme. Revisit only if a second controlled axis is introduced.

- **Starter vocabulary** (`FEATURE_CATEGORY_VOCAB`, `tags.ts:140`, axis = feature category, D-07):
  `natural` · `infrastructure` · `amenity` · `route` · `boundary`.
  A schema-Group (§3.2 `governance: schema`) can later enforce that attachments carry an allowed `l` value from this set. The vocabulary is intentionally small and concrete (enough to test the enforce path in Phase 9), not a guessed full taxonomy.

### 7.2 `t` / `l` disjointness enforcement

The disjointness rule is enforced at write time, not merely documented: `setLabels` **throws** if a requested label value already exists as a freeform `t` hashtag (`tags.ts:167-185`), and `setHashtags` **strips** any value already governed by an `l` label (`tags.ts:110-114`). The two lanes can never overlap — `L`/`l` = controlled/enforceable; `t` = freeform discovery; `c` = entity-backed attach.

---

## 8 modelVersion Discriminator + Clean Break

Every **new-model** event (Group 37518 slimmed, Story 37520, Live Beacon 37521, Temporal Sighting 37522) carries an in-content `modelVersion` string. It is the clean-break discriminator that lets the client recognize and silently skip legacy events without crashing.

- **The literal:** `modelVersion === "earthly/2"` (`MODEL_VERSION`, `src/lib/nostr/modelVersion.ts:19`). Every new-kind `create()` writes it into content and re-asserts it last, so a caller can never override the discriminator.

- **The gate (`hasCurrentModelVersion`, `modelVersion.ts:25`):** returns `true` only when `event.content` parses to JSON whose `modelVersion` equals the current `MODEL_VERSION`. **It never throws** — a parse failure, an absent `modelVersion`, or a mismatched value all return `false`. The defensive `JSON.parse` discipline guarantees one bad event never crashes a list `filter`/`map`.

- **Clean break (D-03 / D-04):** an event whose `modelVersion` is **absent or unrecognized** is classified **legacy / inert** and **never enters the render set** — no chip, no placeholder, no user-facing noise. Legacy kind-37518 "context" events (which predate the discriminator) therefore "just disappear" from the UX's point of view. This is a **clean break**: there is no migration and no back-compat rendering. The git history of this spec is the only archive of v1.

Each per-kind guard (`isArticle` / `isLiveBeacon` / `isTemporalSighting`, and the Phase 9 `isGroup`) gates on `kind` + a `d` tag + `hasCurrentModelVersion` — so legacy, foreign, or malformed events fail the guard and are excluded from every render set.

---

## 9 Schema Governance Dialect

A Group's optional validation schema (§3.2 `governance: schema`) is **stranger-authored executable input** fetched from a relay — it is the one genuinely new trust boundary v2 introduces. It is validated off the main thread by a hardened worker (`src/lib/validation/schema.worker.ts`), never on the UI thread.

The governance dialect is deliberately restricted:

- **draft-2020-12 pinned.** One module-scope `Ajv2020` instance (`ajv/dist/2020`), configured `allErrors:true, strict:false, validateSchema:true` (`schema.worker.ts:67`).
- **No `$data`.** Ajv's `$data` mode is OFF (the default — never enabled). A `{ "$data": "…" }` keyword value is therefore an **invalid** schema that fails closed rather than silently enabling cross-field validation.
- **No external `$ref`.** Any `$ref` / `$dynamicRef` is **rejected before compile** (`schema.worker.ts:103`) — external resolution is never attempted.
- **Size / depth / keyword caps before compile** (`schema.worker.ts:39-43`): `MAX_SCHEMA_BYTES = 64 KB`, `MAX_DEPTH = 12`, `MAX_KEYWORDS = 4096`. An oversized or deeply-nested schema is rejected before `ajv.compile` ever runs (OOM cap).
- **Fail-closed.** Every throw (gate rejection, compile error, ReDoS overrun) is caught and turned into `{ ok: false }` — the engine never fails open. The off-thread hard timeout-kill is the host's job (the worker client's wall-clock watchdog terminates an overrunning worker).
- **Compile-once per `schema-hash`.** Validators are cached keyed by a stable content hash of the schema, so a repeated schema never recompiles.

A Group MAY carry a `schema-hash` tag (`["schema-hash", "sha256:…"]`) as an integrity hint. **The Group validate-on-fetch wiring that feeds real schemas through this worker is Phase 9**; Phase 8 ships the hardened worker + typed interface only.

---

## 10 Expiration (NIP-40)

NIP-40 `expiration` is **advisory, not enforced by relays.** A non-compliant relay can keep serving an expired Live Beacon (§5) or Temporal Sighting (§6) forever. Therefore **the client always filters expired events on read**, against its own clock, regardless of relay GC (SPEC-05).

- `isExpired(event, now)` (`src/lib/nostr/expiry.ts:22`) returns `true` when the event carries a NIP-40 `expiration` strictly in the past relative to `now` (epoch seconds, UTC). No `expiration` tag ⇒ never expires.
- `dropExpired(events, now)` (`src/lib/nostr/expiry.ts:28`) keeps only the non-expired events.
- The `now` argument is explicit (epoch seconds, UTC) so the predicate is deterministic against a fixed clock; read paths pass the current time. The NIP-40 timestamp is read via applesauce's `getExpirationTimestamp`, so the parsing stays aligned with upstream semantics while comparing against the injected clock.

Live Beacon (§5) and Temporal Sighting (§6) are the expiry-bearing kinds; both casts expose `expiresAt`. Every read path that surfaces them MUST filter through `dropExpired` so an expired event never reaches the map. Compare UTC epoch seconds only.

---

## 11 Geo Edit Proposal Event (kind 37519)

Edit proposals allow users to suggest changes to another user's GeoJSON dataset. The proposal contains the full replacement FeatureCollection — not a diff. Unchanged from v1.

Kind constant: `src/lib/nostr/kinds.ts:18` (`GEO_EDIT_PROPOSAL_KIND = 37519`).

### 11.1 Event Structure

| Field | Purpose |
|-------|---------|
| kind | 37519 identifies an edit proposal (parameterized replaceable). |
| content | `JSON.stringify(...)` of the proposed RFC 7946 FeatureCollection. Full replacement content. |
| tags | Target reference, metadata, and discovery. |

### 11.2 Tags

| Tag | Example | Purpose |
|-----|---------|---------|
| d | `["d", "pr8k2m1n"]` | Unique proposal identifier. |
| a | `["a", "37515:<owner-pubkey>:<dataset-d-tag>"]` | Address of the target dataset. |
| p | `["p", "<owner-pubkey>"]` | Dataset owner's pubkey (relay filtering + notifications). |
| base-version | `["base-version", "<event-id>"]` | Event ID of the dataset version this proposal is based on. |
| description | `["description", "Refined eastern boundary"]` | Human-readable summary. |
| bbox | `["bbox", "16.1,48.1,16.7,48.4"]` | Bounding box of proposed content. |
| g | `["g", "u2yh7"]` | Geohash of proposed content centroid. |
| t | `["t", "parks"]` | Hashtags (typically carried from target). |

### 11.3 Status Tracking

Proposal lifecycle is tracked with NIP-34 status event kinds (regular events, not replaceable). Constants: `src/lib/nostr/kinds.ts:33-36`.

| Kind | Status | Meaning |
|------|--------|---------|
| 1630 | open | Open for review (implicit default — no status event needed). |
| 1631 | applied | Owner accepted and republished the dataset with proposed content. |
| 1632 | closed | Owner rejected the proposal. |
| 1633 | draft | Proposer marked as work-in-progress. |

Status events reference the proposal via `a` tag (`37519:<proposer-pubkey>:<proposal-d-tag>`) and optionally `e` (proposal event ID). The latest status event by `created_at` determines the current state; absent any status event, the proposal is implicitly "open".

### 11.4 Accept Flow

1. Owner reviews proposal content (shown as map overlay).
2. Owner clicks "Accept".
3. Client creates a new dataset event with the proposal's FeatureCollection.
4. Client calls `publishUpdate(originalDataset)` — preserves d-tag lineage, increments version.
5. Client carries forward the target's hashtags, Group references, and relay hints.
6. Client publishes a kind 1631 (applied) status event referencing the proposal.

---

## 12 Map Layer Set Announcement (kind 34444)

Server-signed map-layer configuration (parameterized replaceable). Published by the tile/chunk server (mapnolia) to announce available PMTiles layers and their regional chunking. Unchanged from v1. Kind constant: `src/lib/nostr/kinds.ts:21` (`MAP_LAYER_SET_KIND = 34444`).

---

## 13 Encrypted / Extended GeoJSON (kind 30078)

For private datasets or large binary attachments:
- Publish a kind 30078 event with the same `d` tag as the plaintext event.
- Encrypt content to the intended readers.
- Tags SHOULD mirror those of the plaintext stub (except sensitive data).

---

## 14 Auxiliary Events

| Kind | Purpose |
|------|---------|
| 10000 | Ban / mute list (e.g. malicious datasets). |
| 30000 | Role lists (admins, editors, viewers). |
| 10002 | Outbox relay list for the geo app. |

---

## 15 Updates & Lineage

1. Kinds 37515 / 37518 / 37519 / 37520 / 37521 / 37522 are parameterized-replaceable in this app model and SHOULD reuse the same `d` tag for updates. Factory `create()` generates a `d` only when absent; `modify()` preserves the existing `d` (no lineage fork on edit).
2. Publish a new `d` only when intentionally creating a new lineage / breaking fork.
3. Reference predecessors via `["p", "<old-event-id>"]` if history is desirable.

---

## 16 Integrity & Validation Guidelines

1. Clients MUST verify the `checksum` tag matches SHA-256(content) where present.
2. Reject events whose content fails RFC 7946 validation (datasets).
3. Use geohash and bounding-box tags to pre-filter by location.
4. New-model entities (37518 slimmed / 37520 / 37521 / 37522): apply the `modelVersion` gate (§8) — drop legacy/malformed events silently, never throw in a list map.
5. Group schema validation (§9) runs off-thread, fail-closed, draft-2020-12 only, no `$data`, no external `$ref`.
6. Expiry-bearing entities (37521 / 37522): always filter `isExpired` on read (§10).

---

## 17 Interoperability Notes

- Follows NIP-89 naming conventions where possible.
- Uses only standard Nostr tag primitives — easy to extend.
- Coordinates in the form `<kind>:<pubkey>:<d>` remain the canonical attachment/reference target across `a` (curated) and `c` (attach) lanes.
- NIP-23 (Story), NIP-32 (`L`/`l` labels), NIP-40 (expiry), NIP-52 (temporal start/end) are the protocol foundations the split entities build on.

---

*Spec v2 — describes the implemented v1.2 split entity model. Foundation seams shipped Phase 8; per-kind authoring (Group/Story/Sighting/Beacon UIs, governance enum, naddr mirror) lands across Phases 9–13.*
