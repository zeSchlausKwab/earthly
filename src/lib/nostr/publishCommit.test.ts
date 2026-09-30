import { expect, mock, test } from 'bun:test'
import type { OutboxEnqueueRequest, OutboxItem, PublishOutboxService } from '@/platform/contracts'
import { createPublishCommitGuard } from './publishCommit'
import { enqueueDurablePublish } from './publishOutbox'

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((complete) => {
		resolve = complete
	})
	return { promise, resolve }
}

const enqueueRequest: OutboxEnqueueRequest = {
	version: 1,
	eventJson: '{"id":"immutable-signed-event"}',
	routing: 'outbox',
	relayUrls: ['wss://relay.example'],
	requiredRelayUrls: ['wss://relay.example'],
}

test('aborting during delayed relay discovery prevents web transmission', async () => {
	const controller = new AbortController()
	const discovery = deferred<string[]>()
	const pool = { publish: mock(async (_relays: string[]) => [{ ok: true }]) }
	const commitment = createPublishCommitGuard({ signal: controller.signal })
	const publication = (async () => {
		const relays = await commitment.prepare(() => discovery.promise)
		return commitment.commit(() => pool.publish(relays))
	})()
	controller.abort()
	discovery.resolve(['wss://relay.example'])
	await expect(publication).rejects.toThrow('abort')
	expect(pool.publish).not.toHaveBeenCalled()
})

test('account changes during native service initialization prevent durable enqueue', async () => {
	let activeAccount = 'original'
	const initialization = deferred<PublishOutboxService>()
	const initializationStarted = deferred<void>()
	const enqueue = mock(async () => ({ id: 'queued' }) as OutboxItem)
	const service = { enqueue } as unknown as PublishOutboxService
	const commitment = createPublishCommitGuard({
		beforeCommit: () => {
			if (activeAccount !== 'original') throw new Error('Account changed before publication')
		},
	})
	const publication = (async () => {
		await commitment.prepare(async () => ['wss://relay.example'])
		const outbox = await commitment.prepare(() => {
			initializationStarted.resolve()
			return initialization.promise
		})
		return commitment.commit(() => enqueueDurablePublish(outbox, enqueueRequest))
	})()
	await initializationStarted.promise
	activeAccount = 'replacement'
	initialization.resolve(service)
	await expect(publication).rejects.toThrow('Account changed')
	expect(enqueue).not.toHaveBeenCalled()
})

test('authority is checked at the synchronous commit point after preparation', async () => {
	let allowed = true
	const commitment = createPublishCommitGuard({
		beforeCommit: () => {
			if (!allowed) throw new Error('Authority revoked')
		},
	})
	const send = mock(() => 'sent')
	await commitment.prepare(async () => undefined)
	allowed = false
	expect(() => commitment.commit(send)).toThrow('Authority revoked')
	expect(send).not.toHaveBeenCalled()
})

test('cancellation after enqueue begins does not retract the durable publication', async () => {
	const controller = new AbortController()
	const queued = deferred<OutboxItem>()
	const enqueue = mock(() => queued.promise)
	const service = { enqueue } as unknown as PublishOutboxService
	const commitment = createPublishCommitGuard({ signal: controller.signal })
	const publication = commitment.commit(() => enqueueDurablePublish(service, enqueueRequest))
	controller.abort()
	const item = { id: 'queued' } as OutboxItem
	queued.resolve(item)
	expect(await publication).toBe(item)
	expect(enqueue).toHaveBeenCalledTimes(1)
	const deliver = mock(() => 'delivery continues')
	expect(commitment.commit(deliver)).toBe('delivery continues')
	expect(deliver).toHaveBeenCalledTimes(1)
})

test('already aborted publication cannot begin preparation', () => {
	expect(() => createPublishCommitGuard({ signal: AbortSignal.abort() })).toThrow('abort')
})
