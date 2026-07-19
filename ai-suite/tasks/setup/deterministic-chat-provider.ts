import type { Route } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import { deterministicChatSettings } from '../../core/chat-provider-settings'
import type { AiTaskMetadata } from '../../core/task'

export const installDeterministicChatProviderTask: AiTaskMetadata = {
	id: 'setup.deterministic-chat-provider',
	summary:
		'Install a controlled OpenAI-compatible model endpoint that proposes synthetic Earthly geometry.',
	preconditions: ['Fresh browser page', 'Loopback Earthly server'],
	sideEffects: ['Intercepts one fake model origin in the current browser page'],
	viewports: 'both',
}

export const DETERMINISTIC_CHAT_BASE_URL = 'http://model.earthly.localhost/v1'
export const DETERMINISTIC_CHAT_MODEL_ID = 'earthly-spatial-fixture'

export interface DeterministicChatRequestSummary {
	round: number
	messageRoles: string[]
	toolNames: string[]
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

function corsHeaders(contentType: string): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'authorization, content-type, x-cashu',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Content-Type': contentType,
	}
}

function streamBody(delta: Record<string, unknown>, finishReason: string): string {
	const chunk = {
		id: 'chatcmpl-earthly-fixture',
		object: 'chat.completion.chunk',
		created: 1,
		model: DETERMINISTIC_CHAT_MODEL_ID,
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	}
	return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`
}

async function fulfillModelRoute(
	route: Route,
	requests: DeterministicChatRequestSummary[],
): Promise<void> {
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
						id: DETERMINISTIC_CHAT_MODEL_ID,
						name: 'Earthly spatial fixture',
						context_length: 16_384,
						supports_tools: true,
						architecture: { input_modalities: ['text'], output_modalities: ['text'] },
					},
				],
			},
		})
		return
	}

	const body = (request.postDataJSON() ?? {}) as {
		messages?: Array<{ role?: string }>
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
	})

	const hasToolResult = messages.some((message) => message.role === 'tool')
	const bodyText = hasToolResult
		? streamBody(
				{
					role: 'assistant',
					content:
						'I added two synthetic drinking-water points and their 15-minute walking catchments as ordinary Earthly geometry. The proposal was applied and is ready for your inspection and publication.',
				},
				'stop',
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
			)

	await route.fulfill({
		status: 200,
		headers: corsHeaders('text/event-stream; charset=utf-8'),
		body: bodyText,
	})
}

export async function installDeterministicChatProvider(
	earthly: EarthlySession,
): Promise<DeterministicChatProviderHarness> {
	const recorded: DeterministicChatRequestSummary[] = []
	await earthly.page.route(`${DETERMINISTIC_CHAT_BASE_URL}/**`, (route) =>
		fulfillModelRoute(route, recorded),
	)
	return {
		settings: deterministicChatSettings(DETERMINISTIC_CHAT_BASE_URL, DETERMINISTIC_CHAT_MODEL_ID),
		requests: () => structuredClone(recorded),
	}
}
