import type { Page } from '@playwright/test'
import type { EventStore } from 'applesauce-core'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { test, expect } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { createStoryDraft } from '../tasks/create/story'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installInMemoryMapFixture } from '../tasks/setup/in-memory-map-fixture'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { testIdentities } from '../test-identities'

const draftKey = `earthly:context:editor-drafts:v1:${testIdentities.owner.publicKey.slice(0, 8)}`

interface RetainedAtlasDraft {
	name: string
	description: string
	presentation?: unknown
}

async function retainedAtlas(page: Page): Promise<RetainedAtlasDraft | null> {
	return page.evaluate((key) => {
		const drafts = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<
			string,
			RetainedAtlasDraft
		>
		return drafts['new-context'] ?? null
	}, draftKey)
}

async function sourceContents(page: Page, addresses: string[]) {
	return page.evaluate((sources) => {
		const store = (window as unknown as { __earthlyEventStore?: EventStore }).__earthlyEventStore
		if (!store) throw new Error('The fixture EventStore is unavailable')
		return sources.map((address) => {
			const [kind, pubkey, identifier] = address.split(':')
			if (!pubkey || !identifier) throw new Error('Invalid fixture Map address')
			const event = store.getReplaceable(Number(kind), pubkey, identifier)
			if (!event) throw new Error(`Fixture Map is missing: ${address}`)
			return { id: event.id, content: event.content }
		})
	}, addresses)
}

