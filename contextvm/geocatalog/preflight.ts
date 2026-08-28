import {
	GeoCatalogError,
	type GeoCatalog,
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

	const result = await options.catalog.query({ limit: 1 })
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
