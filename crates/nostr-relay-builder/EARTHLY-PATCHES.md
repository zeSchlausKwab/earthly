# Earthly's nostr-relay-builder patch

This directory pins the MIT-licensed `nostr-relay-builder` 0.44.1 source from
[`rust-nostr/nostr`](https://github.com/rust-nostr/nostr), crate source revision
`94398c944cf58f7c4e8dd622cedd103e997e5b98`.

Earthly carries this narrow fork because upstream NIP-42 currently verifies a client signature but
does not expose the authenticated session public key to a runtime authorization policy. Its
negentropy handler also bypasses the read-authentication check. Those gaps allow any valid Nostr key
to authenticate and read a relay configured with NIP-42 `Both`, regardless of Earthly's pairing
grant.

The patch adds:

- `Nip42Policy` and `Nip42PolicyAction` for operation-aware session authorization;
- the policy check on `EVENT`, `REQ`, `COUNT`, and NIP-77 negentropy messages;
- relay-tag validation for NIP-42 authentication events;
- a live-subscription policy recheck before forwarding newly received events.

Keep the fork byte-for-byte aligned with 0.44.1 outside those changes. Remove the Cargo patch when an
upstream release provides equivalent authenticated-session policy hooks and negentropy enforcement.
