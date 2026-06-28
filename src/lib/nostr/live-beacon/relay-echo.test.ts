/**
 * Wave-0 Nyquist BEACON-02 honesty check — a `bun relay`-backed INTEGRATION test.
 *
 * The OPEN phase decision was: replaceable (parameterized) + NIP-40, NOT
 * ephemeral. This test is the relay-echo that proves the two load-bearing
 * properties of that choice against a real Khatru relay:
 *
 *   1. LATEST-WINS: publishing two 37521 events with the SAME `d` and increasing
 *      `created_at` leaves the relay serving exactly ONE event (the newer) for
 *      `{ kinds:[37521], authors:[pubkey], '#d':[d] }` — the parameterized-
 *      replaceable semantics the heartbeat relies on (every heartbeat overwrites
 *      the previous position, no history pile-up).
 *
 *   2. CLIENT dropExpired is authoritative (SPEC-05): relay NIP-40 GC is lazy and
 *      untrusted, so even if the relay still returns an expired beacon, the CLIENT
 *      `dropExpired(events, unixNow())` hides it.
 *
 * This test requires a running relay (`bun relay`, ws://localhost:3334). When no
 * relay is reachable it SKIPS rather than fails — CI without a relay still passes,
 * but the file documents + exercises the contract when run locally.
 *
 * Clock discipline: `created_at` / `expiration` / the dropExpired `now` are all
 * epoch SECONDS (UTC).
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { unixNow } from 'applesauce-core/helpers/time'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { dropExpired } from '@/lib/nostr/expiry'
import { LIVE_BEACON_KIND } from '@/lib/nostr/kinds'

const RELAY_URL = process.env.RELAY_URL ?? 'ws://localhost:3334'

/** Probe the relay once; tests self-skip when it's unreachable. */
let relayAvailable = false

function openSocket(url: string, timeoutMs = 1500): Promise<WebSocket | null> {
	return new Promise((resolve) => {
		let settled = false
		const ws = new WebSocket(url)
		const timeout = setTimeout(() => {
			if (settled) return
			settled = true
			try {
				ws.close()
			} catch {
				// ignore
			}
			resolve(null)
		}, timeoutMs)
		ws.onopen = () => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			resolve(ws)
		}
		ws.onerror = () => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			resolve(null)
		}
	})
}

async function publishRaw(ws: WebSocket, event: unknown): Promise<void> {
	ws.send(JSON.stringify(['EVENT', event]))
	// Give the relay a moment to persist before the next publish / query.
	await new Promise((r) => setTimeout(r, 150))
}

function queryByD(
	url: string,
	filter: { kinds: number[]; authors: string[]; '#d': string[] },
	timeoutMs = 2500,
): Promise<unknown[]> {
	return new Promise((resolve) => {
		const collected: unknown[] = []
		const ws = new WebSocket(url)
		const subId = crypto.randomUUID().slice(0, 8)
		const timeout = setTimeout(finish, timeoutMs)
		function finish() {
			clearTimeout(timeout)
			try {
				ws.send(JSON.stringify(['CLOSE', subId]))
				ws.close()
			} catch {
				// ignore
			}
			resolve(collected)
		}
		ws.onopen = () => ws.send(JSON.stringify(['REQ', subId, filter]))
		ws.onmessage = (msg) => {
			try {
				const data = JSON.parse(msg.data as string)
				if (data[0] === 'EVENT' && data[1] === subId) collected.push(data[2])
				else if (data[0] === 'EOSE' && data[1] === subId) finish()
			} catch {
				// ignore parse errors
			}
		}
		ws.onerror = () => finish()
	})
}

beforeAll(async () => {
	const ws = await openSocket(RELAY_URL)
	if (ws) {
		relayAvailable = true
		ws.close()
	}
})

describe('live-beacon relay-echo — parameterized-replaceable latest-wins (BEACON-02)', () => {
	test('two 37521 with the same d ⇒ the relay serves exactly ONE (the newer)', async () => {
		if (!relayAvailable) {
			console.warn(`[relay-echo] no relay at ${RELAY_URL} — skipping latest-wins integration test`)
			return
		}

		const sk = generateSecretKey()
		const pubkey = getPublicKey(sk)
		const d = `echo-${crypto.randomUUID().slice(0, 8)}`
		const base = unixNow()

		const older = finalizeEvent(
			{
				kind: LIVE_BEACON_KIND,
				created_at: base,
				tags: [['d', d]],
				content: JSON.stringify({ modelVersion: 'earthly/2', status: 'live', seq: 1 }),
			},
			sk,
		)
		const newer = finalizeEvent(
			{
				kind: LIVE_BEACON_KIND,
				created_at: base + 30,
				tags: [['d', d]],
				content: JSON.stringify({ modelVersion: 'earthly/2', status: 'live', seq: 2 }),
			},
			sk,
		)

		const ws = await openSocket(RELAY_URL)
		expect(ws).not.toBeNull()
		if (!ws) return
		await publishRaw(ws, older)
		await publishRaw(ws, newer)
		ws.close()

		const results = (await queryByD(RELAY_URL, {
			kinds: [LIVE_BEACON_KIND],
			authors: [pubkey],
			'#d': [d],
		})) as { content: string; created_at: number }[]

		// parameterized-replaceable: exactly one survives, the newer.
		expect(results).toHaveLength(1)
		const surviving = results[0]
		expect(surviving?.created_at).toBe(base + 30)
		expect(JSON.parse(surviving?.content ?? '{}').seq).toBe(2)
	})
})

describe('live-beacon relay-echo — client dropExpired is authoritative (SPEC-05)', () => {
	test('an expired beacon is hidden by client dropExpired even if the relay returns it', async () => {
		if (!relayAvailable) {
			console.warn(`[relay-echo] no relay at ${RELAY_URL} — skipping dropExpired integration test`)
			return
		}

		const sk = generateSecretKey()
		const pubkey = getPublicKey(sk)
		const d = `expiry-${crypto.randomUUID().slice(0, 8)}`
		const now = unixNow()

		const expired = finalizeEvent(
			{
				kind: LIVE_BEACON_KIND,
				created_at: now - 120,
				tags: [
					['d', d],
					['expiration', String(now - 60)], // already in the past
				],
				content: JSON.stringify({ modelVersion: 'earthly/2', status: 'live' }),
			},
			sk,
		)

		const ws = await openSocket(RELAY_URL)
		expect(ws).not.toBeNull()
		if (!ws) return
		await publishRaw(ws, expired)
		ws.close()

		const results = (await queryByD(RELAY_URL, {
			kinds: [LIVE_BEACON_KIND],
			authors: [pubkey],
			'#d': [d],
		})) as { tags: string[][]; kind: number; content: string }[]

		// Regardless of whether the relay GC'd it, the CLIENT filter hides it.
		const visible = dropExpired(results as never[], unixNow())
		expect(visible).toHaveLength(0)
	})
})
