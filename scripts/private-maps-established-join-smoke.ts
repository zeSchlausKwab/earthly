import assert from 'node:assert/strict'
import type { NostrSigner } from '@contextvm/sdk'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type {
	CoordinatorMessage,
	PendingJoinRequest,
	PendingWelcome,
	PrivateWorkspaceCoordinator,
	PublishedKeyPackage,
} from '../src/lib/private-workspace/contracts'
import {
	parseWorkspaceCheckpointManifest,
	PRIVATE_WORKSPACE_CHECKPOINT_KIND,
} from '../src/lib/private-workspace/checkpoint'
import { PrivateWorkspaceService } from '../src/lib/private-workspace/service'
import { MemoryPrivateWorkspaceStore } from '../src/lib/private-workspace/storage'
import { GEO_COMMENT_KIND, GEO_EVENT_KIND } from '../src/lib/nostr/kinds'

type StoredWelcome = PendingWelcome & { targetPubkey: string }

class InMemoryCordnServer {
	private clock = 0
	private readonly keyPackages = new Map<string, PublishedKeyPackage>()
	private readonly joinRequests = new Map<string, PendingJoinRequest[]>()
	private readonly welcomes: StoredWelcome[] = []
	private readonly messages = new Map<string, CoordinatorMessage[]>()
	private readonly suppressedFetches = new Set<string>()

	setFetchSuppressed(pubkey: string, suppressed: boolean): void {
		if (suppressed) this.suppressedFetches.add(pubkey)
		else this.suppressedFetches.delete(pubkey)
	}

	client(signer: NostrSigner): PrivateWorkspaceCoordinator {
		const ownerPubkey = () => signer.getPublicKey()
		return {
			publishKeyPackage: async ({ kp_ref, kp_64 }) => {
				const pk = await ownerPubkey()
				const at = ++this.clock
				const event = await signer.signEvent({
					kind: 27524,
					created_at: at,
					tags: [],
					content: JSON.stringify({ params: { arguments: { kp_64 } } }),
				})
				this.keyPackages.set(kp_ref, { pk, kp_ref, last_resort: false, at, event })
				return { kp_ref, last_resort: false, at }
			},
			listKeyPackages: async () => ({
				keyPackages: [...this.keyPackages.values()].map(({ event: _event, ...item }) => item),
			}),
			takeKeyPackage: async ({ id }) => {
				const keyPackage = this.keyPackages.get(id) ?? null
				if (keyPackage) this.keyPackages.delete(id)
				return { keyPackage }
			},
			removeKeyPackages: async ({ kp_refs }) => {
				for (const ref of kp_refs) this.keyPackages.delete(ref)
				return { kp_refs }
			},
			takeWelcomes: async ({ consumed } = {}) => {
				const pk = await ownerPubkey()
				for (const item of consumed ?? []) {
					const index = this.welcomes.findIndex(
						(welcome) =>
							welcome.targetPubkey === pk &&
							welcome.kp_ref === item.kp_ref &&
							welcome.at === item.at,
					)
					if (index >= 0) this.welcomes.splice(index, 1)
				}
				return {
					welcomes: this.welcomes
						.filter((welcome) => welcome.targetPubkey === pk)
						.map(({ targetPubkey: _targetPubkey, ...welcome }) => welcome),
				}
			},
			storeWelcome: async ({ target_pk, kp_ref, welcome_64, after }) => {
				const at = ++this.clock
				this.welcomes.push({ targetPubkey: target_pk, kp_ref, welcome_64, after, at })
				return { at }
			},
			storeJoinRequest: async ({ gid, kp_ref }) => {
				const published = this.keyPackages.get(kp_ref)
				if (!published) throw new Error('Missing published KeyPackage')
				const at = ++this.clock
				const requests = this.joinRequests.get(gid) ?? []
				requests.push({ pk: published.pk, kp_ref, at })
				this.joinRequests.set(gid, requests)
				return { at }
			},
			takeJoinRequests: async ({ gid, consumed }) => {
				let requests = this.joinRequests.get(gid) ?? []
				for (const item of consumed ?? []) {
					requests = requests.filter(
						(request) => request.pk !== item.pk || request.at !== item.at,
					)
				}
				this.joinRequests.set(gid, requests)
				return { requests: [...requests] }
			},
			postMessage: async ({ gid, msg_64 }) => {
				const messages = this.messages.get(gid) ?? []
				const cursor = (messages.at(-1)?.cursor ?? 0) + 1
				const at = ++this.clock
				messages.push({ cursor, gid, msg_64, at, encrypted: true })
				this.messages.set(gid, messages)
				return { cursor, gid, at }
			},
			fetchMessages: async ({ gid, after }) => {
				const pk = await ownerPubkey()
				if (this.suppressedFetches.has(pk)) return { messages: [] }
				return {
					messages: (this.messages.get(gid) ?? []).filter(
						(message) => message.cursor > (after ?? 0),
					),
				}
			},
			disconnect: async () => undefined,
		}
	}
}

function testSigner() {
	const secretKey = generateSecretKey()
	const pubkey = getPublicKey(secretKey)
	return {
		pubkey,
		signer: {
			getPublicKey: async () => pubkey,
			signEvent: async (event: Parameters<typeof finalizeEvent>[0]) =>
				finalizeEvent(event, secretKey),
		} as unknown as NostrSigner,
	}
}

