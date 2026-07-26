import type { AccountManager, SerializedAccount } from 'applesauce-accounts'
import type { AccountSession, AccountSessionService } from '@/platform/contracts'

export interface RememberedAccountMetadata {
	ephemeral?: boolean
}

export function createAccountSessionSnapshot<Metadata extends RememberedAccountMetadata>(
	manager: AccountManager<Metadata>,
): AccountSession {
	const remembered = manager.toJSON(true).filter((account) => !account.metadata?.ephemeral)
	const active =
		manager.active && !manager.active.metadata?.ephemeral
			? remembered.find((account) => account.id === manager.active?.id)
			: undefined
	return {
		version: 1,
		accountsJson: JSON.stringify(remembered),
		activeAccountId: active?.id ?? null,
	}
}

export function restoreAccountSessionSnapshot<Metadata extends RememberedAccountMetadata>(
	manager: AccountManager<Metadata>,
	snapshot: AccountSession,
): void {
	const parsed: unknown = JSON.parse(snapshot.accountsJson)
	if (!Array.isArray(parsed)) throw new Error('Serialized accounts must be a JSON array')
	manager.fromJSON(parsed as SerializedAccount<unknown, Metadata>[], true)
	if (!snapshot.activeAccountId) return
	const active = manager.getAccount(snapshot.activeAccountId)
	if (active) manager.setActive(active)
}

/**
 * Reconcile the browser's fast local cache with the native durable copy.
 * Existing remembered browser accounts win (migration/normal startup);
 * otherwise the native copy repairs a stale or unflushed WebView cache.
 */
export async function reconcileAccountSession<Metadata extends RememberedAccountMetadata>(
	manager: AccountManager<Metadata>,
	service: AccountSessionService,
): Promise<'local' | 'native' | 'empty'> {
	const local = createAccountSessionSnapshot(manager)
	const localAccounts: unknown = JSON.parse(local.accountsJson)
	if (Array.isArray(localAccounts) && localAccounts.length > 0) {
		await service.save(local)
		return 'local'
	}

	const native = await service.load()
	if (!native) return 'empty'
	restoreAccountSessionSnapshot(manager, native)
	return 'native'
}
