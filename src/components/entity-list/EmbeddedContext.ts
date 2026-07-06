import { createContext } from 'react'

/**
 * True when a ListPanel is rendered INSIDE the mobile bottom sheet, whose header
 * is already the §14a panel switcher. Embedded panels drop their own title row
 * (glyph · title · count · + new) so the sheet doesn't show two headers; the
 * search/sort toolbar and body still render.
 */
export const EmbeddedListPanelContext = createContext(false)
