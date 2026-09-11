import { deferredSurface } from '../../components/deferredSurface.tsx'
export const ChatPanel = deferredSurface(async () => ({default:(await import('./ChatPanel')).ChatPanel}), 'your AI Thread')
