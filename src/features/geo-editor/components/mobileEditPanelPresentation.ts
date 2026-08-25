import type { Article } from '@/lib/nostr/article'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import type { MapContext } from '@/lib/nostr/map-context'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'
import type { InspectionSubject, MobileEntitySurface, RetainedDatasetSurfaceTarget } from '../store'

export type MobileWorkspacePanelTab = 'map-stack' | 'edit' | 'chat'

const MOBILE_WORKSPACE_PANEL_TABS: readonly MobileWorkspacePanelTab[] = [
	'map-stack',
	'edit',
	'chat',
]

export function mobileWorkspacePanelUsesKeyboardViewport(panel: string): boolean {
	return panel === 'edit' || panel === 'chat'
}

export function resolveMobileWorkspaceTabKey(
	current: MobileWorkspacePanelTab,
	key: string,
): MobileWorkspacePanelTab | null {
	const currentIndex = MOBILE_WORKSPACE_PANEL_TABS.indexOf(current)
	if (key === 'Home') return MOBILE_WORKSPACE_PANEL_TABS[0]
	if (key === 'End') return MOBILE_WORKSPACE_PANEL_TABS[MOBILE_WORKSPACE_PANEL_TABS.length - 1]
	if (key === 'ArrowRight') {
		return MOBILE_WORKSPACE_PANEL_TABS[(currentIndex + 1) % MOBILE_WORKSPACE_PANEL_TABS.length]
	}
	if (key === 'ArrowLeft') {
		return MOBILE_WORKSPACE_PANEL_TABS[
			(currentIndex - 1 + MOBILE_WORKSPACE_PANEL_TABS.length) % MOBILE_WORKSPACE_PANEL_TABS.length
		]
	}
	return null
}

export function resolveMobileStorySurfaceTitle(
	publishedTitle: string | null | undefined,
	localDraftTitle: string | null | undefined,
): string {
	return publishedTitle?.trim() || localDraftTitle?.trim() || 'Untitled story'
}

/**
 * Name a retained Dataset from the validated workspace -> draft pair. Draft
 * metadata is the live authoring value; the workspace label is only a fallback
 * because it can lag behind an unsaved rename.
 */
export function resolveMobileDatasetSurfaceTitle(
	target: RetainedDatasetSurfaceTarget | null | undefined,
): string {
	return (
		target?.draft.collectionMeta.name.trim() ||
		target?.draft.name.trim() ||
		target?.workspace.label.trim() ||
		'Untitled draft'
	)
}

type ConversationTargetEntityType = 'dataset' | 'story' | 'context'

interface ConversationRunTarget {
	chatId: string
	target: {
		entityType: ConversationTargetEntityType | null
		workspaceId: string | null
	}
}

interface ConversationSessionTarget {
	id: string
	targetWorkspaceId: string | null
}

export interface ConversationEditTarget {
	entityType: ConversationTargetEntityType
	workspaceId: string
}

export const CHAT_EDIT_TARGET_UNAVAILABLE_MESSAGE =
	'This conversation\u2019s map target is no longer available. Choose New map or Use current in Chat.'

/**
 * Resolve the target represented by the conversation the user is actually
 * looking at. A matching immutable run owns the answer while it executes;
 * another conversation's global run must never leak into this navigation.
 */
export function resolveActiveConversationEditTarget(
	activeChatId: string | null,
	activeRun: ConversationRunTarget | null,
	chatSessions: readonly ConversationSessionTarget[],
): ConversationEditTarget | null {
	if (!activeChatId) return null
	if (activeRun?.chatId === activeChatId) {
		return activeRun.target.entityType && activeRun.target.workspaceId
			? {
					entityType: activeRun.target.entityType,
					workspaceId: activeRun.target.workspaceId,
				}
			: null
	}

	const workspaceId =
		chatSessions.find((session) => session.id === activeChatId)?.targetWorkspaceId ?? null
	return workspaceId ? { entityType: 'dataset', workspaceId } : null
}

/**
 * Restore only the exact Dataset target represented by the visible
 * conversation. Failure stays in Chat and always announces the recovery path.
 */
export async function attemptConversationEditTargetRestore(
	target: ConversationEditTarget | null,
	onOpenTarget: ((workspaceId: string) => Promise<boolean>) | undefined,
	onUnavailable: () => void,
): Promise<boolean> {
	if (target?.entityType === 'dataset' && onOpenTarget) {
		try {
			if (await onOpenTarget(target.workspaceId)) return true
		} catch {
			// Treat rejected restoration like any other stale target. The caller owns
			// the visible recovery message and Chat remains selected.
		}
	}
	onUnavailable()
	return false
}

export interface InfoPanelViewState {
	viewDataset: GeoDataset | null
	viewContext: MapContext | null
	viewStory: Article | null
	viewSighting: TemporalSighting | null
	viewBeacon: LiveBeacon | null
}

/**
 * A mobile Inspector can remain selected after route state clears the legacy
 * per-kind `view*` values. Resolve that retained subject locally so recalling
 * Inspector is a presentation change, not a store mutation.
 */
