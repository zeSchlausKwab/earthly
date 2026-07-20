import { defineExperiencePersona } from '../model'

export const deliveryDispatcher = defineExperiencePersona({
	id: 'delivery-dispatcher',
	name: 'Delivery dispatcher',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When a route has many stops, I want AI help to prepare and check it, then hand a canonical route to a driver without exposing customer data accidentally.',
	sophistication: { domain: 'expert', earthly: 'basic' },
	patience: {
		level: 'moderate',
		abandonmentTriggers: [
			'The route cannot be corrected before handoff.',
			'Private delivery details may have been sent to a model or public relay silently.',
		],
	},
	platforms: { primary: 'desktop-web', secondary: ['android'] },
	constraints: {
		connectivity: ['Reliable dispatch connection; driver connectivity may vary.'],
		privacy: ['Real customer names and addresses require an explicit external-model boundary.'],
		trust: ['Needs stop ordering, corrections, and handoff state to be auditable.'],
		accessibility: [],
		environment: ['Desktop planning followed by a handoff to a mobile worker.'],
	},
	vocabulary: {
		familiar: ['stop', 'route', 'driver', 'delivery window', 'handoff'],
		confusing: ['MLS epoch', 'Nostr address', 'model tool call'],
	},
	likelyMistakes: [
		'Assumes moving a public draft into a Private group preserves privacy retroactively.',
	],
	recoveryBehavior: [
		'Corrects the route manually, verifies the destination, and reissues the handoff.',
	],
	journeyIds: ['ai-assisted-delivery-handoff'],
})
