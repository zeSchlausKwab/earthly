import { isTauri } from '@/config/platform'
import type { LocalNodeService, PublishOutboxService } from './contracts'
import { webLocalNodeService } from './web/localNode'

let localNodeServicePromise: Promise<LocalNodeService> | null = null
let nativeDeepLinksPromise: Promise<void> | null = null
let publishOutboxServicePromise: Promise<PublishOutboxService | null> | null = null
let pendingNativeDeepLink: string | null = null

export const LOCAL_BLOBS_CHANGED_EVENT = 'earthly:local-blobs-changed'
export const NATIVE_DEEP_LINK_EVENT = 'earthly:native-deep-link'

export interface LocalBlobsChangedDetail {
	hashes: string[]
	revision: number
}

export interface NativeDeepLinkDetail {
	url: string
}

let localBlobRevision = 0

export function getLocalNodeService(): Promise<LocalNodeService> {
	localNodeServicePromise ??= isTauri()
		? import('./tauri/localNode').then(({ tauriLocalNodeService }) => tauriLocalNodeService)
		: Promise.resolve(webLocalNodeService)
	return localNodeServicePromise
}

/** The browser deliberately has no durable publish outbox. */
export function getPublishOutboxService(): Promise<PublishOutboxService | null> {
	publishOutboxServicePromise ??= isTauri()
		? import('./tauri/outbox').then(({ tauriPublishOutboxService }) => tauriPublishOutboxService)
		: Promise.resolve(null)
	return publishOutboxServicePromise
}

/** Start the OS URL bridge once; the browser build deliberately remains inert. */
export function startNativeDeepLinks(): Promise<void> {
	if (!isTauri()) return Promise.resolve()
	nativeDeepLinksPromise ??= import('./tauri/deepLinks')
		.then(({ startTauriDeepLinks }) =>
			startTauriDeepLinks((urls) => {
				for (const url of urls) notifyNativeDeepLink(url)
			}),
		)
		.catch((error) => {
			nativeDeepLinksPromise = null
			console.warn('Unable to start native deep-link handling', error)
		})
	return nativeDeepLinksPromise
}

export function getPendingNativeDeepLink(): string | null {
	return pendingNativeDeepLink
}

export function consumePendingNativeDeepLink(url: string): void {
	if (pendingNativeDeepLink === url) pendingNativeDeepLink = null
}

function notifyNativeDeepLink(url: string): void {
	pendingNativeDeepLink = url
	if (typeof window === 'undefined') return
	window.dispatchEvent(
		new CustomEvent<NativeDeepLinkDetail>(NATIVE_DEEP_LINK_EVENT, { detail: { url } }),
	)
}

export function getLocalBlobRevision(): number {
	return localBlobRevision
}

export function notifyLocalBlobsChanged(hashes: string[]): void {
	localBlobRevision += 1
	if (typeof window === 'undefined') return
	window.dispatchEvent(
		new CustomEvent<LocalBlobsChangedDetail>(LOCAL_BLOBS_CHANGED_EVENT, {
			detail: { hashes: [...new Set(hashes)], revision: localBlobRevision },
		}),
	)
}
