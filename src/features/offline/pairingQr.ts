import jsQR from 'jsqr'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_DECODE_EDGE = 1_600
const INVITATION_PREFIX = 'earthly-pair-v1:'

export function isPairingInvitation(value: string): boolean {
	return value.trim().startsWith(INVITATION_PREFIX)
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
		if (!isPairingInvitation(code.data)) {
			throw new Error('That QR code is not an Earthly pairing invitation')
		}
		return code.data.trim()
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
