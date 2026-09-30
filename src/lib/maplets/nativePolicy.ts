import { isTauri } from '@/config/platform'
import { assertVerifiedMaplet, type VerifiedMaplet } from './artifact'

export const NATIVE_MAPLET_UNSUPPORTED_MESSAGE =
	'Third-party Maplet apps are not supported in the native app yet. Use the bundled Maplets or open the web app.'

/** Android's current Wry bridge is injected into subframes. Do not run downloaded code there. */
export function supportsThirdPartyMaplets(): boolean {
	return !isTauri()
}

export function assertMapletPlatformSupport(artifact: VerifiedMaplet): void {
	assertVerifiedMaplet(artifact)
	if (
		!supportsThirdPartyMaplets() &&
		(artifact.provenance !== 'bundled' ||
			!['bundled:live-mapper', 'bundled:my-maps-viewer'].includes(artifact.identity.dTag))
	)
		throw new Error(NATIVE_MAPLET_UNSUPPORTED_MESSAGE)
}

const SCRIPT_TOKEN = '__TAURI_SCRIPT_NONCE__'
const STYLE_TOKEN = '__TAURI_STYLE_NONCE__'
const NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/

/**
 * Tauri replaces these host-owned placeholders and adds their values to the
 * parent CSP. A srcdoc inherits that policy; its own meta CSP cannot relax it.
 * Only explicitly reviewed bundled Maplets receive these values, after the native gate.
 */
export function prepareMapletHtmlForPlatform(
	artifact: VerifiedMaplet,
	ownerDocument?: Document,
): { html: string; scriptNonceAttribute: string } {
	assertMapletPlatformSupport(artifact)
	if (supportsThirdPartyMaplets()) return { html: artifact.html, scriptNonceAttribute: '' }
	const host = ownerDocument ?? (typeof document === 'undefined' ? undefined : document)
	const script = host
		?.querySelector('meta[name="earthly-maplet-script-nonce"]')
		?.getAttribute('content')
	const style = host
		?.querySelector('meta[name="earthly-maplet-style-nonce"]')
		?.getAttribute('content')
	// Tauri's mobile dev-server proxy serves the original HTML without asset CSP rewriting.
	if (script === SCRIPT_TOKEN && style === STYLE_TOKEN)
		return { html: artifact.html, scriptNonceAttribute: '' }
	if (
		!script ||
		!style ||
		script === SCRIPT_TOKEN ||
		style === STYLE_TOKEN ||
		!NONCE.test(script) ||
		!NONCE.test(style)
	)
		throw new Error(
			'Bundled Maplets need the updated native app assets. Rebuild or update Earthly.',
		)
	// This is a checked transform of our self-contained bundled programs, not
	// an HTML rewriter which grants native execution to arbitrary downloaded tags.
	if (artifact.html.split('<script>').length !== 2 || artifact.html.split('<style>').length !== 2)
		throw new Error('The bundled Maplet document has an unsupported native layout.')
	const scriptNonceAttribute = ` nonce="${script}"`
	return {
		html: artifact.html
			.replace('<script>', `<script${scriptNonceAttribute}>`)
			.replace('<style>', `<style nonce="${style}">`),
		scriptNonceAttribute,
	}
}
