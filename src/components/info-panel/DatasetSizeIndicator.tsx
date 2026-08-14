/**
 * Dataset Size Indicator
 *
 * Shows the current dataset size with a progress bar relative to the upload threshold.
 * Displays a warning when over limit and offers to upload to Blossom.
 *
 * NOTE: This component does NOT auto-publish. It only uploads the blob and calls
 * onUploadComplete with the result. The parent component decides what to do with it.
 */

import { AlertTriangle, CloudUpload, CheckCircle2, Copy, ExternalLink } from 'lucide-react'
import { useMemo, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Progress } from '../ui/progress'
import { Button } from '../ui/button'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
import {
	formatBytes,
	uploadGeoJsonToBlossom,
	type BlossomUploadResult,
} from '@/lib/blossom/blossomUpload'
import type { FeatureCollection } from 'geojson'
import { cn } from '@/lib/utils'
import { serializedJsonBytes } from '@/lib/geo/serializedSize'

interface DatasetSizeIndicatorProps {
	/** The current feature collection to measure */
	featureCollection: FeatureCollection | null
	/** Called when upload completes - should add blob reference to store, NOT publish */
	onUploadComplete?: (result: BlossomUploadResult) => void
	/** If set, indicates the dataset is already stored externally (e.g. loaded from an event blob tag). */
	existingBlob?: { url: string; sha256?: string; size?: number } | null
	/** Show compact version */
	compact?: boolean
	className?: string
}

