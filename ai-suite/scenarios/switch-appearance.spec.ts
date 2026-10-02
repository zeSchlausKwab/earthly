import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures/earthly'
import { setDesktopAgentAccess, setDesktopExternalQueries } from '../tasks/chat/webmcp'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'

test.use({ launchOptions: { args: ['--enable-features=WebMCP'] } })

async function switchAppearance(toggle: Locator) {
	return toggle.evaluate((element) => {
		const thumb = element.querySelector('[data-slot="switch-thumb"]')
		if (!(thumb instanceof HTMLElement)) throw new Error('Switch thumb missing')
		const trackBox = element.getBoundingClientRect()
		const thumbBox = thumb.getBoundingClientRect()
		const trackStyle = getComputedStyle(element)
		const thumbStyle = getComputedStyle(thumb)
		const hitArea = getComputedStyle(element, '::after')
		return {
			trackWidth: trackBox.width,
			trackHeight: trackBox.height,
			thumbWidth: thumbBox.width,
			thumbHeight: thumbBox.height,
			thumbInset: thumbBox.left - trackBox.left,
			trackColor: trackStyle.backgroundColor,
			thumbColor: thumbStyle.backgroundColor,
			opacity: trackStyle.opacity,
			focusVisible: element.matches(':focus-visible'),
			focusRing: trackStyle.boxShadow,
			thumbTransition: thumbStyle.transitionProperty,
			hitWidth: Number.parseFloat(hitArea.minWidth),
			hitHeight: Number.parseFloat(hitArea.minHeight),
		}
	})
}

for (const theme of ['light', 'dark'] as const) {
	test(`shared switches show tracks, state and keyboard focus in ${theme} theme @regression`, async ({
		earthly,
	}, testInfo) => {
		await installIsolatedRelays(earthly)
		await earthly.page.addInitScript((nextTheme) => {
			localStorage.setItem('earthly-theme', nextTheme)
		}, theme)
		await earthly.open({ tour: 'seen' })
		await installDeterministicMapStyle(earthly)
		await setDesktopExternalQueries(earthly, false)
		const section = earthly.page.getByRole('region', { name: 'Desktop agent access', exact: true })
		const toggle = section.getByRole('switch', { name: 'External queries', exact: true })
		await expect(earthly.page.locator('html')).toHaveClass(new RegExp(theme))
		await expect(toggle).not.toBeChecked()
		await expect.poll(async () => (await switchAppearance(toggle)).thumbInset).toBe(2)
		const off = await switchAppearance(toggle)
		expect(off.trackWidth).toBe(36)
		expect(off.trackHeight).toBe(20)
		expect(off.thumbWidth).toBe(16)
		expect(off.thumbHeight).toBe(16)
		expect(off.thumbInset).toBe(2)
		expect(off.trackColor).not.toBe('rgba(0, 0, 0, 0)')
		expect(off.trackColor).not.toBe(off.thumbColor)
		expect(off.hitWidth).toBeGreaterThanOrEqual(44)
		expect(off.hitHeight).toBeGreaterThanOrEqual(44)
		await earthly.page.screenshot({ path: testInfo.outputPath(`switches-${theme}.png`) })

		await toggle.focus()
		await earthly.page.keyboard.press('Space')
		await expect(toggle).toBeChecked()
		await expect.poll(async () => (await switchAppearance(toggle)).thumbInset).toBe(18)
		const on = await switchAppearance(toggle)
		expect(on.trackColor).not.toBe(off.trackColor)
		expect(on.trackColor).not.toBe(on.thumbColor)
		expect(on.focusVisible).toBe(true)
		expect(on.focusRing).not.toBe('none')

		await earthly.page.emulateMedia({ reducedMotion: 'reduce' })
		await expect.poll(async () => (await switchAppearance(toggle)).thumbTransition).toBe('none')
		await setDesktopAgentAccess(earthly, false)
		await expect(toggle).toBeDisabled()
		const disabled = await switchAppearance(toggle)
		expect(disabled.opacity).toBe('0.5')
		expect(disabled.trackColor).toBe(on.trackColor)
		expect(disabled.thumbInset).toBe(18)
	})
}
