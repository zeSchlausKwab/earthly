import {
	bboxContains,
	bboxIntersects,
	cloneEntry,
	prepareQuery,
	radiusBbox,
	type GeoCatalogAdapter,
} from './internal'
import {
	GeoCatalogError,
	type GeoCatalog,
	type GeoCatalogBbox,
	type GeoCatalogKind,
	type GeoCatalogQueryCoverage,
	type GeoCatalogQueryDiagnostics,
	type GeoCatalogQueryResult,
	type GeoCatalogSnapshotMetadata,
} from './types'

const GENERIC_GEOGRAPHY_SUFFIXES = new Set([
	'city',
	'county',
	'district',
	'municipality',
	'province',
	'region',
	'town',
	'village',
])

const GENERIC_SUFFIX_KIND_HINTS: Readonly<Partial<Record<string, GeoCatalogKind>>> = {
	city: 'locality',
	county: 'admin',
	district: 'admin',
	municipality: 'admin',
	province: 'admin',
	region: 'admin',
	town: 'locality',
	village: 'locality',
}

function relaxGenericTextSuffix(
	request: ReturnType<typeof prepareQuery>,
): { request: ReturnType<typeof prepareQuery>; diagnostic: NonNullable<GeoCatalogQueryDiagnostics['textRelaxation']> } | null {
	if (request.text === null || request.textTokens.length < 2) return null
	const suffix = request.textTokens.at(-1)
	if (!suffix || !GENERIC_GEOGRAPHY_SUFFIXES.has(suffix)) return null
	const textTokens = request.textTokens.slice(0, -1)
	const effectiveText = textTokens.join(' ')
	const hintedKind = GENERIC_SUFFIX_KIND_HINTS[suffix]
	return {
		request: {
			...request,
			text: effectiveText,
			textTokens,
			...(request.kinds.length === 0 && hintedKind ? { kinds: [hintedKind] } : {}),
		},
		diagnostic: {
			status: 'applied',
			strategy: 'generic_suffix',
			removedTokens: [suffix],
			effectiveText,
		},
	}
}

function diagnoseCategoryFilter(
	adapter: GeoCatalogAdapter,
	request: ReturnType<typeof prepareQuery>,
): Pick<GeoCatalogQueryDiagnostics, 'categorySuggestions' | 'nearMatches'> | null {
	if (request.text === null || request.categories.length === 0) return null
	const diagnosticResult = adapter.query({
		...request,
		categories: [],
		limit: Math.min(request.limit, 5),
	})
	if (diagnosticResult.entries.length === 0) return null

	const requestedCategories = new Set(request.categories)
	const counts = new Map<string, number>()
	for (const entry of diagnosticResult.entries) {
		for (const category of entry.categories) {
			if (requestedCategories.has(category)) continue
			counts.set(category, (counts.get(category) ?? 0) + 1)
		}
	}
	const categorySuggestions = [...counts]
		.sort(([leftCategory, leftCount], [rightCategory, rightCount]) =>
			rightCount !== leftCount
				? rightCount - leftCount
				: leftCategory.localeCompare(rightCategory, 'en-US'),
		)
		.slice(0, 8)
		.map(([category]) => category)

	return {
		...(categorySuggestions.length > 0 ? { categorySuggestions } : {}),
		nearMatches: diagnosticResult.entries.map((entry) => ({
			id: entry.id,
			name: entry.name,
			kind: entry.kind,
			categories: [...entry.categories],
			...(request.includeGeometry && entry.geometry
				? { geometry: structuredClone(entry.geometry) }
				: {}),
		})),
	}
}

function cloneSnapshot(
	snapshot: GeoCatalogSnapshotMetadata,
	includeDocumentContent: boolean,
): GeoCatalogSnapshotMetadata {
	return {
		id: snapshot.id,
		createdAt: snapshot.createdAt,
		schemaVersion: 1,
		...(snapshot.coverage
			? {
					coverage: {
						spatial:
							snapshot.coverage.spatial.scope === 'global'
								? { scope: 'global' as const }
								: {
										scope: 'bbox' as const,
										bbox: [...snapshot.coverage.spatial.bbox] as GeoCatalogBbox,
									},
						kinds: [...snapshot.coverage.kinds],
					},
				}
			: {}),
		sources: snapshot.sources.map((source) => ({
			...source,
			...(source.documents
				? {
						documents: source.documents.map(({ content, ...document }) => ({
							...document,
							...(includeDocumentContent && content !== undefined ? { content } : {}),
						})),
					}
				: {}),
		})),
	}
}

function requestedSpatialBboxes(
	request: ReturnType<typeof prepareQuery>,
): GeoCatalogBbox[] {
	const bboxes: GeoCatalogBbox[] = []
	if (request.bbox) bboxes.push(request.bbox)
	if (request.near && request.radiusMeters !== null) {
		bboxes.push(
			radiusBbox(
				request.near.longitude,
				request.near.latitude,
				request.radiusMeters,
			),
		)
	}
	return bboxes
}

