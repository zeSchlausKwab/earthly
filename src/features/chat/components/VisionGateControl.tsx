import { Eye, EyeOff, ImageOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { VisionSupport } from '../vision/detectVisionSupport'

interface VisionGateControlProps {
	/** The resolved vision support for the selected model (Plan 04 ladder). */
	support: VisionSupport
	/** The display name of the selected model (for the disabled-reason copy). */
	modelLabel: string
	/** Whether at least one image is currently attached (controls visibility). */
	hasImage: boolean
	/** Current `Send anyway` opt-in state (for an `'uncertain'` model). */
	sendAnyway: boolean
	/** Toggle the `Send anyway` opt-in. */
	onSendAnywayChange: (next: boolean) => void
}

/**
 * The D-08 three-tier image-send affordance for user attachments, driven by the
 * Plan 04 `detectVisionSupport` ladder. Autonomous map screenshots additionally
 * require the separate user preference exposed with the selected model.
 *
 *  - `'vision'`         → image-send enabled normally (informational badge).
 *  - `'no-vision'`      → hard-disabled, with a Tooltip explaining the reason
 *                         (accessibility — not visual-only).
 *  - `'uncertain'`      → amber warning badge + an explicit `Send anyway` opt-in
 *                         confirm; the image is NOT sent unless opted in.
 *
 * Renders nothing when no image is attached (the gate is image-specific; the
 * snapshot path consults the vision ladder and its own preference in the store).
 */
export function VisionGateControl({
	support,
	modelLabel,
	hasImage,
	sendAnyway,
	onSendAnywayChange,
}: VisionGateControlProps) {
	if (!hasImage) return null

	if (support === 'vision') {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						className="inline-flex h-8 shrink-0 cursor-help items-center gap-1.5 rounded border bg-background px-2 text-xs text-muted-foreground"
						aria-label={`${modelLabel} supports image input`}
					>
						<Eye className="h-3.5 w-3.5" aria-hidden="true" />
						Vision
					</button>
				</TooltipTrigger>
				<TooltipContent side="top" sideOffset={6}>
					{modelLabel} supports image input.
				</TooltipContent>
			</Tooltip>
		)
	}

	if (support === 'no-vision') {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						className="inline-flex h-8 shrink-0 cursor-help items-center gap-1.5 rounded border bg-background px-2 text-xs text-muted-foreground opacity-60"
						aria-disabled="true"
						aria-label={`${modelLabel} does not support image input`}
					>
						<ImageOff className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
						No vision
					</button>
				</TooltipTrigger>
				<TooltipContent side="top" sideOffset={6}>
					{modelLabel} doesn't support images, so they can't be sent.
				</TooltipContent>
			</Tooltip>
		)
	}

	// 'uncertain' — amber warning + explicit Send-anyway opt-in (never silent).
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant={sendAnyway ? 'default' : 'outline'}
					size="sm"
					className={cn('h-8 gap-1.5 text-xs', !sendAnyway && 'border-primary/40 text-primary')}
					onClick={() => onSendAnywayChange(!sendAnyway)}
					aria-pressed={sendAnyway}
					aria-label={
						sendAnyway
							? `Stop allowing image input for ${modelLabel}`
							: `Allow image input for ${modelLabel} despite uncertain support`
					}
				>
					<EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
					{sendAnyway ? 'Image allowed' : 'Allow image'}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="top" sideOffset={6}>
				This model may not support images. Send anyway?
			</TooltipContent>
		</Tooltip>
	)
}
