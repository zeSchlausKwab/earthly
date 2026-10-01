/** Builds signed local fixture events only; no relay or HTTP connection is made. */
import { nip19 } from 'nostr-tools'
import { buildWw1StoryFixture } from '../../scripts/fixtures/ww1-story.ts'
import { ArticleFactory } from '@/lib/nostr/article'
import { devIdentities } from '@/lib/seeder/identities'
import { stringifyStoryViewMarkdownBlock } from '@/lib/map-presentation'

const fixture = await buildWw1StoryFixture()
const identifier = 'ai-suite-reader-context-budget'
const title = 'Long Story with twelve inline map views'
const views = Array.from({ length: 12 }, (_, index) => ({
	version: 1,
	type: 'view',
	id: `reader-budget-${index}`,
	title: `Reading step ${index + 1}`,
	display: 'both',
	caption: 'Synthetic regional map used to verify reader resource lifetime.',
	camera: { center: [3 + index * 0.12, 49.5 + index * 0.03], zoom: 6.2 + (index % 3) * 0.2, bearing: index * 2, pitch: 0 },
}))
// Enough ordinary prose separates figures beyond the preloading window on both viewports.
const paragraph = 'This synthetic reading passage separates the inline maps so the reader can scroll through a long document. The regional geometry is a styling fixture rather than a historical claim. Each map has its own authored camera, and returning to an earlier chapter must restore that view while the main map continues to render. Resource use should depend on the visible passage, even when the document contains many chapters and the reader moves backward through them.'
const markdown = views.map(view => [
	`## ${view.title}`,
	stringifyStoryViewMarkdownBlock(view),
	...Array.from({ length: 8 }, () => paragraph),
].join('\n\n')).join('\n\n')
const event = await ArticleFactory.create({ title, summary: 'Local reader context-budget regression fixture.', content: markdown })
	.modifyPublicTags(tags => [...tags.filter(([key]) => key !== 'd'), ['d', identifier]])
	.referencedAddresses(Object.values(fixture.maps).map(map => map.address))
	.mapPresentation(fixture.presentation)
	.sign(devIdentities().owner.signer)
console.log(JSON.stringify({
	events: [...Object.values(fixture.maps).map(map => map.event), event],
	title,
	views,
	path: '/read/' + nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier }),
}))
