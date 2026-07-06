/**
 * Client-side image downscaling for Blossom uploads.
 *
 * blossom.earthly.city caps uploads at ~1 MB (SPEC §7.3), so images are
 * re-encoded in the browser before upload: progressively lower JPEG quality,
 * then shrink dimensions, until the payload fits. Non-image files and images
 * already under the limit pass through untouched.
 */

export const MAX_UPLOAD_IMAGE_BYTES = 1024 * 1024

/** Quality steps tried at each size before shrinking dimensions. */
const QUALITY_STEPS = [0.85, 0.7, 0.55] as const
/** Dimension multipliers tried in order (1 = original size). */
const SCALE_STEPS = [1, 0.75, 0.5, 0.35, 0.25, 0.15] as const

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/**
 * Re-encode `file` as a JPEG no larger than `maxBytes`. Returns the original
 * file when it already fits, isn't an image, or the environment lacks canvas
 * support (the server will then enforce its own limit).
 */
export async function downscaleImageToLimit(
	file: File,
	maxBytes = MAX_UPLOAD_IMAGE_BYTES,
): Promise<File> {
	if (!file.type.startsWith('image/') || file.size <= maxBytes) return file
	if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file

	let bitmap: ImageBitmap
	try {
		bitmap = await createImageBitmap(file)
	} catch {
		// Undecodable (e.g. unsupported format) — let the server decide.
		return file
	}

	try {
		const canvas = document.createElement('canvas')
		const ctx = canvas.getContext('2d')
		if (!ctx) return file

		for (const scale of SCALE_STEPS) {
			canvas.width = Math.max(1, Math.round(bitmap.width * scale))
			canvas.height = Math.max(1, Math.round(bitmap.height * scale))
			ctx.clearRect(0, 0, canvas.width, canvas.height)
			ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

			for (const quality of QUALITY_STEPS) {
				const blob = await canvasToBlob(canvas, quality)
				if (blob && blob.size <= maxBytes) {
					const name = file.name.replace(/\.[a-z0-9]+$/i, '') || 'image'
					return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
				}
			}
		}
		// Even the smallest attempt is over the limit — return the last-resort
		// smallest encode rather than the original (best effort beats failure).
		const blob = await canvasToBlob(canvas, 0.4)
		if (blob && blob.size < file.size) {
			const name = file.name.replace(/\.[a-z0-9]+$/i, '') || 'image'
			return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
		}
		return file
	} finally {
		bitmap.close()
	}
}
