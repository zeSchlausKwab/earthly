import {
	Combine,
	Copy,
	CopyPlus,
	Crosshair,
	Download,
	Edit3,
	EyeOff,
	FileText,
	Globe,
	Layers,
	Link2,
	MapPin,
	Magnet,
	MessageCircle,
	Merge,
	Minus,
	MousePointerClick,
	MousePointer2,
	Pentagon,
	PlusCircle,
	RefreshCw,
	Route,
	Scan,
	Search,
	Settings2,
	Sparkles,
	Split as SplitIcon,
	SquareDashedMousePointer,
	Type,
	Trash2,
	Undo2,
	Upload,
	UploadCloud,
	Redo2,
	X,
	XCircle,
} from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'
import { HelpPopover } from '@/components/HelpPopover'
import { LoginSessionButtons } from '@/features/auth/LoginSessionButtons'
import { Button } from '@/components/ui/button'
import {
	Menubar,
	MenubarCheckboxItem,
	MenubarContent,
	MenubarGroup,
	MenubarItem,
	MenubarLabel,
	MenubarMenu,
	MenubarRadioGroup,
	MenubarRadioItem,
	MenubarSeparator,
	MenubarSub,
	MenubarSubContent,
	MenubarSubTrigger,
	MenubarTrigger,
} from '@/components/ui/menubar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { SearchBar } from '@/components/ui/search-bar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
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
import { OSM_FILTER_PRESETS } from './toolbar/OsmImportPopover'
import { useResponsiveToolbar } from './toolbar/useResponsiveToolbar'
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
	mapStackEntryCount?: number
	mapStackVisibleCount?: number
	chatOpen?: boolean
	onToggleMapStack?: () => void
	onToggleChat?: () => void
	contextScopeLabel?: string | null
	focusLabel?: string | null
	focusKind?: 'dataset' | 'context' | null
	onClearContextScope?: () => void
	onClearFocus?: () => void
}

interface MapStateClusterProps {
	viewMode: 'edit' | 'view'
	mapStackOpen: boolean
	mapStackEntryCount: number
	mapStackVisibleCount: number
	contextScopeLabel?: string | null
	focusLabel?: string | null
	focusKind?: 'dataset' | 'context' | null
	onToggleMapStack?: () => void
	onClearContextScope?: () => void
	onClearFocus?: () => void
	compact?: boolean
	flat?: boolean
}

