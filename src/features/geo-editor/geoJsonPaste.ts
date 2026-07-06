export function getGeoJsonPasteCandidate(text: string | null | undefined): string | null {
	const trimmed = text?.trim()
	if (!trimmed) return null
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
	return trimmed
}
