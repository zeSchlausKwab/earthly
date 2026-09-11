import { LUCIDE_ICON_NAMES } from '@/features/geo-editor/icons/lucideIcons'
import {
	MAP_PRESENTATION_SOURCE_KIND,
	MAP_PRESENTATION_VERSION,
	type MapPresentationCameraV1,
	type MapPresentationIssue,
	type MapPresentationIssueCode,
	type MapPresentationLayerV1,
	type MapPresentationParseResult,
	type MapPresentationSource,
	type MapPresentationStyleOverrideV1,
	type MapPresentationV1,
	type StoryViewBlockParseResult,
	type StoryViewBlockV1,
	type StoryViewLayerPatchV1,
} from './types'

export const MAP_PRESENTATION_LIMITS = Object.freeze({
	layers: 256,
	layerIdLength: 128,
	featureIdsPerLayer: 10_000,
	featureIdLength: 512,
	dTagLength: 512,
	zoom: Object.freeze([0, 24] as const),
	bearing: Object.freeze([-180, 180] as const),
	pitch: Object.freeze([0, 85] as const),
	strokeWidth: Object.freeze({ minExclusive: 0, max: 64 }),
	radius: Object.freeze({ minExclusive: 0, max: 128 }),
	colorLength: 64,
	viewTitleLength: 200,
	viewCaptionLength: 2_000,
})

export const MAP_PRESENTATION_STYLE_KEYS = Object.freeze([
	'color',
	'fillColor',
	'strokeColor',
	'fillOpacity',
	'strokeOpacity',
	'strokeWidth',
	'radius',
	'lineDash',
	'arrowStart',
	'arrowEnd',
	'displayIcon',
] as const)

const STYLE_KEY_SET = new Set<string>(MAP_PRESENTATION_STYLE_KEYS)
const BUNDLED_DISPLAY_ICON_IDS = new Set(LUCIDE_ICON_NAMES.map((name) => `lucide:${name}`))
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u
const HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu
const NAMED_COLOR_PATTERN = /^[a-z]{1,32}$/iu
const FUNCTION_COLOR_PATTERN = /^(?:rgb|rgba|hsl|hsla)\([\d.,%+\-\s]+\)$/iu

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: UnknownRecord, key: string): boolean {
	return Object.hasOwn(value, key)
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index)
		if (code <= 31 || code === 127) return true
	}
	return false
}

function issue(
	code: MapPresentationIssueCode,
	path: string,
	message: string,
): MapPresentationIssue {
	return Object.freeze({ code, path, message })
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function isStableId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAP_PRESENTATION_LIMITS.layerIdLength &&
		STABLE_ID_PATTERN.test(value)
	)
}

function isFeatureId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAP_PRESENTATION_LIMITS.featureIdLength &&
		!hasControlCharacter(value)
	)
}

function isSafeColor(value: unknown): value is string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > MAP_PRESENTATION_LIMITS.colorLength ||
		value.trim() !== value
	) {
		return false
	}
	return (
		HEX_COLOR_PATTERN.test(value) ||
		NAMED_COLOR_PATTERN.test(value) ||
		FUNCTION_COLOR_PATTERN.test(value)
	)
}

/** Parse and canonicalize an exact kind-37515 `kind:pubkey:d` coordinate. */
export function parseMapPresentationSource(value: unknown): {
	readonly kind: typeof MAP_PRESENTATION_SOURCE_KIND
	readonly pubkey: string
	readonly identifier: string
	readonly coordinate: MapPresentationSource
} | null {
	if (typeof value !== 'string') return null
	const kindSeparator = value.indexOf(':')
	if (
		kindSeparator === -1 ||
		value.slice(0, kindSeparator) !== String(MAP_PRESENTATION_SOURCE_KIND)
	) {
		return null
	}
	const pubkeySeparator = value.indexOf(':', kindSeparator + 1)
	if (pubkeySeparator === -1) return null
	const pubkey = value.slice(kindSeparator + 1, pubkeySeparator)
	const identifier = value.slice(pubkeySeparator + 1)
	if (!/^[\da-f]{64}$/iu.test(pubkey)) return null
	if (
		identifier.length === 0 ||
		identifier.length > MAP_PRESENTATION_LIMITS.dTagLength ||
		hasControlCharacter(identifier)
	) {
		return null
	}
	const coordinate =
		`${MAP_PRESENTATION_SOURCE_KIND}:${pubkey.toLowerCase()}:${identifier}` as const
	return Object.freeze({
		kind: MAP_PRESENTATION_SOURCE_KIND,
		pubkey: pubkey.toLowerCase(),
		identifier,
		coordinate,
	})
}

