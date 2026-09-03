import { parseStoryViewBlock, stringifyStoryViewBlock } from './codec'
import { reduceStoryViewBlocks } from './views'
import type {
	MapPresentationIssue,
	MapPresentationV1,
	StoryViewBlockParseResult,
	StoryViewBlockV1,
	StoryViewReductionResultV1,
} from './types'
import {
	extractNostrAddressReferences,
	naddrToCoordinate,
	type NostrAddressReference,
} from '@/lib/nostr/references'
import { parseMapPresentationSource } from './codec'

export const STORY_VIEW_FENCE_LANGUAGE = 'earthly-view' as const

interface MarkdownLine {
	readonly text: string
	readonly start: number
	readonly contentEnd: number
	readonly end: number
}

interface FenceSpan {
	readonly start: number
	readonly end: number
	readonly payloadStart: number
	readonly payloadEnd: number
	readonly language: string
	readonly closed: boolean
}

export interface StoryMarkdownViewOccurrence {
	/** Zero-based order among earthly-view blocks in the body. */
	readonly index: number
	readonly start: number
	readonly end: number
	/** The complete source fence, retained byte-for-byte. */
	readonly raw: string
	/** Text between the opening and closing fence. */
	readonly payload: string
	readonly closed: boolean
	readonly result: StoryViewBlockParseResult
}

export interface StoryMarkdownDocument {
	readonly source: string
	readonly views: readonly StoryMarkdownViewOccurrence[]
	readonly issues: readonly MapPresentationIssue[]
}

function splitMarkdownLines(markdown: string): MarkdownLine[] {
	if (!markdown) return []
	const lines: MarkdownLine[] = []
	let start = 0
	while (start < markdown.length) {
		const newline = markdown.indexOf('\n', start)
		const contentEnd = newline === -1 ? markdown.length : newline
		const end = newline === -1 ? markdown.length : newline + 1
		const raw = markdown.slice(start, contentEnd)
		lines.push({
			text: raw.endsWith('\r') ? raw.slice(0, -1) : raw,
			start,
			contentEnd: raw.endsWith('\r') ? contentEnd - 1 : contentEnd,
			end,
		})
		start = end
	}
	return lines
}

function parseFenceOpener(
	line: string,
): { marker: '`' | '~'; length: number; language: string } | null {
	const match = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/u)
	const run = match?.[1]
	if (!run) return null
	const marker = run[0]
	if (marker !== '`' && marker !== '~') return null
	const info = (match[2] ?? '').trim()
	// CommonMark does not allow a backtick in the info string of a backtick fence.
	if (marker === '`' && info.includes('`')) return null
	return {
		marker,
		length: run.length,
		language: info.split(/\s+/u)[0]?.toLowerCase() ?? '',
	}
}

