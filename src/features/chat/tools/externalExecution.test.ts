import { afterEach, describe, expect, test } from 'bun:test'
import {
	acquireExternalPublicReadExecution,
	acquireExternalToolExecution,
	isExternalToolExecutionActive,
	retainChatToolExecution,
} from './externalExecution'

const leases: Array<() => void> = []
function lease(release: (() => void) | null): () => void {
	expect(release).not.toBeNull()
	if (!release) throw new Error('Expected an execution lease')
	leases.push(release)
	return release
}
afterEach(() => {
	for (const release of leases.splice(0)) release()
})

describe('external execution leases', () => {
	test('public reads share execution while authoring stays exclusive until the last read finishes', () => {
		const first = lease(acquireExternalPublicReadExecution())
		const second = lease(acquireExternalPublicReadExecution())
		expect(isExternalToolExecutionActive()).toBe(true)
		expect(acquireExternalToolExecution()).toBeNull()
		first()
		first() // A duplicate release cannot relinquish another read's lease.
		expect(isExternalToolExecutionActive()).toBe(true)
		expect(acquireExternalToolExecution()).toBeNull()
		second()
		expect(isExternalToolExecutionActive()).toBe(false)
		lease(acquireExternalToolExecution())
	})
	test('exclusive authoring blocks public reads and other exclusive calls', () => {
		const exclusive = lease(acquireExternalToolExecution())
		expect(acquireExternalPublicReadExecution()).toBeNull()
		expect(acquireExternalToolExecution()).toBeNull()
		exclusive()
		lease(acquireExternalPublicReadExecution())
		exclusive()
		expect(isExternalToolExecutionActive()).toBe(true)
	})
	test('cancelled chat tools keep blocking both modes until all chat leases unwind', () => {
		const first = lease(retainChatToolExecution())
		const second = lease(retainChatToolExecution())
		expect(acquireExternalPublicReadExecution()).toBeNull()
		expect(acquireExternalToolExecution()).toBeNull()
		first()
		expect(acquireExternalPublicReadExecution()).toBeNull()
		second()
		lease(acquireExternalPublicReadExecution())
	})
	test('a finished exclusive lease cannot release a newer exclusive owner', () => {
		const first = lease(acquireExternalToolExecution())
		first()
		const second = lease(acquireExternalToolExecution())
		first()
		expect(acquireExternalPublicReadExecution()).toBeNull()
		second()
		expect(isExternalToolExecutionActive()).toBe(false)
	})
})
