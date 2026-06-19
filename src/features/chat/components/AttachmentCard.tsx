import { AlertTriangle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { IngestSummary } from '../ingest/datasetTypes'
import { DatasetTypeIcon, SummarySchemaDetail, summaryStatLine } from './FileChip'

/**
 * The transcript-side attachment representation (Slice A of the ingest +
 * attachment rethink — design `ingest-attachment-rethink.md`, Move 1).
 *
 * The model still receives the `{ ingestHandle, ingestSummary }` JSON part
 * unchanged (D-11 — never `fullRows`). What changed is the *display*: instead of
 * `MessageBubble` printing that JSON verbatim (a wall of `schema`/`sampleRows`),
 * the renderer detects the dataset part and renders THIS compact, collapsible
 * file card — persisting the composer's `FileChip` representation into the sent
 * message rather than stringifying it away.
 *
 * Collapsed by default: filename · kind badge · stat line · ⚠ badge when the
 * summary carries warnings (the affordance is wired now, empty-safe; Slice B
 * populates the warnings). Expanding reveals the schema detail + a small sample
 * table — the same detail that used to be dumped inline. Reuses the
 * `CodeRunDisclosure` collapse idiom (▸/▾ toggle) for interaction consistency.
 */

/**
 * The shape carried on the model-facing dataset content part. Slice B may add
 * `warnings` to `IngestSummary`; we read it structurally and empty-safe so the
 * ⚠ affordance lights up automatically once populated, without a type bump here.
 */
export interface IngestHandlePayload {
	ingestHandle: string
	ingestSummary: IngestSummary
}

/**
 * Recover an `{ ingestHandle, ingestSummary }` payload from a `type:'text'`
 * content part's string. Returns null for anything that is not the dataset
 * shape, so `MessageBubble` falls back to rendering it as normal text. Mirrors
 * the `isIngestHandleJson` guard in `store.ts` (the prompt-path side).
 */
export function parseIngestHandlePart(text: string): IngestHandlePayload | null {
	const trimmed = text.trim()
	if (!trimmed.startsWith('{') || !trimmed.includes('"ingestHandle"')) return null
	try {
		const parsed = JSON.parse(trimmed) as {
			ingestHandle?: unknown
			ingestSummary?: unknown
		}
		if (
			typeof parsed.ingestHandle === 'string' &&
			parsed.ingestSummary &&
			typeof parsed.ingestSummary === 'object'
		) {
			return {
				ingestHandle: parsed.ingestHandle,
				ingestSummary: parsed.ingestSummary as IngestSummary,
			}
		}
		return null
	} catch {
		return null
	}
}

/** Read any warnings carried on the summary (Slice B populates these). */
function summaryWarnings(summary: IngestSummary): string[] {
	const maybe = (summary as IngestSummary & { warnings?: unknown }).warnings
	if (Array.isArray(maybe)) {
		return maybe.filter((w): w is string => typeof w === 'string')
	}
	return []
}

/** Uppercase kind badge: CSV / XLSX / JSON / GEOJSON / TEXT. */
function kindLabel(type: IngestSummary['type']): string {
	return type.toUpperCase()
}

/** A small, scrollable preview of the sampled rows (NEVER the full table). */
function SummarySampleTable({ summary }: { summary: IngestSummary }) {
	const columns = useMemo(() => {
		const fromSchema = summary.schema.map((f) => f.name)
		if (fromSchema.length > 0) return fromSchema
		// Fallback: derive columns from the first sample row's keys.
		const first = summary.sampleRows[0]
		return first ? Object.keys(first) : []
	}, [summary])

	if (summary.sampleRows.length === 0 || columns.length === 0) return null

	return (
		<div className="mt-1 space-y-1">
			<p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				Sample rows
			</p>
			<div className="max-h-40 overflow-auto rounded border bg-background/70">
				<table className="w-full border-collapse text-left text-[10px]">
					<thead>
						<tr className="border-b bg-muted/40">
							{columns.map((col) => (
								<th
									key={col}
									className="whitespace-nowrap px-1.5 py-1 font-medium text-muted-foreground"
								>
									{col}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{summary.sampleRows.map((row, rowIndex) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: sample rows are positional, stable for this static preview
							<tr key={rowIndex} className="border-b last:border-b-0">
								{columns.map((col) => (
									<td
										key={col}
										className="max-w-[10rem] truncate px-1.5 py-1 font-mono"
										title={formatCell(row[col])}
									>
										{formatCell(row[col])}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}

/** Render a single cell value compactly (objects → JSON, nullish → empty). */
function formatCell(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value)
		} catch {
			return String(value)
		}
	}
	return String(value)
}

interface AttachmentCardProps {
	summary: IngestSummary
	/**
	 * Render expanded on first paint. Production always starts collapsed; this
	 * exists so render-proof tests can assert the expanded markup.
	 */
	defaultOpen?: boolean
}

export function AttachmentCard({ summary, defaultOpen = false }: AttachmentCardProps) {
	const [isOpen, setIsOpen] = useState(defaultOpen)
	const warnings = useMemo(() => summaryWarnings(summary), [summary])
	const statLine = useMemo(() => summaryStatLine(summary), [summary])

	return (
		<div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs text-foreground">
			<Button
				type="button"
				variant="ghost"
				onClick={() => setIsOpen((prev) => !prev)}
				className="flex h-auto w-full min-w-0 items-center gap-1.5 p-0 text-left font-medium hover:bg-transparent"
				aria-expanded={isOpen}
			>
				<span className="shrink-0 text-muted-foreground">{isOpen ? '▾' : '▸'}</span>
				<DatasetTypeIcon type={summary.type} className="h-3.5 w-3.5 shrink-0" />
				<span className="min-w-0 truncate" title={summary.fileName}>
					{summary.fileName}
				</span>
				<span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
					{kindLabel(summary.type)}
				</span>
				{warnings.length > 0 && (
					<span
						className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-600 dark:bg-amber-950 dark:text-amber-400"
						title={warnings.join('\n')}
					>
						<AlertTriangle className="h-2.5 w-2.5" />
						{warnings.length}
					</span>
				)}
			</Button>

			<p className={cn('mt-0.5 pl-5 text-[11px] text-muted-foreground')}>{statLine}</p>

			{isOpen && (
				<div className="mt-1 pl-5">
					{warnings.length > 0 && (
						<ul className="mb-1 space-y-0.5">
							{warnings.map((warning) => (
								<li
									key={warning}
									className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400"
								>
									<AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
									<span>{warning}</span>
								</li>
							))}
						</ul>
					)}
					<SummarySchemaDetail summary={summary} />
					<SummarySampleTable summary={summary} />
				</div>
			)}
		</div>
	)
}
