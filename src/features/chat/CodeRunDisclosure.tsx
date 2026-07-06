import { useMemo, useState } from 'react'
import { Code2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MutationCounts } from '@/features/geo-editor/api/results'

/**
 * The successful `run_code` result shape (Plan 02 D-10):
 * `{ ok, counts, consoleLines, truncated, returnValue }`. Failures are NOT a
 * result object — they arrive as a serialized `ToolError` and are rendered by
 * the existing red ToolError bubble in ChatPanel (D-11), never here.
 */
export interface RunCodeResult {
	ok: true
	counts: MutationCounts
	consoleLines: string[]
	truncated: boolean
	returnValue: unknown
}

/**
 * Recover a serialized successful `run_code` result from a `role:'tool'`
 * message's content. Returns null for anything that is not the D-10 success
 * shape (e.g. a ToolError envelope, or non-JSON), so the caller can fall back
 * to the generic / error render paths.
 */
export function parseRunCodeResult(content: string): RunCodeResult | null {
	const trimmed = content.trim()
	if (!trimmed.startsWith('{')) return null
	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>
		if (
			parsed.ok === true &&
			parsed.counts !== null &&
			typeof parsed.counts === 'object' &&
			Array.isArray(parsed.consoleLines) &&
			typeof parsed.truncated === 'boolean' &&
			'returnValue' in parsed
		) {
			return parsed as unknown as RunCodeResult
		}
		return null
	} catch {
		return null
	}
}

/**
 * D-09 compact summary line. Prefers the authoring outcome (created → updated →
 * deleted) so a glance at the collapsed block tells you what hit the map; falls
 * back to a neutral "Ran code" when the script wrote nothing.
 */
export function buildRunCodeSummary(result: RunCodeResult): string {
	const { created, updated, deleted } = result.counts
	const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
	if (created > 0) return `Ran code → ${plural(created, 'feature')} created`
	if (updated > 0) return `Ran code → ${plural(updated, 'feature')} updated`
	if (deleted > 0) return `Ran code → ${plural(deleted, 'feature')} deleted`
	return 'Ran code'
}

function renderReturnValue(value: unknown): string {
	if (value === undefined) return 'undefined'
	try {
		return JSON.stringify(value, null, 2)
	} catch {
		return String(value)
	}
}

interface CodeRunDisclosureProps {
	/** The script source (the `code` argument of the run_code tool call). */
	source: string
	/** The decoded successful run_code result (D-10 shape). */
	result: RunCodeResult
	/**
	 * Render expanded on first paint. Production always starts collapsed (D-09);
	 * this exists so render-proof tests can assert the expanded markup, and so a
	 * future caller could deep-link an expanded block.
	 */
	defaultOpen?: boolean
}

/**
 * Collapsible, READ-ONLY code + output block for a `run_code` tool result
 * (D-09/D-10/D-12/D-07). Reuses the `ToolResultDisclosure` collapse idiom: a
 * `useState` open toggle + a `▸/▾` button + a compact summary line. Collapsed by
 * default; expanding reveals the read-only source, the captured console stream,
 * the authoring counts, and the JSON-rendered return value.
 *
 * There is intentionally NO edit / rerun affordance — the code is shown for
 * transparency only (D-12). Each `run_code` tool message is its own transcript
 * entry, so every self-correction retry is naturally its own block (D-07).
 */
export function CodeRunDisclosure({ source, result, defaultOpen = false }: CodeRunDisclosureProps) {
	const [isOpen, setIsOpen] = useState(defaultOpen)
	const summary = useMemo(() => buildRunCodeSummary(result), [result])
	const consoleText = useMemo(() => result.consoleLines.join('\n'), [result.consoleLines])
	const returnText = useMemo(() => renderReturnValue(result.returnValue), [result.returnValue])
	const { created, updated, deleted, skippedDuplicates } = result.counts

	return (
		<div className="rounded-lg border border-edit/40 bg-edit/15 px-3 py-2 text-xs">
			<div className="mb-1 flex items-center justify-between gap-2">
				<Button
					type="button"
					variant="ghost"
					onClick={() => setIsOpen((prev) => !prev)}
					className="h-auto min-w-0 p-0 text-left font-medium text-edit"
					aria-expanded={isOpen}
				>
					<span className="mr-1">{isOpen ? '▾' : '▸'}</span>
					<Code2 className="mr-1 inline h-3 w-3" />
					<span className="truncate">{summary}</span>
				</Button>
			</div>

			{isOpen && (
				<div className="space-y-2">
					{/* (1) read-only source — D-12: no editable control, no rerun */}
					<div>
						<div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-edit/80">
							Source (read-only)
						</div>
						<div className="max-h-56 overflow-y-auto rounded border border-edit/40 bg-background/70 p-2">
							<pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
								<code>{source}</code>
							</pre>
						</div>
					</div>

					{/* (2) captured console stream — D-10 */}
					{result.consoleLines.length > 0 && (
						<div>
							<div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-edit/80">
								Console
							</div>
							<div className="max-h-40 overflow-y-auto rounded border border-edit/40 bg-background/70 p-2">
								<pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
									{consoleText}
									{result.truncated ? '\n…(output truncated)' : ''}
								</pre>
							</div>
						</div>
					)}

					{/* (3) authoring counts summary — D-10 */}
					<div className="rounded border border-edit/40 bg-background/70 p-2 text-[11px] text-muted-foreground">
						<span className="font-medium text-edit">Result:</span> {created} created · {updated}{' '}
						updated · {deleted} deleted
						{skippedDuplicates > 0 ? ` · ${skippedDuplicates} skipped` : ''}
					</div>

					{/* (4) JSON-rendered return value — D-10 */}
					<div>
						<div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-edit/80">
							Return value
						</div>
						<div className="max-h-40 overflow-y-auto rounded border border-edit/40 bg-background/70 p-2">
							<pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
								{returnText}
								{result.truncated ? '\n…(output truncated)' : ''}
							</pre>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
