import type React from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export type ToolbarButton = {
	key: string
	icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
	onClick: () => void
	disabled?: boolean
	variant?: 'default' | 'outline'
	ariaLabel: string
	description: string
}

type IconButtonRowProps = {
	buttons: ToolbarButton[]
	className?: string
	wrap?: boolean
	small?: boolean
}

export function IconButtonRow({
	buttons,
	className = '',
	wrap = false,
	small = false,
}: IconButtonRowProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : undefined

	return (
		<TooltipProvider delayDuration={500}>
			<div
				className={`flex items-center gap-0.5 ${wrap ? 'flex-wrap justify-center' : ''} ${className}`}
			>
				{buttons.map(
					({ key, icon: Icon, variant = 'outline', disabled, onClick, ariaLabel, description }) => (
						<Tooltip key={key}>
							<TooltipTrigger asChild>
								<Button
									size="icon"
									variant={variant}
									disabled={disabled}
									aria-label={ariaLabel}
									onClick={onClick}
									className={buttonSize}
								>
									<Icon className={iconSize} />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom" sideOffset={8}>
								<p>{description}</p>
							</TooltipContent>
						</Tooltip>
					),
				)}
			</div>
		</TooltipProvider>
	)
}

/** Small vertical divider for button groups */
export function Divider({ className = '' }: { className?: string }) {
	return <div className={`h-5 w-px bg-accent mx-0.5 ${className}`} />
}
