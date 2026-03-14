import { ArrowDownToLine, Check, Copy, Loader2, Share2, X } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import type { FeatureCollection } from 'geojson'
import { QRCodeCanvas } from 'qrcode.react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useRouting } from '../../hooks/useRouting'
import { useEditorStore } from '../../store'

type ShareAspect = '16:9' | '4:3' | '1:1' | '3:4'
type ShareCaptureMode = 'viewport' | 'entity-bounds'
type ShareResolution = 1 | 2 | 3

const SHARE_ASPECTS: Array<{ id: ShareAspect; label: string; ratio: number }> = [
	{ id: '16:9', label: '16:9', ratio: 16 / 9 },
	{ id: '4:3', label: '4:3', ratio: 4 / 3 },
	{ id: '1:1', label: '1:1', ratio: 1 },
	{ id: '3:4', label: '3:4', ratio: 3 / 4 },
]

function decodeNaddrIdentifier(naddr: string | undefined): string | undefined {
	if (!naddr) return undefined
	try {
		const decoded = nip19.decode(naddr)
		if (decoded.type !== 'naddr') return undefined
		const identifier = decoded.data.identifier
		return typeof identifier === 'string' && identifier.trim() ? identifier : undefined
	} catch {
		return undefined
	}
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error('Failed to load image'))
		image.src = src
	})
}

function drawImageCover(
	ctx: CanvasRenderingContext2D,
	image: HTMLImageElement,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	const imageRatio = image.width / image.height
	const rectRatio = width / height

	let drawWidth = width
	let drawHeight = height
	let offsetX = 0
	let offsetY = 0

	if (imageRatio > rectRatio) {
		drawWidth = height * imageRatio
		offsetX = (width - drawWidth) / 2
	} else {
		drawHeight = width / imageRatio
		offsetY = (height - drawHeight) / 2
	}

	// Clip to the target rect so cover-scaling cannot bleed into the white border bands.
	ctx.save()
	ctx.beginPath()
	ctx.rect(x, y, width, height)
	ctx.clip()
	ctx.drawImage(image, x + offsetX, y + offsetY, drawWidth, drawHeight)
	ctx.restore()
}

function drawMultilineText(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	maxWidth: number,
	lineHeight: number,
	maxLines: number,
): void {
	if (!text) return
	const words = text.split(/\s+/).filter(Boolean)
	if (words.length === 0) return

	const lines: string[] = []
	let current = ''
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word
		if (ctx.measureText(candidate).width <= maxWidth) {
			current = candidate
		} else {
			if (current) lines.push(current)
			current = word
		}
		if (lines.length === maxLines) break
	}
	if (current && lines.length < maxLines) {
		lines.push(current)
	}

	for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
		let line = lines[index]
		if (index === maxLines - 1 && lines.length > maxLines) {
			while (line.length > 0 && ctx.measureText(`${line}...`).width > maxWidth) {
				line = line.slice(0, -1)
			}
			line = `${line}...`
		}
		ctx.fillText(line, x, y + index * lineHeight)
	}
}

function sanitizeFileName(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
	return normalized.length > 0 ? normalized.slice(0, 48) : 'earthly-map-share'
}

function resolveFeatureCollectionMeta(collection: FeatureCollection | null | undefined): {
	name?: string
	description?: string
} {
	if (!collection) return {}
	const asExtended = collection as FeatureCollection & {
		name?: unknown
		description?: unknown
		properties?: Record<string, unknown>
	}
	const name =
		typeof asExtended.name === 'string'
			? asExtended.name
			: typeof asExtended.properties?.name === 'string'
				? asExtended.properties.name
				: undefined
	const description =
		typeof asExtended.description === 'string'
			? asExtended.description
			: typeof asExtended.properties?.description === 'string'
				? asExtended.properties.description
				: undefined
	return { name, description }
}

