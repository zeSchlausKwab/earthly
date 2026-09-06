import {
	Combine,
	ArrowUpRight,
	BetweenHorizontalStart,
	Circle,
	Copy,
	CopyPlus,
	Crosshair,
	Download,
	Edit3,
	EyeOff,
	FileText,
	GitPullRequest,
	GitFork,
	Layers,
	Link2,
	LoaderCircle,
	MapPin,
	Magnet,
	MessageCircle,
	MessageSquarePlus,
	Merge,
	Minus,
	Moon,
	MoreHorizontal,
	Ruler,
	Share2,
	Map as MapIcon,
	MousePointerClick,
	MousePointer2,
	MoveHorizontal,
	Pentagon,
	PlusCircle,
	RefreshCw,
	Route,
	Shapes,
	Scan,
	Scissors,
	Search,
	Settings2,
	Sparkles,
	Split as SplitIcon,
	SquareDashedMousePointer,
	Square,
	Sun,
	Triangle,
	Diamond,
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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { createPortal } from 'react-dom'
import { useChatActivity } from '@/features/chat/activity.ts'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { canExecuteEditorCommand, executeEditorCommand, type EditorCommandId } from '../commands'
import type { EditorMode } from '../core'
import {
	canUseGeometryOperationTarget,
	derivedGeometryOperationChoices,
	splitGeometryOperationChoices,
	type GeometryOperationIcon,
} from '../geometryOperationCatalog'
import { useEditorStore } from '../store'
import type { GeoSearchResult } from '../types'
import { CreateMapPopover } from './CreateMapPopover'
import { MeasurePopover } from './MeasurePopover'
import { MapSettingsPanel } from '../../../components/optionalSurfaces.tsx'
import { ShareExportPopover } from './share/ShareExportPopover'
import {
	Divider,
	GeometryOpsDropdown,
	GeometryOperationDialog,
	IconButtonRow,
	OsmImportPopover,
	ProposalDialog,
	PublishDropdown,
	SimplifyDialog,
	type PublishAudienceOption,
	type PublishDropdownProps,
	type ToolbarButton,
	type NumericGeometryOperation,
} from './toolbar/index'
import { OSM_FILTER_PRESETS } from './toolbar/OsmImportPopover'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
	ToolPopoverAnchor,
	useToolPopoverFocusProps,
	type ToolPopoverControl,
} from './toolbar/toolPopoverControl'
import { useResponsiveToolbar } from './toolbar/useResponsiveToolbar'
import { drawModes } from './toolbar/DrawButtonGroup'
import { Input } from '@/components/ui/input'
import type { ResolvedAuthoringDestination } from './authoringDestination'

const geometryOperationIcons: Record<GeometryOperationIcon, typeof Scissors> = {
	split: Scissors,
	branch: GitFork,
	'polygon-offset': BetweenHorizontalStart,
	parallel: MoveHorizontal,
	corridor: Route,
}

interface DatasetActionsProps {
	authoringIntent?: PublishDropdownProps['authoringIntent']
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
	publishMode?: 'public' | 'private' | 'field'
}

interface ToolbarProps {
	datasetActions?: DatasetActionsProps
	/** The Margin shell has no collapsible legacy sidebar to toggle. */
	showSidebarTrigger?: boolean
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
	/** Start or cancel creation of a map callout. */
	onOpenSelectedCallout?: () => void
	selectedFeatureCount?: number
	selectedFeatureHasCallout?: boolean
	calloutComposerActive?: boolean
	calloutAnchorDrawing?: boolean
	destination?: ResolvedAuthoringDestination
	audienceOptions?: readonly PublishAudienceOption[]
	selectedAudienceId?: string
	onAudienceChange?: PublishDropdownProps['onAudienceChange']
	onActivateDestination?: () => void
	onLeaveDestination?: () => void
}

interface MapStateClusterProps {
	mapStackOpen: boolean
	mapStackEntryCount: number
	mapStackVisibleCount: number
	onToggleMapStack?: () => void
	compact?: boolean
	flat?: boolean
	hideCount?: boolean
}

