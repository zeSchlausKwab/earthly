import type { MapletIdentity } from '@/lib/maplets/config'
import type { MapletDataDependencies } from '@/lib/maplets/data'
import { myMapsModel } from './myMapsModel'

/** One-time device migration for the reviewed bundled app, within the current account only. */
export function migrateMyMapsStorage(
	storage: MapletDataDependencies['storage'],
	identity: MapletIdentity,
	pubkey: string,
): boolean {
	if (identity.dTag !== 'bundled:my-maps-viewer' || (pubkey && !/^[a-f0-9]{64}$/.test(pubkey)))
		return false
	const account = pubkey || 'anonymous'
	const prefix = `earthly:maplet-storage:${identity.dTag}:`
	const stableKey = `${prefix}${account}:saved`
	// Even invalid current data belongs to the user; never replace it implicitly.
	if (storage.getItem(stableKey) !== null) return false
	const suffix = `:${account}:saved`
	const candidates: string[] = []
	for (let index = 0; index < storage.length; index++) {
		const key = storage.key(index)
		if (!key?.startsWith(prefix) || !key.endsWith(suffix)) continue
		const hash = key.slice(prefix.length, -suffix.length)
		if (/^[a-f0-9]{64}$/.test(hash)) candidates.push(key)
	}
	// Storage has no update timestamps. Prefer an exact current artifact match,
	// then inspect older namespaces from the most recently enumerated entry.
	const currentKey = `${prefix}${identity.aggregateHash}${suffix}`
	const ordered = candidates
		.reverse()
		.sort((a, b) => Number(b === currentKey) - Number(a === currentKey))
	for (const key of ordered) {
		let value: string
		try {
			const old = storage.getItem(key)
			if (old === null || old.length > 128 * 1024) continue
			value = JSON.stringify(myMapsModel.preferences(JSON.parse(old)))
			if (value.length > 128 * 1024) continue
		} catch {
			continue
		}
		let total = value.length
		const stablePrefix = `${prefix}${account}:`
		for (let index = 0; index < storage.length; index++) {
			const entry = storage.key(index)
			if (entry?.startsWith(stablePrefix)) total += storage.getItem(entry)?.length ?? 0
		}
		if (total > 256 * 1024) return false
		storage.setItem(stableKey, value)
		return true
	}
	return false
}
