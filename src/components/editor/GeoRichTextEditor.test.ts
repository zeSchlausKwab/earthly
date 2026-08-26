import { describe, expect, it } from 'bun:test'
import {
	getGeoReferenceTypeLabel,
	replaceGeoRichTextEditorContent,
	type GeoFeatureItem,
} from './GeoRichTextEditor'

function item(entityType: GeoFeatureItem['entityType']): GeoFeatureItem {
	return { id: entityType ?? 'reference', name: 'Example', address: 'naddr1example', entityType }
}

describe('getGeoReferenceTypeLabel', () => {
	it('gives every reference choice an explicit user-facing type', () => {
		expect(getGeoReferenceTypeLabel(item('dataset'))).toBe('Dataset')
		expect(getGeoReferenceTypeLabel(item('feature'))).toBe('Feature')
		expect(getGeoReferenceTypeLabel(item('osm'))).toBe('OSM')
		expect(getGeoReferenceTypeLabel(item('coordinate'))).toBe('Coordinate')
		expect(getGeoReferenceTypeLabel(item('coordinate-picker'))).toBe('Coordinate')
		expect(getGeoReferenceTypeLabel(item('context'))).toBe('Context')
		expect(getGeoReferenceTypeLabel(item('story'))).toBe('Story')
	})
})

describe('replaceGeoRichTextEditorContent', () => {
	it('replaces prop-driven content without echoing it through onUpdate', () => {
		const calls: Array<{ content: unknown; options: unknown }> = []
		const editor = {
			commands: {
				setContent(content: unknown, options: unknown) {
					calls.push({ content, options })
					return true
				},
			},
		}
		const content = { type: 'doc', content: [{ type: 'paragraph' }] }

		replaceGeoRichTextEditorContent(editor as never, content)

		expect(calls).toEqual([{ content, options: { emitUpdate: false } }])
	})
})
