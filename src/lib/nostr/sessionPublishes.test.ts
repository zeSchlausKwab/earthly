import { beforeEach, describe, expect, it } from 'bun:test'
import { clearSessionPublishes, getSessionPublishes, noteSessionPublish } from './sessionPublishes'

const PUBKEY = 'b'.repeat(64)

describe('sessionPublishes', () => {
	beforeEach(() => {
		clearSessionPublishes()
	})

	it('records a publish with a ready-to-embed mention', () => {
		noteSessionPublish({ type: 'dataset', name: 'Lanes', coordinate: `37515:${PUBKEY}:lanes-1` })
		const entries = getSessionPublishes()
		expect(entries.length).toBe(1)
		expect(entries[0]?.name).toBe('Lanes')
		expect(entries[0]?.mention).toStartWith('nostr:naddr1')
	})

	it('replaces an older entry for the same coordinate (update = one breadcrumb)', () => {
		noteSessionPublish({ type: 'dataset', name: 'v1', coordinate: `37515:${PUBKEY}:d1` })
		noteSessionPublish({ type: 'dataset', name: 'v2', coordinate: `37515:${PUBKEY}:d1` })
		const entries = getSessionPublishes()
		expect(entries.length).toBe(1)
		expect(entries[0]?.name).toBe('v2')
	})

	it('caps the trail and keeps the newest entries', () => {
		for (let i = 0; i < 12; i += 1) {
			noteSessionPublish({ type: 'dataset', name: `d${i}`, coordinate: `37515:${PUBKEY}:d${i}` })
		}
		const entries = getSessionPublishes()
		expect(entries.length).toBe(8)
		expect(entries[0]?.name).toBe('d4')
		expect(entries[entries.length - 1]?.name).toBe('d11')
	})

	it('keeps the coordinate as fallback when naddr encoding fails', () => {
		noteSessionPublish({ type: 'dataset', name: 'bad', coordinate: 'not-a-coordinate' })
		const entries = getSessionPublishes()
		expect(entries[0]?.mention).toBeNull()
		expect(entries[0]?.coordinate).toBe('not-a-coordinate')
	})
})
