import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PublishDropdown } from './PublishDropdown'

describe('Publication follows the draft intent', () => {
	test('an empty or unresolved proposal keeps its disabled Send action and cannot expose audience selection', () => {
		const html = renderToStaticMarkup(
			<PublishDropdown
				authoringIntent="propose"
				canProposeEdit={false}
				audienceOptions={[
					{ id: 'circle', label: 'Circle', publishChannel: { kind: 'private-group', id: 'scope' } },
				]}
				onAudienceChange={() => {}}
			/>,
		)
		expect(html).toContain('Send proposal')
		expect(html).toContain('disabled')
		expect(html).not.toContain('Audience')
		expect(html).not.toContain('aria-haspopup="menu"')
	})
	test('proposal presents Send proposal, never an audience or fork decision', () => {
		const html = renderToStaticMarkup(
			<PublishDropdown
				canProposeEdit
				audienceOptions={[{ id: 'public', label: 'Everyone', publishChannel: { kind: 'public' } }]}
				onAudienceChange={() => {}}
			/>,
		)
		expect(html).toContain('Send proposal')
		expect(html).not.toContain('Fork / Propose')
		expect(html).not.toContain('Audience')
		expect(html).not.toContain('aria-haspopup="menu"')
	})
	test('fork presents Publish map without a second proposal choice', () => {
		const html = renderToStaticMarkup(<PublishDropdown canPublishCopy />)
		expect(html).toContain('Publish map')
		expect(html).not.toContain('Fork / Propose')
		expect(html).not.toContain('Propose edit')
	})
	test('existing own Map still offers Update', () => {
		expect(renderToStaticMarkup(<PublishDropdown canPublishUpdate canPublishCopy />)).toContain(
			'Update',
		)
	})
})
