import { describe, expect, it } from 'bun:test'

import { DEFAULT_THEME, getTheme } from './theme'

describe('theme defaults', () => {
	it('defaults to light when no document theme class is available', () => {
		expect(DEFAULT_THEME).toBe('light')
		expect(getTheme()).toBe('light')
	})
})
