import { ExtensionAccount } from 'applesauce-accounts/accounts'
import { AppWindowIcon, KeyRoundIcon, QrCodeIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { shouldOfferNip07Login } from './loginCapabilities'
import { Nip46LoginDialog } from './Nip46LoginDialog'
import { SignupDialog } from './SignupDialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { loginWithAccount } from '@/lib/nostr'

/**
 * The standard signed-out state (UI/UX audit P1 #3): every surface that needs
 * an identity explains itself AND offers the way in — one labeled primary
 * action plus the sign-in methods available on the current platform. Replaces the dead-end
 * "sign in to view X" messages that offered no sign-in control (which mobile
 * users otherwise had to hunt down in Settings → Accounts).
 */
export function SignedOutCta({
	title,
	description,
	className,
}: {
	/** Semantic title for the protected surface, e.g. "Profile" or "Wallet". */
	title: string
	/** One sentence naming what signing in unlocks here, e.g. "Sign in to view your profile." */
	description: string
	className?: string
}) {
	const [loading, setLoading] = useState(false)
	const [showSignupDialog, setShowSignupDialog] = useState(false)
	const offerNip07Login = shouldOfferNip07Login()

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

	return (
		<div className={cn('flex flex-col items-center gap-3 p-4 text-center', className)}>
			<h2 className="sr-only">{title}</h2>
			<p className="text-sm text-muted-foreground">{description}</p>
			<Button onClick={() => setShowSignupDialog(true)}>
				<KeyRoundIcon className="h-4 w-4" />
				Sign in or create identity
			</Button>
			<div className="flex items-center gap-2">
				{offerNip07Login && (
					<Button variant="outline" size="sm" onClick={handleNip07Login} disabled={loading}>
						<AppWindowIcon className="h-4 w-4" />
						Extension
					</Button>
				)}
				<Nip46LoginDialog
					trigger={
						<Button variant="outline" size="sm" disabled={loading}>
							<QrCodeIcon className="h-4 w-4" />
							Remote signer
						</Button>
					}
				/>
			</div>
			<p className="max-w-xs text-xs text-muted-foreground">
				Earthly uses a Nostr key instead of an email account — you control it, and it signs
				everything you publish.
			</p>
			<SignupDialog open={showSignupDialog} onOpenChange={setShowSignupDialog} />
		</div>
	)
}
