import { createGeoCatalog } from './catalog'
import {
	queryEntries,
	type GeoCatalogAdapter,
	type PreparedGeoCatalogQuery,
	validateEntry,
	validateSnapshotMetadata,
} from './internal'
import {
	GeoCatalogError,
	type GeoCatalog,
	type GeoCatalogEntry,
	type GeoCatalogSnapshotMetadata,
} from './types'

export interface InMemoryGeoCatalogOptions {
	snapshot: GeoCatalogSnapshotMetadata
	entries: readonly GeoCatalogEntry[]
}

class InMemoryGeoCatalogAdapter implements GeoCatalogAdapter {
	readonly snapshot: GeoCatalogSnapshotMetadata
	readonly #entries: GeoCatalogEntry[]

	constructor(options: InMemoryGeoCatalogOptions) {
		this.snapshot = validateSnapshotMetadata(options.snapshot)
		const seen = new Set<string>()
		this.#entries = options.entries.map((entry) => {
			const validated = validateEntry(entry, this.snapshot)
			if (seen.has(validated.id)) {
				throw new GeoCatalogError(
					'snapshot_invalid',
					`GeoCatalog snapshot contains duplicate id ${validated.id}`,
				)
			}
			seen.add(validated.id)
			return validated
		})
	}

	query(request: PreparedGeoCatalogQuery) {
		return queryEntries(this.#entries, request)
	}
}

export function createInMemoryGeoCatalog(options: InMemoryGeoCatalogOptions): GeoCatalog {
	return createGeoCatalog(new InMemoryGeoCatalogAdapter(options))
}

