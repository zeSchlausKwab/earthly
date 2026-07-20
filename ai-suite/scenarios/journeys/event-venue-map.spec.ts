import type { EarthlySession } from '../../core/session'
import type { ScenarioRunDefinition } from '../../experience-lab/model'
import { ExperienceRunRecorder } from '../../experience-lab/run-recorder'
import { expect, test } from '../../fixtures/earthly'
import { authorizeJourneyIdentity } from '../../tasks/auth/authorize-journey-identity'
import { startDataset } from '../../tasks/create/dataset'
import {
	addLabelToGeometryDraft,
	addPolygonToGeometryDraft,
	publishCurrentGeometryDataset,
} from '../../tasks/create/geometry'
import { commentOverlaySnapshot, postAnnotatedComment } from '../../tasks/social/comments'
import { openPanel } from '../../tasks/navigation/open-panel'
import { copyCurrentShareLink } from '../../tasks/navigation/share-current-view'

const organizerRun: ScenarioRunDefinition = {
	id: 'event-venue-organizer-desktop-baseline',
	personaId: 'event-organizer',
	journeyId: 'event-venue-map',
	platform: 'desktop-web',
	connectivity: 'Local deterministic services with a reliable authoring connection.',
	publishChannel: 'public',
	startingState: [
		'Organizer is pre-authorized on desktop.',
		'No event-specific vocabulary or entity choice is supplied by the test prompt.',
	],
	reviewLensIds: ['product-complexity', 'privacy-destination', 'accessibility', 'platform-parity'],
}

const visitorRun: ScenarioRunDefinition = {
	id: 'event-venue-visitor-mobile-baseline',
	personaId: 'event-visitor',
	journeyId: 'event-venue-map',
	platform: 'mobile-web',
	connectivity: 'Fresh mobile browser context opening the organizer link.',
	publishChannel: 'public',
	startingState: [
		'Visitor is signed out and has no Earthly history.',
		'Visitor receives only the organizer-provided link.',
	],
	reviewLensIds: ['product-complexity', 'privacy-destination', 'accessibility', 'platform-parity'],
}

async function expectVenueContent(earthly: EarthlySession, venueName: string): Promise<void> {
	await expect(earthly.page.getByText(venueName, { exact: true }).first()).toBeVisible({
		timeout: 20_000,
	})
	await expect(
		earthly.page.getByRole('button', { name: 'Zoom to Main Stage', exact: true }),
	).toBeVisible()
	await expect(
		earthly.page.getByRole('button', { name: 'Zoom to River Bar', exact: true }),
	).toBeVisible()
}

test('an organizer can hand a named venue map to a mobile visitor @experience-audit @journey-event-venue', async ({
	earthly,
	newEarthlySession,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The organizer starts this cross-viewport handoff')
	test.slow()
	await authorizeJourneyIdentity(earthly, 'owner')
	const visitor = await newEarthlySession()
	await visitor.page.setViewportSize({ width: 390, height: 844 })

	const organizerRecorder = new ExperienceRunRecorder(earthly, testInfo, organizerRun)
	const visitorRecorder = new ExperienceRunRecorder(visitor, testInfo, visitorRun)
	const venueName = `Riverlight Festival ${Date.now().toString(36)}`
	const comment = 'If you get separated, meet beside the quiet gate beyond the main stage.'
	let organizerEvidence: Awaited<ReturnType<ExperienceRunRecorder['finish']>> | undefined
	let visitorEvidence: Awaited<ReturnType<ExperienceRunRecorder['finish']>> | undefined

	try {
		await organizerRecorder.observe(
			'organizer-entry',
			'The organizer begins from the ordinary map and must choose an Earthly composition for a venue.',
		)
		const draft = await startDataset(earthly)
		await draft.nameInput.fill(venueName)
		await addPolygonToGeometryDraft(earthly, [
			[0.52, 0.38],
			[0.69, 0.4],
			[0.67, 0.61],
			[0.5, 0.58],
		])
		const stageLabel = await addLabelToGeometryDraft(earthly, 'Mian Stage', 0.59, 0.47)
		await organizerRecorder.observe(
			'organizer-correction-needed',
			'The stage is deliberately misspelled before publishing to exercise in-place recovery.',
		)
		await stageLabel.fill('Main Stage')
		await expect(stageLabel).toHaveValue('Main Stage')
		await addLabelToGeometryDraft(earthly, 'River Bar', 0.64, 0.53)
		await addLabelToGeometryDraft(earthly, 'Food Court', 0.55, 0.53)
		await organizerRecorder.observe(
			'organizer-draft-ready',
			'One Dataset composes the venue outline and named services before publication.',
		)

		await publishCurrentGeometryDataset(earthly)
		await organizerRecorder.observe(
			'organizer-published',
			'The organizer lands on the canonical Dataset inspector after publishing.',
		)
		await postAnnotatedComment(earthly, {
			comment,
			label: 'Quiet meeting point',
		})
		await organizerRecorder.observe(
			'organizer-annotated',
			'A discussion note adds an optional map annotation without changing the venue Dataset.',
		)
		const shareUrl = await copyCurrentShareLink(earthly)
		await organizerRecorder.observe(
			'organizer-shared',
			'The canonical link is copied through the visible Share surface.',
		)

		const shared = new URL(shareUrl)
		await visitor.open({ path: `${shared.pathname}${shared.search}`, tour: 'seen' })
		await expectVenueContent(visitor, venueName)
		await visitorRecorder.observe(
			'visitor-venue-opened',
			'The signed-out visitor receives the venue title, Main Stage, and River Bar from only the link.',
		)
		await expect(visitor.page.getByText(comment, { exact: true }).first()).toBeVisible({
			timeout: 20_000,
		})
		await expect
			.poll(async () => (await commentOverlaySnapshot(visitor)).sourceIds.length, {
				timeout: 20_000,
			})
			.toBeGreaterThan(0)
		await visitorRecorder.observe(
			'visitor-guidance-found',
			'The organizer note and its meeting-point annotation are visible by default.',
		)

		const venuePath = new URL(visitor.page.url()).pathname
		await visitor.page.getByRole('button', { name: 'Close Dataset', exact: true }).click()
		await expect(visitor.page.locator('.maplibregl-canvas')).toBeVisible()
		await expect.poll(() => new URL(visitor.page.url()).pathname).toBe(venuePath)
		await visitorRecorder.observe(
			'visitor-inspector-closed',
			'Closing the read-only inspector preserves the shared venue route and visible map.',
		)

		await openPanel(visitor, 'Sightings')
		const unrelated = visitor.page.getByRole('button', { name: /^Open sighting / }).first()
		await expect(unrelated).toBeVisible()
		await unrelated.click()
		await visitorRecorder.observe(
			'visitor-unrelated-exploration',
			'The visitor can leave the venue task and inspect a different public entity.',
		)
	} finally {
		organizerEvidence = await organizerRecorder.finish()
		visitorEvidence = await visitorRecorder.finish()
	}

	expect(organizerEvidence.browserHealth.pageErrors).toEqual([])
	expect(visitorEvidence.browserHealth.pageErrors).toEqual([])
})
