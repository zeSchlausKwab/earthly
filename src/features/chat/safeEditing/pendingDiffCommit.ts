import type { DatasetDiff } from '@/features/geo-editor/api/diff'
import type { EditorFeature } from '@/features/geo-editor/core'
import type { GeoCollectionEditDraft } from '@/features/geo-editor/store'
import type { CollectionMeta } from '@/features/geo-editor/types'
import type { ToolExecutionTarget } from '@/features/chat/tools/types'

/** Exact run/tool ownership used to keep reusable provider call ids from colliding. */
export interface PendingDiffExecutionScope {
	readonly runId: number
	readonly chatId: string
	readonly toolCallId: string
	readonly target: ToolExecutionTarget
}

interface DeletedFeatureAnchor {
	readonly id: string
	readonly beforeIndex: number
	readonly previousId: string | null
	readonly nextId: string | null
}

/**
 * Geometry-clone-free feature descriptor produced from the persistence layer's
 * existing before/after snapshots. Feature objects remain shared references and
 * are discarded after attachment; the card already owns the matching diff.
 */
export interface PendingDatasetFeatureCommitInput {
	readonly diff: DatasetDiff
	readonly addedIds: readonly string[]
	readonly modifiedIds: readonly string[]
	readonly deleted: readonly DeletedFeatureAnchor[]
}

/** Successful per-field commit record returned by the run-bound persistence layer. */
export interface PendingDatasetCommitInput {
	readonly target: ToolExecutionTarget
	readonly fields: {
		readonly features?: PendingDatasetFeatureCommitInput
		readonly collectionMeta?: {
			readonly before: CollectionMeta
			readonly after: CollectionMeta
		}
		readonly selectedFeatureIds?: {
			readonly before: readonly string[]
			readonly after: readonly string[]
		}
	}
}

interface AttachedFeatureCommit {
	readonly addedIds: readonly string[]
	readonly modifiedIds: readonly string[]
	readonly deleted: readonly DeletedFeatureAnchor[]
}

/** Bounded record retained by a transcript card after durable persistence. */
export interface AttachedPendingDatasetCommit {
	readonly target: ToolExecutionTarget
	readonly fields: {
		/** Feature values live once in the card's DatasetDiff; this stores ids/anchors only. */
		readonly features?: AttachedFeatureCommit
		readonly collectionMeta?: {
			readonly before: CollectionMeta
			readonly after: CollectionMeta
		}
		readonly selectedFeatureIds?: {
			readonly before: readonly string[]
			readonly after: readonly string[]
		}
	}
}

export interface PendingDatasetUndoUpdates {
	features?: EditorFeature[]
	collectionMeta?: CollectionMeta
	selectedFeatureIds?: string[]
}

export type PendingDatasetUndoPlan =
	| { ok: true; updates: PendingDatasetUndoUpdates }
	| { ok: false; reason: string }

// Undo is a convenience, never a reason to pin an unbounded second copy of a
// large map in the transcript. Large/complex changes simply receive no Undo.
const MAX_CHANGED_FEATURES = 500
const MAX_SELECTION_IDS = 10_000
const MAX_COMPARE_UNITS = 300_000
const MAX_COMPARE_STRING_CHARS = 1_000_000

function clone<T>(value: T): T {
	if (typeof structuredClone === 'function') return structuredClone(value)
	return JSON.parse(JSON.stringify(value)) as T
}

interface CompareBudget {
	units: number
	stringChars: number
}

/** Structural equality with an allocation-free complexity ceiling. */
function boundedEqual(left: unknown, right: unknown, budget: CompareBudget): boolean | null {
	budget.units -= 1
	if (budget.units < 0) return null
	if (typeof left === 'string' && typeof right === 'string') {
		budget.stringChars -= left.length + right.length
		return budget.stringChars < 0 ? null : left === right
	}
	if (left === right) return true
	if (typeof left !== typeof right) return false
	if (left === null || right === null) return false
	if (typeof left !== 'object' || typeof right !== 'object') return false

	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
		for (let index = 0; index < left.length; index += 1) {
			const equal = boundedEqual(left[index], right[index], budget)
			if (equal !== true) return equal
		}
		return true
	}

	const leftRecord = left as Record<string, unknown>
	const rightRecord = right as Record<string, unknown>
	const leftKeys = Object.keys(leftRecord)
	const rightKeys = Object.keys(rightRecord)
	if (leftKeys.length !== rightKeys.length) return false
	for (const key of leftKeys) {
		if (!Object.hasOwn(rightRecord, key)) return false
		const equal = boundedEqual(leftRecord[key], rightRecord[key], budget)
		if (equal !== true) return equal
	}
	return true
}

