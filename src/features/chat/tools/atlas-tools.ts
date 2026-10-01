/** Atlas authoring shares the same reviewed local persistence path as Stories. */
import type { ToolEntry } from './registry'
import type { Tool, ToolJsonSchema } from './types'
import { storyPresentationSchema } from './story-presentation'

export const atlasPresentationSchema: ToolJsonSchema = structuredClone(storyPresentationSchema)
atlasPresentationSchema.description =
	'Optional complete default MapPresentationV1 for this Atlas: ordered Map layers and opening camera. Each layer source must be a Map in curatedReferences. Omit to preserve existing or future data; use {version:1,layers:[]} to clear default layers. Atlases use curatedReferences for source authorization.'
const atlasLayerProperties = atlasPresentationSchema.properties?.layers?.items?.properties
if (atlasLayerProperties?.source)
	atlasLayerProperties.source.description =
		'A Map from this Atlas’s curatedReferences: exact published 37515:<64-hex-pubkey>:<d-tag> coordinate, or {kind:"local-map",workspaceId:"exact-workspace-id"} matching an earthly-draft reference. Local layers render in the draft without publishing.'
if (atlasLayerProperties?.featureIds)
	atlasLayerProperties.featureIds.description =
		'Exact feature ids within the curated Map. Omitted renders the whole source; [] renders no features. Curating a Story does not authorize its referenced Maps; curate every Map layer explicitly.'

export const readAtlasDraftSchema: Tool = {
	type: 'function',
	function: {
		name: 'read_atlas_draft',
		description:
			'Read an explicitly permitted local Atlas draft before editing. Includes its name, Markdown description, curated Map/Story references and default camera/layers, preserving governance and schema metadata.',
		parameters: {
			type: 'object',
			properties: {
				draftTarget: {
					type: 'string',
					description: 'Exact local Atlas draft key returned by list_local_drafts.',
				},
			},
			required: [],
		},
	},
}

export const writeAtlasDraftSchema: Tool = {
	type: 'function',
	function: {
		name: 'write_atlas_draft',
		description:
			'Create a distinct local Atlas or edit a permitted draft. Name and description, curated Map/Story references, cover and default presentation are editable; omitted fields preserve existing content, governance and schema. References must already be readable local drafts or attached published sources. This never publishes or automatically publishes a reference. Changes use the same review and Undo policy as Map/Story tools.',
		parameters: {
			type: 'object',
			properties: {
				draftTarget: {
					type: 'string',
					description:
						'Exact existing local Atlas draft key from list_local_drafts. Omit when createNew=true.',
				},
				createNew: {
					type: 'boolean',
					description: 'Create a separate Atlas draft when new-draft creation is permitted.',
				},
				name: {
					type: 'string',
					maxLength: 300,
					description: 'Atlas name; required when creating.',
				},
				description: {
					type: 'string',
					maxLength: 100_000,
					description: 'Markdown overview; omitted preserves the existing description.',
				},
				curatedReferences: {
					type: 'array',
					maxItems: 200,
					items: { type: 'string', maxLength: 2_000 },
					description:
						'Ordered whole-Map/Story references: published kind:pubkey:d-tag or nostr:naddr, earthly-draft:<workspace-id>, or earthly-story-draft:<encoded-draft-key>. Use exact references from the permitted source list; omit to preserve existing references.',
				},
				image: {
					type: 'string',
					maxLength: 2_000,
					description: 'Optional cover-image URL; empty removes it.',
				},
				presentation: atlasPresentationSchema,
			},
			required: [],
		},
	},
}

export function registerAtlasTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'read_atlas_draft',
		kind: 'host-builtin',
		schema: readAtlasDraftSchema,
		handler: async (args, context) => {
			if (!context?.documentAuthoring)
				throw new Error(
					'Attach an Atlas as a working target or enable new local drafts before authoring an Atlas.',
				)
			const { readDocumentDraft } = await import('./document-authoring')
			return readDocumentDraft('atlas', args, context.documentAuthoring)
		},
	})
	register({
		name: 'write_atlas_draft',
		kind: 'host-builtin',
		schema: writeAtlasDraftSchema,
		handler: async (args, context) => {
			if (!context?.documentAuthoring)
				throw new Error(
					'Attach an Atlas as a working target or enable new local drafts before authoring an Atlas.',
				)
			const { writeDocumentDraft } = await import('./document-authoring')
			return writeDocumentDraft('atlas', args, context.documentAuthoring)
		},
	})
}
