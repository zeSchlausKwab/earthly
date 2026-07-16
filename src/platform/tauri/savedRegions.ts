import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
	nativeSchemas,
	type SavedRegion,
	type SavedRegionCreateRequest,
	type SavedRegionGarbageCollection,
	type SavedRegionProgress,
	type SavedRegionService,
} from '../contracts'

function commandError(error: unknown): Error {
	if (typeof error === 'object' && error !== null && 'message' in error) {
		return new Error(String(error.message))
	}
	return new Error(String(error))
}

async function invokeValidated<T>(
	command: string,
	schema: { parse(value: unknown): T },
	args?: Record<string, unknown>,
): Promise<T> {
	try {
		return schema.parse(await invoke(command, args))
	} catch (error) {
		throw commandError(error)
	}
}

export const tauriSavedRegionService: SavedRegionService = {
	supported: true,
	create: (input: SavedRegionCreateRequest): Promise<SavedRegion> =>
		invokeValidated('saved_region_create_v1', nativeSchemas.savedRegion, { input }),
	list: (): Promise<SavedRegion[]> =>
		invokeValidated('saved_region_list_v1', nativeSchemas.savedRegions),
	download: (id: string): Promise<SavedRegion> =>
		invokeValidated('saved_region_download_v1', nativeSchemas.savedRegion, { id }),
	repair: (id: string): Promise<SavedRegion> =>
		invokeValidated('saved_region_repair_v1', nativeSchemas.savedRegion, { id }),
	cancel: async (id: string): Promise<boolean> => {
		try {
			return Boolean(await invoke('saved_region_cancel_v1', { id }))
		} catch (error) {
			throw commandError(error)
		}
	},
	remove: async (id: string): Promise<boolean> => {
		try {
			return Boolean(await invoke('saved_region_remove_v1', { id }))
		} catch (error) {
			throw commandError(error)
		}
	},
	collectGarbage: (): Promise<SavedRegionGarbageCollection> =>
		invokeValidated('saved_region_collect_garbage_v1', nativeSchemas.savedRegionGarbageCollection),
	listenProgress: async (listener): Promise<() => void> =>
		listen('saved-region-progress-v1', (event) => {
			const parsed = nativeSchemas.savedRegionProgress.safeParse(event.payload)
			if (parsed.success) listener(parsed.data as SavedRegionProgress)
		}),
}
