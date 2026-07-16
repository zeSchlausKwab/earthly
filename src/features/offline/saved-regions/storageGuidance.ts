import { platformErrorCode } from '@/platform/errors'

export interface SavedRegionStorageGuidance {
	title: string
	detail: string
}

export function savedRegionStorageGuidance(
	errorOrCode: unknown,
): SavedRegionStorageGuidance | null {
	const code = typeof errorOrCode === 'string' ? errorOrCode : platformErrorCode(errorOrCode)
	if (code === 'region-insufficient-storage') {
		return {
			title: 'Not enough free space for this offline map',
			detail:
				'Clean unused map files, free device storage, or save a smaller area. Earthly keeps Android storage in reserve.',
		}
	}
	if (code === 'region-storage-write-failed' || code === 'region-storage-failed') {
		return {
			title: 'The offline map could not be written',
			detail:
				'Free device storage or clean unused map files, then choose Resume. Files that finished verification are kept, so the download continues instead of starting over.',
		}
	}
	return null
}
