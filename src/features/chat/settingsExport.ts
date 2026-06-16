import type { ChatSettingsSnapshot } from './store'

export const MAX_IMPORT_BYTES = 65536

export function serializeSnapshot(_snapshot: ChatSettingsSnapshot): string {
	throw new Error('not implemented')
}

export function validateImportedSnapshot(_parsed: unknown): ChatSettingsSnapshot {
	throw new Error('not implemented')
}
