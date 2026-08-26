import { toast } from 'sonner'
import { useActiveAccount } from 'applesauce-react/hooks'
import { castEvent } from 'applesauce-core/casts'
import { useEffect, useMemo, useRef, useState } from 'react'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { accounts, eventStore, publish } from '@/lib/nostr'
import {
	MAP_CONTEXT_GEOMETRY_TYPES,
	MapContext,
	MapContextFactory,
	type MapContextContent,
	type MapContextGeometryType,
} from '@/lib/nostr/map-context'
import {
	dedupeNostrAddressReferences,
	extractNostrAddressReferences,
	extractReferencedCoordinates,
	extractReferencedCoordinatesFromList,
	extractNostrAddressReferencesFromList,
	setAddressReferenceTags,
	stringifyNostrAddressReference,
} from '@/lib/nostr/references'
import {
	GeoRichTextEditor,
	type GeoFeatureItem,
	type GeoRichTextEditorRef,
} from '@/components/editor'
import { BlossomUploaderButton } from '@/components/blossom/BlossomUploaderButton'
import { EntitySearchPopover, type EntitySearchResult } from '@/components/entity-search'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
	EntityPanelSectionHeader,
	EntityPanelShell,
	EntityPanelSurface,
} from '@/components/info-panel/EntityPanelShell'
import { Checkbox } from '@radix-ui/react-checkbox'
import { captureVisibleDatasetReferenceTarget } from '@/features/chat/store'
import { ensureDatasetReferencePublished } from '@/features/chat/referencePublishing'

type SchemaFieldType = 'string' | 'number' | 'integer' | 'boolean'
type ContextEditorTab = 'content' | 'policy' | 'schema'

interface SchemaBuilderField {
	id: string
	key: string
	type: SchemaFieldType
	required: boolean
	min?: number
	max?: number
	minLength?: number
	maxLength?: number
}

interface MapContextEditorPanelProps {
	initialContext?: MapContext | null
	onClose: () => void
	onSave: (context: MapContext) => void
	availableFeatures?: GeoFeatureItem[]
	mapContextEvents?: MapContext[]
}

const ajv = new Ajv2020({
	allErrors: true,
	strict: false,
	validateSchema: true,
})
addFormats(ajv)

const DEFAULT_SCHEMA = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: true,
}

