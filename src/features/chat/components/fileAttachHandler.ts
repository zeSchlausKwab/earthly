/**
 * The extracted, dependency-injected attach callback (D-10 / INGEST-01..05).
 *
 * `handleAttachedFile(file, deps)` is the SINGLE orchestration point for one
 * attached file, factored out of the `FileChipStrip` component so the
 * three-step order can be unit-tested below the UAT (no DOM, no React):
 *
 *   1. `assertFileWithinCaps(file)` — the T-03-19 DoS guard, FIRST and always.
 *      An over-cap file short-circuits here and is NEVER parsed or stored.
 *   2a. image → `readImageDataUrl(file)` → an `image_url` attachment (INGEST-04).
 *       Images skip the parse/store path entirely.
 *   2b. data file → `parseFileInWorker(kind, payload)` off the main thread
 *       (INGEST-02, no freeze) → `putDataset(parsed)` → `deriveIngestSummary`.
 *       The strict assertFileWithinCaps → parseFileInWorker → putDataset order is
 *       the contract `fileAttachHandler.test.ts` pins (WARNING 5).
 *
 * `deps` is injected so the test can mock each step and record the call order;
 * production callers pass the real implementations via `defaultAttachDeps`.
 */

import type {
	CoordinateColumns,
	DatasetType,
	IngestSummary,
	ParsedDataset,
	SchemaField,
} from '../ingest/datasetTypes'
import { detectCoordinateColumns } from '../ingest/detectCoordinateColumns'
import { assertFileWithinCaps, type FileWithinCapsResult } from '../ingest/fileSizeGuards'
import type { IngestParsePayload } from '../ingest/ingestClient'
import { parseFileInWorker } from '../ingest/ingestClient'
import { putDataset } from '../ingest/ingestStore'
import { deriveIngestSummary } from '../ingest/parseSummary'
import type { IngestKind, IngestParseResponse } from '../ingest/types'

/** Result of attaching one file. Discriminated on `status`. */
export type AttachResult =
	| { status: 'rejected'; fileName: string; reason: string }
	| { status: 'image'; fileName: string; imageUrl: string }
	| { status: 'parsed'; fileName: string; handleId: string; summary: IngestSummary }
	| { status: 'failed'; fileName: string; reason: string }

/** Injected dependencies — mockable in tests, defaulted in production. */
export interface AttachDeps {
	assertFileWithinCaps: (file: { size: number; isImage: boolean }) => FileWithinCapsResult
	parseFileInWorker: (kind: IngestKind, payload: IngestParsePayload) => Promise<IngestParseResponse>
	putDataset: (parsed: Omit<ParsedDataset, 'handleId' | 'createdAt'>) => string
	deriveIngestSummary: (parsed: ParsedDataset) => IngestSummary
	readImageDataUrl: (file: File) => Promise<string>
}

/** Minimal clipboard shape kept DOM-light so paste extraction is unit-testable. */
export interface ClipboardImageSource {
	items?: ArrayLike<Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>>
	files?: ArrayLike<File>
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'])

const EXTENSION_KIND: Record<string, IngestKind> = {
	csv: 'csv',
	tsv: 'csv',
	xlsx: 'xlsx',
	xls: 'xlsx',
	geojson: 'geojson',
	json: 'json',
	txt: 'text',
	md: 'text',
	text: 'text',
}

function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.')
	return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Is this an image attachment (INGEST-04)? By mime type or extension. */
export function isImageFile(file: File): boolean {
	if (file.type.startsWith('image/')) return true
	return IMAGE_EXTENSIONS.has(extensionOf(file.name))
}

/**
 * Extract image files from a paste event without duplicating the same clipboard
 * payload through both `items` and `files` (Chromium exposes screenshots in
 * both collections). Item-backed files are preferred because their MIME type is
 * authoritative; `files` is the compatibility fallback.
 */
export function extractPastedImageFiles(source: ClipboardImageSource): File[] {
	const itemImages = Array.from(source.items ?? [])
		.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null && isImageFile(file))

	if (itemImages.length > 0) return itemImages
	return Array.from(source.files ?? []).filter(isImageFile)
}

/** Map a (non-image) file to the off-thread parse kind. Defaults to `text`. */
export function detectIngestKind(file: File): IngestKind {
	const ext = extensionOf(file.name)
	if (ext && EXTENSION_KIND[ext]) return EXTENSION_KIND[ext]
	if (file.type === 'application/json') return 'json'
	if (file.type === 'text/csv') return 'csv'
	return 'text'
}

