import {
	ArrowDown,
	ArrowUp,
	Camera,
	ChevronDown,
	Layers3,
	Map as MapIcon,
	Play,
	RotateCcw,
	Trash2,
} from 'lucide-react'
import { createContext, useContext, useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	MAP_PRESENTATION_LIMITS,
	type MapPresentationLayerV1,
	type MapPresentationStyleOverrideV1,
	type StoryViewBlockV1,
} from '@/lib/map-presentation'
import type { StoryViewCapture } from './GeoMentionExtension'
import {
	acceptStoryViewEdit,
	removeStoryViewLayerPatch,
	updateStoryViewLayerPatch,
	updateStoryViewStyle,
} from './storyViewEditing'

/** React node-view portals inherit this, so opening-layer edits update in place. */
export const StoryViewLayersContext = createContext<readonly MapPresentationLayerV1[]>([])

const fieldClass =
	'h-8 w-full min-w-0 border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary disabled:opacity-70'
const labelClass = 'block text-[10px] font-medium text-muted-foreground'
const actionClass = 'h-7 gap-1 rounded-none px-2 text-[10px]'

interface NumberFieldProps {
	label: string
	value: number | undefined
	onChange: (value: number | undefined) => void
	min: number
	max: number
	step?: number
	optional?: boolean
	disabled?: boolean
}

function NumberField({
	label,
	value,
	onChange,
	min,
	max,
	step = 0.1,
	optional = false,
	disabled,
}: NumberFieldProps) {
	const [draft, setDraft] = useState(value?.toString() ?? '')
	useEffect(() => setDraft(value?.toString() ?? ''), [value])
	const valid =
		draft === ''
			? optional
			: Number.isFinite(Number(draft)) && Number(draft) >= min && Number(draft) <= max
	return (
		<label className="space-y-1">
			<span className={labelClass}>{label}</span>
			<input
				type="number"
				value={draft}
				min={min}
				max={max}
				step={step}
				disabled={disabled}
				placeholder={optional ? 'Inherit' : undefined}
				aria-invalid={!valid}
				className={fieldClass}
				onChange={(event) => {
					const next = event.target.value
					setDraft(next)
					if (next === '') {
						if (optional) onChange(undefined)
						return
					}
					const number = Number(next)
					if (Number.isFinite(number) && number >= min && number <= max) onChange(number)
				}}
				onBlur={() => {
					if (!valid) setDraft(value?.toString() ?? '')
				}}
			/>
		</label>
	)
}

/** Text style values need a local buffer so partial CSS colors are not discarded. */
function StyleTextField({
	label,
	value,
	disabled,
	onCommit,
	placeholder,
}: {
	label: string
	value: string | undefined
	disabled: boolean
	placeholder: string
	onCommit: (value: string | undefined) => boolean
}) {
	const fieldId = useId()
	const [draft, setDraft] = useState(value ?? '')
	const [invalid, setInvalid] = useState(false)
	useEffect(() => {
		setDraft(value ?? '')
		setInvalid(false)
	}, [value])
	return (
		<label htmlFor={fieldId} className="space-y-1">
			<span id={`${fieldId}-label`} className={labelClass}>
				{label}
			</span>
			<input
				id={fieldId}
				value={draft}
				disabled={disabled}
				placeholder={placeholder}
				aria-invalid={invalid}
				aria-labelledby={`${fieldId}-label`}
				aria-describedby={invalid ? `${fieldId}-error` : undefined}
				className={fieldClass}
				onChange={(event) => {
					setDraft(event.target.value)
					setInvalid(!onCommit(event.target.value.trim() || undefined))
				}}
			/>
			{invalid && (
				<span id={`${fieldId}-error`} className="text-[10px] text-destructive">
					Use a valid {label.toLowerCase()}, or clear to inherit.
				</span>
			)}
		</label>
	)
}

interface StoryViewBlockEditorProps {
	view: StoryViewBlockV1
	editable: boolean
	onChange: (view: StoryViewBlockV1) => void
	onCapture?: () => StoryViewCapture | null | undefined
	onActivate?: (view: StoryViewBlockV1) => void
	onRemove?: () => void
	onMove?: (direction: -1 | 1) => void
	canMoveUp?: boolean
	canMoveDown?: boolean
}

