import { ExternalLink, MapPin } from 'lucide-react'
import { GithubIcon } from '@/components/icons/GithubIcon'
import textLogoRose from '../assets/text_logo_rose.svg'
import { Kbd } from './ui/kbd'
import { ScrollArea } from './ui/scroll-area'
import { Button } from './ui/button'
import { useTourStore } from '../features/tour'

interface HelpPanelProps {
	multiSelectModifier?: string
}

export function HelpPanel({ multiSelectModifier = 'Shift' }: HelpPanelProps) {
	const { startTour, hasSeenTour } = useTourStore()

	return (
		<ScrollArea className="h-full">
			<div className="p-4 space-y-4">
				{/* Branding Header */}
				<div className="rounded-lg border border-border bg-gradient-to-r from-sky-50 via-white to-emerald-50 dark:from-sky-950/30 dark:via-background dark:to-emerald-950/30 p-3">
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<img
								src={textLogoRose}
								alt="Earthly.city"
								className="h-7 w-auto max-w-[12rem] object-contain"
							/>
						</div>
						<div className="flex items-center gap-3">
							<a
								href="https://github.com/zeSchlausKwab/earthly"
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
							>
								<GithubIcon className="h-4 w-4" />
								<span className="text-xs font-medium">GitHub</span>
							</a>
							<a
								href="https://opensource.org/license/mit/"
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
							>
								<span className="text-xs font-medium">MIT</span>
								<ExternalLink className="h-4 w-4" />
							</a>
						</div>
					</div>
				</div>

				{/* Interactive Tour */}
				<div className="rounded-lg border border-border p-3 space-y-2">
					<div className="flex items-center justify-between gap-3">
						<div>
							<p className="text-sm font-medium text-foreground">Interactive Tour</p>
							<p className="text-xs text-muted-foreground">
								{hasSeenTour ? 'Replay the guided walkthrough' : 'New here? Take a 2-minute tour'}
							</p>
						</div>
						<Button
							size="sm"
							variant={hasSeenTour ? 'outline' : 'default'}
							onClick={startTour}
							className="shrink-0 gap-1.5"
						>
							<MapPin className="h-3.5 w-3.5" />
							{hasSeenTour ? 'Replay tour' : 'Start tour'}
						</Button>
					</div>
				</div>

				{/* Description */}
				<p className="text-sm text-muted-foreground leading-relaxed">
					Earthly is a Nostr-native collaborative mapping application for creating, publishing, and
					exploring GeoJSON datasets over a decentralized relay network. It combines a
					mobile-friendly map editor, blossom-hosted PMTiles basemaps, and social features like
					comments and reactions on top of geographic data.
				</p>

				{/* Selection */}
				<div className="space-y-2">
					<h4 className="font-semibold text-foreground flex items-center gap-2">
						<span>🧭</span> Selection
					</h4>
					<ul className="text-sm text-muted-foreground space-y-1 pl-6">
						<li>• 🖱️ Click a feature to select it</li>
						<li>
							• 🧩 Hold <strong className="text-foreground">{multiSelectModifier}</strong> to
							multi-select
						</li>
						<li>• 📦 Drag to box-select</li>
					</ul>
				</div>

				{/* Drawing */}
				<div className="space-y-2">
					<h4 className="font-semibold text-foreground flex items-center gap-2">
						<span>✍️</span> Drawing
					</h4>
					<ul className="text-sm text-muted-foreground space-y-1 pl-6">
						<li>• 📍 Click to add points</li>
						<li>
							• ✅ Double-click or <strong className="text-foreground">Enter</strong> to finish
						</li>
						<li>
							• 🛑 <strong className="text-foreground">Escape</strong> to cancel
						</li>
					</ul>
				</div>

				{/* Keyboard Shortcuts */}
				<div className="space-y-2">
					<h4 className="font-semibold text-foreground flex items-center gap-2">
						<span>⌨️</span> Keyboard Shortcuts
					</h4>
					<div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-muted-foreground pl-6">
						<span>
							<Kbd className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-300 rounded text-xs">
								⌘/Ctrl+Z
							</Kbd>
						</span>
						<span>Undo</span>
						<span>
							<Kbd className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-300 rounded text-xs">
								⌘/Ctrl+⇧+Z
							</Kbd>
						</span>
						<span>Redo</span>
						<span>
							<Kbd className="px-1.5 py-0.5 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-300 rounded text-xs">
								Delete
							</Kbd>
						</span>
						<span>Delete selected</span>
						<span>
							<Kbd className="px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-300 rounded text-xs">
								Enter
							</Kbd>
						</span>
						<span>Finish drawing</span>
						<span>
							<Kbd className="px-1.5 py-0.5 bg-muted text-foreground rounded text-xs">Esc</Kbd>
						</span>
						<span>Cancel</span>
					</div>
				</div>
			</div>
		</ScrollArea>
	)
}
