import { verifyEvent, type NostrEvent } from 'nostr-tools'
import type { NostrSigner } from '@contextvm/sdk'
import type { FeatureCollection } from 'geojson'
import { GEO_COMMENT_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import type { PendingJoinRequest, PrivateWorkspaceCoordinator } from './contracts'
import { createPrivateEnvelope, type PrivateWorkspaceEnvelope } from './envelope'
import {
	decodeKeyPackage,
	decodePrivateKeyPackage,
	credentialPubkeyFromKeyPackage,
	addWorkspaceMember,
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
	decodePrivateMapInvitation,
	encodePrivateMapInvitation,
	type PrivateMapInvitation,
} from './invitation'
import type {
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
		return this.options.store.listWorkspaces(await this.ownerPubkey())
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
		const workspace = await this.requireWorkspace(ownerPubkey, workspaceId)
		if (workspace.role !== 'administrator')
			throw new Error('Only administrators can invite members')
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
		const workspace = await this.requireWorkspace(ownerPubkey, workspaceId)
		if (workspace.role !== 'administrator') return []
		const coordinator = this.coordinator(workspace.coordinatorPubkey, workspace.relays)
		const result = await coordinator.takeJoinRequests({ gid: workspace.groupId })
		return result.requests.map((request) => ({ ...request, workspaceId }))
	}

	async approveJoinRequest(request: WorkspaceJoinRequest): Promise<StoredWorkspace> {
		const ownerPubkey = await this.ownerPubkey()
		const workspace = await this.requireWorkspace(ownerPubkey, request.workspaceId)
		if (workspace.role !== 'administrator') throw new Error('Only administrators can add members')
		const coordinator = this.coordinator(workspace.coordinatorPubkey, workspace.relays)
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
		const sealedCommit = await sealCoordinatorPayload(oldState, added.commitBase64)
		const posted = await coordinator.postMessage({ gid: workspace.groupId, msg_64: sealedCommit })
		await coordinator.storeWelcome({
			target_pk: request.pk,
			kp_ref: request.kp_ref,
			welcome_64: added.welcomeBase64,
			after: posted.cursor,
		})
		workspace.stateBase64 = serializeClientState(added.newState)
		workspace.cursor = posted.cursor
		await this.options.store.putWorkspace(workspace)
		await this.publishMetadata(workspace, coordinator)
		await coordinator.takeJoinRequests({
			gid: workspace.groupId,
			consumed: [{ pk: request.pk, at: request.at }],
		})
		return workspace
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
			await coordinator.takeWelcomes({ consumed: [{ kp_ref: welcome.kp_ref, at: welcome.at }] })
			await this.syncWithCoordinator(workspace, coordinator)
			accepted.push(workspace)
		}
		return accepted
	}

	async syncWorkspace(workspaceId: string): Promise<StoredWorkspace> {
		const ownerPubkey = await this.ownerPubkey()
		const workspace = await this.requireWorkspace(ownerPubkey, workspaceId)
		const coordinator = this.coordinator(workspace.coordinatorPubkey, workspace.relays)
		await this.syncWithCoordinator(workspace, coordinator)
		return workspace
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
		let workspace = await this.requireWorkspace(ownerPubkey, workspaceId)
		if (workspace.role !== 'administrator')
			throw new Error('Only administrators can remove members')
		if (memberPubkey === ownerPubkey) throw new Error('Administrator self-removal is not supported')
		workspace = await this.syncWorkspace(workspaceId)
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

	members(workspace: StoredWorkspace): string[] {
		return memberPubkeysFromState(deserializeClientState(workspace.stateBase64))
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
		const envelope = createPrivateEnvelope({ pubkey: ownerPubkey, kind, content, tags })
		const oldState = deserializeClientState(workspace.stateBase64)
		const outbound = await createWorkspaceApplicationMessage({ state: oldState, envelope })
		const coordinator = this.coordinator(workspace.coordinatorPubkey, workspace.relays)
		const posted = await coordinator.postMessage({
			gid: workspace.groupId,
			msg_64: await sealCoordinatorPayload(oldState, outbound.messageBase64),
		})
		workspace.stateBase64 = serializeClientState(outbound.newState)
		workspace.cursor = posted.cursor
		workspace.envelopes.push(envelope)
		await this.options.store.putWorkspace(workspace)
		return envelope
	}

	private async publishMetadata(
		workspace: StoredWorkspace,
		coordinator: PrivateWorkspaceCoordinator,
	): Promise<void> {
		if (!workspace.metadata) return
		const state = deserializeClientState(workspace.stateBase64)
		const envelope = createPrivateEnvelope({
			pubkey: workspace.ownerPubkey,
			kind: PRIVATE_WORKSPACE_METADATA_KIND,
			tags: [['d', 'workspace-metadata']],
			content: JSON.stringify(workspace.metadata),
		})
		const outbound = await createWorkspaceApplicationMessage({ state, envelope })
		const posted = await coordinator.postMessage({
			gid: workspace.groupId,
			msg_64: await sealCoordinatorPayload(state, outbound.messageBase64),
		})
		workspace.stateBase64 = serializeClientState(outbound.newState)
		workspace.cursor = posted.cursor
		workspace.envelopes.push(envelope)
		await this.options.store.putWorkspace(workspace)
	}

	private async syncWithCoordinator(
		workspace: StoredWorkspace,
		coordinator: PrivateWorkspaceCoordinator,
	): Promise<void> {
		if (workspace.status === 'removed') return
		const fetched = await coordinator.fetchMessages({
			gid: workspace.groupId,
			after: workspace.cursor > 0 ? workspace.cursor : undefined,
		})
		let state = deserializeClientState(workspace.stateBase64)
		for (const message of fetched.messages.sort((a, b) => a.cursor - b.cursor)) {
			try {
				const mlsBase64 = message.encrypted
					? await openCoordinatorPayload(state, message.msg_64)
					: message.msg_64
				const processed = await processWorkspaceMessage({ state, messageBase64: mlsBase64 })
				state = processed.newState
				if (processed.kind === 'applicationMessage') {
					if (!workspace.envelopes.some((item) => item.id === processed.envelope.id)) {
						workspace.envelopes.push(processed.envelope)
					}
					const metadata = readMetadata(processed.envelope)
					if (metadata) workspace.metadata = metadata
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
		await this.options.store.putWorkspace(workspace)
	}

	private async requireWorkspace(ownerPubkey: string, workspaceId: string) {
		const workspace = await this.options.store.getWorkspace(ownerPubkey, workspaceId)
		if (!workspace) throw new Error('Private map was not found in this browser profile')
		return workspace
	}
}
