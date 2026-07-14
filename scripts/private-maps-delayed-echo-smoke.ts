import assert from 'node:assert/strict'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { NostrSigner } from '@contextvm/sdk'
import type {
	CoordinatorMessage,
	PrivateWorkspaceCoordinator,
} from '../src/lib/private-workspace/contracts'
import { createPrivateEnvelope } from '../src/lib/private-workspace/envelope'
import {
	createWorkspaceApplicationMessage,
	deserializeClientState,
	sealCoordinatorPayload,
} from '../src/lib/private-workspace/mls'
import { PrivateWorkspaceService } from '../src/lib/private-workspace/service'
import { MemoryPrivateWorkspaceStore } from '../src/lib/private-workspace/storage'

class DelayedEchoCoordinator {
	private cursor = 0
	private suppressFetches = 0
	private nextPostFetchSuppressions = 1
	private readonly messages: CoordinatorMessage[] = []

	suppressNextPostFetches(count: number): void {
		this.nextPostFetchSuppressions = count
	}

	readonly client = {
		postMessage: async ({ gid, msg_64 }: { gid: string; msg_64: string }) => {
			const cursor = ++this.cursor
			this.messages.push({ cursor, gid, msg_64, at: cursor, encrypted: true })
			this.suppressFetches = this.nextPostFetchSuppressions
			this.nextPostFetchSuppressions = 1
			return { cursor, gid, at: cursor }
		},
		fetchMessages: async ({ gid, after }: { gid: string; after?: number }) => {
			if (this.suppressFetches > 0) {
				this.suppressFetches -= 1
				return { messages: [] }
			}
			return {
				messages: this.messages.filter(
					(message) => message.gid === gid && message.cursor > (after ?? 0),
				),
			}
		},
		disconnect: async () => undefined,
	} as unknown as PrivateWorkspaceCoordinator
}

const secretKey = generateSecretKey()
const pubkey = getPublicKey(secretKey)
const signer = {
	getPublicKey: async () => pubkey,
	signEvent: async (event: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(event, secretKey),
} as unknown as NostrSigner
const coordinator = new DelayedEchoCoordinator()
const service = new PrivateWorkspaceService({
	signer,
	store: new MemoryPrivateWorkspaceStore(),
	coordinatorPubkey: 'f'.repeat(64),
	relays: ['ws://localhost:3334'],
	createCoordinator: () => coordinator.client,
})

const workspace = await service.createWorkspace({ name: 'Delayed echo' })
// Hide both the post-cursor ordering check and the immediate echo
// reconciliation. The next user/background sync must confirm it.
coordinator.suppressNextPostFetches(2)
await service.sendChat(workspace.workspaceId, 'survives a delayed coordinator echo')

const beforeEcho = (await service.listWorkspaces())[0]
assert(beforeEcho)
assert.equal(beforeEcho.envelopes.length, 0)

const afterEcho = await service.syncWorkspace(workspace.workspaceId)
assert.equal(afterEcho.envelopes.length, 1)
assert.equal(afterEcho.envelopes[0]?.content, 'survives a delayed coordinator echo')
assert.equal(afterEcho.cursor, 1)

const orphanCoordinator = new DelayedEchoCoordinator()
const orphanStore = new MemoryPrivateWorkspaceStore()
const orphanService = new PrivateWorkspaceService({
	signer,
	store: orphanStore,
	coordinatorPubkey: 'f'.repeat(64),
	relays: ['ws://localhost:3334'],
	createCoordinator: () => orphanCoordinator.client,
})
const orphanWorkspace = await orphanService.createWorkspace({ name: 'Previous failed send' })
const orphanState = deserializeClientState(orphanWorkspace.stateBase64)
const orphanEnvelope = await createPrivateEnvelope({
	signer,
	groupId: orphanWorkspace.groupId,
	pubkey,
	kind: 9,
	content: 'recovers an untracked self echo',
})
const orphanOutbound = await createWorkspaceApplicationMessage({
	state: orphanState,
	envelope: orphanEnvelope,
})
await orphanCoordinator.client.postMessage({
	gid: orphanWorkspace.groupId,
	msg_64: await sealCoordinatorPayload(orphanState, orphanOutbound.messageBase64),
})

await orphanService.syncWorkspace(orphanWorkspace.workspaceId)
const recoveredOrphan = await orphanService.syncWorkspace(orphanWorkspace.workspaceId)
assert.equal(recoveredOrphan.envelopes.length, 1)
assert.equal(recoveredOrphan.envelopes[0]?.content, 'recovers an untracked self echo')
assert.equal(recoveredOrphan.cursor, 1)

console.log('private maps delayed coordinator echo smoke test passed')
