import { MapStackActionIcon } from '@/components/entity-action-icons'
import { Button } from '@/components/ui/button'

interface BulkMapStackButtonProps {
	count: number
	onClick?: () => void
	label?: string
	emptyLabel?: string
}

export function BulkMapStackButton({
	count,
	onClick,
	label = 'Add filtered list to map stack',
	emptyLabel = 'No filtered items to add',
}: BulkMapStackButtonProps) {
	const disabled = !onClick || count === 0
	const title = disabled ? emptyLabel : `${label} (${count})`

	return (
		<Button
			type="button"
			variant="outline"
			size="icon-sm"
			onClick={onClick}
			disabled={disabled}
			aria-label={title}
			title={title}
			className="h-6 w-6 rounded-[2px]"
		>
			<MapStackActionIcon className="h-3.5 w-3.5" />
		</Button>
	)
}
