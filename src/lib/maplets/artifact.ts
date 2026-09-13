import { validateEvent, verifyEvent, type NostrEvent } from 'nostr-tools'
import { validateMapletConfigSchema, type MapletConfigSchema, type MapletIdentity } from './config'

export const NIP_5D_REVISION = '24711d9c47bbdd07908bf1d52bf677d9cbc530f0'
export const MAPLET_KINDS = [5129, 15129, 35129] as const
export const MAPLET_DOMAINS = ['map', 'config', 'resource', 'link', 'identity'] as const
export const MAX_MAPLET_BYTES = 2 * 1024 * 1024
const HASH = /^[a-f0-9]{64}$/

export interface MapletManifest {
	id: string
	event: NostrEvent
	dTag: string
	title: string
	description: string
	requires: string[]
	unsupportedRequires: string[]
	configSchema?: MapletConfigSchema
}

export interface VerifiedMaplet {
	readonly identity: Readonly<MapletIdentity>
	readonly html: string
	readonly title: string
	readonly requires: readonly string[]
	readonly provenance: 'signed' | 'bundled'
	readonly manifest?: MapletManifest
	readonly configSchema?: MapletConfigSchema
}

const verifiedArtifacts = new WeakSet<object>()

export function assertVerifiedMaplet(artifact: VerifiedMaplet): void {
	if (!verifiedArtifacts.has(artifact)) throw new Error('Maplet must be verified before execution')
}

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
	const input = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes)
	const hash = await crypto.subtle.digest('SHA-256', input)
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** NIP-5A: sha256(sorted UTF-8 "<file sha256> <absolute path>\n" lines). */
export function computeMapletAggregate(paths: readonly (readonly string[])[]): Promise<string> {
	return sha256Hex(
		paths
			.map((tag) => `${tag[2]} ${tag[1]}\n`)
			.sort()
			.join(''),
	)
}

/** The config tag is Earthly's experimental static-schema carrier, not a new NIP kind. */
export function parseMapletManifest(input: unknown): MapletManifest {
	if (!validateEvent(input)) throw new Error('Invalid Nostr manifest')
	if (!MAPLET_KINDS.includes(input.kind as (typeof MAPLET_KINDS)[number]))
		throw new Error('Unsupported napplet manifest kind')
	if (
		input.tags.length > 256 ||
		input.content.length > 64 * 1024 ||
		input.tags.some((tag) => tag.length > 16 || tag.some((value) => value.length > 64 * 1024))
	)
		throw new Error('Manifest exceeds size limit')
	if (
		input.tags.reduce(
			(size, tag) => size + tag.reduce((total, value) => total + value.length, 0),
			0,
		) >
		128 * 1024
	)
		throw new Error('Manifest tags exceed size limit')
	// Fresh plain event avoids trusting nostr-tools verifiedSymbol caches on supplied objects.
	const event = JSON.parse(JSON.stringify(input)) as NostrEvent
	if (!verifyEvent(event)) throw new Error('Manifest signature is invalid')
	const dTags = event.tags.filter((tag) => tag[0] === 'd')
	if (event.kind === 35129 ? dTags.length !== 1 || !dTags[0]?.[1] : dTags.length !== 0)
		throw new Error('Invalid manifest identifier')
	const dTag = dTags[0]?.[1] ?? ''
	if (dTag.length > 256) throw new Error('Manifest identifier is too long')
	const requires = [
		...new Set(event.tags.filter((tag) => tag[0] === 'requires').map((tag) => tag[1] ?? '')),
	]
	if (requires.some((domain) => !/^[a-z][a-z0-9-]{0,63}$/.test(domain)))
		throw new Error('Invalid required domain')
	const staticSchema = event.tags.filter((tag) => tag[0] === 'config')
	if (staticSchema.length > 1) throw new Error('Multiple configuration schemas')
	const configSchema = staticSchema[0]?.[1]
		? validateMapletConfigSchema(JSON.parse(staticSchema[0][1]))
		: undefined
	return {
		id: event.kind === 5129 ? event.id : `${event.kind}:${event.pubkey}:${dTag}`,
		event,
		dTag,
		title: (event.tags.find((tag) => tag[0] === 'title')?.[1] || dTag || 'Untitled maplet').slice(
			0,
			160,
		),
		description: (event.tags.find((tag) => tag[0] === 'description')?.[1] ?? '').slice(0, 2000),
		requires,
		unsupportedRequires: requires.filter(
			(domain) => !(MAPLET_DOMAINS as readonly string[]).includes(domain),
		),
		configSchema,
	}
}

export function safeHttpsUrl(value: string): URL {
	if (value.length > 4096) throw new Error('URL is too long')
	const url = new URL(value)
	if (url.protocol !== 'https:' || url.username || url.password)
		throw new Error('Only credential-free HTTPS URLs are allowed')
	const host = url.hostname.toLowerCase()
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.includes(':') ||
		/^\d+(\.\d+){3}$/.test(host)
	)
		throw new Error('Local and IP-literal destinations are unavailable')
	return url
}

