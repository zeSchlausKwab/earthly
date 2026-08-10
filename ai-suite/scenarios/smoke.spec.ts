import { test, expect } from '../fixtures/earthly'
import { readFile } from 'node:fs/promises'
import { createIdentity } from '../tasks/auth/create-identity'
import { signIn } from '../tasks/auth/sign-in'
import { createStoryDraft, insertStoryCoordinateReference } from '../tasks/create/story'
import { startDataset } from '../tasks/create/dataset'
import { openPanel } from '../tasks/navigation/open-panel'
import { completeTour, skipTour } from '../tasks/onboarding/tour'

test('anonymous first visit can complete the tour', async ({ earthly }) => {
	await earthly.open({ tour: 'new' })
	await expect(earthly.page.getByText('Welcome to Earthly')).toBeVisible()
	await completeTour(earthly)
	await expect
		.poll(() => earthly.page.evaluate(() => localStorage.getItem('earthly-tour-seen')))
		.toBe('true')
})

test('seeded owner can sign in through the NIP-07 adapter', async ({ earthly }, testInfo) => {
	test.skip(
		testInfo.project.name !== 'desktop',
		'The current extension login control is desktop-only',
	)
	await signIn(earthly, 'owner')
	await expect(earthly.page.getByRole('button', { name: 'Account menu' })).toBeVisible()
})

test('a new visitor can create a fresh identity', async ({ earthly }, testInfo) => {
	test.skip(
		testInfo.project.name !== 'desktop',
		'The current create-identity trigger is desktop-only',
	)
	await earthly.open({ tour: 'seen' })
	await createIdentity(earthly)
	await expect(earthly.page.getByRole('button', { name: 'Account menu' })).toBeVisible()
})

test('anonymous first visit can skip the tour', async ({ earthly }) => {
	await earthly.open({ tour: 'new' })
	await skipTour(earthly)
	await expect(earthly.page.locator('.driver-popover')).toBeHidden()
})

test('Contexts can be opened through the current viewport navigation', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Contexts')
})

test('unfinished dataset is recoverable from Local drafts', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	const draft = await startDataset(earthly)
	await draft.nameInput.fill('Recoverable trail sketch')
	await expect(draft.nameInput).toHaveValue('Recoverable trail sketch')
	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: 'More tools', exact: true }).click()
		await earthly.page.getByRole('menuitem', { name: 'Exit editing', exact: true }).click()
		await expect(earthly.page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible()
	}
	await openPanel(earthly, 'Local drafts')
	const panel = earthly.page.getByRole('region', { name: 'Local drafts' })
	const localDraftHeadings = earthly.page.getByRole('heading', {
		name: 'Local drafts',
		exact: true,
	})
	await expect(localDraftHeadings.first()).toBeVisible()
	if (earthly.isMobile) await expect(localDraftHeadings).toHaveCount(1)
	await expect(earthly.page.getByText(/saved on this device/i).first()).toBeVisible()
	const expandDrafts = panel.getByRole('button', { name: 'Expand saved drafts' }).first()
	if (await expandDrafts.isVisible()) await expandDrafts.click()
	const recoverableDraft = panel.getByRole('button', {
		name: /^Recoverable trail sketch Public$/i,
	})
	await expect(recoverableDraft).toBeVisible()
	if (earthly.isMobile) {
		await recoverableDraft.click()
		await expect(earthly.page.getByRole('dialog', { name: 'Earthly navigation' })).toBeHidden()
		await expect(earthly.page.getByTestId('mobile-sheet')).toBeVisible()
	}
})

test('Private groups can be opened as a routed panel', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Private groups')
	await expect(
		earthly.page
			.locator('h2:visible')
			.filter({ hasText: /^Private groups$/ })
			.first(),
	).toBeVisible()
})

test('Field sessions are a routed native workspace', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Field sessions')
	await expect(
		earthly.page
			.locator('h2:visible')
			.filter({ hasText: /^Field sessions$/ })
			.first(),
	).toBeVisible()
	await expect(earthly.page.getByText('Earthly app required', { exact: true })).toBeVisible()
	await expect(earthly.page.getByRole('link', { name: 'Get Android app' })).toHaveAttribute(
		'href',
		/https:\/\/zapstore\.dev\/apps\//,
	)
	await expect(earthly.page.getByRole('link', { name: 'Download for macOS' })).toHaveAttribute(
		'href',
		/\/releases\/latest\/download\/earthly-macos-aarch64\.dmg$/,
	)
})

