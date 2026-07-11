import { test, expect } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import { inspectSurface } from '../tasks/diagnostics/inspect-surface'
import { walkKeyboardOrder } from '../tasks/diagnostics/keyboard-walk'
import { openPanel } from '../tasks/navigation/open-panel'
import { inspectTourTargets } from '../tasks/onboarding/tour'

test('all instructional tour steps point at visible controls @known-issue', async ({ earthly }) => {
	test.fail(true, 'Known audit finding: desktop AI Chat and most mobile tour targets are missing')
	await earthly.open({ tour: 'new' })
	const observations = await inspectTourTargets(earthly)
	const instructionalSteps = observations.filter(({ step }) => step >= 2 && step <= 10)
	const invalidSteps = instructionalSteps
		.filter(
			({ target, targetVisible, popoverFitsViewport }) =>
				!target || !targetVisible || !popoverFitsViewport,
		)
		.map(({ step, title, target, targetVisible, popoverFitsViewport }) => ({
			step,
			title,
			target,
			targetVisible,
			popoverFitsViewport,
		}))
	expect(invalidSteps).toEqual([])
})

test('creating a mobile Dataset does not route to Beacons @known-issue', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The audited routing defect is mobile-specific')
	test.fail(
		true,
		'Known audit finding: startCreate closes beacon control and navigates to /beacons',
	)
	await earthly.open({ tour: 'seen' })
	const draft = await startDataset(earthly)
	expect(draft.pathname).not.toBe('/beacons')
})

test('mobile panel choices update the canonical route @known-issue', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The mobile panel switcher has separate state')
	test.fail(true, 'Known audit finding: mobile panel selection never calls the route navigator')
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

test('anonymous mobile account panels offer a sign-in recovery action @known-issue', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'Desktop retains separate global identity controls')
	test.fail(true, 'Known audit finding: mobile Profile and Wallet signed-out states are dead ends')
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Profile')
	await expect(
		earthly.page.getByRole('button', { name: /sign in|create.*identity|get.*identity/i }),
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
