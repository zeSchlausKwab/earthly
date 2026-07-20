import { defineReviewLens } from '../model'

export const privacyDestinationLens = defineReviewLens({
	id: 'privacy-destination',
	name: 'Privacy and destination',
	questions: [
		'Can the persona tell who will receive the result before publishing?',
		'Does route or mode switching ever silently change the destination?',
		'Are location and media consequences visible at the decision point?',
	],
})
