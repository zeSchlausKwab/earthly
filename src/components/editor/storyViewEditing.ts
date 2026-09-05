import type { Editor } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, type Transaction } from '@tiptap/pm/state'
import {
	parseStoryViewBlock,
	stringifyStoryViewBlock,
	type MapPresentationStyleOverrideV1,
	type StoryViewBlockV1,
	type StoryViewLayerPatchV1,
} from '@/lib/map-presentation'

/** Reader recovery must never silently discard values during a manual edit. */
export function acceptStoryViewEdit(candidate: StoryViewBlockV1): StoryViewBlockV1 | null {
	const parsed = parseStoryViewBlock(candidate)
	return parsed.status === 'valid' && parsed.issues.length === 0 ? parsed.value : null
}

/** Insert at the end of the current selection without replacing selected prose. */
export function insertStoryViewAtSelection(editor: Editor, view: StoryViewBlockV1): boolean {
	const parsed = parseStoryViewBlock(view)
	if (parsed.status !== 'valid') return false
	return editor
		.chain()
		.setTextSelection(editor.state.selection.to)
		.insertContent([
			{ type: 'storyView', attrs: { value: stringifyStoryViewBlock(parsed.value) } },
			{ type: 'paragraph' },
		])
		.run()
}

/** Clearing a control removes its delta; it never writes the opening value. */
export function updateStoryViewLayerPatch<K extends keyof StoryViewLayerPatchV1>(
	view: StoryViewBlockV1,
	layerId: string,
	key: K,
	value: StoryViewLayerPatchV1[K] | undefined,
): StoryViewBlockV1 {
	const patch = { ...view.layers?.[layerId] }
	if (value === undefined) delete patch[key]
	else patch[key] = value
	const layers = { ...view.layers }
	if (Object.keys(patch).length) layers[layerId] = patch
	else delete layers[layerId]
	const { layers: _layers, ...rest } = view
	return Object.keys(layers).length ? { ...rest, layers } : rest
}

export function updateStoryViewStyle<K extends keyof MapPresentationStyleOverrideV1>(
	view: StoryViewBlockV1,
	layerId: string,
	key: K,
	value: MapPresentationStyleOverrideV1[K] | undefined,
): StoryViewBlockV1 {
	const style = { ...view.layers?.[layerId]?.style }
	if (value === undefined) delete style[key]
	else style[key] = value
	return updateStoryViewLayerPatch(
		view,
		layerId,
		'style',
		Object.keys(style).length ? style : undefined,
	)
}

export function removeStoryViewLayerPatch(
	view: StoryViewBlockV1,
	layerId: string,
): StoryViewBlockV1 {
	const { [layerId]: _patch, ...layers } = view.layers ?? {}
	const { layers: _layers, ...rest } = view
	return Object.keys(layers).length ? { ...rest, layers } : rest
}

export function getStoryViewMoveTarget(
	doc: ProseMirrorNode,
	position: number,
	direction: -1 | 1,
): number | null {
	if (position < 0 || position >= doc.content.size) return null
	const node = doc.nodeAt(position)
	if (node?.type.name !== 'storyView') return null
	const resolved = doc.resolve(position)
	const index = resolved.index()
	let distance = 0
	for (
		let siblingIndex = index + direction;
		siblingIndex >= 0 && siblingIndex < resolved.parent.childCount;
		siblingIndex += direction
	) {
		const sibling = resolved.parent.child(siblingIndex)
		distance += sibling.nodeSize
		// The Markdown adapter retains blank lines as empty paragraphs. Cross them
		// with their neighboring prose block, rather than making an invisible move.
		if (sibling.type.name === 'paragraph' && sibling.childCount === 0) continue
		return position + direction * distance
	}
	return null
}

/** Swap with one adjacent block using a single undoable document transaction. */
export function moveStoryView(
	transaction: Transaction,
	position: number,
	direction: -1 | 1,
): Transaction | null {
	const target = getStoryViewMoveTarget(transaction.doc, position, direction)
	if (target === null) return null
	const node = transaction.doc.nodeAt(position)
	if (!node) return null
	const from = Math.min(position, target)
	const to = Math.max(position, target) + node.nodeSize
	const siblings: ProseMirrorNode[] = []
	transaction.doc.slice(from, to).content.forEach((sibling) => {
		siblings.push(sibling)
	})
	const first = siblings[0]
	const last = siblings[siblings.length - 1]
	if (!first || !last) return null
	siblings[0] = last
	siblings[siblings.length - 1] = first
	transaction.replaceWith(from, to, Fragment.fromArray(siblings))
	return transaction.setSelection(NodeSelection.create(transaction.doc, target)).scrollIntoView()
}
