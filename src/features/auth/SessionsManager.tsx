import { ExtensionAccount } from 'applesauce-accounts/accounts'
import { useAccounts, useActiveAccount } from 'applesauce-react/hooks'
import { AppWindowIcon, KeyRoundIcon, LogOut, QrCodeIcon, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { shouldOfferNip07Login } from './loginCapabilities'
import { Nip46LoginDialog } from './Nip46LoginDialog'
import { SignupDialog } from './SignupDialog'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UserProfile } from '@/components/user-profile'
import { loginWithAccount, removeAccountSession, switchActiveAccount } from '@/lib/nostr'

interface SessionItemProps {
	pubkey: string
	isActive: boolean
	onSwitch: () => void
	onRemove: () => void
}

function SessionItem({ pubkey, isActive, onSwitch, onRemove }: SessionItemProps) {
	return (
		<div
			className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
				isActive
					? 'bg-primary/10 border-primary/30'
					: 'bg-card hover:bg-muted/50 border-border cursor-pointer'
			}`}
		>
			<Button
				type="button"
				variant="ghost"
				onClick={isActive ? undefined : onSwitch}
				disabled={isActive}
				className="flex min-w-0 flex-1 items-center gap-2 justify-start text-left disabled:cursor-default h-auto px-0"
			>
				<div className="min-w-0 flex-1">
					<UserProfile
						pubkey={pubkey}
						mode="avatar-name"
						size="md"
						showNip05Badge={false}
						interactive={false}
					/>
				</div>
				{isActive && (
					<span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">Active</span>
				)}
			</Button>

			<div className="flex items-center gap-1">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
							onClick={(e) => {
								e.stopPropagation()
								onRemove()
							}}
						>
							<LogOut className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Remove this session</TooltipContent>
				</Tooltip>
			</div>
		</div>
	)
}

/**
 * Sessions manager — list saved accounts, switch between them, add new ones.
 *
 * "Sessions" in the old NDK code = "accounts" here. Renaming the UI strings
 * later if you prefer; the functionality is identical.
 */
export function SessionsManager() {
	const accounts = useAccounts()
	const active = useActiveAccount()
	const offerNip07Login = shouldOfferNip07Login()

	const [loading, setLoading] = useState(false)
	const [showSignupDialog, setShowSignupDialog] = useState(false)

	const handleNip07Login = async () => {
		try {
			setLoading(true)
			const account = await ExtensionAccount.fromExtension()
			await loginWithAccount(account, { remember: true })
		} catch (error) {
			console.error('Extension login failed:', error)
			toast.error('Could not connect to a browser extension. Is one installed?')
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Users className="h-4 w-4 text-muted-foreground" />
					<Label className="text-sm font-medium">Accounts</Label>
					{accounts.length > 0 && (
						<span className="text-xs text-muted-foreground">
							({accounts.length} account{accounts.length !== 1 ? 's' : ''})
						</span>
					)}
				</div>
			</div>

			{accounts.length === 0 ? (
				<div className="text-sm text-muted-foreground italic p-4 border border-dashed rounded-lg text-center">
					No saved accounts. Add one below.
				</div>
			) : (
				<div className="space-y-2">
					{accounts.map((account) => (
						<SessionItem
							key={account.id}
							pubkey={account.pubkey}
							isActive={account.id === active?.id}
							onSwitch={() => void switchActiveAccount(account)}
							onRemove={() => void removeAccountSession(account)}
						/>
					))}
				</div>
			)}

			<div className="pt-2 border-t">
				<Label className="text-xs text-muted-foreground mb-2 block">Add Account</Label>
				<ButtonGroup className="w-full">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								className="flex-1"
								onClick={() => setShowSignupDialog(true)}
							>
								<KeyRoundIcon className="w-4 h-4 mr-1" />
								Key
							</Button>
						</TooltipTrigger>
						<TooltipContent>Create or import a private key</TooltipContent>
					</Tooltip>
					{offerNip07Login && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="outline"
									size="sm"
									className="flex-1"
									onClick={handleNip07Login}
									disabled={loading}
								>
									<AppWindowIcon className="w-4 h-4 mr-1" />
									Extension
								</Button>
							</TooltipTrigger>
							<TooltipContent>Use browser extension (NIP-07)</TooltipContent>
						</Tooltip>
					)}
					<Nip46LoginDialog
						trigger={
							<Button
								variant="outline"
								size="sm"
								className="flex-1"
								disabled={loading}
								title="Use remote signer (NIP-46)"
							>
								<QrCodeIcon className="w-4 h-4 mr-1" />
								Signer
							</Button>
						}
					/>
				</ButtonGroup>
			</div>

			<p className="text-xs text-muted-foreground">
				Accounts are saved unless you uncheck "Stay logged in" when adding one.
			</p>

			<SignupDialog open={showSignupDialog} onOpenChange={setShowSignupDialog} />
		</div>
	)
}
