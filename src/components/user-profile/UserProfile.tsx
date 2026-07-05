import { use$ } from 'applesauce-react/hooks'
import { BadgeCheck, Globe, User } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { memo, useCallback, useMemo, useRef } from 'react'
import { eventStore } from '@/lib/nostr'
import { navigateToRoute } from '@/features/geo-editor/hooks/useRouting'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ProfileData = {
	name?: string
	display_name?: string
	displayName?: string
	image?: string
	picture?: string
	about?: string
	nip05?: string
	website?: string
}

const profileCache = new Map<string, ProfileData>()

/** Score a profile so we don't flicker to a less-complete version mid-stream. */
function getProfileScore(p: ProfileData | null | undefined): number {
	if (!p) return 0
	let score = 0
	if (p.name) score += 2
	if (p.displayName || p.display_name) score += 1
	if (p.image || p.picture) score += 2
	if (p.about) score += 1
	if (p.nip05) score += 1
	if (p.website) score += 1
	return score
}

/**
 * Resolve a hex pubkey from any of: hex, npub, nprofile.
 *
 * Note: NIP-05 input (`name@host`) is no longer supported here. The few legacy
 * call sites all pass hex pubkeys; if you need NIP-05 → pubkey resolution,
 * decode separately and pass the hex result in.
 */
function resolveHexPubkey(input: string): string | null {
	if (!input) return null
	if (/^[0-9a-f]{64}$/i.test(input)) return input.toLowerCase()
	if (input.startsWith('npub') || input.startsWith('nprofile')) {
		try {
			const decoded = nip19.decode(input)
			if (decoded.type === 'npub') return decoded.data as string
			if (decoded.type === 'nprofile') return (decoded.data as { pubkey: string }).pubkey
		} catch {
			return null
		}
	}
	return null
}

export type UserProfileMode = 'name-only' | 'avatar-name' | 'avatar-name-bio' | 'full-profile'
export type UserProfileSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface UserProfileProps {
	/** Hex pubkey, npub, or nprofile. Hex preferred. */
	pubkey: string
	mode?: UserProfileMode
	size?: UserProfileSize
	className?: string
	/**
	 * Whether to show a NIP-05 verified badge when the profile claims one.
	 * The badge is currently advisory — DNS verification is not performed.
	 */
	showNip05Badge?: boolean
	showWebsite?: boolean
	showBio?: boolean
	onClick?: () => void
	fallbackText?: string
	interactive?: boolean
}

/**
 * Display a Nostr user's profile (kind 0 metadata) in one of four modes.
 *
 * Reads from the EventStore via `eventStore.profile(pubkey)`, which the
 * configured event-loader auto-fetches on first subscribe. The component
 * caches the best-scoring profile snapshot per pubkey to prevent flicker
 * when relays trickle in over multiple seconds.
 */
