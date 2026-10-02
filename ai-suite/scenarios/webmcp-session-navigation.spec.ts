import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, nip19 } from 'nostr-tools'
import type { EarthlySession } from '../core/session'
import { expect, test } from '../fixtures/earthly'
import { testIdentities } from '../test-identities'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { discoverWebMcpTools, setDesktopAgentAccess } from '../tasks/chat/webmcp'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

test.use({ launchOptions: { args: ['--enable-features=WebMCP'] } })

interface CachedNativeSession {
	context: {
		executeTool(tool: { name: string }, input: string | Record<string, unknown>): Promise<string>
	}
	tools: Array<{ name: string }>
	stringify: boolean
}

// Intentionally retain the original native descriptors: rediscovery after navigation
// would conceal the registration and source-grant regression this scenario protects.
async function callOriginalRegistration(
	earthly: EarthlySession,
	name: string,
	input: Record<string, unknown> = {},
) {
	return earthly.page.evaluate(
		async ({ name, input }) => {
			const session = (window as unknown as { __webMcpSession: CachedNativeSession })
				.__webMcpSession
			const tool = session.tools.find((item) => item.name === name)
			if (!tool) throw new Error(`Original WebMCP registration unavailable: ${name}`)
			return JSON.parse(
				await session.context.executeTool(tool, session.stringify ? JSON.stringify(input) : input),
			) as Record<string, unknown>
		},
		{ name, input },
	)
}

