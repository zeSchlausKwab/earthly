import { FileText, LoaderCircle, MessageCircle, MessageSquare } from 'lucide-react'
import type { EarthlyObjectTab } from '@/router/routeContract'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMobileObjectNavigation } from './MobileObjectNavigation'
import { useContext } from 'react'
import { ObjectThreadBesideContext } from './ObjectThreadPlacement'

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
	const mobileNavigation = useMobileObjectNavigation()
	const beside = useContext(ObjectThreadBesideContext)
	return (
		<Tabs value={value} onValueChange={(next) => onValueChange(next as EarthlyObjectTab)}>
			<TabsList
				aria-label="Object sections"
				className="h-11 w-full justify-start rounded-none border-b border-border bg-transparent p-0 md:h-8"
			>
				<TabsTrigger
					value="details"
					className="h-11 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none md:h-8"
				>
					<FileText className="h-3.5 w-3.5" aria-hidden="true" />
					Details
				</TabsTrigger>
				<TabsTrigger
					value="comments"
					className="h-11 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none md:h-8"
				>
					<MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
					Comments{commentsCount === undefined ? '' : ` ${commentsCount}`}
				</TabsTrigger>
				{threadAvailable ? (
					<TabsTrigger
						value="thread"
						className="h-11 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none md:h-8"
					>
						<MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
						Thread
						{beside && value === 'thread' && <span className="text-[10px] text-muted-foreground" aria-hidden="true">on right</span>}
						{mobileNavigation?.threadWorking ? (
							<LoaderCircle className="size-3 animate-spin" aria-label="Working" />
						) : null}
					</TabsTrigger>
				) : null}
			</TabsList>
		</Tabs>
	)
}

export function ThreadTabNotice() {
	const mobileNavigation = useMobileObjectNavigation()
	if (mobileNavigation?.threadContent) return <>{mobileNavigation.threadContent}</>
	return (
		<div className="border-t border-border py-4 text-sm text-muted-foreground" role="status">
			The Thread is open beside this Margin. On narrower screens it replaces the details surface.
		</div>
	)
}
