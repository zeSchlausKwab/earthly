const MAX_ERROR_DETAIL = 220

/** Mobile users do not have a developer console. Keep the actionable native or
 * signing error in the editor while making it clear that retrying is safe. */
export function publishFailureMessage(action: string, error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error)
	const detail = raw.replace(/\s+/gu, ' ').trim().slice(0, MAX_ERROR_DETAIL)
	return `Could not ${action}${detail ? `: ${detail}` : ''}. Tap Publish to retry; your draft is unchanged.`
}
