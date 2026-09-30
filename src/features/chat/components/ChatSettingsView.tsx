import { useId } from 'react'
import { Camera, LockKeyhole, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { useChatStore } from '../store'

export function ChatSettingsView({
	readOnly,
	providerLabel,
	endpointLabel,
	onManageConnections,
}: {
	readOnly: boolean
	providerLabel: string
	endpointLabel: string
	onManageConnections: () => void
}) {
	const id = useId()
	const {
		connections,
		activeConnectionId,
		selectConnection,
		models,
		selectedModel,
		setSelectedModel,
		modelsLoading,
		runningChatId,
		settingsStatus,
		safetyLevel,
		setSafetyLevel,
		mapSnapshotsEnabled,
		setMapSnapshotsEnabled,
		toolsEnabled,
		setToolsEnabled,
	} = useChatStore()
	const locked =
		Boolean(runningChatId) || settingsStatus === 'loading' || settingsStatus === 'failed'
	return (
		<section aria-label="Chat settings" className="space-y-5">
			<div>
				<h2 className="text-sm font-semibold">Chat settings</h2>
				<p className="mt-1 text-xs text-muted-foreground">
					These preferences apply across your chats.
				</p>
			</div>
			{readOnly ? (
				<p className="flex gap-2 text-xs text-muted-foreground">
					<LockKeyhole className="size-4 shrink-0" />
					This conversation can read sources but cannot change maps or stories.
				</p>
			) : (
				<label htmlFor={`${id}-safety`} className="block space-y-2 text-xs">
					<span className="font-medium">Edit permissions</span>
					<NativeSelect
						id={`${id}-safety`}
						aria-label="AI edit safety"
						value={safetyLevel}
						disabled={locked}
						onChange={(event) => {
							const level = Number(event.target.value)
							if (level === 1 || level === 2 || level === 3) setSafetyLevel(level)
						}}
						className="w-full [&>select]:min-h-11"
					>
						<NativeSelectOption value="2">Ask before changing</NativeSelectOption>
						<NativeSelectOption value="1">Ask before every change</NativeSelectOption>
						<NativeSelectOption value="3">Apply automatically</NativeSelectOption>
					</NativeSelect>
				</label>
			)}
			<label htmlFor={`${id}-connection`} className="block space-y-2 text-xs">
				<span className="font-medium">Connection</span>
				<NativeSelect
					id={`${id}-connection`}
					aria-label="Chat connection"
					value={activeConnectionId ?? ''}
					disabled={locked || !connections.length}
					onChange={(event) => selectConnection(event.target.value)}
					className="w-full [&>select]:min-h-11"
				>
					{!activeConnectionId && (
						<NativeSelectOption value="" disabled>
							Choose a connection
						</NativeSelectOption>
					)}
					{connections.map((connection) => (
						<NativeSelectOption value={connection.id} key={connection.id}>
							{connection.name}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</label>
			<label htmlFor={`${id}-model`} className="block space-y-2 text-xs">
				<span className="font-medium">Model</span>
				<NativeSelect
					id={`${id}-model`}
					aria-label="Select chat model"
					value={selectedModel ?? ''}
					disabled={locked || modelsLoading || !models.length}
					onChange={(event) => setSelectedModel(event.target.value)}
					className="w-full [&>select]:min-h-11"
				>
					{!selectedModel && (
						<NativeSelectOption value="" disabled>
							{modelsLoading ? 'Loading models…' : 'Choose a model'}
						</NativeSelectOption>
					)}
					{models.map((model) => (
						<NativeSelectOption value={model.id} key={model.id}>
							{model.name}
						</NativeSelectOption>
					))}
				</NativeSelect>
				<span className="block break-all text-muted-foreground">
					{providerLabel} · {endpointLabel}
				</span>
			</label>
			<Button
				type="button"
				variant="outline"
				disabled={Boolean(runningChatId)}
				onClick={onManageConnections}
				className="min-h-11 gap-2 rounded-none text-xs"
			>
				<Settings2 className="size-4" />
				Manage connections
			</Button>
			{!readOnly && (
				<div className="divide-y border-t">
					<label
						htmlFor={`${id}-tools`}
						className="flex min-h-16 items-center justify-between gap-4 py-3 text-xs"
					>
						<span>
							<span className="block font-medium">Geo and web tools</span>
							<span className="text-muted-foreground">Allow map, editor, and search tools.</span>
						</span>
						<Switch
							id={`${id}-tools`}
							aria-label="Geo and web tools"
							checked={toolsEnabled}
							onCheckedChange={setToolsEnabled}
							disabled={locked}
						/>
					</label>
					<label
						htmlFor={`${id}-screenshots`}
						className="flex min-h-16 items-center justify-between gap-4 py-3 text-xs"
					>
						<span>
							<span className="flex items-center gap-1.5 font-medium">
								<Camera className="size-3.5" />
								AI map screenshots
							</span>
							<span className="text-muted-foreground">Allow visual review of the map.</span>
						</span>
						<Switch
							id={`${id}-screenshots`}
							aria-label="Allow AI map screenshots"
							checked={mapSnapshotsEnabled}
							onCheckedChange={setMapSnapshotsEnabled}
							disabled={locked}
						/>
					</label>
				</div>
			)}
			{locked && runningChatId && (
				<p className="text-xs text-muted-foreground">
					Stop the active response to change these settings.
				</p>
			)}
		</section>
	)
}