interface ParsedValue<T> {
	readonly value?: T
	readonly issues: readonly MapPresentationIssue[]
}

export function parseMapPresentationCamera(
	value: unknown,
	path = '$',
): ParsedValue<MapPresentationCameraV1> {
	if (!isRecord(value)) {
		return {
			issues: [issue('invalid-camera', path, 'Camera must be an object.')],
		}
	}
	const center = value.center
	if (
		!Array.isArray(center) ||
		center.length !== 2 ||
		!isFiniteInRange(center[0], -180, 180) ||
		!isFiniteInRange(center[1], -90, 90)
	) {
		return {
			issues: [
				issue(
					'invalid-camera',
					`${path}.center`,
					'Camera center must be a finite [longitude, latitude] pair within world bounds.',
				),
			],
		}
	}
	if (
		!isFiniteInRange(value.zoom, MAP_PRESENTATION_LIMITS.zoom[0], MAP_PRESENTATION_LIMITS.zoom[1])
	) {
		return {
			issues: [
				issue(
					'invalid-camera',
					`${path}.zoom`,
					`Camera zoom must be in [${MAP_PRESENTATION_LIMITS.zoom.join(', ')}].`,
				),
			],
		}
	}
	if (
		hasOwn(value, 'bearing') &&
		!isFiniteInRange(
			value.bearing,
			MAP_PRESENTATION_LIMITS.bearing[0],
			MAP_PRESENTATION_LIMITS.bearing[1],
		)
	) {
		return {
			issues: [
				issue(
					'invalid-camera',
					`${path}.bearing`,
					`Camera bearing must be in [${MAP_PRESENTATION_LIMITS.bearing.join(', ')}].`,
				),
			],
		}
	}
	if (
		hasOwn(value, 'pitch') &&
		!isFiniteInRange(
			value.pitch,
			MAP_PRESENTATION_LIMITS.pitch[0],
			MAP_PRESENTATION_LIMITS.pitch[1],
		)
	) {
		return {
			issues: [
				issue(
					'invalid-camera',
					`${path}.pitch`,
					`Camera pitch must be in [${MAP_PRESENTATION_LIMITS.pitch.join(', ')}].`,
				),
			],
		}
	}

	const camera: MapPresentationCameraV1 = {
		center: Object.freeze([center[0], center[1]] as const),
		zoom: value.zoom,
		...(hasOwn(value, 'bearing') ? { bearing: value.bearing as number } : {}),
		...(hasOwn(value, 'pitch') ? { pitch: value.pitch as number } : {}),
	}
	return { value: Object.freeze(camera), issues: Object.freeze([]) }
}

