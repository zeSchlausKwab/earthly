import {
	parseNostrAddressReference,
	stringifyNostrAddressReference,
	type NostrAddressReference,
} from '@/lib/nostr/references'

export type OsmElementType = 'node' | 'way' | 'relation'

export type GeoReference =
	| ({ kind: 'nostr' } & NostrAddressReference)
	| { kind: 'coordinate'; latitude: number; longitude: number }
	| { kind: 'osm'; elementType: OsmElementType; id: string }

export interface GeoReferenceMatch {
	reference: GeoReference
	raw: string
	start: number
	end: number
}

const COORDINATE_PATTERN = /^geo:([+-]?(?:\d+(?:\.\d+)?|\.\d+)),([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/i
const OSM_PATTERN = /^https?:\/\/(?:www\.)?openstreetmap\.org\/(node|way|relation)\/(\d+)\/?$/i

// Kept intentionally conservative: every canonical serializer emits one of
// these shapes, and boundaries remain predictable inside Markdown prose.
const INLINE_REFERENCE_PATTERN =
	/nostr:naddr1[a-z0-9]+(?:#[a-zA-Z0-9_%~-]+)?|geo:[+-]?(?:\d+(?:\.\d+)?|\.\d+),[+-]?(?:\d+(?:\.\d+)?|\.\d+)|https?:\/\/(?:www\.)?openstreetmap\.org\/(?:node|way|relation)\/\d+\/?/gi

function normalizedNumber(value: number): number {
	return Object.is(value, -0) ? 0 : value
}

function formatCoordinate(value: number): string {
	return normalizedNumber(value).toFixed(6).replace(/\.?0+$/, '')
}

export function parseGeoReference(value: string | null | undefined): GeoReference | null {
	if (!value) return null
	const trimmed = value.trim()
	const nostr = parseNostrAddressReference(trimmed)
	if (nostr) return { kind: 'nostr', ...nostr }

	const coordinate = trimmed.match(COORDINATE_PATTERN)
	if (coordinate?.[1] && coordinate[2]) {
		const latitude = Number(coordinate[1])
		const longitude = Number(coordinate[2])
		if (
			Number.isFinite(latitude) &&
			Number.isFinite(longitude) &&
			latitude >= -90 &&
			latitude <= 90 &&
			longitude >= -180 &&
			longitude <= 180
		) {
			return {
				kind: 'coordinate',
				latitude: normalizedNumber(latitude),
				longitude: normalizedNumber(longitude),
			}
		}
		return null
	}

	const osm = trimmed.match(OSM_PATTERN)
	if (osm?.[1] && osm[2]) {
		return { kind: 'osm', elementType: osm[1].toLowerCase() as OsmElementType, id: osm[2] }
	}
	return null
}

export function stringifyGeoReference(reference: GeoReference): string {
	if (reference.kind === 'nostr') return stringifyNostrAddressReference(reference)
	if (reference.kind === 'coordinate') {
		if (
			!Number.isFinite(reference.latitude) ||
			!Number.isFinite(reference.longitude) ||
			reference.latitude < -90 ||
			reference.latitude > 90 ||
			reference.longitude < -180 ||
			reference.longitude > 180
		) {
			throw new Error('Coordinate reference is outside valid latitude/longitude bounds.')
		}
		// RFC 5870 uses latitude,longitude order. GeoJSON uses the reverse.
		return `geo:${formatCoordinate(reference.latitude)},${formatCoordinate(reference.longitude)}`
	}
	return `https://www.openstreetmap.org/${reference.elementType}/${reference.id}`
}

export function extractGeoReferences(text: string | null | undefined): GeoReferenceMatch[] {
	if (!text) return []
	const matches: GeoReferenceMatch[] = []
	for (const match of text.matchAll(INLINE_REFERENCE_PATTERN)) {
		const raw = match[0]
		const start = match.index
		if (!raw || start === undefined) continue
		const reference = parseGeoReference(raw)
		if (!reference) continue
		matches.push({ reference, raw, start, end: start + raw.length })
	}
	return matches
}

export function geoReferenceLabel(reference: GeoReference): string {
	if (reference.kind === 'nostr') {
		return reference.featureId ? `Feature: ${reference.featureId}` : 'Dataset'
	}
	if (reference.kind === 'osm') return `OSM ${reference.elementType} ${reference.id}`
	return `${formatCoordinate(reference.latitude)}, ${formatCoordinate(reference.longitude)}`
}
