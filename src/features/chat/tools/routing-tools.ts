import { useEditorStore } from '@/features/geo-editor/store'
import { loadWorldLayer } from '@/lib/geo/worldData'
import { runPathfinder } from '../sandbox/sandboxPathfinder'
import type { ToolEntry } from './registry'

function asFeatureCollection(value: unknown): GeoJSON.FeatureCollection | null {
	if (!value || typeof value !== 'object') return null
	const candidate = value as GeoJSON.FeatureCollection
	return candidate.type === 'FeatureCollection' && Array.isArray(candidate.features)
		? candidate
		: null
}

function editorLineNetwork(selectedOnly: boolean): GeoJSON.FeatureCollection {
	const state = useEditorStore.getState()
	const selected = new Set(state.selectedFeatureIds)
	const features = state.features.filter((feature) => {
		if (selectedOnly && !selected.has(feature.id)) return false
		return feature.geometry?.type === 'LineString' || feature.geometry?.type === 'MultiLineString'
	})
	if (features.length === 0) {
		throw new Error(
			selectedOnly
				? 'the current selection contains no line network; select the relevant rail, river, road, or other line features first'
				: 'the editor contains no line network; import or draw the actual network before routing over it',
		)
	}
	return { type: 'FeatureCollection', features }
}

export function registerRoutingTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'route_over_network',
		kind: 'host-builtin',
		schema: {
			type: 'function',
			function: {
				name: 'route_over_network',
				description:
					'Default to this cheap host tool automatically for requested shipping/maritime lanes and for routes over actual rail, river, canal, trail, or custom GeoJSON line networks, without requiring the user to ask for routing. It computes a shortest path with geojson-path-finder and imports compact network-derived geometry when toEditor=true. Prefer it over building the same route with sandbox pathfinder or hand-authored coordinates. For ordinary road, bus, bicycle, or pedestrian routing, prefer valhalla_route. Never substitute a hand-drawn straight line when this tool or Valhalla can represent the requested alignment.',
				parameters: {
					type: 'object',
					properties: {
						network: {
							type: 'string',
							description: 'Line network to route over.',
							enum: ['maritime_network', 'editor_lines', 'selected_lines', 'provided_geojson'],
						},
						from: {
							type: 'array',
							description:
								'Start as [longitude, latitude]. It is snapped to the nearest network vertex.',
						},
						to: {
							type: 'array',
							description:
								'End as [longitude, latitude]. It is snapped to the nearest network vertex.',
						},
						networkGeojson: {
							type: 'object',
							description: 'FeatureCollection used only with network=provided_geojson.',
						},
						name: {
							type: 'string',
							description: 'Optional route feature name.',
						},
						toEditor: {
							type: 'boolean',
							description: 'Import the routed LineString into the editor.',
						},
						replaceExisting: {
							type: 'boolean',
							description: 'When toEditor=true, replace existing features instead of appending.',
						},
					},
					required: ['network', 'from', 'to'],
				},
			},
		},
		handler: async (args) => {
			const networkKind = args.network
			let network: GeoJSON.FeatureCollection
			if (networkKind === 'maritime_network') network = await loadWorldLayer('maritime_network')
			else if (networkKind === 'editor_lines') network = editorLineNetwork(false)
			else if (networkKind === 'selected_lines') network = editorLineNetwork(true)
			else if (networkKind === 'provided_geojson') {
				const provided = asFeatureCollection(args.networkGeojson)
				if (!provided) throw new Error('networkGeojson must be a GeoJSON FeatureCollection')
				network = provided
			} else {
				throw new Error(
					'network must be maritime_network, editor_lines, selected_lines, or provided_geojson',
				)
			}

			const result = runPathfinder(network, args.from, args.to)
			const feature: GeoJSON.Feature<GeoJSON.LineString> = {
				...result.path,
				properties: {
					name:
						typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'Network route',
					sourceDataset: String(networkKind),
					routingEngine: 'geojson-path-finder',
					geometryPrecision: 'network-derived',
					mappingBasis: `Shortest path over ${String(networkKind)}`,
					lengthKm: result.lengthKm,
					strokeWidth: 3,
				},
			}
			return {
				feature,
				summary: {
					network: networkKind,
					lengthKm: result.lengthKm,
					vertexCount: result.vertexCount,
					from: result.from,
					to: result.to,
				},
			}
		},
	})
}