export function parseMapPresentationStyle(
	value: unknown,
	path = '$',
): ParsedValue<MapPresentationStyleOverrideV1> {
	if (!isRecord(value)) {
		return {
			issues: [issue('invalid-style', path, 'Style override must be an object.')],
		}
	}

	const issues: MapPresentationIssue[] = []
	const style: Record<string, string | number | boolean> = {}
	for (const key of Object.keys(value)) {
		if (!STYLE_KEY_SET.has(key)) {
			issues.push(
				issue('unknown-style-key', `${path}.${key}`, `Unknown presentation style key '${key}'.`),
			)
		}
	}

	const copyColor = (key: 'color' | 'fillColor' | 'strokeColor') => {
		if (!hasOwn(value, key)) return
		if (isSafeColor(value[key])) style[key] = value[key]
		else {
			issues.push(
				issue('invalid-style', `${path}.${key}`, `${key} must be a bounded CSS color string.`),
			)
		}
	}
	copyColor('color')
	copyColor('fillColor')
	copyColor('strokeColor')

	for (const key of ['fillOpacity', 'strokeOpacity'] as const) {
		if (!hasOwn(value, key)) continue
		if (isFiniteInRange(value[key], 0, 1)) style[key] = value[key]
		else {
			issues.push(
				issue('invalid-style', `${path}.${key}`, `${key} must be a finite number in [0, 1].`),
			)
		}
	}

	for (const [key, maximum] of [
		['strokeWidth', MAP_PRESENTATION_LIMITS.strokeWidth.max],
		['radius', MAP_PRESENTATION_LIMITS.radius.max],
	] as const) {
		if (!hasOwn(value, key)) continue
		const candidate = value[key]
		if (
			typeof candidate === 'number' &&
			Number.isFinite(candidate) &&
			candidate > 0 &&
			candidate <= maximum
		) {
			style[key] = candidate
		} else {
			issues.push(
				issue(
					'invalid-style',
					`${path}.${key}`,
					`${key} must be a finite number greater than 0 and at most ${maximum}.`,
				),
			)
		}
	}

	if (hasOwn(value, 'lineDash')) {
		const candidate = value.lineDash
		if (candidate === 'solid' || candidate === 'dashed' || candidate === 'dotted') {
			style.lineDash = candidate
		} else {
			issues.push(
				issue(
					'invalid-style',
					`${path}.lineDash`,
					"lineDash must be 'solid', 'dashed', or 'dotted'.",
				),
			)
		}
	}

	for (const key of ['arrowStart', 'arrowEnd'] as const) {
		if (!hasOwn(value, key)) continue
		if (typeof value[key] === 'boolean') style[key] = value[key]
		else {
			issues.push(issue('invalid-style', `${path}.${key}`, `${key} must be a boolean.`))
		}
	}

	if (hasOwn(value, 'displayIcon')) {
		const candidate = value.displayIcon
		if (typeof candidate === 'string' && BUNDLED_DISPLAY_ICON_IDS.has(candidate)) {
			style.displayIcon = candidate
		} else {
			issues.push(
				issue(
					'invalid-style',
					`${path}.displayIcon`,
					'displayIcon must be one of the bundled lucide:<name> icon ids.',
				),
			)
		}
	}

	return {
		value:
			Object.keys(style).length > 0
				? Object.freeze(style as MapPresentationStyleOverrideV1)
				: undefined,
		issues: Object.freeze(issues),
	}
}

function parseFeatureIds(
	value: unknown,
	path: string,
): { value?: readonly string[]; issues: readonly MapPresentationIssue[]; valid: boolean } {
	if (!Array.isArray(value) || value.length > MAP_PRESENTATION_LIMITS.featureIdsPerLayer) {
		return {
			valid: false,
			issues: [
				issue(
					'invalid-feature-selector',
					path,
					`featureIds must be an array of at most ${MAP_PRESENTATION_LIMITS.featureIdsPerLayer} ids.`,
				),
			],
		}
	}
	const ids: string[] = []
	const seen = new Set<string>()
	const issues: MapPresentationIssue[] = []
	for (let index = 0; index < value.length; index += 1) {
		const candidate = value[index]
		if (!isFeatureId(candidate)) {
			return {
				valid: false,
				issues: [
					...issues,
					issue(
						'invalid-feature-selector',
						`${path}[${index}]`,
						'Each feature selector must be a non-empty bounded string without control characters.',
					),
				],
			}
		}
		if (seen.has(candidate)) {
			issues.push(
				issue(
					'duplicate-feature-id',
					`${path}[${index}]`,
					`Duplicate feature id '${candidate}' was removed.`,
				),
			)
			continue
		}
		seen.add(candidate)
		ids.push(candidate)
	}
	return { valid: true, value: Object.freeze(ids), issues: Object.freeze(issues) }
}

