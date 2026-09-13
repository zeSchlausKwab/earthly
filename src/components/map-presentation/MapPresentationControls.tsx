import { Camera } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	getUsableMapPresentation,
	parseMapPresentation,
	type MapPresentationV1,
} from '@/lib/map-presentation'
import { applyPresentationCapture, withoutInitialView } from '@/lib/map-presentation/authoring'

/** Reading opaque or malformed values never rewrites them; only explicit editor actions do. */
export function useMapPresentationEditor({
	value,
	onChange,
	capture,
	invalidCaptureMessage,
}: {
	value: unknown
	onChange: (value: unknown) => void
	capture?: () => unknown
	invalidCaptureMessage: string
}) {
	const [captureError, setCaptureError] = useState<string | null>(null)
	const parsed = useMemo(() => parseMapPresentation(value), [value])
	const presentation = getUsableMapPresentation(parsed)
	const capturePresentation = (mode: 'all' | 'camera') => {
		try {
			const next = applyPresentationCapture(presentation, capture?.(), mode, invalidCaptureMessage)
			setCaptureError(null)
			onChange(next)
		} catch (error) {
			setCaptureError(error instanceof Error ? error.message : invalidCaptureMessage)
		}
	}
	return {
		parsed,
		presentation,
		future: parsed.status === 'unsupported',
		invalid: parsed.status === 'invalid' || (parsed.status === 'valid' && !presentation),
		captureError,
		capturePresentation,
		clearCaptureError: () => setCaptureError(null),
	}
}

export function MapPresentationFormatNotice({
	future,
	invalid,
	futureMessage,
	invalidMessage,
}: {
	future: boolean
	invalid: boolean
	futureMessage: string
	invalidMessage: string
}) {
	if (future) {
		return (
			<p className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
				{futureMessage}
			</p>
		)
	}
	if (invalid) {
		return (
			<p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
				{invalidMessage}
			</p>
		)
	}
	return null
}

export function MapPresentationCameraControl({
	presentation,
	onChange,
	onCapture,
	emptyLabel,
	clearLabel,
}: {
	presentation: MapPresentationV1
	onChange: (value: MapPresentationV1) => void
	onCapture?: () => void
	emptyLabel: string
	clearLabel: string
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-muted/30 px-3 py-2">
			<div className="min-w-0">
				<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Camera className="h-3.5 w-3.5 text-primary" />
					{presentation.initialView
						? `${presentation.initialView.center[1].toFixed(4)}, ${presentation.initialView.center[0].toFixed(4)} · zoom ${presentation.initialView.zoom.toFixed(1)}`
						: emptyLabel}
				</div>
				<p className="mt-1 text-[10px] text-muted-foreground">
					The camera changes only when you capture it explicitly.
				</p>
			</div>
			<div className="flex flex-wrap gap-1">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 gap-1 rounded-none px-2 text-[10px]"
					onClick={onCapture}
					disabled={!onCapture}
				>
					<Camera className="h-3 w-3" /> Capture camera
				</Button>
				{presentation.initialView && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 rounded-none px-2 text-[10px]"
						onClick={() => onChange(withoutInitialView(presentation))}
					>
						{clearLabel}
					</Button>
				)}
			</div>
		</div>
	)
}
