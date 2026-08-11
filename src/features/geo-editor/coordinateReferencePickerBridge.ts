/**
 * Small framework-free bridge between rich-text editors and the main map.
 * Editors can request one map click without knowing where the MapLibre instance
 * lives; GeoEditorView owns the crosshair/cancel UX and completes the request.
 */

export interface PickedCoordinate {
	/** GeoJSON/MapLibre order is longitude, latitude. */
	longitude: number
	latitude: number
}

export interface CoordinateReferencePickRequest {
	id: number
	onPick: (coordinate: PickedCoordinate) => void
}

let nextId = 0
let currentRequest: CoordinateReferencePickRequest | null = null
const subscribers = new Set<() => void>()

function notify(): void {
	for (const subscriber of subscribers) subscriber()
}

export function requestCoordinateReferencePick(
	onPick: (coordinate: PickedCoordinate) => void,
): () => void {
	nextId += 1
	const id = nextId
	currentRequest = { id, onPick }
	notify()
	return () => {
		if (currentRequest?.id !== id) return
		currentRequest = null
		notify()
	}
}

export function getCoordinateReferencePickRequest(): CoordinateReferencePickRequest | null {
	return currentRequest
}

export function completeCoordinateReferencePick(coordinate: PickedCoordinate): void {
	const request = currentRequest
	if (!request) return
	currentRequest = null
	notify()
	request.onPick(coordinate)
}

export function cancelCoordinateReferencePick(): void {
	if (!currentRequest) return
	currentRequest = null
	notify()
}

export function subscribeCoordinateReferencePickRequests(subscriber: () => void): () => void {
	subscribers.add(subscriber)
	return () => subscribers.delete(subscriber)
}

export function resetCoordinateReferencePicker(): void {
	currentRequest = null
	nextId = 0
	subscribers.clear()
}
