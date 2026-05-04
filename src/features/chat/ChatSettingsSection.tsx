import { useEffect, useMemo, useState } from 'react'
import {
	AlertTriangle,
	Bot,
	Check,
	SlidersHorizontal,
	ChevronsUpDown,
	KeyRound,
	Lock,
	Search,
	Server,
	ToggleLeft,
	ToggleRight,
} from 'lucide-react'
import {  } from '@nostr-dev-kit/react'
import { useActiveAccount } from 'applesauce-react/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ProviderType } from './routstr'
import { useChatStore } from './store'

const PROVIDER_OPTIONS: { value: ProviderType; label: string }[] = [
	{ value: 'routstr', label: 'Routstr (paid)' },
	{ value: 'lmstudio', label: 'LM Studio' },
	{ value: 'ollama', label: 'Ollama' },
	{ value: 'custom', label: 'Custom endpoint' },
]

type ModelSortMode = 'relevance' | 'price_input_asc' | 'price_output_asc' | 'name_asc'

function DangerIndicator() {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex shrink-0 items-center justify-center text-orange-500 dark:text-orange-400">
					<AlertTriangle className="h-3.5 w-3.5" />
				</span>
			</TooltipTrigger>
			<TooltipContent side="top" sideOffset={6}>
				danger
			</TooltipContent>
		</Tooltip>
	)
}

