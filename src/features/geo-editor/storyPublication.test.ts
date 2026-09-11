import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readStoryDraft, writeStoryDraft, storyContentFingerprint } from '@/lib/nostr/story/draft'
import { canPublishSavedStory, savedStoryHasChanges } from './storyPublication'
import { coordinateToNaddrReference } from '@/lib/nostr/references'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import {
	getStoryPublicationApproval,
	requestStoryPublicationApproval,
	answerStoryPublicationApproval,
} from '@/features/chat/referencePublishing/storyPublicationApproval'
const previousWindow = globalThis.window
const owner = 'a'.repeat(64)
const reference = coordinateToNaddrReference(`${ARTICLE_KIND}:${owner}:published-story`)!
const target = {
	kind: 'story' as const,
	draftKey: 'published-story',
	title: 'Story',
	storyReference: reference,
}
beforeEach(() => {
	const storage = new Map<string, string>()
	Object.assign(globalThis, {
		window: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key),
			},
		},
	})
})
afterEach(() => {
	if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
	else Object.assign(globalThis, { window: previousWindow })
})
test('Story changes retain the publication baseline across normal form and AI writes', () => {
	const draft = { title: 'Story', content: 'One', updatedAt: 1 }
	writeStoryDraft(target.draftKey, {
		...draft,
		publication: { reference, eventId: 'signed', fingerprint: storyContentFingerprint(draft) },
	})
	expect(savedStoryHasChanges(target)).toBe(false)
	writeStoryDraft(target.draftKey, { ...draft, content: 'Two', updatedAt: 2 })
	expect(savedStoryHasChanges(target)).toBe(true)
	expect(readStoryDraft(target.draftKey)!.publication!.reference).toBe(reference)
	writeStoryDraft(target.draftKey, { ...draft, bodyTab: 'preview', updatedAt: 3 })
	expect(savedStoryHasChanges(target)).toBe(false)
	expect(canPublishSavedStory(target, owner)).toBe(true)
	expect(canPublishSavedStory(target, 'b'.repeat(64))).toBe(false)
})
test('Story and all dependent maps receive one explicit approval; dismissal does not approve', async () => {
	const approval = requestStoryPublicationApproval('Story', ['1914', '1916'])
	const request = getStoryPublicationApproval()!
	expect(request.maps).toEqual(['1914', '1916'])
	answerStoryPublicationApproval(request.id + 1, true)
	expect(getStoryPublicationApproval()).toBe(request)
	answerStoryPublicationApproval(request.id, false)
	expect(await approval).toBe(false)
	expect(getStoryPublicationApproval()).toBeNull()
})
