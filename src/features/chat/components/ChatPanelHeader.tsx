import { useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import {
	Check,
	ChevronDown,
	Download,
	Ellipsis,
	Gauge,
	Link2,
	Loader2,
	LockKeyhole,
	MessageSquarePlus,
	PanelLeft,
	PanelRight,
	Pencil,
	Settings2,
	Trash2,
	X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
	endEntityDrag,
	getEntityDrag,
	readEntityDrop,
	subscribeEntityDrag,
} from '@/components/entity-list/entityTransfer'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useChatStore, type ChatRunState, type ChatSession } from '../store'
import { setConversationEntityRole } from '../entityContext'
import { ChatSafetyIndicator, chatSafetyPresentation } from './ChatHeaderPresentation'
import { ChatMenu, useChatNavigation } from './ChatPanelNavigation'

export function ChatPanelHeader({
	sessions,
	activeId,
	runStates,
	readOnly,
	editableCount,
	sourceCount,
	safetyLevel,
	embedded,
	onCreate,
	onSwitch,
	onDelete,
	onExport,
	onMove,
	dock,
	onClose,
}: {
	sessions: ChatSession[]
	activeId: string | null
	runStates: Record<string, ChatRunState>
	readOnly: boolean
	editableCount: number
	sourceCount: number
	safetyLevel: 1 | 2 | 3
	embedded: boolean
	onCreate: () => void
	onSwitch: (id: string) => void
	onDelete: (id: string) => void
	onExport: () => void
	onMove?: () => void
	dock?: 'left' | 'right'
	onClose?: () => void
}) {
	const { view, openView, menu, setMenu } = useChatNavigation()
	const dragging = useSyncExternalStore(subscribeEntityDrag, getEntityDrag, getEntityDrag)
	const runningChatId = useChatStore((state) => state.runningChatId)
	const [dropOver, setDropOver] = useState<'edit' | 'reference' | null>(null)
	const [pendingDrop, setPendingDrop] = useState<'edit' | 'reference' | null>(null)
	const dropInFlight = useRef(false)
	const active = sessions.find((chat) => chat.id === activeId)
	const [deleteId, setDeleteId] = useState<string | null>(null)
	const deleting = sessions.find((chat) => chat.id === deleteId)
	const running = (id: string | null) =>
		!!id && ['working', 'awaiting_approval'].includes(runStates[id]?.status ?? '')
	const itemClass = 'min-h-11 rounded-none text-xs md:min-h-8'
	const canDrop = (role: 'edit' | 'reference') =>
		!!dragging &&
		!!activeId &&
		runningChatId !== activeId &&
		!pendingDrop &&
		(role === 'reference' || ['dataset', 'feature', 'story'].includes(dragging.item.type))
	const dropHandlers = (role: 'edit' | 'reference') => ({
		onDragOver: (event: DragEvent<HTMLButtonElement>) => {
			if (!dragging) return
			event.stopPropagation()
			event.dataTransfer.dropEffect = canDrop(role) ? 'copy' : 'none'
			if (!canDrop(role)) return
			event.preventDefault()
			setDropOver(role)
		},
		onDragLeave: (event: DragEvent<HTMLButtonElement>) => {
			if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropOver(null)
		},
		onDrop: async (event: DragEvent<HTMLButtonElement>) => {
			const item = readEntityDrop(event.dataTransfer)
			if (!item) return
			event.preventDefault()
			event.stopPropagation()
			setDropOver(null)
			const allowed = canDrop(role)
			endEntityDrag()
			if (!allowed || !activeId || dropInFlight.current) return
			dropInFlight.current = true
			setPendingDrop(role)
			try {
				await setConversationEntityRole(activeId, item, role)
			} catch (error) {
				toast.error(error instanceof Error ? error.message : 'Could not add this item.')
			} finally {
				dropInFlight.current = false
				setPendingDrop(null)
			}
		},
	})
	const dropClass = (role: 'edit' | 'reference') =>
		cn(
			'h-11 gap-1.5 rounded-none px-1.5 text-xs md:h-9',
			dragging && (canDrop(role) ? 'border-dashed border-primary bg-primary/5' : 'opacity-50'),
			dragging && canDrop(role) && dropOver === role && 'bg-primary/15 ring-2 ring-primary',
		)
	return (
		<>
			<header className="shrink-0 border-b bg-background">
				<fieldset
					aria-label="Thread controls"
					className="flex min-w-0 items-center gap-1 px-2 py-1"
				>
					<Popover
						open={menu === 'conversations'}
						onOpenChange={(open) =>
							setMenu((current) =>
								open ? 'conversations' : current === 'conversations' ? null : current,
							)
						}
					>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								aria-label="Conversations"
								title={active?.title}
								className="h-11 min-w-0 flex-1 justify-start gap-1 rounded-none px-2 text-xs md:h-9"
							>
								<span className="truncate">{embedded ? 'Chat' : (active?.title ?? 'Chat')}</span>
								<ChevronDown className="size-3.5 shrink-0" />
							</Button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							aria-label="Conversations"
							className="z-[80] w-[min(360px,calc(100vw-24px))] rounded-none p-1"
						>
							<div className="max-h-[50dvh] overflow-y-auto">
								{sessions.map((chat) => (
									<button
										key={chat.id}
										type="button"
										value={chat.id}
										aria-current={chat.id === activeId ? 'true' : undefined}
										onClick={() => onSwitch(chat.id)}
										className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
									>
										<span className="min-w-0 flex-1">
											<span className="block truncate">{chat.title}</span>
											<span className="text-[11px] text-muted-foreground">
												{running(chat.id) ? 'Working · ' : ''}
												{new Date(chat.updatedAt).toLocaleString()}
											</span>
										</span>
										{chat.id === activeId && <Check className="size-4 shrink-0" />}
									</button>
								))}
							</div>
							<div className="border-t pt-1">
								<Button
									variant="ghost"
									aria-label="New Thread"
									onClick={onCreate}
									className="min-h-11 w-full justify-start rounded-none text-xs"
								>
									<MessageSquarePlus className="size-4" />
									New conversation
								</Button>
							</div>
						</PopoverContent>
					</Popover>
					<ChatMenu id="actions">
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Chat actions"
								className="size-11 shrink-0 rounded-none md:size-9"
							>
								<Ellipsis className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="z-[80] w-60 rounded-none">
							<DropdownMenuItem className={itemClass} onSelect={() => openView('settings')}>
								<Settings2 />
								Chat settings
							</DropdownMenuItem>
							<DropdownMenuItem className={itemClass} onSelect={() => openView('usage')}>
								<Gauge />
								Usage & diagnostics
							</DropdownMenuItem>
							{onMove && (
								<DropdownMenuItem
									className={itemClass}
									aria-label={`Move chat ${dock === 'right' ? 'left' : 'right'}`}
									onSelect={onMove}
								>
									{dock === 'right' ? <PanelLeft /> : <PanelRight />}Move{' '}
									{dock === 'right' ? 'left' : 'right'}
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								className={itemClass}
								disabled={!active?.messages.length}
								onSelect={onExport}
							>
								<Download />
								Export conversation
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className={itemClass}
								variant="destructive"
								disabled={!activeId || running(activeId)}
								onSelect={() => setDeleteId(activeId)}
							>
								<Trash2 />
								Delete conversation…
							</DropdownMenuItem>
						</DropdownMenuContent>
					</ChatMenu>
					{onClose && (
						<Button
							variant="ghost"
							size="icon"
							aria-label="Close Thread"
							onClick={onClose}
							className="size-11 shrink-0 rounded-none md:size-9"
						>
							<X className="size-4" />
						</Button>
					)}
				</fieldset>
				{(view === 'chat' || dragging) && (
					<div className="flex min-w-0 items-center gap-0.5 border-t border-border/60 px-2 py-1">
						<Button
							variant="ghost"
							onClick={() => openView('edit')}
							{...dropHandlers('edit')}
							title="Drop maps or stories here to let AI edit, or click to manage editing access"
							aria-label={`AI can edit ${editableCount}`}
							aria-busy={pendingDrop === 'edit'}
							className={dropClass('edit')}
						>
							{pendingDrop === 'edit' ? (
								<Loader2 className="size-3.5 shrink-0 animate-spin" />
							) : (
								<Pencil className="size-3.5 shrink-0" />
							)}
							{canDrop('edit') ? 'Drop to edit' : `AI can edit ${editableCount}`}
						</Button>
						<Button
							variant="ghost"
							onClick={() => openView('sources')}
							{...dropHandlers('reference')}
							title="Drop here to add a read-only reference, or click to manage sources"
							aria-label={`Sources ${sourceCount}`}
							aria-busy={pendingDrop === 'reference'}
							className={dropClass('reference')}
						>
							{pendingDrop === 'reference' ? (
								<Loader2 className="size-3.5 shrink-0 animate-spin" />
							) : (
								<Link2 className="size-3.5 shrink-0" />
							)}
							{canDrop('reference') ? 'Drop reference' : `Sources ${sourceCount}`}
						</Button>
						<Button
							variant="ghost"
							onClick={() => openView('settings')}
							aria-label={`AI edit safety: ${chatSafetyPresentation(readOnly, safetyLevel).label}`}
							className="ml-auto h-11 min-w-0 gap-1 rounded-none px-1.5 text-xs md:h-9"
						>
							{readOnly ? (
								<>
									<LockKeyhole className="size-3.5 shrink-0" />
									<span>Read-only</span>
								</>
							) : (
								<ChatSafetyIndicator readOnly={false} safetyLevel={safetyLevel} />
							)}
						</Button>
					</div>
				)}
			</header>
			<AlertDialog
				open={!!deleting}
				onOpenChange={(open) => {
					if (!open) setDeleteId(null)
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
						<AlertDialogDescription>
							“{deleting?.title}” and its messages will be removed. Your maps and stories are kept.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep conversation</AlertDialogCancel>
						<Button
							variant="destructive"
							disabled={running(deleteId)}
							onClick={() => {
								if (deleteId) onDelete(deleteId)
								setDeleteId(null)
							}}
						>
							Delete conversation
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
