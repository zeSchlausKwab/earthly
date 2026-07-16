import {
	assertPrivateMapInvitationCurrent,
	decodePrivateMapInvitation,
} from '@/lib/private-workspace'

export interface ParsedPrivateInviteLink {
	workspaceId: string
	invitation: string
}

/** Validate a scanned invite link before routing it into the local MLS workspace flow. */
export function parsePrivateInviteLink(
	value: string,
	nowMilliseconds = Date.now(),
): ParsedPrivateInviteLink {
	let url: URL
	try {
		url = new URL(value.trim())
	} catch {
		throw new Error('Scan an Earthly private-group invitation QR code')
	}

	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error('The private-group invitation must be an HTTP(S) link')
	}

	const segments = url.pathname.split('/').filter(Boolean)
	if (
		segments.length !== 2 ||
		(segments[0] !== 'privategroup' && segments[0] !== 'private-group')
	) {
		throw new Error('The QR code does not contain an Earthly private-group route')
	}

	const invitationValues = url.searchParams.getAll('private-invite')
	const invitation = invitationValues[0]
	if (invitationValues.length !== 1 || !invitation) {
		throw new Error('The private-group invitation token is missing')
	}

	const workspaceId = decodeURIComponent(segments[1] ?? '')
	const decoded = decodePrivateMapInvitation(invitation)
	assertPrivateMapInvitationCurrent(decoded, nowMilliseconds)
	if (decoded.workspaceId !== workspaceId) {
		throw new Error('The invitation does not match this private group')
	}

	return { workspaceId, invitation }
}
