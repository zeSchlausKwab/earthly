# Earthly offline transport strategy

Status: implementation decision for the local-node foundation, 2026-07-14.

Implementation checkpoint, 2026-07-15: step 1 and the QR/photo/paste portion of step 2 are now
implemented, including the `earthly://pair` native handoff. The LAN session is explicit and expires
after 15 minutes; pairing remains signed, approval-gated, and capability-scoped. Accepted peers can
explicitly pull signed Earthly records
with NIP-77 into their verified local database, discover SHA-256 Blossom references in those
records, and explicitly copy the referenced immutable files into their local Blossom store. Pairing
QRs and copied links now carry the same bounded invitation in an OS-registered custom scheme;
cold-start and already-running app delivery converge on the paste/photo join flow. Platform
permission-denial adapters remain. Mirrored GeoJSON is resolved local-first
through a read-only native custom protocol; its Range behavior is also the seam for later local
PMTiles consumption. Relay queries, counts, negentropy reconciliation, live reads, and writes are
bound to the authenticated installation pubkey and its separate durable pairing capabilities.

Implementation checkpoint, 2026-07-16: the raw pairing and pull controls now have a first-class
product surface named **Field sessions**. A Field session is a nearby collaboration workspace, not
an MLS group and not merely a transfer dialog:

- `/fieldsession/:id` keeps the active nearby scope visible beside the map;
- a host selects the local address, starts a bounded LAN session, chooses whether participants may
  contribute, and issues a signed QR/link invitation containing the Field-session metadata;
- participant installations request access and authenticate with their durable installation key;
- records retain the active Earthly user's independent Nostr signature;
- kind `37523` messages carry an `h` tag with the Field-session id, are submitted to the host relay,
  and may include an optional GeoJSON attachment;
- ordinary signed Earthly datasets (kind `37515`) use the same `h` scope, can be created and edited
  with the shared map editor, and are reconciled by the other approved devices without any public
  relay;
- nearby datasets appear in the Field-session Map tab and Map Stack, while a dataset explicitly
  removed from the stack stays removed until the user adds it again;
- **Nearby only** is the release behavior. **Ask before internet sync** records intent in the
  session model but does not publish anything globally in `0.0.1`.

The current installation grant authorizes access to the embedded node; it is not an MLS-style
per-session confidentiality boundary. A previously approved installation remains trusted until the
host revokes it. Use a Private group for end-to-end encrypted membership. Per-session grant scopes,
additional Earthly entity types, and an explicit promotion flow from nearby records to global Nostr
are follow-up work, not hidden behavior in `0.0.1`. Field-session geometry is nearby-scoped signed
Nostr data; it is not encrypted merely because it remains off the public internet.

## Decision

Earthly v1 uses an IP network as the data bearer and keeps pairing independent from discovery and
radio setup. Nostr continues to use WebSocket and Blossom continues to use HTTP, so the same signed
handshake and protocol clients work when devices are:

1. on the same Wi-Fi network, even when that network has no internet connection;
2. connected to a hotspot created by one of the devices;
3. on the same device through loopback, where the operating system permits the host app to remain
   available.

The invitation is transferred by QR, deep link, copy/paste, or a later nearby-discovery adapter. It
contains the exact IP endpoints, so successful discovery never implies authorization. BLE is a
bootstrap option, not the map/blob transport.

Earthly does not continuously stream a partner's map. After pairing, clients synchronize signed
Nostr state and explicitly mirror referenced immutable Blossom objects when they want a durable
offline copy. Mirroring fetches only SHA-256 hashes discovered in synchronized Earthly records from
the approved node's advertised Blossom endpoint; event-supplied URLs are never used as generic
fetch targets.

## Transport matrix

