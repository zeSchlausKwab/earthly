import { Client } from '@modelcontextprotocol/sdk/client'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
	ApplesauceRelayPool,
	callToolStream,
	EncryptionMode,
	NostrClientTransport,
	PrivateKeySigner,
	type NostrSigner,
} from '@contextvm/sdk'
import {
	CORDN_METHODS,
	type ConsumedGroupJoinRequest,
	type CoordinatorMessage,
	type CoordinatorMessageStreamSubscription,
	type CordnProtocolVersion,
	type GroupCursor,
	type GroupPendingJoinRequest,
	type PendingJoinRequest,
	type PrivateWorkspaceCoordinator,
	type SubscribeManyMessagesInput,
} from './contracts'

export interface CordnToolStreamHandle {
	readonly stream: AsyncIterable<{ value: string; chunkIndex: number }> & {
		readonly isActive?: boolean
		abort(reason?: string): Promise<void>
	}
	readonly result: Promise<unknown>
	abort(reason?: string): Promise<void>
}

export interface CordnRpcAdapter {
	callTool(
		identity: 'stable' | 'delivery',
		method: string,
		args: Record<string, unknown>,
	): Promise<unknown>
	callToolStream?(method: string, args: Record<string, unknown>): Promise<CordnToolStreamHandle>
	disconnect(): Promise<void>
}

export type CoordinatorOptions = {
	serverPubkey: string
	relays: string[]
	signer: NostrSigner
	/** Optional injectable RPC adapter used by unit tests. */
	rpcAdapter?: CordnRpcAdapter
}

export const CORDN_REQUEST_TIMEOUT_MS = 30_000

export class CordnUnsupportedStreamingError extends Error {
	constructor(message = 'Coordinator does not support live message streaming') {
		super(message)
		this.name = 'CordnUnsupportedStreamingError'
	}
}