export function ChatSettingsSection() {
	const currentUser = useActiveAccount()
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
	const selectedProviderOption = PROVIDER_OPTIONS.find((option) => option.value === provider)
	const [modelPickerOpen, setModelPickerOpen] = useState(false)
	const [modelQuery, setModelQuery] = useState('')
	const [modelSortMode, setModelSortMode] = useState<ModelSortMode>('relevance')
	const [toolCallingOnly, setToolCallingOnly] = useState(false)
	const selectedModelData = useMemo(
		() => models.find((model) => model.id === selectedModel) ?? null,
		[models, selectedModel],
	)
	const hasToolCallingMetadata = useMemo(
		() => models.some((model) => typeof model.supportsTools === 'boolean'),
		[models],
	)
	const filteredModels = useMemo(() => {
		const query = modelQuery.trim().toLowerCase()
		const indexed = models
			.map((model, index) => ({ model, index }))
			.filter(({ model }) => {
				if (toolCallingOnly && model.supportsTools !== true) return false
				if (!query) return true
				const haystack = `${model.name} ${model.id}`.toLowerCase()
				return haystack.includes(query)
			})

		indexed.sort((a, b) => {
			if (modelSortMode === 'price_input_asc') {
				return (
					a.model.pricing.input - b.model.pricing.input || a.model.name.localeCompare(b.model.name)
				)
			}
			if (modelSortMode === 'price_output_asc') {
				return (
					a.model.pricing.output - b.model.pricing.output ||
					a.model.name.localeCompare(b.model.name)
				)
			}
			if (modelSortMode === 'name_asc') {
				return a.model.name.localeCompare(b.model.name)
			}
			return a.index - b.index
		})

		return indexed.map(({ model }) => model)
	}, [models, modelQuery, modelSortMode, toolCallingOnly])

	useEffect(() => {
		if (provider === 'custom' && !customEndpoint.trim()) return
		if (models.length === 0 && !modelsLoading && !modelsError) {
			void loadModels()
		}
	}, [customEndpoint, loadModels, models.length, modelsError, modelsLoading, provider])

	useEffect(() => {
		if (!hasToolCallingMetadata && toolCallingOnly) {
			setToolCallingOnly(false)
		}
	}, [hasToolCallingMetadata, toolCallingOnly])

	return (
		<div className="space-y-4">
			<div className="space-y-1">
				<div className="flex items-center gap-2">
					<Bot className="h-4 w-4 text-muted-foreground" />
					<Label className="text-sm font-medium">AI Chat</Label>
				</div>
				<p className="text-xs text-muted-foreground">
					Provider, model, tool access, and custom credentials are encrypted with the active Nostr
					signer before they are stored locally.
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
						<span className="flex min-w-0 items-center gap-2">
							<span className="truncate">{selectedProviderOption?.label ?? 'Select provider'}</span>
							{provider === 'routstr' ? <DangerIndicator /> : null}
						</span>
					</SelectTrigger>
					<SelectContent>
						{PROVIDER_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								<span className="flex min-w-0 items-center gap-2">
									<span className="truncate">{option.label}</span>
									{option.value === 'routstr' ? <DangerIndicator /> : null}
								</span>
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
				<Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="outline"
							role="combobox"
							aria-expanded={modelPickerOpen}
							disabled={modelsLoading || isStreaming}
							className="h-auto w-full items-center justify-between px-3 py-2 text-left font-normal"
						>
							<span className="min-w-0 flex-1">
								{selectedModelData ? (
									<span className="flex min-w-0 flex-col">
										<span className="truncate">{selectedModelData.name}</span>
										{(selectedModelData.pricing.input > 0 ||
											selectedModelData.pricing.output > 0) && (
											<span className="text-xs text-muted-foreground">
												{selectedModelData.pricing.input}/{selectedModelData.pricing.output} sats/M
												tokens
											</span>
										)}
									</span>
								) : (
									<span className="text-muted-foreground">
										{modelsLoading ? 'Loading models...' : 'Select model'}
									</span>
								)}
							</span>
							<ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
						<div className="border-b p-2">
							<div className="space-y-2">
								<div className="relative">
									<Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										value={modelQuery}
										onChange={(event) => setModelQuery(event.target.value)}
										placeholder="Search models..."
										className="pl-8"
									/>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<div className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground">
										<SlidersHorizontal className="h-3.5 w-3.5" />
										<span>Sort</span>
									</div>
									<Select
										value={modelSortMode}
										onValueChange={(value) => setModelSortMode(value as ModelSortMode)}
									>
										<SelectTrigger size="sm" className="h-8 min-w-[11rem]">
											<span className="truncate text-xs">
												{modelSortMode === 'relevance'
													? 'Default order'
													: modelSortMode === 'price_input_asc'
														? 'Cheapest input'
														: modelSortMode === 'price_output_asc'
															? 'Cheapest output'
															: 'Name A-Z'}
											</span>
										</SelectTrigger>
										<SelectContent align="start">
											<SelectItem value="relevance">Default order</SelectItem>
											<SelectItem value="price_input_asc">Cheapest input</SelectItem>
											<SelectItem value="price_output_asc">Cheapest output</SelectItem>
											<SelectItem value="name_asc">Name A-Z</SelectItem>
										</SelectContent>
									</Select>
									{hasToolCallingMetadata ? (
										<Button
											type="button"
											variant={toolCallingOnly ? 'default' : 'outline'}
											size="sm"
											onClick={() => setToolCallingOnly((prev) => !prev)}
											className="h-8 text-xs"
										>
											Tool calling only
										</Button>
									) : null}
								</div>
							</div>
						</div>
						<div className="max-h-80 overflow-y-auto p-1">
							{filteredModels.length > 0 ? (
								filteredModels.map((model) => {
									const isSelected = model.id === selectedModel
									return (
										<button
											key={model.id}
											type="button"
											onClick={() => {
												setSelectedModel(model.id)
												setModelPickerOpen(false)
												setModelQuery('')
											}}
											className={cn(
												'flex w-full items-start justify-between gap-3 rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
												isSelected && 'bg-accent/60',
											)}
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate">
													{model.name}
													{model.supportsTools === true ? ' · tools' : ''}
												</span>
												{(model.pricing.input > 0 || model.pricing.output > 0) && (
													<span className="block text-xs text-muted-foreground">
														{model.pricing.input}/{model.pricing.output} sats/M tokens
													</span>
												)}
											</span>
											{isSelected ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : null}
										</button>
									)
								})
							) : (
								<div className="px-2 py-3 text-sm text-muted-foreground">No models found.</div>
							)}
						</div>
					</PopoverContent>
				</Popover>
				{modelsError ? <p className="text-xs text-destructive">{modelsError}</p> : null}
			</div>

			<div className="rounded-lg border bg-card p-3">
				<Button
					type="button"
					variant="ghost"
					onClick={() => setToolsEnabled(!toolsEnabled)}
					className={cn(
						'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors h-auto',
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
				</Button>
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
