import {
	GeoCatalogError,
	type GeoCatalog,
	type GeoCatalogQueryResult,
	type GeoCatalogSnapshotMetadata,
} from './types'

export interface GeoCatalogReadinessSummary {
	snapshot: GeoCatalogSnapshotMetadata
	sampleEntryId: string
}

export interface PreflightGeoCatalogOptions {
	catalog: GeoCatalog
	/** Production requires a usable snapshot; development deliberately remains lazy. */
	required: boolean
	/**
	 * Permit only a genuinely unavailable snapshot while an operator-managed
	 * bootstrap is in progress. Invalid or empty snapshots still fail closed.
	 */
	allowUnavailable?: boolean
}

/**
 * Proves that the configured catalog can be opened, its metadata is valid, and
 * it contains at least one queryable entry. Development skips the query so a
 * missing local snapshot remains a tool-time error rather than a startup error.
 */
export async function preflightGeoCatalog(
	options: PreflightGeoCatalogOptions,
): Promise<GeoCatalogReadinessSummary | null> {
	if (!options.required) return null

	let result: GeoCatalogQueryResult
	try {
		result = await options.catalog.query({ limit: 1 })
	} catch (error) {
		if (
			options.allowUnavailable === true &&
			error instanceof GeoCatalogError &&
			error.code === 'snapshot_unavailable'
		) {
			return null
		}
		throw error
	}
	const sample = result.items[0]
	if (!sample) {
		throw new GeoCatalogError(
			'snapshot_invalid',
			`GeoCatalog snapshot ${result.metadata.snapshot.id} contains no queryable entries`,
		)
	}

	return {
		snapshot: result.metadata.snapshot,
		sampleEntryId: sample.id,
	}
}

export function formatGeoCatalogReadiness(summary: GeoCatalogReadinessSummary): string {
	const sources = summary.snapshot.sources
		.map((source) => `${source.name}@${source.release}`)
		.join(', ')
	return `${summary.snapshot.id} (${sources})`
}
