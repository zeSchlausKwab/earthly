/**
 * Blossom uploader UI built on `blossom-client-sdk` + the active applesauce signer.
 *
 * Capabilities:
 *   - Upload to a "recommended" server (try each kind 10063 announced server in
 *     order, then fall back to `defaultServer`) or to a user-supplied custom URL.
 *   - List the user's existing blobs across announced servers, plus delete + reuse.
 *   - Repair (heal) a stale Blossom URL by re-resolving its sha256 across the
 *     user's announced servers and the default fallback.
 *
 * No NDK dependency — signing flows through `accounts.signer`.
 */

import {
	createDeleteAuth,
	createListAuth,
	createUploadAuth,
	type BlobDescriptor,
	type SignedEvent,
	type Signer,
} from 'blossom-client-sdk'
import { deleteBlob } from 'blossom-client-sdk/actions/delete'
import { listBlobs } from 'blossom-client-sdk/actions/list'
import { uploadBlob } from 'blossom-client-sdk/actions/upload'
import { use$, useActiveAccount } from 'applesauce-react/hooks'
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
import type { EventTemplate } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'
import { config } from '@/config'
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
import { downscaleImageToLimit } from '@/lib/blossom/downscaleImage'
import { accounts, eventStore } from '@/lib/nostr'
import { cn } from '@/lib/utils'

type ServerMode = 'recommended' | 'custom'

const BLOSSOM_SERVER_LIST_KIND = 10063

/**
 * Public result type. Kept stable across the NDK→applesauce rewrite — callers
 * generally only read `url`, but `sha256`/`size`/`mimeType` are still emitted
 * so things like the chat-image flow can reference the blob descriptor.
 */
