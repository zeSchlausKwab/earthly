/** Framework-light refresh/navigation seam for exact Atlas draft identities. */
import type { MapContext } from '@/lib/nostr/map-context'
import { NEW_GROUP_EDITOR_DRAFT_KEY } from './editorDraft'

/** Only the mounted authoring surface supplies local presentation authorization. */
export interface AtlasEditorPresentation {
	instanceId: string
	draftKey: string
	ownerPubkey: string | null
	presentation?: unknown
	acceptedReferences: readonly string[]
}
let foregroundPresentation: AtlasEditorPresentation | null = null
const presentationSubscribers = new Set<() => void>()
export function getAtlasEditorPresentation() {
	return foregroundPresentation
}
export function setAtlasEditorPresentation(value: AtlasEditorPresentation) {
	foregroundPresentation = value
	for (const subscriber of presentationSubscribers) subscriber()
}
export function clearAtlasEditorPresentation(instanceId: string) {
	if (foregroundPresentation?.instanceId !== instanceId) return
	foregroundPresentation = null
	for (const subscriber of presentationSubscribers) subscriber()
}
export function subscribeAtlasEditorPresentation(subscriber: () => void) {
	presentationSubscribers.add(subscriber)
	return () => {
		presentationSubscribers.delete(subscriber)
	}
}

export interface AtlasEditorOpenRequest {
	draftKey: string
	context?: MapContext
	reveal?: boolean
	nonce: number
}
let counter = 0
let lastRequest: AtlasEditorOpenRequest | null = null
let retainedTarget: { draftKey: string; context?: MapContext } | null = null
const subscribers = new Set<() => void>()

export function retainAtlasEditorTarget(
	draftKey = NEW_GROUP_EDITOR_DRAFT_KEY,
	context?: MapContext | null,
) {
	retainedTarget = { draftKey, ...(context ? { context } : {}) }
}
export function getAtlasEditorTarget() {
	return retainedTarget
}
export function clearAtlasEditorTarget() {
	retainedTarget = null
	lastRequest = null
}
export function requestOpenAtlasEditor(
	draftKey: string,
	context?: MapContext,
	options?: { reveal?: boolean },
) {
	retainAtlasEditorTarget(draftKey, context)
	lastRequest = { draftKey, context, reveal: options?.reveal, nonce: ++counter }
	for (const subscriber of subscribers) subscriber()
}
export function getAtlasEditorOpenRequest() {
	return lastRequest
}
export function subscribeAtlasEditorOpenRequests(subscriber: () => void) {
	subscribers.add(subscriber)
	return () => {
		subscribers.delete(subscriber)
	}
}
export function resetAtlasEditorOpenRequests() {
	counter = 0
	lastRequest = null
	retainedTarget = null
	subscribers.clear()
	foregroundPresentation = null
	presentationSubscribers.clear()
}
