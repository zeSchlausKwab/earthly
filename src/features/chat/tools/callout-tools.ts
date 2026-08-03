/** Dedicated AI authoring verbs for the `earthly:callouts` feature property. */
import { createAuthoring } from '@/features/geo-editor/api/authoring'
import type { GeoEditor } from '@/features/geo-editor/core/GeoEditor'
import { useEditorStore } from '@/features/geo-editor/store'
import { gateBulkApply } from '@/features/chat/safeEditing/gateBulkEdit'
import { getSafetyLevel } from '@/features/chat/safeEditing/safetyAccess'
import {
	createMapCallout,
	getFeatureCallouts,
	normalizeMapCallout,
	withFeatureCallouts,
	type MapCallout,
} from '@/lib/geo/callouts'
import type { ToolEntry } from './registry'
import { schemaFor } from './schemas'

function requireEditor(): GeoEditor {
	const editor = useEditorStore.getState().editor
	if (!editor)
		throw new Error('Map editor is not ready. Open the map editor first, then try again.')
	return editor
}

function requiredString(args: Record<string, unknown>, key: string): string {
	const value = args[key]
	if (typeof value !== 'string' || !value.trim()) throw new Error(`\`${key}\` must be a string.`)
	return value.trim()
}

function optionalCalloutFields(args: Record<string, unknown>): Partial<MapCallout> {
	const probe = normalizeMapCallout({
		id: 'probe',
		text: typeof args.text === 'string' ? args.text : '',
		title: args.title,
		media: args.media,
		placement: {
			side: args.placementSide,
			offset: args.offset,
			leader: args.leader,
		},
	})
	if (!probe) throw new Error('Callout content is malformed.')
	return probe
}

async function gateCalloutMutation(
	editor: GeoEditor,
	label: string,
	featureId: string,
	callouts: MapCallout[],
) {
	const existing = editor.getFeature(featureId)
	if (!existing) throw new Error(`Feature '${featureId}' was not found in the active dataset.`)
	return gateBulkApply(editor, { getSafetyLevel, label }, 'modify', () => {
		createAuthoring(editor).modifyFeature(
			featureId,
			withFeatureCallouts(existing, callouts),
			'ai_callout_tool',
		)
	})
}

export function registerCalloutTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'add_feature_callout',
		kind: 'authoring-primitive',
		schema: schemaFor('add_feature_callout'),
		handler: async (args) => {
			const editor = requireEditor()
			const featureId = requiredString(args, 'featureId')
			const text = requiredString(args, 'text')
			const feature = editor.getFeature(featureId)
			if (!feature) throw new Error(`Feature '${featureId}' was not found in the active dataset.`)
			const base = createMapCallout(text)
			const fields = optionalCalloutFields(args)
			const callout = { ...base, ...fields, id: base.id, text }
			const outcome = await gateCalloutMutation(editor, 'Add map callout', featureId, [
				...getFeatureCallouts(feature),
				callout,
			])
			return {
				cancelled: outcome.status === 'cancelled',
				featureId,
				calloutId: callout.id,
			}
		},
	})

	register({
		name: 'update_feature_callout',
		kind: 'authoring-primitive',
		schema: schemaFor('update_feature_callout'),
		handler: async (args) => {
			const editor = requireEditor()
			const featureId = requiredString(args, 'featureId')
			const calloutId = requiredString(args, 'calloutId')
			const feature = editor.getFeature(featureId)
			if (!feature) throw new Error(`Feature '${featureId}' was not found in the active dataset.`)
			const current = getFeatureCallouts(feature)
			const existing = current.find((callout) => callout.id === calloutId)
			if (!existing)
				throw new Error(`Callout '${calloutId}' was not found on feature '${featureId}'.`)
			const fields = optionalCalloutFields({ ...args, text: args.text ?? existing.text })
			const updated: MapCallout = {
				...existing,
				...(args.text !== undefined ? { text: fields.text ?? existing.text } : {}),
				...(args.title !== undefined ? { title: fields.title } : {}),
				...(args.media !== undefined ? { media: fields.media } : {}),
				...(args.placementSide !== undefined ||
				args.offset !== undefined ||
				args.leader !== undefined
					? { placement: { ...existing.placement, ...fields.placement } }
					: {}),
			}
			const outcome = await gateCalloutMutation(
				editor,
				'Update map callout',
				featureId,
				current.map((callout) => (callout.id === calloutId ? updated : callout)),
			)
			return { cancelled: outcome.status === 'cancelled', featureId, calloutId }
		},
	})

	register({
		name: 'remove_feature_callout',
		kind: 'authoring-primitive',
		schema: schemaFor('remove_feature_callout'),
		handler: async (args) => {
			const editor = requireEditor()
			const featureId = requiredString(args, 'featureId')
			const calloutId = requiredString(args, 'calloutId')
			const feature = editor.getFeature(featureId)
			if (!feature) throw new Error(`Feature '${featureId}' was not found in the active dataset.`)
			const current = getFeatureCallouts(feature)
			if (!current.some((callout) => callout.id === calloutId)) {
				throw new Error(`Callout '${calloutId}' was not found on feature '${featureId}'.`)
			}
			const outcome = await gateCalloutMutation(
				editor,
				'Remove map callout',
				featureId,
				current.filter((callout) => callout.id !== calloutId),
			)
			return { cancelled: outcome.status === 'cancelled', featureId, calloutId }
		},
	})
}
