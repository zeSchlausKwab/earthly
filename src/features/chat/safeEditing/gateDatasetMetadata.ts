import type { DatasetMetadataInput } from '@/features/geo-editor/api/authoring'
import {
	createExecutionAuthoring,
	getExecutionCollectionMeta,
	getExecutionEditor,
} from '../tools/executionTarget'
import { emitDiffBlock, requestConfirm, type MetadataChange } from './pendingDiffStore'
import { getSafetyLevel } from './safetyAccess'

/** Review metadata before writing; the shared executor attaches its exact metadata Undo record. */
export async function gateDatasetMetadata(meta: DatasetMetadataInput) {
	const editor = getExecutionEditor()
	if (!editor) throw new Error('Open a Map editor before changing its metadata.')
	const before = getExecutionCollectionMeta()
	const changes: MetadataChange[] = []
	for (const field of ['name', 'description', 'color'] as const) {
		if (meta[field] !== undefined && meta[field] !== before[field])
			changes.push({ field, before: before[field], after: meta[field] })
	}
	for (const [field, value] of Object.entries(meta.properties ?? {})) {
		if (before.customProperties[field] !== value)
			changes.push({
				field: `Property: ${field}`,
				before: JSON.stringify(before.customProperties[field]) ?? '(unset)',
				after: JSON.stringify(value),
			})
	}
	const authoring = createExecutionAuthoring(editor)
	if (!changes.length) return { ...authoring.getDatasetMetadata(), cancelled: false }
	const mustConfirm = getSafetyLevel() !== 3
	const handle = emitDiffBlock(
		{ added: [], modified: [], deleted: [] },
		{
			status: mustConfirm ? 'pending' : 'applied',
			headline: 'Map details changed',
			intent: 'modify',
			metadataChanges: changes,
		},
	)
	if (mustConfirm && (await requestConfirm(handle.id)) === 'cancel')
		return { ...authoring.getDatasetMetadata(), cancelled: true }
	return { ...authoring.setDatasetMetadata(meta), cancelled: false }
}
