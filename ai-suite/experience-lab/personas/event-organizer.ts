import { defineExperiencePersona } from '../model'

export const eventOrganizer = defineExperiencePersona({
	id: 'event-organizer',
	name: 'Event organizer',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When preparing a venue, I want to publish an understandable map of stages and services so visitors can orient themselves.',
	sophistication: { domain: 'expert', earthly: 'basic' },
	patience: {
		level: 'moderate',
		abandonmentTriggers: [
			'I cannot correct a misplaced venue item.',
			'I cannot preview what a visitor will receive.',
		],
	},
	platforms: { primary: 'desktop-web', secondary: ['mobile-web'] },
	constraints: {
		connectivity: ['Reliable planning connection; variable venue connection.'],
		privacy: ['Venue information is intended to be public.'],
		trust: ['Needs a stable share link before distributing it.'],
		accessibility: [],
		environment: ['Plans at a desk, then verifies the result at the venue.'],
	},
	vocabulary: {
		familiar: ['venue', 'stage', 'service', 'map', 'share link'],
		confusing: ['Nostr address', 'relay hints', 'feature collection'],
	},
	likelyMistakes: ['Creates venue items without organizing them into the intended map.'],
	recoveryBehavior: ['Edits and republishes rather than starting the venue map again.'],
	journeyIds: ['event-venue-map'],
})
