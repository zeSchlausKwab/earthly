import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'

export type MapletImportAdapter = 'geojson' | 'liveuamap'

export interface MapletImportCandidate {
	path: string[]
	adapter: MapletImportAdapter
	label: string
	count: number
	propertyKeys: string[]
	suggestedNameProperty?: string
	suggestedIdProperty?: string
}

/** Paths are literal object keys / array indexes, never executable expressions. */
export interface MapletImportRecipe {
	version: 1
	path: string[]
	adapter: MapletImportAdapter
	/** Absent retains all properties; attribution survives an explicit selection. */
	retainProperties?: string[]
	idProperty?: string
	nameProperty?: string
	/** Source record IDs, before optional feature ID remapping. */
	sourceIds?: string[]
}

export interface MapletImportContext {
	/** Acquisition provenance supplied explicitly by the host, never inferred from format. */
	sourceUrl?: string
}

export interface MapletImportResult {
	featureCollection: FeatureCollection
	warnings: string[]
}

export type LiveuamapImportMapper = (
	payload: unknown,
	options: { source: 'sample' | 'live'; includeLines?: boolean; sourceUrl?: string },
) => MapletImportResult

export interface MapletImporter {
	parse(text: string): unknown
	discover(payload: unknown): MapletImportCandidate[]
	apply(
		payload: unknown,
		recipe: MapletImportRecipe,
		context?: MapletImportContext,
	): MapletImportResult
}

/**
 * Deliberately self-contained: serialize this factory into the Maplet sandbox.
 * The optional host validator is additional defense; the factory validates its
 * own output even when no external function is injected.
 */
