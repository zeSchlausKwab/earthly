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
		const stories = await pool.querySync([LOCAL_RELAY], { kinds: [37520] }, { maxWait: 2_000 })
		const referenceStory = stories.find((event) => storyTitle(event) === REFERENCE_STORY_TITLE)
		if (!referenceStory) throw new Error(`Seeded Story not found: ${REFERENCE_STORY_TITLE}`)
		const datasetCoordinate = referenceStory.tags.find((tag) => tag[0] === 'a')?.[1]
		if (!datasetCoordinate) {
			throw new Error(`Seeded Story has no Map reference: ${REFERENCE_STORY_TITLE}`)
		}
		const [kindText, pubkey, ...identifierParts] = datasetCoordinate.split(':')
		const kind = Number(kindText)
		const datasetIdentifier = identifierParts.join(':')
		if (kind !== 37515 || !pubkey || !datasetIdentifier) {
			throw new Error(`Seeded Story has an invalid Map reference: ${datasetCoordinate}`)
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

test('the canonical shared Story stays on the dedicated reader route', async ({ earthly }) => {
	const { naddr, title } = await publishSharedStoryWithoutBounds()
	await earthly.open({ path: `/read/${naddr}` })

	await expect(
		earthly.page.getByRole('heading', { name: title, exact: true, level: 1 }),
	).toBeVisible({
		timeout: 15_000,
	})
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(`/read/${naddr}`)
	await expect(earthly.page.locator('[data-earthly-route-surface="reader"]')).toBeVisible()
	await expect(earthly.page.getByRole('link', { name: 'Open Earthly', exact: true })).toBeVisible()
	await expect(
		earthly.page.getByRole('button', { name: /^(Edit Story|Propose a Story edit)$/ }),
	).toBeVisible()
	await expect(earthly.page.getByRole('navigation', { name: 'Global navigation' })).toHaveCount(0)
	await expect(earthly.page.getByRole('region', { name: 'Shelf' })).toHaveCount(0)
	await expect(earthly.page.getByRole('region', { name: 'AI Thread' })).toHaveCount(0)
})

test('a Story object reveals and fits its referenced Map', async ({ earthly }) => {
	const { naddr, title } = await publishSharedStoryWithoutBounds()
	await earthly.open({ path: `/story/${naddr}` })
	await expect(
		earthly.page.getByRole('heading', { name: title, exact: true, level: 2 }),
	).toBeVisible({ timeout: 15_000 })
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(`/story/${naddr}`)

	const presentationMap = earthly.page
		.getByRole('list', { name: 'Maps on the canvas' })
		.locator('[data-shelf-item^="presentation:story:"]')
	await expect(presentationMap).toHaveCount(1, { timeout: 10_000 })
	await expect(presentationMap.getByRole('button', { name: /^Hide / })).toHaveAttribute(
		'aria-pressed',
		'true',
	)

	await expect
		.poll(
			() =>
				earthly.page.evaluate(() => {
					const map = (
						window as typeof window & {
							__earthlyMap?: { getZoom(): number; isMoving(): boolean }
						}
					).__earthlyMap
					return map && !map.isMoving() && map.getZoom() > 5 ? map.getZoom() : null
				}),
			{ timeout: 15_000 },
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

	// A single-point Map deliberately lands at a readable zoom (15) while the
	// older manual Map helper may hit MapLibre's max zoom. The spatial target,
	// not that point-zoom policy difference, is the shared-route contract.
	expect(automaticView.zoom).toBeGreaterThan(5)
	expect(automaticView.lng).toBeCloseTo(manualView.lng, 4)
	expect(automaticView.lat).toBeCloseTo(manualView.lat, 4)
})

for (const openVia of ['title', 'looking-glass icon'] as const) {
	test(`opening a Story via its ${openVia} reveals and fits its referenced Map`, async ({
		earthly,
	}) => {
		const { title } = await publishSharedStoryWithoutBounds()
		await earthly.open({ path: '/browse/stories' })
		const search = earthly.page.getByPlaceholder('Search stories…')
		await expect(search).toBeVisible({ timeout: 15_000 })
		await search.fill(title)
		const openStory =
			openVia === 'title'
				? earthly.page.getByRole('button', { name: `Open story ${title}`, exact: true })
				: earthly.page.getByRole('button', { name: 'Open story', exact: true })
		await expect(openStory).toBeVisible()
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
				id: 'test:story-activation-visible',
				entityType: 'coordinate',
				entityKey: 'geo:48.2082,16.3738',
				title: 'Visible control entry',
				source: 'manual',
				visible: true,
				pinned: false,
			})
			store.getState().addMapStackEntry({
				id: 'test:story-activation-hidden',
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

		await openStory.click()
		await expect(
			earthly.page.getByRole('heading', { name: title, exact: true, level: 2 }),
		).toBeVisible()
		await expect.poll(() => new URL(earthly.page.url()).pathname).toMatch(/^\/story\//)
		const presentationMap = earthly.page
			.getByRole('list', { name: 'Maps on the canvas' })
			.locator('[data-shelf-item^="presentation:story:"]')
		await expect(presentationMap).toHaveCount(1, { timeout: 10_000 })

		const afterStack = (await editorLifecycleSnapshot(earthly)).mapStack
		expect(afterStack.find((entry) => entry.id === 'test:story-activation-visible')).toMatchObject({
			visible: true,
		})
		expect(afterStack.find((entry) => entry.id === 'test:story-activation-hidden')).toMatchObject({
			visible: false,
		})
		// Story presentation is route-local. Opening it must preserve the user's
		// existing Shelf state rather than writing derived rows into the store.
		expect(afterStack.filter((entry) => entry.entityType === 'dataset')).toHaveLength(0)
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
					__earthlyMap?: {
						jumpTo(options: { center: [number, number]; zoom: number }): void
					}
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
						return map && !map.isMoving() && Math.abs(map.getZoom() - 1) > 0.5
							? map.getZoom()
							: null
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

		expect(automaticView.zoom).toBeGreaterThan(5)
		expect(automaticView.lng).toBeCloseTo(manualView.lng, 4)
		expect(automaticView.lat).toBeCloseTo(manualView.lat, 4)
	})
}
