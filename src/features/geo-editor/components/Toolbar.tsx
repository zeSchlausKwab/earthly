import {
	Copy,
	Crosshair,
	Edit3,
	EyeOff,
	Layers,
	Magnet,
	MessageCircle,
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
import { Input } from '@/components/ui/input'

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
	mapStackOpen?: boolean
	chatOpen?: boolean
	onToggleMapStack?: () => void
	onToggleChat?: () => void
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
	mapStackOpen = false,
	chatOpen = false,
	onToggleMapStack,
	onToggleChat,
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
	const isEditing = viewMode === 'edit'

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
		<Input
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
								<div className="max-h-48 overflow-y-auto space-y-1 bg-popover rounded-lg border border-border">
									{searchResults.map((result) => (
										<Button
											type="button"
											key={result.placeId}
											variant="ghost"
											className="w-full text-left text-sm p-2 hover:bg-muted/50 border-b border-border last:border-0 truncate"
											onClick={() => onSearchResultSelect?.(result)}
										>
											{result.displayName}
										</Button>
									))}
								</div>
							)}
							{searchError && <div className="text-xs text-destructive px-1">{searchError}</div>}
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
														aria-label="Map settings"
													>
														<Settings2 className="h-3.5 w-3.5" />
													</Button>
												</PopoverTrigger>
											</TooltipTrigger>
											<TooltipContent side="bottom" sideOffset={8}>
												<p>Map settings</p>
											</TooltipContent>
										</Tooltip>
										<PopoverContent className="w-[28rem]" side="bottom" align="center">
											<MapSettingsPanel mode="map-only" />
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
			<div className="pointer-events-auto flex flex-col items-start gap-2" data-tour="toolbar">
				<div className="glass-panel flex max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-lg p-1.5">
					<SidebarTrigger className="h-9 w-9" />
					<Divider />

					{!isEditing ? (
						<>
							<SessionButton
								viewMode={viewMode}
								onStartNew={onStartNewDataset}
								onCancel={onCancelEditing}
							/>
							<Divider />
						</>
					) : null}

					<div className="relative">
						<SearchBar
							query={searchQuery}
							loading={searchLoading}
							placeholder="Search location..."
							onSubmit={handleSearchSubmit}
							onQueryChange={setSearchQuery}
							onClear={clearSearch}
							className="w-56"
						/>
						{searchResults && searchResults.length > 0 && (
							<div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-lg border border-border bg-popover p-2 shadow-lg">
								<div className="mb-2 flex items-center justify-between border-b border-border pb-2">
									<span className="text-xs font-medium text-muted-foreground">Results</span>
									<Button
										variant="ghost"
										size="sm"
										className="h-auto p-0 text-xs"
										onClick={clearSearch}
									>
										Close
									</Button>
								</div>
								<div className="max-h-60 space-y-1 overflow-y-auto">
									{searchResults.map((result) => (
										<button
											type="button"
											key={result.placeId}
											className="w-full truncate rounded p-1.5 text-left text-sm hover:bg-muted/50"
											onClick={() => onSearchResultSelect?.(result)}
										>
											{result.displayName}
										</button>
									))}
								</div>
							</div>
						)}
					</div>

					<IconButtonRow buttons={lookupButtons} />
					<Divider />

					<Button
						type="button"
						variant={mapStackOpen ? 'default' : 'outline'}
						size="icon"
						onClick={onToggleMapStack}
						aria-label={mapStackOpen ? 'Hide map stack' : 'Show map stack'}
						title={mapStackOpen ? 'Hide map stack' : 'Show map stack'}
					>
						<Layers className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant={chatOpen ? 'default' : 'outline'}
						size="icon"
						onClick={onToggleChat}
						aria-label={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
						title={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
					>
						<MessageCircle className="h-4 w-4" />
					</Button>
					<Divider />

					<CreateMapPopover />
					<ShareExportPopover />
					<Popover open={showMapSettings} onOpenChange={setShowMapSettings}>
						<PopoverTrigger asChild>
							<Button
								variant={showMapSettings ? 'default' : 'outline'}
								size="icon"
								aria-label="Map settings"
								title="Map settings"
							>
								<Settings2 className="h-4 w-4" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-[28rem]" side="bottom" align="start">
							<MapSettingsPanel mode="map-only" />
						</PopoverContent>
					</Popover>
					<div
						className={`flex items-center gap-1 overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out ${
							isEditing
								? 'max-w-[72rem] translate-x-0 opacity-100'
								: 'pointer-events-none max-w-0 -translate-x-2 opacity-0'
						}`}
						aria-hidden={!isEditing}
					>
						<Divider />
						<div className="flex items-center gap-1 rounded-md border border-emerald-200/80 bg-emerald-50/60 p-1 shadow-sm">
							<SessionButton
								viewMode={viewMode}
								onStartNew={onStartNewDataset}
								onCancel={onCancelEditing}
							/>
							<Divider />
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
							<Divider />
							<IconButtonRow buttons={selectButtons} />
							<Divider />
							<DrawButtonGroup mode={mode} onModeChange={handleModeChange} disabled={false} />
							<Divider />
							<IconButtonRow buttons={historyButtons} />
							<Divider />
							<IconButtonRow buttons={editButtons} />
							<GeometryOpsDropdown {...geometryOpsProps} />
							<Divider />
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
						</div>
					</div>
				</div>

				{fileInput}

				{searchError && (
					<div className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive shadow-sm self-start">
						{searchError}
					</div>
				)}
			</div>
			<SimplifyDialog open={simplifyDialogOpen} onOpenChange={setSimplifyDialogOpen} />
		</>
	)
}
