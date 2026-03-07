import { useNDK, useProfileValue, useUser } from '@nostr-dev-kit/react'
import { memo, useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { User, BadgeCheck, BadgeX, Globe, Loader2 } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '@/lib/utils'

type ProfileData = {
	name?: string
	displayName?: string
	image?: string
	picture?: string
	about?: string
	nip05?: string
	website?: string
}

const profileCache = new Map<string, ProfileData>()

// Calculate how "complete" a profile is (used to prevent flickering)
function getProfileScore(p: ProfileData | null | undefined): number {
	if (!p) return 0
	let score = 0
	if (p.name) score += 2
	if (p.displayName) score += 1
	if (p.image || p.picture) score += 2
	if (p.about) score += 1
	if (p.nip05) score += 1
	if (p.website) score += 1
	return score
}

/**
 * Display modes for UserProfile:
 * - name-only: Just the display name with optional NIP-05 badge
 * - avatar-name: Avatar next to name (compact one-liner)
 * - avatar-name-bio: Larger avatar with name and bio
 * - full-profile: Full card with avatar, name, bio, website, NIP-05
 */
export type UserProfileMode = 'name-only' | 'avatar-name' | 'avatar-name-bio' | 'full-profile'

/**
 * Size variants for the component
 */
export type UserProfileSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface UserProfileProps {
	/**
	 * User identifier - can be:
	 * - Hex pubkey (64 chars)
	 * - npub (bech32 encoded pubkey)
	 * - nprofile (bech32 encoded profile)
	 * - NIP-05 identifier (user@domain.com)
	 *
	 * Note: Never pass nsec (private key) - use npub for public identifiers
	 */
	pubkey: string
	/** Display mode */
	mode?: UserProfileMode
	/** Size variant */
	size?: UserProfileSize
	/** Additional CSS classes */
	className?: string
	/** Whether to show and validate NIP-05 badge */
	showNip05Badge?: boolean
	/** Whether to show website link (only in full-profile mode) */
	showWebsite?: boolean
	/** Whether to show bio (only in avatar-name-bio and full-profile modes) */
	showBio?: boolean
	/** Callback when profile is clicked */
	onClick?: () => void
	/** Custom fallback text (defaults to initials or pubkey prefix) */
	fallbackText?: string
	/** Disable click-to-profile navigation and render as static content */
	interactive?: boolean
}

/**
 * UserProfile displays a Nostr user's profile in various modes.
 *
 * Supports hex pubkeys, npub, nprofile, and NIP-05 identifiers.
 * Automatically fetches and displays profile data including avatar,
 * name, bio, and validates NIP-05 verification.
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
	const ndk = useNDK()
	// useUser handles npub, nprofile, nip05, and hex pubkey resolution
	const user = useUser(pubkey)
	const rawProfile = useProfileValue(user)
	const [nip05Valid, setNip05Valid] = useState<boolean | null>(null)
	const [isValidating, setIsValidating] = useState(false)

	// Track the best profile data we've received to prevent flickering
	// Only update when we get "better" data (more fields filled)
	const committedProfileRef = useRef<ProfileData | null>(null)
	const profileCacheKey = user?.pubkey || pubkey

	// Commit new profile data only if it's better than what we have
	const profile = useMemo(() => {
		const cachedProfile = profileCache.get(profileCacheKey) ?? null
		const baselineProfile = committedProfileRef.current ?? cachedProfile
		const newScore = getProfileScore(rawProfile)
		const oldScore = getProfileScore(baselineProfile)

		// Always accept new data if it's at least as good
		if (rawProfile && newScore >= oldScore) {
			committedProfileRef.current = rawProfile
			profileCache.set(profileCacheKey, rawProfile)
		} else if (!committedProfileRef.current && cachedProfile) {
			committedProfileRef.current = cachedProfile
		}

		return committedProfileRef.current ?? cachedProfile ?? rawProfile
	}, [rawProfile, profileCacheKey])

	// Validate NIP-05 if present
	useEffect(() => {
		if (!profile?.nip05 || !ndk?.ndk || !showNip05Badge) {
			setNip05Valid(null)
			return
		}

		let cancelled = false
		setIsValidating(true)

		const validateNip05 = async () => {
			try {
				if (!user) return
				if (!profile.nip05) return
				const isValid = await user.validateNip05(profile.nip05)
				if (!cancelled) {
					setNip05Valid(isValid)
				}
			} catch (error) {
				console.error('Error validating NIP-05:', error)
				if (!cancelled) {
					setNip05Valid(false)
				}
			} finally {
				if (!cancelled) {
					setIsValidating(false)
				}
			}
		}

		validateNip05()

		return () => {
			cancelled = true
		}
	}, [profile?.nip05, user, ndk, showNip05Badge])

	// Get display name: profile name, displayName, or truncated pubkey
	const displayName = useMemo(() => {
		if (profile?.name) return profile.name
		if (profile?.displayName) return profile.displayName
		const resolvedPubkey = user?.pubkey || pubkey
		// Handle both hex and bech32 formats
		if (resolvedPubkey.startsWith('npub') || resolvedPubkey.startsWith('nprofile')) {
			return `${resolvedPubkey.slice(0, 8)}…`
		}
		return `${resolvedPubkey.slice(0, 8)}…${resolvedPubkey.slice(-4)}`
	}, [profile?.name, profile?.displayName, user?.pubkey, pubkey])

	// Get fallback text for avatar
	const getFallbackText = (): string => {
		if (fallbackText) return fallbackText
		if (profile?.name) return profile.name.substring(0, 2).toUpperCase()
		if (profile?.displayName) return profile.displayName.substring(0, 2).toUpperCase()
		const resolvedPubkey = user?.pubkey || pubkey
		return resolvedPubkey.substring(0, 2).toUpperCase()
	}

	// Size configurations
	const sizeConfig = {
		xs: {
			avatar: 'size-4',
			icon: 'size-2.5',
			text: 'text-[10px]',
			badge: 'size-3',
			gap: 'gap-1',
		},
		sm: {
			avatar: 'size-5',
			icon: 'size-3',
			text: 'text-xs',
			badge: 'size-3.5',
			gap: 'gap-1.5',
		},
		md: {
			avatar: 'size-7',
			icon: 'size-4',
			text: 'text-sm',
			badge: 'size-4',
			gap: 'gap-2',
		},
		lg: {
			avatar: 'size-10',
			icon: 'size-5',
			text: 'text-base',
			badge: 'size-4',
			gap: 'gap-2.5',
		},
		xl: {
			avatar: 'size-16',
			icon: 'size-8',
			text: 'text-lg',
			badge: 'size-5',
			gap: 'gap-3',
		},
	}

	const config = sizeConfig[size]

	// NIP-05 Badge Component
	const Nip05Badge = ({ className: badgeClass }: { className?: string }) => {
		if (!showNip05Badge || !profile?.nip05) return null

		if (isValidating) {
			return (
				<Tooltip>
					<TooltipTrigger asChild>
						<span className={cn('text-gray-400', badgeClass)}>
							<Loader2 className={cn(config.badge, 'animate-spin')} />
						</span>
					</TooltipTrigger>
					<TooltipContent>Validating NIP-05...</TooltipContent>
				</Tooltip>
			)
		}

		if (nip05Valid === null) return null

		return nip05Valid ? (
			<Tooltip>
				<TooltipTrigger asChild>
					<span className={badgeClass}>
						<BadgeCheck className={cn(config.badge, 'text-emerald-500 flex-shrink-0')} />
					</span>
				</TooltipTrigger>
				<TooltipContent>Verified: {profile.nip05}</TooltipContent>
			</Tooltip>
		) : (
			<Tooltip>
				<TooltipTrigger asChild>
					<span className={badgeClass}>
						<BadgeX className={cn(config.badge, 'text-red-400 flex-shrink-0')} />
					</span>
				</TooltipTrigger>
				<TooltipContent>Invalid NIP-05: {profile.nip05}</TooltipContent>
			</Tooltip>
		)
	}

	// Avatar Component
	const ProfileAvatar = ({ sizeClass }: { sizeClass: string }) => (
		<Avatar className={cn(sizeClass, 'flex-shrink-0')}>
			<AvatarImage
				src={profile?.image || profile?.picture}
				alt={displayName}
				className="object-cover"
			/>
			<AvatarFallback
				className={cn(config.text, 'bg-gradient-to-br from-sky-400 to-emerald-400 text-white')}
			>
				{profile ? getFallbackText() : <User className={config.icon} />}
			</AvatarFallback>
		</Avatar>
	)

	// Default click handler navigates to user profile
	const handleDefaultClick = useCallback(() => {
		const resolvedPubkey = user?.pubkey || pubkey
		// Only navigate if we have a valid hex pubkey
		if (
			resolvedPubkey &&
			!resolvedPubkey.startsWith('npub') &&
			!resolvedPubkey.startsWith('nprofile')
		) {
			const npub = nip19.npubEncode(resolvedPubkey)
			window.location.hash = `/user/${npub}`
		} else if (resolvedPubkey) {
			// Already encoded, use directly
			window.location.hash = `/user/${resolvedPubkey}`
		}
	}, [user?.pubkey, pubkey])

	// Wrapper for click handling - always clickable, uses onClick or default navigation
	const Wrapper = ({ children }: { children: React.ReactNode }) => {
		if (!interactive) {
			return <div className={cn('text-left', className)}>{children}</div>
		}

		const clickHandler = onClick ?? handleDefaultClick
		return (
			<button
				type="button"
				onClick={clickHandler}
				className={cn('cursor-pointer hover:opacity-80 transition-opacity text-left', className)}
			>
				{children}
			</button>
		)
	}

	// Render based on mode
	switch (mode) {
		case 'name-only':
			return (
				<Wrapper>
					<div className={cn('flex items-center', config.gap)}>
						<span className={cn('font-medium text-gray-900 truncate', config.text)}>
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
							<span className={cn('font-medium text-gray-700 truncate', config.text)}>
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
								<span className={cn('font-semibold text-gray-900', config.text)}>
									{displayName}
								</span>
								<Nip05Badge />
							</div>
							{showBio && profile?.about && (
								<p className="text-xs text-gray-600 line-clamp-2">{profile.about}</p>
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
								<h3 className="text-lg font-bold text-gray-900">{displayName}</h3>
								<Nip05Badge />
							</div>
							{profile?.nip05 && <p className="text-xs text-gray-500">{profile.nip05}</p>}
							{showBio && profile?.about && (
								<p className="text-sm text-gray-700 max-w-md">{profile.about}</p>
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
									className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 hover:underline"
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
