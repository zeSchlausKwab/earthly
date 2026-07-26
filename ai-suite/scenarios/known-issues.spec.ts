import { test, expect } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import { inspectSurface } from '../tasks/diagnostics/inspect-surface'
import { walkKeyboardOrder } from '../tasks/diagnostics/keyboard-walk'
import { openPanel } from '../tasks/navigation/open-panel'
import { inspectTourTargets } from '../tasks/onboarding/tour'

test('Connect to Nostr choices fit a generous desktop dialog @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The reported overflow is desktop-specific')
	await earthly.open({ tour: 'seen' })
	await earthly.page.getByRole('button', { name: 'Get a Nostr identity' }).click()

	const dialog = earthly.page.getByRole('dialog', { name: 'Connect to Nostr' })
	await expect(dialog).toBeVisible()
	const layout = await dialog.evaluate((element) => {
		const rect = element.getBoundingClientRect()
		return {
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
			width: rect.width,
			left: rect.left,
			right: rect.right,
			viewportWidth: document.documentElement.clientWidth,
		}
	})

	expect(layout.width).toBeGreaterThanOrEqual(640)
	expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1)
	expect(layout.left).toBeGreaterThanOrEqual(16)
	expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth - 16)
})

// FIXED (audit P1 #1/#4): the tour is viewport-split; every anchored step must
// point at a visible control. Steps without a target (welcome, finale, and the
// desktop collaboration concept step) are intentionally centered.
test('all anchored tour steps point at visible controls @regression', async ({ earthly }) => {
	await earthly.open({ tour: 'new' })
	const observations = await inspectTourTargets(earthly)
	const anchoredSteps = observations.filter(({ target }) => target != null)
	// Guard against the degenerate all-centered tour: both variants anchor at
	// least four steps to real chrome.
	expect(anchoredSteps.length).toBeGreaterThanOrEqual(4)
	const invalidSteps = anchoredSteps
		.filter(({ targetVisible, popoverFitsViewport }) => !targetVisible || !popoverFitsViewport)
		.map(({ step, title, target, targetVisible, popoverFitsViewport }) => ({
			step,
			title,
			target,
			targetVisible,
			popoverFitsViewport,
		}))
	expect(invalidSteps).toEqual([])
})

// FIXED (audit P1 #2): entity-editor close handlers are navigation-safe now —
// startCreate's blanket cleanup no longer drags an unrelated create to /beacons.
test('creating a mobile Dataset does not route to Beacons @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The audited routing defect was mobile-specific')
	await earthly.open({ tour: 'seen' })
	const draft = await startDataset(earthly)
	expect(draft.pathname).not.toBe('/beacons')
})

// FIXED (audit P1 #6): mobile dock/switcher selections write the URL through
// the same canonical router as desktop, and reload restores the destination.
test('mobile panel choices update the canonical route @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The mobile panel switcher had separate state')
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Contexts')
	expect.soft(new URL(earthly.page.url()).pathname).toBe('/contexts')
	await earthly.page.reload()
	await expect(
		earthly.page.getByRole('heading', { name: 'Contexts', exact: true }).first(),
	).toBeVisible()
})

// FIXED (audit P1 #3): signed-out Profile/Wallet/My-Entities render the shared
// SignedOutCta with a labeled sign-in action instead of a dead-end message.
test('anonymous mobile account panels offer a sign-in recovery action @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'Desktop retains separate global identity controls')
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Profile')
	await expect(
		earthly.page.getByRole('button', { name: /sign in|create.*identity|get.*identity/i }).first(),
	).toBeVisible()
})

// FIXED (audit P2 #12): compact Zap and Posts refresh actions expose explicit
// names even when disabled or rendered without visible text.
test('visible icon actions have accessible names @regression', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Datasets')
	const surface = await inspectSurface(earthly)
	expect(surface.unnamedControls).toEqual([])
})

// FIXED (audit P2 #12): ListPanel uses a visible h2 on desktop and an sr-only
// h2 when its visual title is supplied by the mobile sheet switcher.
test('primary browse panels expose a semantic heading @regression', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	for (const [panel, heading] of [
		['Datasets', 'Datasets'],
		['Contexts', 'Contexts'],
		['Stories', 'Stories'],
		['Sightings', 'Sightings'],
		['Beacons', 'Beacons'],
		['Profile', 'Profile'],
		['Posts', 'Local posts'],
		['Wallet', 'Wallet'],
		['Settings', 'Settings'],
		['Help', 'Help'],
	] as const) {
		await openPanel(earthly, panel)
		await expect
			.soft(earthly.page.getByRole('heading', { name: heading, exact: true }).first())
			.toBeAttached()
	}
})

// FIXED (audit P1 #7): map bubble actions remain available through the entity
// list but leave the ordinary mobile tab order, so the dock is reachable.
test('mobile keyboard users can reach primary navigation promptly @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The audited focus-order defect is mobile-specific')
	await earthly.open({ tour: 'seen' })
	// Wait for a real photo bubble before walking so the assertion still covers
	// a populated map on slow relays. Mobile bubbles deliberately leave the
	// ordinary tab order, but retain their user-facing image-gallery name.
	await expect(
		earthly.page.getByRole('button', { name: /^View photos for sighting:/ }).first(),
	).toBeVisible({ timeout: 15_000 })
	const stops = await walkKeyboardOrder(earthly, 25)
	expect(stops.some(({ name }) => name === 'Menu')).toBe(true)
})

// FIXED (audit P1 #5): the desktop shell keeps a 25rem minimum, preserving at
// least 280px of Settings tab content at the 768px breakpoint.
test('Settings retains a usable content width at the desktop breakpoint @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The defect occurs at the desktop breakpoint')
	await earthly.page.setViewportSize({ width: 768, height: 1024 })
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Settings')
	const panel = earthly.page.getByRole('tabpanel', { name: 'Chat' })
	await expect(panel).toBeVisible()
	const panelWidth = (await panel.boundingBox())?.width ?? 0
	expect(panelWidth).toBeGreaterThanOrEqual(280)
})

// FIXED (audit P2 #15): the read-only Announcements category uses a read-only
// empty state instead of promising an unavailable posting action.
test('Announcements empty state does not promise an unavailable posting action @regression', async ({
	earthly,
}) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Posts')
	await expect(earthly.page.getByText('No posts yet. Be the first to post!')).toBeHidden()
})

// FIXED (audit P2 #15): category names stay visible beside their emoji at the
// mobile breakpoint.
test('mobile Posts tabs retain descriptive visible labels @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The sm breakpoint hides these labels on mobile')
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Posts')
	await expect(earthly.page.getByText('Announcements', { exact: true })).toBeVisible()
})
