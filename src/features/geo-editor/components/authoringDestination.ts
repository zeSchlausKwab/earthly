import type { PublishChannel } from '../store/types'

export type AuthoringPublishChannel = 'public' | 'private-group' | 'field-session' | 'unresolved'

export type DestinationAvailability = 'available' | 'unavailable'

/**
 * A route-known destination reference. `availability` describes whether its
 * metadata is currently resolved; the stable id keeps an unavailable route
 * from being mistaken for an unattached public destination.
 */
export interface AuthoringDestinationTarget {
	id: string
	label?: string | null
	availability: DestinationAvailability
}

export type AuthoringDestinationInput =
	| {
			publishChannel: 'public'
			context?: AuthoringDestinationTarget | null
			canLeave: boolean
	  }
	| {
			publishChannel: 'private-group'
			group: AuthoringDestinationTarget
			canLeave: boolean
	  }
	| {
			publishChannel: 'field-session'
			session: AuthoringDestinationTarget
			canLeave: boolean
	  }
	| {
			publishChannel: 'unresolved'
			reason: 'legacy' | 'invalid'
			canLeave: boolean
	  }

interface ResolvedDestinationBase {
	publishChannel: AuthoringPublishChannel
	channelLabel: string
	detailLabel: string
	label: string
	accessibleLabel: string
	availability: DestinationAvailability
	canLeave: boolean
}

export type ResolvedAuthoringDestination =
	| (ResolvedDestinationBase & {
			kind: 'public-unattached'
			publishChannel: 'public'
			target: null
			contextAttachment: null
	  })
	| (ResolvedDestinationBase & {
			kind: 'public-context'
			publishChannel: 'public'
			target: AuthoringDestinationTarget
			contextAttachment: AuthoringDestinationTarget
	  })
	| (ResolvedDestinationBase & {
			kind: 'private-group'
			publishChannel: 'private-group'
			target: AuthoringDestinationTarget
			contextAttachment: null
	  })
	| (ResolvedDestinationBase & {
			kind: 'field-session'
			publishChannel: 'field-session'
			target: AuthoringDestinationTarget
			contextAttachment: null
	  })
	| (ResolvedDestinationBase & {
			kind: 'unresolved'
			publishChannel: 'unresolved'
			target: null
			contextAttachment: null
	  })

function targetLabel(target: AuthoringDestinationTarget, availableFallback: string): string {
	const label = target.label?.trim()
	if (label) return label
	return target.availability === 'unavailable' ? 'Unavailable' : availableFallback
}

function accessibleLabel(label: string, availability: DestinationAvailability): string {
	return availability === 'unavailable' ? `${label}, unavailable` : label
}

/**
 * A persisted draft destination is authoritative. The route is only a default
 * for authoring that has not created a local draft yet.
 */
export function resolveAuthoringPublishChannel(
	draftChannel: PublishChannel | null | undefined,
	routeChannel: PublishChannel,
): PublishChannel {
	return draftChannel ?? routeChannel
}

/** Public Blossom storage is never an implicit overflow path for encrypted or nearby work. */
export function canUploadToPublicBlossom(channel: PublishChannel): boolean {
	return channel.kind === 'public'
}

/** A coordinate match is insufficient when public and scoped datasets share an address. */
export function publishChannelMatchesDatasetScope(
	channel: PublishChannel,
	scope: { privateGroupId?: string; fieldSessionId?: string },
): boolean {
	if (channel.kind === 'private-group') return scope.privateGroupId === channel.id
	if (channel.kind === 'field-session') return scope.fieldSessionId === channel.id
	if (channel.kind === 'unresolved') return false
	return !scope.privateGroupId && !scope.fieldSessionId
}

/**
 * Resolves the actual authoring destination into presentation-ready state.
 *
 * The discriminated input intentionally makes a public context attachment
 * possible only for the public channel. Private groups and Field sessions are
 * publish channels of their own, not context filters layered over public
 * publishing.
 */
export function resolveAuthoringDestination(
	input: AuthoringDestinationInput,
): ResolvedAuthoringDestination {
	if (input.publishChannel === 'public') {
		if (!input.context) {
			const label = 'Public · Unattached'
			return {
				kind: 'public-unattached',
				publishChannel: 'public',
				channelLabel: 'Public',
				detailLabel: 'Unattached',
				label,
				accessibleLabel: label,
				availability: 'available',
				canLeave: input.canLeave,
				target: null,
				contextAttachment: null,
			}
		}

		const detailLabel = targetLabel(input.context, 'Unnamed context')
		const label = `Public · ${detailLabel}`
		return {
			kind: 'public-context',
			publishChannel: 'public',
			channelLabel: 'Public',
			detailLabel,
			label,
			accessibleLabel: accessibleLabel(label, input.context.availability),
			availability: input.context.availability,
			canLeave: input.canLeave,
			target: input.context,
			contextAttachment: input.context,
		}
	}

	if (input.publishChannel === 'private-group') {
		const detailLabel = targetLabel(input.group, 'Private group')
		const label = `Private · ${detailLabel}`
		return {
			kind: 'private-group',
			publishChannel: 'private-group',
			channelLabel: 'Private',
			detailLabel,
			label,
			accessibleLabel: accessibleLabel(label, input.group.availability),
			availability: input.group.availability,
			canLeave: input.canLeave,
			target: input.group,
			contextAttachment: null,
		}
	}

	if (input.publishChannel === 'unresolved') {
		const detailLabel = input.reason === 'legacy' ? 'Legacy draft' : 'Invalid saved destination'
		const label = `Destination needed · ${detailLabel}`
		return {
			kind: 'unresolved',
			publishChannel: 'unresolved',
			channelLabel: 'Destination needed',
			detailLabel,
			label,
			accessibleLabel: `${label}, publishing blocked`,
			availability: 'unavailable',
			canLeave: input.canLeave,
			target: null,
			contextAttachment: null,
		}
	}

	const detailLabel = targetLabel(input.session, 'Field session')
	const label = `Nearby · ${detailLabel}`
	return {
		kind: 'field-session',
		publishChannel: 'field-session',
		channelLabel: 'Nearby',
		detailLabel,
		label,
		accessibleLabel: accessibleLabel(label, input.session.availability),
		availability: input.session.availability,
		canLeave: input.canLeave,
		target: input.session,
		contextAttachment: null,
	}
}
