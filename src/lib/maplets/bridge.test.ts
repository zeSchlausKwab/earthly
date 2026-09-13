import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

type Subscription = { close(): void }
type Bridge = {
	identity: {
		getPublicKey(): Promise<string>
		onChanged(callback: (pubkey: string) => void): Subscription
	}
	map: {
		workspace(action: string, payload?: unknown): Promise<unknown>
		onWorkspaceChanged(callback: (value: unknown) => void): Subscription
		resize(height: number): void
	}
	resource?: unknown
	config?: unknown
}

test('production-serialized bridge correlates identity/workspace replies and scopes push subscriptions', async () => {
	const build = await Bun.build({
		entrypoints: [`${import.meta.dir}/bridge.ts`],
		target: 'browser',
		format: 'esm',
		minify: true,
	})
	expect(build.success).toBe(true)
	const moduleText = await build.outputs[0]?.text()
	const temporary = await mkdtemp(join(tmpdir(), 'earthly-maplet-bridge-'))
	let bridgeSource: string
	try {
		const modulePath = join(temporary, 'bridge.mjs')
		await writeFile(modulePath, moduleText ?? '')
		const { installMapletBridge } = await import(modulePath)
		bridgeSource = installMapletBridge.toString()
	} finally {
		await rm(temporary, { recursive: true, force: true })
	}
	const sent: Record<string, unknown>[] = []
	const parent = { postMessage: (value: Record<string, unknown>) => sent.push(value) }
	const sandbox = Object.assign(new EventTarget(), { parent }) as EventTarget & {
		parent: typeof parent
		napplet: Bridge
	}
	runInNewContext(`(${bridgeSource})(['map', 'identity'], null)`, {
		window: sandbox,
		setTimeout,
		clearTimeout,
		DOMException,
	})
	const api = sandbox.napplet
	const receive = (data: Record<string, unknown>, source: unknown = parent) =>
		sandbox.dispatchEvent(Object.assign(new Event('message'), { data, source }))
	expect(api.resource).toBeUndefined()
	expect(api.config).toBeUndefined()
	const snapshot = api.identity.getPublicKey()
	const id = sent.at(-1)?.id
	expect(sent.at(-1)).toEqual({ type: 'identity.getPublicKey', id })
	receive({ type: 'identity.getPublicKey.result', id, pubkey: 'spoofed' }, {})
	receive({ type: 'map.workspace.result', id, value: 'wrong family' })
	receive({ type: 'identity.getPublicKey.result', id, pubkey: '' })
	expect(await snapshot).toBe('')
	const identities: string[] = []
	const identitySubscription = api.identity.onChanged((pubkey) => identities.push(pubkey))
	receive({ type: 'identity.changed', pubkey: 'ab'.repeat(32) })
	receive({ type: 'identity.changed', pubkey: '' })
	identitySubscription.close()
	receive({ type: 'identity.changed', pubkey: 'cd'.repeat(32) })
	expect(identities).toEqual(['ab'.repeat(32), ''])

	const pending = api.map.workspace('list', { owned: true })
	const request = sent.at(-1)
	expect(request).toMatchObject({ type: 'map.workspace', action: 'list', payload: { owned: true } })
	receive({ type: 'map.workspace.result', id: request?.id, value: { drafts: [] } })
	expect(await pending).toEqual({ drafts: [] })
	const cancelled = api.map.workspace('save')
	receive({ type: 'map.workspace.error', id: sent.at(-1)?.id, error: 'identity-changed' })
	await expect(cancelled).rejects.toThrow('identity-changed')

	const updates: unknown[] = []
	const subscription = api.map.onWorkspaceChanged((value) => updates.push(value))
	receive({ type: 'map.workspaceChanged', value: { revision: 1 } }, {})
	receive({ type: 'map.workspaceChanged', value: { revision: 2 } })
	subscription.close()
	receive({ type: 'map.workspaceChanged', value: { revision: 3 } })
	expect(updates).toEqual([{ revision: 2 }])
	api.map.resize(600)
	expect(sent.at(-1)).toEqual({ type: 'map.resize', height: 600 })
})