function parseLayer(value: unknown, path: string): ParsedValue<MapPresentationLayerV1> {
	if (!isRecord(value)) {
		return { issues: [issue('invalid-type', path, 'Presentation layer must be an object.')] }
	}
	const issues: MapPresentationIssue[] = []
	if (!isStableId(value.id)) {
		return {
			issues: [
				issue(
					'invalid-layer-id',
					`${path}.id`,
					'Layer id must be a bounded stable ASCII identifier.',
				),
			],
		}
	}
	const source = parseMapPresentationSource(value.source)
	if (!source) {
		return {
			issues: [
				issue(
					'invalid-source',
					`${path}.source`,
					'Layer source must be an exact kind-37515 coordinate with a 64-hex pubkey and non-empty d-tag.',
				),
			],
		}
	}

	let featureIds: readonly string[] | undefined
	if (hasOwn(value, 'featureIds')) {
		const parsed = parseFeatureIds(value.featureIds, `${path}.featureIds`)
		issues.push(...parsed.issues)
		// Dropping an invalid selector would turn it into "whole Map". Reject the
		// layer instead so malformed input can never widen the referenced data.
		if (!parsed.valid) return { issues: Object.freeze(issues) }
		featureIds = parsed.value
	}

	if (hasOwn(value, 'visible') && typeof value.visible !== 'boolean') {
		issues.push(issue('invalid-visible', `${path}.visible`, 'visible must be a boolean.'))
		return { issues: Object.freeze(issues) }
	}
	if (hasOwn(value, 'opacityMultiplier') && !isFiniteInRange(value.opacityMultiplier, 0, 1)) {
		issues.push(
			issue(
				'invalid-opacity',
				`${path}.opacityMultiplier`,
				'opacityMultiplier must be a finite number in [0, 1].',
			),
		)
		return { issues: Object.freeze(issues) }
	}

	let style: MapPresentationStyleOverrideV1 | undefined
	if (hasOwn(value, 'style')) {
		const parsed = parseMapPresentationStyle(value.style, `${path}.style`)
		issues.push(...parsed.issues)
		style = parsed.value
	}

	const layer: MapPresentationLayerV1 = {
		id: value.id,
		source: source.coordinate,
		...(hasOwn(value, 'featureIds') ? { featureIds: featureIds ?? Object.freeze([]) } : {}),
		visible: hasOwn(value, 'visible') ? (value.visible as boolean) : true,
		opacityMultiplier: hasOwn(value, 'opacityMultiplier') ? (value.opacityMultiplier as number) : 1,
		...(style ? { style } : {}),
	}
	return { value: Object.freeze(layer), issues: Object.freeze(issues) }
}

