import {
	CopyPlus,
	Crosshair,
	Download,
	Edit3,
	FilePenLine,
	Layers,
	Magnet,
	Map as MapIcon,
	MapPin,
	Merge,
	MousePointer2,
	Pentagon,
	Redo2,
	RefreshCw,
	Route,
	Search,
	Split as SplitIcon,
	Trash2,
	Undo2,
	Upload,
	UploadCloud,
	X
} from 'lucide-react';
import type React from 'react';
import { useRef } from 'react';
import { LoginSessionButtons } from '../../../components/LoginSessionButtom';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import type { EditorMode } from '../core';
import { useEditorStore } from '../store';
import type { GeoSearchResult } from '../types';
import { MapSettingsPanel } from './MapSettingsPanel';

type ToolbarButton = {
	key: string;
	icon: React.ComponentType<any>;
	onClick: () => void;
	disabled?: boolean;
	variant?: 'default' | 'outline';
	ariaLabel: string;
};

type IconButtonRowProps = {
	buttons: ToolbarButton[];
	className?: string;
	wrap?: boolean;
};

type SearchBarProps = {
	searchQuery: string;
	searchLoading: boolean;
	placeholder: string;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
	onQueryChange?: (value: string) => void;
	onClearQuery?: () => void;
	className?: string;
};

function IconButtonRow({ buttons, className = '', wrap = false }: IconButtonRowProps) {
	return (
		<div className={`flex items-center gap-1 ${wrap ? 'flex-wrap' : ''} ${className}`}>
			{buttons.map(({ key, icon: Icon, variant = 'outline', disabled, onClick, ariaLabel }) => (
				<Button key={key} size="icon" variant={variant} disabled={disabled} aria-label={ariaLabel} onClick={onClick}>
					<Icon className="h-4 w-4" />
				</Button>
			))}
		</div>
	);
}

