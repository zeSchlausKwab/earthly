import { test } from '../fixtures/earthly'
import { inspectSurface } from '../tasks/diagnostics/inspect-surface'
import { openPanel } from '../tasks/navigation/open-panel'

const viewports = [
	{ width: 320, height: 568 },
	{ width: 390, height: 844 },
	{ width: 768, height: 1024 },
	{ width: 1024, height: 768 },
	{ width: 1440, height: 900 },
]

test('settings and navigation adapt across breakpoint boundaries @audit', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'One context can resize through the full matrix')
	test.setTimeout(60_000)
	const observations = []
	for (const viewport of viewports) {
		await earthly.page.setViewportSize(viewport)
		await earthly.open({ tour: 'seen' })
		await openPanel(earthly, 'Settings')
		await earthly.page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				),
		)
		const surface = await inspectSurface(earthly)
		observations.push({
			viewport,
			pathname: new URL(earthly.page.url()).pathname,
			documentOverflowX: surface.documentOverflowX,
			headings: surface.headings,
			unnamedControlCount: surface.unnamedControls.length,
			undersizedControlCount: surface.undersizedControls.length,
			clippedControlCount: surface.clippedControls.length,
			clippedControls: surface.clippedControls.slice(0, 5),
			tinyTextCount: surface.tinyText.length,
			visibleControlCount: surface.visibleControlCount,
		})
		await testInfo.attach(`settings-${viewport.width}x${viewport.height}.png`, {
			body: await earthly.page.screenshot({ animations: 'disabled' }),
			contentType: 'image/png',
		})
	}
	console.log(`AI_AUDIT_RESPONSIVE:${JSON.stringify(observations)}`)
	await testInfo.attach('responsive-observations.json', {
		body: JSON.stringify(observations, null, 2),
		contentType: 'application/json',
	})
})
