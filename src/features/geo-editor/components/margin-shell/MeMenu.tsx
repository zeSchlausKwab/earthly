import { useState, type ReactNode } from 'react'
import {
	BookOpen,
	CircleHelp,
	CloudUpload,
	Compass,
	FilePenLine,
	Inbox,
	MapPin,
	MessageSquare,
	Moon,
	Radio,
	Settings,
	Sun,
	UserRound,
	Users,
	WalletCards,
	Layers,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { LoginSessionButtons } from '@/features/auth/LoginSessionButtons'
import { SignedOutCta } from '@/features/auth/SignedOutCta'
import { SignupDialog } from '@/features/auth/SignupDialog'
import { useTheme } from '@/lib/theme'

interface MeMenuProps {
	trigger: ReactNode
	currentUserPubkey?: string | null
	draftCount?: number
	unreadCount?: number
	mobile?: boolean
	onNavigate: (href: string) => void
	onShareLive: () => void
	onDiscover: () => void
	onTakeTour: () => void
}

/** Account navigation is a transient menu, not another object in the Margin. */
export function MeMenu({
	trigger,
	currentUserPubkey,
	draftCount = 0,
	unreadCount = 0,
	mobile = false,
	onNavigate,
	onShareLive,
	onDiscover,
	onTakeTour,
}: MeMenuProps) {
	const [open, setOpen] = useState(false)
	const [signupOpen, setSignupOpen] = useState(false)
	const [theme, setTheme] = useTheme()
	const links = [
		{ label: 'Profile', href: '/me', icon: UserRound },
		{ label: 'Drafts', href: '/drafts', icon: FilePenLine, count: draftCount },
		{ label: 'On the map', href: '/shelf', icon: Layers },
		{ label: 'Inbox', href: '/inbox', icon: Inbox, count: unreadCount },
		{ label: 'Circles', href: '/me/circles', icon: Users },
		{ label: 'Nearby sessions', href: '/me/nearby', icon: MapPin },
		{ label: 'Sync & delivery', href: '/delivery', icon: CloudUpload },
		{ label: 'Wallet', href: '/wallet', icon: WalletCards },
		{ label: 'Posts', href: '/posts', icon: MessageSquare },
		{ label: 'Settings', href: '/settings', icon: Settings },
		{ label: 'Help & tour', href: '/help', icon: CircleHelp },
	]
	const activate = (action: () => void) => {
		setOpen(false)
		action()
	}
	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>{trigger}</PopoverTrigger>
				<PopoverContent
					aria-label="Me menu"
					side={mobile ? 'top' : 'bottom'}
					align="end"
					sideOffset={8}
					collisionPadding={12}
					className="earthly-me-menu"
					data-mobile={mobile || undefined}
				>
					<div className="earthly-me-menu__identity">
						<h2 className="text-sm font-semibold">
							{currentUserPubkey ? 'You' : 'Welcome to Earthly'}
						</h2>
						{currentUserPubkey ? (
							<LoginSessionButtons />
						) : (
							<SignedOutCta
								title="Your account"
								description="Sign in to publish, collaborate, and keep your work."
								className="px-0 py-2"
								onCreateOrSignIn={() => {
									setOpen(false)
									setSignupOpen(true)
								}}
							/>
						)}
					</div>
					<nav aria-label="Account navigation" className="earthly-me-menu__links">
						{links.map(({ label, href, icon: Icon, count }) => (
							<button key={href} type="button" onClick={() => activate(() => onNavigate(href))}>
								<Icon aria-hidden="true" />
								<span>{label}</span>
								{count ? <span className="earthly-me-menu__count">{count}</span> : null}
							</button>
						))}
						<button type="button" onClick={() => activate(onShareLive)}>
							<Radio aria-hidden="true" />
							Share live location
						</button>
						<button type="button" onClick={() => activate(() => onNavigate('/beacons'))}>
							<MapPin aria-hidden="true" />
							Live positions
						</button>
						<button type="button" onClick={() => activate(onDiscover)}>
							<Compass aria-hidden="true" />
							Discover
						</button>
						<button type="button" onClick={() => activate(onTakeTour)}>
							<BookOpen aria-hidden="true" />
							Take the tour
						</button>
					</nav>
					<fieldset className="earthly-me-menu__theme">
						<legend className="sr-only">Theme</legend>
						<span aria-hidden="true">Theme</span>
						<button
							type="button"
							aria-pressed={theme === 'light'}
							onClick={() => setTheme('light')}
						>
							<Sun aria-hidden="true" />
							Light
						</button>
						<button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
							<Moon aria-hidden="true" />
							Dark
						</button>
					</fieldset>
				</PopoverContent>
			</Popover>
			<SignupDialog open={signupOpen} onOpenChange={setSignupOpen} />
		</>
	)
}
