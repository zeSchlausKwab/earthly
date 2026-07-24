import {
	Combine,
	ArrowUpRight,
	Circle,
	Copy,
	CopyPlus,
	Crosshair,
	Download,
	Edit3,
	EyeOff,
	FileText,
	GitPullRequest,
	Layers,
	Link2,
	MapPin,
	Magnet,
	MessageCircle,
	Merge,
	Minus,
	Moon,
	MousePointerClick,
	MousePointer2,
	Pentagon,
	PlusCircle,
	RefreshCw,
	Route,
	Shapes,
	Scan,
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
import { createPortal } from 'react-dom'
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
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { canExecuteEditorCommand, executeEditorCommand, type EditorCommandId } from '../commands'
import type { EditorMode } from '../core'
import { useEditorStore } from '../store'
import type { GeoSearchResult } from '../types'
import { CreateMapPopover } from './CreateMapPopover'
import { MeasurePopover } from './MeasurePopover'
import { MapSettingsPanel } from './MapSettingsPanel'
import { ShareExportPopover } from './share/ShareExportPopover'
import {
	Divider,
	DrawButtonGroup,
	FileDropdown,
	GeometryOpsDropdown,
	IconButtonRow,
	OsmImportPopover,
	ProposalDialog,
	PublishDropdown,
	SessionButton,
	SimplifyDialog,
	type ToolbarButton,
} from './toolbar/index'
import { OSM_FILTER_PRESETS } from './toolbar/OsmImportPopover'
import { useResponsiveToolbar } from './toolbar/useResponsiveToolbar'
import { Input } from '@/components/ui/input'
import { CurrentDestinationPill } from './CurrentDestinationPill'
import type { ResolvedAuthoringDestination } from './authoringDestination'

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
	publishMode?: 'public' | 'private' | 'field'
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
	/** E.3: exits the Focus stance — wired to the interactive stance pill. */
	onExitFocus?: () => void
	destination?: ResolvedAuthoringDestination
	onActivateDestination?: () => void
	onLeaveDestination?: () => void
}

interface MapStateClusterProps {
	viewMode: 'edit' | 'view'
	mapStackOpen: boolean
	mapStackEntryCount: number
	mapStackVisibleCount: number
	onToggleMapStack?: () => void
	/**
	 * Round E.3: when provided and the stance is `focus`, the stance pill
	 * becomes a button that exits back to Browse (or Author when a draft is
	 * active — `exitViewMode` decides).
	 */
	onExitFocus?: () => void
	compact?: boolean
	flat?: boolean
	/**
	 * Which part(s) of the cluster to render. The desktop toolbar uses this to
	 * place the map-stack toggle and the stance pill in different positions:
	 *   - 'toggle'  → just the map-stack Layers button + count
	 *   - 'stance'  → just the stance pill
	 *   - 'all'     → full cluster (default, used by mobile)
	 *
	 * Round C: the focused-entity and context-scope chips that used to live
	 * here are removed — the MapStackPanel's per-row "Isolated" indicator and
	 * its "Isolating: <name>" header subtitle now play that role, and they
	 * stay coherent with the stack/visibility model. The toolbar surface is
	 * lighter as a result.
	 */
	parts?: 'all' | 'toggle' | 'stance'
}

