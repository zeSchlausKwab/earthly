import { ExternalLink, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react'
import { useEditorStore } from '@/features/geo-editor/store'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

/**
 * Compact section for managing external GeoJSON blob references.
 * Inline add with minimal clicks.
 */
export function BlobReferencesSection() {
	const blobReferences = useEditorStore((state) => state.blobReferences)
	const blobDraftUrl = useEditorStore((state) => state.blobDraftUrl)
	const setBlobDraftUrl = useEditorStore((state) => state.setBlobDraftUrl)
	const blobDraftStatus = useEditorStore((state) => state.blobDraftStatus)
	const blobDraftError = useEditorStore((state) => state.blobDraftError)
	const previewingBlobReferenceId = useEditorStore((state) => state.previewingBlobReferenceId)
	const fetchBlobReference = useEditorStore((state) => state.fetchBlobReference)
	const previewBlobReference = useEditorStore((state) => state.previewBlobReference)
	const removeBlobReference = useEditorStore((state) => state.removeBlobReference)

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && blobDraftUrl && blobDraftStatus !== 'loading') {
			fetchBlobReference()
		}
	}

	return (
		<section className="space-y-2">
			<div className="text-xs font-medium text-foreground">External references</div>

			{/* Inline add */}
			<div className="flex items-center gap-1">
				<Input
					placeholder="https://…/dataset.geojson"
					value={blobDraftUrl}
					onChange={(e) => setBlobDraftUrl(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={blobDraftStatus === 'loading'}
					className="h-7 text-xs flex-1"
				/>
				<Button
					size="icon-xs"
					variant="outline"
					onClick={fetchBlobReference}
					disabled={!blobDraftUrl || blobDraftStatus === 'loading'}
					aria-label="Add reference"
				>
					<Plus className="h-3 w-3" />
				</Button>
			</div>

			{blobDraftStatus === 'error' && blobDraftError && (
				<p className="text-[10px] text-destructive">{blobDraftError}</p>
			)}

			{/* Reference list - compact */}
			{blobReferences.length > 0 && (
				<div className="space-y-1">
					{blobReferences.map((ref) => {
						const isPreviewing = previewingBlobReferenceId === ref.id && ref.status === 'ready'
						const isLoading = ref.status === 'loading'
						const isError = ref.status === 'error'

						// Extract filename from URL for compact display
						const filename = ref.url.split('/').pop() || ref.url

						return (
							<div
								key={ref.id}
								className={cn(
									'flex items-center gap-1 text-xs py-1 px-1.5 rounded border',
									isError ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-card',
								)}
							>
								<span className="flex-1 truncate text-foreground" title={ref.url}>
									{filename}
								</span>

								{ref.featureCount !== undefined && (
									<span className="text-[10px] text-muted-foreground">{ref.featureCount}</span>
								)}

								<div className="flex items-center gap-0.5">
									<Button
										size="icon-xs"
										variant="ghost"
										onClick={() => previewBlobReference(ref.id)}
										disabled={isLoading}
										aria-label={isPreviewing ? 'Hide preview' : 'Preview'}
									>
										{isPreviewing ? (
											<EyeOff className="h-3 w-3 text-info" />
										) : (
											<Eye className="h-3 w-3" />
										)}
									</Button>
									<Button
										size="icon-xs"
										variant="ghost"
										onClick={() => window.open(ref.url, '_blank')}
										aria-label="Open in new tab"
									>
										<ExternalLink className="h-3 w-3" />
									</Button>
									<Button
										size="icon-xs"
										variant="ghost"
										className="text-destructive hover:text-destructive"
										onClick={() => removeBlobReference(ref.id)}
										aria-label="Remove"
									>
										<Trash2 className="h-3 w-3" />
									</Button>
								</div>
							</div>
						)
					})}
				</div>
			)}
		</section>
	)
}