export function DatasetSizeIndicator({
	featureCollection,
	onUploadComplete,
	existingBlob = null,
	compact = false,
	className,
}: DatasetSizeIndicatorProps) {
	const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
	const [uploadError, setUploadError] = useState<string | null>(null)
	const [uploadResult, setUploadResult] = useState<BlossomUploadResult | null>(null)
	const [copied, setCopied] = useState(false)

	const effectiveExistingBlob = existingBlob?.url
		? ({
				url: existingBlob.url,
				sha256: existingBlob.sha256 ?? '',
				size: existingBlob.size ?? 0,
			} satisfies BlossomUploadResult)
		: null

	const effectiveResult = uploadResult ?? effectiveExistingBlob
	const isStoredExternally = Boolean(effectiveExistingBlob)

	const { size, percentOfLimit, isOverLimit } = useMemo(() => {
		if (!featureCollection) {
			return { size: 0, percentOfLimit: 0, isOverLimit: false }
		}
		const bytes = serializedJsonBytes(featureCollection)
		const percent = (bytes / BLOSSOM_UPLOAD_THRESHOLD_BYTES) * 100
		return {
			size: bytes,
			percentOfLimit: percent,
			isOverLimit: bytes > BLOSSOM_UPLOAD_THRESHOLD_BYTES,
		}
	}, [featureCollection])

	const handleCopyUrl = useCallback(async () => {
		if (!effectiveResult?.url) return
		try {
			await navigator.clipboard.writeText(effectiveResult.url)
			setCopied(true)
			toast.success('URL copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			// Fallback
			const textarea = document.createElement('textarea')
			textarea.value = effectiveResult.url
			document.body.appendChild(textarea)
			textarea.select()
			document.execCommand('copy')
			document.body.removeChild(textarea)
			setCopied(true)
			toast.success('URL copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		}
	}, [effectiveResult?.url])

	const handleUpload = async () => {
		if (!featureCollection) return

		setUploadState('uploading')
		setUploadError(null)
		setUploadResult(null)

		try {
			const result = await uploadGeoJsonToBlossom(featureCollection)
			setUploadState('success')
			setUploadResult(result)
			// Notify parent - should add blob reference to store, NOT publish
			onUploadComplete?.(result)

			toast.success('Upload complete!', {
				description: `Blob stored. Click "Publish" when ready.`,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Upload failed'
			setUploadError(errorMessage)
			setUploadState('error')

			toast.error('Upload failed', {
				description: errorMessage,
			})
		}
	}

	// Don't show if no data
	if (!featureCollection || size === 0) {
		return null
	}

	// Compact version - just shows warning icon when over limit
	if (compact) {
		if (!isOverLimit) return null
		return (
			<div
				className={cn(
					'flex items-center gap-1',
					isStoredExternally ? 'text-ok' : 'text-primary',
					className,
				)}
			>
				{isStoredExternally ? (
					<CheckCircle2 className="h-3 w-3" />
				) : (
					<AlertTriangle className="h-3 w-3" />
				)}
				<span className="text-[10px]">
					{formatBytes(size)} / {formatBytes(BLOSSOM_UPLOAD_THRESHOLD_BYTES)}
				</span>
			</div>
		)
	}

	return (
		<div
			className={cn(
				'space-y-2 rounded-md border p-2',
				isOverLimit
					? isStoredExternally
						? 'border-ok/40 bg-ok/15'
						: 'border-primary/40 bg-primary/10'
					: 'border-border bg-muted',
				className,
			)}
		>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					{isOverLimit ? (
						isStoredExternally ? (
							<CheckCircle2 className="h-3.5 w-3.5 text-ok" />
						) : (
							<AlertTriangle className="h-3.5 w-3.5 text-primary" />
						)
					) : (
						<CheckCircle2 className="h-3.5 w-3.5 text-ok" />
					)}
					<span className="text-xs font-medium">
						{isOverLimit
							? isStoredExternally
								? 'Stored externally'
								: 'Upload required'
							: 'Dataset size OK'}
					</span>
				</div>
				<span className="text-[10px] text-muted-foreground">
					{formatBytes(size)} / {formatBytes(BLOSSOM_UPLOAD_THRESHOLD_BYTES)}
				</span>
			</div>

			{/* Progress bar */}
			<Progress
				value={Math.min(percentOfLimit, 100)}
				className={cn(
					'h-1.5',
					isOverLimit && !isStoredExternally && '[&>div]:bg-primary',
					(!isOverLimit || isStoredExternally) && '[&>div]:bg-ok',
				)}
			/>

			{/* Warning message and upload button */}
			{isOverLimit && (
				<div className="space-y-2">
					{isStoredExternally ? (
						<p className="text-[10px] text-ok">
							This dataset exceeds the safe inline publish limit, but it already has an external
							blob reference.
						</p>
					) : (
						<p className="text-[10px] text-primary">
							This dataset exceeds the safe inline publish limit. Upload to Blossom to store it
							externally.
						</p>
					)}

					{uploadState === 'idle' && !isStoredExternally && (
						<Button
							size="sm"
							variant="outline"
							onClick={handleUpload}
							className="w-full gap-1.5 h-7 text-xs border-primary/40 hover:bg-primary/10"
						>
							<CloudUpload className="h-3 w-3" />
							Upload to Blossom
						</Button>
					)}

					{uploadState === 'uploading' && (
						<Button size="sm" disabled className="w-full h-7 text-xs">
							Uploading...
						</Button>
					)}

					{((uploadState === 'success' && uploadResult) ||
						(uploadState === 'idle' && effectiveExistingBlob)) && (
						<div className="space-y-2">
							<div className="text-[10px] text-ok flex items-center gap-1">
								<CheckCircle2 className="h-3 w-3" />
								{uploadState === 'success'
									? 'Uploaded! Click Publish when ready.'
									: 'External blob reference detected.'}
							</div>
							<div className="flex items-center gap-1 bg-card rounded border border-ok/40 p-1.5">
								<code className="text-[9px] text-ok break-all flex-1 select-all">
									{(uploadState === 'success' ? uploadResult?.url : effectiveExistingBlob?.url) ??
										''}
								</code>
							</div>
							<div className="flex items-center gap-1">
								<Button
									size="sm"
									variant="outline"
									className="h-6 text-[10px] gap-1 px-2"
									onClick={handleCopyUrl}
								>
									<Copy className="h-2.5 w-2.5" />
									{copied ? 'Copied!' : 'Copy'}
								</Button>
								<Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2" asChild>
									<a href={effectiveResult?.url ?? ''} target="_blank" rel="noopener noreferrer">
										<ExternalLink className="h-2.5 w-2.5" />
										Open
									</a>
								</Button>
								<Button
									size="sm"
									variant="outline"
									className="h-6 text-[10px] gap-1 px-2"
									onClick={handleUpload}
								>
									<CloudUpload className="h-2.5 w-2.5" />
									Re-upload
								</Button>
							</div>
						</div>
					)}

					{uploadState === 'error' && uploadError && (
						<div className="space-y-1">
							<p className="text-[10px] text-destructive">{uploadError}</p>
							<Button
								size="sm"
								variant="outline"
								onClick={handleUpload}
								className="w-full h-7 text-xs"
							>
								Retry
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

/**
 * Hook to get the current dataset size info for use in other components.
 */
export function useDatasetSize(featureCollection: FeatureCollection | null) {
	return useMemo(() => {
		if (!featureCollection) {
			return { size: 0, percentOfLimit: 0, isOverLimit: false, formattedSize: '0 B' }
		}
		const bytes = serializedJsonBytes(featureCollection)
		const percent = (bytes / BLOSSOM_UPLOAD_THRESHOLD_BYTES) * 100
		return {
			size: bytes,
			percentOfLimit: percent,
			isOverLimit: bytes > BLOSSOM_UPLOAD_THRESHOLD_BYTES,
			formattedSize: formatBytes(bytes),
		}
	}, [featureCollection])
}
