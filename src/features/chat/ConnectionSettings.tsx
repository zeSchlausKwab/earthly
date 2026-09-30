import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
	CONNECTION_PRESETS,
	getConnectionPreset,
	validateConnection,
	type ChatConnection,
} from './connections'
import { useChatStore } from './store'

function newConnection(presetId = 'openrouter'): ChatConnection {
	const preset = getConnectionPreset(presetId)
	return {
		id: crypto.randomUUID(),
		name: preset.name,
		presetId,
		baseUrl: preset.baseUrl,
		apiKey: '',
		selectedModel: preset.model ?? null,
	}
}

export function ConnectionSettings({ disabled }: { disabled: boolean }) {
	const {
		connections,
		activeConnectionId,
		saveConnection,
		selectConnection,
		deleteConnection,
		settingsSyncStatus,
		settingsStatus,
		settingsSyncError,
		requestSettingsReload,
		settingsOwnerPubkey,
	} = useChatStore()
	const [draft, setDraft] = useState<ChatConnection | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [deleting, setDeleting] = useState(false)
	const active = connections.find((connection) => connection.id === activeConnectionId)
	const preset = draft ? getConnectionPreset(draft.presetId) : null
	const editing = Boolean(draft && connections.some((connection) => connection.id === draft.id))
	// Never keep another account's key in an editor after identity changes.
	useEffect(() => {
		void settingsOwnerPubkey
		setDraft(null)
		setError(null)
		setDeleting(false)
	}, [settingsOwnerPubkey])
	return (
		<div className="min-w-0 space-y-3">
			<div className="space-y-2">
				<Label htmlFor="chat-connection-select">Connection</Label>
				<div className="flex min-w-0 flex-wrap gap-2">
					<NativeSelect
						id="chat-connection-select"
						className="min-w-[min(100%,12rem)] max-w-full flex-1"
						value={activeConnectionId ?? ''}
						disabled={disabled || connections.length === 0}
						onChange={(event) => {
							selectConnection(event.target.value)
							setDraft(null)
							setDeleting(false)
						}}
					>
						{!activeConnectionId && (
							<NativeSelectOption value="">Choose a connection</NativeSelectOption>
						)}
						{connections.map((connection) => (
							<NativeSelectOption key={connection.id} value={connection.id}>
								{connection.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<Button
						variant="outline"
						disabled={disabled}
						onClick={() => {
							setDraft(newConnection())
							setError(null)
							setDeleting(false)
						}}
					>
						<Plus className="h-4 w-4" />
						New connection
					</Button>
				</div>
				{active && (
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<span className="w-full break-all text-xs text-muted-foreground">
							{getConnectionPreset(active.presetId).name} · {active.baseUrl}
						</span>
						<Button
							variant="ghost"
							size="sm"
							disabled={disabled}
							onClick={() => {
								setDraft({ ...active })
								setError(null)
							}}
						>
							<Pencil className="h-3 w-3" />
							Edit
						</Button>
						<Button variant="ghost" size="sm" disabled={disabled} onClick={() => setDeleting(true)}>
							<Trash2 className="h-3 w-3" />
							Delete connection
						</Button>
					</div>
				)}
			</div>
			{deleting && active && (
				<div role="alert" className="space-y-2 rounded border p-3 text-sm">
					<p>Delete “{active.name}” from your saved connections?</p>
					<div className="flex gap-2">
						<Button
							variant="destructive"
							onClick={() => {
								deleteConnection(active.id)
								setDraft(null)
								setDeleting(false)
							}}
						>
							Confirm deletion
						</Button>
						<Button variant="outline" onClick={() => setDeleting(false)}>
							Keep connection
						</Button>
					</div>
				</div>
			)}
			{!connections.length && !draft && (
				<p className="text-xs text-muted-foreground">
					Add a cloud API, a local model server, or Routstr with your NIP-60 wallet.
				</p>
			)}
			{draft && preset && (
				<form
					className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3"
					onSubmit={(event) => {
						event.preventDefault()
						try {
							const connection = validateConnection(draft)
							if (preset.keyRequired && !connection.apiKey)
								throw new Error(`Enter your ${preset.name} API key`)
							saveConnection(connection)
							setDraft(null)
							setError(null)
						} catch (error) {
							setError(error instanceof Error ? error.message : 'Invalid connection')
						}
					}}
				>
					<div className="space-y-2">
						<Label htmlFor="chat-provider-select">Provider</Label>
						<NativeSelect
							id="chat-provider-select"
							className="w-full"
							value={draft.presetId}
							onChange={(event) => {
								const next = newConnection(event.target.value)
								setDraft({ ...next, id: draft.id })
								setError(null)
							}}
						>
							{CONNECTION_PRESETS.map((option) => (
								<NativeSelectOption key={option.id} value={option.id}>
									{option.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
						{preset.hint && <p className="text-xs text-muted-foreground">{preset.hint}</p>}
						{preset.docs && (
							<a className="text-xs underline" href={preset.docs} target="_blank" rel="noreferrer">
								Provider setup guide
							</a>
						)}
					</div>
					<div className="space-y-2">
						<Label htmlFor="connection-name">Connection name</Label>
						<Input
							id="connection-name"
							required
							value={draft.name}
							onChange={(event) => setDraft({ ...draft, name: event.target.value })}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="connection-endpoint">Endpoint</Label>
						<Input
							id="connection-endpoint"
							required
							type="url"
							value={draft.baseUrl}
							placeholder="https://api.example.com/v1"
							onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="connection-key">API key{preset.keyRequired ? '' : ' (optional)'}</Label>
						<Input
							id="connection-key"
							type="password"
							autoComplete="off"
							spellCheck={false}
							required={preset.keyRequired}
							value={draft.apiKey}
							onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="connection-model">Model ID (optional)</Label>
						<Input
							id="connection-model"
							value={draft.selectedModel ?? ''}
							placeholder="Discover models after saving"
							onChange={(event) =>
								setDraft({ ...draft, selectedModel: event.target.value || null })
							}
						/>
						<p className="text-xs text-muted-foreground">
							Use the exact model ID if your provider does not offer model discovery.
						</p>
					</div>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						<Button type="submit" disabled={disabled}>
							{editing ? 'Save connection' : 'Add connection'}
						</Button>
						<Button variant="outline" type="button" onClick={() => setDraft(null)}>
							Cancel
						</Button>
					</div>
				</form>
			)}
			<div
				className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
				role="status"
			>
				<span>
					{settingsStatus === 'no-signer'
						? 'Sign in to encrypt and sync your connections.'
						: settingsSyncStatus === 'synced'
							? 'Encrypted connections synced to Nostr.'
							: settingsSyncStatus === 'syncing'
								? 'Syncing encrypted connections…'
								: settingsSyncStatus === 'error'
									? settingsSyncError
									: 'Encrypted on this device; relay sync is pending.'}
				</span>
				{settingsStatus === 'loaded' && settingsSyncStatus !== 'syncing' && (
					<Button variant="outline" size="sm" onClick={requestSettingsReload}>
						<RefreshCw className="h-3 w-3" />
						{settingsSyncStatus === 'error' ? 'Retry sync' : 'Refresh connections'}
					</Button>
				)}
			</div>
		</div>
	)
}
