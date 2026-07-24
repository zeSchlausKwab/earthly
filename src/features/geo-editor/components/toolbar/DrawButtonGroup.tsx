import { ArrowUpRight, MapPin, Pentagon, Route, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { EditorMode } from '@/features/geo-editor/core'

export interface DrawButtonGroupProps {
	mode: EditorMode
	onModeChange: (mode: EditorMode) => void
	onArrowDraw?: () => void
	disabled?: boolean
	small?: boolean
}

const drawModes = [
	{ key: 'draw_point', icon: MapPin, label: 'Draw point' },
	{ key: 'draw_linestring', icon: Route, label: 'Draw line' },
	{ key: 'draw_polygon', icon: Pentagon, label: 'Draw polygon' },
	{ key: 'draw_annotation', icon: Type, label: 'Draw label' },
] as const

export function DrawButtonGroup({
	mode,
	onModeChange,
	onArrowDraw,
	disabled,
	small,
}: DrawButtonGroupProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : 'h-9 w-9'

	return (
		<TooltipProvider delayDuration={500}>
			<ButtonGroup>
				{drawModes.map(({ key, icon: Icon, label }) => (
					<Tooltip key={key}>
						<TooltipTrigger asChild>
							<Button
								type="button"
								size="icon"
								variant={mode === key ? 'default' : 'outline'}
								disabled={disabled}
								onClick={() => onModeChange(key)}
								className={`${buttonSize} rounded-none`}
								aria-label={label}
							>
								<Icon className={iconSize} />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom" sideOffset={8}>
							<p>{label}</p>
						</TooltipContent>
					</Tooltip>
				))}
				{onArrowDraw ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								size="icon"
								variant="outline"
								disabled={disabled}
								onClick={onArrowDraw}
								className={`${buttonSize} rounded-none`}
								aria-label="Draw arrow"
							>
								<ArrowUpRight className={iconSize} />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom" sideOffset={8}>
							<p>Draw arrow</p>
						</TooltipContent>
					</Tooltip>
				) : null}
			</ButtonGroup>
		</TooltipProvider>
	)
}