/** Maximum encoded payload retained inline for one model image request. */
export const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024
/** Bound image dimensions before base64 encoding to keep requests predictable. */
export const MAX_INLINE_IMAGE_EDGE = 2048

const PROVIDER_SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function readBlobDataUrl(blob: Blob): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result))
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
		reader.readAsDataURL(blob)
	})
}

function loadImageElement(file: File): Promise<{ image: HTMLImageElement; dispose: () => void }> {
	return new Promise((resolve, reject) => {
		const objectUrl = URL.createObjectURL(file)
		const image = new Image()
		const dispose = () => URL.revokeObjectURL(objectUrl)
		image.onload = () => resolve({ image, dispose })
		image.onerror = () => {
			dispose()
			reject(new Error('This image could not be decoded.'))
		}
		image.src = objectUrl
	})
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('This image could not be encoded.'))),
			type,
			quality,
		)
	})
}

/**
 * Convert an upload to the inline data-URL transport used by OpenAI-compatible
 * vision endpoints. Provider-safe images already inside the envelope stay
 * byte-for-byte intact; large or unusual formats are bounded and encoded as
 * WebP so a raw 25 MiB image cannot turn into a 33 MiB JSON request.
 */
export async function readImageDataUrl(file: File): Promise<string> {
	const { image, dispose } = await loadImageElement(file)
	try {
		const width = image.naturalWidth
		const height = image.naturalHeight
		if (width <= 0 || height <= 0) throw new Error('This image has invalid dimensions.')

		const canKeepOriginal =
			PROVIDER_SAFE_IMAGE_TYPES.has(file.type.toLowerCase()) &&
			file.size <= MAX_INLINE_IMAGE_BYTES &&
			width <= MAX_INLINE_IMAGE_EDGE &&
			height <= MAX_INLINE_IMAGE_EDGE
		if (canKeepOriginal) return await readBlobDataUrl(file)

		const scale = Math.min(1, MAX_INLINE_IMAGE_EDGE / Math.max(width, height))
		let targetWidth = Math.max(1, Math.round(width * scale))
		let targetHeight = Math.max(1, Math.round(height * scale))
		const canvas = document.createElement('canvas')
		const context = canvas.getContext('2d')
		if (!context) throw new Error('Image conversion is unavailable in this browser.')

		let encoded: Blob | null = null
		for (let attempt = 0; attempt < 4; attempt += 1) {
			canvas.width = targetWidth
			canvas.height = targetHeight
			context.clearRect(0, 0, targetWidth, targetHeight)
			context.drawImage(image, 0, 0, targetWidth, targetHeight)
			encoded = await canvasToBlob(canvas, 'image/webp', Math.max(0.68, 0.88 - attempt * 0.06))
			if (encoded.size <= MAX_INLINE_IMAGE_BYTES) break
			targetWidth = Math.max(1, Math.round(targetWidth * 0.75))
			targetHeight = Math.max(1, Math.round(targetHeight * 0.75))
		}

		if (!encoded || encoded.size > MAX_INLINE_IMAGE_BYTES) {
			throw new Error('This image is still too large after optimization.')
		}
		return await readBlobDataUrl(encoded)
	} finally {
		dispose()
	}
}

/** The production dependency bundle. Tests pass their own mocks. */
export const defaultAttachDeps: AttachDeps = {
	assertFileWithinCaps,
	parseFileInWorker,
	putDataset,
	deriveIngestSummary,
	readImageDataUrl,
}

/** Max rows scanned per column when inferring its type (WR-07). */
export const SCHEMA_INFERENCE_SAMPLE_ROWS = 100

/** Map a single primitive value to a concrete schema type (null/undefined ignored upstream). */
function primitiveTypeOf(value: unknown): SchemaField['type'] | undefined {
	if (typeof value === 'number') return 'number'
	if (typeof value === 'boolean') return 'boolean'
	if (typeof value === 'string') return 'string'
	// Objects/arrays/etc. are surfaced as 'string' (their JSON-ish rendering).
	return 'string'
}

