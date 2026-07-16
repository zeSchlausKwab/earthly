export class PlatformCommandError extends Error {
	readonly code: string | null

	constructor(message: string, code: string | null = null) {
		super(message)
		this.name = 'PlatformCommandError'
		this.code = code
	}
}

export function platformCommandError(error: unknown): PlatformCommandError {
	if (typeof error === 'object' && error !== null) {
		const message = 'message' in error ? String(error.message) : String(error)
		const code = 'code' in error && typeof error.code === 'string' ? error.code : null
		return new PlatformCommandError(message, code)
	}
	return new PlatformCommandError(String(error))
}

export function platformErrorCode(error: unknown): string | null {
	return error instanceof PlatformCommandError ? error.code : null
}
