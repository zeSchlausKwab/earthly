import { defineReviewLens } from '../model'

export const productComplexityLens = defineReviewLens({
	id: 'product-complexity',
	name: 'Product complexity',
	questions: [
		'Does the persona encounter concepts not required by this journey?',
		'Can a contextual action replace a new global control?',
		'Could the proposed change remove or consolidate an existing concept?',
	],
})
