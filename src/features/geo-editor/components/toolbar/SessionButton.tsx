import { PlusCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export interface SessionButtonProps {
	viewMode: 'edit' | 'view'
	onStartNew?: () => void
	onCancel?: () => void
	small?: boolean
}

export function SessionButton({ viewMode, onStartNew, onCancel, small }: SessionButtonProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : 'h-9 w-9'

	const isEditing = viewMode === 'edit'

	return (
		<TooltipProvider delayDuration={500}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						size="icon"
						variant={isEditing ? 'destructive' : 'default'}
						onClick={isEditing ? onCancel : onStartNew}
						className={`${buttonSize} ${!isEditing ? 'bg-edit hover:bg-edit/80' : ''}`}
						aria-label={isEditing ? 'Cancel editing' : 'New dataset'}
					>
						{isEditing ? <XCircle className={iconSize} /> : <PlusCircle className={iconSize} />}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom" sideOffset={8}>
					<p>{isEditing ? 'Discard changes and exit' : 'Start a new dataset'}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}
