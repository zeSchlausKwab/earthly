import {
	NDKNip07Signer,
	NDKSessionLocalStorage,
	type NDKNip46Signer,
	type NDKPrivateKeySigner,
	removeStoredSession,
	useNDKCurrentUser,
	useNDKSessionLogin,
	useNDKSessionLogout,
} from '@nostr-dev-kit/react'
import { AppWindowIcon, ChevronDown, ClipboardCopy, KeyRoundIcon, LogOutIcon, QrCodeIcon } from 'lucide-react'
import { useState, useRef } from 'react'
import { nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { Nip46LoginDialog } from './Nip46LoginDialog'
import { SignupDialog } from './SignupDialog'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UserProfile } from '@/components/user-profile'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function LoginSessionButtons() {
	const login = useNDKSessionLogin()
	const logout = useNDKSessionLogout()
	const currentUser = useNDKCurrentUser()

	const [loading, setLoading] = useState(false)
	const [showSignupDialog, setShowSignupDialog] = useState(false)
	const storageRef = useRef(new NDKSessionLocalStorage())

	const handleSignup = async (signer: NDKPrivateKeySigner, rememberMe: boolean) => {
		try {
			await login(signer)
			// If user doesn't want to stay logged in, remove from persistent storage
			if (!rememberMe) {
				const user = await signer.user()
				if (user?.pubkey) {
					await removeStoredSession(storageRef.current, user.pubkey)
				}
			}
		} catch (error) {
			console.error('Login failed:', error)
			throw error
		}
	}

	const handleNip07Login = async () => {
		try {
			setLoading(true)
			const signer = new NDKNip07Signer()
			await login(signer)
			// NIP-07 always stays logged in (extension manages the key)
		} catch (error) {
			console.error('Extension login failed:', error)
		} finally {
			setLoading(false)
		}
	}

	const handleNip46Login = async (signer: NDKNip46Signer, rememberMe: boolean) => {
		try {
			setLoading(true)
			await login(signer)
			// If user doesn't want to stay logged in, remove from persistent storage
			if (!rememberMe) {
				const user = await signer.user()
				if (user?.pubkey) {
					await removeStoredSession(storageRef.current, user.pubkey)
				}
			}
		} catch (error) {
			console.error('NIP-46 login failed:', error)
			throw error
		} finally {
			setLoading(false)
		}
	}

	const handleCopyNpub = async () => {
		if (!currentUser) return
		const npub = nip19.npubEncode(currentUser.pubkey)
		await navigator.clipboard.writeText(npub)
		toast.success('npub copied to clipboard')
	}

	return (
		<div className="flex items-center gap-2">
			{currentUser ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" className="gap-2 px-2">
							<UserProfile
								pubkey={currentUser.pubkey}
								mode="avatar-name"
								size="sm"
								showNip05Badge={false}
								interactive={false}
							/>
							<ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={handleCopyNpub}>
							<ClipboardCopy className="h-4 w-4" />
							Copy npub
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive">
							<LogOutIcon className="h-4 w-4" />
							Log out
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				<ButtonGroup>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant={'default'} size="icon" className="h-10 w-10" onClick={() => setShowSignupDialog(true)}>
								<KeyRoundIcon className="w-5 h-5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p className="font-medium">Get a Nostr identity</p>
							<p className="text-xs text-muted-foreground">Create or import a private key</p>
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant={'default'} size="icon" className="h-10 w-10" onClick={handleNip07Login} disabled={loading}>
								<AppWindowIcon className="w-5 h-5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p className="font-medium">Browser extension</p>
							<p className="text-xs text-muted-foreground">Sign in with Alby, nos2x, etc.</p>
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<Nip46LoginDialog
							onLogin={handleNip46Login}
							trigger={
								<TooltipTrigger asChild>
									<Button variant={'default'} size="icon" className="h-10 w-10" disabled={loading}>
										<QrCodeIcon className="w-5 h-5" />
									</Button>
								</TooltipTrigger>
							}
						/>
						<TooltipContent>
							<p className="font-medium">Remote signer</p>
							<p className="text-xs text-muted-foreground">Use Amber, nsec.app, or a bunker URL</p>
						</TooltipContent>
					</Tooltip>
				</ButtonGroup>
			)}

			{/* Signup Dialog */}
			<SignupDialog
				open={showSignupDialog}
				onOpenChange={setShowSignupDialog}
				onConfirm={handleSignup}
			/>
		</div>
	)
}
