import { deferredSurface } from '../deferredSurface.tsx'
export type { GeoFeatureItem, GeoRichTextEditorProps, GeoRichTextEditorRef } from './GeoRichTextEditor'

/** Plain map browsing does not need Tiptap. Refs still reach the mounted editor. */
export const GeoRichTextEditor = deferredSurface(async () => ({ default: (await import('./GeoRichTextEditor')).GeoRichTextEditor }), 'text editor')
