import { use$ } from 'applesauce-react/hooks'
import { UserRound } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { eventStore } from '@/lib/nostr'
import { cn } from '@/lib/utils'

/** The navigation identity is the signed-in account, not the currently viewed profile. */
export function AccountMenuButton({
	pubkey,
	mobile = false,
	className,
	...props
}: ComponentProps<'button'> & { pubkey?: string | null; mobile?: boolean }) {
	const profile = use$(() => (pubkey ? eventStore.profile(pubkey) : undefined), [pubkey])
	const name = pubkey
		? profile?.name || profile?.display_name || `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
		: 'Sign in'
	return (
		<button
			{...props}
			type="button"
			aria-label={pubkey ? `Your account: ${name}` : 'Sign in'}
			title={pubkey ? `Signed in as ${name}` : 'Sign in to Earthly'}
			className={cn(
				mobile
					? 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px] text-muted-foreground hover:text-foreground'
					: 'earthly-topbar__action max-w-44',
				className,
			)}
		>
			{pubkey ? (
				<Avatar key={pubkey} className="size-6 shrink-0" aria-hidden="true">
					<AvatarImage src={profile?.picture} alt="" />
					<AvatarFallback
						className="text-[10px] font-semibold text-white"
						style={{ backgroundColor: `hsl(${parseInt(pubkey.slice(0, 4), 16) % 360} 40% 35%)` }}
					>
						{(profile?.name || profile?.display_name || pubkey).slice(0, 2).toUpperCase()}
					</AvatarFallback>
				</Avatar>
			) : (
				<UserRound className="size-5 shrink-0" aria-hidden="true" />
			)}
			<span className="max-w-full min-w-0 truncate">{name}</span>
		</button>
	)
}
