import type { PreparedDocumentChange } from '@/features/chat/tools/document-authoring'
import { getSafetyLevel } from '@/features/chat/safeEditing/safetyAccess'

export interface DocumentReview extends PreparedDocumentChange {
	id: string
	status: 'pending' | 'approved' | 'applied' | 'cancelled' | 'failed' | 'undone'
}
let reviews: DocumentReview[] = []
const subscribers = new Set<() => void>()
const decisions = new Map<string, (approved: boolean) => void>()
const undos = new Map<string, () => boolean>()
const notify = () => {
	for (const subscriber of subscribers) subscriber()
}
export const getDocumentReviews = () => reviews
export const subscribeDocumentReviews = (listener: () => void) => {
	subscribers.add(listener)
	return () => {
		subscribers.delete(listener)
	}
}
function update(id: string, status: DocumentReview['status']) {
	reviews = reviews.map((review) => (review.id === id ? { ...review, status } : review))
	notify()
}
export function resolveDocumentReview(id: string, approved: boolean) {
	const resolve = decisions.get(id)
	if (!resolve) return
	decisions.delete(id)
	update(id, approved ? 'approved' : 'cancelled')
	resolve(approved)
}
export function clearDocumentReviews() {
	for (const id of [...decisions.keys()]) resolveDocumentReview(id, false)
	undos.clear()
	reviews = []
	notify()
}
export function undoDocumentReview(id: string): boolean {
	const undo = undos.get(id)
	if (!undo || !undo()) return false
	undos.delete(id)
	update(id, 'undone')
	return true
}
/** Preview all / confirm edits / apply with Undo matches the shared Map policy. */
export async function reviewDocumentChange(
	id: string,
	change: PreparedDocumentChange,
	signal: AbortSignal,
) {
	const level = getSafetyLevel()
	const pending = level === 1 || (level === 2 && !change.created)
	const evicted = reviews.slice(0, Math.max(0, reviews.length - 19))
	for (const entry of evicted) undos.delete(entry.id)
	reviews = [...reviews.slice(-19), { ...change, id, status: pending ? 'pending' : 'approved' }]
	if (!pending) {
		notify()
		return true
	}
	return new Promise<boolean>((resolve) => {
		const abort = () => resolveDocumentReview(id, false)
		decisions.set(id, (approved) => {
			signal.removeEventListener('abort', abort)
			resolve(approved)
		})
		signal.addEventListener('abort', abort, { once: true })
		notify()
		if (signal.aborted) abort()
	})
}
export function recordDocumentCommit(id: string, undo: () => boolean) {
	undos.set(id, undo)
	update(id, 'applied')
}
export function failDocumentReview(id: string) {
	if (reviews.some((review) => review.id === id && review.status === 'approved'))
		update(id, 'failed')
}
