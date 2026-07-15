import { isTauri } from '@/config/platform'
import type { LocalNodeService } from './contracts'
import { webLocalNodeService } from './web/localNode'

let localNodeServicePromise: Promise<LocalNodeService> | null = null

export const LOCAL_BLOBS_CHANGED_EVENT = 'earthly:local-blobs-changed'

export interface LocalBlobsChangedDetail {
	hashes: string[]
	revision: number
}

let localBlobRevision = 0

export function getLocalNodeService(): Promise<LocalNodeService> {
	localNodeServicePromise ??= isTauri()
		? import('./tauri/localNode').then(({ tauriLocalNodeService }) => tauriLocalNodeService)
		: Promise.resolve(webLocalNodeService)
	return localNodeServicePromise
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