function MapStateCluster({
	viewMode,
	mapStackOpen,
	mapStackEntryCount,
	mapStackVisibleCount,
	contextScopeLabel,
	focusLabel,
	focusKind,
	onToggleMapStack,
	onClearContextScope,
	onClearFocus,
	compact = false,
	flat = false,
}: MapStateClusterProps) {
	const stanceLabel = viewMode === 'edit' ? 'Edit' : focusLabel ? 'Inspect' : 'Browse'
	const stanceClass = flat
		? viewMode === 'edit'
			? 'text-emerald-700'
			: focusLabel
				? 'text-amber-700'
				: 'text-muted-foreground'
		: viewMode === 'edit'
			? 'border-emerald-200 bg-emerald-50 text-emerald-800'
			: focusLabel
				? 'border-amber-200 bg-amber-50 text-amber-800'
				: 'border-slate-200 bg-slate-50 text-slate-700'
	const mapCountLabel =
		mapStackEntryCount > 0 ? `${mapStackVisibleCount}/${mapStackEntryCount}` : '0'
	const hasContextScope = Boolean(contextScopeLabel)
	const hasFocus = Boolean(focusLabel)
	const focusIcon = focusKind === 'context' ? Globe : Crosshair
	const FocusIcon = focusIcon
	const clusterClass = flat
		? 'flex min-w-0 shrink-0 items-center gap-1'
		: `flex min-w-0 items-center gap-1 rounded-md border border-border/80 bg-background/85 p-1 shadow-sm backdrop-blur ${
				compact ? 'max-w-full overflow-x-auto' : ''
			}`
	const flatItemClass =
		'h-8 shrink-0 gap-1.5 rounded-md border border-transparent px-2 text-sm font-medium shadow-none hover:bg-accent hover:text-accent-foreground'
	const flatActiveClass = 'bg-accent text-accent-foreground'

	return (
		<div className={clusterClass}>
			<Button
				type="button"
				variant={flat ? 'ghost' : mapStackOpen ? 'default' : 'ghost'}
				size={compact ? 'sm' : 'default'}
				className={
					flat
						? cn(flatItemClass, mapStackOpen && flatActiveClass)
						: `h-7 shrink-0 gap-1.5 rounded-md px-2 text-xs ${
								mapStackOpen ? '' : 'text-muted-foreground hover:text-foreground'
							}`
				}
				onClick={onToggleMapStack}
				aria-label={mapStackOpen ? 'Hide map stack' : 'Show map stack'}
				title={mapStackOpen ? 'Hide map stack' : 'Show map stack'}
			>
				<Layers className="h-3.5 w-3.5" />
				<span className={compact ? 'sr-only' : ''}>Map</span>
				<span
					className={
						flat
							? 'font-mono text-xs tabular-nums'
							: 'rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums'
					}
				>
					{mapCountLabel}
				</span>
			</Button>
			<span
				className={
					flat
						? `inline-flex h-8 shrink-0 items-center rounded-md border border-transparent px-2 text-sm font-medium ${stanceClass}`
						: `inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-[11px] font-semibold uppercase ${stanceClass}`
				}
				title={`Current stance: ${stanceLabel}`}
			>
				{stanceLabel}
			</span>
			{hasContextScope ? (
				<span
					className={
						flat
							? 'inline-flex h-8 min-w-0 max-w-[8rem] items-center gap-1 rounded-md border border-transparent px-2 text-sm font-medium text-muted-foreground'
							: `inline-flex h-7 min-w-0 items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 text-xs text-sky-900 ${
									compact ? 'max-w-[8rem]' : 'max-w-[14rem]'
								}`
					}
				>
					<Globe className={flat ? 'h-3.5 w-3.5 shrink-0' : 'h-3.5 w-3.5 shrink-0 text-sky-700'} />
					<span className="truncate">{contextScopeLabel}</span>
					{onClearContextScope ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className={
								flat
									? '-mr-1 h-5 w-5 shrink-0 rounded-full'
									: '-mr-1 h-5 w-5 shrink-0 rounded-full text-sky-700 hover:bg-sky-100'
							}
							onClick={onClearContextScope}
							aria-label="Leave context scope"
							title="Leave context scope"
						>
							<X className="h-3 w-3" />
						</Button>
					) : null}
				</span>
			) : null}
			{hasFocus ? (
				<span
					className={
						flat
							? 'inline-flex h-8 min-w-0 max-w-[8rem] items-center gap-1 rounded-md border border-transparent px-2 text-sm font-medium text-muted-foreground'
							: `inline-flex h-7 min-w-0 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs text-amber-900 ${
									compact ? 'max-w-[8rem]' : 'max-w-[14rem]'
								}`
					}
				>
					<FocusIcon
						className={flat ? 'h-3.5 w-3.5 shrink-0' : 'h-3.5 w-3.5 shrink-0 text-amber-700'}
					/>
					<span className="truncate">{focusLabel}</span>
					{onClearFocus ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className={
								flat
									? '-mr-1 h-5 w-5 shrink-0 rounded-full'
									: '-mr-1 h-5 w-5 shrink-0 rounded-full text-amber-700 hover:bg-amber-100'
							}
							onClick={onClearFocus}
							aria-label="Clear focused item"
							title="Clear focused item"
						>
							<X className="h-3 w-3" />
						</Button>
					) : null}
				</span>
			) : null}
		</div>
	)
}

type MenuIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>

interface ToolbarMenuTriggerProps {
	icon: MenuIcon
	label: string
	active?: boolean
}

function ToolbarMenuTrigger({ icon: Icon, label, active }: ToolbarMenuTriggerProps) {
	return (
		<MenubarTrigger
			className={cn(
				'h-8 gap-1.5 px-2 text-sm font-medium',
				active && 'bg-accent text-accent-foreground',
			)}
		>
			<Icon className="h-3.5 w-3.5" />
			<span>{label}</span>
		</MenubarTrigger>
	)
}

interface ToolbarMenuItemProps {
	icon: MenuIcon
	label: string
	onSelect?: () => void
	disabled?: boolean
	variant?: 'default' | 'destructive'
}

function ToolbarMenuItem({
	icon: Icon,
	label,
	onSelect,
	disabled,
	variant = 'default',
}: ToolbarMenuItemProps) {
	return (
		<MenubarItem
			disabled={disabled}
			variant={variant}
			onSelect={() => {
				if (!disabled) onSelect?.()
			}}
		>
			<Icon className="h-4 w-4" />
			<span>{label}</span>
		</MenubarItem>
	)
}

