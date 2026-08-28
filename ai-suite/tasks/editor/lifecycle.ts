import { expect, type Locator } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import {
	clickEditorMap,
	expectGeometryFeatureCount,
	geometryDraftSnapshot,
} from '../create/geometry'
import { startDataset } from '../create/dataset'

export const cancelDrawingTask: AiTaskMetadata = {
	id: 'editor.cancel-drawing',
	summary: 'Cancel an active drawing mode and prove that map panning and drawing remain usable.',
	preconditions: ['Earthly is open', 'The map editor has initialized'],
	sideEffects: ['Creates an unsaved local Dataset draft with one point'],
	viewports: 'both',
}

export const undoRedoGeometryTask: AiTaskMetadata = {
	id: 'editor.undo-redo-geometry',
	summary: 'Undo and redo a geometry through the controls available in the current viewport.',
	preconditions: ['Earthly is open', 'The map editor has initialized'],
	sideEffects: ['Creates an unsaved local Dataset draft with one point'],
	viewports: 'both',
}

export const mapStackDraftLifecycleTask: AiTaskMetadata = {
	id: 'editor.map-stack-draft-lifecycle',
	summary: 'Keep the active draft through Map Stack Clear and exercise isolate/show-all.',
	preconditions: ['Earthly is open', 'An active Dataset draft exists'],
	sideEffects: ['Changes Map Stack visibility and isolation state'],
	viewports: 'desktop',
}

export const openDatasetEditorTask: AiTaskMetadata = {
	id: 'editor.open-dataset-editor',
	summary: 'Reveal the retained Dataset editor without creating or replacing a draft.',
	preconditions: ['Earthly is open', 'A retained Dataset draft exists'],
	sideEffects: ['Restores the Dataset edit and its mandatory visible Map Stack presentation'],
	viewports: 'desktop',
}

export interface EditorLifecycleSnapshot {
	featureCount: number
	mode: string
	panLocked: boolean
	canUndo: boolean
	canRedo: boolean
	activeDraftId: string | null
	activeWorkspaceId: string | null
	activeWorkspaceChatSessionId: string | null
	workspaceCount: number
	workspaces: Array<{
		id: string
		label: string
		chatSessionId: string | null
	}>
	mapStack: Array<{
		id: string
		entityType: string
		title: string
		visible: boolean
		pinned: boolean
		isolated: boolean
	}>
}

export async function editorLifecycleSnapshot(
	earthly: EarthlySession,
): Promise<EditorLifecycleSnapshot> {
	return earthly.page.evaluate(() => {
		const store = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): {
						features: unknown[]
						mode: string
						panLocked: boolean
						history: { canUndo: boolean; canRedo: boolean }
						activeGeoEditDraftId: string | null
						activeWorkspaceId: string | null
						workspaces: Record<string, { label: string; chatSessionId: string | null }>
						mapStackEntries: Record<
							string,
							{
								id: string
								entityType: string
								title: string
								visible: boolean
								pinned: boolean
								isolated: boolean
							}
						>
						mapStackOrder: string[]
					}
				}
			}
		).__earthlyEditorStore
		if (!store) throw new Error('Earthly editor debug store is unavailable')
		const state = store.getState()
		const activeWorkspace = state.activeWorkspaceId
			? state.workspaces[state.activeWorkspaceId]
			: null
		return {
			featureCount: state.features.length,
			mode: state.mode,
			panLocked: state.panLocked,
			canUndo: state.history.canUndo,
			canRedo: state.history.canRedo,
			activeDraftId: state.activeGeoEditDraftId,
			activeWorkspaceId: state.activeWorkspaceId,
			activeWorkspaceChatSessionId: activeWorkspace?.chatSessionId ?? null,
			workspaceCount: Object.keys(state.workspaces).length,
			workspaces: Object.entries(state.workspaces).map(([id, workspace]) => ({
				id,
				label: workspace.label,
				chatSessionId: workspace.chatSessionId,
			})),
			mapStack: state.mapStackOrder
				.map((id) => state.mapStackEntries[id])
				.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
		}
	})
}

async function firstVisible(locator: Locator): Promise<Locator | null> {
	for (const candidate of await locator.all()) {
		if (await candidate.isVisible()) return candidate
	}
	return null
}

async function openMobileTools(earthly: EarthlySession): Promise<void> {
	const trigger = earthly.page.getByRole('button', { name: /^More tools/ })
	await expect(trigger).toBeVisible()
	await trigger.click()
}

