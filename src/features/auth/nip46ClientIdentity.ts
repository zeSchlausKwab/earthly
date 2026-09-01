import type { Platform } from '@/config/platform'

const PLATFORM_LABELS: Record<Platform, string> = {
	android: 'Android',
	ios: 'iOS',
	linux: 'Linux',
	macos: 'macOS',
	web: 'Web',
	windows: 'Windows',
}

/** Human-readable NIP-46 client name shown by compatible remote signers. */
export function getNip46ClientName(platform: Platform): string {
	return `Earthly City (${PLATFORM_LABELS[platform]})`
}
