import { describe, expect, test } from 'bun:test'
import type { ActionContext } from 'applesauce-actions'
import { NutzapEvent, TokensOperation } from 'applesauce-wallet/actions'
import type { NostrEvent } from 'nostr-tools'
import { SendNutzapFromWallet } from './actions'

describe('SendNutzapFromWallet', () => {
	test('locks fresh send proofs to the recipient and publishes a NIP-61 event', async () => {
		const target = {
			id: '1'.repeat(64),
			pubkey: '2'.repeat(64),
			kind: 37518,
			created_at: 1,
			tags: [['d', 'test-context']],
			content: '{}',
			sig: '3'.repeat(128),
		} satisfies NostrEvent
		const selectedProof = { id: 'keyset-id', amount: 21, secret: 'in', C: '02aa' }
		const sendProof = { id: 'keyset-id', amount: 21, secret: 'out', C: '02bb' }
		const calls: Array<{ builder: unknown; args: unknown[] }> = []
		let lockedTo: string | undefined

		const sendBuilder = {
			asP2PK: ({ pubkey }: { pubkey: string }) => {
				lockedTo = pubkey
				return sendBuilder
			},
			keyset: () => sendBuilder,
			run: async () => ({ keep: [], send: [sendProof] }),
		}
		const cashuWallet = {
			ops: {
				send: () => sendBuilder,
			},
		}

		const action = SendNutzapFromWallet(target, 21, {
			mint: 'https://mint.example',
			p2pk: '02recipient',
			comment: 'Useful map',
		})
		const run: ActionContext['run'] = async (builder, ...args) => {
			calls.push({ builder, args })
			if (builder === TokensOperation) {
				const operation = args[1] as (input: {
					selectedProofs: (typeof selectedProof)[]
					mint: string
					cashuWallet: typeof cashuWallet
				}) => Promise<{ change?: unknown[] }>
				const result = await operation({
					selectedProofs: [selectedProof],
					mint: 'https://mint.example',
					cashuWallet,
				})
				expect(result.change).toBeUndefined()
			}
		}

		await action({ run } as unknown as ActionContext)

		expect(lockedTo).toBe('02recipient')
		expect(calls[0]?.builder).toBe(TokensOperation)
		expect(calls[0]?.args[0]).toBe(21)
		const nutzapCall = calls.find((call) => call.builder === NutzapEvent)
		expect(nutzapCall?.args[0]).toBe(target)
		expect(nutzapCall?.args[1]).toEqual({
			mint: 'https://mint.example',
			proofs: [sendProof],
			unit: 'sat',
		})
		expect(nutzapCall?.args[2]).toMatchObject({ comment: 'Useful map' })
	})
})
