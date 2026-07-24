import type { Route } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import { deterministicChatSettings } from '../../core/chat-provider-settings'
import type { AiTaskMetadata } from '../../core/task'

export const installDeterministicChatProviderTask: AiTaskMetadata = {
	id: 'setup.deterministic-chat-provider',
	summary:
		'Install a controlled OpenAI-compatible model endpoint for repeatable Earthly chat journeys.',
	preconditions: ['Fresh browser page', 'Loopback Earthly server'],
	sideEffects: ['Intercepts one fake model origin in the current browser page'],
	viewports: 'both',
}

export const DETERMINISTIC_CHAT_BASE_URL = 'http://model.earthly.localhost/v1'
export const DETERMINISTIC_CHAT_MODEL_ID = 'earthly-spatial-fixture'
export const DETERMINISTIC_CHAT_SECONDARY_MODEL_ID = 'earthly-compact-fixture'

export type DeterministicChatScenario =
	| 'spatial-research'
	| 'nearby-discovery'
	| 'source-to-map-research'

const scenarioModels: Record<DeterministicChatScenario, { id: string; name: string }> = {
	'spatial-research': {
		id: DETERMINISTIC_CHAT_MODEL_ID,
		name: 'Earthly spatial fixture',
	},
	'nearby-discovery': {
		id: 'earthly-nearby-fixture',
		name: 'Earthly nearby fixture',
	},
	'source-to-map-research': {
		id: 'earthly-source-to-map-fixture',
		name: 'Earthly source-to-map fixture',
	},
}

export interface DeterministicChatRequestSummary {
	round: number
	messageRoles: string[]
	toolNames: string[]
	userMessageCount: number
}

export interface DeterministicChatProviderHarness {
	settings: ReturnType<typeof deterministicChatSettings>
	requests(): DeterministicChatRequestSummary[]
}

const syntheticSpatialDraft = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'water-west',
			properties: { name: 'West trailhead fountain', amenity: 'drinking_water' },
			geometry: { type: 'Point', coordinates: [16.3505, 48.2051] },
		},
		{
			type: 'Feature',
			id: 'water-east',
			properties: { name: 'East trailhead fountain', amenity: 'drinking_water' },
			geometry: { type: 'Point', coordinates: [16.3728, 48.2112] },
		},
		{
			type: 'Feature',
			id: 'catchment-west',
			properties: { name: 'West 15-minute walking catchment', minutes: 15 },
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[16.341, 48.199],
						[16.361, 48.199],
						[16.363, 48.212],
						[16.343, 48.214],
						[16.341, 48.199],
					],
				],
			},
		},
		{
			type: 'Feature',
			id: 'catchment-east',
			properties: { name: 'East 15-minute walking catchment', minutes: 15 },
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[16.363, 48.204],
						[16.383, 48.203],
						[16.385, 48.217],
						[16.365, 48.219],
						[16.363, 48.204],
					],
				],
			},
		},
	],
} as const

const syntheticSourcedDraft = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'current-case-1',
			properties: {
				name: 'Synthetic current case A',
				classification: 'exclave',
				sourceUrl: 'https://en.wikipedia.org/wiki/Enclave_and_exclave',
				sourceTitle: 'Enclave and exclave',
				sourceRevisionId: 123456,
				sourceSection: 'True exclaves',
				sourceTable: 0,
				sourceRow: 1,
				sourceRetrievedAt: '2026-07-21T00:00:00.000Z',
				coordinatePrecision: 'representative',
			},
			geometry: { type: 'Point', coordinates: [8.4, 47.6] },
		},
		{
			type: 'Feature',
			id: 'current-case-2',
			properties: {
				name: 'Synthetic current case B',
				classification: 'exclave',
				sourceUrl: 'https://en.wikipedia.org/wiki/Enclave_and_exclave',
				sourceTitle: 'Enclave and exclave',
				sourceRevisionId: 123456,
				sourceSection: 'True exclaves',
				sourceTable: 0,
				sourceRow: 2,
				sourceRetrievedAt: '2026-07-21T00:00:00.000Z',
				coordinatePrecision: 'representative',
			},
			geometry: { type: 'Point', coordinates: [7.2, 43.8] },
		},
	],
} as const

function corsHeaders(contentType: string): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'authorization, content-type, x-cashu',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Content-Type': contentType,
	}
}