| Bearer | Role | Throughput fit | Cross-platform position | v1 decision |
| --- | --- | --- | --- | --- |
| Same Wi-Fi/LAN | Primary data path | Relay events, attachments, PMTiles, bundles | Standard TCP on desktop, Android, and iOS | Ship first |
| Device hotspot | Fallback IP path when no LAN exists | Same as LAN | User-controlled everywhere; app-created local-only hotspot is Android-specific | Ship guided flow; add Android convenience |
| Android Wi-Fi Direct | Optional nearby IP path without an access point | Large data | Android-specific APIs and permissions | Later adapter |
| Android Wi-Fi Aware | Optional discovery plus high-throughput data path | Large data | Android 8+ but hardware-dependent | Later experiment |
| Apple Multipeer Connectivity | Optional Apple-to-Apple nearby path | Messages, streams, files | Apple framework; not a shared Android wire transport | Later adapter if demanded |
| BLE GATT | Discovery/handshake bootstrap | Small control messages only | Available on Android and Apple, with asymmetric roles and background limits | Do not use for relay/blob payloads |
| QR/deep link/file | Out-of-band invitation handoff | One small signed invitation | Broadly portable and easy to audit | Ship first |

## 1. Same Wi-Fi is the primary path

This is the simplest and most interoperable arrangement. The access point does not need an internet
uplink; it only needs to allow clients to reach each other. One Earthly node binds to a selected
private or link-local address, puts that address in its signed invitation, and keeps LAN serving
visibly enabled only for the user-approved session.

The first version should not depend on multicast discovery. The host displays a QR code containing
the signed invitation and the peer connects directly. mDNS/Bonjour can later advertise a short node
id and fetch the same descriptor, but manual QR remains the deterministic fallback.

Platform work:

- iOS requires a local-network usage description and user permission; Bonjour service types must be
  declared when Bonjour/Multipeer discovery is added. Apple's local-network rules apply to Network,
  Bonjour, and Multipeer Connectivity ([TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)).
