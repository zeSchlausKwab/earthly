import type {
	AccountSessionService,
	LocalNodeService,
	PublishOutboxService,
	SavedRegionService,
	SupportDiagnosticsService,
} from './contracts'
import { webLocalNodeService } from './web/localNode'
import { webSavedRegionService } from './web/savedRegions'

let pendingNativeDeepLink: string | null = null

export const LOCAL_BLOBS_CHANGED_EVENT = 'earthly:local-blobs-changed'
export const NATIVE_DEEP_LINK_EVENT = 'earthly:native-deep-link'
export const PUBLISH_OUTBOX_CHANGED_EVENT = 'earthly:publish-outbox-changed'

export interface LocalBlobsChangedDetail {
	hashes: string[]
	revision: number
}

export interface NativeDeepLinkDetail {
	url: string
}

let localBlobRevision = 0

/** The browser keeps its localStorage session; native apps live in `apps/native/`. */
export function getAccountSessionService(): Promise<AccountSessionService | null> {
	return Promise.resolve(null)
}

export function getLocalNodeService(): Promise<LocalNodeService> {
	return Promise.resolve(webLocalNodeService)
}

/** The browser deliberately has no durable publish outbox. */
export function getPublishOutboxService(): Promise<PublishOutboxService | null> {
	return Promise.resolve(null)
}

export function getSavedRegionService(): Promise<SavedRegionService> {
	return Promise.resolve(webSavedRegionService)
}

/** Redacted native health reports are available only in the native Flutter/Rust apps. */
export function getSupportDiagnosticsService(): Promise<SupportDiagnosticsService | null> {
	return Promise.resolve(null)
}

/** Notify mounted delivery surfaces after an enqueue or state transition. */
export function notifyPublishOutboxChanged(): void {
	if (typeof window === 'undefined') return
	window.dispatchEvent(new Event(PUBLISH_OUTBOX_CHANGED_EVENT))
}

/** Browser build does not register an OS deep-link bridge. */
export function startNativeDeepLinks(): Promise<void> {
	return Promise.resolve()
}

export function getPendingNativeDeepLink(): string | null {
	return pendingNativeDeepLink
}

export function consumePendingNativeDeepLink(url: string): void {
	if (pendingNativeDeepLink === url) pendingNativeDeepLink = null
}

export function getLocalBlobRevision(): number {
	return localBlobRevision
}

export function notifyLocalBlobsChanged(hashes: string[]): void {
	localBlobRevision += 1
	if (typeof window === 'undefined') return
	window.dispatchEvent(
		new CustomEvent<LocalBlobsChangedDetail>(LOCAL_BLOBS_CHANGED_EVENT, {
			detail: { hashes, revision: localBlobRevision },
		}),
	)
}
