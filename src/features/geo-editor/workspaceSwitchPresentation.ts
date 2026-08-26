import type { DraftAuthoringOptions } from './hooks/useDatasetManagement'
import type { PublishChannel } from './store'

type WorkspaceSwitchOptions = Pick<DraftAuthoringOptions, 'syncMapStackVisibility'>

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
 * Exact mobile target activation is presentation-only: the requested workspace
 * becomes active, but the current route and explicit Map Stack visibility stay
 * untouched. Ordinary navigator switches keep the historical route/sheet sync.
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
		syncMapStackVisibility: options?.syncMapStackVisibility,
	})

	if (isMobile && options?.syncMapStackVisibility === false) return

	const activeDraftChannel = readActiveWorkspaceDraftChannel(workspaceId)
	syncRouteToDraftChannel(activeDraftChannel)
	if (activeDraftChannel) surfaceDraftEditorOnMobile()
}
