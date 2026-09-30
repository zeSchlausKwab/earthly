import { Download, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '../store'

export function ChatUsageView({
	phase,
	stalledSeconds,
	wallet,
	onExport,
}: {
	phase: string
	stalledSeconds: number
	wallet?: { ready: boolean; balance: number; mint: string | null; tooltip: string | null }
	onExport: () => void
}) {
	const { diagnostics: d, models, selectedModel, totalSpent, messages } = useChatStore()
	const context =
		d.effectiveContextTokens ?? models.find((model) => model.id === selectedModel)?.contextLength
	const metrics: [string, string][] = [
		['Prompt capacity', context?.toLocaleString() ?? 'Unknown'],
		['Prompt budget', d.promptBudgetTokens?.toLocaleString() ?? 'Not calculated'],
		[
			'Current prompt',
			d.estimatedPromptTokens
				? `~${d.estimatedPromptTokens.toLocaleString()} tokens`
				: 'No request yet',
		],
		[
			'Expected reply',
			d.estimatedCompletionTokens
				? `~${d.estimatedCompletionTokens.toLocaleString()} tokens`
				: 'Not estimated',
		],
		['Model requests', `${d.modelRequestCount} requests`],
		['Current phase', `${phase}${stalledSeconds ? ` · ${stalledSeconds}s since progress` : ''}`],
		['Cumulative input', `~${d.cumulativeEstimatedPromptTokens.toLocaleString()} tokens`],
		['Cumulative output', `~${d.cumulativeEstimatedCompletionTokens.toLocaleString()} tokens`],
		[
			'Tool work',
			`${d.toolCallCount} calls · ${Math.ceil(d.toolResultBytes / 1024)} KiB · ${(d.totalToolDurationMs / 1000).toFixed(1)}s`,
		],
		['Map progress', `${d.mapChangingToolResultCount} map-changing results`],
		['Finish reason', d.finishReason ?? 'Pending'],
		['Prompt profile', d.promptProfile],
		[
			'Advertised tools',
			`${d.advertisedToolCount} · ${Math.ceil(d.advertisedToolSchemaChars / 1024)} KiB schema`,
		],
		['System prompt', `${d.systemPromptChars.toLocaleString()} chars`],
	]
	return (
		<section aria-label="Usage & diagnostics">
			<h2 className="text-sm font-semibold">Usage & diagnostics</h2>
			<p className="mb-5 mt-1 text-xs text-muted-foreground">
				Latest response in this conversation.
			</p>
			{wallet && (
				<div className="mb-4 space-y-1 border-b pb-4 text-xs">
					<p className="flex items-center gap-2 font-medium">
						<Wallet className="size-4" />
						{wallet.ready
							? `${wallet.balance.toLocaleString()} sats · ${totalSpent.toLocaleString()} spent`
							: 'Wallet not connected'}
					</p>
					{wallet.mint && (
						<p title={wallet.tooltip ?? undefined} className="break-words text-muted-foreground">
							{wallet.mint}
						</p>
					)}
				</div>
			)}
			<dl className="divide-y">
				{metrics.map(([label, value]) => (
					<div key={label} className="grid grid-cols-2 gap-3 py-2.5 text-xs">
						<dt className="text-muted-foreground">{label}</dt>
						<dd className="break-words text-right">{value}</dd>
					</div>
				))}
			</dl>
			{Object.keys(d.toolStats).length > 0 && (
				<div className="mt-5">
					<h3 className="text-xs font-semibold">Tools</h3>
					<dl className="divide-y">
						{Object.entries(d.toolStats).map(([name, stats]) => (
							<div key={name} className="py-2 text-xs">
								<dt className="break-all font-mono">{name}</dt>
								<dd className="text-muted-foreground">
									{stats.calls} calls · {(stats.durationMs / 1000).toFixed(1)}s · {stats.errors}{' '}
									errors
								</dd>
							</div>
						))}
					</dl>
				</div>
			)}
			<Button
				variant="outline"
				className="mt-5 min-h-11 rounded-none text-xs"
				disabled={!messages.length}
				onClick={onExport}
			>
				<Download className="size-4" />
				Export diagnostics
			</Button>
		</section>
	)
}
