import {
	Copy,
	Crosshair,
	Edit3,
	EyeOff,
	Magnet,
	MousePointer2,
	Settings2,
	SquareDashedMousePointer,
	Trash2,
	Undo2,
	Redo2,
} from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'
import { HelpPopover } from '@/components/HelpPopover'
import { LoginSessionButtons } from '@/features/auth/LoginSessionButtons'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { SearchBar } from '@/components/ui/search-bar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { canExecuteEditorCommand, executeEditorCommand, type EditorCommandId } from '../commands'
import type { EditorMode } from '../core'
import { useEditorStore } from '../store'
import type { GeoSearchResult } from '../types'
import { CreateMapPopover } from './CreateMapPopover'
import { MapSettingsPanel } from './MapSettingsPanel'
import { ShareExportPopover } from './share/ShareExportPopover'
import {
	Divider,
	DrawButtonGroup,
	FileDropdown,
	GeometryOpsDropdown,
	IconButtonRow,
	OsmImportPopover,
	PublishDropdown,
	SessionButton,
	SimplifyDialog,
	type ToolbarButton,
} from './toolbar/index'

interface DatasetActionsProps {
	onExportGeoJSON?: () => void
	onExportSHP?: () => void
	canExport?: boolean
	onImport?: (file: File) => void
	onClear?: () => void
	canClear?: boolean
	onPublishNew?: () => void
	canPublishNew?: boolean
	onPublishUpdate?: () => void
	canPublishUpdate?: boolean
	onPublishCopy?: () => void
	canPublishCopy?: boolean
	onProposeEdit?: (description: string) => void
	canProposeEdit?: boolean
	isPublishing?: boolean
}

interface ToolbarProps {
	datasetActions?: DatasetActionsProps
	isMobile?: boolean
	showLogin?: boolean
	onSearchResultSelect?: (result: GeoSearchResult) => void
	onInspectorDeactivate?: () => void
	onStartNewDataset?: () => void
	onCancelEditing?: () => void
	onOsmQueryClick?: () => void
	onOsmQueryView?: () => void
	onOsmAdvanced?: () => void
}

