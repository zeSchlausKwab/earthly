import type { ToolCall } from './routstr'

interface Observation {
	result: string
	repetitions: number
}

function normalizedArguments(call: ToolCall): string {
	try {
		return JSON.stringify(JSON.parse(call.function.arguments))
	} catch {
		return call.function.arguments
	}
}

/**
 * Detects same-state observation loops and supplies model guidance without
 * blocking tools, limiting rounds, or ending the run.
 */
export class ToolLoopRecovery {
	private readonly observations = new Map<string, Observation>()

	observe(call: ToolCall, result: string, mapChanged: boolean): string | null {
		if (mapChanged) {
			this.observations.clear()
			return null
		}
		const fingerprint = `${call.function.name}:${normalizedArguments(call)}`
		const previous = this.observations.get(fingerprint)
		const repetitions = previous?.result === result ? previous.repetitions + 1 : 1
		this.observations.set(fingerprint, { result, repetitions })
		if (repetitions < 2) return null
		return [
			'LOOP RECOVERY — this tool call returned exactly the same result in an unchanged map state, so it provided no new information.',
			'Do not repeat this call again unless the map changes. Use the information already returned, choose a different tool or approach, perform the requested write when appropriate, or explain a genuine blocker.',
			'This guidance does not stop the run and does not remove any tools.',
		].join(' ')
	}
}
