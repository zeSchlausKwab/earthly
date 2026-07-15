import jsQR from 'jsqr'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_DECODE_EDGE = 1_600
const INVITATION_PREFIX = 'earthly-pair-v1:'
const MAX_INVITATION_BYTES = 16 * 1024
const PAIRING_LINK_PROTOCOL = 'earthly:'
const PAIRING_LINK_HOST = 'pair'
const ENCODED_INVITATION_PATTERN = /^earthly-pair-v1:z?[A-Za-z0-9_-]+$/

export function isPairingInvitation(value: string): boolean {
	const invitation = value.trim()
	return (
		invitation.length <= MAX_INVITATION_BYTES &&
		invitation.startsWith(INVITATION_PREFIX) &&
		ENCODED_INVITATION_PATTERN.test(invitation)
	)
}

/** Build the versioned OS handoff URL without changing the signed invitation itself. */
export function pairingInvitationLink(invitation: string): string {
	const normalized = normalizePairingInvitation(invitation)
	if (!normalized) throw new Error('Cannot link an invalid Earthly pairing invitation')
	const url = new URL(`${PAIRING_LINK_PROTOCOL}//${PAIRING_LINK_HOST}`)
	url.searchParams.set('invitation', normalized)
	return url.toString()
}

/** Accept the raw copy/paste form or the exact custom-scheme envelope used by the native app. */
export function normalizePairingInvitation(value: string): string | null {
	const candidate = value.trim()
	if (isPairingInvitation(candidate)) return candidate
	if (candidate.length > MAX_INVITATION_BYTES * 2) return null

	try {
		const url = new URL(candidate)
		if (
			url.protocol !== PAIRING_LINK_PROTOCOL ||
			url.hostname !== PAIRING_LINK_HOST ||
			url.pathname !== '' ||
			url.username !== '' ||
			url.password !== '' ||
			url.port !== '' ||
			url.hash !== ''
		) {
			return null
		}
		let parameterCount = 0
		url.searchParams.forEach(() => {
			parameterCount += 1
		})
		if (parameterCount !== 1) return null
		const invitations = url.searchParams.getAll('invitation')
		const invitation = invitations[0]
		return invitations.length === 1 && invitation && isPairingInvitation(invitation)
			? invitation.trim()
			: null
	} catch {
		return null
	}
}

export async function decodePairingQrImage(file: File): Promise<string> {
	if (!file.type.startsWith('image/')) throw new Error('Choose an image containing a QR code')
	if (file.size > MAX_IMAGE_BYTES) throw new Error('The QR image must be smaller than 20 MB')

	const objectUrl = URL.createObjectURL(file)
	try {
		const image = await loadImage(objectUrl)
		const scale = Math.min(1, MAX_DECODE_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
		const width = Math.max(1, Math.round(image.naturalWidth * scale))
		const height = Math.max(1, Math.round(image.naturalHeight * scale))
		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height
		const context = canvas.getContext('2d', { willReadFrequently: true })
		if (!context) throw new Error('This device cannot read QR images')
		context.drawImage(image, 0, 0, width, height)
		const pixels = context.getImageData(0, 0, width, height)
		const code = jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' })
		if (!code) throw new Error('No QR code was found in that image')
		const invitation = normalizePairingInvitation(code.data)
		if (!invitation) {
			throw new Error('That QR code is not an Earthly pairing invitation')
		}
		return invitation
	} finally {
		URL.revokeObjectURL(objectUrl)
	}
}

function loadImage(source: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.decoding = 'async'
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error('The selected image could not be opened'))
		image.src = source
	})
}
