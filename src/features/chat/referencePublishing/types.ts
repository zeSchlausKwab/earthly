import type { FeatureCollection } from 'geojson'
import type { NostrEvent } from 'nostr-tools'
import type { GeoBlobReference } from '@/lib/nostr/geo-event'
import type { PublishChannel } from '@/features/geo-editor/store'

/** Identity captured when a tool asks to publish before creating a reference. */
export interface ReferencePublishBinding {
	chatId: string
	toolCallId: string
	workspaceId: string
	draftId: string
	sourceId: string
	draftUpdatedAt: number
	baseRevisionId: string | null
	baseCoordinate: string | null
}

/**
 * An immutable publication payload. It deliberately contains no pointer back to
 * the currently active editor: changing workspace while the dialog is open must
 * not retarget the publish.
 */
export interface CapturedDatasetPublication {
	binding: ReferencePublishBinding
	title: string
	publishChannel: PublishChannel
	featureCollection: FeatureCollection
	contextReferences: string[]
	blobReferences: GeoBlobReference[]
	featureIds: string[]
	baseEvent: NostrEvent | null
}

export type DatasetPublicationMode = 'new' | 'update' | 'copy'

export interface PublishedDatasetReference {
	mode: DatasetPublicationMode
	datasetCoordinate: string
	datasetMention: string
	featureIds: string[]
	/** New datasets and copies receive a new address, so existing prose must be retried. */
	addressChanged: boolean
	eventId: string
}

export type ReferencePublishDecision =
	| { decision: 'cancelled' }
	| { decision: 'published'; published: PublishedDatasetReference }

export type DatasetReferenceEnsureResult =
	| {
			status: 'ready'
			published?: PublishedDatasetReference
			/** True when a retry consumed the publication receipt from an earlier tool turn. */
			resumedAfterPublication?: boolean
	  }
	| {
			status: 'blocked'
			code:
				| 'reference_publish_cancelled'
				| 'reference_publish_context_missing'
				| 'reference_publish_scope_incompatible'
				| 'reference_publish_source_unavailable'
			message: string
			retryable: boolean
	  }

export type StoryReferencePublicationGateResult =
	| DatasetReferenceEnsureResult
	| {
			status: 'retry'
			code: 'dataset_reference_published_with_new_address'
			message: string
			published: PublishedDatasetReference
	  }
