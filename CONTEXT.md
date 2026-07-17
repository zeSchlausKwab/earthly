# Earthly domain language

This document defines the product terms used when Earthly authors map data. It is intentionally narrower than the implementation vocabulary.

## Local draft

A **local draft** is recoverable, unpublished work saved on the current device for the active account. A geometry draft owns its features, metadata, external file references, context attachments, and publish channel.

Use **Local drafts** or **Saved work** in the UI. Do not call this a workspace. `GeoEditorWorkspace` remains an internal compatibility name for the index that groups revisions of one local draft.

## Publish channel

A **publish channel** answers who receives the record:

- **Public** — publish through the user's normal Nostr outbox.
- **Private group** — encrypt and save through the group's MLS coordinator.
- **Field session** — publish to the nearby session relay according to that session's policy.

The active draft owns its channel. Navigation may suggest a channel for a new draft, but changing routes must never silently turn an existing private or nearby draft into a public one.

## Context attachment

A **context attachment** says what public subject a record belongs to, such as “Roman ruins in Carinthia.” It becomes a `c` reference when published.

A context attachment does not provide privacy and is not a storage container. A public draft may have zero or more context attachments.

## Browse scope

A **browse scope** filters the records shown in catalogs and panels. Opening a Context may set a browse scope. Browsing and attaching are distinct actions: leaving a filter does not silently rewrite a saved draft, and merely viewing a Context must not retarget existing work.

## Destination indicator

The **destination indicator** is the single UI summary of the active authoring outcome. It combines the actual publish channel with the relevant attachment:

- `Public · Unattached`
- `Public · Roman ruins in Carinthia`
- `Private · Alpine rescue`
- `Nearby · Saturday survey`

When no draft is active, the indicator describes the destination a newly created dataset would inherit from the current route. If that destination cannot be resolved, the UI keeps it visible as unavailable and publishing is blocked; it must not fall back to Public.

Drafts saved before publish channels were persisted are quarantined as **Destination needed**. They remain recoverable, but publishing and public Blossom upload stay blocked until their destination can be classified explicitly.

The Local drafts panel is the recovery surface for that classification. It lets the user choose Public, one of their active Private groups, or an active Field session. Merely opening a route never performs this migration.

The indicator's close action leaves the current destination or scope while preserving saved work. Leaving Private or Nearby never converts that draft to Public. A separate, explicit destination-change action is required for conversion.

## Avoided terms

- **Workspace** — overloaded across local drafts, MLS groups, field sessions, and AI chat. Keep it internal unless referring to a specific legacy type.
- **Isolated** for destination — reserved for Map Stack visibility. Use **Unattached** when a public record has no Context.
