import type { PrivateWorkspaceEnvelope } from './envelope'

export type WorkspaceRole = 'administrator' | 'member'
export type WorkspaceStatus = 'active' | 'removed'

export interface WorkspaceMetadata {
	name: string
	description?: string
	recommendedBasemap?: string
}

export interface PendingWorkspaceOutbound {
	cursor: number
	envelope: PrivateWorkspaceEnvelope
}

export interface StoredWorkspace {
	workspaceId: string
	groupId: string
	ownerPubkey: string
	adminPubkey: string
	coordinatorPubkey: string
	relays: string[]
	role: WorkspaceRole
	status: WorkspaceStatus
	stateBase64: string
	cursor: number
	metadata?: WorkspaceMetadata
	envelopes: PrivateWorkspaceEnvelope[]
	pendingOutbound?: PendingWorkspaceOutbound[]
	createdAt: number
}

export interface StoredMlsKeyPackage {
	ownerPubkey: string
	keyPackageRef: string
	keyPackageBase64: string
	privateKeyPackageBase64: string
	published: boolean
	createdAt: number
}

export interface PendingWorkspaceJoin {
	ownerPubkey: string
	workspaceId: string
	groupId: string
	adminPubkey: string
	coordinatorPubkey: string
	relays: string[]
	keyPackageRef: string
	createdAt: number
}

export interface PrivateWorkspaceStore {
	listWorkspaces(ownerPubkey: string): Promise<StoredWorkspace[]>
	getWorkspace(ownerPubkey: string, workspaceId: string): Promise<StoredWorkspace | undefined>
	putWorkspace(workspace: StoredWorkspace): Promise<void>
	putKeyPackage(keyPackage: StoredMlsKeyPackage): Promise<void>
	getKeyPackage(
		ownerPubkey: string,
		keyPackageRef: string,
	): Promise<StoredMlsKeyPackage | undefined>
	putPendingJoin(join: PendingWorkspaceJoin): Promise<void>
	listPendingJoins(ownerPubkey: string): Promise<PendingWorkspaceJoin[]>
	deletePendingJoin(ownerPubkey: string, keyPackageRef: string): Promise<void>
}

const DB_NAME = 'earthly-private-workspaces'
const DB_VERSION = 1

function workspaceKey(ownerPubkey: string, workspaceId: string) {
	return `${ownerPubkey}:${workspaceId}`
}

function keyPackageKey(ownerPubkey: string, keyPackageRef: string) {
	return `${ownerPubkey}:${keyPackageRef}`
}

function request<T>(idbRequest: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		idbRequest.onsuccess = () => resolve(idbRequest.result)
		idbRequest.onerror = () => reject(idbRequest.error ?? new Error('IndexedDB request failed'))
	})
}

export class BrowserPrivateWorkspaceStore implements PrivateWorkspaceStore {
	private dbPromise?: Promise<IDBDatabase>

	private open(): Promise<IDBDatabase> {
		if (typeof indexedDB === 'undefined') throw new Error('Private map storage requires IndexedDB')
		this.dbPromise ??= new Promise((resolve, reject) => {
			const open = indexedDB.open(DB_NAME, DB_VERSION)
			open.onupgradeneeded = () => {
				const db = open.result
				if (!db.objectStoreNames.contains('workspaces')) db.createObjectStore('workspaces')
				if (!db.objectStoreNames.contains('keyPackages')) db.createObjectStore('keyPackages')
				if (!db.objectStoreNames.contains('pendingJoins')) db.createObjectStore('pendingJoins')
			}
			open.onsuccess = () => resolve(open.result)
			open.onerror = () => reject(open.error ?? new Error('Failed to open private map storage'))
		})
		return this.dbPromise
	}

	private async values<T>(storeName: string): Promise<T[]> {
		const db = await this.open()
		return request(db.transaction(storeName).objectStore(storeName).getAll()) as Promise<T[]>
	}

	private async get<T>(storeName: string, key: string): Promise<T | undefined> {
		const db = await this.open()
		return request(db.transaction(storeName).objectStore(storeName).get(key)) as Promise<
			T | undefined
		>
	}

