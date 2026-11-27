import { Download, ExternalLink, Laptop, Monitor, Smartphone } from 'lucide-react'
import {
	EARTHLY_ANDROID_APK_URL,
	EARTHLY_LINUX_TAR_URL,
	EARTHLY_MACOS_DMG_URL,
	EARTHLY_RELEASES_LATEST_URL,
	EARTHLY_WINDOWS_ZIP_URL,
	EARTHLY_ZAPSTORE_URL,
} from '@/config/app-downloads'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

export function NativeAppDownloadLinks({ className }: { className?: string }) {
	return (
		<div className={cn('flex flex-wrap gap-2 pt-2', className)}>
			<Button asChild size="sm">
				<a href={EARTHLY_ZAPSTORE_URL} target="_blank" rel="noreferrer">
					<Smartphone />
					Android (Zapstore)
					<ExternalLink />
				</a>
			</Button>
			<Button asChild size="sm" variant="outline">
				<a href={EARTHLY_ANDROID_APK_URL}>
					<Download />
					Android APK
				</a>
			</Button>
			<Button asChild size="sm" variant="outline">
				<a href={EARTHLY_MACOS_DMG_URL}>
					<Laptop />
					macOS
				</a>
			</Button>
			<Button asChild size="sm" variant="outline">
				<a href={EARTHLY_LINUX_TAR_URL}>
					<Monitor />
					Linux
				</a>
			</Button>
			<Button asChild size="sm" variant="outline">
				<a href={EARTHLY_WINDOWS_ZIP_URL}>
					<Monitor />
					Windows
				</a>
			</Button>
			<Button asChild size="sm" variant="ghost">
				<a href={EARTHLY_RELEASES_LATEST_URL} target="_blank" rel="noreferrer">
					All releases
					<ExternalLink />
				</a>
			</Button>
		</div>
	)
}