function _mergeBboxes(
	input: Array<[number, number, number, number] | undefined>,
): [number, number, number, number] | null {
	const boxes = input.filter(
		(bbox): bbox is [number, number, number, number] =>
			Boolean(bbox) && bbox.every((value) => Number.isFinite(value)),
	)
	if (boxes.length === 0) return null

	let west = boxes[0][0]
	let south = boxes[0][1]
	let east = boxes[0][2]
	let north = boxes[0][3]
	for (const [w, s, e, n] of boxes.slice(1)) {
		west = Math.min(west, w)
		south = Math.min(south, s)
		east = Math.max(east, e)
		north = Math.max(north, n)
	}
	return [west, south, east, north]
}

async function buildShareImage(options: {
	snapshotDataUrl: string
	aspectRatio: number
	title: string
	description?: string
	routeUrl: string
	resolution: ShareResolution
	qrCanvas: HTMLCanvasElement | null
}): Promise<{ dataUrl: string; width: number; height: number }> {
	const mapImage = await loadImageElement(options.snapshotDataUrl)
	const scale = options.resolution
	const border = 24
	const mapWidth = 1600
	const mapHeight = Math.max(900, Math.round(mapWidth / options.aspectRatio))
	const canvas = document.createElement('canvas')
	const logicalWidth = mapWidth + border * 2
	const logicalHeight = mapHeight + border * 2
	canvas.width = Math.max(1, Math.floor(logicalWidth * scale))
	canvas.height = Math.max(1, Math.floor(logicalHeight * scale))

	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('2D canvas context is unavailable')
	ctx.setTransform(scale, 0, 0, scale, 0, 0)

	ctx.fillStyle = '#ffffff'
	ctx.fillRect(0, 0, logicalWidth, logicalHeight)

	drawImageCover(ctx, mapImage, border, border, mapWidth, mapHeight)

	ctx.save()
	ctx.strokeStyle = 'rgba(255,255,255,0.98)'
	ctx.lineWidth = 1
	ctx.strokeRect(0.5, 0.5, logicalWidth - 1, logicalHeight - 1)
	ctx.restore()

	const topY = 16
	const bottomY = logicalHeight - 9
	const leftX = border
	const rightX = logicalWidth - border

	ctx.fillStyle = 'rgba(15, 23, 42, 0.94)'
	ctx.font = '600 14px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
	ctx.fillText(options.title || 'Current map view', leftX, topY)

	ctx.textAlign = 'right'
	ctx.fillStyle = 'rgba(51, 65, 85, 0.9)'
	ctx.font =
		'400 6.9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
	ctx.fillText(options.routeUrl, rightX, topY)

	ctx.textAlign = 'left'
	ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'
	ctx.font = '600 12px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
	ctx.fillText('earthly.city', leftX, bottomY)

	if (options.description) {
		ctx.fillStyle = 'rgba(51, 65, 85, 0.9)'
		ctx.font = '400 10px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
		drawMultilineText(
			ctx,
			options.description,
			leftX + 86,
			bottomY,
			Math.max(280, canvas.width - 560),
			12,
			1,
		)
	}

	ctx.textAlign = 'right'
	ctx.fillStyle = 'rgba(51, 65, 85, 0.9)'
	ctx.font = '400 10px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
	ctx.fillText('Map data © OpenStreetMap contributors', rightX, bottomY)
	ctx.textAlign = 'left'

	const qrCanvas = options.qrCanvas
	if (qrCanvas) {
		const qrSize = 166
		const qrX = logicalWidth - border - qrSize - 10
		const qrY = logicalHeight - border - qrSize - 10
		ctx.strokeStyle = 'rgba(255,255,255,0.95)'
		ctx.lineWidth = 1
		ctx.strokeRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12)
		ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize)
	}

	return {
		dataUrl: canvas.toDataURL('image/png'),
		width: canvas.width,
		height: canvas.height,
	}
}

