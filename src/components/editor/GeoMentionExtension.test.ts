import { describe, expect, it } from 'bun:test'
import { parseFromText, serializeToText } from './GeoMentionExtension'

const NADDR = `naddr1${'x'.repeat(80)}`

describe('GeoMentionExtension spatial reference round-trips', () => {
	it('decodes and re-encodes arbitrary feature ids', () => {
		const input = `Cross nostr:${NADDR}#relation%2F62504 here.`
		const parsed = parseFromText(input)
		const mention = parsed.content?.[0]?.content?.find((node) => node.type === 'geoMention')
		expect(mention?.attrs?.featureId).toBe('relation/62504')
		expect(serializeToText(parsed)).toBe(input)
	})

	it('round-trips coordinate and OpenStreetMap references', () => {
		const input = 'At geo:52.516275,13.377704 see https://www.openstreetmap.org/relation/62422.'
		expect(serializeToText(parseFromText(input))).toBe(input)
	})
})
