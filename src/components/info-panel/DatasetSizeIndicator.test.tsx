import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import { renderToStaticMarkup } from 'react-dom/server'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
import { MAX_INLINE_DATASET_CONTENT_BYTES } from '@/lib/nostr/limits'
import { DatasetSizeIndicator } from './DatasetSizeIndicator'

const RELAY_CONTENT_CEILING_BYTES = 65_535

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
	test('offers Blossom before relay content reaches its hard storage ceiling', () => {
		const featureCollection = collectionWithPayload(62 * 1024)
		const serializedBytes = new TextEncoder().encode(JSON.stringify(featureCollection)).length

		expect(MAX_INLINE_DATASET_CONTENT_BYTES).toBe(60 * 1024)
		expect(BLOSSOM_UPLOAD_THRESHOLD_BYTES).toBe(MAX_INLINE_DATASET_CONTENT_BYTES)
		expect(MAX_INLINE_DATASET_CONTENT_BYTES).toBeLessThan(RELAY_CONTENT_CEILING_BYTES)
		expect(serializedBytes).toBeGreaterThan(BLOSSOM_UPLOAD_THRESHOLD_BYTES)
		expect(serializedBytes).toBeLessThan(RELAY_CONTENT_CEILING_BYTES)

		const html = renderToStaticMarkup(
			<DatasetSizeIndicator featureCollection={featureCollection} />,
		)

		expect(html).toContain('Upload required')
		expect(html).toContain('Upload to Blossom')
		expect(html).toContain('safe inline publish limit')
	})
})
