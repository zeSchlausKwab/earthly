import { expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import { BehaviorSubject, filter, firstValueFrom, of, Subject } from 'rxjs'
import {
	createSocialCounts,
	earthlyCommentMetric,
	earthlyReactionMetric,
	socialCountTarget,
} from './socialCounts'

const target = socialCountTarget({
	id: 'a'.repeat(64),
	kind: 37515,
	pubkey: 'b'.repeat(64),
	created_at: 10,
	tags: [['d', 'map']],
} as NostrEvent)

test('Earthly COUNT metrics use stable addresses and custom geographic comment roots', () => {
	expect(earthlyReactionMetric.filters(target)).toEqual([
		{ kinds: [7], '#a': [`37515:${'b'.repeat(64)}:map`] },
	])
	expect(earthlyCommentMetric.filters(target)).toEqual([
		{ kinds: [37517], '#A': [target.address!] },
	])
	expect(earthlyReactionMetric.filters({ ...target, address: undefined })).toEqual([
		{ kinds: [7], '#e': [target.id] },
	])
	expect(earthlyCommentMetric.filters({ ...target, address: undefined })).toBeUndefined()
})

test('COUNT is lazy, shared across revisions, and never sums relay answers', async () => {
	const responses = new Subject<{ count: number; approximate?: boolean }>()
	let requests = 0
	const counts = createSocialCounts({
		pool: {
			relay: () => ({
				count: () => {
					requests++
					return responses
				},
			}),
		},
		relays$: of(['wss://one.test', 'wss://two.test']),
		scope$: of('alice'),
		auth: () => ({ waitForAuth: false }),
	})
	const values: Array<number | undefined> = []
	expect(requests).toBe(0)
	const first = counts
		.observe(target, earthlyReactionMetric)
		.subscribe((state) => values.push(state.value))
	const second = counts
		.observe({ ...target, id: 'c'.repeat(64), created_at: 20 }, earthlyReactionMetric)
		.subscribe()
	await Promise.resolve()
	await Promise.resolve()
	expect(requests).toBe(1)
	const resolved = firstValueFrom(
		counts
			.observe(target, earthlyReactionMetric)
			.pipe(filter((state) => state.value !== undefined)),
	)
	responses.next({ count: 7, approximate: true })
	responses.complete()
	await resolved
	expect(values.at(-1)).toBe(7)
	first.unsubscribe()
	second.unsubscribe()
	expect(responses.observed).toBe(false)
	counts.stop()
})

test('zero is a known count; account switch discards old authenticated work', async () => {
	const scope$ = new BehaviorSubject('alice')
	let requests = 0
	const counts = createSocialCounts({
		pool: {
			relay: () => ({
				count: () => {
					requests++
					return of({ count: 0 })
				},
			}),
		},
		relays$: of(['wss://one.test']),
		scope$,
		auth: () => ({ waitForAuth: scope$.value }),
	})
	const states: number[] = []
	const sub = counts.observe(target, earthlyReactionMetric).subscribe((state) => {
		if (state.value !== undefined) states.push(state.value)
	})
	await Promise.resolve()
	await Promise.resolve()
	expect(states).toEqual([0])
	scope$.next('bob')
	await Promise.resolve()
	await Promise.resolve()
	expect(requests).toBe(2)
	expect(states).toEqual([0, 0])
	sub.unsubscribe()
	counts.stop()
})
