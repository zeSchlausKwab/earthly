import { ExtensionAccount } from 'applesauce-accounts/accounts'
import { useAccountManager, useAccounts, useActiveAccount } from 'applesauce-react/hooks'
import {
	AppWindowIcon,
	ChevronDown,
	ClipboardCopy,
	KeyRoundIcon,
	LogOutIcon,
	QrCodeIcon,
	Users,
} from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useState } from 'react'
import { toast } from 'sonner'
import { shouldOfferNip07Login } from './loginCapabilities'
import { Nip46LoginDialog } from './Nip46LoginDialog'
import { SignupDialog } from './SignupDialog'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UserProfile } from '@/components/user-profile'
import { loginWithAccount, logoutActive } from '@/lib/nostr'

export function LoginSessionButtons() {
	const manager = useAccountManager()
	const active = useActiveAccount()
	const allAccounts = useAccounts()
	const offerNip07Login = shouldOfferNip07Login()

	const [loading, setLoading] = useState(false)
	const [showSignupDialog, setShowSignupDialog] = useState(false)

	const handleNip07Login = async () => {
		try {
			setLoading(true)
			const account = await ExtensionAccount.fromExtension()
			loginWithAccount(account, { remember: true })
		} catch (error) {
			console.error('Extension login failed:', error)
			toast.error('Could not connect to a browser extension. Is one installed?')
		} finally {
			setLoading(false)
		}
	}

	const handleCopyNpub = async () => {
		if (!active) return
		const npub = nip19.npubEncode(active.pubkey)
		await navigator.clipboard.writeText(npub)
		toast.success('npub copied to clipboard')
	}

	const otherAccounts = allAccounts.filter((acc) => acc.id !== active?.id)

	return (
		<div className="flex items-center gap-2">
			{active ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" className="gap-2 px-2" aria-label="Account menu">
							<UserProfile
								pubkey={active.pubkey}
								mode="avatar-name"
								size="sm"
								showNip05Badge={false}
								interactive={false}
							/>
							<ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-56">
						<DropdownMenuItem onClick={handleCopyNpub}>
							<ClipboardCopy className="h-4 w-4" />
							Copy npub
						</DropdownMenuItem>

						{otherAccounts.length > 0 && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
									<Users className="h-3.5 w-3.5" />
									Switch account
								</DropdownMenuLabel>
								{otherAccounts.map((account) => (
									<DropdownMenuItem key={account.id} onClick={() => manager.setActive(account)}>
										<UserProfile
											pubkey={account.pubkey}
											mode="avatar-name"
											size="sm"
											showNip05Badge={false}
											interactive={false}
										/>
									</DropdownMenuItem>
								))}
							</>
						)}

						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => logoutActive()}
							className="text-destructive focus:text-destructive"
						>
							<LogOutIcon className="h-4 w-4" />
							Log out
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				<ButtonGroup>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={'default'}
								size="icon"
								className="h-10 w-10"
								aria-label="Get a Nostr identity"
								onClick={() => setShowSignupDialog(true)}
							>
								<KeyRoundIcon className="w-5 h-5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p className="font-medium">Get a Nostr identity</p>
							<p className="text-xs text-muted-foreground">Create or import a private key</p>
						</TooltipContent>
					</Tooltip>
					{offerNip07Login && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant={'default'}
									size="icon"
									className="h-10 w-10"
									aria-label="Sign in with browser extension"
									onClick={handleNip07Login}
									disabled={loading}
								>
									<AppWindowIcon className="w-5 h-5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p className="font-medium">Browser extension</p>
								<p className="text-xs text-muted-foreground">Sign in with Alby, nos2x, etc.</p>
							</TooltipContent>
						</Tooltip>
					)}
					<Tooltip>
						<Nip46LoginDialog
							trigger={
								<TooltipTrigger asChild>
									<Button
										variant={'default'}
										size="icon"
										className="h-10 w-10"
										aria-label="Sign in with remote signer"
										disabled={loading}
									>
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

			<SignupDialog open={showSignupDialog} onOpenChange={setShowSignupDialog} />
		</div>
	)
}
