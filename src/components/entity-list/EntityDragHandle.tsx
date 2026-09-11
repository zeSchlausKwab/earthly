import { useState, type DragEvent } from 'react'
import { GripVertical, Link2, Pencil, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
	startEntityDrag,
	endEntityDrag,
	getEntityConversationContext,
	type EntityTransfer,
} from './entityTransfer'

/** Drag on desktop; the same handle opens explicit actions on touch/keyboard. */
export function EntityDragHandle({
	item,
	onDragStart,
}: {
	item: EntityTransfer
	onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
}) {
	const [open, setOpen] = useState(false)
	const [pending, setPending] = useState(false)
	const editable = ['dataset', 'feature', 'story'].includes(item.type)
	const add = async (role: 'edit' | 'reference', fork = false) => {
		const initiating = getEntityConversationContext()
		setPending(true)
		try {
			if (!initiating?.chatId) throw new Error('Open a conversation first, then add this item.')
			const { setConversationEntityRole } = await import('@/features/chat/entityContext')
			const current = getEntityConversationContext()
			if (current?.chatId !== initiating.chatId || current.pubkey !== initiating.pubkey)
				throw new Error('The conversation or account changed. Please try again.')
			await setConversationEntityRole(initiating.chatId, item, role, fork)
			setOpen(false)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not add this item.')
		} finally {
			setPending(false)
		}
	}
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					draggable
					aria-label={`Drag or add ${item.name} to chat`}
					title="Drag to chat, or click for options"
					className="flex h-9 w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary active:cursor-grabbing"
					onDragStart={(event) => {
						onDragStart?.(event)
						startEntityDrag(event.dataTransfer, item)
						setOpen(false)
					}}
					onDragEnd={endEntityDrag}
				>
					<GripVertical className="size-4" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="z-[90] w-64 gap-1 rounded-none p-2"
				aria-label="Add to conversation"
			>
				<Button
					variant="ghost"
					className="justify-start"
					disabled={pending}
					onClick={() => void add('reference')}
				>
					<Link2 className="size-4" />
					Add as read-only reference
				</Button>
				{editable && (
					<Button
						variant="ghost"
						className="justify-start"
						disabled={pending}
						onClick={() => void add('edit')}
					>
						<Pencil className="size-4" />
						Let AI edit
					</Button>
				)}
				{item.type === 'dataset' && !item.localWorkspaceId && (
					<Button
						variant="ghost"
						className="justify-start"
						disabled={pending}
						onClick={() => void add('edit', true)}
					>
						<Copy className="size-4" />
						Make my own copy for AI
					</Button>
				)}
			</PopoverContent>
		</Popover>
	)
}