test('Atlas default-view controls retain scoped layers and camera through local draft reload @editor-contract', async ({
	earthly,
}) => {
	test.setTimeout(120_000)
	const page = earthly.page
	page.setDefaultTimeout(15_000)
	const publications = await installIsolatedRelays(earthly)
	await authorizeJourneyIdentity(earthly)
	const source = await installInMemoryMapFixture(earthly, {
		title: 'Accepted Atlas source',
		identifier: 'atlas-presentation-source',
	})
	const unrelated = await installInMemoryMapFixture(earthly, {
		title: 'Unreferenced route overlay',
		identifier: 'atlas-presentation-unrelated',
	})
	const addresses = [source.address, unrelated.address]
	const originalContents = await sourceContents(page, addresses)
	await earthly.open({ path: unrelated.path })
	await installDeterministicMapStyle(earthly)
	await expect(page.getByRole('button', { name: 'Remove from map', exact: true })).toBeVisible()
	await openPanel(earthly, 'Atlases')
	await page.getByRole('button', { name: 'New Atlas', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Create Atlas', exact: true })).toBeVisible()
	await page.getByRole('textbox', { name: 'Name', exact: true }).fill('A locally styled Atlas')
	const editor = page.locator('.ProseMirror[contenteditable="true"]:visible').first()
	const description = `Accepted source: nostr:${source.path.split('/').at(-1)}`
	await editor.fill(description)
	await page.getByRole('button', { name: 'Set from current view', exact: true }).click()
	await expect(
		page.getByText('No default layers yet. Add one of the Maps accepted by this Atlas.', {
			exact: true,
		}),
	).toBeVisible()
	const sourceSelect = page.getByRole('combobox', { name: 'Accepted Map source', exact: true })
	await expect(sourceSelect.getByRole('option')).toHaveCount(2)
	await expect(sourceSelect.locator('option').nth(1)).toHaveAttribute('value', source.address)
	await expect(sourceSelect.locator(`option[value="${unrelated.address}"]`)).toHaveCount(0)

	await sourceSelect.selectOption(source.address)
	await page.getByRole('button', { name: 'Add layer', exact: true }).click()
	const ids = page.getByRole('textbox', { name: 'Stable presentation layer id', exact: true })
	await ids.nth(0).fill('base')
	await sourceSelect.selectOption(source.address)
	await page.getByRole('button', { name: 'Add layer', exact: true }).click()
	await ids.nth(1).fill('highlight')
	await page.getByRole('button', { name: 'Hide default layer', exact: true }).nth(1).click()
	const opacity = page.getByRole('slider', { name: 'Opacity for highlight', exact: true })
	await opacity.focus()
	await opacity.press('Home')
	for (let step = 0; step < 8; step += 1) await opacity.press('ArrowRight')
	await expect(opacity).toHaveValue('0.4')
	await page
		.getByRole('combobox', { name: 'Feature scope', exact: true })
		.nth(1)
		.selectOption('features')
	await page
		.getByRole('textbox', { name: 'Feature IDs, separated by commas or new lines', exact: true })
		.fill('meeting-point, meeting-point')
	await page.getByText('Style override', { exact: true }).nth(1).click()
	await page.getByRole('textbox', { name: 'strokeColor', exact: true }).fill('#225577')
	await page.getByRole('combobox', { name: 'lineDash', exact: true }).selectOption('dashed')
	await page.getByRole('combobox', { name: 'arrowEnd', exact: true }).selectOption('false')
	await page.getByRole('button', { name: 'Move layer toward bottom', exact: true }).nth(1).click()
	await expect(ids.nth(0)).toHaveValue('highlight')
	await expect(ids.nth(1)).toHaveValue('base')

	await page.getByRole('button', { name: 'Clear camera', exact: true }).click()
	await expect(page.getByText('Default camera not set', { exact: true })).toBeVisible()
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap?.isMoving(),
			),
		)
		.toBe(false)
	await page.getByRole('button', { name: 'Capture camera', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Clear camera', exact: true })).toBeVisible()
	const capturedCamera = await page.evaluate(() => {
		const map = (window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap
		if (!map) throw new Error('The main map is unavailable')
		const center = map.getCenter()
		return {
			center: [center.lng, center.lat],
			zoom: map.getZoom(),
			bearing: map.getBearing(),
			pitch: map.getPitch(),
		}
	})
	await expect(ids).toHaveCount(2)

	// Replacing the editor flushes its retained local draft on both shell layouts.
	await createStoryDraft(earthly, {
		title: 'An independent local Story',
		body: 'Switching editors retains the Atlas presentation.',
	})
	await expect
		.poll(() => retainedAtlas(page))
		.toMatchObject({
			name: 'A locally styled Atlas',
			description,
			presentation: {
				version: 1,
				initialView: capturedCamera,
				layers: [
					{
						id: 'highlight',
						source: source.address,
						visible: false,
						opacityMultiplier: 0.4,
						featureIds: ['meeting-point'],
						style: { strokeColor: '#225577', lineDash: 'dashed', arrowEnd: false },
					},
					{ id: 'base', source: source.address, visible: true, opacityMultiplier: 1 },
				],
			},
		})
	const saved = await retainedAtlas(page)
	expect(await sourceContents(page, addresses)).toEqual(originalContents)
	await page.reload({ waitUntil: 'domcontentloaded' })
	await openPanel(earthly, 'Atlases')
	await page.getByRole('button', { name: 'New Atlas', exact: true }).click()
	await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
		'A locally styled Atlas',
	)
	await expect(ids.nth(0)).toHaveValue('highlight')
	await expect(ids.nth(1)).toHaveValue('base')
	await expect(opacity).toHaveValue('0.4')
	await expect(page.getByRole('button', { name: 'Show default layer', exact: true })).toHaveCount(1)
	await page.getByText('Style override', { exact: true }).nth(0).click()
	await expect(page.getByRole('textbox', { name: 'strokeColor', exact: true }).nth(0)).toHaveValue(
		'#225577',
	)
	await expect(page.getByRole('combobox', { name: 'arrowEnd', exact: true }).nth(0)).toHaveValue(
		'false',
	)
	expect((await retainedAtlas(page))?.presentation).toEqual(saved?.presentation)
	expect(await sourceContents(page, addresses)).toEqual(originalContents)
	expect([...publications.values()]).toEqual([])
})
