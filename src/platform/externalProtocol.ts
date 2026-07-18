import { isTauri } from '@/config/platform'

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['bunker:', 'lightning:', 'nostrconnect:'])

export function normalizeLightningUri(invoice: string): string {
	const value = invoice.trim()
	return value.toLowerCase().startsWith('lightning:') ? value : `lightning:${value}`
}

export function assertAllowedExternalProtocol(url: string): string {
	const value = url.trim()
	let protocol: string
	try {
		protocol = new URL(value).protocol.toLowerCase()
	} catch {
		throw new Error('Invalid external-app link')
	}

	if (!ALLOWED_EXTERNAL_PROTOCOLS.has(protocol)) {
		throw new Error(`Earthly cannot open ${protocol || 'this'} links in another app`)
	}
	return value
}

/**
 * Hand a protocol URI to Android/iOS through Tauri. The browser fallback keeps
 * the same tap-to-open behavior for installed PWAs and mobile browsers.
 */
export async function openExternalProtocol(url: string): Promise<void> {
	const value = assertAllowedExternalProtocol(url)
	if (isTauri()) {
		const { openUrl } = await import('@tauri-apps/plugin-opener')
		await openUrl(value)
		return
	}

	window.location.assign(value)
}
