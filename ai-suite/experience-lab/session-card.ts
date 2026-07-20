import { getExperiencePersona, getJourney } from './catalog'
import type { ExperiencePersona, JourneyDefinition } from './model'

function bullets(values: readonly string[]): string[] {
	return values.map((value) => `- ${value}`)
}

export function renderSessionCard(journey: JourneyDefinition, persona: ExperiencePersona): string {
	if (!journey.actors.some((actor) => actor.personaId === persona.id)) {
		throw new Error(`Persona ${persona.id} does not participate in journey ${journey.id}`)
	}
	return [
		`# Session card: ${journey.title}`,
		'',
		`Persona: **${persona.name}**  `,
		`Evidence: **${persona.evidenceLevel}**  `,
		`Primary platform: **${persona.platforms.primary}**`,
		'',
		'## Facilitator setup',
		'',
		...bullets(journey.startingState),
		...bullets(journey.conditions.seededData),
		'',
		'Do not explain Earthly entities or name controls unless the participant reaches an allowed hint.',
		'',
		'## Participant prompt',
		'',
		journey.taskPrompt,
		'',
		'## Observe',
		'',
		'- Where does the participant try to begin?',
		'- Record meaningful decisions, backtracking, unexplained terms, and dead ends.',
		'- Ask who they believe will receive the result immediately before publishing.',
		'- Record visible confirmation immediately after the primary outcome.',
		'',
		'## Recovery prompts',
		'',
		...journey.recoveryBranches.flatMap((branch) => [
			`- Trigger: ${branch.trigger}`,
			`  - Success: ${branch.success}`,
		]),
		'',
		'## Follow-up task',
		'',
		journey.followUpTask,
		'',
		'## Understanding checks',
		'',
		...bullets(journey.understandingChecks),
		'',
		'## Completion evidence',
		'',
		...bullets(journey.proof),
	].join('\n')
}

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

if (import.meta.main) {
	const journey = getJourney(argument('--journey') ?? 'squirrel-capture')
	const personaId = argument('--persona') ?? journey.actors[0]?.personaId
	if (!personaId) throw new Error(`Journey ${journey.id} has no actor`)
	console.log(renderSessionCard(journey, getExperiencePersona(personaId)))
}
