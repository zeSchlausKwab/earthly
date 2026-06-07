import type { StateCreator } from 'zustand'
import type { EditorState, StanceSlice } from './types'

/**
 * The user's explicit top-level intent.
 *
 *   - 'browse'  → discovery / panning around / no commitment
 *   - 'focus'   → inspecting one or more pinned datasets/contexts
 *   - 'author'  → drawing or editing a specific dataset
 *
 * Transitions are explicit, triggered at known sites:
 *   - applyEditingState (Edit / Fork verb)    → 'author'
 *   - handleInspectDataset / handleInspectContext → 'focus'
 *   - exitViewMode, clearEditingSession, clearFocus → 'browse'
 *
 * Replaces the previously-derived stance label that combined `viewMode` and
 * `focusLabel`.
 */
export const createStanceSlice: StateCreator<EditorState, [], [], StanceSlice> = (set) => ({
	stance: 'browse',
	setStance: (stance) => set({ stance }),
})
