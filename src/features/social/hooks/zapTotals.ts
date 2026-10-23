import { getZapAmount, getZapRequest } from 'applesauce-common/helpers'
import { getNutzapAmount, isValidNutzap, NUTZAP_KIND } from 'applesauce-wallet/helpers'
import type { NostrEvent } from 'nostr-tools'

/** Receipt totals are amounts declared in valid receipts, not a wallet balance.
 * BOLT11 amounts are millisats; NIP-61 proof amounts use the event's unit. */
export function zapTotals(events: NostrEvent[], pubkey?: string) {
	let zapAmount = 0
	let zapCount = 0
	let userHasZapped = false
	for (const event of events) {
		try {
			let sats: number | undefined
			let sender: string | undefined
			if (event.kind === NUTZAP_KIND) {
				if (!isValidNutzap(event)) continue
				const unit = event.tags.find((tag) => tag[0] === 'unit')?.[1] ?? 'sat'
				const amount = getNutzapAmount(event)
				sats =
					amount === undefined
						? undefined
						: unit === 'sat'
							? amount
							: unit === 'msat'
								? amount / 1000
								: undefined
				sender = event.pubkey
			} else if (event.kind === 9735) {
				const request = getZapRequest(event)
				if (!request) continue
				const millisats = getZapAmount(event)
				sats = millisats === undefined ? undefined : millisats / 1000
				sender = request.pubkey
			}
			if (sats === undefined || !Number.isFinite(sats) || sats <= 0) continue
			zapAmount += sats
			zapCount++
			if (pubkey && sender === pubkey) userHasZapped = true
		} catch {
			/* Malformed receipts must not break the discussion. */
		}
	}
	return { zapAmount, zapCount, userHasZapped }
}
