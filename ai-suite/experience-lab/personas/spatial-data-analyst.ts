import { defineExperiencePersona } from '../model'

export const spatialDataAnalyst = defineExperiencePersona({
	id: 'spatial-data-analyst',
	name: 'Spatial data analyst',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When a spatial question spans several sources, I want AI assistance to assemble a traceable draft that I can inspect, correct, and keep editing with ordinary map tools.',
	sophistication: { domain: 'expert', earthly: 'intermediate' },
	patience: {
		level: 'high',
		abandonmentTriggers: [
			'The result cannot be inspected as ordinary Earthly data.',
			'The assistant mutates or publishes data without a visible review boundary.',
		],
	},
	platforms: { primary: 'desktop-web', secondary: [] },
	constraints: {
		connectivity: ['Reliable office connection, with occasional slow external providers.'],
		privacy: ['Private or unpublished inputs must not be sent to an external model implicitly.'],
		trust: ['Needs source provenance, visible tool use, and a reversible approval step.'],
		accessibility: [],
		environment: ['Large desktop viewport with simultaneous chat, map, and editor use.'],
	},
	vocabulary: {
		familiar: ['dataset', 'catchment', 'provenance', 'GeoJSON', 'walking time'],
		confusing: ['model context window', 'tool round', 'binding'],
	},
	likelyMistakes: [
		'Assumes a plausible natural-language answer has already become canonical map data.',
	],
	recoveryBehavior: [
		'Inspects the proposed geometry, rejects or undoes it, refines the prompt, then continues manually.',
	],
	journeyIds: ['conversational-spatial-research'],
})
