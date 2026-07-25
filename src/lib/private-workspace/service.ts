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
import {
	assertPrivateEnvelopeAuthorization,
	createPrivateEnvelope,
	type PrivateWorkspaceEnvelope,
} from './envelope'
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
	assertPrivateMapInvitationCurrent,
	createPrivateMapInvitation,
	decodePrivateMapInvitation,
} from './invitation'
import type {
	PendingWorkspaceApproval,
	PendingWorkspaceApprovalMessage,
	PendingWorkspaceApplication,
	PendingWorkspaceJoin,
	PendingWorkspaceMembershipCommit,
	PrivateWorkspaceStore,
	StoredMlsKeyPackage,
	StoredWorkspace,
	WorkspaceMetadata,
} from './storage'

export const PRIVATE_WORKSPACE_METADATA_KIND = 37523
export const PRIVATE_WORKSPACE_CHAT_KIND = 9

const MAX_SKIPPED_COORDINATOR_MESSAGES = 32
const MAX_MEMBERSHIP_RECOVERY_PASSES = 4
const MAX_TRANSIENT_COORDINATOR_ATTEMPTS = 3

function isTransientCoordinatorError(error: unknown): boolean {
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
	return /(?:timed?\s*out|timeout|connection\s+(?:closed|reset|lost)|relay.*(?:unavailable|disconnected|not connected)|network.*unavailable)/iu.test(
		message,
	)
}

function waitForCoordinatorRetry(attempt: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, attempt * 300))
}

