const GEO_CATALOG_SOURCE_MANIFEST_PREFIX = 'earthly:geoCatalogSourceManifest:'

export interface GeoCatalogDocumentSummary {
	name: string
	url: string
}

export interface GeoCatalogSourceSummary {
	name: string
	release: string
	license?: string
	attribution?: string
	attributionUrl?: string
	documents?: GeoCatalogDocumentSummary[]
}

export interface GeoCatalogManifestSummary {
	snapshotId: string
	createdAt?: string
	sources: GeoCatalogSourceSummary[]
}

export interface PresentedDatasetMetadata {
	properties: Array<[string, unknown]>
	manifests: GeoCatalogManifestSummary[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyText(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function webUrl(value: unknown): string | undefined {
	const text = nonEmptyText(value)
	if (!text) return undefined

	try {
		const parsed = new URL(text)
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? text : undefined
	} catch {
		return undefined
	}
}

function parseManifestValue(value: unknown): Record<string, unknown> | undefined {
	if (isRecord(value)) return value
	if (typeof value !== 'string') return undefined

	try {
		const parsed: unknown = JSON.parse(value)
		return isRecord(parsed) ? parsed : undefined
	} catch {
		return undefined
	}
}

function summarizeDocuments(value: unknown): GeoCatalogDocumentSummary[] | undefined {
	if (!Array.isArray(value)) return undefined

	const documents = value.flatMap((candidate): GeoCatalogDocumentSummary[] => {
		if (!isRecord(candidate)) return []
		const name = nonEmptyText(candidate.name)
		const url = webUrl(candidate.url)
		return name && url ? [{ name, url }] : []
	})

	return documents.length > 0 ? documents : undefined
}

function summarizeSources(value: unknown): GeoCatalogSourceSummary[] {
	if (!Array.isArray(value)) return []

	return value.flatMap((candidate): GeoCatalogSourceSummary[] => {
		if (!isRecord(candidate)) return []
		const name = nonEmptyText(candidate.name)
		const release = nonEmptyText(candidate.release)
		if (!name || !release) return []

		const license = nonEmptyText(candidate.license)
		const attribution = nonEmptyText(candidate.attribution)
		const attributionUrl = webUrl(candidate.attributionUrl)
		const documents = summarizeDocuments(candidate.documents)

		return [
			{
				name,
				release,
				...(license ? { license } : {}),
				...(attribution ? { attribution } : {}),
				...(attributionUrl ? { attributionUrl } : {}),
				...(documents ? { documents } : {}),
			},
		]
	})
}

function summarizeManifest(key: string, value: unknown): GeoCatalogManifestSummary {
	const fallbackSnapshotId =
		key.slice(GEO_CATALOG_SOURCE_MANIFEST_PREFIX.length).trim() || 'Unknown snapshot'
	const manifest = parseManifestValue(value)
	const snapshotId = nonEmptyText(manifest?.snapshotId) ?? fallbackSnapshotId
	const createdAtText = nonEmptyText(manifest?.createdAt)
	const createdAt =
		createdAtText && Number.isFinite(Date.parse(createdAtText)) ? createdAtText : undefined

	return {
		snapshotId,
		...(createdAt ? { createdAt } : {}),
		sources: summarizeSources(manifest?.sources),
	}
}

function isNonEmptyProperty(value: unknown): boolean {
	if (value === undefined || value === null) return false
	if (typeof value === 'string') return value.trim().length > 0
	if (Array.isArray(value)) return value.length > 0
	if (isRecord(value)) return Object.keys(value).length > 0
	return true
}

/**
 * Separates user-facing Dataset properties from internal source manifests.
 *
 * Full manifests remain stored on the Dataset for attribution and export, but
 * inspect mode receives only the small, allow-listed fields it needs to render.
 */
export function presentDatasetMetadata(
	customProperties: Record<string, unknown>,
): PresentedDatasetMetadata {
	const properties: Array<[string, unknown]> = []
	const manifests: GeoCatalogManifestSummary[] = []

	for (const [key, value] of Object.entries(customProperties)) {
		if (key.startsWith(GEO_CATALOG_SOURCE_MANIFEST_PREFIX)) {
			manifests.push(summarizeManifest(key, value))
			continue
		}

		if (isNonEmptyProperty(value)) properties.push([key, value])
	}

	return { properties, manifests }
}
