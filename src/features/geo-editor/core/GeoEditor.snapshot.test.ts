import { describe, expect, it } from 'bun:test'
import type { CameraForBoundsOptions, JumpToOptions, Map as MapLibreMap } from 'maplibre-gl'
import { GeoEditor } from './GeoEditor'
import { createHeadlessEditor, createMockMap } from './test-harness'

interface CameraState {
	center: [number, number]
	zoom: number
	bearing: number
	pitch: number
	padding: { top: number; right: number; bottom: number; left: number }
}

function createCameraMap() {
	// Installs the test harness's minimal browser timer surface.
	createHeadlessEditor()
	const map = createMockMap()
	const camera: CameraState = {
		center: [13.4, 52.5],
		zoom: 6,
		bearing: 27,
		pitch: 38,
		padding: { top: 11, right: 22, bottom: 33, left: 44 },
	}
	const jumps: JumpToOptions[] = []
	const fitCalls: Array<{
		bounds: [[number, number], [number, number]]
		options: CameraForBoundsOptions | undefined
	}> = []

	Object.assign(map, {
		getCenter: () => ({ lng: camera.center[0], lat: camera.center[1] }),
		getZoom: () => camera.zoom,
		getBearing: () => camera.bearing,
		getPitch: () => camera.pitch,
		getPadding: () => ({ ...camera.padding }),
		loaded: () => true,
		areTilesLoaded: () => true,
		getBounds: () => ({
			getWest: () => (camera.zoom === 8 ? 1 : 13),
			getSouth: () => (camera.zoom === 8 ? 2 : 52),
			getEast: () => (camera.zoom === 8 ? 7 : 14),
			getNorth: () => (camera.zoom === 8 ? 9 : 53),
		}),
		cameraForBounds: (
			bounds: [[number, number], [number, number]],
			options?: CameraForBoundsOptions,
		) => {
			fitCalls.push({ bounds, options })
			return { center: [4, 5] as [number, number], zoom: 8, bearing: 0 }
		},
		jumpTo: (options: JumpToOptions) => {
			jumps.push(options)
			if (options.center) {
				const center = options.center as [number, number] | { lng: number; lat: number }
				camera.center = Array.isArray(center) ? [...center] : [center.lng, center.lat]
			}
			if (typeof options.zoom === 'number') camera.zoom = options.zoom
			if (typeof options.bearing === 'number') camera.bearing = options.bearing
			if (typeof options.pitch === 'number') camera.pitch = options.pitch
			if (options.padding) {
				camera.padding = {
					top: options.padding.top ?? camera.padding.top,
					right: options.padding.right ?? camera.padding.right,
					bottom: options.padding.bottom ?? camera.padding.bottom,
					left: options.padding.left ?? camera.padding.left,
				}
			}
			return map
		},
	})

	return { map: map as MapLibreMap, camera, jumps, fitCalls }
}

