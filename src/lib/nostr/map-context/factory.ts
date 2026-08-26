/**
 * Factory + delete helper for kind 37518 (Map Context Event).
 *
 * MapContexts have a JSON content payload (taxonomy/validation rules) plus
 * a handful of optional discovery tags (`bbox`, `t`, `r`, `c`, `v`, etc.)
 * and an optional `parent` coordinate.
 */

import {
	blankEventTemplate,
	DeleteFactory,
	EventFactory,
	toEventTemplate,
} from 'applesauce-core/factories'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'nostr-tools'
import { generateShortDTag } from '@/lib/nostr/dTag'
import { MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { assertCanDeleteOwnedEntity } from '@/lib/nostr/deletion'
import { publish } from '..'
import {
	DEFAULT_CONTEXT_CONTENT,
	getContextId,
	isMapContext,
	type MapContextContent,
	type MapContextEvent,
} from './helpers'

export class MapContextFactory extends EventFactory<typeof MAP_CONTEXT_KIND> {
	/** Start a new MapContext from a content object. */
	static create(content: Partial<MapContextContent> = {}): MapContextFactory {
		return new MapContextFactory((resolve) => {
			const tpl = blankEventTemplate(MAP_CONTEXT_KIND)
			tpl.content = JSON.stringify({ ...DEFAULT_CONTEXT_CONTENT, ...content })
			if (!tpl.tags.some((t) => t[0] === 'd')) {
				tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
			}
			resolve(tpl)
		})
	}

	/** Continue editing an existing context (preserves d-tag). */
	static modify(event: MapContextEvent): MapContextFactory {
		if (!isMapContext(event)) {
			throw new Error('MapContextFactory.modify: event is not a kind 37518 context')
		}
		return new MapContextFactory((resolve) => resolve(toEventTemplate(event)))
	}

	/** Replace the content payload (merges over the defaults). */
	context(content: Partial<MapContextContent>): this {
		return this.chain((tpl) => {
			let parsed: Partial<MapContextContent>
			try {
				parsed = JSON.parse(tpl.content) as Partial<MapContextContent>
			} catch {
				parsed = {}
			}
			return {
				...tpl,
				content: JSON.stringify({ ...DEFAULT_CONTEXT_CONTENT, ...parsed, ...content }),
			}
		})
	}

	/** Replace the bbox tag explicitly. */
	bbox(box: [number, number, number, number] | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => {
			const filtered = tags.filter((t) => t[0] !== 'bbox')
			return box ? [...filtered, ['bbox', box.join(',')]] : filtered
		})
	}

	hashtags(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => [
			...tags.filter((t) => t[0] !== 't'),
			...values.map((value) => ['t', value]),
		])
	}

	relayHints(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => [
			...tags.filter((t) => t[0] !== 'r'),
			...values.map((value) => ['r', value]),
		])
	}

	contextReferences(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => [
			...tags.filter((t) => t[0] !== 'c'),
			...values.filter(Boolean).map((value) => ['c', value]),
		])
	}

	version(value: string | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => {
			const filtered = tags.filter((t) => t[0] !== 'v')
			return value ? [...filtered, ['v', value]] : filtered
		})
	}

	schemaHash(value: string | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => {
			const filtered = tags.filter((t) => t[0] !== 'schema-hash')
			return value ? [...filtered, ['schema-hash', value]] : filtered
		})
	}

	parentContextCoordinate(value: string | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => {
			const filtered = tags.filter((t) => t[0] !== 'parent')
			return value ? [...filtered, ['parent', value]] : filtered
		})
	}

	/** Replace `a`-tag references to other addressable events. */
	referencedAddresses(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => [
			...tags.filter((t) => t[0] !== 'a'),
			...values.filter(Boolean).map((value) => ['a', value]),
		])
	}
}

/** Publish a NIP-09 deletion event for a context the active account owns. */
export async function deleteMapContext(
	context: MapContextEvent,
	signer: EventSigner,
	reason?: string,
): Promise<void> {
	const id = getContextId(context)
	if (!id) throw new Error('Context is missing a d tag and cannot be deleted.')
	await assertCanDeleteOwnedEntity(context, signer, 'Context')
	const event = await DeleteFactory.fromEvents([context], reason).sign(signer)
	await publish(event as NostrEvent, { routing: 'outbox' })
}
