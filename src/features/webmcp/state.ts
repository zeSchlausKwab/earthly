import { create } from 'zustand'

export const DESKTOP_AGENT_SCOPE = 'webmcp-desktop'

export interface AgentActivity {
	id: string
	tool: string
	status: 'running' | 'finished' | 'cancelled' | 'failed'
	message?: string
}

interface WebMcpState {
	/** Browser preference; operations still capture the current account and draft. */
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

export const WEBMCP_PREFERENCES_KEY = 'earthly-webmcp-preferences'
type PreferencesStorage = Pick<Storage, 'getItem' | 'setItem'>
type WebMcpPreferences = Pick<WebMcpState, 'enabled' | 'externalQueriesEnabled'>

function browserStorage(): PreferencesStorage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage
	} catch {
		return null
	}
}

function readPreferences(storage: PreferencesStorage | null): WebMcpPreferences {
	const defaults = { enabled: true, externalQueriesEnabled: true }
	try {
		const saved = storage?.getItem(WEBMCP_PREFERENCES_KEY)
		if (!saved) return defaults
		const preferences: unknown = JSON.parse(saved)
		if (!preferences || typeof preferences !== 'object') return defaults
		const value = preferences as Record<string, unknown>
		return {
			enabled: typeof value.enabled === 'boolean' ? value.enabled : defaults.enabled,
			externalQueriesEnabled:
				typeof value.externalQueriesEnabled === 'boolean'
					? value.externalQueriesEnabled
					: defaults.externalQueriesEnabled,
		}
	} catch {
		return defaults
	}
}

function savePreferences(storage: PreferencesStorage | null, state: WebMcpPreferences): void {
	try {
		storage?.setItem(
			WEBMCP_PREFERENCES_KEY,
			JSON.stringify({
				enabled: state.enabled,
				externalQueriesEnabled: state.externalQueriesEnabled,
			}),
		)
	} catch {
		// Storage may be unavailable; controls must still work for the current page.
	}
}

export function createWebMcpStore(storage: PreferencesStorage | null = browserStorage()) {
	return create<WebMcpState>((set, get) => ({
		...readPreferences(storage),
		status: 'checking',
		toolCount: 0,
		error: null,
		panelOpen: false,
		activities: [],
		setEnabled: (enabled) => {
			set({ enabled, error: null })
			savePreferences(storage, get())
		},
		setExternalQueriesEnabled: (externalQueriesEnabled) => {
			set({ externalQueriesEnabled })
			savePreferences(storage, get())
		},
	}))
}

export const useWebMcpStore = createWebMcpStore()

export function recordAgentActivity(activity: AgentActivity): void {
	useWebMcpStore.setState((state) => ({
		activities: [...state.activities.filter((item) => item.id !== activity.id), activity].slice(
			-20,
		),
		...(activity.status === 'failed' ? { panelOpen: true } : {}),
	}))
}
