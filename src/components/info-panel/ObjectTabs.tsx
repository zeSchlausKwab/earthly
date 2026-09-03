import { FileText, MessageCircle, MessageSquare } from 'lucide-react'
import type { EarthlyObjectTab } from '@/router/routeContract'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface ObjectTabsProps {
	value: EarthlyObjectTab
	onValueChange: (value: EarthlyObjectTab) => void
	commentsCount?: number
	threadAvailable?: boolean
}

/** Shared route-backed tabs for every social object in the Margin. */
export function ObjectTabs({
	value,
	onValueChange,
	commentsCount,
	threadAvailable = true,
}: ObjectTabsProps) {
	return (
		<Tabs value={value} onValueChange={(next) => onValueChange(next as EarthlyObjectTab)}>
			<TabsList className="h-8 w-full justify-start rounded-none border-b border-border bg-transparent p-0">
				<TabsTrigger
					value="details"
					className="h-8 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
				>
					<FileText className="h-3.5 w-3.5" aria-hidden="true" />
					Details
				</TabsTrigger>
				<TabsTrigger
					value="comments"
					className="h-8 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
				>
					<MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
					Comments{commentsCount === undefined ? '' : ` ${commentsCount}`}
				</TabsTrigger>
				{threadAvailable ? (
					<TabsTrigger
						value="thread"
						className="h-8 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
					>
						<MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
						Thread
					</TabsTrigger>
				) : null}
			</TabsList>
		</Tabs>
	)
}

export function ThreadTabNotice() {
	return (
		<div className="border-t border-border py-4 text-sm text-muted-foreground" role="status">
			The Thread is open beside this Margin. On narrower screens it replaces the details surface.
		</div>
	)
}
