import { isTauri } from '@/config/platform'
import type { LocalNodeService } from './contracts'
import { webLocalNodeService } from './web/localNode'

let localNodeServicePromise: Promise<LocalNodeService> | null = null

export function getLocalNodeService(): Promise<LocalNodeService> {
	localNodeServicePromise ??= isTauri()
		? import('./tauri/localNode').then(({ tauriLocalNodeService }) => tauriLocalNodeService)
		: Promise.resolve(webLocalNodeService)
	return localNodeServicePromise
}
