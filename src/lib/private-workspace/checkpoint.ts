import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import type { PrivateWorkspaceEnvelope } from './envelope'
import { acceptedAdministratorPolicyEnvelopes, reduceAdministratorPolicy } from './policy'
import type { StoredWorkspace } from './storage'

export const PRIVATE_WORKSPACE_CHECKPOINT_KIND = 37525
export const PRIVATE_WORKSPACE_CHECKPOINT_VERSION = 1
export const PRIVATE_WORKSPACE_CHECKPOINT_HISTORY = 'none'
const MAX_CHECKPOINT_ENVELOPES = 4_096
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/u

export interface WorkspaceCheckpointManifest {
	version: typeof PRIVATE_WORKSPACE_CHECKPOINT_VERSION
	basisCursor: number
	history: typeof PRIVATE_WORKSPACE_CHECKPOINT_HISTORY
	envelopeIds: string[]
}

function identifier(envelope: PrivateWorkspaceEnvelope): string | undefined {
	return envelope.tags.find((tag) => tag[0] === 'd')?.[1]
}

/**
 * Select the authenticated records that define the current private map for a
 * newly added member. Discussion history is deliberately not part of v1.
 */
export function currentMapCheckpointEnvelopes(
	workspace: Pick<StoredWorkspace, 'adminPubkey' | 'envelopes'>,
): PrivateWorkspaceEnvelope[] {
	const policy = reduceAdministratorPolicy(workspace.adminPubkey, workspace.envelopes)
	const acceptedPolicyIds = new Set(
		acceptedAdministratorPolicyEnvelopes(policy, workspace.envelopes).map((item) => item.id),
	)
	const latestDatasetIds = new Set<string>()
	const latestDatasetByCoordinate = new Map<string, PrivateWorkspaceEnvelope>()

	for (const envelope of workspace.envelopes) {
		if (envelope.kind !== GEO_EVENT_KIND) continue
		const d = identifier(envelope)
		if (!d) continue
		latestDatasetByCoordinate.set(`${envelope.pubkey}:${d}`, envelope)
	}
	for (const envelope of latestDatasetByCoordinate.values()) latestDatasetIds.add(envelope.id)

	return workspace.envelopes.filter(
		(envelope) => acceptedPolicyIds.has(envelope.id) || latestDatasetIds.has(envelope.id),
	)
}

function validateManifest(value: unknown): WorkspaceCheckpointManifest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid private workspace checkpoint manifest')
	}
	const candidate = value as Record<string, unknown>
	if (
		candidate.version !== PRIVATE_WORKSPACE_CHECKPOINT_VERSION ||
		!Number.isSafeInteger(candidate.basisCursor) ||
		(candidate.basisCursor as number) < 0 ||
		candidate.history !== PRIVATE_WORKSPACE_CHECKPOINT_HISTORY ||
		!Array.isArray(candidate.envelopeIds) ||
		candidate.envelopeIds.length > MAX_CHECKPOINT_ENVELOPES ||
		!candidate.envelopeIds.every(
			(id): id is string => typeof id === 'string' && EVENT_ID_PATTERN.test(id),
		)
	) {
		throw new Error('Invalid private workspace checkpoint manifest')
	}
	const envelopeIds = candidate.envelopeIds as string[]
	if (new Set(envelopeIds).size !== envelopeIds.length) {
		throw new Error('Private workspace checkpoint envelope ids must be unique')
	}
	return {
		version: PRIVATE_WORKSPACE_CHECKPOINT_VERSION,
		basisCursor: candidate.basisCursor as number,
		history: PRIVATE_WORKSPACE_CHECKPOINT_HISTORY,
		envelopeIds: [...envelopeIds],
	}
}

export function createWorkspaceCheckpointManifest(input: {
	basisCursor: number
	envelopeIds: string[]
}): WorkspaceCheckpointManifest {
	return validateManifest({
		version: PRIVATE_WORKSPACE_CHECKPOINT_VERSION,
		basisCursor: input.basisCursor,
		history: PRIVATE_WORKSPACE_CHECKPOINT_HISTORY,
		envelopeIds: input.envelopeIds,
	})
}

export function parseWorkspaceCheckpointManifest(content: string): WorkspaceCheckpointManifest {
	return validateManifest(JSON.parse(content) as unknown)
}
