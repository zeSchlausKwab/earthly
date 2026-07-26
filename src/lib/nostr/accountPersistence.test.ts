import { describe, expect, test } from 'bun:test'
import { AccountManager } from 'applesauce-accounts'
import { PrivateKeyAccount, registerCommonAccountTypes } from 'applesauce-accounts/accounts'
import type { AccountSession, AccountSessionService } from '@/platform/contracts'
import {
	createAccountSessionSnapshot,
	reconcileAccountSession,
	restoreAccountSessionSnapshot,
	type RememberedAccountMetadata,
} from './accountPersistence'

function manager() {
	const value = new AccountManager<RememberedAccountMetadata>()
	registerCommonAccountTypes(value)
	return value
}

function rememberedManager() {
	const value = manager()
	const account = PrivateKeyAccount.fromKey<RememberedAccountMetadata>('11'.repeat(32))
	account.metadata = { ephemeral: false }
	value.addAccount(account)
	value.setActive(account)
	return value
}

class MemoryAccountSessionService implements AccountSessionService {
	snapshot: AccountSession | null
	saves: AccountSession[] = []

	constructor(snapshot: AccountSession | null = null) {
		this.snapshot = snapshot
	}

	async load() {
		return this.snapshot
	}

	async save(input: AccountSession) {
		this.snapshot = input
		this.saves.push(input)
		return input
	}
}

describe('native account session persistence', () => {
	test('restores a remembered account and active identity from a native snapshot', async () => {
		const source = rememberedManager()
		const target = manager()
		const service = new MemoryAccountSessionService(createAccountSessionSnapshot(source))

		expect(await reconcileAccountSession(target, service)).toBe('native')
		expect(target.accounts).toHaveLength(1)
		expect(target.active?.id).toBe(source.active?.id)
	})

	test('mirrors valid local accounts instead of replacing them', async () => {
		const local = rememberedManager()
		const other = rememberedManager()
		const otherAccount = PrivateKeyAccount.fromKey<RememberedAccountMetadata>('22'.repeat(32))
		otherAccount.metadata = { ephemeral: false }
		other.addAccount(otherAccount)
		other.setActive(otherAccount)
		const service = new MemoryAccountSessionService(createAccountSessionSnapshot(other))

		expect(await reconcileAccountSession(local, service)).toBe('local')
		expect(service.saves).toHaveLength(1)
		expect(service.snapshot?.activeAccountId).toBe(local.active?.id)
	})

	test('never serializes an ephemeral account', () => {
		const value = manager()
		const account = PrivateKeyAccount.fromKey<RememberedAccountMetadata>('33'.repeat(32))
		account.metadata = { ephemeral: true }
		value.addAccount(account)
		value.setActive(account)

		expect(createAccountSessionSnapshot(value)).toEqual({
			version: 1,
			accountsJson: '[]',
			activeAccountId: null,
		})
	})

	test('ignores an active id that is absent from the snapshot', () => {
		const source = rememberedManager()
		const snapshot = {
			...createAccountSessionSnapshot(source),
			activeAccountId: 'missing-account',
		}
		const target = manager()

		restoreAccountSessionSnapshot(target, snapshot)
		expect(target.accounts).toHaveLength(1)
		expect(target.active).toBeUndefined()
	})
})
