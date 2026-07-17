import type { BlobDescriptor, EventTemplate, SignedEvent, Signer } from 'blossom-client-sdk'

const BLOSSY_V02_EMPTY_HASH = '0'.repeat(64)

export type BlossomFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface BlossomUploadCompatOptions {
	signer: Signer
	message?: string
	expiration?: number
	signal?: AbortSignal
	onAuthCreated?: (auth: SignedEvent) => void
	fetchImpl?: BlossomFetch
}

async function sha256Hex(blob: Blob): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function encodeStandardAuthorization(auth: SignedEvent): string {
	const bytes = new TextEncoder().encode(JSON.stringify(auth))
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return `Nostr ${btoa(binary)}`
}

async function responseError(response: Response): Promise<Error> {
	const reason = response.headers.get('X-Reason')?.trim()
	let body = ''
	try {
		body = (await response.text()).trim()
	} catch {
		// A response body is optional; preserve the status and X-Reason when unreadable.
	}
	const details = [reason, body].filter(
		(value, index, values) => value && values.indexOf(value) === index,
	)
	const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
	return new Error(
		`Blossom upload failed (${status})${details.length ? `: ${details.join(' — ')}` : ''}`,
	)
}

/**
 * Authenticated Blossom upload with a temporary blossy v0.2.2 compatibility tag.
 *
 * blossy v0.2.2 validates PUT auth against the zero-value hash while HEAD uses
 * the real hash. Keep both `x` tags until that server bug is no longer deployed.
 */
export async function uploadBlobWithBlossyV02Compat(
	servers: string | URL | readonly (string | URL)[],
	blob: Blob,
	options: BlossomUploadCompatOptions,
): Promise<BlobDescriptor> {
	const sha256 = await sha256Hex(blob)
	const draft: EventTemplate = {
		created_at: Math.floor(Date.now() / 1000),
		kind: 24242,
		content: options.message ?? 'Upload Blob',
		tags: [
			['t', 'upload'],
			['expiration', String(options.expiration ?? Math.floor(Date.now() / 1000) + 60 * 60)],
			['x', sha256],
			['x', BLOSSY_V02_EMPTY_HASH],
		],
	}
	const auth = await options.signer(draft)
	options.onAuthCreated?.(auth)

	const authorization = encodeStandardAuthorization(auth)
	const targets = Array.isArray(servers) ? servers : [servers]
	const fetchImpl = options.fetchImpl ?? globalThis.fetch
	let lastError: unknown

	for (const server of targets) {
		try {
			const response = await fetchImpl(new URL('/upload', server), {
				method: 'PUT',
				body: blob,
				signal: options.signal,
				headers: {
					Authorization: authorization,
					'Content-Type': blob.type || 'application/octet-stream',
					'X-SHA-256': sha256,
				},
			})
			if (!response.ok) throw await responseError(response)
			return (await response.json()) as BlobDescriptor
		} catch (error) {
			lastError = error
		}
	}

	if (lastError instanceof Error) throw lastError
	throw new Error('No Blossom server available')
}
