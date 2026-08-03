/**
 * MobileMapActions — browse-mode map actions for the mobile shell, restoring
 * desktop-toolbar parity for the controls that never made it into the mobile
 * redesign: place search, share/export, theme toggle, and location lookup.
 *
 * Rendered inside the map's control stack (`controlsChildren`, top-right on
 * mobile) as a ControlGroup so it visually matches the zoom/locate built-ins.
 * Most actions are store/hook-driven; map-visual toggles are passed down from
 * GeoEditorView so desktop and mobile share the same local presentation state.
 *
 * Deliberately NOT rendered in edit mode: the edit tool strip + MobileToolMenu
 * own that surface, and the map controls column stays short for drawing.
 */

import { CircleDot, Crosshair, MapPin, Maximize2, Minimize2, Moon, Sun } from 'lucide-react'
import { ControlButton, ControlGroup } from '@/components/ui/map'
import { useTheme } from '@/lib/theme'
import { calloutDisplayModeActionLabel, type CalloutDisplayMode } from '../callouts/layout'
import { ShareExportPopover } from './share/ShareExportPopover'
import { MobileSearch } from './MobileSearch'
import type { GeoSearchResult } from '../types'
import { executeEditorCommand } from '../commands'
import { useEditorStore } from '../store'

interface MobileMapActionsProps {
	onSearchResultSelect: (result: GeoSearchResult) => void
	calloutsEnabled: boolean
	calloutDisplayMode: CalloutDisplayMode
	onToggleCallouts: () => void
	onCycleCalloutDisplayMode: () => void
}

export function MobileMapActions({
	onSearchResultSelect,
	calloutsEnabled,
	calloutDisplayMode,
	onToggleCallouts,
	onCycleCalloutDisplayMode,
}: MobileMapActionsProps) {
	const [theme, setTheme] = useTheme()
	const isDark = theme === 'dark'

	const searchOpen = useEditorStore((state) => state.mobileSearchOpen)
	const setSearchOpen = useEditorStore((state) => state.setMobileSearchOpen)
	const searchQuery = useEditorStore((state) => state.searchQuery)
	const searchResults = useEditorStore((state) => state.searchResults)
	const searchLoading = useEditorStore((state) => state.searchLoading)
	const searchError = useEditorStore((state) => state.searchError)
	const setSearchQuery = useEditorStore((state) => state.setSearchQuery)
	const performSearch = useEditorStore((state) => state.performSearch)
	const clearSearch = useEditorStore((state) => state.clearSearch)

	// Location lookup — same toggle semantics as the desktop Toolbar and the
	// edit-mode MobileToolMenu: activating it also drops into select mode.
	const mode = useEditorStore((state) => state.mode)
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const setInspectorActive = useEditorStore((state) => state.setInspectorActive)
	const toggleInspector = () => {
		if (inspectorActive) {
			setInspectorActive(false)
			return
		}
		setInspectorActive(true)
		if (mode !== 'select') executeEditorCommand('set_mode', { mode: 'select' })
	}

	return (
		<>
			<ControlGroup>
				<ControlButton
					label={calloutsEnabled ? 'Hide map callouts' : 'Show map callouts'}
					onClick={onToggleCallouts}
					pressed={calloutsEnabled}
				>
					<MapPin className="h-4 w-4" />
				</ControlButton>
				<ControlButton
					label={calloutDisplayModeActionLabel(calloutDisplayMode)}
					onClick={onCycleCalloutDisplayMode}
					disabled={!calloutsEnabled}
				>
					{calloutDisplayMode === 'full' ? (
						<Maximize2 className="h-4 w-4" />
					) : calloutDisplayMode === 'compact' ? (
						<Minimize2 className="h-4 w-4" />
					) : (
						<CircleDot className="h-4 w-4" />
					)}
				</ControlButton>
			</ControlGroup>
			<ControlGroup>
				<ControlButton
					label={inspectorActive ? 'Disable location lookup' : 'Enable location lookup'}
					onClick={toggleInspector}
				>
					<Crosshair className={`h-4 w-4 ${inspectorActive ? 'text-primary' : ''}`} />
				</ControlButton>
				<ControlButton
					label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
					onClick={() => setTheme(isDark ? 'light' : 'dark')}
				>
					{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
				</ControlButton>
			</ControlGroup>
			{/* Share/export brings its own popover trigger, styled to match. */}
			<ShareExportPopover small />
			{searchOpen ? (
				<MobileSearch
					searchQuery={searchQuery}
					searchResults={searchResults}
					searchLoading={searchLoading}
					searchError={searchError}
					onSearchQueryChange={setSearchQuery}
					onSearchSubmit={() => performSearch()}
					onSearchResultSelect={(result) => {
						onSearchResultSelect(result)
						setSearchOpen(false)
					}}
					onClearSearchResults={clearSearch}
					onSearchClear={clearSearch}
					onClose={() => setSearchOpen(false)}
				/>
			) : null}
		</>
	)
}
