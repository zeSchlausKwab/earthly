import type { WalletConnect } from 'applesauce-wallet-connect'
import { firstValueFrom, timeout } from 'rxjs'

/** Bound capability discovery too: the RPC timeout starts only after discovery. */
export function readWalletSupport(wallet: Pick<WalletConnect, 'support$'>, timeoutMs = 15_000) {
	return firstValueFrom(wallet.support$.pipe(timeout(timeoutMs)))
}
