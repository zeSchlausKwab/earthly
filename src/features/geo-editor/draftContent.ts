import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoCollectionEditDraft, GeoEditorWorkspace } from './store/types'
import {
	convertGeoEventsToEditorFeatures,
	extractCollectionMeta,
	sanitizeEditorProperties,
} from './utils'

type DraftContent = Pick<
	GeoCollectionEditDraft,
	'features' | 'collectionMeta' | 'contextRefs' | 'blobReferences' | 'publishChannel'
>

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (value && typeof value === 'object') {
		return `{${Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`
	}
	return JSON.stringify(value) ?? 'null'
}

// Draft objects are immutable. Do not re-hash large geometry on every chat render.
const fingerprints = new WeakMap<DraftContent, string>()

/** Local-only publication baseline; selection, source ids and timestamps are not content. */
export function draftContentFingerprint(draft: DraftContent): string {
	const cached = fingerprints.get(draft)
	if (cached) return cached
	const content = {
		features: draft.features.map((feature) => {
			// normalizeFeature and selection rendering maintain these on the geometry.
			const { active, featureId, ...properties } =
				sanitizeEditorProperties(feature.properties) ?? {}
			return {
				id: feature.id,
				geometry: feature.geometry,
				properties: {
					...properties,
					color: feature.properties?.color ?? draft.collectionMeta.color,
				},
			}
		}),
		collectionMeta: draft.collectionMeta,
		contextRefs: [...new Set(draft.contextRefs)].sort(),
		publishChannel: draft.publishChannel,
		blobReferences: draft.blobReferences.map(
			({ scope, featureId, url, sha256, size, mimeType }) => ({
				scope,
				featureId,
				url,
				sha256,
				size,
				mimeType,
			}),
		),
	}
	const fingerprint = bytesToHex(sha256(new TextEncoder().encode(canonical(content))))
	fingerprints.set(draft, fingerprint)
	return fingerprint
}

const legacyBaselines = new WeakMap<GeoDataset, string>()

/** Unknown is distinct from clean when a pre-baseline draft's source is unavailable. */
export function datasetDraftHasChanges(
	workspace: GeoEditorWorkspace,
	draft: GeoCollectionEditDraft,
	geoEvents: GeoDataset[] = [],
): boolean | undefined {
	let baseline = workspace.publishedContentFingerprint
	if (!baseline) {
		const source = geoEvents.find(
			(event) =>
				event.event.id === workspace.baseRevisionId &&
				`${event.pubkey}:${event.dTag}` === workspace.datasetKey,
		)
		// Blob-backed drafts need the resolved baseline captured when opened. Never
		// compare their full geometry against an unresolved collection placeholder.
		if (!source || source.blobReferences.length || draft.publishChannel.kind !== 'public')
			return undefined
		baseline = legacyBaselines.get(source)
		if (!baseline) {
			baseline = draftContentFingerprint({
				features: convertGeoEventsToEditorFeatures([source]),
				collectionMeta: extractCollectionMeta(source.featureCollection),
				contextRefs: source.contextReferences,
				blobReferences: [],
				publishChannel: { kind: 'public' },
			})
			legacyBaselines.set(source, baseline)
		}
	}
	return draftContentFingerprint(draft) !== baseline
}
