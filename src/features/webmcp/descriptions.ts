import type { ToolJsonSchema } from '@/features/chat/tools/types'
import { BROWSER_EDITOR_TOOLS, BROWSER_EXTERNAL_TOOLS } from './catalog'

const toolNames = [
	...BROWSER_EDITOR_TOOLS,
	...BROWSER_EXTERNAL_TOOLS,
	'get_map',
	'read_features',
	'list_local_drafts',
	'read_story_draft',
	'write_story_draft',
	'read_atlas_draft',
	'write_atlas_draft',
]
const toolReference = new RegExp(`\\b(${toolNames.join('|')})\\b`, 'g')

/** Shared handlers/schemas keep their semantics; browser guidance names the native contract. */
export function browserDescription(description: string): string {
	return description
		.replace(
			'Cite published Maps inline as bare nostr:naddr1… references.',
			'Cite published Maps inline using source.citeReference from earthly_list_local_drafts as bare nostr:naddr1… references.',
		)
		.replace(
			'Preserve feature-only fragments returned by read_entity',
			'Preserve existing feature-only fragments',
		)
		.replace(/\bget_editor_state\b/g, 'earthly_get_map')
		.replace(/\bget_working_set or create_map_draft\b/g, 'earthly_list_local_drafts')
		.replace(/\b(get_working_set|read_entity)\b/g, 'earthly_list_local_drafts')
		.replace(/\blocalReference\b/g, 'source.reference')
		.replace(/\bworkingTarget\b/g, 'draftTarget')
		.replace(' or spinning up run_code for a single number', '')
		.replace(
			'building the same route with sandbox pathfinder or hand-authored coordinates',
			'hand-authoring approximate route coordinates',
		)
		.replace('prefer valhalla_route.', 'enable External queries and use earthly_valhalla_route.')
		.replace(toolReference, (_, name: string) => `earthly_${name}`)
}

/** Rewrites description fields only, including nested presentation schemas, without touching validation. */
export function browserSchema<T extends ToolJsonSchema>(schema: T): T {
	const copy = structuredClone(schema)
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			value.forEach(visit)
		} else if (value && typeof value === 'object') {
			const node = value as Record<string, unknown>
			if (typeof node.description === 'string')
				node.description = browserDescription(node.description)
			for (const key of [
				'properties',
				'patternProperties',
				'$defs',
				'definitions',
				'dependentSchemas',
			]) {
				const children = node[key]
				if (children && typeof children === 'object') Object.values(children).forEach(visit)
			}
			for (const key of [
				'items',
				'prefixItems',
				'additionalProperties',
				'anyOf',
				'oneOf',
				'allOf',
				'not',
				'if',
				'then',
				'else',
				'contains',
				'propertyNames',
			])
				visit(node[key])
		}
	}
	visit(copy)
	return copy
}
