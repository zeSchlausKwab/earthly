/**
 * Private, in-process metadata carried from a read tool handler to the
 * `toEditor` authoring boundary. A symbol keeps legal/source documents out of
 * model-visible tool results while still allowing them to be persisted once at
 * FeatureCollection level.
 */
const EDITOR_DATASET_METADATA = Symbol('earthly.editorDatasetMetadata')

export interface EditorDatasetMetadata {
	properties: Record<string, string | number | boolean>
}

export function attachEditorDatasetMetadata<T extends object>(
	result: T,
	metadata: EditorDatasetMetadata,
): T {
	Object.defineProperty(result, EDITOR_DATASET_METADATA, {
		value: structuredClone(metadata),
		enumerable: false,
		configurable: false,
		writable: false,
	})
	return result
}

export function getEditorDatasetMetadata(value: unknown): EditorDatasetMetadata | null {
	if (!value || typeof value !== 'object') return null
	const metadata = (value as { [EDITOR_DATASET_METADATA]?: unknown })[EDITOR_DATASET_METADATA]
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
	const properties = (metadata as { properties?: unknown }).properties
	if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null
	const primitiveProperties: Record<string, string | number | boolean> = {}
	for (const [key, value] of Object.entries(properties)) {
		if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
			return null
		}
		primitiveProperties[key] = value
	}
	return { properties: primitiveProperties }
}
