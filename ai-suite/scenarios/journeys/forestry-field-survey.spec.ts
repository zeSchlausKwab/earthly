import type { ScenarioRunDefinition } from '../../experience-lab/model'
import { ExperienceRunRecorder } from '../../experience-lab/run-recorder'
import { expect, test } from '../../fixtures/earthly'
import { authorizeJourneyIdentity } from '../../tasks/auth/authorize-journey-identity'
import { startDataset } from '../../tasks/create/dataset'
import {
	addPolygonToGeometryDraft,
	publishCurrentGeometryDataset,
} from '../../tasks/create/geometry'
import { cancelSightingPlacement, startSightingPlacement } from '../../tasks/create/sighting'
import { openPanel } from '../../tasks/navigation/open-panel'
import { installSimulatedNativeLocalNode } from '../../tasks/setup/simulated-native-local-node'

const plannerRun: ScenarioRunDefinition = {
	id: 'forestry-planner-desktop-handoff-baseline',
	personaId: 'forestry-planner',
	journeyId: 'forestry-field-survey',
	platform: 'desktop-web',
	connectivity: 'Local deterministic services with reliable office connectivity.',
	publishChannel: 'public',
	startingState: [
		'Planner is pre-authorized on desktop.',
		'No Field session or native Earthly runtime is available in the browser.',
	],
	reviewLensIds: ['product-complexity', 'privacy-destination', 'platform-parity'],
}

const hostRun: ScenarioRunDefinition = {
	id: 'forestry-field-host-mobile-boundary-baseline',
	personaId: 'field-crew-member',
	journeyId: 'forestry-field-survey',
	platform: 'android',
	connectivity:
		'Deterministic simulated native command boundary; Wi-Fi and peer transport are not simulated.',
	publishChannel: 'field-session',
	startingState: [
		'Crew identity is pre-authorized.',
		'An Android-shaped local node exposes one nearby network address.',
		'No participant device is paired.',
	],
	reviewLensIds: ['product-complexity', 'privacy-destination', 'accessibility', 'platform-parity'],
}

test('a forestry plan reaches the browser/native handoff and the field host can leave safely @experience-audit @journey-forestry-field-survey', async ({
	earthly,
	newEarthlySession,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The planner begins this cross-runtime journey')
	test.setTimeout(120_000)
	await authorizeJourneyIdentity(earthly, 'owner')

	const fieldDevice = await newEarthlySession()
	await fieldDevice.page.setViewportSize({ width: 390, height: 844 })
	await authorizeJourneyIdentity(fieldDevice, 'mara')
	await installSimulatedNativeLocalNode(fieldDevice)
	await fieldDevice.open({ tour: 'seen' })

	const plannerRecorder = new ExperienceRunRecorder(earthly, testInfo, plannerRun)
	const hostRecorder = new ExperienceRunRecorder(fieldDevice, testInfo, hostRun)
	const planName = `North creek survey ${Date.now().toString(36)}`
	const sessionName = `North creek field team ${Date.now().toString(36)}`
	let plannerEvidence: Awaited<ReturnType<ExperienceRunRecorder['finish']>> | undefined
	let hostEvidence: Awaited<ReturnType<ExperienceRunRecorder['finish']>> | undefined

	try {
		await plannerRecorder.observe(
			'planner-entry',
			'The planner starts from the ordinary public map with no Field session active.',
		)
		const plan = await startDataset(earthly)
		await plan.nameInput.fill(planName)
		await addPolygonToGeometryDraft(earthly, [
			[0.5, 0.38],
			[0.69, 0.4],
			[0.67, 0.61],
			[0.48, 0.58],
		])
		await publishCurrentGeometryDataset(earthly)
		await plannerRecorder.observe(
			'planner-plan-published',
			'The authoritative survey boundary exists as an ordinary public Dataset.',
		)

		await openPanel(earthly, 'Field sessions')
		await expect(earthly.page.getByText('Earthly app required', { exact: true })).toBeVisible()
		await plannerRecorder.observe(
			'planner-native-boundary',
			'The browser explains the native boundary but offers no handoff for the Dataset just prepared.',
		)

		await openPanel(fieldDevice, 'Field sessions')
		await hostRecorder.observe(
			'field-device-entry',
			'The app-shaped surface explains a shared nearby workspace and host policy.',
		)
		await fieldDevice.page.getByLabel('Session name').fill(sessionName)
		await fieldDevice.page.getByRole('button', { name: 'Start Field session' }).click()
		await expect(fieldDevice.page.getByRole('heading', { name: sessionName })).toBeVisible()
		await expect(fieldDevice.page.getByText('Nearby only', { exact: true }).first()).toBeVisible()
		await expect(fieldDevice.page.getByText('host', { exact: true })).toBeVisible()
		await hostRecorder.observe(
			'field-session-live',
			'Host role and Nearby-only delivery are visible after starting the session.',
		)

		await fieldDevice.page.getByRole('tab', { name: 'Map', exact: true }).click()
		await expect(
			fieldDevice.page.getByText('No nearby geometry yet', { exact: true }),
		).toBeVisible()
		await expect(fieldDevice.page.getByText(planName, { exact: true })).toHaveCount(0)
		await hostRecorder.observe(
			'plan-not-transferred',
			'The public survey exists, but the Field session has no action for selecting or migrating it.',
		)

		await fieldDevice.page.getByRole('button', { name: 'New nearby dataset' }).click()
		await expect(
			fieldDevice.page.getByRole('group', {
				name: new RegExp(`Current destination: Nearby.*${sessionName}`),
			}),
		).toBeVisible()
		await hostRecorder.observe(
			'nearby-draft-started',
			'A new draft visibly targets the named Nearby session rather than Public.',
		)

		await fieldDevice.page
			.getByRole('button', { name: `Leave destination: Nearby · ${sessionName}` })
			.click()
		await expect(
			fieldDevice.page.getByRole('group', { name: /Current destination: Public.*Unattached/ }),
		).toBeVisible()
		await hostRecorder.observe(
			'nearby-draft-left',
			'Leaving returns to Public and retains the draft, but the Dataset navigation drawer remains open.',
		)
		await fieldDevice.page.getByRole('button', { name: 'Map', exact: true }).last().click()
		await expect(fieldDevice.page.getByRole('dialog', { name: 'Earthly navigation' })).toBeHidden()

		await startSightingPlacement(fieldDevice)
		await hostRecorder.observe(
			'public-follow-up-started',
			'The crew can begin unrelated public capture after leaving the nearby destination.',
		)
		await cancelSightingPlacement(fieldDevice)
	} finally {
		plannerEvidence = await plannerRecorder.finish()
		hostEvidence = await hostRecorder.finish()
	}

	expect(plannerEvidence.browserHealth.pageErrors).toEqual([])
	expect(hostEvidence.browserHealth.pageErrors).toEqual([])
})
