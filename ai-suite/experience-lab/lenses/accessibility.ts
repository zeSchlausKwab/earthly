import { defineReviewLens } from '../model'

export const accessibilityLens = defineReviewLens({
	id: 'accessibility',
	name: 'Accessibility',
	questions: [
		'Are controls named, reachable, and large enough for the persona and environment?',
		'Does the journey remain understandable without relying on color, hover, or map vision alone?',
		'Do focus and reading order follow the visible task?',
	],
})
