import { defineExperiencePersona } from '../model'

export const fieldCrewMember = defineExperiencePersona({
	id: 'field-crew-member',
	name: 'Field crew member',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When I join a field session, I want to see the assigned plan and add observations even when internet connectivity is unreliable.',
	sophistication: { domain: 'expert', earthly: 'novice' },
	patience: {
		level: 'low',
		abandonmentTriggers: [
			'Joining repeatedly times out.',
			'I cannot tell whether my observation reached the team.',
		],
	},
	platforms: { primary: 'android', secondary: ['mobile-web'] },
	constraints: {
		connectivity: ['Nearby Wi-Fi may work while the internet is unavailable.'],
		privacy: ['Must not accidentally publish an operational observation globally.'],
		trust: ['Trusts the planner and field host, not unknown peers.'],
		accessibility: ['Large touch targets usable with gloves.'],
		environment: ['Outdoor glare, wet conditions, and frequent interruptions.'],
	},
	vocabulary: {
		familiar: ['assignment', 'area', 'observation', 'team', 'offline'],
		confusing: ['publish channel', 'relay', 'context', 'workspace'],
	},
	likelyMistakes: [
		'Leaves the session while a drawing is active.',
		'Assumes nearby means globally synchronized.',
	],
	recoveryBehavior: ['Retries once, then asks the planner rather than debugging connectivity.'],
	journeyIds: ['forestry-field-survey'],
})
