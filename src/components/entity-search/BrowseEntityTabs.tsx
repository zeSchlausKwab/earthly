import { BookOpen, Eye, Globe, Plus, UserRound } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import type { EarthlyBrowseKind } from '@/router/routeContract'
import { cn } from '@/lib/utils'
import { DatasetGlyphIcon } from '../entity-action-icons'
import { Button } from '../ui/button'

type BrowseIcon = ComponentType<SVGProps<SVGSVGElement>>

export interface BrowseTabDefinition {
	kind: EarthlyBrowseKind
	label: string
	icon: BrowseIcon
}

const FULL_BROWSE_TABS: readonly BrowseTabDefinition[] = [
	{ kind: 'maps', label: 'Maps', icon: DatasetGlyphIcon },
	{ kind: 'stories', label: 'Stories', icon: BookOpen },
	{ kind: 'atlases', label: 'Atlases', icon: Globe },
	{ kind: 'sightings', label: 'Sightings', icon: Eye },
	{ kind: 'people', label: 'People', icon: UserRound },
]

const CREATE_LABELS: Record<Exclude<EarthlyBrowseKind, 'people'>, string> = {
	maps: 'New Map',
	stories: 'New Story',
	atlases: 'New Atlas',
	sightings: 'New Sighting',
}

function pluralize(noun: string): string {
	const trimmed = noun.trim()
	if (!trimmed) return 'Spots'
	const plural = /s$/i.test(trimmed) ? trimmed : `${trimmed}s`
	return plural.charAt(0).toUpperCase() + plural.slice(1)
}

/** The lens deliberately narrows Browse; its first label adopts the Atlas noun. */
export function getBrowseTabDefinitions(lensItemNoun?: string): readonly BrowseTabDefinition[] {
	if (!lensItemNoun) return FULL_BROWSE_TABS
	return [
		{ kind: 'maps', label: pluralize(lensItemNoun), icon: DatasetGlyphIcon },
		{ kind: 'stories', label: 'Stories', icon: BookOpen },
		{ kind: 'people', label: 'People', icon: UserRound },
	]
}

export interface BrowseEntityTabsProps {
	/** Controlled from the route. There is intentionally no local `maps` default. */
	activeKind: EarthlyBrowseKind
	onKindChange: (kind: EarthlyBrowseKind) => void
	counts?: Partial<Record<EarthlyBrowseKind, number>>
	/** When set, Browse becomes Spots/Stories/People and adopts this Atlas noun. */
	lensItemNoun?: string
	onCreate?: (kind: Exclude<EarthlyBrowseKind, 'people'>) => void
	createLabel?: string
	className?: string
}

/** Route-controlled Browse navigation shared by desktop Margin and phone sheet. */
export function BrowseEntityTabs({
	activeKind,
	onKindChange,
	counts,
	lensItemNoun,
	onCreate,
	createLabel,
	className,
}: BrowseEntityTabsProps) {
	const tabs = getBrowseTabDefinitions(lensItemNoun)
	const createKind = activeKind === 'people' ? null : activeKind

	return (
		<div className={cn('flex min-w-0 items-end border-b border-border', className)}>
			<div
				role="tablist"
				aria-label="Browse"
				className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto"
			>
				{tabs.map((tab) => {
					const Icon = tab.icon
					const active = tab.kind === activeKind
					const count = counts?.[tab.kind]
					return (
						<button
							key={tab.kind}
							type="button"
							role="tab"
							aria-selected={active}
							aria-controls={`browse-${tab.kind}-panel`}
							onClick={() => onKindChange(tab.kind)}
							className={cn(
								'relative inline-flex h-8 shrink-0 items-center gap-1.5 px-2 text-[11px] font-medium transition-colors',
								'after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:scale-x-0 after:bg-primary after:transition-transform',
								active
									? 'text-foreground after:scale-x-100'
									: 'text-muted-foreground hover:text-foreground',
							)}
						>
							<Icon className="h-3.5 w-3.5" aria-hidden="true" />
							<span>{tab.label}</span>
							{count !== undefined ? (
								<span className="font-mono text-[9px] text-muted-foreground">{count}</span>
							) : null}
						</button>
					)
				})}
			</div>
			{createKind && onCreate ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="mb-0.5 h-7 shrink-0 rounded-sm px-2 text-[11px]"
					onClick={() => onCreate(createKind)}
					aria-label={createLabel ?? CREATE_LABELS[createKind]}
				>
					<Plus className="h-3.5 w-3.5" aria-hidden="true" />
					{createLabel ? <span className="hidden xl:inline">{createLabel}</span> : null}
				</Button>
			) : null}
		</div>
	)
}
