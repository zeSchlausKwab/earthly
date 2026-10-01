import { describe, expect, test } from 'bun:test'
import { getModelContext, registerBrowserTools, type BrowserTool } from './platform'

const tool: BrowserTool = {
	name: 'earthly_example',
	description: 'Example',
	inputSchema: { type: 'object' },
	annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
	execute: async () => ({ ok: true }),
}

describe('WebMCP compatibility boundary', () => {
	test('prefers document, supports older navigator and detects unsupported browsers', () => {
		const current = { registerTool: () => {} }
		const legacy = { registerTool: () => {}, unregisterTool: () => {} }
		expect(getModelContext({ modelContext: current }, { modelContext: legacy })).toBe(current)
		expect(getModelContext({}, { modelContext: legacy })).toBe(legacy)
		expect(getModelContext({}, {})).toBeNull()
	})
	test('teardown unregisters native tools through AbortSignal', async () => {
		let registrationSignal: AbortSignal | undefined
		const controller = new AbortController()
		await registerBrowserTools(
			{
				registerTool: (_tool, options) => {
					registrationSignal = options?.signal
				},
			},
			[tool],
			controller.signal,
		)
		expect(registrationSignal?.aborted).toBe(false)
		controller.abort()
		expect(registrationSignal?.aborted).toBe(true)
	})
	test('partial failure removes both native and legacy registrations', async () => {
		let registrationSignal: AbortSignal | undefined
		const removed: string[] = []
		await expect(
			registerBrowserTools(
				{
					registerTool: (entry, options) => {
						registrationSignal = options?.signal
						if (entry.name === 'bad') throw new Error('No permission')
					},
					unregisterTool: (name) => {
						removed.push(name)
					},
				},
				[tool, { ...tool, name: 'bad' }],
				new AbortController().signal,
			),
		).rejects.toThrow('No permission')
		expect(registrationSignal?.aborted).toBe(true)
		expect(removed).toEqual([tool.name])
	})
	test('abort while an old registration awaits does not leave its tool installed', async () => {
		const removed: string[] = []
		const controller = new AbortController()
		await expect(
			registerBrowserTools(
				{
					registerTool: async () => {
						controller.abort()
					},
					unregisterTool: (name) => {
						removed.push(name)
					},
				},
				[tool],
				controller.signal,
			),
		).rejects.toBeDefined()
		expect(removed).toEqual([tool.name])
	})
})
