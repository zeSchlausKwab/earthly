import type { Feature, FeatureCollection } from 'geojson'

function stringIdentity(value: unknown): string | undefined {
	if (typeof value === 'string') return value.length > 0 ? value : undefined
	if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	return undefined
}

/**
 * The single identity rule for source features used by references,
 * presentation selectors, missing-feature diagnostics, and render filtering.
 */
export function getPresentationFeatureId(feature: Feature): string | undefined {
	return (
		stringIdentity(feature.id) ??
		stringIdentity(feature.properties?.featureId) ??
		stringIdentity(feature.properties?.id)
	)
}

export function presentationFeatureMatches(
	feature: Feature,
	featureIds: ReadonlySet<string> | readonly string[],
): boolean {
	const id = getPresentationFeatureId(feature)
	if (id === undefined) return false
	const possibleSet = featureIds as ReadonlySet<string>
	return typeof possibleSet.has === 'function'
		? possibleSet.has(id)
		: (featureIds as readonly string[]).includes(id)
}

export interface PresentationFeatureSelection {
	readonly featureCollection: FeatureCollection
	/** Requested ids that matched, in selector order. */
	readonly matchedFeatureIds: readonly string[]
	/** Requested ids that did not match, in selector order. */
	readonly missingFeatureIds: readonly string[]
}

/**
 * Apply a non-widening feature selector. `undefined` means the whole source;
 * an explicit empty array intentionally selects no features.
 */
export function selectPresentationFeatures(
	collection: FeatureCollection,
	featureIds?: readonly string[],
): PresentationFeatureSelection {
	if (featureIds === undefined) {
		return Object.freeze({
			featureCollection: collection,
			matchedFeatureIds: Object.freeze([]),
			missingFeatureIds: Object.freeze([]),
		})
	}

	const requested = new Set(featureIds)
	const matchedSet = new Set<string>()
	const features = collection.features.filter((feature) => {
		const id = getPresentationFeatureId(feature)
		if (id === undefined || !requested.has(id)) return false
		matchedSet.add(id)
		return true
	})
	const matchedFeatureIds = featureIds.filter((featureId) => matchedSet.has(featureId))
	const missingFeatureIds = featureIds.filter((featureId) => !matchedSet.has(featureId))

	return Object.freeze({
		featureCollection: {
			...collection,
			features,
		},
		matchedFeatureIds: Object.freeze(matchedFeatureIds),
		missingFeatureIds: Object.freeze(missingFeatureIds),
	})
}
