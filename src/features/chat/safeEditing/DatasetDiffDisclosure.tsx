import { useMemo, useState } from 'react'
import { GitCompare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DatasetDiff } from '@/features/geo-editor/api/diff'
import type { EditorFeature } from '@/features/geo-editor/core'

/**
 * DatasetDiffDisclosure — the inline counts-headline diff block with Apply/Cancel
 * (SAFE-03 / D-04 / D-05 / D-08).
 *
 * It clones `CodeRunDisclosure`'s collapse idiom verbatim — a `useState` open
 * toggle + a `▸/▾` ghost `Button` with `aria-expanded` + a `useMemo` summary line
 * + the `rounded-lg border … bg-violet-50` shell with `text-[10px] uppercase
 * tracking-wide` section labels — so the safe-editing preview is visually
 * consistent with the run_code block in the transcript (D-04).
 *
 * UNLIKE `CodeRunDisclosure` (read-only, intentionally NO action affordance), this
 * block renders TWO inline buttons — Apply (primary) + Cancel (ghost) — wired to
 * injected `onApply`/`onCancel` callbacks (the pendingDiffStore resolvers in the
 * live wiring). Everything stays inline in the transcript — NO modal, NO portal
 * (D-08). A `status` prop renders the RESOLVED outcome (the diff stays visible,
 * the buttons are replaced by an "Applied"/"Cancelled" label) — this is what a
 * settled gate, AND a Level-3 auto-apply (status `'applied'`), shows (D-12).
 */

/** Terminal render state of a diff block. `pending` shows the live Apply/Cancel. */
export type DiffBlockStatus = 'pending' | 'applied' | 'cancelled'

/**
 * The D-05 counts headline: `+N added · ~N changed · −N deleted`, computed from a
 * `DatasetDiff`. Pure (mirrors `buildRunCodeSummary`), includes the zero cases.
 */
export function buildDatasetDiffSummary(diff: DatasetDiff): string {
	const added = diff.added.length
	const changed = diff.modified.length
	const deleted = diff.deleted.length
	return `+${added} added · ~${changed} changed · −${deleted} deleted`
}

/** Best-effort human label for a feature row: its name, else its id. */
function featureLabel(feature: EditorFeature): string {
	const name = feature.properties?.name
	if (typeof name === 'string' && name.trim() !== '') return name
	return String(feature.id)
}

interface DiffSectionProps {
	label: string
	rows: string[]
	tone: string
}

function DiffSection({ label, rows, tone }: DiffSectionProps) {
	if (rows.length === 0) return null
	return (
		<div>
			<div className={`mb-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}>
				{label} ({rows.length})
			</div>
			<div className="max-h-32 overflow-y-auto rounded border border-violet-200/70 bg-background/70 p-2 dark:border-violet-800/60">
				<ul className="space-y-0.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
					{rows.map((row, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are a static, non-reordering diff list; ids may repeat as labels
						<li key={`${label}-${i}`} className="truncate">
							{row}
						</li>
					))}
				</ul>
			</div>
		</div>
	)
}

interface DatasetDiffDisclosureProps {
	/** The classified add/modify/delete diff (Plan 01 `DatasetDiff`). */
	diff: DatasetDiff
	/** Commit the buffered mutation (resolves the gate's confirm to apply). */
	onApply: () => void
	/** Discard with zero editor mutation (resolves the gate's confirm to cancel). */
	onCancel: () => void
	/**
	 * Render expanded on first paint. Production starts collapsed; this exists so
	 * render-proof tests can assert the expanded markup.
	 */
	defaultOpen?: boolean
	/**
	 * `pending` (default) shows the live Apply/Cancel buttons; `applied`/`cancelled`
	 * shows the resolved outcome label (diff stays visible; Level-3 auto-apply uses
	 * `applied` — D-12).
	 */
	status?: DiffBlockStatus
}

export function DatasetDiffDisclosure({
	diff,
	onApply,
	onCancel,
	defaultOpen = false,
	status = 'pending',
}: DatasetDiffDisclosureProps) {
	const [isOpen, setIsOpen] = useState(defaultOpen)
	const summary = useMemo(() => buildDatasetDiffSummary(diff), [diff])

	const addedRows = useMemo(() => diff.added.map(featureLabel), [diff.added])
	const modifiedRows = useMemo(
		() => diff.modified.map((m) => featureLabel(m.after)),
		[diff.modified],
	)
	const deletedRows = useMemo(() => diff.deleted.map(featureLabel), [diff.deleted])

	return (
		<div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs dark:border-violet-800 dark:bg-violet-950">
			<div className="mb-1 flex items-center justify-between gap-2">
				<Button
					type="button"
					variant="ghost"
					onClick={() => setIsOpen((prev) => !prev)}
					className="h-auto min-w-0 p-0 text-left font-medium text-violet-700 dark:text-violet-300"
					aria-expanded={isOpen}
				>
					<span className="mr-1">{isOpen ? '▾' : '▸'}</span>
					<GitCompare className="mr-1 inline h-3 w-3" />
					<span className="truncate">{summary}</span>
				</Button>
			</div>

			{isOpen && (
				<div className="space-y-2">
					<DiffSection
						label="Added"
						rows={addedRows}
						tone="text-emerald-700/90 dark:text-emerald-300/90"
					/>
					<DiffSection
						label="Changed"
						rows={modifiedRows}
						tone="text-amber-700/90 dark:text-amber-300/90"
					/>
					<DiffSection
						label="Deleted"
						rows={deletedRows}
						tone="text-rose-700/90 dark:text-rose-300/90"
					/>
				</div>
			)}

			{/* Action / outcome row — inline, no modal (D-08) */}
			<div className="mt-2 flex items-center justify-end gap-2">
				{status === 'pending' ? (
					<>
						<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
							Cancel
						</Button>
						<Button type="button" size="sm" onClick={onApply}>
							Apply
						</Button>
					</>
				) : (
					<span
						className={`text-[11px] font-medium uppercase tracking-wide ${
							status === 'applied'
								? 'text-emerald-700 dark:text-emerald-300'
								: 'text-muted-foreground'
						}`}
					>
						{status === 'applied' ? 'Applied' : 'Cancelled'}
					</span>
				)}
			</div>
		</div>
	)
}
