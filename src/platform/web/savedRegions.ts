import type { SavedRegionService } from '../contracts'

const unsupported = (): never => {
	throw new Error('Saved map regions require the Earthly Android application')
}

export const webSavedRegionService: SavedRegionService = {
	supported: false,
	create: async () => unsupported(),
	list: async () => [],
	events: async () => unsupported(),
	retainDeletions: async () => ({ retainedEvents: 0, regionAttachments: 0 }),
	download: async () => unsupported(),
	repair: async () => unsupported(),
	cancel: async () => false,
	remove: async () => unsupported(),
	collectGarbage: async () => unsupported(),
	listenProgress: async () => () => undefined,
}
