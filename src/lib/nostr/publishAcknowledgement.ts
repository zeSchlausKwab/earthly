/** A resolved pool request is not necessarily an accepted publication. */
export function requirePublishAcknowledgement(
	responses: ReadonlyArray<{ ok: boolean; from: string; message?: string }>,
): void {
	if (responses.some((response) => response.ok)) return
	const reasons = [
		...new Set(responses.map((response) => response.message?.trim()).filter(Boolean)),
	]
	const detail = reasons.join('; ').replace(/\s+/gu, ' ').slice(0, 220)
	throw new Error(
		`No relay accepted this publication${detail ? `: ${detail}` : '. Check your connection and write relays'}`,
	)
}
