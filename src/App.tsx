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
			<Toaster
				position="bottom-right"
				mobileOffset={{
					bottom: 'calc(var(--mobile-dock-height) + env(safe-area-inset-bottom) + 12px)',
					right: 8,
					left: 8,
				}}
			/>
			<TourManager />
		</TooltipProvider>
	)
}

export default App
