import { FileJson, Loader2, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useFieldSessions } from '@/features/field-sessions/model'
import type { SupportDiagnosticsService } from '@/platform/contracts'
import { getSupportDiagnosticsService } from '@/platform/registry'

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function downloadReport(file: File): void {
	const url = URL.createObjectURL(file)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = file.name
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	URL.revokeObjectURL(url)
}

export function OfflineDiagnosticsSection() {
	const sessions = useFieldSessions()
	const [service, setService] = useState<SupportDiagnosticsService | null | undefined>(undefined)
	const [exporting, setExporting] = useState(false)

	useEffect(() => {
		let active = true
		void getSupportDiagnosticsService().then((nextService) => {
			if (active) setService(nextService)
		})
		return () => {
			active = false
		}
	}, [])

	const fieldSessions = useMemo(
		() => ({
			total: sessions.length,
			active: sessions.filter((session) => session.state === 'active').length,
			ended: sessions.filter((session) => session.state === 'ended').length,
			host: sessions.filter((session) => session.role === 'host').length,
			participant: sessions.filter((session) => session.role === 'participant').length,
			nearbyOnly: sessions.filter((session) => session.internetPolicy === 'never').length,
			askBeforeInternet: sessions.filter((session) => session.internetPolicy === 'ask').length,
			peerWritesAllowed: sessions.filter((session) => session.allowPeerWrites).length,
		}),
		[sessions],
	)

	if (service === null) return null

	const exportReport = async () => {
		if (!service) return
		setExporting(true)
		try {
			const native = await service.collect()
			const report = {
				...native,
				client: {
					online: navigator.onLine,
					fieldSessions,
				},
			}
			const stamp = new Date(native.generatedAt * 1_000).toISOString().replaceAll(':', '-')
			const file = new File(
				[`${JSON.stringify(report, null, 2)}\n`],
				`earthly-support-${stamp}.json`,
				{
					type: 'application/json',
				},
			)
			if (
				typeof navigator.share === 'function' &&
				(typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }))
			) {
				try {
					await navigator.share({ title: 'Earthly support report', files: [file] })
					toast.success('Redacted support report shared')
					return
				} catch (error) {
					if (error instanceof DOMException && error.name === 'AbortError') return
				}
			}
			let copied = false
			try {
				await navigator.clipboard.writeText(await file.text())
				copied = true
			} catch {
				// The file download remains the deterministic desktop fallback.
			}
			downloadReport(file)
			toast.success(copied ? 'Support report copied and downloaded' : 'Support report downloaded')
		} catch (error) {
			toast.error(errorMessage(error))
		} finally {
			setExporting(false)
		}
	}

	return (
		<section className="rounded-none border bg-card p-4">
			<div className="flex gap-3">
				<div className="grid size-9 shrink-0 place-items-center bg-muted text-muted-foreground">
					<ShieldCheck className="size-5" />
				</div>
				<div className="min-w-0 flex-1">
					<h3 className="font-semibold">Support report</h3>
					<p className="mt-1 text-xs text-muted-foreground">
						Share counts and health states when an offline workflow fails. Earthly excludes
						identities, addresses, links, messages, map locations, geometry, hashes, and invite
						secrets.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3 w-full"
						disabled={!service || exporting}
						onClick={() => void exportReport()}
					>
						{exporting || service === undefined ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<FileJson className="size-4" />
						)}
						Share redacted report
					</Button>
				</div>
			</div>
		</section>
	)
}
