import { isTauri } from '@/config/platform'

/** NIP-07 browser extensions are available only in the web app. */
export function shouldOfferNip07Login(): boolean {
	return !isTauri()
}
