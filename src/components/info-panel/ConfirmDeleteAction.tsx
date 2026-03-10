import { Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../ui/button'

interface ConfirmDeleteActionProps {
	label: string
	isDeleting?: boolean
	onConfirm: () => void
	className?: string
}

export function ConfirmDeleteAction({
	label,
	isDeleting = false,
	onConfirm,
	className = '',
}: ConfirmDeleteActionProps) {
	const [confirming, setConfirming] = useState(false)

	useEffect(() => {
		if (!isDeleting) {
			setConfirming(false)
		}
	}, [isDeleting])

	if (confirming || isDeleting) {
		return (
			<div
				className={`flex items-center gap-0.5 rounded-md border border-rose-200 bg-rose-50 p-0.5 ${className}`}
			>
				<Button
					type="button"
					size="icon-sm"
					variant="ghost"
					onClick={() => setConfirming(false)}
					disabled={isDeleting}
					aria-label={`Cancel ${label.toLowerCase()} deletion`}
					title={`Keep ${label.toLowerCase()}`}
				>
					<X className="h-3 w-3" />
				</Button>
				<Button
					type="button"
					size="icon-sm"
					variant="destructive"
					onClick={onConfirm}
					disabled={isDeleting}
					aria-label={`Confirm ${label.toLowerCase()} deletion`}
					title={
						isDeleting ? `Deleting ${label.toLowerCase()}...` : `Delete ${label.toLowerCase()}`
					}
				>
					{isDeleting ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<Trash2 className="h-3 w-3" />
					)}
				</Button>
			</div>
		)
	}

	return (
		<Button
			type="button"
			size="icon-sm"
			variant="destructive"
			onClick={() => setConfirming(true)}
			aria-label={`Delete ${label.toLowerCase()}`}
			title={`Delete ${label.toLowerCase()}`}
			className={className}
		>
			<Trash2 className="h-3 w-3" />
		</Button>
	)
}
