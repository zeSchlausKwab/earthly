export {
	GeoEditorMap,
	type GeoEditorMapProps,
	type GeoEditorLocate,
} from './GeoEditorMap'
export type { MapSource, AnnouncementRecord } from './types'
// Re-export mapcn's useMap so existing consumers keep the same import path
// pattern. Identity-stable since both contexts expose `{ map, isLoaded }`.
export { useMap } from '@/components/ui/map'