function isFenceCloser(line: string, marker: '`' | '~', minimumLength: number): boolean {
	const match = line.match(/^ {0,3}(`+|~+)[ \t]*$/u)
	const run = match?.[1]
	return Boolean(run && run[0] === marker && run.length >= minimumLength)
}

function findFenceSpans(markdown: string): readonly FenceSpan[] {
	const lines = splitMarkdownLines(markdown)
	const spans: FenceSpan[] = []
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex]
		if (!line) continue
		const opener = parseFenceOpener(line.text)
		if (!opener) continue

		let closingIndex = -1
		for (let candidate = lineIndex + 1; candidate < lines.length; candidate += 1) {
			const closingLine = lines[candidate]
			if (closingLine && isFenceCloser(closingLine.text, opener.marker, opener.length)) {
				closingIndex = candidate
				break
			}
		}

		const payloadStart = line.end
		if (closingIndex === -1) {
			spans.push({
				start: line.start,
				end: markdown.length,
				payloadStart,
				payloadEnd: markdown.length,
				language: opener.language,
				closed: false,
			})
			break
		}

		const closingLine = lines[closingIndex]
		if (!closingLine) continue
		spans.push({
			start: line.start,
			end: closingLine.contentEnd,
			payloadStart,
			payloadEnd: closingLine.start,
			language: opener.language,
			closed: true,
		})
		lineIndex = closingIndex
	}
	return Object.freeze(spans)
}

function invalidUnclosedView(payload: string): StoryViewBlockParseResult {
	return {
		status: 'invalid',
		raw: payload,
		issues: [
			Object.freeze({
				code: 'invalid-view',
				path: '$',
				message: 'Story view Markdown fence is not closed.',
			}),
		],
	}
}

function parseViewPayload(payload: string, closed: boolean): StoryViewBlockParseResult {
	if (!closed) return invalidUnclosedView(payload)
	try {
		return parseStoryViewBlock(JSON.parse(payload.trim()))
	} catch {
		return {
			status: 'invalid',
			raw: payload,
			issues: [
				Object.freeze({
					code: 'invalid-view',
					path: '$',
					message: 'Story view block contains malformed JSON.',
				}),
			],
		}
	}
}

function prefixOccurrenceIssue(issue: MapPresentationIssue, index: number): MapPresentationIssue {
	const suffix = issue.path === '$' ? '' : issue.path.slice(1)
	return Object.freeze({ ...issue, path: `$.views[${index}]${suffix}` })
}

/**
 * Locate physical `earthly-view` fences without rewriting the Story body.
 * Invalid and future-version blocks remain occurrences with their original raw
 * source, so an unrelated edit can round-trip them unchanged.
 */
export function parseStoryMarkdown(markdown: string | null | undefined): StoryMarkdownDocument {
	const source = markdown ?? ''
	const views: StoryMarkdownViewOccurrence[] = []
	const issues: MapPresentationIssue[] = []
	for (const span of findFenceSpans(source)) {
		if (span.language !== STORY_VIEW_FENCE_LANGUAGE) continue
		const payload = source.slice(span.payloadStart, span.payloadEnd).replace(/(?:\r?\n)$/u, '')
		const result = parseViewPayload(payload, span.closed)
		const index = views.length
		issues.push(...result.issues.map((entry) => prefixOccurrenceIssue(entry, index)))
		views.push(
			Object.freeze({
				index,
				start: span.start,
				end: span.end,
				raw: source.slice(span.start, span.end),
				payload,
				closed: span.closed,
				result,
			}),
		)
	}
	return Object.freeze({
		source,
		views: Object.freeze(views),
		issues: Object.freeze(issues),
	})
}

/** Valid view values in physical document order. Invalid/future blocks are retained in the body but skipped. */
export function extractStoryViewBlocks(
	markdown: string | null | undefined,
): readonly StoryViewBlockV1[] {
	return Object.freeze(
		parseStoryMarkdown(markdown).views.flatMap((occurrence) =>
			occurrence.result.status === 'valid' ? [occurrence.result.value] : [],
		),
	)
}

/** Apply valid physical views cumulatively, in body order. */
export function reduceStoryMarkdownViews(
	presentation: MapPresentationV1,
	markdown: string | null | undefined,
): StoryViewReductionResultV1 {
	return reduceStoryViewBlocks(presentation, extractStoryViewBlocks(markdown))
}

/** Canonical physical representation for a newly created or explicitly edited view. */
export function stringifyStoryViewMarkdownBlock(view: unknown): string {
	return `\`\`\`${STORY_VIEW_FENCE_LANGUAGE}\n${stringifyStoryViewBlock(view)}\n\`\`\``
}

function withBlockSpacing(prefix: string, block: string, suffix: string): string {
	const left =
		prefix.length === 0 || prefix.endsWith('\n\n') ? '' : prefix.endsWith('\n') ? '\n' : '\n\n'
	const right =
		suffix.length === 0 || suffix.startsWith('\n\n') ? '' : suffix.startsWith('\n') ? '\n' : '\n\n'
	return `${prefix}${left}${block}${right}${suffix}`
}

/** Insert a canonical view near a text offset, snapping out of an existing fenced block. */
export function insertStoryViewBlock(
	markdown: string,
	view: unknown,
	offset = markdown.length,
): string {
	let insertionOffset = Math.max(0, Math.min(markdown.length, Math.trunc(offset)))
	const containingFence = findFenceSpans(markdown).find(
		(span) => insertionOffset > span.start && insertionOffset < span.end,
	)
	if (containingFence) insertionOffset = containingFence.end
	return withBlockSpacing(
		markdown.slice(0, insertionOffset),
		stringifyStoryViewMarkdownBlock(view),
		markdown.slice(insertionOffset),
	)
}

/** Replace the first valid physical view with `id`; invalid/future blocks are never touched. */
export function replaceStoryViewBlock(markdown: string, id: string, nextView: unknown): string {
	const occurrence = parseStoryMarkdown(markdown).views.find(
		(entry) => entry.result.status === 'valid' && entry.result.value.id === id,
	)
	if (!occurrence) return markdown
	return `${markdown.slice(0, occurrence.start)}${stringifyStoryViewMarkdownBlock(nextView)}${markdown.slice(occurrence.end)}`
}

/** Remove the first valid physical view with `id`; invalid/future blocks are never touched. */
export function removeStoryViewBlock(markdown: string, id: string): string {
	const occurrence = parseStoryMarkdown(markdown).views.find(
		(entry) => entry.result.status === 'valid' && entry.result.value.id === id,
	)
	if (!occurrence) return markdown
	let start = occurrence.start
	let end = occurrence.end
	if (start >= 2 && markdown.slice(start - 2, start) === '\n\n') start -= 1
	else if (end + 2 <= markdown.length && markdown.slice(end, end + 2) === '\n\n') end += 1
	return `${markdown.slice(0, start)}${markdown.slice(end)}`
}

/**
 * Remove Markdown constructs that cannot be semantic inline references. The
 * result keeps newlines and length stable where practical, which makes it safe
 * to feed through the existing NIP-27 scanner without letting examples in code
 * authorize presentation data.
 */
function semanticMarkdownText(markdown: string): string {
	// All parser offsets are UTF-16 code-unit offsets. Keep the mask in the same
	// units so non-BMP characters before a fence cannot shift the hidden region.
	const chars = markdown.split('')
	const mask = (start: number, end: number) => {
		for (let index = start; index < end; index += 1) {
			if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' '
		}
	}

	for (const span of findFenceSpans(markdown)) mask(span.start, span.end)

	// Four-space/tab-indented code blocks.
	for (const line of splitMarkdownLines(markdown)) {
		if (/^(?: {4}|\t)/u.test(line.text)) mask(line.start, line.contentEnd)
	}

	let visible = chars.join('')
	visible = visible.replace(/<!--[\s\S]*?(?:-->|$)/gu, (value) => value.replace(/[^\r\n]/gu, ' '))

	// Inline code spans: a matching run of backticks owns everything until the
	// next equal-length run. Mask conservatively; code is never authorization.
	const inlineChars = visible.split('')
	for (let index = 0; index < inlineChars.length; index += 1) {
		if (inlineChars[index] !== '`') continue
		let runEnd = index
		while (inlineChars[runEnd] === '`') runEnd += 1
		const run = '`'.repeat(runEnd - index)
		const closing = visible.indexOf(run, runEnd)
		if (closing === -1) {
			index = runEnd - 1
			continue
		}
		maskInline(inlineChars, index, closing + run.length)
		index = closing + run.length - 1
	}
	visible = inlineChars.join('')

	// A backslash-escaped reference is literal Markdown text, not a mention.
	return visible.replace(/\\nostr:naddr1[a-z0-9]+(?:#[a-zA-Z0-9_%~-]+)?/giu, (value) =>
		' '.repeat(value.length),
	)
}

function maskInline(chars: string[], start: number, end: number): void {
	for (let index = start; index < end; index += 1) {
		if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' '
	}
}

/**
 * Extract only semantic kind-37515 inline references. Fenced/indented/inline
 * code and HTML comments are excluded. Document order and duplicates are kept;
 * callers decide whether whole-map and feature mentions collapse.
 */
export function extractSemanticStoryMapReferences(
	markdown: string | null | undefined,
): NostrAddressReference[] {
	return extractSemanticStoryAddressReferences(markdown).filter((reference) => {
		const coordinate = naddrToCoordinate(reference.address)
		return coordinate !== null && parseMapPresentationSource(coordinate) !== null
	})
}

/** Semantic NIP-27 address references of every kind, for Story query-index `a` tags. */
export function extractSemanticStoryAddressReferences(
	markdown: string | null | undefined,
): NostrAddressReference[] {
	if (!markdown) return []
	return extractNostrAddressReferences(semanticMarkdownText(markdown))
}

/** Ordered, deduplicated semantic coordinates of every addressable event kind. */
export function extractSemanticStoryReferencedCoordinates(
	markdown: string | null | undefined,
): string[] {
	const seen = new Set<string>()
	return extractSemanticStoryAddressReferences(markdown).flatMap((reference) => {
		const coordinate = naddrToCoordinate(reference.address)
		if (!coordinate || seen.has(coordinate)) return []
		seen.add(coordinate)
		return [coordinate]
	})
}

/** Ordered, deduplicated exact Map coordinates for Story `a` query-index tags. */
export function extractSemanticStoryMapCoordinates(markdown: string | null | undefined): string[] {
	const seen = new Set<string>()
	return extractSemanticStoryMapReferences(markdown).flatMap((reference) => {
		const coordinate = naddrToCoordinate(reference.address)
		const source = parseMapPresentationSource(coordinate)
		if (!source || seen.has(source.coordinate)) return []
		seen.add(source.coordinate)
		return [source.coordinate]
	})
}
