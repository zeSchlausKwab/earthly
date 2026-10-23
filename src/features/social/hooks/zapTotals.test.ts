import { expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, type NostrEvent } from 'nostr-tools'
import { zapTotals } from './zapTotals'

const invoice =
	'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567'
const key = generateSecretKey()
const request = finalizeEvent(
	{
		kind: 9734,
		created_at: 1,
		content: '',
		tags: [
			['p', 'a'.repeat(64)],
			['relays', 'wss://relay.test'],
		],
	},
	key,
)
const receipt = finalizeEvent(
	{
		kind: 9735,
		created_at: 2,
		content: '',
		tags: [
			['bolt11', invoice],
			['description', JSON.stringify(request)],
		],
	},
	key,
)

test('Lightning amounts are decoded as millisats and returned in sats', () => {
	expect(zapTotals([receipt], request.pubkey)).toEqual({
		zapAmount: 2000,
		zapCount: 1,
		userHasZapped: true,
	})
})

test('malformed invoices and forged request descriptions do not create value or sender state', () => {
	const invalidInvoice = {
		...receipt,
		tags: [
			['bolt11', 'broken'],
			['description', JSON.stringify(request)],
		],
	}
	const invalidSender = {
		...receipt,
		tags: [
			['bolt11', invoice],
			['description', JSON.stringify({ ...request, sig: '0'.repeat(128) })],
		],
	}
	expect(zapTotals([invalidInvoice, invalidSender], request.pubkey)).toEqual({
		zapAmount: 0,
		zapCount: 0,
		userHasZapped: false,
	})
})

test('nutzap units are normalized and unsupported units do not count as sats', () => {
	const nutzap = (unit: string): NostrEvent => ({
		...receipt,
		kind: 9321,
		tags: [
			['unit', unit],
			['u', 'https://mint.test'],
			['p', request.pubkey],
			[
				'proof',
				JSON.stringify({ amount: 2000, id: '00aa', secret: 'test', C: '02' + 'a'.repeat(64) }),
			],
		],
	})
	expect(zapTotals([nutzap('sat'), nutzap('msat'), nutzap('usd')]).zapAmount).toBe(2002)
	expect(zapTotals([nutzap('usd')]).zapCount).toBe(0)
})
