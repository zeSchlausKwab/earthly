import {
	bboxContains,
	bboxIntersects,
	cloneEntry,
	normalizeSearchText,
	prepareQuery,
	radiusBbox,
	type AdapterQueryResult,
	type GeoCatalogAdapter,
	type PreparedGeoCatalogQuery,
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
	type GeoCatalogTextRecoveryStep,
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

const TYPED_GEOGRAPHY_SUFFIX_KIND_HINTS: Readonly<Record<string, GeoCatalogKind>> = {
	canal: 'waterway',
	highway: 'road',
	railway: 'rail',
	river: 'waterway',
	road: 'road',
	stream: 'waterway',
}

const MAX_GEOGRAPHIC_QUALIFIER_TOKENS = 4

function relaxGenericTextSuffix(
	request: PreparedGeoCatalogQuery,
): { request: PreparedGeoCatalogQuery; removedText: string } | null {
	if (request.text === null || request.textTokens.length < 2) return null
	const suffix = request.textTokens.at(-1)
	if (!suffix) return null
	const genericKindHint = GENERIC_SUFFIX_KIND_HINTS[suffix]
	const typedKindHint = TYPED_GEOGRAPHY_SUFFIX_KIND_HINTS[suffix]
	if (!GENERIC_GEOGRAPHY_SUFFIXES.has(suffix) && !typedKindHint) return null
	if (
		typedKindHint &&
		request.kinds.length > 0 &&
		!request.kinds.includes(typedKindHint)
	) {
		return null
	}
	const textTokens = request.textTokens.slice(0, -1)
	const effectiveText = textTokens.join(' ')
	const hintedKind = genericKindHint ?? typedKindHint
	return {
		request: {
			...request,
			text: effectiveText,
			textTokens,
			...(request.kinds.length === 0 && hintedKind ? { kinds: [hintedKind] } : {}),
		},
		removedText: suffix,
	}
}

interface RecoveryState {
	request: PreparedGeoCatalogQuery
	steps: GeoCatalogTextRecoveryStep[]
	appliedCountryCode?: string
	appliedBbox?: GeoCatalogBbox
}

interface GeographicQualifierRecovery {
	preferred: RecoveryState
	spatialFallback?: RecoveryState
}

interface RecoveredQuery {
	result: AdapterQueryResult
	state: RecoveryState
}

function requestWithText(
	request: PreparedGeoCatalogQuery,
	textTokens: string[],
): PreparedGeoCatalogQuery {
	return {
		...request,
		text: textTokens.join(' '),
		textTokens,
	}
}

function isExactTextMatch(entry: { name: string; aliases: string[] }, text: string): boolean {
	return (
		normalizeSearchText(entry.name) === text ||
		entry.aliases.some((alias) => normalizeSearchText(alias) === text)
	)
}

/**
 * Recovery never accepts prefix-only FTS hits. This guard is what makes it
 * safe to loosen human discovery text while keeping stable-id authoring exact.
 */
function queryExactRecovery(
	adapter: GeoCatalogAdapter,
	state: RecoveryState,
): RecoveredQuery | null {
	if (state.request.text === null) return null
	const effectiveText = state.request.text
	const result = adapter.query(state.request)
	const entries = result.entries.filter(
		(entry) =>
			isExactTextMatch(entry, effectiveText) &&
			(!state.appliedBbox || bboxIntersects(entry.bbox, state.appliedBbox)),
	)
	if (entries.length === 0) return null
	return {
		state,
		result: {
			entries,
			// Filtering a returned page cannot prove that the adapter's unseen page
			// contains no further exact/spatial matches. Preserve truncation so a
			// caller never mistakes a partial recovery result for a complete set.
			hasMore: result.hasMore,
		},
	}
}

function geographicQualifierRequest(
	request: PreparedGeoCatalogQuery,
	textTokens: string[],
): PreparedGeoCatalogQuery {
	return {
		...requestWithText(request, textTokens),
		ids: [],
		kinds: ['admin'],
		categories: [],
		adminLevels: [],
		countryCode: null,
		bbox: null,
		near: null,
		radiusMeters: null,
		limit: Math.max(100, request.limit),
		includeGeometry: false,
	}
}

function intersectBboxes(
	left: GeoCatalogBbox | null,
	right: GeoCatalogBbox,
): GeoCatalogBbox | null {
	if (left === null) return [...right]
	const intersection: GeoCatalogBbox = [
		Math.max(left[0], right[0]),
		Math.max(left[1], right[1]),
		Math.min(left[2], right[2]),
		Math.min(left[3], right[3]),
	]
	return intersection[0] <= intersection[2] && intersection[1] <= intersection[3]
		? intersection
		: null
}

/**
 * Resolve a trailing qualifier from the installed catalog itself instead of
	 * maintaining a brittle country-name table. Country qualifiers may narrow by
	 * ISO code alone only when one exact level-zero boundary matches. Every other
	 * administrative qualifier must name one exact boundary and carries both its
	 * country code and bbox into the recovered lookup.
 */
function inferTrailingGeographicQualifier(
	adapter: GeoCatalogAdapter,
	request: PreparedGeoCatalogQuery,
): GeographicQualifierRecovery | null {
	if (request.text === null || request.textTokens.length < 2) return null

	const firstQualifierStart = Math.max(
		1,
		request.textTokens.length - MAX_GEOGRAPHIC_QUALIFIER_TOKENS,
	)
	for (let start = firstQualifierStart; start < request.textTokens.length; start += 1) {
		const qualifierTokens = request.textTokens.slice(start)
		const qualifierText = qualifierTokens.join(' ')
		const qualifierResult = adapter.query(
			geographicQualifierRequest(request, qualifierTokens),
		)
		const exactBoundaries = qualifierResult.entries.filter(
			(entry) =>
				entry.categories.includes('administrative-boundary') &&
				isExactTextMatch(entry, qualifierText),
		)
		// Prefix-backed adapters cannot prove uniqueness when the qualifier query
		// was truncated. Fail closed instead of selecting whichever boundary was
		// ranked first. Same-country duplicate region names are equally ambiguous.
		if (qualifierResult.hasMore || exactBoundaries.length !== 1) continue
		const [qualifierBoundary] = exactBoundaries
		const inferredCountryCode = qualifierBoundary?.countryCode
		if (!inferredCountryCode) continue
		if (request.countryCode !== null && request.countryCode !== inferredCountryCode) {
			continue
		}
		const appliedBbox = intersectBboxes(request.bbox, qualifierBoundary.bbox)
		if (appliedBbox === null) continue
		const countryQualifier = qualifierBoundary.adminLevel === 0

		const textRequest = requestWithText(request, request.textTokens.slice(0, start))
		const steps: GeoCatalogTextRecoveryStep[] = [
			{
				strategy: 'trailing_geographic_qualifier',
				removedText: qualifierText,
				inferredCountryCode,
			},
		]
		const preferred: RecoveryState = {
			request: {
				...textRequest,
				countryCode: request.countryCode ?? inferredCountryCode,
				// Keep only the caller's bbox in SQL. The exact qualifier boundary is
				// enforced below over the small exact-name result set; broad inferred
				// bboxes otherwise make SQLite choose an expensive RTree plan.
				bbox: request.bbox,
			},
			steps,
			appliedCountryCode: request.countryCode ?? inferredCountryCode,
			...(!countryQualifier ? { appliedBbox } : {}),
		}

		// Some Overture base and derived corridor records do not carry a country
		// code. If the user did not supply an explicit code, retain geographic
		// safety with the exact qualifier boundary instead of dropping the
		// qualifier and searching the whole snapshot.
		let spatialFallback: RecoveryState | undefined
		if (request.countryCode === null) {
			spatialFallback = {
				request: {
					...textRequest,
					countryCode: null,
					bbox: request.bbox,
				},
				steps,
				appliedBbox,
			}
		}

		return { preferred, ...(spatialFallback ? { spatialFallback } : {}) }
	}
	return null
}

function withGenericSuffixRecovery(state: RecoveryState): RecoveryState | null {
	const relaxed = relaxGenericTextSuffix(state.request)
	if (!relaxed) return null
	return {
		request: relaxed.request,
		steps: [
			...state.steps,
			{ strategy: 'generic_suffix', removedText: relaxed.removedText },
		],
		...(state.appliedCountryCode
			? { appliedCountryCode: state.appliedCountryCode }
			: {}),
		...(state.appliedBbox ? { appliedBbox: state.appliedBbox } : {}),
	}
}

function textVariantStates(
	state: RecoveryState,
	strategy: 'spacing_variant' | 'single_character_deletion',
): RecoveryState[] {
	const MAX_VARIANT_CANDIDATES = 12
	if (
		state.request.text === null ||
		state.request.text.length > 64 ||
		state.request.textTokens.length > 4
	) {
		return []
	}
	const variants = new Map<string, RecoveryState>()
	const tokens = state.request.textTokens
	const add = (
		nextTokens: string[],
		step: GeoCatalogTextRecoveryStep,
	): void => {
		if (variants.size >= MAX_VARIANT_CANDIDATES) return
		const effectiveText = nextTokens.join(' ')
		if (effectiveText === state.request.text || variants.has(effectiveText)) return
		variants.set(effectiveText, {
			request: requestWithText(state.request, nextTokens),
			steps: [...state.steps, step],
			...(state.appliedCountryCode
				? { appliedCountryCode: state.appliedCountryCode }
				: {}),
			...(state.appliedBbox ? { appliedBbox: state.appliedBbox } : {}),
		})
	}

	for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
		const token = tokens[tokenIndex]
		if (!token) continue

		// A collapsed two-word name is recoverable without guessing any letters.
		// Both resulting words must remain meaningful, which avoids noisy splits.
		if (
			strategy === 'spacing_variant' &&
			token.length >= 8 &&
			token.length <= 24
		) {
			for (
				let split = 3;
				split <= token.length - 3 && variants.size < MAX_VARIANT_CANDIDATES;
				split += 1
			) {
				const replacement = `${token.slice(0, split)} ${token.slice(split)}`
				add(
					[
						...tokens.slice(0, tokenIndex),
						token.slice(0, split),
						token.slice(split),
						...tokens.slice(tokenIndex + 1),
					],
					{ strategy: 'spacing_variant', from: token, to: replacement },
				)
			}
		}

		// Limit typo tolerance to deleting one internal character from a word of
		// at least five letters. Successful candidates must still exactly match a
		// catalog name/alias, and ambiguity is rejected below.
		if (
			strategy === 'single_character_deletion' &&
			token.length >= 5 &&
			token.length <= 16
		) {
			for (
				let index = 1;
				index < token.length - 1 && variants.size < MAX_VARIANT_CANDIDATES;
				index += 1
			) {
				const replacement = `${token.slice(0, index)}${token.slice(index + 1)}`
				add(
					[
						...tokens.slice(0, tokenIndex),
						replacement,
						...tokens.slice(tokenIndex + 1),
					],
					{
						strategy: 'single_character_deletion',
						from: token,
						to: replacement,
					},
				)
			}
		}
	}
	return [...variants.values()]
}