test('Sync & delivery is reachable and describes browser delivery honestly', async ({
	earthly,
}) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Sync & delivery')
	await expect(
		earthly.page.getByText('Available in the native Earthly apps', { exact: true }),
	).toBeVisible()
	await expect(earthly.page.getByText(/web app publishes directly/i)).toBeVisible()
	await expect(earthly.page.getByRole('link', { name: 'Get Android app' })).toBeVisible()
	await expect(earthly.page.getByRole('link', { name: 'Download for macOS' })).toBeVisible()
})

test('the web app describes native offline sharing without pretending to host a node', async ({
	earthly,
}) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Settings')
	await earthly.page.getByRole('tab', { name: 'Offline', exact: true }).click()
	await expect(earthly.page.getByText('Native app required', { exact: true })).toBeVisible()
	await expect(earthly.page.getByText(/does not expose a local relay or file server/)).toBeVisible()
	await expect(earthly.page.getByRole('link', { name: 'Get Android app' })).toHaveCount(2)
	await expect(earthly.page.getByRole('link', { name: 'Download for macOS' })).toHaveCount(2)
})

test('the native command bridge exposes local-node pairing controls', async ({
	earthly,
}, testInfo) => {
	const pmtilesFixture = await readFile(
		new URL('../../base-assets/flowers.pmtiles', import.meta.url),
	)
	await earthly.page.route('http://earthly-blob.localhost/**', async (route) => {
		const range = route
			.request()
			.headers()
			.range?.match(/^bytes=(\d+)-(\d+)$/)
		if (!range) {
			await route.fulfill({ status: 400, body: 'Range required' })
			return
		}
		const start = Number(range[1])
		const end = Math.min(Number(range[2]), pmtilesFixture.length - 1)
		await route.fulfill({
			status: 206,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag',
				'Accept-Ranges': 'bytes',
				'Content-Length': String(end - start + 1),
				'Content-Range': `bytes ${start}-${end}/${pmtilesFixture.length}`,
				'Content-Type': 'application/octet-stream',
				ETag: `"${'d'.repeat(64)}"`,
			},
			body: pmtilesFixture.subarray(start, end + 1),
		})
	})
	await earthly.page.addInitScript(() => {
		const referencedBlobHash = 'd'.repeat(64)
		let descriptor = {
			version: 1,
			nodeId: 'a'.repeat(64),
			relayUrl: 'ws://127.0.0.1:17447/',
			blossomUrl: 'http://127.0.0.1:17448/',
			scope: 'loopback',
			availability: 'process',
		}
		let remoteNodes: Record<string, unknown>[] = []
		const invoke = async (command: string, args?: Record<string, unknown>) => {
			switch (command) {
				case 'outbox_flush_v1':
				case 'outbox_list_v1':
					return []
				case 'local_node_status_v1':
					return { state: 'running', descriptor }
				case 'local_node_network_addresses_v1':
					return [{ address: '192.168.50.4', interfaceName: 'wlan0' }]
				case 'local_node_enable_lan_v1':
					descriptor = {
						...descriptor,
						relayUrl: 'ws://192.168.50.4:17447/',
						blossomUrl: 'http://192.168.50.4:17448/',
						scope: 'local-network',
					}
					return {
						state: 'running',
						descriptor,
						lanExpiresAt: Math.floor(Date.now() / 1000) + 900,
					}
				case 'local_node_pending_claims_v1':
				case 'local_node_peer_grants_v1':
					return []
				case 'local_node_remote_nodes_v1':
					return remoteNodes
				case 'local_node_create_invitation_v1':
					return {
						version: 1,
						encoded: `earthly-pair-v1:z${'x'.repeat(680)}`,
						expiresAt: Math.floor(Date.now() / 1000) + 600,
						capabilities: ['relay-read', 'relay-write', 'blob-read', 'blob-write'],
						descriptor,
					}
				case 'local_node_join_invitation_v1': {
					const remote = {
						version: 1,
						nodeId: 'b'.repeat(64),
						descriptor: {
							...descriptor,
							nodeId: 'b'.repeat(64),
						},
						claimId: 'c'.repeat(64),
						peerPubkey: 'a'.repeat(64),
						peerName: String(args?.peerName ?? 'Earthly device'),
						capabilities: ['relay-read', 'relay-write', 'blob-read', 'blob-write'],
						status: { state: 'pending' },
						updatedAt: Math.floor(Date.now() / 1000),
					}
					remoteNodes = [remote]
					return remote
				}
				case 'local_node_refresh_remote_node_v1': {
					const remote = { ...remoteNodes[0], status: { state: 'accepted' } }
					remoteNodes = [remote]
					return remote
				}
				case 'local_node_sync_remote_node_v1': {
					const now = Math.floor(Date.now() / 1000)
					const nodeId = String(remoteNodes[0]?.nodeId ?? '')
					const remote = {
						...remoteNodes[0],
						updatedAt: now,
						lastSync: { syncedAt: now, receivedEvents: 0 },
						discoveredBlobHashes: [referencedBlobHash],
						mirroredBlobHashes: [],
					}
					remoteNodes = [remote]
					return {
						nodeId,
						receivedEvents: 0,
						hydratedEvents: 0,
						eventsTruncated: false,
						events: [],
						discoveredBlobHashes: [referencedBlobHash],
						remoteNode: remote,
					}
				}
				case 'local_node_mirror_remote_blobs_v1': {
					const remote = {
						...remoteNodes[0],
						discoveredBlobHashes: [referencedBlobHash],
						mirroredBlobHashes: [referencedBlobHash],
					}
					remoteNodes = [remote]
					return {
						nodeId: String(args?.nodeId ?? ''),
						items: [{ sha256: referencedBlobHash, state: 'mirrored' }],
						remoteNode: remote,
					}
				}
				default:
					throw new Error(`Unexpected native command: ${command}`)
			}
		}
		Object.defineProperty(window, '__TAURI_INTERNALS__', {
			configurable: true,
			value: { invoke },
		})
		Object.defineProperty(window, '__TAURI_OS_PLUGIN_INTERNALS__', {
			configurable: true,
			value: { platform: 'android' },
		})
	})

	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Settings')
	await earthly.page.getByRole('tab', { name: 'Offline', exact: true }).click()
	await expect(earthly.page.getByText('Local node running', { exact: true })).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Serve for 15 minutes' }).click()
	await expect(earthly.page.getByText(/Serving on 192\.168\.50\.4/)).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Create pairing invitation' }).click()
	const pairingQr = earthly.page.getByLabel('Expanded pairing QR code')
	await expect(pairingQr).toBeVisible()
	const pairingQrPath = testInfo.outputPath('pairing-invitation.png')
	await pairingQr.screenshot({ path: pairingQrPath })
	await earthly.page.keyboard.press('Escape')
	await expect(earthly.page.getByRole('button', { name: 'Copy app link' })).toBeVisible()

	await earthly.page.getByRole('tab', { name: 'Join a device' }).click()
	await earthly.page.getByLabel('Choose a pairing QR image').setInputFiles(pairingQrPath)
	await expect(earthly.page.getByLabel('Pairing invitation')).toHaveValue(/^earthly-pair-v1:/)
	await earthly.page.getByRole('button', { name: 'Request access' }).click()
	await expect(earthly.page.getByText('Waiting for host approval', { exact: true })).toBeVisible()
	const connectedNode = earthly.page.getByText('Connected Earthly node', { exact: true })
	await expect
		.poll(async () => {
			if (await connectedNode.isVisible()) return true
			try {
				await earthly.page.getByRole('button', { name: 'Check approval' }).click({ timeout: 1_000 })
			} catch {
				// The three-second native refresh may observe approval and replace this button mid-click.
			}
			return connectedNode.isVisible()
		})
		.toBe(true)
	await earthly.page.getByRole('button', { name: 'Sync map records' }).click()
	await expect(earthly.page.getByText(/Last sync/)).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Mirror 1 referenced file' }).click()
	await expect(earthly.page.getByText('1 of 1 referenced files saved locally')).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Use as map' }).click()
	await expect(earthly.page.getByRole('button', { name: 'Active map' })).toBeVisible()
	await expect
		.poll(() => earthly.page.evaluate(() => localStorage.getItem('earthly-local-pmtiles-v1')))
		.toContain(`"sha256":"${'d'.repeat(64)}"`)
})

test('a Story can be saved as a local draft', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	await createStoryDraft(earthly, {
		title: 'AI suite smoke story',
		summary: 'A deterministic unpublished browser-test draft.',
		body: 'This story was composed by the Earthly AI suite.',
	})
	await expect(earthly.page.getByRole('button', { name: 'Save draft' })).toBeVisible()
})

test('a Story can capture a coordinate from the map', async ({ earthly }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'Coordinate picking needs the desktop split view')
	await earthly.open({ tour: 'seen' })
	await createStoryDraft(earthly, {
		title: 'AI suite coordinate reference',
		body: 'This place matters: ',
	})
	const reference = await insertStoryCoordinateReference(earthly)
	expect(reference).toMatch(/^geo:-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/)
	await earthly.page.getByRole('tab', { name: 'Preview', exact: true }).click()
	await expect(earthly.page.locator(`[title="${reference}"]`).last()).toBeVisible()
})
