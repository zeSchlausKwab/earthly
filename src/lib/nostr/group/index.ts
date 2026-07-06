/**
 * Group / Topic Event (kind 37518, slimmed) — attach-push topic with an explicit
 * governance ladder (`open` · `schema` · `closed`).
 *
 * Factory + Cast + helpers (Phase 9). The slimmed successor to `map-context/`:
 * the old contextUse/validationMode/allowForeignAttachments triad collapses to a
 * single `governance` enum, and `isGroup` gates on the SPEC-03 `modelVersion`
 * clean-break discriminator (legacy 37518 silently drops).
 */

export * from './cast'
export * from './factory'
export * from './helpers'
