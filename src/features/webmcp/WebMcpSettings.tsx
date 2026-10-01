import { Button } from '@/components/ui/button'
import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { useChatStore } from '@/features/chat/store'
import { useWebMcpStore } from './state'

export function WebMcpSettings() {
	const id = useId()
	const {
		enabled,
		externalQueriesEnabled,
		setExternalQueriesEnabled,
		status,
		toolCount,
		error,
		setEnabled,
	} = useWebMcpStore()
	const safetyLevel = useChatStore((state) => state.safetyLevel)
	const setSafetyLevel = useChatStore((state) => state.setSafetyLevel)
	return (
		<section className="space-y-3 border-t pt-4" aria-label="Desktop agent access">
			<div className="flex items-center justify-between gap-3">
				<div>
					<Label htmlFor={`${id}-access`}>Desktop agent access</Label>
					<p className="text-xs text-muted-foreground">
						Experimental WebMCP · enabled for this tab session
					</p>
				</div>
				<Switch
					id={`${id}-access`}
					aria-label="Desktop agent access"
					checked={enabled}
					disabled={status === 'checking' || status === 'unsupported'}
					onCheckedChange={setEnabled}
				/>
			</div>
			<p className="text-sm text-muted-foreground">
				Let a connected desktop AI read and edit the open Map draft, including geometry, styles and
				callout images, and compose local Stories and Atlases with references and saved views.
				Document access includes retained drafts in the active account. Publishing stays in Earthly’s publishing flow.
			</p>
			<p role="status" className="text-xs text-muted-foreground">
				{status === 'unsupported'
					? 'WebMCP is unavailable. Use Chrome with the WebMCP testing feature enabled.'
					: status === 'ready'
						? `${toolCount} Earthly tools available to your desktop agent.`
						: status === 'starting'
							? 'Registering Earthly tools…'
							: status === 'error'
								? `Could not register tools: ${error}`
								: 'Desktop agent access is off.'}
			</p>
			<div className="flex items-center justify-between gap-3">
				<div>
					<Label htmlFor={`${id}-external`}>External queries</Label>
					<p className="max-w-sm text-xs text-muted-foreground">
						Allow geography, OSM, road routing, web and Wikipedia tools through Earthly’s existing
						remote MCP connection. Queries may include map bounds, coordinates and search text.
					</p>
				</div>
				<Switch
					id={`${id}-external`}
					aria-label="External queries"
					checked={externalQueriesEnabled}
					disabled={!enabled || status === 'unsupported'}
					onCheckedChange={setExternalQueriesEnabled}
				/>
			</div>
			<div className="space-y-1">
				<Label htmlFor={`${id}-safety`}>AI edit safety</Label>
				<Select
					value={String(safetyLevel)}
					onValueChange={(value) => setSafetyLevel(Number(value) as 1 | 2 | 3)}
				>
					<SelectTrigger id={`${id}-safety`} aria-label="AI edit safety">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="1">Preview all changes</SelectItem>
						<SelectItem value="2">Confirm edits and deletions</SelectItem>
						<SelectItem value="3">Apply with Undo</SelectItem>
					</SelectContent>
				</Select>
				<p className="text-xs text-muted-foreground">
					Shared with Earthly chat. Reviews and Undo appear in Desktop agent activity.
				</p>
			</div>
			<Button
				variant="outline"
				size="sm"
				onClick={() => useWebMcpStore.setState({ panelOpen: true })}
			>
				Desktop agent activity
			</Button>
			<details className="text-xs text-muted-foreground">
				<summary className="cursor-pointer">Connect a desktop agent</summary>
				<p className="mt-2">
					Connect Chrome DevTools MCP and launch Chrome with <code>--enable-features=WebMCP</code>.
					Ask the agent to discover <code>document.modelContext</code> tools through its
					<code> evaluate_script</code> tool, then call <code>earthly_get_map</code>. Builds with
					dedicated WebMCP commands can use <code>--category-experimental-webmcp</code>.
				</p>
				<a
					className="mt-2 inline-block underline"
					href="https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md"
					target="_blank"
					rel="noreferrer"
				>
					Chrome DevTools MCP setup
				</a>
			</details>
		</section>
	)
}
