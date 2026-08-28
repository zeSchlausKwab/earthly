import { Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../ui/button'

interface ConfirmDeleteActionProps {
	label: string
	isDeleting?: boolean
	onConfirm: () => void
	className?: string
	/** Short, entity-specific warning shown during the inline confirmation step. */
	message?: string
	/** Allows local-only deletion to use the more accurate "Discard" verb. */
	confirmText?: string
}

export function ConfirmDeleteAction({
	label,
	isDeleting = false,
	onConfirm,
	className = '',
	message = 'Copies may remain elsewhere',
	confirmText = 'Delete',
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
				className={`flex max-w-full flex-wrap items-center justify-end gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-0.5 ${className}`}
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
				<span className="min-w-0 px-0.5 text-[10px] leading-tight text-destructive">{message}</span>
				<Button
					type="button"
					size="sm"
					variant="destructive"
					onClick={onConfirm}
					disabled={isDeleting}
					aria-label={`Confirm ${label.toLowerCase()} deletion`}
					className="h-6 gap-1 px-2 text-xs"
				>
					{isDeleting ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<Trash2 className="h-3 w-3" />
					)}
					{isDeleting ? 'Deleting…' : confirmText}
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
