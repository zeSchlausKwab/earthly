import { defineExperiencePersona } from '../model'

export const deliveryDriver = defineExperiencePersona({
	id: 'delivery-driver',
	name: 'Delivery driver',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When I receive a route from dispatch, I want to follow it on my phone, add a field note, and leave the job without being trapped in its private destination.',
	sophistication: { domain: 'intermediate', earthly: 'novice' },
	patience: {
		level: 'low',
		abandonmentTriggers: [
			'The assigned route is not immediately visible.',
			'I cannot tell whether my note goes to dispatch or to the public map.',
		],
	},
	platforms: { primary: 'android', secondary: ['mobile-web'] },
	constraints: {
		connectivity: ['Mobile connectivity may drop between stops.'],
		privacy: ['Customer and delivery notes stay inside the assigned group.'],
		trust: ['Needs a stable route and explicit current destination.'],
		accessibility: ['Core actions must work one-handed and in motion-safe pauses.'],
		environment: ['Outdoor mobile work with short interaction windows.'],
	},
	vocabulary: {
		familiar: ['next stop', 'route', 'note', 'dispatch'],
		confusing: ['dataset', 'private-group record', 'relay'],
	},
	likelyMistakes: ['Starts a new public task while still targeting the delivery group.'],
	recoveryBehavior: ['Returns to the assignment, checks destination, then retries the note.'],
	journeyIds: ['ai-assisted-delivery-handoff'],
})
