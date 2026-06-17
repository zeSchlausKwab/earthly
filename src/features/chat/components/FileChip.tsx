import {
	Braces,
	ChevronDown,
	FileSpreadsheet,
	FileText,
	Image as ImageIcon,
	Loader2,
	X,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { IngestSummary } from '../ingest/datasetTypes'

/** The per-file UI status the strip tracks for one chip. */
export type FileChipStatus = 'parsing' | 'parsed' | 'failed' | 'image'

/**
 * Vision tier carried onto an image chip so its visual language follows the
 * three-tier gate (UI-SPEC Color table): confirmed → normal, unconfirmed →
 * amber badge, unsupported → dimmed + hard-disabled tooltip surface.
 */
export type ImageVisionTier = 'vision' | 'uncertain' | 'no-vision'

export interface AttachedFileView {
	id: string
	fileName: string
	status: FileChipStatus
	/** Present when `status === 'parsed'`: the model-facing dataset summary. */
	summary?: IngestSummary
	/** Present when `status === 'failed'` or a rejected file: the error copy. */
	reason?: string
	/** Present when `status === 'image'`: the encoded data URL. */
	imageUrl?: string
	/** Present when `status === 'image'`: dimensions, once probed. */
	imageDimensions?: { width: number; height: number }
	/** Present when `status === 'image'`: the resolved vision tier for styling. */
	visionTier?: ImageVisionTier
}

interface FileChipProps {
	file: AttachedFileView
	onRemove: (id: string) => void
}

/** Pick the lucide type icon by dataset/image kind (UI-SPEC type-icon mapping). */
function TypeIcon({ file, className }: { file: AttachedFileView; className?: string }) {
	if (file.status === 'image') return <ImageIcon className={className} />
	const type = file.summary?.type
	if (type === 'csv' || type === 'xlsx') return <FileSpreadsheet className={className} />
	if (type === 'json' || type === 'geojson') return <Braces className={className} />
	return <FileText className={className} />
}

/** The compact, one-line parse stat (UI-SPEC Copywriting parse-summary copy). */
function compactStatLine(file: AttachedFileView): string {
	if (file.status === 'parsing') return 'Parsing…'
	if (file.status === 'failed') {
		return file.reason ?? `Couldn't parse ${file.fileName}.`
	}
	if (file.status === 'image') {
		const dims = file.imageDimensions
		return dims ? `${file.fileName} · ${dims.width}×${dims.height}` : file.fileName
	}
	const s = file.summary
	if (!s) return ''
	if (s.type === 'geojson') {
		const fc = s.typeStats?.featureCount ?? s.rowCount
		const types = s.typeStats?.geometryTypes?.join(', ')
		const bbox = s.typeStats?.bbox ? ' · bbox detected' : ''
		return `${fc} features${types ? ` · ${types}` : ''}${bbox}`
	}
	if (s.type === 'text') {
		const lines = s.typeStats?.lineCount
		const chars = s.typeStats?.charCount
		if (typeof lines === 'number' && typeof chars === 'number') {
			return `${lines} lines · ${chars} characters`
		}
		return `${s.rowCount} rows`
	}
	// tabular (csv/xlsx/json)
	const coords = s.detectedCoordinateColumns.length
	const more = s.moreColumns ? ` · …${s.moreColumns} more columns` : ''
	return `${s.rowCount} rows × ${s.columnCount} columns · ${coords} coordinate column(s) detected${more}`
}

/** Whether this chip has an expandable fuller summary (parsed data files only). */
function isExpandable(file: AttachedFileView): boolean {
	return file.status === 'parsed' && !!file.summary
}

export function FileChip({ file, onRemove }: FileChipProps) {
	const [open, setOpen] = useState(false)
	const isFailed = file.status === 'failed'
	const isParsing = file.status === 'parsing'
	const isImageUncertain = file.status === 'image' && file.visionTier === 'uncertain'
	const isImageUnsupported = file.status === 'image' && file.visionTier === 'no-vision'
	const expandable = isExpandable(file)

	const chipBody = (
		<div
			className={cn(
				'flex max-w-full items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs',
				isImageUnsupported && 'opacity-60',
				isImageUncertain && 'border-amber-300 dark:border-amber-700',
			)}
		>
			{isParsing ? (
				<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
			) : (
				<TypeIcon
					file={file}
					className={cn('h-3.5 w-3.5 shrink-0', isFailed && 'text-destructive')}
				/>
			)}
			<span className="min-w-0 truncate font-medium" title={file.fileName}>
				{file.fileName}
			</span>
			{isImageUncertain && (
				<span className="shrink-0 rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-600 dark:bg-amber-950 dark:text-amber-400">
					vision?
				</span>
			)}
			{expandable && (
				<ChevronDown
					className={cn(
						'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
						open && 'rotate-180',
					)}
				/>
			)}
			<Button
				type="button"
				size="icon"
				variant="ghost"
				className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
				onClick={(event) => {
					event.stopPropagation()
					onRemove(file.id)
				}}
				aria-label={`Remove ${file.fileName}`}
			>
				<X className="h-3 w-3" />
			</Button>
		</div>
	)

	return (
		<div className="flex max-w-full flex-col gap-1">
			{expandable ? (
				<Collapsible open={open} onOpenChange={setOpen}>
					<CollapsibleTrigger asChild>
						<button type="button" className="max-w-full text-left">
							{chipBody}
						</button>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<ExpandedSummary file={file} />
					</CollapsibleContent>
				</Collapsible>
			) : (
				chipBody
			)}
			{/* Compact caption stat line under the chip (status-colored). */}
			<p
				className={cn('px-1 text-[11px]', isFailed ? 'text-destructive' : 'text-muted-foreground')}
			>
				{isParsing && <Progress value={66} className="mb-1 h-1 w-24" />}
				{compactStatLine(file)}
			</p>
		</div>
	)
}

/** The fuller per-type summary shown when a parsed chip is expanded (no grid). */
function ExpandedSummary({ file }: { file: AttachedFileView }) {
	const s = file.summary
	if (!s) return null
	return (
		<div className="mt-1 space-y-2 rounded border bg-muted/40 p-2 text-[11px]">
			<p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				Summary
			</p>
			<div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
				<span>{s.rowCount} rows</span>
				<span>
					{s.columnCount} columns
					{s.moreColumns ? ` (+${s.moreColumns} capped)` : ''}
				</span>
				{s.detectedCoordinateColumns.length > 0 && (
					<span>coords: {s.detectedCoordinateColumns.join(', ')}</span>
				)}
			</div>
			{s.schema.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{s.schema.map((field) => (
						<span
							key={field.name}
							className="rounded border bg-background px-1.5 py-0.5 text-[10px]"
						>
							{field.name}
							<span className="ml-1 text-muted-foreground">{field.type}</span>
						</span>
					))}
				</div>
			)}
		</div>
	)
}
