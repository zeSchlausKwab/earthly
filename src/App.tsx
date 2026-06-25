import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { useChatSettingsSync } from './features/chat'
import { GeoEditorView } from './features/geo-editor/GeoEditorView'
import { TourManager } from './features/tour'
import './index.css'

export function App() {
	useChatSettingsSync()

	return (
		<TooltipProvider>
			<GeoEditorView />
			<Toaster position="bottom-right" />
			<TourManager />
		</TooltipProvider>
	)
}

export default App
