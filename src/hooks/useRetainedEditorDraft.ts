import { useCallback, useEffect, useRef } from 'react'

interface RetainedDraftSession<T> {
	snapshot: T
	dirty: boolean
	suppressed: boolean
	persist: (identity: string, snapshot: T) => void
	clear: (identity: string) => void
}

export interface UseRetainedEditorDraftOptions<T> {
	/** Stable identity for the create/edit slot (for example `new-story` or an event address). */
	identity: string
	/** The complete serializable form state from the current render. */
	snapshot: T
	/** Writes one local-only draft. This is called when a dirty surface unmounts. */
	persist: (identity: string, snapshot: T) => void
	/** Removes the local-only draft after an explicit discard or successful publish. */
	clear: (identity: string) => void
}

export interface RetainedEditorDraftControls {
	/** Keep this in sync with whether the rendered snapshot differs from its hydrated baseline. */
	setDirty: (dirty: boolean) => void
	/** Persist immediately (used by explicit "Save draft" actions). */
	persistNow: () => void
	/** Clear and suppress the unmount write until the form becomes dirty again. */
	clearRetainedDraft: () => void
}

/**
 * Retains an editor's React-local form state without retaining the whole panel tree.
 *
 * GeoEditorInfoPanel deliberately swaps its active surface. A dirty editor therefore
 * unmounts when the user visits Inspector or another editor. This hook snapshots that
 * surface on unmount and lets the next mount hydrate from the editor's local draft store.
 * Explicit discard/publish clears the stored value and suppresses the same unmount from
 * recreating it.
 *
 * Sessions are held by identity so a prop switch cannot accidentally write the new
 * entity's render under the previous entity's key.
 */
export function useRetainedEditorDraft<T>({
	identity,
	snapshot,
	persist,
	clear,
}: UseRetainedEditorDraftOptions<T>): RetainedEditorDraftControls {
	const sessionsRef = useRef(new Map<string, RetainedDraftSession<T>>())
	let session = sessionsRef.current.get(identity)
	if (!session) {
		session = {
			snapshot,
			dirty: false,
			suppressed: false,
			persist,
			clear,
		}
		sessionsRef.current.set(identity, session)
	} else {
		// Render-time ref synchronization is intentional: an immediate unmount must
		// flush the most recently rendered controlled values, not the previous render.
		session.snapshot = snapshot
		session.persist = persist
		session.clear = clear
	}

	useEffect(() => {
		// React Strict Mode intentionally replays effect setup/cleanup in development.
		// Re-register the render's session so that replay cannot disable later writes.
		sessionsRef.current.set(identity, session)
		return () => {
			const endingSession = sessionsRef.current.get(identity)
			if (endingSession?.dirty && !endingSession.suppressed) {
				endingSession.persist(identity, endingSession.snapshot)
			}
			sessionsRef.current.delete(identity)
		}
	}, [identity, session])

	const setDirty = useCallback(
		(dirty: boolean) => {
			const current = sessionsRef.current.get(identity)
			if (!current) return
			current.dirty = dirty
			if (dirty) current.suppressed = false
		},
		[identity],
	)

	const persistNow = useCallback(() => {
		const current = sessionsRef.current.get(identity)
		if (!current) return
		current.persist(identity, current.snapshot)
		current.dirty = false
		current.suppressed = false
	}, [identity])

	const clearRetainedDraft = useCallback(() => {
		const current = sessionsRef.current.get(identity)
		if (!current) return
		// Suppress first: clear callbacks may synchronously cause navigation/unmount.
		current.dirty = false
		current.suppressed = true
		current.clear(identity)
	}, [identity])

	return { setDirty, persistNow, clearRetainedDraft }
}
