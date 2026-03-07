import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Button } from '../ui/button'

interface EntityAction {
	icon: ReactNode
	label: string
	onClick: () => void
	variant?: 'default' | 'outline' | 'ghost'
	disabled?: boolean
}

interface EntityActionBarProps {
	actions: EntityAction[]
	className?: string
}

export function EntityActionBar({ actions, className = '' }: EntityActionBarProps) {
	if (actions.length === 0) return null

	return (
		<div className={`flex items-center gap-1 ${className}`}>
			{actions.map((action) => (
				<Tooltip key={action.label}>
					<TooltipTrigger asChild>
						<Button
							type="button"
							size="icon-sm"
							variant={action.variant ?? 'outline'}
							onClick={action.onClick}
							disabled={action.disabled}
							className="rounded-none border-slate-200"
							aria-label={action.label}
						>
							{action.icon}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{action.label}</TooltipContent>
				</Tooltip>
			))}
		</div>
	)
}
