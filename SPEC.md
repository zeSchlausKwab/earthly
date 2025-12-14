Nostr GeoJSON Event Specification

Goal – Define a minimal, interoperable way to publish, catalogue and consume GeoJSON datasets over Nostr relays, together with collection/index events that reference them.

⸻

1 GeoJSON Data Event (kind 31991)

Field Purpose
kind 31991 identifies the event as a GeoJSON dataset.
content JSON.stringify(...) of a valid RFC 7946 FeatureCollection (may include extra fields). Stored verbatim – no base64.
tags Metadata and discovery (see below).

1.1 Mandatory Tags

Tag Example Notes
d ["d", "a9d5ea20-2e3f-4b67-93e9-7c60a9f9f4f4"] Random UUID – new unique identifier generated for each dataset event.
bbox ["bbox", "16.1,48.1,16.7,48.4"] West-South-East-North (WGS-84) comma-separated.

1.2 Recommended Tags

Tag Example Purpose
g ["g", "u2yh7"] Geohash (5–7 chars) of dataset centroid for fast proximity search.
crs ["crs", "EPSG:4326"] Coordinate reference system of geometry. Default is EPSG:4326.
checksum ["checksum", "9b06e56ee3…"] SHA-256 of content for integrity.
size ["size", "142359"] Uncompressed byte length of content.
v ["v", "2"] Semantic version or monotonically increasing integer for this dataset.
r ["r", "wss://geo.relay.org"] Relay where future updates will be published.
t ["t", "parks"] Hashtags / thematic categories. Multiple allowed.
collection ["collection", "30406:npub1pubkey…:city_parks_2025"] (Optional) Back-link to a parent collection event.

1.3 Optional Tags

Free-form tags permitted for domain-specific metadata, e.g. srid, license, source, lang, map_style, etc.

1.4 Example Data Event

{
"id": "…",
"pubkey": "npub1pubkeyexample…", // publisher's **public** key (never nsec!)
"kind": 31991,
"content": "{\"type\":\"FeatureCollection\",\"name\":\"Vienna Trailheads 2025\",…}",
"tags": [
["d","a9d5ea20-2e3f-4b67-93e9-7c60a9f9f4f4"],
["bbox","16.1,48.1,16.7,48.4"],
["g","u2yh7"],
["crs","EPSG:4326"],
["checksum","9b06e56ee3…"],
["t","trails"],
["v","1"],
["r","wss://geo.relay.org"]
]
}

1.5 External Geometry Blobs

Large FeatureCollections can exceed typical relay payload limits (~4 MB). Publishers may host the heavy GeoJSON in object storage (HTTPS, IPFS, Arweave, etc.) and reference it from a lightweight stub event using blob tags:

Tag format: ["blob","<scope>","<url>","sha256=<hex>","size=<bytes>","mime=<type>"]

• scope = "collection" to indicate the entire FeatureCollection lives at the URL.  
• scope = "feature:<feature-id>" to indicate a single feature with the given id must be fetched remotely.  
• url points to the JSON blob (MUST be HTTPS/IPFS/...)   
• sha256 / size / mime parameters are optional but recommended. Omit the key=value pair if unknown.

Clients SHOULD keep bbox/g/t metadata inside the stub event for discovery, then lazily fetch the blob when needed. Example tags:

["blob","collection","https://example.org/Russia_regions.geojson","size=7349314","mime=application/geo+json"]  
["blob","feature:canada_provinces_blob","https://example.org/canada_provinces.geojson","sha256=21ab…","size=2810040"]

When using feature scoped blobs, include a placeholder feature in the stub event with the matching id so clients know how to substitute the fetched geometry.

Hybrid datasets are fully supported: keep lightweight inline features (points, centroids, simplified boundaries) inside the event content and attach blob tags for heavyweight members. Clients SHOULD merge the two sources – inline features stay as-is, while downloaded features are appended. Placeholders that are meant to be replaced SHOULD either set geometry to null or use extremely simplified geometry so visual artefacts are avoided until the blob finishes loading.

