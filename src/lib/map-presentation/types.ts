/** Embedded presentation schema for Story and Atlas content. */

import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'

export const MAP_PRESENTATION_VERSION = 1 as const
export const MAP_PRESENTATION_SOURCE_KIND = GEO_EVENT_KIND

/** A validated parameterized-replaceable Map address. */
export type MapPresentationSource = `37515:${string}:${string}`

export interface MapPresentationCameraV1 {
	readonly center: readonly [longitude: number, latitude: number]
	readonly zoom: number
	readonly bearing?: number
	readonly pitch?: number
}

/** Short public name used by the serialized schema documentation. */
export type MapCameraV1 = MapPresentationCameraV1

export type MapPresentationLineDashV1 = 'solid' | 'dashed' | 'dotted'

/**
 * Presentation-only properties. Content fields such as name, description, and
 * label deliberately do not belong here: applying a presentation must never
 * rewrite a referenced feature.
 */
export interface MapPresentationStyleOverrideV1 {
	readonly color?: string
	readonly fillColor?: string
	readonly strokeColor?: string
	readonly fillOpacity?: number
	readonly strokeOpacity?: number
	readonly strokeWidth?: number
	readonly radius?: number
	readonly lineDash?: MapPresentationLineDashV1
	readonly arrowStart?: boolean
	readonly arrowEnd?: boolean
	readonly displayIcon?: string
}

export type PresentationStyleOverrideV1 = MapPresentationStyleOverrideV1

/** One render instance. Layers are ordered bottom-to-top by their array order. */
export interface MapPresentationLayerV1 {
	readonly id: string
	readonly source: MapPresentationSource
	/** Absent means the complete source Map; an empty array means no features. */
	readonly featureIds?: readonly string[]
	readonly visible: boolean
	readonly opacityMultiplier: number
	readonly style?: MapPresentationStyleOverrideV1
}

export type PresentationLayerId = string
export type PresentationLayerV1 = MapPresentationLayerV1

export interface MapPresentationV1 {
	readonly version: typeof MAP_PRESENTATION_VERSION
	readonly initialView?: MapPresentationCameraV1
	readonly layers: readonly MapPresentationLayerV1[]
}

export type StoryViewDisplayV1 = 'cue' | 'figure' | 'both'

export interface StoryViewLayerPatchV1 {
	readonly visible?: boolean
	readonly opacityMultiplier?: number
	readonly style?: MapPresentationStyleOverrideV1
}

/**
 * A parsed inline Story view block. Layer patches can only address the stable
 * local layer ids from the containing Story presentation.
 */
export interface StoryViewBlockV1 {
	readonly version: typeof MAP_PRESENTATION_VERSION
	readonly type: 'view'
	readonly id: string
	readonly title: string
	readonly caption?: string
	readonly display: StoryViewDisplayV1
	readonly camera?: MapPresentationCameraV1
	readonly layers?: Readonly<Record<string, StoryViewLayerPatchV1>>
}

export type MapPresentationIssueCode =
	| 'invalid-type'
	| 'missing-version'
	| 'unsupported-version'
	| 'invalid-camera'
	| 'invalid-layers'
	| 'layer-limit'
	| 'invalid-layer-id'
	| 'duplicate-layer-id'
	| 'invalid-source'
	| 'invalid-feature-selector'
	| 'duplicate-feature-id'
	| 'invalid-visible'
	| 'invalid-opacity'
	| 'invalid-style'
	| 'unknown-style-key'
	| 'invalid-view'
	| 'unknown-layer-id'

export interface MapPresentationIssue {
	readonly code: MapPresentationIssueCode
	/** JSONPath-like location in the untrusted value. */
	readonly path: string
	readonly message: string
}

export type MapPresentationParseResult =
	| {
			readonly status: 'valid'
			readonly value: MapPresentationV1
			readonly issues: readonly MapPresentationIssue[]
	  }
	| {
			readonly status: 'absent'
			readonly issues: readonly []
	  }
	| {
			readonly status: 'unsupported'
			readonly version: unknown
			/** Kept verbatim so unrelated edits can round-trip future schemas. */
			readonly raw: unknown
			readonly issues: readonly MapPresentationIssue[]
	  }
	| {
			readonly status: 'invalid'
			readonly raw: unknown
			readonly issues: readonly MapPresentationIssue[]
	  }

export type StoryViewBlockParseResult =
	| {
			readonly status: 'valid'
			readonly value: StoryViewBlockV1
			readonly issues: readonly MapPresentationIssue[]
	  }
	| {
			readonly status: 'unsupported'
			readonly version: unknown
			readonly raw: unknown
			readonly issues: readonly MapPresentationIssue[]
	  }
	| {
			readonly status: 'invalid'
			readonly raw: unknown
			readonly issues: readonly MapPresentationIssue[]
	  }

export interface EffectiveStoryViewStateV1 {
	readonly camera?: MapPresentationCameraV1
	readonly layers: readonly MapPresentationLayerV1[]
}

export interface StoryViewSnapshotV1 {
	readonly view: StoryViewBlockV1
	readonly state: EffectiveStoryViewStateV1
}

export interface StoryViewReductionResultV1 {
	readonly initialState: EffectiveStoryViewStateV1
	readonly snapshots: readonly StoryViewSnapshotV1[]
	readonly issues: readonly MapPresentationIssue[]
}
