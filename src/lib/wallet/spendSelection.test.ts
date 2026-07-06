import { describe, expect, test } from 'bun:test'
import { TokenContentSymbol, WALLET_TOKEN_KIND } from 'applesauce-wallet/helpers'
import type { NostrEvent } from 'nostr-tools'
import { selectSpendableTokens } from './actions'

const MINT = 'https://mint.example'

function tokenEvent(opts: {
	id: string
	createdAt: number
	amount: number
	deleted?: string[]
	publicDeleted?: string[]
}): NostrEvent {
	const event: NostrEvent = {
		id: opts.id,
		pubkey: 'pubkey',
		created_at: opts.createdAt,
		kind: WALLET_TOKEN_KIND,
		tags: (opts.publicDeleted ?? []).map((id) => ['del', id]),
		content: '',
		sig: 'sig',
	}
	Reflect.set(event, TokenContentSymbol, {
		mint: MINT,
		unit: 'sat',
		del: opts.deleted ?? [],
		proofs: [
			{
				id: `proof-${opts.id}`,
				amount: opts.amount,
				secret: `secret-${opts.id}`,
				C: `C-${opts.id}`,
			},
		],
	})
	return event
}

describe('selectSpendableTokens', () => {
	test('ignores token events marked deleted by public del tags', () => {
		const spent = tokenEvent({ id: 'spent', createdAt: 1, amount: 100 })
		const change = tokenEvent({
			id: 'change',
			createdAt: 2,
			amount: 90,
			publicDeleted: ['spent'],
		})

		const selected = selectSpendableTokens([spent, change], 50, MINT)

		expect(selected.events.map((event) => event.id)).toEqual(['change'])
		expect(selected.proofs.map((proof) => proof.secret)).toEqual(['secret-change'])
	})

	test('ignores token events marked deleted inside unlocked token content', () => {
		const spent = tokenEvent({ id: 'spent', createdAt: 1, amount: 100 })
		const change = tokenEvent({
			id: 'change',
			createdAt: 2,
			amount: 90,
			deleted: ['spent'],
		})

		const selected = selectSpendableTokens([spent, change], 50, MINT)

		expect(selected.events.map((event) => event.id)).toEqual(['change'])
		expect(selected.proofs.map((proof) => proof.secret)).toEqual(['secret-change'])
	})
})
