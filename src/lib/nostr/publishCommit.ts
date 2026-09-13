export interface PublishCommitOptions {
	/** Cancels preparation before durable enqueue or relay transmission begins. */
	signal?: AbortSignal
	/** Rechecks caller authority during preparation and immediately before commitment. */
	beforeCommit?: () => void
}

/**
 * Discovery/service initialization is cancellable. Once enqueue or transmission
 * starts, the signed event may be durable or in flight and cannot be retracted.
 */
export function createPublishCommitGuard(options: PublishCommitOptions = {}) {
	let committed = false
	const assertActive = () => {
		if (committed) return
		options.signal?.throwIfAborted()
		options.beforeCommit?.()
		options.signal?.throwIfAborted()
	}
	assertActive()
	return {
		async prepare<T>(operation: () => Promise<T>): Promise<T> {
			assertActive()
			const result = await operation()
			assertActive()
			return result
		},
		commit<T>(operation: () => T): T {
			assertActive()
			committed = true
			return operation()
		},
	}
}
