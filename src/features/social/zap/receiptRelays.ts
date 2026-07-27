import { config } from '@/config'
import { readRelaysFor } from '@/lib/nostr/relay-router'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

function dedupe(relays: string[]): string[] {
	return relays.filter((relay, index) => relays.indexOf(relay) === index)
}

function isExternallyReachableRelay(relay: string): boolean {
	try {
		const url = new URL(relay)
		return (url.protocol === 'ws:' || url.protocol === 'wss:') && !LOOPBACK_HOSTS.has(url.hostname)
	} catch {
		return false
	}
}

/**
 * NIP-57 services must be able to publish the receipt from their own server.
 * Prefer public write relays, then configured public read relays. A local-only
 * setup remains usable for deterministic tests, but cannot receive a remote
 * Lightning provider's receipt.
 */
export function selectZapReceiptRelays(writeRelays: string[], readRelays: string[]): string[] {
	const configured = dedupe([...writeRelays, ...readRelays])
	const publicRelays = configured.filter(isExternallyReachableRelay)
	return publicRelays.length ? publicRelays : configured
}

export function zapReceiptDeliveryRelays(): string[] {
	return selectZapReceiptRelays(config.writeRelays, readRelaysFor('zap'))
}

/** Watch both the advertised public relays and the current content relay. */
export function zapReceiptWatchRelays(): string[] {
	return dedupe([...zapReceiptDeliveryRelays(), ...readRelaysFor('content')])
}
