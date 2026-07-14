import { verifyEvent, type NostrEvent } from 'nostr-tools'
import type { NostrSigner } from '@contextvm/sdk'
import type { FeatureCollection } from 'geojson'
import { GEO_COMMENT_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import type { PendingJoinRequest, PrivateWorkspaceCoordinator } from './contracts'
import {
	createWorkspaceCheckpointManifest,
	currentMapCheckpointEnvelopes,
	parseWorkspaceCheckpointManifest,
	PRIVATE_WORKSPACE_CHECKPOINT_KIND,
} from './checkpoint'
import { createPrivateEnvelope, type PrivateWorkspaceEnvelope } from './envelope'
import {
	decodeKeyPackage,
	decodePrivateKeyPackage,
	credentialPubkeyFromKeyPackage,
	addWorkspaceMember,
	createForwardedWorkspaceApplicationMessage,
	createWorkspaceApplicationMessage,
	createWorkspaceGroup,
	deserializeClientState,
	generateMlsKeyPackage,
	groupIdFromState,
	joinWorkspaceGroup,
	memberPubkeysFromState,
	openCoordinatorPayload,
	processWorkspaceMessage,
	removeWorkspaceMember,
	sealCoordinatorPayload,
	serializeClientState,
} from './mls'
import {
	createAdministratorPolicyTransition,
	PRIVATE_WORKSPACE_ADMIN_POLICY_KIND,
	reduceAdministratorPolicy,
	type AdministratorPolicyState,
} from './policy'
import {
	decodePrivateMapInvitation,
	encodePrivateMapInvitation,
	type PrivateMapInvitation,
} from './invitation'
import type {
	PendingWorkspaceApproval,
	PendingWorkspaceApprovalMessage,
	PendingWorkspaceJoin,
	PrivateWorkspaceStore,
	StoredMlsKeyPackage,
	StoredWorkspace,
	WorkspaceMetadata,
} from './storage'

export const PRIVATE_WORKSPACE_METADATA_KIND = 37523
export const PRIVATE_WORKSPACE_CHAT_KIND = 9

type CoordinatorFactory = (options: {
	serverPubkey: string
	relays: string[]
	signer: NostrSigner
}) => PrivateWorkspaceCoordinator

export interface PrivateWorkspaceServiceOptions {
	signer: NostrSigner
	store: PrivateWorkspaceStore
	coordinatorPubkey: string
	relays: string[]
	createCoordinator: CoordinatorFactory
	now?: () => number
}

export interface WorkspaceJoinRequest extends PendingJoinRequest {
	workspaceId: string
}

export interface WorkspaceSyncResult {
	workspace: StoredWorkspace
	changed: boolean
}

function publicationKeyPackageBase64(event: NostrEvent): string {
	const content = JSON.parse(event.content) as {
		params?: { arguments?: { kp_64?: unknown; keyPackageBase64?: unknown } }
	}
	const value = content.params?.arguments?.kp_64 ?? content.params?.arguments?.keyPackageBase64
	if (typeof value !== 'string')
		throw new Error('KeyPackage publication event does not contain kp_64')
	return value
}

function readMetadata(envelope: PrivateWorkspaceEnvelope): WorkspaceMetadata | undefined {
	if (envelope.kind !== PRIVATE_WORKSPACE_METADATA_KIND) return undefined
	const value = JSON.parse(envelope.content) as Record<string, unknown>
	if (typeof value.name !== 'string' || value.name.trim().length === 0) {
		throw new Error('Invalid private map metadata')
	}
	return {
		name: value.name,
		description: typeof value.description === 'string' ? value.description : undefined,
		recommendedBasemap:
			typeof value.recommendedBasemap === 'string' ? value.recommendedBasemap : undefined,
	}
}

function randomToken(): string {
	return crypto.randomUUID().replaceAll('-', '')
}

export class PrivateWorkspaceService {
	private readonly now: () => number
	private readonly coordinators = new Map<string, PrivateWorkspaceCoordinator>()

	constructor(private readonly options: PrivateWorkspaceServiceOptions) {
		this.now = options.now ?? Date.now
	}

	private async ownerPubkey() {
		const pubkey = await this.options.signer.getPublicKey()
		if (!/^[0-9a-f]{64}$/u.test(pubkey)) throw new Error('An active Nostr account is required')
		return pubkey
	}

	private coordinator(serverPubkey = this.options.coordinatorPubkey, relays = this.options.relays) {
		const key = `${serverPubkey}:${relays.join(',')}`
		const existing = this.coordinators.get(key)
		if (existing) return existing
		const coordinator = this.options.createCoordinator({
			serverPubkey,
			relays,
			signer: this.options.signer,
		})
		this.coordinators.set(key, coordinator)
		return coordinator
	}

	private administratorPolicy(workspace: StoredWorkspace): AdministratorPolicyState {
		const policy = reduceAdministratorPolicy(workspace.adminPubkey, workspace.envelopes)
		workspace.role = policy.administrators.includes(workspace.ownerPubkey)
			? 'administrator'
			: 'member'
		return policy
	}

	private requireAdministrator(
		workspace: StoredWorkspace,
		ownerPubkey: string,
		action: string,
	): AdministratorPolicyState {
		const policy = this.administratorPolicy(workspace)
		if (!policy.administrators.includes(ownerPubkey)) {
			throw new Error(`Only administrators can ${action}`)
		}
		return policy
	}

	private applyEnvelope(workspace: StoredWorkspace, envelope: PrivateWorkspaceEnvelope): void {
		if (workspace.envelopes.some((item) => item.id === envelope.id)) return
		const policyBefore = this.administratorPolicy(workspace)
		if (
			envelope.kind === PRIVATE_WORKSPACE_CHECKPOINT_KIND &&
			policyBefore.administrators.includes(envelope.pubkey)
		) {
			const manifest = parseWorkspaceCheckpointManifest(envelope.content)
			const receivedIds = new Set(workspace.envelopes.map((item) => item.id))
			const missingIds = manifest.envelopeIds.filter((id) => !receivedIds.has(id))
			if (missingIds.length > 0) {
				throw new Error(
					`Private workspace checkpoint is incomplete (${missingIds.length} records missing)`,
				)
			}
		}

		workspace.envelopes.push(envelope)
		const metadata = policyBefore.administrators.includes(envelope.pubkey)
			? readMetadata(envelope)
			: undefined
		if (metadata) {
			workspace.metadata = metadata
		}
		this.administratorPolicy(workspace)
	}

	/** Close the long-lived ContextVM sessions owned by this service. */
	async dispose(): Promise<void> {
		await this.resetConnections()
	}

	/** Drop failed transports so the next operation can establish a fresh session. */
	async resetConnections(): Promise<void> {
		const coordinators = [...this.coordinators.values()]
		this.coordinators.clear()
		await Promise.allSettled(coordinators.map((coordinator) => coordinator.disconnect()))
	}

	async listWorkspaces() {
		const workspaces = await this.options.store.listWorkspaces(await this.ownerPubkey())
		for (const workspace of workspaces) this.administratorPolicy(workspace)
		return workspaces
	}

	async listPendingJoins() {
		return this.options.store.listPendingJoins(await this.ownerPubkey())
	}

	async createWorkspace(metadata: WorkspaceMetadata): Promise<StoredWorkspace> {
		if (!metadata.name.trim()) throw new Error('Private map name is required')
		const ownerPubkey = await this.ownerPubkey()
		const workspaceId = crypto.randomUUID()
		const groupId = `earthly:${randomToken()}`
		const keyPackage = await generateMlsKeyPackage(ownerPubkey)
		const state = await createWorkspaceGroup({
			groupId,
			keyPackage: keyPackage.keyPackage,
			privateKeyPackage: keyPackage.privateKeyPackage,
		})
		const createdAt = this.now()
		await this.options.store.putKeyPackage({
			ownerPubkey,
			keyPackageRef: keyPackage.keyPackageRef,
			keyPackageBase64: keyPackage.keyPackageBase64,
			privateKeyPackageBase64: keyPackage.privateKeyPackageBase64,
			published: false,
			createdAt,
		})

		const workspace: StoredWorkspace = {
			workspaceId,
			groupId,
			ownerPubkey,
			adminPubkey: ownerPubkey,
			coordinatorPubkey: this.options.coordinatorPubkey,
			relays: this.options.relays,
			role: 'administrator',
			status: 'active',
			stateBase64: serializeClientState(state),
			cursor: 0,
			metadata: { ...metadata, name: metadata.name.trim() },
			envelopes: [],
			createdAt,
		}
		await this.options.store.putWorkspace(workspace)
		return workspace
	}

	async createInvitation(workspaceId: string): Promise<string> {
		const ownerPubkey = await this.ownerPubkey()
		const workspace = await this.syncWorkspace(workspaceId)
		this.requireAdministrator(workspace, ownerPubkey, 'invite members')
		const invitation: PrivateMapInvitation = {
			version: 1,
			workspaceId: workspace.workspaceId,
			groupId: workspace.groupId,
			adminPubkey: workspace.adminPubkey,
			coordinatorPubkey: workspace.coordinatorPubkey,
			relays: workspace.relays,
			nonce: randomToken(),
		}
		return encodePrivateMapInvitation(invitation)
	}

	async requestToJoin(encodedInvitation: string): Promise<PendingWorkspaceJoin> {
		const invitation = decodePrivateMapInvitation(encodedInvitation)
		const ownerPubkey = await this.ownerPubkey()
		if (ownerPubkey === invitation.adminPubkey)
			throw new Error('You already administer this private map')
		const artifacts = await generateMlsKeyPackage(ownerPubkey)
		const storedKeyPackage: StoredMlsKeyPackage = {
			ownerPubkey,
			keyPackageRef: artifacts.keyPackageRef,
			keyPackageBase64: artifacts.keyPackageBase64,
			privateKeyPackageBase64: artifacts.privateKeyPackageBase64,
			published: false,
			createdAt: this.now(),
		}
		await this.options.store.putKeyPackage(storedKeyPackage)

		const coordinator = this.coordinator(invitation.coordinatorPubkey, invitation.relays)
		await coordinator.publishKeyPackage({
			kp_ref: artifacts.keyPackageRef,
			kp_64: artifacts.keyPackageBase64,
		})
		storedKeyPackage.published = true
		await this.options.store.putKeyPackage(storedKeyPackage)
		await coordinator.storeJoinRequest({
			gid: invitation.groupId,
			kp_ref: artifacts.keyPackageRef,
		})

		const pending: PendingWorkspaceJoin = {
			ownerPubkey,
			workspaceId: invitation.workspaceId,
			groupId: invitation.groupId,
			adminPubkey: invitation.adminPubkey,
			coordinatorPubkey: invitation.coordinatorPubkey,
			relays: invitation.relays,
			keyPackageRef: artifacts.keyPackageRef,
			createdAt: this.now(),
		}
		await this.options.store.putPendingJoin(pending)
		return pending
	}

	async fetchJoinRequests(workspaceId: string): Promise<WorkspaceJoinRequest[]> {
		const ownerPubkey = await this.ownerPubkey()
		const workspace = await this.syncWorkspace(workspaceId)
		if (!this.administratorPolicy(workspace).administrators.includes(ownerPubkey)) return []
		const coordinator = this.coordinator(workspace.coordinatorPubkey, workspace.relays)
		const result = await coordinator.takeJoinRequests({ gid: workspace.groupId })
		return result.requests.map((request) => ({ ...request, workspaceId }))
	}

	async approveJoinRequest(request: WorkspaceJoinRequest): Promise<StoredWorkspace> {
		const ownerPubkey = await this.ownerPubkey()
		let workspace = await this.requireWorkspace(ownerPubkey, request.workspaceId)
		if (workspace.pendingApproval) {
			if (
				workspace.pendingApproval.targetPubkey !== request.pk ||
				workspace.pendingApproval.keyPackageRef !== request.kp_ref
			) {
				throw new Error('Finish the pending member approval before approving another member')
			}
			return this.resumePendingApproval(
				workspace,
				this.coordinator(workspace.coordinatorPubkey, workspace.relays),
			)
		}
		workspace = await this.syncWorkspace(request.workspaceId)
		this.requireAdministrator(workspace, ownerPubkey, 'add members')
		const coordinator = this.coordinator(workspace.coordinatorPubkey, workspace.relays)
		if (
			memberPubkeysFromState(deserializeClientState(workspace.stateBase64)).includes(request.pk)
		) {
			await coordinator.takeJoinRequests({
				gid: workspace.groupId,
				consumed: [{ pk: request.pk, at: request.at }],
			})
			return workspace
		}
		const checkpointBasisCursor = (workspace.pendingOutbound ?? []).reduce(
			(cursor, item) => Math.max(cursor, item.cursor),
			workspace.cursor,
		)
		const checkpointEnvelopes = currentMapCheckpointEnvelopes(workspace)
		const metadataEnvelope = await this.createMetadataEnvelope(workspace)
		const checkpointManifest = createWorkspaceCheckpointManifest({
			basisCursor: checkpointBasisCursor,
			envelopeIds: [
				...checkpointEnvelopes.map((envelope) => envelope.id),
				...(metadataEnvelope ? [metadataEnvelope.id] : []),
			],
		})
		const consumed = await coordinator.takeKeyPackage({ id: request.kp_ref })
		if (!consumed.keyPackage) throw new Error('The requested MLS KeyPackage is no longer available')
		const published = consumed.keyPackage
		if (!verifyEvent(published.event)) throw new Error('Invalid KeyPackage publication signature')
		if (published.kp_ref !== request.kp_ref) {
			throw new Error('Coordinator returned a different KeyPackage than requested')
		}
		if (published.pk !== request.pk || published.event.pubkey !== request.pk) {
			throw new Error('Join request identity does not match its KeyPackage publication')
		}
		const keyPackage = decodeKeyPackage(publicationKeyPackageBase64(published.event))
		if (credentialPubkeyFromKeyPackage(keyPackage) !== request.pk) {
			throw new Error('KeyPackage credential is not bound to the requesting Nostr account')
		}

		const oldState = deserializeClientState(workspace.stateBase64)
		const added = await addWorkspaceMember({ state: oldState, keyPackage })
		const checkpointEnvelope = await this.createCheckpointEnvelope(workspace, checkpointManifest)
		let plannedState = added.newState
		const messages: PendingWorkspaceApprovalMessage[] = [
			{
				type: 'commit',
				msgBase64: await sealCoordinatorPayload(oldState, added.commitBase64),
			},
		]
		const appendApplicationMessage = async (
			envelope: PrivateWorkspaceEnvelope,
			forwarded: boolean,
		) => {
			const stateBefore = plannedState
			const outbound = forwarded
				? await createForwardedWorkspaceApplicationMessage({ state: stateBefore, envelope })
				: await createWorkspaceApplicationMessage({ state: stateBefore, envelope })
			plannedState = outbound.newState
			messages.push({
				type: 'application',
				msgBase64: await sealCoordinatorPayload(stateBefore, outbound.messageBase64),
				envelope,
			})
		}
		for (const envelope of checkpointEnvelopes) {
			await appendApplicationMessage(envelope, true)
		}
		if (metadataEnvelope) {
			await appendApplicationMessage(metadataEnvelope, false)
		}
		await appendApplicationMessage(checkpointEnvelope, false)
		const approval: PendingWorkspaceApproval = {
			version: 1,
			targetPubkey: request.pk,
			keyPackageRef: request.kp_ref,
			requestAt: request.at,
			basisCursor: checkpointBasisCursor,
			welcomeBase64: added.welcomeBase64,
			finalStateBase64: serializeClientState(plannedState),
			messages,
		}
		workspace.pendingApproval = approval
		await this.options.store.putWorkspace(workspace)
		return this.resumePendingApproval(workspace, coordinator)
	}

	async acceptPendingWelcomes(): Promise<StoredWorkspace[]> {
		const ownerPubkey = await this.ownerPubkey()
		const joins = await this.options.store.listPendingJoins(ownerPubkey)
		const accepted: StoredWorkspace[] = []

		for (const pending of joins) {
			const coordinator = this.coordinator(pending.coordinatorPubkey, pending.relays)
			const result = await coordinator.takeWelcomes()
			const welcome = result.welcomes.find((item) => item.kp_ref === pending.keyPackageRef)
			if (!welcome) continue
			const keyPackage = await this.options.store.getKeyPackage(ownerPubkey, pending.keyPackageRef)
			if (!keyPackage) throw new Error('The MLS private KeyPackage for this Welcome is missing')
			const state = await joinWorkspaceGroup({
				welcomeBase64: welcome.welcome_64,
				keyPackage: decodeKeyPackage(keyPackage.keyPackageBase64),
				privateKeyPackage: decodePrivateKeyPackage(keyPackage.privateKeyPackageBase64),
			})
			if (groupIdFromState(state) !== pending.groupId)
				throw new Error('Welcome is for another group')
			const workspace: StoredWorkspace = {
				workspaceId: pending.workspaceId,
				groupId: pending.groupId,
				ownerPubkey,
				adminPubkey: pending.adminPubkey,
				coordinatorPubkey: pending.coordinatorPubkey,
				relays: pending.relays,
				role: 'member',
				status: 'active',
				stateBase64: serializeClientState(state),
				cursor: welcome.after ?? 0,
				envelopes: [],
				createdAt: this.now(),
			}
			await this.options.store.putWorkspace(workspace)
			await this.options.store.deletePendingJoin(ownerPubkey, pending.keyPackageRef)
			await coordinator.takeWelcomes({
				consumed: result.welcomes
					.filter((item) => item.kp_ref === welcome.kp_ref)
					.map((item) => ({ kp_ref: item.kp_ref, at: item.at })),
			})
			await this.syncWithCoordinator(workspace, coordinator)
			accepted.push(workspace)
		}
		return accepted
	}

	async syncWorkspace(workspaceId: string): Promise<StoredWorkspace> {
		return (await this.syncWorkspaceResult(workspaceId)).workspace
	}

	async syncWorkspaceResult(workspaceId: string): Promise<WorkspaceSyncResult> {
		const ownerPubkey = await this.ownerPubkey()
		const workspace = await this.requireWorkspace(ownerPubkey, workspaceId)
		const coordinator = this.coordinator(workspace.coordinatorPubkey, workspace.relays)
		if (workspace.pendingApproval) {
			await this.resumePendingApproval(workspace, coordinator)
			return { workspace, changed: true }
		}
		const changed = await this.syncWithCoordinator(workspace, coordinator)
		return { workspace, changed }
	}

	async sendChat(workspaceId: string, content: string) {
		if (!content.trim()) throw new Error('Message cannot be empty')
		return this.sendEnvelope(workspaceId, PRIVATE_WORKSPACE_CHAT_KIND, content.trim())
	}

	async sendComment(workspaceId: string, text: string, geojson?: FeatureCollection) {
		const trimmedText = text.trim()
		const hasGeometry = Boolean(geojson?.features.length)
		if (!trimmedText && !hasGeometry) throw new Error('A comment needs text or geometry')
		if (geojson && geojson.type !== 'FeatureCollection') {
			throw new Error('A comment attachment must be GeoJSON')
		}

		return this.sendEnvelope(
			workspaceId,
			GEO_COMMENT_KIND,
			JSON.stringify({ text: trimmedText, ...(hasGeometry ? { geojson } : {}) }),
			[['d', crypto.randomUUID()]],
		)
	}

	async sendEntity(
		workspaceId: string,
		entity: { kind: number; content: string; tags?: string[][] },
	) {
		return this.sendEnvelope(workspaceId, entity.kind, entity.content, entity.tags)
	}

	async sendDataset(
		workspaceId: string,
		collection: FeatureCollection,
		options: { datasetId?: string; name?: string } = {},
	) {
		if (collection.type !== 'FeatureCollection') throw new Error('A dataset must be GeoJSON')
		const collectionName =
			options.name ??
			(typeof (collection as FeatureCollection & { name?: unknown }).name === 'string'
				? (collection as FeatureCollection & { name: string }).name
				: 'Private dataset')
		return this.sendEntity(workspaceId, {
			kind: GEO_EVENT_KIND,
			content: JSON.stringify(collection),
			tags: [
				['d', options.datasetId ?? crypto.randomUUID()],
				['name', collectionName],
			],
		})
	}

	async sendDemoDataset(workspaceId: string, label: string) {
		const collection: FeatureCollection & { name: string } = {
			type: 'FeatureCollection',
			name: label || 'Private map marker',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [16.3725, 48.2089] },
					properties: { name: label || 'Private map marker', demo: true },
				},
			],
		}
		return this.sendDataset(workspaceId, collection)
	}

	async removeMember(workspaceId: string, memberPubkey: string): Promise<StoredWorkspace> {
		const ownerPubkey = await this.ownerPubkey()
		const workspace = await this.syncWorkspace(workspaceId)
		const policy = this.requireAdministrator(workspace, ownerPubkey, 'remove members')
		if (policy.administrators.includes(memberPubkey)) {
			throw new Error('Demote this administrator before removing them')
		}
		const oldState = deserializeClientState(workspace.stateBase64)
		const removed = await removeWorkspaceMember({ state: oldState, pubkey: memberPubkey })
		const coordinator = this.coordinator(workspace.coordinatorPubkey, workspace.relays)
		const posted = await coordinator.postMessage({
			gid: workspace.groupId,
			msg_64: await sealCoordinatorPayload(oldState, removed.commitBase64),
		})
		workspace.stateBase64 = serializeClientState(removed.newState)
		workspace.cursor = posted.cursor
		await this.options.store.putWorkspace(workspace)
		return workspace
	}

	async setAdministrator(
		workspaceId: string,
		memberPubkey: string,
		administrator: boolean,
	): Promise<StoredWorkspace> {
		const ownerPubkey = await this.ownerPubkey()
		const workspace = await this.syncWorkspace(workspaceId)
		const policy = this.requireAdministrator(workspace, ownerPubkey, 'manage administrators')
		if (!this.members(workspace).includes(memberPubkey)) {
			throw new Error('Only current group members can be administrators')
		}

		const transition = createAdministratorPolicyTransition(policy, {
			pubkey: memberPubkey,
			administrator,
		})
		const envelope = await this.sendEnvelope(
			workspaceId,
			PRIVATE_WORKSPACE_ADMIN_POLICY_KIND,
			JSON.stringify(transition),
			[['d', 'administrator-policy']],
		)
		const updated = await this.requireWorkspace(ownerPubkey, workspaceId)
		const transitionIsPending = updated.pendingOutbound?.some(
			(item) => item.envelope.id === envelope.id,
		)
		if (this.administratorPolicy(updated).head !== envelope.id && !transitionIsPending) {
			throw new Error(
				'Administrator policy changed concurrently; review the current roles and retry',
			)
		}
		await this.options.store.putWorkspace(updated)
		return updated
	}

	members(workspace: StoredWorkspace): string[] {
		return memberPubkeysFromState(deserializeClientState(workspace.stateBase64))
	}

	administrators(workspace: StoredWorkspace): string[] {
		return [...this.administratorPolicy(workspace).administrators]
	}

	private async sendEnvelope(
		workspaceId: string,
		kind: number,
		content: string,
		tags?: string[][],
	) {
		const ownerPubkey = await this.ownerPubkey()
		let workspace = await this.requireWorkspace(ownerPubkey, workspaceId)
		workspace = await this.syncWorkspace(workspaceId)
		if (workspace.status !== 'active')
			throw new Error('This account was removed from the private map')
		const envelope = await createPrivateEnvelope({
			signer: this.options.signer,
			groupId: workspace.groupId,
			pubkey: ownerPubkey,
			kind,
			content,
			tags,
		})
		const coordinator = this.coordinator(workspace.coordinatorPubkey, workspace.relays)
		await this.postApplicationEnvelope(workspace, coordinator, envelope)
		return envelope
	}

	private async postApplicationEnvelope(
		workspace: StoredWorkspace,
		coordinator: PrivateWorkspaceCoordinator,
		envelope: PrivateWorkspaceEnvelope,
		forwarded = false,
	): Promise<void> {
		const oldState = deserializeClientState(workspace.stateBase64)
		const outbound = forwarded
			? await createForwardedWorkspaceApplicationMessage({ state: oldState, envelope })
			: await createWorkspaceApplicationMessage({ state: oldState, envelope })
		const posted = await coordinator.postMessage({
			gid: workspace.groupId,
			msg_64: await sealCoordinatorPayload(oldState, outbound.messageBase64),
		})
		workspace.stateBase64 = serializeClientState(outbound.newState)
		workspace.pendingOutbound = [
			...(workspace.pendingOutbound ?? []),
			{ cursor: posted.cursor, envelope },
		]
		await this.options.store.putWorkspace(workspace)
		await this.syncWithCoordinator(workspace, coordinator)
	}

	private async createMetadataEnvelope(
		workspace: StoredWorkspace,
	): Promise<PrivateWorkspaceEnvelope | undefined> {
		if (!workspace.metadata) return
		this.requireAdministrator(workspace, workspace.ownerPubkey, 'publish group metadata')
		return createPrivateEnvelope({
			signer: this.options.signer,
			groupId: workspace.groupId,
			pubkey: workspace.ownerPubkey,
			kind: PRIVATE_WORKSPACE_METADATA_KIND,
			tags: [['d', 'workspace-metadata']],
			content: JSON.stringify(workspace.metadata),
		})
	}

	private async createCheckpointEnvelope(
		workspace: StoredWorkspace,
		manifest: ReturnType<typeof createWorkspaceCheckpointManifest>,
	): Promise<PrivateWorkspaceEnvelope> {
		this.requireAdministrator(workspace, workspace.ownerPubkey, 'publish a join checkpoint')
		return createPrivateEnvelope({
			signer: this.options.signer,
			groupId: workspace.groupId,
			pubkey: workspace.ownerPubkey,
			kind: PRIVATE_WORKSPACE_CHECKPOINT_KIND,
			tags: [['d', 'current-map-checkpoint']],
			content: JSON.stringify(manifest),
		})
	}

	private async resumePendingApproval(
		workspace: StoredWorkspace,
		coordinator: PrivateWorkspaceCoordinator,
	): Promise<StoredWorkspace> {
		const approval = workspace.pendingApproval
		if (approval?.version !== 1) {
			throw new Error('Unsupported private-map approval recovery journal')
		}
		this.requireAdministrator(workspace, workspace.ownerPubkey, 'recover member approval')
		if (approval.messages.length === 0 || approval.messages[0]?.type !== 'commit') {
			throw new Error('Invalid private-map approval recovery journal')
		}

		const fetched = await coordinator.fetchMessages({
			gid: workspace.groupId,
			after: approval.basisCursor > 0 ? approval.basisCursor : undefined,
		})
		for (const planned of approval.messages) {
			if (planned.cursor !== undefined) continue
			const existing = fetched.messages.find((message) => message.msg_64 === planned.msgBase64)
			if (existing) {
				planned.cursor = existing.cursor
			} else {
				const posted = await coordinator.postMessage({
					gid: workspace.groupId,
					msg_64: planned.msgBase64,
				})
				planned.cursor = posted.cursor
			}
			await this.options.store.putWorkspace(workspace)
		}

		const delivered = await coordinator.fetchMessages({
			gid: workspace.groupId,
			after: approval.basisCursor > 0 ? approval.basisCursor : undefined,
		})
		const plannedCiphertexts = new Set(approval.messages.map((message) => message.msgBase64))
		const unexpected = delivered.messages.filter(
			(message) => !plannedCiphertexts.has(message.msg_64),
		)
		if (unexpected.length > 0) {
			throw new Error(
				'Private map changed while member approval was being recovered; concurrent recovery is not yet supported',
			)
		}

		if (!approval.localFinalized) {
			const commitCursor = approval.messages[0]?.cursor
			if (commitCursor === undefined || !approval.finalStateBase64) {
				throw new Error('Private-map approval messages were not fully acknowledged')
			}
			workspace.stateBase64 = approval.finalStateBase64
			this.reconcileAcknowledgedOutbounds(workspace, commitCursor)
			for (const planned of [...approval.messages]
				.filter(
					(
						message,
					): message is PendingWorkspaceApprovalMessage & {
						envelope: PrivateWorkspaceEnvelope
						cursor: number
					} =>
						message.type === 'application' &&
						message.envelope !== undefined &&
						message.cursor !== undefined,
				)
				.sort((a, b) => a.cursor - b.cursor)) {
				this.applyEnvelope(workspace, planned.envelope)
			}
			workspace.cursor = Math.max(
				workspace.cursor,
				...approval.messages.map((message) => message.cursor ?? 0),
			)
			approval.localFinalized = true
			await this.options.store.putWorkspace(workspace)
		}

		const commitCursor = approval.messages[0]?.cursor
		if (commitCursor === undefined) {
			throw new Error('Private-map approval commit was not acknowledged')
		}
		if (approval.welcomeStoredAt === undefined) {
			const stored = await coordinator.storeWelcome({
				target_pk: approval.targetPubkey,
				kp_ref: approval.keyPackageRef,
				welcome_64: approval.welcomeBase64,
				after: commitCursor,
			})
			approval.welcomeStoredAt = stored.at
			await this.options.store.putWorkspace(workspace)
		}
		await coordinator.takeJoinRequests({
			gid: workspace.groupId,
			consumed: [{ pk: approval.targetPubkey, at: approval.requestAt }],
		})
		workspace.pendingApproval = undefined
		await this.options.store.putWorkspace(workspace)
		return workspace
	}

	private async syncWithCoordinator(
		workspace: StoredWorkspace,
		coordinator: PrivateWorkspaceCoordinator,
	): Promise<boolean> {
		if (workspace.status === 'removed') return false
		const fetched = await coordinator.fetchMessages({
			gid: workspace.groupId,
			after: workspace.cursor > 0 ? workspace.cursor : undefined,
		})
		if (fetched.messages.length === 0) {
			const reconciled = this.reconcileAcknowledgedOutbounds(workspace, workspace.cursor)
			if (!reconciled) return false
			await this.options.store.putWorkspace(workspace)
			return true
		}
		let state = deserializeClientState(workspace.stateBase64)
		for (const message of fetched.messages.sort((a, b) => a.cursor - b.cursor)) {
			const pendingOutboundIndex = workspace.pendingOutbound?.findIndex(
				(item) => item.cursor === message.cursor,
			)
			if (pendingOutboundIndex !== undefined && pendingOutboundIndex >= 0) {
				const pending = workspace.pendingOutbound?.[pendingOutboundIndex]
				if (pending) this.applyEnvelope(workspace, pending.envelope)
				workspace.pendingOutbound?.splice(pendingOutboundIndex, 1)
				workspace.cursor = message.cursor
				continue
			}
			try {
				const mlsBase64 = message.encrypted
					? await openCoordinatorPayload(state, message.msg_64)
					: message.msg_64
				const processed = await processWorkspaceMessage({
					state,
					messageBase64: mlsBase64,
					administratorPubkeys: this.administratorPolicy(workspace).administrators,
				})
				state = processed.newState
				if (processed.kind === 'applicationMessage') {
					this.applyEnvelope(workspace, processed.envelope)
				}
				if (!memberPubkeysFromState(state).includes(workspace.ownerPubkey)) {
					workspace.status = 'removed'
				}
			} catch (error) {
				if (
					workspace.role === 'member' &&
					error instanceof Error &&
					/ancestor|overlap/u.test(error.message)
				) {
					workspace.status = 'removed'
				} else {
					throw error
				}
			} finally {
				workspace.cursor = message.cursor
			}
			if (workspace.status === 'removed') break
		}
		workspace.stateBase64 = serializeClientState(state)
		this.reconcileAcknowledgedOutbounds(workspace, workspace.cursor)
		this.administratorPolicy(workspace)
		await this.options.store.putWorkspace(workspace)
		return true
	}

	private reconcileAcknowledgedOutbounds(
		workspace: StoredWorkspace,
		throughCursor: number,
	): boolean {
		const pending = workspace.pendingOutbound
		if (!pending?.length) return false
		const acknowledged = pending
			.filter((item) => item.cursor <= throughCursor)
			.sort((a, b) => a.cursor - b.cursor)
		if (acknowledged.length === 0) return false
		for (const item of acknowledged) this.applyEnvelope(workspace, item.envelope)
		const acknowledgedCursors = new Set(acknowledged.map((item) => item.cursor))
		const remaining = pending.filter((item) => !acknowledgedCursors.has(item.cursor))
		workspace.pendingOutbound = remaining.length > 0 ? remaining : undefined
		return true
	}

	private async requireWorkspace(ownerPubkey: string, workspaceId: string) {
		const workspace = await this.options.store.getWorkspace(ownerPubkey, workspaceId)
		if (!workspace) throw new Error('Private map was not found in this browser profile')
		this.administratorPolicy(workspace)
		return workspace
	}
}
