import { describe, expect, test } from 'bun:test'
import { EMPTY_STATE_PROMPTS } from './examplePrompts'

describe('empty-state example prompts', () => {
	test('includes a concise, multi-layer Belt and Road map request', () => {
		const prompt = EMPTY_STATE_PROMPTS.find((value) => /belt and road initiative/i.test(value))

		expect(prompt).toBeDefined()
		expect(prompt).toMatch(/overland corridors/i)
		expect(prompt).toMatch(/shipping lanes/i)
		expect(prompt).toMatch(/arctic routes/i)
		expect(prompt).toMatch(/callouts/i)
	})

	test('offers a smaller set of richer but still approachable requests', () => {
		expect(EMPTY_STATE_PROMPTS.length).toBeGreaterThanOrEqual(6)
		expect(EMPTY_STATE_PROMPTS.length).toBeLessThanOrEqual(8)

		for (const prompt of EMPTY_STATE_PROMPTS) {
			const words = prompt.trim().split(/\s+/)
			expect(words.length).toBeGreaterThanOrEqual(18)
			expect(words.length).toBeLessThanOrEqual(45)
		}
	})
})
