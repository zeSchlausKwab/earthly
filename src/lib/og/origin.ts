/**
 * Resolve the origin used in public metadata.
 *
 * Production normally runs behind a TLS-terminating reverse proxy, so the
 * request visible to Bun can be `http://...` even though the public URL is
 * HTTPS. Prefer the explicitly trusted origin and only inspect the request in
 * development where no public origin was supplied.
 */
export function getPublicBaseUrl(request: Request, configuredOrigin?: string): string {
	const origin = configuredOrigin ? new URL(configuredOrigin).origin : new URL(request.url).origin
	return origin.replace(/\/+$/u, '')
}
