export const OG_IMAGE_RENDER_VERSION = 'v3'

const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/u
const VERSION_PATTERN = /^([0-9a-f]{64})-(v\d+)$/u

export function createOGImageVersion(eventId: string | null | undefined): string | null {
	return eventId && EVENT_ID_PATTERN.test(eventId) ? `${eventId}-${OG_IMAGE_RENDER_VERSION}` : null
}

export function parseOGImageVersion(
	value: string | null | undefined,
): { eventId: string; rendererVersion: string } | null {
	if (!value) return null
	const match = value.match(VERSION_PATTERN)
	if (!match?.[1] || !match[2]) return null
	return { eventId: match[1], rendererVersion: match[2] }
}
