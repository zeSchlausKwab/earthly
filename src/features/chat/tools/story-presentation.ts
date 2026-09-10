/** Model-facing authoring contract; the shared codec remains the schema authority. */
import {
	MAP_PRESENTATION_LIMITS,
	type MAP_PRESENTATION_STYLE_KEYS,
	parseMapPresentation,
	parseStoryMarkdown,
	type MapPresentationIssue,
	type StoryMarkdownViewOccurrence,
} from '@/lib/map-presentation'
import { validateStoryPresentation } from '@/lib/nostr/story/lifecycle'
import type { ToolJsonSchema } from './types'

export const STORY_PRESENTATION_PROMPT_HINT =
	'Story maps use write_story_draft.presentation for the opening MapPresentationV1 and physical ```earthly-view JSON fences in markdown for inline views, not scenes/anchors or URL overlays. Views patch stable opening-layer ids cumulatively; cue/both advance the main map, figure renders inline without changing later cues. Only semantic body Map/feature references authorize layers; never publish automatically.'

export const STORY_VIEW_AUTHORING_HINT = [
	STORY_PRESENTATION_PROMPT_HINT,
	'Use read_story_draft before updating an existing Story; keep the full Markdown and existing view ids/positions unless the user asks to change them. Omit presentation to preserve it, or replace the entire opening presentation together with markdown in one write. The opening layers array is ordered bottom-to-top, can repeat a source with different stable ids/selectors/styles, and uses exact 37515:<64-hex-pubkey>:<d-tag> coordinates from read_entity, not naddr strings or event revision ids.',
	'Each physical fence contains {"version":1,"type":"view","id":"unique-view-id","title":"View title","display":"cue"}, optionally caption, camera:{center:[longitude,latitude],zoom,bearing?,pitch?}, and layers:{"opening-layer-id":{visible?,opacityMultiplier?,style?}}. Use display="figure" for a live inline map or "both" for an inline map that also drives the main canvas. No image upload is needed. For example:\n```earthly-view\n{"version":1,"type":"view","id":"closer","title":"A closer look","display":"both","camera":{"center":[2.3,48.8],"zoom":8},"layers":{"battle-sites":{"opacityMultiplier":0.8,"style":{"color":"#c44"}}}}\n```',
	'Views are sparse deltas, not full replacements: omitted camera/layer/style values inherit the opening state plus prior cue/both deltas; figure-only changes do not carry forward. A view cannot add, remove, reorder, retarget a source, or change featureIds. Define/select the layers in presentation first. Referenced sources are latest Maps; no version/history or scene array.',
	'A bare semantic nostr:naddr1… Map mention in prose authorizes the whole source or any subset; feature-only mentions authorize only those exact percent-decoded featureIds. Mentions in code, examples, view JSON, or URL on= overlays do not authorize anything. Never widen a feature-only reference to the whole Map or assume the active map is authorized. Style overrides affect rendering only, not foreign geometry/content. Preserve unknown future presentation and untouched future view fences on unrelated prose edits.',
].join(' ')

const limits = MAP_PRESENTATION_LIMITS
const cameraSchema: ToolJsonSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		center: {
			type: 'array',
			items: { type: 'number' },
			minItems: 2,
			maxItems: 2,
			description: '[longitude (-180..180), latitude (-90..90)].',
		},
		zoom: { type: 'number', minimum: limits.zoom[0], maximum: limits.zoom[1] },
		bearing: { type: 'number', minimum: limits.bearing[0], maximum: limits.bearing[1] },
		pitch: { type: 'number', minimum: limits.pitch[0], maximum: limits.pitch[1] },
	},
	required: ['center', 'zoom'],
}

