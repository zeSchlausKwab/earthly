import { useCallback, useEffect, useId, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import type { FeatureCollection } from 'geojson'
import { ArrowLeft, Check, ChevronRight, Layers2, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface MapletCatalogItem {
	id: string
	title: string
	description: string
	author?: string
	releaseHash?: string
	source: 'bundled' | 'nostr'
	schema?: Record<string, unknown>
}

export interface MapletInstanceView {
	id: string
	definitionId: string
	title: string
	status: 'loading' | 'ready' | 'stale' | 'error'
	error?: string
	warnings: string[]
	updatedAt?: number
	/** Source of retained geometry; configuration can already be requesting a different source. */
	outputSource?: 'sample' | 'live'
	collection: FeatureCollection
	config: Record<string, unknown>
	visible: boolean
}

export interface MapletsPanelProps {
	catalog: MapletCatalogItem[]
	instances: MapletInstanceView[]
	onAdd: (definitionId: string) => void | Promise<void>
	onRemove: (id: string) => void
	onToggleVisibility: (id: string) => void
	onRefresh: (id: string) => void
	onConfigure: (id: string, values: Record<string, unknown>) => void | Promise<void>
	onCopy: (id: string, featureIds?: string[]) => void
	onFit: (id: string) => void
	onOpenWorkspace?: (id: string) => void
	appOpen?: boolean
	onSurface?: (id: string, element: HTMLElement | null) => void
	onDiscover: () => void
	discovering?: boolean
	discoveryError?: string
	selectedFeature?: { instanceId: string; featureId: string }
	settingsRequest?: { instanceId: string; nonce: string }
	onSelectFeature?: (id: string, featureId: string) => void
}

const inputClass =
	'mt-1.5 min-h-10 w-full rounded-sm border border-input bg-background px-2.5 py-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 md:min-h-8'
const smallActionClass = 'min-h-10 rounded-sm px-2.5 text-[11px] md:min-h-8'

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

function fieldTitle(key: string, schema: Record<string, unknown>): string {
	return typeof schema.title === 'string'
		? schema.title
		: key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}

/** The host presents the supported schema; the runtime remains the validation boundary. */
function ConfigurationFields({
	schema,
	values,
	onChange,
	prefix,
	depth = 0,
}: {
	schema: Record<string, unknown>
	values: Record<string, unknown>
	onChange: (values: Record<string, unknown>) => void
	prefix: string
	depth?: number
}) {
	const properties = record(schema.properties)
	const required = Array.isArray(schema.required) ? schema.required : []
	return (
		<div className="space-y-4">
			{Object.entries(properties).map(([key, rawSchema]) => {
				const field = record(rawSchema)
				const title = fieldTitle(key, field)
				const id = `${prefix}-${key}`
				const value = values[key] ?? field.default
				const description = typeof field.description === 'string' ? field.description : undefined
				const update = (next: unknown) => onChange({ ...values, [key]: next })
				const choices = Array.isArray(field.enum) ? field.enum : undefined
				if (field.type === 'object' && depth < 4)
					return (
						<fieldset key={key} className="border-l border-border pl-3">
							<legend className="mb-3 text-xs font-medium">{title}</legend>
							<ConfigurationFields
								schema={field}
								values={record(value)}
								onChange={update}
								prefix={id}
								depth={depth + 1}
							/>
						</fieldset>
					)
				if (field.type === 'boolean' && !choices)
					return (
						<label
							key={key}
							htmlFor={id}
							className="flex min-h-10 cursor-pointer items-start gap-2.5"
						>
							<input
								id={id}
								type="checkbox"
								checked={value === true}
								onChange={(event) => update(event.target.checked)}
								className="mt-0.5 size-4 shrink-0 accent-primary"
							/>
							<span>
								<span className="block text-xs font-medium">{title}</span>
								{description ? (
									<span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
										{description}
									</span>
								) : null}
							</span>
						</label>
					)
				return (
					<div key={key}>
						<label htmlFor={id} className="text-xs font-medium">
							{title}
							{required.includes(key) ? <span className="text-muted-foreground"> *</span> : null}
						</label>
						{choices ? (
							<select
								id={id}
								className={inputClass}
								value={value === undefined ? '' : JSON.stringify(value)}
								required={required.includes(key)}
								onChange={(event) =>
									update(event.target.value ? JSON.parse(event.target.value) : undefined)
								}
							>
								{value === undefined ? <option value="">Choose…</option> : null}
								{choices.map((choice, index) => (
									<option key={JSON.stringify(choice)} value={JSON.stringify(choice)}>
										{Array.isArray(field.enumDescriptions) &&
										typeof field.enumDescriptions[index] === 'string'
											? field.enumDescriptions[index]
											: String(choice)}
									</option>
								))}
							</select>
						) : field.type === 'array' ? (
							<textarea
								id={id}
								className={inputClass}
								rows={3}
								defaultValue={Array.isArray(value) ? value.join('\n') : ''}
								placeholder="One value per line"
								onChange={(event) => {
									const itemType = record(field.items).type
									const lines = event.target.value === '' ? [] : event.target.value.split('\n')
									const valid = lines.every((line) =>
										itemType === 'boolean'
											? line === 'true' || line === 'false'
											: itemType === 'number' || itemType === 'integer'
												? line.trim() !== '' &&
													Number.isFinite(Number(line)) &&
													(itemType !== 'integer' || Number.isInteger(Number(line)))
												: true,
									)
									event.currentTarget.setCustomValidity(
										valid
											? ''
											: `Enter one ${itemType === 'boolean' ? 'true or false value' : itemType} per line.`,
									)
									if (!valid) return
									update(
										lines.map((line) =>
											itemType === 'number' || itemType === 'integer'
												? Number(line)
												: itemType === 'boolean'
													? line === 'true'
													: line,
										),
									)
								}}
							/>
						) : (
							<input
								id={id}
								className={inputClass}
								type={field.type === 'integer' || field.type === 'number' ? 'number' : 'text'}
								value={typeof value === 'string' || typeof value === 'number' ? value : ''}
								required={required.includes(key)}
								step={field.type === 'integer' ? 1 : 'any'}
								min={typeof field.minimum === 'number' ? field.minimum : undefined}
								max={typeof field.maximum === 'number' ? field.maximum : undefined}
								minLength={typeof field.minLength === 'number' ? field.minLength : undefined}
								maxLength={typeof field.maxLength === 'number' ? field.maxLength : undefined}
								onChange={(event) =>
									update(
										field.type === 'integer' || field.type === 'number'
											? event.target.value === ''
												? undefined
												: event.target.valueAsNumber
											: event.target.value,
									)
								}
							/>
						)}
						{description ? (
							<p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
								{description}
							</p>
						) : null}
					</div>
				)
			})}
		</div>
	)
}

function MapletSettings({
	instance,
	definition,
	onConfigure,
	onClose,
}: {
	instance: MapletInstanceView
	definition?: MapletCatalogItem
	onConfigure: MapletsPanelProps['onConfigure']
	onClose: () => void
}) {
	const [values, setValues] = useState(instance.config)
	const [error, setError] = useState<string>()
	const [saving, setSaving] = useState(false)
	const prefix = useId()
	useEffect(() => setValues(instance.config), [instance.config])
	const hasSettings =
		definition?.schema && Object.keys(record(definition.schema.properties)).length > 0
	return (
		<form
			aria-label={`${instance.title} settings`}
			className="border-t border-border bg-muted/20 p-3"
			onSubmit={async (event) => {
				event.preventDefault()
				setSaving(true)
				setError(undefined)
				try {
					await onConfigure(instance.id, values)
					onClose()
				} catch (reason) {
					setError(reason instanceof Error ? reason.message : 'Could not save these settings.')
				} finally {
					setSaving(false)
				}
			}}
		>
			<div className="mb-4 flex items-center justify-between gap-2">
				<h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					Configuration
				</h4>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onClick={onClose}
					aria-label="Close settings"
				>
					<X aria-hidden="true" />
				</Button>
			</div>
			{hasSettings && definition.schema ? (
				<ConfigurationFields
					schema={definition.schema}
					values={values}
					onChange={setValues}
					prefix={prefix}
				/>
			) : (
				<p className="text-xs text-muted-foreground">This Maplet has no configurable settings.</p>
			)}
			{error ? (
				<p role="alert" className="mt-3 text-xs text-destructive">
					{error}
				</p>
			) : null}
			{hasSettings ? (
				<div className="mt-4 flex items-center gap-2">
					<Button type="submit" disabled={saving} className={smallActionClass}>
						{saving ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : (
							<Check aria-hidden="true" />
						)}
						Apply settings
					</Button>
					<Button type="button" variant="ghost" className={smallActionClass} onClick={onClose}>
						Cancel
					</Button>
				</div>
			) : null}
		</form>
	)
}

/** Tool discovery lives here; configurations belong inside the selected Maplet. */
export function MapletsPanel(props: MapletsPanelProps) {
	const { catalog, instances, onAdd, onDiscover, discovering, discoveryError } = props
	const native = isTauri()
	const surfaceId = useId()
	const [query, setQuery] = useState('')
	const [opening, setOpening] = useState<string>()
	const [error, setError] = useState<string>()
	const [settingsId, setSettingsId] = useState<string>()
	const surface = useCallback(
		(element: HTMLElement | null) => {
			props.onSurface?.(surfaceId, element)
		},
		[props.onSurface, surfaceId],
	)
	useEffect(() => {
		if (props.settingsRequest) setSettingsId(props.settingsRequest.instanceId)
	}, [props.settingsRequest])
	const settings = instances.find((instance) => instance.id === settingsId)
	const visibleCatalog = catalog.filter((item) =>
		`${item.title} ${item.description} ${item.author ?? ''}`
			.toLowerCase()
			.includes(query.toLowerCase()),
	)
	const open = async (id: string) => {
		setOpening(id)
		setError(undefined)
		try {
			await onAdd(id)
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Could not open this Maplet.')
		} finally {
			setOpening(undefined)
		}
	}
	return (
		<section
			ref={surface}
			id="browse-maplets-panel"
			role="tabpanel"
			aria-label="Maplets"
			className="relative h-full min-h-0 min-w-0 overflow-hidden"
		>
			{props.appOpen ? (
				<div className="h-full" />
			) : (
				<div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
					{settings ? (
						<>
							<Button
								type="button"
								variant="ghost"
								className={smallActionClass}
								onClick={() => setSettingsId(undefined)}
							>
								<ArrowLeft aria-hidden="true" /> Maplets
							</Button>
							<MapletSettings
								instance={settings}
								definition={catalog.find((item) => item.id === settings.definitionId)}
								onConfigure={props.onConfigure}
								onClose={() => setSettingsId(undefined)}
							/>
						</>
					) : (
						<>
							<header className="border-b border-border px-3 pb-4 pt-3">
								<div className="flex items-center justify-between">
									<span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
										Browse
									</span>
									<Layers2 className="size-4 text-primary" aria-hidden="true" />
								</div>
								<h2 className="mt-2 text-lg font-semibold tracking-tight">Maplets</h2>
								<p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
									Tools that bring outside data onto your map.
								</p>
							</header>
							<div className="px-3 py-3">
								<input
									type="search"
									aria-label="Find a Maplet"
									placeholder="Find a Maplet"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									className={inputClass}
								/>
							</div>
							{visibleCatalog.map((item) => {
								const unavailable = native && item.source === 'nostr'
								return (
									<button
										key={item.id}
										type="button"
										aria-label={`Open ${item.title}`}
										disabled={!!opening || unavailable}
										onClick={() => void open(item.id)}
										className="block w-full border-b border-border px-3 py-4 text-left hover:bg-muted/50 disabled:cursor-default disabled:opacity-60"
									>
										<div className="flex min-w-0 items-center gap-3">
											<div className="flex size-9 shrink-0 items-center justify-center border border-border bg-muted/40">
												<Layers2 className="size-4" />
											</div>
											<div className="min-w-0 flex-1">
												<h3 className="truncate text-sm font-semibold">{item.title}</h3>
												<p className="mt-0.5 truncate text-[10px] text-muted-foreground">
													By{' '}
													{item.source === 'bundled'
														? 'Earthly'
														: item.author
															? `${item.author.slice(0, 12)}…`
															: 'Unknown developer'}
												</p>
											</div>
											{opening === item.id ? (
												<LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
											) : (
												<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
											)}
										</div>
										<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
											{item.description}
										</p>
										<div className="mt-3 flex items-center justify-between text-[9px] text-muted-foreground">
											<span>
												{item.id === 'my-maps-viewer'
													? 'Explore or create configurations'
													: 'Open Maplet'}
											</span>
											<span className="border border-border px-1.5 py-0.5">
												{item.source === 'bundled' ? 'Bundled' : 'Published'}
											</span>
										</div>
										{item.releaseHash ? (
											<span className="mt-2 block font-mono text-[9px] text-muted-foreground">
												Release {item.releaseHash.slice(0, 12)}
											</span>
										) : null}
									</button>
								)
							})}
							{!visibleCatalog.length ? (
								<p className="px-3 py-5 text-xs text-muted-foreground">No matching Maplets.</p>
							) : null}
							<div className="space-y-2 px-3 py-4">
								<div className="flex items-center justify-between">
									<span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
										Maplet discovery
									</span>
									<Button
										type="button"
										variant="ghost"
										className={smallActionClass}
										onClick={onDiscover}
										disabled={discovering}
									>
										{discovering ? (
											<LoaderCircle className="animate-spin" aria-hidden="true" />
										) : (
											<RefreshCw aria-hidden="true" />
										)}{' '}
										{discovering ? 'Discovering…' : 'Discover Maplets'}
									</Button>
								</div>
								<p className="text-[11px] leading-relaxed text-muted-foreground">
									Find tools published by other developers through your configured relays. Open a
									Maplet to explore its configurations.
								</p>
								{native ? (
									<p className="text-[11px] leading-relaxed text-muted-foreground">
										Third-party Maplets are currently available in the web app. GMapper works here.
									</p>
								) : null}
							</div>
						</>
					)}
					{error || discoveryError ? (
						<p role="alert" className="px-3 py-2 text-xs text-destructive">
							{error || discoveryError}
						</p>
					) : null}
				</div>
			)}
		</section>
	)
}
