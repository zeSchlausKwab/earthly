import { expect, test } from 'bun:test'
import { RelayPool } from 'applesauce-relay'
import { PrivateKeySigner } from 'applesauce-signers'
import { firstValueFrom, of, take, toArray } from 'rxjs'
import { readRelayEvents } from './finiteRead'
import { createRelayAuthOptions } from './relayAuthentication'

/** Wire fixtures are strictly loopback and use fresh disposable signers. */
function relayFixture(
	mode: 'empty' | 'auth' | 'refuse' | 'silent' | 'closed-once' | 'disconnect-once',
) {
	let requests = 0
	let closes = 0
	const authenticated = new Set<string>()
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch(request, server) {
			if (server.upgrade(request)) return
			return new Response('{}')
		},
		websocket: {
			open(socket) {
				if (mode === 'auth' || mode === 'refuse') socket.send(JSON.stringify(['AUTH', 'challenge']))
			},
			message(socket, data) {
				const [type, id, value] = JSON.parse(String(data))
				if (type === 'AUTH') {
					if (mode === 'auth') authenticated.add(id.pubkey)
					socket.send(
						JSON.stringify([
							'OK',
							id.id,
							mode === 'auth',
							mode === 'auth' ? '' : 'blocked: denied',
						]),
					)
					return
				}
				if (type === 'CLOSE') {
					closes++
					return
				}
				if (type === 'COUNT') {
					socket.send(JSON.stringify(['COUNT', id, { count: 0 }]))
					return
				}
				if (type === 'EVENT') {
					socket.send(JSON.stringify(['OK', id.id, false, 'blocked: no writes']))
					return
				}
				if (type !== 'REQ') return
				requests++
				if (mode === 'silent') return
				if (mode === 'disconnect-once' && requests === 1) {
					socket.close(1011, 'restarting')
					return
				}
				if (mode === 'closed-once' && requests === 1) {
					socket.send(JSON.stringify(['CLOSED', id, 'finished']))
					return
				}
				if ((mode === 'auth' || mode === 'refuse') && !authenticated.has(value.authors?.[0])) {
					socket.send(JSON.stringify(['CLOSED', id, 'auth-required: login']))
					return
				}
				socket.send(JSON.stringify(['EOSE', id]))
			},
		},
	})
	const url = `ws://127.0.0.1:${server.port}`
	const pool = new RelayPool({ keepAlive: 0 })
	pool.relay(url).reconnectTimer = () => of(0)
	return {
		pool,
		url,
		authenticated,
		requests: () => requests,
		closes: () => closes,
		stop: () => {
			pool.close()
			server.stop(true)
		},
	}
}

test('v7 wire reads authenticate both accounts on a shared connection', async () => {
	const f = relayFixture('auth')
	try {
		for (let i = 0; i < 2; i++) {
			const signer = new PrivateKeySigner()
			const pubkey = await signer.getPublicKey()
			const result = await readRelayEvents(
				f.pool,
				[f.url],
				{ kinds: [1], authors: [pubkey] },
				{ timeoutMs: 1000, auth: createRelayAuthOptions({ pubkey, signer }, () => true) },
			)
			expect(result[0]?.ok).toBe(true)
		}
		expect(f.authenticated.size).toBe(2)
	} finally {
		f.stop()
	}
})

test('v7 negative AUTH and negative publish acknowledgements stay failures', async () => {
	const f = relayFixture('refuse')
	try {
		const signer = new PrivateKeySigner()
		const pubkey = await signer.getPublicKey()
		const [read] = await readRelayEvents(
			f.pool,
			[f.url],
			{ kinds: [1], authors: [pubkey] },
			{ timeoutMs: 1000, auth: createRelayAuthOptions({ pubkey, signer }, () => true) },
		)
		expect(read?.ok).toBe(false)
		const event = await signer.signEvent({ kind: 1, content: '', created_at: 1, tags: [] })
		const responses = await f.pool.publish([f.url], event, { waitForAuth: false })
		expect(responses[0]?.ok).toBe(false)
	} finally {
		f.stop()
	}
})

test('v7 COUNT zero is supported and distinct from a silent request', async () => {
	const f = relayFixture('silent')
	try {
		const response = await firstValueFrom(f.pool.relay(f.url).count({ kinds: [7] }))
		expect(response.count).toBe(0)
		const [result] = await readRelayEvents(f.pool, [f.url], { kinds: [1] }, { timeoutMs: 20 })
		expect(result?.ok).toBe(false)
	} finally {
		f.stop()
	}
})

test('v7 high-level subscriptions recover a clean CLOSED', async () => {
	const f = relayFixture('closed-once')
	try {
		const responses = await firstValueFrom(
			f.pool
				.relay(f.url)
				.subscription({ kinds: [1] }, { resubscribe: { count: 2, delay: 1 }, waitForAuth: false })
				.pipe(take(1), toArray()),
		)
		expect(responses).toEqual(['EOSE'])
		expect(f.requests()).toBe(2)
	} finally {
		f.stop()
	}
})

test('v7 high-level subscriptions recover a dropped socket', async () => {
	const f = relayFixture('disconnect-once')
	try {
		const response = await firstValueFrom(
			f.pool.relay(f.url).subscription({ kinds: [1] }, { reconnect: true, waitForAuth: false }),
		)
		expect(response).toBe('EOSE')
		expect(f.requests()).toBe(2)
	} finally {
		f.stop()
	}
})
