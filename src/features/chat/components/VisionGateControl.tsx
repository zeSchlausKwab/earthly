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
 * The D-08 three-tier image-send affordance, driven by the Plan 04
 * `detectVisionSupport` ladder. The SAME gate governs user-attached images AND
 * the autonomous `capture_map_snapshot` one-shot (D-09).
 *
 *  - `'vision'`         → image-send enabled normally (informational badge).
 *  - `'no-vision'`      → hard-disabled, with a Tooltip explaining the reason
 *                         (accessibility — not visual-only).
 *  - `'uncertain'`      → amber warning badge + an explicit `Send anyway` opt-in
 *                         confirm; the image is NOT sent unless opted in.
 *
 * Renders nothing when no image is attached (the gate is image-specific; the
 * snapshot path consults the same ladder result directly in the store).
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
			<span className="inline-flex h-8 items-center gap-1.5 rounded border bg-background px-2 text-xs text-muted-foreground">
				<Eye className="h-3.5 w-3.5" />
				Images enabled
			</span>
		)
	}

	if (support === 'no-vision') {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<span
						className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded border bg-background px-2 text-xs text-muted-foreground opacity-60"
						aria-disabled="true"
					>
						<ImageOff className="h-3.5 w-3.5 text-destructive" />
						Images unsupported
					</span>
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
					className={cn(
						'h-8 gap-1.5 text-xs',
						!sendAnyway &&
							'border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400',
					)}
					onClick={() => onSendAnywayChange(!sendAnyway)}
				>
					<EyeOff className="h-3.5 w-3.5" />
					{sendAnyway ? 'Sending image anyway' : 'Send anyway'}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="top" sideOffset={6}>
				This model may not support images. Send anyway?
			</TooltipContent>
		</Tooltip>
	)
}