/**
 * Infer a SchemaField list from sampled rows (mirrors the parse pipeline shape).
 *
 * WR-07: scan a bounded sample (first SCHEMA_INFERENCE_SAMPLE_ROWS) of each
 * column's non-null values rather than typing from the FIRST non-null value
 * alone. When more than one primitive type appears, the column is `'mixed'`
 * (which `datasetTypes.SchemaField` already supports) instead of being mistyped
 * by a stray first value (e.g. a `"N/A"` token at the top of a numeric column).
 */
export function inferSchema(
	rows: Record<string, unknown>[],
	schemaFields?: string[],
): SchemaField[] {
	const names = schemaFields ?? (rows[0] ? Object.keys(rows[0]) : [])
	const scanLimit = Math.min(rows.length, SCHEMA_INFERENCE_SAMPLE_ROWS)
	return names.map((name) => {
		const seen = new Set<SchemaField['type']>()
		for (let i = 0; i < scanLimit; i++) {
			const value = rows[i]?.[name]
			if (value === undefined || value === null) continue
			const t = primitiveTypeOf(value)
			if (t) seen.add(t)
			if (seen.size > 1) break
		}
		const singleType = seen.values().next().value
		const type: SchemaField['type'] =
			seen.size === 0 ? 'string' : seen.size === 1 ? (singleType ?? 'string') : 'mixed'
		return { name, type }
	})
}

/** Build the host-side ParsedDataset (pre-handle) from a parse response. */
function buildParsedDataset(
	file: File,
	kind: IngestKind,
	res: IngestParseResponse,
): Omit<ParsedDataset, 'handleId' | 'createdAt'> {
	const type = kind as DatasetType

	// Tabular kinds: rows + schemaFields. Structured kinds: a single wrapped row.
	let fullRows: Record<string, unknown>[]
	let schemaFields: string[]
	if (kind === 'csv' || kind === 'xlsx') {
		fullRows = res.rows ?? []
		schemaFields = res.schemaFields ?? (fullRows[0] ? Object.keys(fullRows[0]) : [])
	} else if (kind === 'geojson') {
		fullRows = [{ __geojson: res.data }]
		schemaFields = []
	} else {
		fullRows = [(res.data as Record<string, unknown>) ?? {}]
		schemaFields = kind === 'json' ? [] : ['lineCount', 'charCount']
	}

	const schema = inferSchema(fullRows, schemaFields)
	const coordinateColumns: CoordinateColumns = detectCoordinateColumns(schemaFields)

	return {
		fileName: file.name,
		type,
		schema,
		rowCount: fullRows.length,
		columnCount: schema.length,
		fullRows,
		coordinateColumns,
		bytes: file.size,
	}
}

/**
 * Orchestrate a single attached file through the cap → parse → store pipeline.
 * Pure with respect to its injected `deps` (no global imports exercised in the
 * unit test); production callers pass `defaultAttachDeps`.
 */
export async function handleAttachedFile(
	file: File,
	deps: AttachDeps = defaultAttachDeps,
): Promise<AttachResult> {
	const isImage = isImageFile(file)

	// 1. Size cap FIRST — over-cap files never reach parse/store (T-03-19).
	const capResult = deps.assertFileWithinCaps({ size: file.size, isImage })
	if (!capResult.ok) {
		return { status: 'rejected', fileName: file.name, reason: capResult.reason }
	}

	// 2a. Image path — encode to a data URL `image_url` part (INGEST-04).
	if (isImage) {
		try {
			const imageUrl = await deps.readImageDataUrl(file)
			return { status: 'image', fileName: file.name, imageUrl }
		} catch {
			return {
				status: 'failed',
				fileName: file.name,
				reason: `Couldn't read ${file.name}. Try a different image.`,
			}
		}
	}

	// 2b. Data path — off-thread parse → store → summary.
	const kind = detectIngestKind(file)
	const payload: IngestParsePayload =
		kind === 'xlsx' ? { buffer: await file.arrayBuffer() } : { text: await file.text() }

	const res = await deps.parseFileInWorker(kind, payload)
	if (!res.success) {
		return {
			status: 'failed',
			fileName: file.name,
			reason: `Couldn't parse ${file.name}. Check the file format and try again.`,
		}
	}

	const parsed = buildParsedDataset(file, kind, res)
	const handleId = deps.putDataset(parsed)
	const summary = deps.deriveIngestSummary({
		...parsed,
		handleId,
		createdAt: Date.now(),
	})

	return { status: 'parsed', fileName: file.name, handleId, summary }
}
