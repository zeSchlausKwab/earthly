import {
	NDKNip07Signer,
	type NDKNip46Signer,
	type NDKPrivateKeySigner,
	useNDKCurrentUser,
	useNDKSessionLogin,
	useNDKSessionLogout
} from '@nostr-dev-kit/react';
import { AppWindowIcon, KeyRoundIcon, Link, LogOutIcon, QrCodeIcon, SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { Nip46LoginDialog } from './Nip46LoginDialog';
import { SignupDialog } from './SignupDialog';
import { Button } from './ui/button';
import { ButtonGroup } from './ui/button-group';
// import { AppWindowIcon } from "./ui/icons/lucide-app-window";
// import { KeyRoundIcon } from "./ui/icons/lucide-key-round";
// import { QrCodeIcon } from "./ui/icons/lucide-qr-code";
// import { WalletButton } from "./WalletButton";
// import { LogOutIcon } from "./ui/icons/lucide-log-out";
// import { SettingsIcon } from "./ui/icons/lucide-settings";
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
// import { useUIStore } from "../stores/uiStore";
// import { usePlatform } from "../lib/hooks/usePlatform";
// import { Link } from "@tanstack/react-router";

export function LoginSessionButtons() {
	const login = useNDKSessionLogin();
	const logout = useNDKSessionLogout();
	const currentUser = useNDKCurrentUser();
	// const shouldPulseLogin = useUIStore((state) => state.shouldPulseLogin);
	// const { isTauri } = usePlatform();

	const [loading, setLoading] = useState(false);
	const [showSignupDialog, setShowSignupDialog] = useState(false);

	const handleSignup = async (signer: NDKPrivateKeySigner) => {
		try {
			await login(signer);
		} catch (error) {
			console.error('Login failed:', error);
			throw error;
		}
	};

	const handleNip07Login = async () => {
		try {
			setLoading(true);
			const signer = new NDKNip07Signer();
			await login(signer);
		} catch (error) {
			console.error('Extension login failed:', error);
		} finally {
			setLoading(false);
		}
	};

	const handleNip46Login = async (signer: NDKNip46Signer) => {
		try {
			setLoading(true);
			await login(signer);
		} catch (error) {
			console.error('NIP-46 login failed:', error);
			throw error; // Re-throw so the dialog can handle it
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex items-center gap-4">
			{currentUser ? (
				<ButtonGroup>
					{/* <WalletButton /> */}
					{/* <MiniProfile userOrPubkey={currentUser} /> */}
					<Link to="/settings">
						<Button>
							<SettingsIcon className="w-5 h-5" />
						</Button>
					</Link>
					<Button onClick={() => logout()}>
						<LogOutIcon className="w-5 h-5" />
					</Button>
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
					{/* {!isTauri && ( */}
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
					{/* )} */}
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
			<SignupDialog open={showSignupDialog} onOpenChange={setShowSignupDialog} onConfirm={handleSignup} />
		</div>
	);
}