const styleProperties: Record<(typeof MAP_PRESENTATION_STYLE_KEYS)[number], ToolJsonSchema> = {
	color: { type: 'string', maxLength: limits.colorLength },
	fillColor: { type: 'string', maxLength: limits.colorLength },
	strokeColor: { type: 'string', maxLength: limits.colorLength },
	fillOpacity: { type: 'number', minimum: 0, maximum: 1 },
	strokeOpacity: { type: 'number', minimum: 0, maximum: 1 },
	strokeWidth: { type: 'number', exclusiveMinimum: 0, maximum: limits.strokeWidth.max },
	radius: { type: 'number', exclusiveMinimum: 0, maximum: limits.radius.max },
	lineDash: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
	arrowStart: { type: 'boolean' },
	arrowEnd: { type: 'boolean' },
	displayIcon: { type: 'string', description: 'An existing bundled lucide:<icon-name> id.' },
}

export const storyPresentationSchema: ToolJsonSchema = {
	type: 'object',
	description:
		'Optional complete opening MapPresentationV1. Omit to preserve existing/future data. Use {version:1,layers:[]} to clear opening layers (also remove view patches that target them). Inline views belong in markdown, never a scenes array here.',
	additionalProperties: false,
	properties: {
		version: { type: 'integer', enum: [1] },
		initialView: cameraSchema,
		layers: {
			type: 'array',
			maxItems: limits.layers,
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					id: {
						type: 'string',
						maxLength: limits.layerIdLength,
						description:
							'Stable unique local layer id; preserve across edits. ASCII letters/digits plus . _ : -.',
					},
					source: {
						type: 'string',
						description: 'Exact latest Map coordinate: 37515:<64-hex-pubkey>:<d-tag>.',
					},
					featureIds: {
						type: 'array',
						items: { type: 'string', maxLength: limits.featureIdLength },
						maxItems: limits.featureIdsPerLayer,
						description:
							'Exact source feature ids. Omitted means whole source; [] means no features. Must be authorized by semantic body mentions.',
					},
					visible: { type: 'boolean', description: 'Default true.' },
					opacityMultiplier: {
						type: 'number',
						minimum: 0,
						maximum: 1,
						description: 'Default 1; multiplies effective fill/stroke opacity.',
					},
					style: {
						type: 'object',
						additionalProperties: false,
						properties: styleProperties,
						description:
							'Bounded rendering overrides only, never foreign content or labels. Colors accept hex, named colors, rgb()/rgba(), or hsl()/hsla(); no CSS URLs.',
					},
				},
				required: ['id', 'source'],
			},
		},
	},
	required: ['version', 'layers'],
}

function assertKnownKeys(value: unknown, keys: readonly string[], path: string): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return
	const unknown = Object.keys(value).filter((key) => !keys.includes(key))
	if (unknown.length) {
		throw new Error(
			`${path} has unsupported fields: ${unknown.join(', ')}. Views cannot retarget sources or featureIds; edit the opening presentation instead.`,
		)
	}
}

function assertCameraKeys(value: unknown, path: string): void {
	assertKnownKeys(value, Object.keys(cameraSchema.properties ?? {}), path)
}

function issueMessage(issues: readonly MapPresentationIssue[]): string {
	return issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
}

function viewSourceKey(view: StoryMarkdownViewOccurrence): string {
	// Appending prose after an EOF fence necessarily adds a line separator, but
	// does not edit the opaque payload or the physical closing delimiter.
	return view.closed ? view.raw.replace(/\r?\n$/u, '') : view.raw
}

