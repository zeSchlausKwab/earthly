import { defineExperiencePersona } from '../model'

export const eventVisitor = defineExperiencePersona({
	id: 'event-visitor',
	name: 'Event visitor',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When I open a venue map on my phone, I want to find the next stage or service without learning how the map was authored.',
	sophistication: { domain: 'basic', earthly: 'novice' },
	patience: {
		level: 'very-low',
		abandonmentTriggers: [
			'The shared link does not open the promised venue.',
			'Authoring UI hides the map.',
		],
	},
	platforms: { primary: 'mobile-web', secondary: ['android'] },
	constraints: {
		connectivity: ['Congested mobile network at the venue.'],
		privacy: ['Does not expect to publish merely by opening the map.'],
		trust: ['Trusts the organizer link but not unrelated prompts.'],
		accessibility: ['Readable outdoors and usable one-handed.'],
		environment: ['Crowded, noisy, and time-sensitive.'],
	},
	vocabulary: {
		familiar: ['stage', 'food', 'bar', 'meeting point', 'map'],
		confusing: ['dataset', 'proposal', 'map stack', 'context'],
	},
	likelyMistakes: ['Closes an inspector expecting to return to the venue map.'],
	recoveryBehavior: ['Uses Back once, then abandons the map if the venue context is lost.'],
	journeyIds: ['event-venue-map'],
})
