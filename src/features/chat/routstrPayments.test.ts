import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import * as walletActions from '@/lib/wallet/actions'
import { PrivateKeyAccount } from 'applesauce-accounts/accounts'
import { accounts, type EarthlyAccountMetadata } from '@/lib/nostr'
import {
	createRoutstrPayment,
	fetchCashuRefund,
	pendingRoutstrPaymentKeys,
	recoverRoutstrPayments,
} from './routstrPayments'

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let previousWindow: PropertyDescriptor | undefined
const originalFetch = globalThis.fetch
const originalAccount = accounts.active
const owner = PrivateKeyAccount.fromKey<EarthlyAccountMetadata>('33'.repeat(32))
const other = PrivateKeyAccount.fromKey<EarthlyAccountMetadata>('44'.repeat(32))
accounts.addAccount(owner)
accounts.addAccount(other)

beforeEach(() => {
	previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
	Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
	const storage = Object.create(null)
	Object.defineProperties(storage, {
		getItem: { value: (key: string) => storage[key] ?? null },
		setItem: {
			value: (key: string, value: string) => {
				storage[key] = value
			},
		},
		removeItem: {
			value: (key: string) => {
				delete storage[key]
			},
		},
	})
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
	accounts.setActive(owner)
})
afterEach(() => {
	if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
	else Reflect.deleteProperty(globalThis, 'window')
	if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
	else Reflect.deleteProperty(globalThis, 'localStorage')
	globalThis.fetch = originalFetch
	if (originalAccount) accounts.setActive(originalAccount)
	else accounts.clearActive()
})

test('persists an encrypted receipt before payment and keeps it when refund minting is delayed', async () => {
	const payment = createRoutstrPayment(owner, 'https://routstr.example/v1/')
	await payment.prepare('cashu-test-secret')
	const keys = pendingRoutstrPaymentKeys(owner.pubkey)
	expect(keys).toHaveLength(1)
	const ciphertext = localStorage.getItem(keys[0] ?? '') ?? ''
	expect(ciphertext).not.toContain('cashu-test-secret')
	const record = JSON.parse(await owner.signer.nip44.decrypt(owner.pubkey, ciphertext))
	expect(record.token).toBe('cashu-test-secret')
	globalThis.fetch = (async () => new Response('', { status: 425 })) as unknown as typeof fetch
	await expect(payment.settle()).rejects.toThrow('still preparing')
	expect(pendingRoutstrPaymentKeys(owner.pubkey)).toEqual(keys)
})

test('does not redeem a payment into a different active wallet', async () => {
	const payment = createRoutstrPayment(owner, 'https://routstr.example/v1')
	await payment.prepare('cashu-test-secret')
	accounts.setActive(other)
	let requested = false
	globalThis.fetch = (async () => {
		requested = true
		return Response.json({ token: 'refund' })
	}) as unknown as typeof fetch
	await expect(payment.settle()).rejects.toThrow('paying account')
	expect(requested).toBe(false)
	expect(pendingRoutstrPaymentKeys(other.pubkey)).toHaveLength(0)
	expect(pendingRoutstrPaymentKeys(owner.pubkey)).toHaveLength(1)
})

test('uses the current POST refund endpoint and keeps the bearer token out of URLs', async () => {
	let url = ''
	let init: RequestInit | undefined
	globalThis.fetch = (async (input, options) => {
		url = String(input)
		init = options
		return Response.json({ token: 'cashu-refund' })
	}) as typeof fetch
	expect(await fetchCashuRefund('https://routstr.example/v1/', 'cashu-payment')).toBe(
		'cashu-refund',
	)
	expect(url).toBe('https://routstr.example/v1/balance/refund')
	expect(init?.method).toBe('POST')
	expect(new Headers(init?.headers).get('X-Cashu')).toBe('cashu-payment')
})

test('retains the minted refund until wallet publication succeeds and retries without fetching again', async () => {
	const receive = spyOn(walletActions, 'receiveCashuToken')
	try {
		receive
			.mockRejectedValueOnce(new Error('relay rejected publication'))
			.mockResolvedValue(undefined)
		let requests = 0
		globalThis.fetch = (async () => {
			requests++
			return Response.json({ token: 'cashu-refund' })
		}) as unknown as typeof fetch
		const payment = createRoutstrPayment(owner, 'https://routstr.example/v1')
		await payment.prepare('cashu-payment')
		await expect(payment.settle()).rejects.toThrow('relay rejected')
		expect(pendingRoutstrPaymentKeys(owner.pubkey)).toHaveLength(1)
		expect(await recoverRoutstrPayments()).toEqual({ recovered: 1, pending: 0 })
		expect(requests).toBe(1)
		expect(receive).toHaveBeenLastCalledWith('cashu-refund')
		expect(pendingRoutstrPaymentKeys(owner.pubkey)).toHaveLength(0)
	} finally {
		receive.mockRestore()
	}
})