export function resolveInfoPanelViewState(
	inspectionSubjectOverride: InspectionSubject | null | undefined,
	fallback: InfoPanelViewState,
): InfoPanelViewState {
	if (inspectionSubjectOverride === undefined) return fallback
	return {
		viewDataset:
			inspectionSubjectOverride?.kind === 'dataset' ? inspectionSubjectOverride.entity : null,
		viewContext:
			inspectionSubjectOverride?.kind === 'context' ? inspectionSubjectOverride.entity : null,
		viewStory:
			inspectionSubjectOverride?.kind === 'story' ? inspectionSubjectOverride.entity : null,
		viewSighting:
			inspectionSubjectOverride?.kind === 'sighting' ? inspectionSubjectOverride.entity : null,
		viewBeacon:
			inspectionSubjectOverride?.kind === 'beacon' ? inspectionSubjectOverride.entity : null,
	}
}

export interface MobileEditPanelPresentationInput {
	surface?: MobileEntitySurface | null
	inspectionKind?: 'dataset' | 'context' | 'story' | 'sighting' | 'beacon' | null
	hasRetainedDataset?: boolean
	contextEditorMode?: 'none' | 'create' | 'edit'
	storyEditorMode?: 'none' | 'create' | 'edit'
	sightingEditorMode?: 'none' | 'create' | 'edit'
	beaconControlMode?: 'none' | 'create' | 'adjust'
	hasViewedDataset?: boolean
	hasViewedContext?: boolean
	hasViewedStory?: boolean
	hasViewedSighting?: boolean
	hasViewedBeacon?: boolean
}

export interface MobileEditPanelPresentation {
	label: string
	intent: 'author' | 'inspect'
}

/**
 * The mobile `edit` tab hosts several different product surfaces. Give the
 * shell an honest title so inspecting an entity is not announced as editing it.
 */
export function resolveMobileEditPanelPresentation({
	surface,
	inspectionKind,
	hasRetainedDataset = false,
	contextEditorMode = 'none',
	storyEditorMode = 'none',
	sightingEditorMode = 'none',
	beaconControlMode = 'none',
	hasViewedDataset = false,
	hasViewedContext = false,
	hasViewedStory = false,
	hasViewedSighting = false,
	hasViewedBeacon = false,
}: MobileEditPanelPresentationInput): MobileEditPanelPresentation {
	if (surface === 'dataset') {
		return hasRetainedDataset
			? { label: 'Edit dataset', intent: 'author' }
			: { label: 'Dataset', intent: 'inspect' }
	}
	if (surface === 'context') {
		if (contextEditorMode === 'create') return { label: 'New context', intent: 'author' }
		if (contextEditorMode === 'edit') return { label: 'Edit context', intent: 'author' }
		return { label: 'Context', intent: 'inspect' }
	}
	if (surface === 'story') {
		if (storyEditorMode === 'create') return { label: 'New story', intent: 'author' }
		if (storyEditorMode === 'edit') return { label: 'Edit story', intent: 'author' }
		return { label: 'Story', intent: 'inspect' }
	}
	if (surface === 'sighting') {
		if (sightingEditorMode === 'create') return { label: 'New sighting', intent: 'author' }
		if (sightingEditorMode === 'edit') return { label: 'Edit sighting', intent: 'author' }
		return { label: 'Sighting', intent: 'inspect' }
	}
	if (surface === 'beacon') {
		if (beaconControlMode === 'create') return { label: 'Share live location', intent: 'author' }
		if (beaconControlMode === 'adjust') return { label: 'Adjust live location', intent: 'author' }
		return { label: 'Live location', intent: 'inspect' }
	}
	if (surface === 'inspector') {
		if (inspectionKind === 'dataset') return { label: 'Dataset', intent: 'inspect' }
		if (inspectionKind === 'context') return { label: 'Context', intent: 'inspect' }
		if (inspectionKind === 'story') return { label: 'Story', intent: 'inspect' }
		if (inspectionKind === 'sighting') return { label: 'Sighting', intent: 'inspect' }
		if (inspectionKind === 'beacon') return { label: 'Live location', intent: 'inspect' }
		return { label: 'Inspect', intent: 'inspect' }
	}

	// Compatibility fallback for callers that have not yet adopted the explicit
	// mobile surface discriminant.
	if (contextEditorMode === 'create') return { label: 'New context', intent: 'author' }
	if (contextEditorMode === 'edit') return { label: 'Edit context', intent: 'author' }
	if (storyEditorMode === 'create') return { label: 'New story', intent: 'author' }
	if (storyEditorMode === 'edit') return { label: 'Edit story', intent: 'author' }
	if (sightingEditorMode === 'create') return { label: 'New sighting', intent: 'author' }
	if (sightingEditorMode === 'edit') return { label: 'Edit sighting', intent: 'author' }
	if (beaconControlMode === 'create') return { label: 'Share live location', intent: 'author' }
	if (beaconControlMode === 'adjust') return { label: 'Adjust live location', intent: 'author' }
	if (hasRetainedDataset) return { label: 'Edit dataset', intent: 'author' }

	if (hasViewedDataset) return { label: 'Dataset', intent: 'inspect' }
	if (hasViewedContext) return { label: 'Context', intent: 'inspect' }
	if (hasViewedStory) return { label: 'Story', intent: 'inspect' }
	if (hasViewedSighting) return { label: 'Sighting', intent: 'inspect' }
	if (hasViewedBeacon) return { label: 'Live location', intent: 'inspect' }

	return { label: 'Inspect', intent: 'inspect' }
}
