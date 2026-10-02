import { test, expect } from '../fixtures/earthly'
import type { NostrEvent } from 'nostr-tools'
import { documentRebaseFixture, newerStoryFixture } from '../fixtures/webmcp-rebase'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { discoverWebMcpTools, executeWebMcpTool, setDesktopAgentSafety } from '../tasks/chat/webmcp'

interface RebaseField {
	field: string
	base: unknown
	local: unknown
	remote: unknown
	status: 'unchanged' | 'local-only' | 'remote-only' | 'conflict'
}

test.use({ launchOptions: { args: ['--enable-features=WebMCP'] } })

test('native observed Story receipt requires explicit rebase before preparing a newer publication and Undo restores its guard @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(earthly.isMobile, 'One desktop case verifies the private receipt/rebase factory hook.')
	test.setTimeout(120_000)
	const fixture = documentRebaseFixture('story')
	const events = new Map([[fixture.original.id, fixture.original]])
	const attempts: NostrEvent[] = []
	await installIsolatedRelays(earthly, events, {
		acknowledgeEvent: (event) => event.kind !== 37520,
		onPublish: (event) => attempts.push(event),
	})
	await authorizeJourneyIdentity(earthly, 'owner')
	await installDeterministicMapStyle(earthly)
	await setDesktopAgentSafety(earthly, 'Apply with Undo')
	const original = await executeWebMcpTool(earthly, 'earthly_read_entity', {
		reference: fixture.reference,
	})
	const entry = await executeWebMcpTool(earthly, 'earthly_edit_entity', {
		reference: fixture.reference,
		revisionId: original.revisionId,
		intent: 'edit',
	})
	expect(entry, JSON.stringify(entry)).toMatchObject({ ok: true, kind: 'story' })
	const draftTarget = String(entry.draftKey)
	const readDraft = () => executeWebMcpTool(earthly, 'earthly_read_story_draft', { draftTarget })
	const initial = await readDraft()
	expect(
		await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
			draftTarget,
			draftToken: initial.draftToken,
			title: 'Story awaiting delivery',
			markdown: 'Reviewed publication narrative.',
		}),
	).toMatchObject({ ok: true })
	const prepared = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
		target: { kind: 'story', draftKey: draftTarget },
	})
	expect(prepared, JSON.stringify(prepared)).toMatchObject({ ok: true, mode: 'update' })
	const uncertain = await executeWebMcpTool(earthly, 'earthly_publish_publication', {
		previewToken: prepared.previewToken,
		confirm: true,
	})
	expect(uncertain, JSON.stringify(uncertain)).toMatchObject({
		ok: false,
		sideEffectsApplied: true,
		receipts: [{ delivery: 'unknown', coordinate: fixture.reference }],
	})
	const receipt = (uncertain.receipts as Array<{ eventId: string }>)[0]
	const delivered = receipt ? events.get(receipt.eventId) : undefined
	if (!delivered) throw new Error('The isolated relay did not retain the signed Story.')
	expect(delivered.sig).toMatch(/^[0-9a-f]{128}$/)
	const afterUnknown = await readDraft()
	expect(
		await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
			draftTarget,
			draftToken: afterUnknown.draftToken,
			title: 'Local recovery Story title',
			markdown: 'My later local narrative.',
		}),
	).toMatchObject({ ok: true })
	const dirty = await readDraft()
	const beforeDraft = dirty.draft as { publication: { eventId: string } }
	expect([fixture.original.id, delivered.id]).toContain(beforeDraft.publication.eventId)
	const remote = newerStoryFixture(delivered, {
		title: 'Remote recovery Story title',
		summary: 'Remote recovery summary',
	})
	events.set(remote.id, remote)
	const attemptsBeforeRecovery = attempts.length
	// Read configured relays while keeping the uncertain receipt in this runtime.
	const latest = await executeWebMcpTool(earthly, 'earthly_read_entity', {
		reference: fixture.reference,
		refresh: true,
	})
	expect(latest, JSON.stringify(latest)).toMatchObject({ ok: true, revisionId: remote.id })
	const observed = await executeWebMcpTool(earthly, 'earthly_reconcile_publication', {
		previewToken: prepared.previewToken,
	})
	expect(observed, JSON.stringify(observed)).toMatchObject({
		ok: true,
		publicationComplete: true,
		recoveryBlocked: true,
		signedOrSent: false,
		receipts: [{ delivery: 'unknown', observation: { status: 'verified' } }],
		recoveries: [{ status: 'stale_source' }],
	})
	expect((await readDraft()).draft).toEqual(beforeDraft)
	expect(
		await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
			target: { kind: 'story', draftKey: draftTarget },
		}),
	).toMatchObject({ ok: false, sideEffectsApplied: false })
	expect(attempts).toHaveLength(attemptsBeforeRecovery)
	const retained = await readDraft()
	const preview = await executeWebMcpTool(earthly, 'earthly_prepare_document_rebase', {
		kind: 'story',
		draftTarget,
		draftToken: retained.draftToken,
		sourceRevisionId: latest.revisionId,
	})
	expect(preview, JSON.stringify(preview)).toMatchObject({
		ok: true,
		baseRevisionId: beforeDraft.publication.eventId,
		latestRevisionId: remote.id,
		conflicts: expect.arrayContaining(['title']),
	})
	const mergedTitle = 'Explicitly recovered Story'
	const resolutions: Record<string, { choice: 'local' | 'remote' | 'merged'; value?: unknown }> = {
		title: { choice: 'merged', value: mergedTitle },
	}
	for (const field of (preview.fields as RebaseField[]).filter(
		(field) => field.status === 'conflict',
	)) {
		if (field.field !== 'title')
			resolutions[field.field] = { choice: field.field === 'summary' ? 'remote' : 'local' }
	}
	const applied = await executeWebMcpTool(earthly, 'earthly_apply_document_rebase', {
		rebaseToken: preview.rebaseToken,
		confirm: true,
		resolutions,
	})
	expect(applied, JSON.stringify(applied)).toMatchObject({
		ok: true,
		status: 'rebased',
		sourceRevisionId: remote.id,
	})
	expect((await readDraft()).draft).toMatchObject({
		title: mergedTitle,
		markdown: 'My later local narrative.',
		summary: 'Remote recovery summary',
		publication: { eventId: remote.id },
	})
	const fresh = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
		target: { kind: 'story', draftKey: draftTarget },
	})
	expect(fresh, JSON.stringify(fresh)).toMatchObject({
		ok: true,
		mode: 'update',
		baseEventId: remote.id,
		sideEffectsApplied: false,
	})
	expect(
		await executeWebMcpTool(earthly, 'earthly_reconcile_publication', {
			previewToken: prepared.previewToken,
		}),
	).toMatchObject({ publicationComplete: true, recoveryBlocked: false, signedOrSent: false })
	expect(attempts).toHaveLength(attemptsBeforeRecovery)
	const activity = earthly.page.getByRole('complementary', {
		name: 'Desktop agent activity',
		exact: true,
	})
	if (!(await activity.isVisible()))
		await earthly.page.getByRole('button', { name: 'Desktop agent', exact: true }).click()
	await activity
		.getByLabel('Story draft changes', { exact: true })
		.filter({ hasText: `${mergedTitle} · applied` })
		.last()
		.getByRole('button', { name: 'Undo desktop agent edit', exact: true })
		.click()
	expect((await readDraft()).draft).toEqual(beforeDraft)
	expect(
		await executeWebMcpTool(earthly, 'earthly_reconcile_publication', {
			previewToken: prepared.previewToken,
		}),
	).toMatchObject({ publicationComplete: true, recoveryBlocked: true, signedOrSent: false })
	expect(
		await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
			target: { kind: 'story', draftKey: draftTarget },
		}),
	).toMatchObject({ ok: false, sideEffectsApplied: false })
	expect(attempts).toHaveLength(attemptsBeforeRecovery)
	await testInfo.attach('receipt-rebase-contract.json', {
		body: JSON.stringify({ uncertain, observed, preview, applied, fresh }, null, 2),
		contentType: 'application/json',
	})
})

