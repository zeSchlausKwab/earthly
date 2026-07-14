import { test } from '../fixtures/earthly'
import { monitorBrowserHealth } from '../tasks/diagnostics/browser-health'
import { inspectSurface, type SurfaceAudit } from '../tasks/diagnostics/inspect-surface'
import { walkKeyboardOrder } from '../tasks/diagnostics/keyboard-walk'
import { openPanel, type EarthlyPanel } from '../tasks/navigation/open-panel'

const panels: EarthlyPanel[] = [
	'Datasets',
	'Contexts',
	'Private groups',
	'Stories',
	'Sightings',
	'Beacons',
	'Profile',
	'Posts',
	'Wallet',
	'Settings',
	'Help',
]

interface PanelObservation {
	panel: EarthlyPanel
	pathname: string
	bodyText: string
	surface: SurfaceAudit
}

test('all primary panels expose auditable layout and browser-health evidence @audit', async ({
	earthly,
}, testInfo) => {
	const health = monitorBrowserHealth(earthly.page)
	await earthly.open({ tour: 'seen' })
	const observations: PanelObservation[] = []

	for (const panel of panels) {
		await test.step(panel, async () => {
			await openPanel(earthly, panel)
			observations.push({
				panel,
				pathname: new URL(earthly.page.url()).pathname,
				bodyText: (await earthly.page.locator('body').innerText())
					.replace(/\s+/g, ' ')
					.slice(0, 800),
				surface: await inspectSurface(earthly),
			})
			await testInfo.attach(`${panel.toLowerCase()}-${testInfo.project.name}.png`, {
				body: await earthly.page.screenshot({ animations: 'disabled' }),
				contentType: 'image/png',
			})
		})
	}

	health.stop()
	console.log(
		`AI_AUDIT_PANELS:${testInfo.project.name}:${JSON.stringify(
			observations.map(({ panel, pathname, bodyText, surface }) => ({
				panel,
				pathname,
				copy: ['Profile', 'Posts', 'Wallet', 'Help'].includes(panel)
					? bodyText.slice(0, 300)
					: undefined,
				headings: surface.headings,
				unnamedControls: surface.unnamedControls,
				undersizedControlCount: surface.undersizedControls.length,
				clippedControlCount: surface.clippedControls.length,
				tinyTextCount: surface.tinyText.length,
				visibleControlCount: surface.visibleControlCount,
				documentOverflowX: surface.documentOverflowX,
			})),
		)}`,
	)
	console.log(`AI_AUDIT_HEALTH:${testInfo.project.name}:${JSON.stringify(health.snapshot())}`)
	await testInfo.attach('panel-observations.json', {
		body: JSON.stringify(observations, null, 2),
		contentType: 'application/json',
	})
	await testInfo.attach('browser-health.json', {
		body: JSON.stringify(health.snapshot(), null, 2),
		contentType: 'application/json',
	})
})

test('initial tab order stays named and inside the viewport @audit', async ({
	earthly,
}, testInfo) => {
	await earthly.open({ tour: 'seen' })
	const stops = await walkKeyboardOrder(earthly, 35)
	console.log(`AI_AUDIT_KEYBOARD:${testInfo.project.name}:${JSON.stringify(stops)}`)
	await testInfo.attach('keyboard-order.json', {
		body: JSON.stringify(stops, null, 2),
		contentType: 'application/json',
	})
})
