import { expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import { EMPTY, NEVER, Observable, of } from 'rxjs'
import { readRelayEvents } from './finiteRead'

const event = { id: 'a' } as NostrEvent
const filters = { kinds: [1] }

test('finite reads distinguish empty success, partial results, and all failed', async () => {
	const pool = {
		relay: (url: string) => ({
			request: () =>
				url === 'empty'
					? EMPTY
					: new Observable<NostrEvent>((observer) => {
							observer.next(event)
							observer.error(new Error('closed'))
						}),
		}),
	}
	const results = await readRelayEvents(pool, ['empty', 'failed'], filters)
	expect(results[0]).toEqual({ relay: 'empty', ok: true, events: [] })
	expect(results[1]).toMatchObject({ relay: 'failed', ok: false, events: [event] })
	const failed = await readRelayEvents(pool, ['failed'], filters)
	expect(failed.some((result) => result.ok)).toBe(false)
})

test('silent relays have a total deadline and release their subscriptions', async () => {
	let released = false
	const pool = {
		relay: () => ({
			request: () =>
				new Observable<NostrEvent>(() => () => {
					released = true
				}),
		}),
	}
	const [result] = await readRelayEvents(pool, ['silent'], filters, { timeoutMs: 5 })
	expect(result?.ok).toBe(false)
	expect(released).toBe(true)
})

test('abort cancels every source and rejects the whole read', async () => {
	const controller = new AbortController()
	const result = readRelayEvents({ relay: () => ({ request: () => NEVER }) }, ['a', 'b'], filters, {
		signal: controller.signal,
	})
	controller.abort(new Error('cancelled'))
	await expect(result).rejects.toThrow('cancelled')
})

test('a bounded read rejects oversized streams and ignores late records', async () => {
	const [result] = await readRelayEvents(
		{ relay: () => ({ request: () => of(event, event, event) }) },
		['a'],
		filters,
		{ maxEvents: 1 },
	)
	expect(result).toMatchObject({ ok: false, events: [event] })
})
