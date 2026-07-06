/**
 * Wave-0 Nyquist RED baseline — pins the device-local, app-global contributor mute store
 * (D-10/D-11). Mute is local-only (localStorage), per-device, applied app-wide, no signing.
 *
 * RED-BASELINE: `@/lib/mute/useMuteStore` does not exist yet (lands in a later Plan).
 *
 *   - mute(pk) adds pk to the muted set; the same pk muted twice does NOT duplicate
 *     (Set semantics).
 *   - unmute(pk) removes it.
 *   - the store is created via zustand `persist` with the localStorage name
 *     `earthly-muted-contributors` (asserted via `useMuteStore.persist.getOptions().name`,
 *     mirroring the chat store's persist contract).
 *
 * NOTE: bun's test runtime has no `localStorage`; zustand's persist middleware only attaches
 * its `.persist` admin API when a storage is resolvable. We polyfill a memory-backed
 * `globalThis.localStorage` BEFORE importing the store so `persist.getOptions()` is present.
 */

import { beforeAll, describe, expect, test } from 'bun:test'

// Memory-backed localStorage polyfill — installed before the store module is imported.
const __mem: Record<string, string> = {}
;(globalThis as { localStorage?: Storage }).localStorage = {
	getItem: (k: string) => (k in __mem ? __mem[k] : null),
	setItem: (k: string, v: string) => {
		__mem[k] = v
	},
	removeItem: (k: string) => {
		delete __mem[k]
	},
	clear: () => {
		for (const k of Object.keys(__mem)) delete __mem[k]
	},
	key: (i: number) => Object.keys(__mem)[i] ?? null,
	get length() {
		return Object.keys(__mem).length
	},
} as Storage

// Imported lazily after the polyfill so persist resolves its storage.
let useMuteStore: typeof import('@/lib/mute/useMuteStore').useMuteStore

beforeAll(async () => {
	;({ useMuteStore } = await import('@/lib/mute/useMuteStore'))
})

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

describe('useMuteStore — device-local mute set', () => {
	test('mute(pk) adds the contributor to the muted set', () => {
		useMuteStore.getState().mute(PK_A)
		expect(useMuteStore.getState().muted).toContain(PK_A)
	})

	test('muting the same pk twice does not duplicate (Set semantics)', () => {
		useMuteStore.getState().mute(PK_B)
		useMuteStore.getState().mute(PK_B)
		const occurrences = useMuteStore.getState().muted.filter((x) => x === PK_B).length
		expect(occurrences).toBe(1)
	})

	test('unmute(pk) removes the contributor', () => {
		useMuteStore.getState().mute(PK_A)
		useMuteStore.getState().unmute(PK_A)
		expect(useMuteStore.getState().muted).not.toContain(PK_A)
	})
})

describe('useMuteStore — persist contract', () => {
	test('persists under the earthly-muted-contributors localStorage key', () => {
		const persist = (
			useMuteStore as unknown as { persist?: { getOptions: () => { name?: string } } }
		).persist
		expect(persist?.getOptions().name).toBe('earthly-muted-contributors')
	})
})
