import { defineExperiencePersona } from '../model'

export const forestryPlanner = defineExperiencePersona({
	id: 'forestry-planner',
	name: 'Forestry planner',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When preparing field work, I want to select and share authoritative geometry so a crew can collect observations against the same plan.',
	sophistication: { domain: 'expert', earthly: 'intermediate' },
	patience: {
		level: 'high',
		abandonmentTriggers: [
			'I cannot determine which data the crew received.',
			'Nearby work might publish publicly.',
		],
	},
	platforms: { primary: 'desktop-web', secondary: ['android'] },
	constraints: {
		connectivity: ['Reliable office connection; intermittent field connection.'],
		privacy: ['Operational plans may be restricted to the field team.'],
		trust: ['Needs visible provenance and role policy.'],
		accessibility: [],
		environment: ['Plans at a desk and later reconciles field results.'],
	},
	vocabulary: {
		familiar: ['layer', 'dataset', 'survey area', 'crew', 'offline'],
		confusing: ['MLS epoch', 'relay policy', 'Nostr event kind'],
	},
	likelyMistakes: ['Assumes map-stack visibility controls what was transferred.'],
	recoveryBehavior: ['Inspects status and retries synchronization before recreating work.'],
	journeyIds: ['forestry-field-survey'],
})
