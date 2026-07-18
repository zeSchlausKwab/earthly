import { test, expect } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { monitorBrowserHealth } from '../tasks/diagnostics/browser-health'
import { inspectSurface, type SurfaceAudit } from '../tasks/diagnostics/inspect-surface'

interface EditorUxObservation {
	step: string
	surface: SurfaceAudit
	editor: Awaited<ReturnType<typeof editorLifecycleSnapshot>>
}

test('editor lifecycle exposes comparable UX evidence @audit @editor-ux-audit', async ({
	earthly,
}, testInfo) => {
	const health = monitorBrowserHealth(earthly.page)
	const observations: EditorUxObservation[] = []

	const capture = async (step: string) => {
		observations.push({
			step,
			surface: await inspectSurface(earthly),
			editor: await editorLifecycleSnapshot(earthly),
		})
		await testInfo.attach(`${step}-${testInfo.project.name}.png`, {
			body: await earthly.page.screenshot({ animations: 'disabled' }),
			contentType: 'image/png',
		})
	}

	await earthly.open({ tour: 'seen' })
	await capture('browse-map')
	await startDataset(earthly)
	await capture('new-dataset')
	await earthly.page.getByRole('button', { name: 'Draw line', exact: true }).first().click()
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).mode)
		.toBe('draw_linestring')
	await capture('drawing-active')

	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: /^More tools/ }).click()
		await earthly.page.getByRole('menuitem', { name: 'Cancel drawing', exact: true }).click()
	} else {
		await earthly.page.getByRole('button', { name: 'Select mode', exact: true }).click()
	}
	await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).mode).toBe('select')
	await capture('drawing-cancelled')

	health.stop()
	expect(health.snapshot().pageErrors).toEqual([])
	await testInfo.attach('editor-ux-observations.json', {
		body: JSON.stringify(observations, null, 2),
		contentType: 'application/json',
	})
	await testInfo.attach('editor-browser-health.json', {
		body: JSON.stringify(health.snapshot(), null, 2),
		contentType: 'application/json',
	})
})
