import { useActiveAccount } from 'applesauce-react/hooks'
import { Bot, X } from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
	clearDocumentReviews,
	getDocumentReviews,
	subscribeDocumentReviews,
	resolveDocumentReview,
	undoDocumentReview,
} from './documentReviews'
import { useEditorStore } from '@/features/geo-editor/store'
import { DatasetDiffDisclosure } from '@/features/chat/safeEditing/DatasetDiffDisclosure'
import {
	getAllPendingDiffs,
	clearPendingDiffsForChat,
	resolvePendingDiff,
	subscribePendingDiffs,
} from '@/features/chat/safeEditing/pendingDiffStore'
import { undoPendingDiff } from '@/features/chat/safeEditing/targetBoundUndo'
import { getModelContext, registerBrowserTools } from './platform'
import { cancelDesktopOperation, createBrowserToolService } from './service'
import { DESKTOP_AGENT_SCOPE, useWebMcpStore } from './state'

export function WebMcpRuntimeHost() {
	const enabled = useWebMcpStore((state) => state.enabled)
	const externalQueriesEnabled = useWebMcpStore((state) => state.externalQueriesEnabled)
	const account = useActiveAccount()?.pubkey ?? null
	const previousAccount = useRef(account)
	useEffect(() => {
		if (previousAccount.current !== account) {
			cancelDesktopOperation()
			clearPendingDiffsForChat(DESKTOP_AGENT_SCOPE)
			clearDocumentReviews()
			useWebMcpStore.setState({ activities: [], panelOpen: false })
		}
		previousAccount.current = account
	}, [account])

	useEffect(() => {
		const context = getModelContext()
		if (!context) {
			useWebMcpStore.setState({ status: 'unsupported', toolCount: 0 })
			return
		}
		if (!enabled) {
			useWebMcpStore.setState({ status: 'off', toolCount: 0 })
			return
		}
		const controller = new AbortController()
		useWebMcpStore.setState({ status: 'starting', error: null })
		const register = async () => {
			try {
				const tools = createBrowserToolService(controller.signal, undefined, externalQueriesEnabled)
				await registerBrowserTools(context, tools, controller.signal)
				if (!controller.signal.aborted && previousAccount.current === account)
					useWebMcpStore.setState({ status: 'ready', toolCount: tools.length })
			} catch (error) {
				if (controller.signal.aborted || previousAccount.current !== account) return
				controller.abort()
				useWebMcpStore.setState({
					status: 'error',
					toolCount: 0,
					error: error instanceof Error ? error.message : 'Registration failed.',
				})
			}
		}
		void register()
		return () => controller.abort()
	}, [enabled, externalQueriesEnabled, account])
	return <DesktopAgentActivity />
}

