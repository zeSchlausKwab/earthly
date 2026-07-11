export interface AiSuiteEnvironment {
	baseURL: string
	headless: boolean
}

const DEFAULT_BASE_URL = 'http://localhost:3000'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

export function isLoopbackURL(value: string): boolean {
	try {
		const url = new URL(value)
		return LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) || url.hostname.endsWith('.localhost')
	} catch {
		return false
	}
}

export function resolveEnvironment(
	env: Record<string, string | undefined> = process.env,
): AiSuiteEnvironment {
	const baseURL = env.AI_SUITE_BASE_URL ?? DEFAULT_BASE_URL
	if (!isLoopbackURL(baseURL)) {
		throw new Error(
			`Earthly AI suite refuses non-loopback target ${baseURL}. ` +
				'Start a local server or set AI_SUITE_BASE_URL to a loopback URL.',
		)
	}

	return {
		baseURL: new URL(baseURL).origin,
		headless: env.AI_SUITE_HEADLESS === '1' || env.CI === '1',
	}
}
