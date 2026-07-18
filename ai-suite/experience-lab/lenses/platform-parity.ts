import { defineReviewLens } from '../model'

export const platformParityLens = defineReviewLens({
	id: 'platform-parity',
	name: 'Platform parity',
	questions: [
		'Is the relevant capability available on the persona’s primary platform?',
		'Is a missing capability intentionally native- or desktop-specific?',
		'Does handoff preserve destination, scope, and inspectability?',
	],
})