export function StoryViewBlockEditor({
	view,
	editable,
	onChange,
	onCapture,
	onActivate,
	onRemove,
	onMove,
	canMoveUp,
	canMoveDown,
}: StoryViewBlockEditorProps) {
	const baseLayers = useContext(StoryViewLayersContext)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const settingsId = useId()
	const layerIds = [
		...new Set([...baseLayers.map((layer) => layer.id), ...Object.keys(view.layers ?? {})]),
	]
	const commit = (candidate: StoryViewBlockV1) => {
		const accepted = acceptStoryViewEdit(candidate)
		if (!accepted) return false
		onChange(accepted)
		return true
	}
	const setCameraField = (
		key: 'longitude' | 'latitude' | 'zoom' | 'bearing' | 'pitch',
		value: number | undefined,
	) => {
		if (!view.camera) return
		if (key === 'longitude' || key === 'latitude') {
			if (value === undefined) return
			const center: [number, number] = [...view.camera.center]
			center[key === 'longitude' ? 0 : 1] = value
			commit({ ...view, camera: { ...view.camera, center } })
		} else {
			const camera = { ...view.camera }
			if (key === 'zoom') {
				if (value !== undefined) camera.zoom = value
			} else if (value === undefined) delete camera[key]
			else camera[key] = value
			commit({ ...view, camera })
		}
	}
	return (
		<div className="not-prose space-y-3 whitespace-normal">
			<div className="flex items-start gap-2">
				<MapIcon className="mt-1.5 h-4 w-4 shrink-0 text-primary" />
				<div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
					<label className="space-y-1">
						<span className={labelClass}>View title</span>
						<input
							value={view.title}
							disabled={!editable}
							maxLength={MAP_PRESENTATION_LIMITS.viewTitleLength}
							className={fieldClass}
							onChange={(event) =>
								commit({ ...view, title: event.target.value || 'Untitled view' })
							}
						/>
					</label>
					<label className="space-y-1">
						<span className={labelClass}>Display</span>
						<select
							value={view.display}
							disabled={!editable}
							className={fieldClass}
							onChange={(event) =>
								commit({ ...view, display: event.target.value as StoryViewBlockV1['display'] })
							}
						>
							<option value="cue">Main map cue</option>
							<option value="figure">Figure only</option>
							<option value="both">Cue and figure</option>
						</select>
					</label>
				</div>
				{editable && (
					<div className="flex shrink-0 flex-col gap-1">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="h-7 w-7 rounded-none"
							disabled={!canMoveUp}
							onClick={() => onMove?.(-1)}
							aria-label="Move Story view up"
						>
							<ArrowUp className="h-3.5 w-3.5" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="h-7 w-7 rounded-none"
							disabled={!canMoveDown}
							onClick={() => onMove?.(1)}
							aria-label="Move Story view down"
						>
							<ArrowDown className="h-3.5 w-3.5" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="h-7 w-7 rounded-none text-muted-foreground hover:text-destructive"
							onClick={onRemove}
							aria-label="Remove Story view"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</Button>
					</div>
				)}
			</div>
			<p className="text-[11px] text-muted-foreground">
				{view.display === 'figure'
					? 'An inline figure only. This does not change the main map or later views.'
					: view.display === 'both'
						? 'An inline figure and a main-map cue. Later cues inherit these changes.'
						: 'A main-map cue at this point in the prose. Later cues inherit these changes.'}
			</p>
			<label className="block space-y-1">
				<span className={labelClass}>Caption</span>
				<input
					value={view.caption ?? ''}
					disabled={!editable}
					maxLength={MAP_PRESENTATION_LIMITS.viewCaptionLength}
					className={fieldClass}
					placeholder="Optional figure caption"
					onChange={(event) => {
						const { caption: _caption, ...rest } = view
						commit(event.target.value.trim() ? { ...rest, caption: event.target.value } : rest)
					}}
				/>
			</label>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className={actionClass}
					aria-expanded={settingsOpen}
					aria-controls={settingsId}
					onClick={() => setSettingsOpen(!settingsOpen)}
				>
					<Layers3 className="h-3 w-3" /> Camera and layers <ChevronDown className="h-3 w-3" />
				</Button>
				{onCapture && editable && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className={actionClass}
						onClick={() => {
							const captured = onCapture()
							if (!captured) return
							commit({
								...view,
								...(captured.camera ? { camera: captured.camera } : {}),
								...(captured.layers ? { layers: captured.layers } : {}),
							})
						}}
					>
						<Camera className="h-3 w-3" /> Capture current map
					</Button>
				)}
				{onActivate && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className={actionClass}
						onClick={() => onActivate(view)}
					>
						<Play className="h-3 w-3" />
						{view.display === 'figure' ? 'Preview figure' : 'Apply view'}
					</Button>
				)}
				<span className="text-[10px] text-muted-foreground">
					{view.camera ? `Zoom ${view.camera.zoom.toFixed(1)}` : 'Camera inherited'} ·{' '}
					{Object.keys(view.layers ?? {}).length} layer changes
				</span>
			</div>
			{settingsOpen && (
				<div id={settingsId} className="space-y-3 border-t border-border pt-3">
					<fieldset className="space-y-2">
						<legend className="text-xs font-semibold">Camera</legend>
						{view.camera ? (
							<>
								<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
									<NumberField
										label="Longitude"
										value={view.camera.center[0]}
										min={-180}
										max={180}
										step={0.0001}
										disabled={!editable}
										onChange={(value) => setCameraField('longitude', value)}
									/>
									<NumberField
										label="Latitude"
										value={view.camera.center[1]}
										min={-90}
										max={90}
										step={0.0001}
										disabled={!editable}
										onChange={(value) => setCameraField('latitude', value)}
									/>
									<NumberField
										label="Zoom"
										value={view.camera.zoom}
										min={0}
										max={24}
										disabled={!editable}
										onChange={(value) => setCameraField('zoom', value)}
									/>
									<NumberField
										label="Bearing"
										value={view.camera.bearing}
										min={-180}
										max={180}
										optional
										disabled={!editable}
										onChange={(value) => setCameraField('bearing', value)}
									/>
									<NumberField
										label="Pitch"
										value={view.camera.pitch}
										min={0}
										max={85}
										optional
										disabled={!editable}
										onChange={(value) => setCameraField('pitch', value)}
									/>
								</div>
								{editable && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className={actionClass}
										onClick={() => {
											const { camera: _camera, ...rest } = view
											commit(rest)
										}}
									>
										<RotateCcw className="h-3 w-3" /> Inherit camera
									</Button>
								)}
							</>
						) : (
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-[11px] text-muted-foreground">
									Use the preceding main-map cue or opening camera.
								</span>
								{editable && (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className={actionClass}
										onClick={() =>
											commit({
												...view,
												camera: onCapture?.()?.camera ?? { center: [0, 0], zoom: 2 },
											})
										}
									>
										Set camera
									</Button>
								)}
							</div>
						)}
					</fieldset>
					<fieldset className="space-y-2">
						<legend className="text-xs font-semibold">Layer changes</legend>
						<p className="text-[11px] text-muted-foreground">
							Inherit keeps the preceding cue or opening value. Only explicit changes are stored;
							sources and feature selections stay in the opening map.
						</p>
						{!layerIds.length && (
							<p className="text-xs text-muted-foreground">
								Add layers to the Opening map below to control them here.
							</p>
						)}
						{layerIds.map((layerId) => (
							<StoryViewLayerEditor
								key={layerId}
								layerId={layerId}
								view={view}
								exists={baseLayers.some((layer) => layer.id === layerId)}
								editable={editable}
								commit={commit}
							/>
						))}
					</fieldset>
				</div>
			)}
		</div>
	)
}

