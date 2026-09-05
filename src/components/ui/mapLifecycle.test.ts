import { describe, expect, test } from 'bun:test'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { attachBasemapLifecycle, EMPTY_BASEMAP, type BasemapState } from './mapLifecycle'

function fixture() {
	const listeners = new Map<string, Set<(event: { sourceId?: string }) => void>>()
	const styles: unknown[] = []
	const states: BasemapState[] = []
	const map = {
		on(name: string, callback: (event: { sourceId?: string }) => void) {
			if (!listeners.has(name)) listeners.set(name, new Set())
			listeners.get(name)?.add(callback)
		},
		off(name: string, callback: (event: { sourceId?: string }) => void) { listeners.get(name)?.delete(callback) },
		getStyle: () => ({ sources: { basemap: {} } }),
		setStyle: (style: unknown) => styles.push(style),
	}
	const lifecycle = attachBasemapLifecycle(map as unknown as MapLibreMap, 'original-style', (state) => states.push(state))
	const emit = (name: string, event = {}) => listeners.get(name)?.forEach((callback) => callback(event))
	return { lifecycle, styles, states, emit }
}

describe('Basemap lifecycle', () => {
	test('allows authored layers at style.load without waiting for basemap load', () => {
		const f = fixture()
		try {
			f.emit('style.load')
			expect(f.states.at(-1)).toEqual({ styleReady: true, status: 'loading' })
			f.emit('load')
			expect(f.states.at(-1)?.status).toBe('ready')
		} finally { f.lifecycle.dispose() }
	})
	test('offers fallback and retries the intended style, never the fallback', () => {
		const f = fixture()
		try {
			f.emit('error')
			expect(f.states.at(-1)?.status).toBe('error')
			f.lifecycle.useFallback()
			expect(f.styles.at(-1)).toBe(EMPTY_BASEMAP)
			f.emit('style.load')
			expect(f.states.at(-1)).toEqual({ styleReady: true, status: 'fallback' })
			f.lifecycle.retry()
			expect(f.styles.at(-1)).toBe('original-style')
			f.emit('style.load')
			f.emit('idle')
			expect(f.states.at(-1)?.status).toBe('ready')
		} finally { f.lifecycle.dispose() }
	})
	test('style changes reset readiness; idle does not hide errors; authored-source errors do not blame basemap', () => {
		const f = fixture()
		try {
			f.emit('style.load'); f.emit('load')
			f.emit('error', { sourceId: 'my-drawn-map' })
			expect(f.states.at(-1)?.status).toBe('ready')
			f.emit('error', { sourceId: 'basemap' }); f.emit('idle')
			expect(f.states.at(-1)?.status).toBe('error')
			f.lifecycle.setStyle('new-style')
			expect(f.states.at(-1)).toEqual({ styleReady: false, status: 'loading' })
			f.lifecycle.retry()
			expect(f.styles.at(-1)).toBe('new-style')
		} finally { f.lifecycle.dispose() }
	})
	test('unmount unsubscribes, including late load/error events', () => {
		const f = fixture()
		f.lifecycle.dispose()
		f.emit('style.load'); f.emit('error'); f.emit('idle')
		expect(f.states).toEqual([])
	})
})
