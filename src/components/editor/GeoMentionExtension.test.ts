import { describe, expect, it } from 'bun:test'
import { parseFromText, serializeToText } from './GeoMentionExtension'
import { stringifyStoryViewMarkdownBlock } from '@/lib/map-presentation'

const NADDR = `naddr1${'x'.repeat(80)}`

describe('GeoMentionExtension spatial reference round-trips', () => {
	it('decodes and re-encodes arbitrary feature ids', () => {
		const input = `Cross nostr:${NADDR}#relation%2F62504 here.`
		const parsed = parseFromText(input)
		const mention = parsed.content?.[0]?.content?.find((node) => node.type === 'geoMention')
		expect(mention?.attrs?.featureId).toBe('relation/62504')
		expect(mention?.attrs?.referenceType).toBe('feature')
		expect(serializeToText(parsed)).toBe(input)
	})

	it('round-trips coordinate and OpenStreetMap references', () => {
		const input = 'At geo:52.516275,13.377704 see https://www.openstreetmap.org/relation/62422.'
		const parsed = parseFromText(input)
		const mentions = parsed.content?.[0]?.content?.filter((node) => node.type === 'geoMention')
		expect(mentions?.map((mention) => mention.attrs?.referenceType)).toEqual(['coordinate', 'osm'])
		expect(serializeToText(parsed)).toBe(input)
	})
})

describe('GeoMentionExtension physical Story views', () => {
	it('parses a valid earthly-view fence as one block node and writes canonical Markdown', () => {
		const block = stringifyStoryViewMarkdownBlock({
			version: 1,
			type: 'view',
			id: 'front-1916',
			title: 'Verdun and the Somme',
			display: 'both',
			camera: { center: [3.9, 49.7], zoom: 6.6 },
			layers: { front: { visible: true } },
		})
		const input = `Before\n\n${block}\n\nAfter`
		const parsed = parseFromText(input)
		expect(parsed.content?.filter((node) => node.type === 'storyView')).toHaveLength(1)
		expect(serializeToText(parsed)).toBe(input)
	})

	it('keeps invalid and unsupported earthly-view fences as ordinary source text', () => {
		const invalid = `\`\`\`earthly-view\nnostr:${NADDR}#way%2f42 is not JSON\n\`\`\``
		const future = `\`\`\`earthly-view\n{"version":2,"example":"nostr:${NADDR}#way%2f42"}\n\`\`\``
		const input = `${invalid}\n\n${future}`
		const parsed = parseFromText(input)
		expect(parsed.content?.some((node) => node.type === 'storyView')).toBe(false)
		expect(serializeToText(parsed)).toBe(input)
	})
})