/** Return a correction only when exactly one candidate spelling matches. */
function recoverTextVariant(
	adapter: GeoCatalogAdapter,
	state: RecoveryState,
): RecoveredQuery | null {
	for (const strategy of [
		'spacing_variant',
		'single_character_deletion',
	] as const) {
		const recovered = textVariantStates(state, strategy)
			.map((variant) => queryExactRecovery(adapter, variant))
			.filter((candidate): candidate is RecoveredQuery => candidate !== null)
		if (recovered.length > 1) return null
		if (recovered.length === 1) return recovered[0] ?? null
	}
	return null
}

function recoverState(
	adapter: GeoCatalogAdapter,
	state: RecoveryState,
	includeVariants = true,
): RecoveredQuery | null {
	const direct = queryExactRecovery(adapter, state)
	if (direct) return direct
	const generic = withGenericSuffixRecovery(state)
	if (generic) {
		const genericResult = queryExactRecovery(adapter, generic)
		if (genericResult) return genericResult
		if (includeVariants) {
			const genericVariant = recoverTextVariant(adapter, generic)
			if (genericVariant) return genericVariant
		}
	}
	return includeVariants ? recoverTextVariant(adapter, state) : null
}

function recoveryDiagnostic(
	state: RecoveryState,
): NonNullable<GeoCatalogQueryDiagnostics['textRecovery']> {
	return {
		status: 'applied',
		steps: state.steps,
		effectiveText: state.request.text ?? '',
		...(state.appliedCountryCode
			? { appliedCountryCode: state.appliedCountryCode }
			: {}),
		...(state.appliedBbox ? { appliedBbox: state.appliedBbox } : {}),
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
				// Recovery is a discovery aid only. Geometry-bearing calls may feed
				// the editor, and stable-id calls are continuations of an earlier exact
				// choice, so neither is allowed to loosen human-readable text.
				if (
					result.entries.length === 0 &&
					!prepared.includeGeometry &&
					prepared.ids.length === 0 &&
					prepared.text !== null
				) {
					const initialState: RecoveryState = { request: prepared, steps: [] }
					const qualifiedRecovery = inferTrailingGeographicQualifier(adapter, prepared)
					let recovered: RecoveredQuery | null = null

					if (qualifiedRecovery) {
						recovered = recoverState(adapter, qualifiedRecovery.preferred, false)
						if (!recovered && qualifiedRecovery.spatialFallback) {
							recovered = recoverState(adapter, qualifiedRecovery.spatialFallback, false)
						}
						if (!recovered) {
							recovered = recoverState(
								adapter,
								qualifiedRecovery.spatialFallback ?? qualifiedRecovery.preferred,
							)
						}
					}

					const genericState = withGenericSuffixRecovery(initialState)
					if (!recovered && genericState) {
						recovered = queryExactRecovery(adapter, genericState)
						if (recovered) {
							// Keep the existing compact diagnostic for the original one-step
							// suffix behavior. Multi-step and spelling recovery use textRecovery.
							diagnostics = {
								textRelaxation: {
									status: 'applied',
									strategy: 'generic_suffix',
									removedTokens: [
										genericState.steps[0]?.strategy === 'generic_suffix'
											? genericState.steps[0].removedText
											: '',
									].filter(Boolean),
									effectiveText: genericState.request.text ?? '',
								},
							}
						}
						if (!recovered) {
							recovered = recoverTextVariant(adapter, genericState)
						}
					}

					if (!recovered) recovered = recoverTextVariant(adapter, initialState)
					if (recovered) {
						result = recovered.result
						if (!diagnostics) {
							diagnostics = { textRecovery: recoveryDiagnostic(recovered.state) }
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
