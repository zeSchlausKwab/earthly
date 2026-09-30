import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'

export interface KmlImport {
	name: string
	payload: { layers: Record<string, FeatureCollection> }
	warnings: string[]
}

/** Self-contained and serialized into the iframe. XML is data, never inserted into the UI. */
export function parseMapletKml(text: string, sourceUrl = ''): KmlImport {
	if (new TextEncoder().encode(text).length > 5 * 1024 * 1024)
		throw new Error('Choose a KML file smaller than 5 MiB. Export one layer if needed.')
	if (/<!DOCTYPE|<!ENTITY/i.test(text))
		throw new Error('KML document types and entities are not supported.')
	const doc = new DOMParser().parseFromString(text, 'application/xml')
	if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'kml')
		throw new Error('This is not valid KML. Export KML rather than a web page or compressed KMZ.')
	const children = (node: Element, tag: string) =>
		Array.from(node.children).filter((child) => child.localName === tag)
	const child = (node: Element, tag: string) => children(node, tag)[0]
	const value = (node: Element, tag: string) => child(node, tag)?.textContent?.trim() ?? ''
	const all = Array.from(doc.querySelectorAll('*'))
	if (all.length > 100_000) throw new Error('KML has too many XML elements.')
	const warnings: string[] = []
	const unsupported = [
		'NetworkLink',
		'GroundOverlay',
		'PhotoOverlay',
		'ScreenOverlay',
		'Model',
		'Track',
		'MultiTrack',
	]
	for (const tag of unsupported) {
		const count = all.filter((node) => node.localName === tag).length
		if (count)
			warnings.push(
				`${count} ${tag} element(s) were not imported. External links and assets are not fetched.`,
			)
	}
	const document = child(doc.documentElement, 'Document') ?? doc.documentElement
	const name = value(document, 'name') || 'Imported KML'
	const styles = new Map(
		all
			.filter((node) => ['Style', 'StyleMap'].includes(node.localName) && node.hasAttribute('id'))
			.map((node) => [node.getAttribute('id') ?? '', node]),
	)
	const layers: Record<string, FeatureCollection> = Object.create(null)
	let positions = 0
	let featureCount = 0
	let altitude = false
	function coords(node: Element): Position[] {
		const raw = value(node, 'coordinates')
		if (!raw) throw new Error('KML geometry is missing coordinates.')
		return raw.split(/\s+/).map((tuple) => {
			if (++positions > 50_000)
				throw new Error('KML exceeds 50,000 coordinates. Export one layer instead.')
			const parts = tuple.split(',')
			const numbers = parts.map(Number)
			const [longitude, latitude] = numbers
			if (
				longitude === undefined ||
				latitude === undefined ||
				parts.length < 2 ||
				parts.length > 3 ||
				parts.some((part) => !part.trim()) ||
				numbers.some((number) => !Number.isFinite(number)) ||
				Math.abs(longitude) > 180 ||
				Math.abs(latitude) > 90
			)
				throw new Error('KML contains an invalid longitude/latitude coordinate.')
			if (numbers.length === 3 && numbers[2] !== 0) altitude = true
			return numbers
		})
	}
	function ring(node: Element): Position[] {
		const linear = child(node, 'LinearRing')
		if (!linear) throw new Error('KML polygon is missing a ring.')
		const points = coords(linear)
		const first = points[0]
		if (!first || points.length < 3) throw new Error('KML polygon has too few coordinates.')
		if (JSON.stringify(first) !== JSON.stringify(points.at(-1))) points.push([...first])
		if (points.length < 4) throw new Error('KML polygon has too few coordinates.')
		return points
	}
	function geometries(node: Element, depth = 0): Geometry[] {
		if (depth > 8) throw new Error('KML geometry nesting is too deep.')
		const result: Geometry[] = []
		for (const element of Array.from(node.children)) {
			switch (element.localName) {
				case 'Point': {
					const coordinates = coords(element)
					const first = coordinates[0]
					if (!first || coordinates.length !== 1)
						throw new Error('KML point needs exactly one coordinate.')
					result.push({ type: 'Point', coordinates: first })
					break
				}
				case 'LineString': {
					const coordinates = coords(element)
					if (coordinates.length < 2) throw new Error('KML line needs two coordinates.')
					result.push({ type: 'LineString', coordinates })
					break
				}
				case 'Polygon': {
					const outer = child(element, 'outerBoundaryIs')
					if (!outer) throw new Error('KML polygon is missing its outer boundary.')
					result.push({
						type: 'Polygon',
						coordinates: [ring(outer), ...children(element, 'innerBoundaryIs').map(ring)],
					})
					break
				}
				case 'MultiGeometry':
					result.push(...geometries(element, depth + 1))
					break
			}
		}
		return result
	}
	function style(
		element: Element | undefined,
		seen = new Set<Element>(),
	): Record<string, string | number> {
		if (!element || seen.has(element)) return {}
		seen.add(element)
		if (seen.size > 16) throw new Error('KML style references are too deep.')
		if (element.localName === 'StyleMap') {
			const pair = children(element, 'Pair').find((item) => value(item, 'key') === 'normal')
			const ref = pair ? value(pair, 'styleUrl') : ''
			return style(ref.startsWith('#') ? styles.get(ref.slice(1)) : undefined, seen)
		}
		const props: Record<string, string | number> = {}
		for (const [tag, colorKey, opacityKey] of [
			['PolyStyle', 'fillColor', 'fillOpacity'],
			['LineStyle', 'strokeColor', 'strokeOpacity'],
			['IconStyle', 'fillColor', 'fillOpacity'],
		] as const) {
			const entry = child(element, tag)
			if (!entry) continue
			const color = value(entry, 'color')
			if (/^[\da-f]{8}$/i.test(color)) {
				props[colorKey] = `#${color.slice(6, 8)}${color.slice(4, 6)}${color.slice(2, 4)}`
				props[opacityKey] = Number.parseInt(color.slice(0, 2), 16) / 255
			}
			if (tag === 'PolyStyle' && value(entry, 'fill') === '0') props.fillOpacity = 0
			if (tag === 'PolyStyle' && value(entry, 'outline') === '0') props.strokeOpacity = 0
			if (tag === 'LineStyle' && value(entry, 'width')) {
				const width = Number(value(entry, 'width'))
				if (Number.isFinite(width)) props.strokeWidth = Math.max(0, Math.min(20, width))
			}
		}
		return props
	}
	function plain(input: string): string {
		return input
			.replace(/<br\s*\/?\s*>/gi, '\n')
			.replace(/<[^>]*>/g, '')
			.slice(0, 8_000)
	}
	function walk(node: Element, folder: string[], depth = 0): void {
		if (depth > 16) throw new Error('KML folder nesting is too deep.')
		for (const element of Array.from(node.children)) {
			if (element.localName === 'Document') walk(element, folder, depth + 1)
			else if (element.localName === 'Folder')
				walk(element, [...folder, value(element, 'name') || 'Untitled layer'], depth + 1)
			else if (element.localName === 'Placemark') {
				if (++featureCount > 5_000) throw new Error('KML exceeds 5,000 placemarks.')
				const parts = geometries(element)
				const first = parts[0]
				if (!first) {
					warnings.push(
						`Skipped placemark without supported geometry: ${value(element, 'name') || featureCount}.`,
					)
					continue
				}
				const geometry: Geometry =
					parts.length === 1
						? first
						: parts.every((part) => part.type === 'Polygon')
							? {
									type: 'MultiPolygon',
									coordinates: parts.map(
										(part) => (part as Extract<Geometry, { type: 'Polygon' }>).coordinates,
									),
								}
							: { type: 'GeometryCollection', geometries: parts }
				const layer = folder.join(' / ') || 'Ungrouped'
				const ref = value(element, 'styleUrl')
				const properties: Record<string, unknown> = {
					...style(ref.startsWith('#') ? styles.get(ref.slice(1)) : undefined),
					...style(child(element, 'Style')),
					name: value(element, 'name') || 'Unnamed feature',
					description: plain(value(element, 'description')),
					sourceFormat: 'kml',
					sourceMap: name,
					sourceLayer: layer,
					...(sourceUrl ? { sourceUrl } : {}),
				}
				const extended = child(element, 'ExtendedData')
				if (extended) {
					const data: Record<string, string> = Object.create(null)
					for (const entry of Array.from(extended.querySelectorAll('*'))) {
						const key = entry.getAttribute('name')
						if (!key || !['Data', 'SimpleData'].includes(entry.localName)) continue
						if (['__proto__', 'constructor', 'prototype'].includes(key))
							throw new Error('Unsafe KML property name.')
						data[key] = plain(
							entry.localName === 'Data' ? value(entry, 'value') : (entry.textContent ?? ''),
						)
					}
					properties.kmlData = data
				}
				const id = element.getAttribute('id')
				const feature: Feature = {
					type: 'Feature',
					...(id ? { id: `kml:${JSON.stringify(folder)}:${id}` } : {}),
					geometry,
					properties,
				}
				// Prefixing the label also keeps arbitrary folder names out of special JSON keys.
				const key = `Layer: ${layer}`
				layers[key] ??= { type: 'FeatureCollection', features: [] }
				layers[key].features.push(feature)
			}
		}
	}
	walk(doc.documentElement, [])
	if (!Object.keys(layers).length)
		throw new Error(
			'KML contains no supported geometry. Export the actual data rather than a network link.',
		)
	if (altitude)
		warnings.push(
			'Altitude coordinates are retained; KML altitude modes and extrusion are not rendered.',
		)
	warnings.push(
		'KML snapshot: fetch time does not establish when the map author last updated it. Icons and labels use Earthly styling.',
	)
	return { name, payload: { layers }, warnings }
}
