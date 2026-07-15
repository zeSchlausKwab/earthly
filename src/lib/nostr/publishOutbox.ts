import type { OutboxItem, OutboxRelayResult } from '@/platform/contracts'

function canonicalRelayUrl(relay: string): string {
	try {
		return new URL(relay).toString()
	} catch {
		return relay
	}
}

export function requiredPublishRelays(
	targetRelays: string[],
	configuredRelays: string[],
): string[] {
	const targets = new Set(targetRelays.map(canonicalRelayUrl))
	const baseline = [...new Set(configuredRelays.map(canonicalRelayUrl))].filter((relay) =>
		targets.has(relay),
	)
	return baseline.length > 0 ? baseline : [...new Set(targetRelays.map(canonicalRelayUrl))]
}

export function pendingOutboxRelays(item: OutboxItem): string[] {
	return item.relays
		.filter((relay) => relay.state !== 'acknowledged')
		.map((relay) => relay.relayUrl)
}

export function failedRelayResults(relays: string[], error: unknown): OutboxRelayResult[] {
	const message = error instanceof Error ? error.message : String(error)
	return relays.map((relayUrl) => ({ relayUrl, ok: false, message }))
}
