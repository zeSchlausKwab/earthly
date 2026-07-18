import { ChevronLeft, ChevronRight, Images } from 'lucide-react'
import { type ReactElement, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface GalleryImage {
	url?: string
	alt?: string
}

export function usableGalleryImages(images: readonly GalleryImage[]): Array<{
	url: string
	alt?: string
}> {
	const seen = new Set<string>()
	const usable: Array<{ url: string; alt?: string }> = []
	for (const image of images) {
		const url = image.url?.trim()
		if (!url || seen.has(url)) continue
		seen.add(url)
		usable.push({ url, alt: image.alt })
	}
	return usable
}

interface ImageGalleryDialogProps {
	images: readonly GalleryImage[]
	trigger: ReactElement
	title?: string
	initialIndex?: number
}

/**
 * Shared, keyboard-accessible image display used by entity lists and inspectors.
 * The first ordered image is the default; additional images remain reachable in
 * the same dialog without turning every entity surface into a thumbnail grid.
 */
export function ImageGalleryDialog({
	images,
	trigger,
	title = 'Image preview',
	initialIndex = 0,
}: ImageGalleryDialogProps) {
	const gallery = useMemo(() => usableGalleryImages(images), [images])
	const boundedInitialIndex = Math.min(Math.max(0, initialIndex), Math.max(0, gallery.length - 1))
	const [activeIndex, setActiveIndex] = useState(boundedInitialIndex)
	const activeImage = gallery[activeIndex] ?? gallery[0]

	if (!activeImage) return null

	const move = (direction: -1 | 1) => {
		setActiveIndex((current) => (current + direction + gallery.length) % gallery.length)
	}

	return (
		<Dialog
			onOpenChange={(open) => {
				if (open) setActiveIndex(boundedInitialIndex)
			}}
		>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent
				className="grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[3px] bg-background p-0 sm:max-w-6xl"
				onKeyDown={(event) => {
					if (gallery.length < 2) return
					if (event.key === 'ArrowLeft') move(-1)
					if (event.key === 'ArrowRight') move(1)
				}}
			>
				<DialogHeader className="border-b border-border px-4 py-3 pr-12 text-left">
					<DialogTitle className="flex items-center gap-2 text-sm">
						<Images className="h-4 w-4 text-primary" />
						{title}
					</DialogTitle>
					<DialogDescription>
						Image {activeIndex + 1} of {gallery.length}. Use the arrow keys to move between images.
					</DialogDescription>
				</DialogHeader>

				<div className="relative flex min-h-0 items-center justify-center bg-black/95 p-2 sm:p-5">
					<img
						src={activeImage.url}
						alt={activeImage.alt ?? `${title}, image ${activeIndex + 1}`}
						className="max-h-[calc(100dvh-10rem)] max-w-full object-contain"
					/>
					{gallery.length > 1 ? (
						<>
							<Button
								type="button"
								variant="ghost"
								size="icon-lg"
								className="absolute left-2 rounded-full bg-black/55 text-white hover:bg-black/75 hover:text-white"
								onClick={() => move(-1)}
								aria-label="Previous image"
							>
								<ChevronLeft className="h-5 w-5" />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon-lg"
								className="absolute right-2 rounded-full bg-black/55 text-white hover:bg-black/75 hover:text-white"
								onClick={() => move(1)}
								aria-label="Next image"
							>
								<ChevronRight className="h-5 w-5" />
							</Button>
						</>
					) : null}
				</div>

				{gallery.length > 1 ? (
					<div className="flex max-w-full gap-2 overflow-x-auto border-t border-border bg-muted/40 p-2">
						{gallery.map((image, index) => (
							<button
								type="button"
								key={image.url}
								onClick={() => setActiveIndex(index)}
								aria-label={`Show image ${index + 1}`}
								aria-current={activeIndex === index ? 'true' : undefined}
								className={cn(
									'h-14 w-14 shrink-0 overflow-hidden rounded-[2px] border-2 bg-muted',
									activeIndex === index ? 'border-primary' : 'border-transparent opacity-70',
								)}
							>
								<img src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
							</button>
						))}
					</div>
				) : (
					<div />
				)}
			</DialogContent>
		</Dialog>
	)
}
