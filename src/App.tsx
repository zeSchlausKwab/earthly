import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { useChatSettingsSync } from './features/chat'
import { GeoEditorView } from './features/geo-editor/GeoEditorView'
import { ZapDialogHost } from './features/social/comments/GeoSocialActions'
import { CurrentUserReactionSync } from './features/social/reactions/CurrentUserReactionSync'
import { TourManager } from './features/tour'
import { useIsMobile } from './lib/hooks/useIsMobile'

export function App() {
	useChatSettingsSync()
	const isMobile = useIsMobile()

	return (
		<TooltipProvider>
			<GeoEditorView />
			<CurrentUserReactionSync />
			<ZapDialogHost />
			<Toaster
				position={isMobile ? 'top-center' : 'bottom-center'}
				offset={isMobile ? undefined : { bottom: 24 }}
				mobileOffset={{
					top: 'calc(env(safe-area-inset-top) + 12px)',
					right: 8,
					left: 8,
				}}
			/>
			<TourManager />
		</TooltipProvider>
	)
}

export default App
