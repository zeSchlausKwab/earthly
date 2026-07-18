import { expect, test } from '../../fixtures/earthly'
import { ExperienceRunRecorder } from '../../experience-lab/run-recorder'
import type { ScenarioRunDefinition } from '../../experience-lab/model'
import { authorizeJourneyIdentity } from '../../tasks/auth/authorize-journey-identity'
import {
	cancelSightingPlacement,
	placeSighting,
	publishSighting,
	startSightingPlacement,
} from '../../tasks/create/sighting'
import { openPanel } from '../../tasks/navigation/open-panel'

const run: ScenarioRunDefinition = {
	id: 'squirrel-capture-mobile-web-baseline',
	personaId: 'casual-wildlife-observer',
	journeyId: 'squirrel-capture',
	platform: 'mobile-web',
	connectivity: 'Local deterministic services; media upload unavailable.',
	publishChannel: 'public',
	startingState: [
		'First-run tour dismissed.',
		'Local author pre-authorized so the journey evaluates capture rather than key management.',
	],
	reviewLensIds: ['product-complexity', 'privacy-destination', 'accessibility', 'platform-parity'],
}

test('a casual observer can recover, publish a squirrel sighting, and continue @experience-audit @journey-squirrel-capture', async ({
	earthly,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== 'mobile',
		'The first cohort evaluates the mobile capture path',
	)
	test.slow()
	await authorizeJourneyIdentity(earthly, 'owner')

	const recorder = new ExperienceRunRecorder(earthly, testInfo, run)
	const title = `Squirrel by the oak ${Date.now().toString(36)}`
	let evidence: Awaited<ReturnType<ExperienceRunRecorder['finish']>> | undefined
	try {
		const entry = await recorder.observe(
			'entry',
			'The participant starts from the map with no Earthly entity vocabulary supplied.',
		)
		expect(entry.currentDestination).toContain('Public')

		await startSightingPlacement(earthly)
		const placement = await recorder.observe(
			'placement-armed',
			'The first placement is intentionally cancelled.',
		)
		expect(placement.visibleAlerts.join(' ')).not.toContain('Lock panning to draw')
		await cancelSightingPlacement(earthly)
		const recovered = await recorder.observe(
			'placement-recovered',
			'The map must remain usable after cancellation.',
		)
		expect(recovered.visibleAlerts.join(' ')).not.toContain('Lock panning to draw')

		await startSightingPlacement(earthly)
		await placeSighting(earthly)
		const form = await recorder.observe(
			'editor-ready',
			'Media is inspected but not uploaded because deterministic localhost Blossom is unavailable.',
		)
		expect(form.headings.some((heading) => heading.text === 'New Sighting')).toBe(true)
		expect(form.visibleAlerts.join(' ')).not.toContain('Lock panning to draw')
		await publishSighting(earthly, {
			title,
			description: 'A small red squirrel carrying an acorn beside the old oak.',
		})
		await recorder.observe('published', 'The canonical Sighting inspector is the publish result.')

		await openPanel(earthly, 'Sightings')
		await expect(earthly.page.getByRole('button', { name: `Open sighting ${title}` })).toBeVisible()
		await recorder.observe('list-return', 'The new Sighting is discoverable in the browse list.')

		const otherSighting = earthly.page
			.getByRole('button', { name: /^Open sighting / })
			.filter({ hasNotText: title })
			.first()
		if ((await otherSighting.count()) > 0) {
			await otherSighting.click()
			await recorder.observe('inspect-another', 'A seeded Sighting is inspected after publishing.')
		}

		await startSightingPlacement(earthly)
		await recorder.observe(
			'second-capture-started',
			'The participant is not trapped by the first task.',
		)
		await cancelSightingPlacement(earthly)
	} finally {
		evidence = await recorder.finish()
	}

	expect(evidence.browserHealth.pageErrors).toEqual([])
})