function MapStateCluster({
	viewMode: _viewMode,
	mapStackOpen,
	mapStackEntryCount,
	mapStackVisibleCount,
	onToggleMapStack,
	onExitFocus,
	compact = false,
	flat = false,
	parts = 'all',
}: MapStateClusterProps) {
	const renderToggle = parts === 'all' || parts === 'toggle'
	const renderStance = parts === 'all' || parts === 'stance'
	// Stance is the source of truth (replaces the previously-derived label
	// that combined viewMode + focusLabel). Transitions live at the explicit
	// trigger sites — see stanceSlice for the model.
	const stance = useEditorStore((state) => state.stance)
	// Stance labels kept as-is (vocabulary change deferred). Colors follow the
	// DS palette — amber = active/selection (focus), violet = edit/draft
	// (author), muted neutral = browse.
	const stanceLabel = stance === 'author' ? 'Edit' : stance === 'focus' ? 'Inspect' : 'Browse'
	const stanceClass = flat
		? stance === 'author'
			? 'text-edit'
			: stance === 'focus'
				? 'text-primary'
				: 'text-muted-foreground'
		: stance === 'author'
			? 'border-edit/40 bg-edit/10 text-edit'
			: stance === 'focus'
				? 'border-primary/40 bg-primary/10 text-primary'
				: 'border-border bg-muted/40 text-muted-foreground'
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
			{renderToggle ? (
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
					aria-label={mapStackOpen ? 'Hide map stack' : 'Show map stack'}
					title={mapStackOpen ? 'Hide map stack' : 'Show map stack'}
				>
					<Layers className="h-3.5 w-3.5" />
					<span className="sr-only">Map stack</span>
					{mapStackEntryCount > 0 ? (
						<span
							className={
								flat
									? 'font-mono text-[10px] tabular-nums'
									: 'rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums'
							}
						>
							{mapCountLabel}
						</span>
					) : null}
				</Button>
			) : null}
			{/* Stance pill — compact in flat mode: tight padding + extra-small text.
			    In the Focus stance the pill is interactive (E.3): clicking it exits
			    inspection back to Browse/Author. */}
			{renderStance ? (
				stance === 'focus' && onExitFocus ? (
					<button
						type="button"
						onClick={onExitFocus}
						className={
							flat
								? `inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-transparent px-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors hover:bg-primary/15 ${stanceClass}`
								: `inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px] font-semibold uppercase transition-colors hover:bg-primary/15 ${stanceClass}`
						}
						title="Exit inspection"
						aria-label="Exit inspection"
					>
						{stanceLabel}
						<X className="h-3 w-3" />
					</button>
				) : (
					<span
						className={
							flat
								? `inline-flex h-8 shrink-0 items-center rounded-md border border-transparent px-1.5 text-[11px] font-semibold uppercase tracking-wide ${stanceClass}`
								: `inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-[11px] font-semibold uppercase ${stanceClass}`
						}
						title={`Current stance: ${stanceLabel}`}
					>
						{stanceLabel}
					</span>
				)
			) : null}
		</div>
	)
}

/**
 * Dark/light theme toggle. The active theme is the `light`/`dark` class on
 * `<html>` (see `@/lib/theme`); flipping it re-themes the whole app and the
 * map basemap. Light is the default working theme.
 */
