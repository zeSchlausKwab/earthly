import { captureVisibleDatasetReferenceTarget } from '@/features/chat/store'
import { getMapContextSnapshot } from '@/features/chat/tools/context'
import { getMapPresentation } from '@/features/chat/tools/map-view-tools'
import { projectDurableFeatures } from '@/features/chat/tools/executionTarget'
import type { EditorFeature } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'

export class BrowserToolError extends Error {
	constructor(
		public readonly code: string,
		message: string,
	) {
		super(message)
	}
}

export function readCurrentMap() {
	const state = useEditorStore.getState()
	const target = captureVisibleDatasetReferenceTarget()
	const draft = target.draftId ? state.geoEditDrafts[target.draftId] : null
	if (!draft || !state.editor || state.pendingHydratedDraftId) {
		throw new BrowserToolError(
			'map_required',
			'Open an editable Map draft before using Earthly tools.',
		)
	}
	const features = projectDurableFeatures(draft.features)
	if (
		JSON.stringify(projectDurableFeatures(state.editor.getAllFeatures())) !==
		JSON.stringify(features)
	) {
		throw new BrowserToolError(
			'map_not_ready',
			'The Map is still loading or drawing. Finish drawing and read it again.',
		)
	}
	const fingerprint = JSON.stringify([
		target.workspaceId,
		target.draftId,
		target.sourceId,
		target.baseRevisionId,
		features,
		draft.collectionMeta,
		draft.selectedFeatureIds,
	])
	return { target, draft, features, fingerprint }
}

/** Stable across timestamp-only autosaves; changes with geometry, metadata, selection or target. */
export function createMapReader() {
	let previousFingerprint: string | null = null
	let token = ''
	return () => {
		const map = readCurrentMap()
		if (map.fingerprint !== previousFingerprint) {
			previousFingerprint = map.fingerprint
			token = crypto.randomUUID()
		}
		return { ...map, mapToken: token }
	}
}

export function describeMap(map: ReturnType<ReturnType<typeof createMapReader>>) {
	return {
		mapToken: map.mapToken,
		target: map.target,
		metadata: map.draft.collectionMeta,
		selectedFeatureIds: map.draft.selectedFeatureIds,
		...getMapContextSnapshot(),
		...getMapPresentation(),
		featureCount: map.features.length,
		coordinates:
			'GeoJSON uses [longitude, latitude] in WGS84. Widths/distances use each tool’s units.',
		visualInspection:
			'Use Chrome DevTools take_screenshot for the rendered map including HTML callouts and images. earthly_capture_map_snapshot returns canvas image bytes only.',
	}
}

const MAX_PAGE_BYTES = 512 * 1024

/** Bound both count and UTF-8 bytes while retaining full geometry and callout/media properties. */
export function featurePage(
	features: EditorFeature[],
	args: { offset?: number; limit?: number; featureIds?: string[] },
) {
	const ids = args.featureIds ? new Set(args.featureIds) : null
	const filtered = ids ? features.filter((feature) => ids.has(String(feature.id))) : features
	const offset = args.offset ?? 0
	const limit = args.limit ?? 50
	const page: EditorFeature[] = []
	let bytes = 0
	for (const feature of filtered.slice(offset, offset + limit)) {
		const size = new TextEncoder().encode(JSON.stringify(feature)).byteLength
		if (bytes + size > MAX_PAGE_BYTES) {
			if (!page.length)
				throw new BrowserToolError(
					'feature_too_large',
					'This feature exceeds the 512 KiB read budget. Simplify it or use a local GeoJSON export.',
				)
			break
		}
		page.push(feature)
		bytes += size
	}
	const next = offset + page.length
	return {
		geojson: { type: 'FeatureCollection' as const, features: page },
		totalMatched: filtered.length,
		offset,
		nextOffset: next < filtered.length ? next : null,
		featureBytes: bytes,
	}
}
