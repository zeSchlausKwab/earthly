import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
	ensureDatasetDraftForMutation,
	registerDatasetDraftEnsurer,
	startDatasetDraftForActiveChat,
} from './authoringTaskBridge'

let unregister: (() => void) | null = null

afterEach(() => {
	unregister?.()
	unregister = null
})

describe('Dataset authoring target intent', () => {
	test('ordinary mutations reuse the owned target while New map explicitly forces a fresh draft', async () => {
		const ensure = mock(() => {})
		unregister = registerDatasetDraftEnsurer(ensure)

		await ensureDatasetDraftForMutation()
		await startDatasetDraftForActiveChat()

		expect(ensure).toHaveBeenNthCalledWith(1)
		expect(ensure).toHaveBeenNthCalledWith(2, { forceNew: true })
	})
})
