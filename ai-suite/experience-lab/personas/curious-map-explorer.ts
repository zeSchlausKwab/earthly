import { defineExperiencePersona } from '../model'

export const curiousMapExplorer = defineExperiencePersona({
	id: 'curious-map-explorer',
	name: 'Curious nearby explorer',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When I have a little free time, I want to ask a plain-language question and see a small number of useful nearby options without learning GIS vocabulary.',
	sophistication: { domain: 'novice', earthly: 'novice' },
	patience: {
		level: 'very-low',
		abandonmentTriggers: [
			'The app asks for technical map inputs before answering.',
			'I cannot get back to the map while keeping the useful result.',
		],
	},
	platforms: { primary: 'mobile-web', secondary: ['android'] },
	constraints: {
		connectivity: ['Ordinary mobile connection that may be slow or metered.'],
		privacy: ['Location should be requested and explained rather than assumed.'],
		trust: ['Needs recognizable places and a clear explanation of why they fit.'],
		accessibility: ['Primary actions must remain reachable one-handed.'],
		environment: ['Standing or walking outdoors with brief attention.'],
	},
	vocabulary: {
		familiar: ['near me', 'walking', 'quiet', 'coffee', 'park'],
		confusing: ['isochrone', 'bounding box', 'feature collection'],
	},
	likelyMistakes: ['Closes chat expecting its recommendations to remain visible on the map.'],
	recoveryBehavior: [
		'Rephrases once in everyday language, then leaves if the result stays abstract.',
	],
	journeyIds: ['conversational-nearby-discovery'],
})