function queryCoverage(
	snapshot: GeoCatalogSnapshotMetadata,
	request: ReturnType<typeof prepareQuery>,
	returned: number,
): GeoCatalogQueryCoverage {
	const declared = snapshot.coverage
	const requestedBboxes = requestedSpatialBboxes(request)
	let spatial: GeoCatalogQueryCoverage['spatial']
	if (!declared) {
		spatial = { status: 'unknown' }
	} else if (declared.spatial.scope === 'global') {
		spatial = {
			status: 'global',
			...(requestedBboxes.length === 1 ? { queryBbox: requestedBboxes[0] } : {}),
		}
	} else if (requestedBboxes.length === 0) {
		spatial = {
			status: 'unscoped',
			snapshotBbox: [...declared.spatial.bbox],
		}
	} else {
		const snapshotBbox = declared.spatial.bbox
		const statuses = requestedBboxes.map((bbox) =>
			bboxContains(snapshotBbox, bbox)
				? 'inside'
				: bboxIntersects(snapshotBbox, bbox)
					? 'partial'
					: 'outside',
		)
		// Spatial filters are conjunctive. If any requested footprint is wholly
		// outside the installed snapshot, their intersection cannot be served by
		// that snapshot even when another constraint is inside it.
		const status = statuses.includes('outside')
			? 'outside'
			: statuses.every((candidate) => candidate === 'inside')
				? 'inside'
				: 'partial'
		spatial = {
			status,
			snapshotBbox: [...snapshotBbox],
			...(requestedBboxes.length === 1 ? { queryBbox: requestedBboxes[0] } : {}),
		}
	}

	let kinds: GeoCatalogQueryCoverage['kinds']
	if (!declared) {
		kinds = { status: 'unknown', available: [], missing: [] }
	} else if (request.kinds.length === 0) {
		kinds = {
			status: 'unscoped',
			available: [...declared.kinds],
			missing: [],
		}
	} else {
		const available = request.kinds.filter((kind) => declared.kinds.includes(kind))
		const missing = request.kinds.filter((kind) => !declared.kinds.includes(kind))
		kinds = {
			status:
				missing.length === 0
					? 'available'
					: available.length === 0
						? 'unavailable'
						: 'partial',
			available,
			missing,
		}
	}

	if (returned > 0) return { spatial, kinds }
	const outside = spatial.status === 'outside'
	const kindUnavailable = kinds.status === 'unavailable'
	const zeroResultReason =
		outside && kindUnavailable
			? 'outside_snapshot_and_kind_unavailable'
			: outside
				? 'outside_snapshot'
				: kindUnavailable
					? 'kind_unavailable'
					: spatial.status === 'unscoped'
						? 'query_location_unscoped'
					: spatial.status === 'unknown' || kinds.status === 'unknown'
							? 'coverage_unknown'
							: 'no_match_within_snapshot'
	return { spatial, kinds, zeroResultReason }
}

/**
 * Keeps request validation, geometry redaction, metadata, and error semantics
 * identical regardless of which storage adapter backs the Module.
 */
export function createGeoCatalog(adapter: GeoCatalogAdapter): GeoCatalog {
	return {
		async query(request): Promise<GeoCatalogQueryResult> {
			try {
				const prepared = prepareQuery(request)
				let result = adapter.query(prepared)
				let diagnostics: GeoCatalogQueryDiagnostics | undefined
				// Relaxation is a discovery aid only. Geometry-bearing calls may feed
				// the editor, so they must use an exact query or stable ids selected
				// from an earlier, explicitly diagnosed discovery result.
				if (result.entries.length === 0 && !prepared.includeGeometry) {
					const relaxed = relaxGenericTextSuffix(prepared)
					if (relaxed) {
						const relaxedResult = adapter.query(relaxed.request)
						if (relaxedResult.entries.length > 0) {
							result = relaxedResult
							diagnostics = { textRelaxation: relaxed.diagnostic }
						}
					}
				}
				if (result.entries.length === 0) {
					const categoryDiagnostics = diagnoseCategoryFilter(adapter, prepared)
					if (categoryDiagnostics) {
						diagnostics = { ...diagnostics, ...categoryDiagnostics }
					}
				}
				return {
					items: result.entries.map((entry) =>
						cloneEntry(entry, prepared.includeGeometry),
					),
					metadata: {
						snapshot: cloneSnapshot(adapter.snapshot, prepared.includeGeometry),
						coverage: queryCoverage(adapter.snapshot, prepared, result.entries.length),
						query: {
							returned: result.entries.length,
							limit: prepared.limit,
							hasMore: result.hasMore,
							...(diagnostics ? { diagnostics } : {}),
						},
					},
				}
			} catch (error) {
				if (error instanceof GeoCatalogError) throw error
				throw new GeoCatalogError('query_failed', 'GeoCatalog query failed', { cause: error })
			}
		},
	}
}
