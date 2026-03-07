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
import { AppWindowIcon, KeyRoundIcon, LogOutIcon, QrCodeIcon } from 'lucide-react'
import { useState, useRef } from 'react'
import { Nip46LoginDialog } from './Nip46LoginDialog'
import { SignupDialog } from './SignupDialog'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
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

	return (
		<div className="flex items-center gap-2">
			{currentUser ? (
				<ButtonGroup>
					<div className="rounded-md border bg-background px-2 py-1">
						<UserProfile
							pubkey={currentUser.pubkey}
							mode="avatar-name"
							size="sm"
							showNip05Badge={false}
							interactive={false}
						/>
					</div>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="outline" size="icon" onClick={() => logout()}>
								<LogOutIcon className="w-4 h-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Log out</p>
						</TooltipContent>
					</Tooltip>
				</ButtonGroup>
			) : (
				<ButtonGroup>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant={'secondary'} onClick={() => setShowSignupDialog(true)}>
								<KeyRoundIcon className="w-5 h-5" />
								signup
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Create a new nsec.</p>
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant={'secondary'} onClick={handleNip07Login} disabled={loading}>
								<AppWindowIcon className="w-5 h-5" />
								{loading ? 'Logging in...' : 'extension'}
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Use your nostr extension.</p>
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<Nip46LoginDialog
							onLogin={handleNip46Login}
							trigger={
								<TooltipTrigger asChild>
									<Button variant={'secondary'} disabled={loading}>
										<QrCodeIcon className="w-5 h-5" />
										{loading ? 'Logging in...' : 'signer'}
									</Button>
								</TooltipTrigger>
							}
						/>
						<TooltipContent>
							<p>Use an external signer.</p>
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