function UserProfileComponent({
	pubkey,
	mode = 'avatar-name',
	size = 'md',
	className = '',
	showNip05Badge = true,
	showWebsite = true,
	showBio = true,
	onClick,
	fallbackText,
	interactive = true,
}: UserProfileProps) {
	const hexPubkey = useMemo(() => resolveHexPubkey(pubkey), [pubkey])

	// Subscribe to the kind 0 profile content for this pubkey. The event-loader
	// in `lib/nostr` auto-fetches if we don't have it cached.
	const rawProfile = use$(
		() => (hexPubkey ? eventStore.profile(hexPubkey) : undefined),
		[hexPubkey],
	)

	// Anti-flicker: keep the best-scoring version we've seen.
	const committedProfileRef = useRef<ProfileData | null>(null)
	const profileCacheKey = hexPubkey ?? pubkey

	const profile = useMemo<ProfileData | null>(() => {
		const cached = profileCache.get(profileCacheKey) ?? null
		const baseline = committedProfileRef.current ?? cached
		const next = (rawProfile ?? null) as ProfileData | null
		const newScore = getProfileScore(next)
		const oldScore = getProfileScore(baseline)

		if (next && newScore >= oldScore) {
			committedProfileRef.current = next
			profileCache.set(profileCacheKey, next)
			return next
		}
		if (!committedProfileRef.current && cached) {
			committedProfileRef.current = cached
		}
		return committedProfileRef.current ?? cached ?? next
	}, [rawProfile, profileCacheKey])

	const displayName = useMemo(() => {
		if (profile?.name) return profile.name
		const display = profile?.display_name ?? profile?.displayName
		if (display) return display
		const resolved = hexPubkey ?? pubkey
		if (resolved.startsWith('npub') || resolved.startsWith('nprofile')) {
			return `${resolved.slice(0, 8)}…`
		}
		return `${resolved.slice(0, 8)}…${resolved.slice(-4)}`
	}, [profile?.name, profile?.display_name, profile?.displayName, hexPubkey, pubkey])

	const getFallbackText = (): string => {
		if (fallbackText) return fallbackText
		if (profile?.name) return profile.name.substring(0, 2).toUpperCase()
		const display = profile?.display_name ?? profile?.displayName
		if (display) return display.substring(0, 2).toUpperCase()
		const resolved = hexPubkey ?? pubkey
		return resolved.substring(0, 2).toUpperCase()
	}

	const sizeConfig = {
		xs: { avatar: 'size-4', icon: 'size-2.5', text: 'text-[10px]', badge: 'size-3', gap: 'gap-1' },
		sm: { avatar: 'size-5', icon: 'size-3', text: 'text-xs', badge: 'size-3.5', gap: 'gap-1.5' },
		md: { avatar: 'size-7', icon: 'size-4', text: 'text-sm', badge: 'size-4', gap: 'gap-2' },
		lg: { avatar: 'size-10', icon: 'size-5', text: 'text-base', badge: 'size-4', gap: 'gap-2.5' },
		xl: { avatar: 'size-16', icon: 'size-8', text: 'text-lg', badge: 'size-5', gap: 'gap-3' },
	}

	const config = sizeConfig[size]

	const Nip05Badge = ({ className: badgeClass }: { className?: string }) => {
		if (!showNip05Badge || !profile?.nip05) return null
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<span className={badgeClass}>
						<BadgeCheck className={cn(config.badge, 'text-ok flex-shrink-0')} />
					</span>
				</TooltipTrigger>
				<TooltipContent>{profile.nip05}</TooltipContent>
			</Tooltip>
		)
	}

	const ProfileAvatar = ({ sizeClass }: { sizeClass: string }) => (
		<Avatar className={cn(sizeClass, 'flex-shrink-0')}>
			<AvatarImage
				src={profile?.image || profile?.picture}
				alt={displayName}
				className="object-cover"
			/>
			<AvatarFallback className={cn(config.text, 'bg-gradient-to-br from-info to-ok text-white')}>
				{profile ? getFallbackText() : <User className={config.icon} />}
			</AvatarFallback>
		</Avatar>
	)

	const handleDefaultClick = useCallback(() => {
		const resolved = hexPubkey ?? pubkey
		if (resolved && !resolved.startsWith('npub') && !resolved.startsWith('nprofile')) {
			const npub = nip19.npubEncode(resolved)
			navigateToRoute(`/user/${npub}`)
		} else if (resolved) {
			navigateToRoute(`/user/${resolved}`)
		}
	}, [hexPubkey, pubkey])

	const Wrapper = ({ children }: { children: React.ReactNode }) => {
		if (!interactive) {
			return <div className={cn('text-left', className)}>{children}</div>
		}
		const clickHandler = onClick ?? handleDefaultClick
		return (
			<Button
				type="button"
				variant="ghost"
				onClick={clickHandler}
				className={cn(
					'cursor-pointer hover:opacity-80 transition-opacity text-left h-auto p-0 justify-start',
					className,
				)}
			>
				{children}
			</Button>
		)
	}

	switch (mode) {
		case 'name-only':
			return (
				<Wrapper>
					<div className={cn('flex items-center', config.gap)}>
						<span className={cn('font-medium text-foreground truncate', config.text)}>
							{displayName}
						</span>
						<Nip05Badge />
					</div>
				</Wrapper>
			)

		case 'avatar-name':
			return (
				<Wrapper>
					<div className={cn('flex items-center min-w-0', config.gap)}>
						<ProfileAvatar sizeClass={config.avatar} />
						<div className={cn('flex items-center min-w-0', config.gap)}>
							<span className={cn('font-medium text-foreground truncate', config.text)}>
								{displayName}
							</span>
							<Nip05Badge />
						</div>
					</div>
				</Wrapper>
			)

		case 'avatar-name-bio':
			return (
				<Wrapper>
					<div className={cn('flex items-start', config.gap)}>
						<ProfileAvatar
							sizeClass={
								size === 'xs'
									? sizeConfig.sm.avatar
									: size === 'sm'
										? sizeConfig.md.avatar
										: size === 'md'
											? sizeConfig.lg.avatar
											: sizeConfig.xl.avatar
							}
						/>
						<div className="flex flex-col gap-0.5 min-w-0">
							<div className={cn('flex items-center', config.gap)}>
								<span className={cn('font-semibold text-foreground', config.text)}>
									{displayName}
								</span>
								<Nip05Badge />
							</div>
							{showBio && profile?.about && (
								<p className="text-xs text-muted-foreground line-clamp-2">{profile.about}</p>
							)}
						</div>
					</div>
				</Wrapper>
			)

		case 'full-profile':
			return (
				<Wrapper>
					<div className="flex flex-col items-center gap-3">
						<ProfileAvatar sizeClass="size-20" />
						<div className="flex flex-col items-center gap-1.5 text-center">
							<div className="flex items-center gap-2">
								<h3 className="text-lg font-bold text-foreground">{displayName}</h3>
								<Nip05Badge />
							</div>
							{profile?.nip05 && <p className="text-xs text-muted-foreground">{profile.nip05}</p>}
							{showBio && profile?.about && (
								<p className="text-sm text-foreground max-w-md">{profile.about}</p>
							)}
							{showWebsite && profile?.website && (
								<a
									href={
										profile.website.startsWith('http')
											? profile.website
											: `https://${profile.website}`
									}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-sm text-info hover:text-info hover:underline"
									onClick={(e) => e.stopPropagation()}
								>
									<Globe className="size-3.5" />
									{profile.website.replace(/^https?:\/\//, '')}
								</a>
							)}
						</div>
					</div>
				</Wrapper>
			)

		default:
			return null
	}
}

export const UserProfile = memo(UserProfileComponent)
UserProfile.displayName = 'UserProfile'
