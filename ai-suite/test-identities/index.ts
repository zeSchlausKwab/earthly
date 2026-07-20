import { devUser1, devUser2, devUser3 } from '../../src/lib/fixtures'

/** A deterministic signer fixture with no behavioral persona assumptions. */
export interface TestIdentity {
	id: 'owner' | 'mara' | 'tomas'
	displayName: string
	publicKey: string
	secretKeyHex: string
}

export const testIdentities = {
	owner: {
		id: 'owner',
		displayName: 'Earthly Curator',
		publicKey: devUser1.pk,
		secretKeyHex: devUser1.sk,
	},
	mara: {
		id: 'mara',
		displayName: 'Mara Holzer',
		publicKey: devUser2.pk,
		secretKeyHex: devUser2.sk,
	},
	tomas: {
		id: 'tomas',
		displayName: 'Tomas Veit',
		publicKey: devUser3.pk,
		secretKeyHex: devUser3.sk,
	},
} as const satisfies Record<string, TestIdentity>

export type TestIdentityId = keyof typeof testIdentities
