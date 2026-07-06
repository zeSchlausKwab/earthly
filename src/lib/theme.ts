/**
 * Lightweight theme controller for the "dense instrument" design system.
 *
 * The app has no `next-themes` provider; the active theme is simply the
 * `light` / `dark` class on `<html>`. Dark is the default working theme
 * (Studio); light is warm paper for light contexts. The preference persists
 * to localStorage and is applied pre-render by an inline script in
 * `src/index.html` to avoid a flash of the wrong theme.
 *
 * `src/components/ui/map.tsx` and the map basemap style both observe the
 * document class, so flipping the theme here re-themes the whole app plus the
 * map (see `resolveThemedMapStyle`).
 */
import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'earthly-theme'

const listeners = new Set<(mode: ThemeMode) => void>()

/** Current theme read straight from the document class (source of truth). */
export function getTheme(): ThemeMode {
	if (typeof document === 'undefined') return 'dark'
	return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

/** Apply a theme to the document, persist it, and notify subscribers. */
export function setTheme(mode: ThemeMode): void {
	if (typeof document !== 'undefined') {
		const el = document.documentElement
		el.classList.remove('light', 'dark')
		el.classList.add(mode)
	}
	try {
		localStorage.setItem(THEME_STORAGE_KEY, mode)
	} catch {
		// ignore (private mode / storage disabled)
	}
	for (const listener of listeners) listener(mode)
}

export function toggleTheme(): ThemeMode {
	const next: ThemeMode = getTheme() === 'dark' ? 'light' : 'dark'
	setTheme(next)
	return next
}

/**
 * React hook: `[mode, setTheme]`. Stays in sync across every consumer because
 * `setTheme` fans out to all subscribers.
 */
export function useTheme(): [ThemeMode, (mode: ThemeMode) => void] {
	const [mode, setMode] = useState<ThemeMode>(getTheme)
	useEffect(() => {
		const listener = (next: ThemeMode) => setMode(next)
		listeners.add(listener)
		// Re-sync in case the class changed between render and effect.
		setMode(getTheme())
		return () => {
			listeners.delete(listener)
		}
	}, [])
	return [mode, setTheme]
}
