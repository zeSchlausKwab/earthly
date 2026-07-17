import { describe, expect, test } from 'bun:test'
import {
	canUploadToPublicBlossom,
	publishChannelMatchesDatasetScope,
	resolveAuthoringDestination,
	resolveAuthoringPublishChannel,
} from './authoringDestination'

describe('resolveAuthoringDestination', () => {
	test('represents neutral public authoring as unattached', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'public',
			canLeave: false,
		})

		expect(destination).toMatchObject({
			kind: 'public-unattached',
			publishChannel: 'public',
			label: 'Public · Unattached',
			availability: 'available',
			canLeave: false,
			target: null,
			contextAttachment: null,
		})
	})

	test('keeps a public context attachment distinct from its public channel', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'public',
			context: {
				id: '31990:pubkey:roman-ruins',
				label: 'Roman ruins in Carinthia',
				availability: 'available',
			},
			canLeave: true,
		})
		if (destination.kind !== 'public-context') throw new Error('Expected a context destination')

		expect(destination).toMatchObject({
			kind: 'public-context',
			publishChannel: 'public',
			label: 'Public · Roman ruins in Carinthia',
			availability: 'available',
			canLeave: true,
		})
		expect(destination.contextAttachment.id).toBe('31990:pubkey:roman-ruins')
	})

	test('keeps a saved private draft private after navigating to a public route', () => {
		expect(
			resolveAuthoringPublishChannel(
				{ kind: 'private-group', id: 'alpine-rescue' },
				{ kind: 'public' },
			),
		).toEqual({ kind: 'private-group', id: 'alpine-rescue' })
	})

	test('uses the route channel before a local draft exists', () => {
		expect(
			resolveAuthoringPublishChannel(undefined, {
				kind: 'field-session',
				id: 'saturday-survey',
			}),
		).toEqual({ kind: 'field-session', id: 'saturday-survey' })
	})

	test('keeps an unclassified legacy draft visibly blocked', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'unresolved',
			reason: 'legacy',
			canLeave: true,
		})

		expect(destination).toMatchObject({
			kind: 'unresolved',
			publishChannel: 'unresolved',
			label: 'Destination needed · Legacy draft',
			availability: 'unavailable',
			canLeave: true,
		})
	})

	test('offers public Blossom overflow only to public drafts', () => {
		expect(canUploadToPublicBlossom({ kind: 'public' })).toBe(true)
		expect(canUploadToPublicBlossom({ kind: 'private-group', id: 'group' })).toBe(false)
		expect(canUploadToPublicBlossom({ kind: 'field-session', id: 'session' })).toBe(false)
		expect(canUploadToPublicBlossom({ kind: 'unresolved', reason: 'legacy' })).toBe(false)
	})

	test('requires both coordinate and transport scope when restoring a dataset source', () => {
		expect(
			publishChannelMatchesDatasetScope(
				{ kind: 'private-group', id: 'group-a' },
				{ privateGroupId: 'group-a' },
			),
		).toBe(true)
		expect(
			publishChannelMatchesDatasetScope(
				{ kind: 'private-group', id: 'group-a' },
				{ privateGroupId: 'group-b' },
			),
		).toBe(false)
		expect(publishChannelMatchesDatasetScope({ kind: 'field-session', id: 'field-a' }, {})).toBe(
			false,
		)
		expect(
			publishChannelMatchesDatasetScope({ kind: 'public' }, { fieldSessionId: 'field-a' }),
		).toBe(false)
	})

	test('preserves a route-known private group when its metadata is unavailable', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'private-group',
			group: {
				id: 'private-group-route-id',
				availability: 'unavailable',
			},
			canLeave: true,
		})
		if (destination.kind !== 'private-group') throw new Error('Expected a private destination')

		expect(destination).toMatchObject({
			kind: 'private-group',
			publishChannel: 'private-group',
			label: 'Private · Unavailable',
			accessibleLabel: 'Private · Unavailable, unavailable',
			availability: 'unavailable',
		})
		expect(destination.target.id).toBe('private-group-route-id')
	})

	test('uses the last known label while retaining unavailable state', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'field-session',
			session: {
				id: 'field-session-route-id',
				label: 'Alps survey',
				availability: 'unavailable',
			},
			canLeave: true,
		})
		if (destination.kind !== 'field-session') throw new Error('Expected a nearby destination')

		expect(destination.label).toBe('Nearby · Alps survey')
		expect(destination.accessibleLabel).toBe('Nearby · Alps survey, unavailable')
		expect(destination.target.id).toBe('field-session-route-id')
	})

	test('renders an available Field session with the Nearby label', () => {
		const destination = resolveAuthoringDestination({
			publishChannel: 'field-session',
			session: {
				id: 'field-session-id',
				label: 'Trail crew',
				availability: 'available',
			},
			canLeave: false,
		})

		expect(destination).toMatchObject({
			kind: 'field-session',
			publishChannel: 'field-session',
			label: 'Nearby · Trail crew',
			availability: 'available',
			canLeave: false,
			contextAttachment: null,
		})
	})
})
