import type {
	OutboxEnqueueRequest,
	OutboxItem,
	OutboxRelayResult,
	PublishOutboxService,
} from '@/platform/contracts'
import { PlatformCommandError } from '@/platform/errors'

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

/**
 * Enqueueing is idempotent because the native outbox keys rows by the signed
 * event id. A transient Tauri command failure can therefore be retried once
 * without publishing a duplicate or asking the user to sign again.
 */
export async function enqueueDurablePublish(
	service: PublishOutboxService,
	input: OutboxEnqueueRequest,
): Promise<OutboxItem> {
	try {
		return await service.enqueue(input)
	} catch (error) {
		if (!(error instanceof PlatformCommandError)) throw error
		return service.enqueue(input)
	}
}