async function clickHistoryAction(earthly: EarthlySession, action: 'Undo' | 'Redo'): Promise<void> {
	if (earthly.isMobile) {
		await openMobileTools(earthly)
		await earthly.page.getByRole('menuitem', { name: action, exact: true }).click()
		return
	}

	const direct = await firstVisible(earthly.page.getByRole('button', { name: action, exact: true }))
	if (direct) {
		await direct.click()
		return
	}

	await earthly.page.getByText('Edit', { exact: true }).first().click()
	await earthly.page.getByRole('menuitem', { name: action, exact: true }).click()
}

export async function openDatasetEditor(earthly: EarthlySession): Promise<Locator> {
	if (earthly.isMobile) throw new Error('The persistent Dataset editor rail is desktop-only')
	const datasetSurface = earthly.page.getByRole('button', { name: 'Dataset', exact: true })
	await expect(datasetSurface).toBeVisible()
	await datasetSurface.click()
	const nameInput = earthly.page.getByPlaceholder('Name').first()
	await expect(nameInput).toBeVisible()
	return nameInput
}

export async function cancelDrawingAndVerifyRecovery(
	earthly: EarthlySession,
): Promise<EditorLifecycleSnapshot> {
	await startDataset(earthly)
	await earthly.page.getByRole('button', { name: 'Draw line', exact: true }).first().click()
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).mode)
		.toBe('draw_linestring')

	if (earthly.isMobile) {
		await openMobileTools(earthly)
		const panLock = earthly.page.getByRole('menuitemcheckbox', {
			name: 'Lock pan while drawing',
			exact: true,
		})
		await panLock.click()
		await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).panLocked).toBe(true)
		await openMobileTools(earthly)
		await earthly.page.getByRole('menuitem', { name: 'Cancel drawing', exact: true }).click()
	} else {
		await earthly.page.getByRole('button', { name: 'Select mode', exact: true }).click()
	}

	await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).mode).toBe('select')
	await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).panLocked).toBe(false)

	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
	await clickEditorMap(earthly, 0.63, 0.43)
	await expectGeometryFeatureCount(earthly, 1)
	return editorLifecycleSnapshot(earthly)
}

export async function undoRedoGeometry(earthly: EarthlySession): Promise<EditorLifecycleSnapshot> {
	await startDataset(earthly)
	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
	await clickEditorMap(earthly, 0.61, 0.41)
	await expectGeometryFeatureCount(earthly, 1)
	await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).canUndo).toBe(true)

	await clickHistoryAction(earthly, 'Undo')
	await expectGeometryFeatureCount(earthly, 0)
	await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).canRedo).toBe(true)

	await clickHistoryAction(earthly, 'Redo')
	await expectGeometryFeatureCount(earthly, 1)
	return editorLifecycleSnapshot(earthly)
}

export async function exerciseMapStackDraftLifecycle(
	earthly: EarthlySession,
): Promise<EditorLifecycleSnapshot> {
	if (earthly.isMobile) throw new Error('Map Stack draft lifecycle currently targets desktop')
	if ((await geometryDraftSnapshot(earthly)).featureCount === 0) {
		await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
		await clickEditorMap(earthly, 0.6, 0.4)
		await expectGeometryFeatureCount(earthly, 1)
	}

	const mapStack = earthly.page.getByRole('region', { name: 'Map stack' })
	if (!(await mapStack.isVisible())) {
		await earthly.page.getByRole('button', { name: 'Show map stack' }).click()
		await expect(mapStack).toBeVisible()
	}

	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(earthly)).mapStack.some(
				(entry) => entry.id === 'draft:active',
			),
		)
		.toBe(true)

	const clear = mapStack.getByRole('button', { name: 'Clear', exact: true })
	if (await clear.isEnabled()) await clear.click()
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(earthly)).mapStack.some(
				(entry) => entry.id === 'draft:active',
			),
		)
		.toBe(true)
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(earthly)).mapStack.every(
				(entry) => entry.id === 'draft:active' || entry.pinned,
			),
		)
		.toBe(true)

	await mapStack.getByRole('button', { name: 'Isolate on the map', exact: true }).click()
	await expect
		.poll(
			async () =>
				(await editorLifecycleSnapshot(earthly)).mapStack.find(
					(entry) => entry.id === 'draft:active',
				)?.isolated,
		)
		.toBe(true)
	await mapStack.getByRole('button', { name: 'Show all', exact: true }).click()
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(earthly)).mapStack.some((entry) => entry.isolated),
		)
		.toBe(false)
	return editorLifecycleSnapshot(earthly)
}
