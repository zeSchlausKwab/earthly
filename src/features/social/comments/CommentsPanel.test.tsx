import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { act, forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { CommentNode } from '../hooks/useGeoComments'
import type {
	GeoRichTextEditorProps,
	GeoRichTextEditorRef,
} from '@/components/editor/GeoRichTextEditor'
import { PanelTranslucencyContext } from '@/components/PanelTranslucencyContext'
import { TooltipProvider } from '@/components/ui/tooltip'

let commentNodes: CommentNode[] = []
let account: { pubkey: string } | null = { pubkey: 'me' }
const submitted: string[] = []
const replies: string[] = []
const visibility: string[] = []
const mapEditor = { setFeatures() {}, clearHistory() {}, getAllFeatures: () => [] }
const editorState = {
	editor: mapEditor,
	features: [],
	mode: 'select',
	selectedFeatureIds: [],
	canFinishDrawing: false,
	setFeatures() {},
	setSelectedFeatureIds() {},
	setMode() {},
	setHistoryState() {},
}
const accountHooks = { ...(await import('applesauce-react/hooks')) }
mock.module('applesauce-react/hooks', () => ({ ...accountHooks, useActiveAccount: () => account }))
mock.module('@/features/geo-editor/store', () => ({
	useEditorStore: Object.assign(
		(select: (state: typeof editorState) => unknown) => select(editorState),
		{
			getState: () => editorState,
		},
	),
}))
mock.module('../hooks/useGeoComments', () => ({
	useGeoComments: () => ({
		comments: commentNodes,
		allComments: commentNodes.flatMap((node) => [
			node.event,
			...node.children.map((child) => child.event),
		]),
		count: commentNodes.reduce((count, node) => count + 1 + node.children.length, 0),
		isLoading: false,
		postComment: async (text: string) => {
			submitted.push(text)
		},
		postReply: async (_comment: GeoComment, text: string) => {
			replies.push(text)
		},
	}),
}))
mock.module('@/components/editor/GeoRichTextEditor', () => ({
	GeoRichTextEditor: forwardRef<GeoRichTextEditorRef, GeoRichTextEditorProps>((props, ref) => {
		const input = useRef<HTMLTextAreaElement>(null)
		useImperativeHandle(
			ref,
			() =>
				({
					getText: () => input.current?.value ?? '',
					clear: () => {},
					focus: () => {},
				}) as GeoRichTextEditorRef,
		)
		return (
			<textarea
				ref={input}
				aria-label="Comment text"
				data-translucent={props.translucent}
				placeholder={props.placeholder}
				disabled={props.disabled}
				onInput={(event) => props.onChange?.(event.currentTarget.value)}
			/>
		)
	}),
}))
mock.module('@/components/editor', () => ({
	RichContentRenderer: ({ content }: { content: string }) => <p>{content}</p>,
}))
mock.module('@/components/user-profile', () => ({
	UserProfile: ({ pubkey }: { pubkey: string }) => <span>{pubkey}</span>,
}))
mock.module('./GeoSocialActions', () => ({
	GeoSocialActions: ({
		target,
		onReplyClick,
		onReactionCountChange,
	}: {
		target: { id: string }
		onReplyClick?: () => void
		onReactionCountChange?: (count: number) => void
	}) => {
		useEffect(() => {
			onReactionCountChange?.(target.id === 'older' ? 10 : 0)
		}, [target.id, onReactionCountChange])
		return (
			<section aria-label={`Social actions ${target.id}`}>
				<button type="button" onClick={onReplyClick}>
					Reply
				</button>
				<button type="button">Share</button>
				<button type="button">Zap</button>
			</section>
		)
	},
}))

const { CommentsPanel } = await import('./CommentsPanel')
let root: Root
let container: HTMLElement

function comment(id: string, time: number): CommentNode {
	return {
		event: {
			id,
			commentId: id,
			pubkey: 'author',
			text: `${id} text`,
			created_at: time,
			geojson: {
				type: 'FeatureCollection',
				features: [
					{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [16, 48] } },
				],
			},
		} as GeoComment,
		children: [],
		depth: 0,
	}
}

