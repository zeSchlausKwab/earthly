import { GeoEditorView } from './features/geo-editor/GeoEditorView'
import { useChatSettingsSync } from './features/chat'
import { Toaster } from './components/ui/sonner'
import { TourManager } from './features/tour'
import './index.css'

export function App() {
	useChatSettingsSync()

	return (
		<>
			<GeoEditorView />
			<Toaster position="bottom-right" />
			<TourManager />
		</>
	)
}

export default App