export interface VerifyMapletOptions {
	signal?: AbortSignal
	fetchBlob?: (hash: string, servers: string[], signal?: AbortSignal) => Promise<Uint8Array>
}

async function fetchManifestBlob(
	hash: string,
	servers: string[],
	signal?: AbortSignal,
): Promise<Uint8Array> {
	for (const server of servers.slice(0, 5)) {
		try {
			const base = safeHttpsUrl(server)
			base.search = ''
			base.hash = ''
			const url = new URL(`${base.pathname.replace(/\/$/, '')}/${hash}`, base.origin)
			const response = await fetch(url, {
				signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
				credentials: 'omit',
				referrerPolicy: 'no-referrer',
				redirect: 'error',
			})
			if (!response.ok || !response.body) throw new Error('Artifact download failed')
			const reader = response.body.getReader()
			const chunks: Uint8Array[] = []
			let length = 0
			try {
				while (true) {
					const next = await reader.read()
					if (next.done) break
					length += next.value.byteLength
					if (length > MAX_MAPLET_BYTES) throw new Error('Maplet exceeds size limit')
					chunks.push(next.value)
				}
			} finally {
				await reader.cancel()
			}
			const bytes = new Uint8Array(length)
			let offset = 0
			for (const chunk of chunks) {
				bytes.set(chunk, offset)
				offset += chunk.byteLength
			}
			if ((await sha256Hex(bytes)) !== hash) throw new Error('Maplet file hash mismatch')
			return bytes
		} catch (error) {
			if (signal?.aborted) throw error
		}
	}
	throw new Error('Could not retrieve a verified maplet from its Blossom servers')
}

function sealArtifact(artifact: VerifiedMaplet): VerifiedMaplet {
	Object.freeze(artifact.identity)
	Object.freeze(artifact.requires)
	verifiedArtifacts.add(artifact)
	return Object.freeze(artifact)
}

export async function verifyMapletManifest(
	input: unknown,
	options: VerifyMapletOptions = {},
): Promise<VerifiedMaplet> {
	const manifest = parseMapletManifest(input)
	if (manifest.unsupportedRequires.length)
		throw new Error(`Unsupported capabilities: ${manifest.unsupportedRequires.join(', ')}`)
	const paths = manifest.event.tags.filter((tag) => tag[0] === 'path')
	if (paths.length !== 1 || paths[0]?.[1] !== '/index.html')
		throw new Error('This release must contain one self-contained /index.html')
	const fileHash = paths[0]?.[2] ?? ''
	if (!HASH.test(fileHash)) throw new Error('Invalid maplet file hash')
	const aggregates = manifest.event.tags.filter((tag) => tag[0] === 'x')
	if (
		aggregates.length > 1 ||
		aggregates.some((tag) => !HASH.test(tag[1] ?? '') || tag[2] !== 'aggregate')
	)
		throw new Error('Invalid aggregate hash tag')
	if (
		manifest.event.kind === 5129 &&
		(aggregates.length !== 1 || manifest.event.tags.filter((tag) => tag[0] === 'a').length !== 1)
	)
		throw new Error('Snapshot needs an aggregate and parent reference')
	const aggregateHash = await computeMapletAggregate(paths)
	if (aggregates[0] && aggregates[0][1] !== aggregateHash)
		throw new Error('Maplet aggregate hash mismatch')
	options.signal?.throwIfAborted()
	const servers = manifest.event.tags
		.filter((tag) => tag[0] === 'server')
		.map((tag) => tag[1] ?? '')
	const bytes = await (options.fetchBlob ?? fetchManifestBlob)(fileHash, servers, options.signal)
	options.signal?.throwIfAborted()
	if (bytes.byteLength > MAX_MAPLET_BYTES) throw new Error('Maplet exceeds size limit')
	if ((await sha256Hex(bytes)) !== fileHash) throw new Error('Maplet file hash mismatch')
	const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	return sealArtifact({
		identity: { dTag: manifest.dTag, aggregateHash },
		html,
		title: manifest.title,
		requires: manifest.requires,
		provenance: 'signed',
		manifest,
		configSchema: manifest.configSchema,
	})
}

/** Deliberately separate from Nostr publication: bundled code has no invented publisher/signature. */
export async function prepareBundledMaplet(options: {
	id: string
	html: string
	title?: string
	requires?: readonly string[]
	configSchema?: MapletConfigSchema
}): Promise<VerifiedMaplet> {
	const bytes = new TextEncoder().encode(options.html)
	if (bytes.byteLength > MAX_MAPLET_BYTES) throw new Error('Bundled maplet exceeds size limit')
	const fileHash = await sha256Hex(bytes)
	const aggregateHash = await computeMapletAggregate([['path', '/index.html', fileHash]])
	return sealArtifact({
		identity: { dTag: `bundled:${options.id}`, aggregateHash },
		html: options.html,
		title: options.title ?? options.id,
		requires: [...(options.requires ?? ['map', 'config', 'resource'])],
		provenance: 'bundled',
		configSchema: options.configSchema
			? validateMapletConfigSchema(options.configSchema)
			: undefined,
	})
}
