/**
 * GeoJSON Data Event (kind 37515) — applesauce migration target.
 *
 * Use these in place of `NDKGeoEvent`:
 *   - Reading: `castEvent(event, GeoDataset, eventStore)` or
 *     `castTimelineStream(GeoDataset, eventStore)` in observable pipelines
 *   - Writing: `GeoDatasetFactory.create(fc).hashtags(['t1']).withDerivedMetadata().sign(signer)`
 *   - Deleting: `await deleteDataset(event, signer, reason)`
 */

export * from './cast'
export * from './factory'
export * from './helpers'
