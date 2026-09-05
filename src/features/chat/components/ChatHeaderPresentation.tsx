import { AlertTriangle, LockKeyhole, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export function chatSafetyPresentation(readOnly: boolean, safetyLevel: number) {
	if (readOnly) {
		return {
			label: 'Read-only',
			description: 'Text only; no tools or map changes.',
			permissive: false,
		}
	}
	if (safetyLevel === 3) {
		return {
			label: 'Auto apply',
			description: 'AI changes are applied automatically. Open Thread settings to change safety.',
			permissive: true,
		}
	}
	return {
		label: safetyLevel === 1 ? 'Ask always' : 'Ask first',
		description: safetyLevel === 1 ? 'Ask before every change.' : 'Ask before changing the map.',
		permissive: false,
	}
}

/** The surrounding object header already identifies an embedded conversation. */
export function ChatThreadIdentity({ title, embedded }: { title: string; embedded: boolean }) {
	if (embedded) return null
	return (
		<p className="min-w-0 flex-1 truncate text-xs font-semibold" title={title}>
			{title}
		</p>
	)
}

export function ChatSafetyIndicator({
	readOnly,
	safetyLevel,
}: {
	readOnly: boolean
	safetyLevel: number
}) {
	const safety = chatSafetyPresentation(readOnly, safetyLevel)
	const Icon = readOnly ? LockKeyhole : safety.permissive ? AlertTriangle : ShieldCheck
	return (
		<span
			className={cn(
				'inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium',
				safety.permissive ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
			)}
			title={safety.description}
		>
			<Icon className="size-3.5 shrink-0" aria-hidden="true" />
			{safety.label}
		</span>
	)
}
