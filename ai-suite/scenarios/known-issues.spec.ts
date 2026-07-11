import { test, expect } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import { inspectSurface } from '../tasks/diagnostics/inspect-surface'
import { walkKeyboardOrder } from '../tasks/diagnostics/keyboard-walk'
import { openPanel } from '../tasks/navigation/open-panel'
import { inspectTourTargets } from '../tasks/onboarding/tour'

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
		earthly.page
			.locator('button:visible')
			.filter({ hasText: /^Contexts/ })
			.first(),
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

test('visible icon actions have accessible names @known-issue', async ({ earthly }) => {
	test.fail(
		true,
		'Known audit finding: compact Zap and Posts refresh actions have no accessible name',
	)
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Datasets')
	const surface = await inspectSurface(earthly)
	expect(surface.unnamedControls).toEqual([])
})

test('primary browse panels expose a semantic heading @known-issue', async ({ earthly }) => {
	test.fail(
		true,
		'Known audit finding: primary panel titles are visual controls rather than headings',
	)
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Datasets')
	const surface = await inspectSurface(earthly)
	expect(surface.headings).not.toEqual([])
})

test('mobile keyboard users can reach primary navigation promptly @known-issue', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The audited focus-order defect is mobile-specific')
	test.fail(true, 'Known audit finding: map marker buttons precede and bury the mobile navigation')
	await earthly.open({ tour: 'seen' })
	// The defect only reproduces once sighting markers are in the tab order —
	// on a slow relay the walk would otherwise reach the dock and flake as an
	// unexpected pass. Wait for the first marker before walking.
	await expect(earthly.page.getByRole('button', { name: /^Open sighting:/ }).first()).toBeVisible({
		timeout: 15_000,
	})
	const stops = await walkKeyboardOrder(earthly, 25)
	expect(stops.some(({ name }) => name === 'Explore')).toBe(true)
})

test('Settings retains a usable content width at the desktop breakpoint @known-issue', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The defect occurs at the desktop breakpoint')
	test.fail(true, 'Known audit finding: Settings content collapses to roughly 94px at 768px')
	await earthly.page.setViewportSize({ width: 768, height: 1024 })
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Settings')
	const panel = earthly.page.getByRole('tabpanel', { name: 'Chat' })
	await expect(panel).toBeVisible()
	expect((await panel.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(280)
})

test('Announcements empty state does not promise an unavailable posting action @known-issue', async ({
	earthly,
}) => {
	test.fail(
		true,
		'Known audit finding: Announcements hides the post form but says “Be the first to post!”',
	)
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Posts')
	await expect(earthly.page.getByText('No posts yet. Be the first to post!')).toBeHidden()
})

test('mobile Posts tabs retain descriptive visible labels @known-issue', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The sm breakpoint hides these labels on mobile')
	test.fail(true, 'Known audit finding: mobile category tabs render only four unexplained emoji')
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Posts')
	await expect(earthly.page.getByText('Announcements', { exact: true })).toBeVisible()
})