async function retryTransientCoordinatorCall<T>(operation: () => Promise<T>): Promise<T> {
	let lastError: unknown
	for (let attempt = 1; attempt <= MAX_TRANSIENT_COORDINATOR_ATTEMPTS; attempt += 1) {
		try {
			return await operation()
		} catch (error) {
			lastError = error
			if (!isTransientCoordinatorError(error) || attempt === MAX_TRANSIENT_COORDINATOR_ATTEMPTS)
				throw error
			await waitForCoordinatorRetry(attempt)
		}
	}
	throw lastError
}

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

	private async publishJoinKeyPackage(
		coordinator: PrivateWorkspaceCoordinator,
		ownerPubkey: string,
		input: { kp_ref: string; kp_64: string },
	) {
		let uncertainPublish = false
		let lastError: unknown

		for (let attempt = 1; attempt <= MAX_TRANSIENT_COORDINATOR_ATTEMPTS; attempt += 1) {
			try {
				return await coordinator.publishKeyPackage(input)
			} catch (error) {
				lastError = error
				const transient = isTransientCoordinatorError(error)
				if (!transient && !uncertainPublish) throw error
				uncertainPublish ||= transient

				try {
					const available = await coordinator.listKeyPackages()
					const published = available.keyPackages.find(
						(item) => item.pk === ownerPubkey && item.kp_ref === input.kp_ref,
					)
					if (published) return published
				} catch (listError) {
					if (!isTransientCoordinatorError(listError)) throw listError
					lastError = listError
				}

				if (!transient || attempt === MAX_TRANSIENT_COORDINATOR_ATTEMPTS) throw lastError
				await waitForCoordinatorRetry(attempt)
			}
		}

		throw lastError
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

	/**
	 * Delete this installation's encrypted workspace state. This intentionally
	 * does not claim to erase records already held by the coordinator or peers.
	 */
	async deleteWorkspace(workspaceId: string): Promise<void> {
		const ownerPubkey = await this.ownerPubkey()
		await this.requireWorkspace(ownerPubkey, workspaceId)
		await this.options.store.deleteWorkspace(ownerPubkey, workspaceId)
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
			lastResort: keyPackage.lastResort,
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
		// Invitations contain only signed, already-persisted group coordinates.
		// Requiring a coordinator round trip here made the invite UI depend on
		// network health even though no MLS state is changed or published.
		const workspace = await this.requireWorkspace(ownerPubkey, workspaceId)
		this.requireAdministrator(workspace, ownerPubkey, 'invite members')
		return createPrivateMapInvitation({
			signer: this.options.signer,
			workspaceId: workspace.workspaceId,
			groupId: workspace.groupId,
			adminPubkey: workspace.adminPubkey,
			coordinatorPubkey: workspace.coordinatorPubkey,
			relays: workspace.relays,
			nonce: randomToken(),
			issuedAt: Math.floor(this.now() / 1000),
		})
	}

	async requestToJoin(encodedInvitation: string): Promise<PendingWorkspaceJoin> {
		const invitation = decodePrivateMapInvitation(encodedInvitation)
		assertPrivateMapInvitationCurrent(invitation, this.now())
		const ownerPubkey = await this.ownerPubkey()
		if (ownerPubkey === invitation.adminPubkey)
			throw new Error('You already administer this private map')
		const artifacts = await generateMlsKeyPackage(ownerPubkey, { lastResort: true })
		const storedKeyPackage: StoredMlsKeyPackage = {
			ownerPubkey,
			keyPackageRef: artifacts.keyPackageRef,
			keyPackageBase64: artifacts.keyPackageBase64,
			privateKeyPackageBase64: artifacts.privateKeyPackageBase64,
			lastResort: artifacts.lastResort,
			published: false,
			createdAt: this.now(),
		}
		await this.options.store.putKeyPackage(storedKeyPackage)

		const coordinator = this.coordinator(invitation.coordinatorPubkey, invitation.relays)
		const published = await this.publishJoinKeyPackage(coordinator, ownerPubkey, {
			kp_ref: artifacts.keyPackageRef,
			kp_64: artifacts.keyPackageBase64,
		})
		if (!artifacts.lastResort || !published.last_resort) {
			await coordinator
				.removeKeyPackages({ kp_refs: [artifacts.keyPackageRef] })
				.catch(() => undefined)
			throw new Error('The coordinator did not recognize the retryable join KeyPackage profile')
		}
		storedKeyPackage.published = true
		await this.options.store.putKeyPackage(storedKeyPackage)
		await retryTransientCoordinatorCall(() =>
			coordinator.storeJoinRequest({
				gid: invitation.groupId,
				kp_ref: artifacts.keyPackageRef,
			}),
		)

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
		if (
			workspace.status !== 'active' ||
			!this.administratorPolicy(workspace).administrators.includes(ownerPubkey)
		)
			return []
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
		const approvalKeyPackage = await this.takeApprovalKeyPackage(request, coordinator)
		const approval = await this.createPendingApproval(
			workspace,
			request,
			approvalKeyPackage.keyPackageBase64,
			1,
		)
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
			if (keyPackage.lastResort) {
				const available = await coordinator.listKeyPackages()
				if (available.keyPackages.some((item) => item.kp_ref === pending.keyPackageRef)) {
					await coordinator.removeKeyPackages({ kp_refs: [pending.keyPackageRef] })
				}
			}
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
		if (workspace.pendingApplication) {
			await this.resumePendingApplication(workspace, coordinator)
			return { workspace, changed: true }
		}
		if (workspace.pendingApproval) {
			await this.resumePendingApproval(workspace, coordinator)
			return { workspace, changed: true }
		}
		if (workspace.pendingMembershipCommit) {
			await this.resumePendingMembershipCommit(workspace, coordinator)
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
		if (!this.members(workspace).includes(memberPubkey)) return workspace
		const policy = this.requireAdministrator(workspace, ownerPubkey, 'remove members')
		if (policy.administrators.includes(memberPubkey)) {
			throw new Error('Demote this administrator before removing them')
		}
		if (workspace.pendingOutbound?.length) {
			throw new Error(
				'Wait for pending private-map records to be confirmed before removing a member',
			)
		}
		const coordinator = this.coordinator(workspace.coordinatorPubkey, workspace.relays)
		workspace.pendingMembershipCommit = await this.createPendingRemoval(workspace, memberPubkey, 1)
		await this.options.store.putWorkspace(workspace)
		return this.resumePendingMembershipCommit(workspace, coordinator)
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
		if (workspace.pendingApplication) {
			throw new Error('Finish the pending private-map record before sending another')
		}
		const oldState = deserializeClientState(workspace.stateBase64)
		const outbound = forwarded
			? await createForwardedWorkspaceApplicationMessage({ state: oldState, envelope })
			: await createWorkspaceApplicationMessage({ state: oldState, envelope })
		workspace.pendingApplication = {
			version: 1,
			envelope,
			forwarded,
			basisCursor: workspace.cursor,
			basisStateBase64: workspace.stateBase64,
			msgBase64: await sealCoordinatorPayload(oldState, outbound.messageBase64),
			finalStateBase64: serializeClientState(outbound.newState),
			attempt: 1,
		}
		await this.options.store.putWorkspace(workspace)
		await this.resumePendingApplication(workspace, coordinator)
	}

	private async resumePendingApplication(
		workspace: StoredWorkspace,
		coordinator: PrivateWorkspaceCoordinator,
	): Promise<void> {
		for (let pass = 0; pass < MAX_MEMBERSHIP_RECOVERY_PASSES; pass += 1) {
			const pending = workspace.pendingApplication
			if (pending?.version !== 1) {
				throw new Error('Unsupported private-map application recovery journal')
			}
			assertPrivateEnvelopeAuthorization(pending.envelope, workspace.groupId)

			if (pending.cursor === undefined) {
				const fetched = await coordinator.fetchMessages({
					gid: workspace.groupId,
					after: pending.basisCursor > 0 ? pending.basisCursor : undefined,
				})
				const existing = fetched.messages.find((message) => message.msg_64 === pending.msgBase64)
				if (existing) {
					pending.cursor = existing.cursor
				} else {
					const posted = await coordinator.postMessage({
						gid: workspace.groupId,
						msg_64: pending.msgBase64,
					})
					pending.cursor = posted.cursor
				}
				await this.options.store.putWorkspace(workspace)
			}

			const preceding = await coordinator.fetchMessages({
				gid: workspace.groupId,
				after: pending.basisCursor > 0 ? pending.basisCursor : undefined,
			})
			const orderedPreceding = preceding.messages
				.filter((message) => message.cursor < (pending.cursor ?? 0))
				.sort((a, b) => a.cursor - b.cursor)
			if (await this.applicationEpochAdvanced(workspace, pending, orderedPreceding)) {
				await this.catchUpBeforeStaleApplication(workspace, pending, orderedPreceding)
				if (workspace.status === 'removed') {
					workspace.pendingApplication = undefined
					await this.options.store.putWorkspace(workspace)
					throw new Error(
						'This account was removed before the pending private-map record could be delivered',
					)
				}
				workspace.pendingApplication = await this.rebuildPendingApplication(workspace, pending)
				await this.options.store.putWorkspace(workspace)
				continue
			}

			workspace.stateBase64 = pending.finalStateBase64
			if (!workspace.pendingOutbound?.some((item) => item.cursor === pending.cursor)) {
				workspace.pendingOutbound = [
					...(workspace.pendingOutbound ?? []),
					{ cursor: pending.cursor, envelope: pending.envelope },
				]
			}
			workspace.pendingApplication = undefined
			await this.options.store.putWorkspace(workspace)
			await this.syncWithCoordinator(workspace, coordinator)
			return
		}

		throw new Error('Private-map membership kept changing; the pending record will resume later')
	}

	private async applicationEpochAdvanced(
		workspace: StoredWorkspace,
		pending: PendingWorkspaceApplication,
		messages: Awaited<ReturnType<PrivateWorkspaceCoordinator['fetchMessages']>>['messages'],
	): Promise<boolean> {
		let state = deserializeClientState(pending.basisStateBase64)
		const basisEpoch = String(state.groupContext.epoch)
		const probe: StoredWorkspace = {
			...workspace,
			stateBase64: pending.basisStateBase64,
			cursor: pending.basisCursor,
			envelopes: [...workspace.envelopes],
			pendingOutbound: workspace.pendingOutbound ? [...workspace.pendingOutbound] : undefined,
		}

		for (const message of messages) {
			const priorOutbound = probe.pendingOutbound?.find((item) => item.cursor === message.cursor)
			if (priorOutbound) {
				this.applyEnvelope(probe, priorOutbound.envelope)
				continue
			}
			try {
				const mlsBase64 = message.encrypted
					? await openCoordinatorPayload(state, message.msg_64)
					: message.msg_64
				const processed = await processWorkspaceMessage({
					state,
					messageBase64: mlsBase64,
					administratorPubkeys: this.administratorPolicy(probe).administrators,
				})
				state = processed.newState
				if (processed.kind === 'applicationMessage') {
					this.applyEnvelope(probe, processed.envelope)
				}
			} catch {
				// Invalid/stale records do not advance the usable MLS epoch.
			}
			if (String(state.groupContext.epoch) !== basisEpoch) return true
		}
		return false
	}

	private async catchUpBeforeStaleApplication(
		workspace: StoredWorkspace,
		pending: PendingWorkspaceApplication,
		messages: Awaited<ReturnType<PrivateWorkspaceCoordinator['fetchMessages']>>['messages'],
	): Promise<void> {
		let state = deserializeClientState(pending.basisStateBase64)
		for (const message of messages) {
			const pendingOutboundIndex = workspace.pendingOutbound?.findIndex(
				(item) => item.cursor === message.cursor,
			)
			if (pendingOutboundIndex !== undefined && pendingOutboundIndex >= 0) {
				const priorOutbound = workspace.pendingOutbound?.[pendingOutboundIndex]
				if (priorOutbound) this.applyEnvelope(workspace, priorOutbound.envelope)
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
				} else if (processed.kind === 'rejected') {
					this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'rejected')
				}
				if (!memberPubkeysFromState(state).includes(workspace.ownerPubkey)) {
					workspace.status = 'removed'
				}
			} catch {
				this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'stale-or-invalid')
			} finally {
				workspace.cursor = message.cursor
			}
			if (workspace.status === 'removed') break
		}
		workspace.stateBase64 = serializeClientState(state)
		this.reconcileAcknowledgedOutbounds(workspace, workspace.cursor)
		this.administratorPolicy(workspace)
	}

	private async rebuildPendingApplication(
		workspace: StoredWorkspace,
		pending: PendingWorkspaceApplication,
	): Promise<PendingWorkspaceApplication> {
		const oldState = deserializeClientState(workspace.stateBase64)
		const outbound = pending.forwarded
			? await createForwardedWorkspaceApplicationMessage({
					state: oldState,
					envelope: pending.envelope,
				})
			: await createWorkspaceApplicationMessage({ state: oldState, envelope: pending.envelope })
		return {
			version: 1,
			envelope: pending.envelope,
			forwarded: pending.forwarded,
			basisCursor: workspace.cursor,
			basisStateBase64: workspace.stateBase64,
			msgBase64: await sealCoordinatorPayload(oldState, outbound.messageBase64),
			finalStateBase64: serializeClientState(outbound.newState),
			attempt: pending.attempt + 1,
		}
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

	private async takeApprovalKeyPackage(
		request: Pick<WorkspaceJoinRequest, 'pk' | 'kp_ref'>,
		coordinator: PrivateWorkspaceCoordinator,
	): Promise<{ keyPackageBase64: string }> {
		const consumed = await coordinator.takeKeyPackage({ id: request.kp_ref })
		if (!consumed.keyPackage) {
			throw new Error('The requested MLS KeyPackage is no longer available')
		}
		const published = consumed.keyPackage
		if (!verifyEvent(published.event)) throw new Error('Invalid KeyPackage publication signature')
		if (published.kp_ref !== request.kp_ref) {
			throw new Error('Coordinator returned a different KeyPackage than requested')
		}
		if (published.pk !== request.pk || published.event.pubkey !== request.pk) {
			throw new Error('Join request identity does not match its KeyPackage publication')
		}
		const keyPackageBase64 = publicationKeyPackageBase64(published.event)
		if (credentialPubkeyFromKeyPackage(decodeKeyPackage(keyPackageBase64)) !== request.pk) {
			throw new Error('KeyPackage credential is not bound to the requesting Nostr account')
		}
		return { keyPackageBase64 }
	}

	private async createPendingApproval(
		workspace: StoredWorkspace,
		request: Pick<WorkspaceJoinRequest, 'pk' | 'kp_ref' | 'at'>,
		keyPackageBase64: string,
		attempt: number,
	): Promise<PendingWorkspaceApproval> {
		const keyPackage = decodeKeyPackage(keyPackageBase64)
		if (credentialPubkeyFromKeyPackage(keyPackage) !== request.pk) {
			throw new Error('KeyPackage credential is not bound to the requesting Nostr account')
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
		return {
			version: 1,
			targetPubkey: request.pk,
			keyPackageRef: request.kp_ref,
			keyPackageBase64,
			requestAt: request.at,
			basisCursor: checkpointBasisCursor,
			basisStateBase64: workspace.stateBase64,
			welcomeBase64: added.welcomeBase64,
			finalStateBase64: serializeClientState(plannedState),
			messages,
			attempt,
		}
	}

	private async createPendingRemoval(
		workspace: StoredWorkspace,
		targetPubkey: string,
		attempt: number,
	): Promise<PendingWorkspaceMembershipCommit> {
		const oldState = deserializeClientState(workspace.stateBase64)
		const removed = await removeWorkspaceMember({
			state: oldState,
			pubkey: targetPubkey,
		})
		return {
			version: 1,
			operation: 'remove',
			targetPubkey,
			basisCursor: workspace.cursor,
			basisStateBase64: workspace.stateBase64,
			msgBase64: await sealCoordinatorPayload(oldState, removed.commitBase64),
			finalStateBase64: serializeClientState(removed.newState),
			attempt,
		}
	}

	private recordSkippedCoordinatorMessage(
		workspace: StoredWorkspace,
		cursor: number,
		reason: 'rejected' | 'stale-or-invalid',
	): void {
		const previous = (workspace.skippedCoordinatorMessages ?? []).filter(
			(message) => message.cursor !== cursor,
		)
		workspace.skippedCoordinatorMessages = [
			...previous,
			{ cursor, reason, recordedAt: this.now() },
		].slice(-MAX_SKIPPED_COORDINATOR_MESSAGES)
	}

	private async resumePendingMembershipCommit(
		workspace: StoredWorkspace,
		coordinator: PrivateWorkspaceCoordinator,
	): Promise<StoredWorkspace> {
		for (let pass = 0; pass < MAX_MEMBERSHIP_RECOVERY_PASSES; pass += 1) {
			const pending = workspace.pendingMembershipCommit
			if (pending?.version !== 1 || pending.operation !== 'remove') {
				throw new Error('Unsupported private-map membership recovery journal')
			}
			if (workspace.pendingApproval) {
				throw new Error('Finish the pending member approval before changing membership')
			}

			const firstFetch = await coordinator.fetchMessages({
				gid: workspace.groupId,
				after: pending.basisCursor > 0 ? pending.basisCursor : undefined,
			})
			if (pending.cursor === undefined) {
				const existing = firstFetch.messages.find((message) => message.msg_64 === pending.msgBase64)
				if (existing) {
					pending.cursor = existing.cursor
				} else {
					const posted = await coordinator.postMessage({
						gid: workspace.groupId,
						msg_64: pending.msgBase64,
					})
					pending.cursor = posted.cursor
				}
				await this.options.store.putWorkspace(workspace)
			}

			const delivered = await coordinator.fetchMessages({
				gid: workspace.groupId,
				after: pending.basisCursor > 0 ? pending.basisCursor : undefined,
			})
			let state = deserializeClientState(pending.basisStateBase64)
			let replayCursor = pending.basisCursor
			let epochChangedBeforeOwnCommit = false
			let ownCommitAccepted = false
			let ownCommitObserved = false

			for (const message of delivered.messages.sort((a, b) => a.cursor - b.cursor)) {
				if (message.cursor <= replayCursor) continue
				if (message.msg_64 === pending.msgBase64) {
					ownCommitObserved = true
					const policy = this.administratorPolicy(workspace)
					const currentMembers = memberPubkeysFromState(state)
					if (
						!epochChangedBeforeOwnCommit &&
						policy.administrators.includes(workspace.ownerPubkey) &&
						!policy.administrators.includes(pending.targetPubkey) &&
						currentMembers.includes(pending.targetPubkey)
					) {
						state = deserializeClientState(pending.finalStateBase64)
						ownCommitAccepted = true
					} else {
						this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'stale-or-invalid')
					}
					replayCursor = message.cursor
					continue
				}

				try {
					const epochBefore = String(state.groupContext.epoch)
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
					} else if (processed.kind === 'rejected') {
						this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'rejected')
					}
					if (!ownCommitAccepted && String(state.groupContext.epoch) !== epochBefore) {
						epochChangedBeforeOwnCommit = true
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
						this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'stale-or-invalid')
					}
				} finally {
					replayCursor = message.cursor
				}
				if (workspace.status === 'removed') break
			}

			if (!ownCommitObserved) {
				throw new Error('Coordinator did not return the posted private-group membership record')
			}

			workspace.stateBase64 = serializeClientState(state)
			workspace.cursor = replayCursor
			this.reconcileAcknowledgedOutbounds(workspace, replayCursor)
			const policy = this.administratorPolicy(workspace)
			const currentMembers = memberPubkeysFromState(state)

			if (
				workspace.status === 'removed' ||
				ownCommitAccepted ||
				!currentMembers.includes(pending.targetPubkey)
			) {
				workspace.pendingMembershipCommit = undefined
				await this.options.store.putWorkspace(workspace)
				return workspace
			}
			if (!policy.administrators.includes(workspace.ownerPubkey)) {
				workspace.pendingMembershipCommit = undefined
				await this.options.store.putWorkspace(workspace)
				throw new Error('Administrator role changed concurrently; member removal was not applied')
			}
			if (policy.administrators.includes(pending.targetPubkey)) {
				workspace.pendingMembershipCommit = undefined
				await this.options.store.putWorkspace(workspace)
				throw new Error('The member became an administrator concurrently and was not removed')
			}

			workspace.pendingMembershipCommit = await this.createPendingRemoval(
				workspace,
				pending.targetPubkey,
				pending.attempt + 1,
			)
			await this.options.store.putWorkspace(workspace)
		}

		throw new Error('Private-map membership kept changing; removal will resume on the next sync')
	}

	private async resumePendingApproval(
		workspace: StoredWorkspace,
		coordinator: PrivateWorkspaceCoordinator,
	): Promise<StoredWorkspace> {
		for (let pass = 0; pass < MAX_MEMBERSHIP_RECOVERY_PASSES; pass += 1) {
			const approval = workspace.pendingApproval
			if (approval?.version !== 1) {
				throw new Error('Unsupported private-map approval recovery journal')
			}
			if (approval.messages.length === 0 || approval.messages[0]?.type !== 'commit') {
				throw new Error('Invalid private-map approval recovery journal')
			}
			if (approval.localFinalized) {
				return this.completePendingApprovalPublication(workspace, coordinator)
			}
			this.requireAdministrator(workspace, workspace.ownerPubkey, 'recover member approval')

			const firstFetch = await coordinator.fetchMessages({
				gid: workspace.groupId,
				after: approval.basisCursor > 0 ? approval.basisCursor : undefined,
			})
			for (const planned of approval.messages) {
				if (planned.cursor !== undefined) continue
				const existing = firstFetch.messages.find((message) => message.msg_64 === planned.msgBase64)
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
			const deliveredCiphertexts = new Set(delivered.messages.map((message) => message.msg_64))
			const plannedCursors = approval.messages.map((message) => message.cursor)
			const planIsContiguousFromBasis = plannedCursors.every(
				(cursor, index) => cursor === approval.basisCursor + index + 1,
			)
			const coordinatorOmittedPlannedMessages = approval.messages.some(
				(message) => !deliveredCiphertexts.has(message.msgBase64),
			)
			if (coordinatorOmittedPlannedMessages && !planIsContiguousFromBasis) {
				throw new Error('Coordinator did not return the posted private-group approval records')
			}
			const finalPlannedCursor = Math.max(
				approval.basisCursor,
				...plannedCursors.map((cursor) => cursor ?? 0),
			)
			const replayMessages = coordinatorOmittedPlannedMessages
				? [
						...approval.messages.map((message) => ({
							cursor: message.cursor ?? 0,
							gid: workspace.groupId,
							msg_64: message.msgBase64,
							at: 0,
							encrypted: true,
						})),
						...delivered.messages.filter((message) => message.cursor > finalPlannedCursor),
					]
				: delivered.messages

			this.reconcileAcknowledgedOutbounds(workspace, approval.basisCursor)
			let state = deserializeClientState(approval.basisStateBase64 ?? workspace.stateBase64)
			let replayCursor = approval.basisCursor
			let epochChangedBeforeOwnCommit = false
			let ownCommitAccepted = false
			const plannedByCiphertext = new Map(
				approval.messages.map((message) => [message.msgBase64, message]),
			)

			for (const message of replayMessages.sort((a, b) => a.cursor - b.cursor)) {
				if (message.cursor <= replayCursor) continue
				const ownPlanned = plannedByCiphertext.get(message.msg_64)
				if (ownPlanned) {
					if (ownPlanned.type === 'commit') {
						const policy = this.administratorPolicy(workspace)
						if (
							!epochChangedBeforeOwnCommit &&
							policy.administrators.includes(workspace.ownerPubkey) &&
							!memberPubkeysFromState(state).includes(approval.targetPubkey)
						) {
							state = deserializeClientState(approval.finalStateBase64)
							for (const planned of approval.messages) {
								if (planned.type === 'application' && planned.envelope) {
									this.applyEnvelope(workspace, planned.envelope)
								}
							}
							ownCommitAccepted = true
						} else {
							this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'stale-or-invalid')
						}
					} else if (!ownCommitAccepted) {
						this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'stale-or-invalid')
					}
					replayCursor = message.cursor
					continue
				}

				try {
					const epochBefore = String(state.groupContext.epoch)
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
					} else if (processed.kind === 'rejected') {
						this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'rejected')
					}
					if (!ownCommitAccepted && String(state.groupContext.epoch) !== epochBefore) {
						epochChangedBeforeOwnCommit = true
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
						this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'stale-or-invalid')
					}
				} finally {
					replayCursor = message.cursor
				}
				if (workspace.status === 'removed') break
			}

			workspace.stateBase64 = serializeClientState(state)
			workspace.cursor = replayCursor
			const policy = this.administratorPolicy(workspace)
			const currentMembers = memberPubkeysFromState(state)

			if (workspace.status === 'removed') {
				workspace.pendingApproval = undefined
				await this.options.store.putWorkspace(workspace)
				return workspace
			}
			if (ownCommitAccepted && currentMembers.includes(approval.targetPubkey)) {
				approval.localFinalized = true
				await this.options.store.putWorkspace(workspace)
				return this.completePendingApprovalPublication(workspace, coordinator)
			}
			if (currentMembers.includes(approval.targetPubkey)) {
				await coordinator.takeJoinRequests({
					gid: workspace.groupId,
					consumed: [{ pk: approval.targetPubkey, at: approval.requestAt }],
				})
				workspace.pendingApproval = undefined
				await this.options.store.putWorkspace(workspace)
				return workspace
			}
			if (!policy.administrators.includes(workspace.ownerPubkey)) {
				workspace.pendingApproval = undefined
				await this.options.store.putWorkspace(workspace)
				throw new Error('Administrator role changed concurrently; member approval was not applied')
			}

			let keyPackageBase64 = approval.keyPackageBase64
			if (!keyPackageBase64) {
				keyPackageBase64 = (
					await this.takeApprovalKeyPackage(
						{ pk: approval.targetPubkey, kp_ref: approval.keyPackageRef },
						coordinator,
					)
				).keyPackageBase64
			}
			workspace.pendingApproval = await this.createPendingApproval(
				workspace,
				{
					pk: approval.targetPubkey,
					kp_ref: approval.keyPackageRef,
					at: approval.requestAt,
				},
				keyPackageBase64,
				(approval.attempt ?? 1) + 1,
			)
			await this.options.store.putWorkspace(workspace)
		}

		throw new Error('Private-map membership kept changing; approval will resume on the next sync')
	}

	private async completePendingApprovalPublication(
		workspace: StoredWorkspace,
		coordinator: PrivateWorkspaceCoordinator,
	): Promise<StoredWorkspace> {
		const approval = workspace.pendingApproval
		if (approval?.version !== 1 || !approval.localFinalized) {
			throw new Error('Private-map approval is not ready to publish its Welcome')
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
				} else if (processed.kind === 'rejected') {
					this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'rejected')
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
					this.recordSkippedCoordinatorMessage(workspace, message.cursor, 'stale-or-invalid')
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
