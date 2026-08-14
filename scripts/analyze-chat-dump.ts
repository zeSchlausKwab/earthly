interface DumpMessage {
	role?: string
	content?: unknown
	tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
}

interface ChatDump {
	chat?: { title?: string }
	endpoint?: { provider?: string; modelLabel?: string; promptProfile?: string }
	diagnostics?: Record<string, unknown>
	analysis?: Record<string, unknown>
	messages?: DumpMessage[]
}

function analyzeLegacy(messages: DumpMessage[]) {
	let toolCallCount = 0
	let toolErrorCount = 0
	const fingerprints = new Map<string, number>()
	for (const message of messages) {
		for (const call of message.tool_calls ?? []) {
			toolCallCount += 1
			const fingerprint = `${call.function?.name ?? 'unknown'}:${call.function?.arguments ?? ''}`
			fingerprints.set(fingerprint, (fingerprints.get(fingerprint) ?? 0) + 1)
		}
		if (message.role === 'tool' && typeof message.content === 'string') {
			try {
				const value = JSON.parse(message.content) as Record<string, unknown>
				if (value.ok === false || value.kind === 'unknown_tool' || value.kind === 'handler_error') {
					toolErrorCount += 1
				}
			} catch {
				// Raw non-JSON tool output is not automatically an error.
			}
		}
	}
	return {
		toolCallCount,
		toolErrorCount,
		repeatedToolCalls: [...fingerprints.values()].filter((count) => count > 1).length,
		completedWithAssistant: messages.at(-1)?.role === 'assistant',
	}
}

const paths = Bun.argv.slice(2)
if (paths.length === 0) {
	console.error('Usage: bun run chat:analyze <earthly-chat-dump.json> [...]')
	process.exit(1)
}

for (const path of paths) {
	const dump = (await Bun.file(path).json()) as ChatDump
	const analysis = dump.analysis ?? analyzeLegacy(dump.messages ?? [])
	console.log(
		JSON.stringify(
			{
				file: path,
				chat: dump.chat?.title ?? null,
				provider: dump.endpoint?.provider ?? null,
				model: dump.endpoint?.modelLabel ?? null,
				promptProfile: dump.endpoint?.promptProfile ?? 'legacy/unknown',
				diagnostics: dump.diagnostics ?? null,
				analysis,
			},
			null,
			2,
		),
	)
}
