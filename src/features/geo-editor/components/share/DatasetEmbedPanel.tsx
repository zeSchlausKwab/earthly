import { Check, Copy, Loader2 } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import type { NostrEvent } from 'nostr-tools'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { config } from '@/config'
import { DEFAULT_VIEW, type ViewOptions } from '@/features/public-map/model'
import { createMapEmbed } from '@/features/public-map/references'
import { useEditorStore } from '../../store'
import { checkDatasetEmbed, datasetEmbedProblem } from './datasetEmbed'

type Compatibility =
	| { status: 'checking' }
	| { status: 'ready' }
	| { status: 'error'; message: string }
const toggles = [
	['title', 'Show title'],
	['legend', 'Show legend'],
	['controls', 'Show map controls'],
	['scrollZoom', 'Scroll to zoom'],
] as const

/** Mounted only for a selected public event; remounted when the event changes. */
export function DatasetEmbedPanel({
	reference,
	event,
	title,
}: {
	reference: string
	event: NostrEvent
	title: string
}) {
	const id = useId()
	const editor = useEditorStore((state) => state.editor)
	const [view, setView] = useState<ViewOptions>({ ...DEFAULT_VIEW })
	const [height, setHeight] = useState('480')
	const [compatibility, setCompatibility] = useState<Compatibility>({ status: 'checking' })
	const [attempt, setAttempt] = useState(0)
	const [copiedHtml, setCopiedHtml] = useState('')
	const [copyError, setCopyError] = useState('')
	const localProblem = useMemo(() => datasetEmbedProblem(event), [event])

	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the same reference after a service failure.
	useEffect(() => {
		if (localProblem) return
		const controller = new AbortController()
		const timeout = window.setTimeout(() => controller.abort(), 12_000)
		let active = true
		setCompatibility({ status: 'checking' })
		void checkDatasetEmbed(config.publicMapUrl, reference, controller.signal)
			.then(() => {
				if (active) setCompatibility({ status: 'ready' })
			})
			.catch((error: unknown) => {
				if (!active) return
				setCompatibility({
					status: 'error',
					message: controller.signal.aborted
						? 'The embed service took too long to respond. Try again.'
						: error instanceof Error && error.message !== 'Failed to fetch'
							? error.message
							: 'Could not reach the embed service. Check your connection and try again.',
				})
			})
			.finally(() => window.clearTimeout(timeout))
		return () => {
			active = false
			controller.abort()
			window.clearTimeout(timeout)
		}
	}, [reference, localProblem, attempt])

	const validHeight = /^\d+$/.test(height) && Number(height) >= 200 && Number(height) <= 2000
	const embed =
		validHeight && !localProblem && compatibility.status === 'ready'
			? createMapEmbed(config.publicMapUrl, reference, view, Number(height))
			: null

	function captureCamera() {
		const camera = editor?.getMapCamera()
		if (!camera) return
		setView((current) => ({
			...current,
			center: [
				((((camera.center[0] + 180) % 360) + 360) % 360) - 180,
				Math.max(-85, Math.min(85, camera.center[1])),
			],
			zoom: Math.max(0, Math.min(20, camera.zoom)),
		}))
	}

	async function copyIframe() {
		if (!embed) return
		setCopyError('')
		try {
			await navigator.clipboard.writeText(embed.html)
			setCopiedHtml(embed.html)
		} catch {
			setCopyError('Clipboard access failed. Select and copy the iframe code below.')
		}
	}

	const problem = localProblem ?? (compatibility.status === 'error' ? compatibility.message : null)
	return (
		<section aria-label="Embed dataset" className="space-y-3">
			<div className="space-y-1">
				<p className="text-sm font-medium break-words">{title}</p>
				<p className="text-xs text-muted-foreground">
					Embeds this public dataset only. Shows the latest published version when loaded;
					unpublished edits are not included.
				</p>
			</div>
			{problem ? (
				<div className="space-y-2 rounded-md border p-3">
					<p role="alert" className="text-sm">
						{problem}
					</p>
					{!localProblem && (
						<Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
							Check again
						</Button>
					)}
				</div>
			) : compatibility.status === 'checking' ? (
				<p role="status" className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" />
					Checking embed compatibility…
				</p>
			) : (
				<>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1 text-xs">
							<label htmlFor={`${id}-theme`}>Theme</label>
							<select
								id={`${id}-theme`}
								className="h-9 w-full rounded-md border bg-background px-2 text-sm"
								value={view.theme}
								onChange={(e) =>
									setView({ ...view, theme: e.target.value as ViewOptions['theme'] })
								}
							>
								<option value="light">Light</option>
								<option value="dark">Dark</option>
							</select>
						</div>
						<label className="space-y-1 text-xs" htmlFor={`${id}-height`}>
							<span>Height (px)</span>
							<Input
								id={`${id}-height`}
								type="number"
								min={200}
								max={2000}
								step={1}
								value={height}
								aria-invalid={!validHeight}
								aria-describedby={!validHeight ? `${id}-height-error` : undefined}
								onChange={(e) => setHeight(e.target.value)}
							/>
						</label>
					</div>
					{!validHeight && (
						<p id={`${id}-height-error`} className="text-xs text-destructive">
							Enter a whole number between 200 and 2000 pixels.
						</p>
					)}
					<div className="grid grid-cols-2 gap-2">
						{toggles.map(([key, label]) => (
							<label key={key} className="flex items-center gap-2 text-xs">
								<input
									type="checkbox"
									className="accent-primary"
									checked={view[key]}
									onChange={(e) => setView({ ...view, [key]: e.target.checked })}
								/>
								{label}
							</label>
						))}
					</div>
					<fieldset className="flex gap-2" aria-label="Initial map view">
						<Button
							size="sm"
							variant={view.center ? 'outline' : 'default'}
							aria-pressed={!view.center}
							onClick={() => setView(({ center: _center, zoom: _zoom, ...rest }) => rest)}
						>
							Fit dataset
						</Button>
						<Button
							size="sm"
							variant={view.center ? 'default' : 'outline'}
							aria-pressed={Boolean(view.center)}
							disabled={!editor}
							onClick={captureCamera}
						>
							Use current camera
						</Button>
					</fieldset>
					{view.center && (
						<p className="text-xs text-muted-foreground">
							Camera captured. Click again after moving the main map to update it.
						</p>
					)}
					{embed && (
						<div className="overflow-hidden rounded-md border bg-muted">
							<iframe
								title="Dataset embed preview"
								src={embed.embedUrl}
								width="100%"
								height={Math.min(Number(height), 360)}
								className="border-0"
								allowFullScreen
							/>
						</div>
					)}
					<p className="text-xs text-muted-foreground">
						Preview height is capped at 360 px. The copied iframe uses your chosen height.
					</p>
				</>
			)}
			<Button className="w-full" size="sm" disabled={!embed} onClick={copyIframe}>
				{embed && copiedHtml === embed.html ? (
					<>
						<Check className="mr-2 size-4" />
						Iframe copied
					</>
				) : (
					<>
						<Copy className="mr-2 size-4" />
						Copy iframe
					</>
				)}
			</Button>
			{copyError && (
				<p role="alert" className="text-xs text-destructive">
					{copyError}
				</p>
			)}
			{embed && (
				<label className="block space-y-1 text-xs">
					Iframe code
					<textarea
						className="mt-1 block w-full resize-y rounded-md border bg-muted p-2 font-mono text-[11px]"
						readOnly
						rows={3}
						value={embed.html}
						onFocus={(e) => e.currentTarget.select()}
					/>
				</label>
			)}
		</section>
	)
}
