import { describe, expect, test } from 'bun:test'
import { resolveDatasetEditorDeleteMode } from './datasetEditorDeletion'

describe('resolveDatasetEditorDeleteMode', () => {
	test('uses Nostr deletion for an owned published Dataset', () => {
		expect(
			resolveDatasetEditorDeleteMode({
				hasActiveDataset: true,
				isDatasetOwner: true,
				hasActiveWorkspace: true,
				canDeleteWorkspace: true,
			}),
		).toBe('published-dataset')
	})

	test('discards saved work for an unpublished scratch Dataset', () => {
		expect(
			resolveDatasetEditorDeleteMode({
				hasActiveDataset: false,
				isDatasetOwner: false,
				hasActiveWorkspace: true,
				canDeleteWorkspace: true,
			}),
		).toBe('local-workspace')
	})

	test("discards only the local workspace when editing somebody else's Dataset", () => {
		expect(
			resolveDatasetEditorDeleteMode({
				hasActiveDataset: true,
				isDatasetOwner: false,
				hasActiveWorkspace: true,
				canDeleteWorkspace: true,
			}),
		).toBe('local-workspace')
	})

	test('hides deletion when no safe operation is available', () => {
		expect(
			resolveDatasetEditorDeleteMode({
				hasActiveDataset: false,
				isDatasetOwner: false,
				hasActiveWorkspace: true,
				canDeleteWorkspace: false,
			}),
		).toBeNull()
	})
})
