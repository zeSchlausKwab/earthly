export const PRIVATE_INVITE_CLIPBOARD_TIMEOUT_MS = 5_000

export async function copyPrivateInviteText(
	value: string,
	clipboard: Pick<Clipboard, 'writeText'> | undefined = navigator.clipboard,
	timeoutMs = PRIVATE_INVITE_CLIPBOARD_TIMEOUT_MS,
): Promise<void> {
	if (!clipboard) throw new Error('Clipboard access is unavailable; use the invitation QR instead')

	let timeout: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			clipboard.writeText(value),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error('Copying timed out; use the invitation QR instead')),
					timeoutMs,
				)
			}),
		])
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}
