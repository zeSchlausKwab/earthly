/**
 * MobileMapActions — browse-mode map actions for the mobile shell, restoring
 * desktop-toolbar parity for the controls that never made it into the mobile
 * redesign: place search, share/export, theme toggle, and location lookup.
 *
 * Rendered inside the map's control stack (`controlsChildren`, top-right on
 * mobile) as a ControlGroup so it visually matches the zoom/locate built-ins.
 * Everything is store/hook-driven — the only prop is the search-result
 * handler GeoEditorView already owns (same one the desktop Toolbar uses).
 *
 * Deliberately NOT rendered in edit mode: the edit tool strip + MobileToolMenu
 * own that surface, and the map controls column stays short for drawing.
 */

import { Crosshair, Moon, Search, Sun } from 'lucide-react'
import { useState } from 'react'
import { ControlButton, ControlGroup } from '@/components/ui/map'
import { useTheme } from '@/lib/theme'
import { ShareExportPopover } from './share/ShareExportPopover'
import { MobileSearch } from './MobileSearch'
import type { GeoSearchResult } from '../types'
import { executeEditorCommand } from '../commands'
import { useEditorStore } from '../store'

interface MobileMapActionsProps {
	onSearchResultSelect: (result: GeoSearchResult) => void
}

export function MobileMapActions({ onSearchResultSelect }: MobileMapActionsProps) {
	const [theme, setTheme] = useTheme()
	const isDark = theme === 'dark'

	const [searchOpen, setSearchOpen] = useState(false)
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
				<ControlButton label="Search places" onClick={() => setSearchOpen((open) => !open)}>
					<Search className="h-4 w-4" />
				</ControlButton>
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
