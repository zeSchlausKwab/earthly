import {
	ArrowUpRight,
	BookOpen,
	Compass,
	Database,
	Globe2,
	Layers3,
	MapPin,
	RadioTower,
	Route,
	Smartphone,
	Users,
	X,
	type LucideIcon,
} from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Button } from '@/components/ui/button'

export type DiscoveryItemKind = 'dataset' | 'story' | 'context'

export interface DiscoveryItem {
	id: string
	title: string
	summary?: string
	meta?: string
}

export interface DiscoverDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	datasets: readonly DiscoveryItem[]
	stories: readonly DiscoveryItem[]
	contexts: readonly DiscoveryItem[]
	onSelectItem: (kind: DiscoveryItemKind, id: string) => void
	onBrowseSightings: () => void
	onCreatePrivateGroup: () => void
	onGetApp: () => void
	onTakeTour: () => void
	tourReady: boolean
	loading?: boolean
}

interface IndexSectionProps {
	kind: DiscoveryItemKind
	index: string
	title: string
	description: string
	icon: LucideIcon
	items: readonly DiscoveryItem[]
	loading: boolean
	onSelect: (kind: DiscoveryItemKind, id: string) => void
}

interface AtlasActionProps {
	title: string
	description: string
	icon: LucideIcon
	onClick: () => void
}

const MAX_ITEMS_PER_SECTION = 3

function LoadingRows() {
	return (
		<div className="space-y-1.5" aria-hidden="true">
			{[0, 1, 2].map((row) => (
				<div key={row} className="h-[3.2rem] animate-pulse border border-border/60 bg-muted/60" />
			))}
		</div>
	)
}

function EmptySection({ kind }: { kind: DiscoveryItemKind }) {
	const nouns: Record<DiscoveryItemKind, string> = {
		dataset: 'datasets',
		story: 'stories',
		context: 'contexts',
	}

	return (
		<div className="flex min-h-[3.2rem] items-center border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
			No featured {nouns[kind]} yet. Check back as the atlas grows.
		</div>
	)
}

