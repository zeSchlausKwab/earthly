import { lazy, Suspense } from 'react'
import { useChatActivity } from './activity.ts'

const SettingsSync = lazy(() => import('./useChatSettingsSync').then(m => ({ default: function SettingsSync() { m.useChatSettingsSync(); return null } })))

/** Once AI is used, synchronization stays mounted across closes and account changes. */
export function ChatRuntimeHost() {
	const { activated } = useChatActivity()
	return activated ? <Suspense fallback={null}><SettingsSync /></Suspense> : null
}
