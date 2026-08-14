import type { Feature } from 'geojson'

const UTF8_ENCODER = new TextEncoder()

/** Measure the UTF-8 bytes that will actually be transported for a JSON value. */
export function serializedJsonBytes(value: unknown): number {
	return UTF8_ENCODER.encode(JSON.stringify(value)).length
}

/** Measure a plain GeoJSON FeatureCollection around the current editor features. */
export function serializedFeatureCollectionBytes(features: Feature[]): number {
	return serializedJsonBytes({ type: 'FeatureCollection', features })
}
