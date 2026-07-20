import { defineJourney } from '../model'

export const squirrelCaptureJourney = defineJourney({
	id: 'squirrel-capture',
	title: 'Capture and share a squirrel sighting',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When I see a squirrel, I want to share a photo and location quickly, understand who can see it, and continue using the map.',
	actors: [{ personaId: 'casual-wildlife-observer', role: 'observer and author' }],
	intentLanes: ['capture', 'explore'],
	startingState: [
		'Fresh mobile browser with the first-run tour already dismissed.',
		'The observer has not learned Earthly mapping terminology.',
		'A development identity may be pre-authorized so the journey evaluates capture rather than key management.',
	],
	conditions: {
		platforms: ['mobile-web', 'android'],
		connectivity: ['Ordinary mobile connectivity with one recoverable interruption.'],
		publishChannel: 'public',
		seededData: ['At least one existing sighting to inspect after publishing.'],
	},
	taskPrompt:
		'You have just seen a cute squirrel. Share where you saw it with a title, short note, and photos. Make sure you know who can see it, then look at another sighting and begin a second capture.',
	primaryOutcome:
		'A public squirrel sighting is visible on the map, in the Sightings list, and in its inspector with the primary image.',
	proof: [
		'The published sighting title is visible in the inspector.',
		'The Sightings list contains the new sighting.',
		'The primary image has a user-visible gallery action when media upload is available.',
	],
	understandingChecks: [
		'The observer can identify that the destination is public before publishing.',
		'The observer can explain that a Context is optional rather than required for a sighting.',
		'The observer sees an unambiguous publish result.',
	],
	recoveryBranches: [
		{
			trigger: 'Cancel the first placement before entering sighting details.',
			success: 'The map returns to a usable state and another capture can begin.',
		},
		{
			trigger: 'Leave the editor after entering text but before publishing.',
			success: 'The exit is understandable and does not leave drawing or destination state stuck.',
		},
	],
	followUpTask:
		'Inspect another current sighting, return to the list, and begin a second sighting.',
	capabilities: [
		'identity',
		'capture',
		'media',
		'location',
		'destination',
		'publish',
		'inspect',
		'recover',
		'transition',
	],
	parityExpectation:
		'Responsive mobile covers the complete non-native flow; Android owns camera, location permission, share intent, and process-lifecycle contracts.',
	automationLevel: 'experience-audit',
	knownGaps: [
		'NIP-07 test identity sign-in is desktop-only, so mobile capture needs a safe pre-authorized identity fixture.',
		'Blossom media upload should not be required for a localhost-only deterministic contract.',
	],
	tags: ['mobile', 'sighting', 'capture', 'public', 'first-cohort'],
})
