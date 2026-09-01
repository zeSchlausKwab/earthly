import { PrivateKeySigner } from 'applesauce-signers'
import { expect, test } from '../fixtures/earthly'

const NIP46_KIND = 24_133

test('an approved nostrconnect QR completes remote-signer login', async ({ earthly }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'One viewport is sufficient for the shared dialog')

	const remoteSigner = new PrivateKeySigner()
	const remotePubkey = await remoteSigner.getPublicKey()
	let relayFailure: unknown = null
	let approvalSent = false
	let signerSubscriptionClosed = false

	await earthly.page.routeWebSocket(/^wss:\/\/relay\.earthly\.city\/?$/, (socket) => {
		let nip46SubscriptionId: string | null = null
		let clientPubkey: string | null = null

		const sendResponse = async (response: { id: string; result: string }) => {
			if (!nip46SubscriptionId || !clientPubkey) throw new Error('NIP-46 subscription not ready')
			const content = await remoteSigner.nip44.encrypt(clientPubkey, JSON.stringify(response))
			const event = await remoteSigner.signEvent({
				kind: NIP46_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['p', clientPubkey]],
				content,
			})
			socket.send(JSON.stringify(['EVENT', nip46SubscriptionId, event]))
		}

		socket.onMessage((rawMessage) => {
			void (async () => {
				const message = JSON.parse(String(rawMessage)) as unknown[]
				if (message[0] === 'REQ') {
					const subscriptionId = String(message[1])
					const filters = message.slice(2) as Array<{
						kinds?: number[]
						'#p'?: string[]
					}>
					const nip46Filter = filters.find((filter) => filter.kinds?.includes(NIP46_KIND))
					if (nip46Filter?.['#p']?.[0]) {
						nip46SubscriptionId = subscriptionId
						clientPubkey = nip46Filter['#p'][0]
						const uriInput = earthly.page.locator('input[value^="nostrconnect://"]')
						await expect(uriInput).toBeVisible()
						const connectionUri = new URL(await uriInput.inputValue())
						expect(connectionUri.searchParams.get('name')).toBe('Earthly City (Web)')
						const secret = connectionUri.searchParams.get('secret')
						if (!secret) throw new Error('Connection URI omitted its secret')
						await sendResponse({ id: 'approved', result: secret })
						approvalSent = true
					}
					socket.send(JSON.stringify(['EOSE', subscriptionId]))
					return
				}

				if (message[0] === 'EVENT') {
					const event = message[1] as {
						id: string
						pubkey: string
						kind: number
						content: string
					}
					socket.send(JSON.stringify(['OK', event.id, true, 'saved']))
					if (event.kind !== NIP46_KIND || !clientPubkey) return

					const request = JSON.parse(
						await remoteSigner.nip44.decrypt(clientPubkey, event.content),
					) as { id: string; method: string }
					if (request.method === 'get_public_key') {
						await sendResponse({ id: request.id, result: remotePubkey })
					}
				}

				if (message[0] === 'CLOSE' && String(message[1]) === nip46SubscriptionId) {
					signerSubscriptionClosed = true
				}
			})().catch((error) => {
				relayFailure = error
			})
		})
	})

	await earthly.open({ tour: 'seen' })
	await earthly.page.getByRole('button', { name: 'Sign in with remote signer' }).click()
	await expect(earthly.page.getByText('Waiting for approval...', { exact: true })).toBeVisible()
	await expect.poll(() => approvalSent).toBe(true)
	await expect(earthly.page.getByRole('button', { name: 'Account menu' })).toBeVisible({
		timeout: 5_000,
	})
	await expect(
		earthly.page.getByRole('heading', { name: 'Connect with Remote Signer' }),
	).toBeHidden()
	expect(relayFailure).toBeNull()
	expect(signerSubscriptionClosed).toBe(false)
})
