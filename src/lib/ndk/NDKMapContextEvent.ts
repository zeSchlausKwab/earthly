import NDK, { NDKEvent, NDKKind, type NDKSigner, registerEventClass } from '@nostr-dev-kit/react'
import { MAP_CONTEXT_KIND } from './kinds'
import type { GeoBoundingBox } from './NDKGeoEvent'
import { generateShortDTag } from './dTag'

export type MapContextUse = 'taxonomy' | 'validation' | 'hybrid'
export type MapContextValidationMode = 'none' | 'optional' | 'required'
export const MAP_CONTEXT_GEOMETRY_TYPES = [
	'Point',
	'MultiPoint',
	'LineString',
	'MultiLineString',
	'Polygon',
	'MultiPolygon',
	'GeometryCollection',
] as const
export type MapContextGeometryType = (typeof MAP_CONTEXT_GEOMETRY_TYPES)[number]

export interface MapContextGeometryConstraints {
	allowedTypes: MapContextGeometryType[]
}

export interface MapContextContent {
	name: string
	description?: string
	descriptionFormat?: 'markdown'
	references?: string[]
	image?: string
	contextUse: MapContextUse
	validationMode: MapContextValidationMode
	allowForeignAttachments?: boolean
	geometryConstraints?: MapContextGeometryConstraints
	schemaDialect?: string
	schema?: Record<string, unknown>
}

const DEFAULT_CONTENT: MapContextContent = {
	name: '',
	descriptionFormat: 'markdown',
	contextUse: 'taxonomy',
	validationMode: 'none',
	allowForeignAttachments: false,
}

export class NDKMapContextEvent extends NDKEvent {
	static kinds = [MAP_CONTEXT_KIND]

	static from(event: NDKEvent): NDKMapContextEvent {
		const wrapped = new NDKMapContextEvent(event.ndk, event)
		wrapped.kind = event.kind ?? MAP_CONTEXT_KIND
		return wrapped
	}

	get context(): MapContextContent {
		if (!this.content) return { ...DEFAULT_CONTENT }
		try {
			const parsed = JSON.parse(this.content) as Partial<MapContextContent>
			return { ...DEFAULT_CONTENT, ...parsed }
		} catch {
			return { ...DEFAULT_CONTENT }
		}
	}

	set context(value: MapContextContent) {
		this.content = JSON.stringify(value)
	}

	get contextId(): string | undefined {
		return this.dTag
	}

	set contextId(value: string | undefined) {
		this.dTag = value
	}

	get contextCoordinate(): string | undefined {
		const contextId = this.contextId
		if (!contextId || !this.pubkey) return undefined
		const kind = this.kind ?? MAP_CONTEXT_KIND
		return `${kind}:${this.pubkey}:${contextId}`
	}

	get boundingBox(): GeoBoundingBox | undefined {
		const raw = this.tagValue('bbox')
		if (!raw) return undefined
		const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()))
		if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
			return undefined
		}
		return parts as GeoBoundingBox
	}

	set boundingBox(bbox: GeoBoundingBox | undefined) {
		this.replaceOptionalTag('bbox', bbox ? bbox.join(',') : undefined)
	}

	get relayHints(): string[] {
		return this.tags
			.filter((tag) => tag[0] === 'r')
			.flatMap((tag) => (typeof tag[1] === 'string' ? [tag[1]] : []))
	}

	set relayHints(relays: string[] | undefined) {
		this.removeTag('r')
		relays?.forEach((relay) => {
			this.tags.push(['r', relay])
		})
	}

	get hashtags(): string[] {
		return this.tags
			.filter((tag) => tag[0] === 't')
			.flatMap((tag) => (typeof tag[1] === 'string' ? [tag[1]] : []))
	}

	set hashtags(tags: string[] | undefined) {
		this.removeTag('t')
		tags?.forEach((tag) => {
			this.tags.push(['t', tag])
		})
	}

	get version(): string | undefined {
		return this.tagValue('v')
	}

	set version(value: string | undefined) {
		this.replaceOptionalTag('v', value)
	}

	get contextReferences(): string[] {
		return this.tags
			.filter((tag) => tag[0] === 'c')
			.flatMap((tag) => (typeof tag[1] === 'string' && tag[1] ? [tag[1]] : []))
	}

	set contextReferences(contexts: string[] | undefined) {
		this.removeTag('c')
		contexts?.forEach((value) => {
			if (value) {
				this.tags.push(['c', value])
			}
		})
	}

	get referencedAddresses(): string[] {
		return this.tags
			.filter((tag) => tag[0] === 'a')
			.flatMap((tag) => (typeof tag[1] === 'string' && tag[1] ? [tag[1]] : []))
	}

	get schemaHash(): string | undefined {
		return this.tagValue('schema-hash')
	}

	set schemaHash(value: string | undefined) {
		this.replaceOptionalTag('schema-hash', value)
	}

	get parentContextCoordinate(): string | undefined {
		return this.tagValue('parent')
	}

	set parentContextCoordinate(value: string | undefined) {
		this.replaceOptionalTag('parent', value)
	}

	ensureContextId(): string {
		if (!this.contextId) {
			this.contextId = generateShortDTag()
		}
		return this.contextId
	}

	private replaceOptionalTag(tagName: string, value: string | undefined) {
		this.removeTag(tagName)
		if (value !== undefined) {
			this.tags.push([tagName, value])
		}
	}

	private async prepareForPublish(signer?: NDKSigner): Promise<void> {
		this.kind = MAP_CONTEXT_KIND
		this.ensureContextId()
		this.created_at = Math.floor(Date.now() / 1000)
		await this.sign(signer)
	}

	async publishNew(signer?: NDKSigner): Promise<NDKMapContextEvent> {
		await this.prepareForPublish(signer)
		await this.publish()
		return this
	}

	static async deleteContext(
		ndk: NDK,
		context: NDKMapContextEvent,
		reason?: string,
		signer?: NDKSigner,
	): Promise<void> {
		const contextId = context.contextId ?? context.dTag
		if (!contextId) {
			throw new Error('Context is missing a d tag and cannot be deleted.')
		}
		if (!context.pubkey) {
			throw new Error('Context is missing a pubkey and cannot be deleted.')
		}

		const contextKind = context.kind ?? MAP_CONTEXT_KIND
		const deletion = new NDKEvent(ndk)
		deletion.kind = NDKKind.EventDeletion
		deletion.content = reason ?? ''
		deletion.tags.push(['a', `${contextKind}:${context.pubkey}:${contextId}`])
		if (context.id) {
			deletion.tags.push(['e', context.id])
		}

		await deletion.sign(signer)
		await deletion.publish()
	}
}

registerEventClass(NDKMapContextEvent)
