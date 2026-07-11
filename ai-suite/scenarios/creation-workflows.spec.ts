import { test, expect } from '../fixtures/earthly'
import { signIn } from '../tasks/auth/sign-in'
import { createContext } from '../tasks/create/context'
import { createAndPublishGeometryDataset, createGeometryDraft } from '../tasks/create/geometry'
import { createAndPublishStory } from '../tasks/create/story'
import { monitorBrowserHealth } from '../tasks/diagnostics/browser-health'
import { seedDatasetProposal, seedStoryProposal } from '../tasks/setup/story-proposal'
import {
	postAnnotatedComment,
	postComment,
	replyToComment,
	setCommentAnnotationsVisible,
} from '../tasks/social/comments'
import {
	acceptDatasetProposal,
	openDatasetProposal,
	previewDatasetProposal,
	proposeDatasetEdit,
	rejectDatasetProposal,
	requestDatasetProposalChanges,
} from '../tasks/social/dataset-proposals'
import {
	acceptStoryEdit,
	draftStoryProposal,
	rejectStoryEdit,
	requestStoryEditChanges,
} from '../tasks/social/story-proposals'

test('point, line, polygon, and label creation remain understandable @workflow-audit', async ({
	earthly,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== 'desktop',
		'Authoring audit begins with the full desktop tools',
	)
	const health = monitorBrowserHealth(earthly.page)
	await earthly.open({ tour: 'seen' })
	const result = await createGeometryDraft(earthly)
	expect(result.featureCount).toBe(4)
	expect(result.geometryTypes).toEqual(['Point', 'LineString', 'Polygon', 'Point'])
	expect(result.annotationText).toBe('AI suite map label')
	console.log(`AI_WORKFLOW_GEOMETRY:${JSON.stringify(result)}`)
	health.stop()
	expect(health.snapshot().pageErrors).toEqual([])
	await testInfo.attach('geometry-creation.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})
})

test('a Story owner can accept and reject proposed edits @workflow-audit', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'Story proposal audit is desktop-only')
	const runId = Date.now().toString(36)
	const originalBody = `Original proposal audit narrative ${runId}`
	const acceptedBody = `Accepted proposal audit narrative ${runId}`
	const rejectedBody = `Rejected proposal audit narrative ${runId}`
	const changesBody = `Changes-requested proposal audit narrative ${runId}`
	await signIn(earthly, 'owner')
	const story = await createAndPublishStory(earthly, {
		title: `Proposal audit story ${runId}`,
		body: originalBody,
	})

	await seedStoryProposal(earthly, story.url, acceptedBody)
	await acceptStoryEdit(earthly, acceptedBody)

	await seedStoryProposal(earthly, story.url, changesBody)
	await requestStoryEditChanges(earthly, `Please tighten the intro ${runId}`)

	await seedStoryProposal(earthly, story.url, rejectedBody)
	await rejectStoryEdit(earthly)
	await expect(earthly.page.getByText(acceptedBody, { exact: true }).first()).toBeVisible()
	await expect(earthly.page.getByText(rejectedBody, { exact: true })).toBeHidden()
	await testInfo.attach('story-proposal-review.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})
})

test('a reader can type a proposed Story edit without a runtime failure @workflow-audit', async ({
	earthly,
	newEarthlySession,
}, testInfo) => {
	// FIXED: prosemirror-model is deduped to a single version via the package.json
	// override — typing in the proposal editor no longer mixes Fragment classes.
	test.skip(testInfo.project.name !== 'desktop', 'Multi-persona proposal audit is desktop-only')
	const runId = Date.now().toString(36)
	await signIn(earthly, 'owner')
	const story = await createAndPublishStory(earthly, {
		title: `Proposal composer audit ${runId}`,
		body: `Original proposal composer narrative ${runId}`,
	})

	const contributor = await newEarthlySession()
	const health = monitorBrowserHealth(contributor.page)
	await signIn(contributor, 'mara')
	await draftStoryProposal(contributor, story.url, `Edited proposal narrative ${runId}`)
	await testInfo.attach('story-proposal-composer.png', {
		body: await contributor.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})
	health.stop()
	expect(health.snapshot().pageErrors).toEqual([])
	await expect(contributor.page.locator('bun-hmr')).toBeHidden()
})