export function ShareExportPopover() {
	const editor = useEditorStore((state) => state.editor)
	const focusedMapGeometry = useEditorStore((state) => state.focusedMapGeometry)
	const viewDataset = useEditorStore((state) => state.viewDataset)
	const viewContext = useEditorStore((state) => state.viewContext)
	const focusedNaddr = useEditorStore((state) => state.focusedNaddr)
	const focusedType = useEditorStore((state) => state.focusedType)
	const { clearFocus, route } = useRouting()

	const isFocused = Boolean(focusedNaddr && focusedType)
	const shareRouteUrl =
		typeof window !== 'undefined' ? window.location.href : 'https://earthly.context'

	const [sharePopoverOpen, setSharePopoverOpen] = useState(false)
	const [copiedUrl, setCopiedUrl] = useState(false)
	const [shareAspect, setShareAspect] = useState<ShareAspect>('16:9')
	const [shareCaptureMode, setShareCaptureMode] = useState<ShareCaptureMode>('viewport')
	const [shareResolution, setShareResolution] = useState<ShareResolution>(1)
	const [sharePreviewDataUrl, setSharePreviewDataUrl] = useState<string | null>(null)
	const [sharePreviewLoading, setSharePreviewLoading] = useState(false)
	const [sharePreviewError, setSharePreviewError] = useState<string | null>(null)
	const [shareExporting, setShareExporting] = useState(false)

	const shareQrCanvasRef = useRef<HTMLCanvasElement | null>(null)
	const sharePreviewRequestRef = useRef(0)

	const shareMeta = useMemo(() => {
		const focusedIdentifier =
			decodeNaddrIdentifier(focusedNaddr ?? undefined) ??
			decodeNaddrIdentifier(route.naddr) ??
			decodeNaddrIdentifier(route.contextNaddr)

		if (focusedType === 'geoevent') {
			const meta = resolveFeatureCollectionMeta(viewDataset?.featureCollection)
			return {
				title: meta.name ?? focusedIdentifier ?? 'Feature collection',
				description: meta.description,
				subjectLabel: 'feature collection',
			}
		}
		if (focusedType === 'mapcontext') {
			return {
				title: viewContext?.context.name || focusedIdentifier || 'Context',
				description: viewContext?.context.description,
				subjectLabel: 'context',
			}
		}
		if (route.contextNaddr) {
			return {
				title: viewContext?.context.name || focusedIdentifier || 'Context view',
				description: viewContext?.context.description,
				subjectLabel: 'map view',
			}
		}
		return {
			title: focusedIdentifier || 'Current map view',
			description: undefined,
			subjectLabel: 'map view',
		}
	}, [focusedType, focusedNaddr, viewDataset, viewContext, route])

	const focusedEntityBounds = useMemo(() => {
		if (focusedMapGeometry?.bbox) {
			return focusedMapGeometry.bbox
		}
		if (focusedType === 'geoevent') {
			return viewDataset?.boundingBox ?? null
		}
		if (focusedType === 'mapcontext') {
			return viewContext?.boundingBox ?? null
		}
		return null
	}, [focusedMapGeometry, focusedType, viewDataset, viewContext])

	const selectedAspect = useMemo(
		() => SHARE_ASPECTS.find((aspect) => aspect.id === shareAspect) ?? SHARE_ASPECTS[0],
		[shareAspect],
	)
	const canUseEntityBounds = isFocused && Boolean(focusedEntityBounds)

	useEffect(() => {
		if (!canUseEntityBounds && shareCaptureMode === 'entity-bounds') {
			setShareCaptureMode('viewport')
		}
	}, [canUseEntityBounds, shareCaptureMode])

	const renderShareImage = useCallback(async () => {
		if (!editor) throw new Error('Map is not ready yet.')
		const captureMax = Math.min(8192, 2048 * shareResolution)

		const mapSnapshot =
			shareCaptureMode === 'entity-bounds' && focusedEntityBounds
				? await editor.captureMapSnapshotForBoundingBoxStable(focusedEntityBounds, {
						mimeType: 'image/png',
						maxWidth: captureMax,
						maxHeight: captureMax,
						paddingPx: 36,
						targetAspect: selectedAspect.ratio,
					})
				: await editor.captureMapSnapshotStable({
						mimeType: 'image/png',
						maxWidth: captureMax,
						maxHeight: captureMax,
					})

		return buildShareImage({
			snapshotDataUrl: mapSnapshot.dataUrl,
			aspectRatio: selectedAspect.ratio,
			title: shareMeta.title,
			description: shareMeta.description,
			routeUrl: shareRouteUrl,
			resolution: shareResolution,
			qrCanvas: shareQrCanvasRef.current,
		})
	}, [
		editor,
		shareCaptureMode,
		shareResolution,
		focusedEntityBounds,
		selectedAspect.ratio,
		shareMeta.title,
		shareMeta.description,
		shareRouteUrl,
	])

	useEffect(() => {
		if (!sharePopoverOpen) return
		let cancelled = false
		const requestId = sharePreviewRequestRef.current + 1
		sharePreviewRequestRef.current = requestId
		setSharePreviewLoading(true)
		setSharePreviewError(null)

		const timer = window.setTimeout(() => {
			renderShareImage()
				.then((result) => {
					if (cancelled || sharePreviewRequestRef.current !== requestId) return
					setSharePreviewDataUrl(result.dataUrl)
					setSharePreviewLoading(false)
				})
				.catch((error) => {
					if (cancelled || sharePreviewRequestRef.current !== requestId) return
					setSharePreviewError(error instanceof Error ? error.message : 'Failed to render preview.')
					setSharePreviewLoading(false)
				})
		}, 100)

		return () => {
			cancelled = true
			window.clearTimeout(timer)
		}
	}, [sharePopoverOpen, renderShareImage])

	const handleCopyShareUrl = async () => {
		try {
			await navigator.clipboard.writeText(shareRouteUrl)
			setCopiedUrl(true)
			setTimeout(() => setCopiedUrl(false), 2000)
		} catch (error) {
			console.error('Failed to copy URL:', error)
		}
	}

	const handleExportPng = async () => {
		setShareExporting(true)
		setSharePreviewError(null)
		try {
			const rendered = await renderShareImage()
			setSharePreviewDataUrl(rendered.dataUrl)
			const link = document.createElement('a')
			link.href = rendered.dataUrl
			link.download = `${sanitizeFileName(shareMeta.title)}.png`
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link)
		} catch (error) {
			setSharePreviewError(error instanceof Error ? error.message : 'Failed to export PNG.')
		} finally {
			setShareExporting(false)
		}
	}

	const handleSharePopoverOpenChange = (open: boolean) => {
		setSharePopoverOpen(open)
		if (open) {
			setCopiedUrl(false)
			setSharePreviewError(null)
			setShareCaptureMode(canUseEntityBounds ? 'entity-bounds' : 'viewport')
			return
		}

		sharePreviewRequestRef.current += 1
		setSharePreviewLoading(false)
		setSharePreviewError(null)
		setSharePreviewDataUrl(null)
	}

	const handleExitFocus = () => {
		setSharePopoverOpen(false)
		sharePreviewRequestRef.current += 1
		setSharePreviewLoading(false)
		setSharePreviewError(null)
		setSharePreviewDataUrl(null)
		if (typeof window !== 'undefined') {
			window.requestAnimationFrame(() => clearFocus())
			return
		}
		clearFocus()
	}

	return (
		<TooltipProvider delayDuration={500}>
			<Popover open={sharePopoverOpen} onOpenChange={handleSharePopoverOpenChange}>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button variant="default" size="icon" aria-label="Share">
								<Share2 className="h-4 w-4" />
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Share this view</p>
					</TooltipContent>
				</Tooltip>
				<PopoverContent className="w-[32rem] max-w-[calc(100vw-2rem)]" side="bottom" align="end">
					<div className="space-y-3">
						<div>
							<h4 className="text-sm font-semibold mb-1">Share this view</h4>
							<p className="text-xs text-gray-500">
								Share this {shareMeta.subjectLabel} as a link or export card.
							</p>
						</div>

						<div className="flex gap-2">
							<Button
								size="sm"
								variant="outline"
								className="flex-1 justify-start"
								onClick={handleCopyShareUrl}
							>
								{copiedUrl ? (
									<>
										<Check className="h-4 w-4 mr-2 text-green-600" />
										Copied!
									</>
								) : (
									<>
										<Copy className="h-4 w-4 mr-2" />
										Copy link
									</>
								)}
							</Button>
							<Button
								size="sm"
								variant="default"
								className="min-w-32 justify-center"
								disabled={!editor || shareExporting}
								onClick={handleExportPng}
							>
								{shareExporting ? (
									<>
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
										Exporting...
									</>
								) : (
									<>
										<ArrowDownToLine className="h-4 w-4 mr-2" />
										Export PNG
									</>
								)}
							</Button>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Capture
								</p>
								{canUseEntityBounds ? (
									<div className="flex gap-1">
										<Button
											size="sm"
											variant={shareCaptureMode === 'viewport' ? 'default' : 'outline'}
											className="h-8 flex-1 text-xs"
											onClick={() => setShareCaptureMode('viewport')}
										>
											Viewport
										</Button>
										<Button
											size="sm"
											variant={shareCaptureMode === 'entity-bounds' ? 'default' : 'outline'}
											className="h-8 flex-1 text-xs"
											onClick={() => setShareCaptureMode('entity-bounds')}
										>
											Entity bounds
										</Button>
									</div>
								) : (
									<div className="h-8 rounded-md border border-dashed border-gray-300 px-2 flex items-center text-xs text-gray-500">
										Viewport only
									</div>
								)}
							</div>

							<div className="space-y-1.5">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Aspect ratio
								</p>
								<div className="grid grid-cols-4 gap-1">
									{SHARE_ASPECTS.map((aspect) => (
										<Button
											key={aspect.id}
											size="sm"
											variant={shareAspect === aspect.id ? 'default' : 'outline'}
											className="h-8 px-0 text-xs"
											onClick={() => setShareAspect(aspect.id)}
										>
											{aspect.label}
										</Button>
									))}
								</div>
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 mt-2">
									Resolution
								</p>
								<div className="grid grid-cols-3 gap-1">
									{([1, 2, 3] as const).map((multiplier) => (
										<Button
											key={multiplier}
											size="sm"
											variant={shareResolution === multiplier ? 'default' : 'outline'}
											className="h-8 px-0 text-xs"
											onClick={() => setShareResolution(multiplier)}
										>
											{multiplier}x
										</Button>
									))}
								</div>
							</div>
						</div>

						<div className="space-y-1.5">
							<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
								Preview
							</p>
							<div
								className="relative w-full overflow-hidden rounded-md border border-gray-200 bg-gray-100"
								style={{ aspectRatio: selectedAspect.ratio }}
							>
								{sharePreviewDataUrl && !sharePreviewLoading && (
									<img
										src={sharePreviewDataUrl}
										alt="Share preview"
										className="absolute inset-0 h-full w-full object-contain"
									/>
								)}
								{sharePreviewLoading && (
									<div className="absolute inset-0 flex items-center justify-center text-xs text-gray-600 bg-white/80">
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
										Rendering preview...
									</div>
								)}
							</div>
							{sharePreviewError && <p className="text-xs text-red-600">{sharePreviewError}</p>}
						</div>

						{isFocused && (
							<Button
								size="sm"
								variant="ghost"
								className="w-full justify-start text-gray-600"
								onClick={handleExitFocus}
							>
								<X className="h-4 w-4 mr-2" />
								Exit focus mode
							</Button>
						)}
					</div>
					<QRCodeCanvas
						ref={shareQrCanvasRef}
						value={shareRouteUrl}
						size={256}
						level="M"
						marginSize={1}
						bgColor="#ffffff"
						fgColor="#0f172a"
						className="hidden"
					/>
				</PopoverContent>
			</Popover>
		</TooltipProvider>
	)
}
