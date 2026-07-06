/**
 * Canonical per-action icons for entity rows — the single source of truth so the
 * SAME function always renders the SAME icon across the dataset catalog, the
 * context catalog, and the Map Stack rows.
 *
 * Render order convention (left → right), showing only the actions that apply to
 * a given row:
 *
 *   [map-stack toggle] → [zoom] → [inspect] → [load into editor] → [favorite] → [debug]
 *
 * Map Stack rows are already on the stack, so they drop the map-stack toggle and
 * instead lead with the stack-specific Focus (isolate) and trail with Pin +
 * Remove; the shared middle (zoom → inspect → load) keeps the same relative
 * order and icons as the catalogs.
 *
 * When adding a new row action, add its icon here and reuse it everywhere rather
 * than importing a lucide icon directly at the call site.
 */
export {
	Bug as DebugActionIcon,
	Database as DatasetGlyphIcon,
	Focus as IsolateActionIcon,
	Layers as MapStackActionIcon,
	LocateFixed as ZoomActionIcon,
	PanelLeft as OpenPanelActionIcon,
	PencilLine as DraftGlyphIcon,
	Pin as PinActionIcon,
	Search as InspectActionIcon,
	SquarePen as LoadEditorActionIcon,
	Star as FavoriteActionIcon,
	Trash2 as DeleteActionIcon,
	X as RemoveActionIcon,
} from 'lucide-react'