/** Defensive parse. Unsupported versions are returned with their raw value intact. */
export function parseMapPresentation(value: unknown): MapPresentationParseResult {
	if (value === undefined) return { status: 'absent', issues: [] }
	if (!isRecord(value)) {
		return {
			status: 'invalid',
			raw: value,
			issues: [issue('invalid-type', '$', 'Map presentation must be an object.')],
		}
	}
	if (!hasOwn(value, 'version')) {
		return {
			status: 'invalid',
			raw: value,
			issues: [issue('missing-version', '$.version', 'Map presentation version is required.')],
		}
	}
	if (value.version !== MAP_PRESENTATION_VERSION) {
		return {
			status: 'unsupported',
			version: value.version,
			raw: value,
			issues: [
				issue(
					'unsupported-version',
					'$.version',
					`Unsupported Map presentation version '${String(value.version)}'.`,
				),
			],
		}
	}

	const issues: MapPresentationIssue[] = []
	let initialView: MapPresentationCameraV1 | undefined
	if (hasOwn(value, 'initialView')) {
		const parsed = parseMapPresentationCamera(value.initialView, '$.initialView')
		issues.push(...parsed.issues)
		initialView = parsed.value
	}

	const layers: MapPresentationLayerV1[] = []
	if (hasOwn(value, 'layers')) {
		if (!Array.isArray(value.layers)) {
			issues.push(issue('invalid-layers', '$.layers', 'layers must be an array.'))
		} else {
			const candidates = value.layers.slice(0, MAP_PRESENTATION_LIMITS.layers)
			if (value.layers.length > MAP_PRESENTATION_LIMITS.layers) {
				issues.push(
					issue(
						'layer-limit',
						'$.layers',
						`Only the first ${MAP_PRESENTATION_LIMITS.layers} layers were considered.`,
					),
				)
			}
			const seen = new Set<string>()
			for (let index = 0; index < candidates.length; index += 1) {
				const parsed = parseLayer(candidates[index], `$.layers[${index}]`)
				issues.push(...parsed.issues)
				if (!parsed.value) continue
				if (seen.has(parsed.value.id)) {
					issues.push(
						issue(
							'duplicate-layer-id',
							`$.layers[${index}].id`,
							`Duplicate layer id '${parsed.value.id}' was dropped.`,
						),
					)
					continue
				}
				seen.add(parsed.value.id)
				layers.push(parsed.value)
			}
		}
	}

	const presentation: MapPresentationV1 = {
		version: MAP_PRESENTATION_VERSION,
		...(initialView ? { initialView } : {}),
		layers: Object.freeze(layers),
	}
	return {
		status: 'valid',
		value: Object.freeze(presentation),
		issues: Object.freeze(issues),
	}
}

export function parseMapPresentationJSON(json: string): MapPresentationParseResult {
	try {
		return parseMapPresentation(JSON.parse(json))
	} catch {
		return {
			status: 'invalid',
			raw: json,
			issues: [issue('invalid-type', '$', 'Map presentation JSON is malformed.')],
		}
	}
}

export class InvalidMapPresentationError extends Error {
	readonly issues: readonly MapPresentationIssue[]

	constructor(issues: readonly MapPresentationIssue[]) {
		super(issues.map((entry) => `${entry.path}: ${entry.message}`).join('; '))
		this.name = 'InvalidMapPresentationError'
		this.issues = issues
	}
}

/** Canonicalize a V1 value; explicit writes reject absent/future/invalid roots. */
export function normalizeMapPresentation(value: unknown): MapPresentationV1 {
	const parsed = parseMapPresentation(value)
	if (parsed.status !== 'valid') throw new InvalidMapPresentationError(parsed.issues)
	return parsed.value
}

/** Deterministic JSON writer (canonical field order, defaults made explicit). */
export function stringifyMapPresentation(value: unknown): string {
	return JSON.stringify(normalizeMapPresentation(value))
}

