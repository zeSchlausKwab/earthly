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
					<div className="rounded-md border border-gray-200 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-2">
						<div className="flex items-center justify-between gap-3">
							<span className="font-semibold text-gray-900">🌍 Earthly</span>
							<div className="flex items-center gap-3">
								<a
									href="https://github.com/zeSchlausKwab/earthly"
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 text-gray-700 hover:text-gray-900"
								>
									<GithubIcon className="h-4 w-4" />
									<span className="text-xs font-medium">GitHub</span>
								</a>
								<a
									href="https://opensource.org/license/mit/"
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 text-gray-700 hover:text-gray-900"
								>
									<span className="text-xs font-medium">MIT</span>
									<ExternalLink className="h-4 w-4" />
								</a>
							</div>
						</div>
					</div>

					<p className="text-gray-700 leading-snug">
						Earthly is a Nostr-native collaborative mapping application for creating, publishing,
						and exploring GeoJSON datasets over a decentralized relay network. It combines a
						mobile-friendly map editor, blossom-hosted PMTiles basemaps, and social features like
						comments and reactions on top of geographic data.
					</p>

					<div>
						<h4 className="font-semibold text-gray-900 mb-1">🧭 Selection</h4>
						<ul className="text-gray-700 space-y-0.5">
							<li>• 🖱️ Click a feature to select it</li>
							<li>
								• 🧩 Hold <strong>{multiSelectModifier}</strong> to multi-select
							</li>
							<li>• 📦 Drag to box-select</li>
						</ul>
					</div>

					<div>
						<h4 className="font-semibold text-gray-900 mb-1">✍️ Drawing</h4>
						<ul className="text-gray-700 space-y-0.5">
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
						<h4 className="font-semibold text-gray-900 mb-1">⌨️ Keyboard Shortcuts</h4>
						<div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-gray-700">
							<span>
								<Kbd className="px-1 bg-blue-50 text-blue-900 rounded">⌘/Ctrl+Z</Kbd>
							</span>
							<span>Undo</span>
							<span>
								<Kbd className="px-1 bg-blue-50 text-blue-900 rounded">⌘/Ctrl+⇧+Z</Kbd>
							</span>
							<span>Redo</span>
							<span>
								<Kbd className="px-1 bg-rose-50 text-rose-900 rounded">Delete</Kbd>
							</span>
							<span>Delete selected</span>
							<span>
								<Kbd className="px-1 bg-emerald-50 text-emerald-900 rounded">Enter</Kbd>
							</span>
							<span>Finish drawing</span>
							<span>
								<Kbd className="px-1 bg-gray-100 text-gray-900 rounded">Esc</Kbd>
							</span>
							<span>Cancel</span>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
