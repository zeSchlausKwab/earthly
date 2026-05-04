import NDKBlossom from '@nostr-dev-kit/blossom'
import type { NDKSigner as BlossomSigner, NDKUser as BlossomUser } from '@nostr-dev-kit/ndk'
import type NDKType from '@nostr-dev-kit/ndk'
import { useNDK, type NDKImetaTag, type NDKSigner } from '@nostr-dev-kit/react'
import { useActiveAccount } from 'applesauce-react/hooks'
import {
	Check,
	CloudUpload,
	ExternalLink,
	Image as ImageIcon,
	ImageUp,
	Link2,
	Loader2,
	Server,
	Trash2,
	Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'
import { config } from '@/config'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ServerMode = 'recommended' | 'custom'

export interface BlossomUploaderResult {
	url: string
	sha256?: string
	mimeType?: string
	size?: number
	imeta: NDKImetaTag
	fileName?: string
	source: 'upload' | 'library' | 'healed'
}

interface BlossomUploaderButtonProps {
	onUploaded: (result: BlossomUploaderResult) => void
	accept?: string
	currentUrl?: string
	title?: string
	description?: string
	defaultServer?: string
	signer?: NDKSigner | null
	buttonLabel?: string
	buttonVariant?: ComponentProps<typeof Button>['variant']
	buttonSize?: ComponentProps<typeof Button>['size']
	className?: string
	disabled?: boolean
	iconOnly?: boolean
}

function normalizeServerUrl(value: string): string {
	return value.trim().replace(/\/+$/, '')
}

function parseBytes(value?: string): number | undefined {
	if (!value) return undefined
	const numeric = Number(value)
	return Number.isFinite(numeric) ? numeric : undefined
}

function formatBytes(bytes?: number): string {
	if (!bytes || bytes <= 0) return 'Unknown size'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function isImageAccept(accept: string): boolean {
	return accept.split(',').some((part) => part.trim().startsWith('image/'))
}

function isAcceptedBlob(imeta: NDKImetaTag, accept: string): boolean {
	const mimeType = imeta.m ?? ''
	if (!accept.trim()) return true
	if (isImageAccept(accept)) return mimeType.startsWith('image/')
	return true
}

function toUploaderResult(
	imeta: NDKImetaTag,
	source: BlossomUploaderResult['source'],
	fileName?: string,
): BlossomUploaderResult {
	return {
		url: imeta.url ?? '',
		sha256: imeta.x,
		mimeType: imeta.m,
		size: parseBytes(imeta.size),
		imeta,
		fileName,
		source,
	}
}

export function BlossomUploaderButton({
	onUploaded,
	accept = 'image/*',
	currentUrl,
	title = 'Upload To Blossom',
	description = 'Upload an image, reuse an existing blob, or repair a broken Blossom URL.',
	defaultServer = config.blossomServer,
	signer = null,
	buttonLabel = 'Upload',
	buttonVariant = 'outline',
	buttonSize = 'sm',
	className,
	disabled = false,
	iconOnly = false,
}: BlossomUploaderButtonProps) {
	const { ndk } = useNDK()
	const currentUser = useActiveAccount()
	const activeUser = currentUser ?? ndk?.activeUser ?? null
	const blossom = useMemo(
		() =>
			ndk
				? new NDKBlossom(
						ndk as unknown as NDKType,
						(signer ?? undefined) as BlossomSigner | undefined,
					)
				: null,
		[ndk, signer],
	)

	const [open, setOpen] = useState(false)
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string | null>(null)
	const [serverMode, setServerMode] = useState<ServerMode>('recommended')
	const [customServer, setCustomServer] = useState(defaultServer)
	const [uploading, setUploading] = useState(false)
	const [uploadProgress, setUploadProgress] = useState(0)
	const [uploadError, setUploadError] = useState<string | null>(null)
	const [discoveredServers, setDiscoveredServers] = useState<string[]>([])
	const [loadingDiscovery, setLoadingDiscovery] = useState(false)
	const [discoveryError, setDiscoveryError] = useState<string | null>(null)
	const [libraryItems, setLibraryItems] = useState<NDKImetaTag[]>([])
	const [loadingLibrary, setLoadingLibrary] = useState(false)
	const [libraryError, setLibraryError] = useState<string | null>(null)
	const [deletingHash, setDeletingHash] = useState<string | null>(null)
	const [healing, setHealing] = useState(false)
	const fileInputRef = useRef<HTMLInputElement | null>(null)

	useEffect(() => {
		setCustomServer(defaultServer)
	}, [defaultServer])

	useEffect(() => {
		if (!selectedFile) {
			setSelectedPreviewUrl(null)
			return
		}
		const previewUrl = URL.createObjectURL(selectedFile)
		setSelectedPreviewUrl(previewUrl)
		return () => URL.revokeObjectURL(previewUrl)
	}, [selectedFile])

	const filteredLibraryItems = useMemo(
		() => libraryItems.filter((item) => item.url && isAcceptedBlob(item, accept)),
		[libraryItems, accept],
	)

	const canHealCurrentUrl = Boolean(currentUrl?.trim() && activeUser && blossom)
	const hasCustomServer = normalizeServerUrl(customServer).length > 0

	const resetTransientState = useCallback(() => {
		setSelectedFile(null)
		setServerMode('recommended')
		setUploadProgress(0)
		setUploadError(null)
		setHealing(false)
		setDeletingHash(null)
	}, [])

	const closeDialog = useCallback(() => {
		setOpen(false)
		resetTransientState()
	}, [resetTransientState])

	const loadDiscovery = useCallback(async () => {
		if (!open || !blossom || !activeUser) {
			setDiscoveredServers([])
			setDiscoveryError(null)
			return
		}

		setLoadingDiscovery(true)
		setDiscoveryError(null)
		try {
			const serverList = await blossom.getServerList(activeUser as unknown as BlossomUser)
			setDiscoveredServers(serverList?.servers ?? [])
		} catch (error) {
			console.error('Failed to load blossom server list:', error)
			setDiscoveryError(error instanceof Error ? error.message : 'Failed to load Blossom servers')
			setDiscoveredServers([])
		} finally {
			setLoadingDiscovery(false)
		}
	}, [open, blossom, activeUser])

	const loadLibrary = useCallback(async () => {
		if (!open || !blossom || !activeUser) {
			setLibraryItems([])
			setLibraryError(null)
			return
		}

		setLoadingLibrary(true)
		setLibraryError(null)
		try {
			const blobs = await blossom.listBlobs(activeUser as unknown as BlossomUser)
			setLibraryItems(blobs)
		} catch (error) {
			console.error('Failed to load blossom library:', error)
			setLibraryError(error instanceof Error ? error.message : 'Failed to load your blobs')
			setLibraryItems([])
		} finally {
			setLoadingLibrary(false)
		}
	}, [open, blossom, activeUser])

	useEffect(() => {
		if (!open) return
		void loadDiscovery()
		void loadLibrary()
	}, [open, loadDiscovery, loadLibrary])

	const handleSelectExisting = useCallback(
		(imeta: NDKImetaTag) => {
			const result = toUploaderResult(imeta, 'library')
			onUploaded(result)
			toast.success('Blossom URL inserted')
			closeDialog()
		},
		[onUploaded, closeDialog],
	)

	const handleDeleteExisting = useCallback(
		async (imeta: NDKImetaTag) => {
			if (!blossom || !imeta.x) return
			setDeletingHash(imeta.x)
			try {
				const deleted = await blossom.deleteBlob(imeta.x)
				if (!deleted) {
					throw new Error('The server rejected the delete request.')
				}
				setLibraryItems((current) => current.filter((item) => item.x !== imeta.x))
				toast.success('Blob deleted')
			} catch (error) {
				console.error('Failed to delete blossom blob:', error)
				toast.error(error instanceof Error ? error.message : 'Failed to delete blob')
			} finally {
				setDeletingHash(null)
			}
		},
		[blossom],
	)

	const handleRepairCurrentUrl = useCallback(async () => {
		if (!blossom || !activeUser || !currentUrl?.trim()) return
		setHealing(true)
		setUploadError(null)
		try {
			const healedUrl = await blossom.fixUrl(
				activeUser as unknown as BlossomUser,
				currentUrl.trim(),
			)
			const result = toUploaderResult({ url: healedUrl }, 'healed')
			onUploaded(result)
			toast.success(healedUrl === currentUrl.trim() ? 'URL is already healthy' : 'URL repaired')
			closeDialog()
		} catch (error) {
			console.error('Failed to repair blossom URL:', error)
			setUploadError(error instanceof Error ? error.message : 'Failed to repair URL')
			toast.error(error instanceof Error ? error.message : 'Failed to repair URL')
		} finally {
			setHealing(false)
		}
	}, [blossom, activeUser, currentUrl, onUploaded, closeDialog])

	const handleUpload = useCallback(async () => {
		if (!blossom || !selectedFile) return

		const normalizedCustomServer = normalizeServerUrl(customServer)
		if (serverMode === 'custom' && !normalizedCustomServer) {
			setUploadError('Enter a Blossom server URL.')
			return
		}

		setUploading(true)
		setUploadError(null)
		setUploadProgress(0)

		try {
			const imeta = await blossom.upload(selectedFile, {
				server: serverMode === 'custom' ? normalizedCustomServer : undefined,
				fallbackServer: serverMode === 'recommended' ? defaultServer : undefined,
				signer: (signer ?? undefined) as BlossomSigner | undefined,
				onProgress: (progress) => {
					if (progress.total > 0) {
						setUploadProgress(Math.round((progress.loaded / progress.total) * 100))
					}
					return 'continue'
				},
			})

			const result = toUploaderResult(imeta, 'upload', selectedFile.name)
			onUploaded(result)
			toast.success('Uploaded to Blossom', {
				description: result.url,
			})
			closeDialog()
		} catch (error) {
			console.error('Failed to upload to blossom:', error)
			const message = error instanceof Error ? error.message : 'Failed to upload image'
			setUploadError(message)
			toast.error(message)
		} finally {
			setUploading(false)
		}
	}, [
		blossom,
		selectedFile,
		customServer,
		serverMode,
		defaultServer,
		signer,
		onUploaded,
		closeDialog,
	])

	const effectiveDescription = useMemo(() => {
		if (serverMode === 'custom') {
			return hasCustomServer
				? `Upload straight to ${normalizeServerUrl(customServer)}.`
				: 'Choose a custom Blossom server for this upload.'
		}

		if (!activeUser) {
			return `Upload will use the fallback server ${defaultServer}.`
		}

		if (discoveredServers.length > 0) {
			return `Uploads try your ${discoveredServers.length} announced Blossom server${discoveredServers.length === 1 ? '' : 's'} first, then fall back to ${defaultServer}.`
		}

		return `No announced Blossom servers were found. Upload will use the fallback server ${defaultServer}.`
	}, [
		serverMode,
		hasCustomServer,
		customServer,
		activeUser,
		discoveredServers.length,
		defaultServer,
	])

	const triggerDisabled = disabled || !ndk
	const serverModeButtonClass = (mode: ServerMode) =>
		cn(
			'h-10 flex-1 justify-center rounded-lg border px-3 text-sm shadow-none transition-colors',
			serverMode === mode
				? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 hover:text-white'
				: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900',
		)

	return (
		<>
			<Button
				type="button"
				variant={buttonVariant}
				size={buttonSize}
				className={cn('shrink-0 whitespace-nowrap', className)}
				onClick={() => setOpen(true)}
				disabled={triggerDisabled}
				aria-label={buttonLabel}
			>
				<ImageUp className="h-4 w-4" />
				{iconOnly ? null : buttonLabel}
			</Button>

			<Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : closeDialog())}>
				<DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-3xl">
					<DialogHeader className="border-b border-slate-200 bg-white px-6 py-6">
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{description}</DialogDescription>
					</DialogHeader>

					<Tabs defaultValue="upload" className="flex max-h-[calc(88vh-6.5rem)] flex-col">
						<div className="border-b border-slate-200 px-6 py-4">
							<TabsList className="grid h-auto w-full grid-cols-2 rounded-xl border border-slate-200 bg-slate-100/80 p-1">
								<TabsTrigger
									value="upload"
									className="rounded-lg px-4 py-2.5 text-sm data-[state=active]:bg-white data-[state=active]:shadow-none"
								>
									Upload
								</TabsTrigger>
								<TabsTrigger
									value="library"
									disabled={!activeUser}
									className="rounded-lg px-4 py-2.5 text-sm data-[state=active]:bg-white data-[state=active]:shadow-none"
								>
									My Blobs
								</TabsTrigger>
							</TabsList>
						</div>

						<TabsContent value="upload" className="mt-0 overflow-y-auto px-6 py-5">
							<div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
								<div className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
									<div className="space-y-1">
										<p className="text-sm font-medium text-slate-900">Choose a file</p>
										<p className="text-xs text-slate-500">Accepted types: {accept || 'any file'}</p>
									</div>

									<input
										ref={fileInputRef}
										type="file"
										accept={accept}
										className="hidden"
										onChange={(event) => {
											const nextFile = event.target.files?.[0] ?? null
											setSelectedFile(nextFile)
											setUploadError(null)
										}}
									/>

									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										className={cn(
											'flex min-h-[18rem] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center transition hover:border-slate-400 hover:bg-slate-50',
											selectedFile && 'border-emerald-300 bg-emerald-50/40',
										)}
									>
										{selectedPreviewUrl ? (
											<img
												src={selectedPreviewUrl}
												alt={selectedFile?.name ?? 'Selected upload'}
												className="h-28 w-28 rounded-lg border border-slate-200 object-cover shadow-sm"
											/>
										) : (
											<div className="flex h-28 w-28 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400">
												<ImageIcon className="h-8 w-8" />
											</div>
										)}
										<div className="max-w-full space-y-1">
											<p className="break-all text-sm font-medium text-slate-900">
												{selectedFile ? selectedFile.name : 'Select an image'}
											</p>
											<p className="text-xs text-slate-500">
												{selectedFile ? formatBytes(selectedFile.size) : 'Click to browse'}
											</p>
										</div>
									</button>

									{uploadError ? (
										<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
											{uploadError}
										</div>
									) : null}

									{uploading ? (
										<div className="space-y-2">
											<div className="flex items-center justify-between text-xs text-slate-500">
												<span>Uploading to Blossom</span>
												<span>{uploadProgress}%</span>
											</div>
											<Progress value={uploadProgress} />
										</div>
									) : null}

									<div className="flex flex-wrap items-center gap-2">
										<Button
											type="button"
											onClick={() => void handleUpload()}
											disabled={!selectedFile || uploading || healing}
											className="min-w-28"
										>
											{uploading ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<CloudUpload className="h-4 w-4" />
											)}
											Upload
										</Button>
										{canHealCurrentUrl ? (
											<Button
												type="button"
												variant="outline"
												onClick={() => void handleRepairCurrentUrl()}
												disabled={uploading || healing}
												className="min-w-36 shadow-none"
											>
												{healing ? (
													<Loader2 className="h-4 w-4 animate-spin" />
												) : (
													<Wrench className="h-4 w-4" />
												)}
												Repair current URL
											</Button>
										) : null}
									</div>
								</div>

								<div className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
									<div className="space-y-1">
										<p className="text-sm font-medium text-slate-900">Server routing</p>
										<p className="text-xs leading-5 text-slate-500">{effectiveDescription}</p>
									</div>

									<div className="rounded-xl border border-slate-200 bg-slate-50 p-1">
										<div className="flex gap-1.5">
											<Button
												type="button"
												variant="outline"
												onClick={() => setServerMode('recommended')}
												className={serverModeButtonClass('recommended')}
											>
												<Server className="h-4 w-4" />
												Recommended
											</Button>
											<Button
												type="button"
												variant="outline"
												onClick={() => setServerMode('custom')}
												className={serverModeButtonClass('custom')}
											>
												<Link2 className="h-4 w-4" />
												Custom
											</Button>
										</div>
									</div>

									{serverMode === 'custom' ? (
										<div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
											<Label htmlFor="blossom-custom-server">Custom Blossom server</Label>
											<Input
												id="blossom-custom-server"
												value={customServer}
												onChange={(event) => setCustomServer(event.target.value)}
												placeholder="https://blossom.example.com"
											/>
										</div>
									) : (
										<div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
											<div className="flex items-center justify-between gap-3">
												<p className="text-xs font-medium text-slate-700">Discovered servers</p>
												{loadingDiscovery ? (
													<Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
												) : null}
											</div>
											{discoveryError ? (
												<p className="text-xs leading-5 text-amber-600">{discoveryError}</p>
											) : discoveredServers.length > 0 ? (
												<div className="space-y-1">
													{discoveredServers.map((server) => (
														<p
															key={server}
															className="break-all rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] leading-4 text-slate-600"
														>
															{server}
														</p>
													))}
												</div>
											) : (
												<p className="text-xs leading-5 text-slate-500">
													No Kind 10063 server list found for the current user.
												</p>
											)}
											<div className="break-all rounded-lg border border-dashed border-slate-300 bg-white px-2 py-1.5 text-[11px] leading-4 text-slate-500">
												Fallback: {defaultServer}
											</div>
										</div>
									)}

									{currentUrl?.trim() ? (
										<div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
											<p className="text-xs font-medium text-slate-700">Current field value</p>
											<p className="break-all text-[11px] leading-5 text-slate-500">
												{currentUrl.trim()}
											</p>
										</div>
									) : null}
								</div>
							</div>
						</TabsContent>

						<TabsContent value="library" className="mt-0 overflow-y-auto px-6 py-5">
							<div className="space-y-3">
								<div className="flex items-center justify-between gap-3">
									<div>
										<p className="text-sm font-medium text-slate-900">My Blossom uploads</p>
										<p className="text-xs text-slate-500">
											Reuse existing uploads instead of creating duplicates.
										</p>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => void loadLibrary()}
										disabled={loadingLibrary}
										className="shadow-none"
									>
										{loadingLibrary ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
									</Button>
								</div>

								{libraryError ? (
									<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
										{libraryError}
									</div>
								) : null}

								<ScrollArea className="h-[22rem] rounded-xl border border-slate-200">
									<div className="space-y-3 p-3">
										{loadingLibrary ? (
											<div className="flex h-32 items-center justify-center text-sm text-slate-500">
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												Loading blobs…
											</div>
										) : filteredLibraryItems.length > 0 ? (
											filteredLibraryItems.map((imeta) => {
												const hash = imeta.x ?? imeta.url ?? 'blob'
												const isDeleting = deletingHash === imeta.x
												const isImage = (imeta.m ?? '').startsWith('image/')
												return (
													<div
														key={hash}
														className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3"
													>
														<div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
															{isImage ? (
																<img
																	src={imeta.url}
																	alt={imeta.alt ?? 'Blossom upload'}
																	className="h-full w-full object-cover"
																/>
															) : (
																<ImageIcon className="h-5 w-5 text-slate-400" />
															)}
														</div>
														<div className="min-w-0 flex-1 space-y-1">
															<p className="truncate text-sm font-medium text-slate-900">
																{imeta.alt || imeta.url}
															</p>
															<p className="text-xs text-slate-500">
																{imeta.m || 'unknown type'} • {formatBytes(parseBytes(imeta.size))}
															</p>
															<p className="truncate text-[11px] text-slate-400">{imeta.url}</p>
														</div>
														<div className="flex shrink-0 items-center gap-1">
															<Button
																type="button"
																size="icon-sm"
																variant="outline"
																onClick={() => handleSelectExisting(imeta)}
																aria-label="Use this upload"
																className="shadow-none"
															>
																<Check className="h-4 w-4" />
															</Button>
															<Button
																type="button"
																size="icon-sm"
																variant="outline"
																asChild
																aria-label="Open upload"
																className="shadow-none"
															>
																<a href={imeta.url} target="_blank" rel="noopener noreferrer">
																	<ExternalLink className="h-4 w-4" />
																</a>
															</Button>
															<Button
																type="button"
																size="icon-sm"
																variant="outline"
																onClick={() => void handleDeleteExisting(imeta)}
																disabled={!imeta.x || isDeleting}
																aria-label="Delete upload"
																className="shadow-none"
															>
																{isDeleting ? (
																	<Loader2 className="h-4 w-4 animate-spin" />
																) : (
																	<Trash2 className="h-4 w-4" />
																)}
															</Button>
														</div>
													</div>
												)
											})
										) : (
											<div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
												No matching blobs found for this field yet.
											</div>
										)}
									</div>
								</ScrollArea>
							</div>
						</TabsContent>
					</Tabs>
				</DialogContent>
			</Dialog>
		</>
	)
}
