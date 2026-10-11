import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type NostrEvent } from 'nostr-tools'
import {
	type MapSnapshot,
	DEFAULT_VIEW,
	validateMapData,
	viewOptionsSchema,
} from '@/features/public-map/model'
import { GeoDatasetFactory } from '@/lib/nostr/geo-event/datasetFactory'
import { getDatasetId, type GeoDatasetEvent } from '@/lib/nostr/geo-event/helpers'
import { requirePublishAcknowledgement } from '@/lib/nostr/publishAcknowledgement'
import { mapUrl } from './references'

export interface MapGateway {
	read(reference: string): Promise<NostrEvent | null>
	publish(event: NostrEvent): Promise<Array<{ from: string; ok: boolean; message?: string }>>
	relays: string[]
}

interface Draft {
	snapshot: MapSnapshot & { draftId: string; revision: number; expiresAt: number }
	key?: Uint8Array
	previous?: GeoDatasetEvent
	pending?: GeoDatasetEvent
	publishing?: Promise<MapSnapshot>
}

/** Process-local guest editing capabilities; transport reconnects do not revoke them. */
export class PublicMapDraftStore {
	private drafts = new Map<string, Draft>()
	constructor(private limit = 1280) {}
	get size() {
		this.sweep()
		return this.drafts.size
	}
	get(id: string) {
		this.sweep()
		return this.drafts.get(id)
	}
	set(id: string, draft: Draft) {
		this.sweep()
		if (!this.drafts.has(id) && this.drafts.size >= this.limit)
			throw new Error('Guest map capacity reached; try again later')
		this.drafts.set(id, draft)
	}
	sweep() {
		for (const [id, draft] of this.drafts) {
			if (Date.now() < draft.snapshot.expiresAt) continue
			draft.key?.fill(0)
			this.drafts.delete(id)
		}
	}
	dispose() {
		for (const draft of this.drafts.values()) draft.key?.fill(0)
		this.drafts.clear()
	}
}

/** A connection may resume a draft only by presenting its unguessable draftId capability. */
export class PublicMapSession {
	private drafts: PublicMapDraftStore
	private ownsStore: boolean
	private created = 0
	constructor(
		private gateway: MapGateway,
		private baseUrl: string,
		readonly expiresAt: number,
		store?: PublicMapDraftStore,
	) {
		this.ownsStore = !store
		this.drafts = store ?? new PublicMapDraftStore()
	}

	private assertActive() {
		if (Date.now() >= this.expiresAt) {
			this.dispose()
			throw new Error(
				'Editing session expired. Published maps remain readable; create a new copy to continue.',
			)
		}
	}

	preview(input: {
		title: string
		description?: string
		data: unknown
		draftId?: string
		revision?: number
		view?: unknown
	}): MapSnapshot {
		this.assertActive()
		const existing = input.draftId ? this.getDraft(input.draftId, input.revision) : undefined
		if (existing?.publishing) throw new Error('Publication is in progress. Wait before editing.')
		if (existing?.pending && !existing.snapshot.reference)
			throw new Error(
				'The previous publication has an uncertain outcome. Retry that revision before editing.',
			)
		if (!existing && this.created >= 20)
			throw new Error('This session has reached its 20-map limit')
		const data = validateMapData(input.data)
		const snapshot = {
			title: input.title,
			description: input.description ?? '',
			data,
			view: viewOptionsSchema.parse(input.view ?? existing?.snapshot.view ?? DEFAULT_VIEW),
			draftId: input.draftId ?? crypto.randomUUID(),
			revision: (existing?.snapshot.revision ?? 0) + 1,
			expiresAt: existing?.snapshot.expiresAt ?? this.expiresAt,
		}
		this.drafts.set(snapshot.draftId, {
			snapshot,
			key: existing?.key,
			previous: existing?.previous,
		})
		if (!existing) this.created++
		return structuredClone(snapshot)
	}

	private getDraft(id: string, revision?: number): Draft {
		this.assertActive()
		const draft = this.drafts.get(id)
		if (!draft) throw new Error('Draft not found or expired. Create a new preview to continue.')
		if (draft.snapshot.revision !== revision)
			throw new Error('Draft revision changed. Preview the current content before publishing.')
		return draft
	}

	publish(id: string, revision: number): Promise<MapSnapshot> {
		const draft = this.getDraft(id, revision)
		if (draft.snapshot.reference) return Promise.resolve(structuredClone(draft.snapshot))
		if (draft.publishing) return draft.publishing
		const promise = this.commit(draft).finally(() => {
			draft.publishing = undefined
		})
		draft.publishing = promise
		return promise
	}

	private async commit(draft: Draft): Promise<MapSnapshot> {
		if (draft.previous) {
			const reference = nip19.naddrEncode({
				kind: draft.previous.kind,
				pubkey: draft.previous.pubkey,
				identifier: getDatasetId(draft.previous)!,
				relays: this.gateway.relays,
			})
			const observed = await this.gateway.read(reference)
			if (observed && observed.id !== draft.previous.id && observed.id !== draft.pending?.id) {
				throw new Error('A different published revision was observed. Read it before continuing.')
			}
		}
		if (!draft.pending) {
			draft.key ??= generateSecretKey()
			const key = draft.key
			const builder = draft.previous
				? GeoDatasetFactory.update(draft.previous, draft.snapshot.data)
				: GeoDatasetFactory.create(draft.snapshot.data)
			draft.pending = await builder
				.modifyPublicTags((tags) => [
					...tags.filter((tag) => !['title', 'description'].includes(tag[0] ?? '')),
					['title', draft.snapshot.title],
					['description', draft.snapshot.description],
				])
				.relayHints(this.gateway.relays)
				.withDerivedMetadata()
				.sign({
					getPublicKey: async () => getPublicKey(key),
					signEvent: async (template) => finalizeEvent(template, key),
				})
		}
		// Keep this exact signed event on failure, including uncertain relay outcomes.
		const event = draft.pending
		const receipts = await this.gateway.publish(event)
		requirePublishAcknowledgement(receipts)
		const reference = nip19.naddrEncode({
			kind: event.kind,
			pubkey: event.pubkey,
			identifier: getDatasetId(event)!,
			relays: receipts.filter((receipt) => receipt.ok).map((receipt) => receipt.from),
		})
		draft.previous = event
		draft.snapshot = {
			...draft.snapshot,
			reference,
			eventId: event.id,
			shareUrl: mapUrl(this.baseUrl, reference).href,
		}
		return structuredClone(draft.snapshot)
	}

	dispose() {
		if (this.ownsStore) this.drafts.dispose()
	}
}