export function Toolbar({
	datasetActions,
	isMobile = false,
	showLogin = true,
	onSearchResultSelect,
	onInspectorDeactivate,
	onStartNewDataset,
	onCancelEditing,
	onOsmQueryClick,
	onOsmQueryView,
	onOsmAdvanced,
}: ToolbarProps) {
	const editor = useEditorStore((state) => state.editor)
	const mode = useEditorStore((state) => state.mode)
	const snappingEnabled = useEditorStore((state) => state.snappingEnabled)
	const viewMode = useEditorStore((state) => state.viewMode)
	const editIsolationEnabled = useEditorStore((state) => state.editIsolationEnabled)
	const toggleEditIsolation = useEditorStore((state) => state.toggleEditIsolation)
	const history = useEditorStore((state) => state.history)

	// UI State
	const mobileToolsOpen = useEditorStore((state) => state.mobileToolsOpen)
	const mobileSearchOpen = useEditorStore((state) => state.mobileSearchOpen)
	const mobileActionsOpen = useEditorStore((state) => state.mobileActionsOpen)
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const setInspectorActive = useEditorStore((state) => state.setInspectorActive)
	const showMapSettings = useEditorStore((state) => state.showMapSettings)
	const setShowMapSettings = useEditorStore((state) => state.setShowMapSettings)

	// OSM Query state
	const osmQueryMode = useEditorStore((state) => state.osmQueryMode)
	const osmQueryFilter = useEditorStore((state) => state.osmQueryFilter)
	const setOsmQueryFilter = useEditorStore((state) => state.setOsmQueryFilter)
	const setOsmQueryMode = useEditorStore((state) => state.setOsmQueryMode)

	// Search State
	const searchQuery = useEditorStore((state) => state.searchQuery)
	const searchResults = useEditorStore((state) => state.searchResults)
	const searchLoading = useEditorStore((state) => state.searchLoading)
	const searchError = useEditorStore((state) => state.searchError)
	const setSearchQuery = useEditorStore((state) => state.setSearchQuery)
	const performSearch = useEditorStore((state) => state.performSearch)
	const clearSearch = useEditorStore((state) => state.clearSearch)

	const fileInputRef = useRef<HTMLInputElement>(null)
	const [magicPopoverOpen, setMagicPopoverOpen] = useState(false)
	const [simplifyDialogOpen, setSimplifyDialogOpen] = useState(false)

	// Computed: Is editing disabled (view mode active)?
	const isEditingDisabled = viewMode !== 'edit'

	const runEditorCommand = (commandId: EditorCommandId, args?: Record<string, unknown>) => {
		executeEditorCommand(commandId, args)
	}

	const handleModeChange = (newMode: EditorMode) => {
		if (inspectorActive) {
			setInspectorActive(false)
			onInspectorDeactivate?.()
		}
		runEditorCommand('set_mode', { mode: newMode })
	}

	const handleToggleSnapping = () => runEditorCommand('toggle_snapping')
	const handleToggleEditIsolation = () => toggleEditIsolation()
	const handleToggleInspector = () => {
		if (inspectorActive) {
			setInspectorActive(false)
			onInspectorDeactivate?.()
		} else {
			setInspectorActive(true)
			if (mode !== 'select') {
				runEditorCommand('set_mode', { mode: 'select' })
			}
		}
	}

	const handleSearchSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		performSearch()
	}

	const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file && datasetActions?.onImport) {
			datasetActions.onImport(file)
		}
		if (fileInputRef.current) {
			fileInputRef.current.value = ''
		}
	}

	const handleOsmClickMode = () => {
		setOsmQueryMode('click')
		onOsmQueryClick?.()
		setMagicPopoverOpen(false)
	}

	const handleOsmQueryView = () => {
		onOsmQueryView?.()
		setMagicPopoverOpen(false)
	}

	// Command capabilities
	const canUndo = canExecuteEditorCommand('undo')
	const canRedo = canExecuteEditorCommand('redo')
	const canDeleteSelected = canExecuteEditorCommand('delete_selected_features')
	const canDuplicateSelected = canExecuteEditorCommand('duplicate_selected_features')
	const canMergeSelected = canExecuteEditorCommand('merge_selected_features')
	const canSplitSelected = canExecuteEditorCommand('split_selected_features')
	const canConnectLines = canExecuteEditorCommand('connect_selected_lines')
	const canDissolveLines = canExecuteEditorCommand('dissolve_selected_lines')
	const canSimplifySelected = canExecuteEditorCommand('simplify_selected_features')
	const canStartBooleanOps = canExecuteEditorCommand('start_boolean_union')
	const booleanOpActive = editor?.getBooleanOperation()

	// Button sections
	const selectButtons: ToolbarButton[] = [
		{
			key: 'select',
			icon: MousePointer2,
			onClick: () => handleModeChange('select'),
			variant: mode === 'select' && !inspectorActive ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Select mode',
			description: 'Select and move features',
		},
		{
			key: 'box_select',
			icon: SquareDashedMousePointer,
			onClick: () => handleModeChange('box_select'),
			variant: mode === 'box_select' ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Box select mode',
			description: 'Drag to select multiple features',
		},
	]

	const historyButtons: ToolbarButton[] = [
		{
			key: 'undo',
			icon: Undo2,
			onClick: () => runEditorCommand('undo'),
			disabled: !history.canUndo || !canUndo || isEditingDisabled,
			ariaLabel: 'Undo',
			description: 'Undo last action',
		},
		{
			key: 'redo',
			icon: Redo2,
			onClick: () => runEditorCommand('redo'),
			disabled: !history.canRedo || !canRedo || isEditingDisabled,
			ariaLabel: 'Redo',
			description: 'Redo last action',
		},
	]

	const editButtons: ToolbarButton[] = [
		{
			key: 'snapping',
			icon: Magnet,
			onClick: handleToggleSnapping,
			variant: snappingEnabled ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Toggle snapping',
			description: 'Snap to nearby points',
		},
		{
			key: 'edit',
			icon: Edit3,
			onClick: () => handleModeChange('edit'),
			variant: mode === 'edit' ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Edit vertices',
			description: 'Edit vertices of selected feature',
		},
		{
			key: 'edit-isolation',
			icon: EyeOff,
			onClick: handleToggleEditIsolation,
			variant: editIsolationEnabled ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Toggle edit isolation',
			description: 'Show only geometry in the current edit state',
		},
		{
			key: 'delete',
			icon: Trash2,
			onClick: () => runEditorCommand('delete_selected_features'),
			disabled: isEditingDisabled || !canDeleteSelected,
			ariaLabel: 'Delete',
			description: 'Delete selected features',
		},
		{
			key: 'duplicate',
			icon: Copy,
			onClick: () => runEditorCommand('duplicate_selected_features'),
			disabled: isEditingDisabled || !canDuplicateSelected,
			ariaLabel: 'Duplicate',
			description: 'Duplicate selected features',
		},
	]

	const lookupButtons: ToolbarButton[] = [
		{
			key: 'reverse-lookup',
			icon: Crosshair,
			onClick: handleToggleInspector,
			variant: inspectorActive ? 'default' : 'outline',
			ariaLabel: 'Location lookup',
			description: 'Click map to get location info',
		},
	]

	const geometryOpsProps = {
		disabled: isEditingDisabled,
		onMerge: () => runEditorCommand('merge_selected_features'),
		onSplit: () => runEditorCommand('split_selected_features'),
		onConnect: () => runEditorCommand('connect_selected_lines'),
		onDissolve: () => runEditorCommand('dissolve_selected_lines'),
		onSimplify: () => setSimplifyDialogOpen(true),
		onUnion: () => runEditorCommand('start_boolean_union'),
		onDifference: () => runEditorCommand('start_boolean_difference'),
		canMerge: canMergeSelected,
		canSplit: canSplitSelected,
		canConnect: canConnectLines,
		canDissolve: canDissolveLines,
		canSimplify: canSimplifySelected,
		canBooleanOps: canStartBooleanOps,
		booleanOpActive,
	}

	const fileInput = (
		<input
			type="file"
			ref={fileInputRef}
			className="hidden"
			accept=".geojson,.json,.zip,.shp"
			onChange={handleFileImport}
		/>
	)

	// ============================================
	// MOBILE TOOLBAR
	// ============================================
	if (isMobile) {
		return (
			<>
				<div className="pointer-events-auto w-full max-w-md px-2 mx-auto">
					{mobileToolsOpen && (
						<div className="glass-panel rounded-lg p-1.5">
							{/* Row 1: Session + Select + Draw */}
							<div className="flex items-center justify-center gap-1 flex-wrap mb-1">
								<SessionButton
									viewMode={viewMode}
									onStartNew={onStartNewDataset}
									onCancel={onCancelEditing}
									small
								/>
								<Divider />
								<IconButtonRow buttons={selectButtons} small />
								<Divider />
								<DrawButtonGroup
									mode={mode}
									onModeChange={handleModeChange}
									disabled={isEditingDisabled}
									small
								/>
							</div>
							{/* Row 2: History + Edit tools + Geometry ops */}
							<div className="flex items-center justify-center gap-1 flex-wrap">
								<IconButtonRow buttons={historyButtons} small />
								<Divider />
								<IconButtonRow buttons={editButtons} small />
								<GeometryOpsDropdown {...geometryOpsProps} small />
							</div>
						</div>
					)}

					{mobileSearchOpen && (
						<div className="glass-panel flex flex-col gap-2 rounded-lg p-1.5">
							<div className="flex items-center gap-2">
								<SearchBar
									query={searchQuery}
									loading={searchLoading}
									placeholder="Search..."
									onSubmit={(e) => {
										e.preventDefault()
										handleSearchSubmit(e)
									}}
									onQueryChange={setSearchQuery}
									onClear={clearSearch}
								/>
								<IconButtonRow buttons={lookupButtons} small />
							</div>
							{searchResults && searchResults.length > 0 && (
								<div className="max-h-48 overflow-y-auto space-y-1 bg-white rounded-lg border border-gray-100">
									{searchResults.map((result) => (
										<button
											type="button"
											key={result.placeId}
											className="w-full text-left text-sm p-2 hover:bg-gray-50 border-b border-gray-50 last:border-0 truncate"
											onClick={() => onSearchResultSelect?.(result)}
										>
											{result.displayName}
										</button>
									))}
								</div>
							)}
							{searchError && <div className="text-xs text-red-600 px-1">{searchError}</div>}
						</div>
					)}

					{mobileActionsOpen && datasetActions && (
						<div className="glass-panel rounded-lg p-1.5">
							<div className="flex items-center justify-center gap-1 flex-wrap">
								<FileDropdown
									onImportClick={() => fileInputRef.current?.click()}
									onExportGeoJSON={datasetActions.onExportGeoJSON ?? (() => {})}
									onExportSHP={datasetActions.onExportSHP ?? (() => {})}
									canExport={datasetActions.canExport}
									disabled={isEditingDisabled}
									small
								/>
								<OsmImportPopover
									open={magicPopoverOpen}
									onOpenChange={setMagicPopoverOpen}
									osmQueryFilter={osmQueryFilter}
									onOsmFilterChange={setOsmQueryFilter}
									onOsmClickMode={handleOsmClickMode}
									onOsmQueryView={handleOsmQueryView}
									onOsmAdvanced={onOsmAdvanced}
									isClickMode={osmQueryMode === 'click'}
									small
								/>
								<CreateMapPopover />
								<Divider />
								<PublishDropdown
									canPublishNew={datasetActions.canPublishNew}
									canPublishUpdate={datasetActions.canPublishUpdate}
									canPublishCopy={datasetActions.canPublishCopy}
									canProposeEdit={datasetActions.canProposeEdit}
									isPublishing={datasetActions.isPublishing}
									onPublishNew={datasetActions.onPublishNew}
									onPublishUpdate={datasetActions.onPublishUpdate}
									onPublishCopy={datasetActions.onPublishCopy}
									onProposeEdit={datasetActions.onProposeEdit}
									small
								/>
								<Divider />
								<HelpPopover
									multiSelectModifier={editor?.getMultiSelectModifierLabel() ?? 'Shift'}
								/>
								<TooltipProvider delayDuration={500}>
									<Popover open={showMapSettings} onOpenChange={setShowMapSettings}>
										<Tooltip>
											<TooltipTrigger asChild>
												<PopoverTrigger asChild>
													<Button
														variant={showMapSettings ? 'default' : 'outline'}
														size="icon"
														className="h-8 w-8"
														aria-label="Settings"
													>
														<Settings2 className="h-3.5 w-3.5" />
													</Button>
												</PopoverTrigger>
											</TooltipTrigger>
											<TooltipContent side="bottom" sideOffset={8}>
												<p>Map settings</p>
											</TooltipContent>
										</Tooltip>
										<PopoverContent className="w-72" side="bottom" align="center">
											<MapSettingsPanel />
										</PopoverContent>
									</Popover>
								</TooltipProvider>
								{showLogin && <LoginSessionButtons />}
							</div>
							{fileInput}
						</div>
					)}
				</div>
				<SimplifyDialog open={simplifyDialogOpen} onOpenChange={setSimplifyDialogOpen} />
			</>
		)
	}

	// ============================================
	// DESKTOP TOOLBAR
	// ============================================
	return (
		<>
			<div className="flex flex-col gap-2 pointer-events-auto">
				<div className="glass-panel flex flex-wrap items-center gap-1 rounded-lg p-1.5">
					{/* Row 1: Core editing tools */}
					<div className="flex items-center gap-1">
						{/* Sidebar toggle */}
						<SidebarTrigger className="h-9 w-9" />
						<Divider />

						{/* Session control (New Dataset / Cancel) */}
						<SessionButton
							viewMode={viewMode}
							onStartNew={onStartNewDataset}
							onCancel={onCancelEditing}
						/>
						<Divider />

						{/* Select */}
						<IconButtonRow buttons={selectButtons} />
						<Divider />

						{/* Draw */}
						<DrawButtonGroup
							mode={mode}
							onModeChange={handleModeChange}
							disabled={isEditingDisabled}
						/>
						<Divider />

						{/* History */}
						<IconButtonRow buttons={historyButtons} />
						<Divider />

						{/* Edit */}
						<IconButtonRow buttons={editButtons} />
						<GeometryOpsDropdown {...geometryOpsProps} />
					</div>

					{/* Flexible spacer - grows on wide screens, shrinks/wraps on narrow */}
					<div className="flex-1 min-w-4" />

					{/* Row 2: Search, data & publish tools */}
					<div className="flex items-center gap-1">
						{/* Search */}
						<div className="relative">
							<SearchBar
								query={searchQuery}
								loading={searchLoading}
								placeholder="Search location..."
								onSubmit={handleSearchSubmit}
								onQueryChange={setSearchQuery}
								onClear={clearSearch}
								className="w-48"
							/>
							{searchResults && searchResults.length > 0 && (
								<div className="absolute top-full left-0 mt-2 w-64 rounded-lg bg-white p-2 shadow-lg z-50 border border-gray-100">
									<div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-2">
										<span className="text-xs font-medium text-gray-500">Results</span>
										<Button
											variant="ghost"
											size="sm"
											className="h-auto p-0 text-xs"
											onClick={clearSearch}
										>
											Close
										</Button>
									</div>
									<div className="max-h-60 overflow-y-auto space-y-1">
										{searchResults.map((result) => (
											<button
												type="button"
												key={result.placeId}
												className="w-full text-left text-sm p-1.5 hover:bg-gray-50 rounded truncate"
												onClick={() => onSearchResultSelect?.(result)}
											>
												{result.displayName}
											</button>
										))}
									</div>
								</div>
							)}
						</div>

						{/* Lookup */}
						<IconButtonRow buttons={lookupButtons} />
						<Divider />

						{/* File, OSM, Map & Publish */}
						<FileDropdown
							onImportClick={() => fileInputRef.current?.click()}
							onExportGeoJSON={datasetActions?.onExportGeoJSON ?? (() => {})}
							onExportSHP={datasetActions?.onExportSHP ?? (() => {})}
							canExport={datasetActions?.canExport}
							disabled={isEditingDisabled}
						/>
						<OsmImportPopover
							open={magicPopoverOpen}
							onOpenChange={setMagicPopoverOpen}
							osmQueryFilter={osmQueryFilter}
							onOsmFilterChange={setOsmQueryFilter}
							onOsmClickMode={handleOsmClickMode}
							onOsmQueryView={handleOsmQueryView}
							onOsmAdvanced={onOsmAdvanced}
							isClickMode={osmQueryMode === 'click'}
						/>
						<CreateMapPopover />
						<PublishDropdown
							canPublishNew={datasetActions?.canPublishNew}
							canPublishUpdate={datasetActions?.canPublishUpdate}
							canPublishCopy={datasetActions?.canPublishCopy}
							canProposeEdit={datasetActions?.canProposeEdit}
							isPublishing={datasetActions?.isPublishing}
							onPublishNew={datasetActions?.onPublishNew}
							onPublishUpdate={datasetActions?.onPublishUpdate}
							onPublishCopy={datasetActions?.onPublishCopy}
							onProposeEdit={datasetActions?.onProposeEdit}
						/>

						<Divider />
						<ShareExportPopover />
					</div>

					{fileInput}
				</div>

				{searchError && (
					<div className="rounded-lg bg-red-50 p-2 text-xs text-red-600 shadow-sm self-start">
						{searchError}
					</div>
				)}
			</div>
			<SimplifyDialog open={simplifyDialogOpen} onOpenChange={setSimplifyDialogOpen} />
		</>
	)
}
