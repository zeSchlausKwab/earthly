import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, SimplePool } from 'nostr-tools'
import { test, expect } from '../fixtures/earthly'
import { testIdentities } from '../test-identities'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { createContext } from '../tasks/create/context'
import { openPanel } from '../tasks/navigation/open-panel'

const LOCAL_RELAY = 'ws://127.0.0.1:3334'
const TWO_THOUSAND_SAT_INVOICE =
	'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567'

async function publishLocal(pool: SimplePool, event: ReturnType<typeof finalizeEvent>) {
	await Promise.all(pool.publish([LOCAL_RELAY], event))
}

test('a Context like survives the entity panel remount @social-actions', async ({ earthly }) => {
	const runId = Date.now().toString(36)
	await authorizeJourneyIdentity(earthly, 'owner')
	await createContext(earthly, {
		name: `Social actions ${runId}`,
		description: 'A local-only Context used to verify entity reactions.',
	})

	const getContextRow = () =>
		earthly.page
			.getByRole('button', { name: `Inspect context Social actions ${runId}`, exact: true })
			.first()
			.locator('xpath=ancestor::*[.//button[@aria-label="Zap"]][1]')
	const contextRow = getContextRow()
	await contextRow.getByRole('button', { name: 'Like', exact: true }).click()
	await expect(contextRow.getByRole('button', { name: 'Unlike', exact: true })).toBeVisible()

	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: 'Close Contexts', exact: true }).click()
		await openPanel(earthly, 'Contexts')
	} else {
		await openPanel(earthly, 'Datasets')
		await openPanel(earthly, 'Contexts')
	}

	const remountedContextRow = getContextRow()
	await expect(
		remountedContextRow.getByRole('button', { name: 'Unlike', exact: true }),
	).toBeVisible()
	await remountedContextRow.getByRole('button', { name: 'Unlike', exact: true }).click()
	await expect(remountedContextRow.getByRole('button', { name: 'Like', exact: true })).toBeVisible()
})

test('a paid zap stays visible with confirmation instead of dismissing itself @social-actions', async ({
	earthly,
}) => {
	const pool = new SimplePool()
	const owner = testIdentities.owner
	const secretKey = hexToBytes(owner.secretKeyHex)
	const runId = Date.now().toString(36)
	const callbackCapture: {
		zapRequest: { kind: number; tags: string[][] } | null
	} = { zapRequest: null }

	await publishLocal(
		pool,
		finalizeEvent(
			{
				kind: 0,
				created_at: Math.floor(Date.now() / 1000) + 1,
				tags: [],
				content: JSON.stringify({
					name: owner.displayName,
					lud16: 'owner@payments.test',
				}),
			},
			secretKey,
		),
	)
	await earthly.page.route('https://payments.test/**', async (route) => {
		const url = new URL(route.request().url())
		if (url.pathname === '/callback') {
			callbackCapture.zapRequest = JSON.parse(url.searchParams.get('nostr') ?? '') as {
				kind: number
				tags: string[][]
			}
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(
				url.pathname === '/callback'
					? { pr: TWO_THOUSAND_SAT_INVOICE }
					: {
							callback: 'https://payments.test/callback',
							minSendable: 1_000,
							maxSendable: 10_000_000,
							allowsNostr: true,
							nostrPubkey: owner.publicKey,
						},
			),
		})
	})

	try {
		await authorizeJourneyIdentity(earthly, 'owner')
		await openPanel(earthly, 'Wallet')
		await earthly.page.getByRole('button', { name: 'Add NWC wallet', exact: true }).click()
		await expect(
			earthly.page.getByRole('button', { name: 'Scan QR code', exact: true }),
		).toBeVisible()
		await earthly.page
			.getByLabel('NWC connection')
			.fill(
				`nostr+walletconnect://${owner.publicKey}?relay=${encodeURIComponent(LOCAL_RELAY)}&secret=${owner.secretKeyHex}&lud16=${encodeURIComponent('owner@payments.test')}`,
			)
		await earthly.page.getByRole('button', { name: 'Save wallet', exact: true }).click()
		await expect(earthly.page.getByRole('button', { name: 'Replace', exact: true })).toBeVisible()

		await createContext(earthly, {
			name: `Zap lifecycle ${runId}`,
			description: 'A local-only Context used to verify zap confirmation.',
		})
		const contextRow = earthly.page
			.getByRole('button', { name: `Inspect context Zap lifecycle ${runId}`, exact: true })
			.first()
			.locator('xpath=ancestor::*[.//button[@aria-label="Zap"]][1]')
		await contextRow.getByRole('button', { name: 'Zap', exact: true }).click()
		await earthly.page.getByRole('button', { name: 'Custom', exact: true }).click()
		await earthly.page.getByLabel('Custom amount').fill('2000')
		await earthly.page
			.getByRole('button', { name: 'Generate Lightning invoice', exact: true })
			.click()
		await expect(earthly.page.getByRole('button', { name: 'Copy invoice' })).toBeVisible()
		await expect(
			earthly.page.getByRole('button', { name: 'Pay with NWC wallet', exact: true }),
		).toBeVisible()
		expect(callbackCapture.zapRequest?.kind).toBe(9734)
		expect(callbackCapture.zapRequest?.tags.find((tag) => tag[0] === 'relays')?.slice(1)).toContain(
			'wss://relay.earthly.city',
		)
		await expect(
			earthly.page.getByText(
				'This invoice belongs to your connected NWC wallet. A self-payment may only show its routing fee; use another wallet to test an incoming zap.',
				{ exact: true },
			),
		).toBeVisible()

		const contexts = await pool.querySync(
			[LOCAL_RELAY],
			{ kinds: [37518], authors: [owner.publicKey], limit: 20 },
			{ maxWait: 2_000 },
		)
		const target = contexts.find((event) => event.content.includes(`Zap lifecycle ${runId}`))
		expect(target).toBeTruthy()
		const identifier = target?.tags.find((tag) => tag[0] === 'd')?.[1]
		expect(identifier).toBeTruthy()

		if (earthly.isMobile) {
			await earthly.page
				.locator('button')
				.filter({ hasText: /^Map$/ })
				.last()
				.evaluate((button: HTMLButtonElement) => button.click())
		} else {
			await earthly.page
				.locator('button')
				.filter({ hasText: /^Datasets/ })
				.first()
				.evaluate((button: HTMLButtonElement) => button.click())
		}
		await expect(earthly.page.getByRole('heading', { name: 'Send a zap' })).toBeVisible()

		await publishLocal(
			pool,
			finalizeEvent(
				{
					kind: 9735,
					created_at: Math.floor(Date.now() / 1000),
					tags: [
						['bolt11', TWO_THOUSAND_SAT_INVOICE],
						['a', `37518:${owner.publicKey}:${identifier}`],
						['description', JSON.stringify(callbackCapture.zapRequest)],
					],
					content: '',
				},
				secretKey,
			),
		)

		await expect(earthly.page.getByRole('heading', { name: 'Send a zap' })).toBeVisible()
		await expect(
			earthly.page.getByRole('dialog').getByText('Zap received', { exact: true }),
		).toBeVisible()
		await expect(earthly.page.getByRole('heading', { name: 'Send a zap' })).toBeHidden({
			timeout: 4_000,
		})
	} finally {
		pool.destroy()
	}
})
