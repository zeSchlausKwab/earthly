/**
 * Barrel for the Group service layer (Phase 9 trust core): schema-hash compute/verify,
 * the off/warn/strict foreign-lane filter, and the attach-discovery + warn-not-block
 * publish entrypoint. Consumers (editor 04, publish 05, view 06) import verified
 * primitives from here.
 */

export * from './attach'
export * from './filterModes'
export * from './schemaHash'
