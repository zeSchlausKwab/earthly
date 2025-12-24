/**
 * Platform Detection Utilities
 *
 * Handles Tauri and platform-specific detection.
 * Kept separate from environment configuration.
 */

/**
 * Detect if running in Tauri (desktop or mobile)
 */
export function isTauri(): boolean {
	if (typeof window === 'undefined') return false
	const w = window as Window & {
		__TAURI__?: unknown
		__TAURI_INTERNAL__?: unknown
	}
	return !!w.__TAURI__ || !!w.__TAURI_INTERNAL__
}

/**
 * Platform types that can be detected
 */
export type Platform = 'android' | 'ios' | 'macos' | 'windows' | 'linux' | 'web'

/**
 * Detect the current platform when running in Tauri.
 * Returns "web" for non-Tauri contexts.
 */
export async function getPlatform(): Promise<Platform> {
	if (!isTauri()) return 'web'

	try {
		// @ts-expect-error - Tauri API may not be available at compile time
		const { platform } = await import('@tauri-apps/api/os')
		const platformName = await platform()

		// Map Tauri platform names to our Platform type
		const platformMap: Record<string, Platform> = {
			android: 'android',
			ios: 'ios',
			darwin: 'macos',
			macos: 'macos',
			windows: 'windows',
			win32: 'windows',
			linux: 'linux'
		}

		return platformMap[platformName] ?? 'web'
	} catch {
		return 'web'
	}
}

/**
 * Check if running on a mobile platform (Android or iOS)
 */
export async function isMobile(): Promise<boolean> {
	const platform = await getPlatform()
	return platform === 'android' || platform === 'ios'
}

/**
 * Get platform-specific localhost address.
 * Android emulator needs 10.0.2.2 to reach host machine.
 */
export async function getLocalhostAddress(): Promise<string> {
	const platform = await getPlatform()
	return platform === 'android' ? '10.0.2.2' : 'localhost'
}
