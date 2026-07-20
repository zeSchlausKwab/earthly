import { describe, expect, test } from 'bun:test'
import { experienceCatalog } from './catalog'
import { renderSessionCard } from './session-card'
import { getExperiencePersona, getJourney } from './catalog'
import { validateExperienceCatalog, type ExperienceCatalog } from './model'

describe('Earthly Journey Lab catalog', () => {
	test('the first cohort has valid persona and journey references', () => {
		expect(validateExperienceCatalog(experienceCatalog)).toEqual([])
		expect(experienceCatalog.personas).toHaveLength(9)
		expect(experienceCatalog.journeys).toHaveLength(6)
	})

	test('rejects a journey actor that has no experience persona', () => {
		const invalid = {
			...experienceCatalog,
			journeys: [
				{
					...experienceCatalog.journeys[0],
					actors: [{ personaId: 'missing-persona', role: 'ghost' }],
				},
			],
		} as unknown as ExperienceCatalog
		expect(validateExperienceCatalog(invalid)).toContain(
			'Journey squirrel-capture references missing persona missing-persona',
		)
	})

	test('renders a neutral human session card with recovery and continuation', () => {
		const journey = getJourney('squirrel-capture')
		const card = renderSessionCard(journey, getExperiencePersona('casual-wildlife-observer'))
		expect(card).toContain('Participant prompt')
		expect(card).toContain('Recovery prompts')
		expect(card).toContain(journey.followUpTask)
		expect(card).not.toContain('Click the')
	})
})
