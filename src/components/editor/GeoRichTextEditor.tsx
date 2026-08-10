import { useEditor, EditorContent } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import {
	useState,
	useCallback,
	useRef,
	forwardRef,
	useImperativeHandle,
	useMemo,
	useEffect,
	type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import {
	Bold,
	ChevronDown,
	ChevronUp,
	Code2,
	Crosshair,
	FileText,
	Globe,
	Heading2,
	Italic,
	Layers3,
	List,
	Map as MapIcon,
	MapPin,
	Quote,
	Shapes,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { GeoMentionNode, serializeToText, parseFromText } from './GeoMentionExtension'
import { mergeMentionItems, searchMentionEntities } from './mentionSearch'
import { stringifyGeoReference } from '@/lib/geo/reference'
import { requestCoordinateReferencePick } from '@/features/geo-editor/coordinateReferencePickerBridge'

export interface GeoFeatureItem {
	/** Unique identifier */
	id: string
	/** Display name */
	name: string
	/** The naddr1... address */
	address: string
	/** Entity type for reference rendering */
	entityType?:
		| 'dataset'
		| 'context'
		| 'feature'
		| 'story'
		| 'coordinate'
		| 'osm'
		| 'coordinate-picker'
	/** Feature ID within the dataset (optional for dataset-level refs) */
	featureId?: string
	/** Geometry type for icon */
	geometryType?: string
	/** Source dataset name */
	datasetName?: string
}

export interface GeoRichTextEditorProps {
	/** Initial text content (with nostr: mentions) */
	initialValue?: string
	/** Placeholder text */
	placeholder?: string
	/** Available features for $ mentions */
	availableFeatures?: GeoFeatureItem[]
	/** Whether `$` suggestions may query public relays in addition to local features */
	searchRelayMentions?: boolean
	/** Called when content changes */
	onChange?: (text: string) => void
	/** Called when a feature is dropped */
	onFeatureDrop?: (feature: GeoFeatureItem) => void
	/** Callback when a geo mention's visibility is toggled */
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	/** Callback to zoom to a mentioned geometry */
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	/** Whether the editor is disabled */
	disabled?: boolean
	/** Minimum height in rows */
	rows?: number
	/** Additional class names */
	className?: string
	/** Whether the editor is strictly read-only (no editing UI) */
	readOnly?: boolean
	/** Whether to show the formatting toolbar */
	showToolbar?: boolean
	/** Initial toolbar state */
	defaultToolbarExpanded?: boolean
}

export interface GeoRichTextEditorRef {
	/** Get plain text with nostr: mentions */
	getText: () => string
	/** Set content from nostr: mention text */
	setContent: (text: string) => void
	/** Clear the editor */
	clear: () => void
	/** Focus the editor */
	focus: () => void
	/** Insert a geo mention at cursor */
	insertMention: (item: GeoFeatureItem) => void
}

interface SuggestionState {
	isOpen: boolean
	query: string
	items: GeoFeatureItem[]
	selectedIndex: number
	clientRect: DOMRect | null
	range: { from: number; to: number } | null
}

type GeoSuggestionProps = SuggestionProps<GeoFeatureItem, GeoFeatureItem>

export function getGeoReferenceTypeLabel(item: GeoFeatureItem): string {
	switch (item.entityType) {
		case 'coordinate-picker':
		case 'coordinate':
			return 'Coordinate'
		case 'dataset':
			return 'Dataset'
		case 'feature':
			return 'Feature'
		case 'osm':
			return 'OSM'
		case 'context':
			return 'Context'
		case 'story':
			return 'Story'
		default:
			return 'Reference'
	}
}

function getSuggestionDescription(item: GeoFeatureItem): string {
	if (item.entityType === 'coordinate-picker') return 'Click once on the map'
	if (item.entityType === 'feature') {
		return [item.geometryType, item.datasetName].filter(Boolean).join(' · ') || 'Dataset geometry'
	}
	if (item.entityType === 'osm') return item.geometryType || 'OpenStreetMap object'
	if (item.entityType === 'dataset') {
		return item.datasetName && item.datasetName !== item.name
			? item.datasetName
			: 'Complete dataset'
	}
	return item.datasetName || item.geometryType || 'Spatial reference'
}

/**
 * Rich text editor with inline geo mention support.
 * - Type `$` to trigger feature suggestions
 * - Drag & drop features to insert mentions
 * - Renders mentions as interactive chips
 */
export const GeoRichTextEditor = forwardRef<GeoRichTextEditorRef, GeoRichTextEditorProps>(
	(
		{
			initialValue = '',
			placeholder = 'Type here... Use $ to mention features',
			availableFeatures = [],
			searchRelayMentions = true,
			onChange,
			onFeatureDrop,
			onMentionVisibilityToggle,
			onMentionZoomTo,
			disabled = false,
			rows = 3,
			className = '',
			readOnly = false,
			showToolbar = true,
			defaultToolbarExpanded,
		},
		ref,
	) => {
		const [suggestion, setSuggestion] = useState<SuggestionState>({
			isOpen: false,
			query: '',
			items: [],
			selectedIndex: 0,
			clientRect: null,
			range: null,
		})
		const [isDragOver, setIsDragOver] = useState(false)
		const [isToolbarExpanded, setIsToolbarExpanded] = useState(defaultToolbarExpanded ?? rows >= 4)
		const suggestionRef = useRef<HTMLDivElement>(null)
		const rootRef = useRef<HTMLDivElement>(null)
		const editorContainerRef = useRef<HTMLDivElement>(null)
		const suggestionCommandRef = useRef<((item: GeoFeatureItem) => void) | null>(null)
		const suggestionStateRef = useRef<SuggestionState | null>(null)
		const relayMentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
		const relayMentionQueryRef = useRef<string>('')
		const coordinatePickerCancelRef = useRef<(() => void) | null>(null)
		const beginCoordinatePickRef = useRef<(() => void) | null>(null)

		useEffect(() => {
			suggestionStateRef.current = suggestion
		}, [suggestion])

		// Use ref to access latest availableFeatures inside Tiptap extension callback
		// without recreating the extension (which useEditor wouldn't pick up)
		const availableFeaturesRef = useRef(availableFeatures)
		useEffect(() => {
			availableFeaturesRef.current = availableFeatures
		}, [availableFeatures])
		const searchRelayMentionsRef = useRef(searchRelayMentions)
		useEffect(() => {
			searchRelayMentionsRef.current = searchRelayMentions
			if (!searchRelayMentions && relayMentionTimerRef.current) {
				clearTimeout(relayMentionTimerRef.current)
				relayMentionTimerRef.current = null
			}
		}, [searchRelayMentions])

		// Create a name resolver that looks up names from available features by address
		const createNameResolver = useCallback(
			() =>
				(address: string): string | undefined => {
					const exactDataset = availableFeaturesRef.current.find(
						(item) => item.address === address && !item.featureId,
					)
					return exactDataset?.name
				},
			[],
		)

		// Filter features based on query
		const filterFeatures = useCallback((query: string): GeoFeatureItem[] => {
			const features = availableFeaturesRef.current
			const coordinatePicker: GeoFeatureItem = {
				id: 'action:pick-coordinate',
				name: 'Pick a coordinate on the map',
				address: '',
				entityType: 'coordinate-picker',
				geometryType: 'Coordinate',
			}
			if (!query) return [coordinatePicker, ...features.slice(0, 9)]
			const lowerQuery = query.toLowerCase()
			const matches = features
				.filter(
					(f) =>
						f.name.toLowerCase().includes(lowerQuery) ||
						f.featureId?.toLowerCase().includes(lowerQuery) ||
						f.datasetName?.toLowerCase().includes(lowerQuery),
				)
				.slice(0, 9)
			const pickerMatches = ['coordinate', 'location', 'point', 'map'].some((term) =>
				term.includes(lowerQuery),
			)
			return pickerMatches ? [coordinatePicker, ...matches] : matches
		}, [])

		// Relay entity suggestions: local matches render instantly (sync
		// items), relay results (unloaded datasets/groups/stories) merge into
		// the open suggestion state when they arrive. Guarded by a query
		// token so stale responses never overwrite a newer query's list.
		// Stable ([] deps) so the memoized mention extension never has to be
		// recreated. Suggestions cannot open on a disabled/read-only editor,
		// so no gating is needed here.
		const queueRelayMentionSearch = useCallback((query: string) => {
			relayMentionQueryRef.current = query
			if (relayMentionTimerRef.current) clearTimeout(relayMentionTimerRef.current)
			if (!searchRelayMentionsRef.current) return
			if (query.trim().length < 2) return

			relayMentionTimerRef.current = setTimeout(() => {
				void searchMentionEntities(query).then((relayItems) => {
					if (!searchRelayMentionsRef.current) return
					if (relayItems.length === 0) return
					if (relayMentionQueryRef.current !== query) return
					setSuggestion((prev) => {
						if (!prev.isOpen || prev.query !== query) return prev
						const next: SuggestionState = {
							...prev,
							items: mergeMentionItems(prev.items, relayItems),
						}
						suggestionStateRef.current = next
						return next
					})
				})
			}, 250)
		}, [])

		useEffect(() => {
			return () => {
				if (relayMentionTimerRef.current) clearTimeout(relayMentionTimerRef.current)
			}
		}, [])

		// Create mention extension with $ trigger
		// We use useMemo to avoid recreating the extension on every render,
		// but we need to ensure it has access to the latest filterFeatures
		const mentionExtension = useMemo(() => {
			return Mention.configure({
				HTMLAttributes: {
					class: 'geo-mention-trigger',
				},
				suggestion: {
					char: '$',
					allowSpaces: false,
					startOfLine: false,
					allowedPrefixes: null,
					items: ({ query }) => filterFeatures(query),
					render: () => {
						return {
							onStart: (props: GeoSuggestionProps) => {
								const items = Array.isArray(props.items)
									? (props.items as GeoFeatureItem[])
									: filterFeatures(props.query)

								suggestionCommandRef.current = props.command ?? null
								const next: SuggestionState = {
									isOpen: true,
									query: props.query,
									items,
									selectedIndex: 0,
									clientRect: props.clientRect?.() ?? null,
									range: props.range ?? null,
								}

								suggestionStateRef.current = next
								setSuggestion(next)
								queueRelayMentionSearch(props.query)
							},
							onUpdate: (props: GeoSuggestionProps) => {
								const items = Array.isArray(props.items)
									? (props.items as GeoFeatureItem[])
									: filterFeatures(props.query)

								suggestionCommandRef.current = props.command ?? null
								setSuggestion((prev) => {
									const selectedIndex = Math.min(prev.selectedIndex, Math.max(0, items.length - 1))
									const next: SuggestionState = {
										...prev,
										query: props.query,
										items,
										selectedIndex,
										clientRect: props.clientRect?.() ?? null,
										range: props.range ?? null,
									}
									suggestionStateRef.current = next
									return next
								})
								queueRelayMentionSearch(props.query)
							},
							onExit: () => {
								suggestionCommandRef.current = null
								relayMentionQueryRef.current = ''
								setSuggestion((prev) => {
									const next: SuggestionState = { ...prev, isOpen: false, range: null }
									suggestionStateRef.current = next
									return next
								})
							},
							onKeyDown: (props: SuggestionKeyDownProps) => {
								if (props.event.key === 'ArrowUp') {
									setSuggestion((prev) => {
										const next: SuggestionState = {
											...prev,
											selectedIndex: Math.max(0, prev.selectedIndex - 1),
										}
										suggestionStateRef.current = next
										return next
									})
									return true
								}
								if (props.event.key === 'ArrowDown') {
									setSuggestion((prev) => {
										const next: SuggestionState = {
											...prev,
											selectedIndex: Math.max(
												0,
												Math.min(prev.items.length - 1, prev.selectedIndex + 1),
											),
										}
										suggestionStateRef.current = next
										return next
									})
									return true
								}
								if (props.event.key === 'Enter' || props.event.key === 'Tab') {
									const state = suggestionStateRef.current
									const selectedItem = state?.items[state.selectedIndex]
									if (selectedItem && suggestionCommandRef.current) {
										props.event.preventDefault()
										suggestionCommandRef.current(selectedItem)
										return true
									}
								}
								return false
							},
						}
					},
					command: ({ editor, range, props }) => {
						const item = props as unknown as GeoFeatureItem
						if (item.entityType === 'coordinate-picker') {
							editor.chain().focus().deleteRange(range).run()
							setSuggestion((prev) => ({ ...prev, isOpen: false }))
							beginCoordinatePickRef.current?.()
							return
						}

						editor
							.chain()
							.focus()
							.deleteRange(range)
							.insertContent({
								type: 'geoMention',
								attrs: {
									address: item.address,
									featureId: item.featureId,
									displayName: item.name,
									referenceType: item.entityType,
								},
							})
							.insertContent(' ')
							.run()

						setSuggestion((prev) => ({ ...prev, isOpen: false }))
					},
				},
			})
		}, [filterFeatures, queueRelayMentionSearch])

		const editor = useEditor({
			extensions: [
				StarterKit.configure({
					// Disable features we don't need
					heading: false,
					bulletList: false,
					orderedList: false,
					blockquote: false,
					codeBlock: false,
					horizontalRule: false,
				}),
				Placeholder.configure({
					placeholder,
				}),
				GeoMentionNode.configure({
					callbacks: {
						onVisibilityToggle: onMentionVisibilityToggle,
						onZoomTo: onMentionZoomTo,
					},
				}),
				mentionExtension,
			],
			content: initialValue ? parseFromText(initialValue, createNameResolver()) : '',
			editable: !disabled && !readOnly,
			onUpdate: ({ editor }) => {
				const json = editor.getJSON()
				const text = serializeToText(json)
				onChange?.(text)
			},
		})

		const editorMinHeight = Math.max(rows * 26, readOnly ? 0 : 88)

		const beginCoordinatePick = useCallback(() => {
			if (!editor || disabled || readOnly) return
			coordinatePickerCancelRef.current?.()
			coordinatePickerCancelRef.current = requestCoordinateReferencePick(
				({ latitude, longitude }) => {
					coordinatePickerCancelRef.current = null
					const address = stringifyGeoReference({ kind: 'coordinate', latitude, longitude })
					editor
						.chain()
						.focus()
						.insertContent({
							type: 'geoMention',
							attrs: {
								address,
								featureId: null,
								displayName: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
								referenceType: 'coordinate',
							},
						})
						.insertContent(' ')
						.run()
				},
			)
		}, [disabled, editor, readOnly])
		beginCoordinatePickRef.current = beginCoordinatePick

		useEffect(
			() => () => {
				coordinatePickerCancelRef.current?.()
				coordinatePickerCancelRef.current = null
			},
			[],
		)

		useEffect(() => {
			if (!editor) return
			const dom = editor.view.dom as HTMLElement
			dom.style.minHeight = readOnly ? '' : `${editorMinHeight}px`
			dom.style.height = readOnly ? 'auto' : '100%'
		}, [editor, editorMinHeight, readOnly])

		// Handle suggestion selection
		const selectSuggestion = useCallback((item: GeoFeatureItem) => {
			const command = suggestionCommandRef.current
			if (!command) return
			command(item)
		}, [])

		const getSuggestionIcon = (item: GeoFeatureItem) => {
			if (item.entityType === 'coordinate-picker' || item.entityType === 'coordinate') {
				return <Crosshair className="h-4 w-4 flex-shrink-0 text-primary" />
			}
			if (item.entityType === 'context') {
				return <Globe className="h-4 w-4 flex-shrink-0 text-primary" />
			}
			if (item.entityType === 'dataset') {
				return <Layers3 className="h-4 w-4 flex-shrink-0 text-primary" />
			}
			if (item.entityType === 'feature') {
				return <Shapes className="h-4 w-4 flex-shrink-0 text-primary" />
			}
			if (item.entityType === 'osm') {
				return <MapIcon className="h-4 w-4 flex-shrink-0 text-primary" />
			}
			if (item.entityType === 'story') {
				return <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
			}
			return <MapPin className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
		}

		const insertMarkdown = useCallback(
			(before: string, after = before, placeholderText = '') => {
				if (!editor || disabled || readOnly) return
				const { from, to, empty } = editor.state.selection
				const selectedText = empty
					? placeholderText
					: editor.state.doc.textBetween(from, to, '\n', '\n')
				const tr = editor.state.tr.insertText(`${before}${selectedText}${after}`, from, to)
				const selectionStart = from + before.length
				const selectionEnd = selectionStart + selectedText.length
				tr.setSelection(TextSelection.create(tr.doc, selectionStart, selectionEnd))
				editor.view.dispatch(tr.scrollIntoView())
				editor.view.focus()
			},
			[disabled, editor, readOnly],
		)

		const insertBlockPrefix = useCallback(
			(prefix: string) => {
				if (!editor || disabled || readOnly) return
				const { from, to } = editor.state.selection
				const needsLeadingBreak = from > 1 ? '\n' : ''
				const insertion = `${needsLeadingBreak}${prefix}`
				const tr = editor.state.tr.insertText(insertion, from, to)
				const cursor = from + insertion.length
				tr.setSelection(TextSelection.create(tr.doc, cursor))
				editor.view.dispatch(tr.scrollIntoView())
				editor.view.focus()
			},
			[disabled, editor, readOnly],
		)

		// Expose methods via ref
		useImperativeHandle(
			ref,
			() => ({
				getText: () => {
					if (!editor) return ''
					return serializeToText(editor.getJSON())
				},
				setContent: (text: string) => {
					if (!editor) return
					const content = text ? parseFromText(text, createNameResolver()) : ''
					editor.commands.setContent(content)
				},
				clear: () => {
					editor?.commands.clearContent()
				},
				focus: () => {
					editor?.commands.focus()
				},
				insertMention: (item: GeoFeatureItem) => {
					if (!editor) return
					editor
						.chain()
						.focus()
						.insertContent({
							type: 'geoMention',
							attrs: {
								address: item.address,
								featureId: item.featureId,
								displayName: item.name,
								referenceType: item.entityType,
							},
						})
						.insertContent(' ')
						.run()
				},
			}),
			[editor, createNameResolver],
		)

		// Re-parse content when availableFeatures changes from empty to populated
		// This ensures mention names are resolved even if features load after initial render
		useEffect(() => {
			if (!editor || availableFeatures.length === 0) return

			// Get current content as text
			const json = editor.getJSON()
			const text = serializeToText(json)

			// Only re-parse if there are nostr: mentions that might need name resolution
			if (!text.includes('nostr:naddr1')) return

			// Re-parse with the name resolver to update display names
			const newContent = parseFromText(text, createNameResolver())
			editor.commands.setContent(newContent)
		}, [editor, availableFeatures, createNameResolver])

		// Update content when initialValue prop changes (e.g., switching between collections)
		useEffect(() => {
			if (!editor) return

			const currentText = serializeToText(editor.getJSON())
			if (currentText === initialValue) return

			const newContent = initialValue ? parseFromText(initialValue, createNameResolver()) : ''
			editor.commands.setContent(newContent)
		}, [editor, initialValue, createNameResolver])

		// Drag & drop handlers
		const handleDragOver = useCallback((e: React.DragEvent) => {
			e.preventDefault()
			e.dataTransfer.dropEffect = 'copy'
			setIsDragOver(true)
		}, [])

		const handleDragLeave = useCallback((e: React.DragEvent) => {
			// Only set false if we're leaving the container entirely
			if (!editorContainerRef.current?.contains(e.relatedTarget as Node)) {
				setIsDragOver(false)
			}
		}, [])

		const handleDrop = useCallback(
			(e: React.DragEvent) => {
				e.preventDefault()
				setIsDragOver(false)

				const data = e.dataTransfer.getData('application/geo-feature')
				if (!data) return

				try {
					const item: GeoFeatureItem = JSON.parse(data)
					if (!editor) return

					// Insert at cursor position (or end if no focus)
					editor
						.chain()
						.focus()
						.insertContent({
							type: 'geoMention',
							attrs: {
								address: item.address,
								featureId: item.featureId,
								displayName: item.name,
								referenceType: item.entityType,
							},
						})
						.insertContent(' ')
						.run()

					onFeatureDrop?.(item)
				} catch (error) {
					console.error('Failed to parse dropped feature:', error)
				}
			},
			[editor, onFeatureDrop],
		)

		// Render the suggestion layer at the viewport level so narrow Story panels and
		// split-view overflow never crop it. Positioning also flips above the cursor
		// when there is more room there.
		const suggestionStyle: CSSProperties | null = (() => {
			if (!suggestion.clientRect || typeof window === 'undefined') return null
			const viewportPadding = 8
			const gap = 6
			const width = Math.min(352, window.innerWidth - viewportPadding * 2)
			const estimatedHeight = Math.min(360, 42 + suggestion.items.length * 58)
			const spaceBelow = window.innerHeight - suggestion.clientRect.bottom - gap - viewportPadding
			const spaceAbove = suggestion.clientRect.top - gap - viewportPadding
			const placeAbove = spaceBelow < Math.min(180, estimatedHeight) && spaceAbove > spaceBelow
			const availableHeight = Math.max(120, placeAbove ? spaceAbove : spaceBelow)
			const maxHeight = Math.min(360, availableHeight)
			const left = Math.min(
				Math.max(viewportPadding, suggestion.clientRect.left),
				window.innerWidth - width - viewportPadding,
			)
			const top = placeAbove
				? Math.max(
						viewportPadding,
						suggestion.clientRect.top - gap - Math.min(estimatedHeight, maxHeight),
					)
				: suggestion.clientRect.bottom + gap
			return { position: 'fixed', left, top, width, maxHeight }
		})()

		return (
			<div ref={rootRef} className={cn('relative flex min-h-0 flex-col', className)}>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: container needs drag & drop handlers */}
				<div
					ref={editorContainerRef}
					className={cn(
						'flex min-h-0 flex-1 flex-col border transition-colors',
						readOnly
							? 'border-transparent bg-transparent'
							: isDragOver
								? 'border-info/40 bg-info/15 ring-2 ring-info'
								: 'border-border bg-card',
						disabled && !readOnly && 'cursor-not-allowed bg-muted',
					)}
					onDragOver={!readOnly ? handleDragOver : undefined}
					onDragLeave={!readOnly ? handleDragLeave : undefined}
					onDrop={!readOnly ? handleDrop : undefined}
				>
					{!readOnly && showToolbar && (
						<>
							<div className="flex items-center justify-between border-b border-border bg-muted px-1.5">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-5 gap-1 rounded-none px-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
									onClick={() => setIsToolbarExpanded((value) => !value)}
									disabled={disabled}
								>
									{isToolbarExpanded ? (
										<ChevronUp className="h-3 w-3" />
									) : (
										<ChevronDown className="h-3 w-3" />
									)}
									Format
								</Button>
								<span className="text-[9px] text-muted-foreground">$ inserts references</span>
							</div>
							{isToolbarExpanded && (
								<div className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1">
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										onClick={() => insertMarkdown('**', '**', 'bold')}
										disabled={disabled}
										title="Bold"
									>
										<Bold className="h-3.5 w-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										onClick={() => insertMarkdown('*', '*', 'italic')}
										disabled={disabled}
										title="Italic"
									>
										<Italic className="h-3.5 w-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										onClick={() => insertMarkdown('`', '`', 'code')}
										disabled={disabled}
										title="Inline code"
									>
										<Code2 className="h-3.5 w-3.5" />
									</Button>
									<div className="mx-1 h-4 w-px bg-muted" />
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										onClick={() => insertBlockPrefix('## ')}
										disabled={disabled}
										title="Heading"
									>
										<Heading2 className="h-3.5 w-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										onClick={() => insertBlockPrefix('- ')}
										disabled={disabled}
										title="Bullet list"
									>
										<List className="h-3.5 w-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										onClick={() => insertBlockPrefix('> ')}
										disabled={disabled}
										title="Quote"
									>
										<Quote className="h-3.5 w-3.5" />
									</Button>
									<div className="mx-1 h-4 w-px bg-muted" />
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										onClick={beginCoordinatePick}
										disabled={disabled}
										title="Reference a coordinate from the map"
									>
										<Crosshair className="h-3.5 w-3.5" />
									</Button>
								</div>
							)}
						</>
					)}
					<EditorContent
						editor={editor}
						className={cn(
							'min-h-0 flex-1 prose prose-sm max-w-none text-sm',
							'[&_.ProseMirror]:h-full [&_.ProseMirror]:outline-none',
							readOnly ? '[&_.ProseMirror]:p-0' : '[&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2.5',
							'[&_.ProseMirror]:whitespace-pre-wrap',
							'[&_.ProseMirror_p]:my-0',
							'[&_.ProseMirror_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
							'[&_.ProseMirror_.is-editor-empty:first-child::before]:text-muted-foreground',
							'[&_.ProseMirror_.is-editor-empty:first-child::before]:float-left',
							'[&_.ProseMirror_.is-editor-empty:first-child::before]:h-0',
							'[&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none',
						)}
					/>

					{/* Drop zone indicator */}
					{isDragOver && (
						<div className="absolute inset-0 flex items-center justify-center bg-info/15 pointer-events-none">
							<div className="flex items-center gap-2 text-info font-medium">
								<MapPin className="h-5 w-5" />
								Drop to insert mention
							</div>
						</div>
					)}
				</div>

				{/* The suggestion popup is portaled below, outside panel overflow. */}
				{suggestion.isOpen &&
					suggestionStyle &&
					typeof document !== 'undefined' &&
					createPortal(
						<div
							ref={suggestionRef}
							role="listbox"
							aria-label="Spatial references"
							className="z-[100] overflow-y-auto border border-border bg-card shadow-xl"
							style={suggestionStyle}
						>
							<div className="sticky top-0 z-10 border-b border-border bg-muted px-3 py-2">
								<div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground">
									Insert map reference
								</div>
								<div className="mt-0.5 text-[10px] text-muted-foreground">
									Choose what this part of the article points to
								</div>
							</div>
							{suggestion.items.length > 0 ? (
								suggestion.items.map((item, index) => {
									const typeLabel = getGeoReferenceTypeLabel(item)
									return (
										<button
											key={item.id}
											type="button"
											className={cn(
												'flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted',
												index === suggestion.selectedIndex && 'bg-info/15',
											)}
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => selectSuggestion(item)}
										>
											<span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center border border-border bg-muted/60">
												{getSuggestionIcon(item)}
											</span>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium text-foreground">
													{item.name}
												</span>
												<span className="mt-1 flex min-w-0 items-center gap-1.5">
													<span
														data-reference-type={typeLabel}
														className="flex-shrink-0 border border-primary/35 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-primary"
													>
														{typeLabel}
													</span>
													<span className="truncate text-[10px] text-muted-foreground">
														{getSuggestionDescription(item)}
													</span>
												</span>
											</span>
										</button>
									)
								})
							) : (
								<div className="px-3 py-3 text-xs text-muted-foreground">No matches</div>
							)}
						</div>,
						document.body,
					)}
			</div>
		)
	},
)

GeoRichTextEditor.displayName = 'GeoRichTextEditor'
