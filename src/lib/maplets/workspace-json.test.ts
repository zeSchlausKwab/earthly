import { expect, test } from 'bun:test'
import {
	cloneMapletWorkspaceJson,
	MAX_WORKSPACE_BYTES,
	MAX_WORKSPACE_DEPTH,
	MAX_WORKSPACE_NODES,
} from './workspace-json'

test('workspace snapshots accept two copies of a 50,000-position geometry', () => {
	const collection = {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'large',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: Array.from({ length: 50_000 }, () => [16, 48, 100]),
				},
			},
		],
	}
	const snapshot = { layers: [{ collection }], renderCollection: collection }
	const result = cloneMapletWorkspaceJson(snapshot) as typeof snapshot
	expect(result.layers[0]?.collection.features[0]?.geometry.coordinates).toHaveLength(50_000)
	expect(result.renderCollection.features[0]?.geometry.coordinates).toHaveLength(50_000)
	expect(result.renderCollection).not.toBe(collection)
	expect(result.layers[0]?.collection).not.toBe(result.renderCollection)
})

test('workspace JSON enforces independent size, byte, depth and node budgets', () => {
	expect(() => cloneMapletWorkspaceJson('x'.repeat(MAX_WORKSPACE_BYTES))).toThrow('size limit')
	expect(() => cloneMapletWorkspaceJson('界'.repeat(Math.ceil(MAX_WORKSPACE_BYTES / 3)))).toThrow(
		'byte limit',
	)
	let deep: unknown = null
	for (let index = 0; index <= MAX_WORKSPACE_DEPTH; index++) deep = { value: deep }
	expect(() => cloneMapletWorkspaceJson(deep)).toThrow('complexity limit')
	expect(() =>
		cloneMapletWorkspaceJson(Array.from({ length: MAX_WORKSPACE_NODES }, () => 0)),
	).toThrow('complexity limit')
})

test('workspace JSON rejects nonfinite values, poisoned keys, custom prototypes and accessors', () => {
	for (const value of [
		NaN,
		Infinity,
		undefined,
		1n,
		new Date(),
		new Map(),
		() => {},
		{ nested: undefined },
	])
		expect(() => cloneMapletWorkspaceJson(value)).toThrow()
	for (const key of ['__proto__', 'constructor', 'prototype'])
		expect(() => cloneMapletWorkspaceJson({ [key]: {} })).toThrow('Unsafe')
	expect(() => cloneMapletWorkspaceJson(Object.create({ inherited: true }))).toThrow('plain JSON')
	let getterCalls = 0
	const accessor = Object.defineProperty({}, 'value', {
		enumerable: true,
		get: () => {
			getterCalls++
			return true
		},
	})
	expect(() => cloneMapletWorkspaceJson(accessor)).toThrow('accessors')
	expect(getterCalls).toBe(0)
	const cycle: Record<string, unknown> = {}
	cycle.self = cycle
	expect(() => cloneMapletWorkspaceJson(cycle)).toThrow('complexity limit')
	expect(
		cloneMapletWorkspaceJson(Object.assign(Object.create(null), { valid: [null, false, 42] })),
	).toEqual({ valid: [null, false, 42] })
})
