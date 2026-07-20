import type { TestInfo } from '@playwright/test'
import type { EarthlySession } from '../core/session'
import {
	monitorBrowserHealth,
	type BrowserHealthMonitor,
	type BrowserHealthSnapshot,
} from '../tasks/diagnostics/browser-health'
import {
	observeJourneyStep,
	type JourneyStepObservation,
} from '../tasks/diagnostics/journey-observation'
import type { ScenarioRunDefinition } from './model'

export interface ExperienceRunEvidence {
	run: ScenarioRunDefinition
	startedAt: string
	completedAt: string
	observations: JourneyStepObservation[]
	browserHealth: BrowserHealthSnapshot
}

export class ExperienceRunRecorder {
	readonly observations: JourneyStepObservation[] = []
	readonly startedAt = new Date().toISOString()
	readonly health: BrowserHealthMonitor

	constructor(
		private readonly earthly: EarthlySession,
		private readonly testInfo: TestInfo,
		readonly run: ScenarioRunDefinition,
	) {
		this.health = monitorBrowserHealth(earthly.page)
	}

	async observe(step: string, note?: string): Promise<JourneyStepObservation> {
		const observation = await observeJourneyStep(this.earthly, step, note)
		this.observations.push(observation)
		await this.testInfo.attach(`${String(this.observations.length).padStart(2, '0')}-${step}.png`, {
			body: await this.earthly.page.screenshot({ animations: 'disabled' }),
			contentType: 'image/png',
		})
		return observation
	}

	async finish(): Promise<ExperienceRunEvidence> {
		this.health.stop()
		const evidence: ExperienceRunEvidence = {
			run: this.run,
			startedAt: this.startedAt,
			completedAt: new Date().toISOString(),
			observations: this.observations,
			browserHealth: this.health.snapshot(),
		}
		console.log(`EARTHLY_EXPERIENCE_RUN:${JSON.stringify(evidence)}`)
		await this.testInfo.attach('experience-run.json', {
			body: JSON.stringify(evidence, null, 2),
			contentType: 'application/json',
		})
		return evidence
	}
}
