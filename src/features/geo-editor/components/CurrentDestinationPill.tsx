import { CircleHelp, Globe2, Lock, MapPinned, RadioTower, TriangleAlert, X } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ResolvedAuthoringDestination } from './authoringDestination'

export type CurrentDestinationPillVariant = 'toolbar' | 'mobile'

export interface CurrentDestinationPillProps {
	destination: ResolvedAuthoringDestination
	variant?: CurrentDestinationPillVariant
	onActivate?: () => void
	onLeave?: () => void
	className?: string
}

type DestinationIcon = ComponentType<SVGProps<SVGSVGElement>>

function iconForDestination(destination: ResolvedAuthoringDestination): DestinationIcon {
	switch (destination.kind) {
		case 'public-unattached':
			return Globe2
		case 'public-context':
			return MapPinned
		case 'private-group':
			return Lock
		case 'field-session':
			return RadioTower
		case 'unresolved':
			return CircleHelp
	}
}

function destinationTone(destination: ResolvedAuthoringDestination): string {
	if (destination.availability === 'unavailable') {
		return 'border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100'
	}

	switch (destination.kind) {
		case 'private-group':
			return 'border-primary/40 bg-primary/10 text-foreground'
		case 'field-session':
			return 'border-emerald-500/45 bg-emerald-500/10 text-foreground'
		case 'public-context':
			return 'border-sky-500/40 bg-sky-500/10 text-foreground'
		case 'public-unattached':
			return 'border-border bg-background/95 text-foreground'
		case 'unresolved':
			return 'border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100'
	}
}

interface DestinationContentsProps {
	destination: ResolvedAuthoringDestination
}

function DestinationContents({ destination }: DestinationContentsProps) {
	const Icon = iconForDestination(destination)
	return (
		<>
			<Icon className="size-3.5 shrink-0" aria-hidden="true" />
			<span className="shrink-0 font-semibold">{destination.channelLabel}</span>
			<span className="text-muted-foreground" aria-hidden="true">
				·
			</span>
			<span className="truncate">{destination.detailLabel}</span>
			{destination.availability === 'unavailable' ? (
				<TriangleAlert className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
			) : null}
		</>
	)
}

/**
 * Store-agnostic presentation for the destination an authored geometry will
 * use. The activate and leave actions are deliberately separate sibling
 * buttons so the compact control remains valid, keyboard-accessible markup.
 */
export function CurrentDestinationPill({
	destination,
	variant = 'toolbar',
	onActivate,
	onLeave,
	className,
}: CurrentDestinationPillProps) {
	const leaveEnabled = destination.canLeave && Boolean(onLeave)
	const availabilitySuffix = destination.availability === 'unavailable' ? ', unavailable' : ''
	const IconContents = <DestinationContents destination={destination} />

	const fieldset = (
		<fieldset
			aria-label={`Current destination: ${destination.accessibleLabel}`}
			data-destination-kind={destination.kind}
			data-publish-channel={destination.publishChannel}
			data-availability={destination.availability}
			data-variant={variant}
			className={cn(
				'm-0 inline-flex min-w-0 items-stretch overflow-hidden border p-0 text-xs shadow-sm',
				destinationTone(destination),
				variant === 'mobile'
					? 'h-7 max-w-[calc(100vw-6.5rem)] rounded-full bg-background/95 text-[11px] backdrop-blur'
					: 'h-7 max-w-80 rounded-[2px]',
				className,
			)}
		>
			{onActivate ? (
				<button
					type="button"
					onClick={onActivate}
					aria-label={`Open destination: ${destination.label}${availabilitySuffix}`}
					className={cn(
						'flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
						variant === 'mobile' && 'py-1.5',
					)}
				>
					{IconContents}
				</button>
			) : (
				<span
					className={cn(
						'flex min-w-0 flex-1 items-center gap-1.5 px-2',
						variant === 'mobile' && 'py-1.5',
					)}
				>
					{IconContents}
				</span>
			)}

			{leaveEnabled ? (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation()
						onLeave?.()
					}}
					aria-label={`Leave destination: ${destination.label}`}
					className={cn(
						'flex shrink-0 items-center justify-center border-l border-current/15 outline-none transition-colors hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
						variant === 'mobile' ? 'w-9' : 'w-7',
					)}
				>
					<X className="size-3.5" aria-hidden="true" />
				</button>
			) : null}
		</fieldset>
	)

	if (variant !== 'mobile') return fieldset

	return (
		<Badge asChild variant="outline" className="h-7 rounded-full p-0">
			{fieldset}
		</Badge>
	)
}
