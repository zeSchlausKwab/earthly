import { useEffect, useState } from 'react'

export interface SatelliteSettings {
	enabled: boolean
	mode: 'satellite' | 'combined'
	opacity: number
	osmOverlay: boolean
}

export const SATELLITE_STORAGE_KEY = 'earthly-satellite-settings'
export const DEFAULT_SATELLITE_SETTINGS: SatelliteSettings = {
	enabled: false,
	mode: 'combined',
	opacity: 0.75,
	osmOverlay: true,
}

/** The 2016 edition is CC BY 4.0; newer editions restrict commercial use. */
export const EOX_SATELLITE_TILES =
	'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'
export const EOX_SATELLITE_ATTRIBUTION =
	'<a href="https://cloudless.eox.at">EOxCloudless</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016 &amp; 2017) · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · <a href="https://maps.eox.at">EOX::Maps</a>'

export function normalizeSatelliteSettings(value: unknown): SatelliteSettings {
	const settings = value && typeof value === 'object' ? value : {}
	return {
		enabled: 'enabled' in settings && settings.enabled === true,
		mode: 'mode' in settings && settings.mode === 'satellite' ? 'satellite' : 'combined',
		opacity:
			'opacity' in settings &&
			typeof settings.opacity === 'number' &&
			Number.isFinite(settings.opacity)
				? Math.max(0, Math.min(1, settings.opacity))
				: DEFAULT_SATELLITE_SETTINGS.opacity,
		osmOverlay: !('osmOverlay' in settings) || settings.osmOverlay !== false,
	}
}

export type MapBackground = 'osm' | 'satellite' | 'combined'

export function getMapBackground(settings: SatelliteSettings): MapBackground {
	return settings.enabled ? settings.mode : 'osm'
}

/** Preserve the custom blend while the user visits the OSM or satellite presets. */
export function setMapBackground(mode: MapBackground): void {
	setSatelliteSettings(mode === 'osm' ? { enabled: false } : { enabled: true, mode })
}

export function resolveSatelliteComposition(settings: SatelliteSettings): SatelliteSettings {
	return settings.mode === 'satellite' ? { ...settings, opacity: 1, osmOverlay: false } : settings
}

// Also retain preferences in memory when browser storage is unavailable.
let fallbackSettings = DEFAULT_SATELLITE_SETTINGS
const listeners = new Set<(settings: SatelliteSettings) => void>()

export function getSatelliteSettings(): SatelliteSettings {
	try {
		const stored = localStorage.getItem(SATELLITE_STORAGE_KEY)
		if (stored) return normalizeSatelliteSettings(JSON.parse(stored))
	} catch {
		// Private mode, disabled storage, or an invalid saved value.
	}
	return fallbackSettings
}

export function setSatelliteSettings(patch: Partial<SatelliteSettings>): void {
	const settings = normalizeSatelliteSettings({ ...getSatelliteSettings(), ...patch })
	fallbackSettings = settings
	try {
		localStorage.setItem(SATELLITE_STORAGE_KEY, JSON.stringify(settings))
	} catch {
		// The map and every settings surface still update in this session.
	}
	for (const listener of listeners) listener(settings)
}

export function useSatelliteSettings(): [
	SatelliteSettings,
	(patch: Partial<SatelliteSettings>) => void,
] {
	const [settings, setSettings] = useState(getSatelliteSettings)
	useEffect(() => {
		listeners.add(setSettings)
		setSettings(getSatelliteSettings())
		return () => {
			listeners.delete(setSettings)
		}
	}, [])
	return [settings, setSatelliteSettings]
}