test('WebMCP registrations and source grants survive editor–Reader navigation; access renewal still expires them', async ({
	earthly,
}) => {
	test.setTimeout(90_000)
	const timestamp = Math.floor(Date.now() / 1000) - 100
	const secret = hexToBytes(testIdentities.owner.secretKeyHex)
	const map = finalizeEvent(
		{
			kind: 37515,
			created_at: timestamp,
			tags: [['d', 'webmcp-navigation-map']],
			content: JSON.stringify({
				modelVersion: 'earthly/2',
				type: 'FeatureCollection',
				name: 'WebMCP navigation source',
				features: [
					{
						type: 'Feature',
						id: 'meeting-point',
						geometry: { type: 'Point', coordinates: [16, 48] },
						properties: { name: 'Meeting point' },
					},
				],
			}),
		},
		secret,
	)
	const mapReference = `37515:${map.pubkey}:webmcp-navigation-map`
	const title = 'WebMCP navigation Story'
	const story = finalizeEvent(
		{
			kind: 37520,
			created_at: timestamp,
			tags: [
				['d', 'webmcp-navigation-story'],
				['a', mapReference],
			],
			content: JSON.stringify({
				modelVersion: 'earthly/2',
				title,
				content: `A source retained across views: ${mapReference}`,
			}),
		},
		secret,
	)
	const naddr = nip19.naddrEncode({
		kind: story.kind,
		pubkey: story.pubkey,
		identifier: 'webmcp-navigation-story',
	})
	const storyReference = `37520:${story.pubkey}:webmcp-navigation-story`
	const events = new Map([map, story].map((event) => [event.id, event]))
	await installIsolatedRelays(earthly, events)
	await earthly.page.addInitScript(() => {
		localStorage.setItem(
			'earthly-webmcp-preferences',
			JSON.stringify({
				enabled: false,
				externalQueriesEnabled: true,
			}),
		)
	})
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.open({ path: `/story/${naddr}` })
	await installDeterministicMapStyle(earthly)
	await expect(
		earthly.page.getByRole('heading', { name: title, exact: true, level: 2 }),
	).toBeVisible()
	expect(await discoverWebMcpTools(earthly)).toEqual([])
	await setDesktopAgentAccess(earthly, true)
	await earthly.page.goBack()
	await expect(earthly.page.getByRole('button', { name: 'Read', exact: true })).toBeVisible()
	await expect.poll(async () => (await discoverWebMcpTools(earthly)).length).toBeGreaterThan(0)
	const version = Number(earthly.page.context().browser()?.version().split('.')[0])
	await earthly.page.evaluate(async (stringify) => {
		const context = (
			document as unknown as {
				modelContext: CachedNativeSession['context'] & {
					getTools(): Promise<Array<{ name: string }>>
				}
			}
		).modelContext
		;(window as unknown as { __webMcpSession: CachedNativeSession }).__webMcpSession = {
			context,
			tools: await context.getTools(),
			stringify,
		}
	}, version < 155)
	expect(
		await callOriginalRegistration(earthly, 'earthly_read_entity', { reference: mapReference }),
	).toMatchObject({ ok: true, revisionId: map.id })
	expect(
		await callOriginalRegistration(earthly, 'earthly_read_entity', { reference: storyReference }),
	).toMatchObject({ ok: true, revisionId: story.id })
	const before = await callOriginalRegistration(earthly, 'earthly_list_local_drafts')
	expect(before).toMatchObject({ ok: true, creationToken: expect.any(String) })
	expect(before.sources).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ reference: mapReference, revisionId: map.id }),
		]),
	)
	const retainedStory = await callOriginalRegistration(earthly, 'earthly_write_story_draft', {
		createNew: true,
		creationToken: before.creationToken,
		title: 'Retained WebMCP navigation draft',
		markdown: 'An unpublished local Story.',
	})
	expect(retainedStory).toMatchObject({ ok: true, draftKey: expect.any(String) })
	const beforeReader = await callOriginalRegistration(earthly, 'earthly_list_local_drafts')

	await earthly.page.getByRole('button', { name: 'Read', exact: true }).click()
	await expect(
		earthly.page.getByRole('heading', { name: title, exact: true, level: 1 }),
	).toBeVisible()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(`/read/${naddr}`)
	const reader = await callOriginalRegistration(earthly, 'earthly_list_local_drafts')
	expect(reader.creationToken).toBe(before.creationToken)
	expect(reader.sources).toEqual(beforeReader.sources)
	expect(reader.drafts).toEqual(beforeReader.drafts)
	expect(await callOriginalRegistration(earthly, 'earthly_get_map')).toMatchObject({
		ok: false,
		code: 'map_required',
	})
	expect(
		await callOriginalRegistration(earthly, 'earthly_create_map_draft', {
			title: 'Unavailable Reader Map',
			audience: 'public',
		}),
	).toMatchObject({ ok: false, code: 'map_required', sideEffectsApplied: false })
	expect(
		await callOriginalRegistration(earthly, 'earthly_preview_story_draft', {
			draftTarget: retainedStory.draftKey,
			draftToken: retainedStory.draftToken,
		}),
	).toMatchObject({ ok: false, code: 'editor_required', sideEffectsApplied: false })
	expect(new URL(earthly.page.url()).pathname).toBe(`/read/${naddr}`)
	expect(
		await callOriginalRegistration(earthly, 'earthly_edit_entity', {
			reference: storyReference,
			revisionId: story.id,
			intent: 'edit',
		}),
	).toMatchObject({ ok: false, code: 'editor_required', sideEffectsApplied: false })
	const afterRefusedMap = await callOriginalRegistration(earthly, 'earthly_list_local_drafts')
	expect(afterRefusedMap.drafts).toEqual(reader.drafts)

	const closeActivity = earthly.page.getByRole('button', {
		name: 'Close desktop agent activity',
		exact: true,
	})
	if (await closeActivity.isVisible()) await closeActivity.click()
	await earthly.page.getByRole('button', { name: 'Edit Story', exact: true }).click()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(`/story/${naddr}/edit`)
	const back = await callOriginalRegistration(earthly, 'earthly_list_local_drafts')
	expect(back.creationToken).toBe(before.creationToken)
	expect(back.sources).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ reference: mapReference, revisionId: map.id }),
		]),
	)

	await setDesktopAgentAccess(earthly, false)
	await expect.poll(() => discoverWebMcpTools(earthly)).toEqual([])
	await expect(callOriginalRegistration(earthly, 'earthly_list_local_drafts')).rejects.toThrow()
	await setDesktopAgentAccess(earthly, true)
	const renewed = await earthly.page.evaluate(async (stringify) => {
		const context = (
			document as unknown as {
				modelContext: CachedNativeSession['context'] & {
					getTools(): Promise<Array<{ name: string }>>
				}
			}
		).modelContext
		const tool = (await context.getTools()).find(
			(item) => item.name === 'earthly_list_local_drafts',
		)
		if (!tool) throw new Error('Renewed WebMCP registration unavailable')
		return JSON.parse(await context.executeTool(tool, stringify ? '{}' : {})) as Record<
			string,
			unknown
		>
	}, version < 155)
	expect(renewed.creationToken).not.toBe(before.creationToken)
	expect(renewed.sources).not.toEqual(
		expect.arrayContaining([
			expect.objectContaining({ reference: mapReference, revisionId: map.id }),
		]),
	)
})
