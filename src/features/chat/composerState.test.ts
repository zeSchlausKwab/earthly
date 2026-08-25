import { beforeEach, describe, expect, test } from 'bun:test'
import { useChatComposerStore } from './composerState'

describe('per-Chat composer ownership', () => {
	beforeEach(() => {
		useChatComposerStore.getState().reset()
	})

	test('a parse completion stays with its initiating Chat after the visible Chat changes', async () => {
		const setDraft = useChatComposerStore.getState().setDraft
		setDraft('chat-a', (current) => ({
			...current,
			files: [{ id: 'file-1', fileName: 'map.geojson', status: 'parsing' }],
		}))

		const lateCompletion = Promise.resolve().then(() => {
			setDraft('chat-a', (current) => ({
				...current,
				files: current.files.map((file) =>
					file.id === 'file-1'
						? {
								...file,
								status: 'parsed' as const,
								summary: {
									handleId: 'ingest-1',
									fileName: 'map.geojson',
									type: 'geojson' as const,
									rowCount: 1,
									columnCount: 0,
									schema: [],
									sampleRows: [],
									detectedCoordinateColumns: [],
									typeStats: { featureCount: 1 },
								},
							}
						: file,
				),
			}))
		})

		// Browse Chat B while Chat A's file is still parsing.
		setDraft('chat-b', (current) => ({ ...current, input: 'Draft for B' }))
		await lateCompletion

		const drafts = useChatComposerStore.getState().drafts
		expect(drafts['chat-a']?.files[0]?.status).toBe('parsed')
		expect(drafts['chat-b']?.files).toEqual([])
		expect(drafts['chat-b']?.input).toBe('Draft for B')
	})

	test('all unfinished composer fields survive subscriber unmount and remount', () => {
		const store = useChatComposerStore.getState()
		let observedInput = ''
		const unsubscribe = useChatComposerStore.subscribe((state) => {
			observedInput = state.drafts['chat-a']?.input ?? ''
		})
		store.setDraft('chat-a', {
			input: 'Continue this thought',
			selectionContext: [
				{
					type: 'Feature',
					id: 'selected-1',
					geometry: { type: 'Point', coordinates: [16.37, 48.21] },
					properties: {},
				},
			],
			geometry: {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [16.38, 48.22] },
						properties: {},
					},
				],
			},
			files: [{ id: 'file-1', fileName: 'places.csv', status: 'parsing' }],
			sendAnyway: true,
		})
		expect(observedInput).toBe('Continue this thought')

		// MobilePanel unmounts ChatPanel when the user returns to the map. The
		// memory store outlives that subscriber and supplies the next mount.
		unsubscribe()
		const remountedDraft = useChatComposerStore.getState().drafts['chat-a']
		expect(remountedDraft).toMatchObject({
			input: 'Continue this thought',
			sendAnyway: true,
		})
		expect(remountedDraft?.selectionContext).toHaveLength(1)
		expect(remountedDraft?.geometry?.features).toHaveLength(1)
		expect(remountedDraft?.files[0]?.fileName).toBe('places.csv')
	})
})
