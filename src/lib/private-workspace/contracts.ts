import type { NostrEvent } from 'nostr-tools'

export const CORDN_METHODS = {
	publishKeyPackage: 'kp_publish',
	listKeyPackages: 'kp_list',
	takeKeyPackage: 'kp_take',
	removeKeyPackages: 'kp_remove',
	takeWelcomes: 'welcome_take',
	storeWelcome: 'welcome_store',
	storeJoinRequest: 'join_request_store',
	takeJoinRequests: 'join_request_take',
	takeManyJoinRequests: 'join_request_take_many',
	postMessage: 'msg_post',
	fetchMessages: 'msg_fetch',
	fetchManyMessages: 'msg_fetch_many',
	subscribeManyMessages: 'msg_sub_many',
} as const

export type CordnProtocolVersion = 'unknown' | 'v4' | 'v5'

export interface GroupCursor {
	gid: string
	after?: number
}

export interface ConsumedGroupJoinRequest {
	gid: string
	pk: string
	at: number
}

export interface PublishedKeyPackage {
	pk: string
	kp_ref: string
	last_resort: boolean
	at: number
	event: NostrEvent
}

export interface AvailableKeyPackage {
	pk: string
	kp_ref: string
	last_resort: boolean
	at: number
}

export interface PendingWelcome {
	kp_ref: string
	welcome_64: string
	at: number
	after?: number
}

export interface PendingJoinRequest {
	pk: string
	kp_ref: string
	at: number
}

export interface GroupPendingJoinRequest extends PendingJoinRequest {
	gid: string
}

export interface CoordinatorMessage {
	cursor: number
	gid: string
	msg_64: string
	at: number
	/**
	 * Cordn v0.5+ servers are encrypted-only and omit this field.
	 * Cordn v0.4 servers may send `false` for legacy plaintext frames.
	 */
	encrypted?: boolean
}

/**
 * Cordn v0.5 omits `encrypted` because every group payload is outer-encrypted.
 * Default to `true` while preserving explicit v0.4 `encrypted: false`.
 */
export function isCoordinatorMessageEncrypted(
	message: Pick<CoordinatorMessage, 'encrypted'>,
): boolean {
	return message.encrypted ?? true
}

export interface CoordinatorMessageStreamSubscription {
	readonly active: boolean
	readonly closed: Promise<void>
	close(reason?: string): Promise<void>
}

export interface SubscribeManyMessagesInput {
	groups: GroupCursor[]
	onMessage: (message: CoordinatorMessage) => void | Promise<void>
	onError?: (error: Error) => void
	onClose?: () => void
}

export interface PrivateWorkspaceCoordinator {
	publishKeyPackage(input: { kp_ref: string; kp_64: string }): Promise<{
		kp_ref: string
		last_resort: boolean
		at: number
	}>
	listKeyPackages(): Promise<{ keyPackages: AvailableKeyPackage[] }>
	takeKeyPackage(input: { id: string }): Promise<{ keyPackage: PublishedKeyPackage | null }>
	removeKeyPackages(input: { kp_refs: string[] }): Promise<{ kp_refs: string[] }>
	takeWelcomes(input?: { consumed?: Array<{ kp_ref: string; at: number }> }): Promise<{
		welcomes: PendingWelcome[]
	}>
	storeWelcome(input: {
		target_pk: string
		kp_ref: string
		welcome_64: string
		after?: number
	}): Promise<{ at: number }>
	storeJoinRequest(input: { gid: string; kp_ref: string }): Promise<{ at: number }>
	takeJoinRequests(input: {
		gid: string
		consumed?: Array<{ pk: string; at: number }>
	}): Promise<{ requests: PendingJoinRequest[] }>
	takeManyJoinRequests?(input: {
		groups: Array<{ gid: string }>
		consumed?: ConsumedGroupJoinRequest[]
	}): Promise<{ requests: GroupPendingJoinRequest[] }>
	postMessage(input: { gid: string; msg_64: string }): Promise<{
		cursor: number
		gid: string
		at: number
	}>
	fetchMessages(input: { gid: string; after?: number }): Promise<{
		messages: CoordinatorMessage[]
	}>
	fetchManyMessages?(input: { groups: GroupCursor[] }): Promise<{
		messages: CoordinatorMessage[]
	}>
	subscribeManyMessages?(
		input: SubscribeManyMessagesInput,
	): Promise<CoordinatorMessageStreamSubscription>
	disconnect(): Promise<void>
}