function StoryViewLayerEditor({
	layerId,
	view,
	exists,
	editable,
	commit,
}: {
	layerId: string
	view: StoryViewBlockV1
	exists: boolean
	editable: boolean
	commit: (view: StoryViewBlockV1) => boolean
}) {
	const patch = view.layers?.[layerId]
	const style = patch?.style
	const [expanded, setExpanded] = useState(false)
	const styleField = <K extends keyof MapPresentationStyleOverrideV1>(
		key: K,
		value: MapPresentationStyleOverrideV1[K] | undefined,
	) => commit(updateStoryViewStyle(view, layerId, key, value))
	return (
		<fieldset className="min-w-0 space-y-2 border border-border p-2">
			<legend className="max-w-full truncate px-1 font-mono text-[11px]" title={layerId}>
				{layerId}
			</legend>
			{!exists && (
				<p className="text-[11px] text-warning">
					This layer is missing from the opening map. Its changes are retained but cannot render
					until the same layer ID returns.
				</p>
			)}
			<div className="grid grid-cols-2 gap-2">
				<label className="space-y-1">
					<span className={labelClass}>Visibility</span>
					<select
						className={fieldClass}
						disabled={!editable}
						value={patch?.visible === undefined ? 'inherit' : patch.visible ? 'show' : 'hide'}
						onChange={(event) =>
							commit(
								updateStoryViewLayerPatch(
									view,
									layerId,
									'visible',
									event.target.value === 'inherit' ? undefined : event.target.value === 'show',
								),
							)
						}
					>
						<option value="inherit">Inherit</option>
						<option value="show">Show</option>
						<option value="hide">Hide</option>
					</select>
				</label>
				<NumberField
					label="Opacity multiplier"
					value={patch?.opacityMultiplier}
					min={0}
					max={1}
					step={0.05}
					optional
					disabled={!editable}
					onChange={(value) =>
						commit(updateStoryViewLayerPatch(view, layerId, 'opacityMultiplier', value))
					}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className={actionClass}
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
				>
					Style overrides{style ? ` · ${Object.keys(style).length}` : ''}
					<ChevronDown className="h-3 w-3" />
				</Button>
				{editable && patch && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className={actionClass}
						onClick={() => commit(removeStoryViewLayerPatch(view, layerId))}
					>
						<RotateCcw className="h-3 w-3" /> Inherit all layer settings
					</Button>
				)}
			</div>
			{expanded && (
				<div className="space-y-2 border-t border-border pt-2">
					<div className="grid grid-cols-2 gap-2">
						{(
							[
								['color', 'Color'],
								['fillColor', 'Fill color'],
								['strokeColor', 'Stroke color'],
							] as const
						).map(([key, label]) => (
							<StyleTextField
								key={key}
								label={label}
								value={style?.[key]}
								disabled={!editable}
								placeholder="Inherit · CSS color"
								onCommit={(value) => styleField(key, value)}
							/>
						))}
						{(
							[
								['fillOpacity', 'Fill opacity', 0, 1],
								['strokeOpacity', 'Stroke opacity', 0, 1],
								['strokeWidth', 'Stroke width', 0.01, 64],
								['radius', 'Point radius', 0.01, 128],
							] as const
						).map(([key, label, min, max]) => (
							<NumberField
								key={key}
								label={label}
								value={style?.[key]}
								min={min}
								max={max}
								optional
								disabled={!editable}
								onChange={(value) => styleField(key, value)}
							/>
						))}
						<label className="space-y-1">
							<span className={labelClass}>Line dash</span>
							<select
								className={fieldClass}
								disabled={!editable}
								value={style?.lineDash ?? ''}
								onChange={(event) =>
									styleField(
										'lineDash',
										(event.target.value || undefined) as MapPresentationStyleOverrideV1['lineDash'],
									)
								}
							>
								<option value="">Inherit</option>
								<option value="solid">Solid</option>
								<option value="dashed">Dashed</option>
								<option value="dotted">Dotted</option>
							</select>
						</label>
						{(
							[
								['arrowStart', 'Start arrow'],
								['arrowEnd', 'End arrow'],
							] as const
						).map(([key, label]) => (
							<label key={key} className="space-y-1">
								<span className={labelClass}>{label}</span>
								<select
									className={fieldClass}
									disabled={!editable}
									value={style?.[key] === undefined ? '' : String(style[key])}
									onChange={(event) =>
										styleField(
											key,
											event.target.value === '' ? undefined : event.target.value === 'true',
										)
									}
								>
									<option value="">Inherit</option>
									<option value="true">Show</option>
									<option value="false">Hide</option>
								</select>
							</label>
						))}
						<StyleTextField
							label="Display icon"
							value={style?.displayIcon}
							disabled={!editable}
							placeholder="Inherit · lucide:map-pin"
							onCommit={(value) => styleField('displayIcon', value)}
						/>
					</div>
					{editable && style && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={actionClass}
							onClick={() => commit(updateStoryViewLayerPatch(view, layerId, 'style', undefined))}
						>
							<RotateCcw className="h-3 w-3" /> Inherit styling
						</Button>
					)}
				</div>
			)}
		</fieldset>
	)
}
