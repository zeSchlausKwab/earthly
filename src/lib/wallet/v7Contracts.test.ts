import { spendableTokenContent } from './tokenContent'
import { expect, test } from 'bun:test'
import { Amount, getDecodedToken, getEncodedToken, type Token } from '@cashu/cashu-ts'
import { setHiddenContentCache } from 'applesauce-core/helpers'
import { LocalStorageCouch, receiveAnimated, sendAnimated } from 'applesauce-wallet/helpers'
import type { NostrEvent } from 'nostr-tools'
import { firstValueFrom, Subject, filter, take, toArray } from 'rxjs'

const keysetId = '01' + 'ab'.repeat(32)
const token: Token = {
	mint: 'https://mint.invalid',
	unit: 'sat',
	proofs: [
		{ id: keysetId, amount: Amount.from(2), secret: 'offline-test', C: '02' + 'ab'.repeat(32) },
	],
}

test('v2 recovery preserves full keyset ids without contacting a mint', () => {
	const values = new Map<string, string>()
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			localStorage: {
				getItem: (key: string) => values.get(key) ?? null,
				setItem: (key: string, value: string) => values.set(key, value),
				removeItem: (key: string) => values.delete(key),
			},
		},
	})
	try {
		const couch = new LocalStorageCouch('v7-recovery-test')
		const clear = couch.store(token)
		expect(couch.getAll()[0]?.proofs[0]?.id).toBe(keysetId)
		clear()
		expect(couch.getAll()).toEqual([])
	} finally {
		if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
		else Reflect.deleteProperty(globalThis, 'window')
	}
})

test('compact v2 tokens resolve using full mint keyset ids', () => {
	const encoded = getEncodedToken(token)
	expect(getDecodedToken(encoded, [keysetId]).proofs[0]?.id).toBe(keysetId)
})

test('malformed unlocked tokens are not spendable content', () => {
	for (const content of ['null', '{}', 'not-json', '{"mint":1,"proofs":[]}']) {
		const event = {
			kind: 7375,
			pubkey: 'a'.repeat(64),
			content: '',
			tags: [],
		} as unknown as NostrEvent
		setHiddenContentCache(event, content)
		expect(spendableTokenContent(event)).toBeUndefined()
	}
})

test('animated QR fragments from a hot source survive asynchronous decoder setup', async () => {
	const encoded = getEncodedToken(token)
	const parts = await firstValueFrom(
		sendAnimated(encoded, { interval: 1, fragmentLength: 5000 }).pipe(take(1), toArray()),
	)
	const input = new Subject<string>()
	const received = firstValueFrom(
		receiveAnimated(input).pipe(filter((value): value is string => typeof value === 'string')),
	)
	for (const part of parts) input.next(part)
	input.complete()
	expect(await received).toBe(encoded)
})
