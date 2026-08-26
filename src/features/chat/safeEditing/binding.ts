import type { CollectionMeta } from '@/features/geo-editor/types'

/**
 * SAFE-01 — pure binding resolver (D-01 / D-02 / D-03).
 *
 * Every send-capable conversation is explicitly bound to a target Dataset. This resolver is
 * a PURE function over the editor-store identity fields — it does NOT subscribe to the store
 * and does NOT mount React (the `BindingChip` reads the store and feeds this resolver), so it
 * is headlessly testable. When there is no explicitly selected persistent draft it reports
 * `targetRequired: true`; callers may offer New map or Use current edit, but never create or
 * infer a target while resolving this state.
 */
export interface BindingResolverInput {
	/** The open collection's metadata (name drives the chip label). */
	collectionMeta: Pick<CollectionMeta, 'name'>
	/** Mirror of `editor.getAllFeatures().length` (kept fresh by Editor.tsx). */
	featureCount: number
	/** The explicitly selected edit draft id, or null when this Chat has no valid target. */
	targetDraftId: string | null
}

export interface BindingIdentity {
	/** Display name for the binding chip; falls back to 'Untitled draft' when empty (D-03). */
	name: string
	/** True for an open draft or a dirty dataset (D-03). */
	unsaved: boolean
	/** Number of features in the bound target (D-03). */
	featureCount: number
	/** True until an explicitly selected persistent edit draft can be resolved. */
	targetRequired: boolean
}

const UNTITLED_DRAFT_NAME = 'Untitled draft'

export function resolveBinding(input: BindingResolverInput): BindingIdentity {
	const { collectionMeta, featureCount, targetDraftId } = input

	const trimmedName = collectionMeta.name.trim()
	const name = trimmedName === '' ? UNTITLED_DRAFT_NAME : trimmedName

	const hasOpenDraft = targetDraftId !== null
	const unsaved = hasOpenDraft

	// Only a persistent draft can be an editing target. Visible or loaded features remain
	// available as reference context but never establish a Chat binding by themselves.
	const hasBoundTarget = hasOpenDraft
	const targetRequired = !hasBoundTarget

	return {
		name,
		unsaved,
		featureCount: hasBoundTarget ? featureCount : 0,
		targetRequired,
	}
}
