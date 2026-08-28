import type { DraftAuthoringOptions } from './hooks/useDatasetManagement'
import type { PublishChannel } from './store'

interface WorkspaceSwitchOptions {
	/** Keep an exact Chat-target open on the current mobile route/sheet. */
	preserveMobileRoute?: boolean
}

interface SwitchWorkspaceFromViewParams {
	workspaceId: string
	options?: WorkspaceSwitchOptions
	isMobile: boolean
	routePublishChannel: PublishChannel
	switchToWorkspace: (workspaceId: string, options: DraftAuthoringOptions) => void | Promise<void>
	readActiveWorkspaceDraftChannel: (workspaceId: string) => PublishChannel | null
	syncRouteToDraftChannel: (publishChannel: PublishChannel | null) => void
	surfaceDraftEditorOnMobile: () => void
}

/**
 * Adapt a view-level workspace switch to the Dataset authoring API.
 *
 * Exact mobile target activation can preserve the current route/sheet, but a
 * Dataset workspace switch always owns its visible edit representation.
 * Ordinary navigator switches keep the historical route/sheet sync.
 */
export async function switchWorkspaceFromView({
	workspaceId,
	options,
	isMobile,
	routePublishChannel,
	switchToWorkspace,
	readActiveWorkspaceDraftChannel,
	syncRouteToDraftChannel,
	surfaceDraftEditorOnMobile,
}: SwitchWorkspaceFromViewParams): Promise<void> {
	await switchToWorkspace(workspaceId, {
		publishChannel: routePublishChannel,
	})

	if (isMobile && options?.preserveMobileRoute) return

	const activeDraftChannel = readActiveWorkspaceDraftChannel(workspaceId)
	syncRouteToDraftChannel(activeDraftChannel)
	if (activeDraftChannel) surfaceDraftEditorOnMobile()
}
