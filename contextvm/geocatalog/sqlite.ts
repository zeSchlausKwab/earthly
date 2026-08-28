import {
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	unlinkSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { Database } from 'bun:sqlite'
import { createGeoCatalog } from './catalog'
import {
	encodeNormalizedAliases,
	normalizeSearchText,
	parseJson,
	radiusBbox,
	type GeoCatalogAdapter,
	type PreparedGeoCatalogQuery,
	validateEntry,
	validateSnapshotMetadata,
} from './internal'
import {
	GEO_CATALOG_ADMIN_LABEL_CATEGORY,
	GeoCatalogError,
	type GeoCatalog,
	type GeoCatalogBbox,
	type GeoCatalogEntry,
	type GeoCatalogSnapshotMetadata,
} from './types'

const SNAPSHOT_SCHEMA = `
	CREATE TABLE geocatalog_metadata (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		snapshot_json TEXT NOT NULL
	) STRICT;

	CREATE TABLE geocatalog_features (
		rowid INTEGER PRIMARY KEY,
		id TEXT NOT NULL UNIQUE,
		kind TEXT NOT NULL CHECK (
			kind IN ('admin', 'locality', 'place', 'road', 'rail', 'waterway', 'infrastructure')
		),
		name TEXT NOT NULL,
		normalized_name TEXT NOT NULL,
		aliases_json TEXT NOT NULL,
		normalized_aliases TEXT NOT NULL,
		categories_json TEXT NOT NULL,
		country_code TEXT,
		admin_level INTEGER CHECK (admin_level IS NULL OR admin_level >= 0),
		west REAL NOT NULL,
		south REAL NOT NULL,
		east REAL NOT NULL,
		north REAL NOT NULL,
		center_lon REAL NOT NULL,
		center_lat REAL NOT NULL,
		importance REAL NOT NULL,
		source_name TEXT NOT NULL,
		source_release TEXT NOT NULL,
		source_record_id TEXT,
		properties_json TEXT NOT NULL,
		geometry_json TEXT
	) STRICT;

	CREATE INDEX geocatalog_features_kind ON geocatalog_features(kind);
	CREATE INDEX geocatalog_features_country ON geocatalog_features(country_code);
	CREATE INDEX geocatalog_features_admin_level ON geocatalog_features(admin_level);
	CREATE INDEX geocatalog_features_order
		ON geocatalog_features(importance DESC, normalized_name, id);

	CREATE TABLE geocatalog_feature_categories (
		feature_rowid INTEGER NOT NULL,
		category TEXT NOT NULL,
		PRIMARY KEY (feature_rowid, category)
	) STRICT;

	CREATE INDEX geocatalog_feature_categories_category
		ON geocatalog_feature_categories(category, feature_rowid);

	CREATE VIRTUAL TABLE geocatalog_fts USING fts5(
		id UNINDEXED,
		name,
		aliases,
		tokenize = 'unicode61 remove_diacritics 2'
	);

	CREATE VIRTUAL TABLE geocatalog_rtree USING rtree(
		feature_rowid,
		min_lon,
		max_lon,
		min_lat,
		max_lat
	);
`

type NamedBindings = Record<string, string | number | bigint | boolean | null>

interface SqliteSnapshotRow {
	snapshot_json: string
}

interface SqliteFeatureRow {
	id: string
	kind: string
	name: string
	aliases_json: string
	categories_json: string
	country_code: string | null
	admin_level: number | null
	west: number
	south: number
	east: number
	north: number
	center_lon: number
	center_lat: number
	importance: number
	source_name: string
	source_release: string
	source_record_id: string | null
	properties_json: string
	geometry_json: string | null
}

export interface OpenSqliteGeoCatalogOptions {
	path: string
}

export interface WriteSqliteGeoCatalogSnapshotOptions {
	path: string
	snapshot: GeoCatalogSnapshotMetadata
	entries: Iterable<GeoCatalogEntry> | AsyncIterable<GeoCatalogEntry>
}

function removeIncompleteSnapshot(path: string): void {
	for (const artifact of [path, `${path}-wal`, `${path}-shm`]) {
		if (!existsSync(artifact)) continue
		const stat = lstatSync(artifact)
		if (!stat.isFile() && !stat.isSymbolicLink()) {
			throw new GeoCatalogError(
				'snapshot_invalid',
				`Incomplete GeoCatalog artifact is not a file and was not removed: ${artifact}`,
			)
		}
		unlinkSync(artifact)
	}
}

function removeSnapshotSidecars(path: string): void {
	for (const artifact of [`${path}-wal`, `${path}-shm`]) {
		if (!existsSync(artifact)) continue
		const stat = lstatSync(artifact)
		if (!stat.isFile() && !stat.isSymbolicLink()) {
			throw new GeoCatalogError(
				'snapshot_invalid',
				`GeoCatalog sidecar is not a file and was not removed: ${artifact}`,
			)
		}
		unlinkSync(artifact)
	}
}

function reserveSnapshotPath(path: string): void {
	let descriptor: number
	try {
		descriptor = openSync(path, 'wx', 0o600)
	} catch (error) {
		const code =
			error && typeof error === 'object' && 'code' in error
				? String((error as { code: unknown }).code)
				: null
		throw new GeoCatalogError(
			'snapshot_invalid',
			code === 'EEXIST'
				? `Refusing to replace existing GeoCatalog snapshot at ${path}`
				: `Cannot reserve GeoCatalog snapshot path ${path}`,
			{ cause: error },
		)
	}
	try {
		closeSync(descriptor)
	} catch (error) {
		try {
			unlinkSync(path)
		} catch (cleanupError) {
			throw new GeoCatalogError(
				'snapshot_invalid',
				`Cannot close or remove reserved GeoCatalog snapshot path ${path}`,
				{ cause: { error, cleanupError } },
			)
		}
		throw new GeoCatalogError(
			'snapshot_invalid',
			`Cannot close reserved GeoCatalog snapshot path ${path}`,
			{ cause: error },
		)
	}
}

function unavailableCatalog(error: GeoCatalogError): GeoCatalog {
	return {
		async query() {
			throw error
		},
	}
}

function readSnapshotMetadata(database: Database): GeoCatalogSnapshotMetadata {
	const row = database
		.query<SqliteSnapshotRow, []>(
			'SELECT snapshot_json FROM geocatalog_metadata WHERE singleton = 1',
		)
		.get()
	if (!row) {
		throw new GeoCatalogError('snapshot_invalid', 'GeoCatalog snapshot metadata is missing')
	}
	return validateSnapshotMetadata(parseJson(row.snapshot_json, 'snapshot metadata'))
}

function createFtsQuery(tokens: readonly string[]): string {
	return tokens.map((token) => `"${token}"*`).join(' AND ')
}

function addBboxCondition(
	conditions: string[],
	bindings: NamedBindings,
	bbox: GeoCatalogBbox,
	prefix: string,
): void {
	bindings[`${prefix}_south`] = bbox[1]
	bindings[`${prefix}_north`] = bbox[3]
	bindings[`${prefix}_west`] = bbox[0]
	bindings[`${prefix}_east`] = bbox[2]
	const latitude =
		`geocatalog_rtree.min_lat <= $${prefix}_north AND ` +
		`geocatalog_rtree.max_lat >= $${prefix}_south`
	const longitude =
		bbox[0] <= bbox[2]
			? `geocatalog_rtree.min_lon <= $${prefix}_east AND geocatalog_rtree.max_lon >= $${prefix}_west`
			: `((geocatalog_rtree.min_lon <= 180 AND geocatalog_rtree.max_lon >= $${prefix}_west) OR ` +
				`(geocatalog_rtree.min_lon <= $${prefix}_east AND geocatalog_rtree.max_lon >= -180))`
	conditions.push(`(${latitude}) AND (${longitude})`)
}

function distanceExpression(): string {
	return `(
		6371008.8 * 2 * asin(min(1, sqrt(
			pow(sin(radians(f.center_lat - $near_lat) / 2), 2) +
			cos(radians($near_lat)) * cos(radians(f.center_lat)) *
			pow(sin(radians(f.center_lon - $near_lon) / 2), 2)
		)))
	)`
}

function parseFeatureRow(
	row: SqliteFeatureRow,
	snapshot: GeoCatalogSnapshotMetadata,
): GeoCatalogEntry {
	const aliases = parseJson(row.aliases_json, `entry ${row.id}.aliases`)
	const categories = parseJson(row.categories_json, `entry ${row.id}.categories`)
	const properties = parseJson(row.properties_json, `entry ${row.id}.properties`)
	const geometry =
		row.geometry_json === null
			? undefined
			: parseJson(row.geometry_json, `entry ${row.id}.geometry`)
	return validateEntry(
		{
			id: row.id,
			kind: row.kind,
			name: row.name,
			aliases,
			categories,
			...(row.country_code ? { countryCode: row.country_code } : {}),
			...(row.admin_level !== null ? { adminLevel: row.admin_level } : {}),
			bbox: [row.west, row.south, row.east, row.north],
			center: { longitude: row.center_lon, latitude: row.center_lat },
			importance: row.importance,
			source: {
				name: row.source_name,
				release: row.source_release,
				...(row.source_record_id ? { recordId: row.source_record_id } : {}),
			},
			properties,
			...(geometry ? { geometry } : {}),
		},
		snapshot,
	)
}

class SqliteGeoCatalogAdapter implements GeoCatalogAdapter {
	readonly snapshot: GeoCatalogSnapshotMetadata
	readonly #database: Database

	constructor(database: Database, snapshot: GeoCatalogSnapshotMetadata) {
		this.#database = database
		this.snapshot = snapshot
	}

	query(request: PreparedGeoCatalogQuery) {
		const bindings: NamedBindings = { fetch_limit: request.limit + 1 }
		const conditions: string[] = []
		const joins: string[] = []

		if (request.includeGeometry) {
			bindings.admin_label_category = GEO_CATALOG_ADMIN_LABEL_CATEGORY
			conditions.push(`NOT (
				f.kind = 'admin' AND EXISTS (
					SELECT 1
					FROM geocatalog_feature_categories AS non_authoring_category
					WHERE non_authoring_category.feature_rowid = f.rowid
						AND non_authoring_category.category = $admin_label_category
				)
			)`)
		}

		if (request.ids.length > 0) {
			const placeholders = request.ids.map((id, index) => {
				bindings[`id_${index}`] = id
				return `$id_${index}`
			})
			conditions.push(`f.id IN (${placeholders.join(', ')})`)
		}
		if (request.kinds.length > 0) {
			const placeholders = request.kinds.map((kind, index) => {
				bindings[`kind_${index}`] = kind
				return `$kind_${index}`
			})
			conditions.push(`f.kind IN (${placeholders.join(', ')})`)
		}
		if (request.categories.length > 0) {
			const placeholders = request.categories.map((category, index) => {
				bindings[`category_${index}`] = category
				return `$category_${index}`
			})
			conditions.push(`f.rowid IN (
				SELECT filtered_category.feature_rowid
				FROM geocatalog_feature_categories AS filtered_category
				WHERE filtered_category.category IN (${placeholders.join(', ')})
			)`)
		}
		if (request.adminLevels.length > 0) {
			const placeholders = request.adminLevels.map((adminLevel, index) => {
				bindings[`admin_level_${index}`] = adminLevel
				return `$admin_level_${index}`
			})
			conditions.push(`f.admin_level IN (${placeholders.join(', ')})`)
		}
		if (request.countryCode !== null) {
			bindings.country_code = request.countryCode
			conditions.push('f.country_code = $country_code')
		}
		if (request.text !== null) {
			joins.push('JOIN geocatalog_fts ON geocatalog_fts.rowid = f.rowid')
			bindings.fts_query = createFtsQuery(request.textTokens)
			bindings.normalized_text = request.text
			bindings.text_prefix = `${request.text}%`
			conditions.push('geocatalog_fts MATCH $fts_query')
		}

		if (request.bbox !== null || request.near !== null) {
			joins.push('JOIN geocatalog_rtree ON geocatalog_rtree.feature_rowid = f.rowid')
		}
		if (request.bbox !== null) {
			addBboxCondition(conditions, bindings, request.bbox, 'bbox')
		}
		if (request.near !== null && request.radiusMeters !== null) {
			bindings.near_lon = request.near.longitude
			bindings.near_lat = request.near.latitude
			bindings.radius_meters = request.radiusMeters
			addBboxCondition(
				conditions,
				bindings,
				radiusBbox(request.near.longitude, request.near.latitude, request.radiusMeters),
				'near_bbox',
			)
		}

		const idRank =
			request.ids.length === 0
				? '0'
				: `CASE f.id ${request.ids
						.map((_id, index) => `WHEN $id_${index} THEN ${index}`)
						.join(' ')} ELSE ${request.ids.length} END`
		const textRank =
			request.text === null
				? '0'
				: `CASE
					WHEN f.normalized_name = $normalized_text THEN 0
					WHEN instr(f.normalized_aliases, char(31) || $normalized_text || char(31)) > 0 THEN 1
					WHEN f.normalized_name LIKE $text_prefix THEN 2
					ELSE 3
				END`
		const distance = request.near === null ? '0' : distanceExpression()
		const geometryProjection = request.includeGeometry
			? 'f.geometry_json'
			: 'NULL AS geometry_json'
		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
		const radiusWhere = request.near === null ? '' : 'WHERE distance_meters <= $radius_meters'
		const sql = `
			WITH ranked AS (
				SELECT
					f.id, f.kind, f.name, f.aliases_json, f.categories_json,
					f.country_code, f.admin_level,
					f.west, f.south, f.east, f.north, f.center_lon, f.center_lat,
					f.importance, f.source_name, f.source_release, f.source_record_id,
					f.properties_json, ${geometryProjection},
					${idRank} AS id_rank,
					${textRank} AS text_rank,
					${distance} AS distance_meters,
					f.normalized_name AS normalized_name
				FROM geocatalog_features AS f
				${joins.join('\n')}
				${where}
			)
			SELECT
				id, kind, name, aliases_json, categories_json, country_code, admin_level,
				west, south, east, north, center_lon, center_lat,
				importance, source_name, source_release, source_record_id,
				properties_json, geometry_json
			FROM ranked
			${radiusWhere}
			ORDER BY id_rank, text_rank, distance_meters, importance DESC, normalized_name, id
			LIMIT $fetch_limit
		`

		const rows = this.#database
			.query<SqliteFeatureRow, NamedBindings>(sql)
			.all(bindings)
		const hasMore = rows.length > request.limit
		return {
			entries: rows
				.slice(0, request.limit)
				.map((row) => parseFeatureRow(row, this.snapshot)),
			hasMore,
		}
	}
}

function openAdapter(path: string): SqliteGeoCatalogAdapter {
	if (!existsSync(path)) {
		throw new GeoCatalogError(
			'snapshot_unavailable',
			`GeoCatalog snapshot is unavailable at ${path}`,
		)
	}
	let database: Database | null = null
	try {
		database = new Database(path, { readonly: true, strict: true })
		const snapshot = readSnapshotMetadata(database)
		return new SqliteGeoCatalogAdapter(database, snapshot)
	} catch (error) {
		database?.close()
		if (error instanceof GeoCatalogError) throw error
		throw new GeoCatalogError('snapshot_invalid', `Cannot open GeoCatalog snapshot at ${path}`, {
			cause: error,
		})
	}
}

/**
 * Opening is startup-safe. A missing or invalid file returns a catalog whose
 * first query raises a typed, non-retryable error instead of crashing ContextVM.
 */
export function openSqliteGeoCatalog(options: OpenSqliteGeoCatalogOptions): GeoCatalog {
	if (typeof options.path !== 'string' || options.path.trim().length === 0) {
		return unavailableCatalog(
			new GeoCatalogError('snapshot_unavailable', 'GeoCatalog snapshot path is not configured'),
		)
	}
	try {
		return createGeoCatalog(openAdapter(options.path.trim()))
	} catch (error) {
		return unavailableCatalog(
			error instanceof GeoCatalogError
				? error
				: new GeoCatalogError('snapshot_unavailable', 'GeoCatalog snapshot cannot be opened', {
						cause: error,
					}),
		)
	}
}

interface PreparedSnapshotWriter {
	writeMetadata(): void
	writeEntry(entry: GeoCatalogEntry): void
}

function prepareSnapshotWriter(
	database: Database,
	snapshot: GeoCatalogSnapshotMetadata,
): PreparedSnapshotWriter {
	const insertMetadata = database.query<never, [string]>(
		'INSERT INTO geocatalog_metadata(singleton, snapshot_json) VALUES (1, ?)',
	)
	const insertFeature = database.query<never, [
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string | null,
		number | null,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		string,
		string,
		string | null,
		string,
		string | null,
	]>(`
		INSERT INTO geocatalog_features(
			id, kind, name, normalized_name, aliases_json, normalized_aliases, categories_json,
			country_code, admin_level,
			west, south, east, north, center_lon, center_lat, importance,
			source_name, source_release, source_record_id, properties_json, geometry_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	const insertCategory = database.query<never, [number | bigint, string]>(
		'INSERT INTO geocatalog_feature_categories(feature_rowid, category) VALUES (?, ?)',
	)
	const insertFts = database.query<never, [number | bigint, string, string, string]>(
		'INSERT INTO geocatalog_fts(rowid, id, name, aliases) VALUES (?, ?, ?, ?)',
	)
	const insertRtree = database.query<
		never,
		[number | bigint, number, number, number, number]
	>(
		'INSERT INTO geocatalog_rtree(feature_rowid, min_lon, max_lon, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)',
	)

	return {
		writeMetadata() {
			insertMetadata.run(JSON.stringify(snapshot))
		},
		writeEntry(entryInput) {
			const entry = validateEntry(entryInput, snapshot)
			const inserted = insertFeature.run(
				entry.id,
				entry.kind,
				entry.name,
				normalizeSearchText(entry.name),
				JSON.stringify(entry.aliases),
				encodeNormalizedAliases(entry.aliases),
				JSON.stringify(entry.categories),
				entry.countryCode ?? null,
				entry.adminLevel ?? null,
				entry.bbox[0],
				entry.bbox[1],
				entry.bbox[2],
				entry.bbox[3],
				entry.center.longitude,
				entry.center.latitude,
				entry.importance,
				entry.source.name,
				entry.source.release,
				entry.source.recordId ?? null,
				JSON.stringify(entry.properties),
				entry.geometry ? JSON.stringify(entry.geometry) : null,
			)
			const rowid = inserted.lastInsertRowid
			for (const category of entry.categories) insertCategory.run(rowid, category)
			insertFts.run(
				rowid,
				entry.id,
				normalizeSearchText(entry.name),
				entry.aliases.map(normalizeSearchText).join(' '),
			)
			insertRtree.run(rowid, entry.bbox[0], entry.bbox[2], entry.bbox[1], entry.bbox[3])
		},
	}
}

function initializeSnapshot(
	database: Database,
	snapshotInput: GeoCatalogSnapshotMetadata,
	entryInputs: Iterable<GeoCatalogEntry>,
): void {
	const snapshot = validateSnapshotMetadata(snapshotInput)
	database.exec(SNAPSHOT_SCHEMA)
	const writer = prepareSnapshotWriter(database, snapshot)
	const write = database.transaction(() => {
		writer.writeMetadata()
		for (const entry of entryInputs) writer.writeEntry(entry)
	})
	write()
	database.exec('PRAGMA optimize')
}

/**
 * Writes a new immutable snapshot. Existing files are deliberately rejected;
 * release builders should write a fresh path and promote it atomically.
 */
export async function writeSqliteGeoCatalogSnapshot(
	options: WriteSqliteGeoCatalogSnapshotOptions,
): Promise<void> {
	if (typeof options.path !== 'string' || options.path.trim().length === 0) {
		throw new GeoCatalogError('snapshot_invalid', 'GeoCatalog snapshot path is required')
	}
	const path = options.path.trim()
	if (existsSync(path)) {
		throw new GeoCatalogError(
			'snapshot_invalid',
			`Refusing to replace existing GeoCatalog snapshot at ${path}`,
		)
	}
	mkdirSync(dirname(path), { recursive: true })
	reserveSnapshotPath(path)
	let database: Database
	try {
		database = new Database(path, { strict: true })
	} catch (error) {
		try {
			removeIncompleteSnapshot(path)
		} catch (cleanupError) {
			throw new GeoCatalogError(
				'snapshot_invalid',
				`Cannot initialize or remove reserved GeoCatalog snapshot at ${path}`,
				{ cause: { error, cleanupError } },
			)
		}
		throw new GeoCatalogError('snapshot_invalid', `Cannot initialize snapshot at ${path}`, {
			cause: error,
		})
	}
	const noFailure = Symbol('no-failure')
	let failure: unknown | typeof noFailure = noFailure
	try {
		database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
		const snapshot = validateSnapshotMetadata(options.snapshot)
		database.exec(SNAPSHOT_SCHEMA)
		const writer = prepareSnapshotWriter(database, snapshot)
		database.exec('BEGIN IMMEDIATE')
		writer.writeMetadata()
		for await (const entry of options.entries) writer.writeEntry(entry)
		database.exec('COMMIT')
		database.exec(
			'PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;',
		)
	} catch (error) {
		failure = error
		if (database.inTransaction) {
			try {
				database.exec('ROLLBACK')
			} catch (rollbackError) {
				failure = { error, rollbackError }
			}
		}
	} finally {
		database.close()
	}
	if (failure === noFailure) {
		try {
			removeSnapshotSidecars(path)
		} catch (error) {
			failure = error
		}
	}
	if (failure !== noFailure) {
		try {
			removeIncompleteSnapshot(path)
		} catch (cleanupError) {
			throw new GeoCatalogError(
				'snapshot_invalid',
				`GeoCatalog snapshot failed and its incomplete artifact could not be removed: ${path}`,
				{ cause: { failure, cleanupError } },
			)
		}
		if (failure instanceof GeoCatalogError) throw failure
		const detail = failure instanceof Error ? `: ${failure.message}` : ''
		throw new GeoCatalogError(
			'snapshot_invalid',
			`Failed to write GeoCatalog snapshot${detail}`,
			{ cause: failure },
		)
	}
}

// Internal test seam. Production callers open immutable files through the
// exported factory rather than retaining a writable Database.
export function createSqliteGeoCatalogForDatabase(database: Database): GeoCatalog {
	return createGeoCatalog(new SqliteGeoCatalogAdapter(database, readSnapshotMetadata(database)))
}

export function initializeSqliteGeoCatalogForTests(
	database: Database,
	snapshot: GeoCatalogSnapshotMetadata,
	entries: readonly GeoCatalogEntry[],
): void {
	initializeSnapshot(database, snapshot, entries)
}
