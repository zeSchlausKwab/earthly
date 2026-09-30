import { expect, test } from 'bun:test'
import { migrateMyMapsStorage } from './myMapsStorage'
import { myMapsModel } from './myMapsModel'

const identity = { dTag: 'bundled:my-maps-viewer', aggregateHash: 'a'.repeat(64) }
const pubkey = 'b'.repeat(64)
const prefix = `earthly:maplet-storage:${identity.dTag}:`
const legacyKey = (account = pubkey, hash = identity.aggregateHash) =>
	`${prefix}${hash}:${account}:saved`
const stableKey = (account = pubkey) => `${prefix}${account}:saved`
const preferences = {
	version: 1,
	sources: [
		{
			url: 'https://www.google.com/maps/d/viewer?mid=publicMap123',
			title: 'Device source',
			hiddenLayers: ['Roads'],
			opacity: 0.4,
			visible: false,
		},
	],
}
function storage(initial: [string, string][] = []) {
	const values = new Map(initial)
	return {
		values,
		get length() {
			return values.size
		},
		key(index: number) {
			return [...values.keys()][index] ?? null
		},
		getItem(key: string) {
			return values.get(key) ?? null
		},
		setItem(key: string, value: string) {
			values.set(key, value)
		},
		removeItem(key: string) {
			values.delete(key)
		},
	}
}

test('device preferences migrate to a stable namespace with normalized defaults and no deletion', () => {
	const raw = JSON.stringify(preferences)
	const device = storage([[legacyKey(), raw]])
	expect(migrateMyMapsStorage(device, identity, pubkey)).toBe(true)
	expect(JSON.parse(device.getItem(stableKey()) ?? 'null')).toEqual(
		myMapsModel.preferences(preferences),
	)
	expect(device.getItem(legacyKey())).toBe(raw)
	expect(migrateMyMapsStorage(device, identity, pubkey)).toBe(false)
})

test('anonymous migration reads only anonymous records and cannot adopt an account’s sources', () => {
	const privateData = JSON.stringify(preferences)
	const anonymousData = JSON.stringify({
		...preferences,
		sources: [{ ...preferences.sources[0], title: 'Anonymous source' }],
	})
	const device = storage([
		[legacyKey(), privateData],
		[legacyKey('anonymous'), anonymousData],
	])
	expect(migrateMyMapsStorage(device, identity, '')).toBe(true)
	expect(JSON.parse(device.getItem(stableKey('anonymous')) ?? 'null').sources[0].title).toBe(
		'Anonymous source',
	)
	expect(device.getItem(stableKey())).toBeNull()
	expect(device.getItem(legacyKey())).toBe(privateData)
})

test('account switches migrate only the selected account and keep other identities separate', () => {
	const other = 'c'.repeat(64)
	const raw = JSON.stringify(preferences)
	const device = storage([
		[legacyKey(), raw],
		[legacyKey('anonymous'), raw],
		[`earthly:maplet-storage:bundled:other:${identity.aggregateHash}:${other}:saved`, raw],
	])
	expect(migrateMyMapsStorage(device, identity, other)).toBe(false)
	expect(device.getItem(stableKey(other))).toBeNull()
	expect(device.values.size).toBe(3)
})

test('migration rejects malformed JSON and invalid preferences without hiding original data', () => {
	for (const raw of [
		'{',
		JSON.stringify({ version: 3, sources: [] }),
		JSON.stringify({
			version: 1,
			sources: [{ ...preferences.sources[0], url: 'https://evil.example/data' }],
		}),
		JSON.stringify({ version: 2, sources: [{ ...preferences.sources[0], id: '../bad' }] }),
	]) {
		const device = storage([[legacyKey(), raw]])
		expect(migrateMyMapsStorage(device, identity, pubkey)).toBe(false)
		expect(device.getItem(legacyKey())).toBe(raw)
		expect(device.getItem(stableKey())).toBeNull()
	}
})

test('an existing stable value always wins, including invalid or empty values', () => {
	for (const existing of ['', '{', JSON.stringify({ version: 2, sources: [], drafts: [] })]) {
		const device = storage([
			[legacyKey(), JSON.stringify(preferences)],
			[stableKey(), existing],
		])
		expect(migrateMyMapsStorage(device, identity, pubkey)).toBe(false)
		expect(device.getItem(stableKey())).toBe(existing)
	}
})

test('only exact legacy hash, account and saved-key segments qualify for migration', () => {
	const raw = JSON.stringify(preferences)
	const device = storage([
		[legacyKey(pubkey, 'not-a-hash'), raw],
		[legacyKey(pubkey, 'a'.repeat(65)), raw],
		[`${legacyKey()}:extra`, raw],
		[`${prefix}${identity.aggregateHash}:extra:${pubkey}:saved`, raw],
		[`${prefix}${identity.aggregateHash}:${pubkey}:other`, raw],
		[
			`earthly:maplet-storage:bundled:my-maps-viewer-other:${identity.aggregateHash}:${pubkey}:saved`,
			raw,
		],
	])
	expect(migrateMyMapsStorage(device, identity, pubkey)).toBe(false)
	expect(device.getItem(stableKey())).toBeNull()
})

test('a valid current artifact is preferred and invalid recent entries can fall back to an older valid record', () => {
	const old = legacyKey(pubkey, 'd'.repeat(64))
	const device = storage([
		[legacyKey(), JSON.stringify(preferences)],
		[
			old,
			JSON.stringify({
				...preferences,
				sources: [{ ...preferences.sources[0], title: 'Older version' }],
			}),
		],
	])
	expect(migrateMyMapsStorage(device, identity, pubkey)).toBe(true)
	expect(JSON.parse(device.getItem(stableKey()) ?? 'null').sources[0].title).toBe('Device source')
	const fallback = storage([
		[old, JSON.stringify(preferences)],
		[legacyKey(), '{'],
	])
	expect(migrateMyMapsStorage(fallback, identity, pubkey)).toBe(true)
})

test('migration remains unavailable to third-party identities and respects the stable storage quota', () => {
	const raw = JSON.stringify(preferences)
	const foreign = storage([
		[`earthly:maplet-storage:third-party:${identity.aggregateHash}:${pubkey}:saved`, raw],
	])
	expect(migrateMyMapsStorage(foreign, { ...identity, dTag: 'third-party' }, pubkey)).toBe(false)
	const full = storage([
		[legacyKey(), raw],
		[`${prefix}${pubkey}:other`, 'x'.repeat(256 * 1024)],
	])
	expect(migrateMyMapsStorage(full, identity, pubkey)).toBe(false)
	expect(full.getItem(stableKey())).toBeNull()
	expect(full.getItem(legacyKey())).toBe(raw)
})
