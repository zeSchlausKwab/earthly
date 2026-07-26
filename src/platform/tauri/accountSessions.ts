import { invoke } from '@tauri-apps/api/core'
import { nativeSchemas, type AccountSession, type AccountSessionService } from '../contracts'

function commandError(error: unknown): Error {
	if (typeof error === 'object' && error !== null && 'message' in error) {
		return new Error(String(error.message))
	}
	return new Error(String(error))
}

export const tauriAccountSessionService: AccountSessionService = {
	load: async (): Promise<AccountSession | null> => {
		try {
			const value = await invoke('account_session_load_v1')
			return value === null ? null : nativeSchemas.accountSession.parse(value)
		} catch (error) {
			throw commandError(error)
		}
	},
	save: async (input: AccountSession): Promise<AccountSession> => {
		try {
			return nativeSchemas.accountSession.parse(await invoke('account_session_save_v1', { input }))
		} catch (error) {
			throw commandError(error)
		}
	},
}
