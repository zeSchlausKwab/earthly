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
 * Hand a protocol URI to the operating system via standard browser navigation.
 */
export async function openExternalProtocol(url: string): Promise<void> {
	const value = assertAllowedExternalProtocol(url)
	window.location.assign(value)
}
