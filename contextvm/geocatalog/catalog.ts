import { cloneEntry, prepareQuery, type GeoCatalogAdapter } from './internal'
import {
	GeoCatalogError,
	type GeoCatalog,
	type GeoCatalogQueryResult,
	type GeoCatalogSnapshotMetadata,
} from './types'

function cloneSnapshot(snapshot: GeoCatalogSnapshotMetadata): GeoCatalogSnapshotMetadata {
	return {
		id: snapshot.id,
		createdAt: snapshot.createdAt,
		schemaVersion: 1,
		sources: snapshot.sources.map((source) => ({ ...source })),
	}
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
				const result = adapter.query(prepared)
				return {
					items: result.entries.map((entry) =>
						cloneEntry(entry, prepared.includeGeometry),
					),
					metadata: {
						snapshot: cloneSnapshot(adapter.snapshot),
						query: {
							returned: result.entries.length,
							limit: prepared.limit,
							hasMore: result.hasMore,
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

