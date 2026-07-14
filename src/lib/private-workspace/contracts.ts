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
	postMessage: 'msg_post',
	fetchMessages: 'msg_fetch',
} as const

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

export interface CoordinatorMessage {
	cursor: number
	gid: string
	msg_64: string
	at: number
	encrypted?: boolean
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
	postMessage(input: { gid: string; msg_64: string }): Promise<{
		cursor: number
		gid: string
		at: number
	}>
	fetchMessages(input: { gid: string; after?: number }): Promise<{
		messages: CoordinatorMessage[]
	}>
	disconnect(): Promise<void>
}
