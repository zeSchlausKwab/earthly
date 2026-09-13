import { describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { nip19 } from 'nostr-tools'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	deriveAtlasPresentationAuthorization,
	deriveStoryPresentationAuthorization,
	type MapPresentationAuthorization,
} from '@/lib/map-presentation'
import { addPresentationLayer, emptyPresentation } from '@/lib/map-presentation/authoring'
import { MapPresentationFormatNotice, useMapPresentationEditor } from './MapPresentationControls'
import { MapPresentationLayersEditor } from './MapPresentationLayersEditor'

const PUBKEY = 'a'.repeat(64)
const SOURCE = `37515:${PUBKEY}:western-front` as const
const ADDRESS = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'western-front' })
const STORY_AUTHORIZATION = deriveStoryPresentationAuthorization(`nostr:${ADDRESS}#battle-a`)
const ATLAS_AUTHORIZATION = deriveAtlasPresentationAuthorization([SOURCE])
const STORY_PRESENTATION = addPresentationLayer(emptyPresentation(), SOURCE, STORY_AUTHORIZATION)

const LABELS = {
	sourcePlaceholder: 'Add a Map…',
	sourceSelect: 'Map source',
	help: 'Layers render bottom to top.',
	empty: 'No layers yet.',
	unauthorized: 'This layer is outside the allowed source scope.',
	hide: 'Hide layer',
	show: 'Show layer',
	moveDown: 'Move layer toward bottom',
	moveUp: 'Move layer toward top',
	featureIds: 'Feature IDs, separated by commas or new lines',
}

function renderLayers(authorization: MapPresentationAuthorization) {
	const html = renderToStaticMarkup(
		<MapPresentationLayersEditor
			presentation={STORY_PRESENTATION}
			authorization={authorization}
			options={[{ source: SOURCE, label: 'Western Front' }]}
			onChange={() => {}}
			idPrefix="presentation"
			labels={LABELS}
		/>,
	)
	return parseHTML(html).document
}

describe('shared presentation controls', () => {
	test('locks feature-only Story grants and shows the cited scope in the source picker', () => {
		const document = renderLayers(STORY_AUTHORIZATION)
		const scope = document.querySelector('option[value="whole"]')?.parentElement
		expect(scope?.hasAttribute('disabled')).toBe(true)
		expect(document.querySelector('textarea')?.textContent).toBe('battle-a')
		expect(document.querySelector('[aria-label="Map source"]')?.textContent).toContain(
			'1 cited features',
		)
		expect(document.toString()).not.toContain(LABELS.unauthorized)
	})

	test('allows whole-Map scope for owner-accepted Atlas sources', () => {
		const document = renderLayers(ATLAS_AUTHORIZATION)
		const scope = document.querySelector('option[value="whole"]')?.parentElement
		expect(scope?.hasAttribute('disabled')).toBe(false)
		expect(document.querySelector('[aria-label="Map source"]')?.textContent).not.toContain(
			'cited features',
		)
	})

	test('keeps an existing layer editable with a warning when its reference is removed', () => {
		const document = renderLayers(deriveStoryPresentationAuthorization(''))
		expect(
			document.querySelector('[aria-label="Stable presentation layer id"]')?.getAttribute('value'),
		).toBe('western-front')
		expect(document.toString()).toContain(LABELS.unauthorized)
		expect(document.querySelector('textarea')?.textContent).toBe('battle-a')
	})

	test('reading absent, malformed and future views neither captures the map nor writes replacement content', () => {
		const writes: unknown[] = []
		let captures = 0
		function Harness({ value }: { value: unknown }) {
			const editor = useMapPresentationEditor({
				value,
				onChange: (next) => writes.push(next),
				capture: () => {
					captures += 1
					return emptyPresentation()
				},
				invalidCaptureMessage: 'Invalid capture',
			})
			return (
				<MapPresentationFormatNotice
					future={editor.future}
					invalid={editor.invalid}
					futureMessage="Future format is preserved"
					invalidMessage="Malformed view uses fallback framing"
				/>
			)
		}
		const future = { version: 2, proprietary: { layers: ['opaque'] } }
		expect(renderToStaticMarkup(<Harness value={future} />)).toContain('Future format is preserved')
		expect(renderToStaticMarkup(<Harness value={{ version: 1, layers: null }} />)).toContain(
			'Malformed view uses fallback framing',
		)
		expect(renderToStaticMarkup(<Harness value={undefined} />)).toBe('')
		expect(captures).toBe(0)
		expect(writes).toEqual([])
		expect(future).toEqual({ version: 2, proprietary: { layers: ['opaque'] } })
	})
})
