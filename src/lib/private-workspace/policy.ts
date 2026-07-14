import type { PrivateWorkspaceEnvelope } from './envelope'

export const PRIVATE_WORKSPACE_ADMIN_POLICY_KIND = 37524
export const PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION = 1

export interface AdministratorPolicyTransition {
	version: typeof PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION
	revision: number
	previous: string | null
	administrators: string[]
}

export interface AdministratorPolicyState {
	version: typeof PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION
	rootAdminPubkey: string
	revision: number
	head: string | null
	administrators: string[]
	acceptedEnvelopeIds: string[]
	rejected: Array<{ envelopeId: string; reason: string }>
}

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/u

function canonicalAdministrators(values: string[]): string[] {
	return [...new Set(values)].sort()
}

function sameValues(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function changedAdministrators(before: string[], after: string[]): string[] {
	const beforeSet = new Set(before)
	const afterSet = new Set(after)
	return [
		...before.filter((pubkey) => !afterSet.has(pubkey)),
		...after.filter((pubkey) => !beforeSet.has(pubkey)),
	]
}

export function initialAdministratorPolicy(rootAdminPubkey: string): AdministratorPolicyState {
	if (!PUBKEY_PATTERN.test(rootAdminPubkey)) {
		throw new Error('Administrator policy root must be a lowercase Nostr pubkey')
	}
	return {
		version: PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION,
		rootAdminPubkey,
		revision: 0,
		head: null,
		administrators: [rootAdminPubkey],
		acceptedEnvelopeIds: [],
		rejected: [],
	}
}

export function parseAdministratorPolicyTransition(
	envelope: PrivateWorkspaceEnvelope,
): AdministratorPolicyTransition {
	if (envelope.kind !== PRIVATE_WORKSPACE_ADMIN_POLICY_KIND) {
		throw new Error('Envelope is not an administrator-policy transition')
	}

	const parsed = JSON.parse(envelope.content) as Record<string, unknown>
	if (
		parsed.version !== PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION ||
		!Number.isSafeInteger(parsed.revision) ||
		(parsed.revision as number) < 1 ||
		(parsed.previous !== null && typeof parsed.previous !== 'string') ||
		!Array.isArray(parsed.administrators) ||
		!parsed.administrators.every(
			(pubkey): pubkey is string => typeof pubkey === 'string' && PUBKEY_PATTERN.test(pubkey),
		)
	) {
		throw new Error('Invalid administrator-policy transition')
	}

	const administrators = parsed.administrators as string[]
	if (
		administrators.length === 0 ||
		!sameValues(administrators, canonicalAdministrators(administrators))
	) {
		throw new Error('Administrator-policy pubkeys must be unique and canonically sorted')
	}

	return {
		version: PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION,
		revision: parsed.revision as number,
		previous: parsed.previous as string | null,
		administrators,
	}
}

export function reduceAdministratorPolicy(
	rootAdminPubkey: string,
	envelopes: readonly PrivateWorkspaceEnvelope[],
): AdministratorPolicyState {
	const state = initialAdministratorPolicy(rootAdminPubkey)
	const seen = new Set<string>()

	for (const envelope of envelopes) {
		if (envelope.kind !== PRIVATE_WORKSPACE_ADMIN_POLICY_KIND || seen.has(envelope.id)) continue
		seen.add(envelope.id)

		try {
			const transition = parseAdministratorPolicyTransition(envelope)
			if (!state.administrators.includes(envelope.pubkey)) {
				throw new Error('Policy author was not an administrator at the previous revision')
			}
			if (transition.revision !== state.revision + 1) {
				throw new Error('Policy revision does not extend the current revision')
			}
			if (transition.previous !== state.head) {
				throw new Error('Policy transition does not extend the current head')
			}
			if (changedAdministrators(state.administrators, transition.administrators).length !== 1) {
				throw new Error('A policy transition must promote or demote exactly one administrator')
			}

			state.revision = transition.revision
			state.head = envelope.id
			state.administrators = transition.administrators
			state.acceptedEnvelopeIds.push(envelope.id)
		} catch (error) {
			state.rejected.push({
				envelopeId: envelope.id,
				reason: error instanceof Error ? error.message : 'Invalid administrator-policy transition',
			})
		}
	}

	return state
}

export function createAdministratorPolicyTransition(
	state: AdministratorPolicyState,
	input: { pubkey: string; administrator: boolean },
): AdministratorPolicyTransition {
	if (!PUBKEY_PATTERN.test(input.pubkey)) throw new Error('Invalid administrator pubkey')
	const current = state.administrators.includes(input.pubkey)
	if (current === input.administrator) {
		throw new Error(
			input.administrator
				? 'This member is already an administrator'
				: 'This member is not an administrator',
		)
	}
	if (!input.administrator && state.administrators.length === 1) {
		throw new Error('A private group must retain at least one administrator')
	}

	const administrators = canonicalAdministrators(
		input.administrator
			? [...state.administrators, input.pubkey]
			: state.administrators.filter((pubkey) => pubkey !== input.pubkey),
	)
	return {
		version: PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION,
		revision: state.revision + 1,
		previous: state.head,
		administrators,
	}
}

export function acceptedAdministratorPolicyEnvelopes(
	state: AdministratorPolicyState,
	envelopes: readonly PrivateWorkspaceEnvelope[],
): PrivateWorkspaceEnvelope[] {
	const accepted = new Set(state.acceptedEnvelopeIds)
	return envelopes.filter((envelope) => accepted.has(envelope.id))
}
