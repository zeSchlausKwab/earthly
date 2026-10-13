import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { decodeMapReference } from '@/features/public-map/references'
import { validateMapData } from '@/features/public-map/model'

/** Require the loaded, signed public event to match the selected route. */
export function canEmbedDataset(
	reference: string | null | undefined,
	event: NostrEvent | undefined,
	restricted: boolean,
): boolean {
	if (restricted || !reference || !event || event.tags.some((tag) => tag[0] === 'h')) return false
	try {
		const pointer = decodeMapReference(reference)
		return (
			event.kind === pointer.kind &&
			event.pubkey === pointer.pubkey &&
			event.tags.some((tag) => tag[0] === 'd' && tag[1] === pointer.identifier) &&
			// Verify the current fields without inheriting nostr-tools' cached verdict symbol.
			verifyEvent({
				id: event.id,
				kind: event.kind,
				pubkey: event.pubkey,
				created_at: event.created_at,
				tags: event.tags,
				content: event.content,
				sig: event.sig,
			})
		)
	} catch {
		return false
	}
}

const UNSUPPORTED =
	'This dataset is not supported by the embed viewer. It currently accepts inline point, line and polygon data up to 300 features and 48 KiB. Simplify or split the dataset, or share its link instead.'

export function datasetEmbedProblem(event: NostrEvent): string | null {
	if (event.tags.some((tag) => tag[0] === 'blob')) {
		return 'This dataset uses external files. The embed viewer currently supports inline datasets only. Share its link instead.'
	}
	try {
		validateMapData(JSON.parse(event.content))
		return null
	} catch {
		return UNSUPPORTED
	}
}

/** Read through the same gateway as the iframe; local availability alone is insufficient. */
export async function checkDatasetEmbed(
	baseUrl: string,
	reference: string,
	signal: AbortSignal,
): Promise<void> {
	decodeMapReference(reference)
	const response = await fetch(new URL(`/api/maps/${encodeURIComponent(reference)}`, baseUrl), {
		signal,
		credentials: 'omit',
		cache: 'no-store',
	})
	let result: unknown
	try {
		result = await response.json()
	} catch {
		throw new Error('The embed service returned an unreadable response. Try again later.')
	}
	const snapshot = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
	if (!response.ok) {
		if (typeof snapshot.error === 'string' && snapshot.error.includes('inline')) {
			throw new Error(UNSUPPORTED)
		}
		throw new Error(
			'The embed service could not read this dataset. It may be unavailable on the supported relays or use data this viewer cannot display. Try again or share its Earthly link.',
		)
	}
	if (
		snapshot.reference !== reference ||
		typeof snapshot.title !== 'string' ||
		typeof snapshot.description !== 'string' ||
		typeof snapshot.eventId !== 'string'
	) {
		throw new Error('The embed service returned an invalid map. Try again later.')
	}
	try {
		validateMapData(snapshot.data)
	} catch {
		throw new Error(UNSUPPORTED)
	}
}