describe('GeoEditor fitted map snapshots', () => {
	it('rejects a stable screenshot when map content misses the readiness deadline', async () => {
		const { map } = createCameraMap()
		const editor = new GeoEditor(map)
		;(
			editor as unknown as { waitForMapContentReady: () => Promise<boolean> }
		).waitForMapContentReady = async () => false

		await expect(editor.captureMapSnapshotStable()).rejects.toThrow(
			'Map content did not finish loading',
		)
	})

	it('fits the requested bounds and restores the complete camera after capture', async () => {
		const { map, camera, jumps, fitCalls } = createCameraMap()
		const editor = new GeoEditor(map)
		editor.captureMapSnapshotStable = async () => ({
			dataUrl: 'data:image/png;base64,fixture',
			width: 640,
			height: 480,
		})

		const result = await editor.captureMapSnapshotForFittedBoundsStable([1, 2, 7, 9], {
			paddingPx: 64,
			maxZoom: 12,
		})

		expect(fitCalls).toEqual([
			{
				bounds: [
					[1, 2],
					[7, 9],
				],
				options: { padding: 64, maxZoom: 12, bearing: 0, pitch: 0 },
			},
		])
		expect(jumps[0]).toEqual({ padding: { top: 0, right: 0, bottom: 0, left: 0 } })
		expect(jumps[1]).toMatchObject({
			center: [4, 5],
			zoom: 8,
			bearing: 0,
			pitch: 0,
			padding: { top: 0, right: 0, bottom: 0, left: 0 },
		})
		expect(result).toMatchObject({
			width: 640,
			height: 480,
			mapCenter: { lat: 5, lon: 4 },
			mapZoom: 8,
			mapBbox: [1, 2, 7, 9],
			mapContentReady: true,
		})
		expect(jumps.at(-1)).toEqual({
			center: [13.4, 52.5],
			zoom: 6,
			bearing: 27,
			pitch: 38,
			padding: { top: 11, right: 22, bottom: 33, left: 44 },
		})
		expect(camera).toEqual({
			center: [13.4, 52.5],
			zoom: 6,
			bearing: 27,
			pitch: 38,
			padding: { top: 11, right: 22, bottom: 33, left: 44 },
		})
	})

	it('reduces excessive padding to fit a narrow mobile canvas', async () => {
		const { map, fitCalls } = createCameraMap()
		Object.assign(map, {
			getCanvas: () => ({
				clientWidth: 375,
				clientHeight: 700,
				width: 375,
				height: 700,
				style: { cursor: '' },
			}),
		})
		const editor = new GeoEditor(map)
		editor.captureMapSnapshotStable = async () => ({
			dataUrl: 'data:image/png;base64,fixture',
			width: 375,
			height: 700,
		})

		await editor.captureMapSnapshotForFittedBoundsStable([1, 2, 7, 9], {
			paddingPx: 256,
		})

		expect(fitCalls[0]?.options?.padding).toBe(186)
	})

	it('restores the complete camera when stable capture fails', async () => {
		const { map, camera, jumps } = createCameraMap()
		const editor = new GeoEditor(map)
		editor.captureMapSnapshotStable = async () => {
			throw new Error('canvas readback failed')
		}

		await expect(editor.captureMapSnapshotForFittedBoundsStable([1, 2, 7, 9])).rejects.toThrow(
			'canvas readback failed',
		)
		expect(jumps.at(-1)).toMatchObject({
			center: [13.4, 52.5],
			zoom: 6,
			bearing: 27,
			pitch: 38,
			padding: { top: 11, right: 22, bottom: 33, left: 44 },
		})
		expect(camera.center).toEqual([13.4, 52.5])
		expect(camera.zoom).toBe(6)
		expect(camera.bearing).toBe(27)
		expect(camera.pitch).toBe(38)
		expect(camera.padding).toEqual({ top: 11, right: 22, bottom: 33, left: 44 })
	})

	it('discards the fitted capture and preserves a newer user camera move', async () => {
		const { map, camera, jumps } = createCameraMap()
		const editor = new GeoEditor(map)
		editor.captureMapSnapshotStable = async () => {
			camera.center = [20, 30]
			camera.zoom = 4
			camera.bearing = 5
			camera.pitch = 6
			camera.padding = { top: 1, right: 2, bottom: 3, left: 4 }
			return {
				dataUrl: 'data:image/png;base64,interrupted',
				width: 640,
				height: 480,
			}
		}

		await expect(editor.captureMapSnapshotForFittedBoundsStable([1, 2, 7, 9])).rejects.toThrow(
			'Map camera changed',
		)
		expect(jumps.at(-1)).not.toMatchObject({ center: [13.4, 52.5] })
		expect(camera).toEqual({
			center: [20, 30],
			zoom: 4,
			bearing: 5,
			pitch: 6,
			padding: { top: 1, right: 2, bottom: 3, left: 4 },
		})
	})
})
