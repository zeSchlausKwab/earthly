import { invoke } from '@tauri-apps/api/core'
import { nativeSchemas, type SupportDiagnosticsService } from '../contracts'

function commandError(error: unknown): Error {
	if (typeof error === 'object' && error !== null && 'message' in error) {
		return new Error(String(error.message))
	}
	return new Error(String(error))
}

export const tauriSupportDiagnosticsService: SupportDiagnosticsService = {
	collect: async () => {
		try {
			return nativeSchemas.supportDiagnosticReport.parse(await invoke('support_diagnostics_v1'))
		} catch (error) {
			throw commandError(error)
		}
	},
}
