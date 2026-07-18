import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'

/**
 * Register before reading the launch URL so a link opened during bootstrap is
 * not lost between the two operations. Tauri may report the same URL through
 * both paths; the handoff is intentionally idempotent in the feature layer.
 */
export async function startTauriDeepLinks(onUrls: (urls: string[]) => void): Promise<void> {
	try {
		await onOpenUrl(onUrls)
	} catch (error) {
		console.warn('Unable to listen for native deep links', error)
	}

	try {
		const launchUrls = await getCurrent()
		if (launchUrls?.length) onUrls(launchUrls)
	} catch (error) {
		console.warn('Unable to read the native launch link', error)
	}
}