beforeAll(() => {
	const { window } = parseHTML('<html><body></body></html>')
	Object.assign(globalThis, {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
		MutationObserver: window.MutationObserver,
	})
	window.requestAnimationFrame = (callback) => {
		callback(0)
		return 0
	}
	;(
		globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true
})
beforeEach(() => {
	account = { pubkey: 'me' }
	commentNodes = [comment('older', 1), comment('newer', 2)]
	submitted.length = 0
	replies.length = 0
	visibility.length = 0
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(async () => {
	await act(() => root.unmount())
	container.remove()
})

async function render(
	options: {
		translucent?: boolean
		embedded?: boolean
		toolbarAction?: ReactNode
		layout?: 'docked' | 'flow'
	} = {},
) {
	await act(async () => {
		root.render(
			<TooltipProvider>
				<PanelTranslucencyContext.Provider value={options.translucent ?? false}>
					<CommentsPanel
						target={{ id: 'map', dTag: 'map' } as GeoDataset}
						embedded={options.embedded}
						layout={options.layout}
						toolbarAction={options.toolbarAction}
						onCommentGeojsonVisibilityChange={(entry, visible) =>
							visibility.push(`${entry.id}:${visible}`)
						}
					/>
				</PanelTranslucencyContext.Provider>
			</TooltipProvider>,
		)
	})
}

function button(text: string, scope: Element = container): HTMLButtonElement {
	const match = Array.from(scope.querySelectorAll('button')).find(
		(entry) => entry.textContent === text,
	)
	if (!match) throw new Error(`Missing button ${text}`)
	return match
}

describe('Comments panel presentation', () => {
	test('keeps the composer below threads and suppresses only duplicated object actions', async () => {
		await render({
			embedded: true,
			toolbarAction: <button type="button">Attach 1 selected</button>,
		})
		expect(container.querySelector('[aria-label="Social actions map"]')).toBeNull()
		expect(container.querySelectorAll('[aria-label^="Social actions "]')).toHaveLength(2)
		expect(button('Attach 1 selected')).toBeDefined()
		const list = container.querySelector('[aria-label="Comment threads"]')
		const composer = container.querySelector('[aria-label="Comment composer"]')
		expect(list?.parentElement?.lastElementChild?.contains(composer)).toBe(true)
		expect(container.textContent).not.toContain('Discussion')
		expect(button('Attach a place')).toBeDefined()
		expect(container.querySelector('[aria-label="Draw point"]')).toBeNull()
		expect(button('Post').disabled).toBe(true)
		expect(list?.classList.contains('min-h-12')).toBe(true)
		expect(composer?.parentElement?.classList.contains('min-h-0')).toBe(true)
		expect(composer?.parentElement?.classList.contains('shrink-0')).toBe(false)
	})

	test('puts the composer before unbounded threads on reading pages without docked height constraints', async () => {
		await render({ layout: 'flow' })
		const list = container.querySelector('[aria-label="Comment threads"]')
		const composer = container.querySelector('[aria-label="Comment composer"]')
		expect(list?.previousElementSibling?.contains(composer)).toBe(true)
		expect(list?.classList.contains('overflow-y-auto')).toBe(false)
		expect(composer?.parentElement?.classList.contains('max-h-[70%]')).toBe(false)
		expect(composer?.parentElement?.classList.contains('overflow-y-auto')).toBe(false)
		expect(list?.parentElement?.classList.contains('h-full')).toBe(false)
		expect(container.querySelector('[aria-label="Social actions map"]')).not.toBeNull()
	})

	test('preserves standalone object social actions and transparent form/row surfaces', async () => {
		await render({ translucent: true })
		expect(container.querySelector('[aria-label="Social actions map"]')).not.toBeNull()
		expect(container.querySelector('textarea')?.getAttribute('data-translucent')).toBe('true')
		const rows = container.querySelectorAll(
			'[aria-label="Comment threads"] [data-translucent="true"]',
		)
		expect(rows).toHaveLength(2)
		for (const row of Array.from(rows)) {
			expect(row.classList.contains('bg-transparent')).toBe(true)
			expect(row.classList.contains('bg-card')).toBe(false)
		}
	})

	test('keeps opaque row surfaces outside a glass panel', async () => {
		await render()
		expect(container.querySelector('textarea')?.getAttribute('data-translucent')).toBe('false')
		expect(
			container
				.querySelector('[aria-label="Comment threads"] [data-translucent="false"]')
				?.classList.contains('bg-card'),
		).toBe(true)
	})

	test('switches newest / most-liked using row counts without dropping geometry actions', async () => {
		await render({ embedded: true })
		const list = container.querySelector('[aria-label="Comment threads"]')
		expect(list?.textContent?.indexOf('newer text')).toBeLessThan(
			list?.textContent?.indexOf('older text') ?? 0,
		)
		const select = container.querySelector('select')
		if (!select) throw new Error('Missing sort control')
		await act(() => {
			select.querySelector('option[value="newest"]')?.removeAttribute('selected')
			select.querySelector('option[value="most-liked"]')?.setAttribute('selected', '')
			select.dispatchEvent(new window.Event('change', { bubbles: true }))
		})
		expect(list?.textContent?.indexOf('older text')).toBeLessThan(
			list?.textContent?.indexOf('newer text') ?? 0,
		)
		await act(() => button('Hide annotations').click())
		expect(visibility).toContain('older:false')
		expect(visibility).toContain('newer:false')
	})

	test('keeps replies inline and restores the root composer when cancelled', async () => {
		await render({ translucent: true, embedded: true })
		const row = container.querySelector('[aria-label="Social actions older"]')
		if (!row) throw new Error('Missing comment actions')
		await act(() => button('Reply', row).click())
		expect(container.querySelector('[aria-label="Comment composer"]')).toBeNull()
		expect(
			container
				.querySelector('[aria-label="Reply composer"] textarea')
				?.getAttribute('data-translucent'),
		).toBe('true')
		await act(() => button('Cancel').click())
		expect(container.querySelector('[aria-label="Reply composer"]')).toBeNull()
		expect(container.querySelector('[aria-label="Comment composer"]')).not.toBeNull()
	})

	test('keeps logged-out comments readable and writing disabled', async () => {
		account = null
		await render({ embedded: true, translucent: true })
		expect(container.querySelector('textarea')?.disabled).toBe(true)
		expect(button('Post').disabled).toBe(true)
		expect(container.textContent).toContain('older text')
		expect(container.textContent?.match(/Log in to comment/g)).toHaveLength(1)
	})

	test('posts rich-editor text using the existing callback and supports Ctrl+Enter', async () => {
		await render({ embedded: true })
		const input = container.querySelector('textarea')
		const form = container.querySelector('form')
		if (!input || !form) throw new Error('Missing composer')
		const text = 'A **rich** note with nostr:map-reference'
		await act(() => {
			input.value = text
			input.dispatchEvent(new window.Event('input', { bubbles: true }))
		})
		expect(button('Post').disabled).toBe(false)
		let keyboardSubmissions = 0
		form.requestSubmit = () => {
			keyboardSubmissions += 1
			form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
		}
		const keyboardEvent = new window.Event('keydown', { bubbles: true, cancelable: true })
		Object.assign(keyboardEvent, { key: 'Enter', ctrlKey: true })
		await act(async () => {
			form.dispatchEvent(keyboardEvent)
		})
		expect(keyboardSubmissions).toBe(1)
		expect(submitted).toEqual([text])
	})

	test('retains deep replies but caps visual indentation and keeps collapse controls', async () => {
		const parent = comment('parent', 1)
		const reply = comment('reply', 2)
		reply.depth = 5
		parent.children = [reply]
		commentNodes = [parent]
		await render({ embedded: true })
		const replyActions = container.querySelector('[aria-label="Social actions reply"]')
		const replyRow = replyActions?.closest('[data-translucent]') as HTMLElement | null
		expect(replyRow?.style.marginLeft).toBe('1rem')
		const collapse = container.querySelector<HTMLButtonElement>('[aria-label="Collapse replies"]')
		if (!collapse) throw new Error('Missing collapse control')
		await act(() => collapse.click())
		expect(container.textContent).not.toContain('reply text')
		const expand = container.querySelector<HTMLButtonElement>('[aria-label="Expand replies"]')
		if (!expand) throw new Error('Missing expand control')
		await act(() => expand.click())
		expect(container.textContent).toContain('reply text')
	})
})