function ThemeToggleButton() {
	const [theme, setTheme] = useTheme()
	const isDark = theme === 'dark'
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
			title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
			className="h-8 w-8 shrink-0 rounded-md border border-transparent text-muted-foreground shadow-none hover:text-foreground"
			onClick={() => setTheme(isDark ? 'light' : 'dark')}
		>
			{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
		</Button>
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
	onExitFocus,
	destination,
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
	// File's "New dataset" and the mobile SessionButton remain the entry
	// points into the Author stance.
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

	// Search results dropdown needs to escape the toolbar's `overflow-x-auto`
	// wrapper (CSS forces overflow-y: auto whenever overflow-x: auto, which
	// otherwise clips the dropdown below the bar). We portal to body and
	// position via the form's bounding rect.
	const searchFormRef = useRef<HTMLFormElement | null>(null)
	const [searchAnchorRect, setSearchAnchorRect] = useState<DOMRect | null>(null)

	// Responsive toolbar — measures available width and decides which priority
	// menus (Draw → Edit → View) expand inline vs stay as MenubarMenu dropdowns.
	const { containerRef: toolbarContainerRef, expanded: expandedMenus } = useResponsiveToolbar()

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
		window.addEventListener('resize', update)
		window.addEventListener('scroll', update, true)
		return () => {
			window.removeEventListener('resize', update)
			window.removeEventListener('scroll', update, true)
		}
	}, [showSearchDropdown])

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
			if (result) onSearchResultSelect?.(result)
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
			datasetActions?.canPublishCopy ||
			datasetActions?.canProposeEdit,
	)
	const publishMenuDisabled = Boolean(datasetActions?.isPublishing)
	// PR.1: the proposal composer is a dialog opened from the File menu's Publish
	// section (next to Fork), so the propose verb lives where the other publish
	// verbs do instead of in a separate toolbar control.
	const [proposalDialogOpen, setProposalDialogOpen] = useState(false)

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
				onArrowDraw={handleArrowDrawing}
				disabled={isEditingDisabled}
				small
			/>
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
							{datasetActions?.canProposeEdit ? (
								<ToolbarMenuItem
									icon={GitPullRequest}
									label="Propose edit to owner…"
									onSelect={() => setProposalDialogOpen(true)}
									disabled={publishMenuDisabled}
								/>
							) : null}
						</>
					) : null}
				</MenubarContent>
			</MenubarMenu>

			{!isAuthoring ? null : expandedMenus.has('draw') ? (
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

			{!isAuthoring ? null : expandedMenus.has('edit') ? (
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
			multiple
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
							onToggleMapStack={onToggleMapStack}
							onExitFocus={onExitFocus}
							compact
						/>
					</div>

					{mobileToolsOpen && (
						<div className="glass-panel rounded-lg p-1.5">
							{/* Row 1: Session + (when authoring) Select + Draw.
							    E.1: SessionButton is the stance entry point and always
							    renders; the draw/edit tools only exist in Author. */}
							<div className="flex items-center justify-center gap-1 flex-wrap mb-1">
								<SessionButton
									viewMode={viewMode}
									onStartNew={onStartNewDataset}
									onCancel={onCancelEditing}
									small
								/>
								{isAuthoring ? (
									<>
										<Divider />
										<IconButtonRow buttons={selectButtons} small />
										<Divider />
										<DrawButtonGroup
											mode={mode}
											onModeChange={handleModeChange}
											onArrowDraw={handleArrowDrawing}
											disabled={isEditingDisabled}
											small
										/>
									</>
								) : null}
							</div>
							{/* Row 2: History + Edit tools + Geometry ops — Author only. */}
							{isAuthoring ? (
								<div className="flex items-center justify-center gap-1 flex-wrap">
									<IconButtonRow buttons={historyButtons} small />
									<Divider />
									<IconButtonRow buttons={editButtons} small />
									<GeometryOpsDropdown {...geometryOpsProps} small />
								</div>
							) : null}
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
									{searchResults.map((result, index) => (
										<Button
											type="button"
											key={result.placeId ?? `result-${index}`}
											variant="ghost"
											className="w-full text-left text-sm p-2 hover:bg-muted/50 border-b border-border last:border-0 truncate"
											onClick={() => onSearchResultSelect?.(result)}
										>
											{result.displayName}
										</Button>
									))}
								</div>
							)}
							{/* P2.1: explicit non-result states so a slow/empty/failed
							    geocode gives feedback on mobile too (report 8.1). */}
							{searchLoading && (
								<div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
									<RefreshCw className="h-3 w-3 animate-spin" />
									<span>Searching…</span>
								</div>
							)}
							{searchHasNoResults && (
								<div className="px-1 text-xs text-muted-foreground">
									No places match “{searchQuery.trim()}”.
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
								{isAuthoring ? (
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
								) : null}
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
									publishMode={datasetActions.publishMode}
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
					className="flex w-full items-center gap-1 overflow-x-auto p-0"
				>
					{/* Topic 1: sidebar trigger (left-most chrome). */}
					<SidebarTrigger className="h-8 w-8" />
					<Divider />

					{/* Topic 2: map-stack toggle (the chat/right-sidebar toggle now lives
					    at the far right of the bar — see Topic 7 — mirroring the left
					    sidebar trigger on the far left). */}
					<MapStateCluster
						viewMode={viewMode}
						mapStackOpen={mapStackOpen}
						mapStackEntryCount={mapStackEntryCount}
						mapStackVisibleCount={mapStackVisibleCount}
						onToggleMapStack={onToggleMapStack}
						compact
						flat
						parts="toggle"
					/>
					<Divider />

					{/* Topic 3: stance indicator. The previously-shown context-scope and
					    focus chips were removed in Round C: the MapStackPanel's per-row
					    "Isolated" pill + header "Isolating: <name>" subtitle now play
					    that role and stay coherent with the stack/visibility model. */}
					<MapStateCluster
						viewMode={viewMode}
						mapStackOpen={mapStackOpen}
						mapStackEntryCount={mapStackEntryCount}
						mapStackVisibleCount={mapStackVisibleCount}
						onExitFocus={onExitFocus}
						compact
						flat
						parts="stance"
					/>
					<Divider />

					{/* Topic 4: one truthful authoring destination. This is distinct
					    from Browse / Inspect / Edit stance and from Map Stack isolation. */}
					{destination ? (
						<>
							<CurrentDestinationPill
								destination={destination}
								onActivate={onActivateDestination}
								onLeave={onLeaveDestination}
							/>
							<Divider />
						</>
					) : null}

					{/* Topic 5: file / draw / edit menus (priority-expanding) */}
					{desktopCommandMenubar}

					{/* Grow-spacer: once the priority-expanding menus can't grow any
					    further, this invisible element takes the slack and pushes the
					    search bar + right cluster to the right edge. */}
					<div className="min-w-0 flex-1" aria-hidden="true" />

					<Divider />

					{/* Topic 5: search + location lookup */}
					<div className="relative shrink-0">
						<form
							ref={searchFormRef}
							onSubmit={handleSearchSubmit}
							className="group relative flex h-8 w-36 shrink-0 items-center rounded-md border border-transparent transition-colors hover:bg-accent/70 focus-within:border-ring/40 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/20 2xl:w-48"
						>
							<Input
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
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
						{/* Search results — portaled to body so the toolbar's
						    `overflow-x-auto` wrapper can't clip the dropdown. P2.1:
						    shown for every post-submit state (loading / results /
						    no-results / error) so the geocode never fails silently. */}
						{showSearchDropdown &&
							searchAnchorRect &&
							typeof document !== 'undefined' &&
							createPortal(
								<div
									className="fixed z-50 w-72 rounded-lg border border-border bg-popover p-2 shadow-lg"
									style={{
										top: searchAnchorRect.bottom + 8,
										left: searchAnchorRect.left,
									}}
								>
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
										<Button
											variant="ghost"
											size="sm"
											className="h-auto p-0 text-xs"
											onClick={clearSearch}
										>
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
													onClick={() => onSearchResultSelect?.(result)}
												>
													{result.displayName}
												</button>
											))}
										</div>
									)}
								</div>,
								document.body,
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
							inspectorActive &&
								'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
						)}
					>
						<Crosshair className="h-4 w-4" />
					</Button>
					<Divider />

					{/* Topic 6: data sources + share / settings. OsmImportPopover
					    moved here from inside the Draw menu — it's an import
					    operation, not a draw mode. E.1: import only exists while
					    authoring (it pulls features into the active draft). */}
					{isAuthoring ? (
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
					) : null}
					<CreateMapPopover small />
					<MeasurePopover />
					<ShareExportPopover small />
					<ThemeToggleButton />
					<Popover open={showMapSettings} onOpenChange={setShowMapSettings}>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Map settings"
								title="Map settings"
								className={cn(
									'h-8 w-8 shrink-0 rounded-md border border-transparent shadow-none',
									showMapSettings &&
										'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
								)}
							>
								<Settings2 className="h-4 w-4" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-[28rem]" side="bottom" align="start">
							<MapSettingsPanel mode="map-only" />
						</PopoverContent>
					</Popover>
					{/* Workflow audit P2: publishing is the completion of the core
					    workflow, so the primary Publish action stays persistently
					    visible beside the editing controls whenever a publish verb is
					    available — the File menu keeps the full verb list alongside
					    import/export. */}
					{datasetActions && canPublishFromMenu ? (
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
							publishMode={datasetActions.publishMode}
						/>
					) : null}
					{/* Topic 7: chat / right-sidebar toggle — pinned to the FAR RIGHT,
				    mirroring the far-left sidebar trigger, with a separator to its
				    left signalling that it opens the right sidebar. */}
					<Divider />
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={onToggleChat}
						data-tour="sidebar-chat"
						aria-label={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
						title={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
						className={cn(
							'h-8 w-8 shrink-0 rounded-md border border-transparent shadow-none',
							chatOpen &&
								'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
						)}
					>
						<MessageCircle className="h-4 w-4" />
					</Button>
				</div>

				{fileInput}
				{/* P2.1: search errors now surface in the portaled dropdown (desktop)
				    and the mobile search panel, so the old toolbar-level error banner
				    here was removed to avoid a duplicate message. */}
			</div>
			<SimplifyDialog open={simplifyDialogOpen} onOpenChange={setSimplifyDialogOpen} />
			<ProposalDialog
				open={proposalDialogOpen}
				onOpenChange={setProposalDialogOpen}
				isPublishing={datasetActions?.isPublishing}
				onSubmit={(description) => datasetActions?.onProposeEdit?.(description)}
			/>
		</>
	)
}
