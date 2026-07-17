import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CurrentDestinationPill } from './CurrentDestinationPill'
import { resolveAuthoringDestination } from './authoringDestination'

describe('CurrentDestinationPill', () => {
	test('renders a compact public destination without an exit action', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'public',
			canLeave: false,
		})
		const html = renderToStaticMarkup(<CurrentDestinationPill destination={destination} />)

		expect(html).toContain('Public')
		expect(html).toContain('Unattached')
		expect(html).toContain('data-destination-kind="public-unattached"')
		expect(html).toContain('data-publish-channel="public"')
		expect(html).not.toContain('Leave destination:')
	})

	test('renders separate accessible activate and leave buttons', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'private-group',
			group: { id: 'group-id', label: 'Hello Map', availability: 'available' },
			canLeave: true,
		})
		const html = renderToStaticMarkup(
			<CurrentDestinationPill destination={destination} onActivate={() => {}} onLeave={() => {}} />,
		)

		expect(html).toContain('aria-label="Open destination: Private · Hello Map"')
		expect(html).toContain('aria-label="Leave destination: Private · Hello Map"')
		expect(html.match(/<button/g)).toHaveLength(2)
	})

	test('does not render an exit button when the resolved model cannot be left', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'field-session',
			session: { id: 'session-id', label: 'Trail crew', availability: 'available' },
			canLeave: false,
		})
		const html = renderToStaticMarkup(
			<CurrentDestinationPill destination={destination} onLeave={() => {}} />,
		)

		expect(html).not.toContain('Leave destination:')
		expect(html).not.toContain('<button')
	})

	test('keeps a route-known unavailable destination visible and announced', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'private-group',
			group: { id: 'missing-group', availability: 'unavailable' },
			canLeave: true,
		})
		const html = renderToStaticMarkup(
			<CurrentDestinationPill destination={destination} onLeave={() => {}} />,
		)

		expect(html).toContain('Private')
		expect(html).toContain('Unavailable')
		expect(html).toContain('data-availability="unavailable"')
		expect(html).toContain('aria-label="Current destination: Private · Unavailable, unavailable"')
		expect(html).toContain('aria-label="Leave destination: Private · Unavailable"')
	})

	test('exposes the mobile presentation variant without changing semantics', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'public',
			context: { id: 'context-id', label: 'Roman ruins', availability: 'available' },
			canLeave: true,
		})
		const html = renderToStaticMarkup(
			<CurrentDestinationPill destination={destination} variant="mobile" onLeave={() => {}} />,
		)

		expect(html).toContain('data-variant="mobile"')
		expect(html).toContain('Public')
		expect(html).not.toContain('Public context')
		expect(html).toContain('Roman ruins')
		expect(html).toContain('min-h-9')
	})

	test('announces quarantined legacy drafts without suggesting a public destination', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'unresolved',
			reason: 'legacy',
			canLeave: true,
		})
		const html = renderToStaticMarkup(
			<CurrentDestinationPill destination={destination} onLeave={() => {}} />,
		)

		expect(html).toContain('Destination needed')
		expect(html).toContain('Legacy draft')
		expect(html).toContain('data-publish-channel="unresolved"')
		expect(html).not.toContain('Public')
	})
})
