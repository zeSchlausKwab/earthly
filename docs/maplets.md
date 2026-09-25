# Earthly Maplets

Maplets are sandboxed Napplets that contribute GeoJSON layers to Earthly. A Maplet
owns its interface and data conversion; Earthly owns discovery, verified execution,
resource grants, rendering, and copying output into editable drafts. **My Maps
Viewer** fetches third-party geometry in the browser and shares source links.
**Live Mapper** remains available for guided imports and snapshot collections.

The authority is the living specifications linked by [napplet.run](https://napplet.run/).
The verified web-profile reference is
[NIP-5D revision `24711d9`](https://github.com/dskvr/nips/blob/24711d9c47bbdd07908bf1d52bf677d9cbc530f0/5D.md).
Identity follows the [current NAP-IDENTITY specification](https://github.com/napplet/naps/blob/master/naps/NAP-IDENTITY.md),
verified on 2026-09-13. This is a supported subset, not a complete NAP implementation
or conformance certification. The `map` domain, workspace/resize extensions,
`maplet` role, discovery tag, collection manifest, and static configuration-schema
tag below are Earthly's experimental profile.

The upstream registry checked on 2026-09-25 now separates NIP-5A manifests
(kind 35128) from the NIP-5D web projection. Earthly's executable discovery still
uses the pinned prototype profile described below; this change does not claim
full compatibility with the reorganized manifest format. The viewer uses a
bounded subset of the current draft NAP-STORAGE and NAP-RELAY interfaces.

## My Maps Viewer

Open **Maplets → My Maps Viewer → Add to map**. Paste a public Google My Maps
viewer, editor, embed, or KML export link containing a `mid`. The Maplet canonicalizes
the link, requests the KML through Earthly's browser resource grant, and converts
it inside its sandbox. No Earthly backend, CVM request, Google login, or geometry
publication is involved. This supports My Maps (`/maps/d/…`), not arbitrary Google
Maps places, routes, or saved lists.

All nonempty KML folders appear as toggleable layers. Up to twelve sources can be
displayed together, subject to the existing aggregate geometry limits. Each source
has visibility, opacity, refresh, and last-fetch status. Refresh replaces that
source's complete export; it retains the last successful geometry on failure.
The timestamp records retrieval, not when Google’s author last changed the map.
There is no background polling. The sidebar Refresh action refreshes visible
sources without destroying the viewer or its unsaved choices.

On fetch failure, a downloaded KML file can be chosen as a local preview for that
source. The file is not uploaded or persisted; saved links continue to fetch Google.
KMZ, external NetworkLinks, overlays, and 3D objects remain outside the supported
vector subset. Source notes report unsupported elements. Copy to editor uses the
existing independent-draft flow and retains source attribution.

### Saving and publishing are separate

- **Save for me** saves links and view preferences on this device. When signed in,
  it also encrypts those preferences to the active pubkey with NIP-44 and publishes
  one NIP-78 kind 30078 event with `d=earthly:maplet:my-maps-viewer:sources:v1`.
  Signers without NIP-44 and relay failures are reported; the device copy remains.
- **Restore from account** reads that exact owner address, verifies the signature,
  decrypts through the host signer, and fetches the saved visible sources. It is
  explicit on another device; opening the viewer restores the local saved copy.
  Unsaved changes must be saved before a remote restore replaces them.
- **Name & publish source** publishes a public source description under the active
  pubkey. Neither geometry nor private layer/opacity choices are included.
- **Discover sources** queries configured content/discovery relays, initially for
  100 recent announcements, expandable to 500. Search filters loaded titles,
  descriptions, tags, and hex publisher keys. Sources are fetched only after
  **Add to my map**. Discovery is refreshed explicitly and is not a global index.
- **Unpublish source** replaces the owner's announcement with a tombstone. It
  removes that recommendation from discovery; existing users retain their links.

The public format is Earthly experimental **kind 37526**, not an allocated NIP kind:

```json
{
  "kind": 37526,
  "tags": [
    ["d", "my-maps:publicMap123"],
    ["t", "maplet-source"],
    ["maplet", "my-maps-viewer"],
    ["r", "https://www.google.com/maps/d/kml?mid=publicMap123&forcekml=1"]
  ],
  "content": "{\"version\":1,\"maplet\":\"my-maps-viewer\",\"url\":\"https://www.google.com/maps/d/kml?mid=publicMap123&forcekml=1\",\"title\":\"Coastal survey\",\"description\":\"\",\"tags\":[\"coast\"],\"deleted\":false}"
}
```

The identity is `(kind, pubkey, d)`. The newest valid announcement wins; equal
timestamps use the lexicographically lowest event ID. A source publisher is a
curator, not necessarily the Google map's original author. Data changes at Google
do not require republishing the source announcement. The current NIP-78 reserves
app-data events for owner-private storage, so public discovery uses its own kind.

### Reusable host capabilities

`window.napplet.storage.getItem/setItem/removeItem/keys` expose bounded JSON storage
scoped to the verified applet identity `(dTag, aggregateHash)` and active pubkey
(or the anonymous device session). Quotas are 128 KiB per value and 256 KiB per
scope. A changed app build gets a new local namespace; account restore uses the
stable private address above. Storage itself does not imply Nostr sync.

`window.napplet.relay.query/publish/publishEncrypted` implement a bounded subset of
the [draft NAP-RELAY](https://github.com/napplet/naps/pull/2). Queries return
`{ event }[]`; signing and encryption stay in Earthly. Only this reviewed bundled
viewer receives the source-event and owner-preference grant. Downloaded Maplets
do not inherit signing or private-data access. Additional apps need explicit
host policies; the shared broker is independent of this source format.

The Maplet owns source validation, KML conversion, configuration UI, and source
announcements. The host independently validates allowed event shapes, signatures,
account ownership, size limits, and account continuity before signing/publishing.
Account changes clear the viewer and cancel pending privileged requests.
`map.onRefresh` is an Earthly extension for refreshing displayed sources.

The two bundled Maplets are admitted by the native CSP policy; downloaded code
remains blocked in Tauri. Responsive browser tests are not Android WebView tests.
Browser CORS for Google's export works for the tested map but is not a guaranteed
Google API contract.

## Run the local demo

Use an existing development session, or start the web server:

```sh
bun --hot src/index.ts
```

Open [http://localhost:3000/browse/maplets](http://localhost:3000/browse/maplets)
(or the configured `PORT`). The web server supplies the fixed source connector;
a static frontend alone cannot acquire that source. Local file imports and the
bundled example and public My Maps KML fetches do not need it. Nostr discovery/following need configured relays;
use the existing local relay workflow for development publishing.

1. Add **Live Mapper** from the Maplets tab. Its visible workspace opens empty.
2. Choose **Explore a JSON file** to select/drop a file or paste a response.
   **Try example data** explicitly loads the captured example. Anonymous users
   can preview imports and follow published collections.
3. Sign in to Earthly, open **Manage**, and create a collection. Add named groups
   if useful. Groups form one level of organization, independent of the source.
4. In **Import data**, choose the geographic candidate, name/ID properties,
   properties to retain, destination layer, and group. Preview the geometry and
   review additions, changes, removals, and diagnostics before saving.
5. Use **Layers** to show/hide groups and layers. **View on map** closes the dialog
   without destroying its iframe or in-progress import. Reopen it to continue.
   Shelf controls the whole Maplet's visibility.
6. Publish from **Manage** after reviewing the collection. Share its `naddr` with
   another account; paste it in **Follow** to receive later signed snapshots.

Readers can also use **Published collections** in the Maplets tab. The directory
loads signed collections from the configured relays, with collection/layer/group
search and publisher keys (hex or npub). Each result shows its publisher, named
layers, geometry count, and publication time. **Follow** starts Live Mapper and
opens the collection without copying an address. The same action appears on
recognized collection maps in Maps, publisher profiles, search, and map details.

The directory verifies signatures and the collection manifest, keeps the newest
valid version per author/collection address, and listens for updates. It initially
requests 100 recent events and can expand to 500 with **Load more collections**.
Search filters those loaded results; it is not a global search across every relay.
Relay failures are shown separately from an empty directory. **Maplet apps** is
the separate catalog for executable Maplet software.

Saving an import is local. Publishing is a separate explicit action. The native
file input and drop/paste gestures grant access to the chosen input; NAP-FS is not
implemented. There is no arbitrary filesystem access. Raw import input stays in
the iframe session and is cleared on account changes or runtime destruction.
The host persists normalized geometry, bounded recipes, and provenance.

## Guided imports and recipes

### Browser-only My Maps and KML

Choose **Import My Maps / KML**, paste a public Google My Maps viewer/export link,
and select **Fetch KML in browser**. The host resource grant fetches Google's
canonical `https://www.google.com/maps/d/kml?mid=…&forcekml=1` endpoint directly
from the browser. No Earthly backend, CVM call, Google credentials, or proxy is
involved. The iframe still has no ambient network access: it requests bytes via
`napplet.resource.bytes`, then parses and converts them locally.

Each nonempty KML folder is offered as a geographic candidate. For a new import
with multiple folders, **Entire map** is selected by default. **Preview entire
map** shows every layer together for inspection/copying; to save a layer with
its import recipe, choose that candidate and **Preview selected layer**. The UI
explicitly states when other layers are excluded. Saved-layer updates retain
their recipe’s layer selection rather than switching to the entire map. Polygon holes,
points, lines, multi-geometries, names, descriptions, basic colors/opacity/width,
ExtendedData, and source map/layer/URL attribution are retained. XML IDs are used
when present; absent IDs receive the importer's content-based IDs with a warning.
KML layer updates default to **Replace this complete layer**, because full exports often
lack stable IDs and changed/deleted geometry must not accumulate during updates.

**Choose KML file** and file drop provide a fully local fallback. My Maps offers
**Export to KML/KMZ** in its menu; choose uncompressed KML with actual geometry.
KMZ archives, network links, external icons, overlays, and 3D KML behavior are not
supported. Unsupported elements are reported; linked resources are never fetched.
Malformed XML, invalid coordinates, entities/document types, and oversized data
are rejected. Failed fetches or malformed input retain the previous preview.

This is a snapshot import: fetching again requires another explicit review and
does not automatically publish or update a saved layer. The request is credential
free and redirects are denied. Private maps, disabled export, CORS changes, or
Google errors lead to the file fallback. On 2026-09-25 a real Chromium request for
the user-provided map succeeded with CORS: 1,741,940 bytes, 372 placemarks, nine
nonempty folders, 38,508 positions; Earthly displayed all 372 geometries with zero
backend resource requests. This verifies this public source today, not every map.

See Google's [My Maps export instructions](https://support.google.com/mymaps/answer/3109452?hl=en)
and [KML reference](https://developers.google.com/kml/documentation/kmlreference).

### JSON and source adapters

The importer discovers supported data nested inside JSON objects/arrays: GeoJSON
FeatureCollections, Features, standalone geometries, arrays/maps of Features, and
the supported Liveuamap record formats. Paths are arrays of literal keys/indexes, not
JSONPath expressions or executable mappings. Invalid selected records produce an
error or an explicit adapter diagnostic. Other coordinate formats require another
reviewed adapter.

Liveuamap imports can mix type-6 flat latitude/longitude polygon paths with
type-14 lines containing ordered `{lat, lng}` points. Lines preserve array order
and are not closed automatically; optional point IDs do not reorder them. Each type-14 line keeps
its source record identity when coordinates change, so saved recipes can update
it without adding a duplicate. Unsupported types and malformed coordinates reject
the import with an explanation rather than silently dropping records.

The Liveuamap adapter can create a named layer per source overlay. Each layer
keeps a version-1 recipe with `path`, `adapter` (`geojson` or `liveuamap`), optional
`retainProperties`, `idProperty`, `nameProperty`, and `sourceIds`. Source-ID filters
keep replay focused on that layer when a later input contains many other overlays.
Updating a layer reapplies its saved recipe and requires another review. Missing
recipe paths or selected source records are reported.

**Update included records** merges into the selected layer. Where features carry
`sourceId`, all old geometry parts for included source records are replaced;
unrelated records remain. Without source IDs, merge uses stable feature IDs.
**Replace this complete layer** explicitly replaces the whole target layer.
Neither mode changes other layers. A preview is temporary; canceling restores the
selected collection's saved map output.

The example is a copy of the user-supplied `all.json`, checked in as
`src/features/maplets/live-mapper/liveuamap-yemen.sample.json`. Its capture time is
unknown. The adapter produces four polygonal features and six diagnosed lines. It
converts flat latitude/longitude paths to GeoJSON longitude/latitude, closes rings,
and treats separate rings as exteriors; unknown holes are not inferred. Source
styling is preserved, including zero stroke opacity, so some retained lines remain
invisible.

## Collections, publication, and following

Drafts, layer recipes, selected collection, followed addresses, and visibility
preferences are stored under `earthly:maplet-workspace:v1:<pubkey|anonymous>`.
Removing/readding Live Mapper preserves saved work, but not raw input. Switching
accounts loads that account's workspace; anonymous preferences have a separate
namespace. Owner mutations require the active owner account, including checks
after asynchronous signing. Storage failures are surfaced; an unsuccessful local
save does not replace the last saved state.

The trusted collection workspace is shared by Follow buttons and the Live Mapper
iframe. Followed snapshots continue updating while Earthly is open, including when
the iframe is closed or removed. Account switches cancel the previous account's
subscriptions and pending operations.

A collection has a stable ID, owner, name, groups `{id,name}`, and layers
`{id,name,groupId,collection,recipe?,provenance?,updatedAt}`. Only the selected local
or followed collection contributes saved output to this Maplet. Group/layer
visibility is private and is not published.

Publication reuses Earthly's `GeoDatasetFactory` and sign/publish path. Each
collection is one addressable **kind 37515** dataset, with the stable collection
ID in its `d` tag. Each publication is an atomic complete GeoJSON FeatureCollection
snapshot with an `earthly:maplet-collection` foreign member:

```js
{
  version: 1,
  id: collectionId,
  name: collectionName,
  groups: [{ id: groupId, name: groupName }],
  layers: [{
    id: layerId, name: layerName, groupId: groupIdOrNull,
    featureIds: [[publishedFeatureId, originalFeatureId]],
    provenance: { /* bounded acquisition/adapter metadata */ },
    updatedAt: unixMilliseconds,
  }],
}
```

Top-level features contain normalized geometry and properties. Published IDs are
namespaced by layer with a hash of the original ID, avoiding cross-layer collisions;
the manifest restores original IDs and organization. Attribution/provenance is
retained. Recipes and raw responses are excluded from public content. Acquisition
provenance can include adapter/version, input hash, import time, source URL,
unknown source capture time, and sample status.

Following accepts an exact `naddr` or `37515:<pubkey>:<collectionId>`. Reads use
configured content relays and an exact author/kind/`d` filter. Every candidate is
checked for a valid signature, exact address, manifest consistency, and geometry
limits. Invalid timestamps and events more than five minutes ahead of the local
clock are rejected. A valid newer snapshot replaces the previous one; equal
timestamps use Nostr's event-ID tie-break. Failed/invalid updates retain the last
valid geometry and private visibility. This is a latest-snapshot view, not a
publication-history browser.

Rendered features carry `mapletWorkspaceSource` with collection/layer/source
feature IDs, owner, dataset address, and exact event ID. Locally edited geometry
is marked `localDraft`, distinguishing it from the last published snapshot.
Copying into Earthly's editor preserves this provenance and creates independent
features with new editor IDs.

## Runtime and capability contract

### Tauri Android

The bundled Live Mapper uses the same import, collection, follow, and copy-to-editor
code in the Android app. Signing uses the native account integration and publishing
uses the durable native outbox. File selection uses the WebView file chooser;
paste uses the normal import text area. Workspaces and recipes currently remain
in WebView localStorage rather than the native event database.

Packaged Tauri CSP nonces are carried into the bundled Maplet's scripts and styles.
This allows the trusted workspace to run without weakening the application's
script policy. Third-party Maplet **apps** are disabled in Tauri: the pinned Android
WebView stack can expose native IPC to subframes, so an opaque-origin iframe is
not sufficient isolation for foreign executable code. Published collection **data**
can still be consumed by the bundled Live Mapper. Foreign app execution needs a
separate WebView without native IPC or a verified framework-level isolation fix.

The fixed source connector is web-backend-only. Native imports show a file/paste
fallback instead of requesting a relative backend URL from the packaged app.
Responsive-browser tests do not certify APK behavior. Android file selection,
native signing, process restart, and the packaged CSP path still require a device
or emulator Maplet smoke test before claiming complete Android verification.

See [Tauri CSP](https://v2.tauri.app/security/csp/) and Android's
[JavaScript bridge API](https://developer.android.com/reference/android/webkit/WebView#addJavascriptInterface(java.lang.Object,java.lang.String)).

Verified HTML runs in an iframe with `sandbox="allow-scripts"`. Earthly injects
`window.napplet` before applet code, correlates requests, binds messages to the
mounted iframe, applies a restrictive CSP, and revokes unexpected navigation.
In the web app, applets have no ambient network, relay, signer, host-DOM, or
host-storage access. The native IPC limitation above is why Tauri only permits
the bundled Live Mapper.

The UI permits one active instance per definition, up to eight Maplets. Applet UI
lives in a visible, scrollable host dialog; closing it keeps the iframe mounted.
Refresh/settings changes can restart it and discard transient input. Hiding via
Shelf affects rendering; removing the Maplet destroys its runtime and cancels
its pending capability requests/subscriptions. Saved Live Mapper workspace data
remains local, and host-owned followed collections stay subscribed while Earthly
is open.
Maplets follow Shelf order relative to each other, above ordinary saved Map data
and below editable geometry. Interleaving individual saved Maps requires a later
shared-renderer change.

### Map output, identity, and workspace

```js
await window.napplet.map.replace(featureCollection, { warnings: ['Source note'] });

const pubkey = await window.napplet.identity.getPublicKey();
const identitySubscription = window.napplet.identity.onChanged(pubkey => {
  // Empty string means signed out. Clear account-specific transient input.
});
identitySubscription.close();
```

`map.replace` atomically supplies this instance's complete output; it cannot write
another instance's layer. Earthly validates standard geometry types, finite WGS84
coordinates, closed rings, distinct stringified IDs, and bounded JSON properties.
Source errors retain previous output and mark it stale/failed. There is no viewport
context, incremental feature patching, inter-Maplet wiring, or custom map control
API. Identity reports the current account and never supplies a signer.

The experimental `map.workspace(action, payload?)` broker is granted **only to the
bundled Live Mapper**. Downloaded Maplets cannot enumerate, edit, or publish host
workspace drafts. Operations cover local collection/group/layer edits, visibility,
explicit publication, following/unfollowing, state reads, and the host `viewMap`
action. `map.onWorkspaceChanged(callback)` supplies account state, including
`renderCollection` and warnings, which Live Mapper renders through `map.replace`.
Account changes abort pending workspace requests and discard late results. There
is no arbitrary event-signing operation.

`map.resize(height)` is an experimental advisory iframe-height request, bounded
and throttled by Earthly. It does not grant host DOM access. Workspace and resize
are not presented as upstream NAP capabilities.

### Configuration

The profile implements the bounded [NAP-CONFIG](https://github.com/napplet/naps/pull/14)
model: applets declare schemas; Earthly validates values and owns settings/storage.

```js
const values = await window.napplet.config.get();
const unsubscribe = window.napplet.config.subscribe(values => { /* apply values */ });
window.napplet.config.openSettings();
unsubscribe(); // unsubscribe.close() is also supported.
```

The bridge also supports `config.schema`, `registerSchema`, and `onSchemaError`.
Static experimental `config` tags make schemas available before mounting; runtime
schema changes are validated and forwarded to host settings. The subset supports
objects, primitive fields/arrays, enums, defaults, basic numeric/string/array
bounds, and display annotations. References, regex patterns, executable validation,
and unsupported keywords are rejected. Settings are scoped to `(dTag, aggregateHash)`;
a new build does not automatically inherit old values. Secret storage is outside
this profile. Live Mapper currently declares an empty schema: import choices and
saved recipes belong to its workspace rather than generic settings fields.

### Resources and backend

```js
const blob = await window.napplet.resource.bytes(approvedSourceUrl);
const payload = JSON.parse(await blob.text());
// Convert inside the Maplet, then call map.replace.
```

The resource bridge includes `info`, `bytes`, `bytesMany`, cancellation, and managed
object URLs. This host grants the exact reviewed Live Mapper feed with JSON results
and canonical public My Maps exports with KML results. Unknown URLs are rejected
before fetching. KML bytes are inert data and parsed in the sandbox; arbitrary XML,
HTML and SVG responses are not granted. Applets cannot supply headers,
credentials, alternate hosts, or redirects. The fixed source is:

```text
https://yemen.liveuamap.com/ajax/do?act=acornice&time=1789297855&resid=53&lang=en&isUserReg=0
```

The Liveuamap connector's acquisition follows:

```text
Maplet resource.bytes(approved URL)
  → Earthly broker
  → same-origin GET /api/maplets/liveuamap-yemen
  → shared fixed-feed connector
  → Liveuamap
```

The server request avoids browser CORS restrictions. It returns complete JSON with
no readability truncation; limits include a 15-second timeout, 2 MiB response,
denied redirects, 60-second successful cache, coalescing, and brief failure backoff.
It sends no user cookies/authorization and does not bypass browser challenges.
The verified source request encountered a Cloudflare challenge, reported as a
structured `upstream_challenge` error. A failed request never silently selects the
example.

The meaning of the endpoint's fixed `time` parameter is unverified. Fetch/import
time is not source capture time and does not establish freshness. The importer
makes acquisition explicit; it does not poll arbitrary URLs or automatically
reimport a publisher's changing source. Example data is labeled as captured data.

The same service is available through ContextVM as
`get_maplet_feed({ feed: 'liveuamap-yemen' })`. The web demo's same-origin route
calls it directly and does not require a deployed CVM tool. CVM success includes
`structuredContent.result` with raw `payload`, source URL, `fetchedAt`, unknown
`capturedAt`, attribution, and cache status; failures are structured. NAP-CVM is
not injected into this profile.

## Publishing a compatible third-party release

Discovery queries signed kind `35129` events with `['t','maplet']`, choosing the
latest valid announcement per address. Adding verifies signature, file hash,
aggregate hash, required domains, and artifact bounds before execution. Discovery
is not a resource grant.

Package one self-contained `/index.html` with inline code/styles. Compute SHA-256
over its exact UTF-8 bytes, then upload those bytes to a browser-accessible Blossom
server with suitable CORS. Earthly fetches `<server-base>/<file-hash>` without
credentials and verifies the downloaded bytes. Sign a kind `35129` event with tags
shaped as follows, replacing the placeholders:

```js
[
  ['d', 'my-maplet'],
  ['title', 'My Maplet'],
  ['description', 'What the layer contributes'],
  ['t', 'maplet'],
  ['archetype', 'maplet'], // Optional experimental role.
  ['requires', 'map'],
  ['requires', 'config'], // Include only domains actually needed.
  ['requires', 'identity'], // Optional current-account identity; no signer.
  ['path', '/index.html', fileHash],
  ['x', aggregateHash, 'aggregate'],
  ['server', 'https://your-blossom-server.example'],
  ['config', JSON.stringify(configSchema)], // Experimental schema carrier.
]
```

The aggregate is SHA-256 over lexicographically sorted UTF-8 lines of
`<file-hash> <absolute-path>\n`. Here its input is exactly
`${fileHash} /index.html\n`, including the final newline. See `sha256Hex` and
`computeMapletAggregate` in `src/lib/maplets/artifact.ts`. Hash the same bytes that
you upload.

The verifier also understands supported `5129`/`15129` manifest variants; the
catalog currently queries `35129`. Additional assets, unimplemented required
domains, arbitrary external APIs, and third-party workspace grants are unsupported.
`link` is optional and injected only when a host handler exists; this UI does not
supply one, so compatible releases should not require it.

## Copying and limits

Copying uses the full stored output rather than clipped map tiles. It deep-copies
features, assigns new editor IDs, preserves source properties and workspace
provenance, and records release identity, original feature ID, copy time, and
available manifest/publisher/receipt metadata under `mapletSource`. Host rendering
IDs are removed. Copies are independent snapshots; later updates do not change the
draft. Editor publication uses Earthly's existing path.

Current bounds include:

- HTML: 2 MiB and one file. Resource results: 5 MiB at the bridge, 2 MiB at this
  connector. Runtime: 10 concurrent requests, 60 acquisitions/minute.
- Complete geometry collection: 5,000 features, 50,000 positions, closed rings,
  bounded properties, and 5 Mi serialized characters. Public snapshots also have
  a 5 MiB UTF-8 limit. The host displays at most 20 warnings.
- Import input: 5 MiB, depth 24, 300,000 traversal nodes.
- Workspace: 20 own and 20 followed collections; 32 groups and 100 layers per
  collection. Returned state, including rendered copies, is limited to 10 MiB,
  depth 24, and 600,000 nodes. Serialized local storage is capped at 12 Mi
  characters; browser quota may be smaller. Limits are checked before committing
  local saves. Recipes and provenance are bounded plain JSON.
- Configuration: 64 Ki characters, 128 schema nodes, four nested levels.

See `src/lib/maplets/` and `src/features/maplets/workspace.ts` for the enforced
contracts. Starter repository/one-line bootstrap with AI skills, documentation,
and Maplet checks remains explicitly deferred; this implementation does not create
or publish that starter.

## Focused validation

```sh
bun test src/lib/maplets src/features/maplets contextvm/tools/maplet-feed.test.ts
```

The repository AI-suite covers the integrated UI. Before browser automation,
follow `ai-suite/README.md` and inspect `bun run ai:list`; keep mutating scenarios
on loopback services and local relays.