export function isMethodNotFoundError(error: unknown): boolean {
	if (!error) return false
	if (
		typeof error === 'object' &&
		'code' in error &&
		(error as { code?: unknown }).code === -32601
	) {
		return true
	}
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
	return /(?:unknown\s+tool|tool\s+['"`]?[\w.-]+['"`]?\s+not\s+found|tool\s+not\s+found|method\s+not\s+found|-32601|not\s+implemented|unsupported\s+(?:tool|method))/iu.test(
		message,
	)
}

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

function extractToolErrorText(result: Record<string, unknown>): string | undefined {
	if (result.isError !== true) return undefined
	const content = result.content
	if (Array.isArray(content)) {
		const texts = content
			.map((item) =>
				item && typeof item === 'object' && 'text' in item && typeof item.text === 'string'
					? item.text.trim()
					: '',
			)
			.filter(Boolean)
		if (texts.length > 0) return texts.join(' ')
	}
	return 'Cordn tool returned an error'
}

function structured<T>(result: unknown, method: string): T {
	if (!result || typeof result !== 'object') {
		throw new Error(`Coordinator returned no structured result for ${method}`)
	}
	const record = result as Record<string, unknown>
	const toolError = extractToolErrorText(record)
	if (toolError) {
		throw new Error(`Cordn ${method} error: ${toolError}`)
	}
	if (!('structuredContent' in record)) {
		throw new Error(`Coordinator returned no structured result for ${method}`)
	}
	const content = record.structuredContent
	if (!content || typeof content !== 'object') {
		throw new Error(`Coordinator returned no structured result for ${method}`)
	}
	return content as T
}

function isCoordinatorMessage(value: unknown): value is CoordinatorMessage {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false
	const record = value as Record<string, unknown>
	return (
		typeof record.cursor === 'number' &&
		Number.isFinite(record.cursor) &&
		typeof record.gid === 'string' &&
		record.gid.length > 0 &&
		typeof record.msg_64 === 'string' &&
		typeof record.at === 'number' &&
		Number.isFinite(record.at) &&
		(record.encrypted === undefined || typeof record.encrypted === 'boolean')
	)
}

function extractMessagesFromParsedValue(parsed: unknown): CoordinatorMessage[] {
	if (isCoordinatorMessage(parsed)) return [parsed]
	if (Array.isArray(parsed)) return parsed.filter(isCoordinatorMessage)
	if (!parsed || typeof parsed !== 'object') return []
	const record = parsed as Record<string, unknown>
	if (isCoordinatorMessage(record.message)) return [record.message]
	if (Array.isArray(record.messages)) return record.messages.filter(isCoordinatorMessage)
	if (record.structuredContent && typeof record.structuredContent === 'object') {
		return extractMessagesFromParsedValue(record.structuredContent)
	}
	return []
}

/**
 * Parse one CEP-41 open-stream chunk emitted by Cordn v0.5 `msg_sub_many`.
 * Accepts a single JSON message, `{ message }`, `{ messages }`, a JSON array,
 * or newline-delimited JSON frames, ignoring non-message heartbeat frames.
 */
export function parseStreamedCoordinatorMessages(chunk: string): CoordinatorMessage[] {
	const trimmed = chunk.trim()
	if (!trimmed) return []
	try {
		return extractMessagesFromParsedValue(JSON.parse(trimmed) as unknown)
	} catch {
		const messages: CoordinatorMessage[] = []
		for (const line of trimmed.split(/\r?\n/u)) {
			const clean = line.trim()
			if (!clean) continue
			try {
				messages.push(...extractMessagesFromParsedValue(JSON.parse(clean) as unknown))
			} catch {
				// Ignore malformed/non-JSON heartbeat fragments
			}
		}
		return messages
	}
}

function createContextVmRpcAdapter(options: CoordinatorOptions): CordnRpcAdapter {
	const relayHandler = new ApplesauceRelayPool(options.relays)
	const stableClient = new Client({ name: 'EarthlyPrivateMaps', version: '0.2.0' })
	const deliveryClient = new Client({ name: 'EarthlyPrivateMapsDelivery', version: '0.2.0' })

	const transportOptions = {
		serverPubkey: options.serverPubkey,
		relayHandler,
		isStateless: true,
		logLevel: 'silent' as const,
		encryptionMode: EncryptionMode.DISABLED,
		openStream: { enabled: true },
		oversizedTransfer: { enabled: true },
	}
	const stableTransport = new NostrClientTransport({
		...transportOptions,
		signer: options.signer,
	})
	const deliveryTransport = new NostrClientTransport({
		...transportOptions,
		signer: new PrivateKeySigner(),
	})
	const stableConnected = stableClient.connect(stableTransport as Transport)
	const deliveryConnected = deliveryClient.connect(deliveryTransport as Transport)

	return {
		async callTool(identity, method, args) {
			const client = identity === 'stable' ? stableClient : deliveryClient
			await withCoordinatorDeadline(
				identity === 'stable' ? stableConnected : deliveryConnected,
				`${method} coordinator connection`,
			)
			return client.callTool({ name: method, arguments: args }, undefined, {
				onprogress: () => undefined,
				timeout: CORDN_REQUEST_TIMEOUT_MS,
				resetTimeoutOnProgress: true,
				maxTotalTimeout: CORDN_REQUEST_TIMEOUT_MS,
			})
		},
		async callToolStream(method, args) {
			await withCoordinatorDeadline(deliveryConnected, `${method} coordinator connection`)
			const call = await callToolStream({
				client: deliveryClient as unknown as Parameters<typeof callToolStream>[0]['client'],
				transport: deliveryTransport,
				name: method,
				arguments: args,
			})
			return {
				stream: call.stream,
				result: call.result,
				abort: (reason?: string) => call.abort(reason),
			}
		},
		async disconnect() {
			await Promise.allSettled([stableTransport.close(), deliveryTransport.close()])
			await Promise.allSettled([stableConnected, deliveryConnected])
		},
	}
}

/**
 * Cordn-compatible ContextVM client supporting both Cordn v0.5 (`msg_fetch_many`,
 * `msg_sub_many`, `join_request_take_many`) and Cordn v0.4 (`msg_fetch`,
 * `join_request_take`) with automatic cached protocol fallback.
 *
 * Identity-bound operations use Earthly's active account signer. Delivery-only
 * operations use an ephemeral transport signer so the coordinator does not learn
 * the stable account pubkey from every group-message fetch, stream, and post.
 */
export class CordnCoordinatorClient implements PrivateWorkspaceCoordinator {
	private readonly rpc: CordnRpcAdapter
	private protocolMode: CordnProtocolVersion = 'unknown'
	private streamingSupported: boolean | undefined

	constructor(options: CoordinatorOptions) {
		if (!/^[0-9a-f]{64}$/u.test(options.serverPubkey)) {
			throw new Error('The Cordn coordinator pubkey is not configured')
		}
		if (options.relays.length === 0)
			throw new Error('The Cordn coordinator needs at least one relay')

		this.rpc = options.rpcAdapter ?? createContextVmRpcAdapter(options)
	}

	getProtocolMode(): CordnProtocolVersion {
		return this.protocolMode
	}

	isStreamingSupported(): boolean {
		return this.protocolMode !== 'v4' && this.streamingSupported !== false
	}

	async disconnect(): Promise<void> {
		await this.rpc.disconnect()
	}

	private async call<T>(
		identity: 'stable' | 'delivery',
		method: string,
		args: Record<string, unknown>,
	): Promise<T> {
		const result = await this.rpc.callTool(identity, method, args)
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

	async takeJoinRequests(input: {
		gid: string
		consumed?: Array<{ pk: string; at: number }>
	}): Promise<{ requests: PendingJoinRequest[] }> {
		if (this.protocolMode !== 'v4') {
			try {
				const consumed: ConsumedGroupJoinRequest[] | undefined = input.consumed?.map((item) => ({
					gid: input.gid,
					pk: item.pk,
					at: item.at,
				}))
				const result = await this.call<{ requests: Array<PendingJoinRequest & { gid?: string }> }>(
					'delivery',
					CORDN_METHODS.takeManyJoinRequests,
					{
						groups: [{ gid: input.gid }],
						...(consumed && consumed.length > 0 ? { consumed } : {}),
					},
				)
				this.protocolMode = 'v5'
				return {
					requests: result.requests
						.filter((req) => !req.gid || req.gid === input.gid)
						.map(({ pk, kp_ref, at }) => ({ pk, kp_ref, at })),
				}
			} catch (error) {
				if (!isMethodNotFoundError(error)) throw error
				this.protocolMode = 'v4'
				this.streamingSupported = false
			}
		}

		return this.call<{ requests: PendingJoinRequest[] }>(
			'delivery',
			CORDN_METHODS.takeJoinRequests,
			input,
		)
	}

	async takeManyJoinRequests(input: {
		groups: Array<{ gid: string }>
		consumed?: ConsumedGroupJoinRequest[]
	}): Promise<{ requests: GroupPendingJoinRequest[] }> {
		if (input.groups.length === 0) return { requests: [] }

		if (this.protocolMode !== 'v4') {
			try {
				const result = await this.call<{ requests: GroupPendingJoinRequest[] }>(
					'delivery',
					CORDN_METHODS.takeManyJoinRequests,
					{
						groups: input.groups,
						...(input.consumed && input.consumed.length > 0 ? { consumed: input.consumed } : {}),
					},
				)
				this.protocolMode = 'v5'
				return result
			} catch (error) {
				if (!isMethodNotFoundError(error)) throw error
				this.protocolMode = 'v4'
				this.streamingSupported = false
			}
		}

		const consumedByGid = new Map<string, Array<{ pk: string; at: number }>>()
		for (const item of input.consumed ?? []) {
			const list = consumedByGid.get(item.gid) ?? []
			list.push({ pk: item.pk, at: item.at })
			consumedByGid.set(item.gid, list)
		}

		const perGroup = await Promise.all(
			input.groups.map(async ({ gid }) => {
				const consumed = consumedByGid.get(gid)
				const res = await this.call<{ requests: PendingJoinRequest[] }>(
					'delivery',
					CORDN_METHODS.takeJoinRequests,
					{ gid, ...(consumed && consumed.length > 0 ? { consumed } : {}) },
				)
				return res.requests.map((req) => ({ ...req, gid }))
			}),
		)
		return { requests: perGroup.flat() }
	}

	postMessage(input: { gid: string; msg_64: string }) {
		return this.call<Awaited<ReturnType<PrivateWorkspaceCoordinator['postMessage']>>>(
			'delivery',
			CORDN_METHODS.postMessage,
			input,
		)
	}

	async fetchMessages(input: { gid: string; after?: number }): Promise<{
		messages: CoordinatorMessage[]
	}> {
		if (this.protocolMode !== 'v4') {
			try {
				const group: GroupCursor = {
					gid: input.gid,
					...(input.after !== undefined ? { after: input.after } : {}),
				}
				const result = await this.call<{ messages: CoordinatorMessage[] }>(
					'delivery',
					CORDN_METHODS.fetchManyMessages,
					{ groups: [group] },
				)
				this.protocolMode = 'v5'
				return {
					messages: result.messages.filter((message) => message.gid === input.gid),
				}
			} catch (error) {
				if (!isMethodNotFoundError(error)) throw error
				this.protocolMode = 'v4'
				this.streamingSupported = false
			}
		}

		return this.call<{ messages: CoordinatorMessage[] }>(
			'delivery',
			CORDN_METHODS.fetchMessages,
			input,
		)
	}

	async fetchManyMessages(input: { groups: GroupCursor[] }): Promise<{
		messages: CoordinatorMessage[]
	}> {
		if (input.groups.length === 0) return { messages: [] }

		if (this.protocolMode !== 'v4') {
			try {
				const result = await this.call<{ messages: CoordinatorMessage[] }>(
					'delivery',
					CORDN_METHODS.fetchManyMessages,
					{ groups: input.groups },
				)
				this.protocolMode = 'v5'
				return result
			} catch (error) {
				if (!isMethodNotFoundError(error)) throw error
				this.protocolMode = 'v4'
				this.streamingSupported = false
			}
		}

		const perGroup = await Promise.all(
			input.groups.map((group) =>
				this.call<{ messages: CoordinatorMessage[] }>('delivery', CORDN_METHODS.fetchMessages, {
					gid: group.gid,
					...(group.after !== undefined ? { after: group.after } : {}),
				}),
			),
		)
		return {
			messages: perGroup
				.flatMap((res) => res.messages)
				.sort((a, b) => a.at - b.at || a.cursor - b.cursor),
		}
	}

	async subscribeManyMessages(
		input: SubscribeManyMessagesInput,
	): Promise<CoordinatorMessageStreamSubscription> {
		if (
			this.protocolMode === 'v4' ||
			this.streamingSupported === false ||
			!this.rpc.callToolStream
		) {
			throw new CordnUnsupportedStreamingError()
		}
		if (input.groups.length === 0) {
			throw new Error('msg_sub_many requires at least one group')
		}

		let handle: CordnToolStreamHandle
		try {
			handle = await this.rpc.callToolStream(CORDN_METHODS.subscribeManyMessages, {
				groups: input.groups,
			})
		} catch (error) {
			if (isMethodNotFoundError(error)) {
				this.streamingSupported = false
				throw new CordnUnsupportedStreamingError(
					error instanceof Error ? error.message : String(error),
				)
			}
			throw error
		}

		let active = true
		let closedLocally = false
		let errorNotified = false
		let closeNotified = false

		const notifyError = (error: Error) => {
			if (errorNotified || closedLocally) return
			errorNotified = true
			input.onError?.(error)
		}

		const notifyClose = () => {
			if (closeNotified) return
			closeNotified = true
			active = false
			input.onClose?.()
		}

		const handleTerminalResult = async () => {
			try {
				const rawResult = await handle.result
				if (rawResult && typeof rawResult === 'object') {
					const record = rawResult as Record<string, unknown>
					const toolError = extractToolErrorText(record)
					if (toolError) {
						const err = new Error(
							`Cordn ${CORDN_METHODS.subscribeManyMessages} error: ${toolError}`,
						)
						if (isMethodNotFoundError(err)) {
							this.streamingSupported = false
							notifyError(new CordnUnsupportedStreamingError(err.message))
						} else {
							notifyError(err)
						}
						await handle.abort('server-error').catch(() => undefined)
						return
					}
					const finalMessages = extractMessagesFromParsedValue(record)
					for (const message of finalMessages) {
						if (!active) break
						await input.onMessage(message)
					}
				}
			} catch (error) {
				if (closedLocally) return
				if (isMethodNotFoundError(error)) {
					this.streamingSupported = false
					notifyError(
						new CordnUnsupportedStreamingError(
							error instanceof Error ? error.message : String(error),
						),
					)
				} else {
					notifyError(error instanceof Error ? error : new Error(String(error)))
				}
				await handle.abort('result-error').catch(() => undefined)
			}
		}

		const pumpStream = async () => {
			try {
				for await (const chunk of handle.stream) {
					if (!active) break
					this.protocolMode = 'v5'
					this.streamingSupported = true
					const messages = parseStreamedCoordinatorMessages(chunk.value)
					for (const message of messages) {
						if (!active) break
						await input.onMessage(message)
					}
				}
			} catch (error) {
				if (!closedLocally) {
					if (isMethodNotFoundError(error)) {
						this.streamingSupported = false
						notifyError(
							new CordnUnsupportedStreamingError(
								error instanceof Error ? error.message : String(error),
							),
						)
					} else {
						notifyError(error instanceof Error ? error : new Error(String(error)))
					}
				}
			}
		}

		const closed = Promise.allSettled([pumpStream(), handleTerminalResult()]).then(() => {
			notifyClose()
		})

		return {
			get active() {
				return active
			},
			closed,
			async close(reason?: string) {
				if (!active && closedLocally) return
				closedLocally = true
				active = false
				await handle.abort(reason).catch(() => undefined)
				await closed
			},
		}
	}
}