function freshBudget(): CompareBudget {
	return { units: MAX_COMPARE_UNITS, stringChars: MAX_COMPARE_STRING_CHARS }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function hasUniqueIds(features: readonly EditorFeature[]): boolean {
	return new Set(features.map((feature) => feature.id)).size === features.length
}

function sameFeatureDiff(left: DatasetDiff, right: DatasetDiff): boolean {
	if (
		left.added.length !== right.added.length ||
		left.modified.length !== right.modified.length ||
		left.deleted.length !== right.deleted.length
	) {
		return false
	}
	const budget = freshBudget()
	for (let index = 0; index < left.added.length; index += 1) {
		if (boundedEqual(left.added[index], right.added[index], budget) !== true) return false
	}
	for (let index = 0; index < left.modified.length; index += 1) {
		if (
			boundedEqual(left.modified[index]?.before, right.modified[index]?.before, budget) !== true ||
			boundedEqual(left.modified[index]?.after, right.modified[index]?.after, budget) !== true
		) {
			return false
		}
	}
	for (let index = 0; index < left.deleted.length; index += 1) {
		if (boundedEqual(left.deleted[index], right.deleted[index], budget) !== true) return false
	}
	return true
}

export function buildPendingDatasetFeatureCommitInput(
	before: readonly EditorFeature[],
	after: readonly EditorFeature[],
): PendingDatasetFeatureCommitInput | null {
	if (!hasUniqueIds(before) || !hasUniqueIds(after)) return null
	const beforeById = new Map(before.map((feature) => [feature.id, feature]))
	const afterById = new Map(after.map((feature) => [feature.id, feature]))
	const budget = freshBudget()
	const derived: DatasetDiff = { added: [], modified: [], deleted: [] }

	for (const afterFeature of after) {
		const beforeFeature = beforeById.get(afterFeature.id)
		if (!beforeFeature) {
			derived.added.push(afterFeature)
			continue
		}
		const equal = boundedEqual(beforeFeature, afterFeature, budget)
		if (equal === null) return null
		if (!equal) derived.modified.push({ before: beforeFeature, after: afterFeature })
	}
	for (const beforeFeature of before) {
		if (!afterById.has(beforeFeature.id)) derived.deleted.push(beforeFeature)
	}

	const changedCount = derived.added.length + derived.modified.length + derived.deleted.length
	if (changedCount === 0 || changedCount > MAX_CHANGED_FEATURES) return null
	// Reordering surviving features is not safely invertible from a bounded delta.
	const commonBefore = before
		.filter((feature) => afterById.has(feature.id))
		.map((feature) => feature.id)
	const commonAfter = after
		.filter((feature) => beforeById.has(feature.id))
		.map((feature) => feature.id)
	if (!arraysEqual(commonBefore, commonAfter)) return null

	return {
		diff: derived,
		addedIds: derived.added.map((feature) => feature.id),
		modifiedIds: derived.modified.map(({ after: feature }) => feature.id),
		deleted: derived.deleted.map((feature) => {
			const beforeIndex = before.findIndex((candidate) => candidate.id === feature.id)
			return {
				id: feature.id,
				beforeIndex,
				previousId: before[beforeIndex - 1]?.id ?? null,
				nextId: before[beforeIndex + 1]?.id ?? null,
			}
		}),
	}
}

export function sameToolExecutionTarget(
	left: ToolExecutionTarget | undefined,
	right: ToolExecutionTarget | undefined,
): boolean {
	if (!left || !right) return false
	return (
		left.entityType === right.entityType &&
		left.draftId === right.draftId &&
		left.entityId === right.entityId &&
		left.sourceId === right.sourceId &&
		left.baseRevisionId === right.baseRevisionId &&
		left.draftUpdatedAt === right.draftUpdatedAt &&
		left.wasDirty === right.wasDirty &&
		left.workspaceId === right.workspaceId
	)
}

export function buildAttachedPendingDatasetCommit(
	input: PendingDatasetCommitInput,
	cardDiff: DatasetDiff,
): AttachedPendingDatasetCommit | null {
	type MutableAttachedFields = {
		-readonly [Key in keyof AttachedPendingDatasetCommit['fields']]: AttachedPendingDatasetCommit['fields'][Key]
	}
	const fields: MutableAttachedFields = {}
	if (input.fields.features) {
		if (!sameFeatureDiff(input.fields.features.diff, cardDiff)) return null
		const { addedIds, modifiedIds, deleted } = input.fields.features
		const inputChangedCount = addedIds.length + modifiedIds.length + deleted.length
		if (
			inputChangedCount === 0 ||
			inputChangedCount > MAX_CHANGED_FEATURES ||
			!arraysEqual(
				addedIds,
				input.fields.features.diff.added.map((feature) => feature.id),
			) ||
			!arraysEqual(
				modifiedIds,
				input.fields.features.diff.modified.map(({ after }) => after.id),
			) ||
			!arraysEqual(
				deleted.map((anchor) => anchor.id),
				input.fields.features.diff.deleted.map((feature) => feature.id),
			) ||
			deleted.some(
				(anchor) =>
					!Number.isSafeInteger(anchor.beforeIndex) ||
					anchor.beforeIndex < 0 ||
					(anchor.previousId !== null && typeof anchor.previousId !== 'string') ||
					(anchor.nextId !== null && typeof anchor.nextId !== 'string'),
			)
		) {
			return null
		}
		fields.features = {
			addedIds: [...addedIds],
			modifiedIds: [...modifiedIds],
			deleted: deleted.map((anchor) => ({ ...anchor })),
		}
	} else if (cardDiff.added.length + cardDiff.modified.length + cardDiff.deleted.length > 0) {
		return null
	}
	if (input.fields.collectionMeta) {
		if (
			boundedEqual(
				input.fields.collectionMeta.before,
				input.fields.collectionMeta.after,
				freshBudget(),
			) === null
		) {
			return null
		}
		fields.collectionMeta = clone(input.fields.collectionMeta)
	}
	if (input.fields.selectedFeatureIds) {
		const { before, after } = input.fields.selectedFeatureIds
		if (before.length > MAX_SELECTION_IDS || after.length > MAX_SELECTION_IDS) return null
		fields.selectedFeatureIds = { before: [...before], after: [...after] }
	}
	if (!fields.features && !fields.collectionMeta && !fields.selectedFeatureIds) return null
	return { target: Object.freeze({ ...input.target }), fields }
}

function findFeature(
	diff: DatasetDiff,
	kind: 'added' | 'deleted',
	id: string,
): EditorFeature | null {
	return diff[kind].find((feature) => feature.id === id) ?? null
}

function findModifiedFeature(diff: DatasetDiff, id: string) {
	return diff.modified.find((pair) => pair.after.id === id) ?? null
}

/** Pure per-field CAS and inverse-delta planner used by the target-bound Undo. */
export function planPendingDatasetUndo(
	commit: AttachedPendingDatasetCommit,
	diff: DatasetDiff,
	draft: GeoCollectionEditDraft,
): PendingDatasetUndoPlan {
	const updates: PendingDatasetUndoUpdates = {}
	const featureCommit = commit.fields.features
	if (featureCommit) {
		if (!hasUniqueIds(draft.features)) return { ok: false, reason: 'duplicate feature ids' }
		const currentById = new Map(draft.features.map((feature) => [feature.id, feature]))
		const budget = freshBudget()
		for (const id of featureCommit.addedIds) {
			const expected = findFeature(diff, 'added', id)
			const current = currentById.get(id)
			if (!expected || !current || boundedEqual(current, expected, budget) !== true) {
				return { ok: false, reason: 'an added feature changed' }
			}
		}
		for (const id of featureCommit.modifiedIds) {
			const expected = findModifiedFeature(diff, id)
			const current = currentById.get(id)
			if (!expected || !current || boundedEqual(current, expected.after, budget) !== true) {
				return { ok: false, reason: 'a modified feature changed' }
			}
		}
		for (const deleted of featureCommit.deleted) {
			if (!findFeature(diff, 'deleted', deleted.id) || currentById.has(deleted.id)) {
				return { ok: false, reason: 'a deleted feature id was reused' }
			}
		}

		const addedIds = new Set(featureCommit.addedIds)
		const modifiedById = new Map(
			featureCommit.modifiedIds.map((id) => [id, findModifiedFeature(diff, id)?.before]),
		)
		const restored = draft.features
			.filter((feature) => !addedIds.has(feature.id))
			.map((feature) => {
				const beforeFeature = modifiedById.get(feature.id)
				return beforeFeature ? clone(beforeFeature) : feature
			})
		for (const deleted of [...featureCommit.deleted].sort(
			(a, b) => a.beforeIndex - b.beforeIndex,
		)) {
			const beforeFeature = findFeature(diff, 'deleted', deleted.id)
			if (!beforeFeature) return { ok: false, reason: 'the undo record is incomplete' }
			const nextIndex = deleted.nextId
				? restored.findIndex((feature) => feature.id === deleted.nextId)
				: -1
			const previousIndex = deleted.previousId
				? restored.findIndex((feature) => feature.id === deleted.previousId)
				: -1
			const insertionIndex =
				nextIndex >= 0
					? nextIndex
					: previousIndex >= 0
						? previousIndex + 1
						: Math.min(deleted.beforeIndex, restored.length)
			restored.splice(insertionIndex, 0, clone(beforeFeature))
		}
		updates.features = restored
	}

	if (commit.fields.collectionMeta) {
		const { before, after } = commit.fields.collectionMeta
		if (
			boundedEqual(draft.collectionMeta, after, freshBudget()) !== true ||
			draft.name !== after.name ||
			draft.description !== after.description
		) {
			return { ok: false, reason: 'Dataset metadata changed' }
		}
		updates.collectionMeta = clone(before)
	}
	if (commit.fields.selectedFeatureIds) {
		const { before, after } = commit.fields.selectedFeatureIds
		if (!arraysEqual(draft.selectedFeatureIds, after)) {
			return { ok: false, reason: 'the selection changed' }
		}
		updates.selectedFeatureIds = [...before]
	}
	return { ok: true, updates }
}
