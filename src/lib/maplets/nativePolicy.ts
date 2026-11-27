import { assertVerifiedMaplet, type VerifiedMaplet } from './artifact'

export const NATIVE_MAPLET_UNSUPPORTED_MESSAGE =
	'Third-party Maplet apps are supported in the Earthly web app.'

/** The web runtime supports verified third-party Maplets in sandboxed iframes. */
export function supportsThirdPartyMaplets(): boolean {
	return true
}

export function assertMapletPlatformSupport(artifact: VerifiedMaplet): void {
	assertVerifiedMaplet(artifact)
}

export function prepareMapletHtmlForPlatform(
	artifact: VerifiedMaplet,
	_ownerDocument?: Document,
): { html: string; scriptNonceAttribute: string } {
	assertMapletPlatformSupport(artifact)
	return { html: artifact.html, scriptNonceAttribute: '' }
}
