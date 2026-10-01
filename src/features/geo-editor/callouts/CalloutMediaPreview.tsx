import { Video } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { MapCalloutMedia } from '@/lib/geo/callouts'
import { cn } from '@/lib/utils'

function isVideo(media: MapCalloutMedia): boolean {
	return (
		media.mimeType?.startsWith('video/') === true || /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(media.url)
	)
}

/** Media fills a bounded slot; its intrinsic dimensions never resize the callout. */
export function CalloutMediaPreview({
	media,
	thumbnail = false,
	className,
}: {
	media: MapCalloutMedia[]
	thumbnail?: boolean
	className?: string
}) {
	const first = media[0]
	if (!first) return null
	return (
		<div
			className={cn(
				'relative shrink-0 overflow-hidden rounded-[3px] border border-black/10 bg-muted',
				thumbnail ? 'size-12' : 'h-24 w-full',
				className,
			)}
		>
			{isVideo(first) && !thumbnail ? (
				<video
					controls
					muted
					preload="metadata"
					poster={first.thumbnailUrl}
					className="pointer-events-auto h-full w-full object-contain"
					onPointerDown={(event) => event.stopPropagation()}
				>
					<source src={first.url} type={first.mimeType} />
				</video>
			) : (
				<a
					href={first.url}
					target="_blank"
					rel="noreferrer"
					aria-label={isVideo(first) ? 'Open callout video' : 'Open callout image'}
					className="pointer-events-auto flex h-full w-full items-center justify-center"
				>
					{isVideo(first) && !first.thumbnailUrl ? (
						<Video className="size-4 text-muted-foreground" />
					) : (
						<img
							src={isVideo(first) ? first.thumbnailUrl : first.url}
							alt={first.alt ?? 'Callout image'}
							decoding="async"
							className="block h-full w-full object-contain"
						/>
					)}
				</a>
			)}
			{media.length > 1 ? (
				<span className="pointer-events-none absolute right-1 top-1 rounded-full bg-black/70 px-1 py-0.5 text-[9px] font-medium text-white">
					+{media.length - 1}
				</span>
			) : null}
		</div>
	)
}

export function CalloutImageUrlInput({ onAdd }: { onAdd: (media: MapCalloutMedia) => void }) {
	const [url, setUrl] = useState('')
	const [error, setError] = useState<string | null>(null)
	const add = () => {
		try {
			const parsed = new URL(url.trim())
			if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error()
		} catch {
			setError('Enter an http or https image URL.')
			return
		}
		onAdd({ url: url.trim() })
		setUrl('')
		setError(null)
	}
	return (
		<div className="space-y-1">
			<div className="flex gap-1.5">
				<Input
					value={url}
					onChange={(event) => {
						setUrl(event.target.value)
						setError(null)
					}}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault()
							add()
						}
					}}
					type="url"
					aria-label="Callout image URL"
					aria-invalid={Boolean(error)}
					placeholder="Image URL…"
					className="h-7 min-w-0 flex-1 text-[11px]"
				/>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 px-2 text-[11px]"
					disabled={!url.trim()}
					onClick={add}
				>
					Add image
				</Button>
			</div>
			{error ? (
				<p role="alert" className="text-[10px] text-destructive">
					{error}
				</p>
			) : null}
		</div>
	)
}
