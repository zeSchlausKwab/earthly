/**
 * Publish layer for the seeding pipeline, built directly on `applesauce-relay`
 * (no NDK compat shim). Owns:
 *
 *   - retry-with-backoff publishing (adapted from the old canonical seeder,
 *     which was the only script that survived flaky production relays)
 *   - the `--dry-run` seam: scenarios always call `client.publish()`; in
 *     dry-run mode the client enumerates the event instead of touching the
 *     network, so a dry run exercises the exact same code path
 *   - simple EOSE-bounded fetches (used by the purge scenario)
 */

import { RelayPool } from 'applesauce-relay'
import type { Filter, NostrEvent } from 'nostr-tools'
import { firstValueFrom, toArray } from 'rxjs'
import { assertRelayReachable, waitForRelay } from './health'

export interface SeedRelayClientOptions {
	dryRun?: boolean
	verbose?: boolean
	/** Per-attempt publish timeout. Generous for slow production relays. */
	publishTimeoutMs?: number
	maxAttempts?: number
	log?: (message: string) => void
}

export class SeedPublishError extends Error {}

export class SeedRelayClient {
	readonly url: string
	readonly dryRun: boolean
	readonly verbose: boolean
	private readonly publishTimeoutMs: number
	private readonly maxAttempts: number
	private readonly log: (message: string) => void
	private readonly pool = new RelayPool()
	/** Events published (or, in dry-run, enumerated) so far. */
	published = 0
	/** kind → count, for the end-of-run summary. */
	readonly publishedByKind = new Map<number, number>()

	constructor(url: string, options: SeedRelayClientOptions = {}) {
		this.url = url
		this.dryRun = options.dryRun ?? false
		this.verbose = options.verbose ?? false
		this.publishTimeoutMs = options.publishTimeoutMs ?? 20_000
		this.maxAttempts = options.maxAttempts ?? 5
		this.log = options.log ?? console.log
	}

	/** Fail fast if the relay is down. No-op in dry-run mode. */
	async connect(): Promise<void> {
		if (this.dryRun) return
		await assertRelayReachable(this.url)
	}

	/**
	 * Publish a signed event with retry + backoff. In dry-run mode the event is
	 * counted and enumerated instead.
	 */
	async publish(event: NostrEvent, label?: string): Promise<void> {
		this.published += 1
		this.publishedByKind.set(event.kind, (this.publishedByKind.get(event.kind) ?? 0) + 1)

		if (this.dryRun) {
			const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
			this.log(
				`  [dry-run] kind ${event.kind}${dTag ? ` d=${dTag}` : ''}${label ? ` — ${label}` : ''}`,
			)
			return
		}

		for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
			try {
				await this.publishOnce(event)
				if (this.verbose && label) this.log(`  ✓ ${label}`)
				return
			} catch (err) {
				if (attempt === this.maxAttempts) {
					throw new SeedPublishError(
						`publish failed after ${this.maxAttempts} attempts: ${
							err instanceof Error ? err.message : String(err)
						}`,
					)
				}
				const message = err instanceof Error ? err.message : String(err)
				const wait = 4000 * attempt
				this.log(`  [retry] attempt ${attempt} failed: ${message.slice(0, 80)}`)
				this.log(`  [retry] retrying in ${wait}ms...`)
				await new Promise((resolve) => setTimeout(resolve, wait))
				await waitForRelay(this.url, 10_000)
			}
		}
	}

	private async publishOnce(event: NostrEvent): Promise<void> {
		const responses = await Promise.race([
			this.pool.publish([this.url], event),
			new Promise<never>((_resolve, reject) =>
				setTimeout(
					() => reject(new Error('publish timed out — is the relay running? `bun relay`')),
					this.publishTimeoutMs,
				),
			),
		])
		const rejected = responses.find((response) => !response.ok)
		if (rejected) {
			throw new Error(`relay rejected event: ${rejected.message ?? 'no reason given'}`)
		}
	}

	/** Fetch all events matching `filters` (completes on EOSE). */
	async fetch(filters: Filter | Filter[]): Promise<NostrEvent[]> {
		const filterList = Array.isArray(filters) ? filters : [filters]
		return firstValueFrom(this.pool.request([this.url], filterList).pipe(toArray()))
	}

	/** One-line run summary, e.g. `42 events (37515×30, 0×12)`. */
	summary(): string {
		const byKind = [...this.publishedByKind.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([kind, count]) => `${kind}×${count}`)
			.join(', ')
		return `${this.published} events${byKind ? ` (${byKind})` : ''}`
	}
}
