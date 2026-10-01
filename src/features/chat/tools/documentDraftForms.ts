/** Exact mounted document form seam: pending human inputs precede storage CAS checks. */
export type MountedDocumentKind = 'story' | 'atlas'
export interface DocumentDraftForm {
	kind: MountedDocumentKind
	draftKey: string
	ownerPubkey: string | null
	/** Persist only changed human input; clean hydration must not change a revision. */
	flush: () => void
	/** Stop an obsolete form saving on unmount without deleting durable content. */
	suppress: () => void
}
const forms = new Map<string, DocumentDraftForm>()
const key = (kind: MountedDocumentKind, draftKey: string, owner: string | null) =>
	JSON.stringify([kind, draftKey, owner])

export function registerDocumentDraftForm(form: DocumentDraftForm) {
	const identity = key(form.kind, form.draftKey, form.ownerPubkey)
	forms.set(identity, form)
	return () => {
		if (forms.get(identity) === form) forms.delete(identity)
	}
}

export function flushDocumentDraftForm(
	kind: MountedDocumentKind,
	draftKey: string,
	owner: string | null,
) {
	forms.get(key(kind, draftKey, owner))?.flush()
}

export function flushAllDocumentDraftForms(owner: string | null) {
	for (const form of forms.values()) if (form.ownerPubkey === owner) form.flush()
}

export function suppressDocumentDraftFormSave(
	kind: MountedDocumentKind,
	draftKey: string,
	owner: string | null,
) {
	forms.get(key(kind, draftKey, owner))?.suppress()
}
