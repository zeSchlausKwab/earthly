import { defineJourney } from '../model'

export const eventVenueMapJourney = defineJourney({
	id: 'event-venue-map',
	title: 'Publish and visit an event venue map',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When an organizer shares a venue, visitors should find stages and services on mobile without learning the authoring model.',
	actors: [
		{ personaId: 'event-organizer', role: 'venue map author' },
		{ personaId: 'event-visitor', role: 'mobile map visitor' },
	],
	intentLanes: ['build', 'coordinate', 'explore'],
	startingState: [
		'Organizer is signed in on desktop.',
		'Visitor starts from a shared mobile link.',
	],
	conditions: {
		platforms: ['desktop-web', 'mobile-web'],
		connectivity: ['Reliable authoring connection and congested mobile consumption.'],
		publishChannel: 'public',
		seededData: ['Venue outline and named stage, bar, food, and meeting-point features.'],
	},
	taskPrompt:
		'Create and share a venue map. As a visitor, open it on mobile, find a stage and a bar, close the inspector safely, and then explore something unrelated nearby.',
	primaryOutcome: 'The organizer-to-visitor handoff works without oral explanation.',
	proof: ['Shared route opens the intended venue.', 'Named services are inspectable on mobile.'],
	understandingChecks: [
		'Organizer can predict what the visitor receives.',
		'Visitor does not mistake inspection for editing or publishing.',
	],
	recoveryBranches: [
		{
			trigger: 'Organizer misplaces an item.',
			success: 'The item can be corrected and republished.',
		},
		{
			trigger: 'Visitor closes an inspector after a cold deep link.',
			success: 'The venue scope and map remain available.',
		},
	],
	followUpTask: 'Organizer updates one venue item while the visitor browses an unrelated entity.',
	capabilities: [
		'author-geometry',
		'organize',
		'share',
		'inspect',
		'discover',
		'recover',
		'transition',
	],
	parityExpectation:
		'Desktop authors the venue; mobile consumes and navigates it without losing scope.',
	automationLevel: 'exploratory',
	knownGaps: ['The canonical venue entity composition needs validation through the first run.'],
	tags: ['desktop', 'mobile', 'handoff', 'event', 'first-cohort'],
})
