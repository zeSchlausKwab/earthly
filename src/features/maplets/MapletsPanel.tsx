import { useEffect, useId, useMemo, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import type { Feature, FeatureCollection } from 'geojson'
import {
	ArrowDownToLine,
	Check,
	ChevronRight,
	Copy,
	Crosshair,
	Eye,
	EyeOff,
	Layers2,
	LoaderCircle,
	Plus,
	Radio,
	RefreshCw,
	Settings2,
	X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MapletCollectionDirectory } from './MapletCollectionDirectory'

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
	onFollowCollection?: (address: string) => Promise<void>
	collectionDiscoveryEnabled?: boolean
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

function featureName(feature: Feature, index: number): string {
	const properties = feature.properties ?? {}
	for (const value of [properties.name, properties.title, properties.label]) {
		if (typeof value === 'string' && value.trim()) return value
	}
	return `Geometry ${index + 1}`
}

function InstanceCard({
	instance,
	definition,
	panel,
}: {
	instance: MapletInstanceView
	definition?: MapletCatalogItem
	panel: MapletsPanelProps
}) {
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [featuresOpen, setFeaturesOpen] = useState(true)
	const [selection, setSelection] = useState<Set<string>>(() => new Set())
	const features = instance.collection.features
	const selectableIds = useMemo(
		() => features.flatMap((feature) => (feature.id === undefined ? [] : [String(feature.id)])),
		[features],
	)
	const selectedIds = selectableIds.filter((id) => selection.has(id))
	const outputSource =
		features.length > 0 ? (instance.outputSource ?? instance.config.source) : instance.config.source
	const sample = outputSource === 'sample'
	const statusLabel =
		instance.status === 'loading'
			? 'Refreshing'
			: instance.status === 'stale'
				? 'Last saved result'
				: instance.status === 'error'
					? 'Source unavailable'
					: sample
						? 'Captured sample'
						: outputSource === 'live'
							? 'Live source'
							: 'Layer ready'
	useEffect(() => {
		if (panel.settingsRequest?.instanceId === instance.id) setSettingsOpen(true)
	}, [panel.settingsRequest, instance.id])
	useEffect(() => {
		if (panel.selectedFeature?.instanceId !== instance.id) return
		const featureId = panel.selectedFeature.featureId
		setFeaturesOpen(true)
		setSelection((previous) => new Set([...previous, featureId]))
	}, [panel.selectedFeature?.instanceId, panel.selectedFeature?.featureId, instance.id])
	return (
		<article
			aria-label={`${instance.title} Maplet`}
			className="overflow-hidden rounded-sm border border-border bg-card/60"
		>
			<header className="px-3 pt-3">
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0">
						<h3 className="text-sm font-semibold tracking-tight">{instance.title}</h3>
						<p
							role="status"
							className={cn(
								'mt-1.5 flex items-center gap-1.5 text-[10px]',
								instance.status === 'error' || instance.status === 'stale'
									? 'text-amber-700 dark:text-amber-400'
									: 'text-muted-foreground',
							)}
						>
							{instance.status === 'loading' ? (
								<LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
							) : (
								<span
									className={cn(
										'size-1.5 rounded-full',
										instance.status === 'ready' && !sample
											? 'bg-ok'
											: instance.status === 'error' || instance.status === 'stale'
												? 'bg-amber-500'
												: 'bg-muted-foreground/60',
									)}
								/>
							)}
							{statusLabel}
							{features.length > 0 ? (
								<span className="font-mono">· {features.length} geometries</span>
							) : null}
						</p>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-10 shrink-0 md:size-7"
						onClick={() => panel.onRemove(instance.id)}
						aria-label={`Remove ${instance.title}`}
						title="Remove Maplet"
					>
						<X aria-hidden="true" />
					</Button>
				</div>
				{sample ? (
					<p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
						{instance.config.source === 'live'
							? 'This is the captured sample. A live result has not arrived yet.'
							: 'Preview from a captured dataset. Switch the data source in settings to request updates.'}
					</p>
				) : null}
				{instance.error ? (
					<div
						role="alert"
						className="mt-3 border-l-2 border-amber-500 bg-amber-500/5 px-2.5 py-2 text-xs leading-relaxed"
					>
						<p>{instance.error}</p>
						{features.length > 0 ? (
							<p className="mt-1 text-muted-foreground">Your last result is still on the map.</p>
						) : null}
					</div>
				) : null}
				<div className="my-2 flex flex-wrap items-center gap-0.5">
					{panel.onOpenWorkspace ? (
						<Button
							type="button"
							variant="outline"
							className={smallActionClass}
							onClick={() => panel.onOpenWorkspace?.(instance.id)}
							aria-label={`Open ${instance.title} workspace`}
						>
							<Layers2 aria-hidden="true" />
							Open workspace
						</Button>
					) : null}
					<Button
						type="button"
						variant="ghost"
						className={smallActionClass}
						aria-pressed={instance.visible}
						aria-label={`${instance.visible ? 'Hide' : 'Show'} ${instance.title} on map`}
						onClick={() => panel.onToggleVisibility(instance.id)}
					>
						{instance.visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
						{instance.visible ? 'Visible' : 'Hidden'}
					</Button>
					<Button
						type="button"
						variant="ghost"
						className={smallActionClass}
						disabled={!features.length}
						onClick={() => panel.onFit(instance.id)}
						aria-label={`Fit ${instance.title} on map`}
					>
						<Crosshair aria-hidden="true" />
						Fit
					</Button>
					<Button
						type="button"
						variant="ghost"
						className={smallActionClass}
						disabled={instance.status === 'loading'}
						onClick={() => panel.onRefresh(instance.id)}
						aria-label={`Refresh ${instance.title}`}
					>
						<RefreshCw aria-hidden="true" />
						Refresh
					</Button>
					{Object.keys(record(definition?.schema?.properties)).length > 0 ? (
						<Button
							type="button"
							variant="ghost"
							className={smallActionClass}
							aria-expanded={settingsOpen}
							onClick={() => setSettingsOpen((open) => !open)}
							aria-label={`${instance.title} settings`}
						>
							<Settings2 aria-hidden="true" />
							Settings
						</Button>
					) : null}
				</div>
			</header>
			{settingsOpen ? (
				<MapletSettings
					instance={instance}
					definition={definition}
					onConfigure={panel.onConfigure}
					onClose={() => setSettingsOpen(false)}
				/>
			) : null}
			{features.length > 0 ? (
				<div className="border-t border-border">
					<button
						type="button"
						className="flex min-h-10 w-full items-center justify-between px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
						aria-expanded={featuresOpen}
						onClick={() => setFeaturesOpen((open) => !open)}
					>
						<span>Take geometry into your map</span>
						<ChevronRight
							className={cn('size-3 transition-transform', featuresOpen && 'rotate-90')}
							aria-hidden="true"
						/>
					</button>
					{featuresOpen ? (
						<div>
							<div className="flex items-center justify-between gap-2 px-3 pb-2 text-[10px] text-muted-foreground">
								<label className="flex min-h-8 cursor-pointer items-center gap-2">
									<input
										type="checkbox"
										aria-label={`Select all ${instance.title} geometry`}
										className="size-3.5 accent-primary"
										checked={
											selectableIds.length > 0 && selectedIds.length === selectableIds.length
										}
										onChange={(event) =>
											setSelection(new Set(event.target.checked ? selectableIds : []))
										}
									/>
									Select all
								</label>
								<span className="font-mono">{selectedIds.length} selected</span>
							</div>
							<ul className="max-h-60 overflow-y-auto border-y border-border/70">
								{features.slice(0, 200).map((feature, index) => {
									const id = feature.id === undefined ? undefined : String(feature.id)
									const name = featureName(feature, index)
									const selected = id !== undefined && selection.has(id)
									return (
										<li
											key={id ?? index}
											className={cn(
												'flex min-h-10 items-center gap-2.5 border-b border-border/50 px-3 last:border-0',
												selected && 'bg-primary/5',
											)}
										>
											<input
												type="checkbox"
												className="size-3.5 shrink-0 accent-primary"
												aria-label={`Select ${name}`}
												checked={selected}
												disabled={id === undefined}
												onChange={() => {
													if (id === undefined) return
													setSelection((previous) => {
														const next = new Set(previous)
														if (next.has(id)) next.delete(id)
														else next.add(id)
														return next
													})
												}}
											/>
											<button
												type="button"
												className="min-w-0 flex-1 py-2 text-left text-xs hover:text-primary disabled:cursor-default"
												disabled={!id || !panel.onSelectFeature}
												onClick={() => {
													if (id) panel.onSelectFeature?.(instance.id, id)
												}}
											>
												<span className="block truncate">{name}</span>
												<span className="mt-0.5 block font-mono text-[9px] text-muted-foreground">
													{feature.geometry?.type ?? 'No geometry'}
												</span>
											</button>
										</li>
									)
								})}
							</ul>
							{features.length > 200 ? (
								<p className="px-3 pt-2 text-[10px] text-muted-foreground">
									Showing the first 200 geometries. Select all includes all {features.length}.
								</p>
							) : null}
							<div className="p-3">
								<Button
									type="button"
									variant="outline"
									className={cn(smallActionClass, 'w-full justify-center')}
									disabled={!selectedIds.length}
									onClick={() => panel.onCopy(instance.id, selectedIds)}
								>
									<Copy aria-hidden="true" />
									Copy {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'selected'} to
									editor
								</Button>
								<p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
									An independent draft, ready to reshape and publish to Nostr. Source attribution
									stays with your copy.
								</p>
							</div>
						</div>
					) : null}
				</div>
			) : null}
			{instance.warnings.length > 0 ? (
				<details className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
					<summary className="cursor-pointer py-1">
						{instance.warnings.length} source {instance.warnings.length === 1 ? 'note' : 'notes'}
					</summary>
					<ul className="mt-2 space-y-1.5 break-words leading-relaxed">
						{[...new Set(instance.warnings)].map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</details>
			) : null}
			{instance.updatedAt ? (
				<p className="border-t border-border/60 px-3 py-2 font-mono text-[9px] text-muted-foreground">
					{sample ? 'Sample loaded' : 'Last received'}{' '}
					{new Date(instance.updatedAt).toLocaleTimeString([], {
						hour: '2-digit',
						minute: '2-digit',
					})}
				</p>
			) : null}
		</article>
	)
}

export function MapletsPanel(props: MapletsPanelProps) {
	const { catalog, instances, onAdd, onDiscover, discovering, discoveryError } = props
	const native = isTauri()
	const [adding, setAdding] = useState<string>()
	const [addError, setAddError] = useState<{ definitionId: string; message: string }>()
	const addMaplet = async (definitionId: string) => {
		setAdding(definitionId)
		setAddError(undefined)
		try {
			await onAdd(definitionId)
		} catch (error) {
			setAddError({
				definitionId,
				message: error instanceof Error ? error.message : 'Could not add this Maplet.',
			})
		} finally {
			setAdding(undefined)
		}
	}
	return (
		<section
			id="browse-maplets-panel"
			role="tabpanel"
			aria-label="Maplets"
			className="h-full min-h-0 overflow-y-auto pb-4 [scrollbar-gutter:stable]"
		>
			<header className="border-b border-border px-2 pb-4 pt-2">
				<div className="flex items-center justify-between">
					<span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
						Composable map data
					</span>
					<Layers2 className="size-4 text-primary" aria-hidden="true" />
				</div>
				<h2 className="mt-2 text-xl font-medium tracking-tight">A map that keeps moving.</h2>
				<p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
					Add a source, explore its layers, and make any geometry your own.
				</p>
			</header>
			{instances.length > 0 ? (
				<div className="space-y-3 pt-4">
					<div className="flex items-center justify-between px-2 text-[10px] text-muted-foreground">
						<h3 className="font-semibold uppercase tracking-[0.14em]">On your map</h3>
						<span className="font-mono">{instances.length.toString().padStart(2, '0')}</span>
					</div>
					{instances.map((instance) => (
						<InstanceCard
							key={instance.id}
							instance={instance}
							definition={catalog.find((item) => item.id === instance.definitionId)}
							panel={props}
						/>
					))}
				</div>
			) : null}
			{props.onFollowCollection ? (
				<MapletCollectionDirectory
					enabled={props.collectionDiscoveryEnabled}
					onFollow={props.onFollowCollection}
				/>
			) : null}
			<div className="pt-5">
				<div className="mb-2 flex items-center justify-between gap-2 px-2">
					<h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
						Maplet apps
					</h3>
					<Button
						type="button"
						variant="ghost"
						className={smallActionClass}
						disabled={discovering}
						onClick={onDiscover}
						aria-label="Discover Nostr Maplets"
					>
						{discovering ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : (
							<Radio aria-hidden="true" />
						)}
						Discover
					</Button>
				</div>
				{discoveryError ? (
					<p
						role="alert"
						className="mb-3 border-l-2 border-amber-500 px-3 py-2 text-xs leading-relaxed"
					>
						{discoveryError}
					</p>
				) : null}
				<div className="divide-y divide-border border-y border-border">
					{catalog.map((item) => {
						const added = instances.some((instance) => instance.definitionId === item.id)
						const unavailable = native && item.source === 'nostr'
						return (
							<article
								key={item.id}
								aria-label={`${item.title} catalog entry`}
								className="px-2 py-4"
							>
								<div className="flex items-start gap-3">
									<div className="flex size-9 shrink-0 items-center justify-center border border-border bg-primary/5 text-primary">
										<Layers2 className="size-4" aria-hidden="true" />
									</div>
									<div className="min-w-0 flex-1">
										<h4 className="text-sm font-semibold">{item.title}</h4>
										<p className="mt-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
											{item.source === 'bundled' ? 'Earthly app' : 'Published on Nostr'}
										</p>
									</div>
								</div>
								<p className="mt-3 text-xs leading-relaxed text-muted-foreground">
									{item.description}
								</p>
								{unavailable ? (
									<p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
										Third-party Maplet apps are currently available in the web app.
									</p>
								) : null}
								<div className="mt-3 flex items-center justify-between gap-2">
									<Button
										type="button"
										variant={added ? 'ghost' : 'outline'}
										className={smallActionClass}
										disabled={unavailable || added || adding !== undefined}
										onClick={() => void addMaplet(item.id)}
										aria-label={`Add ${item.title} to map`}
									>
										{adding === item.id ? (
											<LoaderCircle className="animate-spin" aria-hidden="true" />
										) : added ? (
											<Check aria-hidden="true" />
										) : (
											<Plus aria-hidden="true" />
										)}
										{adding === item.id ? 'Adding…' : added ? 'Added to map' : 'Add to map'}
									</Button>
									{item.author || item.releaseHash ? (
										<details className="min-w-0 text-right text-[10px] text-muted-foreground">
											<summary className="cursor-pointer py-2">Provenance</summary>
											<div className="max-w-52 break-all text-left font-mono text-[9px] leading-relaxed">
												{item.author ? <p>Author: {item.author}</p> : null}
												{item.releaseHash ? (
													<p className="mt-1">Release: {item.releaseHash}</p>
												) : null}
											</div>
										</details>
									) : null}
								</div>
								{addError?.definitionId === item.id ? (
									<p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">
										{addError.message}
									</p>
								) : null}
							</article>
						)
					})}
				</div>
				{!catalog.length ? (
					<p className="px-2 py-4 text-xs text-muted-foreground">
						Discover Maplets published to your Nostr relays.
					</p>
				) : null}
				<p className="mt-4 flex items-start gap-2 px-2 text-[10px] leading-relaxed text-muted-foreground">
					<ArrowDownToLine className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
					Use the Shelf to arrange these layers alongside the rest of your map.
				</p>
			</div>
		</section>
	)
}
