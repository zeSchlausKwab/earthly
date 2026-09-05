import { useSyncExternalStore } from 'react'
import type { ToolExecutionRunIdentity } from './tools/types'

type Activity = { activated: boolean; runningChatId: string | null; activeRun: ToolExecutionRunIdentity | null }
let activity: Activity = { activated: false, runningChatId: null, activeRun: null }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => activity

/** Small read-only bridge: toolbar progress must not import the AI runtime. */
export function reportChatActivity(next: Omit<Activity, 'activated'>) {
	if (activity.activated && activity.runningChatId === next.runningChatId && activity.activeRun === next.activeRun) return
	activity = { ...next, activated: true }
	for (const listener of listeners) listener()
}
export function useChatActivity() { return useSyncExternalStore(subscribe, snapshot, snapshot) }
