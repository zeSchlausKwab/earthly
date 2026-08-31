import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, nip19, SimplePool, type NostrEvent } from 'nostr-tools'
import { test, expect } from '../fixtures/earthly'
import { testIdentities } from '../test-identities'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'

const LOCAL_RELAY = 'ws://127.0.0.1:3334'
const REFERENCE_STORY_TITLE = 'Field Notes: Donaukanal Wildlife'

function storyTitle(event: NostrEvent): string | null {
	try {
		const content = JSON.parse(event.content) as { title?: unknown }
		return typeof content.title === 'string' ? content.title : null
	} catch {
		return null
	}
}

async function publishSharedStoryWithoutBounds(): Promise<{ naddr: string; title: string }> {
	const pool = new SimplePool()
	try {
		const stories = await pool.querySync(
			[LOCAL_RELAY],
			{ kinds: [37520], limit: 20 },
			{ maxWait: 2_000 },
		)
		const referenceStory = stories.find((event) => storyTitle(event) === REFERENCE_STORY_TITLE)
		if (!referenceStory) throw new Error(`Seeded Story not found: ${REFERENCE_STORY_TITLE}`)
		const datasetCoordinate = referenceStory.tags.find((tag) => tag[0] === 'a')?.[1]
		if (!datasetCoordinate) {
			throw new Error(`Seeded Story has no Dataset reference: ${REFERENCE_STORY_TITLE}`)
		}
		const [kindText, pubkey, ...identifierParts] = datasetCoordinate.split(':')
		const kind = Number(kindText)
		const datasetIdentifier = identifierParts.join(':')
		if (kind !== 37515 || !pubkey || !datasetIdentifier) {
			throw new Error(`Seeded Story has an invalid Dataset reference: ${datasetCoordinate}`)
		}
		const datasetAddress = nip19.naddrEncode({ kind, pubkey, identifier: datasetIdentifier })
		const identifier = `shared-story-${Date.now().toString(36)}`
		const title = `Shared Story ${identifier}`
		const event = finalizeEvent(
			{
				kind: 37520,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['d', identifier],
					['a', datasetCoordinate],
				],
				content: JSON.stringify({
					modelVersion: 'earthly/2',
					title,
					summary: 'A direct-link Story whose map extent comes only from its reference.',
					content: `Open the referenced map: nostr:${datasetAddress}`,
				}),
			},
			hexToBytes(testIdentities.owner.secretKeyHex),
		)
		await Promise.all(pool.publish([LOCAL_RELAY], event))
		return {
			naddr: nip19.naddrEncode({
				kind: event.kind,
				pubkey: event.pubkey,
				identifier,
				relays: [LOCAL_RELAY],
			}),
			title,
		}
	} finally {
		pool.close([LOCAL_RELAY])
	}
}

test('a shared Story landing reveals and fits its referenced Dataset', async ({ earthly }) => {
	const { naddr, title } = await publishSharedStoryWithoutBounds()
	await earthly.open({ path: `/stories/story/${naddr}` })
	await expect(earthly.page.getByText(title, { exact: true }).first()).toBeVisible({
		timeout: 15_000,
	})
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(`/stories/story/${naddr}`)

	await expect
		.poll(
			async () =>
				(await editorLifecycleSnapshot(earthly)).mapStack.filter(
					(entry) => entry.entityType === 'dataset' && entry.visible,
				).length,
			{ timeout: 10_000 },
		)
		.toBe(1)

	const [referencedDataset] = (await editorLifecycleSnapshot(earthly)).mapStack.filter(
		(entry) => entry.entityType === 'dataset' && entry.visible,
	)
	if (!referencedDataset) throw new Error('Story reference was not admitted to the Map Stack')
	const mapStack = earthly.page.getByRole('region', { name: 'Map stack' })
	await expect(mapStack).toBeVisible()
	await expect(mapStack.getByText(title, { exact: true })).toBeVisible()
	await expect(mapStack.getByText(referencedDataset.title, { exact: true })).toBeVisible()

	await expect
		.poll(() =>
			earthly.page.evaluate(() => {
				const map = (
					window as typeof window & {
						__earthlyMap?: { getZoom(): number; isMoving(): boolean }
					}
				).__earthlyMap
				return map && !map.isMoving() && map.getZoom() > 5 ? map.getZoom() : null
			}),
		)
		.not.toBeNull()
	const automaticView = await earthly.page.evaluate(() => {
		const map = (
			window as typeof window & {
				__earthlyMap?: {
					getCenter(): { lat: number; lng: number }
					getZoom(): number
				}
			}
		).__earthlyMap
		if (!map) throw new Error('Earthly map debug handle is unavailable')
		const center = map.getCenter()
		return { lat: center.lat, lng: center.lng, zoom: map.getZoom() }
	})

	await earthly.page.evaluate(() => {
		const map = (
			window as typeof window & {
				__earthlyMap?: { jumpTo(options: { center: [number, number]; zoom: number }): void }
			}
		).__earthlyMap
		if (!map) throw new Error('Earthly map debug handle is unavailable')
		map.jumpTo({ center: [0, 0], zoom: 1 })
	})
	await expect
		.poll(() =>
			earthly.page.evaluate(
				() =>
					(
						window as typeof window & {
							__earthlyMap?: { getZoom(): number }
						}
					).__earthlyMap?.getZoom() ?? null,
			),
		)
		.toBeCloseTo(1, 1)

	await earthly.page
		.getByRole('button', { name: 'Zoom to referenced geometry', exact: true })
		.first()
		.click()
	await expect
		.poll(
			() =>
				earthly.page.evaluate(() => {
					const map = (
						window as typeof window & {
							__earthlyMap?: { getZoom(): number; isMoving(): boolean }
						}
					).__earthlyMap
					return map && !map.isMoving() && Math.abs(map.getZoom() - 1) > 0.5 ? map.getZoom() : null
				}),
			{ timeout: 15_000 },
		)
		.not.toBeNull()
	const manualView = await earthly.page.evaluate(() => {
		const map = (
			window as typeof window & {
				__earthlyMap?: {
					getCenter(): { lat: number; lng: number }
					getZoom(): number
				}
			}
		).__earthlyMap
		if (!map) throw new Error('Earthly map debug handle is unavailable')
		const center = map.getCenter()
		return { lat: center.lat, lng: center.lng, zoom: map.getZoom() }
	})

	// A single-point Dataset deliberately lands at a readable zoom (15) while the
	// older manual Dataset helper may hit MapLibre's max zoom. The spatial target,
	// not that point-zoom policy difference, is the shared-route contract.
	expect(automaticView.zoom).toBeGreaterThan(5)
	expect(automaticView.lng).toBeCloseTo(manualView.lng, 4)
	expect(automaticView.lat).toBeCloseTo(manualView.lat, 4)
})