test('a Dataset owner can preview, request changes, reject, and accept proposals @workflow-audit', async ({
	earthly,
	newEarthlySession,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'Dataset proposal audit is desktop-only')
	const runId = Date.now().toString(36)
	await signIn(earthly, 'owner')
	const dataset = await createAndPublishGeometryDataset(earthly, `Proposal dataset ${runId}`)

	const changesDescription = `Needs-review Dataset proposal ${runId}`
	const changeReason = `Keep the point but explain its source ${runId}`
	const contributor = await newEarthlySession()
	await signIn(contributor, 'mara')
	await proposeDatasetEdit(contributor, dataset.url, changesDescription)
	await openDatasetProposal(earthly, changesDescription)
	await previewDatasetProposal(earthly)
	await requestDatasetProposalChanges(earthly, changeReason)

	const rejectedDescription = `Rejected Dataset proposal ${runId}`
	await seedDatasetProposal(earthly, dataset.url, rejectedDescription)
	await openDatasetProposal(earthly, rejectedDescription)
	await rejectDatasetProposal(earthly)

	const acceptedDescription = `Accepted Dataset proposal ${runId}`
	await seedDatasetProposal(earthly, dataset.url, acceptedDescription)
	await openDatasetProposal(earthly, acceptedDescription)
	await acceptDatasetProposal(earthly)
	await earthly.page.getByRole('tab', { name: 'Details', exact: true }).click()
	await expect(earthly.page.getByText('Features (1)', { exact: true })).toBeVisible()
	await testInfo.attach('dataset-proposal-decisions.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})
})

test('an author can comment, reply, and attach a map annotation @workflow-audit', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'Local NIP-07 persona login is desktop-only')
	const runId = Date.now().toString(36)
	const rootComment = `Root workflow comment ${runId}`
	const reply = `Threaded workflow reply ${runId}`
	const annotatedComment = `Annotated workflow comment ${runId}`
	const health = monitorBrowserHealth(earthly.page)
	await signIn(earthly, 'owner')
	await createAndPublishStory(earthly, {
		title: `Comment audit story ${runId}`,
		body: 'A local Story used to audit comments and map annotations.',
	})
	await postComment(earthly, rootComment)
	await replyToComment(earthly, rootComment, reply)
	await postAnnotatedComment(earthly, {
		comment: annotatedComment,
		label: `Annotation ${runId}`,
	})
	await expect(earthly.page.getByRole('button', { name: 'Hide annotations' })).toBeVisible()
	await setCommentAnnotationsVisible(earthly, false)
	await setCommentAnnotationsVisible(earthly, true)
	health.stop()
	expect(health.snapshot().pageErrors).toEqual([])
	await testInfo.attach('comments-and-annotation.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})
})

test('a signed-in author can create a Context and publish a Story @workflow-audit', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'Local NIP-07 persona login is desktop-only')
	const runId = Date.now().toString(36)
	const health = monitorBrowserHealth(earthly.page)
	await signIn(earthly, 'owner')
	await createContext(earthly, {
		name: `AI audit context ${runId}`,
		description: 'A local-only Context created while auditing the complete authoring workflow.',
	})
	await testInfo.attach('context-created.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})
	await createAndPublishStory(earthly, {
		title: `AI audit story ${runId}`,
		summary: 'Local-only workflow audit story.',
		body: 'This Story verifies creation, publishing, and the reader transition.',
	})
	health.stop()
	expect(health.snapshot().pageErrors).toEqual([])
	await testInfo.attach('story-created.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})
})
