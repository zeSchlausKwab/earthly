/**
 * Blossom Upload Utility
 *
 * Uploads GeoJSON FeatureCollections to a Blossom server (BUD-02) with NIP-98
 * Nostr authentication signed by the active applesauce account.
 *
 * Replaces the previous NDK-based implementation. Uses `blossom-client-sdk`
 * for the actual HTTP + auth event construction.
 */

import { createUploadAuth, type Signer } from 'blossom-client-sdk'
import { uploadBlob } from 'blossom-client-sdk/actions/upload'
import type { FeatureCollection } from 'geojson'
import type { EventTemplate } from 'nostr-tools'
import { getBlossomServerUrl } from '@/features/geo-editor/constants'
import { accounts } from '@/lib/nostr'

export interface BlossomUploadResult {
	/** SHA-256 hash of the uploaded content */
	sha256: string
	/** Public URL to access the blob */
	url: string
	/** Size in bytes */
	size: number
}

export interface BlossomUploadOptions {
	/** Override the default Blossom server URL */
	blossomServer?: string
	/** Optional progress callback (0-100) */
	onProgress?: (percent: number) => void
}

/** Adapt the active applesauce signer to blossom-client-sdk's Signer type. */
function makeBlossomSigner(): Signer {
	const signer = accounts.signer
	if (!signer) {
		throw new Error('No active account — sign in to upload to Blossom')
	}
	return async (draft: EventTemplate) => {
		const signed = await signer.signEvent(draft)
		// blossom-client-sdk's SignedEvent shape matches nostr-tools NostrEvent
		return signed
	}
}

/**
 * Upload a GeoJSON FeatureCollection to a Blossom server.
 *
 * Returns the server's blob descriptor (sha256 + url + size). Throws with a
 * useful message on auth or server errors.
 */
export async function uploadGeoJsonToBlossom(
	geojson: FeatureCollection,
	options: BlossomUploadOptions = {},
): Promise<BlossomUploadResult> {
	const { blossomServer = getBlossomServerUrl(), onProgress } = options

	const jsonString = JSON.stringify(geojson)
	const data = new TextEncoder().encode(jsonString)
	const blob = new Blob([data], { type: 'application/geo+json' })
	const size = data.length

	onProgress?.(10)

	// blossom-client-sdk computes the sha256 itself when given a Blob, but
	// we sign the auth event over it explicitly so we control the message text.
	const auth = await createUploadAuth(makeBlossomSigner(), blob, {
		message: `Upload GeoJSON (${size} bytes)`,
		expiration: Math.floor(Date.now() / 1000) + 5 * 60,
	})

	onProgress?.(30)

	try {
		const result = await uploadBlob(blossomServer, blob, { auth })
		onProgress?.(100)
		return {
			sha256: result.sha256,
			url: result.url,
			size: result.size ?? size,
		}
	} catch (error) {
		if (error instanceof Error) throw error
		throw new Error('Failed to upload to Blossom server')
	}
}

/** Liveness probe for a Blossom server. */
export async function checkBlossomServer(blossomServer?: string): Promise<boolean> {
	const server = blossomServer ?? getBlossomServerUrl()
	try {
		const response = await fetch(server, { method: 'GET' })
		return response.ok
	} catch {
		return false
	}
}

/** Format bytes as a human-readable string. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
