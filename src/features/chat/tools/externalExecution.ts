/** The chat runtime and browser bridge share one detached editor and diff context. */
let externalOwner: symbol | null = null
const publicReadOwners = new Set<symbol>()
const chatExecutions = new Set<symbol>()

/** Keep browser calls out until a cancelled chat's awaited tools have actually unwound. */
export function retainChatToolExecution(): () => void {
	const owner = Symbol('chat tool execution')
	chatExecutions.add(owner)
	return () => {
		chatExecutions.delete(owner)
	}
}

export function isExternalToolExecutionActive(): boolean {
	return externalOwner !== null || publicReadOwners.size > 0
}

export function acquireExternalToolExecution(): (() => void) | null {
	if (externalOwner || publicReadOwners.size || chatExecutions.size) return null
	const owner = Symbol('external tool execution')
	externalOwner = owner
	return () => {
		if (externalOwner === owner) externalOwner = null
	}
}

/** Public entity discovery has no detached editor or pending-diff bindings. */
export function acquireExternalPublicReadExecution(): (() => void) | null {
	if (externalOwner || chatExecutions.size) return null
	const owner = Symbol('external public read')
	publicReadOwners.add(owner)
	return () => {
		publicReadOwners.delete(owner)
	}
}
