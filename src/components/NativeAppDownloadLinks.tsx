import { ExternalLink, Laptop, Smartphone } from 'lucide-react'
import { EARTHLY_MACOS_DMG_URL, EARTHLY_ZAPSTORE_URL } from '@/config/app-downloads'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

export function NativeAppDownloadLinks({ className }: { className?: string }) {
	return (
		<div className={cn('flex flex-wrap gap-2 pt-2', className)}>
			<Button asChild size="sm">
				<a href={EARTHLY_ZAPSTORE_URL} target="_blank" rel="noreferrer">
					<Smartphone />
					Get Android app
					<ExternalLink />
				</a>
			</Button>
			<Button asChild size="sm" variant="outline">
				<a href={EARTHLY_MACOS_DMG_URL}>
					<Laptop />
					Download for macOS
				</a>
			</Button>
		</div>
	)
}