const cordn = new InMemoryCordnServer()
const alice = testSigner()
const bob = testSigner()
const carol = testSigner()

function service(identity: ReturnType<typeof testSigner>) {
	return new PrivateWorkspaceService({
		signer: identity.signer,
		store: new MemoryPrivateWorkspaceStore(),
		coordinatorPubkey: 'f'.repeat(64),
		relays: ['ws://localhost:3334'],
		createCoordinator: () => cordn.client(identity.signer),
	})
}

const aliceService = service(alice)
const bobService = service(bob)
const carolService = service(carol)
const workspace = await aliceService.createWorkspace({ name: 'Established field map' })
const datasetId = 'ridge-survey'
const oldDataset = await aliceService.sendDataset(
	workspace.workspaceId,
	{
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [16.37, 48.2] },
				properties: { revision: 1 },
			},
		],
	},
	{ datasetId, name: 'Ridge survey old' },
)
// Model a coordinator that durably acknowledges Alice's writes but does not
// immediately expose their echoes back to Alice. Approval must still include
// acknowledged local records in the late-member checkpoint.
cordn.setFetchSuppressed(alice.pubkey, true)
const currentDataset = await aliceService.sendDataset(
	workspace.workspaceId,
	{
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: { type: 'LineString', coordinates: [[16.37, 48.2], [16.38, 48.21]] },
				properties: { revision: 2 },
			},
		],
	},
	{ datasetId, name: 'Ridge survey current' },
)
await aliceService.sendComment(workspace.workspaceId, 'Discussion before either member joined')
const [aliceBeforeJoin] = await aliceService.listWorkspaces()
assert(aliceBeforeJoin)
const expectedCheckpointBasis = Math.max(
	aliceBeforeJoin.cursor,
	...(aliceBeforeJoin.pendingOutbound ?? []).map((item) => item.cursor),
)

async function join(
	joiningService: PrivateWorkspaceService,
	joiningPubkey: string,
): Promise<void> {
	const invitation = await aliceService.createInvitation(workspace.workspaceId)
	await joiningService.requestToJoin(invitation)
	const request = (await aliceService.fetchJoinRequests(workspace.workspaceId)).find(
		(item) => item.pk === joiningPubkey,
	)
	assert(request)
	await aliceService.approveJoinRequest(request)
	assert.equal((await joiningService.acceptPendingWelcomes()).length, 1)
}

await join(bobService, bob.pubkey)
cordn.setFetchSuppressed(alice.pubkey, false)
const [joinedBobWorkspace] = await bobService.listWorkspaces()
assert(joinedBobWorkspace)
const bobCheckpoint = joinedBobWorkspace.envelopes.find(
	(envelope) => envelope.kind === PRIVATE_WORKSPACE_CHECKPOINT_KIND,
)
assert(bobCheckpoint)
assert.equal(parseWorkspaceCheckpointManifest(bobCheckpoint.content).basisCursor, expectedCheckpointBasis)
assert.deepEqual(
	joinedBobWorkspace.envelopes
		.filter((item) => item.kind === GEO_EVENT_KIND)
		.map((item) => item.id),
	[currentDataset.id],
)
assert.equal(
	joinedBobWorkspace.envelopes.some((item) => item.kind === GEO_COMMENT_KIND),
	false,
)
const bobDataset = await bobService.sendDataset(
	workspace.workspaceId,
	{
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [16.39, 48.22] },
				properties: { owner: 'bob' },
			},
		],
	},
	{ datasetId: 'camp', name: 'Camp' },
)
await aliceService.syncWorkspace(workspace.workspaceId)

await join(carolService, carol.pubkey)
const [carolWorkspace] = await carolService.listWorkspaces()
assert(carolWorkspace)
const checkpoint = carolWorkspace.envelopes.find(
	(envelope) => envelope.kind === PRIVATE_WORKSPACE_CHECKPOINT_KIND,
)
assert(checkpoint, 'new member must receive a checkpoint manifest')
const manifest = parseWorkspaceCheckpointManifest(checkpoint.content)
assert(manifest.basisCursor > 0)
assert(manifest.envelopeIds.includes(currentDataset.id))
assert(manifest.envelopeIds.includes(bobDataset.id))
assert.equal(manifest.envelopeIds.includes(oldDataset.id), false)
const carolDatasets = carolWorkspace.envelopes.filter(
	(envelope) => envelope.kind === GEO_EVENT_KIND,
)
assert.equal(carolDatasets.length, 2)
assert(carolDatasets.some((envelope) => envelope.id === currentDataset.id))
assert.equal(
	carolWorkspace.envelopes.some((envelope) => envelope.kind === GEO_COMMENT_KIND),
	false,
	'checkpoint v1 must not disclose discussion history',
)

await bobService.syncWorkspace(workspace.workspaceId)
const [bobWorkspace] = await bobService.listWorkspaces()
assert(bobWorkspace)
assert.equal(bobWorkspace.envelopes.filter((item) => item.kind === GEO_EVENT_KIND).length, 2)

await aliceService.removeMember(workspace.workspaceId, carol.pubkey)
await aliceService.sendChat(workspace.workspaceId, 'After Carol was removed')
const removedCarol = await carolService.syncWorkspace(workspace.workspaceId)
assert.equal(removedCarol.status, 'removed')
assert.equal(
	removedCarol.envelopes.some((envelope) => envelope.content === 'After Carol was removed'),
	false,
)

console.log('private maps established-workspace join smoke test passed')