function createSchemaFieldId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}
	return `schema-field-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function schemaFromBuilder(fields: SchemaBuilderField[]) {
	const properties: Record<string, Record<string, unknown>> = {}
	const required: string[] = []

	fields.forEach((field) => {
		if (!field.key.trim()) return
		const definition: Record<string, unknown> = { type: field.type }
		if (field.required) {
			required.push(field.key)
		}
		if ((field.type === 'number' || field.type === 'integer') && typeof field.min === 'number') {
			definition.minimum = field.min
		}
		if ((field.type === 'number' || field.type === 'integer') && typeof field.max === 'number') {
			definition.maximum = field.max
		}
		if (field.type === 'string' && typeof field.minLength === 'number') {
			definition.minLength = field.minLength
		}
		if (field.type === 'string' && typeof field.maxLength === 'number') {
			definition.maxLength = field.maxLength
		}
		properties[field.key] = definition
	})

	return {
		type: 'object',
		properties,
		required,
		additionalProperties: true,
	}
}

function builderFromSchema(schema: unknown): SchemaBuilderField[] {
	if (!schema || typeof schema !== 'object') return []
	const maybe = schema as Record<string, unknown>
	const props = maybe.properties
	if (!props || typeof props !== 'object' || Array.isArray(props)) return []
	const requiredList = Array.isArray(maybe.required)
		? maybe.required.filter((entry): entry is string => typeof entry === 'string')
		: []

	return Object.entries(props).flatMap(([key, def]) => {
		if (!def || typeof def !== 'object') return []
		const asRecord = def as Record<string, unknown>
		const type = asRecord.type
		if (!['string', 'number', 'integer', 'boolean'].includes(String(type))) return []
		return [
			{
				id: createSchemaFieldId(),
				key,
				type: type as SchemaFieldType,
				required: requiredList.includes(key),
				min: typeof asRecord.minimum === 'number' ? asRecord.minimum : undefined,
				max: typeof asRecord.maximum === 'number' ? asRecord.maximum : undefined,
				minLength: typeof asRecord.minLength === 'number' ? asRecord.minLength : undefined,
				maxLength: typeof asRecord.maxLength === 'number' ? asRecord.maxLength : undefined,
			},
		]
	})
}

function hasExternalRef(schema: unknown): boolean {
	if (!schema || typeof schema !== 'object') return false
	if (Array.isArray(schema)) {
		return schema.some((value) => hasExternalRef(value))
	}
	const entries = Object.entries(schema as Record<string, unknown>)
	for (const [key, value] of entries) {
		if (key === '$ref' && typeof value === 'string') {
			if (!value.startsWith('#/')) return true
		}
		if (hasExternalRef(value)) return true
	}
	return false
}

function schemaHasValidationRules(schema: unknown): boolean {
	if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false
	const record = schema as Record<string, unknown>
	const properties =
		record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
			? (record.properties as Record<string, unknown>)
			: null
	const required = Array.isArray(record.required)
		? record.required.filter((entry): entry is string => typeof entry === 'string')
		: []

	if (properties && Object.keys(properties).length > 0) return true
	if (required.length > 0) return true

	const nonMetadataKeys = Object.keys(record).filter(
		(key) =>
			!['$schema', '$id', 'title', 'description', 'type', 'additionalProperties'].includes(key),
	)
	return nonMetadataKeys.length > 0
}

function buildSampleValue(field: SchemaBuilderField): unknown {
	if (field.type === 'boolean') {
		return true
	}

	if (field.type === 'string') {
		const minLength = Math.max(0, Math.floor(field.minLength ?? 0))
		const length = Math.max(1, Math.min(minLength, 32))
		return 'x'.repeat(length)
	}

	if (field.type === 'integer') {
		let value =
			typeof field.min === 'number'
				? Math.ceil(field.min)
				: typeof field.max === 'number' && field.max < 0
					? Math.floor(field.max)
					: 0
		if (typeof field.max === 'number' && value > field.max) {
			value = Math.floor(field.max)
		}
		return value
	}

	let value =
		typeof field.min === 'number'
			? field.min
			: typeof field.max === 'number' && field.max < 0
				? field.max
				: 0
	if (typeof field.max === 'number' && value > field.max) {
		value = field.max
	}
	return value
}

function samplePropertiesFromBuilder(fields: SchemaBuilderField[]): Record<string, unknown> {
	const entries = fields.filter((field) => field.key.trim().length > 0)
	const sample: Record<string, unknown> = {}

	entries
		.filter((field) => field.required)
		.forEach((field) => {
			sample[field.key] = buildSampleValue(field)
		})

	if (Object.keys(sample).length === 0 && entries.length > 0) {
		const first = entries[0]
		if (first) {
			sample[first.key] = buildSampleValue(first)
		}
	}

	return sample
}

function sampleJsonFromBuilder(fields: SchemaBuilderField[]): string {
	return JSON.stringify(samplePropertiesFromBuilder(fields), null, 2)
}

export function MapContextEditorPanel({
	initialContext,
	onClose,
	onSave,
	availableFeatures = [],
	mapContextEvents = [],
}: MapContextEditorPanelProps) {
	const currentUser = useActiveAccount()
	const initial = initialContext?.context
	const descriptionEditorRef = useRef<GeoRichTextEditorRef>(null)

	const [name, setName] = useState(initial?.name ?? '')
	const [description, setDescription] = useState(initial?.description ?? '')
	const [curatedReferences, setCuratedReferences] = useState<string[]>(initial?.references ?? [])
	const [image, setImage] = useState(initial?.image ?? '')
	const [contextUse, setContextUse] = useState<MapContextContent['contextUse']>(
		initial?.contextUse ?? 'taxonomy',
	)
	const [validationMode, setValidationMode] = useState<MapContextContent['validationMode']>(
		initial?.validationMode ?? 'none',
	)
	const [allowForeignAttachments, setAllowForeignAttachments] = useState(
		initial?.allowForeignAttachments ?? true,
	)
	const [attachedContextRefs, setAttachedContextRefs] = useState<string[]>(
		initialContext?.contextReferences ?? [],
	)
	const [activeTab, setActiveTab] = useState<ContextEditorTab>('content')
	const [schemaMode, setSchemaMode] = useState<'builder' | 'json'>('builder')
	const [allowedGeometryTypes, setAllowedGeometryTypes] = useState<MapContextGeometryType[]>(
		initial?.geometryConstraints?.allowedTypes ?? [],
	)
	const [fields, setFields] = useState<SchemaBuilderField[]>(() =>
		builderFromSchema(initial?.schema),
	)
	const [schemaJson, setSchemaJson] = useState(
		JSON.stringify(initial?.schema ?? DEFAULT_SCHEMA, null, 2),
	)
	const [samplePropertiesJson, setSamplePropertiesJson] = useState(() =>
		sampleJsonFromBuilder(builderFromSchema(initial?.schema)),
	)
	const [isSaving, setIsSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)

	const builderSchema = useMemo(() => schemaFromBuilder(fields), [fields])
	const suggestedBuilderSampleJson = useMemo(() => sampleJsonFromBuilder(fields), [fields])
	const effectiveSchemaJson =
		schemaMode === 'builder' ? JSON.stringify(builderSchema, null, 2) : schemaJson
	const referencedEntities = useMemo(() => {
		const availableFeatureMap = new Map<string, GeoFeatureItem>()
		availableFeatures.forEach((item) => {
			availableFeatureMap.set(`${item.address}#${item.featureId ?? ''}`, item)
			if (!item.featureId) {
				availableFeatureMap.set(item.address, item)
			}
		})

		return dedupeNostrAddressReferences(extractNostrAddressReferences(description)).map(
			(reference) => {
				const exactKey = `${reference.address}#${reference.featureId ?? ''}`
				const matched =
					availableFeatureMap.get(exactKey) ??
					(!reference.featureId ? availableFeatureMap.get(reference.address) : undefined)

				return {
					key: exactKey,
					address: reference.address,
					featureId: reference.featureId,
					name:
						matched?.name ??
						(reference.featureId
							? `${reference.address}#${reference.featureId}`
							: reference.address),
					entityType: matched?.entityType ?? 'feature',
					datasetName: matched?.datasetName,
				}
			},
		)
	}, [availableFeatures, description])
	const curatedReferenceEntities = useMemo(() => {
		const availableFeatureMap = new Map<string, GeoFeatureItem>()
		availableFeatures.forEach((item) => {
			availableFeatureMap.set(`${item.address}#${item.featureId ?? ''}`, item)
			if (!item.featureId) {
				availableFeatureMap.set(item.address, item)
			}
		})

		return dedupeNostrAddressReferences(
			extractNostrAddressReferencesFromList(curatedReferences),
		).map((reference) => {
			const exactKey = `${reference.address}#${reference.featureId ?? ''}`
			const matched =
				availableFeatureMap.get(exactKey) ??
				(!reference.featureId ? availableFeatureMap.get(reference.address) : undefined)

			return {
				key: exactKey,
				raw: stringifyNostrAddressReference(reference),
				address: reference.address,
				featureId: reference.featureId,
				name:
					matched?.name ??
					(reference.featureId ? `${reference.address}#${reference.featureId}` : reference.address),
				entityType: matched?.entityType ?? 'feature',
				datasetName: matched?.datasetName,
			}
		})
	}, [availableFeatures, curatedReferences])
	const availableCuratedReferenceFeatures = useMemo(
		() => availableFeatures.filter((item) => item.entityType !== 'context'),
		[availableFeatures],
	)

	useEffect(() => {
		const nextInitial = initialContext?.context
		const nextFields = builderFromSchema(nextInitial?.schema)
		setName(nextInitial?.name ?? '')
		setDescription(nextInitial?.description ?? '')
		descriptionEditorRef.current?.setContent(nextInitial?.description ?? '')
		setCuratedReferences(nextInitial?.references ?? [])
		setImage(nextInitial?.image ?? '')
		setContextUse(nextInitial?.contextUse ?? 'taxonomy')
		setValidationMode(nextInitial?.validationMode ?? 'none')
		setAllowForeignAttachments(nextInitial?.allowForeignAttachments ?? false)
		setAttachedContextRefs(initialContext?.contextReferences ?? [])
		setActiveTab('content')
		setAllowedGeometryTypes(nextInitial?.geometryConstraints?.allowedTypes ?? [])
		setSchemaMode('builder')
		setFields(nextFields)
		setSchemaJson(JSON.stringify(nextInitial?.schema ?? DEFAULT_SCHEMA, null, 2))
		setSamplePropertiesJson(sampleJsonFromBuilder(nextFields))
		setSaveError(null)
	}, [initialContext])

	useEffect(() => {
		if (schemaMode !== 'builder') return
		setSamplePropertiesJson(suggestedBuilderSampleJson)
	}, [schemaMode, suggestedBuilderSampleJson])

	const parsedSchema = useMemo(() => {
		try {
			return { schema: JSON.parse(effectiveSchemaJson), error: null as string | null }
		} catch (error) {
			return {
				schema: null,
				error: error instanceof Error ? error.message : 'Invalid schema JSON',
			}
		}
	}, [effectiveSchemaJson])

	const sampleValidation = useMemo(() => {
		if (!parsedSchema.schema) {
			return { status: 'error' as const, message: parsedSchema.error ?? 'Invalid schema' }
		}
		try {
			const parsedSample = JSON.parse(samplePropertiesJson)
			const validate = ajv.compile(parsedSchema.schema)
			const valid = validate(parsedSample)
			if (valid) {
				return { status: 'valid' as const, message: 'Sample is valid.' }
			}
			const first = validate.errors?.[0]
			return {
				status: 'invalid' as const,
				message: `${first?.instancePath || '/'} ${first?.message || 'Validation failed'}`,
			}
		} catch (error) {
			return {
				status: 'error' as const,
				message: error instanceof Error ? error.message : 'Invalid sample JSON',
			}
		}
	}, [parsedSchema, samplePropertiesJson])

	const validationEnabled =
		allowForeignAttachments && contextUse !== 'taxonomy' && validationMode !== 'none'

	useEffect(() => {
		if (!allowForeignAttachments && activeTab === 'schema') {
			setActiveTab('policy')
		}
	}, [activeTab, allowForeignAttachments])

	useEffect(() => {
		if (allowForeignAttachments) return
		if (contextUse !== 'taxonomy') {
			setContextUse('taxonomy')
		}
		if (validationMode !== 'none') {
			setValidationMode('none')
		}
	}, [allowForeignAttachments, contextUse, validationMode])

	const toggleAllowedGeometryType = (type: MapContextGeometryType, checked: boolean) => {
		const next = new Set(allowedGeometryTypes)
		if (checked) {
			next.add(type)
		} else {
			next.delete(type)
		}
		setAllowedGeometryTypes(Array.from(next.values()))
	}

	const currentContextCoordinate = initialContext?.contextCoordinate ?? null
	const attachableContexts = useMemo(() => {
		const attached = new Set(attachedContextRefs)
		return mapContextEvents
			.filter((context) => {
				const coordinate = context.contextCoordinate
				if (!coordinate) return false
				if (currentContextCoordinate && coordinate === currentContextCoordinate) return false
				if (attached.has(coordinate)) return true
				return context.context.allowForeignAttachments
			})
			.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	}, [attachedContextRefs, currentContextCoordinate, mapContextEvents])

	const attachedContexts = useMemo(
		() =>
			attachedContextRefs
				.map(
					(coordinate) =>
						mapContextEvents.find((context) => context.contextCoordinate === coordinate) ?? null,
				)
				.filter((context): context is MapContext => Boolean(context)),
		[attachedContextRefs, mapContextEvents],
	)

	const handleAttachmentSearchSelect = (result: EntitySearchResult) => {
		if (result.type !== 'context') return
		const selectedContext = result.entity as MapContext
		const coordinate = selectedContext.contextCoordinate
		if (!coordinate) return
		setAttachedContextRefs((prev) => (prev.includes(coordinate) ? prev : [...prev, coordinate]))
	}

	const handleCuratedReferenceSelect = (result: EntitySearchResult) => {
		const selected = result.entity as GeoFeatureItem
		const selectedKey = `${selected.address}#${selected.featureId ?? ''}`
		const inlineReferenceSet = new Set(referencedEntities.map((reference) => reference.key))
		if (inlineReferenceSet.has(selectedKey)) return
		const nextReference = stringifyNostrAddressReference({
			address: selected.address,
			featureId: selected.featureId,
		})
		setCuratedReferences((prev) => (prev.includes(nextReference) ? prev : [...prev, nextReference]))
	}

	const handleSave = async () => {
		if (!currentUser) return
		setSaveError(null)

		if (!name.trim()) {
			setSaveError('Context name is required.')
			return
		}

		const schemaWasProvided = schemaMode === 'json' ? schemaJson.trim().length > 0 : true
		const schemaHasRules = parsedSchema.schema
			? schemaHasValidationRules(parsedSchema.schema)
			: false

		if (validationEnabled && schemaWasProvided && !parsedSchema.schema) {
			setSaveError('Schema is invalid.')
			return
		}
		if (parsedSchema.schema && hasExternalRef(parsedSchema.schema)) {
			setSaveError('External $ref is not supported in v1. Use self-contained schema only.')
			return
		}
		if (validationEnabled && !schemaHasRules && allowedGeometryTypes.length === 0) {
			setSaveError('Add at least one schema rule or one allowed geometry type.')
			return
		}

		setIsSaving(true)
		try {
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')

			const effectiveContextUse = !allowForeignAttachments ? 'taxonomy' : contextUse
			const effectiveValidationMode =
				!allowForeignAttachments || effectiveContextUse === 'taxonomy'
					? 'none'
					: validationMode || 'optional'

			const contextContent: MapContextContent = {
				name: name.trim(),
				description: description.length > 0 ? description : undefined,
				descriptionFormat: 'markdown',
				references: curatedReferences.length > 0 ? curatedReferences : undefined,
				image: image.trim() || undefined,
				contextUse: effectiveContextUse,
				validationMode: effectiveValidationMode,
				allowForeignAttachments,
				geometryConstraints:
					validationEnabled && allowedGeometryTypes.length > 0
						? { allowedTypes: allowedGeometryTypes }
						: undefined,
				schemaDialect:
					validationEnabled && schemaHasRules
						? 'https://json-schema.org/draft/2020-12/schema'
						: undefined,
				schema:
					validationEnabled && schemaHasRules
						? (parsedSchema.schema as Record<string, unknown>)
						: undefined,
			}
			const referencedCoords = [
				...extractReferencedCoordinates(description),
				...extractReferencedCoordinatesFromList(curatedReferences),
			]

			// Context descriptions and curated references share the same invariant as
			// Stories: a referenced Dataset must identify the current published draft,
			// never an older revision. Capture the exact edit state before awaiting the
			// global publish confirmation so sidebar navigation cannot retarget it.
			const target = captureVisibleDatasetReferenceTarget()
			const referenceGate = await ensureDatasetReferencePublished({
				markdown: [description, ...curatedReferences].join('\n'),
				chatId: `manual-context:${initialContext?.contextId ?? 'new'}`,
				toolCallId: `publish-context:${Date.now()}`,
				target,
			})
			if (referenceGate.status === 'blocked') {
				setSaveError(referenceGate.message)
				return
			}

			const factory = initialContext
				? MapContextFactory.modify(initialContext.event).context(contextContent)
				: MapContextFactory.create(contextContent)

			const signedEvent = await factory
				.contextReferences(attachedContextRefs)
				.modifyPublicTags(setAddressReferenceTags(referencedCoords))
				.sign(signer)

			await publish(signedEvent, { routing: 'outbox' })
			toast.success('Context published.')
			const cast = castEvent(signedEvent, MapContext, eventStore)
			onSave(cast)
			onClose()
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : 'Failed to save context')
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<Tabs
			value={activeTab}
			onValueChange={(value) => setActiveTab(value as ContextEditorTab)}
			className="flex h-full min-h-0 flex-col"
		>
			<EntityPanelShell
				title={initialContext ? 'Edit context' : 'Create context'}
				tabs={
					<TabsList className="h-8 w-full justify-start overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
						<TabsTrigger
							value="content"
							className="h-8 rounded-none border-b-2 border-transparent px-2 text-xs data-[state=active]:border-input data-[state=active]:bg-transparent data-[state=active]:shadow-none"
						>
							Content
						</TabsTrigger>
						<TabsTrigger
							value="policy"
							className="h-8 rounded-none border-b-2 border-transparent px-2 text-xs data-[state=active]:border-input data-[state=active]:bg-transparent data-[state=active]:shadow-none"
						>
							Policy
						</TabsTrigger>
						{allowForeignAttachments && (
							<TabsTrigger
								value="schema"
								className="h-8 rounded-none border-b-2 border-transparent px-2 text-xs data-[state=active]:border-input data-[state=active]:bg-transparent data-[state=active]:shadow-none"
							>
								Schema
							</TabsTrigger>
						)}
					</TabsList>
				}
			>
				<TabsContent value="content" className="mt-0 space-y-3">
					<EntityPanelSurface tone="context" className="space-y-3">
						<EntityPanelSectionHeader
							eyebrow="Narrative"
							title="Describe the context"
							description="Markdown is stored verbatim. Use $ to insert NIP-27 nostr references inline."
						/>
						<div className="space-y-2">
							<Label>Name</Label>
							<Input
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="Roman ruins in Carinthia"
								className="rounded-none"
							/>
						</div>
						<div className="space-y-2">
							<Label>Description</Label>
							<GeoRichTextEditor
								ref={descriptionEditorRef}
								initialValue={description}
								onChange={setDescription}
								availableFeatures={availableFeatures}
								placeholder={`## Scope
Write in Markdown. Use $ to insert datasets, contexts, or features.`}
								rows={8}
								className="min-h-[280px] w-full"
							/>
						</div>
						<div className="space-y-2">
							<div className="flex items-center justify-between gap-2">
								<Label>Referenced entities</Label>
								<span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
									{referencedEntities.length}
								</span>
							</div>
							{referencedEntities.length === 0 ? (
								<p className="border border-border px-3 py-2 text-[11px] text-muted-foreground">
									No inline nostr references yet.
								</p>
							) : (
								<div className="border border-border">
									{referencedEntities.map((reference, index) => (
										<div
											key={reference.key}
											className={`flex items-start justify-between gap-3 px-3 py-2 ${
												index > 0 ? 'border-t border-border' : ''
											}`}
										>
											<div className="min-w-0 space-y-0.5">
												<p className="truncate text-xs font-medium text-foreground">
													{reference.name}
												</p>
												<p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
													{reference.entityType}
													{reference.datasetName ? ` · ${reference.datasetName}` : ''}
												</p>
												<p className="truncate text-[10px] text-muted-foreground">
													nostr:{reference.address}
													{reference.featureId ? `#${reference.featureId}` : ''}
												</p>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
						<div className="space-y-2">
							<div className="flex items-center justify-between gap-2">
								<Label>Curated references</Label>
								<span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
									{curatedReferenceEntities.length}
								</span>
							</div>
							<EntitySearchPopover
								sources={{ features: availableCuratedReferenceFeatures }}
								entityTypes={['feature']}
								onSelect={handleCuratedReferenceSelect}
								placeholder="Search geometries and datasets to reference…"
								searchMode="local"
								inputClassName="rounded-none"
							/>
							{curatedReferenceEntities.length === 0 ? (
								<p className="border border-border px-3 py-2 text-[11px] text-muted-foreground">
									No extra curated references. Add items here when they belong to the context but do
									not need to appear in the narrative text.
								</p>
							) : (
								<div className="border border-border">
									{curatedReferenceEntities.map((reference, index) => (
										<div
											key={reference.key}
											className={`flex items-start justify-between gap-3 px-3 py-2 ${
												index > 0 ? 'border-t border-border' : ''
											}`}
										>
											<div className="min-w-0 space-y-0.5">
												<p className="truncate text-xs font-medium text-foreground">
													{reference.name}
												</p>
												<p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
													{reference.entityType}
													{reference.datasetName ? ` · ${reference.datasetName}` : ''}
												</p>
												<p className="truncate text-[10px] text-muted-foreground">
													{reference.raw}
												</p>
											</div>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="h-6 rounded-none px-2 text-[11px]"
												onClick={() =>
													setCuratedReferences((prev) =>
														prev.filter((value) => value !== reference.raw),
													)
												}
											>
												Remove
											</Button>
										</div>
									))}
								</div>
							)}
						</div>
						<div className="space-y-2">
							<Label>Image URL</Label>
							<div className="flex items-center gap-2">
								<Input
									value={image}
									onChange={(event) => setImage(event.target.value)}
									placeholder="https://..."
									className="rounded-none"
								/>
								<BlossomUploaderButton
									currentUrl={image}
									onUploaded={({ url }) => setImage(url)}
									buttonLabel="Blossom"
									className="rounded-none"
								/>
							</div>
						</div>
					</EntityPanelSurface>
				</TabsContent>

				<TabsContent value="policy" className="mt-0 space-y-3">
					<EntityPanelSurface tone="neutral" className="space-y-3">
						<EntityPanelSectionHeader
							eyebrow="Participation"
							title="Attachment policy"
							description="Open contexts accept foreign c attachments. Closed contexts ignore them."
						/>
						<div className="flex items-start justify-between gap-3 border border-border px-3 py-2">
							<div className="space-y-1">
								<p className="text-xs font-medium text-foreground">Allow foreign attachments</p>
								<p className="text-[11px] leading-5 text-muted-foreground">
									Compliant clients only query foreign attachments when this is enabled.
								</p>
							</div>
							<Switch
								checked={allowForeignAttachments}
								onCheckedChange={setAllowForeignAttachments}
							/>
						</div>
						{!allowForeignAttachments && (
							<p className="text-[11px] text-muted-foreground">
								Validation and schema controls stay hidden while foreign attachments are off.
							</p>
						)}
					</EntityPanelSurface>

					<EntityPanelSurface tone="neutral" className="space-y-3">
						<EntityPanelSectionHeader
							eyebrow="Context Graph"
							title="Attach this context"
							description="Use c attachments for open parent contexts. Closed contexts are excluded from search unless already attached."
						/>
						<div className="space-y-2">
							<Label>Attach to open context</Label>
							<EntitySearchPopover
								sources={{ contexts: attachableContexts }}
								entityTypes={['context']}
								onSelect={handleAttachmentSearchSelect}
								placeholder="Search open contexts…"
								searchMode="local"
								inputClassName="rounded-none"
							/>
						</div>
						{attachedContexts.length === 0 ? (
							<p className="border border-border px-3 py-2 text-[11px] text-muted-foreground">
								This context is currently standalone.
							</p>
						) : (
							<div className="space-y-2">
								{attachedContexts.map((context) => {
									const coordinate = context.contextCoordinate
									if (!coordinate) return null
									return (
										<div
											key={coordinate}
											className="flex items-center justify-between gap-2 border border-border px-3 py-2"
										>
											<div className="min-w-0">
												<p className="truncate text-xs font-medium text-foreground">
													{context.context.name || context.contextId || 'Untitled context'}
												</p>
												<p className="truncate text-[10px] text-muted-foreground">
													{context.context.allowForeignAttachments ? 'open' : 'closed'} ·{' '}
													{coordinate}
												</p>
											</div>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="h-6 rounded-none px-2 text-[11px]"
												onClick={() =>
													setAttachedContextRefs((prev) =>
														prev.filter((value) => value !== coordinate),
													)
												}
											>
												Detach
											</Button>
										</div>
									)
								})}
							</div>
						)}
					</EntityPanelSurface>

					{allowForeignAttachments && (
						<EntityPanelSurface tone="neutral" className="space-y-3">
							<EntityPanelSectionHeader
								eyebrow="Validation"
								title="Validation behavior"
								description="Choose whether the context is taxonomy-only or also validates incoming geometry."
							/>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								<div className="space-y-2">
									<Label>Context use</Label>
									<Select
										value={contextUse}
										onValueChange={(value) => {
											const nextUse = value as MapContextContent['contextUse']
											setContextUse(nextUse)
											if (nextUse === 'taxonomy') {
												setValidationMode('none')
											}
										}}
									>
										<SelectTrigger className="rounded-none">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="taxonomy">taxonomy</SelectItem>
											<SelectItem value="validation">validation</SelectItem>
											<SelectItem value="hybrid">hybrid</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label>Validation mode</Label>
									<Select
										value={validationMode}
										onValueChange={(value) =>
											setValidationMode(value as MapContextContent['validationMode'])
										}
										disabled={contextUse === 'taxonomy'}
									>
										<SelectTrigger className="rounded-none">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="none">none</SelectItem>
											<SelectItem value="optional">optional</SelectItem>
											<SelectItem value="required">required</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
							<div className="space-y-2">
								<Label>Allowed geometry types</Label>
								<div className="grid grid-cols-2 gap-2">
									{MAP_CONTEXT_GEOMETRY_TYPES.map((geometryType) => (
										<div key={geometryType}>
											<Label key={geometryType} />
											<Checkbox
												checked={allowedGeometryTypes.includes(geometryType)}
												disabled={!validationEnabled}
												onCheckedChange={(checked) =>
													toggleAllowedGeometryType(geometryType, checked === true)
												}
											/>
											<span>{geometryType}</span>
										</div>
									))}
								</div>
							</div>
						</EntityPanelSurface>
					)}
				</TabsContent>

				{allowForeignAttachments && (
					<TabsContent value="schema" className="mt-0 space-y-3">
						<EntityPanelSurface tone="neutral" className="space-y-3">
							<EntityPanelSectionHeader
								eyebrow="Schema"
								title="Property constraints"
								description="Use the builder for common cases or switch to raw JSON."
								action={
									<div className="flex items-center gap-1">
										<Button
											size="sm"
											variant={schemaMode === 'builder' ? 'default' : 'outline'}
											onClick={() => setSchemaMode('builder')}
											className="h-7 rounded-none px-2 text-[11px]"
										>
											Builder
										</Button>
										<Button
											size="sm"
											variant={schemaMode === 'json' ? 'default' : 'outline'}
											onClick={() => {
												setSchemaMode('json')
												setSchemaJson(JSON.stringify(builderSchema, null, 2))
											}}
											className="h-7 rounded-none px-2 text-[11px]"
										>
											JSON
										</Button>
									</div>
								}
							/>

							{schemaMode === 'builder' ? (
								<div className="space-y-2">
									{fields.map((field, index) => (
										<div key={field.id} className="space-y-2 border border-border px-3 py-2">
											<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
												<Input
													value={field.key}
													onChange={(event) => {
														const next = [...fields]
														next[index] = { ...field, key: event.target.value }
														setFields(next)
													}}
													placeholder="property key"
													className="rounded-none"
												/>
												<Select
													value={field.type}
													onValueChange={(value) => {
														const next = [...fields]
														next[index] = { ...field, type: value as SchemaFieldType }
														setFields(next)
													}}
												>
													<SelectTrigger className="rounded-none">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="string">string</SelectItem>
														<SelectItem value="number">number</SelectItem>
														<SelectItem value="integer">integer</SelectItem>
														<SelectItem value="boolean">boolean</SelectItem>
													</SelectContent>
												</Select>
											</div>
											<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
												<Input
													type="number"
													value={
														field.type === 'string' ? (field.minLength ?? '') : (field.min ?? '')
													}
													onChange={(event) => {
														const next = [...fields]
														const numeric =
															event.target.value === '' ? undefined : Number(event.target.value)
														next[index] =
															field.type === 'string'
																? { ...field, minLength: numeric }
																: { ...field, min: numeric }
														setFields(next)
													}}
													placeholder={field.type === 'string' ? 'minLength' : 'minimum'}
													disabled={field.type === 'boolean'}
													className="rounded-none"
												/>
												<Input
													type="number"
													value={
														field.type === 'string' ? (field.maxLength ?? '') : (field.max ?? '')
													}
													onChange={(event) => {
														const next = [...fields]
														const numeric =
															event.target.value === '' ? undefined : Number(event.target.value)
														next[index] =
															field.type === 'string'
																? { ...field, maxLength: numeric }
																: { ...field, max: numeric }
														setFields(next)
													}}
													placeholder={field.type === 'string' ? 'maxLength' : 'maximum'}
													disabled={field.type === 'boolean'}
													className="rounded-none"
												/>
											</div>
											<div className="flex items-center justify-between">
												<Label className="flex items-center gap-1 text-[11px] text-muted-foreground">
													<Input
														type="checkbox"
														checked={field.required}
														onChange={(event) => {
															const next = [...fields]
															next[index] = { ...field, required: event.target.checked }
															setFields(next)
														}}
													/>
													required
												</Label>
												<Button
													size="sm"
													variant="ghost"
													onClick={() => {
														setFields(fields.filter((_, fieldIndex) => fieldIndex !== index))
													}}
													className="h-6 rounded-none px-2 text-[11px]"
												>
													Remove
												</Button>
											</div>
										</div>
									))}
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											setFields([
												...fields,
												{
													id: createSchemaFieldId(),
													key: '',
													type: 'string',
													required: false,
												},
											])
										}}
										className="rounded-none"
									>
										Add property
									</Button>
								</div>
							) : (
								<Textarea
									value={schemaJson}
									onChange={(event) => setSchemaJson(event.target.value)}
									rows={12}
									className="rounded-none font-mono text-xs"
								/>
							)}

							<div className="space-y-1">
								<Label>Sample properties JSON</Label>
								<Textarea
									value={samplePropertiesJson}
									onChange={(event) => setSamplePropertiesJson(event.target.value)}
									rows={4}
									className="rounded-none font-mono text-xs"
								/>
								<p
									className={`text-xs ${
										sampleValidation.status === 'valid'
											? 'text-ok'
											: sampleValidation.status === 'invalid'
												? 'text-primary'
												: 'text-destructive'
									}`}
								>
									{sampleValidation.message}
								</p>
							</div>
						</EntityPanelSurface>
					</TabsContent>
				)}

				<EntityPanelSurface tone="neutral" className="space-y-2">
					{saveError && <p className="text-xs text-destructive">{saveError}</p>}
					<div className="flex items-center justify-end gap-2">
						<Button variant="outline" onClick={onClose} className="rounded-none">
							Cancel
						</Button>
						<Button
							onClick={handleSave}
							disabled={isSaving || !currentUser}
							className="rounded-none"
						>
							{isSaving ? 'Saving…' : 'Save context'}
						</Button>
					</div>
				</EntityPanelSurface>
			</EntityPanelShell>
		</Tabs>
	)
}
