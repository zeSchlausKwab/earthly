export const MAX_WORKSPACE_BYTES = 10 * 1024 * 1024
export const MAX_WORKSPACE_NODES = 600_000
export const MAX_WORKSPACE_DEPTH = 24

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/** Workspace snapshots include geometries; configuration's smaller budget does not apply. */
export function cloneMapletWorkspaceJson(value: unknown): unknown {
	let nodes = 0
	let characters = 0
	const account = (count: number) => {
		characters += count
		if (characters > MAX_WORKSPACE_BYTES) throw new Error('Workspace data exceeds size limit')
	}
	const text = (value: string) => {
		if (value.length > MAX_WORKSPACE_BYTES) throw new Error('Workspace text exceeds size limit')
		account(JSON.stringify(value).length)
	}
	const clone = (item: unknown, depth: number): unknown => {
		if (++nodes > MAX_WORKSPACE_NODES || depth > MAX_WORKSPACE_DEPTH)
			throw new Error('Workspace data exceeds complexity limit')
		if (item === null || typeof item === 'boolean') {
			account(String(item).length)
			return item
		}
		if (typeof item === 'string') {
			text(item)
			return item
		}
		if (typeof item === 'number' && Number.isFinite(item)) {
			account(String(item).length)
			return item
		}
		if (Array.isArray(item)) {
			if (
				Object.getPrototypeOf(item) !== Array.prototype ||
				Reflect.ownKeys(item).length !== item.length + 1
			)
				throw new Error('Workspace data must contain only plain JSON arrays')
			account(2 + Math.max(0, item.length - 1))
			const result: unknown[] = []
			for (let index = 0; index < item.length; index++) {
				const descriptor = Object.getOwnPropertyDescriptor(item, index)
				if (!descriptor || !('value' in descriptor))
					throw new Error('Workspace data must not contain accessors')
				result.push(clone(descriptor.value, depth + 1))
			}
			return result
		}
		if (item && typeof item === 'object') {
			const prototype = Object.getPrototypeOf(item)
			if (prototype !== Object.prototype && prototype !== null)
				throw new Error('Workspace data must contain only plain JSON objects')
			const keys = Reflect.ownKeys(item)
			account(2 + Math.max(0, keys.length - 1))
			const result: Record<string, unknown> = {}
			for (const key of keys) {
				if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key))
					throw new Error('Unsafe workspace property name')
				const descriptor = Object.getOwnPropertyDescriptor(item, key)
				if (!descriptor?.enumerable || !('value' in descriptor))
					throw new Error('Workspace data must not contain accessors or hidden properties')
				text(key)
				account(1)
				result[key] = clone(descriptor.value, depth + 1)
			}
			return result
		}
		throw new Error('Workspace data must contain only finite JSON values')
	}
	const result = clone(value, 0)
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_WORKSPACE_BYTES)
		throw new Error('Workspace data exceeds byte limit')
	return result
}