function IndexSection({
	kind,
	index,
	title,
	description,
	icon: Icon,
	items,
	loading,
	onSelect,
}: IndexSectionProps) {
	const visibleItems = items.slice(0, MAX_ITEMS_PER_SECTION)

	return (
		<section
			className="min-w-0 border-t-2 border-foreground/80 pt-2"
			aria-labelledby={`discover-${kind}`}
		>
			<div className="mb-2 flex items-start gap-2">
				<span
					className="font-mono text-[0.625rem] leading-5 text-muted-foreground"
					aria-hidden="true"
				>
					{index}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<Icon className="size-3.5 text-primary" aria-hidden="true" />
						<h2 id={`discover-${kind}`} className="text-xs font-semibold tracking-wide uppercase">
							{title}
						</h2>
					</div>
					<p className="mt-0.5 text-[0.6875rem] leading-4 text-muted-foreground">{description}</p>
				</div>
			</div>

			{loading ? (
				<LoadingRows />
			) : visibleItems.length === 0 ? (
				<EmptySection kind={kind} />
			) : (
				<ul className="space-y-1">
					{visibleItems.map((item) => (
						<li key={item.id}>
							<button
								type="button"
								onClick={() => onSelect(kind, item.id)}
								className="group flex min-h-[3.2rem] w-full items-start gap-2 border border-border bg-card px-2.5 py-2 text-left transition-colors hover:border-foreground/40 hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
								aria-label={`Open ${kind}: ${item.title}`}
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-xs font-semibold text-card-foreground">
										{item.title}
									</span>
									{item.summary ? (
										<span className="mt-0.5 line-clamp-2 block text-[0.6875rem] leading-4 text-muted-foreground">
											{item.summary}
										</span>
									) : null}
									{item.meta ? (
										<span className="mt-1 block truncate font-mono text-[0.625rem] text-muted-foreground">
											{item.meta}
										</span>
									) : null}
								</span>
								<ArrowUpRight
									className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
									aria-hidden="true"
								/>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	)
}

function AtlasAction({ title, description, icon: Icon, onClick }: AtlasActionProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="group flex min-h-16 items-start gap-2 border border-border bg-secondary/50 p-2.5 text-left transition-colors hover:border-foreground/40 hover:bg-secondary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
		>
			<span className="grid size-7 shrink-0 place-items-center border border-border bg-background">
				<Icon className="size-3.5 text-primary" aria-hidden="true" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex items-center gap-1 text-xs font-semibold">
					{title}
					<ArrowUpRight
						className="size-3 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
						aria-hidden="true"
					/>
				</span>
				<span className="mt-0.5 block text-[0.6875rem] leading-4 text-muted-foreground">
					{description}
				</span>
			</span>
		</button>
	)
}

export function DiscoverDialog({
	open,
	onOpenChange,
	datasets,
	stories,
	contexts,
	onSelectItem,
	onBrowseSightings,
	onCreatePrivateGroup,
	onGetApp,
	onTakeTour,
	tourReady,
	loading = false,
}: DiscoverDialogProps) {
	const selectItem = (kind: DiscoveryItemKind, id: string) => {
		onOpenChange(false)
		onSelectItem(kind, id)
	}

	const runAndClose = (action: () => void) => {
		onOpenChange(false)
		action()
	}

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 isolate z-[90] bg-black/70 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
				<DialogPrimitive.Content
					className="fixed inset-x-3 top-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[91] flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden border border-border bg-popover text-popover-foreground shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[min(88dvh,48rem)] sm:w-[min(calc(100vw-2rem),56rem)] sm:-translate-x-1/2 sm:-translate-y-1/2"
					aria-busy={loading}
				>
					{loading ? (
						<span className="sr-only" role="status">
							Loading the latest Earthly maps, stories, and contexts.
						</span>
					) : null}
					<div
						className="pointer-events-none absolute inset-0 opacity-[0.045] dark:opacity-[0.08]"
						style={{
							backgroundImage:
								'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
							backgroundSize: '24px 24px',
						}}
						aria-hidden="true"
					/>

					<header className="relative shrink-0 border-b border-border bg-popover/95 px-4 py-3 pr-11 sm:px-5 sm:py-4 sm:pr-12">
						<div className="flex items-start gap-3">
							<div className="relative grid size-10 shrink-0 place-items-center border-2 border-foreground bg-primary text-primary-foreground">
								<Compass className="size-5" aria-hidden="true" />
								<span className="absolute -right-1 -bottom-1 size-2 border border-foreground bg-popover" />
							</div>
							<div className="min-w-0">
								<div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase">
									<span>Earthly field atlas</span>
									<span aria-hidden="true">/</span>
									<span>Live index</span>
								</div>
								<DialogPrimitive.Title className="font-serif text-xl leading-none font-semibold tracking-tight sm:text-2xl">
									Discover Earthly
								</DialogPrimitive.Title>
								<DialogPrimitive.Description className="mt-1.5 max-w-2xl text-xs leading-5 text-muted-foreground">
									Open a map, follow its story, or join work happening in the field. The latest map
									loads beneath this index when one is available.
								</DialogPrimitive.Description>
							</div>
						</div>
						<DialogPrimitive.Close asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-lg"
								className="absolute top-2 right-2"
								aria-label="Close Discover"
							>
								<X aria-hidden="true" />
							</Button>
						</DialogPrimitive.Close>
					</header>

					<div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
						<div className="grid gap-4 md:grid-cols-3">
							<IndexSection
								kind="dataset"
								index="01"
								title="Datasets"
								description="Reusable maps and geographic layers."
								icon={Database}
								items={datasets}
								loading={loading}
								onSelect={selectItem}
							/>
							<IndexSection
								kind="story"
								index="02"
								title="Stories"
								description="Guided narratives told through maps."
								icon={BookOpen}
								items={stories}
								loading={loading}
								onSelect={selectItem}
							/>
							<IndexSection
								kind="context"
								index="03"
								title="Contexts"
								description="Shared places, questions, and discussions."
								icon={Layers3}
								items={contexts}
								loading={loading}
								onSelect={selectItem}
							/>
						</div>

						<div className="mt-5 border-t border-border pt-3">
							<div className="mb-2 flex items-center gap-2">
								<Route className="size-3.5 text-primary" aria-hidden="true" />
								<h2 className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase">
									Ways into the map
								</h2>
							</div>
							<div className="grid gap-1.5 sm:grid-cols-3">
								<AtlasAction
									title="Sightings"
									description="Browse recent observations shared from the field."
									icon={RadioTower}
									onClick={() => runAndClose(onBrowseSightings)}
								/>
								<AtlasAction
									title="Create a private group"
									description="Map and coordinate with invited collaborators."
									icon={Users}
									onClick={() => runAndClose(onCreatePrivateGroup)}
								/>
								<AtlasAction
									title="Get the app"
									description="Carry maps into the field and work offline."
									icon={Smartphone}
									onClick={() => runAndClose(onGetApp)}
								/>
							</div>
						</div>
					</div>

					<footer className="relative flex shrink-0 flex-col gap-2 border-t-2 border-foreground/80 bg-secondary/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
						<div className="flex min-w-0 items-start gap-2">
							<span className="grid size-7 shrink-0 place-items-center border border-border bg-background">
								<Globe2 className="size-3.5 text-primary" aria-hidden="true" />
							</span>
							<div>
								<p className="text-xs font-semibold">New to the atlas?</p>
								<p className="text-[0.6875rem] leading-4 text-muted-foreground">
									Take a short, optional tour of the map tools.
								</p>
							</div>
						</div>
						<div className="flex items-center gap-2 sm:shrink-0">
							{!tourReady ? (
								<span className="text-[0.625rem] text-muted-foreground" role="status">
									Map is still preparing…
								</span>
							) : null}
							<Button
								type="button"
								size="lg"
								className="ml-auto border border-foreground/80 shadow-sm"
								onClick={() => runAndClose(onTakeTour)}
								disabled={!tourReady}
								aria-describedby={!tourReady ? 'discover-tour-status' : undefined}
							>
								<MapPin aria-hidden="true" />
								Take the tour
							</Button>
							{!tourReady ? (
								<span id="discover-tour-status" className="sr-only">
									The tour becomes available when the map has finished loading.
								</span>
							) : null}
						</div>
					</footer>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	)
}