	private async put<T>(storeName: string, key: string, value: T): Promise<void> {
		const db = await this.open()
		const transaction = db.transaction(storeName, 'readwrite')
		await request(transaction.objectStore(storeName).put(value, key))
	}

	private async delete(storeName: string, key: string): Promise<void> {
		const db = await this.open()
		const transaction = db.transaction(storeName, 'readwrite')
		await request(transaction.objectStore(storeName).delete(key))
	}

	async listWorkspaces(ownerPubkey: string) {
		return (await this.values<StoredWorkspace>('workspaces'))
			.filter((workspace) => workspace.ownerPubkey === ownerPubkey)
			.sort((a, b) => b.createdAt - a.createdAt)
	}

	getWorkspace(ownerPubkey: string, workspaceId: string) {
		return this.get<StoredWorkspace>('workspaces', workspaceKey(ownerPubkey, workspaceId))
	}

	putWorkspace(workspace: StoredWorkspace) {
		return this.put(
			'workspaces',
			workspaceKey(workspace.ownerPubkey, workspace.workspaceId),
			workspace,
		)
	}

	putKeyPackage(keyPackage: StoredMlsKeyPackage) {
		return this.put(
			'keyPackages',
			keyPackageKey(keyPackage.ownerPubkey, keyPackage.keyPackageRef),
			keyPackage,
		)
	}

	getKeyPackage(ownerPubkey: string, keyPackageRef: string) {
		return this.get<StoredMlsKeyPackage>('keyPackages', keyPackageKey(ownerPubkey, keyPackageRef))
	}

	putPendingJoin(join: PendingWorkspaceJoin) {
		return this.put('pendingJoins', keyPackageKey(join.ownerPubkey, join.keyPackageRef), join)
	}

	async listPendingJoins(ownerPubkey: string) {
		return (await this.values<PendingWorkspaceJoin>('pendingJoins')).filter(
			(join) => join.ownerPubkey === ownerPubkey,
		)
	}

	deletePendingJoin(ownerPubkey: string, keyPackageRef: string) {
		return this.delete('pendingJoins', keyPackageKey(ownerPubkey, keyPackageRef))
	}
}

export class MemoryPrivateWorkspaceStore implements PrivateWorkspaceStore {
	private readonly workspaces = new Map<string, StoredWorkspace>()
	private readonly keyPackages = new Map<string, StoredMlsKeyPackage>()
	private readonly pendingJoins = new Map<string, PendingWorkspaceJoin>()

	async listWorkspaces(ownerPubkey: string) {
		return [...this.workspaces.values()].filter((item) => item.ownerPubkey === ownerPubkey)
	}
	async getWorkspace(ownerPubkey: string, workspaceId: string) {
		return this.workspaces.get(workspaceKey(ownerPubkey, workspaceId))
	}
	async putWorkspace(workspace: StoredWorkspace) {
		this.workspaces.set(workspaceKey(workspace.ownerPubkey, workspace.workspaceId), workspace)
	}
	async putKeyPackage(keyPackage: StoredMlsKeyPackage) {
		this.keyPackages.set(
			keyPackageKey(keyPackage.ownerPubkey, keyPackage.keyPackageRef),
			keyPackage,
		)
	}
	async getKeyPackage(ownerPubkey: string, keyPackageRef: string) {
		return this.keyPackages.get(keyPackageKey(ownerPubkey, keyPackageRef))
	}
	async putPendingJoin(join: PendingWorkspaceJoin) {
		this.pendingJoins.set(keyPackageKey(join.ownerPubkey, join.keyPackageRef), join)
	}
	async listPendingJoins(ownerPubkey: string) {
		return [...this.pendingJoins.values()].filter((item) => item.ownerPubkey === ownerPubkey)
	}
	async deletePendingJoin(ownerPubkey: string, keyPackageRef: string) {
		this.pendingJoins.delete(keyPackageKey(ownerPubkey, keyPackageRef))
	}
}
