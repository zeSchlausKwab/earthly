import type { FeatureCollection } from 'geojson'
import { z } from 'zod'
import { normalizeGeoJsonToFeatureCollection } from '@/lib/geo/normalizeGeoJSON'

export const MAX_MAP_BYTES = 48 * 1024
export const MAX_MAP_FEATURES = 300

// ChatGPT's tool-schema validator requires one items schema for an array.
// The pipe keeps tuple semantics at runtime while advertising numeric arrays.
const position = z
	.array(z.number().finite())
	.min(2)
	.max(3)
	.describe('[longitude, latitude, optional altitude]')
	.pipe(
		z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).rest(z.number().finite()),
	)
const line = z.array(position).min(2).max(5000)
const ring = z
	.array(position)
	.min(4)
	.max(5000)
	.refine(
		(value) => JSON.stringify(value[0]) === JSON.stringify(value[value.length - 1]),
		'Polygon rings must be closed',
	)
const geometry = z.union([
	z.object({ type: z.literal('Point'), coordinates: position }),
	z.object({ type: z.literal('MultiPoint'), coordinates: z.array(position).min(1).max(5000) }),
	z.object({ type: z.literal('LineString'), coordinates: line }),
	z.object({ type: z.literal('MultiLineString'), coordinates: z.array(line).min(1).max(100) }),
	z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1).max(100) }),
	z.object({
		type: z.literal('MultiPolygon'),
		coordinates: z.array(z.array(ring).min(1).max(100)).min(1).max(100),
	}),
])

export const mapDataSchema = z
	.object({
		type: z.literal('FeatureCollection'),
		features: z
			.array(
				z
					.object({
						type: z.literal('Feature'),
						id: z.union([z.string().min(1).max(128), z.number().finite()]).optional(),
						geometry,
						properties: z.record(z.string(), z.unknown()).nullable().default({}),
					})
					.passthrough(),
			)
			.min(1)
			.max(MAX_MAP_FEATURES),
	})
	.passthrough()

export const viewOptionsSchema = z
	.object({
		theme: z.enum(['light', 'dark']).default('light'),
		title: z.boolean().default(true),
		legend: z.boolean().default(true),
		controls: z.boolean().default(true),
		scrollZoom: z.boolean().default(false),
		center: z
			.array(z.number().finite())
			.length(2)
			.describe('[longitude, latitude]')
			.pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)]))
			.optional(),
		zoom: z.number().min(0).max(20).optional(),
	})
	.strict()

export type ViewOptions = z.infer<typeof viewOptionsSchema>
export const DEFAULT_VIEW = viewOptionsSchema.parse({})
export interface MapSnapshot {
	title: string
	description: string
	data: FeatureCollection
	view: ViewOptions
	reference?: string
	eventId?: string
	shareUrl?: string
	draftId?: string
	revision?: number
	expiresAt?: number
}

/** Reject malformed geometry before normalization can silently drop it. */
export function validateMapData(input: unknown): FeatureCollection {
	const serialized = JSON.stringify(input)
	if (!serialized || new TextEncoder().encode(serialized).length > MAX_MAP_BYTES) {
		throw new Error(
			`This pilot supports inline maps up to ${MAX_MAP_BYTES} bytes. Simplify or split the dataset.`,
		)
	}
	const parsed = mapDataSchema.parse(input)
	const ids = new Set<string>()
	for (const feature of parsed.features) {
		feature.id ??= crypto.randomUUID()
		const id = String(feature.id)
		if (ids.has(id)) throw new Error(`Duplicate feature ID: ${id}`)
		ids.add(id)
		const properties = feature.properties ?? {}
		for (const key of ['color', 'fillColor', 'strokeColor']) {
			if (
				properties[key] !== undefined &&
				(typeof properties[key] !== 'string' ||
					!/^(#[0-9a-f]{3,8}|[a-z]{1,25}|rgba?\([\d.,%\s]+\))$/i.test(properties[key] as string))
			) {
				throw new Error(`Feature ${id}: ${key} must be a CSS color`)
			}
		}
		for (const [key, max] of [
			['fillOpacity', 1],
			['strokeOpacity', 1],
			['strokeWidth', 32],
			['radius', 64],
		] as const) {
			const value = properties[key]
			if (
				value !== undefined &&
				(typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
			) {
				throw new Error(`Feature ${id}: ${key} must be between 0 and ${max}`)
			}
		}
	}
	const normalized = normalizeGeoJsonToFeatureCollection(parsed)
	if (new TextEncoder().encode(JSON.stringify(normalized)).length > MAX_MAP_BYTES) {
		throw new Error('Map exceeds the inline size limit after assigning feature IDs. Simplify it.')
	}
	return normalized
}

export function parseViewOptions(params: URLSearchParams): ViewOptions {
	if (params.has('v') && params.get('v') !== '1')
		throw new Error('Unsupported embed configuration version')
	const input: Record<string, unknown> = {}
	if (params.has('theme')) input.theme = params.get('theme')
	for (const key of ['title', 'legend', 'controls', 'scrollZoom']) {
		if (!params.has(key)) continue
		const value = params.get(key)
		if (value !== 'true' && value !== 'false') throw new Error(`${key} must be true or false`)
		input[key] = value === 'true'
	}
	if (params.has('center')) input.center = params.get('center')?.split(',').map(Number)
	if (params.has('zoom')) input.zoom = Number(params.get('zoom'))
	return viewOptionsSchema.parse(input)
}