function SearchBar({
	searchQuery,
	searchLoading,
	placeholder,
	onSubmit,
	onQueryChange,
	onClearQuery,
	className = ''
}: SearchBarProps) {
	return (
		<form onSubmit={onSubmit} className={`flex items-center gap-2 ${className}`}>
			<div className="relative flex-1">
				<Input
					value={searchQuery}
					onChange={(event) => onQueryChange?.(event.target.value)}
					placeholder={placeholder}
					className="pr-9"
				/>
				{searchQuery && (
					<button
						type="button"
						aria-label="Clear search"
						className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-500 hover:text-gray-800"
						onClick={() => onClearQuery?.()}
					>
						<X className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
			<Button type="submit" size="icon" variant="default" aria-label="Search location" disabled={searchLoading}>
				{searchLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
			</Button>
		</form>
	);
}

interface DatasetActionsProps {
	onExport?: () => void;
	canExport?: boolean;
	onImport?: (file: File) => void;
	onClear?: () => void;
	canClear?: boolean;
	onPublishNew?: () => void;
	canPublishNew?: boolean;
	onPublishUpdate?: () => void;
	canPublishUpdate?: boolean;
	onPublishCopy?: () => void;
	canPublishCopy?: boolean;
	isPublishing?: boolean;
}

interface ToolbarProps {
	datasetActions?: DatasetActionsProps;
	isMobile?: boolean;
	showLogin?: boolean;
	onSearchResultSelect?: (result: GeoSearchResult) => void;
	onInspectorDeactivate?: () => void;
}

export function Toolbar({
	datasetActions,
	isMobile = false,
	showLogin = true,
	onSearchResultSelect,
	onInspectorDeactivate
}: ToolbarProps) {
	const editor = useEditorStore((state) => state.editor);
	const mode = useEditorStore((state) => state.mode);
	const setMode = useEditorStore((state) => state.setMode);
	const snappingEnabled = useEditorStore((state) => state.snappingEnabled);
	const setSnappingEnabled = useEditorStore((state) => state.setSnappingEnabled);
	const history = useEditorStore((state) => state.history);
	const setHistoryState = useEditorStore((state) => state.setHistoryState);

	// UI State
	const showTips = useEditorStore((state) => state.showTips);
	const setShowTips = useEditorStore((state) => state.setShowTips);
	const showDatasetsPanel = useEditorStore((state) => state.showDatasetsPanel);
	const setShowDatasetsPanel = useEditorStore((state) => state.setShowDatasetsPanel);
	const showInfoPanel = useEditorStore((state) => state.showInfoPanel);
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel);
	const setMobileActiveState = useEditorStore((state) => state.setMobileActiveState);
	const mobileDatasetsOpen = useEditorStore((state) => state.mobileDatasetsOpen);
	const mobileInfoOpen = useEditorStore((state) => state.mobileInfoOpen);
	const mobileToolsOpen = useEditorStore((state) => state.mobileToolsOpen);
	const mobileSearchOpen = useEditorStore((state) => state.mobileSearchOpen);
	const mobileActionsOpen = useEditorStore((state) => state.mobileActionsOpen);
	const inspectorActive = useEditorStore((state) => state.inspectorActive);
	const setInspectorActive = useEditorStore((state) => state.setInspectorActive);
	const showMapSettings = useEditorStore((state) => state.showMapSettings);
	const setShowMapSettings = useEditorStore((state) => state.setShowMapSettings);

	// Search State
	const searchQuery = useEditorStore((state) => state.searchQuery);
	const searchResults = useEditorStore((state) => state.searchResults);
	const searchLoading = useEditorStore((state) => state.searchLoading);
	const searchError = useEditorStore((state) => state.searchError);
	const setSearchQuery = useEditorStore((state) => state.setSearchQuery);
	const performSearch = useEditorStore((state) => state.performSearch);
	const clearSearch = useEditorStore((state) => state.clearSearch);

	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleModeChange = (newMode: EditorMode) => {
		setMode(newMode);
		if (inspectorActive) {
			setInspectorActive(false);
			onInspectorDeactivate?.();
		}
	};

	const handleUndo = () => {
		editor?.undo();
		setHistoryState(editor?.history.canUndo() ?? false, editor?.history.canRedo() ?? false);
	};

	const handleRedo = () => {
		editor?.redo();
		setHistoryState(editor?.history.canUndo() ?? false, editor?.history.canRedo() ?? false);
	};

	const handleToggleSnapping = () => {
		setSnappingEnabled(!snappingEnabled);
	};

	const handleToggleDatasets = () => {
		if (isMobile) {
			setMobileActiveState(mobileDatasetsOpen ? null : 'datasets');
		} else {
			setShowDatasetsPanel(!showDatasetsPanel);
		}
	};

	const handleToggleInfo = () => {
		if (isMobile) {
			setMobileActiveState(mobileInfoOpen ? null : 'info');
		} else {
			setShowInfoPanel(!showInfoPanel);
		}
	};

	const handleToggleTips = () => {
		setShowTips((prev) => !prev);
	};

	const handleToggleInspector = () => {
		if (inspectorActive) {
			setInspectorActive(false);
			onInspectorDeactivate?.();
		} else {
			setInspectorActive(true);
			if (mode !== 'select') {
				setMode('select');
			}
		}
	};

	const handleToggleMapSettings = () => {
		setShowMapSettings(!showMapSettings);
	};

	const handleSearchSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		performSearch();
	};

	const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file && datasetActions?.onImport) {
			datasetActions.onImport(file);
		}
		if (fileInputRef.current) {
			fileInputRef.current.value = '';
		}
	};

	const handleDeleteSelected = () => {
		const selected = editor?.getSelectedFeatures();
		if (selected && selected.length > 0) {
			editor?.deleteFeatures(selected.map((f) => f.id));
		}
	};

	const handleMergeSelected = () => {
		editor?.combineSelectedFeatures();
	};

	const handleSplitSelected = () => {
		editor?.splitSelectedFeatures();
	};

	const datasetsOpen = isMobile ? mobileDatasetsOpen : showDatasetsPanel;
	const infoPanelOpen = isMobile ? mobileInfoOpen : showInfoPanel;

	// Desktop Toolbar Configuration
	const desktopButtons: ToolbarButton[] = [
		// 1. Select
		{
			key: 'select',
			icon: MousePointer2,
			onClick: () => handleModeChange('select'),
			variant: mode === 'select' ? 'default' : 'outline',
			ariaLabel: 'Select mode'
		},
		// 2. Draw: point, line, polygon
		{
			key: 'point',
			icon: MapPin,
			onClick: () => handleModeChange('draw_point'),
			variant: mode === 'draw_point' ? 'default' : 'outline',
			ariaLabel: 'Draw point'
		},
		{
			key: 'line',
			icon: Route,
			onClick: () => handleModeChange('draw_linestring'),
			variant: mode === 'draw_linestring' ? 'default' : 'outline',
			ariaLabel: 'Draw line'
		},
		{
			key: 'polygon',
			icon: Pentagon,
			onClick: () => handleModeChange('draw_polygon'),
			variant: mode === 'draw_polygon' ? 'default' : 'outline',
			ariaLabel: 'Draw polygon'
		},
		// 3. Undo/Redo
		{
			key: 'undo',
			icon: Undo2,
			onClick: handleUndo,
			disabled: !history.canUndo,
			ariaLabel: 'Undo'
		},
		{
			key: 'redo',
			icon: Redo2,
			onClick: handleRedo,
			disabled: !history.canRedo,
			ariaLabel: 'Redo'
		},
		// Snap Toggle
		{
			key: 'snapping',
			icon: Magnet,
			onClick: handleToggleSnapping,
			variant: snappingEnabled ? 'default' : 'outline',
			ariaLabel: 'Toggle snapping'
		},
		// 4. Edit toggle (Vertex Editing)
		{
			key: 'edit',
			icon: Edit3,
			onClick: () => handleModeChange('edit'),
			variant: mode === 'edit' ? 'default' : 'outline',
			ariaLabel: 'Edit mode'
		},
		// 4. Delete
		{
			key: 'delete',
			icon: Trash2,
			onClick: handleDeleteSelected,
			ariaLabel: 'Delete selected'
		},
		// 5. Merge
		{
			key: 'merge',
			icon: Merge,
			onClick: handleMergeSelected,
			ariaLabel: 'Merge selected'
		},
		// 6. Split
		{
			key: 'split',
			icon: SplitIcon,
			onClick: handleSplitSelected,
			ariaLabel: 'Split selected'
		}
	];

	const datasetButtons: ToolbarButton[] = [
		{
			key: 'import',
			icon: Upload,
			onClick: () => fileInputRef.current?.click(),
			ariaLabel: 'Import GeoJSON'
		},
		{
			key: 'export',
			icon: Download,
			onClick: datasetActions?.onExport ?? (() => {}),
			disabled: !datasetActions?.canExport,
			ariaLabel: 'Export GeoJSON'
		},
		{
			key: 'clear',
			icon: Trash2,
			onClick: datasetActions?.onClear ?? (() => {}),
			disabled: !datasetActions?.canClear,
			ariaLabel: 'Clear all features'
		}
	];

	const publishButtons: ToolbarButton[] = [
		{
			key: 'publish-new',
			icon: UploadCloud,
			onClick: datasetActions?.onPublishNew ?? (() => {}),
			disabled: !datasetActions?.canPublishNew || datasetActions?.isPublishing,
			ariaLabel: 'Publish as new dataset'
		},
		{
			key: 'publish-update',
			icon: RefreshCw,
			onClick: datasetActions?.onPublishUpdate ?? (() => {}),
			disabled: !datasetActions?.canPublishUpdate || datasetActions?.isPublishing,
			ariaLabel: 'Update existing dataset'
		},
		{
			key: 'publish-copy',
			icon: CopyPlus,
			onClick: datasetActions?.onPublishCopy ?? (() => {}),
			disabled: !datasetActions?.canPublishCopy || datasetActions?.isPublishing,
			ariaLabel: 'Fork dataset'
		}
	];

	const reverseLookupButton: ToolbarButton = {
		key: 'reverse-lookup',
		icon: Crosshair,
		onClick: handleToggleInspector, // Reusing inspector for now as it handles reverse lookup
		variant: inspectorActive ? 'default' : 'outline',
		ariaLabel: 'Reverse lookup'
	};

	const actionButtons: ToolbarButton[] = [
		// Import
		{
			key: 'import',
			icon: Upload,
			onClick: () => fileInputRef.current?.click(),
			ariaLabel: 'Import GeoJSON'
		},
		// Export
		{
			key: 'export',
			icon: Download,
			onClick: datasetActions?.onExport ?? (() => {}),
			disabled: !datasetActions?.canExport,
			ariaLabel: 'Export GeoJSON'
		},
		// Publish
		{
			key: 'publish-new',
			icon: UploadCloud,
			onClick: datasetActions?.onPublishNew ?? (() => {}),
			disabled: !datasetActions?.canPublishNew || datasetActions?.isPublishing,
			ariaLabel: 'Publish as new dataset'
		},
		// Update
		{
			key: 'publish-update',
			icon: RefreshCw,
			onClick: datasetActions?.onPublishUpdate ?? (() => {}),
			disabled: !datasetActions?.canPublishUpdate || datasetActions?.isPublishing,
			ariaLabel: 'Update existing dataset'
		}
	];

	const sidebarButtons: ToolbarButton[] = [
		// Toggle Sidebar
		{
			key: 'datasets',
			icon: Layers,
			onClick: handleToggleDatasets,
			variant: datasetsOpen ? 'default' : 'outline',
			ariaLabel: 'Toggle datasets panel'
		},
		{
			key: 'info',
			icon: FilePenLine,
			onClick: handleToggleInfo,
			variant: infoPanelOpen ? 'default' : 'outline',
			ariaLabel: 'Toggle info panel'
		}
	];
	// Mobile Toolbar Configuration
	const mobileDrawButtons: ToolbarButton[] = [
		{
			key: 'select',
			icon: MousePointer2,
			onClick: () => handleModeChange('select'),
			variant: mode === 'select' ? 'default' : 'outline',
			ariaLabel: 'Select mode'
		},
		{
			key: 'point',
			icon: MapPin,
			onClick: () => handleModeChange('draw_point'),
			variant: mode === 'draw_point' ? 'default' : 'outline',
			ariaLabel: 'Draw point'
		},
		{
			key: 'line',
			icon: Route,
			onClick: () => handleModeChange('draw_linestring'),
			variant: mode === 'draw_linestring' ? 'default' : 'outline',
			ariaLabel: 'Draw line'
		},
		{
			key: 'polygon',
			icon: Pentagon,
			onClick: () => handleModeChange('draw_polygon'),
			variant: mode === 'draw_polygon' ? 'default' : 'outline',
			ariaLabel: 'Draw polygon'
		}
	];

	const mobileEditButtons: ToolbarButton[] = [
		{
			key: 'undo',
			icon: Undo2,
			onClick: handleUndo,
			disabled: !history.canUndo,
			ariaLabel: 'Undo'
		},
		{
			key: 'redo',
			icon: Redo2,
			onClick: handleRedo,
			disabled: !history.canRedo,
			ariaLabel: 'Redo'
		},
		{
			key: 'snapping',
			icon: Magnet,
			onClick: handleToggleSnapping,
			variant: snappingEnabled ? 'default' : 'outline',
			ariaLabel: 'Toggle snapping'
		},
		{
			key: 'edit',
			icon: Edit3,
			onClick: () => handleModeChange('edit'),
			variant: mode === 'edit' ? 'default' : 'outline',
			ariaLabel: 'Edit mode'
		},
		{
			key: 'inspector',
			icon: Crosshair,
			onClick: handleToggleInspector,
			variant: inspectorActive ? 'default' : 'outline',
			ariaLabel: 'Toggle inspector'
		},
		{
			key: 'delete',
			icon: Trash2,
			onClick: handleDeleteSelected,
			ariaLabel: 'Delete selected'
		},
		{
			key: 'merge',
			icon: Merge,
			onClick: handleMergeSelected,
			ariaLabel: 'Merge selected'
		},
		{
			key: 'split',
			icon: SplitIcon,
			onClick: handleSplitSelected,
			ariaLabel: 'Split selected'
		},
		{
			key: 'map-settings',
			icon: MapIcon,
			onClick: handleToggleMapSettings,
			variant: showMapSettings ? 'default' : 'outline',
			ariaLabel: 'Map Settings'
		}
	];

	if (isMobile) {
		return (
			<>
				{/* Top Bar Content (Sub-bars) */}
				<div className="pointer-events-auto w-full max-w-md mx-auto">
					{mobileToolsOpen && (
						<div className="flex items-center justify-center gap-2 rounded-lg bg-white/90 p-2 shadow-sm backdrop-blur flex-wrap">
							<IconButtonRow buttons={mobileDrawButtons} />
							<div className="h-6 w-px bg-gray-200" />
							<IconButtonRow buttons={mobileEditButtons} />
						</div>
					)}

					{mobileSearchOpen && (
						<div className="flex flex-col gap-2 rounded-lg bg-white/90 p-2 shadow-sm backdrop-blur">
							<SearchBar
								searchQuery={searchQuery}
								searchLoading={searchLoading}
								placeholder="Search location..."
								onSubmit={(e) => {
									e.preventDefault();
									handleSearchSubmit(e);
								}}
								onQueryChange={setSearchQuery}
								onClearQuery={clearSearch}
							/>
							{searchResults && searchResults.length > 0 && (
								<div className="max-h-60 overflow-y-auto space-y-1 bg-white rounded-lg border border-gray-100">
									{searchResults.map((result) => (
										<button
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
						<div className="flex items-center justify-center gap-2 rounded-lg bg-white/90 p-2 shadow-sm backdrop-blur flex-wrap">
							<IconButtonRow buttons={datasetButtons} />
							<div className="h-6 w-px bg-gray-200" />
							<IconButtonRow buttons={publishButtons} />
							<input
								type="file"
								ref={fileInputRef}
								className="hidden"
								accept=".geojson,.json"
								onChange={handleFileImport}
							/>
							{showLogin && (
								<div className="ml-2">
									<LoginSessionButtons />
								</div>
							)}
						</div>
					)}
				</div>
			</>
		);
	}

	return (
		<div className="flex flex-col gap-2 pointer-events-auto">
			<div className="flex items-center justify-between gap-2 rounded-lg bg-white/90 p-2 shadow-sm backdrop-blur">
				<div className="flex items-center gap-2 w-full">
					<IconButtonRow buttons={desktopButtons} />

					<div className="h-6 w-px bg-gray-200 mx-1" />

					<div className="relative">
						<SearchBar
							searchQuery={searchQuery}
							searchLoading={searchLoading}
							placeholder="Search location..."
							onSubmit={handleSearchSubmit}
							onQueryChange={setSearchQuery}
							onClearQuery={clearSearch}
							className="w-64"
						/>
						{searchResults && searchResults.length > 0 && (
							<div className="absolute top-full left-0 mt-2 w-64 rounded-lg bg-white p-2 shadow-lg z-50 border border-gray-100">
								<div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-2">
									<span className="text-xs font-medium text-gray-500">Results</span>
									<Button variant="ghost" size="sm" className="h-auto p-0 text-xs" onClick={clearSearch}>
										Close
									</Button>
								</div>
								<div className="max-h-60 overflow-y-auto space-y-1">
									{searchResults.map((result) => (
										<button
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

					<IconButtonRow buttons={[reverseLookupButton]} />

					<div className="h-6 w-px bg-gray-200 mx-1" />

					<IconButtonRow buttons={actionButtons} />

					<Popover open={showMapSettings} onOpenChange={setShowMapSettings}>
						<PopoverTrigger asChild>
							<Button variant={showMapSettings ? 'default' : 'outline'} size="icon" aria-label="Map Settings">
								<MapIcon className="h-4 w-4" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-80" side="bottom" align="end">
							<MapSettingsPanel />
						</PopoverContent>
					</Popover>

					<IconButtonRow buttons={sidebarButtons} />

					<div className="flex-1" />

					{showLogin && <LoginSessionButtons />}
				</div>
			</div>

			{searchError && (
				<div className="rounded-lg bg-red-50 p-2 text-xs text-red-600 shadow-sm self-start">{searchError}</div>
			)}
		</div>
	);
}

// Helper component for Help Icon
function HelpIcon(props: any) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			{...props}
		>
			<circle cx="12" cy="12" r="10" />
			<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
			<path d="M12 17h.01" />
		</svg>
	);
}
