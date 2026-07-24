import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { expectGeometryFeatureCount, geometryDraftSnapshot } from '../create/geometry'

export const placeMobilePrecisionPointTask: AiTaskMetadata = {
	id: 'editor.place-mobile-precision-point',
	summary: 'Place a Dataset point with pan lock and the real touch magnifier.',
	preconditions: ['Mobile Earthly session', 'An active Dataset draft', 'The map is ready'],
	sideEffects: ['Enables pan lock and the magnifier', 'Adds one point to the active draft'],
	viewports: 'mobile',
}

export interface MobilePrecisionPointResult {
	featureCount: number
	magnifierPreloaded: boolean
	magnifierVisibleDuringTouch: boolean
}

async function waitForAnimationFrames(earthly: EarthlySession, count = 2): Promise<void> {
	await earthly.page.evaluate(
		(frameCount) =>
			new Promise<void>((resolveFrames) => {
				let remaining = frameCount
				const next = () => {
					remaining -= 1
					if (remaining <= 0) resolveFrames()
					else requestAnimationFrame(next)
				}
				requestAnimationFrame(next)
			}),
		count,
	)
}

export async function placeMobilePrecisionPoint(
	earthly: EarthlySession,
	xRatio = 0.54,
	yRatio = 0.34,
): Promise<MobilePrecisionPointResult> {
	if (!earthly.isMobile) throw new Error('Mobile precision drawing requires the mobile viewport')

	const before = (await geometryDraftSnapshot(earthly)).featureCount
	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).tap()
	await earthly.page.getByRole('button', { name: 'Lock pan while drawing', exact: true }).tap()
	await expect(earthly.page.getByText('Lock panning to draw', { exact: true })).toBeHidden()
	await earthly.page.getByRole('button', { name: 'More tools', exact: true }).tap()
	await earthly.page.getByRole('menuitemcheckbox', { name: 'Magnifier', exact: true }).tap()

	const magnifier = earthly.page.getByTestId('map-magnifier')
	await expect(magnifier).toBeHidden()
	await expect(magnifier).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })

	const canvas = earthly.page.locator('canvas[aria-label="Map"]').first()
	await expect(canvas).toBeVisible()
	const canvasBox = await canvas.boundingBox()
	if (!canvasBox) throw new Error('Map canvas has no visible bounding box')
	const mobileSheet = earthly.page.getByTestId('mobile-sheet')
	const sheetBox = (await mobileSheet.isVisible()) ? await mobileSheet.boundingBox() : null
	const exposedMapHeight = sheetBox
		? Math.max(96, sheetBox.y - canvasBox.y)
		: Math.max(96, canvasBox.height * 0.66)
	const target = {
		x: canvasBox.x + canvasBox.width * xRatio,
		y: canvasBox.y + exposedMapHeight * yRatio,
	}
	const end = {
		x: Math.min(Math.max(target.x, 76), canvasBox.x + canvasBox.width - 78),
		y: Math.min(Math.max(target.y + 48, 156), canvasBox.y + exposedMapHeight - 28),
	}
	const start = { x: end.x - 22, y: end.y + 20 }
	const touchPoint = (x: number, y: number) => ({
		x,
		y,
		radiusX: 12,
		radiusY: 12,
		force: 0.72,
		id: 1,
	})

	const session = await earthly.page.context().newCDPSession(earthly.page)
	try {
		await session.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [touchPoint(start.x, start.y)],
		})
		await expect(magnifier).toBeVisible()

		for (let step = 1; step <= 8; step += 1) {
			const progress = step / 8
			await session.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [
					touchPoint(
						start.x + (end.x - start.x) * progress,
						start.y + (end.y - start.y) * progress,
					),
				],
			})
			await waitForAnimationFrames(earthly)
		}

		await session.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [],
		})
	} finally {
		await session.detach()
	}

	await expect(magnifier).toBeHidden()
	await expectGeometryFeatureCount(earthly, before + 1)
	return {
		featureCount: before + 1,
		magnifierPreloaded: true,
		magnifierVisibleDuringTouch: true,
	}
}
