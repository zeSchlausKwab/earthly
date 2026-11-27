/**
 * Platform Detection Utilities
 *
 * The web app runs exclusively in browser contexts (native mobile & desktop
 * apps live in `apps/native/` using Flutter + Rust).
 */

export function isTauri(): boolean {
	return false
}

export type Platform = 'android' | 'ios' | 'macos' | 'windows' | 'linux' | 'web'

export async function getPlatform(): Promise<Platform> {
	return 'web'
}

export async function isMobile(): Promise<boolean> {
	return false
}

export async function getLocalhostAddress(): Promise<string> {
	return 'localhost'
}