test('opening a Story in the app keeps the Map Stack and camera unchanged', async ({ earthly }) => {
	await earthly.open({ path: '/stories' })
	const openStory = earthly.page.getByRole('button', {
		name: `Open story ${REFERENCE_STORY_TITLE}`,
		exact: true,
	})
	await expect(openStory).toBeVisible({ timeout: 15_000 })
	await expect
		.poll(() =>
			earthly.page.evaluate(() => {
				const debugWindow = window as typeof window & {
					__earthlyMap?: unknown
					__earthlyEditorStore?: unknown
				}
				return Boolean(debugWindow.__earthlyMap && debugWindow.__earthlyEditorStore)
			}),
		)
		.toBe(true)

	await earthly.page.evaluate(() => {
		const store = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): {
						addMapStackEntry(input: {
							id: string
							entityType: 'coordinate'
							entityKey: string
							title: string
							source: 'manual'
							visible: boolean
							pinned: boolean
						}): string
					}
				}
			}
		).__earthlyEditorStore
		const map = (
			window as typeof window & {
				__earthlyMap?: {
					jumpTo(options: { center: [number, number]; zoom: number }): void
				}
			}
		).__earthlyMap
		if (!store || !map) throw new Error('Earthly debug handles are unavailable')
		store.getState().addMapStackEntry({
			id: 'test:story-neutral-visible',
			entityType: 'coordinate',
			entityKey: 'geo:48.2082,16.3738',
			title: 'Visible control entry',
			source: 'manual',
			visible: true,
			pinned: false,
		})
		store.getState().addMapStackEntry({
			id: 'test:story-neutral-hidden',
			entityType: 'coordinate',
			entityKey: 'geo:47.4979,19.0402',
			title: 'Hidden control entry',
			source: 'manual',
			visible: false,
			pinned: false,
		})
		map.jumpTo({ center: [12, 42], zoom: 4 })
	})
	await expect
		.poll(() =>
			earthly.page.evaluate(() => {
				const map = (
					window as typeof window & {
						__earthlyMap?: {
							getCenter(): { lat: number; lng: number }
							getZoom(): number
							isMoving(): boolean
						}
					}
				).__earthlyMap
				if (!map || map.isMoving()) return null
				const center = map.getCenter()
				return { lat: center.lat, lng: center.lng, zoom: map.getZoom() }
			}),
		)
		.toEqual({ lat: 42, lng: 12, zoom: 4 })

	const beforeStack = (await editorLifecycleSnapshot(earthly)).mapStack
	await openStory.click()
	await expect(earthly.page.getByText(REFERENCE_STORY_TITLE, { exact: true }).first()).toBeVisible()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toMatch(/^\/stories\/story\//)
	await expect
		.poll(() =>
			earthly.page.evaluate(() => {
				const map = (
					window as typeof window & {
						__earthlyMap?: {
							getCenter(): { lat: number; lng: number }
							getZoom(): number
							isMoving(): boolean
						}
					}
				).__earthlyMap
				if (!map || map.isMoving()) return null
				const center = map.getCenter()
				return { lat: center.lat, lng: center.lng, zoom: map.getZoom() }
			}),
		)
		.toEqual({ lat: 42, lng: 12, zoom: 4 })
	expect((await editorLifecycleSnapshot(earthly)).mapStack).toEqual(beforeStack)
})
