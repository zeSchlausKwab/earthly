import type { ColumnDef } from '@tanstack/react-table'
import { Bug, Eye, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { UserProfile } from '@/components/user-profile'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'

export interface ContextRowData {
	context: NDKMapContextEvent
	contextName: string
	contextUse: string
	validationMode: string | null
	attachmentPolicy: string
	displayDepth: number
	displayParentName: string | null
	isCuratedChild: boolean
	attachmentCount: number
}

export interface ContextColumnsContext {
	currentUserPubkey?: string
	onInspectContext?: (context: NDKMapContextEvent) => void
	onEditContext?: (context: NDKMapContextEvent) => void
	onOpenDebug?: (event: NDKMapContextEvent) => void
}

export const createContextColumns = (
	context: ContextColumnsContext,
): ColumnDef<ContextRowData>[] => [
	{
		accessorKey: 'contextName',
		header: 'Context',
		cell: ({ row }) => {
			const {
				context,
				contextName,
				displayDepth,
				displayParentName,
				isCuratedChild,
				attachmentCount,
			} = row.original
			const content = context.context
			return (
				<div
					className="max-w-[180px] space-y-0.5"
					style={displayDepth > 0 ? { paddingLeft: `${displayDepth}rem` } : undefined}
				>
					<div className="flex items-center gap-1.5">
						{displayDepth > 0 && <span className="text-[10px] text-slate-400">└</span>}
						<div className="truncate text-xs font-semibold text-gray-900" title={contextName}>
							{contextName}
						</div>
					</div>
					<UserProfile
						pubkey={context.pubkey}
						mode="avatar-name"
						size="sm"
						showNip05Badge={false}
					/>
					{isCuratedChild && (
						<div className="text-[10px] text-slate-400">
							curated child
							{displayParentName ? ` · in ${displayParentName}` : ''}
							{attachmentCount > 1 ? ` · ${attachmentCount} contexts` : ''}
						</div>
					)}
					{content.description && (
						<div className="text-[10px] text-gray-500 line-clamp-2">{content.description}</div>
					)}
				</div>
			)
		},
	},
	{
		accessorKey: 'contextUse',
		header: 'Use',
		size: 100,
		cell: ({ row }) => {
			return (
				<span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
					{row.original.contextUse}
				</span>
			)
		},
	},
	{
		accessorKey: 'validationMode',
		header: 'Validation',
		size: 120,
		cell: ({ row }) => {
			const mode = row.original.validationMode
			if (!mode) {
				return <span className="text-[10px] text-slate-300">-</span>
			}
			const className =
				mode === 'required'
					? 'bg-red-100 text-red-700'
					: mode === 'optional'
						? 'bg-amber-100 text-amber-700'
						: 'bg-gray-100 text-gray-700'
			return <span className={`rounded px-1.5 py-0.5 text-[10px] ${className}`}>{mode}</span>
		},
	},
	{
		accessorKey: 'attachmentPolicy',
		header: 'Policy',
		size: 120,
		cell: ({ row }) => {
			const state = row.original.attachmentPolicy
			return (
				<span
					className={`rounded px-1.5 py-0.5 text-[10px] ${
						state === 'open'
							? 'bg-emerald-100 text-emerald-700'
							: 'bg-stone-100 text-stone-700'
					}`}
				>
					{state}
				</span>
			)
		},
	},
	{
		id: 'actions',
		header: '',
		size: 120,
		cell: ({ row }) => {
			const { context: contextEvent } = row.original
			const isOwner = context.currentUserPubkey === contextEvent.pubkey
			return (
				<div className="flex items-center gap-0.5">
					<Button
						size="icon-sm"
						variant="outline"
						onClick={() => context.onInspectContext?.(contextEvent)}
						aria-label="Inspect context"
						title="Inspect context"
					>
						<Eye className="h-3 w-3" />
					</Button>
					{isOwner && context.onEditContext && (
						<Button
							size="icon-sm"
							variant="outline"
							onClick={() => context.onEditContext?.(contextEvent)}
							aria-label="Edit context"
							title="Edit context"
						>
							<Pencil className="h-3 w-3" />
						</Button>
					)}
					{context.onOpenDebug && (
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label="Open debug dialog"
							title="Open debug dialog"
							onClick={() => context.onOpenDebug?.(contextEvent)}
						>
							<Bug className="h-3 w-3" />
						</Button>
					)}
				</div>
			)
		},
	},
]
