import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { searchLocation } from '../../contextvm/tools/nominatim'
import { mapDataSchema, viewOptionsSchema, type MapSnapshot } from '@/features/public-map/model'
import { createMapEmbed } from './references'
import { readPublicMap } from './gateway'
import type { MapGateway, PublicMapSession } from './service'

export const MAP_RESOURCE_URI = 'ui://earthly/public-map/v1.html'
const uiMetadata = {
	ui: { resourceUri: MAP_RESOURCE_URI },
	'openai/outputTemplate': MAP_RESOURCE_URI,
}

function mapResult(snapshot: MapSnapshot): CallToolResult {
	return {
		content: [
			{
				type: 'text',
				text: snapshot.shareUrl
					? `Public map: ${snapshot.shareUrl}`
					: 'Temporary map preview. It has not been published. Ask to publish publicly before sharing.',
			},
		],
		structuredContent: {
			title: snapshot.title,
			draftId: snapshot.draftId,
			revision: snapshot.revision,
			reference: snapshot.reference,
			eventId: snapshot.eventId,
			shareUrl: snapshot.shareUrl,
			expiresAt: snapshot.expiresAt,
			features: snapshot.data.features.map((feature) => ({
				id: feature.id,
				type: feature.geometry?.type,
				name: feature.properties?.name ?? feature.properties?.label,
			})),
		},
		_meta: { map: snapshot },
	}
}

async function resultOf(
	operation: () => Promise<CallToolResult> | CallToolResult,
): Promise<CallToolResult> {
	try {
		return await operation()
	} catch (error) {
		return {
			isError: true,
			content: [
				{ type: 'text', text: error instanceof Error ? error.message : 'Map operation failed' },
			],
		}
	}
}

export function createMapMcpServer(
	session: PublicMapSession,
	gateway: MapGateway,
	baseUrl: string,
	widgetHtml: string,
) {
	const server = new McpServer({ name: 'earthly-public-maps', version: '0.1.0' })
	server.registerResource('earthly-map', MAP_RESOURCE_URI, {}, async () => ({
		contents: [
			{
				uri: MAP_RESOURCE_URI,
				mimeType: 'text/html;profile=mcp-app',
				text: widgetHtml,
				_meta: {
					ui: {
						prefersBorder: true,
						csp: {
							connectDomains: [baseUrl, 'https://tiles.openfreemap.org'],
							resourceDomains: [baseUrl, 'https://tiles.openfreemap.org'],
						},
					},
					'openai/widgetDescription':
						'Earthly interactive map with selectable features and public share links.',
					'openai/widgetCSP': {
						connect_domains: [baseUrl, 'https://tiles.openfreemap.org'],
						resource_domains: [baseUrl, 'https://tiles.openfreemap.org'],
					},
				},
			},
		],
	}))
	server.registerTool(
		'preview_map',
		{
			title: 'Preview an Earthly map',
			description:
				'Visualize supplied GeoJSON in chat without publishing. Supports up to 300 features and 48 KiB inline GeoJSON. Use [longitude, latitude]. Use name, color, fillColor, strokeColor, radius and earthly:callouts properties. For edits supply draftId, current revision and the complete revised collection, preserving feature IDs. Input can come from any source; never invent geocoding results. The guest editing session lasts at most two hours and ends on server restart.',
			inputSchema: {
				title: z.string().trim().min(1).max(160),
				description: z.string().max(2000).optional(),
				data: mapDataSchema,
				draftId: z.string().uuid().optional(),
				revision: z.number().int().positive().optional(),
				view: viewOptionsSchema.optional(),
			},
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
			_meta: uiMetadata,
		},
		(input) => resultOf(() => mapResult(session.preview(input))),
	)
	server.registerTool(
		'publish_map',
		{
			title: 'Publish a public map',
			description:
				'Publish the exact preview revision publicly to Nostr under a temporary per-map guest identity. Only call when the user requests public publication or public sharing. Anyone may read and copy the data. Requires the preview draftId and revision. Repeating a call retries the same signed event. Editing authority lasts only for this MCP session; the key is never returned.',
			inputSchema: {
				draftId: z.string().uuid(),
				revision: z.number().int().positive(),
				visibility: z.literal('public'),
			},
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
		},
		({ draftId, revision }) =>
			resultOf(async () => mapResult(await session.publish(draftId, revision))),
	)
	server.registerTool(
		'read_map',
		{
			title: 'Show a published map',
			description:
				'Read and display an inline public Earthly map by naddr from configured relays. Returns its geometry for further work. No account or signing key required. Blob-backed maps are not supported in this pilot.',
			inputSchema: { reference: z.string().min(10).max(4096), view: viewOptionsSchema.optional() },
			annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
			_meta: uiMetadata,
		},
		({ reference, view }) =>
			resultOf(async () => {
				const snapshot = await readPublicMap(gateway, baseUrl, reference)
				if (view) snapshot.view = view
				const result = mapResult(snapshot)
				result.structuredContent = { ...result.structuredContent, data: snapshot.data }
				return result
			}),
	)
	server.registerTool(
		'get_map_embed',
		{
			title: 'Get an Earthly iframe',
			description:
				'Return a configured iframe and public link for a published map. Options affect only presentation and never publish or edit the dataset. Embed viewers need no ChatGPT account. Links read the latest published version on load.',
			inputSchema: {
				reference: z.string().min(10).max(4096),
				view: viewOptionsSchema.optional(),
				height: z.number().int().min(200).max(2000).default(480),
			},
			annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
		},
		({ reference, view, height }) =>
			resultOf(async () => {
				await readPublicMap(gateway, baseUrl, reference)
				const embed = createMapEmbed(baseUrl, reference, view, height)
				return { content: [{ type: 'text', text: embed.html }], structuredContent: embed }
			}),
	)
	server.registerTool(
		'find_map_locations',
		{
			title: 'Find map locations',
			description:
				'Geocode a place name through Earthly’s existing Nominatim adapter. Returns candidates rather than guessing which ambiguous place was intended. Send only locations the user wants processed by this public geocoding provider. Choose candidates before preview_map; preserve source attribution.',
			inputSchema: {
				query: z.string().trim().min(1).max(250),
				countryCode: z
					.string()
					.regex(/^[a-zA-Z]{2}$/)
					.optional(),
			},
			annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
		},
		({ query, countryCode }) =>
			resultOf(async () => {
				const found = await searchLocation(query, 5, { countryCode })
				const results = found.results.map(({ displayName, coordinates, osmType, osmId }) => ({
					displayName,
					coordinates,
					source:
						osmType && osmId
							? `https://www.openstreetmap.org/${osmType}/${osmId}`
							: 'https://www.openstreetmap.org',
				}))
				return {
					content: [
						{
							type: 'text',
							text: `${results.length} candidates. Resolve ambiguity before mapping. Attribution: © OpenStreetMap contributors.`,
						},
					],
					structuredContent: { query, results },
				}
			}),
	)
	return server
}
