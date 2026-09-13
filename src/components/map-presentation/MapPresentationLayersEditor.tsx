import { ArrowDown, ArrowUp, Eye, EyeOff, Layers3, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
	authorizePresentationLayer,
	type MapPresentationAuthorization,
	type MapPresentationLayerV1,
	type MapPresentationLineDashV1,
	type MapPresentationSource,
	type MapPresentationV1,
} from '@/lib/map-presentation'
import {
	addPresentationLayer,
	movePresentationLayer,
	parseFeatureIds,
	removePresentationLayer,
	updateLayerStyle,
	updatePresentationLayer,
	withoutLayerFeatureIds,
	withoutLayerStyle,
	type PresentationSourceOption,
} from '@/lib/map-presentation/authoring'

interface PresentationLayerLabels {
	sourcePlaceholder: string
	sourceSelect: string
	help: string
	empty: string
	unauthorized: string
	hide: string
	show: string
	moveDown: string
	moveUp: string
	featureIds: string
}

function parseLineDash(value: string): MapPresentationLineDashV1 | undefined {
	return value === 'solid' || value === 'dashed' || value === 'dotted' ? value : undefined
}

export function MapPresentationLayersEditor({
	presentation,
	authorization,
	options,
	onChange,
	idPrefix,
	labels,
	layerDescription,
}: {
	presentation: MapPresentationV1
	authorization: MapPresentationAuthorization
	options: readonly PresentationSourceOption[]
	onChange: (presentation: MapPresentationV1) => void
	idPrefix: string
	labels: PresentationLayerLabels
	layerDescription?: (layer: MapPresentationLayerV1, index: number) => ReactNode
}) {
	const [selectedSource, setSelectedSource] = useState('')
	const updateLayer = (index: number, layer: MapPresentationLayerV1) => {
		onChange(updatePresentationLayer(presentation, index, layer))
	}
	const addLayer = () => {
		const option = options.find((entry) => entry.source === selectedSource)
		if (!option) return
		onChange(addPresentationLayer(presentation, option.source, authorization))
		setSelectedSource('')
	}
	const featureCount = (source: MapPresentationSource) => {
		const grant = authorization.get(source)
		return grant?.scope === 'features' ? grant.featureIds.length : 0
	}
	return (
		<>
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<select
						value={selectedSource}
						aria-label={labels.sourceSelect}
						onChange={(event) => setSelectedSource(event.target.value)}
						className="h-8 min-w-0 flex-1 border border-border bg-background px-2 text-xs text-foreground"
					>
						<option value="">{labels.sourcePlaceholder}</option>
						{options.map((option) => (
							<option key={option.source} value={option.source}>
								{option.label}
								{authorization.get(option.source)?.scope === 'features'
									? ` · ${featureCount(option.source)} cited features`
									: ''}
							</option>
						))}
					</select>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 gap-1 rounded-none px-2 text-xs"
						onClick={addLayer}
						disabled={!selectedSource}
					>
						<Plus className="h-3.5 w-3.5" />
						Add layer
					</Button>
				</div>
				<p className="text-[10px] text-muted-foreground">{labels.help}</p>
			</div>

			<div className="space-y-2">
				{presentation.layers.length === 0 && (
					<p className="border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
						{labels.empty}
					</p>
				)}
				{presentation.layers.map((layer, index) => {
					const grant = authorization.get(layer.source)
					const authorizationResult = authorizePresentationLayer(layer, authorization)
					const controlPrefix = `${idPrefix}-${index}`
					return (
						<div key={layer.id} className="space-y-3 border border-border bg-background px-3 py-2">
							<div className="flex items-start gap-2">
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="h-7 w-7 flex-shrink-0 rounded-none"
									onClick={() => updateLayer(index, { ...layer, visible: !layer.visible })}
									aria-label={layer.visible ? labels.hide : labels.show}
								>
									{layer.visible ? (
										<Eye className="h-3.5 w-3.5" />
									) : (
										<EyeOff className="h-3.5 w-3.5" />
									)}
								</Button>
								<div className="min-w-0 flex-1">
									<Input
										value={layer.id}
										onChange={(event) => updateLayer(index, { ...layer, id: event.target.value })}
										className="h-7 rounded-none font-mono text-xs"
										aria-label="Stable presentation layer id"
									/>
									<p
										className={
											layerDescription
												? 'mt-1 truncate text-[10px] text-muted-foreground'
												: 'mt-1 truncate font-mono text-[9px] text-muted-foreground'
										}
										title={layer.source}
									>
										{layerDescription?.(layer, index) ?? layer.source}
									</p>
								</div>
								<div className="flex flex-shrink-0 items-center gap-0.5">
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										disabled={index === 0}
										onClick={() => onChange(movePresentationLayer(presentation, index, index - 1))}
										aria-label={labels.moveDown}
									>
										<ArrowUp className="h-3.5 w-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										disabled={index === presentation.layers.length - 1}
										onClick={() => onChange(movePresentationLayer(presentation, index, index + 1))}
										aria-label={labels.moveUp}
									>
										<ArrowDown className="h-3.5 w-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none text-muted-foreground hover:text-destructive"
										onClick={() => onChange(removePresentationLayer(presentation, index))}
										aria-label="Remove layer"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</Button>
								</div>
							</div>

							{authorizationResult.status !== 'authorized' && (
								<p className="border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] text-foreground">
									{labels.unauthorized}
								</p>
							)}

							<div className="grid gap-3 sm:grid-cols-2">
								<label className="space-y-1 text-[10px] text-muted-foreground">
									<span className="flex items-center justify-between">
										Opacity <span className="font-mono">{layer.opacityMultiplier.toFixed(2)}</span>
									</span>
									<input
										type="range"
										aria-label={`Opacity for ${layer.id}`}
										min="0"
										max="1"
										step="0.05"
										value={layer.opacityMultiplier}
										onChange={(event) =>
											updateLayer(index, {
												...layer,
												opacityMultiplier: Number(event.target.value),
											})
										}
										className="w-full"
									/>
								</label>
								<label className="space-y-1 text-[10px] text-muted-foreground">
									<span>Feature scope</span>
									<select
										value={layer.featureIds === undefined ? 'whole' : 'features'}
										disabled={grant?.scope === 'features'}
										onChange={(event) =>
											updateLayer(
												index,
												event.target.value === 'whole'
													? withoutLayerFeatureIds(layer)
													: { ...layer, featureIds: [] },
											)
										}
										className="h-8 w-full border border-border bg-background px-2 text-xs text-foreground"
									>
										<option value="whole">Whole Map</option>
										<option value="features">Selected features</option>
									</select>
								</label>
							</div>
							{layer.featureIds !== undefined && (
								<Label
									htmlFor={`${controlPrefix}-features`}
									className="block space-y-1 text-[10px] font-normal text-muted-foreground"
								>
									<span>{labels.featureIds}</span>
									<Textarea
										id={`${controlPrefix}-features`}
										value={layer.featureIds.join(', ')}
										onChange={(event) =>
											updateLayer(index, {
												...layer,
												featureIds: parseFeatureIds(event.target.value),
											})
										}
										rows={2}
										className="rounded-none font-mono text-xs"
									/>
								</Label>
							)}

							<details className="border-t border-border pt-2">
								<summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									<Layers3 className="h-3 w-3" /> Style override
								</summary>
								<div className="mt-2 grid gap-2 sm:grid-cols-3">
									{(['color', 'fillColor', 'strokeColor'] as const).map((key) => (
										<Label
											key={key}
											htmlFor={`${controlPrefix}-${key}`}
											className="space-y-1 text-[9px] font-normal text-muted-foreground"
										>
											<span>{key}</span>
											<Input
												id={`${controlPrefix}-${key}`}
												value={layer.style?.[key] ?? ''}
												onChange={(event) =>
													updateLayer(
														index,
														updateLayerStyle(layer, key, event.target.value || undefined),
													)
												}
												placeholder="author style"
												className="h-7 rounded-none px-2 text-[10px]"
											/>
										</Label>
									))}
									{(['fillOpacity', 'strokeOpacity', 'strokeWidth', 'radius'] as const).map(
										(key) => (
											<Label
												key={key}
												htmlFor={`${controlPrefix}-${key}`}
												className="space-y-1 text-[9px] font-normal text-muted-foreground"
											>
												<span>{key}</span>
												<Input
													id={`${controlPrefix}-${key}`}
													type="number"
													step={key.includes('Opacity') ? '0.05' : '0.5'}
													min={key.includes('Opacity') ? '0' : '0.1'}
													max={key.includes('Opacity') ? '1' : undefined}
													value={layer.style?.[key] ?? ''}
													onChange={(event) =>
														updateLayer(
															index,
															updateLayerStyle(
																layer,
																key,
																event.target.value === '' ? undefined : Number(event.target.value),
															),
														)
													}
													className="h-7 rounded-none px-2 text-[10px]"
												/>
											</Label>
										),
									)}
									<label className="space-y-1 text-[9px] text-muted-foreground">
										<span>lineDash</span>
										<select
											value={layer.style?.lineDash ?? ''}
											onChange={(event) =>
												updateLayer(
													index,
													updateLayerStyle(layer, 'lineDash', parseLineDash(event.target.value)),
												)
											}
											className="h-7 w-full border border-border bg-background px-2 text-[10px] text-foreground"
										>
											<option value="">author style</option>
											<option value="solid">solid</option>
											<option value="dashed">dashed</option>
											<option value="dotted">dotted</option>
										</select>
									</label>
									{(['arrowStart', 'arrowEnd'] as const).map((key) => (
										<label key={key} className="space-y-1 text-[9px] text-muted-foreground">
											<span>{key}</span>
											<select
												value={layer.style?.[key] === undefined ? '' : String(layer.style[key])}
												onChange={(event) =>
													updateLayer(
														index,
														updateLayerStyle(
															layer,
															key,
															event.target.value === '' ? undefined : event.target.value === 'true',
														),
													)
												}
												className="h-7 w-full border border-border bg-background px-2 text-[10px] text-foreground"
											>
												<option value="">author style</option>
												<option value="true">on</option>
												<option value="false">off</option>
											</select>
										</label>
									))}
									<Label
										htmlFor={`${controlPrefix}-displayIcon`}
										className="space-y-1 text-[9px] font-normal text-muted-foreground sm:col-span-2"
									>
										<span>displayIcon</span>
										<Input
											id={`${controlPrefix}-displayIcon`}
											value={layer.style?.displayIcon ?? ''}
											onChange={(event) =>
												updateLayer(
													index,
													updateLayerStyle(layer, 'displayIcon', event.target.value || undefined),
												)
											}
											placeholder="lucide:map-pin"
											className="h-7 rounded-none px-2 font-mono text-[10px]"
										/>
									</Label>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 gap-1 self-end rounded-none text-[10px]"
										onClick={() => updateLayer(index, withoutLayerStyle(layer))}
										disabled={!layer.style}
									>
										<RotateCcw className="h-3 w-3" /> Use author styling
									</Button>
								</div>
							</details>
						</div>
					)
				})}
			</div>
		</>
	)
}
