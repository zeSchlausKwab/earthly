import { useRef, useState } from 'react'
import {
	Combine,
	Copy,
	CopyPlus,
	Crosshair,
	Download,
	Edit3,
	EyeOff,
	GitPullRequest,
	Link2,
	Lock,
	LockOpen,
	Magnet,
	Merge,
	Minus,
	MousePointer2,
	MoreHorizontal,
	RefreshCw,
	Route,
	Search,
	Split as SplitIcon,
	SquareDashedMousePointer,
	Trash2,
	Type,
	Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { canExecuteEditorCommand, executeEditorCommand } from '../commands'
import { ProposalDialog } from './toolbar/ProposalDialog'
import type { EditorMode } from '../core'
import { useEditorStore } from '../store'

/**
 * MobileToolMenu — the mobile tool strip's ••• overflow. It mirrors the full
 * desktop authoring toolbar (Draw / Edit / Geometry ops / File / Publish) in a
 * single scrolling dropdown so nothing the desktop offers while editing is
 * unreachable on a phone. Command-based actions run through the shared
 * `executeEditorCommand`/`canExecuteEditorCommand` (no prop threading); the
 * data/publish verbs come in as callbacks from GeoEditorView.
 */
export interface MobileToolMenuProps {
	panLocked: boolean
	onTogglePanLock: () => void
	magnifierEnabled: boolean
	onToggleMagnifier: () => void
	onExportGeoJSON: () => void
	onExportSHP?: () => void
	onImport?: (file: File) => void
	onClear: () => void
	canExport: boolean
	canClear: boolean
	onPublishUpdate?: () => void
	canPublishUpdate?: boolean
	onPublishCopy?: () => void
	canPublishCopy?: boolean
	/** Propose an edit to a foreign dataset (opens the description dialog). */
	onProposeEdit?: (description: string) => void
	canProposeEdit?: boolean
	isPublishing?: boolean
	onOsmClick?: () => void
	onOsmView?: () => void
	onOsmAdvanced?: () => void
}

export function MobileToolMenu({
	panLocked,
	onTogglePanLock,
	magnifierEnabled,
	onToggleMagnifier,
	onExportGeoJSON,
	onExportSHP,
	onImport,
	onClear,
	canExport,
	canClear,
	onPublishUpdate,
	canPublishUpdate,
	onPublishCopy,
	canPublishCopy,
	onProposeEdit,
	canProposeEdit,
	isPublishing,
	onOsmClick,
	onOsmView,
	onOsmAdvanced,
}: MobileToolMenuProps) {
	const [proposalDialogOpen, setProposalDialogOpen] = useState(false)
	const mode = useEditorStore((state) => state.mode)
	const snappingEnabled = useEditorStore((state) => state.snappingEnabled)
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const setInspectorActive = useEditorStore((state) => state.setInspectorActive)
	const editIsolationEnabled = useEditorStore(
		(state) => state.mapStackEntries['draft:active']?.isolated === true,
	)
	const setMapStackEntryIsolated = useEditorStore((state) => state.setMapStackEntryIsolated)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const setMode = (next: EditorMode) => executeEditorCommand('set_mode', { mode: next })
	const toggleInspector = () => {
		if (inspectorActive) {
			setInspectorActive(false)
		} else {
			setInspectorActive(true)
			if (mode !== 'select') executeEditorCommand('set_mode', { mode: 'select' })
		}
	}

	const canUndo = canExecuteEditorCommand('undo')
	const canRedo = canExecuteEditorCommand('redo')
	const canDelete = canExecuteEditorCommand('delete_selected_features')
	const canDuplicate = canExecuteEditorCommand('duplicate_selected_features')
	const canMerge = canExecuteEditorCommand('merge_selected_features')
	const canSplit = canExecuteEditorCommand('split_selected_features')
	const canConnect = canExecuteEditorCommand('connect_selected_lines')
	const canDissolve = canExecuteEditorCommand('dissolve_selected_lines')
	const canSimplify = canExecuteEditorCommand('simplify_selected_features')
	const canBoolean = canExecuteEditorCommand('start_boolean_union')

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					className="h-9 w-9 shrink-0 rounded-[2px]"
					aria-label="More tools"
					title="More tools"
				>
					<MoreHorizontal className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="end" className="max-h-[70vh] w-60 overflow-y-auto">
				<DropdownMenuLabel>History</DropdownMenuLabel>
				<DropdownMenuGroup>
					<DropdownMenuItem disabled={!canUndo} onSelect={() => executeEditorCommand('undo')}>
						<RefreshCw className="h-4 w-4 -scale-x-100" />
						Undo
					</DropdownMenuItem>
					<DropdownMenuItem disabled={!canRedo} onSelect={() => executeEditorCommand('redo')}>
						<RefreshCw className="h-4 w-4" />
						Redo
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Tools</DropdownMenuLabel>
				<DropdownMenuGroup>
					<DropdownMenuItem onSelect={() => setMode('box_select')}>
						<SquareDashedMousePointer className="h-4 w-4" />
						Box select
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => setMode('edit')}>
						<Edit3 className="h-4 w-4" />
						Edit vertices
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => setMode('draw_annotation')}>
						<Type className="h-4 w-4" />
						Label
					</DropdownMenuItem>
					<DropdownMenuCheckboxItem
						checked={snappingEnabled}
						onCheckedChange={() => executeEditorCommand('toggle_snapping')}
					>
						<Magnet className="h-4 w-4" />
						Snapping
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem checked={panLocked} onCheckedChange={onTogglePanLock}>
						{panLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
						Lock pan while drawing
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem checked={magnifierEnabled} onCheckedChange={onToggleMagnifier}>
						<Search className="h-4 w-4" />
						Magnifier
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem
						checked={editIsolationEnabled}
						onCheckedChange={() => setMapStackEntryIsolated('draft:active', !editIsolationEnabled)}
					>
						<EyeOff className="h-4 w-4" />
						Edit isolation
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem checked={inspectorActive} onCheckedChange={toggleInspector}>
						<Crosshair className="h-4 w-4" />
						Location lookup
					</DropdownMenuCheckboxItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Selection</DropdownMenuLabel>
				<DropdownMenuGroup>
					<DropdownMenuItem
						disabled={!canDelete}
						variant="destructive"
						onSelect={() => executeEditorCommand('delete_selected_features')}
					>
						<Trash2 className="h-4 w-4" />
						Delete selected
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!canDuplicate}
						onSelect={() => executeEditorCommand('duplicate_selected_features')}
					>
						<Copy className="h-4 w-4" />
						Duplicate selected
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<Combine className="h-4 w-4" />
						Geometry operations
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="max-h-[60vh] w-56 overflow-y-auto">
						<DropdownMenuItem
							disabled={!canMerge}
							onSelect={() => executeEditorCommand('merge_selected_features')}
						>
							<Merge className="h-4 w-4" />
							Merge to Multi
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!canSplit}
							onSelect={() => executeEditorCommand('split_selected_features')}
						>
							<SplitIcon className="h-4 w-4" />
							Split Multi
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!canSimplify}
							onSelect={() => executeEditorCommand('simplify_selected_features')}
						>
							<Route className="h-4 w-4" />
							Simplify selection
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={!canConnect}
							onSelect={() => executeEditorCommand('connect_selected_lines')}
						>
							<Link2 className="h-4 w-4" />
							Connect lines
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!canDissolve}
							onSelect={() => executeEditorCommand('dissolve_selected_lines')}
						>
							<Combine className="h-4 w-4" />
							Dissolve lines
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={!canBoolean}
							onSelect={() => executeEditorCommand('start_boolean_union')}
						>
							<Combine className="h-4 w-4" />
							Boolean union
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!canBoolean}
							onSelect={() => executeEditorCommand('start_boolean_difference')}
						>
							<Minus className="h-4 w-4" />
							Boolean difference
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				{onOsmClick || onOsmView || onOsmAdvanced ? (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<MousePointer2 className="h-4 w-4" />
							OpenStreetMap
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="w-56">
							{onOsmClick ? (
								<DropdownMenuItem onSelect={onOsmClick}>Click on map</DropdownMenuItem>
							) : null}
							{onOsmView ? (
								<DropdownMenuItem onSelect={onOsmView}>Query current view</DropdownMenuItem>
							) : null}
							{onOsmAdvanced ? (
								<DropdownMenuItem onSelect={onOsmAdvanced}>Advanced…</DropdownMenuItem>
							) : null}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Data</DropdownMenuLabel>
				<DropdownMenuGroup>
					{onImport ? (
						<DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
							<Upload className="h-4 w-4" />
							Import GeoJSON / SHP
						</DropdownMenuItem>
					) : null}
					<DropdownMenuItem disabled={!canExport} onSelect={onExportGeoJSON}>
						<Download className="h-4 w-4" />
						Export GeoJSON
					</DropdownMenuItem>
					{onExportSHP ? (
						<DropdownMenuItem disabled={!canExport} onSelect={onExportSHP}>
							<Download className="h-4 w-4" />
							Export SHP
						</DropdownMenuItem>
					) : null}
				</DropdownMenuGroup>
				{canPublishUpdate || canPublishCopy || canProposeEdit ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>Publish</DropdownMenuLabel>
						<DropdownMenuGroup>
							{onPublishUpdate ? (
								<DropdownMenuItem disabled={!canPublishUpdate} onSelect={onPublishUpdate}>
									<RefreshCw className="h-4 w-4" />
									Update existing
								</DropdownMenuItem>
							) : null}
							{onPublishCopy ? (
								<DropdownMenuItem disabled={!canPublishCopy} onSelect={onPublishCopy}>
									<CopyPlus className="h-4 w-4" />
									Fork as new dataset
								</DropdownMenuItem>
							) : null}
							{onProposeEdit && canProposeEdit ? (
								<DropdownMenuItem onSelect={() => setProposalDialogOpen(true)}>
									<GitPullRequest className="h-4 w-4" />
									Propose edit to owner…
								</DropdownMenuItem>
							) : null}
						</DropdownMenuGroup>
					</>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={!canClear}
					variant="destructive"
					onSelect={onClear}
					className={cn(!canClear && 'opacity-50')}
				>
					<Trash2 className="h-4 w-4" />
					Clear draft
				</DropdownMenuItem>
			</DropdownMenuContent>
			{onImport ? (
				<Input
					type="file"
					ref={fileInputRef}
					className="hidden"
					accept=".geojson,.json,.zip,.shp"
					onChange={(event) => {
						const file = event.target.files?.[0]
						if (file) onImport(file)
						if (fileInputRef.current) fileInputRef.current.value = ''
					}}
				/>
			) : null}
			{onProposeEdit ? (
				<ProposalDialog
					open={proposalDialogOpen}
					onOpenChange={setProposalDialogOpen}
					isPublishing={isPublishing}
					onSubmit={(description) => onProposeEdit(description)}
				/>
			) : null}
		</DropdownMenu>
	)
}
