import { Client } from '@modelcontextprotocol/sdk/client'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
	ApplesauceRelayPool,
	EncryptionMode,
	NostrClientTransport,
	PrivateKeySigner,
	type NostrSigner,
} from '@contextvm/sdk'
import { CORDN_METHODS, type PrivateWorkspaceCoordinator } from './contracts'

type CoordinatorOptions = {
	serverPubkey: string
	relays: string[]
	signer: NostrSigner
}

export const CORDN_REQUEST_TIMEOUT_MS = 30_000

export async function withCoordinatorDeadline<T>(
	operation: Promise<T>,
	label: string,
	timeoutMs = CORDN_REQUEST_TIMEOUT_MS,
): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			operation,
			new Promise<T>((_, reject) => {
				timeout = setTimeout(
					() =>
						reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`)),
					timeoutMs,
				)
			}),
		])
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

function structured<T>(result: unknown, method: string): T {
	if (!result || typeof result !== 'object' || !('structuredContent' in result)) {
		throw new Error(`Coordinator returned no structured result for ${method}`)
	}
	const content = (result as { structuredContent?: unknown }).structuredContent
	if (!content || typeof content !== 'object') {
		throw new Error(`Coordinator returned no structured result for ${method}`)
	}
	return content as T
}

/**
 * Cordn-compatible ContextVM client.
 *
 * Identity-bound operations use Earthly's active account signer. Delivery-only
 * operations use an ephemeral transport signer so the coordinator does not learn
 * the stable account pubkey from every group-message fetch and post.
 */
export class CordnCoordinatorClient implements PrivateWorkspaceCoordinator {
	private readonly stableClient: Client
	private readonly stableTransport: NostrClientTransport
	private readonly stableConnected: Promise<void>
	private readonly deliveryClient: Client
	private readonly deliveryTransport: NostrClientTransport
	private readonly deliveryConnected: Promise<void>

	constructor(options: CoordinatorOptions) {
		if (!/^[0-9a-f]{64}$/u.test(options.serverPubkey)) {
			throw new Error('The Cordn coordinator pubkey is not configured')
		}
		if (options.relays.length === 0)
			throw new Error('The Cordn coordinator needs at least one relay')

		const relayHandler = new ApplesauceRelayPool(options.relays)
		this.stableClient = new Client({ name: 'EarthlyPrivateMaps', version: '0.1.0' })
		this.deliveryClient = new Client({ name: 'EarthlyPrivateMapsDelivery', version: '0.1.0' })

		const transportOptions = {
			serverPubkey: options.serverPubkey,
			relayHandler,
			isStateless: true,
			logLevel: 'silent' as const,
			encryptionMode: EncryptionMode.DISABLED,
			openStream: { enabled: true },
			oversizedTransfer: { enabled: true },
		}
		this.stableTransport = new NostrClientTransport({
			...transportOptions,
			signer: options.signer,
		})
		this.deliveryTransport = new NostrClientTransport({
			...transportOptions,
			signer: new PrivateKeySigner(),
		})
		this.stableConnected = this.stableClient.connect(this.stableTransport as Transport)
		this.deliveryConnected = this.deliveryClient.connect(this.deliveryTransport as Transport)
	}

	async disconnect(): Promise<void> {
		await Promise.allSettled([this.stableTransport.close(), this.deliveryTransport.close()])
		await Promise.allSettled([this.stableConnected, this.deliveryConnected])
	}

	private async call<T>(
		identity: 'stable' | 'delivery',
		method: string,
		args: Record<string, unknown>,
	): Promise<T> {
		const client = identity === 'stable' ? this.stableClient : this.deliveryClient
		await withCoordinatorDeadline(
			identity === 'stable' ? this.stableConnected : this.deliveryConnected,
			`${method} coordinator connection`,
		)
		const result = await client.callTool({ name: method, arguments: args }, undefined, {
			onprogress: () => undefined,
			timeout: CORDN_REQUEST_TIMEOUT_MS,
			resetTimeoutOnProgress: true,
			maxTotalTimeout: CORDN_REQUEST_TIMEOUT_MS,
		})
		return structured<T>(result, method)
	}

	publishKeyPackage(input: { kp_ref: string; kp_64: string }) {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['publishKeyPackage']>>>(
			'stable',
			CORDN_METHODS.publishKeyPackage,
			input,
		)
	}

	listKeyPackages() {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['listKeyPackages']>>>(
			'delivery',
			CORDN_METHODS.listKeyPackages,
			{},
		)
	}

	takeKeyPackage(input: { id: string }) {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['takeKeyPackage']>>>(
			'delivery',
			CORDN_METHODS.takeKeyPackage,
			input,
		)
	}

	removeKeyPackages(input: { kp_refs: string[] }) {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['removeKeyPackages']>>>(
			'stable',
			CORDN_METHODS.removeKeyPackages,
			input,
		)
	}

	takeWelcomes(input: { consumed?: Array<{ kp_ref: string; at: number }> } = {}) {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['takeWelcomes']>>>(
			'stable',
			CORDN_METHODS.takeWelcomes,
			input,
		)
	}

	storeWelcome(input: { target_pk: string; kp_ref: string; welcome_64: string; after?: number }) {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['storeWelcome']>>>(
			'delivery',
			CORDN_METHODS.storeWelcome,
			input,
		)
	}

	storeJoinRequest(input: { gid: string; kp_ref: string }) {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['storeJoinRequest']>>>(
			'stable',
			CORDN_METHODS.storeJoinRequest,
			input,
		)
	}

	takeJoinRequests(input: { gid: string; consumed?: Array<{ pk: string; at: number }> }) {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['takeJoinRequests']>>>(
			'delivery',
			CORDN_METHODS.takeJoinRequests,
			input,
		)
	}

	postMessage(input: { gid: string; msg_64: string }) {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['postMessage']>>>(
			'delivery',
			CORDN_METHODS.postMessage,
			input,
		)
	}

	fetchMessages(input: { gid: string; after?: number }) {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['fetchMessages']>>>(
			'delivery',
			CORDN_METHODS.fetchMessages,
			input,
		)
	}
}
