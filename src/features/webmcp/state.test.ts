import { describe, expect, test } from 'bun:test'
import { createWebMcpStore, WEBMCP_PREFERENCES_KEY } from './state'

function memoryStorage(initial?: string) {
	const items = new Map<string, string>()
	if (initial !== undefined) items.set(WEBMCP_PREFERENCES_KEY, initial)
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
	}
}

describe('WebMCP browser preferences', () => {
	test('new browsers register local and external capabilities by default', () => {
		const store = createWebMcpStore(memoryStorage())
		expect(store.getState().enabled).toBe(true)
		expect(store.getState().externalQueriesEnabled).toBe(true)
	})

	test('explicit opt-outs survive recreating the page without retaining runtime state', () => {
		const storage = memoryStorage()
		const first = createWebMcpStore(storage)
		first.getState().setExternalQueriesEnabled(false)
		first.getState().setEnabled(false)
		first.setState({
			status: 'ready',
			toolCount: 62,
			panelOpen: true,
			activities: [{ id: 'old-operation', tool: 'earthly_get_map', status: 'finished' }],
		})
		const reloaded = createWebMcpStore(storage)
		expect(reloaded.getState().enabled).toBe(false)
		expect(reloaded.getState().externalQueriesEnabled).toBe(false)
		expect(reloaded.getState().status).toBe('checking')
		expect(reloaded.getState().toolCount).toBe(0)
		expect(reloaded.getState().panelOpen).toBe(false)
		expect(reloaded.getState().activities).toEqual([])
		expect(JSON.parse(storage.getItem(WEBMCP_PREFERENCES_KEY) ?? 'null')).toEqual({
			enabled: false,
			externalQueriesEnabled: false,
		})
	})

	test('disabling access preserves the independently chosen external query preference', () => {
		const storage = memoryStorage()
		const first = createWebMcpStore(storage)
		first.getState().setEnabled(false)
		const reloaded = createWebMcpStore(storage)
		expect(reloaded.getState().enabled).toBe(false)
		expect(reloaded.getState().externalQueriesEnabled).toBe(true)
		reloaded.getState().setEnabled(true)
		expect(reloaded.getState().externalQueriesEnabled).toBe(true)
		reloaded.getState().setExternalQueriesEnabled(false)
		reloaded.getState().setEnabled(false)
		reloaded.getState().setEnabled(true)
		expect(reloaded.getState().externalQueriesEnabled).toBe(false)
	})

	test('invalid preferences use defaults while valid individual opt-outs are honored', () => {
		for (const saved of ['not json', 'null', '[]', '42', '{"enabled":"false"}']) {
			const store = createWebMcpStore(memoryStorage(saved))
			expect(store.getState().enabled).toBe(true)
			expect(store.getState().externalQueriesEnabled).toBe(true)
		}
		const partial = createWebMcpStore(memoryStorage('{"enabled":false}'))
		expect(partial.getState().enabled).toBe(false)
		expect(partial.getState().externalQueriesEnabled).toBe(true)
	})

	test('blocked storage does not prevent changing the page preferences', () => {
		const store = createWebMcpStore({
			getItem: () => {
				throw new Error('Storage blocked')
			},
			setItem: () => {
				throw new Error('Storage blocked')
			},
		})
		store.getState().setEnabled(false)
		store.getState().setExternalQueriesEnabled(false)
		expect(store.getState().enabled).toBe(false)
		expect(store.getState().externalQueriesEnabled).toBe(false)
	})
})