function MapStateCluster({
	mapStackOpen,
	mapStackEntryCount,
	mapStackVisibleCount,
	onToggleMapStack,
	compact = false,
	flat = false,
	hideCount = false,
}: MapStateClusterProps) {
	const mapCountLabel =
		mapStackEntryCount > 0 ? `${mapStackVisibleCount}/${mapStackEntryCount}` : '0'
	const clusterClass = flat
		? 'flex min-w-0 shrink-0 items-center gap-1'
		: `flex min-w-0 items-center gap-1 rounded-md border border-border/80 bg-background/85 p-1 shadow-sm backdrop-blur ${
				compact ? 'max-w-full overflow-x-auto' : ''
			}`
	// Uniform toolbar icon-button style — matches Chat / Lookup / Settings.
	// Active state uses `bg-primary text-primary-foreground` (solid fill, high
	// contrast) so users can clearly tell at a glance which toggles are on.
	// `bg-accent` was too subtle against the glass-panel background.
	const flatToggleClass =
		'h-8 shrink-0 gap-1 rounded-md border border-transparent px-1.5 text-xs font-medium shadow-none hover:bg-accent hover:text-accent-foreground'
	const flatActiveClass =
		'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'

	return (
		<div className={clusterClass}>
			<Button
				type="button"
				variant={flat ? 'ghost' : mapStackOpen ? 'default' : 'ghost'}
				size={compact ? 'sm' : 'default'}
				className={
					flat
						? cn(flatToggleClass, mapStackOpen && flatActiveClass)
						: `h-7 shrink-0 gap-1.5 rounded-md px-2 text-xs ${
								mapStackOpen ? '' : 'text-muted-foreground hover:text-foreground'
							}`
				}
				onClick={onToggleMapStack}
				aria-label={mapStackOpen ? 'Hide On the map panel' : 'Show On the map panel'}
				title={mapStackOpen ? 'Hide On the map panel' : 'Show On the map panel'}
			>
				<Layers className="h-3.5 w-3.5" />
				<span className="sr-only">On the map</span>
				{mapStackEntryCount > 0 ? (
					<span
						className={
							hideCount
								? 'sr-only'
								: flat
									? 'font-mono text-[10px] tabular-nums'
									: 'rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums'
						}
					>
						{mapCountLabel}
					</span>
				) : null}
			</Button>
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
			aria-label={label}
			title={label}
			className={cn(
				'h-8 gap-1.5 px-2 text-sm font-medium',
				active &&
					'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
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
	showSidebarTrigger = true,
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
	onOpenSelectedCallout,
	selectedFeatureCount = 0,
	selectedFeatureHasCallout = false,
	calloutComposerActive = false,
	calloutAnchorDrawing = false,
	destination,
	audienceOptions,
	selectedAudienceId,
	onAudienceChange,
	onActivateDestination,
	onLeaveDestination,
}: ToolbarProps) {
	const editor = useEditorStore((state) => state.editor)
	const mode = useEditorStore((state) => state.mode)
	const snappingEnabled = useEditorStore((state) => state.snappingEnabled)
	const viewMode = useEditorStore((state) => state.viewMode)
	// Round E.1: stance gates which toolbar clusters render at all. Browse and
	// Focus show the lean discovery surface (File / search / view toggles);
	// the Draw + Edit clusters and import tools only exist while authoring.
	// File's "New Map" action remains the entry point into authoring.
	const stance = useEditorStore((state) => state.stance)
	const isAuthoring = stance === 'author'
	// Round D.4: edit-isolation is no longer a separate slice — it's the draft
	// stack entry's `isolated` flag. Reads + toggles route through the same
	// MapStackPanel.Focus button mechanism; the checkbox here stays as a
	// familiar surface.
	const editIsolationEnabled = useEditorStore(
		(state) => state.mapStackEntries['draft:active']?.isolated === true,
	)
	const setMapStackEntryIsolated = useEditorStore((state) => state.setMapStackEntryIsolated)
	const toggleEditIsolation = useCallback(() => {
		setMapStackEntryIsolated('draft:active', !editIsolationEnabled)
	}, [setMapStackEntryIsolated, editIsolationEnabled])
	const history = useEditorStore((state) => state.history)

	// UI State
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const setInspectorActive = useEditorStore((state) => state.setInspectorActive)
	const chatDock = useEditorStore((state) => state.chatDock)
	const chatWorking = useChatActivity().runningChatId !== null
	const compactThreadLayout = useIsMobile(1100)
	const threadToggleLabel =
		chatOpen && (chatDock === 'right' || compactThreadLayout)
			? 'Hide Thread'
			: chatOpen
				? 'Move Thread to the right'
				: chatWorking
					? `Thread is working; show it${compactThreadLayout ? '' : ' on the right'}`
					: `Show Thread${compactThreadLayout ? '' : ' on the right'}`
	const toggleChatAtDock = useEditorStore((state) => state.toggleChatAtDock)
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
	const searchPerformed = useEditorStore((state) => state.searchPerformed)
	const setSearchQuery = useEditorStore((state) => state.setSearchQuery)
	const performSearch = useEditorStore((state) => state.performSearch)
	const clearSearch = useEditorStore((state) => state.clearSearch)

	// P2.1 (report 8.1): the dropdown is shown for every post-submit state, not
	// only when results exist — so a slow, empty, or failed geocode gives
	// feedback instead of silently rendering nothing.
	const showSearchDropdown =
		searchLoading ||
		searchResults.length > 0 ||
		Boolean(searchError) ||
		(searchPerformed && searchResults.length === 0)
	const searchHasNoResults =
		searchPerformed && !searchLoading && !searchError && searchResults.length === 0
	// Keyboard navigation over the results list (ArrowUp/Down + Enter).
	const [activeResultIndex, setActiveResultIndex] = useState(-1)

	const fileInputRef = useRef<HTMLInputElement>(null)
	const [magicPopoverOpen, setMagicPopoverOpen] = useState(false)
	const [simplifyDialogOpen, setSimplifyDialogOpen] = useState(false)
	const [numericGeometryOperation, setNumericGeometryOperation] =
		useState<NumericGeometryOperation | null>(null)

	// Keep search results outside canvas clipping and anchor them to the form,
	// including when opening panels reflows the toolbar without a window resize.
	const searchFormRef = useRef<HTMLFormElement | null>(null)
	const [searchAnchorRect, setSearchAnchorRect] = useState<DOMRect | null>(null)

	// Fit individual shortcuts into the space left by the actual pinned controls.
	const {
		containerRef: toolbarContainerRef,
		menubarRef,
		spacerRef,
		measureRef,
		searchRef,
		inlineShortcuts,
		compactSearch,
		compactLabels,
		inlineCallout,
	} = useResponsiveToolbar(isAuthoring)
	const [searchOpen, setSearchOpen] = useState(false)
	const [theme, setTheme] = useTheme()
	const moreToolsRef = useRef<HTMLButtonElement>(null)
	const [activeTool, setActiveTool] = useState<'excerpt' | 'measure' | 'share' | null>(null)
	const toolControl = (tool: NonNullable<typeof activeTool>): ToolPopoverControl => ({
		anchorRef: moreToolsRef,
		open: activeTool === tool,
		onOpenChange: (open) =>
			setActiveTool((current) => (open ? tool : current === tool ? null : current)),
	})
	const osmControl: ToolPopoverControl = {
		anchorRef: moreToolsRef,
		open: magicPopoverOpen,
		onOpenChange: setMagicPopoverOpen,
	}
	const settingsControl: ToolPopoverControl = {
		anchorRef: moreToolsRef,
		open: showMapSettings,
		onOpenChange: setShowMapSettings,
	}

	const settingsFocusProps = useToolPopoverFocusProps(settingsControl)

	// Refresh the dropdown's anchor rect whenever the dropdown should be visible
	// (any post-submit state, not just results) and on resize/scroll so the
	// portal stays aligned with the form even as the layout shifts.
	useEffect(() => {
		if (!showSearchDropdown) {
			setSearchAnchorRect(null)
			return
		}
		const update = () => {
			const node = searchFormRef.current
			if (node) setSearchAnchorRect(node.getBoundingClientRect())
		}
		update()
		const observer = new ResizeObserver(update)
		if (toolbarContainerRef.current) observer.observe(toolbarContainerRef.current)
		window.addEventListener('resize', update)
		window.addEventListener('scroll', update, true)
		return () => {
			observer.disconnect()
			window.removeEventListener('resize', update)
			window.removeEventListener('scroll', update, true)
		}
	}, [showSearchDropdown, compactSearch, searchOpen])

	// Reset the keyboard highlight whenever the result set changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on result-set identity change
	useEffect(() => {
		setActiveResultIndex(-1)
	}, [searchResults])

	const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Escape') {
			clearSearch()
			return
		}
		if (!searchResults.length) return
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			setActiveResultIndex((index) => Math.min(index + 1, searchResults.length - 1))
		} else if (event.key === 'ArrowUp') {
			event.preventDefault()
			setActiveResultIndex((index) => Math.max(index - 1, 0))
		} else if (event.key === 'Enter' && activeResultIndex >= 0) {
			// A result is highlighted → select it instead of re-running the search.
			event.preventDefault()
			const result = searchResults[activeResultIndex]
			if (result) selectSearchResult(result)
		}
	}

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
	const handleArrowDrawing = () => runEditorCommand('start_arrow_drawing', { placement: 'end' })
	const handleInsertPrimitive = (
		shape: 'rectangle' | 'square' | 'circle' | 'triangle' | 'diamond',
	) => runEditorCommand('start_primitive_drawing', { shape })
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

	const selectSearchResult = (result: GeoSearchResult) => {
		onSearchResultSelect?.(result)
		setActiveResultIndex(-1)
		setSearchOpen(false)
	}

	const handleSearchSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		performSearch()
	}

	const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
		// Multi-file import: every selected file goes through the same handler;
		// each import appends (replace:false) and reports its own toast.
		const files = Array.from(e.target.files ?? [])
		if (files.length > 0 && datasetActions?.onImport) {
			for (const file of files) {
				datasetActions.onImport(file)
			}
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
	const selectedGeometry = editor?.getSelectedFeatures()[0]?.geometry.type
	const hasSingleSelection = (editor?.getSelectedFeatures().length ?? 0) === 1
	const canOperateOnLine =
		hasSingleSelection &&
		(selectedGeometry === 'LineString' || selectedGeometry === 'MultiLineString')
	const canOperateOnPolygon =
		hasSingleSelection && (selectedGeometry === 'Polygon' || selectedGeometry === 'MultiPolygon')
	const startGeometryOperation = (kind: import('../core/types').GeometryInteractionKind) =>
		runEditorCommand('start_geometry_operation', { kind })

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
			description: 'Show only geometry in the working Map',
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
		onStartGeometryOperation: startGeometryOperation,
		onOpenNumericGeometryOperation: setNumericGeometryOperation,
		canOperateOnLine,
		canOperateOnPolygon,
	}

	const canPublishFromMenu = Boolean(
		datasetActions?.canPublishNew ||
			datasetActions?.canPublishUpdate ||
			datasetActions?.canPublishCopy ||
			datasetActions?.canProposeEdit,
	)
	const publishMenuDisabled = Boolean(datasetActions?.isPublishing)
	// PR.1: the proposal composer is a dialog opened from the File menu's Publish
	// section (next to Fork), so the propose verb lives where the other publish
	// verbs do instead of in a separate toolbar control.
	const [proposalDialogOpen, setProposalDialogOpen] = useState(false)

	const drawButtons: ToolbarButton[] = [
		...selectButtons,
		...drawModes.map(({ key, icon, label }) => ({
			key,
			icon,
			ariaLabel: label,
			description: label,
			onClick: () => handleModeChange(key),
			variant: mode === key ? ('default' as const) : ('outline' as const),
			disabled: isEditingDisabled,
		})),
		{
			key: 'draw_arrow',
			icon: ArrowUpRight,
			ariaLabel: 'Draw arrow',
			description: 'Draw arrow',
			onClick: handleArrowDrawing,
			disabled: isEditingDisabled,
		},
	]
	const renderShortcut = (button: ToolbarButton) => (
		<div key={button.key} data-toolbar-shortcut={button.key} className="w-8 shrink-0">
			<IconButtonRow buttons={[button]} small />
		</div>
	)
	// Menus remain stable keyboard-accessible command catalogs. Their most-used
	// commands also become direct shortcuts, one at a time as room becomes free.
	const drawExpandedInline = (
		<>
			{drawButtons.filter((button) => inlineShortcuts.has(button.key)).map(renderShortcut)}
			{inlineShortcuts.has('draw_shape') && (
				<div data-toolbar-shortcut="draw_shape" className="w-8 shrink-0">
					<MenubarMenu>
						<MenubarTrigger asChild>
							<Button
								type="button"
								size="icon"
								variant={mode === 'draw_primitive' ? 'default' : 'outline'}
								className="h-8 w-8 rounded-none"
								disabled={isEditingDisabled}
								aria-label="Draw shape"
								title="Draw shape"
							>
								<Shapes className="h-3.5 w-3.5" />
							</Button>
						</MenubarTrigger>
						<MenubarContent align="start" className="min-w-48">
							<ToolbarMenuItem
								icon={Square}
								label="Rectangle"
								onSelect={() => handleInsertPrimitive('rectangle')}
							/>
							<ToolbarMenuItem
								icon={Square}
								label="Square"
								onSelect={() => handleInsertPrimitive('square')}
							/>
							<ToolbarMenuItem
								icon={Circle}
								label="Circle"
								onSelect={() => handleInsertPrimitive('circle')}
							/>
							<ToolbarMenuItem
								icon={Triangle}
								label="Triangle"
								onSelect={() => handleInsertPrimitive('triangle')}
							/>
							<ToolbarMenuItem
								icon={Diamond}
								label="Diamond"
								onSelect={() => handleInsertPrimitive('diamond')}
							/>
						</MenubarContent>
					</MenubarMenu>
				</div>
			)}
		</>
	)

	const editExpandedInline = (
		<>
			{[...historyButtons, ...editButtons]
				.filter((button) => inlineShortcuts.has(button.key))
				.map(renderShortcut)}
			{inlineShortcuts.has('geometry_ops') && (
				<div data-toolbar-shortcut="geometry_ops" className="w-8 shrink-0">
					<GeometryOpsDropdown {...geometryOpsProps} small />
				</div>
			)}
		</>
	)

	const desktopCommandMenubar = (
		<Menubar
			ref={menubarRef}
			className="h-8 shrink-0 gap-0.5 border-0 bg-transparent p-0 shadow-none"
		>
			<MenubarMenu>
				<ToolbarMenuTrigger icon={isEditing ? XCircle : FileText} label="File" active={isEditing} />
				<MenubarContent align="start" className="min-w-56">
					<MenubarGroup>
						<ToolbarMenuItem
							icon={isEditing ? XCircle : PlusCircle}
							label={isEditing ? 'Cancel editing' : 'New Map'}
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
								{datasetActions?.canProposeEdit ? 'Proposal' : 'Publish'}
							</MenubarLabel>
							{datasetActions?.canPublishNew && (
								<ToolbarMenuItem
									icon={UploadCloud}
									label="Publish new Map"
									onSelect={datasetActions?.onPublishNew}
									disabled={publishMenuDisabled || !datasetActions?.canPublishNew}
								/>
							)}
							{datasetActions?.canPublishUpdate && (
								<ToolbarMenuItem
									icon={RefreshCw}
									label="Update existing"
									onSelect={datasetActions?.onPublishUpdate}
									disabled={publishMenuDisabled || !datasetActions?.canPublishUpdate}
								/>
							)}
							{datasetActions?.canPublishCopy && (
								<ToolbarMenuItem
									icon={CopyPlus}
									label={datasetActions?.canPublishUpdate ? 'Publish as new map' : 'Publish map'}
									onSelect={datasetActions?.onPublishCopy}
									disabled={publishMenuDisabled || !datasetActions?.canPublishCopy}
								/>
							)}
							{datasetActions?.canProposeEdit ? (
								<ToolbarMenuItem
									icon={GitPullRequest}
									label="Send proposal…"
									onSelect={() => setProposalDialogOpen(true)}
									disabled={publishMenuDisabled}
								/>
							) : null}
						</>
					) : null}
				</MenubarContent>
			</MenubarMenu>

			{isAuthoring && (
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
							<ToolbarMenuItem
								icon={ArrowUpRight}
								label="Arrow"
								onSelect={handleArrowDrawing}
								disabled={isEditingDisabled}
							/>
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
						<MenubarSub>
							<MenubarSubTrigger className="gap-2">
								<Shapes className="h-4 w-4" />
								<span>Shapes</span>
							</MenubarSubTrigger>
							<MenubarSubContent className="min-w-48">
								<ToolbarMenuItem
									icon={Square}
									label="Rectangle"
									onSelect={() => handleInsertPrimitive('rectangle')}
								/>
								<ToolbarMenuItem
									icon={Square}
									label="Square"
									onSelect={() => handleInsertPrimitive('square')}
								/>
								<ToolbarMenuItem
									icon={Circle}
									label="Circle"
									onSelect={() => handleInsertPrimitive('circle')}
								/>
								<ToolbarMenuItem
									icon={Triangle}
									label="Triangle"
									onSelect={() => handleInsertPrimitive('triangle')}
								/>
								<ToolbarMenuItem
									icon={Diamond}
									label="Diamond"
									onSelect={() => handleInsertPrimitive('diamond')}
								/>
							</MenubarSubContent>
						</MenubarSub>
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

			{isAuthoring && drawExpandedInline}
			{isAuthoring && (
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
									label="Explode Multipart"
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
								<MenubarSub>
									<MenubarSubTrigger className="gap-2">
										<Scissors className="h-4 w-4 text-muted-foreground" />
										Cut / Split
									</MenubarSubTrigger>
									<MenubarSubContent className="min-w-64">
										{splitGeometryOperationChoices.map((choice) => (
											<ToolbarMenuItem
												key={choice.kind}
												icon={geometryOperationIcons[choice.icon]}
												label={`${choice.label} · ${choice.typeFlow}`}
												onSelect={() => startGeometryOperation(choice.kind)}
												disabled={
													!canUseGeometryOperationTarget(
														choice.target,
														canOperateOnLine,
														canOperateOnPolygon,
													)
												}
											/>
										))}
									</MenubarSubContent>
								</MenubarSub>
								<MenubarSub>
									<MenubarSubTrigger className="gap-2">
										<MoveHorizontal className="h-4 w-4 text-muted-foreground" />
										Offset / Corridor
									</MenubarSubTrigger>
									<MenubarSubContent className="min-w-64">
										{derivedGeometryOperationChoices.map((choice) => {
											const OperationIcon = geometryOperationIcons[choice.icon]
											return (
												<MenubarSub key={choice.numericKind}>
													<MenubarSubTrigger
														disabled={
															!canUseGeometryOperationTarget(
																choice.target,
																canOperateOnLine,
																canOperateOnPolygon,
															)
														}
														className="gap-2"
													>
														<OperationIcon className="h-4 w-4" /> {choice.typeFlow}
													</MenubarSubTrigger>
													<MenubarSubContent>
														<MenubarItem
															onSelect={() => setNumericGeometryOperation(choice.numericKind)}
														>
															{choice.numericMenuLabel}
														</MenubarItem>
														<MenubarItem onSelect={() => startGeometryOperation(choice.dragKind)}>
															Drag on map
														</MenubarItem>
													</MenubarSubContent>
												</MenubarSub>
											)
										})}
									</MenubarSubContent>
								</MenubarSub>
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

			{isAuthoring && editExpandedInline}
		</Menubar>
	)

	const fileInput = (
		<Input
			type="file"
			ref={fileInputRef}
			className="hidden"
			accept=".geojson,.json,.zip,.shp"
			multiple
			onChange={handleFileImport}
		/>
	)

	const searchForm = (
		<form
			ref={searchFormRef}
			onSubmit={handleSearchSubmit}
			className={cn(
				'group relative flex h-8 shrink-0 items-center rounded-md border border-transparent transition-colors hover:bg-accent/70 focus-within:border-ring/40 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/20',
				compactSearch ? 'w-full' : 'w-36',
			)}
		>
			<Input
				value={searchQuery}
				onChange={(event) => {
					setSearchQuery(event.target.value)
					setActiveResultIndex(-1)
				}}
				onKeyDown={handleSearchKeyDown}
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
	)
	const searchFeedback = showSearchDropdown ? (
		<div className="rounded-lg border border-border bg-popover p-2 shadow-lg">
			<div className="mb-2 flex items-center justify-between border-b border-border pb-2">
				<span className="text-xs font-medium text-muted-foreground">
					{searchLoading
						? 'Searching…'
						: searchError
							? 'Search error'
							: searchHasNoResults
								? 'No results'
								: 'Results'}
				</span>
				<Button variant="ghost" size="sm" className="h-auto p-0 text-xs" onClick={clearSearch}>
					Close
				</Button>
			</div>
			{searchLoading ? (
				<div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
					<RefreshCw className="h-3.5 w-3.5 animate-spin" />
					<span>Searching for “{searchQuery.trim()}”…</span>
				</div>
			) : searchError ? (
				<div className="px-1 py-2 text-sm text-destructive">{searchError}</div>
			) : searchHasNoResults ? (
				<div className="px-1 py-2 text-sm text-muted-foreground">
					No places match “{searchQuery.trim()}”.
				</div>
			) : (
				<div className="max-h-60 space-y-1 overflow-y-auto">
					{searchResults.map((result, index) => (
						<button
							type="button"
							key={result.placeId ?? `result-${index}`}
							className={cn(
								'w-full truncate rounded p-1.5 text-left text-sm hover:bg-muted/50',
								index === activeResultIndex && 'bg-muted',
							)}
							onClick={() => selectSearchResult(result)}
						>
							{result.displayName}
						</button>
					))}
				</div>
			)}
		</div>
	) : null

	const moreTools = (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button
					ref={moreToolsRef}
					variant="ghost"
					size="sm"
					aria-label="More tools"
					title="More tools"
					className={cn('h-8 shrink-0 gap-1.5 px-2', compactLabels && 'w-8 px-0')}
				>
					<MoreHorizontal className="h-4 w-4" />
					{!compactLabels && <span>More</span>}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-64"
				onCloseAutoFocus={(event) => {
					// The selected tool takes focus; closing this menu must not steal it back.
					if (activeTool || magicPopoverOpen || showMapSettings) event.preventDefault()
				}}
			>
				<DropdownMenuLabel>On the map</DropdownMenuLabel>
				<DropdownMenuItem onSelect={handleToggleInspector}>
					<Crosshair className="h-4 w-4" />
					{inspectorActive ? 'Stop location lookup' : 'Look up a location'}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => setActiveTool('measure')}>
					<Ruler className="h-4 w-4" />
					Measure
				</DropdownMenuItem>
				{isAuthoring && (
					<DropdownMenuItem onSelect={onOpenSelectedCallout}>
						<MessageSquarePlus className="h-4 w-4" />
						{calloutComposerActive || calloutAnchorDrawing
							? 'Cancel map callout'
							: 'Add map callout'}
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Data and sharing</DropdownMenuLabel>
				{isAuthoring && (
					<DropdownMenuItem onSelect={() => setMagicPopoverOpen(true)}>
						<Sparkles className="h-4 w-4" />
						Import from OpenStreetMap
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onSelect={() => setActiveTool('excerpt')}>
					<MapIcon className="h-4 w-4" />
					Create map excerpt
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => setActiveTool('share')}>
					<Share2 className="h-4 w-4" />
					Share and export image
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Appearance</DropdownMenuLabel>
				<DropdownMenuItem onSelect={() => setShowMapSettings(true)}>
					<Settings2 className="h-4 w-4" />
					Map settings
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
					{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
					{theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)

	// One row against the actual canvas width. Secondary tools share a stable
	// overflow launcher; their popovers stay mounted while panels are resized.
	return (
		<>
			<div
				className="pointer-events-auto flex w-full flex-col items-stretch gap-2"
				data-tour="toolbar"
			>
				<div
					ref={toolbarContainerRef}
					className="flex w-full min-w-0 flex-nowrap items-center gap-1 p-0"
				>
					{showSidebarTrigger ? (
						<>
							{/* Topic 1: optional legacy sidebar trigger. */}
							<SidebarTrigger className="h-8 w-8" />
							<Divider />
						</>
					) : null}

					{/* Topic 2: map-stack toggle (the chat/right-sidebar toggle now lives
					    at the far right of the bar — see Topic 7 — mirroring the left
					    sidebar trigger on the far left). */}
					<MapStateCluster
						mapStackOpen={mapStackOpen}
						mapStackEntryCount={mapStackEntryCount}
						mapStackVisibleCount={mapStackVisibleCount}
						onToggleMapStack={onToggleMapStack}
						compact
						flat
						hideCount={compactLabels}
					/>
					<Divider />

					{/* Topic 5: file / draw / edit menus (priority-expanding) */}
					{desktopCommandMenubar}
					{isAuthoring && inlineCallout ? (
						<div data-toolbar-shortcut="callout" className="w-8 shrink-0">
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant={
												calloutComposerActive || calloutAnchorDrawing ? 'default' : 'outline'
											}
											size="icon-sm"
											onClick={onOpenSelectedCallout}
											aria-label={
												calloutAnchorDrawing
													? 'Cancel callout anchor'
													: calloutComposerActive
														? 'Cancel new map callout'
														: selectedFeatureHasCallout
															? 'Add another map callout'
															: 'Add map callout'
											}
											className="h-8 w-8 shrink-0 rounded-none"
										>
											<MessageSquarePlus className="h-3.5 w-3.5" />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="bottom" sideOffset={8}>
										<p>
											{calloutAnchorDrawing
												? 'Cancel callout anchor'
												: calloutComposerActive
													? 'Cancel new map callout'
													: selectedFeatureCount === 0
														? 'Draw a point anchor and add a map callout'
														: selectedFeatureCount > 1
															? 'Select a single geometry to add a map callout'
															: selectedFeatureHasCallout
																? 'Add another map callout'
																: 'Add map callout'}
										</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						</div>
					) : null}

					{/* Grow-spacer: once the priority-expanding menus can't grow any
					    further, this invisible element takes the slack and pushes the
					    search bar + right cluster to the right edge. */}
					<div ref={spacerRef} className="min-w-0 flex-1" aria-hidden="true" />

					<Divider />

					<div ref={searchRef} className={cn('shrink-0', compactSearch ? 'w-8' : 'w-36')}>
						{compactSearch ? (
							<Popover open={searchOpen} onOpenChange={setSearchOpen}>
								<PopoverTrigger asChild>
									<Button
										variant="ghost"
										size="icon-sm"
										className="h-8 w-8 shrink-0"
										aria-label="Search location"
										title="Search location"
									>
										<Search className="h-4 w-4" />
									</Button>
								</PopoverTrigger>
								<PopoverContent aria-label="Search location" align="end" className="w-80 gap-2">
									{searchForm}
									{searchFeedback}
								</PopoverContent>
							</Popover>
						) : (
							<>
								{searchForm}
								{showSearchDropdown &&
									searchAnchorRect &&
									typeof document !== 'undefined' &&
									createPortal(
										<div
											className="fixed z-50 w-72"
											style={{
												top: searchAnchorRect.bottom + 8,
												left: Math.min(searchAnchorRect.left, window.innerWidth - 300),
											}}
										>
											{searchFeedback}
										</div>,
										document.body,
									)}
							</>
						)}
					</div>
					{moreTools}
					{/* Workflow audit P2: publishing is the completion of the core
					    workflow, so the primary Publish action stays persistently
					    visible beside the editing controls whenever a publish verb is
					    available — the File menu keeps the full verb list alongside
					    import/export. */}
					{datasetActions && (canPublishFromMenu || destination) ? (
						<PublishDropdown
							small={compactLabels}
							authoringIntent={datasetActions.authoringIntent}
							canPublishNew={datasetActions.canPublishNew}
							canPublishUpdate={datasetActions.canPublishUpdate}
							canPublishCopy={datasetActions.canPublishCopy}
							canProposeEdit={datasetActions.canProposeEdit}
							isPublishing={datasetActions.isPublishing}
							onPublishNew={datasetActions.onPublishNew}
							onPublishUpdate={datasetActions.onPublishUpdate}
							onPublishCopy={datasetActions.onPublishCopy}
							onProposeEdit={datasetActions.onProposeEdit}
							publishMode={datasetActions.publishMode}
							publishingScope={destination}
							audienceOptions={audienceOptions}
							selectedAudienceId={selectedAudienceId}
							onAudienceChange={onAudienceChange}
							onOpenPublishingScope={onActivateDestination}
							onLeavePublishingScope={onLeaveDestination}
						/>
					) : null}
					{/* Thread and publishing stay pinned; neither is put in overflow. */}
					<Divider />
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={() => (onToggleChat ? onToggleChat() : toggleChatAtDock('right'))}
						data-tour="sidebar-chat"
						aria-label={threadToggleLabel}
						title={threadToggleLabel}
						className={cn(
							'h-8 w-8 shrink-0 rounded-md border border-transparent shadow-none',
							chatOpen &&
								(chatDock === 'right' || compactThreadLayout) &&
								'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
						)}
					>
						{chatWorking ? (
							<LoaderCircle className="h-4 w-4 animate-spin" />
						) : (
							<MessageCircle className="h-4 w-4" />
						)}
					</Button>
				</div>
				{/* Inert sizing probes use the same rem-based dimensions as the real
				    shortcuts/search; no duplicate controls or popovers are mounted. */}
				<div
					ref={measureRef}
					aria-hidden="true"
					className="pointer-events-none invisible absolute left-0 top-0 flex h-0 overflow-hidden"
				>
					<span className="w-8 shrink-0" />
					<span className="w-36 shrink-0" />
				</div>

				{fileInput}
				{/* P2.1: search errors now surface in the portaled dropdown (desktop)
				    and the mobile search panel, so the old toolbar-level error banner
				    here was removed to avoid a duplicate message. */}
			</div>

			{isAuthoring && (
				<OsmImportPopover
					control={osmControl}
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
			)}
			<CreateMapPopover control={toolControl('excerpt')} small />
			<MeasurePopover control={toolControl('measure')} />
			<ShareExportPopover control={toolControl('share')} small />
			<Popover open={showMapSettings} onOpenChange={setShowMapSettings}>
				<ToolPopoverAnchor anchorRef={moreToolsRef} />
				<PopoverContent
					aria-label="Map settings"
					className="w-[28rem] max-w-[calc(100vw-2rem)]"
					side="bottom"
					align="end"
					{...settingsFocusProps}
				>
					<MapSettingsPanel mode="map-only" />
				</PopoverContent>
			</Popover>
			<SimplifyDialog open={simplifyDialogOpen} onOpenChange={setSimplifyDialogOpen} />
			<GeometryOperationDialog
				operation={numericGeometryOperation}
				open={numericGeometryOperation !== null}
				onOpenChange={(open) => {
					if (!open) setNumericGeometryOperation(null)
				}}
			/>
			<ProposalDialog
				open={proposalDialogOpen}
				onOpenChange={setProposalDialogOpen}
				isPublishing={datasetActions?.isPublishing}
				onSubmit={(description) => datasetActions?.onProposeEdit?.(description)}
			/>
		</>
	)
}
