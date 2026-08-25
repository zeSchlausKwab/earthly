import { describe, expect, test } from 'bun:test'
import type { EventSigner } from 'applesauce-core/factories/types'
import { assertCanDeleteOwnedEntity } from './deletion'

const signerFor = (pubkey: string): EventSigner => ({
	getPublicKey: () => pubkey,
	signEvent: () => {
		throw new Error('The ownership preflight must not sign.')
	},
})

describe('assertCanDeleteOwnedEntity', () => {
	test('allows the active author', async () => {
		await expect(
			assertCanDeleteOwnedEntity({ pubkey: 'author' }, signerFor('author'), 'Dataset'),
		).resolves.toBeUndefined()
	})

	test('rejects a different active account', async () => {
		await expect(
			assertCanDeleteOwnedEntity({ pubkey: 'author' }, signerFor('other'), 'Story'),
		).rejects.toThrow('Only the author can delete this story.')
	})

	test('rejects a target without an author', async () => {
		await expect(assertCanDeleteOwnedEntity({}, signerFor('author'), 'Context')).rejects.toThrow(
			'Context is missing an author',
		)
	})
})
