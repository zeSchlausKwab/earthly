import { create } from 'zustand'

export const DESKTOP_AGENT_SCOPE = 'webmcp-desktop'

export interface AgentActivity {
	id: string
	tool: string
	status: 'running' | 'finished' | 'cancelled' | 'failed'
	message?: string
}

interface WebMcpState {
	/** Session-only opt-in: a reload or account change needs fresh access. */
	enabled: boolean
	externalQueriesEnabled: boolean
	setExternalQueriesEnabled: (enabled: boolean) => void
	status: 'checking' | 'unsupported' | 'off' | 'starting' | 'ready' | 'error'
	toolCount: number
	error: string | null
	panelOpen: boolean
	activities: AgentActivity[]
	setEnabled: (enabled: boolean) => void
}

export const useWebMcpStore = create<WebMcpState>((set) => ({
	enabled: false,
	externalQueriesEnabled: false,
	status: 'checking',
	toolCount: 0,
	error: null,
	panelOpen: false,
	activities: [],
	setEnabled: (enabled) =>
		set({ enabled, error: null, ...(!enabled ? { externalQueriesEnabled: false } : {}) }),
	setExternalQueriesEnabled: (externalQueriesEnabled) => set({ externalQueriesEnabled }),
}))

export function recordAgentActivity(activity: AgentActivity): void {
	useWebMcpStore.setState((state) => ({
		activities: [...state.activities.filter((item) => item.id !== activity.id), activity].slice(
			-20,
		),
		...(activity.status === 'failed' ? { panelOpen: true } : {}),
	}))
}