function DesktopAgentActivity() {
	const drafts = useEditorStore((state) => state.geoEditDrafts)
	const { enabled, status, panelOpen, activities } = useWebMcpStore()
	const diffs = useSyncExternalStore(subscribePendingDiffs, getAllPendingDiffs, getAllPendingDiffs)
	const documents = useSyncExternalStore(
		subscribeDocumentReviews,
		getDocumentReviews,
		getDocumentReviews,
	)
	const ownDiffs = diffs.filter((entry) => entry.chatId === DESKTOP_AGENT_SCOPE).slice(-20)
	useEffect(() => {
		if (
			diffs.some((entry) => entry.chatId === DESKTOP_AGENT_SCOPE && entry.status === 'pending') ||
			documents.some((entry) => entry.status === 'pending')
		)
			useWebMcpStore.setState({ panelOpen: true })
	}, [diffs, documents])
	const running = activities.find((item) => item.status === 'running')
	if ((!enabled || status === 'unsupported') && !panelOpen && !activities.length) return null
	return (
		<div className="fixed right-14 top-[calc(max(0.5rem,env(safe-area-inset-top))+4rem)] z-[90] max-w-[calc(100vw-80px)] md:top-auto md:bottom-16">
			{panelOpen ? (
				<aside
					aria-label="Desktop agent activity"
					className="flex max-h-[calc(100dvh-8rem-var(--mobile-dock-height,64px)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-96 max-w-full flex-col border border-border bg-background p-3 shadow-lg md:max-h-[calc(100dvh-8rem)]"
				>
					<div className="flex shrink-0 items-center justify-between gap-2">
						<h2 className="flex items-center gap-2 text-sm font-semibold">
							<Bot className="size-4" />
							Desktop agent activity
						</h2>
						<Button
							size="icon"
							variant="ghost"
							aria-label="Close desktop agent activity"
							onClick={() => useWebMcpStore.setState({ panelOpen: false })}
						>
							<X className="size-4" />
						</Button>
					</div>
					<p className="mt-1 shrink-0 text-xs text-muted-foreground" role="status">
						{running
							? `Running ${toolLabel(running.tool)}`
							: enabled
								? `Access ${status}`
								: 'Access off'}
					</p>
					<div className="mt-3 min-h-0 max-h-[50vh] space-y-2 overflow-y-auto">
						{activities.slice(-5).map((item) => (
							<p key={item.id} className="break-words text-xs">
								<span title={item.tool}>{toolLabel(item.tool)}</span> · {item.status}
								{item.message ? ` · ${item.message}` : ''}
							</p>
						))}
						{ownDiffs.map((entry) => (
							<div key={entry.id} className="space-y-1">
								<p className="text-xs text-muted-foreground">
									{drafts[entry.target?.draftId ?? '']?.name || 'Map draft'}
								</p>
								<DatasetDiffDisclosure
									diff={entry.diff}
									status={entry.status}
									headline={entry.headline}
									metadataChanges={entry.metadataChanges}
									onApply={() => resolvePendingDiff(entry.id, 'applied')}
									onCancel={() => resolvePendingDiff(entry.id, 'cancelled')}
								/>
								{entry.status === 'applied' && entry.commit ? (
									<Button
										size="sm"
										variant="outline"
										disabled={Boolean(running)}
										onClick={() => undoPendingDiff(entry.id)}
									>
										Undo desktop agent edit
									</Button>
								) : null}
							</div>
						))}
						{documents.map((entry) => (
							<section
								key={entry.id}
								className="space-y-2 rounded border p-2 text-xs"
								aria-label={`${entry.kind === 'story' ? 'Story' : 'Atlas'} draft changes`}
							>
								<p className="font-medium">
									{'name' in entry.after ? entry.after.name : entry.after.title} · {entry.status}
								</p>
								<details>
									<summary>Review document changes</summary>
									<details>
										<summary>Before</summary>
										<pre className="whitespace-pre-wrap break-words">
											{JSON.stringify(entry.before, null, 2)}
										</pre>
									</details>
									<details open>
										<summary>After</summary>
										<pre className="whitespace-pre-wrap break-words">
											{JSON.stringify(entry.after, null, 2)}
										</pre>
									</details>
								</details>
								{entry.status === 'pending' && (
									<div className="flex gap-2">
										<Button size="sm" onClick={() => resolveDocumentReview(entry.id, true)}>
											Apply changes
										</Button>
										<Button
											size="sm"
											variant="outline"
											onClick={() => resolveDocumentReview(entry.id, false)}
										>
											Cancel
										</Button>
									</div>
								)}
								{entry.status === 'applied' && (
									<Button
										size="sm"
										variant="outline"
										disabled={Boolean(running)}
										onClick={() => {
											if (!undoDocumentReview(entry.id))
												toast.error(
													'This draft changed since the AI edit. Open it to review; Undo did not overwrite it.',
												)
										}}
									>
										Undo desktop agent edit
									</Button>
								)}
							</section>
						))}
						{!activities.length ? (
							<p className="text-xs text-muted-foreground">
								Agent calls and edit reviews will appear here.
							</p>
						) : null}
					</div>
					<div className="mt-3 flex shrink-0 gap-2">
						{running ? (
							<Button size="sm" variant="outline" onClick={cancelDesktopOperation}>
								Cancel operation
							</Button>
						) : null}
						{enabled ? (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									useWebMcpStore.getState().setEnabled(false)
									cancelDesktopOperation()
								}}
							>
								Disable agent access
							</Button>
						) : null}
					</div>
				</aside>
			) : (
				<Button
					variant="outline"
					className="size-11 bg-background md:h-7 md:w-auto"
					aria-label={running ? 'Desktop agent · Working' : 'Desktop agent'}
					title={running ? 'Desktop agent · Working' : 'Desktop agent activity'}
					onClick={() => useWebMcpStore.setState({ panelOpen: true })}
				>
					<Bot className="size-4" />
					<span className="hidden md:inline">Desktop agent{running ? ' · Working' : ''}</span>
					{running ? <span className="size-1.5 rounded-full bg-primary md:hidden" /> : null}
				</Button>
			)}
		</div>
	)
}

function toolLabel(name: string): string {
	const words = name.replace(/^earthly_/, '').replaceAll('_', ' ')
	return words.charAt(0).toUpperCase() + words.slice(1)
}
