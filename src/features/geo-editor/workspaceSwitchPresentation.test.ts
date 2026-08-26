import { describe, expect, test } from 'bun:test'
import type { DraftAuthoringOptions } from './hooks/useDatasetManagement'
import type { PublishChannel } from './store'
import { switchWorkspaceFromView } from './workspaceSwitchPresentation'

const publicChannel: PublishChannel = { kind: 'public' }
const targetChannel: PublishChannel = { kind: 'private-group', id: 'target-group' }

describe('view-level workspace switching', () => {
	test('exact cross-workspace mobile open preserves published-map visibility and route', async () => {
		let activeWorkspaceId = 'workspace-current'
		let route = '/mapcontext/current-inspection'
		const visibleEntries = new Set(['dataset:target', 'dataset:other'])
		let receivedOptions: DraftAuthoringOptions | undefined
		let routeSyncCount = 0
		let surfacedCount = 0

		await switchWorkspaceFromView({
			workspaceId: 'workspace-target',
			options: { syncMapStackVisibility: false },
			isMobile: true,
			routePublishChannel: publicChannel,
			switchToWorkspace: (workspaceId, options) => {
				activeWorkspaceId = workspaceId
				receivedOptions = options
				// Model the Dataset hook's ordinary visibility synchronization. The
				// adapter must pass false or the target's published row is replaced.
				if (options.syncMapStackVisibility !== false) {
					visibleEntries.delete('dataset:target')
					visibleEntries.add('draft:active')
				}
			},
			readActiveWorkspaceDraftChannel: () => targetChannel,
			syncRouteToDraftChannel: (channel) => {
				routeSyncCount += 1
				route = channel?.kind === 'private-group' ? `/private-group/${channel.id}` : '/drafts'
			},
			surfaceDraftEditorOnMobile: () => {
				surfacedCount += 1
			},
		})

		expect(activeWorkspaceId).toBe('workspace-target')
		expect(receivedOptions).toEqual({
			publishChannel: publicChannel,
			syncMapStackVisibility: false,
		})
		expect([...visibleEntries]).toEqual(['dataset:target', 'dataset:other'])
		expect(route).toBe('/mapcontext/current-inspection')
		expect(routeSyncCount).toBe(0)
		expect(surfacedCount).toBe(0)
	})

	test('ordinary mobile workspace switch retains route and sheet synchronization', async () => {
		let route = '/mapcontext/current-inspection'
		let surfacedCount = 0
		let receivedOptions: DraftAuthoringOptions | undefined

		await switchWorkspaceFromView({
			workspaceId: 'workspace-target',
			isMobile: true,
			routePublishChannel: publicChannel,
			switchToWorkspace: (_workspaceId, options) => {
				receivedOptions = options
			},
			readActiveWorkspaceDraftChannel: () => targetChannel,
			syncRouteToDraftChannel: (channel) => {
				route = channel?.kind === 'private-group' ? `/private-group/${channel.id}` : '/drafts'
			},
			surfaceDraftEditorOnMobile: () => {
				surfacedCount += 1
			},
		})

		expect(receivedOptions).toEqual({
			publishChannel: publicChannel,
			syncMapStackVisibility: undefined,
		})
		expect(route).toBe('/private-group/target-group')
		expect(surfacedCount).toBe(1)
	})
})
