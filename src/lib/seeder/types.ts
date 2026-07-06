import type { SeederConfig } from './config'
import type { SeedIdentity } from './identities'
import type { SeedRelayClient } from './relay/publish'

/** Everything a scenario needs: parsed config, relay client, and the signing owner. */
export interface SeederContext {
	config: SeederConfig
	client: SeedRelayClient
	/** Identity derived from the resolved signing key (devUser1 by default). */
	owner: SeedIdentity
}

export type SeedScenario = (ctx: SeederContext) => Promise<void>
