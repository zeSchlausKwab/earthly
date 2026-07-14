import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { useChatSettingsSync } from './features/chat'
import { GeoEditorView } from './features/geo-editor/GeoEditorView'
import { PrivateMapsDialog } from './features/private-maps/PrivateMapsDialog'
import { TourManager } from './features/tour'
import './index.css'

export function App() {
	useChatSettingsSync()

	return (
		<TooltipProvider>
			<GeoEditorView />
			<PrivateMapsDialog />
			<Toaster position="bottom-right" />
			<TourManager />
		</TooltipProvider>
	)
}

export default App
