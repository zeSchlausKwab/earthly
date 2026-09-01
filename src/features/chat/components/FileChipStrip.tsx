import { Paperclip } from 'lucide-react'
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { evictDataset } from '../ingest/ingestStore'
import { type AttachDeps, handleAttachedFile } from './fileAttachHandler'
import { type AttachedFileView, FileChip, type ImageVisionTier } from './FileChip'

interface FileChipStripProps {
	/** Controlled list of attached-file views (mirrors `ChatGeometryAttachment`). */
	files: AttachedFileView[]
	onChange: (files: AttachedFileView[]) => void
	/** Current image vision tier — stamped onto image chips for styling. */
	visionTier?: ImageVisionTier
	/** Injected for testability; defaults to the real pipeline. */
	deps?: AttachDeps
	className?: string
}

export interface FileChipStripHandle {
	/** Attach files supplied by a non-picker source, such as a clipboard paste. */
	attachFiles: (files: FileList | File[]) => Promise<void>
}

// IN-03: a module-level monotonic counter guarantees the non-crypto fallback id
// is unique even when several files are seeded in the same tick (Date.now() +
// Math.random() could collide and mis-route a parse result, since the id keys
// both the React list and the update-by-id map).
let fileIdCounter = 0

function makeId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID()
	}
	fileIdCounter += 1
	return `file-${Date.now()}-${fileIdCounter}-${Math.random().toString(36).slice(2)}`
}

/**
 * The D-10 file-chip strip: an `Attach file` button AND drag-and-drop onto the
 * input region (INGEST-01), one `FileChip` per attached file with off-thread
 * parse status (INGEST-02/05). Mounted ALONGSIDE `ChatGeometryAttachment` — not
 * folded in. Absent (renders nothing chrome-heavy) until a file is attached,
 * matching the geometry-attachment pattern; the trigger button stays visible so
 * the user can attach the first file.
 */
export const FileChipStrip = forwardRef<FileChipStripHandle, FileChipStripProps>(
	function FileChipStrip({ files, onChange, visionTier, deps, className }, ref) {
		const inputRef = useRef<HTMLInputElement>(null)
		const [dragActive, setDragActive] = useState(false)
		// `files` is the controlled source of truth; keep a ref so async parse
		// completions append against the latest list, not a stale closure.
		const filesRef = useRef(files)
		filesRef.current = files

		const processFiles = useCallback(
			async (fileList: FileList | File[]) => {
				const incoming = Array.from(fileList)
				if (incoming.length === 0) return

				// Seed one parsing chip per file synchronously, so the UI shows progress
				// immediately (off-thread parse never blocks — INGEST-02).
				const seeded: AttachedFileView[] = incoming.map((file) => ({
					id: makeId(),
					fileName: file.name,
					status: 'parsing',
				}))
				const next = [...filesRef.current, ...seeded]
				filesRef.current = next
				onChange(next)

				await Promise.all(
					incoming.map(async (file, index) => {
						const seededFile = seeded[index]
						if (!seededFile) return
						const chipId = seededFile.id
						const result = await handleAttachedFile(file, deps)

						const updated: AttachedFileView =
							result.status === 'parsed'
								? {
										id: chipId,
										fileName: result.fileName,
										status: 'parsed',
										summary: result.summary,
									}
								: result.status === 'image'
									? {
											id: chipId,
											fileName: result.fileName,
											status: 'image',
											imageUrl: result.imageUrl,
											visionTier,
										}
									: {
											id: chipId,
											fileName: result.fileName,
											status: 'failed',
											reason: result.reason,
										}

						const current = filesRef.current.map((f) => (f.id === chipId ? updated : f))
						filesRef.current = current
						onChange(current)
					}),
				)
			},
			[deps, onChange, visionTier],
		)

		useImperativeHandle(ref, () => ({ attachFiles: processFiles }), [processFiles])

		const handleRemove = useCallback(
			(id: string) => {
				const removed = filesRef.current.find((f) => f.id === id)
				const next = filesRef.current.filter((f) => f.id !== id)
				filesRef.current = next
				onChange(next)
				// WR-02: free the parsed dataset's `fullRows` from the session-only ingest
				// store when its chip is removed, so attach/remove cycles don't leak memory.
				const handleId = removed?.summary?.handleId
				if (handleId) evictDataset(handleId)
			},
			[onChange],
		)

		const handleDrop = useCallback(
			(event: React.DragEvent) => {
				event.preventDefault()
				setDragActive(false)
				if (event.dataTransfer?.files?.length) {
					void processFiles(event.dataTransfer.files)
				}
			},
			[processFiles],
		)

		return (
			// Drag-and-drop is a progressive enhancement of the always-present
			// `Attach file` button (which is keyboard-accessible); the wrapper itself
			// is only a drop target, not a focusable control.
			// biome-ignore lint/a11y/noStaticElementInteractions: drop-target wrapper; the Attach-file button is the accessible path
			<div
				className={cn('min-w-0', className)}
				onDragOver={(event) => {
					event.preventDefault()
					setDragActive(true)
				}}
				onDragLeave={() => setDragActive(false)}
				onDrop={handleDrop}
			>
				<div className="flex flex-wrap items-center gap-1.5">
					<Button
						type="button"
						variant={dragActive ? 'default' : 'outline'}
						size="sm"
						className="h-8 gap-1.5 text-xs"
						onClick={() => inputRef.current?.click()}
						title="Attach file"
					>
						<Paperclip className="h-3.5 w-3.5" />
						Attach file
					</Button>
					<input
						ref={inputRef}
						type="file"
						multiple
						className="hidden"
						onChange={(event) => {
							if (event.target.files?.length) {
								void processFiles(event.target.files)
							}
							event.target.value = ''
						}}
					/>
				</div>

				{dragActive && (
					<div className="mt-2 rounded-lg border border-dashed bg-muted p-2.5 text-center text-xs text-muted-foreground">
						Drop files to attach
					</div>
				)}

				{files.length > 0 && (
					<div className="mt-2 flex flex-wrap items-start gap-2">
						{files.map((file) => (
							<FileChip key={file.id} file={file} onRemove={handleRemove} />
						))}
					</div>
				)}
			</div>
		)
	},
)
