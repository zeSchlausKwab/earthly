import type { ISigner } from 'applesauce-signers'
import { accounts } from '@/lib/nostr'
import { receiveCashuToken, withSpendLock } from '@/lib/wallet/actions'
import { normalizeEndpoint } from './connections'

const PREFIX = 'earthly.routstr-payment.v1.'
export const ROUTSTR_PAYMENTS_CHANGED = 'earthly:routstr-payments-changed'
interface PaymentRecord {
	id: string
	baseUrl: string
	token: string
	refund?: string
}
type Owner = { pubkey: string; signer: ISigner }
const key = (pubkey: string, id: string) => `${PREFIX}${pubkey}.${id}`
const changed = () => {
	if (typeof window !== 'undefined') window.dispatchEvent(new Event(ROUTSTR_PAYMENTS_CHANGED))
}

export function pendingRoutstrPaymentKeys(pubkey: string): string[] {
	if (typeof localStorage === 'undefined') return []
	return Object.keys(localStorage).filter((name) => name.startsWith(`${PREFIX}${pubkey}.`))
}

async function save(owner: Owner, record: PaymentRecord): Promise<void> {
	if (!owner.signer.nip44) throw new Error('NIP-44 is required to protect wallet payment recovery')
	const ciphertext = await owner.signer.nip44.encrypt(owner.pubkey, JSON.stringify(record))
	localStorage.setItem(key(owner.pubkey, record.id), ciphertext)
	changed()
}

export async function fetchCashuRefund(baseUrl: string, token: string): Promise<string | null> {
	const response = await fetch(`${normalizeEndpoint(baseUrl)}/balance/refund`, {
		method: 'POST',
		headers: { 'X-Cashu': token },
		signal: AbortSignal.timeout(20_000),
	})
	if (!response.ok) throw new CashuRefundError(response.status)
	const data = await response.json()
	const refund = response.headers.get('X-Cashu') || data.token
	return typeof refund === 'string' && refund.length ? refund : null
}

export class CashuRefundError extends Error {
	constructor(readonly status: number) {
		super(
			status === 425
				? 'Routstr is still preparing the refund. Recover it later in Wallet tools.'
				: `Routstr refund is pending (HTTP ${status}). Use Wallet tools to recover it.`,
		)
	}
}

/** A durable encrypted receipt is created before an outbound token leaves Earthly. */
export function createRoutstrPayment(owner: Owner, baseUrl: string) {
	const record: PaymentRecord = {
		id: crypto.randomUUID(),
		baseUrl: normalizeEndpoint(baseUrl),
		token: '',
	}
	return {
		async prepare(token: string) {
			record.token = token
			await save(owner, record)
		},
		async settle(refund?: string | null): Promise<string | null> {
			if (!record.token) return null
			if (refund) {
				record.refund = refund
				await save(owner, record)
			}
			return settleRecord(owner, record)
		},
	}
}

async function settleRecord(
	owner: Owner,
	record: PaymentRecord,
	reclaimUnsent = false,
): Promise<string | null> {
	return withSpendLock(async () => {
		if (accounts.active?.pubkey !== owner.pubkey)
			throw new Error('Switch back to the paying account to recover its Routstr payment')
		// Another tab or a previous recovery may have completed while this operation waited.
		if (!localStorage.getItem(key(owner.pubkey, record.id))) return null
		let token = record.refund
		if (!token) {
			try {
				token = (await fetchCashuRefund(record.baseUrl, record.token)) ?? undefined
			} catch (error) {
				if (reclaimUnsent && error instanceof CashuRefundError && error.status === 404)
					token = record.token
				else throw error
			}
			if (!token)
				throw new Error('No refund token yet. The encrypted payment receipt has been kept.')
			record.refund = token
			await save(owner, record)
		}
		if (accounts.active?.pubkey !== owner.pubkey)
			throw new Error('Payment recovery belongs to another account')
		await receiveCashuToken(token)
		localStorage.removeItem(key(owner.pubkey, record.id))
		changed()
		return token
	})
}

export async function recoverRoutstrPayments(): Promise<{ recovered: number; pending: number }> {
	const owner = accounts.active
	if (!owner?.signer.nip44) throw new Error('Sign in with a NIP-44 signer to recover payments')
	let recovered = 0
	let pending = 0
	for (const name of pendingRoutstrPaymentKeys(owner.pubkey)) {
		try {
			const ciphertext = localStorage.getItem(name)
			if (!ciphertext) continue
			const record: PaymentRecord = JSON.parse(
				await owner.signer.nip44.decrypt(owner.pubkey, ciphertext),
			)
			if (key(owner.pubkey, record.id) !== name || !record.token)
				throw new Error('Invalid payment receipt')
			if (await settleRecord(owner, record, true)) recovered += 1
		} catch {
			pending += 1
		}
	}
	return { recovered, pending }
}
