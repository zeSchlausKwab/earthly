import type { CollectionMeta } from '@/features/geo-editor/types'

/**
 * SAFE-01 — pure binding resolver (D-01 / D-02 / D-03).
 *
 * The chat is always explicitly bound to a target dataset. This resolver is a PURE function
 * over the editor-store identity fields — it does NOT subscribe to the store and does NOT
 * mount React (the `BindingChip` in Plan 05 reads the store and feeds this resolver), so it is
 * headlessly testable. It also NEVER refuses a mutation: when there is genuinely no bound
 * target it reports `needsAutoCreate: true` (the auto-create-and-bind signal) rather than a
 * "refuse" state — the actual untitled-draft creation is wired at the gate/UI layer (Plan
 * 04/05), this resolver only reports that auto-create is needed.
 */
export interface BindingResolverInput {
	/** The open collection's metadata (name drives the chip label). */
	collectionMeta: Pick<CollectionMeta, 'name'>
	/** Mirror of `editor.getAllFeatures().length` (kept fresh by Editor.tsx). */
	featureCount: number
	/** The active geo-edit draft id, or null when no draft is open. */
	activeGeoEditDraftId: string | null
	/** Whether the open dataset has unsaved in-memory edits. */
	isDirty: boolean
}

export interface BindingIdentity {
	/** Display name for the binding chip; falls back to 'Untitled draft' when empty (D-03). */
	name: string
	/** True for an open draft or a dirty dataset (D-03). */
	unsaved: boolean
	/** Number of features in the bound target (D-03). */
	featureCount: number
	/**
	 * D-02 auto-create-and-bind signal: true only when there is genuinely no bound target to
	 * show (no open draft, no features). The gate/UI creates + shows the untitled draft BEFORE
	 * the mutation — this is never a refusal.
	 */
	needsAutoCreate: boolean
}

const UNTITLED_DRAFT_NAME = 'Untitled draft'

export function resolveBinding(input: BindingResolverInput): BindingIdentity {
	const { collectionMeta, featureCount, activeGeoEditDraftId, isDirty } = input

	const trimmedName = collectionMeta.name.trim()
	const name = trimmedName === '' ? UNTITLED_DRAFT_NAME : trimmedName

	const hasOpenDraft = activeGeoEditDraftId !== null
	const unsaved = hasOpenDraft || isDirty

	// A bound target exists when a draft is open OR features are already present (a loaded /
	// saved dataset). Only when neither holds is there nothing to show → auto-create-and-bind.
	const hasBoundTarget = hasOpenDraft || featureCount > 0
	const needsAutoCreate = !hasBoundTarget

	return {
		name,
		unsaved,
		featureCount,
		needsAutoCreate,
	}
}
