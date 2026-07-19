import { defineJourney } from '../model'

export const aiAssistedDeliveryHandoffJourney = defineJourney({
	id: 'ai-assisted-delivery-handoff',
	title: 'Prepare a route with AI and hand it to a private field team',
	evidenceLevel: 'hypothetical',
	jobStory:
		'Use AI to prepare a correctable route from synthetic stops, turn it into canonical Earthly data, and hand it from desktop dispatch to a private mobile worker.',
	actors: [
		{ personaId: 'delivery-dispatcher', role: 'route planner and Private-group administrator' },
		{ personaId: 'delivery-driver', role: 'mobile route recipient and field-note author' },
	],
	intentLanes: ['analyze', 'build', 'coordinate', 'capture'],
	startingState: [
		'Dispatcher has synthetic stops on desktop and no active Private group.',
		'Driver has Earthly on Android but has not joined the delivery group.',
	],
	conditions: {
		platforms: ['desktop-web', 'android'],
		connectivity: ['Connected planning and invitation; intermittent connectivity during delivery.'],
		publishChannel: 'private-group',
		seededData: ['Synthetic addresses, delivery windows, and one deliberately misplaced stop.'],
	},
	taskPrompt:
		'Geocode and order the synthetic stops, correct the misplaced stop, preserve the route as Earthly data, transfer it to a Private group, let the driver add a note, then leave the group and begin public work.',
	primaryOutcome:
		'Dispatch and driver share one correctable private route without sending private group history to the external model or confusing private and public destinations.',
	proof: [
		'AI output becomes a canonical, manually correctable route.',
		'The transfer into the Private group preserves source and destination meaning.',
		'Driver notes remain private and leaving returns authoring to Public.',
	],
	understandingChecks: [
		'Dispatcher knows which inputs were sent to the model and which were not.',
		'Driver can identify the active private destination before posting a note.',
	],
	recoveryBranches: [
		{
			trigger: 'One geocoded stop is wrong.',
			success: 'The dispatcher corrects it manually without regenerating the whole route.',
		},
		{
			trigger: 'The driver leaves or reconnects to the group.',
			success: 'The route and note state recover without retargeting later public work.',
		},
	],
	followUpTask: 'Driver leaves the delivery group and creates an unrelated public Sighting.',
	capabilities: [
		'ai-assist',
		'author-geometry',
		'organize',
		'attach',
		'share',
		'join',
		'destination',
		'synchronize',
		'recover',
		'transition',
	],
	parityExpectation:
		'Desktop owns route preparation and review; Android owns invitation, private field use, annotation, resume, and destination exit.',
	automationLevel: 'experience-audit',
	knownGaps: [
		'Existing public Datasets cannot yet be migrated into a Private group through one provenance-preserving action.',
		'Private-group content must remain excluded from external-model context unless a future explicit disclosure and consent contract is designed.',
	],
	tags: ['desktop', 'android', 'ai-chat', 'private-group', 'second-cohort'],
})
