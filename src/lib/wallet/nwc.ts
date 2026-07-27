import { WalletConnect } from 'applesauce-wallet-connect'
import { parseWalletConnectURI } from 'applesauce-wallet-connect/helpers'
import { allowRelays, pool } from '@/lib/nostr'
import { loadUserData, removeUserData, saveUserData } from './storage'

const NWC_STORAGE_KEY = 'earthly:nwc-connection'
export const NWC_CONNECTION_CHANGE_EVENT = 'earthly:nwc-connection-change'

export interface NwcConnectionDetails {
	uri: string
	service: string
	relays: string[]
	lud16?: string
}

function emitConnectionChange(): void {
	if (typeof window !== 'undefined') window.dispatchEvent(new Event(NWC_CONNECTION_CHANGE_EVENT))
}

/** Parse and normalize an NIP-47 connection URI without contacting its relay. */
export function parseNwcConnection(uri: string): NwcConnectionDetails {
	const normalized = uri.trim()
	const parsed = parseWalletConnectURI(normalized)
	return {
		uri: normalized,
		service: parsed.service,
		relays: parsed.relays,
		lud16: parsed.lud16,
	}
}

export function loadNwcConnection(pubkey: string): NwcConnectionDetails | null {
	const stored = loadUserData<NwcConnectionDetails | null>(NWC_STORAGE_KEY, null, pubkey)
	if (!stored?.uri) return null
	try {
		return parseNwcConnection(stored.uri)
	} catch {
		return null
	}
}

export function saveNwcConnection(uri: string, pubkey: string): NwcConnectionDetails {
	const connection = parseNwcConnection(uri)
	// Constructing the client validates the service pubkey and connection secret
	// before we retain a QR payload that can never connect.
	createNwcClient(connection)
	saveUserData(NWC_STORAGE_KEY, connection, pubkey)
	emitConnectionChange()
	return connection
}

export function removeNwcConnection(pubkey: string): void {
	removeUserData(NWC_STORAGE_KEY, pubkey)
	emitConnectionChange()
}

export function createNwcClient(connection: NwcConnectionDetails): WalletConnect {
	// NWC relays are explicitly supplied and approved by the user in the QR/URI.
	// Vouch for them so the development WebSocket guard permits this wallet-only traffic.
	allowRelays(connection.relays)
	return WalletConnect.fromConnectURI(connection.uri, {
		pool,
		timeout: 15_000,
	})
}

export async function getNwcWalletStatus(connection: NwcConnectionDetails): Promise<{
	canPay: boolean
	balanceSats?: number
}> {
	const wallet = createNwcClient(connection)
	const canPay = await wallet.supportsMethod('pay_invoice')
	let balanceSats: number | undefined
	if (await wallet.supportsMethod('get_balance')) {
		const result = await wallet.getBalance()
		balanceSats = Math.floor(result.balance / 1000)
	}
	return { canPay, balanceSats }
}

export async function payInvoiceWithNwc(
	connection: NwcConnectionDetails,
	invoice: string,
): Promise<void> {
	const wallet = createNwcClient(connection)
	if (!(await wallet.supportsMethod('pay_invoice'))) {
		throw new Error('This NWC wallet does not allow invoice payments.')
	}
	await wallet.payInvoice(invoice)
}