interface ToolbarMenuCheckboxProps {
	icon: MenuIcon
	label: string
	checked: boolean
	onCheckedChange: () => void
	disabled?: boolean
}

function ToolbarMenuCheckbox({
	icon: Icon,
	label,
	checked,
	onCheckedChange,
	disabled,
}: ToolbarMenuCheckboxProps) {
	return (
		<MenubarCheckboxItem
			checked={checked}
			disabled={disabled}
			onCheckedChange={() => {
				if (!disabled) onCheckedChange()
			}}
		>
			<Icon className="h-4 w-4" />
			<span>{label}</span>
		</MenubarCheckboxItem>
	)
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
	mapStackEntryCount = 0,
	mapStackVisibleCount = 0,
	chatOpen = false,
	onToggleMapStack,
	onToggleChat,
	contextScopeLabel,
	focusLabel,
	focusKind,
	onClearContextScope,
	onClearFocus,
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

	// Responsive toolbar — measures available width and decides which priority
	// menus (Draw → Edit → View) expand inline vs stay as MenubarMenu dropdowns.
	const { containerRef: toolbarContainerRef, expanded: expandedMenus } = useResponsiveToolbar()

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

	const canPublishFromMenu = Boolean(
		datasetActions?.canPublishNew ||
			datasetActions?.canPublishUpdate ||
			datasetActions?.canPublishCopy,
	)
	const showProposalPublishControl = isEditing && Boolean(datasetActions?.canProposeEdit)
	const publishMenuDisabled = Boolean(datasetActions?.isPublishing)

	// Desktop menus — Draw, Edit, View each render in one of two forms depending
	// on `expandedMenus`: inline button row (when the toolbar has horizontal
	// room) or a collapsed MenubarMenu dropdown. File never expands inline
	// (too many items) so it stays as a dropdown always.
	const drawExpandedInline = (
		<div className="flex items-center gap-0.5">
			<IconButtonRow buttons={selectButtons} small />
			<DrawButtonGroup
				mode={mode}
				onModeChange={handleModeChange}
				disabled={isEditingDisabled}
				small
			/>
			{/* OsmImportPopover moved out of Draw — rendered as a standalone
			    button next to the File menu so it's always reachable. */}
		</div>
	)

	const editExpandedInline = (
		<div className="flex items-center gap-0.5">
			<IconButtonRow buttons={historyButtons} small />
			<IconButtonRow buttons={editButtons} small />
			<GeometryOpsDropdown {...geometryOpsProps} small />
		</div>
	)

	const desktopCommandMenubar = (
		<Menubar className="h-8 shrink-0 gap-0.5 border-0 bg-transparent p-0 shadow-none">
			<MenubarMenu>
				<ToolbarMenuTrigger icon={isEditing ? XCircle : FileText} label="File" active={isEditing} />
				<MenubarContent align="start" className="min-w-56">
					<MenubarGroup>
						<ToolbarMenuItem
							icon={isEditing ? XCircle : PlusCircle}
							label={isEditing ? 'Cancel editing' : 'New dataset'}
							onSelect={isEditing ? onCancelEditing : onStartNewDataset}
							variant={isEditing ? 'destructive' : 'default'}
						/>
					</MenubarGroup>
					<MenubarSeparator />
					<MenubarGroup>
						<ToolbarMenuItem
							icon={Upload}
							label="Import GeoJSON / SHP"
							onSelect={() => fileInputRef.current?.click()}
							disabled={isEditingDisabled}
						/>
						<ToolbarMenuItem
							icon={Download}
							label="Export GeoJSON"
							onSelect={datasetActions?.onExportGeoJSON}
							disabled={isEditingDisabled || !datasetActions?.canExport}
						/>
						<ToolbarMenuItem
							icon={Download}
							label="Export SHP"
							onSelect={datasetActions?.onExportSHP}
							disabled={isEditingDisabled || !datasetActions?.canExport}
						/>
					</MenubarGroup>
					{canPublishFromMenu ? (
						<>
							<MenubarSeparator />
							<MenubarLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">
								Publish
							</MenubarLabel>
							<ToolbarMenuItem
								icon={UploadCloud}
								label="Publish new dataset"
								onSelect={datasetActions?.onPublishNew}
								disabled={publishMenuDisabled || !datasetActions?.canPublishNew}
							/>
							<ToolbarMenuItem
								icon={RefreshCw}
								label="Update existing"
								onSelect={datasetActions?.onPublishUpdate}
								disabled={publishMenuDisabled || !datasetActions?.canPublishUpdate}
							/>
							<ToolbarMenuItem
								icon={CopyPlus}
								label="Fork as new dataset"
								onSelect={datasetActions?.onPublishCopy}
								disabled={publishMenuDisabled || !datasetActions?.canPublishCopy}
							/>
						</>
					) : null}
				</MenubarContent>
			</MenubarMenu>

			{expandedMenus.has('draw') ? (
				drawExpandedInline
			) : (
				<MenubarMenu>
					<ToolbarMenuTrigger icon={MousePointer2} label="Draw" active={mode.startsWith('draw_')} />
					<MenubarContent align="start" className="min-w-56">
						<MenubarRadioGroup value={mode}>
							<MenubarRadioItem
								value="select"
								disabled={isEditingDisabled}
								onSelect={() => handleModeChange('select')}
							>
								<MousePointer2 className="h-4 w-4" />
								<span>Select</span>
							</MenubarRadioItem>
							<MenubarRadioItem
								value="box_select"
								disabled={isEditingDisabled}
								onSelect={() => handleModeChange('box_select')}
							>
								<SquareDashedMousePointer className="h-4 w-4" />
								<span>Box select</span>
							</MenubarRadioItem>
							<MenubarSeparator />
							<MenubarRadioItem
								value="draw_point"
								disabled={isEditingDisabled}
								onSelect={() => handleModeChange('draw_point')}
							>
								<MapPin className="h-4 w-4" />
								<span>Point</span>
							</MenubarRadioItem>
							<MenubarRadioItem
								value="draw_linestring"
								disabled={isEditingDisabled}
								onSelect={() => handleModeChange('draw_linestring')}
							>
								<Route className="h-4 w-4" />
								<span>Line</span>
							</MenubarRadioItem>
							<MenubarRadioItem
								value="draw_polygon"
								disabled={isEditingDisabled}
								onSelect={() => handleModeChange('draw_polygon')}
							>
								<Pentagon className="h-4 w-4" />
								<span>Polygon</span>
							</MenubarRadioItem>
							<MenubarRadioItem
								value="draw_annotation"
								disabled={isEditingDisabled}
								onSelect={() => handleModeChange('draw_annotation')}
							>
								<Type className="h-4 w-4" />
								<span>Label</span>
							</MenubarRadioItem>
						</MenubarRadioGroup>
						<MenubarSeparator />
						<MenubarSub>
							<MenubarSubTrigger className="gap-2">
								<Sparkles className="h-4 w-4 text-muted-foreground" />
								<span>OpenStreetMap</span>
							</MenubarSubTrigger>
							<MenubarSubContent className="min-w-56">
								<MenubarLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">
									Feature type
								</MenubarLabel>
								<MenubarRadioGroup value={osmQueryFilter}>
									{OSM_FILTER_PRESETS.map((preset) => (
										<MenubarRadioItem
											key={preset.value}
											value={preset.value}
											onSelect={() => setOsmQueryFilter(preset.value)}
										>
											<span>{preset.label}</span>
										</MenubarRadioItem>
									))}
								</MenubarRadioGroup>
								<MenubarSeparator />
								<ToolbarMenuItem
									icon={MousePointerClick}
									label="Click on map"
									onSelect={handleOsmClickMode}
									disabled={isEditingDisabled}
								/>
								<ToolbarMenuItem
									icon={Scan}
									label="Query current view"
									onSelect={handleOsmQueryView}
									disabled={isEditingDisabled}
								/>
								<ToolbarMenuItem
									icon={Settings2}
									label="Advanced..."
									onSelect={onOsmAdvanced}
									disabled={isEditingDisabled || !onOsmAdvanced}
								/>
							</MenubarSubContent>
						</MenubarSub>
					</MenubarContent>
				</MenubarMenu>
			)}

			{expandedMenus.has('edit') ? (
				editExpandedInline
			) : (
				<MenubarMenu>
					<ToolbarMenuTrigger
						icon={Edit3}
						label="Edit"
						active={isEditing || editIsolationEnabled || Boolean(booleanOpActive)}
					/>
					<MenubarContent align="start" className="min-w-60">
						<MenubarGroup>
							<ToolbarMenuItem
								icon={Undo2}
								label="Undo"
								onSelect={() => runEditorCommand('undo')}
								disabled={!history.canUndo || !canUndo || isEditingDisabled}
							/>
							<ToolbarMenuItem
								icon={Redo2}
								label="Redo"
								onSelect={() => runEditorCommand('redo')}
								disabled={!history.canRedo || !canRedo || isEditingDisabled}
							/>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<ToolbarMenuItem
								icon={Edit3}
								label="Edit vertices"
								onSelect={() => handleModeChange('edit')}
								disabled={isEditingDisabled}
							/>
							<ToolbarMenuCheckbox
								icon={Magnet}
								label="Snapping"
								checked={snappingEnabled}
								onCheckedChange={handleToggleSnapping}
								disabled={isEditingDisabled}
							/>
							<ToolbarMenuCheckbox
								icon={EyeOff}
								label="Edit isolation"
								checked={editIsolationEnabled}
								onCheckedChange={handleToggleEditIsolation}
								disabled={isEditingDisabled}
							/>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<ToolbarMenuItem
								icon={Trash2}
								label="Delete selected"
								onSelect={() => runEditorCommand('delete_selected_features')}
								disabled={isEditingDisabled || !canDeleteSelected}
								variant="destructive"
							/>
							<ToolbarMenuItem
								icon={Copy}
								label="Duplicate selected"
								onSelect={() => runEditorCommand('duplicate_selected_features')}
								disabled={isEditingDisabled || !canDuplicateSelected}
							/>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarSub>
							<MenubarSubTrigger className="gap-2">
								<Combine className="h-4 w-4 text-muted-foreground" />
								<span>Geometry operations</span>
							</MenubarSubTrigger>
							<MenubarSubContent className="min-w-60">
								<MenubarLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">
									Multi / Structure
								</MenubarLabel>
								<ToolbarMenuItem
									icon={Merge}
									label="Merge to Multi"
									onSelect={() => runEditorCommand('merge_selected_features')}
									disabled={!canMergeSelected}
								/>
								<ToolbarMenuItem
									icon={SplitIcon}
									label="Split Multi"
									onSelect={() => runEditorCommand('split_selected_features')}
									disabled={!canSplitSelected}
								/>
								<ToolbarMenuItem
									icon={Route}
									label="Simplify Selection"
									onSelect={() => setSimplifyDialogOpen(true)}
									disabled={!canSimplifySelected}
								/>
								<MenubarSeparator />
								<MenubarLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">
									Lines
								</MenubarLabel>
								<ToolbarMenuItem
									icon={Link2}
									label="Connect Lines"
									onSelect={() => runEditorCommand('connect_selected_lines')}
									disabled={!canConnectLines}
								/>
								<ToolbarMenuItem
									icon={Combine}
									label="Dissolve Lines"
									onSelect={() => runEditorCommand('dissolve_selected_lines')}
									disabled={!canDissolveLines}
								/>
								<MenubarSeparator />
								<MenubarLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">
									Boolean
								</MenubarLabel>
								<ToolbarMenuItem
									icon={Combine}
									label="Boolean Union"
									onSelect={() => runEditorCommand('start_boolean_union')}
									disabled={!canStartBooleanOps}
								/>
								<ToolbarMenuItem
									icon={Minus}
									label="Boolean Difference"
									onSelect={() => runEditorCommand('start_boolean_difference')}
									disabled={!canStartBooleanOps}
								/>
							</MenubarSubContent>
						</MenubarSub>
					</MenubarContent>
				</MenubarMenu>
			)}

			{/* View menu dropped — Location lookup is now a standalone
			    Crosshair button rendered next to the search box (below). */}
		</Menubar>
	)

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
	// MOBILE TOOLBAR (legacy — kept until we're sure the responsive unified
	// toolbar handles every viewport. To re-enable, change `MOBILE_TOOLBAR_ENABLED`
	// to use `isMobile`.)
	// ============================================
	const MOBILE_TOOLBAR_ENABLED = false
	if (isMobile && MOBILE_TOOLBAR_ENABLED) {
		return (
			<>
				<div className="pointer-events-auto w-full max-w-md px-2 mx-auto">
					<div className="mb-2 flex justify-center">
						<MapStateCluster
							viewMode={viewMode}
							mapStackOpen={mapStackOpen}
							mapStackEntryCount={mapStackEntryCount}
							mapStackVisibleCount={mapStackVisibleCount}
							contextScopeLabel={contextScopeLabel}
							focusLabel={focusLabel}
							focusKind={focusKind}
							onToggleMapStack={onToggleMapStack}
							onClearContextScope={onClearContextScope}
							onClearFocus={onClearFocus}
							compact
						/>
					</div>

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
			<div
				className="pointer-events-auto flex w-full flex-col items-stretch gap-2"
				data-tour="toolbar"
			>
				<div
					ref={toolbarContainerRef}
					className="glass-panel flex w-full items-center gap-1 overflow-x-auto rounded-lg p-1"
				>
					{/* Topic 1: navigation chrome */}
					<SidebarTrigger className="h-8 w-8" />
					<Divider />

					{/* Topic 2: file / draw / edit menus (priority-expanding) */}
					{desktopCommandMenubar}
					<Divider />

					{/* Topic 3: search + location lookup */}
					<div className="relative shrink-0">
						<form
							onSubmit={handleSearchSubmit}
							className="group relative flex h-8 w-36 shrink-0 items-center rounded-md border border-transparent transition-colors hover:bg-accent/70 focus-within:border-ring/40 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/20 2xl:w-48"
						>
							<Input
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								placeholder="Search..."
								className="h-8 border-0 bg-transparent px-2 pr-8 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
								aria-label="Search location"
							/>
							{searchQuery ? (
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label="Clear search"
									className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-md text-muted-foreground hover:text-foreground"
									onClick={clearSearch}
								>
									<X className="h-3.5 w-3.5" />
								</Button>
							) : (
								<Button
									type="submit"
									variant="ghost"
									size="icon-xs"
									aria-label="Search"
									disabled={searchLoading}
									className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-md text-muted-foreground hover:text-foreground"
								>
									{searchLoading ? (
										<RefreshCw className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Search className="h-3.5 w-3.5" />
									)}
								</Button>
							)}
						</form>
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
					{/* Location lookup (formerly the only View menu item) sits next
					    to the search box's looking-glass icon so it forms a single
					    "find / inspect" group. */}
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={handleToggleInspector}
						aria-label={inspectorActive ? 'Disable location lookup' : 'Enable location lookup'}
						title="Click map to look up location"
						className={cn(
							'h-8 w-8 shrink-0 rounded-md border border-transparent shadow-none',
							inspectorActive && 'bg-accent text-accent-foreground',
						)}
					>
						<Crosshair className="h-4 w-4" />
					</Button>
					<Divider />

					{/* Topic 4: map state cluster */}
					<MapStateCluster
						viewMode={viewMode}
						mapStackOpen={mapStackOpen}
						mapStackEntryCount={mapStackEntryCount}
						mapStackVisibleCount={mapStackVisibleCount}
						contextScopeLabel={contextScopeLabel}
						focusLabel={focusLabel}
						focusKind={focusKind}
						onToggleMapStack={onToggleMapStack}
						onClearContextScope={onClearContextScope}
						onClearFocus={onClearFocus}
						compact
						flat
					/>
					<Divider />

					{/* Topic 5: communication */}
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={onToggleChat}
						aria-label={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
						title={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
						className={cn(
							'h-8 w-8 shrink-0 rounded-md border border-transparent shadow-none',
							chatOpen && 'bg-accent text-accent-foreground',
						)}
					>
						<MessageCircle className="h-4 w-4" />
					</Button>
					<Divider />

					{/* Topic 6: data sources + share / settings. OsmImportPopover
					    moved here from inside the Draw menu — it's an import
					    operation, not a draw mode. */}
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
					<CreateMapPopover small />
					<ShareExportPopover small />
					<Popover open={showMapSettings} onOpenChange={setShowMapSettings}>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Map settings"
								title="Map settings"
								className={cn(
									'h-8 w-8 shrink-0 rounded-md border border-transparent shadow-none',
									showMapSettings && 'bg-accent text-accent-foreground',
								)}
							>
								<Settings2 className="h-4 w-4" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-[28rem]" side="bottom" align="start">
							<MapSettingsPanel mode="map-only" />
						</PopoverContent>
					</Popover>
					{showProposalPublishControl ? (
						<>
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
								small
							/>
						</>
					) : null}
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
