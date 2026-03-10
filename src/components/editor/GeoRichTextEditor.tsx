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
} from 'react'
import {
	Bold,
	ChevronDown,
	ChevronUp,
	Code2,
	Heading2,
	Italic,
	List,
	MapPin,
	Quote,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { GeoMentionNode, serializeToText, parseFromText } from './GeoMentionExtension'

export interface GeoFeatureItem {
	/** Unique identifier */
	id: string
	/** Display name */
	name: string
	/** The naddr1... address */
	address: string
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
		const [isToolbarExpanded, setIsToolbarExpanded] = useState(
			defaultToolbarExpanded ?? rows >= 4,
		)
		const suggestionRef = useRef<HTMLDivElement>(null)
		const rootRef = useRef<HTMLDivElement>(null)
		const editorContainerRef = useRef<HTMLDivElement>(null)
		const suggestionCommandRef = useRef<((item: GeoFeatureItem) => void) | null>(null)
		const suggestionStateRef = useRef<SuggestionState | null>(null)

		useEffect(() => {
			suggestionStateRef.current = suggestion
		}, [suggestion])

		// Use ref to access latest availableFeatures inside Tiptap extension callback
		// without recreating the extension (which useEditor wouldn't pick up)
		const availableFeaturesRef = useRef(availableFeatures)
		useEffect(() => {
			availableFeaturesRef.current = availableFeatures
		}, [availableFeatures])

		// Create a name resolver that looks up names from available features by address
		const createNameResolver = useCallback(
			() =>
				(address: string): string | undefined => {
					const feature = availableFeaturesRef.current.find((f) => f.address === address)
					return feature?.name
				},
			[],
		)

		// Filter features based on query
		const filterFeatures = useCallback((query: string): GeoFeatureItem[] => {
			const features = availableFeaturesRef.current
			if (!query) return features.slice(0, 10)
			const lowerQuery = query.toLowerCase()
			return features
				.filter(
					(f) =>
						f.name.toLowerCase().includes(lowerQuery) ||
						f.featureId?.toLowerCase().includes(lowerQuery) ||
						f.datasetName?.toLowerCase().includes(lowerQuery),
				)
				.slice(0, 10)
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
							},
							onExit: () => {
								suggestionCommandRef.current = null
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
								},
							})
							.insertContent(' ')
							.run()

						setSuggestion((prev) => ({ ...prev, isOpen: false }))
					},
				},
			})
		}, [filterFeatures])

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

		// Calculate suggestion popup position
		const suggestionStyle = (() => {
			if (!suggestion.clientRect) return {}

			const rootRect = rootRef.current?.getBoundingClientRect()
			if (!rootRect) {
				return {
					position: 'fixed' as const,
					top: suggestion.clientRect.bottom + 4,
					left: suggestion.clientRect.left,
				}
			}

			// Use absolute positioning relative to the root wrapper. This avoids issues with
			// `position: fixed` inside transformed ancestors (common in modals/sheets).
			return {
				position: 'absolute' as const,
				top: suggestion.clientRect.bottom - rootRect.top + 4,
				left: suggestion.clientRect.left - rootRect.left,
			}
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
								? 'border-sky-400 bg-sky-50/50 ring-2 ring-sky-200'
								: 'border-gray-200 bg-white',
						disabled && !readOnly && 'cursor-not-allowed bg-gray-50',
					)}
					onDragOver={!readOnly ? handleDragOver : undefined}
					onDragLeave={!readOnly ? handleDragLeave : undefined}
					onDrop={!readOnly ? handleDrop : undefined}
				>
					{!readOnly && showToolbar && (
						<>
							<div className="flex items-center justify-between border-b border-gray-200 bg-stone-50 px-2 py-1">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 rounded-none px-2 text-[11px] uppercase tracking-[0.22em] text-stone-600"
									onClick={() => setIsToolbarExpanded((value) => !value)}
									disabled={disabled}
								>
									{isToolbarExpanded ? (
										<ChevronUp className="h-3.5 w-3.5" />
									) : (
										<ChevronDown className="h-3.5 w-3.5" />
									)}
									Format
								</Button>
								<span className="text-[10px] text-stone-500">$ for references</span>
							</div>
							{isToolbarExpanded && (
								<div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-white px-2 py-1">
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
									<div className="mx-1 h-4 w-px bg-gray-200" />
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
							'[&_.ProseMirror_.is-editor-empty:first-child::before]:text-gray-400',
							'[&_.ProseMirror_.is-editor-empty:first-child::before]:float-left',
							'[&_.ProseMirror_.is-editor-empty:first-child::before]:h-0',
							'[&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none',
						)}
					/>

					{/* Drop zone indicator */}
					{isDragOver && (
						<div className="absolute inset-0 flex items-center justify-center bg-sky-100/80 pointer-events-none">
							<div className="flex items-center gap-2 text-sky-700 font-medium">
								<MapPin className="h-5 w-5" />
								Drop to insert mention
							</div>
						</div>
					)}
				</div>

				{/* Suggestion popup */}
				{suggestion.isOpen && (
					<div
						ref={suggestionRef}
						className="absolute z-50 w-64 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg"
						style={suggestionStyle}
					>
						{suggestion.items.length > 0 ? (
							suggestion.items.map((item, index) => (
								<button
									key={item.id}
									type="button"
									className={`
										w-full flex items-center gap-2 px-3 py-2 text-left text-sm
										${index === suggestion.selectedIndex ? 'bg-sky-50 text-sky-700' : 'hover:bg-gray-50'}
									`}
									onClick={() => selectSuggestion(item)}
								>
									<MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
									<div className="flex-1 min-w-0">
										<div className="font-medium truncate">{item.name}</div>
										{item.datasetName && (
											<div className="text-xs text-gray-500 truncate">{item.datasetName}</div>
										)}
									</div>
									{item.geometryType && (
										<span className="text-xs text-gray-400 flex-shrink-0">{item.geometryType}</span>
									)}
								</button>
							))
						) : (
							<div className="px-3 py-2 text-xs text-gray-500">No matches</div>
						)}
					</div>
				)}
			</div>
		)
	},
)

GeoRichTextEditor.displayName = 'GeoRichTextEditor'