export interface BlossomUploaderResult {
	url: string
	sha256?: string
	mimeType?: string
	size?: number
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

function isHttpServerUrl(value: string): boolean {
	try {
		const protocol = new URL(value).protocol
		return protocol === 'http:' || protocol === 'https:'
	} catch {
		return false
	}
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

function isAcceptedBlob(blob: BlobDescriptor, accept: string): boolean {
	const mimeType = blob.type ?? ''
	if (!accept.trim()) return true
	if (isImageAccept(accept)) return mimeType.startsWith('image/')
	return true
}

function descriptorToResult(
	blob: Pick<BlobDescriptor, 'url' | 'sha256' | 'type' | 'size'>,
	source: BlossomUploaderResult['source'],
	fileName?: string,
): BlossomUploaderResult {
	return {
		url: blob.url ?? '',
		sha256: blob.sha256,
		mimeType: blob.type,
		size: blob.size,
		fileName,
		source,
	}
}

/** Adapt the active applesauce signer to a blossom-client-sdk Signer. */
function makeBlossomSigner(): Signer {
	const signer = accounts.signer
	if (!signer) throw new Error('No active account — sign in first')
	return async (draft: EventTemplate) => signer.signEvent(draft) as Promise<SignedEvent>
}

/** Read the active account's announced Blossom servers from kind 10063. */
function useAnnouncedBlossomServers(pubkey: string | undefined): {
	servers: string[]
	loading: boolean
} {
	const event = use$(
		() => (pubkey ? eventStore.replaceable(BLOSSOM_SERVER_LIST_KIND, pubkey) : undefined),
		[pubkey],
	)

	const servers = useMemo(() => {
		if (!event) return []
		return event.tags
			.filter((tag) => tag[0] === 'server' && tag[1])
			.map((tag) => normalizeServerUrl(tag[1] as string))
			.filter(isHttpServerUrl)
	}, [event])

	return { servers, loading: !event && Boolean(pubkey) }
}

export function BlossomUploaderButton({
	onUploaded,
	accept = 'image/*',
	currentUrl,
	title = 'Upload To Blossom',
	description = 'Upload an image, reuse an existing blob, or repair a broken Blossom URL.',
	defaultServer = config.blossomServer,
	buttonLabel = 'Upload',
	buttonVariant = 'outline',
	buttonSize = 'sm',
	className,
	disabled = false,
	iconOnly = false,
}: BlossomUploaderButtonProps) {
	const activeAccount = useActiveAccount()
	const userPubkey = activeAccount?.pubkey

	const [open, setOpen] = useState(false)
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string | null>(null)
	const [serverMode, setServerMode] = useState<ServerMode>('recommended')
	const [customServer, setCustomServer] = useState(defaultServer)
	const [uploading, setUploading] = useState(false)
	const [uploadProgress, setUploadProgress] = useState(0)
	const [uploadError, setUploadError] = useState<string | null>(null)
	const [libraryItems, setLibraryItems] = useState<BlobDescriptor[]>([])
	const [loadingLibrary, setLoadingLibrary] = useState(false)
	const [libraryError, setLibraryError] = useState<string | null>(null)
	const [deletingHash, setDeletingHash] = useState<string | null>(null)
	const [healing, setHealing] = useState(false)
	const fileInputRef = useRef<HTMLInputElement | null>(null)

	const { servers: announcedServers, loading: loadingDiscovery } =
		useAnnouncedBlossomServers(userPubkey)

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

	const canHealCurrentUrl = Boolean(currentUrl?.trim() && userPubkey)
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

	const loadLibrary = useCallback(async () => {
		if (!open || !userPubkey) {
			setLibraryItems([])
			setLibraryError(null)
			return
		}

		setLoadingLibrary(true)
		setLibraryError(null)
		try {
			const targets = announcedServers.length > 0 ? announcedServers : [defaultServer]
			const seen = new Map<string, BlobDescriptor>()
			const errors: string[] = []
			await Promise.all(
				targets.map(async (server) => {
					try {
						const blobs = await listBlobs(server, userPubkey, {
							onAuth: async () => createListAuth(makeBlossomSigner()),
						})
						for (const blob of blobs) {
							if (!seen.has(blob.sha256)) seen.set(blob.sha256, blob)
						}
					} catch (err) {
						errors.push(`${server}: ${err instanceof Error ? err.message : String(err)}`)
					}
				}),
			)
			setLibraryItems(Array.from(seen.values()).sort((a, b) => b.uploaded - a.uploaded))
			if (seen.size === 0 && errors.length > 0) {
				setLibraryError(errors.join('\n'))
			}
		} catch (error) {
			console.error('Failed to load blossom library:', error)
			setLibraryError(error instanceof Error ? error.message : 'Failed to load your blobs')
			setLibraryItems([])
		} finally {
			setLoadingLibrary(false)
		}
	}, [open, userPubkey, announcedServers, defaultServer])

	useEffect(() => {
		if (!open) return
		void loadLibrary()
	}, [open, loadLibrary])

	const handleSelectExisting = useCallback(
		(blob: BlobDescriptor) => {
			onUploaded(descriptorToResult(blob, 'library'))
			toast.success('Blossom URL inserted')
			closeDialog()
		},
		[onUploaded, closeDialog],
	)

	const handleDeleteExisting = useCallback(
		async (blob: BlobDescriptor) => {
			if (!blob.sha256) return
			setDeletingHash(blob.sha256)
			try {
				const targets = announcedServers.length > 0 ? announcedServers : [defaultServer]
				let deleted = false
				for (const server of targets) {
					try {
						const ok = await deleteBlob(server, blob.sha256, {
							onAuth: async () => createDeleteAuth(makeBlossomSigner(), blob.sha256),
						})
						if (ok) deleted = true
					} catch {
						/* try next server */
					}
				}
				if (!deleted) throw new Error('No server accepted the delete request.')
				setLibraryItems((current) => current.filter((item) => item.sha256 !== blob.sha256))
				toast.success('Blob deleted')
			} catch (error) {
				console.error('Failed to delete blossom blob:', error)
				toast.error(error instanceof Error ? error.message : 'Failed to delete blob')
			} finally {
				setDeletingHash(null)
			}
		},
		[announcedServers, defaultServer],
	)

	const handleRepairCurrentUrl = useCallback(async () => {
		const original = currentUrl?.trim()
		if (!original || !userPubkey) return
		setHealing(true)
		setUploadError(null)
		try {
			// Extract sha256 from the URL: Blossom URLs are <server>/<sha256>[.<ext>].
			const filename = original.split('/').pop() ?? ''
			const sha256 = filename.split('.')[0] ?? ''
			if (!/^[0-9a-f]{64}$/i.test(sha256)) {
				throw new Error('Could not parse a sha256 from the current URL.')
			}

			const candidates = [...announcedServers, defaultServer, new URL(original).origin].map(
				normalizeServerUrl,
			)
			const tried = new Set<string>()

			for (const server of candidates) {
				if (!server || tried.has(server)) continue
				tried.add(server)
				const probe = `${server}/${sha256}`
				try {
					const res = await fetch(probe, { method: 'HEAD' })
					if (res.ok) {
						const result = descriptorToResult({ url: probe, sha256, size: 0 }, 'healed')
						onUploaded(result)
						toast.success(probe === original ? 'URL is already healthy' : 'URL repaired')
						closeDialog()
						return
					}
				} catch {
					/* try next */
				}
			}

			throw new Error('No server we know of has this blob.')
		} catch (error) {
			console.error('Failed to repair blossom URL:', error)
			setUploadError(error instanceof Error ? error.message : 'Failed to repair URL')
			toast.error(error instanceof Error ? error.message : 'Failed to repair URL')
		} finally {
			setHealing(false)
		}
	}, [currentUrl, userPubkey, announcedServers, defaultServer, onUploaded, closeDialog])

	const handleUpload = useCallback(async () => {
		if (!selectedFile || !userPubkey) return

		const normalizedCustomServer = normalizeServerUrl(customServer)
		if (serverMode === 'custom' && !isHttpServerUrl(normalizedCustomServer)) {
			setUploadError('Enter a valid http:// or https:// Blossom server URL.')
			return
		}

		setUploading(true)
		setUploadError(null)
		setUploadProgress(0)

		try {
			const targets =
				serverMode === 'custom'
					? [normalizedCustomServer]
					: [
							...announcedServers,
							...(announcedServers.includes(normalizeServerUrl(defaultServer))
								? []
								: [defaultServer]),
						]

			if (targets.length === 0) {
				throw new Error('No Blossom server available.')
			}

			// blossom.earthly.city caps uploads at ~1 MB — downscale images in
			// the browser when the default server is among the targets (SPEC §7.3).
			// Must happen before auth: the upload auth binds to the file hash.
			let uploadFile = selectedFile
			const normalizedDefault = normalizeServerUrl(defaultServer)
			if (targets.some((server) => normalizeServerUrl(server) === normalizedDefault)) {
				uploadFile = await downscaleImageToLimit(selectedFile)
				if (uploadFile !== selectedFile) {
					toast.info(`Image downscaled to ${(uploadFile.size / 1024).toFixed(0)} kB for upload`)
				}
			}

			setUploadProgress(20)
			const auth = await createUploadAuth(makeBlossomSigner(), uploadFile, {
				message: `Upload ${uploadFile.name}`,
				expiration: Math.floor(Date.now() / 1000) + 5 * 60,
			})
			setUploadProgress(40)

			let lastError: unknown = null
			let descriptor: BlobDescriptor | null = null
			for (const server of targets) {
				try {
					descriptor = await uploadBlob(server, uploadFile, { auth })
					break
				} catch (err) {
					lastError = err
				}
			}
			if (!descriptor) {
				throw lastError instanceof Error ? lastError : new Error('All servers rejected the upload.')
			}
			setUploadProgress(100)

			const result = descriptorToResult(descriptor, 'upload', uploadFile.name)
			onUploaded(result)
			toast.success('Uploaded to Blossom', { description: result.url })
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
		selectedFile,
		userPubkey,
		customServer,
		serverMode,
		announcedServers,
		defaultServer,
		onUploaded,
		closeDialog,
	])

	const effectiveDescription = useMemo(() => {
		if (serverMode === 'custom') {
			return hasCustomServer
				? `Upload straight to ${normalizeServerUrl(customServer)}.`
				: 'Choose a custom Blossom server for this upload.'
		}

		if (!userPubkey) {
			return `Upload will use the fallback server ${defaultServer}.`
		}

		if (announcedServers.length > 0) {
			return `Uploads try your ${announcedServers.length} announced Blossom server${announcedServers.length === 1 ? '' : 's'} first, then fall back to ${defaultServer}.`
		}

		return `No announced Blossom servers were found. Upload will use the fallback server ${defaultServer}.`
	}, [
		serverMode,
		hasCustomServer,
		customServer,
		userPubkey,
		announcedServers.length,
		defaultServer,
	])

	const triggerDisabled = disabled
	const serverModeButtonClass = (mode: ServerMode) =>
		cn(
			'h-10 flex-1 justify-center rounded-lg border px-3 text-sm shadow-none transition-colors',
			serverMode === mode
				? 'border-input bg-muted-foreground text-white hover:bg-muted-foreground hover:text-white'
				: 'border-border bg-card text-foreground hover:bg-muted hover:text-foreground',
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
					<DialogHeader className="border-b border-border bg-card px-6 py-6">
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{description}</DialogDescription>
					</DialogHeader>

					<Tabs defaultValue="upload" className="flex max-h-[calc(88vh-6.5rem)] flex-col">
						<div className="border-b border-border px-6 py-4">
							<TabsList className="grid h-auto w-full grid-cols-2 rounded-xl border border-border bg-muted/80 p-1">
								<TabsTrigger
									value="upload"
									className="rounded-lg px-4 py-2.5 text-sm data-[state=active]:bg-card data-[state=active]:shadow-none"
								>
									Upload
								</TabsTrigger>
								<TabsTrigger
									value="library"
									disabled={!userPubkey}
									className="rounded-lg px-4 py-2.5 text-sm data-[state=active]:bg-card data-[state=active]:shadow-none"
								>
									My Blobs
								</TabsTrigger>
							</TabsList>
						</div>

						<TabsContent value="upload" className="mt-0 overflow-y-auto px-6 py-5">
							<div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
								<div className="min-w-0 space-y-3 rounded-xl border border-border bg-muted/70 p-4">
									<div className="space-y-1">
										<p className="text-sm font-medium text-foreground">Choose a file</p>
										<p className="text-xs text-muted-foreground">
											Accepted types: {accept || 'any file'}
										</p>
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
											'flex min-h-[18rem] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center transition hover:border-border hover:bg-muted',
											selectedFile && 'border-ok/40 bg-ok/15',
										)}
									>
										{selectedPreviewUrl ? (
											<img
												src={selectedPreviewUrl}
												alt={selectedFile?.name ?? 'Selected upload'}
												className="h-28 w-28 rounded-lg border border-border object-cover shadow-sm"
											/>
										) : (
											<div className="flex h-28 w-28 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
												<ImageIcon className="h-8 w-8" />
											</div>
										)}
										<div className="max-w-full space-y-1">
											<p className="break-all text-sm font-medium text-foreground">
												{selectedFile ? selectedFile.name : 'Select an image'}
											</p>
											<p className="text-xs text-muted-foreground">
												{selectedFile ? formatBytes(selectedFile.size) : 'Click to browse'}
											</p>
										</div>
									</button>

									{uploadError ? (
										<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
											{uploadError}
										</div>
									) : null}

									{uploading ? (
										<div className="space-y-2">
											<div className="flex items-center justify-between text-xs text-muted-foreground">
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

								<div className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
									<div className="space-y-1">
										<p className="text-sm font-medium text-foreground">Server routing</p>
										<p className="text-xs leading-5 text-muted-foreground">
											{effectiveDescription}
										</p>
									</div>

									<div className="rounded-xl border border-border bg-muted p-1">
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
										<div className="space-y-2 rounded-xl border border-border bg-muted/70 p-3">
											<Label htmlFor="blossom-custom-server">Custom Blossom server</Label>
											<Input
												id="blossom-custom-server"
												value={customServer}
												onChange={(event) => setCustomServer(event.target.value)}
												placeholder="https://blossom.example.com"
											/>
										</div>
									) : (
										<div className="space-y-2 rounded-xl border border-border bg-muted p-3">
											<div className="flex items-center justify-between gap-3">
												<p className="text-xs font-medium text-foreground">Discovered servers</p>
												{loadingDiscovery ? (
													<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
												) : null}
											</div>
											{announcedServers.length > 0 ? (
												<div className="space-y-1">
													{announcedServers.map((server) => (
														<p
															key={server}
															className="break-all rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] leading-4 text-muted-foreground"
														>
															{server}
														</p>
													))}
												</div>
											) : (
												<p className="text-xs leading-5 text-muted-foreground">
													No Kind 10063 server list found for the current user.
												</p>
											)}
											<div className="break-all rounded-lg border border-dashed border-border bg-card px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
												Fallback: {defaultServer}
											</div>
										</div>
									)}

									{currentUrl?.trim() ? (
										<div className="space-y-2 rounded-xl border border-border bg-muted p-3">
											<p className="text-xs font-medium text-foreground">Current field value</p>
											<p className="break-all text-[11px] leading-5 text-muted-foreground">
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
										<p className="text-sm font-medium text-foreground">My Blossom uploads</p>
										<p className="text-xs text-muted-foreground">
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
									<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
										{libraryError}
									</div>
								) : null}

								<ScrollArea className="h-[22rem] rounded-xl border border-border">
									<div className="space-y-3 p-3">
										{loadingLibrary ? (
											<div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												Loading blobs…
											</div>
										) : filteredLibraryItems.length > 0 ? (
											filteredLibraryItems.map((blob) => {
												const isDeleting = deletingHash === blob.sha256
												const isImage = (blob.type ?? '').startsWith('image/')
												return (
													<div
														key={blob.sha256}
														className="flex items-start gap-3 rounded-xl border border-border bg-card p-3"
													>
														<div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
															{isImage ? (
																<img
																	src={blob.url}
																	alt="Blossom upload"
																	className="h-full w-full object-cover"
																/>
															) : (
																<ImageIcon className="h-5 w-5 text-muted-foreground" />
															)}
														</div>
														<div className="min-w-0 flex-1 space-y-1">
															<p className="truncate text-sm font-medium text-foreground">
																{blob.url}
															</p>
															<p className="text-xs text-muted-foreground">
																{blob.type || 'unknown type'} • {formatBytes(blob.size)}
															</p>
															<p className="truncate text-[11px] text-muted-foreground">
																{blob.sha256.slice(0, 16)}…
															</p>
														</div>
														<div className="flex shrink-0 items-center gap-1">
															<Button
																type="button"
																size="icon-sm"
																variant="outline"
																onClick={() => handleSelectExisting(blob)}
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
																<a href={blob.url} target="_blank" rel="noopener noreferrer">
																	<ExternalLink className="h-4 w-4" />
																</a>
															</Button>
															<Button
																type="button"
																size="icon-sm"
																variant="outline"
																onClick={() => void handleDeleteExisting(blob)}
																disabled={!blob.sha256 || isDeleting}
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
											<div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border bg-muted text-sm text-muted-foreground">
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
