import { describe, expect, test } from 'bun:test'
import type { NostrSigner } from '@contextvm/sdk'
import { isCoordinatorMessageEncrypted, type CoordinatorMessage } from './contracts'
import {
	CordnCoordinatorClient,
	CordnUnsupportedStreamingError,
	isMethodNotFoundError,
	parseStreamedCoordinatorMessages,
	withCoordinatorDeadline,
	type CordnRpcAdapter,
} from './coordinator'

const fakeSigner = {
	getPublicKey: async () => 'a'.repeat(64),
	signEvent: async (ev: unknown) => ev,
} as unknown as NostrSigner

describe('Cordn coordinator deadlines', () => {
	test('rejects an operation that never settles', async () => {
		await expect(
			withCoordinatorDeadline(new Promise<never>(() => undefined), 'Cordn test request', 5),
		).rejects.toThrow('Cordn test request timed out')
	})

	test('preserves a response that arrives before the deadline', async () => {
		await expect(
			withCoordinatorDeadline(Promise.resolve('ready'), 'Cordn test request', 50),
		).resolves.toBe('ready')
	})
})

describe('Cordn v0.4 / v0.5 protocol negotiation & streaming', () => {
	test('defaults message.encrypted to true while respecting explicit v0.4 false', () => {
		expect(isCoordinatorMessageEncrypted({ encrypted: undefined })).toBe(true)
		expect(isCoordinatorMessageEncrypted({ encrypted: true })).toBe(true)
		expect(isCoordinatorMessageEncrypted({ encrypted: false })).toBe(false)
	})

	test('detects unknown tool / method-not-found errors', () => {
		expect(isMethodNotFoundError(new Error('Cordn msg_fetch_many error: Unknown tool'))).toBe(true)
		expect(isMethodNotFoundError(new Error('MCP error -32601: Method not found'))).toBe(true)
		expect(isMethodNotFoundError({ code: -32601, message: 'Method not found' })).toBe(true)
		expect(isMethodNotFoundError(new Error('Request timed out'))).toBe(false)
	})

	test('uses Cordn v0.5 batch RPCs when supported', async () => {
		const calls: Array<{ method: string; args: Record<string, unknown> }> = []
		const rpcAdapter: CordnRpcAdapter = {
			async callTool(_identity, method, args) {
				calls.push({ method, args })
				if (method === 'msg_fetch_many') {
					return {
						structuredContent: {
							messages: [
								{ cursor: 3, gid: 'g1', msg_64: 'abc', at: 100 },
								{ cursor: 4, gid: 'g2', msg_64: 'def', at: 101 },
							],
						},
					}
				}
				if (method === 'join_request_take_many') {
					return {
						structuredContent: {
							requests: [{ gid: 'g1', pk: 'c'.repeat(64), kp_ref: 'ref-1', at: 10 }],
						},
					}
				}
				throw new Error(`Unexpected method ${method}`)
			},
			disconnect: async () => undefined,
		}

		const client = new CordnCoordinatorClient({
			serverPubkey: 'b'.repeat(64),
			relays: ['ws://localhost:3334'],
			signer: fakeSigner,
			rpcAdapter,
		})

		const fetched = await client.fetchMessages({ gid: 'g1', after: 2 })
		expect(fetched.messages).toEqual([{ cursor: 3, gid: 'g1', msg_64: 'abc', at: 100 }])
		expect(client.getProtocolMode()).toBe('v5')

		const requests = await client.takeJoinRequests({ gid: 'g1' })
		expect(requests.requests).toEqual([{ pk: 'c'.repeat(64), kp_ref: 'ref-1', at: 10 }])
		expect(calls.map((c) => c.method)).toEqual(['msg_fetch_many', 'join_request_take_many'])
	})

	test('caches v0.4 fallback after unknown-tool error on msg_fetch_many', async () => {
		const calls: string[] = []
		const rpcAdapter: CordnRpcAdapter = {
			async callTool(_identity, method, args) {
				calls.push(method)
				if (method === 'msg_fetch_many' || method === 'join_request_take_many') {
					return {
						isError: true,
						content: [{ type: 'text', text: `Unknown tool: ${method}` }],
					}
				}
				if (method === 'msg_fetch') {
					return {
						structuredContent: {
							messages: [
								{
									cursor: 1,
									gid: String(args.gid),
									msg_64: 'legacy',
									at: 10,
									encrypted: false,
								},
							],
						},
					}
				}
				if (method === 'join_request_take') {
					return {
						structuredContent: {
							requests: [{ pk: 'd'.repeat(64), kp_ref: 'kp-v4', at: 20 }],
						},
					}
				}
				throw new Error(`Unexpected ${method}`)
			},
			disconnect: async () => undefined,
		}

		const client = new CordnCoordinatorClient({
			serverPubkey: 'b'.repeat(64),
			relays: ['ws://localhost:3334'],
			signer: fakeSigner,
			rpcAdapter,
		})

		const first = await client.fetchMessages({ gid: 'g1' })
		expect(first.messages).toHaveLength(1)
		expect(first.messages[0]?.encrypted).toBe(false)
		expect(client.getProtocolMode()).toBe('v4')
		expect(client.isStreamingSupported()).toBe(false)

		// Second fetch and join request check should bypass v0.5 RPCs immediately.
		await client.fetchMessages({ gid: 'g1', after: 1 })
		const joinReqs = await client.takeJoinRequests({ gid: 'g1' })
		expect(joinReqs.requests[0]?.kp_ref).toBe('kp-v4')
		expect(calls).toEqual(['msg_fetch_many', 'msg_fetch', 'msg_fetch', 'join_request_take'])

		await expect(
			client.subscribeManyMessages({
				groups: [{ gid: 'g1' }],
				onMessage: () => undefined,
			}),
		).rejects.toBeInstanceOf(CordnUnsupportedStreamingError)
	})

	test('streams pushed messages from msg_sub_many open-stream chunks', async () => {
		const pushed: CoordinatorMessage[] = []
		const msg1: CoordinatorMessage = { cursor: 5, gid: 'g1', msg_64: 'cipher1', at: 500 }
		const msg2: CoordinatorMessage = { cursor: 6, gid: 'g1', msg_64: 'cipher2', at: 501 }
		const chunks = [
			{ value: JSON.stringify(msg1), chunkIndex: 0 },
			{ value: JSON.stringify({ messages: [msg2] }), chunkIndex: 1 },
		]
		let aborted = false
		const rpcAdapter: CordnRpcAdapter = {
			callTool: async () => ({ structuredContent: {} }),
			async callToolStream(method, args) {
				expect(method).toBe('msg_sub_many')
				expect(args).toEqual({ groups: [{ gid: 'g1', after: 4 }] })
				return {
					stream: {
						isActive: true,
						async abort() {
							aborted = true
						},
						async *[Symbol.asyncIterator]() {
							for (const chunk of chunks) yield chunk
						},
					},
					result: Promise.resolve({ structuredContent: { ok: true } }),
					async abort() {
						aborted = true
					},
				}
			},
			disconnect: async () => undefined,
		}

		const client = new CordnCoordinatorClient({
			serverPubkey: 'b'.repeat(64),
			relays: ['ws://localhost:3334'],
			signer: fakeSigner,
			rpcAdapter,
		})

		let closedCalled = false
		const sub = await client.subscribeManyMessages({
			groups: [{ gid: 'g1', after: 4 }],
			onMessage: (msg) => {
				pushed.push(msg)
			},
			onClose: () => {
				closedCalled = true
			},
		})
		await sub.closed

		expect(pushed).toEqual([msg1, msg2])
		expect(closedCalled).toBe(true)
		expect(client.getProtocolMode()).toBe('v5')
		expect(aborted).toBe(false)
	})

	test('parses single, wrapped, array, and NDJSON streamed frames', () => {
		const m1 = { cursor: 1, gid: 'g1', msg_64: 'a', at: 10 }
		const m2 = { cursor: 2, gid: 'g2', msg_64: 'b', at: 11, encrypted: true }
		expect(parseStreamedCoordinatorMessages(JSON.stringify(m1))).toEqual([m1])
		expect(parseStreamedCoordinatorMessages(JSON.stringify({ message: m1 }))).toEqual([m1])
		expect(parseStreamedCoordinatorMessages(JSON.stringify({ messages: [m1, m2] }))).toEqual([
			m1,
			m2,
		])
		expect(
			parseStreamedCoordinatorMessages(
				`${JSON.stringify(m1)}\n{"type":"ping"}\n${JSON.stringify(m2)}\n`,
			),
		).toEqual([m1, m2])
	})
})