export function parseStoryViewBlock(value: unknown): StoryViewBlockParseResult {
	if (!isRecord(value)) {
		return {
			status: 'invalid',
			raw: value,
			issues: [issue('invalid-view', '$', 'Story view block must be an object.')],
		}
	}
	if (value.version !== MAP_PRESENTATION_VERSION) {
		if (hasOwn(value, 'version')) {
			return {
				status: 'unsupported',
				version: value.version,
				raw: value,
				issues: [
					issue(
						'unsupported-version',
						'$.version',
						`Unsupported Story view version '${String(value.version)}'.`,
					),
				],
			}
		}
		return {
			status: 'invalid',
			raw: value,
			issues: [issue('missing-version', '$.version', 'Story view version is required.')],
		}
	}
	if (value.type !== 'view' || !isStableId(value.id)) {
		return {
			status: 'invalid',
			raw: value,
			issues: [
				issue(
					'invalid-view',
					value.type !== 'view' ? '$.type' : '$.id',
					value.type !== 'view'
						? "Story view type must be 'view'."
						: 'Story view id must be a bounded stable ASCII identifier.',
				),
			],
		}
	}
	if (
		typeof value.title !== 'string' ||
		value.title.length === 0 ||
		value.title.length > MAP_PRESENTATION_LIMITS.viewTitleLength
	) {
		return {
			status: 'invalid',
			raw: value,
			issues: [issue('invalid-view', '$.title', 'Story view title is required and bounded.')],
		}
	}
	if (
		hasOwn(value, 'caption') &&
		(typeof value.caption !== 'string' ||
			value.caption.length > MAP_PRESENTATION_LIMITS.viewCaptionLength)
	) {
		return {
			status: 'invalid',
			raw: value,
			issues: [issue('invalid-view', '$.caption', 'Story view caption must be a bounded string.')],
		}
	}
	if (value.display !== 'cue' && value.display !== 'figure' && value.display !== 'both') {
		return {
			status: 'invalid',
			raw: value,
			issues: [
				issue(
					'invalid-view',
					'$.display',
					"Story view display must be 'cue', 'figure', or 'both'.",
				),
			],
		}
	}

	const issues: MapPresentationIssue[] = []
	let camera: MapPresentationCameraV1 | undefined
	if (hasOwn(value, 'camera')) {
		const parsed = parseMapPresentationCamera(value.camera, '$.camera')
		issues.push(...parsed.issues)
		camera = parsed.value
	}

	let layers: Record<string, StoryViewLayerPatchV1> | undefined
	if (hasOwn(value, 'layers')) {
		if (!isRecord(value.layers)) {
			issues.push(issue('invalid-layers', '$.layers', 'Story view layers must be an object.'))
		} else {
			layers = {}
			for (const layerId of Object.keys(value.layers).sort()) {
				const patchPath = `$.layers.${layerId}`
				if (!isStableId(layerId)) {
					issues.push(issue('invalid-layer-id', patchPath, 'Invalid layer id in Story view.'))
					continue
				}
				const rawPatch = value.layers[layerId]
				if (!isRecord(rawPatch)) {
					issues.push(issue('invalid-type', patchPath, 'Story view layer patch must be an object.'))
					continue
				}
				const patch: {
					visible?: boolean
					opacityMultiplier?: number
					style?: MapPresentationStyleOverrideV1
				} = {}
				if (hasOwn(rawPatch, 'visible')) {
					if (typeof rawPatch.visible === 'boolean') patch.visible = rawPatch.visible
					else {
						issues.push(
							issue('invalid-visible', `${patchPath}.visible`, 'visible must be a boolean.'),
						)
					}
				}
				if (hasOwn(rawPatch, 'opacityMultiplier')) {
					if (isFiniteInRange(rawPatch.opacityMultiplier, 0, 1)) {
						patch.opacityMultiplier = rawPatch.opacityMultiplier
					} else {
						issues.push(
							issue(
								'invalid-opacity',
								`${patchPath}.opacityMultiplier`,
								'opacityMultiplier must be a finite number in [0, 1].',
							),
						)
					}
				}
				if (hasOwn(rawPatch, 'style')) {
					const parsed = parseMapPresentationStyle(rawPatch.style, `${patchPath}.style`)
					issues.push(...parsed.issues)
					if (parsed.value) patch.style = parsed.value
				}
				if (Object.keys(patch).length > 0) layers[layerId] = Object.freeze(patch)
			}
			layers = Object.freeze(layers)
		}
	}

	const block: StoryViewBlockV1 = {
		version: MAP_PRESENTATION_VERSION,
		type: 'view',
		id: value.id,
		title: value.title,
		...(hasOwn(value, 'caption') ? { caption: value.caption as string } : {}),
		display: value.display,
		...(camera ? { camera } : {}),
		...(layers ? { layers } : {}),
	}
	return {
		status: 'valid',
		value: Object.freeze(block),
		issues: Object.freeze(issues),
	}
}

export function normalizeStoryViewBlock(value: unknown): StoryViewBlockV1 {
	const parsed = parseStoryViewBlock(value)
	if (parsed.status !== 'valid') throw new InvalidMapPresentationError(parsed.issues)
	return parsed.value
}

export function stringifyStoryViewBlock(value: unknown): string {
	return JSON.stringify(normalizeStoryViewBlock(value))
}
