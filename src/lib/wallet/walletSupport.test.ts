import { expect, test } from 'bun:test'
import { Observable, of } from 'rxjs'
import { readWalletSupport } from './walletSupport'

test('silent NWC capability discovery times out and releases its demand', async () => {
	let released = false
	const support$ = new Observable<null>(() => () => {
		released = true
	})
	await expect(readWalletSupport({ support$ }, 5)).rejects.toThrow('Timeout')
	expect(released).toBe(true)
})

test('NWC capabilities are read once before status or payment', async () => {
	const support = { methods: ['pay_invoice'], encryption: ['nip44_v2' as const] }
	expect(await readWalletSupport({ support$: of(support) })).toEqual(support)
})
