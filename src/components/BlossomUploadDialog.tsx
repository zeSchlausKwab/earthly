/**
 * Blossom Upload Dialog
 *
 * Shows a warning when dataset size exceeds the Nostr event limit
 * and offers to upload the geometry to the Blossom server.
 *
 * After upload, shows the URL with options to copy/open it.
 * Does NOT auto-publish - user can continue editing and publish later.
 */

import type { FeatureCollection } from 'geojson'
import {
	AlertTriangle,
	Cloud,
	CloudUpload,
	Loader2,
	CheckCircle2,
	Copy,
	ExternalLink,
	Send,
} from 'lucide-react'
import { useState, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Progress } from './ui/progress'
import {
	uploadGeoJsonToBlossom,
	formatBytes,
	type BlossomUploadResult,
} from '../lib/blossom/blossomUpload'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '../features/geo-editor/constants'

export interface BlossomUploadDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	geojson: FeatureCollection | null
	/** Called when user clicks "Publish Now" after upload */
	onPublishWithUpload?: (result: BlossomUploadResult) => void
	/** Called when upload completes - adds blob reference to editor state */
	onUploadComplete?: (result: BlossomUploadResult) => void
	/** Called when user chooses to skip upload (only if allowSkip is true) */
	onSkip?: () => void
	/** Allow skipping the upload (for optional uploads) */
	allowSkip?: boolean
	/** Title override */
	title?: string
}

type UploadState = 'idle' | 'uploading' | 'success' | 'error'

