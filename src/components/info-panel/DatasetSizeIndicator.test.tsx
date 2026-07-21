import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import { renderToStaticMarkup } from 'react-dom/server'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
import { MAX_INLINE_DATASET_CONTENT_BYTES } from '@/lib/nostr/limits'
import { DatasetSizeIndicator } from './DatasetSizeIndicator'

const ONE_MIB = 1024 * 1024

function collectionWithPayload(payloadBytes: number): FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [0, 0] },
				properties: { payload: 'x'.repeat(payloadBytes) },
			},
		],
	}
}

describe('DatasetSizeIndicator inline publish budget', () => {
	test('offers Blossom when content exceeds the relay 1 MiB policy', () => {
		const featureCollection = collectionWithPayload(ONE_MIB + 1024)
		const serializedBytes = new TextEncoder().encode(JSON.stringify(featureCollection)).length

		expect(MAX_INLINE_DATASET_CONTENT_BYTES).toBe(ONE_MIB)
		expect(BLOSSOM_UPLOAD_THRESHOLD_BYTES).toBe(MAX_INLINE_DATASET_CONTENT_BYTES)
		expect(serializedBytes).toBeGreaterThan(BLOSSOM_UPLOAD_THRESHOLD_BYTES)

		const html = renderToStaticMarkup(
			<DatasetSizeIndicator featureCollection={featureCollection} />,
		)

		expect(html).toContain('Upload required')
		expect(html).toContain('Upload to Blossom')
		expect(html).toContain('safe inline publish limit')
	})

	test('keeps a dataset below 1 MiB on the inline publish path', () => {
		const featureCollection = collectionWithPayload(ONE_MIB - 4096)
		const serializedBytes = new TextEncoder().encode(JSON.stringify(featureCollection)).length
		expect(serializedBytes).toBeLessThan(BLOSSOM_UPLOAD_THRESHOLD_BYTES)

		const html = renderToStaticMarkup(
			<DatasetSizeIndicator featureCollection={featureCollection} />,
		)
		expect(html).toContain('Dataset size OK')
		expect(html).not.toContain('Upload required')
	})
})
