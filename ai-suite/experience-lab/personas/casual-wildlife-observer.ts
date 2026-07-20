import { defineExperiencePersona } from '../model'

export const casualWildlifeObserver = defineExperiencePersona({
	id: 'casual-wildlife-observer',
	name: 'Casual wildlife observer',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When I notice an animal, I want to share a photo and its location immediately so other people can see what is nearby.',
	sophistication: { domain: 'basic', earthly: 'novice' },
	patience: {
		level: 'very-low',
		abandonmentTriggers: [
			'I cannot find a clear capture action within the first screen.',
			'I am asked to understand datasets, relays, or map-editing terminology.',
			'I cannot tell whether the post succeeded or who can see it.',
		],
	},
	platforms: { primary: 'mobile-web', secondary: ['android'] },
	constraints: {
		connectivity: ['Ordinary mobile connectivity that may briefly drop.'],
		privacy: ['Wants a visible warning before publishing location publicly.'],
		trust: ['Will grant camera access readily but may deny precise location once.'],
		accessibility: ['Touch targets must work one-handed.'],
		environment: ['Outside, distracted, and possibly moving.'],
	},
	vocabulary: {
		familiar: ['photo', 'location', 'post', 'public', 'sighting'],
		confusing: ['dataset', 'context', 'relay', 'publish channel', 'map stack'],
	},
	likelyMistakes: [
		'Denies location before understanding why it is requested.',
		'Taps the map while trying to pan.',
		'Closes the editor and expects the unfinished sighting to remain recoverable.',
	],
	recoveryBehavior: [
		'Looks for one obvious Back, Cancel, or Retry action.',
		'Abandons the flow rather than opening Settings to repair it.',
	],
	journeyIds: ['squirrel-capture'],
})