Scope behaviors:
• collection – the remote FeatureCollection represents additional members for this dataset. Inline features inside the stub MAY remain (e.g. previews), but clients typically prefer the fetched geometry for editing/rendering.  
• feature:<id> – the referenced blob replaces one logical feature. The stub MUST include a placeholder feature whose Feature.id matches <id> (geometry may be null). Once fetched, clients remove the placeholder and insert every feature contained in the blob payload. This allows one placeholder to expand into many fully detailed features.

Example content with a mixture of inline geometries and a feature placeholder:

```json
{
  "type": "FeatureCollection",
  "name": "Canada provinces",
  "features": [
    {
      "type": "Feature",
      "id": "canada_provinces_blob",
      "geometry": null,
      "properties": {
        "name": "Full-resolution provinces",
        "externalPlaceholder": true
      }
    },
    {
      "type": "Feature",
      "id": "overview-centroid",
      "geometry": {
        "type": "Point",
        "coordinates": [-95.358, 60.108]
      },
      "properties": {
        "name": "Dataset centroid preview"
      }
    }
  ]
}
```

Tags for this event would include `["blob","feature:canada_provinces_blob","https://example.org/canada.geojson","size=2800000","mime=application/geo+json"]` to signal where the real polygon geometry is stored.

⸻

2 GeoJSON Collection Event (kind 30406)

A lightweight catalogue pointing to multiple GeoJSON datasets.

Field Purpose
kind 30406 identifies a collection.
content JSON with human-readable metadata: { name, description, picture?, ownerPk?, license?, tags? }.
tags One a tag per dataset plus structural metadata.

2.1 Tags

Tag Example Notes
d ["d", "city_parks_2025"] Random UUID for this collection event.
a ["a", "31991:npub1pubkey…:a9d5ea20…"] Coordinate of a GeoJSON Data Event using publisher’s npub. Multiple.
bbox Combined extent of all members (optional).
g ["g", "u2yh7"] Geohash of collection centroid.
t Hashtags categorising the collection.
r Recommended relay.

2.2 Example Collection Event

{
"id": "…",
"pubkey": "npub1maintainer…",
"kind": 30406,
"content": "{\"name\":\"City Parks Dataset\",\"description\":\"Boundaries and amenities for Vienna parks\",\"picture\":\"https://…/parks.png\",\"license\":\"CC-BY-4.0\"}",
"tags": [
["d","city_parks_2025"],
["bbox","16.1,48.1,16.7,48.4"],
["g","u2yh7"],
["a","31991:npub1pubkey…:a9d5ea20…"],
["a","31991:npub1otherpubkey…:bb17c530…"],
["t","parks"]
]
}

⸻

3 Encrypted / Extended GeoJSON (kind 30078)

For private datasets or large binary attachments:
• Publish a kind 30078 event with the same d tag as the plaintext event.
• Encrypt content to the intended readers.
• Tags SHOULD mirror those of the plaintext stub (except sensitive data).

⸻

4 Auxiliary Events

Kind Purpose
10000 Ban / mute list (e.g. malicious datasets).
30000 Role lists (admins, editors, viewers).
10002 Outbox relay list for the geo app.

⸻

5 Versioning & Updates 1. Publish a new event (new random d) whenever the GeoJSON changes. 2. Use the v tag to communicate a logical version sequence within a dataset lineage. 3. Reference predecessors via ["p", "<old-event-id>"] if history is desirable.

⸻

6 Integrity & Validation Guidelines 1. Clients must verify the checksum tag matches SHA-256(content). 2. Reject events whose content fails RFC 7946 validation. 3. Use geohash and bounding-box tags to pre-filter by location. 4. Large payloads MAY be compressed (e.g. gzip) and indicated by an encoding tag.

⸻

7 Interoperability Notes
• Follows NIP-89 naming conventions where possible.
• Uses only standard Nostr tag primitives – easy to extend.
• Collection coordinates in the form <kind>:<pubkey>:<d> match NIP-51 list style.

⸻

8 Open Questions / TODO
• Should we reserve a separate kind for single Feature objects?
• Add optional time tag for temporal datasets?
• Handling tiled GeoJSON (e.g. RFC-8462 GeoJSON seq)?

Feedback welcome!
