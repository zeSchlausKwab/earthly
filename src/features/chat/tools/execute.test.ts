import { afterEach, describe, expect, it } from 'bun:test'
import { registerDatasetDraftEnsurer } from '@/features/geo-editor/authoringTaskBridge'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import { executeToolCall } from './execute'
import { type ToolEntry, register, registry } from './registry'

const routeResult = {
	feature: {
		type: 'Feature' as const,
		id: 'tour-route',
		properties: { name: 'One-day tour' },
		geometry: {
			type: 'LineString' as const,
			coordinates: [
				[2.35, 48.85],
				[2.29, 48.86],
			],
		},
	},
}

describe('tool-result geometry authoring lifecycle', () => {
	const productionRouteEntry = registry.get('valhalla_route')
	let unregisterEnsurer: (() => void) | null = null

	afterEach(() => {
		unregisterEnsurer?.()
		unregisterEnsurer = null
		useEditorStore.getState().setEditor(null)
		if (productionRouteEntry) register(productionRouteEntry)
	})

	it('establishes a recoverable authoring target before a toEditor tool result mutates geometry', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
		let authoringTargetReady = false
		unregisterEnsurer = registerDatasetDraftEnsurer(() => {
			authoringTargetReady = true
		})

		const fixtureEntry: ToolEntry = {
			name: 'valhalla_route',
			kind: 'remote-mcp',
			schema: productionRouteEntry?.schema ?? {
				type: 'function',
				function: {
					name: 'valhalla_route',
					description: 'Return fixture route geometry.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => routeResult,
		}
		register(fixtureEntry)

		const result = await executeToolCall({
			id: 'route-call',
			type: 'function',
			function: {
				name: 'valhalla_route',
				arguments: JSON.stringify({ toEditor: true }),
			},
		})

		expect(authoringTargetReady).toBe(true)
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(JSON.parse(result.content).editorImport.importedCount).toBe(1)
	})
})
