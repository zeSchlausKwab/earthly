import { describe, expect, it } from 'bun:test'
import {
	cancelCoordinateReferencePick,
	completeCoordinateReferencePick,
	getCoordinateReferencePickRequest,
	requestCoordinateReferencePick,
	resetCoordinateReferencePicker,
} from './coordinateReferencePickerBridge'

describe('coordinate reference picker bridge', () => {
	it('delivers one map click and clears the request', () => {
		resetCoordinateReferencePicker()
		let picked: { longitude: number; latitude: number } | null = null
		requestCoordinateReferencePick((coordinate) => {
			picked = coordinate
		})
		expect(getCoordinateReferencePickRequest()).not.toBeNull()
		completeCoordinateReferencePick({ longitude: 13.377704, latitude: 52.516275 })
		expect(picked as { longitude: number; latitude: number } | null).toEqual({
			longitude: 13.377704,
			latitude: 52.516275,
		})
		expect(getCoordinateReferencePickRequest()).toBeNull()
	})

	it('supports explicit cancellation', () => {
		resetCoordinateReferencePicker()
		requestCoordinateReferencePick(() => {})
		cancelCoordinateReferencePick()
		expect(getCoordinateReferencePickRequest()).toBeNull()
	})
})