for (const kind of ['story', 'atlas'] as const) {
	test(`native ${kind} rebase explicitly merges dirty edits against a newer publication and Undo restores the old base @editor-contract`, async ({
		earthly,
	}, testInfo) => {
		test.setTimeout(120_000)
		const fixture = documentRebaseFixture(kind)
		const events = new Map([[fixture.original.id, fixture.original]])
		const publications = await installIsolatedRelays(earthly, events)
		const contentPublications = () =>
			[...publications].filter(([, eventKind]) => [37515, 37518, 37520].includes(eventKind))
		await authorizeJourneyIdentity(earthly, 'owner')
		await installDeterministicMapStyle(earthly)
		await setDesktopAgentSafety(earthly, 'Apply with Undo')
		await expect
			.poll(async () => (await discoverWebMcpTools(earthly)).map((tool) => tool.name))
			.toContain('earthly_prepare_document_rebase')
		const original = await executeWebMcpTool(earthly, 'earthly_read_entity', {
			reference: fixture.reference,
		})
		expect(original, JSON.stringify(original)).toMatchObject({
			ok: true,
			revisionId: fixture.original.id,
		})
		const entry = await executeWebMcpTool(earthly, 'earthly_edit_entity', {
			reference: fixture.reference,
			revisionId: original.revisionId,
			intent: 'edit',
		})
		expect(entry, JSON.stringify(entry)).toMatchObject({
			ok: true,
			kind,
			sourceRevisionId: fixture.original.id,
		})
		const draftTarget = String(entry.draftKey)
		const readTool = `earthly_read_${kind}_draft`
		const read = await executeWebMcpTool(earthly, readTool, { draftTarget })
		const local =
			kind === 'story'
				? { title: 'Local Story title', markdown: 'Local-only Story narrative' }
				: { name: 'Local Atlas name', description: 'Local-only Atlas description' }
		const write = await executeWebMcpTool(earthly, `earthly_write_${kind}_draft`, {
			draftTarget,
			draftToken: read.draftToken,
			...local,
		})
		expect(write, JSON.stringify(write)).toMatchObject({ ok: true })
		expect((await executeWebMcpTool(earthly, readTool, { draftTarget })).draft).toMatchObject(local)
		expect(contentPublications()).toEqual([])

		// The remote device published a newer revision. Reload deliberately discards
		// the page's fetch cache while retaining the browser's dirty local edit slot.
		events.set(fixture.remote.id, fixture.remote)
		await earthly.page.reload({ waitUntil: 'domcontentloaded' })
		await expect
			.poll(async () => (await discoverWebMcpTools(earthly)).map((tool) => tool.name))
			.toContain('earthly_prepare_document_rebase')
		const latest = await executeWebMcpTool(earthly, 'earthly_read_entity', {
			reference: fixture.reference,
		})
		expect(latest, JSON.stringify(latest)).toMatchObject({
			ok: true,
			revisionId: fixture.remote.id,
		})
		const retained = await executeWebMcpTool(earthly, readTool, { draftTarget })
		expect(retained.draft).toMatchObject(local)
		const beforeDraft = retained.draft as Record<string, unknown>
		if (kind === 'story')
			expect(beforeDraft.publication).toMatchObject({ eventId: fixture.original.id })
		else expect(beforeDraft.sourceRevisionId).toBe(fixture.original.id)
		const stalePublication = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
			target: { kind, draftKey: draftTarget },
		})
		expect(stalePublication, JSON.stringify(stalePublication)).toMatchObject({
			ok: false,
			sideEffectsApplied: false,
		})
		const preview = await executeWebMcpTool(earthly, 'earthly_prepare_document_rebase', {
			kind,
			draftTarget,
			draftToken: retained.draftToken,
			sourceRevisionId: latest.revisionId,
		})
		expect(preview, JSON.stringify(preview)).toMatchObject({
			ok: true,
			baseRevisionId: fixture.original.id,
			latestRevisionId: fixture.remote.id,
		})
		const fields = preview.fields as RebaseField[]
		const titleField = kind === 'story' ? 'title' : 'name'
		expect(preview.conflicts).toContain(titleField)
		expect(fields.find((field) => field.field === titleField)).toMatchObject({
			local: local[titleField],
			remote: kind === 'story' ? 'Remote Story title' : 'Remote Atlas name',
			status: 'conflict',
		})
		if (preview.baseAvailable)
			expect(fields.find((field) => field.field === titleField)?.base).toBe(
				kind === 'story' ? 'Original Story title' : 'Original Atlas name',
			)
		expect((await executeWebMcpTool(earthly, readTool, { draftTarget })).draft).toEqual(beforeDraft)
		const mergedTitle =
			kind === 'story' ? 'Local and remote Story title' : 'Local and remote Atlas name'
		const resolutions: Record<string, { choice: 'local' | 'remote' | 'merged'; value?: unknown }> =
			{
				[titleField]: { choice: 'merged', value: mergedTitle },
			}
		// When the historical public event was evicted, no automatic merge is safe:
		// resolve every remaining conflict explicitly using its complete field snapshot.
		for (const field of fields.filter((field) => field.status === 'conflict')) {
			if (field.field === titleField) continue
			resolutions[field.field] = {
				choice:
					kind === 'story'
						? field.field === 'summary'
							? 'remote'
							: 'local'
						: field.field === 'policy'
							? 'remote'
							: 'local',
			}
		}
		expect(
			await executeWebMcpTool(earthly, 'earthly_apply_document_rebase', {
				rebaseToken: preview.rebaseToken,
				confirm: false,
				resolutions,
			}),
		).toMatchObject({ ok: false, sideEffectsApplied: false })
		expect(
			await executeWebMcpTool(earthly, 'earthly_apply_document_rebase', {
				rebaseToken: preview.rebaseToken,
				confirm: true,
				resolutions: {},
			}),
		).toMatchObject({ ok: false, sideEffectsApplied: false })
		expect((await executeWebMcpTool(earthly, readTool, { draftTarget })).draft).toEqual(beforeDraft)
		const applied = await executeWebMcpTool(earthly, 'earthly_apply_document_rebase', {
			rebaseToken: preview.rebaseToken,
			confirm: true,
			resolutions,
		})
		expect(applied, JSON.stringify(applied)).toMatchObject({
			ok: true,
			status: 'rebased',
			sourceRevisionId: fixture.remote.id,
		})
		const after = await executeWebMcpTool(earthly, readTool, { draftTarget })
		expect(after.draft).toMatchObject(
			kind === 'story'
				? {
						title: mergedTitle,
						markdown: 'Local-only Story narrative',
						summary: 'Remote-only Story summary',
						publication: { eventId: fixture.remote.id },
					}
				: {
						name: mergedTitle,
						description: 'Local-only Atlas description',
						governance: 'closed',
						sourceRevisionId: fixture.remote.id,
					},
		)
		expect(contentPublications()).toEqual([])
		const publication = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
			target: { kind, draftKey: draftTarget },
		})
		expect(publication, JSON.stringify(publication)).toMatchObject({
			ok: true,
			mode: 'update',
			baseEventId: fixture.remote.id,
			sideEffectsApplied: false,
		})
		expect(contentPublications()).toEqual([])
		const activity = earthly.page.getByRole('complementary', {
			name: 'Desktop agent activity',
			exact: true,
		})
		if (!(await activity.isVisible()))
			await earthly.page.getByRole('button', { name: 'Desktop agent', exact: true }).click()
		const review = activity
			.getByLabel(kind === 'story' ? 'Story draft changes' : 'Atlas draft changes', { exact: true })
			.filter({ hasText: `${mergedTitle} · applied` })
			.last()
		await review.getByRole('button', { name: 'Undo desktop agent edit', exact: true }).click()
		const undone = await executeWebMcpTool(earthly, readTool, { draftTarget })
		expect(undone.draft).toEqual(beforeDraft)
		expect(contentPublications()).toEqual([])
		await testInfo.attach('rebase-contract.json', {
			body: JSON.stringify({ kind, preview, applied, publication }, null, 2),
			contentType: 'application/json',
		})
	})
}
