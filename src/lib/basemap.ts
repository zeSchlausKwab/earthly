/**
 * Basemap (OpenFreeMap) style preference.
 *
 * The map is central to Earthly's look, so its basemap follows the app theme
 * by default (`auto`: Positron in light, Dark in dark) but can be pinned to a
 * specific OpenFreeMap style regardless of theme via the Map settings dropdown.
 *
 * Only applies to the `default` map source; blossom/pmtiles sources build their
 * own style. Preference persists to localStorage and syncs across consumers,
 * mirroring `@/lib/theme`.
 */
import { useEffect, useState } from 'react'

export type BasemapStyleId = 'auto' | 'positron' | 'bright' | 'liberty' | 'dark' | 'fiord'

export const BASEMAP_STYLE_STORAGE_KEY = 'earthly-basemap-style'

/** Ordered list for the settings dropdown. */
export const BASEMAP_STYLE_OPTIONS: { id: BasemapStyleId; label: string; hint?: string }[] = [
	{ id: 'auto', label: 'Auto', hint: 'Match theme' },
	{ id: 'positron', label: 'Positron', hint: 'Light' },
	{ id: 'bright', label: 'Bright', hint: 'Light' },
	{ id: 'liberty', label: 'Liberty', hint: 'Light' },
	{ id: 'dark', label: 'Dark', hint: 'Dark' },
	{ id: 'fiord', label: 'Fiord', hint: 'Dark' },
]

const OPENFREEMAP_BASE = 'https://tiles.openfreemap.org/styles'

export function basemapStyleUrl(id: Exclude<BasemapStyleId, 'auto'>): string {
	return `${OPENFREEMAP_BASE}/${id}`
}

/**
 * Resolve a preference into the `{ light, dark }` pair the map component reads.
 * `auto` maps light→Positron, dark→Dark; a pinned style uses the same URL for
 * both theme slots so it stays put when the theme flips.
 */
export function resolveBasemapStyles(pref: BasemapStyleId): { light: string; dark: string } {
	if (pref === 'auto') {
		return { light: basemapStyleUrl('positron'), dark: basemapStyleUrl('dark') }
	}
	const url = basemapStyleUrl(pref)
	return { light: url, dark: url }
}

const listeners = new Set<(id: BasemapStyleId) => void>()

function isValid(value: string | null): value is BasemapStyleId {
	return (
		value === 'auto' ||
		value === 'positron' ||
		value === 'bright' ||
		value === 'liberty' ||
		value === 'dark' ||
		value === 'fiord'
	)
}

export function getBasemapStyle(): BasemapStyleId {
	try {
		const stored = localStorage.getItem(BASEMAP_STYLE_STORAGE_KEY)
		if (isValid(stored)) return stored
	} catch {
		// ignore
	}
	return 'auto'
}

export function setBasemapStyle(id: BasemapStyleId): void {
	try {
		localStorage.setItem(BASEMAP_STYLE_STORAGE_KEY, id)
	} catch {
		// ignore
	}
	for (const listener of listeners) listener(id)
}

/** React hook: `[basemapStyle, setBasemapStyle]`, synced across consumers. */
export function useBasemapStyle(): [BasemapStyleId, (id: BasemapStyleId) => void] {
	const [id, setId] = useState<BasemapStyleId>(getBasemapStyle)
	useEffect(() => {
		const listener = (next: BasemapStyleId) => setId(next)
		listeners.add(listener)
		setId(getBasemapStyle())
		return () => {
			listeners.delete(listener)
		}
	}, [])
	return [id, setBasemapStyle]
}
