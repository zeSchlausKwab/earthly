import { describe, expect, it } from 'bun:test'
import { detectCoordinateColumns } from './detectCoordinateColumns'
import { INGEST_SIZE_CAPS, assertFileWithinCaps } from './fileSizeGuards'

describe('detectCoordinateColumns', () => {
	it('detects Latitude/Longitude case-insensitively', () => {
		expect(detectCoordinateColumns(['Name', 'Latitude', 'Longitude'])).toEqual({
			lat: 'Latitude',
			lon: 'Longitude',
		})
	})

	it('detects short lat/lon names', () => {
		expect(detectCoordinateColumns(['lat', 'lon'])).toEqual({ lat: 'lat', lon: 'lon' })
	})

	it('detects lng as longitude', () => {
		expect(detectCoordinateColumns(['lng', 'lat'])).toEqual({ lat: 'lat', lon: 'lng' })
	})

	it('detects x/y as lon/lat', () => {
		expect(detectCoordinateColumns(['x', 'y'])).toEqual({ lat: 'y', lon: 'x' })
	})

	it('detects wkt', () => {
		expect(detectCoordinateColumns(['id', 'WKT'])).toEqual({ wkt: 'WKT' })
	})

	it('detects geometry', () => {
		expect(detectCoordinateColumns(['Geometry', 'name'])).toEqual({ geometry: 'Geometry' })
	})

	it('returns empty object for ambiguous / no coord columns (D-04 AI overrides)', () => {
		expect(detectCoordinateColumns(['name', 'city', 'population'])).toEqual({})
	})
})

describe('assertFileWithinCaps', () => {
	it('rejects a tabular file over the tabular cap (V12 DoS)', () => {
		const result = assertFileWithinCaps({ size: INGEST_SIZE_CAPS.tabularBytes + 1, isImage: false })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toContain('too large')
	})

	it('rejects an image over the image cap', () => {
		const result = assertFileWithinCaps({ size: INGEST_SIZE_CAPS.imageBytes + 1, isImage: true })
		expect(result.ok).toBe(false)
	})

	it('accepts a tabular file within the cap', () => {
		expect(assertFileWithinCaps({ size: 5 * 1024 * 1024, isImage: false })).toEqual({ ok: true })
	})

	it('accepts an image within the cap', () => {
		expect(assertFileWithinCaps({ size: 5 * 1024 * 1024, isImage: true })).toEqual({ ok: true })
	})

	it('tabular cap is at least 12MB (Phase 7 West Pacific Trail, A4)', () => {
		expect(INGEST_SIZE_CAPS.tabularBytes).toBeGreaterThanOrEqual(12 * 1024 * 1024)
	})

	// CR-02: a non-finite / unparseable size must FAIL CLOSED (rejected), not slip
	// past the cap via a clamp-fallback inversion.
	it('FAILS CLOSED on an Infinity size (CR-02)', () => {
		const result = assertFileWithinCaps({ size: Number.POSITIVE_INFINITY, isImage: false })
		expect(result.ok).toBe(false)
	})

	it('FAILS CLOSED on a NaN size (CR-02)', () => {
		expect(assertFileWithinCaps({ size: Number.NaN, isImage: false }).ok).toBe(false)
		expect(assertFileWithinCaps({ size: Number.NaN, isImage: true }).ok).toBe(false)
	})

	it('FAILS CLOSED on a negative size (CR-02)', () => {
		expect(assertFileWithinCaps({ size: -1, isImage: false }).ok).toBe(false)
	})

	it('accepts a zero-byte file (boundary, still ok)', () => {
		expect(assertFileWithinCaps({ size: 0, isImage: false })).toEqual({ ok: true })
	})
})
