import { afterEach, expect, spyOn, test } from 'bun:test'
import { PrivateKeyAccount } from 'applesauce-accounts/accounts'
import { accounts } from '@/lib/nostr'
import { createWalletActions, getWalletCouch, walletActions } from './runtime'
import { sendCashuToken, withSpendLock } from './actions'

const previous = accounts.active
const a = PrivateKeyAccount.fromKey<Record<string, never>>('11'.repeat(32))
const b = PrivateKeyAccount.fromKey<Record<string, never>>('22'.repeat(32))
accounts.addAccount(a)
accounts.addAccount(b)
afterEach(() => {
	if (previous) accounts.setActive(previous)
	else accounts.clearActive()
})

test('wallet operation keeps its original signer and nested action identity after an account switch', async () => {
	accounts.setActive(a)
	const runner = createWalletActions()
	await runner.run(() => async ({ self, sign, run }) => {
		expect(self).toBe(a.pubkey)
		accounts.setActive(b)
		const signed = await sign({ kind: 1, content: '', tags: [], created_at: 1 })
		expect(signed.pubkey).toBe(a.pubkey)
		await run(() => async (nested) => {
			expect(nested.self).toBe(a.pubkey)
		})
	})
	await walletActions.run(() => async ({ self }) => {
		expect(self).toBe(b.pubkey)
	})
	expect(getWalletCouch(a.pubkey)).not.toBe(getWalletCouch(b.pubkey))
})

test('a queued spend cannot move to another account while waiting', async () => {
	accounts.setActive(a)
	let release!: () => void
	const first = withSpendLock(
		() =>
			new Promise<void>((resolve) => {
				release = resolve
			}),
	)
	await Promise.resolve()
	const queued = withSpendLock(async () => 'should not execute')
	accounts.setActive(b)
	release()
	await first
	await expect(queued).rejects.toThrow('Account changed')
})

test('receipt encryption failure retains both swapped change and outbound proofs', async () => {
	accounts.setActive(a)
	const send = { id: '00'.repeat(8), amount: 10, secret: 'out', C: `02${'11'.repeat(32)}` }
	const keep = { ...send, amount: 6, secret: 'change' }
	let cleared = false
	const couch = getWalletCouch(a.pubkey)
	const store = spyOn(couch, 'store').mockResolvedValue(async () => {
		cleared = true
	})
	const sendBuilder = {
		asRandom() {
			return this
		},
		keepAsRandom() {
			return this
		},
		keyset() {
			return this
		},
		async run() {
			return { keep: [keep], send: [send] }
		},
	}
	const cashuWallet = { ops: { send: () => sendBuilder } }
	const run = spyOn(walletActions, 'run').mockImplementation(async (_builder, ...args) => {
		const operation = args[1] as (input: {
			selectedProofs: (typeof send)[]
			mint: string
			cashuWallet: typeof cashuWallet
		}) => Promise<unknown>
		await operation({ selectedProofs: [send], mint: 'https://mint.example', cashuWallet })
	})
	try {
		await expect(
			sendCashuToken(10, {
				onTokenCreated: async () => {
					throw new Error('Signer unavailable')
				},
			}),
		).rejects.toThrow('Signer unavailable')
		expect(store).toHaveBeenCalledWith({
			mint: 'https://mint.example',
			unit: 'sat',
			proofs: [keep, send],
		})
		expect(cleared).toBe(false)
	} finally {
		run.mockRestore()
		store.mockRestore()
	}
})