function streamBody(delta: Record<string, unknown>, finishReason: string, modelId: string): string {
	const chunk = {
		id: 'chatcmpl-earthly-fixture',
		object: 'chat.completion.chunk',
		created: 1,
		model: modelId,
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	}
	return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`
}

async function fulfillModelRoute(
	route: Route,
	requests: DeterministicChatRequestSummary[],
	scenario: DeterministicChatScenario,
): Promise<void> {
	const model = scenarioModels[scenario]
	const request = route.request()
	if (request.method() === 'OPTIONS') {
		await route.fulfill({ status: 204, headers: corsHeaders('text/plain') })
		return
	}
	if (request.url().endsWith('/models')) {
		await route.fulfill({
			status: 200,
			headers: corsHeaders('application/json'),
			json: {
				data: [
					{
						id: model.id,
						name: model.name,
						context_length: 16_384,
						supports_tools: true,
						architecture: { input_modalities: ['text'], output_modalities: ['text'] },
					},
					{
						id: DETERMINISTIC_CHAT_SECONDARY_MODEL_ID,
						name: 'Earthly compact fixture',
						context_length: 8_192,
						supports_tools: true,
						architecture: { input_modalities: ['text'], output_modalities: ['text'] },
					},
				],
			},
		})
		return
	}

	const body = (request.postDataJSON() ?? {}) as {
		messages?: Array<{ role?: string; content?: unknown }>
		tools?: Array<{ function?: { name?: string } }>
	}
	const messages = Array.isArray(body.messages) ? body.messages : []
	const toolNames = Array.isArray(body.tools)
		? body.tools.flatMap((tool) => (tool.function?.name ? [tool.function.name] : []))
		: []
	requests.push({
		round: requests.length + 1,
		messageRoles: messages.flatMap((message) => (message.role ? [message.role] : [])),
		toolNames,
		userMessageCount: messages.filter((message) => message.role === 'user').length,
	})

	const lastUserIndex = messages.findLastIndex((message) => message.role === 'user')
	const hasToolResultForCurrentTurn = messages
		.slice(lastUserIndex + 1)
		.some((message) => message.role === 'tool')
	const userMessageCount = messages.filter((message) => message.role === 'user').length

	const nearbyBodyText = hasToolResultForCurrentTurn
		? streamBody(
				{
					role: 'assistant',
					content:
						userMessageCount > 1
							? 'Refined to Garden Court Park and Quiet Cup on this side of the river. This remains a chat recommendation; no route or recommendation layer was added to the map.'
							: 'I used the current map viewport, not your device location. Two synthetic candidates are Riverside Park with North Bank Coffee, and Garden Court Park with Quiet Cup. Earthly has not added these recommendations or a route to the map.',
				},
				'stop',
				model.id,
			)
		: streamBody(
				{
					role: 'assistant',
					tool_calls: [
						{
							index: 0,
							id: `call-nearby-state-${userMessageCount}`,
							type: 'function',
							function: { name: 'get_editor_state', arguments: '{}' },
						},
					],
				},
				'tool_calls',
				model.id,
			)

	const spatialBodyText = hasToolResultForCurrentTurn
		? streamBody(
				{
					role: 'assistant',
					content:
						'I added two synthetic drinking-water points and their 15-minute walking catchments as ordinary Earthly geometry. The proposal was applied and is ready for your inspection and publication.',
				},
				'stop',
				model.id,
			)
		: streamBody(
				{
					role: 'assistant',
					tool_calls: [
						{
							index: 0,
							id: 'call-spatial-draft',
							type: 'function',
							function: {
								name: 'write_geojson_to_editor',
								arguments: JSON.stringify({ geojson: syntheticSpatialDraft }),
							},
						},
						{
							index: 1,
							id: 'call-spatial-metadata',
							type: 'function',
							function: {
								name: 'set_dataset_metadata',
								arguments: JSON.stringify({
									name: 'Trailhead water catchments',
									description: 'Synthetic deterministic AI-suite research result.',
								}),
							},
						},
					],
				},
				'tool_calls',
				model.id,
			)
	const sourceToMapCode = `
		authoring.commitDataset({
			featureCollection: ${JSON.stringify(syntheticSourcedDraft)},
			metadata: {
				name: 'Current sourced cases',
				description: 'Deterministic provenance-aware source-to-map fixture.',
				properties: { sourceUrl: 'https://en.wikipedia.org/wiki/Enclave_and_exclave' }
			},
			requireFeatureProvenance: true
		})
		'Committed 2 provenance-validated features'
	`
	const sourceToMapBodyText = hasToolResultForCurrentTurn
		? streamBody(
				{
					role: 'assistant',
					content:
						'I created one validated Dataset containing exactly the two synthetic current cases. Every feature retains article revision, section, table, row, retrieval time, and coordinate-precision provenance.',
				},
				'stop',
				model.id,
			)
		: streamBody(
				{
					role: 'assistant',
					tool_calls: [
						{
							index: 0,
							id: 'call-source-state',
							type: 'function',
							function: { name: 'get_editor_state', arguments: '{}' },
						},
						{
							index: 1,
							id: 'call-source-commit',
							type: 'function',
							function: {
								name: 'run_code',
								arguments: JSON.stringify({ code: sourceToMapCode }),
							},
						},
					],
				},
				'tool_calls',
				model.id,
			)
	const bodyText =
		scenario === 'nearby-discovery'
			? nearbyBodyText
			: scenario === 'source-to-map-research'
				? sourceToMapBodyText
				: spatialBodyText

	await route.fulfill({
		status: 200,
		headers: corsHeaders('text/event-stream; charset=utf-8'),
		body: bodyText,
	})
}

export async function installDeterministicChatProvider(
	earthly: EarthlySession,
	scenario: DeterministicChatScenario = 'spatial-research',
): Promise<DeterministicChatProviderHarness> {
	const recorded: DeterministicChatRequestSummary[] = []
	await earthly.page.route(`${DETERMINISTIC_CHAT_BASE_URL}/**`, (route) =>
		fulfillModelRoute(route, recorded, scenario),
	)
	const model = scenarioModels[scenario]
	return {
		settings: deterministicChatSettings(DETERMINISTIC_CHAT_BASE_URL, model.id),
		requests: () => structuredClone(recorded),
	}
}
