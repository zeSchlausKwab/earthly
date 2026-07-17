import { describe, expect, it, mock } from 'bun:test'
import type { EventTemplate, SignedEvent, Signer } from 'blossom-client-sdk'
import { uploadBlobWithBlossyV02Compat } from './uploadCompat'

function testSigner(onDraft?: (draft: EventTemplate) => void): Signer {
	return async (draft) => {
		onDraft?.(draft)
		return {
			...draft,
			id: 'event-id',
			pubkey: 'test-pubkey',
			sig: 'test-signature',
		} as SignedEvent
	}
}

describe('uploadBlobWithBlossyV02Compat', () => {
	it('signs both real and v0.2.2 hashes and sends a standard-base64 direct PUT', async () => {
		const blob = new Blob(['earthly'], { type: 'application/geo+json' })
		const expectedHash = 'cd495693995f449975f44028a41306c974c38cf81186ec37effa31103cc437a1'
		const descriptor = {
			uploaded: 123,
			type: blob.type,
			sha256: expectedHash,
			size: blob.size,
			url: `https://blossom.example/${expectedHash}`,
		}
		let signedDraft: EventTemplate | undefined
		const fetchImpl = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(String(input)).toBe('https://blossom.example/upload')
			expect(init?.method).toBe('PUT')
			expect(init?.body).toBe(blob)
			const headers = new Headers(init?.headers)
			expect(headers.get('X-SHA-256')).toBe(expectedHash)
			expect(headers.get('Content-Type')).toBe(blob.type)

			const authorization = headers.get('Authorization')
			expect(authorization).toStartWith('Nostr ')
			const encoded = authorization?.slice('Nostr '.length) ?? ''
			expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
			expect(encoded.length % 4).toBe(0)
			expect(encoded).toEndWith('=')
			const decoded = JSON.parse(
				new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))),
			)
			expect(decoded.tags.filter((tag: string[]) => tag[0] === 'x')).toEqual([
				['x', expectedHash],
				['x', '0'.repeat(64)],
			])

			return Response.json(descriptor)
		})

		const result = await uploadBlobWithBlossyV02Compat('https://blossom.example/base', blob, {
			signer: testSigner((draft) => {
				signedDraft = draft
			}),
			message: 'Upload earthly',
			fetchImpl,
		})

		expect(signedDraft?.kind).toBe(24242)
		expect(signedDraft?.content).toBe('Upload earthly')
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(result).toEqual(descriptor)
	})

	it('surfaces the server X-Reason and response body', async () => {
		const fetchImpl = mock(
			async () =>
				new Response('event did not authorize this upload', {
					status: 401,
					headers: { 'X-Reason': 'invalid auth event' },
				}),
		)

		await expect(
			uploadBlobWithBlossyV02Compat('https://blossom.example', new Blob(['x']), {
				signer: testSigner(),
				fetchImpl,
			}),
		).rejects.toThrow('invalid auth event — event did not authorize this upload')
	})
})
