import { ExternalLink, HelpCircle } from 'lucide-react'
import { GithubIcon } from '@/components/icons/GithubIcon'
import { Button } from './ui/button'
import { Kbd } from './ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

interface HelpPopoverProps {
	multiSelectModifier?: string
}

export function HelpPopover({ multiSelectModifier = 'Shift' }: HelpPopoverProps) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button size="icon" variant="ghost" aria-label="Help & shortcuts">
					<HelpCircle className="h-4 w-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-96 text-sm" align="end">
				<div className="space-y-3">
					<div className="rounded-md border border-border bg-gradient-to-r from-info via-white to-ok p-2">
						<div className="flex items-center justify-between gap-3">
							<span className="font-semibold text-foreground">🌍 Earthly</span>
							<div className="flex items-center gap-3">
								<a
									href="https://github.com/zeSchlausKwab/earthly"
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 text-foreground hover:text-foreground"
								>
									<GithubIcon className="h-4 w-4" />
									<span className="text-xs font-medium">GitHub</span>
								</a>
								<a
									href="https://opensource.org/license/mit/"
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 text-foreground hover:text-foreground"
								>
									<span className="text-xs font-medium">MIT</span>
									<ExternalLink className="h-4 w-4" />
								</a>
							</div>
						</div>
					</div>

					<p className="text-foreground leading-snug">
						Earthly is a Nostr-native collaborative mapping application for creating, publishing,
						and exploring GeoJSON datasets over a decentralized relay network. It combines a
						mobile-friendly map editor, blossom-hosted PMTiles basemaps, and social features like
						comments and reactions on top of geographic data.
					</p>

					<div>
						<h4 className="font-semibold text-foreground mb-1">🧭 Selection</h4>
						<ul className="text-foreground space-y-0.5">
							<li>• 🖱️ Click a feature to select it</li>
							<li>
								• 🧩 Hold <strong>{multiSelectModifier}</strong> to multi-select
							</li>
							<li>• 📦 Drag to box-select</li>
						</ul>
					</div>

					<div>
						<h4 className="font-semibold text-foreground mb-1">✍️ Drawing</h4>
						<ul className="text-foreground space-y-0.5">
							<li>• 📍 Click to add points</li>
							<li>
								• ✅ Double-click or <strong>Enter</strong> to finish
							</li>
							<li>
								• 🛑 <strong>Escape</strong> to cancel
							</li>
						</ul>
					</div>

					<div>
						<h4 className="font-semibold text-foreground mb-1">⌨️ Keyboard Shortcuts</h4>
						<div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-foreground">
							<span>
								<Kbd className="px-1 bg-info/15 text-info rounded">⌘/Ctrl+Z</Kbd>
							</span>
							<span>Undo</span>
							<span>
								<Kbd className="px-1 bg-info/15 text-info rounded">⌘/Ctrl+⇧+Z</Kbd>
							</span>
							<span>Redo</span>
							<span>
								<Kbd className="px-1 bg-destructive/10 text-destructive rounded">Delete</Kbd>
							</span>
							<span>Delete selected</span>
							<span>
								<Kbd className="px-1 bg-ok/15 text-ok rounded">Enter</Kbd>
							</span>
							<span>Finish drawing</span>
							<span>
								<Kbd className="px-1 bg-muted text-foreground rounded">Esc</Kbd>
							</span>
							<span>Cancel</span>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