export function BlossomUploadDialog({
	open,
	onOpenChange,
	geojson,
	onPublishWithUpload,
	onUploadComplete,
	onSkip,
	allowSkip = false,
	title = 'Upload to Blossom',
}: BlossomUploadDialogProps) {
	const [uploadState, setUploadState] = useState<UploadState>('idle')
	const [uploadProgress, setUploadProgress] = useState(0)
	const [uploadError, setUploadError] = useState<string | null>(null)
	const [uploadResult, setUploadResult] = useState<BlossomUploadResult | null>(null)
	const [copied, setCopied] = useState(false)

	// Calculate current size - only when dialog is open to avoid expensive computation
	const { size, percentOfLimit, isOverLimit } = useMemo(() => {
		// Don't compute when dialog is closed - this is expensive for large datasets
		if (!open || !geojson) {
			return { size: 0, percentOfLimit: 0, isOverLimit: false }
		}
		const jsonString = JSON.stringify(geojson)
		const bytes = new TextEncoder().encode(jsonString).length
		const percent = (bytes / BLOSSOM_UPLOAD_THRESHOLD_BYTES) * 100
		return {
			size: bytes,
			percentOfLimit: percent,
			isOverLimit: bytes > BLOSSOM_UPLOAD_THRESHOLD_BYTES,
		}
	}, [geojson, open])

	const handleUpload = async () => {
		if (!geojson) return

		setUploadState('uploading')
		setUploadError(null)
		setUploadProgress(0)

		try {
			const result = await uploadGeoJsonToBlossom(geojson, {
				onProgress: setUploadProgress,
			})
			setUploadResult(result)
			setUploadState('success')
			// Notify parent that upload completed (to add blob reference to editor state)
			// but do NOT publish automatically
			onUploadComplete?.(result)

			toast.success('Upload complete!', {
				description: `Blob stored at ${result.url.split('/').pop()?.slice(0, 12)}...`,
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

	const handleCopyUrl = useCallback(async () => {
		if (!uploadResult?.url) return
		try {
			await navigator.clipboard.writeText(uploadResult.url)
			setCopied(true)
			toast.success('URL copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			// Fallback for older browsers
			const textarea = document.createElement('textarea')
			textarea.value = uploadResult.url
			document.body.appendChild(textarea)
			textarea.select()
			document.execCommand('copy')
			document.body.removeChild(textarea)
			setCopied(true)
			toast.success('URL copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		}
	}, [uploadResult?.url])

	const handleClose = () => {
		// Reset state when closing
		setUploadState('idle')
		setUploadProgress(0)
		setUploadError(null)
		setUploadResult(null)
		setCopied(false)
		onOpenChange(false)
	}

	const handleSkip = () => {
		handleClose()
		onSkip?.()
	}

	const handlePublishNow = () => {
		if (uploadResult && onPublishWithUpload) {
			onPublishWithUpload(uploadResult)
			handleClose()
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{uploadState === 'success' ? (
							<CheckCircle2 className="h-5 w-5 text-green-500" />
						) : isOverLimit ? (
							<AlertTriangle className="h-5 w-5 text-amber-500" />
						) : (
							<Cloud className="h-5 w-5 text-blue-500" />
						)}
						{uploadState === 'success' ? 'Upload Complete' : title}
					</DialogTitle>
					<DialogDescription>
						{uploadState === 'success' ? (
							'Your geometry has been uploaded to Blossom. You can continue editing or publish now.'
						) : isOverLimit ? (
							<>
								Your dataset is <strong>{formatBytes(size)}</strong>, which exceeds the{' '}
								<strong>{formatBytes(BLOSSOM_UPLOAD_THRESHOLD_BYTES)}</strong> limit for Nostr
								events.
							</>
						) : (
							<>
								Upload your geometry to Blossom for external storage. Current size:{' '}
								<strong>{formatBytes(size)}</strong>
							</>
						)}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Size progress bar */}
					{uploadState === 'idle' && (
						<div className="space-y-2">
							<div className="flex justify-between text-xs text-muted-foreground">
								<span>Dataset size</span>
								<span>{Math.round(percentOfLimit)}% of limit</span>
							</div>
							<Progress
								value={Math.min(percentOfLimit, 100)}
								className={percentOfLimit > 100 ? '[&>div]:bg-amber-500' : ''}
							/>
							{percentOfLimit > 100 && (
								<p className="text-xs text-amber-600">
									⚠️ {Math.round(percentOfLimit - 100)}% over the limit
								</p>
							)}
						</div>
					)}

					{/* Upload progress */}
					{uploadState === 'uploading' && (
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin" />
								Uploading to Blossom...
							</div>
							<Progress value={uploadProgress} />
						</div>
					)}

					{/* Success state with URL and actions */}
					{uploadState === 'success' && uploadResult && (
						<div className="space-y-3">
							<div className="rounded-md bg-green-50 p-3 text-sm">
								<p className="font-medium text-green-800 mb-2">Uploaded successfully!</p>
								<div className="flex items-center gap-2 bg-white rounded border border-green-200 p-2">
									<code className="text-xs text-green-700 break-all flex-1 select-all">
										{uploadResult.url}
									</code>
								</div>
								<div className="flex items-center gap-2 mt-2">
									<Button
										size="sm"
										variant="outline"
										className="h-7 text-xs gap-1"
										onClick={handleCopyUrl}
									>
										<Copy className="h-3 w-3" />
										{copied ? 'Copied!' : 'Copy URL'}
									</Button>
									<Button size="sm" variant="outline" className="h-7 text-xs gap-1" asChild>
										<a href={uploadResult.url} target="_blank" rel="noopener noreferrer">
											<ExternalLink className="h-3 w-3" />
											Open
										</a>
									</Button>
								</div>
								<p className="text-xs text-green-600 mt-2">
									Size: {formatBytes(uploadResult.size)} • SHA-256:{' '}
									{uploadResult.sha256.slice(0, 12)}...
								</p>
							</div>
							<p className="text-xs text-muted-foreground">
								The blob reference has been added to your dataset. You can continue editing or
								publish now.
							</p>
						</div>
					)}

					{/* Error state */}
					{uploadState === 'error' && uploadError && (
						<div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{uploadError}</div>
					)}

					{/* Info text */}
					{uploadState === 'idle' && (
						<div className="text-xs text-muted-foreground">
							<p>
								Uploading to Blossom stores the full geometry externally. The Nostr event will
								contain a reference link and metadata for discovery.
							</p>
						</div>
					)}
				</div>

				<DialogFooter className="gap-2 sm:gap-0">
					{uploadState === 'idle' && (
						<>
							{allowSkip && onSkip && (
								<Button variant="outline" onClick={handleSkip}>
									Skip
								</Button>
							)}
							<Button variant="ghost" onClick={handleClose}>
								Cancel
							</Button>
							<Button onClick={handleUpload} className="gap-2">
								<CloudUpload className="h-4 w-4" />
								Upload to Blossom
							</Button>
						</>
					)}
					{uploadState === 'uploading' && (
						<Button disabled>
							<Loader2 className="h-4 w-4 animate-spin mr-2" />
							Uploading...
						</Button>
					)}
					{uploadState === 'success' && (
						<>
							<Button variant="outline" onClick={handleClose}>
								Continue Editing
							</Button>
							{onPublishWithUpload && (
								<Button onClick={handlePublishNow} className="gap-2">
									<Send className="h-4 w-4" />
									Publish Now
								</Button>
							)}
						</>
					)}
					{uploadState === 'error' && (
						<>
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button onClick={handleUpload}>Retry</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
