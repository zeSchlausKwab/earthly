import { GeoEditorView } from './features/geo-editor/GeoEditorView'
import { useChatSettingsSync } from './features/chat'
import { Toaster } from './components/ui/sonner'
import './index.css'

export function App() {
	useChatSettingsSync()

	return (
		<>
			<GeoEditorView />
			<Toaster position="bottom-right" />
		</>
	)
}

export default App
