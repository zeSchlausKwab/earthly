import { Download, FileText, LockKeyhole, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	CORDN_ENCRYPTED_MEDIA_VERSION,
	downloadAndDecryptMedia,
	type PrivateWorkspaceService,
	type ProjectedMediaAttachment,
	type StoredWorkspace,
} from '@/lib/private-workspace'

interface DecryptedImageState {
	status: 'loading' | 'ready' | 'error'
	url?: string
	error?: string
}

function isImageMime(mime: string): boolean {
	return mime.split(';')[0]?.trim().toLowerCase().startsWith('image/') ?? false
}

function triggerDownload(bytes: Uint8Array, mime: string, filename: string) {
	const copy = new Uint8Array(bytes.byteLength)
	copy.set(bytes)
	const blob = new Blob([copy], { type: mime })
	const objectUrl = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = objectUrl
	link.download = filename
	document.body.appendChild(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}

function DecryptedImagePreview({
	workspace,
	service,
	envelopeId,
	attachment,
}: {
	workspace: StoredWorkspace
	service?: PrivateWorkspaceService
	envelopeId?: string
	attachment: ProjectedMediaAttachment
}) {
	const [state, setState] = useState<DecryptedImageState>({ status: 'loading' })
	const [attempt, setAttempt] = useState(0)

	useEffect(() => {
		if (attempt < 0) return
		if (!service) {
			setState({ status: 'error', error: 'Media decryption unavailable' })
			return
		}
		let cancelled = false
		let objectUrl: string | undefined
		const controller = new AbortController()
		setState({ status: 'loading' })

		void (async () => {
			try {
				const key = await service.resolveMediaKeyForAttachment(workspace, attachment, envelopeId)
				const decrypted = await downloadAndDecryptMedia({
					attachment,
					epochMediaKey: attachment.v === CORDN_ENCRYPTED_MEDIA_VERSION ? key : undefined,
					signal: controller.signal,
				})
				if (cancelled) return
				const copy = new Uint8Array(decrypted.bytes.byteLength)
				copy.set(decrypted.bytes)
				objectUrl = URL.createObjectURL(new Blob([copy], { type: decrypted.mime }))
				setState({ status: 'ready', url: objectUrl })
			} catch (error) {
				if (cancelled) return
				setState({
					status: 'error',
					error: error instanceof Error ? error.message : 'Could not decrypt media',
				})
			}
		})()

		return () => {
			cancelled = true
			controller.abort()
			if (objectUrl) URL.revokeObjectURL(objectUrl)
		}
	}, [workspace, service, envelopeId, attachment, attempt])

	if (state.status === 'loading') {
		return (
			<div className="flex items-center gap-2 rounded-[2px] border border-border bg-muted/30 px-2 py-2 text-[11px] text-muted-foreground">
				<RefreshCw className="h-3.5 w-3.5 animate-spin" />
				<span className="truncate">Decrypting {attachment.filename}…</span>
			</div>
		)
	}

	if (state.status === 'error' || !state.url) {
		return (
			<div className="flex items-center justify-between gap-2 rounded-[2px] border border-border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
				<span className="flex min-w-0 items-center gap-1.5">
					<LockKeyhole className="h-3.5 w-3.5 shrink-0" />
					<span className="truncate">{state.error ?? 'Encrypted media unavailable'}</span>
				</span>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					className="h-6 shrink-0 px-1.5 text-[10px]"
					onClick={() => setAttempt((count) => count + 1)}
				>
					Retry
				</Button>
			</div>
		)
	}

	return (
		<figure className="overflow-hidden rounded-[2px] border border-border bg-muted/20">
			<a href={state.url} target="_blank" rel="noreferrer" className="block">
				<img
					src={state.url}
					alt={attachment.alt ?? attachment.filename}
					loading="lazy"
					className="max-h-56 w-full object-contain bg-background/60"
				/>
			</a>
			<figcaption className="flex items-center justify-between gap-2 border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
				<span className="flex min-w-0 items-center gap-1">
					<LockKeyhole className="h-3 w-3 shrink-0 text-ok" />
					<span className="truncate">{attachment.alt || attachment.filename}</span>
				</span>
				<a
					href={state.url}
					download={attachment.filename}
					className="shrink-0 font-mono text-[9.5px] uppercase text-foreground hover:underline"
				>
					Save
				</a>
			</figcaption>
		</figure>
	)
}

function EncryptedFileCard({
	workspace,
	service,
	envelopeId,
	attachment,
}: {
	workspace: StoredWorkspace
	service?: PrivateWorkspaceService
	envelopeId?: string
	attachment: ProjectedMediaAttachment
}) {
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string>()

	const handleDownload = useCallback(async () => {
		if (!service || busy) return
		setBusy(true)
		setError(undefined)
		try {
			const key = await service.resolveMediaKeyForAttachment(workspace, attachment, envelopeId)
			const decrypted = await downloadAndDecryptMedia({
				attachment,
				epochMediaKey: attachment.v === CORDN_ENCRYPTED_MEDIA_VERSION ? key : undefined,
			})
			triggerDownload(decrypted.bytes, decrypted.mime, decrypted.filename)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not decrypt file')
		} finally {
			setBusy(false)
		}
	}, [workspace, service, envelopeId, attachment, busy])

	return (
		<div className="rounded-[2px] border border-border bg-muted/25 px-2 py-1.5 text-[11px]">
			<div className="flex items-center gap-2">
				<FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-foreground">{attachment.filename}</p>
					<p className="font-mono text-[9.5px] text-muted-foreground">
						{attachment.mime} · {attachment.v}
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="xs"
					className="h-6 shrink-0 gap-1 px-2 text-[10px]"
					disabled={!service || busy}
					onClick={() => void handleDownload()}
				>
					{busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
					{busy ? 'Decrypting…' : 'Decrypt'}
				</Button>
			</div>
			{error ? <p className="mt-1 text-[10px] text-destructive">{error}</p> : null}
		</div>
	)
}

export function PrivateMediaAttachments({
	workspace,
	service,
	envelopeId,
	attachments,
}: {
	workspace: StoredWorkspace
	service?: PrivateWorkspaceService
	envelopeId?: string
	attachments: readonly ProjectedMediaAttachment[]
}) {
	if (attachments.length === 0) return null

	return (
		<div className="mt-2 space-y-1.5">
			{attachments.map((attachment) =>
				isImageMime(attachment.mime) ? (
					<DecryptedImagePreview
						key={`${attachment.x}:${attachment.n}`}
						workspace={workspace}
						service={service}
						envelopeId={envelopeId}
						attachment={attachment}
					/>
				) : (
					<EncryptedFileCard
						key={`${attachment.x}:${attachment.n}`}
						workspace={workspace}
						service={service}
						envelopeId={envelopeId}
						attachment={attachment}
					/>
				),
			)}
		</div>
	)
}
