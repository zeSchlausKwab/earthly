# Earthly Maplets

Maplets are sandboxed Napplets that fetch and convert external data into Earthly
map geometry. The Maplet owns its interface and conversion; Earthly owns verified
execution, capability grants, rendering, and copying into editable drafts.
**GMapper** is the bundled Google My Maps viewer. The earlier Live Mapper JSON
importer and Nostr snapshot-collection interface have been retired from the catalog.
Their saved collection data remains ordinary Nostr Map data; GMapper does not
convert those collections into Google configurations.

The authority is the living specifications linked by [napplet.run](https://napplet.run/).
Earthly still uses its pinned experimental executable-discovery profile, based on
[NIP-5D revision `24711d9`](https://github.com/dskvr/nips/blob/24711d9c47bbdd07908bf1d52bf677d9cbc530f0/5D.md).
The upstream registry now separates NIP-5A manifests from the NIP-5D web projection;
this UI change does not migrate executable manifests or claim full NAP conformance.
The `map` domain and configuration announcement format below are Earthly extensions.

## The interface

There are three distinct objects:

- **Maplet:** developer-created executable code, found in **Browse → Maplets**.
- **Configuration:** a named setup for one Maplet. For GMapper, this is one Google
  My Maps link, selected layers, opacity, and layer colours.
- **On the map:** an active use of a configuration, shown under its own name in
  the Shelf. Several configurations of the same source can be displayed separately.

Open **GMapper** from the catalog. **Explore configurations** lists public
configurations published by other users; **Yours** lists your saved configurations
and drafts. The interface stays the same when signing in. Owners can edit and
publish updates; everyone else can add a public configuration to the map or make
a separately owned copy. Browsing and viewing do not require an account.

To author a configuration, choose **Create configuration**, paste a public My Maps
link, and **Load preview**. Choose the layers and colours, opacity, title,
description, and tags. The preview appears on the main map and is identified as a
configuration preview. Save privately, or review what becomes public before
publishing. Editing a published configuration does not publish automatically.

A configuration's **Your view** controls are personal overrides. They do not change
the author's defaults. **Make a copy** uses the current view as the new configuration's
defaults and removes the original publication identity. A publisher configuration
update is distinct from a geometry refresh; applying the update retains personal
choices. Resetting your view explicitly returns to the publisher's defaults.
Withdrawing an owner's publication removes it from discovery; consumers retain the
configuration they already added.

## Browser data acquisition

GMapper accepts public Google My Maps viewer, editor, embed, or KML export links
containing a `mid`. It canonicalizes them to:

```text
https://www.google.com/maps/d/kml?mid=<map-id>&forcekml=1
```

Earthly's browser resource broker fetches the bytes without credentials, and the
Maplet parses the KML in its sandbox. No Earthly backend, CVM request, Google login,
or Nostr geometry transport participates. This supports My Maps (`/maps/d/…`), not
ordinary Google Maps places, directions, saved lists, or arbitrary KML server URLs.

Each nonempty KML folder is a layer. The converter retains points, lines, polygons
and holes, multi-geometries, names, descriptions, supported colours/opacity/width,
ExtendedData, and source map/layer/URL attribution. It reports unsupported elements;
it never follows external NetworkLinks or fetches linked icons. KMZ, image overlays,
and 3D behaviours are outside the supported vector subset. Malformed XML, document
types/entities, invalid coordinates, and oversized inputs are rejected.

**Refresh data** fetches the current complete export and retains the previous valid
geometry on failure. The timestamp is retrieval time, not the upstream author's
last edit time. Refresh is explicit; there is no background polling. A downloaded
KML file is a local fallback for the same configuration when direct access fails.
File bytes and geometry are not uploaded or saved in account preferences; reopening
continues to use the stored Google link.

Google export availability and browser CORS remain upstream constraints. A successful
fixture or individual public map does not establish a supported Google API contract.
See Google's [My Maps export instructions](https://support.google.com/mymaps/answer/3109452?hl=en)
and [KML reference](https://developers.google.com/kml/documentation/kmlreference).

## Private storage and migration

Private preferences contain version-2 `sources` and `drafts`. Each configuration
has an independent ID; duplicate URLs are allowed. Preferences hold metadata,
author defaults, publication references, active/visible state, and personal overrides.
They contain neither KML bytes nor converted geometry.

Device saves use the Maplet's bounded host storage. Account saves encrypt preferences
to the active public key using NIP-44 and publish a NIP-78 kind `30078` event at the
existing address:

```text
earthly:maplet:my-maps-viewer:sources:v1
```

That identifier stays unchanged so **Restore from account** can read existing
backups. Version-1 URL-based source preferences migrate to independent configurations,
retaining visibility, layer choices, and opacity. Existing public version-1 source
announcements are also read as configurations with default styling. Migration does
not publish events automatically.

Local storage failures, missing signer encryption support, locked signers, and relay
failures are reported. An account-signing failure leaves local work available for
retry. Account switching separates device storage, clears transient account-specific
state, and cancels pending privileged requests.

## Public configuration format

Public configuration descriptions use Earthly experimental kind **37526**, not an
allocated NIP kind. They contain a link and defaults, not geometry. The executable
Maplet identity remains `my-maps-viewer` for compatibility even though the UI name
is GMapper. New configurations use `d=my-maps-config:<configuration-id>`; their ID
is separate from the Google map ID, so one publisher can share several flavours of
the same source.

```js
{
  kind: 37526,
  tags: [
    ['d', 'my-maps-config:configuration-id'],
    ['t', 'maplet-source'],
    ['maplet', 'my-maps-viewer'],
    ['r', 'https://www.google.com/maps/d/kml?mid=publicMap123&forcekml=1'],
  ],
  content: JSON.stringify({
    version: 2,
    maplet: 'my-maps-viewer',
    id: 'configuration-id',
    url: 'https://www.google.com/maps/d/kml?mid=publicMap123&forcekml=1',
    title: 'Areas only',
    description: 'Selected survey areas',
    tags: ['survey'],
    hiddenLayers: ['Observations'],
    opacity: 0.8,
    layerColors: { Areas: '#225577' },
    deleted: false,
  }),
}
```

The address is `(kind, pubkey, d)`. Each accepted event must have a valid signature,
exact supported tags, bounded content, canonical source URL, and valid defaults.
The newest valid announcement wins; equal timestamps use the lexicographically
lowest event ID. Existing source addresses (`my-maps:<Google mid>`) remain readable;
publishing an update to one retains that address so migration does not leave a
second discoverable entry.

Configuration discovery queries configured content/discovery relays. It is a
bounded relay listing, with search over loaded titles, descriptions, tags, and
publisher keys, rather than a global index. Merely discovering a configuration
does not fetch its Google data. Public configuration metadata remains available
without sign-in. The publisher is a curator and need not be the original Google
map author. Google data updates do not require republishing the configuration.

## Runtime and host contract

Verified HTML runs in an iframe with `sandbox="allow-scripts"`. Earthly injects
`window.napplet` before Maplet code, binds requests to that frame, correlates replies,
applies a restrictive CSP, and revokes unexpected navigation. The web sandbox has
no ambient network, host DOM, host storage, relay, or signer access.

```js
await napplet.map.replace(featureCollection, { warnings: ['Source note'] });
const pubkey = await napplet.identity.getPublicKey();
const blob = await napplet.resource.bytes(approvedSourceUrl);
const preferences = await napplet.storage.getItem('preferences');
const settings = await napplet.config.get();
```

Identity reports the current public key, never a signer. Geometry output atomically
replaces that instance's complete layer and is independently validated for supported
geometry, finite WGS84 coordinates, closed rings, unique IDs, and bounded properties.
The resource grant permits canonical public My Maps exports; arbitrary URLs,
caller-provided headers, credentials, and redirects are not granted.

Earthly's optional `map.replace(collection, { entries })` extension groups output
into independently addressable configuration uses. Each entry has a stable `id`,
`title`, its own validated `collection`, and optional `visible` and `warnings`.
The host accepts at most 16 entries within the existing aggregate geometry/byte
budget, binds their IDs to the calling runtime, and creates a Shelf item for each
ordinary entry. Omitting `entries` preserves the single-output Maplet contract.

An entry marked `preview: true` is temporary: it has no Shelf item and is displayed
only while that Maplet surface is visible. `previewOf: '<entry id>'` lets an edit
preview temporarily hide the matching ordinary output from the same runtime,
preserving its Shelf membership and viewing choices. Previews draw above ordinary
Maplet outputs; leaving the editor removes the preview and restores the original.
GMapper uses this extension to show changed layers/styles without publishing or
altering the user's active configuration.

`storage.getItem/setItem/removeItem/keys` expose bounded JSON storage scoped to the
verified app identity and active account, or anonymous device session. The relay
bridge implements a bounded subset of draft NAP-RELAY:
`relay.query`, `relay.publish`, and `relay.publishEncrypted`. Only the reviewed
bundled GMapper receives public-configuration and owner-preference grants. The host
independently validates event shapes, ownership, account continuity, and limits
before signing. Downloaded Maplets do not inherit those privileges.

The generic bounded NAP-CONFIG profile remains available for executable Maplets:
`config.get`, `subscribe`, `openSettings`, schema registration, and validation.
It supports objects, primitive fields/arrays, enums, defaults, basic bounds, and
display annotations. References, regex patterns, executable validation, unsupported
keywords, and secret storage are outside the profile. GMapper's named configuration
editor is app-owned and uses its own domain format rather than an empty generic
settings form. Earthly's presentation/refresh extensions integrate it with the Shelf.

Maplet visibility and removal remain ordinary Shelf controls. Closing the Maplet
surface preserves its mounted runtime and current work. Independent configuration
entries allow toggling, fitting, inspecting, isolating, and removing individual uses.
Geometry follows Shelf order between Maplet uses; renderer-level interleaving with
ordinary saved Map features remains outside this change.

### Tauri Android

The bundled GMapper is allowed under the packaged CSP. Native script/style nonces
are inherited without weakening host policy. Its signing and encrypted publication
use Earthly's native account integration and durable outbox. Browser export CORS and
WebView file selection are still platform-sensitive; responsive browser coverage is
not Android APK certification.

Downloaded executable Maplets remain disabled in Tauri because the supported
Android WebView stack can expose native IPC to child frames. Safe foreign execution
needs a separate WebView without native IPC, or a verified isolation change. Public
configuration descriptions are data and can be consumed by bundled GMapper.

## Third-party executable discovery

Earthly discovers signed kind `35129` announcements tagged `maplet`, chooses the
latest valid release per address, and verifies signature, declared domains, file
hashes, aggregate hash, and artifact limits before execution. Discovery itself is
not a resource or signing grant. The verifier also recognizes the supported
`5129`/`15129` manifest variants; catalog queries remain `35129`.

A compatible release currently contains one self-contained `/index.html` with
inline code/styles, uploaded unchanged to a browser-accessible Blossom server:

```js
[
  ['d', 'my-maplet'],
  ['title', 'My Maplet'],
  ['description', 'What this tool contributes'],
  ['t', 'maplet'],
  ['archetype', 'maplet'],
  ['requires', 'map'],
  ['path', '/index.html', fileHash],
  ['x', aggregateHash, 'aggregate'],
  ['server', 'https://your-blossom-server.example'],
]
```

The file hash is SHA-256 over the exact UTF-8 bytes. The aggregate is SHA-256 over
lexicographically sorted `<file-hash> <absolute-path>\n` lines; for one file its input
is `${fileHash} /index.html\n`, including the final newline. Additional assets,
unimplemented required domains, arbitrary source grants, and downloaded-app signing
are unsupported. The starter repository/bootstrap with AI skills remains deferred.

## Taking geometry into an editable Map

The configuration's **Geometry** section allows selecting output features and
copying them into Earthly's editor. Copies deep-copy the full validated output,
receive new editor IDs, preserve source properties and attribution, and record
available release/publisher/source identity under `mapletSource`. A copy is an
independent snapshot: neither Google refreshes nor configuration updates change it.
Publishing that draft uses Earthly's normal Map publication flow.

## Limits and validation

Current limits include 2 MiB single-file HTML artifacts; 5 MiB resource/geometry
results; 5,000 features and 50,000 positions per output; bounded depth/properties;
10 concurrent capability requests and 60 resource acquisitions per minute;
128 KiB per host-storage value and 256 KiB per scope; 12 saved configurations and
12 drafts; public configuration descriptions below 60,000 characters; and generic
configuration values below 64 Ki characters with 128 schema nodes/four nesting levels.
The implementation files own exact enforced limits.

```sh
bun test src/lib/maplets src/features/maplets src/components/MapStackPanel.maplets.test.tsx
bun run ai:typecheck
bunx playwright test -c ai-suite/playwright.config.ts my-maps-viewer maplet-discovery maplet-native-csp maplets
```

Browser scenarios use local personas, isolated relays, and controlled KML fixtures.
Before automation, follow `ai-suite/README.md` and inspect `bun run ai:list`. Never
start/reset `bun dev` just to run these tests; use the existing loopback server.