export function createMapletImporter(
	mapLiveuamapPayload: LiveuamapImportMapper,
	validateCollection?: (input: unknown) => FeatureCollection,
): MapletImporter {
	const maxBytes = 5 * 1024 * 1024
	const maxNodes = 300_000
	const maxDepth = 24
	const maxCandidates = 64
	const maxFeatures = 5_000
	const maxPositions = 50_000
	const maxPropertyBytes = 16_384
	const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
	const geometryTypes = new Set([
		'Point',
		'MultiPoint',
		'LineString',
		'MultiLineString',
		'Polygon',
		'MultiPolygon',
		'GeometryCollection',
	])
	const own = (value: object, key: string) => Object.hasOwn(value, key)
	const record = (value: unknown): value is Record<string, unknown> =>
		value !== null && typeof value === 'object' && !Array.isArray(value)
	const byteLength = (text: string) => new TextEncoder().encode(text).byteLength
	function assertKey(key: string): void {
		if (forbidden.has(key)) throw new Error(`Unsafe JSON key: ${key}`)
	}
	/** Bound every input, including unselected branches, before discovery/serialization. */
	function checkInput(payload: unknown): void {
		let nodes = 0
		const ancestors = new Set<object>()
		function walk(value: unknown, depth: number): void {
			if (++nodes > maxNodes) throw new Error('Import JSON exceeds the traversal node limit.')
			if (depth > maxDepth) throw new Error('Import JSON exceeds the nesting depth limit.')
			if (value === null || typeof value === 'boolean' || typeof value === 'string') return
			if (typeof value === 'number') {
				if (!Number.isFinite(value)) throw new Error('Import JSON contains a nonfinite number.')
				return
			}
			if (typeof value !== 'object') throw new Error('Import requires plain JSON values.')
			if (ancestors.has(value)) throw new Error('Import JSON contains a cycle.')
			const prototype = Object.getPrototypeOf(value)
			if (
				Array.isArray(value)
					? prototype !== Array.prototype
					: prototype !== Object.prototype && prototype !== null
			)
				throw new Error('Import requires plain JSON objects.')
			if (Object.getOwnPropertySymbols(value).length)
				throw new Error('Import requires plain JSON keys.')
			ancestors.add(value)
			const descriptors = Object.getOwnPropertyDescriptors(value)
			for (const [key, descriptor] of Object.entries(descriptors)) {
				if (Array.isArray(value) && key === 'length') continue
				assertKey(key)
				if (!own(descriptor, 'value') || !descriptor.enumerable)
					throw new Error('Import JSON cannot contain accessors.')
				walk(descriptor.value, depth + 1)
			}
			if (Array.isArray(value) && Object.keys(value).length !== value.length)
				throw new Error('Import JSON cannot contain sparse arrays.')
			ancestors.delete(value)
		}
		walk(payload, 0)
		if (byteLength(JSON.stringify(payload)) > maxBytes)
			throw new Error('Import JSON exceeds the 5 MiB limit.')
	}
	function parse(text: string): unknown {
		if (typeof text !== 'string' || byteLength(text) > maxBytes)
			throw new Error('Import JSON exceeds the 5 MiB limit.')
		let payload: unknown
		try {
			payload = JSON.parse(text)
		} catch {
			throw new Error('The supplied text is not valid JSON.')
		}
		checkInput(payload)
		return payload
	}
	function stableJson(value: unknown): string {
		if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
		if (record(value))
			return `{${Object.keys(value)
				.sort()
				.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
				.join(',')}}`
		return JSON.stringify(value)
	}
	function contentId(value: unknown): string {
		const input = stableJson(value)
		let first = 2166136261
		let second = 2246822519
		for (let index = 0; index < input.length; index++) {
			const code = input.charCodeAt(index)
			first = Math.imul(first ^ code, 16777619) >>> 0
			second = Math.imul(second ^ code, 3266489917) >>> 0
		}
		return `import:${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
	}
	function validId(value: unknown): value is string | number {
		return (
			(typeof value === 'string' && value.length > 0 && value.length <= 256) ||
			(typeof value === 'number' && Number.isFinite(value))
		)
	}
	function featureMarker(value: unknown): boolean {
		return record(value) && value.type === 'Feature'
	}
	function liveMarker(value: unknown): value is Record<string, unknown> {
		return record(value) && own(value, 'points') && own(value, 'type_id') && own(value, 'id')
	}
	function adapterAt(value: unknown): MapletImportAdapter | null {
		if (
			record(value) &&
			(value.type === 'FeatureCollection' ||
				value.type === 'Feature' ||
				geometryTypes.has(String(value.type)))
		)
			return 'geojson'
		if (liveMarker(value)) return 'liveuamap'
		if (record(value) && own(value, 'fields') && record(value.fields)) {
			const values = Object.values(value.fields)
			if (values.length === 0 || values.some(liveMarker)) return 'liveuamap'
		}
		if (value && typeof value === 'object') {
			const values = Object.values(value)
			if (values.some(featureMarker)) return 'geojson'
			if (!Array.isArray(value) && values.some(liveMarker)) return 'liveuamap'
		}
		return null
	}
	function atPath(payload: unknown, path: readonly string[]): unknown {
		let node = payload
		for (const key of path) {
			assertKey(key)
			if (!node || typeof node !== 'object' || !own(node, key))
				throw new Error('Import recipe no longer matches the source path. Choose the data again.')
			node = (node as Record<string, unknown>)[key]
		}
		return node
	}
	function geometryValidator() {
		let positionCount = 0
		function list(value: unknown): unknown[] {
			if (!Array.isArray(value)) throw new Error('Invalid geometry coordinate structure.')
			return value
		}
		function position(value: unknown): Position {
			if (++positionCount > maxPositions)
				throw new Error('Import exceeds the 50,000 coordinate limit.')
			if (
				!Array.isArray(value) ||
				value.length < 2 ||
				value.length > 3 ||
				value.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
				Math.abs(value[0]) > 180 ||
				Math.abs(value[1]) > 90
			)
				throw new Error('Invalid WGS84 longitude/latitude coordinate.')
			return [...value]
		}
		function line(value: unknown, ring = false): Position[] {
			const positions = list(value).map(position)
			if (positions.length < (ring ? 4 : 2)) throw new Error('Geometry has too few coordinates.')
			if (ring) {
				if (stableJson(positions[0]) !== stableJson(positions[positions.length - 1]))
					throw new Error('Polygon ring must be closed; select an explicit adapter to repair it.')
				if (new Set(positions.slice(0, -1).map((item) => stableJson(item.slice(0, 2)))).size < 3)
					throw new Error('Polygon ring has too few distinct coordinates.')
				let area = 0
				for (let index = 1; index < positions.length; index++) {
					const a = positions[index - 1]
					const b = positions[index]
					if (
						!a ||
						!b ||
						a[0] === undefined ||
						a[1] === undefined ||
						b[0] === undefined ||
						b[1] === undefined
					)
						throw new Error('Invalid polygon coordinate.')
					area += a[0] * b[1] - b[0] * a[1]
				}
				if (Math.abs(area) < 1e-12) throw new Error('Polygon ring has zero area.')
			}
			return positions
		}
		function polygon(value: unknown): Position[][] {
			const rings = list(value)
			if (!rings.length) throw new Error('Polygon has no exterior ring.')
			return rings.map((ring) => line(ring, true))
		}
		function geometry(value: unknown, depth = 0): Geometry {
			if (!record(value) || depth > 3) throw new Error('Invalid or excessively nested geometry.')
			switch (value.type) {
				case 'Point':
					return { type: 'Point', coordinates: position(value.coordinates) }
				case 'MultiPoint': {
					const coordinates = list(value.coordinates).map(position)
					if (!coordinates.length) throw new Error('MultiPoint has no coordinates.')
					return { type: 'MultiPoint', coordinates }
				}
				case 'LineString':
					return { type: 'LineString', coordinates: line(value.coordinates) }
				case 'MultiLineString': {
					const coordinates = list(value.coordinates).map((item) => line(item))
					if (!coordinates.length) throw new Error('MultiLineString has no paths.')
					return { type: 'MultiLineString', coordinates }
				}
				case 'Polygon':
					return { type: 'Polygon', coordinates: polygon(value.coordinates) }
				case 'MultiPolygon': {
					const coordinates = list(value.coordinates).map(polygon)
					if (!coordinates.length) throw new Error('MultiPolygon has no polygons.')
					return { type: 'MultiPolygon', coordinates }
				}
				case 'GeometryCollection': {
					const geometries = list(value.geometries).map((item) => geometry(item, depth + 1))
					if (!geometries.length) throw new Error('GeometryCollection has no geometries.')
					return { type: 'GeometryCollection', geometries }
				}
				default:
					throw new Error('Unsupported GeoJSON geometry.')
			}
		}
		return geometry
	}
	function normalizedGeojson(value: unknown): FeatureCollection {
		let items: { value: unknown; key?: string }[]
		const inheritedProvenance: Record<string, unknown> = {}
		if (record(value) && value.type === 'FeatureCollection') {
			if (!Array.isArray(value.features))
				throw new Error('FeatureCollection features must be an array.')
			for (const [key, entry] of Object.entries(value)) {
				if (reserved(key)) inheritedProvenance[key] = structuredClone(entry)
			}
			items = value.features.map((item) => ({ value: item }))
		} else if (
			record(value) &&
			(value.type === 'Feature' || geometryTypes.has(String(value.type)))
		) {
			items = [{ value }]
		} else if (Array.isArray(value)) {
			items = value.map((item) => ({ value: item }))
		} else if (record(value)) {
			items = Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => ({ value: item, key }))
		} else throw new Error('The selected value is not a GeoJSON source.')
		if (items.length > maxFeatures) throw new Error('Import exceeds the 5,000 feature limit.')
		const geometry = geometryValidator()
		return {
			type: 'FeatureCollection',
			features: items.map(({ value: item, key }) => {
				if (!record(item))
					throw new Error('Mixed GeoJSON source: every selected record must be a Feature.')
				if (item.type !== 'Feature') {
					if (items.length !== 1 || item !== value || !geometryTypes.has(String(item.type)))
						throw new Error('Mixed GeoJSON source: every selected record must be a Feature.')
					return { type: 'Feature', geometry: geometry(item), properties: {} }
				}
				if (item.properties !== undefined && item.properties !== null && !record(item.properties))
					throw new Error('Feature properties must be an object or null.')
				if (item.id !== undefined && !validId(item.id))
					throw new Error('Invalid source feature ID.')
				const id = item.id ?? key
				return {
					type: 'Feature',
					...(id === undefined ? {} : { id: id as string | number }),
					geometry: geometry(item.geometry),
					properties: {
						...inheritedProvenance,
						...structuredClone((item.properties ?? {}) as Record<string, unknown>),
					},
				}
			}),
		}
	}
	function normalizedLiveuamap(value: unknown, context?: MapletImportContext): MapletImportResult {
		let fields: Record<string, unknown>
		let datats: unknown
		if (liveMarker(value)) fields = { [String(value.id)]: value }
		else if (record(value) && own(value, 'fields') && record(value.fields)) {
			fields = value.fields
			datats = value.datats
		} else if (record(value)) fields = value
		else throw new Error('The selected value is not a Liveuamap record source.')
		if (Object.keys(fields).length > maxFeatures)
			throw new Error('Import exceeds the 5,000 record limit.')
		const expectedIds = new Set<string>()
		let positions = 0
		function validatePosition(lat: unknown, lon: unknown): void {
			if (++positions > maxPositions) throw new Error('Import exceeds the 50,000 coordinate limit.')
			if (
				typeof lat !== 'number' ||
				typeof lon !== 'number' ||
				!Number.isFinite(lat) ||
				!Number.isFinite(lon) ||
				Math.abs(lat) > 90 ||
				Math.abs(lon) > 180
			)
				throw new Error('Invalid Liveuamap WGS84 latitude/longitude coordinate.')
		}
		for (const item of Object.values(fields)) {
			if (
				!liveMarker(item) ||
				!validId(item.id) ||
				!Array.isArray(item.points) ||
				!item.points.length
			)
				throw new Error(
					'Mixed or changed Liveuamap source: every record needs an ID, a supported type, and points.',
				)
			if (item.type_id !== 6 && item.type_id !== 14)
				throw new Error(
					`Liveuamap record ${String(item.id)} has unsupported type ${String(item.type_id)}. Supported types are 6 (polygon paths) and 14 (ordered line points); no partial records were imported.`,
				)
			if (expectedIds.has(String(item.id))) throw new Error('Duplicate Liveuamap source ID.')
			expectedIds.add(String(item.id))
			if (item.type_id === 14) {
				if (item.points.length < 2)
					throw new Error('Invalid Liveuamap line; at least two ordered points are required.')
				for (const point of item.points) {
					if (!record(point))
						throw new Error('Invalid Liveuamap line point; expected a latitude/longitude object.')
					validatePosition(point.lat, point.lng)
				}
				continue
			}
			for (const path of item.points) {
				if (!Array.isArray(path) || path.length < 4 || path.length % 2 !== 0)
					throw new Error('Invalid Liveuamap path; no partial records were imported.')
				for (let index = 0; index < path.length; index += 2) {
					validatePosition(path[index], path[index + 1])
				}
			}
		}
		const mapped = mapLiveuamapPayload(fields, { source: 'sample', includeLines: true })
		if (mapped.warnings.some((warning) => /\b(skipped|omitted)\b/iu.test(warning)))
			throw new Error('Liveuamap contains a degenerate path; no partial records were imported.')
		const actualIds = new Set(
			mapped.featureCollection.features.map((feature) => String(feature.properties?.sourceId)),
		)
		if (actualIds.size !== expectedIds.size || [...expectedIds].some((id) => !actualIds.has(id)))
			throw new Error('Liveuamap conversion did not preserve every selected record.')
		const featureCollection = normalizedGeojson(mapped.featureCollection)
		let contentLineIds = 0
		for (const feature of featureCollection.features) {
			const properties = { ...feature.properties }
			// This adapter identifies a wire format, not a region or acquisition method.
			delete properties.sourceUrl
			if (context?.sourceUrl) properties.sourceUrl = context.sourceUrl
			properties.sourceMode = 'imported'
			const prefix = `liveuamap:${String(properties.sourceId)}`
			if (feature.geometry.type === 'LineString') {
				if (properties.sourceTypeId === 14) {
					// A type-14 record owns exactly one line, so edits retain its source identity.
					feature.id = `${prefix}:line`
				} else {
					feature.id = `${prefix}:line:${contentId(feature.geometry).slice('import:'.length)}`
					contentLineIds++
				}
			} else feature.id = `${prefix}:polygon`
			feature.properties = properties
		}
		if (datats !== undefined) {
			if (typeof datats !== 'number' && typeof datats !== 'string')
				throw new Error('Invalid Liveuamap datats metadata.')
			for (const feature of featureCollection.features)
				feature.properties = { ...feature.properties, sourceDatats: datats }
		}
		const warnings = mapped.warnings.slice(1) // The first message describes the demo's sample/live acquisition.
		if (contentLineIds)
			warnings.push(
				`${contentLineIds} source line(s) have no separate source ID. Geometry-based line IDs were generated; those IDs change when the line geometry changes.`,
			)
		return { featureCollection, warnings }
	}
	function normalize(
		value: unknown,
		adapter: MapletImportAdapter,
		context?: MapletImportContext,
	): MapletImportResult {
		if (adapterAt(value) !== adapter)
			throw new Error('Import recipe adapter no longer matches the source. Choose the data again.')
		return adapter === 'liveuamap'
			? normalizedLiveuamap(value, context)
			: { featureCollection: normalizedGeojson(value), warnings: [] }
	}
	function propertyKeys(features: Feature[]): string[] {
		const keys = [
			...new Set(features.flatMap((feature) => Object.keys(feature.properties ?? {}))),
		].sort()
		if (keys.length > 256) throw new Error('Import has more than 256 property fields.')
		return keys
	}
	function discover(payload: unknown): MapletImportCandidate[] {
		checkInput(payload)
		const candidates: MapletImportCandidate[] = []
		function walk(value: unknown, path: string[]): void {
			const adapter = adapterAt(value)
			if (adapter) {
				if (candidates.length >= maxCandidates)
					throw new Error('Import exceeds the 64 candidate limit.')
				const { featureCollection } = normalize(value, adapter)
				const features = featureCollection.features
				const keys = propertyKeys(features)
				const name = ['name', 'title', 'label'].find(
					(key) =>
						keys.includes(key) &&
						features.every((feature) => typeof feature.properties?.[key] === 'string'),
				)
				const id = ['id', 'fid', 'sourceId'].find(
					(key) =>
						keys.includes(key) &&
						features.every((feature) => validId(feature.properties?.[key])) &&
						new Set(features.map((feature) => String(feature.properties?.[key]))).size ===
							features.length,
				)
				candidates.push({
					path: [...path],
					adapter,
					label: `${path.length ? path.map((key) => `[${JSON.stringify(key)}]`).join('') : '$'} · ${adapter === 'geojson' ? 'GeoJSON' : 'Liveuamap'}`,
					count: features.length,
					propertyKeys: keys,
					...(name ? { suggestedNameProperty: name } : {}),
					...(id ? { suggestedIdProperty: id } : {}),
				})
				return // Do not offer the same collection's nested features/coordinates again.
			}
			if (value && typeof value === 'object') {
				for (const [key, child] of Object.entries(value)) {
					if (child && typeof child === 'object') walk(child, [...path, key])
				}
			}
		}
		walk(payload, [])
		return candidates
	}
	function reserved(key: string): boolean {
		return (
			/^(source|attribution|copyright|license|provenance|mapletSource)/iu.test(key) ||
			key === 'geometryDiagnostic' ||
			key === 'ringInterpretation'
		)
	}
	function apply(
		payload: unknown,
		recipe: MapletImportRecipe,
		context?: MapletImportContext,
	): MapletImportResult {
		checkInput(payload)
		checkInput(recipe)
		if (context !== undefined) {
			checkInput(context)
			if (!record(context) || Object.keys(context).some((key) => key !== 'sourceUrl'))
				throw new Error('Invalid import provenance context.')
			if (context.sourceUrl !== undefined) {
				if (typeof context.sourceUrl !== 'string' || context.sourceUrl.length > 4096)
					throw new Error('Invalid source URL provenance.')
				const url = new URL(context.sourceUrl)
				if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
					throw new Error('Invalid source URL provenance.')
			}
		}
		if (
			!record(recipe) ||
			recipe.version !== 1 ||
			!Array.isArray(recipe.path) ||
			recipe.path.length > maxDepth ||
			recipe.path.some((key) => typeof key !== 'string') ||
			!['geojson', 'liveuamap'].includes(recipe.adapter)
		)
			throw new Error('Unsupported or invalid import recipe.')
		if (
			Object.keys(recipe).some(
				(key) =>
					![
						'version',
						'path',
						'adapter',
						'retainProperties',
						'idProperty',
						'nameProperty',
						'sourceIds',
					].includes(key),
			)
		)
			throw new Error('Import recipe contains unsupported fields.')
		for (const key of [recipe.idProperty, recipe.nameProperty]) {
			if (key !== undefined && (typeof key !== 'string' || !key || key.length > 256))
				throw new Error('Invalid property mapping.')
			if (key !== undefined) assertKey(key)
		}
		if (
			recipe.retainProperties !== undefined &&
			(!Array.isArray(recipe.retainProperties) ||
				recipe.retainProperties.length > 256 ||
				recipe.retainProperties.some(
					(key) => typeof key !== 'string' || !key || key.length > 256,
				) ||
				new Set(recipe.retainProperties).size !== recipe.retainProperties.length)
		)
			throw new Error('Invalid retained property selection.')
		if (
			recipe.sourceIds !== undefined &&
			(!Array.isArray(recipe.sourceIds) ||
				!recipe.sourceIds.length ||
				recipe.sourceIds.length > maxFeatures ||
				recipe.sourceIds.some((id) => typeof id !== 'string' || !validId(id)) ||
				new Set(recipe.sourceIds).size !== recipe.sourceIds.length)
		)
			throw new Error('Invalid source ID selection.')
		const mapped = normalize(atPath(payload, recipe.path), recipe.adapter, context)
		const originalIds = new Set<string>()
		for (const feature of mapped.featureCollection.features) {
			if (feature.id !== undefined) {
				if (originalIds.has(String(feature.id)))
					throw new Error('Duplicate feature IDs in the full source.')
				originalIds.add(String(feature.id))
			}
		}
		const keys = propertyKeys(mapped.featureCollection.features)
		for (const key of recipe.retainProperties ?? []) {
			assertKey(key)
			if (mapped.featureCollection.features.length && !keys.includes(key) && !reserved(key))
				throw new Error(`Import recipe property "${key}" is missing; review the changed source.`)
		}
		const warnings = [...mapped.warnings]
		const sourceIds = recipe.sourceIds
		const selectedFeatures =
			sourceIds === undefined
				? mapped.featureCollection.features
				: mapped.featureCollection.features.filter((feature) =>
						sourceIds.includes(String(feature.properties?.sourceId ?? feature.id)),
					)
		if (recipe.sourceIds !== undefined) {
			if (!selectedFeatures.length)
				throw new Error(
					'Selected source record is missing; review the import recipe before replacing this layer.',
				)
			const present = new Set(
				selectedFeatures.map((feature) => String(feature.properties?.sourceId ?? feature.id)),
			)
			const missing = recipe.sourceIds.filter((id) => !present.has(id))
			if (missing.length)
				warnings.push(
					`${missing.length} selected source record(s) are absent from this input: ${missing.join(', ')}.`,
				)
		}
		let generatedIds = 0
		const ids = new Set<string>()
		const features = selectedFeatures.map((feature) => {
			const original = feature.properties ?? {}
			const properties: Record<string, unknown> = {}
			for (const [key, value] of Object.entries(original)) {
				if (
					recipe.retainProperties === undefined ||
					recipe.retainProperties.includes(key) ||
					reserved(key)
				)
					properties[key] = structuredClone(value)
			}
			if (recipe.nameProperty !== undefined) {
				if (typeof original[recipe.nameProperty] !== 'string')
					throw new Error('Name mapping is missing or not text in a source record.')
				properties.name = original[recipe.nameProperty]
			}
			let id: unknown = feature.id
			if (recipe.idProperty !== undefined) {
				id = original[recipe.idProperty]
				if (!validId(id)) throw new Error('ID mapping is missing or invalid in a source record.')
			} else if (id === undefined) {
				id = contentId({ geometry: feature.geometry, properties: original })
				generatedIds++
			}
			if (!validId(id)) throw new Error('Invalid feature ID.')
			if (ids.has(String(id)))
				throw new Error('Duplicate feature IDs: select a unique source ID mapping.')
			ids.add(String(id))
			if (byteLength(JSON.stringify(properties)) > maxPropertyBytes)
				throw new Error('Feature properties exceed the 16 KiB limit.')
			return { ...feature, id, properties }
		})
		if (generatedIds)
			warnings.push(
				`${generatedIds} feature(s) have no source ID. Deterministic content IDs were generated; IDs change when geometry or source properties change. Choose an ID field for updates.`,
			)
		const featureCollection: FeatureCollection = { type: 'FeatureCollection', features }
		if (byteLength(JSON.stringify(featureCollection)) > maxBytes)
			throw new Error('Import output exceeds the 5 MiB limit.')
		return {
			featureCollection: validateCollection
				? validateCollection(featureCollection)
				: featureCollection,
			warnings,
		}
	}
	return { parse, discover, apply }
}
