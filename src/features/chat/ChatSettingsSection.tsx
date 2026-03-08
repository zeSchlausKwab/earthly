import { useEffect } from 'react'
import { Bot, KeyRound, Lock, Server, ToggleLeft, ToggleRight } from 'lucide-react'
import { useNDKCurrentUser } from '@nostr-dev-kit/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ProviderType } from './routstr'
import { useChatStore } from './store'

const PROVIDER_OPTIONS: { value: ProviderType; label: string }[] = [
	{ value: 'routstr', label: 'Routstr (paid)' },
	{ value: 'lmstudio', label: 'LM Studio' },
	{ value: 'ollama', label: 'Ollama' },
	{ value: 'custom', label: 'Custom endpoint' },
]

export function ChatSettingsSection() {
	const currentUser = useNDKCurrentUser()
	const {
		provider,
		customEndpoint,
		customApiKey,
		models,
		selectedModel,
		modelsLoading,
		modelsError,
		toolsEnabled,
		isStreaming,
		setProvider,
		setCustomEndpoint,
		setCustomApiKey,
		loadModels,
		setSelectedModel,
		setToolsEnabled,
	} = useChatStore()

	useEffect(() => {
		if (provider === 'custom' && !customEndpoint.trim()) return
		if (models.length === 0 && !modelsLoading && !modelsError) {
			void loadModels()
		}
	}, [customEndpoint, loadModels, models.length, modelsError, modelsLoading, provider])

	return (
		<div className="space-y-4">
			<div className="space-y-1">
				<div className="flex items-center gap-2">
					<Bot className="h-4 w-4 text-muted-foreground" />
					<Label className="text-sm font-medium">AI Chat</Label>
				</div>
				<p className="text-xs text-muted-foreground">
					Provider, model, tool access, and custom credentials are encrypted with the active
					Nostr signer before they are stored locally.
				</p>
			</div>

			<div className="space-y-2">
				<Label>Provider</Label>
				<Select
					value={provider}
					onValueChange={(value) => setProvider(value as ProviderType)}
					disabled={isStreaming}
				>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{PROVIDER_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{provider === 'custom' && (
				<div className="space-y-3 rounded-lg border bg-muted/20 p-3">
					<div className="space-y-2">
						<Label>Endpoint</Label>
						<Input
							placeholder="http://localhost:8080/v1"
							value={customEndpoint}
							onChange={(event) => setCustomEndpoint(event.target.value)}
							disabled={isStreaming}
						/>
					</div>

					<div className="space-y-2">
						<Label>API Key</Label>
						<Input
							placeholder="Optional bearer token"
							type="password"
							value={customApiKey}
							onChange={(event) => setCustomApiKey(event.target.value)}
							disabled={isStreaming}
						/>
					</div>

					<Button
						variant="outline"
						onClick={() => void loadModels()}
						disabled={!customEndpoint || isStreaming || modelsLoading}
						className="w-full"
					>
						{modelsLoading ? 'Connecting...' : 'Connect custom endpoint'}
					</Button>
				</div>
			)}

			<div className="space-y-2">
				<Label>Model</Label>
				<Select
					value={selectedModel ?? ''}
					onValueChange={setSelectedModel}
					disabled={modelsLoading || isStreaming}
				>
					<SelectTrigger>
						<SelectValue placeholder={modelsLoading ? 'Loading models...' : 'Select model'} />
					</SelectTrigger>
					<SelectContent>
						{models.map((model) => (
							<SelectItem key={model.id} value={model.id}>
								<div className="flex flex-col">
									<span>{model.name}</span>
									{(model.pricing.input > 0 || model.pricing.output > 0) && (
										<span className="text-xs text-muted-foreground">
											{model.pricing.input}/{model.pricing.output} sats/M tokens
										</span>
									)}
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{modelsError ? <p className="text-xs text-destructive">{modelsError}</p> : null}
			</div>

			<div className="rounded-lg border bg-card p-3">
				<button
					type="button"
					onClick={() => setToolsEnabled(!toolsEnabled)}
					className={cn(
						'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
						toolsEnabled
							? 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200'
							: 'border-border bg-muted/40 text-muted-foreground',
					)}
				>
					<div className="space-y-1">
						<div className="flex items-center gap-2 text-sm font-medium">
							<Server className="h-4 w-4" />
							<span>Geo and web tools</span>
						</div>
						<p className="text-xs opacity-80">
							Allow the model to call map, editor, and search tools during a chat.
						</p>
					</div>
					{toolsEnabled ? (
						<ToggleRight className="h-5 w-5 shrink-0" />
					) : (
						<ToggleLeft className="h-5 w-5 shrink-0" />
					)}
				</button>
			</div>

			<div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
				<div className="flex items-start gap-2">
					{currentUser ? (
						<Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					) : (
						<KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					)}
					<p>
						{currentUser
							? 'Changes are saved for the active Nostr account and restored automatically when the app starts.'
							: 'Sign in with a Nostr account to persist chat settings in encrypted local storage.'}
					</p>
				</div>
			</div>
		</div>
	)
}
