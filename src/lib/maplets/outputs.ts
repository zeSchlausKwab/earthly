import type { FeatureCollection } from 'geojson'
import { MAPLET_LIMITS, validateMapletCollection } from './collection'
import { isRecord } from './config'

/** Optional Earthly map-domain extension: independently addressable configuration outputs. */
export interface MapletOutput {
	id: string
	title: string
	collection: FeatureCollection
	warnings: string[]
	visible: boolean
	preview: boolean
	/** Temporarily replaces this same-runtime output while leaving Shelf membership intact. */
	previewOf?: string
}

export function validateMapletOutputs(input: unknown): MapletOutput[] {
	if (!Array.isArray(input) || input.length > 16) throw new Error('Maplet output limit exceeded')
	const ids = new Set<string>()
	const outputs = input.map((value) => {
		if (
			!isRecord(value) ||
			typeof value.id !== 'string' ||
			!value.id ||
			value.id.length > 200 ||
			ids.has(value.id) ||
			typeof value.title !== 'string' ||
			!value.title.trim() ||
			value.title.length > 160 ||
			(value.visible !== undefined && typeof value.visible !== 'boolean') ||
			(value.preview !== undefined && typeof value.preview !== 'boolean') ||
			(value.previewOf !== undefined &&
				(value.preview !== true ||
					typeof value.previewOf !== 'string' ||
					!value.previewOf ||
					value.previewOf.length > 200 ||
					value.previewOf === value.id)) ||
			!Array.isArray(value.warnings ?? []) ||
			((value.warnings ?? []) as unknown[]).some((warning) => typeof warning !== 'string')
		)
			throw new Error('Invalid Maplet configuration output')
		ids.add(value.id)
		return {
			id: value.id,
			title: value.title.trim(),
			collection: validateMapletCollection(value.collection),
			warnings: ((value.warnings ?? []) as string[]).slice(0, 20).map((text) => text.slice(0, 500)),
			visible: value.visible !== false,
			preview: value.preview === true,
			...(value.previewOf !== undefined ? { previewOf: value.previewOf as string } : {}),
		}
	})
	if (
		outputs.reduce((size, output) => size + JSON.stringify(output.collection).length, 0) >
		MAPLET_LIMITS.bytes
	)
		throw new Error('Maplet collection exceeds size limit')
	// Enforce the existing geometry budget across all outputs, including hidden
	// configurations. IDs may repeat across independent source collections.
	validateMapletCollection({
		type: 'FeatureCollection',
		features: outputs.flatMap((output, outputIndex) =>
			output.collection.features.map((feature, featureIndex) => ({
				...feature,
				id: `${outputIndex}:${featureIndex}`,
			})),
		),
	})
	return outputs
}
