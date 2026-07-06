/**
 * Factory + delete helper for kind 37518 (Group / Topic Event — slimmed).
 *
 * Extends the shared `EntityFactory` base (NOT raw `EventFactory`) for the
 * bare-sign-function contract the Wave-0 tests pin. `create()` injects the
 * SPEC-03 `modelVersion` discriminator (stripping any caller-supplied value,
 * then re-asserting the current one last so it can never be forced to a stale
 * value) and generates a `d` tag only if absent; `modify()` reuses
 * `toEventTemplate(event)` and never regenerates `d` (no lineage fork — comments
 * and reactions stay attached, Pitfall 4). All tag setters delegate to the
 * shared `tags.ts` transformers (SPEC-02) — no copy-pasted write bodies.
 */

import { blankEventTemplate, DeleteFactory, toEventTemplate } from 'applesauce-core/factories'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'nostr-tools'
import { generateShortDTag } from '@/lib/nostr/dTag'
import { EntityFactory } from '@/lib/nostr/entityFactory'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
import { MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import { publish } from '..'
import {
	setBbox,
	setContextRefs,
	setGeohash,
	setHashtags,
	setLabels,
	setReferencedAddresses,
	setSchemaHash,
} from '@/lib/nostr/tags'
import {
	DEFAULT_GROUP_CONTENT,
	getGroupId,
	type GroupContent,
	type GroupEvent,
	isGroup,
} from './helpers'

export class GroupFactory extends EntityFactory<typeof MAP_CONTEXT_KIND> {
	/** Start a new Group from a content object. */
	static create(content: Partial<GroupContent> = {}): GroupFactory {
		return new GroupFactory((resolve) => {
			const tpl = blankEventTemplate(MAP_CONTEXT_KIND)
			// modelVersion (SPEC-03) is authoritative — strip any caller-supplied
			// value, then re-assert the current one so it can never be overridden.
			const { modelVersion: _ignored, ...rest } = content
			tpl.content = JSON.stringify({
				...DEFAULT_GROUP_CONTENT,
				...rest,
				modelVersion: MODEL_VERSION,
			})
			if (!tpl.tags.some((t) => t[0] === 'd')) {
				tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
			}
			resolve(tpl)
		})
	}

	/** Continue editing an existing Group (preserves d-tag). */
	static modify(event: GroupEvent): GroupFactory {
		if (!isGroup(event)) {
			throw new Error('GroupFactory.modify: event is not a kind 37518 group')
		}
		return new GroupFactory((resolve) => resolve(toEventTemplate(event)))
	}

	/** Replace the content payload (re-asserts modelVersion). */
	group(content: Partial<GroupContent>): this {
		return this.chain((tpl) => {
			let parsed: Partial<GroupContent>
			try {
				parsed = JSON.parse(tpl.content) as Partial<GroupContent>
			} catch {
				parsed = {}
			}
			return {
				...tpl,
				content: JSON.stringify({
					...DEFAULT_GROUP_CONTENT,
					...parsed,
					...content,
					modelVersion: MODEL_VERSION,
				}),
			}
		})
	}

	bbox(box: GeoBoundingBox | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => setBbox(tags, box))
	}

	geohash(centroid: [number, number] | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => setGeohash(tags, centroid))
	}

	hashtags(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setHashtags(tags, values))
	}

	labels(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setLabels(tags, values))
	}

	/** Foreign (`c`) contribution-lane references. */
	contextReferences(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setContextRefs(tags, values))
	}

	/** Curated (`a`) lane — the owner's pinned/blessed addressable references (D-03). */
	referencedAddresses(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setReferencedAddresses(tags, values))
	}

	/** Replace the canonical schema-hash tag (delegates to tags.ts). */
	schemaHash(value: string | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => setSchemaHash(tags, value))
	}
}

/** Publish a NIP-09 deletion event for a Group the active account owns. */
export async function deleteGroup(
	group: GroupEvent,
	signer: EventSigner,
	reason?: string,
): Promise<void> {
	const id = getGroupId(group)
	if (!id) throw new Error('Group is missing a d tag and cannot be deleted.')
	const event = await DeleteFactory.fromEvents([group], reason).sign(signer)
	await publish(event as NostrEvent, { routing: 'outbox' })
}
