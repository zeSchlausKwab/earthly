import { defineJourney } from '../model'

export const conversationalNearbyDiscoveryJourney = defineJourney({
	id: 'conversational-nearby-discovery',
	title: 'Find something worthwhile nearby through conversation',
	evidenceLevel: 'hypothetical',
	jobStory:
		'Ask an ordinary-language nearby question on mobile, refine the answer, and keep useful spatial state after leaving chat.',
	actors: [{ personaId: 'curious-map-explorer', role: 'mobile explorer' }],
	intentLanes: ['explore'],
	startingState: [
		'Explorer opens Earthly on mobile with no active authoring destination.',
		'Location permission has not yet been decided for this session.',
	],
	conditions: {
		platforms: ['mobile-web', 'android'],
		connectivity: ['Ordinary mobile connection with a separately controlled model response.'],
		publishChannel: 'not-applicable',
		seededData: ['Synthetic nearby parks, coffee shops, river crossings, and walking routes.'],
	},
	taskPrompt:
		'I have 45 minutes. Find a quiet park and coffee nearby, without a car. Refine it so I do not cross the river, inspect one result, close chat, and keep the useful map state.',
	primaryOutcome:
		'A novice gets a small, understandable set of spatial options and can return to the map without losing them or entering authoring accidentally.',
	proof: [
		'Location denial and grant each have a comprehensible recovery path.',
		'A refinement changes the mapped recommendation rather than only the prose.',
		'Closing chat retains the selected result or route on the map.',
	],
	understandingChecks: [
		'The explorer knows why location is requested.',
		'The explorer can distinguish a recommendation from a published contribution.',
	],
	recoveryBranches: [
		{
			trigger: 'Location permission is denied.',
			success: 'A place can be entered manually without restarting the journey.',
		},
		{
			trigger: 'The first recommendation crosses the river.',
			success: 'A conversational refinement updates both explanation and map state.',
		},
	],
	followUpTask: 'Close the recommendation and create an unrelated public Sighting.',
	capabilities: ['ai-assist', 'discover', 'location', 'inspect', 'recover', 'resume', 'transition'],
	parityExpectation:
		'Mobile web proves responsive comprehension; Android additionally owns native permission, intent, and process-lifecycle behavior.',
	automationLevel: 'experience-audit',
	knownGaps: [
		'Responsive browser automation cannot prove Android location permission or background lifecycle.',
	],
	tags: ['mobile', 'android', 'ai-chat', 'location', 'second-cohort'],
})