- Android target SDK 36 can use LAN sockets with `INTERNET`, but Android 17 makes
  `ACCESS_LOCAL_NETWORK` mandatory for apps targeting SDK 37+. Earthly must add the declaration,
  runtime rationale, denial handling, and socket-error state before raising `targetSdk` to 37
  ([Android local-network permission](https://developer.android.com/privacy-and-security/local-network-permission)).
- Release WebViews do not receive unrestricted cleartext LAN access. A native adapter owns peer
  sockets and exposes narrow relay/blob operations to the webview.

## 2. A hotspot is the no-router fallback

Once both devices join one hotspot, Earthly uses the exact same TCP/WebSocket/HTTP path as same-Wi-Fi
mode. The hotspot is a bearer setup step, not a second synchronization protocol.

Recommended UX:

1. Host chooses **Create offline network**.
2. Earthly opens or invokes the best platform flow and displays the network status.
3. The peer joins the network.
4. Host displays the ordinary signed pairing QR.
5. After explicit approval, the peer uses the descriptor's private IP endpoints.

On Android, a native Tauri plugin can call `startLocalOnlyHotspot()`. Android documents this as a
network without internet specifically intended for communication between connected applications;
Android 13+ requires `NEARBY_WIFI_DEVICES`
([LocalOnlyHotspot](https://developer.android.com/develop/connectivity/wifi/localonlyhotspot)). The
hotspot reservation is lifecycle-bound, so Earthly must show when it stops and regenerate the
descriptor if the address changes.

On Apple platforms, `NEHotspotConfigurationManager` can help a peer join a known Wi-Fi network only
after explicit user approval; it configures/joins networks, it does not provide a general API for an
app to turn the iPhone into a Personal Hotspot
([Wi-Fi configuration](https://developer.apple.com/documentation/networkextension/wi-fi-configuration)).
The cross-platform baseline is therefore a user-enabled Personal Hotspot or another device's
hotspot, with Android app-created LocalOnlyHotspot as a convenience rather than a protocol
requirement.

## 3. BLE is viable for bootstrap, not map transfer

BLE is designed around GATT attributes and small pieces of data. Android's own guidance lists
"transferring small amounts of data" as a common use case
([BLE overview](https://developer.android.com/develop/connectivity/bluetooth/ble/ble-overview)). A
complete signed Earthly invitation is larger than an advertisement and would require a custom GATT
service, framing, fragmentation, retries, duplicate suppression, and central/peripheral role
coordination.

Useful BLE scope:

- advertise an Earthly service UUID and a truncated node/invitation digest;
- exchange the full signed invitation through a bounded GATT characteristic;
- show nearby devices without requiring the camera;
- optionally carry a tiny acceptance/status message before upgrading to IP.

Rejected BLE scope for v1:

- tunnelling WebSocket or HTTP over GATT;
- transferring PMTiles, photos, bundles, or mirrored Blossom content;
- promising continuous background availability;
- treating Bluetooth bonding as Earthly authorization.

Earthly signatures and invitation nonces remain mandatory over BLE. Android warns that BLE data for
a paired device can be accessible to other apps on the device, so application-layer authentication
cannot be delegated to the radio. Android background connections are also tied to process and
foreground-service constraints
([Android BLE background guidance](https://developer.android.com/develop/connectivity/bluetooth/ble/background)).
Apple supports central and peripheral roles through Core Bluetooth, but background advertising and
scanning are restricted and apps do not run indefinitely
([Core Bluetooth background processing](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html)).

## 4. Platform-specific high-throughput paths

Android Wi-Fi Direct connects devices without an intermediate access point and is explicitly aimed
at higher-speed sharing over greater range than Bluetooth
([Wi-Fi Direct](https://developer.android.com/develop/connectivity/wifi/wifip2p)). Wi-Fi Aware can
discover peers and establish a bidirectional network without an access point, with higher throughput
than Bluetooth, but requires supporting hardware
([Wi-Fi Aware](https://developer.android.com/develop/connectivity/wifi/wifi-aware)). Both can feed an
ordinary IP descriptor after setup, making them optional native bearer adapters rather than forks of
the pairing protocol.

Apple's Multipeer Connectivity can use infrastructure Wi-Fi, peer-to-peer Wi-Fi, and Bluetooth and
can transfer messages, streams, and files. It stops advertising/browsing and disconnects sessions
when the app backgrounds, and it is not a portable Android API
([Multipeer Connectivity](https://developer.apple.com/documentation/multipeerconnectivity)). It is a
reasonable Apple-to-Apple optimization only if measured product demand justifies another adapter.

## Implementation order

1. Keep loopback as the default and expose an explicit, time-bounded **Serve on local network**
   action that selects a private address and creates the signed invitation.
2. Add QR/deep-link import, pending-claim UI, explicit approve/reject, capability display, and revoke.
3. Add native LAN permission adapters and permission-denial diagnostics for Android and iOS.
4. Add Android LocalOnlyHotspot creation/join guidance; keep the manual hotspot path on every
   platform.
5. Add mDNS/Bonjour as convenience discovery without removing QR.
6. Prototype BLE invitation bootstrap only after the IP path has two-device interoperability tests.
7. Evaluate Wi-Fi Direct/Aware and Multipeer Connectivity from measured failure cases, not as v1
   prerequisites.

## Acceptance tests

- Two devices on an internet-disconnected Wi-Fi network complete pairing, relay publish/query, and
  Blossom upload/range read.
- The same test passes when one Android device owns a LocalOnlyHotspot.
- Denying LAN/nearby permission produces an actionable state and never silently falls back to a
  public relay.
- Closing LAN serving immediately closes listeners and invalidates the advertised address without
  revoking the persistent peer identity.
- A captured invitation cannot be approved twice, cannot request unoffered capabilities, and cannot
  be replayed on another node.
- BLE bootstrap, if added, exchanges only the invitation/control envelope; data-path tests verify
  that large content upgrades to Wi-Fi/IP.
- A participant installation authenticates independently from the active user's signing key,
  publishes a Field-session message to the host, and both installations reconcile the identical
  signed record without internet access.