/** Strict on new AI intent, lossless on untouched unrecognized persisted values. */
export function prepareStoryMapAuthoring(options: {
	markdown: string
	previousMarkdown?: string
	presentation: unknown
	replacePresentation: boolean
}): { content: string; presentation?: unknown } {
	const parsed = parseMapPresentation(options.presentation)
	if (options.replacePresentation) {
		if (parsed.status !== 'valid' || parsed.issues.length) {
			throw new Error(
				`presentation must be a valid MapPresentationV1. ${issueMessage(parsed.issues)}`,
			)
		}
		assertKnownKeys(
			options.presentation,
			Object.keys(storyPresentationSchema.properties ?? {}),
			'presentation',
		)
		const raw = options.presentation as Record<string, unknown>
		if (!Array.isArray(raw.layers)) throw new Error('presentation.layers must be an array.')
		assertCameraKeys(raw.initialView, 'presentation.initialView')
		for (const [index, layer] of (raw.layers as unknown[]).entries()) {
			assertKnownKeys(
				layer,
				Object.keys(storyPresentationSchema.properties?.layers?.items?.properties ?? {}),
				`presentation.layers[${index}]`,
			)
		}
	}

	// Match complete physical fences, not merely ids: adding a second copy or
	// changing any unsupported content is new intent and must validate.
	const preserved = new Map<string, number>()
	for (const view of parseStoryMarkdown(options.previousMarkdown).views) {
		const key = viewSourceKey(view)
		preserved.set(key, (preserved.get(key) ?? 0) + 1)
	}
	const ids = new Map<string, boolean>()
	const openingIds = new Set(
		parsed.status === 'valid' ? parsed.value.layers.map((layer) => layer.id) : [],
	)
	for (const occurrence of parseStoryMarkdown(options.markdown).views) {
		const key = viewSourceKey(occurrence)
		const remaining = preserved.get(key) ?? 0
		const unchanged = remaining > 0
		if (unchanged) preserved.set(key, remaining - 1)
		const result = occurrence.result
		const path = `earthly-view block ${occurrence.index + 1}`
		if (result.status === 'valid') {
			const previousUnchanged = ids.get(result.value.id)
			if (previousUnchanged !== undefined && (!unchanged || !previousUnchanged)) {
				throw new Error(
					`${path} duplicates view id '${result.value.id}'. Use unique stable view ids.`,
				)
			}
			ids.set(result.value.id, unchanged)
		}
		if (unchanged) continue
		if (result.status !== 'valid' || result.issues.length) {
			throw new Error(`${path} must be a valid StoryViewBlockV1. ${issueMessage(result.issues)}`)
		}
		const raw = JSON.parse(occurrence.payload) as Record<string, unknown>
		assertKnownKeys(
			raw,
			['version', 'type', 'id', 'title', 'caption', 'display', 'camera', 'layers'],
			path,
		)
		assertCameraKeys(raw.camera, `${path}.camera`)
		for (const [id, patch] of Object.entries((raw.layers ?? {}) as Record<string, unknown>)) {
			assertKnownKeys(patch, ['visible', 'opacityMultiplier', 'style'], `${path}.layers.${id}`)
			if (!openingIds.has(id)) {
				throw new Error(
					`${path} targets unknown opening layer '${id}'. Define an authorized layer in presentation first.`,
				)
			}
		}
	}

	const validated = validateStoryPresentation(
		{
			content: options.markdown,
			presentation:
				options.replacePresentation && parsed.status === 'valid'
					? parsed.value
					: options.presentation,
		},
		{ allowLocalDraftReferences: true },
	)
	return {
		content: options.markdown,
		presentation: options.replacePresentation ? validated.presentation : options.presentation,
	}
}

/** Keep diagnostics separate from raw values so future schemas remain inspectable. */
export function describeStoryMapContent(presentation: unknown, markdown: string | undefined) {
	const parsed = parseMapPresentation(presentation)
	const views = parseStoryMarkdown(markdown).views
	return {
		presentationStatus: parsed.status,
		presentationIssues: parsed.issues.slice(0, 10),
		openingLayerIds: parsed.status === 'valid' ? parsed.value.layers.map((layer) => layer.id) : [],
		viewBlockCount: views.length,
		viewBlocksTruncated: views.length > 100,
		viewBlocks: views.slice(0, 100).map(({ index, result }) => ({
			index,
			status: result.status,
			...(result.status === 'valid'
				? {
						id: result.value.id,
						title: result.value.title,
						display: result.value.display,
						layerIds: Object.keys(result.value.layers ?? {}),
					}
				: {}),
			issues: result.issues.slice(0, 10),
		})),
	}
}
