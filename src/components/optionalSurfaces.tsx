import { deferredSurface } from './deferredSurface.tsx'

export const GeoEditorInfoPanelContent = deferredSurface(async () => ({default:(await import('./GeoEditorInfoPanel')).GeoEditorInfoPanelContent}), 'inspector')
export const MapSettingsPanel = deferredSurface(async () => ({default:(await import('@/features/geo-editor/components/MapSettingsPanel')).MapSettingsPanel}), 'settings')
export const Nip60Wallet = deferredSurface(async () => ({default:(await import('@/features/wallet/components/Nip60Wallet')).Nip60Wallet}), 'wallet')
export const PrivateGroupsPanel = deferredSurface(async () => ({default:(await import('@/features/private-maps/PrivateMapsDialog')).PrivateGroupsPanel}), 'Circles')
export const FieldSessionsPanel = deferredSurface(async () => ({default:(await import('@/features/field-sessions/FieldSessionsPanel')).FieldSessionsPanel}), 'Nearby')
export const UserProfilePanel = deferredSurface(async () => ({default:(await import('./UserProfilePanel')).UserProfilePanel}), 'profile')
export const ShoutboxPanel = deferredSurface(async () => ({default:(await import('@/features/social/shoutbox/ShoutboxPanel')).ShoutboxPanel}), 'community')
