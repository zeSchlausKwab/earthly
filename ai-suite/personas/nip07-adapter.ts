import type { Page } from '@playwright/test'
import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import type { EarthlyPersona } from './index'

const SIGN_BINDING = '__earthlyAiSignEvent'

function hexToBytes(value: string): Uint8Array {
	const pairs = value.match(/.{2}/g)
	if (pairs?.length !== 32) throw new Error('Persona secret key must be 32 bytes')
	return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)))
}

export async function installNip07Adapter(page: Page, persona: EarthlyPersona): Promise<void> {
	const secretKey = hexToBytes(persona.secretKeyHex)
	await page.exposeFunction(SIGN_BINDING, (template: EventTemplate) =>
		finalizeEvent(template, secretKey),
	)
	await page.addInitScript(
		({ publicKey, binding }) => {
			type SignFunction = (template: EventTemplate) => Promise<unknown>
			const sign = (window as unknown as Record<string, SignFunction>)[binding]
			Object.defineProperty(window, 'nostr', {
				configurable: true,
				value: {
					getPublicKey: async () => publicKey,
					signEvent: async (template: EventTemplate) => sign?.(template),
					getRelays: async () => ({}),
				},
			})
		},
		{ publicKey: persona.publicKey, binding: SIGN_BINDING },
	)
}
